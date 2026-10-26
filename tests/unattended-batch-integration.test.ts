import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	BatchIntegrationError,
	findIntegratedCandidate,
	integrateGuardedLaneCommit,
	prepareLaneCandidate,
	type IntegrationCheckChild,
} from "../plugins/immune-brain/runtime/unattended/batch_integration";
import { planLaneLeakRestore, restoreProvableLaneLeaks } from "../plugins/immune-brain/runtime/unattended/batch_leak_restore";
import { applyDeltaToWorkingTree, batchRefName, changedPaths, createBatchRef, readBatchRef } from "../plugins/immune-brain/runtime/unattended/batch_ref";
import type { BatchLaneRunStateRecord } from "../plugins/immune-brain/runtime/unattended/batch_state";

const BATCH_BRANCH = "imm/initiative-slug";
const BATCH_ID = "batch-001";

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", ["-C", cwd, "-c", "user.name=T", "-c", "user.email=t@t", ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function intentPath(taskId: string): string {
	return `docs/plans/${taskId}.intent.json`;
}

/** A valid intent sidecar whose single descriptor runs `script` with bun inside the delivery tree. */
function intentJson(taskId: string, script: string): string {
	const verification = JSON.stringify({
		contract: "assurance_kernel/verification_descriptor/v2",
		command: { executable: "bun", argv: ["-e", script], cwd: ".", timeout_ms: 60000, max_output_bytes: 4096 },
		environment: { prepare: null, writable_paths: [] },
	});
	return `${JSON.stringify({
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		goal: `Deliver ${taskId}`,
		acceptance: [{ id: "A1", assertion: `${taskId} holds`, verification }],
		scope_hint: [`${taskId}.txt`],
		risk: "material",
		revision: 1,
		owner: "user",
	})}\n`;
}

const absent = (file: string) => `process.exit(require("node:fs").existsSync(${JSON.stringify(file)}) ? 1 : 0)`;
const ALWAYS_PASS = "process.exit(0)";

interface Fixture {
	dir: string;
	repo: string;
	base: string;
	cleanup(): void;
	/** A lane cut from `from`, with one commit adding `file`, never touching the batch branch. */
	laneCommit(taskId: string, file: string, body: string, from?: string): string;
	/** A commit made directly on the batch branch, standing in for an integrated sibling. */
	siblingCommit(taskId: string, file: string, body: string): string;
	refs(): string;
}

/** A real repository on the batch branch; each task's intent sidecar lives in the base commit. */
function fixture(scripts: Record<string, string>): Fixture {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "imm-integration-")));
	const repo = join(dir, "repo");
	mkdirSync(repo);
	git(repo, "init", "-q", "-b", "main");
	writeFileSync(join(repo, ".gitignore"), ".imm/\nnode_modules/\n");
	writeFileSync(join(repo, "base.txt"), "base\n");
	mkdirSync(join(repo, "docs/plans"), { recursive: true });
	for (const [taskId, script] of Object.entries(scripts)) writeFileSync(join(repo, intentPath(taskId)), intentJson(taskId, script));
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "-m", "base");
	git(repo, "checkout", "-q", "-b", BATCH_BRANCH);
	const message = (taskId: string) => `imm(${taskId}): deliver\n\nImmune-Brain-Batch: ${BATCH_ID}\n`;
	return {
		dir,
		repo,
		base: git(repo, "rev-parse", "HEAD"),
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
		laneCommit(taskId, file, body, from) {
			const path = join(dir, `lane-${taskId}`);
			git(repo, "worktree", "add", "-q", "-b", `imm-lane/initiative-slug/${taskId}`, path, from ?? git(repo, "rev-parse", BATCH_BRANCH));
			writeFileSync(join(path, file), body);
			git(path, "add", "-A");
			git(path, "commit", "-q", "-m", message(taskId));
			return git(path, "rev-parse", "HEAD");
		},
		siblingCommit(taskId, file, body) {
			writeFileSync(join(repo, file), body);
			git(repo, "add", "-A");
			git(repo, "commit", "-q", "-m", message(taskId));
			return git(repo, "rev-parse", "HEAD");
		},
		refs: () => git(repo, "for-each-ref", "--format=%(refname) %(objectname)"),
	};
}

