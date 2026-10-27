import { describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareBatchLaneRunState, writeBatchLaneRunState } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { createBatchRef } from "../plugins/immune-brain/runtime/unattended/batch_ref";
import { runBatchGitPreflight } from "../plugins/immune-brain/runtime/unattended/batch_git";
import { changeIdentity, identitiesEqual, integrateLaneCommit } from "../plugins/immune-brain/runtime/unattended/batch_integration";
import { runFinalVerification } from "../plugins/immune-brain/runtime/unattended/batch_final_verification";
import { resolveLaneParallel } from "../plugins/immune-brain/runtime/unattended/batch_lanes";
import { createLaneWorktree } from "../plugins/immune-brain/runtime/unattended/batch_worktrees";

const ref = "refs/heads/imm/parent";
function git(root: string, ...args: string[]): string {
	return execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@local", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function fixture() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "imm-parent-")));
	git(root, "init", "-q", "-b", "main");
	writeFileSync(join(root, ".git/info/exclude"), ".imm/\n");
	writeFileSync(join(root, "value.txt"), "base\n");
	writeFileSync(join(root, "check.ts"), 'import { readFileSync } from "node:fs"; process.exit(readFileSync("value.txt", "utf8") === "parent\\n" ? 0 : 1);\n');
	git(root, "add", "--", "value.txt", "check.ts");
	git(root, "commit", "-qm", "base");
	const base = git(root, "rev-parse", "HEAD");
	const start = () => runBatchGitPreflight({ root, initiative_slug: "parent", base_head: base, batch_id: "batch-parent", progress_mode: "parent_branch", blocking_scopes: ["value.txt"] });
	const snapshot = () => ({ head: git(root, "rev-parse", "HEAD"), branch: git(root, "symbolic-ref", "HEAD"), index: readFileSync(join(root, ".git/index")).toString("hex"), value: readFileSync(join(root, "value.txt"), "utf8"), status: git(root, "status", "--porcelain") });
	const bind = (settled = false) => writeBatchLaneRunState(root, {
		...prepareBatchLaneRunState({ batch_id: "batch-parent", initiative_slug: "parent", children: [{ task_id: "child", slice_id: "S1", blocked_by: [],
			status: "enrollable", reason: null, intent_path: null, intent_revision: null, intent_content_hash: null }],
			plan_digest: "sha256:" + "a".repeat(64), base_head: base, branch: ref, progress_mode: "parent_branch",
			confirmation_time: "2026-10-01T00:00:00.000Z", now: "2026-10-01T00:00:00.000Z",
			budget: { max_children: 1, qa_failure_limit: 1 }, max_parallel: 1 }),
		batch_state: settled ? "budget_stopped" : "running",
	});
	const resources = () => ({ checkout: snapshot(), refs: git(root, "for-each-ref", "--format=%(refname) %(objectname) %(symref)"), worktrees: git(root, "worktree", "list", "--porcelain") });
	return { root, base, start, snapshot, bind, resources, cleanup: () => rmSync(root, { recursive: true, force: true }) };
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
			fx.bind();
			expect(fx.start()).toEqual({ ok: true, branch: ref });
			expect(git(fx.root, "rev-parse", ref)).toBe(fx.base);
			expect(fx.snapshot()).toEqual(before);
			expect(git(fx.root, "worktree", "list", "--porcelain")).not.toContain("imm/worktrees");
		} finally { fx.cleanup(); }
	});

	for (const origin of ["foreign", "interrupted"] as const) it(`refuses a same-tip ${origin} Parent without durable provenance`, () => {
		const fx = fixture();
		try {
			if (origin === "foreign") git(fx.root, "branch", "imm/parent");
			else expect(fx.start().ok).toBe(true);
			const before = fx.resources();
			expect(fx.start()).toMatchObject({ ok: false, reason: "batch_parent_branch_exists" });
			expect(fx.resources()).toEqual(before);
		} finally { fx.cleanup(); }
	});

	it("continues from a validated settled Parent but refuses a divergent recorded tip", () => {
		const fx = fixture();
		try {
			fx.start(); fx.bind(true);
			expect(fx.start().ok).toBe(true);
			git(fx.root, "commit", "--allow-empty", "-qm", "divergence");
			git(fx.root, "update-ref", ref, "HEAD");
			const before = fx.resources();
			expect(fx.start().ok).toBe(false);
			expect(fx.resources()).toEqual(before);
		} finally { fx.cleanup(); }
	});

	for (const dangling of [true, false]) it(`refuses a ${dangling ? "dangling" : "same-tip"} symbolic Parent without changing it or its target`, () => {
		const fx = fixture();
		try {
			const target = "refs/heads/user-new";
			if (!dangling) { git(fx.root, "branch", "user-new"); fx.bind(); }
			git(fx.root, "symbolic-ref", ref, target);
			const rawPath = join(fx.root, ".git", ref);
			const before = { resources: fx.resources(), symbolic: readFileSync(rawPath) };
			expect(fx.start()).toMatchObject({ ok: false, reason: "batch_parent_branch_exists" });
			expect(() => createBatchRef(fx.root, ref, fx.base)).toThrow("symbolic Parent");
			expect({ resources: fx.resources(), symbolic: readFileSync(rawPath) }).toEqual(before);
			expect(git(fx.root, "symbolic-ref", ref)).toBe(target);
			expect(existsSync(join(fx.root, ".git", target))).toBe(!dangling);
		} finally { fx.cleanup(); }
	});

	it("exclusively creates Parent refs, refusing a same-tip contender at the mutation boundary", () => {
		const fx = fixture();
		try {
			git(fx.root, "branch", "imm/parent");
			const before = fx.resources();
			expect(() => createBatchRef(fx.root, ref, fx.base)).toThrow("batch_ref_exists");
			expect(fx.resources()).toEqual(before);
		} finally { fx.cleanup(); }
	});

	for (const collision of ["path", "branch", "symbolic-branch"] as const) it(`refuses a matching unbound Lane ${collision} without changing user resources`, () => {
		const fx = fixture();
		try {
			let lane: string | undefined;
			if (collision === "path") lane = createLaneWorktree(fx.root, "parent", "child", fx.base);
			else if (collision === "symbolic-branch") git(fx.root, "symbolic-ref", "refs/heads/imm-lane/parent/child", "refs/heads/user-new");
			else git(fx.root, "branch", "imm-lane/parent/child");
			const before = fx.resources();
			const bytes = lane ? readFileSync(join(lane, "value.txt")) : null;
			expect(() => createLaneWorktree(fx.root, "parent", "child", fx.base)).toThrow("batch_worktree_failed");
			expect(fx.resources()).toEqual(before);
			if (lane) expect(readFileSync(join(lane, "value.txt"))).toEqual(bytes);
			if (collision === "symbolic-branch") {
				expect(git(fx.root, "symbolic-ref", "refs/heads/imm-lane/parent/child")).toBe("refs/heads/user-new");
				expect(existsSync(join(fx.root, ".git/refs/heads/user-new"))).toBe(false);
			}
		} finally { fx.cleanup(); }
	});

	for (const contender of ["empty-directory", "user-files", "direct-ref", "symbolic-ref"] as const)
	it(`refuses a Lane ${contender} appearing after observation without adopting or modifying it`, () => {
		const fx = fixture();
		const path = join(fx.root, ".git/imm/worktrees/parent/child");
		const branch = "refs/heads/imm-lane/parent/child";
		const originalExists = fs.existsSync;
		let observed: ReturnType<typeof fx.resources> | undefined;
		const spy = spyOn(fs, "existsSync").mockImplementation(candidate => {
			const exists = originalExists(candidate);
			if (candidate === path && !exists && !observed) {
				if (contender === "direct-ref") git(fx.root, "update-ref", branch, fx.base);
				else if (contender === "symbolic-ref") git(fx.root, "symbolic-ref", branch, "refs/heads/user-new");
				else {
					mkdirSync(path);
					if (contender === "user-files") writeFileSync(join(path, "keep.bin"), new Uint8Array([0, 255, 1, 2]));
				}
				observed = fx.resources();
				return false;
			}
			return exists;
		});
		try {
			expect(() => createLaneWorktree(fx.root, "parent", "child", fx.base)).toThrow("batch_worktree_failed");
			spy.mockRestore();
			expect(observed).toBeDefined();
			expect(fx.resources()).toEqual(observed!);
			if (contender === "empty-directory") expect(fs.readdirSync(path)).toEqual([]);
			if (contender === "user-files") {
				expect(fs.readdirSync(path)).toEqual(["keep.bin"]);
				expect(readFileSync(join(path, "keep.bin"))).toEqual(Buffer.from([0, 255, 1, 2]));
			}
			if (contender === "direct-ref" || contender === "symbolic-ref") {
				expect(fs.readdirSync(path)).toEqual([]);
				expect(() => createLaneWorktree(fx.root, "parent", "child", fx.base)).toThrow("recorded Lane binding");
				expect(fx.resources()).toEqual(observed!);
			}
			if (contender === "symbolic-ref") {
				expect(git(fx.root, "symbolic-ref", branch)).toBe("refs/heads/user-new");
				expect(existsSync(join(fx.root, ".git/refs/heads/user-new"))).toBe(false);
			}
		} finally { spy.mockRestore(); fx.cleanup(); }
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

	it("integrates exactly one child commit without coordinator writes and leaves the Lane in place", () => {
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
			expect(existsSync(lane)).toBe(true);
			expect(git(fx.root, "rev-parse", "imm-lane/parent/child")).toBe(commit);
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
