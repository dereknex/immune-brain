import { afterAll, describe, expect, it, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { computeBatchPlanDigest, createBatchAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/batch_authority";
import { canonicalIntentHash, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import type { AssuranceProjectionResult } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import { createBatchKernelPort } from "../plugins/immune-brain/runtime/unattended/batch_kernel_port";
import { createEnrollmentAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { createDefaultBatchGitPort, type BatchRunnerGitPort } from "../plugins/immune-brain/runtime/unattended/batch_git";
import { createDefaultLaneGitPort } from "../plugins/immune-brain/runtime/unattended/batch_lanes";
import { startBatch } from "../plugins/immune-brain/runtime/unattended/batch_runner";
import type { BatchRunnerKernelPort, StartBatchInput } from "../plugins/immune-brain/runtime/unattended/batch_runner";
import { parseBatchLaneRunState, prepareBatchLaneRunState, readAnyBatchRunState, type BatchLaneRunReport } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { readSettledRunEvidence, recoverKernelStoreFollowUps } from "../plugins/immune-brain/runtime/kernel/storage";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";
import type { BatchPlanChild } from "../plugins/immune-brain/runtime/unattended/types";
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
});

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function fixture() {
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
	git(dir, "init", "-q", "-b", "main");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
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

function request(repo: string, base: string, fx: { kernel: ReturnType<typeof kernel>; git: BatchRunnerGitPort }): StartBatchInput {
	const intent = readTaskIntent(repo, TASK);
	const children: BatchPlanChild[] = [{ task_id: TASK, slice_id: TASK, blocked_by: [], status: "enrollable", reason: null,
		intent_path: intent.intent_ref.path, intent_revision: intent.intent_ref.revision,
		intent_content_hash: canonicalIntentHash(intent.intent) }];
	const registry = createBatchAuthorityRegistry();
	const planDigest = computeBatchPlanDigest(children);
	const budget = { max_children: 1, qa_failure_limit: 2 };
	const capability = registry.issue({ batch_id: BATCH_ID, initiative_slug: TASK, plan_digest: planDigest,
		branch: `refs/heads/imm/${TASK}`, base_head: base, budget, actor_id: "user", confirmation_ref: "confirm", nonce: "n" },
	children, CONFIRMED_AT);
	return { root: repo, plan_source: "single_task", batch_id: BATCH_ID, initiative_slug: TASK, registry, capability,
		children, plan_digest: planDigest, base_head: base, confirmation_time: CONFIRMED_AT, budget, now,
		kernel: createBatchKernelPort({ root: repo, enrollmentRegistry: createEnrollmentAuthorityRegistry(), registry,
			capability, binding: { batch_id: BATCH_ID, initiative_slug: TASK, plan_digest: planDigest, branch: `refs/heads/imm/${TASK}`,
				base_head: base, budget, actor_id: "user", confirmation_ref: "confirm", nonce: "n" },
			advanceTask: async () => ({ state: "completed" }),
			resume: { isResuming: false, existingBatch: null, batchBranch: `refs/heads/imm/${TASK}` },
			overrides: fx.kernel }),
		git: fx.git, max_parallel: 1 };
}

const laneReport = (report: unknown) => report as BatchLaneRunReport;

describe("single-task entry refusals", () => {
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
	function owned() {
		const { repo, base } = fixture();
		const port = createDefaultLaneGitPort();
		const k = kernel();
		const laneCommits = createDefaultBatchGitPort();
		return { repo, base, port, kernel: k,
			args: () => request(repo, base, { kernel: k, git: Object.assign(laneCommits, { lane: port }) }) };
	}

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