const checkOf = (taskId: string): IntegrationCheckChild => ({ task_id: taskId, intent_path: intentPath(taskId) });

function integrate(fx: Fixture, input: { task: string; lane_commit: string; lane_base?: string; siblings?: Array<{ task: string; commit: string | null }> }) {
	return integrateGuardedLaneCommit({
		root: fx.repo,
		branch: BATCH_BRANCH,
		batch_head: git(fx.repo, "rev-parse", "HEAD"),
		lane_base: input.lane_base ?? fx.base,
		lane_commit: input.lane_commit,
		child: checkOf(input.task),
		siblings: (input.siblings ?? []).map((sibling) => ({ ...checkOf(sibling.task), commit: sibling.commit })),
	});
}

async function reasonOf(run: () => Promise<unknown>): Promise<string> {
	try {
		await run();
	} catch (error) {
		expect(error).toBeInstanceOf(BatchIntegrationError);
		return (error as BatchIntegrationError).reason;
	}
	throw new Error("expected the integration to be refused");
}

/** The batch branch, every ref and the working tree are exactly as before. */
function expectUntouched(fx: Fixture, head: string, refs: string): void {
	expect(git(fx.repo, "rev-parse", "HEAD")).toBe(head);
	expect(git(fx.repo, "rev-parse", BATCH_BRANCH)).toBe(head);
	expect(fx.refs()).toBe(refs);
	expect(git(fx.repo, "status", "--porcelain", "--untracked-files=all")).toBe("");
	expect(existsSync(join(fx.repo, ".imm"))).toBe(false);
}

