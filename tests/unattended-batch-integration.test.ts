import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	BatchIntegrationError,
	findIntegratedCandidate,
	integrateGuardedLaneCommit,
	prepareLaneCandidate,
	type IntegrationCheckChild,
} from "../plugins/immune-brain/runtime/unattended/batch_integration";

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
	writeFileSync(join(repo, ".gitignore"), ".imm/\n");
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
