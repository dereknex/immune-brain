import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { computeBatchPlanDigest, createBatchAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/batch_authority";
import { canonicalIntentHash, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import type { AssuranceProjectionResult } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import { createBatchKernelPort } from "../plugins/immune-brain/runtime/unattended/batch_kernel_port";
import { createEnrollmentAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { createDefaultBatchGitPort } from "../plugins/immune-brain/runtime/unattended/batch_git";
import { createDefaultLaneGitPort } from "../plugins/immune-brain/runtime/unattended/batch_lanes";
import { startBatch, type BatchRunnerKernelPort, type StartBatchInput } from "../plugins/immune-brain/runtime/unattended/batch_runner";
import { readAnyBatchRunState, type BatchLaneRunReport, type BatchLaneRunStateRecord } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { cleanupSingleTaskLane, exitProofCondition } from "../plugins/immune-brain/runtime/unattended/lane_cleanup";
import { LaneSupervisor, type LaneExit, type LaneGeneration } from "../plugins/immune-brain/runtime/unattended/lane_supervisor";
import type { BatchPlanChild } from "../plugins/immune-brain/runtime/unattended/types";

const TASK = "drive-task";
const BATCH_ID = "batch-one";
const CONFIRMED_AT = "2026-01-01T00:00:00.000Z";
const now = "2026-01-02T00:00:00.000Z";
const REPO_ROOT = resolve(import.meta.dir, "..");

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", ["-C", cwd, "-c", "user.name=T", "-c", "user.email=t@t", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const roots: string[] = [];
const oldPath = process.env.PATH;
afterEach(() => { process.env.PATH = oldPath; delete process.env.LANE_TEST_MODE; });
afterAll(() => { process.env.PATH = oldPath; for (const root of roots) rmSync(root, { recursive: true, force: true }); });

/** A repository whose Git integration preference is `mode`, holding one childless TaskIntent. */
function fixture(mode: "manual" | "auto") {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "imm-lane-cleanup-")));
	roots.push(dir);
	mkdirSync(join(dir, "docs/plans"), { recursive: true });
	mkdirSync(join(dir, ".imm"), { recursive: true });
	writeFileSync(join(dir, ".gitignore"), ".imm/state/\n");
	writeFileSync(join(dir, ".imm/config.json"), JSON.stringify({ contract: "immune_brain/project_config/v1", git_integration: mode }));
	writeFileSync(join(dir, "base.txt"), "base\n");
	const verification = JSON.stringify({ contract: "assurance_kernel/verification_descriptor/v2",
		command: { executable: "bun", argv: ["-e", "process.exit(0)"], cwd: ".", timeout_ms: 60000, max_output_bytes: 4096 },
		environment: { prepare: null, writable_paths: [] } });
	writeFileSync(join(dir, `docs/plans/${TASK}.intent.json`), `${JSON.stringify({ contract: "assurance_kernel/task_intent/v1", task_id: TASK,
		owner: "user", goal: "Deliver the single task", acceptance: [{ id: "A1", assertion: "A1 holds", verification }],
		scope_hint: ["delivery.txt"], risk: "material", revision: 1 })}\n`);
	git(dir, "init", "-q", "-b", "main");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	return { repo: dir, base: git(dir, "rev-parse", "HEAD") };
}

/**
 * A fake Executor Host. It runs in the Lane as the real `claude`/`pi` would: it
 * delivers, settles the Lane's own Kernel run and exits, or hangs, by LANE_TEST_MODE.
 */