describe("integration guard reruns descriptors on the candidate", () => {
	it("fast-forwards when the rerun passes", async () => {
		const fx = fixture({ "task-c": absent("forbidden.txt") });
		try {
			const lane = fx.laneCommit("task-c", "task-c.txt", "c\n");
			const { commit } = await integrate(fx, { task: "task-c", lane_commit: lane });
			expect(commit).toBe(lane);
			expect(git(fx.repo, "rev-parse", BATCH_BRANCH)).toBe(lane);
			expect(git(fx.repo, "rev-parse", "HEAD")).toBe(lane);
		} finally {
			fx.cleanup();
		}
	});

	it("resolves the repository's installed dependencies as the Lane does", async () => {
		const fx = fixture({ "task-c": `require("lane-only-dependency")` });
		try {
			mkdirSync(join(fx.repo, "node_modules/lane-only-dependency"), { recursive: true });
			writeFileSync(join(fx.repo, "node_modules/lane-only-dependency/index.js"), "module.exports = 1;\n");
			const lane = fx.laneCommit("task-c", "task-c.txt", "c\n");
			expect((await integrate(fx, { task: "task-c", lane_commit: lane })).commit).toBe(lane);
		} finally {
			fx.cleanup();
		}
	});

	it("rejects when a sibling change makes the child's descriptor fail on the candidate", async () => {
		const fx = fixture({ "task-c": absent("shared.txt"), "task-s": ALWAYS_PASS });
		try {
			// The lane alone satisfies its descriptor; only the combination with the sibling breaks it.
			const lane = fx.laneCommit("task-c", "task-c.txt", "c\n");
			const sibling = fx.siblingCommit("task-s", "shared.txt", "s\n");
			const refs = fx.refs();
			const reason = await reasonOf(() => integrate(fx, { task: "task-c", lane_commit: lane, siblings: [{ task: "task-s", commit: sibling }] }));
			expect(reason).toBe("batch_integration_check_failed");
			expectUntouched(fx, sibling, refs);
		} finally {
			fx.cleanup();
		}
	});

	it("does not let a sibling weaken the child's frozen acceptance in the candidate sidecar", async () => {
		const fx = fixture({ "task-c": absent("shared.txt"), "task-s": ALWAYS_PASS });
		try {
			const lane = fx.laneCommit("task-c", "task-c.txt", "c\n");
			writeFileSync(join(fx.repo, "shared.txt"), "break the frozen acceptance\n");
			const sibling = fx.siblingCommit("task-s", intentPath("task-c"), intentJson("task-c", ALWAYS_PASS));
			const refs = fx.refs();
			expect(await reasonOf(() => integrate(fx, { task: "task-c", lane_commit: lane,
				siblings: [{ task: "task-s", commit: sibling }] }))).toBe("batch_integration_check_failed");
			expectUntouched(fx, sibling, refs);
		} finally { fx.cleanup(); }
	});

	it("rejects when the child's change breaks the descriptor of a sibling integrated since the lane base", async () => {
		const fx = fixture({ "task-c": ALWAYS_PASS, "task-s": absent("task-c.txt") });
		try {
			const lane = fx.laneCommit("task-c", "task-c.txt", "c\n");
			const sibling = fx.siblingCommit("task-s", "shared.txt", "s\n");
			const refs = fx.refs();
			const reason = await reasonOf(() => integrate(fx, { task: "task-c", lane_commit: lane, siblings: [{ task: "task-s", commit: sibling }] }));
			expect(reason).toBe("batch_integration_check_failed");
			expectUntouched(fx, sibling, refs);
		} finally {
			fx.cleanup();
		}
	});

	it("does not recheck a sibling integrated before the lane base", async () => {
		const fx = fixture({ "task-c": ALWAYS_PASS, "task-s": absent("task-c.txt") });
		try {
			const sibling = fx.siblingCommit("task-s", "shared.txt", "s\n");
			// The Lane is cut after the sibling landed, so the sibling's descriptor was already accepted for this base.
			const lane = fx.laneCommit("task-c", "task-c.txt", "c\n", sibling);
			const { commit } = await integrate(fx, {
				task: "task-c",
				lane_commit: lane,
				lane_base: sibling,
				siblings: [{ task: "task-s", commit: sibling }],
			});
			expect(commit).toBe(lane);
		} finally {
			fx.cleanup();
		}
	});

	it("rejects when the rerun cannot run, never accepting an unchecked candidate", async () => {
		const fx = fixture({ "task-c": ALWAYS_PASS });
		try {
			const lane = fx.laneCommit("task-c", "task-c.txt", "c\n");
			const refs = fx.refs();
			const head = git(fx.repo, "rev-parse", "HEAD");
			const missing = await reasonOf(() =>
				integrateGuardedLaneCommit({
					root: fx.repo,
					branch: BATCH_BRANCH,
					batch_head: head,
					lane_base: fx.base,
					lane_commit: lane,
					child: { task_id: "task-c", intent_path: "docs/plans/absent.intent.json" },
					siblings: [],
				}),
			);
			expect(missing).toBe("batch_integration_check_failed");
			const noIntent = await reasonOf(() =>
				integrateGuardedLaneCommit({
					root: fx.repo,
					branch: BATCH_BRANCH,
					batch_head: head,
					lane_base: fx.base,
					lane_commit: lane,
					child: { task_id: "task-c", intent_path: null },
					siblings: [],
				}),
			);
			expect(noIntent).toBe("batch_integration_check_failed");
			expectUntouched(fx, head, refs);
		} finally {
			fx.cleanup();
		}
	});

	it("reports a plumbing conflict as batch_integration_conflict and leaves the branch unmoved", async () => {
		const fx = fixture({ "task-c": ALWAYS_PASS, "task-s": ALWAYS_PASS });
		try {
			const lane = fx.laneCommit("task-c", "shared.txt", "from the lane\n");
			const sibling = fx.siblingCommit("task-s", "shared.txt", "from the sibling\n");
			const refs = fx.refs();
			const reason = await reasonOf(() => integrate(fx, { task: "task-c", lane_commit: lane, siblings: [{ task: "task-s", commit: sibling }] }));
			expect(reason).toBe("batch_integration_conflict");
			expectUntouched(fx, sibling, refs);
		} finally {
			fx.cleanup();
		}
	});

	it("still integrates a disjoint child after another child's guard failed", async () => {
		const fx = fixture({ "task-c": absent("shared.txt"), "task-d": ALWAYS_PASS, "task-s": ALWAYS_PASS });
		try {
			const failing = fx.laneCommit("task-c", "task-c.txt", "c\n");
			const disjoint = fx.laneCommit("task-d", "task-d.txt", "d\n");
			const sibling = fx.siblingCommit("task-s", "shared.txt", "s\n");
			const siblings = [{ task: "task-s", commit: sibling }];
			expect(await reasonOf(() => integrate(fx, { task: "task-c", lane_commit: failing, siblings }))).toBe("batch_integration_check_failed");
			expect(git(fx.repo, "rev-parse", BATCH_BRANCH)).toBe(sibling);

			const { commit } = await integrate(fx, { task: "task-d", lane_commit: disjoint, siblings });
			expect(git(fx.repo, "rev-parse", BATCH_BRANCH)).toBe(commit);
			expect(git(fx.repo, "log", "--format=%s", `${fx.base}..HEAD`).split("\n")).toEqual(["imm(task-d): deliver", "imm(task-s): deliver"]);
			// The failed child's Lane branch is kept, still carrying its commit.
			expect(git(fx.repo, "rev-parse", "imm-lane/initiative-slug/task-c")).toBe(failing);
		} finally {
			fx.cleanup();
		}
	});
});

