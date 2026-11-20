// Two-tier proof-based Lane cleanup (Spec unified-lane-sessions D11).
//
// Per integrated child of any agreement, `advanceBatch` calls
// `BatchSessionPort.closeWithProof(handle, key)`. Only when that call returns
// a proven `exited` bound to `(handle, key)` and per-child Git conditions hold
// (clean Lane worktree, `imm-lane/<slug>/<task_id>` ancestor of the batch
// branch) does cleanup remove that child's Lane worktree and
// `refs/heads/imm-lane/<slug>/<task_id>`, recording `lane_removed` with the
// proof while leaving sibling Lanes and `record.branch` untouched. The batch
// branch `refs/heads/imm/<slug>` is deleted only by the checkout-delivery
// step, never here. Any failed proof or Git condition retains the Lane with
// `batch_lane_retained` naming the condition; parked, stopped and redo Lanes
// are never passed here by the caller.
import { spawnSync } from "node:child_process";

export const LANE_RETAINED_REASON = "batch_lane_retained";

export interface ChildExitProof {
	ok: true;
	exited: true;
	handle: string;
	key?: string;
	session_key?: string;
}

export type LaneCleanupOutcome =
	| { status: "removed"; exit: ChildExitProof; worktree: string; branches: string[] }
	| { status: "retained"; condition: string };

function git(cwd: string, ...args: string[]) {
	return spawnSync("git", ["--no-optional-locks", "-C", cwd, ...args], { encoding: "utf8" });
}

/** `batch_lane_retained` report text for a failed condition. */
export function retainedLaneReason(condition: string): string {
	return `${LANE_RETAINED_REASON}: ${condition}; the Lane worktree and branch are kept`;
}

function proofCondition(proof: unknown): string | null {
	if (!proof || typeof proof !== "object") return "no exit proof was returned for this Lane session";
	const p = proof as Record<string, unknown>;
	if (p.ok !== true || p.exited !== true) {
		const code = typeof p.code === "string" ? String(p.code) : "unproven";
		const reason = typeof p.reason === "string" ? String(p.reason) : "closeWithProof did not prove exit";
		return `${reason} (${code})`;
	}
	if (typeof p.handle !== "string" || !p.handle) return "the exit proof carries no handle";
	if (typeof p.key !== "string" && typeof p.session_key !== "string") return "the exit proof carries no session key";
	return null;
}

/**
 * Remove one integrated child's Lane worktree and its `imm-lane/` branch.
 * Nothing is removed unless the proof and every Git condition hold; a failure
 * mid-removal retains whatever is left and reports it. The batch branch
 * (`parentRef`) is only read for the ancestor check and is never deleted here.
 */
export function cleanupIntegratedChildLane(input: {
	root: string;
	lanePath: string;
	laneBranch: string;
	parentRef: string;
	proof: unknown;
}): LaneCleanupOutcome {
	const retain = (condition: string): LaneCleanupOutcome => ({ status: "retained", condition });
	const unproven = proofCondition(input.proof);
	if (unproven) return retain(unproven);
	const exit = input.proof as ChildExitProof;
	const status = git(input.lanePath, "status", "--porcelain", "--untracked-files=all");
	if (status.status !== 0) return retain("the Lane status is unreadable");
	if (status.stdout.trim()) {
		const paths = status.stdout.split("\n").filter(Boolean).map(line => line.slice(3)).sort();
		return retain(`the Lane has tracked modifications or untracked files: ${paths.join(", ")}`);
	}
	const laneRef = `refs/heads/${input.laneBranch}`;
	const laneTip = git(input.root, "rev-parse", "--verify", "--quiet", `${laneRef}^{commit}`);
	const parentTip = git(input.root, "rev-parse", "--verify", "--quiet", `${input.parentRef}^{commit}`);
	if (laneTip.status !== 0 || parentTip.status !== 0) return retain("a Lane branch is unreadable");
	if (git(input.root, "merge-base", "--is-ancestor", laneTip.stdout.trim(), parentTip.stdout.trim()).status !== 0)
		return retain(`the Lane branch carries commits that ${input.parentRef.replace("refs/heads/", "")} does not`);
	const listed = git(input.root, "worktree", "list", "--porcelain");
	if (listed.status !== 0) return retain("the worktree list is unreadable");
	if (listed.stdout.split("\n").includes(`branch ${input.parentRef}`))
		return retain(`${input.parentRef.replace("refs/heads/", "")} is checked out in a worktree`);
	const removed = git(input.root, "worktree", "remove", input.lanePath);
	if (removed.status !== 0) return retain(`the Lane worktree could not be removed: ${removed.stderr.trim()}`);
	const deleted = git(input.root, "update-ref", "-d", laneRef, laneTip.stdout.trim());
	if (deleted.status !== 0) return retain(`${laneRef.replace("refs/heads/", "")} could not be removed: ${deleted.stderr.trim()}`);
	return { status: "removed", exit, worktree: input.lanePath, branches: [input.laneBranch] };
}

