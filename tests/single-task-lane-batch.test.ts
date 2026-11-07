import { afterAll, describe, expect, it, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { computeBatchPlanDigest, createBatchAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/batch_authority";
import { canonicalIntentHash, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import type { AssuranceProjectionResult } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import { createBatchKernelPort } from "../plugins/immune-brain/runtime/unattended/batch_kernel_port";
import { createEnrollmentAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { createDefaultBatchGitPort, type BatchRunnerGitPort } from "../plugins/immune-brain/runtime/unattended/batch_git";
import { createDefaultLaneGitPort } from "../plugins/immune-brain/runtime/unattended/batch_lanes";
import { LaneSupervisor } from "../plugins/immune-brain/runtime/unattended/lane_supervisor";
import { startBatch, stopSingleTaskSupervisor } from "../plugins/immune-brain/runtime/unattended/batch_runner";
import type { BatchRunnerKernelPort, StartBatchInput } from "../plugins/immune-brain/runtime/unattended/batch_runner";
import { parseBatchLaneRunState, prepareBatchLaneRunState, readAnyBatchRunState, writeBatchLaneRunState, type BatchLaneRunReport, type BatchLaneRunStateRecord } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { readSettledRunEvidence, recoverKernelStoreFollowUps } from "../plugins/immune-brain/runtime/kernel/storage";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";
import type { BatchPlanChild } from "../plugins/immune-brain/runtime/unattended/types";
import { deliverSingleTask } from "../plugins/immune-brain/runtime/unattended/checkout_delivery";
import { prepareBatchPreflight } from "../plugins/immune-brain/runtime/unattended/batch_preflight";
import { projectTaskStatus } from "../plugins/immune-brain/runtime/assurance/coordinator";

const TASK = "drive-task";
const BATCH_ID = "batch-one";
const CONFIRMED_AT = "2026-01-01T00:00:00.000Z";
const now = "2026-01-02T00:00:00.000Z";

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", ["-C", cwd, "-c", "user.name=T", "-c", "user.email=t@t", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

test("single-task batch records retain their source and reject a different child or parallel limit", () => {
	const record = prepareBatchLaneRunState({
		plan_source: "single_task",
		batch_id: BATCH_ID,
		initiative_slug: TASK,
		children: [{ task_id: TASK, slice_id: TASK, blocked_by: [], status: "enrollable", reason: null,
			intent_path: `docs/plans/${TASK}.intent.json`, intent_revision: 1, intent_content_hash: "sha256:123" }],
		plan_digest: "sha256:plan", base_head: "head", confirmation_time: CONFIRMED_AT,
		budget: { max_children: 1, qa_failure_limit: 2 }, max_parallel: 1, now,
	});
	const parse = (value: unknown) => parseBatchLaneRunState(JSON.stringify(value), record.batch_id);
	expect(parse(record).plan_source).toBe("single_task");
	expect(() => parse({ ...record, max_parallel: 2 })).toThrow("invalid single_task plan");
	expect(() => parse({ ...record, initiative_slug: "other" })).toThrow("invalid single_task plan");
	expect(parse({ ...record, executor_mode: "interactive" }).executor_mode).toBe("interactive");
	expect(() => parse({ ...record, executor_mode: "unknown" })).toThrow("invalid executor_mode");
	expect(() => parse({ ...record, plan_source: undefined, executor_mode: "interactive" })).toThrow("invalid executor_mode");
});

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function fixture(options: { mode?: "manual" | "auto"; untrackedIntent?: boolean } = {}) {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "imm-single-task-")));
	roots.push(dir);
	mkdirSync(join(dir, "docs/plans"), { recursive: true });
	writeFileSync(join(dir, ".gitignore"), ".imm/state/\n");
	writeFileSync(join(dir, "base.txt"), "base\n");
	const verification = JSON.stringify({ contract: "assurance_kernel/verification_descriptor/v2",
		command: { executable: "bun", argv: ["-e", "process.exit(0)"], cwd: ".", timeout_ms: 60000, max_output_bytes: 4096 },
		environment: { prepare: null, writable_paths: [] } });
	writeFileSync(join(dir, `docs/plans/${TASK}.intent.json`), `${JSON.stringify({ contract: "assurance_kernel/task_intent/v1", task_id: TASK,
		owner: "user", goal: "Deliver the single task", acceptance: [{ id: "A1", assertion: "A1 holds", verification }],
		scope_hint: ["delivery.txt"], risk: "material", revision: 1 })}\n`);
	if (options.mode) {
		mkdirSync(join(dir, ".imm"), { recursive: true });
		writeFileSync(join(dir, ".imm/config.json"), JSON.stringify({ contract: "immune_brain/project_config/v1", git_integration: options.mode }));
	}
	git(dir, "init", "-q", "-b", "main");
	git(dir, "add", "-A");
	if (options.untrackedIntent) git(dir, "rm", "-q", "--cached", `docs/plans/${TASK}.intent.json`);
	git(dir, "commit", "-qm", "base");
	// The canonical planning input is staged in the coordinator checkout but absent from HEAD.
	if (options.untrackedIntent) git(dir, "add", `docs/plans/${TASK}.intent.json`);
	return { repo: dir, base: git(dir, "rev-parse", "HEAD") };
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

/** A Kernel stand-in that settles the child once its Lane carries the delivered bytes. */
function kernel(): BatchRunnerKernelPort & { lanes: Map<string, string>; settled: Set<string> } {
	const state = {
		lanes: new Map<string, string>(),
		settled: new Set<string>(),
		async enrollTask({ root, task_id }: { root: string; task_id: string }) { state.lanes.set(task_id, root); return { record_revision: "r" }; },
		async advanceTask(_root: string, taskId: string) { state.settled.add(taskId); return { state: "completed" as const }; },
		async projectTask(_root: string, taskId: string): Promise<AssuranceProjectionResult> {
			const done = state.settled.has(taskId);
			return { contract: "assurance_kernel/assurance_projection/v1", task_id: taskId, error: null,
				claim: done ? null : { task_id: taskId, lifecycle_status: "active" },
				projection: projectionBody({ lifecycle: done ? "done" : "active", completion_ready: done,
					artifact_state: "frozen", next_obligation: done ? "none" : "submit_assurance" }) } as AssuranceProjectionResult;
		},
		ownsTaskClaim: (taskId: string) => state.lanes.has(taskId) && !state.settled.has(taskId),
		validateBatchAuthorization: ({ registry, capability, binding }: Parameters<BatchRunnerKernelPort["validateBatchAuthorization"]>[0]) =>
			registry.inspect(capability, { ...binding, branch: `refs/heads/imm/${TASK}`, actor_id: "user", confirmation_ref: "confirm", nonce: "n" } as never),
	};
	return state as unknown as BatchRunnerKernelPort & { lanes: Map<string, string>; settled: Set<string> };
}

/** The Kernel's own settled evidence pair for the seeded run, written into its audit directory. */
/** Persist a batch record the way the state owner would, without its own authorization. */
function writeBatch(path: string, bytes: string) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, bytes);
}