describe("interruption between the candidate and the fast-forward", () => {
	it("writes no ref and no working tree before acceptance, then resumes to exactly one commit", async () => {
		const fx = fixture({ "task-c": ALWAYS_PASS, "task-s": ALWAYS_PASS });
		try {
			const lane = fx.laneCommit("task-c", "task-c.txt", "c\n");
			const sibling = fx.siblingCommit("task-s", "shared.txt", "s\n");
			const refs = fx.refs();
			const input = { root: fx.repo, branch: BATCH_BRANCH, batch_head: sibling, lane_base: fx.base, lane_commit: lane };

			// The process dies after building the candidate: an unreferenced object, nothing else.
			const orphan = prepareLaneCandidate(input);
			expect(orphan).not.toBe(lane);
			expectUntouched(fx, sibling, refs);
			const find = () => findIntegratedCandidate({ root: fx.repo, task_id: "task-c", batch_id: BATCH_ID, from_head: fx.base, lane_base: fx.base, lane_commit: lane });
			expect(find()).toBeNull();

			// The resumed tick integrates the child once.
			const { commit } = await integrate(fx, { task: "task-c", lane_commit: lane, siblings: [{ task: "task-s", commit: sibling }] });
			expect(find()).toBe(commit);
			expect(git(fx.repo, "log", "--format=%s", `${fx.base}..HEAD`, "--grep=imm(task-c):", "--fixed-strings").split("\n")).toEqual(["imm(task-c): deliver"]);

			// The process dies after the fast-forward but before the state write: the resume adopts it and adds nothing.
			expect(find()).toBe(commit);
			expect(git(fx.repo, "rev-list", "--count", `${fx.base}..HEAD`)).toBe("2");
		} finally {
			fx.cleanup();
		}
	});
});

const HIDDEN_REF = batchRefName(BATCH_ID);

interface HiddenFixture {
	dir: string;
	repo: string;
	base: string;
	cleanup(): void;
	laneCommit(taskId: string, file: string, body: string): string;
}