function fakeExecutors(): string {
	const bins = realpathSync(mkdtempSync(join(tmpdir(), "imm-lane-executor-")));
	roots.push(bins);
	const module = (path: string) => JSON.stringify(join(REPO_ROOT, path));
	writeFileSync(join(bins, "executor.ts"), `
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readTaskIntent } from ${module("plugins/immune-brain/runtime/kernel/intent")};
import { readSettledRunEvidence, recoverKernelStoreFollowUps } from ${module("plugins/immune-brain/runtime/kernel/storage")};
import { seedKernelRunForTest } from ${module("tests/fixtures/mutation-authority-test-seam")};
const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t", ...args], { encoding: "utf8" }).trim();
const lane = process.cwd(), TASK = ${JSON.stringify(TASK)};
writeFileSync(join(lane, "delivery.txt"), "delivered\\n");
const read = readTaskIntent(lane, TASK);
seedKernelRunForTest(lane, { task_id: TASK, run_id: "run-1", terminal: { lifecycle: "done" }, record: {
	contract: "assurance_kernel/task_record/v4", task_id: TASK, intent_snapshot: read.intent,
	intent_ref: { path: read.intent_ref.path, content_hash: read.content_hash }, lifecycle: "done", artifact_state: "frozen",
	baseline: read.content_hash, git_base_head: git("rev-parse", "HEAD"), attestations: [], findings: [], history: [] } });
recoverKernelStoreFollowUps(lane, TASK);
const evidence = readSettledRunEvidence(lane, TASK)!;
const audit = join(".imm/audit", TASK, evidence.run_id);
mkdirSync(join(lane, audit), { recursive: true });
writeFileSync(join(lane, audit, "task-record.json"), evidence.record_json);
writeFileSync(join(lane, audit, "terminal-proof.json"), evidence.proof_json);
git("add", "--", "delivery.txt");
mkdirSync(join(lane, ".imm/state"), { recursive: true });
writeFileSync(join(lane, ".imm/state/executor-done"), "done\\n");
process.exit(process.env.LANE_TEST_MODE === "nonzero" ? 3 : 0);
`);
	const script = `#!/bin/sh\ncase "$LANE_TEST_MODE" in hang) exec /bin/sleep 30;; esac\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(bins, "executor.ts"))}\n`;
	for (const name of ["claude", "pi"]) { writeFileSync(join(bins, name), script); chmodSync(join(bins, name), 0o755); }
	process.env.PATH = `${bins}:${oldPath}`;
	return bins;
}

function projectionBody(overrides: Partial<AssuranceProjectionResult["projection"]> = {}): AssuranceProjectionResult["projection"] {
	return {
		run_id: "run-1", record_revision: "r1", workspace_revision: "w", intent_revision: 1,
		intent_content_hash: "sha256:intent", diff_hash: "sha256:diff", lifecycle: "active", artifact_state: "active",
		risk: "material", next_obligation: "submit_assurance", fresh_acceptance_ids: [], missing_acceptance_ids: ["A1"],
		stale_attestation_ids: [], fresh_approval_kinds: [], missing_approval_kinds: [], blocking_finding_ids: [],
		unresolved_user_decision_ids: [], replan_required_ids: [], independence_violations: [], open_user_decision_count: 0,
		completion_ready: false, authorization: { state: "none", blocked: null }, ...overrides,
	} as AssuranceProjectionResult["projection"];
}

/** A Kernel stand-in whose Lane reads done once the fake Executor wrote its (ignored) completion marker. */
function kernel(): BatchRunnerKernelPort {
	const lanes = new Map<string, string>(), settled = new Set<string>();
	const state = {
		async enrollTask({ root, task_id }: { root: string; task_id: string }) { lanes.set(task_id, root); return { record_revision: "r" }; },
		async advanceTask(_root: string, taskId: string) { settled.add(taskId); return { state: "completed" as const }; },
		async projectTask(root: string, taskId: string): Promise<AssuranceProjectionResult> {
			const done = settled.has(taskId) || existsSync(join(root, ".imm/state/executor-done"));
			return { contract: "assurance_kernel/assurance_projection/v1", task_id: taskId, error: null,
				claim: done ? null : { task_id: taskId, lifecycle_status: "active" },
				projection: projectionBody({ lifecycle: done ? "done" : "active", completion_ready: done, record_revision: done ? "r2" : "r1",
					artifact_state: "frozen", next_obligation: done ? "none" : "submit_assurance" }) } as AssuranceProjectionResult;
		},
		ownsTaskClaim: (taskId: string) => lanes.has(taskId) && !settled.has(taskId),
		validateBatchAuthorization: ({ registry, capability, binding }: Parameters<BatchRunnerKernelPort["validateBatchAuthorization"]>[0]) =>
			registry.inspect(capability, { ...binding, branch: `refs/heads/imm/${TASK}`, actor_id: "user", confirmation_ref: "confirm", nonce: "n" } as never),
	};
	return state as unknown as BatchRunnerKernelPort;
}