function auditPair(root: string, taskId: string): string {
	const evidence = readSettledRunEvidence(root, taskId)!;
	const relative = `.imm/audit/${taskId}/${evidence.run_id}`;
	mkdirSync(join(root, relative), { recursive: true });
	writeFileSync(join(root, relative, "task-record.json"), evidence.record_json);
	writeFileSync(join(root, relative, "terminal-proof.json"), evidence.proof_json);
	return relative;
}

/** Settle the Lane's own Kernel run, so the supervisor reads a real done projection. */
function settleLane(lane: string) {
	const read = readTaskIntent(lane, TASK);
	seedKernelRunForTest(lane, { task_id: TASK, run_id: "run-1", terminal: { lifecycle: "done" }, record: {
		contract: "assurance_kernel/task_record/v4", task_id: TASK, intent_snapshot: read.intent,
		intent_ref: { path: read.intent_ref.path, content_hash: read.content_hash }, lifecycle: "done", artifact_state: "frozen",
		baseline: read.content_hash, git_base_head: git(lane, "rev-parse", "HEAD"), attestations: [], findings: [], history: [],
	} });
	recoverKernelStoreFollowUps(lane, TASK);
}

function request(repo: string, base: string, fx: { kernel: ReturnType<typeof kernel>; git: BatchRunnerGitPort },
	extra: Partial<StartBatchInput> & { confirmedAt?: string } = {}): StartBatchInput {
	const { confirmedAt = CONFIRMED_AT, ...overrides } = extra;
	const intent = readTaskIntent(repo, TASK);
	const children: BatchPlanChild[] = [{ task_id: TASK, slice_id: TASK, blocked_by: [], status: "enrollable", reason: null,
		intent_path: intent.intent_ref.path, intent_revision: intent.intent_ref.revision,
		intent_content_hash: canonicalIntentHash(intent.intent) }];
	const registry = createBatchAuthorityRegistry();
	const planDigest = computeBatchPlanDigest(children);
	const budget = { max_children: 1, qa_failure_limit: 2 };
	const capability = registry.issue({ batch_id: BATCH_ID, initiative_slug: TASK, plan_digest: planDigest,
		branch: `refs/heads/imm/${TASK}`, base_head: base, budget, actor_id: "user", confirmation_ref: "confirm", nonce: "n" },
	children, confirmedAt);
	return { root: repo, plan_source: "single_task", batch_id: BATCH_ID, initiative_slug: TASK, registry, capability,
		children, plan_digest: planDigest, base_head: base, confirmation_time: confirmedAt, budget, now,
		kernel: createBatchKernelPort({ root: repo, enrollmentRegistry: createEnrollmentAuthorityRegistry(), registry,
			capability, binding: { batch_id: BATCH_ID, initiative_slug: TASK, plan_digest: planDigest, branch: `refs/heads/imm/${TASK}`,
				base_head: base, budget, actor_id: "user", confirmation_ref: "confirm", nonce: "n" },
			advanceTask: async () => ({ state: "completed" }),
			resume: { isResuming: false, existingBatch: null, batchBranch: `refs/heads/imm/${TASK}` },
			overrides: fx.kernel }),
		git: fx.git, max_parallel: 1, ...overrides };
}

const laneReport = (report: unknown) => report as BatchLaneRunReport;