/**
 * Remove one child's Lane worktree and `imm-lane/` branch for a discarded batch
 * (loop-leader-uls-alignment D4.1). Unlike integrated cleanup the branch may
 * carry commits the batch never took, because the owner abandoned the work; the
 * exit proof and a clean worktree are still required, so uncommitted edits are
 * never deleted. A worktree or branch already gone counts as removed, which
 * makes a retry after a partial removal converge.
 */
export function cleanupDiscardedChildLane(input: {
	root: string;
	lanePath: string;
	laneBranch: string;
	/** The exit proof of the child's session; `null` only when the child never held a session. */
	proof: unknown;
}): { status: "removed"; worktree: string; branches: string[] } | { status: "retained"; condition: string } {
	const retain = (condition: string): { status: "retained"; condition: string } => ({ status: "retained", condition });
	const unproven = input.proof === null ? null : proofCondition(input.proof);
	if (unproven) return retain(unproven);
	const listed = git(input.root, "worktree", "list", "--porcelain");
	if (listed.status !== 0) return retain("the worktree list is unreadable");
	const registered = listed.stdout.split("\n").includes(`worktree ${input.lanePath}`);
	if (registered) {
		const status = git(input.lanePath, "status", "--porcelain", "--untracked-files=all");
		if (status.status !== 0) return retain("the Lane status is unreadable");
		if (status.stdout.trim()) {
			const paths = status.stdout.split("\n").filter(Boolean).map(line => line.slice(3)).sort();
			return retain(`the Lane has tracked modifications or untracked files: ${paths.join(", ")}`);
		}
		const removed = git(input.root, "worktree", "remove", input.lanePath);
		if (removed.status !== 0) return retain(`the Lane worktree could not be removed: ${removed.stderr.trim()}`);
	}
	const laneRef = `refs/heads/${input.laneBranch}`;
	const laneTip = git(input.root, "rev-parse", "--verify", "--quiet", `${laneRef}^{commit}`);
	if (laneTip.status === 0) {
		if (git(input.root, "worktree", "list", "--porcelain").stdout.split("\n").includes(`branch ${laneRef}`))
			return retain(`${input.laneBranch} is checked out in another worktree`);
		const deleted = git(input.root, "update-ref", "-d", laneRef, laneTip.stdout.trim());
		if (deleted.status !== 0) return retain(`${input.laneBranch} could not be removed: ${deleted.stderr.trim()}`);
	}
	return { status: "removed", worktree: input.lanePath, branches: [input.laneBranch] };
}

/**
 * Delete the batch branch `refs/heads/imm/<slug>` after a successful
 * `checkout_delivery`. Only the checkout path calls this, only once the whole
 * batch completed and `deliverSingleTask` succeeded, and only when the branch
 * is not checked out in any worktree. Under `retain_branch` this is never
 * called and the branch is kept.
 */
export function cleanupParentBranch(input: {
	root: string;
	parentRef: string;
}): { removed: boolean; condition?: string } {
	const listed = git(input.root, "worktree", "list", "--porcelain");
	if (listed.status !== 0) return { removed: false, condition: "the worktree list is unreadable" };
	if (listed.stdout.split("\n").includes(`branch ${input.parentRef}`))
		return { removed: false, condition: `${input.parentRef.replace("refs/heads/", "")} is checked out in a worktree` };
	const tip = git(input.root, "rev-parse", "--verify", "--quiet", `${input.parentRef}^{commit}`);
	if (tip.status !== 0) return { removed: false, condition: "the batch branch is unreadable" };
	const deleted = git(input.root, "update-ref", "-d", input.parentRef, tip.stdout.trim());
	if (deleted.status !== 0)
		return { removed: false, condition: `${input.parentRef.replace("refs/heads/", "")} could not be removed: ${deleted.stderr.trim()}` };
	return { removed: true };
}