/** One authorization is issued per fixture, so every call below runs under the same single approval. */
function request(repo: string, base: string, supervision: NonNullable<StartBatchInput["supervision"]>): StartBatchInput {
	const intent = readTaskIntent(repo, TASK);
	const children: BatchPlanChild[] = [{ task_id: TASK, slice_id: TASK, blocked_by: [], status: "enrollable", reason: null,
		intent_path: intent.intent_ref.path, intent_revision: intent.intent_ref.revision,
		intent_content_hash: canonicalIntentHash(intent.intent) }];
	const registry = createBatchAuthorityRegistry();
	const planDigest = computeBatchPlanDigest(children);
	const budget = { max_children: 1, qa_failure_limit: 2 };
	const binding = { batch_id: BATCH_ID, initiative_slug: TASK, plan_digest: planDigest, branch: `refs/heads/imm/${TASK}`,
		base_head: base, budget, actor_id: "user", confirmation_ref: "confirm", nonce: "n" };
	const capability = registry.issue(binding, children, CONFIRMED_AT);
	return { root: repo, plan_source: "single_task", batch_id: BATCH_ID, initiative_slug: TASK, registry, capability,
		children, plan_digest: planDigest, base_head: base, confirmation_time: CONFIRMED_AT, budget, now,
		kernel: createBatchKernelPort({ root: repo, enrollmentRegistry: createEnrollmentAuthorityRegistry(), registry,
			capability, binding, advanceTask: async () => ({ state: "completed" }),
			resume: { isResuming: false, existingBatch: null, batchBranch: `refs/heads/imm/${TASK}` },
			overrides: kernel() }),
		git: Object.assign(createDefaultBatchGitPort(), { lane: createDefaultLaneGitPort() }), max_parallel: 1, supervision };
}

const supervise = (supervisor: LaneSupervisor, extra: Partial<NonNullable<StartBatchInput["supervision"]>> = {}) =>
	({ supervisor, parentHost: "claude-code" as const, pluginDir: "/plugin", waitMs: 30_000, ...extra });
