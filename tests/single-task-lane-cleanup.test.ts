// Two-tier proof-based Lane cleanup (Spec unified-lane-sessions D11, S6).
// Per integrated child, `closeWithProof` proof + Git checks remove the Lane
// worktree and `imm-lane/<slug>/<task_id>`; the batch branch is deleted only
// by the checkout-delivery step. Any failed proof or Git condition retains
// with `batch_lane_retained`.
import { afterAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cleanupIntegratedChildLane, cleanupParentBranch, retainedLaneReason } from "../plugins/immune-brain/runtime/unattended/lane_cleanup";

const REPO_ROOT = resolve(import.meta.dir, "..");
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", ["-C", cwd, "-c", "user.name=T", "-c", "user.email=t@t", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const PROOF = { ok: true as const, exited: true as const, handle: "h1", key: "imm-t-g1-abc123" };
const branches = (repo: string) => git(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads/imm-lane", "refs/heads/imm").split("\n").filter(Boolean);

/** A delivered Lane: parent branch carries its tip, worktree checked out on the lane branch. */
function lane(slug = "t", task = "t") {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "imm-lane-unit-")));
	roots.push(dir);
	const repo = join(dir, "repo"), path = join(dir, "lane");
	mkdirSync(repo);
	writeFileSync(join(repo, ".gitignore"), "ignored.log\n");
	writeFileSync(join(repo, "tracked.txt"), "tracked\n");
	git(repo, "init", "-q", "-b", "main"); git(repo, "add", "-A"); git(repo, "commit", "-qm", "base");
	const laneBranch = `imm-lane/${slug}/${task}`;
	git(repo, "worktree", "add", "-q", "-b", laneBranch, path);
	writeFileSync(join(path, "delivered.txt"), "d\n"); git(path, "add", "-A"); git(path, "commit", "-qm", "delivery");
	git(repo, "branch", `imm/${slug}`, laneBranch);
	const parentRef = `refs/heads/imm/${slug}`;
	const run = (overrides: Partial<Parameters<typeof cleanupIntegratedChildLane>[0]> = {}) => cleanupIntegratedChildLane({
		root: repo, lanePath: path, laneBranch, parentRef, proof: PROOF, ...overrides });
	return { repo, path, laneBranch, parentRef, run };
}

const kept = (f: ReturnType<typeof lane>) => {
	expect(existsSync(f.path)).toBe(true);
	expect(branches(f.repo)).toContain(f.laneBranch);
};

describe("two-tier per-child cleanup", () => {
	it("removes the worktree and imm-lane branch on a clean Lane, ignoring ignored files, for single-task and Initiative shapes", () => {
		for (const [slug, task] of [["t", "t"], ["slug", "child-1"]] as const) {
			const f = lane(slug, task);
			writeFileSync(join(f.path, "ignored.log"), "scratch\n");
			expect(f.run()).toEqual({ status: "removed", exit: PROOF, worktree: f.path, branches: [f.laneBranch] });
			expect(existsSync(f.path)).toBe(false);
			// The batch branch stays: only the checkout-delivery step deletes it.
			expect(branches(f.repo)).toEqual([`imm/${slug}`]);
			expect(git(f.repo, "worktree", "list", "--porcelain")).not.toContain(f.path);
		}
	});

	it("keeps a Lane with a tracked modification or an untracked non-ignored file, naming the file", () => {
		for (const [path, content] of [["tracked.txt", "edited\n"], ["stray.txt", "stray\n"]] as const) {
			const f = lane();
			writeFileSync(join(f.path, path), content);
			expect(f.run()).toEqual({ status: "retained", condition: expect.stringContaining(`the Lane has tracked modifications or untracked files: ${path}`) });
			kept(f);
			expect(retainedLaneReason("x")).toContain("batch_lane_retained");
			expect(readFileSync(join(f.path, path), "utf8")).toBe(content);
		}
	});

	it("keeps a Lane whose branch carries a commit that the batch branch lacks", () => {
		const f = lane();
		writeFileSync(join(f.path, "late.txt"), "late\n"); git(f.path, "add", "-A"); git(f.path, "commit", "-qm", "late");
		expect(f.run()).toEqual({ status: "retained", condition: expect.stringContaining("carries commits that imm/t does not") });
		kept(f);
	});

	it("keeps a Lane while the batch branch is checked out elsewhere", () => {
		const f = lane();
		git(f.repo, "checkout", "-q", "imm/t");
		expect(f.run()).toEqual({ status: "retained", condition: expect.stringContaining("imm/t is checked out in a worktree") });
		kept(f);
	});

	it("retains on every unproven closeWithProof shape, naming the failed condition", () => {
		const cases: Array<[unknown, string]> = [
			[null, "no exit proof"],
			[{ ok: false, code: "unknown", reason: "the session state is unknown" }, "unknown"],
			[{ ok: false, code: "timeout", reason: "await timed out" }, "timeout"],
			[{ ok: false, code: "events_lost", reason: "the provider dropped events" }, "events_lost"],
			[{ ok: false, code: "not_owned", reason: "handle was not created for this session key" }, "not_owned"],
			[{ ok: true, exited: true, handle: "", key: "k" }, "no handle"],
			[{ ok: true, exited: true, handle: "h" }, "no session key"],
		];
		for (const [proof, text] of cases) {
			const f = lane();
			expect(f.run({ proof })).toEqual({ status: "retained", condition: expect.stringContaining(text) });
			kept(f);
		}
	});

	it("deletes the batch branch only when it is not checked out anywhere", () => {
		const f = lane();
		expect(cleanupParentBranch({ root: f.repo, parentRef: f.parentRef })).toEqual({ removed: true });
		expect(branches(f.repo)).toEqual([f.laneBranch]);
		const g = lane();
		git(g.repo, "checkout", "-q", "imm/t");
		expect(cleanupParentBranch({ root: g.repo, parentRef: g.parentRef })).toMatchObject({ removed: false, condition: expect.stringContaining("checked out") });
		expect(branches(g.repo)).toContain("imm/t");
	});
});

describe("two-tier cleanup contract", () => {
	it("documents closeWithProof cleanup, lane_removed and batch_lane_retained in ADR 0027", () => {
		const adr = readFileSync(join(REPO_ROOT, "docs/adr/0027-parent-branch-merge-queue.md"), "utf8");
		expect(adr).toContain("lane_removed");
		expect(adr.toLowerCase()).toContain("exit proof");
		expect(adr).toContain("batch_lane_retained");
		expect(adr).toContain("closeWithProof");
	});
});