describe("single-task entry refusals", () => {
	it.each([
		["consolidation", JSON.stringify({ contract: "assurance_kernel/parent_delivery_consolidation/v1", envelope: {} }), true],
		["malformed-json", "{", false],
		["invalid-batch", JSON.stringify({ contract: "assurance_kernel/batch_run_state/v2", initiative_slug: "other" }), false],
		["newer-batch", JSON.stringify({ contract: "assurance_kernel/batch_run_state/v3", initiative_slug: "other" }), false],
	] as const)("classifies %s records before checking Initiative membership", async (name, bytes, allowed) => {
		const { repo } = fixture();
		const path = join(repo, `.imm/state/batches/${name}.json`);
		writeBatch(path, bytes);
		const result = await prepareBatchPreflight({ root: repo, initiative_slug: TASK, plan_source: "single_task", now });
		if (allowed) expect(result).toMatchObject({ ok: true });
		else expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("batch run state is unreadable or invalid:") });
		expect(readFileSync(path, "utf8")).toBe(bytes);
	});

	it("refuses an existing Initiative batch for a task_id entry and the inverse", async () => {
		let { repo, base } = fixture();
		const intent = readTaskIntent(repo, TASK);
		const children: BatchPlanChild[] = [{ task_id: TASK, slice_id: TASK, blocked_by: [], status: "enrollable", reason: null,
			intent_path: intent.intent_ref.path, intent_revision: intent.intent_ref.revision, intent_content_hash: canonicalIntentHash(intent.intent) }];
		const initiativeRecord = prepareBatchLaneRunState({ batch_id: "initiative-batch", initiative_slug: TASK, children,
			plan_digest: computeBatchPlanDigest(children), base_head: base, confirmation_time: CONFIRMED_AT,
			budget: { max_children: 1, qa_failure_limit: 2 }, max_parallel: 1, now });
		writeBatch(join(repo, ".imm/state/batches/initiative-batch.json"), `${JSON.stringify({ ...initiativeRecord, batch_state: "running", children: [{ ...initiativeRecord.children[0]!, state: "lane_admitted", lane: { path: repo, branch: `imm-lane/${TASK}/${TASK}`, base_head: base, lane_commit: null } }] }, null, 2)}\n`);
		const refused = await prepareBatchPreflight({ root: repo, initiative_slug: TASK, plan_source: "single_task", now, readInitiative: async () => ({ contract: "immune_brain/local_initiative_observation/v1", initiative_id: TASK, path: "docs/plans/x", tasks: [{ task_id: TASK, slice_id: TASK, blocked_by: [] }] }) });
		expect(refused).toMatchObject({ ok: false, reason: expect.stringContaining("batch_entry_kind_mismatch") });
		// The inverse, in its own workspace: an Initiative entry meeting a recorded single_task batch.
		({ repo, base } = fixture());
		const singleTask = prepareBatchLaneRunState({ plan_source: "single_task", batch_id: "single-batch", initiative_slug: TASK, children,
			plan_digest: computeBatchPlanDigest(children), base_head: base, confirmation_time: CONFIRMED_AT,
			budget: { max_children: 1, qa_failure_limit: 2 }, max_parallel: 1, now });
		writeBatch(join(repo, ".imm/state/batches/single-batch.json"), `${JSON.stringify({ ...singleTask, batch_state: "running" }, null, 2)}\n`);
		const initiativeEntry = await prepareBatchPreflight({ root: repo, initiative_slug: TASK, now,
			readInitiative: async () => ({ contract: "immune_brain/local_initiative_observation/v1", initiative_id: TASK, path: "docs/plans/x", tasks: [{ task_id: TASK, slice_id: TASK, blocked_by: [] }] }) });
		expect(initiativeEntry).toMatchObject({ ok: false, reason: expect.stringContaining("batch_entry_kind_mismatch") });
	});

	it("refuses a task that is a child of an active Initiative batch", async () => {
		const { repo, base } = fixture();
		const intent = readTaskIntent(repo, TASK);
		const child = { task_id: TASK, slice_id: "S1", blocked_by: [], status: "enrollable" as const, reason: null,
			intent_path: intent.intent_ref.path, intent_revision: intent.intent_ref.revision, intent_content_hash: canonicalIntentHash(intent.intent) };
		const parentChild = { ...child, task_id: "child-task" };
		const record = prepareBatchLaneRunState({ batch_id: "initiative-batch", initiative_slug: "some-initiative",
			children: [parentChild], plan_digest: computeBatchPlanDigest([parentChild]), base_head: base, confirmation_time: CONFIRMED_AT,
			budget: { max_children: 1, qa_failure_limit: 2 }, max_parallel: 1, now });
		writeBatch(join(repo, ".imm/state/batches/initiative-batch.json"), `${JSON.stringify({ ...record, batch_state: "running", children: [{ ...record.children[0]!, task_id: TASK, state: "lane_admitted", lane: { path: repo, branch: `imm-lane/some-initiative/${TASK}`, base_head: base, lane_commit: null } }] }, null, 2)}\n`);
		const refused = await prepareBatchPreflight({ root: repo, initiative_slug: TASK, plan_source: "single_task", now,
			readInitiative: async () => ({ contract: "immune_brain/local_initiative_observation/v1", initiative_id: TASK, path: "docs/plans/x", tasks: [{ task_id: TASK, slice_id: TASK, blocked_by: [] }] }) });
		expect(refused).toMatchObject({ ok: false, reason: expect.stringContaining("batch_entry_kind_mismatch") });
	});
});

