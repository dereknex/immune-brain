// Single-task Lane cleanup (Spec drive-always-lanes D7). A Lane is removed only on
// exit proof taken from the runtime's own child-process exit event; every other
// case retains the Lane and names the failed condition.
import { spawnSync } from "node:child_process";
import type { LaneExit, LaneGeneration } from "./lane_supervisor";

export const LANE_RETAINED_REASON = "batch_lane_retained";

export type LaneCleanupOutcome =
	| { status: "removed"; exit: LaneExit; worktree: string; branches: string[] }
	| { status: "retained"; condition: string };

/** The first exit-proof condition that fails, or null when the current generation exited normally. */
export function exitProofCondition(generation: LaneGeneration | null, observation?: LaneExit | null): string | null {
	if (!generation) return "no Executor generation was supervised by the runtime, so no exit was observed";
	if (generation.state === "interrupted") return `Executor generation ${generation.generation} was interrupted`;
	if (generation.state === "stopped_by_parent") return `Executor generation ${generation.generation} was stopped by the Parent`;
	if (generation.state !== "exited" || !generation.exit)
		return `Executor generation ${generation.generation} exit was never observed (unobservable)`;
	const exit = observation ?? generation.exit;
	if (exit.generation !== generation.generation)
		return `the exit observation belongs to superseded generation ${exit.generation}; the current generation is ${generation.generation}`;
	if (exit.pid !== generation.pid || exit.repository !== generation.repository || exit.lane_path !== generation.lane_path)
		return `the exit observation of generation ${generation.generation} is not bound to this Executor process`;
	if (exit.code !== 0 || exit.signal !== null)
		return `Executor generation ${generation.generation} did not exit normally (${exit.signal ? `signal ${exit.signal}` : `code ${exit.code}`})`;
	return null;
}

function git(cwd: string, ...args: string[]) {
	return spawnSync("git", ["--no-optional-locks", "-C", cwd, ...args], { encoding: "utf8" });
}

/** `batch_lane_retained` report text for a failed condition. */
export function retainedLaneReason(condition: string): string {
	return `${LANE_RETAINED_REASON}: ${condition}; the Lane worktree and both branches are kept`;
}

/**
 * Remove a delivered single-task Lane, its `imm-lane/` branch and `imm/<task_id>`.
 * Nothing is removed unless every condition holds; a failure mid-removal retains
 * whatever is left and reports it.
 */
export function cleanupSingleTaskLane(input: {
	root: string;
	lanePath: string;
	laneBranch: string;
	parentRef: string;
	generation: LaneGeneration | null;
	observation?: LaneExit | null;
}): LaneCleanupOutcome {
	const retain = (condition: string): LaneCleanupOutcome => ({ status: "retained", condition });
	const proof = exitProofCondition(input.generation, input.observation);
	if (proof) return retain(proof);
	const exit = input.observation ?? input.generation!.exit!;
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
	for (const [ref, tip] of [[laneRef, laneTip.stdout.trim()], [input.parentRef, parentTip.stdout.trim()]] as const) {
		const deleted = git(input.root, "update-ref", "-d", ref, tip);
		if (deleted.status !== 0) return retain(`${ref.replace("refs/heads/", "")} could not be removed: ${deleted.stderr.trim()}`);
	}
	return { status: "removed", exit, worktree: input.lanePath,
		branches: [input.laneBranch, input.parentRef.replace("refs/heads/", "")] };
}
