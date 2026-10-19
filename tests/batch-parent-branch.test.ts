import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBatchGitPreflight } from "../plugins/immune-brain/runtime/unattended/batch_git";
import { changeIdentity, identitiesEqual, integrateLaneCommit } from "../plugins/immune-brain/runtime/unattended/batch_integration";
import { runFinalVerification } from "../plugins/immune-brain/runtime/unattended/batch_final_verification";
import { resolveLaneParallel } from "../plugins/immune-brain/runtime/unattended/batch_lanes";
import { createLaneWorktree, removeLaneWorktree } from "../plugins/immune-brain/runtime/unattended/batch_worktrees";

const ref = "refs/heads/imm/parent";
function git(root: string, ...args: string[]): string {
	return execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@local", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function fixture() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "imm-parent-")));
	git(root, "init", "-q", "-b", "main");
	writeFileSync(join(root, "value.txt"), "base\n");
	writeFileSync(join(root, "check.ts"), 'import { readFileSync } from "node:fs"; process.exit(readFileSync("value.txt", "utf8") === "parent\\n" ? 0 : 1);\n');
	git(root, "add", "--", "value.txt", "check.ts");
	git(root, "commit", "-qm", "base");
	const base = git(root, "rev-parse", "HEAD");
	const start = () => runBatchGitPreflight({ root, initiative_slug: "parent", base_head: base, batch_id: "batch-parent", progress_mode: "parent_branch", blocking_scopes: ["value.txt"] });
	const snapshot = () => ({ head: git(root, "rev-parse", "HEAD"), branch: git(root, "symbolic-ref", "HEAD"), index: readFileSync(join(root, ".git/index")).toString("hex"), value: readFileSync(join(root, "value.txt"), "utf8"), status: git(root, "status", "--porcelain") });
	return { root, base, start, snapshot, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("Parent branch batches", () => {
	it("creates and reuses the Parent ref without touching a dirty coordinator checkout or index", () => {
		const fx = fixture();
		try {
			writeFileSync(join(fx.root, "value.txt"), "staged\n");
			git(fx.root, "add", "--", "value.txt");
			writeFileSync(join(fx.root, "value.txt"), "local\n");
			const before = fx.snapshot();
			expect(fx.start()).toEqual({ ok: true, branch: ref });
			expect(fx.start()).toEqual({ ok: true, branch: ref });
			expect(git(fx.root, "rev-parse", ref)).toBe(fx.base);
			expect(fx.snapshot()).toEqual(before);
			expect(git(fx.root, "worktree", "list", "--porcelain")).not.toContain("imm/worktrees");
		} finally { fx.cleanup(); }
	});

	it("does not refresh the coordinator index when a clean tracked file has stale stat data", () => {
		const fx = fixture();
		try {
			const index = readFileSync(join(fx.root, ".git/index"));
			utimesSync(join(fx.root, "value.txt"), 1, 1);
			expect(fx.start().ok).toBe(true);
			expect(readFileSync(join(fx.root, ".git/index"))).toEqual(index);
		} finally { fx.cleanup(); }
	});

	it("refuses a different existing Parent tip before creating refs, worktrees or a batch record", () => {
		const fx = fixture();
		try {
			git(fx.root, "commit", "--allow-empty", "-qm", "other");
			git(fx.root, "branch", "imm/parent");
			const before = { checkout: fx.snapshot(), refs: git(fx.root, "show-ref"), worktrees: git(fx.root, "worktree", "list", "--porcelain") };
			expect(fx.start()).toMatchObject({ ok: false, reason: "batch_parent_branch_exists" });
			expect({ checkout: fx.snapshot(), refs: git(fx.root, "show-ref"), worktrees: git(fx.root, "worktree", "list", "--porcelain") }).toEqual(before);
			expect(existsSync(join(fx.root, ".imm/state/batches"))).toBe(false);
		} finally { fx.cleanup(); }
	});

	it("rejects lane_offers on new batches, even when empty", () => {
		const fx = fixture();
		try {
			expect(() => resolveLaneParallel(fx.root, "parent", 2, [])).toThrow("lane_offers_retired");
			expect(git(fx.root, "branch", "--list", "imm/*")).toBe("");
		} finally { fx.cleanup(); }
	});

	for (const dirty of [false, true]) it(`integrates exactly one child commit without coordinator writes and ${dirty ? "keeps a dirty" : "removes a clean"} Lane`, () => {
		const fx = fixture();
		try {
			expect(fx.start().ok).toBe(true);
			const lane = createLaneWorktree(fx.root, "parent", "child", fx.base);
			expect(lane).toBe(join(fx.root, ".git/imm/worktrees/parent/child"));
			expect(git(lane, "symbolic-ref", "--short", "HEAD")).toBe("imm-lane/parent/child");
			expect(git(lane, "rev-parse", "HEAD")).toBe(fx.base);
			writeFileSync(join(lane, "value.txt"), "parent\n");
			git(lane, "commit", "-qam", "child delivery");
			const commit = git(lane, "rev-parse", "HEAD");
			writeFileSync(join(fx.root, "value.txt"), "coordinator\n");
			const before = fx.snapshot();
			const result = integrateLaneCommit({ root: fx.root, branch: ref, batch_head: fx.base, lane_base: fx.base, lane_commit: commit });
			expect(git(fx.root, "rev-parse", ref)).toBe(result.commit);
			expect(git(fx.root, "rev-list", "--count", `${fx.base}..${ref}`)).toBe("1");
			expect(identitiesEqual(changeIdentity(fx.root, fx.base, commit), changeIdentity(fx.root, fx.base, result.commit))).toBe(true);
			if (dirty) writeFileSync(join(lane, "uncommitted.txt"), "keep me\n");
			expect(removeLaneWorktree(fx.root, lane, "imm-lane/parent/child", commit)).toBe(!dirty);
			expect(existsSync(lane)).toBe(dirty);
			expect(Boolean(git(fx.root, "branch", "--list", "imm-lane/parent/child"))).toBe(dirty);
			if (dirty) expect(readFileSync(join(lane, "uncommitted.txt"), "utf8")).toBe("keep me\n");
			expect(fx.snapshot()).toEqual(before);
		} finally { fx.cleanup(); }
	});

	for (const parentPasses of [true, false]) it(`verifies the Parent tip, not an opposite coordinator edit (${parentPasses ? "pass" : "fail"}), and removes the detached worktree`, async () => {
		const fx = fixture();
		try {
			fx.start();
			const lane = createLaneWorktree(fx.root, "parent", "child", fx.base);
			writeFileSync(join(lane, "value.txt"), parentPasses ? "parent\n" : "wrong\n");
			git(lane, "commit", "-qam", "delivery");
			const head = git(lane, "rev-parse", "HEAD");
			integrateLaneCommit({ root: fx.root, branch: ref, batch_head: fx.base, lane_base: fx.base, lane_commit: head });
			writeFileSync(join(fx.root, "value.txt"), parentPasses ? "wrong\n" : "parent\n");
			const before = fx.snapshot();
			const worktrees = git(fx.root, "worktree", "list", "--porcelain");
			const report = await runFinalVerification(fx.root, ["bun check.ts"], { parent_head: head });
			expect(report).toMatchObject({ passed: parentPasses, head, results: [{ passed: parentPasses, exit_code: parentPasses ? 0 : 1 }] });
			expect(git(fx.root, "worktree", "list", "--porcelain")).toBe(worktrees);
			expect(git(fx.root, "rev-parse", ref)).toBe(head);
			expect(fx.snapshot()).toEqual(before);
		} finally { fx.cleanup(); }
	});
});