describe("single-task status", () => {
	it("returns the batch record and the child's Lane state for a task_id, and none for an unknown task", async () => {
		const { repo, base } = fixture();
		const intent = readTaskIntent(repo, TASK);
		const children: BatchPlanChild[] = [{ task_id: TASK, slice_id: TASK, blocked_by: [], status: "enrollable", reason: null,
			intent_path: intent.intent_ref.path, intent_revision: intent.intent_ref.revision, intent_content_hash: canonicalIntentHash(intent.intent) }];
		const record = prepareBatchLaneRunState({ plan_source: "single_task", batch_id: "batch-one", initiative_slug: TASK, children,
			plan_digest: computeBatchPlanDigest(children), base_head: base, confirmation_time: CONFIRMED_AT,
			budget: { max_children: 1, qa_failure_limit: 2 }, max_parallel: 1, now });
		const lanePath = `${repo}/.git/imm/worktrees/${TASK}/${TASK}`;
		writeBatch(join(repo, ".imm/state/batches/batch-one.json"), `${JSON.stringify({ ...record, batch_state: "running",
			children: [{ ...record.children[0]!, state: "enrolled", lane: { path: lanePath, branch: `imm-lane/${TASK}/${TASK}`, base_head: base, lane_commit: null } }] }, null, 2)}\n`);
		const status = await projectTaskStatus(repo, TASK);
		expect(status.batch?.record).toMatchObject({ plan_source: "single_task", batch_state: "running", initiative_slug: TASK,
			children: [{ task_id: TASK, state: "enrolled", lane: { path: lanePath, branch: `imm-lane/${TASK}/${TASK}` } }] });
		const unknown = await projectTaskStatus(repo, "no-such-task");
		expect(unknown.batch ?? null).toBeNull();
	});
});