const report = (value: unknown) => value as BatchLaneRunReport;
const recordOf = (repo: string) => readAnyBatchRunState(repo, BATCH_ID) as BatchLaneRunStateRecord;
const branches = (repo: string) => git(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads/imm-lane", "refs/heads/imm").split("\n").filter(Boolean);
const worktrees = (repo: string) => git(repo, "worktree", "list", "--porcelain").split("\n").filter(line => line.startsWith("worktree ")).map(line => line.slice(9));

describe("single-task Lane cleanup end to end", () => {
	it("manual: the task is staged in the checkout and no Lane, imm-lane/ or imm/ branch remains", async () => {
		fakeExecutors();
		const { repo, base } = fixture("manual");
		const run = report(await startBatch(request(repo, base, supervise(new LaneSupervisor()))));
		expect(run.batch_state, JSON.stringify(run)).toBe("completed");
		const lane = recordOf(repo).children[0]!.lane!.path;
		expect(git(repo, "rev-parse", "HEAD")).toBe(base);
		expect(git(repo, "diff", "--cached", "--name-only").split("\n")).toContain("delivery.txt");
		expect(readFileSync(join(repo, "delivery.txt"), "utf8")).toBe("delivered\n");
		expect(worktrees(repo)).toEqual([repo]);
		expect(existsSync(lane)).toBe(false);
		expect(branches(repo)).toEqual([]);
		expect(run.lane_refusals ?? []).toEqual([]);
		const removed = recordOf(repo).children[0]!.lane_removed!;
		expect(removed).toMatchObject({ worktree: lane, branches: [`imm-lane/${TASK}/${TASK}`, `imm/${TASK}`],
			exit: { generation: 1, code: 0, signal: null, lane_path: lane } });
		expect(run.lane_supervision).toMatchObject({ state: "exited", generation: 1, exit: removed.exit });
	}, 60_000);

	it("auto: the current branch holds the delivery commit and nothing of the Lane remains", async () => {
		fakeExecutors();
		const { repo, base } = fixture("auto");
		const run = report(await startBatch(request(repo, base, supervise(new LaneSupervisor()))));
		expect(run.batch_state, JSON.stringify(run)).toBe("completed");
		const delivery = recordOf(repo).commits[0]!;
		expect(git(repo, "rev-parse", "refs/heads/main")).toBe(delivery);
		expect(git(repo, "rev-parse", "HEAD")).toBe(delivery);
		expect(git(repo, "show", "HEAD:delivery.txt")).toBe("delivered");
		expect(worktrees(repo)).toEqual([repo]);
		expect(branches(repo)).toEqual([]);
		expect(recordOf(repo).children[0]!.lane_removed).toMatchObject({ exit: { code: 0, signal: null } });
	}, 60_000);

	it("retains the Lane when the Executor settled but did not exit normally", async () => {
		fakeExecutors();
		process.env.LANE_TEST_MODE = "nonzero";
		const { repo, base } = fixture("manual");
		const run = report(await startBatch(request(repo, base, supervise(new LaneSupervisor()))));
		expect(run.batch_state, JSON.stringify(run)).toBe("completed");
		const lane = recordOf(repo).children[0]!.lane!.path;
		expect(run.lane_refusals).toEqual([{ task_id: TASK, path: lane, reason: expect.stringContaining("batch_lane_retained: Executor generation 1 did not exit normally (code 3)") }]);
		expect(existsSync(lane)).toBe(true);
		expect(branches(repo).sort()).toEqual([`imm-lane/${TASK}/${TASK}`, `imm/${TASK}`]);
		expect(git(repo, "diff", "--cached", "--name-only").split("\n")).toContain("delivery.txt");
		expect(recordOf(repo).children[0]!.lane_retained).toEqual({ condition: expect.stringContaining("code 3") });
	}, 60_000);

	it("retains the Lane and reports a parked return step", async () => {
		fakeExecutors();
		const { repo, base } = fixture("manual");
		writeFileSync(join(repo, "delivery.txt"), "user content\n");
		const run = report(await startBatch(request(repo, base, supervise(new LaneSupervisor()))));
		expect(run.batch_state).toBe("needs_human");
		const lane = recordOf(repo).children[0]!.lane!.path;
		expect(run.lane_refusals).toEqual([{ task_id: TASK, path: lane, reason: expect.stringMatching(/batch_lane_retained: the return step is parked \(checkout_delivery_overlap: delivery.txt\)/) }]);
		expect(existsSync(lane)).toBe(true);
		expect(branches(repo).sort()).toEqual([`imm-lane/${TASK}/${TASK}`, `imm/${TASK}`]);
		expect(readFileSync(join(repo, "delivery.txt"), "utf8")).toBe("user content\n");
	}, 60_000);

	describe("while the Executor never exits normally under supervision", () => {
		const keptLane = (repo: string) => {
			const lane = recordOf(repo).children[0]!.lane!.path;
			expect(existsSync(lane)).toBe(true);
			expect(branches(repo)).toContain(`imm-lane/${TASK}/${TASK}`);
			return lane;
		};
		it("an interrupted generation", async () => {
			fakeExecutors();
			process.env.LANE_TEST_MODE = "hang";
			const { repo, base } = fixture("manual");
			const controller = new AbortController();
			setTimeout(() => controller.abort(), 700);
			const run = report(await startBatch(request(repo, base, supervise(new LaneSupervisor(), { signal: controller.signal }))));
			expect(run.lane_refusals).toEqual([{ task_id: TASK, path: keptLane(repo), reason: expect.stringContaining("batch_lane_retained: Executor generation 1 was interrupted") }]);
		}, 60_000);
		it("a generation stopped by the Parent, and an exit nobody observed", async () => {
			fakeExecutors();
			process.env.LANE_TEST_MODE = "hang";
			const { repo, base } = fixture("manual");
			const supervisor = new LaneSupervisor();
			try {
				const running = report(await startBatch(request(repo, base, supervise(supervisor, { waitMs: 400 }))));
				expect(running.lane_supervision).toMatchObject({ state: "running", generation: 1 });
				expect(running.lane_refusals ?? []).toEqual([]);
				// A new Host process holds no handle to the child, so no exit can be observed.
				const lost = report(await startBatch(request(repo, base, supervise(new LaneSupervisor(), { waitMs: 400 }))));
				expect(lost.lane_supervision).toMatchObject({ state: "unobservable", generation: 1, exit: null });
				expect(lost.lane_refusals).toEqual([{ task_id: TASK, path: keptLane(repo), reason: expect.stringContaining("batch_lane_retained: Executor generation 1 exit was never observed (unobservable)") }]);
				const stopped = report(await startBatch(request(repo, base, supervise(supervisor, { stop: true }))));
				expect(stopped.lane_supervision).toMatchObject({ state: "stopped", generation: 1 });
				expect(stopped.lane_refusals).toEqual([{ task_id: TASK, path: keptLane(repo), reason: expect.stringContaining("batch_lane_retained: Executor generation 1 was stopped by the Parent") }]);
			} finally { await supervisor.run({ key: `${repo}\0${BATCH_ID}`, repository: repo, lanePath: recordOf(repo).children[0]!.lane!.path, taskId: TASK,
				choice: { host: "pi", not_applied: [] }, pluginDir: "", store: { read: () => null, update: () => { throw new Error("unused"); } }, baseline: "", waitMs: 100, graceMs: 100, stop: true }).catch(() => {}); }
		}, 60_000);
	});
});

describe("single-task Lane cleanup conditions", () => {
	/** A delivered Lane: `imm/t` carries its branch tip, and the worktree is checked out on `imm-lane/t/t`. */
	function lane() {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "imm-lane-unit-")));
		roots.push(dir);
		const repo = join(dir, "repo"), path = join(dir, "lane");
		mkdirSync(repo);
		writeFileSync(join(repo, ".gitignore"), "ignored.log\n");
		writeFileSync(join(repo, "tracked.txt"), "tracked\n");
		git(repo, "init", "-q", "-b", "main"); git(repo, "add", "-A"); git(repo, "commit", "-qm", "base");
		git(repo, "worktree", "add", "-q", "-b", "imm-lane/t/t", path);
		writeFileSync(join(path, "delivered.txt"), "d\n"); git(path, "add", "-A"); git(path, "commit", "-qm", "delivery");
		git(repo, "branch", "imm/t", "imm-lane/t/t");
		const exit: LaneExit = { repository: repo, lane_path: path, generation: 2, pid: 42, code: 0, signal: null };
		const generation: LaneGeneration = { repository: repo, lane_path: path, generation: 2, pid: 42, owner_pid: process.pid,
			state: "exited", exit, baseline: "r1", no_progress: 0 };
		const run = (overrides: Partial<Parameters<typeof cleanupSingleTaskLane>[0]> = {}) => cleanupSingleTaskLane({
			root: repo, lanePath: path, laneBranch: "imm-lane/t/t", parentRef: "refs/heads/imm/t", generation, ...overrides });
		return { repo, path, exit, generation, run };
	}
	const kept = (f: ReturnType<typeof lane>) => {
		expect(existsSync(f.path)).toBe(true);
		expect(branches(f.repo).sort()).toEqual(["imm-lane/t/t", "imm/t"]);
	};

	it("removes the worktree and both branches on a clean Lane, ignoring ignored files", () => {
		const f = lane();
		writeFileSync(join(f.path, "ignored.log"), "scratch\n");
		expect(f.run()).toEqual({ status: "removed", exit: f.exit, worktree: f.path, branches: ["imm-lane/t/t", "imm/t"] });
		expect(existsSync(f.path)).toBe(false);
		expect(branches(f.repo)).toEqual([]);
		expect(git(f.repo, "worktree", "list", "--porcelain")).not.toContain(f.path);
	});
	it("keeps a Lane with a tracked modification or an untracked non-ignored file", () => {
		for (const [path, content] of [["tracked.txt", "edited\n"], ["stray.txt", "stray\n"]] as const) {
			const f = lane();
			writeFileSync(join(f.path, path), content);
			expect(f.run()).toEqual({ status: "retained", condition: expect.stringContaining(`the Lane has tracked modifications or untracked files: ${path}`) });
			kept(f);
			expect(readFileSync(join(f.path, path), "utf8")).toBe(content);
		}
	});
	it("keeps a Lane whose branch carries a commit that imm/<task_id> lacks", () => {
		const f = lane();
		writeFileSync(join(f.path, "late.txt"), "late\n"); git(f.path, "add", "-A"); git(f.path, "commit", "-qm", "late");
		expect(f.run()).toEqual({ status: "retained", condition: expect.stringContaining("carries commits that imm/t does not") });
		kept(f);
	});
	it("keeps a Lane while imm/<task_id> is checked out elsewhere", () => {
		const f = lane();
		git(f.repo, "checkout", "-q", "imm/t");
		expect(f.run()).toEqual({ status: "retained", condition: expect.stringContaining("imm/t is checked out in a worktree") });
		kept(f);
	});
	it("treats an observation from a superseded generation as no proof", () => {
		const f = lane();
		const stale = { ...f.exit, generation: 1 };
		expect(f.run({ observation: stale })).toEqual({ status: "retained", condition: expect.stringContaining("superseded generation 1; the current generation is 2") });
		expect(exitProofCondition({ ...f.generation, state: "running", exit: null, generation: 2 }, stale)).toContain("exit was never observed");
		kept(f);
	});
	it("treats every non-exited or abnormal generation as no proof", () => {
		const f = lane();
		const conditions = [
			[null, "no Executor generation was supervised"],
			[{ ...f.generation, state: "interrupted" }, "was interrupted"],
			[{ ...f.generation, state: "stopped_by_parent" }, "was stopped by the Parent"],
			[{ ...f.generation, state: "unobservable", exit: null }, "(unobservable)"],
			[{ ...f.generation, state: "running", exit: null }, "(unobservable)"],
			[{ ...f.generation, exit: { ...f.exit, code: 1 } }, "did not exit normally (code 1)"],
			[{ ...f.generation, exit: { ...f.exit, code: null, signal: "SIGKILL" } }, "did not exit normally (signal SIGKILL)"],
			[{ ...f.generation, exit: { ...f.exit, pid: 43 } }, "is not bound to this Executor process"],
		] as const;
		for (const [generation, text] of conditions) {
			expect(f.run({ generation: generation as LaneGeneration | null })).toEqual({ status: "retained", condition: expect.stringContaining(text) });
			kept(f);
		}
	});
});

describe("single-task Lane cleanup contract", () => {
	it("amends ADR 0027 with the exit-proof conditions, and keeps Initiative Lanes outside the amendment", () => {
		const adr = readFileSync(join(REPO_ROOT, "docs/adr/0027-parent-branch-merge-queue.md"), "utf8");
		const start = adr.indexOf("Amendment: single-task Lane cleanup (drive-always-lanes S4)");
		expect(start).toBeGreaterThan(-1);
		const section = adr.slice(start).split(/\n#{1,3} (?!Amendment: single-task Lane cleanup)/)[0]!;
		for (const text of ["normal exit", "current generation", "git status --porcelain --untracked-files=all", "batch_lane_retained", "Initiative"])
			expect(section).toContain(text);
	});
});