/** A user on `main` with the batch standing on a hidden ref at the base commit; `mode` is the declared Git integration. */
function hiddenFixture(scripts: Record<string, string>, mode: "manual" | "auto"): HiddenFixture {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "imm-hidden-integration-")));
	const repo = join(dir, "repo");
	mkdirSync(repo);
	git(repo, "init", "-q", "-b", "main");
	writeFileSync(join(repo, ".gitignore"), ".imm/\nnode_modules/\n");
	writeFileSync(join(repo, "AGENTS.md"), `# Agent Instructions\n\n## Immune-Brain Preferences\n\n- Git integration: ${mode}\n`);
	writeFileSync(join(repo, "base.txt"), "base\n");
	writeFileSync(join(repo, "shared.txt"), "shared\n");
	mkdirSync(join(repo, "docs/plans"), { recursive: true });
	for (const [taskId, script] of Object.entries(scripts)) writeFileSync(join(repo, intentPath(taskId)), intentJson(taskId, script));
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "-m", "base");
	const base = git(repo, "rev-parse", "HEAD");
	createBatchRef(repo, HIDDEN_REF, base);
	return {
		dir,
		repo,
		base,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
		laneCommit(taskId, file, body) {
			const path = join(dir, `lane-${taskId}`);
			git(repo, "worktree", "add", "-q", "-b", `imm-lane/initiative-slug/${taskId}`, path, base);
			writeFileSync(join(path, file), body);
			git(path, "add", "-A");
			git(path, "commit", "-q", "-m", `imm(${taskId}): deliver\n\nImmune-Brain-Batch: ${BATCH_ID}\n`);
			return git(path, "rev-parse", "HEAD");
		},
	};
}

function integrateHidden(fx: HiddenFixture, task: string, lane_commit: string) {
	return integrateGuardedLaneCommit({
		root: fx.repo,
		branch: HIDDEN_REF,
		batch_head: readBatchRef(fx.repo, HIDDEN_REF)!,
		lane_base: fx.base,
		lane_commit,
		child: checkOf(task),
		siblings: [],
	});
}