describe("single-task Lane delivery", () => {
	function owned(options: { mode?: "manual" | "auto"; untrackedIntent?: boolean; extra?: Partial<StartBatchInput> & { confirmedAt?: string } } = {}) {
		const { repo, base } = fixture(options);
		const port = createDefaultLaneGitPort();
		const k = kernel();
		const laneCommits = createDefaultBatchGitPort();
		return { repo, base, port, kernel: k,
			args: (extra: Partial<StartBatchInput> & { confirmedAt?: string } = {}) =>
				request(repo, base, { kernel: k, git: Object.assign(laneCommits, { lane: port }) }, { ...options.extra, ...extra }) };
	}

	it("keeps an interactive Lane on re-entry, delivers its settlement and retains its worktree", async () => {
		const f = owned();
		const project = f.kernel.projectTask;
		let decisionPending = false;
		let decisionArtifactState: "active" | "frozen" = "active";
		const advance = spyOn(f.kernel, "advanceTask").mockImplementation(async () => { throw new Error("the Executor or user owns the next action"); });
		f.kernel.projectTask = async (...args) => {
			const result = await project(...args);
			if (result.projection.lifecycle === "active") result.projection.artifact_state = decisionPending ? decisionArtifactState : "active";
			if (decisionPending) {
				result.projection.next_obligation = "resolve_user_decision";
				result.projection.open_user_decision_count = 1;
			}
			return result;
		};
		const supervisor = new LaneSupervisor();
		const spawn = spyOn(supervisor, "run").mockImplementation(async () => { throw new Error("must not spawn a runtime Executor"); });
		const args = { ...f.args(), executor_mode: "interactive" as const,
			supervision: { supervisor, parentHost: "pi" as const, pluginDir: "/plugin", waitMs: 1 } };
		const first = laneReport(await startBatch(args));
		const lane = first.children[0]!.lane!.path;
		expect(first.handoffs).toContainEqual(expect.objectContaining({ role: "executor", task_id: TASK, lane_path: lane }));
		expect(first.lane_supervision).toBeUndefined();
		expect(readAnyBatchRunState(f.repo, BATCH_ID)).toMatchObject({ executor_mode: "interactive" });
		const again = laneReport(await startBatch({ ...args, executor_mode: undefined }));
		expect(again.children[0]!.lane!.path).toBe(lane);
		expect(again.next_action).toContain("Resume inside Herdr");
		expect(again.next_action).toContain(`task_id ${TASK} and no initiative_slug`);
		expect(again.handoffs).toContainEqual(expect.objectContaining({ role: "executor", lane_path: lane }));
		decisionPending = true;
		for (const artifactState of ["active", "frozen"] as const) {
			decisionArtifactState = artifactState;
			const decision = laneReport(await startBatch(args));
			expect(decision.lane_decision_required).toMatchObject({ task_id: TASK, record_revision: "r1", open_user_decision_count: 1 });
			expect(decision.batch_state).toBe("running");
			expect(decision.children[0]!.state).toBe("enrolled");
			expect(decision.handoffs.some(h => h.role === "executor")).toBe(false);
		}
		expect(advance).not.toHaveBeenCalled();
		decisionPending = false;
		expect(await stopSingleTaskSupervisor(supervisor, f.repo, TASK)).toMatchObject({ state: "blocked", reason: "lane_executor_interactive" });
		writeFileSync(join(lane, "delivery.txt"), "delivered\n");
		settleLane(lane);
		f.kernel.settled.add(TASK);
		auditPair(lane, TASK);
		git(lane, "add", "--", "delivery.txt");
		const done = laneReport(await startBatch({ ...args, executor_mode: undefined }));
		expect(done.batch_state).toBe("completed");
		expect(done.final_report?.return_to_coordinator.status).toBe("staged");
		expect(git(f.repo, "show", ":delivery.txt")).toBe("delivered");
		expect(git(f.repo, "worktree", "list", "--porcelain")).toContain(lane);
		expect(done.children[0]!.lane_retained).toBeDefined();
		expect(spawn).not.toHaveBeenCalled();
	});

	it("reports a pending decision in an already parked interactive Lane without resuming it", async () => {
		const f = owned();
		const args = { ...f.args(), executor_mode: "interactive" as const };
		await startBatch(args);
		const record = readAnyBatchRunState(f.repo, BATCH_ID) as BatchLaneRunStateRecord;
		writeBatchLaneRunState(f.repo, { ...record, batch_state: "needs_human",
			children: record.children.map(child => ({ ...child, state: "needs_human", reason: "awaiting_user" })) });
		args.kernel.projectTask = async (_root, taskId) => ({ contract: "assurance_kernel/assurance_projection/v1", task_id: taskId,
			error: null, claim: { task_id: taskId, lifecycle_status: "active" }, projection: projectionBody({
				artifact_state: "frozen", next_obligation: "resolve_user_decision", open_user_decision_count: 1 }) }) as AssuranceProjectionResult;
		const report = laneReport(await startBatch(args));
		expect(report.lane_decision_required).toMatchObject({ task_id: TASK, open_user_decision_count: 1 });
		expect(report.batch_state).toBe("needs_human");
		expect(report.children[0]!.state).toBe("needs_human");
	});

	it("integrates the settled delivery onto imm/<task_id> with identical per-path content", async () => {
		const f = owned();
		// The first tick creates the Lane and enrolls the child; the Parent ref starts at base.
		const first = laneReport(await startBatch(f.args()));
		expect(first.children[0]!.state).toBe("enrolled");
		expect(readAnyBatchRunState(f.repo, BATCH_ID)).toMatchObject({ plan_source: "single_task", initiative_slug: TASK, max_parallel: 1 });
		const lane = first.children[0]!.lane!.path;
		writeFileSync(join(lane, "delivery.txt"), "delivered\n");
		settleLane(lane);
		const pair = auditPair(lane, TASK);
		expect(pair).toContain(`.imm/audit/${TASK}/run-1`);
		git(lane, "add", "--", "delivery.txt");
		const second = laneReport(await startBatch(f.args()));
		expect(second.children[0]!.state).toBe("integrated");
		const laneCommit = second.children[0]!.lane!.lane_commit!;
		expect(git(lane, "rev-parse", "HEAD")).toBe(laneCommit);
		const candidate = git(f.repo, "rev-parse", `refs/heads/imm/${TASK}`);
		expect(candidate).toBe(second.commits[0]!);
		const changed = git(f.repo, "diff", "--name-only", f.base, candidate).split("\n").sort();
		expect(changed).toEqual([`${pair}/task-record.json`, `${pair}/terminal-proof.json`, "delivery.txt"].sort());
		for (const path of changed)
			expect(git(f.repo, "show", `${candidate}:${path}`)).toBe(git(lane, "show", `${laneCommit}:${path}`));
		expect(readFileSync(join(f.repo, "base.txt"), "utf8")).toBe("base\n");
		expect(second.final_report?.return_to_coordinator).toEqual({ mode: "manual", status: "staged", reason: null });
		expect(git(f.repo, "rev-parse", "HEAD")).toBe(f.base);
		expect(git(f.repo, "show", ":delivery.txt")).toBe("delivered");
	});

	it("parks a settled child when the checkout has an overlapping user file", async () => {
		const f = owned();
		const first = laneReport(await startBatch(f.args()));
		const lane = first.children[0]!.lane!.path;
		writeFileSync(join(lane, "delivery.txt"), "delivered\n");
		settleLane(lane);
		auditPair(lane, TASK);
		git(lane, "add", "--", "delivery.txt");
		writeFileSync(join(f.repo, "delivery.txt"), "user content\n");
		const second = laneReport(await startBatch(f.args()));
		expect(second.batch_state).toBe("needs_human");
		expect(second.children[0]).toMatchObject({ state: "needs_human", reason: "checkout_delivery_overlap: delivery.txt" });
		expect(second.final_report?.return_to_coordinator).toMatchObject({ status: "blocked", reason: "checkout_delivery_overlap: delivery.txt" });
		expect(readFileSync(join(f.repo, "delivery.txt"), "utf8")).toBe("user content\n");
		expect(git(f.repo, "rev-parse", "HEAD")).toBe(f.base);
	});

	it("parks the child and moves no ref when the candidate does not match the delivery", async () => {
		const f = owned();
		const first = laneReport(await startBatch(f.args()));
		const lane = first.children[0]!.lane!.path;
		writeFileSync(join(lane, "delivery.txt"), "delivered\n");
		settleLane(lane);
		auditPair(lane, TASK);
		git(lane, "add", "--", "delivery.txt");
		// The Parent branch already carries the same bytes, so the delivery has no candidate of its own.
		git(f.repo, "checkout", "-q", `imm/${TASK}`);
		writeFileSync(join(f.repo, "delivery.txt"), "delivered\n");
		const relative = auditPair(lane, TASK);
		mkdirSync(join(f.repo, relative), { recursive: true });
		for (const file of ["task-record.json", "terminal-proof.json"])
			writeFileSync(join(f.repo, relative, file), readFileSync(join(lane, relative, file)));
		git(f.repo, "add", "-A");
		git(f.repo, "commit", "-qm", "identical delivery already present");
		const parentHead = git(f.repo, "rev-parse", `refs/heads/imm/${TASK}`);
		git(f.repo, "checkout", "-q", "main");
		const second = laneReport(await startBatch(f.args()));
		expect(second.children[0]!.state).toBe("needs_human");
		expect(second.children[0]!.reason).toContain("batch_change_already_present");
		expect(git(f.repo, "rev-parse", `refs/heads/imm/${TASK}`)).toBe(parentHead);
		expect(second.batch_state).toBe("needs_human");
	});
});

describe("single-task final verification and checkout delivery", () => {
	const PASS = ["bun --version"];
	const LATER = "2026-01-03T00:00:00.000Z";
	type Fixture = ReturnType<typeof ownedFixture>;
	const ownedFixture = (options: Parameters<typeof owned>[0] = {}) => owned(options);
	// `owned` lives in the sibling describe; rebuild the same wiring here.
	function owned(options: { mode?: "manual" | "auto"; untrackedIntent?: boolean; extra?: Partial<StartBatchInput> & { confirmedAt?: string } } = {}) {
		const { repo, base } = fixture(options);
		const port = createDefaultLaneGitPort();
		const k = kernel();
		const laneCommits = createDefaultBatchGitPort();
		return { repo, base, port, kernel: k,
			args: (extra: Partial<StartBatchInput> & { confirmedAt?: string } = {}) =>
				request(repo, base, { kernel: k, git: Object.assign(laneCommits, { lane: port }) }, { final_verification: PASS, ...options.extra, ...extra }) };
	}
	/** Enroll, then deliver and settle the Lane so the next tick integrates and finalizes. */
	async function settled(f: Fixture) {
		const first = laneReport(await startBatch(f.args()));
		const lane = first.children[0]!.lane!.path;
		writeFileSync(join(lane, "delivery.txt"), "delivered\n");
		settleLane(lane);
		auditPair(lane, TASK);
		git(lane, "add", "--", "delivery.txt");
		return lane;
	}
	const read = (f: Fixture) => readAnyBatchRunState(f.repo, BATCH_ID) as BatchLaneRunStateRecord;
	const recordBytes = (f: Fixture) => readFileSync(join(f.repo, `.imm/state/batches/${BATCH_ID}.json`), "utf8");
	/** Park the settled child on a dirty overlap after a passing verification. */
	async function parkedOnOverlap(f: Fixture, overlap = "delivery.txt") {
		await settled(f);
		writeFileSync(join(f.repo, overlap), "user content\n");
		const parked = laneReport(await startBatch(f.args()));
		expect(parked.batch_state).toBe("needs_human");
		return parked;
	}
	/** The interruption shape from the observed failure: running, integrated child, nested passing report. */
	function asObservedRunning(f: Fixture, mutate: (record: BatchLaneRunStateRecord) => void = () => {}) {
		const record = read(f);
		record.batch_state = "running";
		record.children = record.children.map(child => ({ ...child, state: "integrated", reason: null }));
		record.final_report!.return_to_coordinator = { ...record.final_report!.return_to_coordinator, status: "blocked", reason: "return_pending" };
		record.final_report!.final_verification!.results[0]!.duration_ms = 12345;
		mutate(record);
		writeBatchLaneRunState(f.repo, record);
	}

	it.each(["manual", "auto"] as const)("%s: completes with passing final commands and a re-readable completed-only proof", async mode => {
		const f = owned({ mode });
		await settled(f);
		const done = laneReport(await startBatch(f.args()));
		expect(done.batch_state).toBe("completed");
		const record = read(f);
		expect(record).toMatchObject({ batch_state: "completed", final_verification_result: { passed: true, head: done.commits[0] },
			final_report: { final_verification: { passed: true }, return_to_coordinator: { mode, status: mode === "auto" ? "fast_forwarded" : "staged", reason: null } } });
		expect(readFileSync(join(f.repo, "delivery.txt"), "utf8")).toBe("delivered\n");
		expect(git(f.repo, "rev-parse", "HEAD")).toBe(mode === "auto" ? done.commits[0]! : f.base);
		if (mode === "manual") expect(git(f.repo, "show", ":delivery.txt")).toBe("delivered");
	});

	it.each(["manual", "auto"] as const)("%s: parks a passing verification on a dirty overlap with the exact path and a nested result only", async mode => {
		const f = owned({ mode });
		const parked = await parkedOnOverlap(f);
		const reason = "checkout_delivery_overlap: delivery.txt";
		expect(parked.children[0]).toMatchObject({ state: "needs_human", reason });
		const record = read(f);
		expect(record.batch_state).toBe("needs_human");
		expect(record.final_verification_result).toBeUndefined();
		expect(record.final_report).toMatchObject({ final_verification: { passed: true, head: parked.commits[0] }, return_to_coordinator: { mode, status: "blocked", reason } });
		expect(record.children[0]!.lane_removed ?? record.children[0]!.lane_retained).toBeUndefined();
		expect(readFileSync(join(f.repo, "delivery.txt"), "utf8")).toBe("user content\n");
		expect(git(f.repo, "rev-parse", "HEAD")).toBe(f.base);
		expect(git(f.repo, "status", "--porcelain")).toBe("?? delivery.txt");
		expect(git(f.repo, "rev-parse", `refs/heads/imm/${TASK}`)).toBe(parked.commits[0]!);
		// The producer must never persist the illegal combination, and the reader still rejects it.
		for (const batch_state of ["running", "needs_human"] as const)
			expect(() => parseBatchLaneRunState(JSON.stringify({ ...record, batch_state, final_verification_result: record.final_report!.final_verification }), BATCH_ID))
				.toThrow("final verification requires a completed lane batch");
	});

	it("delivers around the coordinator's own identical staged planning input and keeps its bytes", async () => {
		const f = owned({ untrackedIntent: true });
		const lane = await settled(f);
		// The Lane copies the planning input and delivers it; the coordinator keeps its own identical staged copy for resume.
		const intentPath = `docs/plans/${TASK}.intent.json`;
		git(lane, "add", "--", intentPath);
		const sidecar = readFileSync(join(f.repo, intentPath), "utf8");
		const sidecarIndex = git(f.repo, "ls-files", "--stage", "--", intentPath);
		const done = laneReport(await startBatch(f.args()));
		expect(done.batch_state).toBe("completed");
		expect(done.final_report?.return_to_coordinator).toEqual({ mode: "manual", status: "staged", reason: null });
		expect(read(f).final_report?.return_to_coordinator).toEqual({ mode: "manual", status: "staged", reason: null });
		expect(readFileSync(join(f.repo, intentPath), "utf8")).toBe(sidecar);
		expect(git(f.repo, "ls-files", "--stage", "--", intentPath)).toBe(sidecarIndex);
		const pair = `.imm/audit/${TASK}/${readSettledRunEvidence(lane, TASK)!.run_id}`;
		expect(git(f.repo, "rev-parse", "HEAD")).toBe(f.base);
		expect(readFileSync(join(f.repo, "delivery.txt"), "utf8")).toBe("delivered\n");
		expect(git(f.repo, "diff", "--cached", "--name-only").split("\n").sort())
			.toEqual([`${pair}/task-record.json`, `${pair}/terminal-proof.json`, "delivery.txt", intentPath].sort());
		for (const file of ["task-record.json", "terminal-proof.json"]) expect(existsSync(join(f.repo, pair, file))).toBe(true);
		// A second tick delivers nothing more.
		const index = git(f.repo, "diff", "--cached");
		await startBatch(f.args());
		expect(git(f.repo, "diff", "--cached")).toBe(index);
	});

	it("resumes a delivery park with fresh authorization without a new child, integration or verification", async () => {
		const f = owned();
		const enroll = spyOn(f.kernel, "enrollTask");
		const parked = await parkedOnOverlap(f);
		const enrolled = enroll.mock.calls.length;
		const integrated = parked.commits[0]!;
		const record = read(f);
		record.final_report!.final_verification!.results[0]!.duration_ms = 12345;
		writeBatchLaneRunState(f.repo, record);
		expect(laneReport(await startBatch(f.args())).batch_state).toBe("needs_human"); // no fresh authorization yet
		rmSync(join(f.repo, "delivery.txt"));
		const done = laneReport(await startBatch(f.args({ confirmedAt: LATER })));
		expect(done.batch_state).toBe("completed");
		expect(enroll.mock.calls.length).toBe(enrolled);
		expect(done.commits).toEqual([integrated]);
		expect(git(f.repo, "rev-parse", `refs/heads/imm/${TASK}`)).toBe(integrated);
		expect(read(f).final_verification_result!.results[0]!.duration_ms).toBe(12345);
		expect(git(f.repo, "show", ":delivery.txt")).toBe("delivered");
	});

	it("replays the observed running/integrated/nested-pass shape once, reusing unchanged verification", async () => {
		const f = owned();
		const enroll = spyOn(f.kernel, "enrollTask");
		const parked = await parkedOnOverlap(f);
		const enrolled = enroll.mock.calls.length;
		asObservedRunning(f);
		rmSync(join(f.repo, "delivery.txt"));
		const done = laneReport(await startBatch(f.args()));
		expect(done.batch_state).toBe("completed");
		expect(enroll.mock.calls.length).toBe(enrolled);
		expect(done.commits).toEqual(parked.commits);
		expect(read(f).final_verification_result!.results[0]!.duration_ms).toBe(12345);
		expect(git(f.repo, "show", ":delivery.txt")).toBe("delivered");
	});

	it.each([
		["another head", (r: BatchLaneRunStateRecord) => { r.final_report!.final_verification!.head = "0".repeat(40); }],
		["a changed command list", (r: BatchLaneRunStateRecord) => { r.final_report!.final_verification!.results[0]!.command = "git status"; }],
		["a contradictory result", (r: BatchLaneRunStateRecord) => { r.final_report!.final_verification!.results[0]!.passed = false; }],
		["a failed observation", (r: BatchLaneRunStateRecord) => { r.final_report!.final_verification!.passed = false; r.final_report!.final_verification!.results[0]!.passed = false; r.final_report!.final_verification!.results[0]!.exit_code = 1; }],
	] as const)("reruns verification instead of reusing %s", async (_name, mutate) => {
		const f = owned();
		await parkedOnOverlap(f);
		asObservedRunning(f, mutate);
		rmSync(join(f.repo, "delivery.txt"));
		const done = laneReport(await startBatch(f.args()));
		expect(done.batch_state).toBe("completed");
		const result = read(f).final_verification_result!;
		expect(result).toMatchObject({ passed: true, results: [{ command: "bun --version", passed: true }] });
		expect(result.results[0]!.duration_ms).not.toBe(12345);
	});

	it.each(["manual", "auto"] as const)("%s: reconciles an already applied delivery after an interruption, once", async mode => {
		const f = owned({ mode });
		const parked = await parkedOnOverlap(f);
		asObservedRunning(f);
		rmSync(join(f.repo, "delivery.txt"));
		const baseHead = read(f).children[0]!.lane!.base_head;
		expect(deliverSingleTask(f.repo, baseHead, parked.commits[0]!).reason).toBeNull();
		const before = { head: git(f.repo, "rev-parse", "HEAD"), status: git(f.repo, "status", "--porcelain"), index: git(f.repo, "diff", "--cached", "--binary") };
		const done = laneReport(await startBatch(f.args()));
		expect(done.reason).toBe("all enrollable children integrated");
		expect(done.batch_state).toBe("completed");
		expect(done.final_report?.return_to_coordinator).toMatchObject({ status: mode === "auto" ? "fast_forwarded" : "staged", reason: null });
		expect({ head: git(f.repo, "rev-parse", "HEAD"), status: git(f.repo, "status", "--porcelain"), index: git(f.repo, "diff", "--cached", "--binary") }).toEqual(before);
		expect(done.commits).toEqual(parked.commits);
	});

	it("parks instead of reconciling when the applied delivery bytes changed", async () => {
		const f = owned();
		const parked = await parkedOnOverlap(f);
		asObservedRunning(f);
		rmSync(join(f.repo, "delivery.txt"));
		deliverSingleTask(f.repo, read(f).children[0]!.lane!.base_head, parked.commits[0]!);
		writeFileSync(join(f.repo, "delivery.txt"), "user edited after apply\n");
		const again = laneReport(await startBatch(f.args()));
		expect(again.batch_state).toBe("needs_human");
		expect(again.children[0]!.reason).toContain("checkout_delivery_overlap: ");
		expect(again.children[0]!.reason).toContain("delivery.txt");
		expect(readFileSync(join(f.repo, "delivery.txt"), "utf8")).toBe("user edited after apply\n");
		expect(read(f).final_verification_result).toBeUndefined();
	});

	it("replays a completed batch idempotently", async () => {
		const f = owned();
		await settled(f);
		const done = laneReport(await startBatch(f.args()));
		const before = { record: recordBytes(f), head: git(f.repo, "rev-parse", "HEAD"), index: git(f.repo, "diff", "--cached", "--binary"), ref: git(f.repo, "rev-parse", `refs/heads/imm/${TASK}`) };
		const replay = laneReport(await startBatch(f.args()));
		expect(replay.batch_state).toBe("completed");
		expect(replay.commits).toEqual(done.commits);
		expect({ record: recordBytes(f), head: git(f.repo, "rev-parse", "HEAD"), index: git(f.repo, "diff", "--cached", "--binary"), ref: git(f.repo, "rev-parse", `refs/heads/imm/${TASK}`) }).toEqual(before);
	});

	it.each([
		["a nonzero exit", ["git no-such-subcommand"], undefined, "final_verification_failed: git no-such-subcommand"],
		["a bounded timeout", ["sleep 5"], 200, "final_verification_failed: sleep 5"],
	] as const)("%s parks the child with duration evidence and neither delivers nor cleans up", async (_name, commands, timeout, reason) => {
		const f = owned({ extra: { final_verification: [...commands], ...(timeout ? { final_verification_timeout_ms: timeout } : {}) } });
		await settled(f);
		const parked = laneReport(await startBatch(f.args()));
		expect(parked.batch_state).toBe("needs_human");
		expect(parked.children[0]).toMatchObject({ state: "needs_human", reason });
		const record = read(f);
		expect(record.final_verification_result).toBeUndefined();
		const nested = record.final_report!.final_verification!;
		expect(nested.passed).toBe(false);
		expect(nested.results[0]!.duration_ms).toBeGreaterThanOrEqual(0);
		if (timeout) expect(nested.results[0]).toMatchObject({ signal: "timeout", exit_code: null });
		expect(record.final_report!.return_to_coordinator).toMatchObject({ status: "blocked", reason });
		expect(record.children[0]!.lane_removed ?? record.children[0]!.lane_retained).toBeUndefined();
		expect(git(f.repo, "worktree", "list", "--porcelain")).toContain(record.children[0]!.lane!.path);
		expect(git(f.repo, "status", "--porcelain")).toBe("");
		expect(git(f.repo, "rev-parse", "HEAD")).toBe(f.base);
		expect(git(f.repo, "rev-parse", `refs/heads/imm/${TASK}`)).toBe(parked.commits[0]!);
		expect(parked.commits).toHaveLength(1);
	});
});