describe("lane integration on a hidden batch ref", () => {
	it("moves only the hidden ref and writes the scoped delta into the working tree", async () => {
		const fx = hiddenFixture({ "task-c": ALWAYS_PASS }, "manual");
		try {
			const lane = fx.laneCommit("task-c", "task-c.txt", "c\n");
			const branch = git(fx.repo, "rev-parse", "--abbrev-ref", "HEAD");
			const { commit } = await integrateHidden(fx, "task-c", lane);

			expect(readBatchRef(fx.repo, HIDDEN_REF)).toBe(commit);
			expect(commit).not.toBe(fx.base);
			expect(git(fx.repo, "rev-parse", "HEAD")).toBe(fx.base);
			expect(git(fx.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);
			expect(git(fx.repo, "diff", "--cached", "--name-only")).toBe("");
			expect(readFileSync(join(fx.repo, "task-c.txt"), "utf8")).toBe("c\n");
			expect(git(fx.repo, "status", "--porcelain", "--untracked-files=all")).toBe("?? task-c.txt");
			expect(git(fx.repo, "for-each-ref", "--format=%(refname)", "refs/heads/main")).toBe("refs/heads/main");
		} finally {
			fx.cleanup();
		}
	});

	it("parks on a conflicting local edit, naming the paths and changing neither the tree nor the ref", async () => {
		const fx = hiddenFixture({ "task-c": ALWAYS_PASS }, "auto");
		try {
			const lane = fx.laneCommit("task-c", "shared.txt", "from the lane\n");
			writeFileSync(join(fx.repo, "shared.txt"), "my local edit\n");
			const reason = await reasonOf(() => integrateHidden(fx, "task-c", lane));

			expect(reason).toBe("batch_integration_conflict");
			let message = "";
			try {
				await integrateHidden(fx, "task-c", lane);
			} catch (error) {
				message = (error as Error).message;
			}
			expect(message).toContain("local edits on shared.txt");
			expect(readBatchRef(fx.repo, HIDDEN_REF)).toBe(fx.base);
			expect(readFileSync(join(fx.repo, "shared.txt"), "utf8")).toBe("my local edit\n");
			expect(git(fx.repo, "rev-parse", "HEAD")).toBe(fx.base);
		} finally {
			fx.cleanup();
		}
	});

	it("commits only the applied paths through the settle commit under Git integration auto", async () => {
		const fx = hiddenFixture({ "task-c": ALWAYS_PASS }, "auto");
		try {
			const lane = fx.laneCommit("task-c", "task-c.txt", "c\n");
			writeFileSync(join(fx.repo, "unrelated.txt"), "keep out\n");
			writeFileSync(join(fx.repo, "base.txt"), "base edited\n");
			await integrateHidden(fx, "task-c", lane);

			expect(git(fx.repo, "log", "--format=%s", `${fx.base}..HEAD`)).toBe("imm(task-c): settled delivery");
			expect(git(fx.repo, "show", "--name-only", "--format=", "HEAD")).toBe("task-c.txt");
			expect(git(fx.repo, "diff", "--name-only")).toBe("base.txt");
			expect(git(fx.repo, "ls-files", "--others", "--exclude-standard")).toBe("unrelated.txt");
		} finally {
			fx.cleanup();
		}
	});

	it("commits nothing under Git integration manual", async () => {
		const fx = hiddenFixture({ "task-c": ALWAYS_PASS }, "manual");
		try {
			await integrateHidden(fx, "task-c", fx.laneCommit("task-c", "task-c.txt", "c\n"));
			expect(git(fx.repo, "rev-list", "--count", `${fx.base}..HEAD`)).toBe("0");
		} finally {
			fx.cleanup();
		}
	});

	it("completes a retry after an interruption between the working-tree apply and the ref move", async () => {
		const fx = hiddenFixture({ "task-c": ALWAYS_PASS }, "manual");
		try {
			const lane = fx.laneCommit("task-c", "task-c.txt", "c\n");
			// The process dies after the delta reached the working tree but before the ref moved.
			applyDeltaToWorkingTree(fx.repo, fx.base, lane, changedPaths(fx.repo, fx.base, lane));
			expect(readBatchRef(fx.repo, HIDDEN_REF)).toBe(fx.base);

			const { commit } = await integrateHidden(fx, "task-c", lane);
			expect(readBatchRef(fx.repo, HIDDEN_REF)).toBe(commit);
			expect(readFileSync(join(fx.repo, "task-c.txt"), "utf8")).toBe("c\n");
			expect(git(fx.repo, "rev-parse", "HEAD")).toBe(fx.base);
		} finally {
			fx.cleanup();
		}
	});

	it("does not mistake an integrated Lane's delivery in the working tree for a Lane leak", async () => {
		const fx = hiddenFixture({ "task-c": ALWAYS_PASS }, "manual");
		try {
			const lane = fx.laneCommit("task-c", "task-c.txt", "c\n");
			await integrateHidden(fx, "task-c", lane);
			const recordWith = (state: string) =>
				({
					batch_id: BATCH_ID,
					branch: HIDDEN_REF,
					children: [
						{
							task_id: "task-c",
							state,
							lane: { base_head: fx.base, branch: `imm-lane/initiative-slug/task-c`, path: join(fx.dir, "lane-task-c"), lane_commit: lane },
						},
					],
				}) as unknown as BatchLaneRunStateRecord;
			const entries = [{ code: "??", path: "task-c.txt" }];

			// Control: while the Lane has not been integrated, the same bytes are its leak.
			expect(planLaneLeakRestore(fx.repo, recordWith("lane_committed"), entries).kind).toBe("provable");

			// Once integrated, the bytes are the delivery: nothing is restored and the file stays.
			const integrated = recordWith("integrated");
			expect(planLaneLeakRestore(fx.repo, integrated, entries).kind).toBe("unprovable");
			expect(restoreProvableLaneLeaks(fx.repo, integrated, entries, "2026-10-16T00:00:00Z").kind).toBe("unprovable");
			expect(readFileSync(join(fx.repo, "task-c.txt"), "utf8")).toBe("c\n");
		} finally {
			fx.cleanup();
		}
	});
});
