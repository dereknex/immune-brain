import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeBatchPlanDigest, createBatchAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/batch_authority";
import { canonicalIntentHash, intentAuthorityHash, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import type { AssuranceProjectionResult } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import { createBatchKernelPort } from "../plugins/immune-brain/runtime/unattended/batch_kernel_port";
import { createEnrollmentAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { createDefaultBatchGitPort, type BatchRunnerGitPort } from "../plugins/immune-brain/runtime/unattended/batch_git";
import { createDefaultLaneGitPort } from "../plugins/immune-brain/runtime/unattended/batch_lanes";
import { runLaneBatch } from "../plugins/immune-brain/runtime/unattended/batch_lanes";

/** S8: the shared transitional entry is gone; the engine entry reads the persisted record the same way. */
const startBatch = (input: StartBatchInput) => runLaneBatch(input, readAnyBatchRunState(input.root, input.batch_id));
import type { BatchRunnerKernelPort } from "../plugins/immune-brain/runtime/unattended/batch_kernel_port";
import type { StartBatchInput } from "../plugins/immune-brain/runtime/unattended/batch_lanes";
import { parkLaneForExecutor, prepareBatchLaneRunState, readAnyBatchRunState, rebindBatchChildIdentity, rebindSingleTaskIdentity, writeBatchLaneRunState, type BatchLaneRunReport, type BatchLaneRunStateRecord } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { LaneDecisionStaleError, laneDecisionFacts, relayLaneDecision, type LaneDecisionOperation } from "../plugins/immune-brain/runtime/unattended/lane_decision";
import { laneDecisionRequestPath, readLaneDecisionRequest, writeLaneDecisionRequest, LANE_EXECUTOR_ENV, LANE_EXECUTOR_HEADLESS } from "../plugins/immune-brain/runtime/unattended/lane_decision_request";
import type { BatchPlanChild } from "../plugins/immune-brain/runtime/unattended/types";
import { batchReason } from "../plugins/immune-brain/runtime/unattended/batch_reasons";
import { findLaneRelayTarget } from "../plugins/immune-brain/runtime/unattended/lane_decision";
import { findActiveLaneBatchForTask, findExistingActiveBatch } from "../plugins/immune-brain/runtime/unattended/batch_preflight";
import { readTaskTombstone } from "../plugins/immune-brain/runtime/kernel/backend_claim";
import { prepareBatchLaneRunState, writeBatchLaneRunState } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { hasContiguousLaneRebind } from "../plugins/immune-brain/runtime/assurance/run_continuation";
import { laneSessionKey } from "../plugins/immune-brain/runtime/unattended/batch_session_port";
import { openBatchSessionPort, startLanes, advanceLanes } from "../plugins/immune-brain/runtime/lane_sessions/index";
import { SessionPortAdapter } from "../plugins/immune-brain/runtime/lane_sessions/session_port_adapter";
import type { BatchAgreement } from "../plugins/immune-brain/runtime/unattended/batch_agreement";
import { reconcileChildSession } from "../plugins/immune-brain/runtime/unattended/child_session_reconciler";
import { readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage";
import { createMcpRuntime, elicitationParams } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { consumePhaseAdmission, phaseEntryGateHookOutput, recordPhaseEntryPrompt, type GatedTool } from "../plugins/immune-brain/runtime/claude/lane_guard";
import { copyGitTemplate } from "./helpers/git-template";
import { memoryLanePort, memoryLanePortEnv } from "./helpers/memory-lane-port";
import { projectAssurance } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import { mockHostSdkForDeliveryTree } from "./helpers/pi-canary-assurance-harness";

// Delivery QA has no Host SDK packages; the Pi surface runs against the harness seam when they are absent.
await mockHostSdkForDeliveryTree();
afterAll(() => mock.restore());
const { executePiUnattendedBatch } = await import("../plugins/immune-brain/.pi-extension/imm-unattended-batch");
const { default: registerPiWork, recordPiPhaseInput, getSharedPiProgression } = await import("../plugins/immune-brain/.pi-extension/imm-canary-work");

const TASK = "drive-task";
const BATCH_ID = "batch-one";
const CONFIRMED_AT = "2026-01-01T00:00:00.000Z";
const now = "2026-01-02T00:00:00.000Z";

const roots: string[] = [];
const oldPath = process.env.PATH;
afterAll(() => { process.env.PATH = oldPath; for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", ["-C", cwd, "-c", "user.name=T", "-c", "user.email=t@t", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const VERIFICATION = JSON.stringify({ contract: "assurance_kernel/verification_descriptor/v2",
	command: { executable: "bun", argv: ["-e", "process.exit(0)"], cwd: ".", timeout_ms: 60000, max_output_bytes: 4096 },
	environment: { prepare: null, writable_paths: [] } });

function intentJson(revision: number, assertion = "A1 holds", risk = "material") {
	return `${JSON.stringify({ contract: "assurance_kernel/task_intent/v1", task_id: TASK, owner: "user", goal: "Deliver the single task",
		acceptance: [{ id: "A1", assertion, verification: VERIFICATION }], scope_hint: ["delivery.txt"], risk, revision })}\n`;
}

function fixture() {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "imm-lane-decision-")));
	roots.push(dir);
	mkdirSync(join(dir, "docs/plans"), { recursive: true });
	writeFileSync(join(dir, ".gitignore"), ".imm/state/\n");
	writeFileSync(join(dir, "base.txt"), "base\n");
	writeFileSync(join(dir, `docs/plans/${TASK}.intent.json`), intentJson(1));
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

function kernel(): BatchRunnerKernelPort & { lanes: Map<string, string> } {
	const state = {
		lanes: new Map<string, string>(),
		async enrollTask({ root, task_id }: { root: string; task_id: string }) { state.lanes.set(task_id, root); return { record_revision: "r" }; },
		async advanceTask() { return { state: "completed" as const }; },
		async projectTask(_root: string, taskId: string): Promise<AssuranceProjectionResult> {
			return { contract: "assurance_kernel/assurance_projection/v1", task_id: taskId, error: null,
				claim: { task_id: taskId, lifecycle_status: "active" }, projection: projectionBody() } as AssuranceProjectionResult;
		},
		ownsTaskClaim: (taskId: string) => state.lanes.has(taskId),
		validateBatchAuthorization: ({ registry, capability, binding }: Parameters<BatchRunnerKernelPort["validateBatchAuthorization"]>[0]) =>
			registry.inspect(capability, { ...binding, branch: `refs/heads/imm/${TASK}`, actor_id: "user", confirmation_ref: "confirm", nonce: "n" } as never),
	};
	return state as unknown as BatchRunnerKernelPort & { lanes: Map<string, string> };
}

function request(repo: string, base: string, fx: { kernel: ReturnType<typeof kernel>; git: BatchRunnerGitPort }, intentOverride?: ReturnType<typeof readTaskIntent>): StartBatchInput {
	const intent = intentOverride ?? readTaskIntent(repo, TASK);
	const children: BatchPlanChild[] = [{ task_id: TASK, slice_id: TASK, blocked_by: [], status: "enrollable", reason: null,
		intent_path: intent.intent_ref.path, intent_revision: intent.intent_ref.revision,
		intent_content_hash: canonicalIntentHash(intent.intent), intent_authority_hash: intentAuthorityHash(intent.intent) }];
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


/** A started single-task batch whose Lane child waits on a literal-user decision. */
async function waitingLane(_executor_mode?: "interactive") {
	const { repo, base } = fixture();
	const k = kernel();
	const args = (intentOverride?: ReturnType<typeof readTaskIntent>) => ({ ...request(repo, base, { kernel: k, git: Object.assign(createDefaultBatchGitPort(), { lane: createDefaultLaneGitPort() }) }, intentOverride) });
	const first = laneReport(await startBatch(args()));
	const lane = first.children[0]!.lane!.path;
	return { repo, base, lane, args, first };
}

const waiting = () => projectionBody({ record_revision: "r1", next_obligation: "resolve_user_decision", open_user_decision_count: 1,
	authorization: { state: "resolve_user_decision", blocked: null } as never });
const advanced = () => projectionBody({ record_revision: "r2" });

function relayInput(repo: string, lane: string, over: Partial<Parameters<typeof relayLaneDecision<{ state: string }>>[0]> = {}) {
	// The Executor leaves gen.txt in the Lane; the Kernel record advances only after it ran.
	const project = async (path: string, taskId: string): Promise<AssuranceProjectionResult> => ({ contract: "assurance_kernel/assurance_projection/v1",
		task_id: taskId, error: null, claim: { task_id: taskId, lifecycle_status: "active" },
		projection: existsSync(join(lane, "gen.txt")) ? advanced() : applied.value ? advanced() : waiting() }) as AssuranceProjectionResult;
	const applied = { value: false, calls: 0 };
	const input = { root: repo, taskId: TASK, operation: "request_authorization" as LaneDecisionOperation, project,
		apply: async () => { applied.calls++; applied.value = true; return { state: "applied" }; },
		// S8: the relay resumes through the session-port owner, which the test
		// observes here by writing the next generation's marker itself.
		advance: async () => { writeFileSync(join(lane, "gen.txt"), lane); return { advanced: true }; },
		...over };
	return { input, applied };
}

describe("single-task Lane decision relay (S5)", () => {
	it("applies the gate in the Lane and resumes the next generation", async () => {
			const { repo, lane } = await waitingLane();
		const { input, applied } = relayInput(repo, lane);
		const outcome = await relayLaneDecision(input);
		expect(applied.calls).toBe(1);
		expect(outcome).toMatchObject({ relayed: true, lane_relay: { applied: true, operation: "request_authorization", rebound: false, lane_supervision: { advanced: true } } });
		expect(readFileSync(join(lane, "gen.txt"), "utf8").trim()).toBe(lane);
	});

	it.each(["request_authorization", "stop"] as const)("applies %s through the session-port relay without spawning a process", async operation => {
		const { repo, lane, args } = await waitingLane("interactive");
		const { input, applied } = relayInput(repo, lane, { operation });
		const outcome = await relayLaneDecision(input);
		expect(applied.calls).toBe(1);
		if (operation === "stop") {
			expect(outcome).toMatchObject({ relayed: true, lane_relay: { applied: true, operation, lane_supervision: null } });
			expect(existsSync(join(lane, "gen.txt"))).toBe(false);
			expect(existsSync(lane)).toBe(true);
			expect(readAnyBatchRunState(repo, BATCH_ID)).toMatchObject({ batch_state: "needs_human",
				children: [{ state: "needs_human", reason: "lane_executor_stopped" }] });
			expect(outcome).toMatchObject({ lane_relay: { next_action: expect.stringContaining("Close") } });
			const next = laneReport(await startBatch(args()));
			expect(next.children[0]!.reason).toBe("lane_executor_stopped");
		} else {
			expect(outcome).toMatchObject({ relayed: true, lane_relay: { applied: true, operation, lane_supervision: { advanced: true } } });
			expect(readFileSync(join(lane, "gen.txt"), "utf8").trim()).toBe(lane);
			expect(existsSync(lane)).toBe(true);
		}
	});

	it("records an approved stop for an already parked Lane", async () => {
		const { repo, lane } = await waitingLane("interactive");
		const record = readAnyBatchRunState(repo, BATCH_ID) as BatchLaneRunStateRecord;
		writeBatchLaneRunState(repo, { ...record, batch_state: "needs_human",
			children: record.children.map(child => ({ ...child, state: "needs_human", reason: "awaiting_user" })) });
		const { input } = relayInput(repo, lane, { operation: "stop" });
		const outcome = await relayLaneDecision(input);
		expect(outcome).toMatchObject({ relayed: true, lane_relay: { applied: true, lane_supervision: null,
			next_action: expect.stringContaining("Close") } });
		expect(readAnyBatchRunState(repo, BATCH_ID)).toMatchObject({ batch_state: "needs_human",
			children: [{ state: "needs_human", reason: "lane_executor_stopped" }] });
		expect(existsSync(lane)).toBe(true);
	});

	it("refuses a decision answered against a record revision that is no longer current", async () => {
			const { repo, lane } = await waitingLane();
		const { input, applied } = relayInput(repo, lane, { expectedRecordRevision: "r0" });
		await expect(relayLaneDecision(input)).rejects.toBeInstanceOf(LaneDecisionStaleError);
		expect(applied.calls).toBe(0);
		expect(existsSync(join(lane, "gen.txt"))).toBe(false);
	});

	it("refuses a decision for a Lane that waits on none", async () => {
			const { repo, lane } = await waitingLane();
		const { input, applied } = relayInput(repo, lane, { project: async (_p, taskId) => ({ contract: "assurance_kernel/assurance_projection/v1",
			task_id: taskId, error: null, claim: { task_id: taskId, lifecycle_status: "active" }, projection: projectionBody() }) as AssuranceProjectionResult });
		await expect(relayLaneDecision(input)).rejects.toBeInstanceOf(LaneDecisionStaleError);
		expect(applied.calls).toBe(0);
		expect(existsSync(join(lane, "gen.txt"))).toBe(false);
	});

	it.each([undefined, "interactive"] as const)("starts nothing when the user cancels the gate (mode=%s)", async mode => {
			const { repo, lane } = await waitingLane(mode);
		const before = readAnyBatchRunState(repo, BATCH_ID);
		const { input } = relayInput(repo, lane, { apply: async () => ({ state: "cancelled" }), applied: result => result.state === "applied" });
		const outcome = await relayLaneDecision(input);
		expect(outcome).toMatchObject({ relayed: true, lane_relay: { applied: false, lane_supervision: null } });
		expect(existsSync(join(lane, "gen.txt"))).toBe(false);
		expect(readAnyBatchRunState(repo, BATCH_ID)).toEqual(before);
	});

	it("reports a record that moved while the gate was open as stale, and keeps other gate errors", async () => {
			const { repo, lane } = await waitingLane();
		let moved = false;
		const project = async (_p: string, taskId: string): Promise<AssuranceProjectionResult> => ({ contract: "assurance_kernel/assurance_projection/v1",
			task_id: taskId, error: null, claim: { task_id: taskId, lifecycle_status: "active" },
			projection: moved ? projectionBody({ ...waiting(), record_revision: "r9" }) : waiting() }) as AssuranceProjectionResult;
		await expect(relayLaneDecision(relayInput(repo, lane, { project, apply: async () => { moved = true; throw new Error("gate failed"); } }).input))
			.rejects.toBeInstanceOf(LaneDecisionStaleError);
		moved = false;
		await expect(relayLaneDecision(relayInput(repo, lane, { project, apply: async () => { throw new Error("gate failed"); } }).input))
			.rejects.toThrow("gate failed");
		expect(existsSync(join(lane, "gen.txt"))).toBe(false);
	});

	it("leaves a task without a single-task Lane to the in-place path", async () => {
		const { repo } = fixture();
		const { input, applied } = relayInput(repo, repo);
		expect(await relayLaneDecision(input)).toEqual({ relayed: false });
		expect(applied.calls).toBe(0);
	});

	it("parks the child on a relayed stop, closes its session when one is bound, and retains its Lane", async () => {
		const { repo, lane } = await waitingLane();
		// A child with a live session handle: the relay closes exactly that session.
		const record = readAnyBatchRunState(repo, BATCH_ID) as BatchLaneRunStateRecord;
		writeBatchLaneRunState(repo, {
			...record,
			children: record.children.map((child) => ({
				...child,
				session: { key: "imm-drive-task-g1-aaaaaaaaaaaa", generation: 1, baseline: "r1",
					handle: "herdr:ws/relay-tab", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
			})),
		});
		const stops: string[] = [];
		const sessions = { stop: async (handle: string) => { stops.push(handle); return { ok: true as const }; } } as unknown as import("../plugins/immune-brain/runtime/unattended/batch_session_port").BatchSessionPort;
		const stopped = await relayLaneDecision(relayInput(repo, lane, { operation: "stop", sessions }).input);
		expect(stopped).toMatchObject({ relayed: true, lane_relay: { operation: "stop", applied: true, lane_supervision: null } });
		expect(stops).toEqual(["herdr:ws/relay-tab"]);
		expect(readAnyBatchRunState(repo, BATCH_ID)).toMatchObject({ batch_state: "needs_human",
			children: [{ state: "needs_human", reason: "lane_executor_stopped" }] });
		expect(existsSync(lane)).toBe(true);
	});

	it("rebinds the batch's approved identity once a breaking revision is committed in the Lane", async () => {
		const { repo, lane, args } = await waitingLane();
		writeFileSync(join(lane, `docs/plans/${TASK}.intent.json`), intentJson(2, "A1 holds, revised"));
		const revised = readTaskIntent(lane, TASK);
		const record = readAnyBatchRunState(repo, BATCH_ID) as BatchLaneRunStateRecord;
		expect(record.batch_id).toBe(BATCH_ID);
		const stateFile = join(repo, ".imm", "state", "batches", `${BATCH_ID}.json`);
		const digestBefore = record.plan_digest;

		rebindSingleTaskIdentity(repo, BATCH_ID, { task_id: TASK, intent: revised.intent, content_hash: revised.intent_ref.content_hash });
		const reboundBytes = readFileSync(stateFile, "utf8");
		const rebound = readAnyBatchRunState(repo, BATCH_ID) as BatchLaneRunStateRecord;
		const expectedDigest = computeBatchPlanDigest(rebound.children.map((c) => ({
			task_id: c.task_id,
			intent_path: rebound.intent_identities![c.task_id]!.intent_path,
			intent_revision: revised.intent.revision,
			intent_content_hash: revised.intent_ref.content_hash,
			intent_authority_hash: intentAuthorityHash(revised.intent),
			blocked_by: c.blocked_by,
		})));
		expect(rebound.plan_digest).toBe(expectedDigest);
		expect(rebound.plan_digest).not.toBe(digestBefore);
		expect(rebound.lane_rebinds).toHaveLength(1);
		expect(rebound.lane_rebinds?.[0]).toMatchObject({
			task_id: TASK,
			from_revision: 1,
			to_revision: 2,
			from_digest: digestBefore,
			to_digest: expectedDigest,
			intent_content_hash: revised.intent_ref.content_hash,
			risk: revised.intent.risk,
		});

		// Replaying the committed identity leaves record bytes unchanged and adds no second entry.
		rebindSingleTaskIdentity(repo, BATCH_ID, { task_id: TASK, intent: revised.intent, content_hash: revised.intent_ref.content_hash });
		expect(readFileSync(stateFile, "utf8")).toBe(reboundBytes);
		expect((readAnyBatchRunState(repo, BATCH_ID) as BatchLaneRunStateRecord).lane_rebinds).toHaveLength(1);

		// An older revision is stale and leaves record bytes unchanged.
		const older = readTaskIntent(repo, TASK);
		expect(() => rebindSingleTaskIdentity(repo, BATCH_ID, { task_id: TASK, intent: older.intent, content_hash: older.intent_ref.content_hash })).toThrow("lane_decision_stale");
		expect(readFileSync(stateFile, "utf8")).toBe(reboundBytes);

		const next = laneReport(await startBatch(args(revised)));
		expect(next.reason ?? "").not.toContain("batch_child_authority_changed");
		expect(next.batch_state).not.toBe("needs_human");
		expect(next.lane_rebinds?.[0]?.to_revision).toBe(2);

		// A record whose plan_digest no longer matches its own identities fails closed without writing.
		const tamperedDigest = `sha256:${"a".repeat(64)}`;
		const tampered = { ...rebound, plan_digest: tamperedDigest, lane_rebinds: undefined };
		writeFileSync(stateFile, `${JSON.stringify(tampered, null, 2)}\n`);
		const tamperedBytes = readFileSync(stateFile, "utf8");
		writeFileSync(join(lane, `docs/plans/${TASK}.intent.json`), intentJson(3, "A1 holds, v3"));
		const v3 = readTaskIntent(lane, TASK);
		expect(() => rebindSingleTaskIdentity(repo, BATCH_ID, { task_id: TASK, intent: v3.intent, content_hash: v3.intent_ref.content_hash })).toThrow("lane_decision_rebind_failed");
		expect(readFileSync(stateFile, "utf8")).toBe(tamperedBytes);
	});

	it("validates lane_rebinds invariants when reading batch run state", async () => {
		const { repo, lane } = await waitingLane();
		const stateFile = join(repo, ".imm", "state", "batches", `${BATCH_ID}.json`);
		writeFileSync(join(lane, `docs/plans/${TASK}.intent.json`), intentJson(2, "A1 holds, revised"));
		const revised = readTaskIntent(lane, TASK);
		const rebound = rebindSingleTaskIdentity(repo, BATCH_ID, { task_id: TASK, intent: revised.intent, content_hash: revised.intent_ref.content_hash });
		expect(readAnyBatchRunState(repo, BATCH_ID)).toEqual(rebound);
		const validEntry = rebound.lane_rebinds![0]!;

		// Last entry's to_digest differs from plan_digest.
		writeFileSync(stateFile, `${JSON.stringify({ ...rebound, lane_rebinds: [{ ...validEntry, to_digest: `sha256:${"b".repeat(64)}` }] }, null, 2)}\n`);
		expect(() => readAnyBatchRunState(repo, BATCH_ID)).toThrow();

		// S3 generalizes lane_rebinds to any child: an Initiative record without plan_source still carries them.
		writeFileSync(stateFile, `${JSON.stringify({ ...rebound, plan_source: undefined, lane_rebinds: [validEntry] }, null, 2)}\n`);
		expect(() => readAnyBatchRunState(repo, BATCH_ID)).not.toThrow();

		// Entry whose to_revision is not greater than from_revision.
		writeFileSync(stateFile, `${JSON.stringify({ ...rebound, lane_rebinds: [{ ...validEntry, from_revision: 2, to_revision: 2 }] }, null, 2)}\n`);
		expect(() => readAnyBatchRunState(repo, BATCH_ID)).toThrow();

		// Entry whose risk is not routine, material or critical.
		writeFileSync(stateFile, `${JSON.stringify({ ...rebound, lane_rebinds: [{ ...validEntry, risk: "extreme" }] }, null, 2)}\n`);
		expect(() => readAnyBatchRunState(repo, BATCH_ID)).toThrow();

		// Last entry for a task disagrees with intent_identities.
		writeFileSync(stateFile, `${JSON.stringify({ ...rebound, lane_rebinds: [{ ...validEntry, from_revision: 2, to_revision: 3 }] }, null, 2)}\n`);
		expect(() => readAnyBatchRunState(repo, BATCH_ID)).toThrow();
	});

	it("derives the waiting facts only from the Kernel projection", () => {
		expect(laneDecisionFacts(TASK, projectionBody())).toBeNull();
		expect(laneDecisionFacts(TASK, projectionBody({ lifecycle: "done" }))).toBeNull();
		expect(laneDecisionFacts(TASK, waiting())).toMatchObject({ task_id: TASK, record_revision: "r1", open_user_decision_count: 1 });
	});

	it("counts a headless Executor's revision request only while it binds the current record (#426 F19)", () => {
		const lane = realpathSync(mkdtempSync(join(tmpdir(), "imm-lane-request-")));
		roots.push(lane);
		const next_intent = JSON.parse(intentJson(2, "A1 holds, revised"));
		writeLaneDecisionRequest(lane, { task_id: TASK, operation: "approve_breaking_intent_revision", record_revision: "r1", next_intent, requested_at: CONFIRMED_AT });
		expect(laneDecisionFacts(TASK, projectionBody({ record_revision: "r1" }))).toBeNull();
		expect(laneDecisionFacts(TASK, projectionBody({ record_revision: "r1" }), lane)).toMatchObject({ record_revision: "r1",
			requested: { operation: "approve_breaking_intent_revision", next_intent: { revision: 2 } } });
		expect(laneDecisionFacts(TASK, projectionBody({ record_revision: "r2" }), lane)).toBeNull();
		expect(laneDecisionFacts("other-task", projectionBody({ record_revision: "r1" }), lane)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Host seam (DAL-S5-A1, DAL-S5-A2): the same Lane decisions entered through the
// Claude Code MCP runtime and the Pi canary tool, each with a counting native
// gate stub and a real Kernel in the Parent checkout and in the Lane.
// ---------------------------------------------------------------------------

const HOST_ENV = { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" };
const PI_SESSION = { getSessionId: () => "s5-lane-decision-relay" };
const FINAL_VERIFICATION = ["bun test", "bun run typecheck"];
const DECISION_ID = "user-decision-1";

interface Relayed { error?: string; lane_relay?: { operation: string; applied: boolean; rebound: boolean; lane_supervision: { state?: string; generation?: number } | null }; raw?: any }
interface HostHarness {
	/** Every native gate the Host opened, start gate included. */
	gates: Array<{ text: string }>;
	/** What the next native gate answers: accept when true, decline otherwise. */
	answer: { approve: boolean };
	start(args?: Record<string, unknown>): Promise<any>;
	stop(): Promise<any>;
	stopBatch(): Promise<void>;
	relay(op: "request_authorization" | "approve_breaking_intent_revision" | "stop", extra?: { record_revision?: string; next_intent?: unknown }): Promise<Relayed>;
}

/** A repository whose Lane is opened through the S5 port path with an injected
 * fake session port: no real Herdr tab opens, no supervisor script runs. The
 * first generation leaves no findings behind; the test seeds the waiting
 * decision or replan finding directly, exactly like an interactive TUI run. */
function hostFixture(risk = "material") {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "imm-lane-host-")));
	roots.push(root);
	copyGitTemplate(root);
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	writeFileSync(join(root, `docs/plans/${TASK}.intent.json`), intentJson(1, "A1 holds", risk));
	git(root, "add", "docs");
	git(root, "commit", "-qm", "task intent");
	const bin = realpathSync(mkdtempSync(join(tmpdir(), "imm-lane-host-bin-")));
	roots.push(bin);
	const store = join(import.meta.dir, "../plugins/immune-brain/runtime/kernel/sqlite_store");
	writeFileSync(join(bin, "seed.ts"), [
		`import { readRunRowByTask, updateRunRecord, withKernelRead, withKernelTransaction } from ${JSON.stringify(store)};`,
		`const [root, taskId, kind] = process.argv.slice(2);`,
		`const run = withKernelRead(root, db => readRunRowByTask(db, taskId));`,
		`const record = JSON.parse(run.record_json);`,
		`record.findings.push(kind === "replan_required"`,
		`	? { id: ${JSON.stringify(DECISION_ID)}, kind, status: "open", acceptance_id: null, source: "kernel", review_round: 3, summary: "Review rework limit reached" }`,
		`	: { id: ${JSON.stringify(DECISION_ID)}, kind, status: "open", acceptance_id: null, source: "execution", review_round: 1, summary: "awaiting literal user" });`,
		`withKernelTransaction(root, db => updateRunRecord(db, run.run_id, run.revision, JSON.stringify(record, null, 2) + "\\n", new Date().toISOString()));`,
	].join("\n"));
	// One shared fake session port per fixture: the Host opens exactly one
	// session for the single child and resumes it afterwards (never a second).
	const port: any = memoryLanePort();
	const stops: string[] = [];
	const creates: unknown[] = [];
	const resumes: unknown[] = [];
	const origCreate = port.createSession.bind(port);
	port.createSession = async (input: unknown) => { ((input as any)?.resume ? resumes : creates).push(input); const opened: any = await origCreate(input as never); port.states.set(opened.handle, "idle"); return opened; };
	const origStop = port.stopSession.bind(port);
	port.stopSession = async (handle: string) => { stops.push(handle); return origStop(handle); };
	return { root, stops, creates, resumes,
		factory: () => port,
		/** What one interactive TUI run leaves in the Lane. */
		seed: (kind: "unresolved_user_decision" | "replan_required", lane: string) =>
			execFileSync(process.execPath, [join(bin, "seed.ts"), lane, TASK, kind], { stdio: "ignore" }) };
}

function claudeHarness(root: string, factory: () => unknown): HostHarness {
	const gates: HostHarness["gates"] = [];
	const answer = { approve: true };
	const entry = realpathSync(mkdtempSync(join(tmpdir(), "imm-phase-entry-")));
	roots.push(entry);
	const session = { session_id: "s5-host-session", cwd: root };
	recordPhaseEntryPrompt({ hook_event_name: "UserPromptSubmit", prompt: "/drive", ...session }, { root: entry, home: entry });
	const runtime = createMcpRuntime({
		consumePhaseAdmission(toolCallId: string, operation: GatedTool) {
			phaseEntryGateHookOutput({ hook_event_name: "PreToolUse", tool_name: `mcp__plugin_immune-brain_immune-brain__${operation}`, tool_use_id: toolCallId, ...session }, { root: entry });
			return consumePhaseAdmission(toolCallId, operation, entry);
		},
		cwd: root, env: { ...HOST_ENV, ...memoryLanePortEnv }, interactive: true,
		sessionPortFactory: factory,
		requestConfirmation: async input => { gates.push({ text: elicitationParams(input).message }); return { decision: answer.approve ? "accept" : "decline", requestId: `native-${gates.length}` }; },
	});
	runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
	let calls = 0;
	const tool = (name: string, args: Record<string, unknown>) => runtime.callTool(name, args, { toolCallId: `s5-${name}-${++calls}` });
	return {
		gates, answer,
		start: (args = { agents: { executor: "claude-code" }, final_verification: FINAL_VERIFICATION }) => tool("start_unattended_batch", { task_id: TASK, ...args }),
		stop: () => tool("start_unattended_batch", { task_id: TASK, stop: true, final_verification: FINAL_VERIFICATION }),
		stopBatch: async () => { await tool("start_unattended_batch", { task_id: TASK, stop: true, final_verification: FINAL_VERIFICATION }).catch(() => undefined); },
		relay: async (op, extra = {}) => {
			try { const raw = await tool(op, { task_id: TASK, ...extra }); return { raw, lane_relay: raw.lane_relay }; }
			catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
		},
	};
}

function piHarness(root: string, factory: () => unknown): HostHarness {
	const gates: HostHarness["gates"] = [];
	const answer = { approve: true };
	const tools: any[] = [];
	registerPiWork({ registerTool: (tool: unknown) => tools.push(tool), registerCommand() {}, on() {}, events: { on() {}, emit() {} } } as never);
	const work = tools.find(tool => tool.name === "imm_kernel_canary");
	recordPiPhaseInput({ text: "/skill:drive", source: "interactive" }, { cwd: root, sessionManager: PI_SESSION });
	const ctx = { mode: "tui", cwd: root, signal: new AbortController().signal, sessionManager: PI_SESSION, ui: {
		notify() {},
		custom: async (factory: any) => {
			let selected: string | undefined;
			const component = factory({ requestRender() {} }, { fg: (_color: string, text: string) => text, bold: (text: string) => text }, {}, (result: string | undefined) => { selected = result; });
			component.handleInput?.("d");
			gates.push({ text: component.render(120).join("\n") });
			if (!answer.approve) component.handleInput?.("\u001b[B");
			component.handleInput?.("\r");
			return selected;
		},
	} };
	return {
		gates, answer,
		start: () => executePiUnattendedBatch({ root, taskId: TASK, executor: { executor_host: "pi" }, confirmBatch: async details => { gates.push({ text: details.summary }); return answer.approve ? "accept" : "cancel"; }, sessionPortFactory: factory, env: { ...memoryLanePortEnv } }),
		stop: () => executePiUnattendedBatch({ root, taskId: TASK, stop: true, sessionPortFactory: factory, env: { ...memoryLanePortEnv } }),
		stopBatch: async () => { await executePiUnattendedBatch({ root, taskId: TASK, stop: true, sessionPortFactory: factory, env: { ...memoryLanePortEnv } }).catch(() => undefined); },
		relay: async (op, extra = {}) => {
			try {
				const result = await work.execute(`s5-${op}`, { task_id: TASK, action: { op: op === "stop" ? "request_stop" : op, ...extra } }, undefined, undefined, ctx);
				const raw = JSON.parse(result.content.map((item: any) => item.text).join("\n"));
				return { raw, lane_relay: raw.lane_relay };
			} catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
		},
	};
}

const decisionStatus = (lane: string) => readTaskRecordRaw(lane, TASK).record?.findings.find(finding => finding.id === DECISION_ID)?.status;

/** The Lane projection revision the relay treats as the decision baseline. */
async function laneRevision(lanePath: string, taskId: string): Promise<string> {
	const projected = await projectAssurance(lanePath, taskId);
	if (projected.error !== null) throw new Error(`no Lane projection for ${taskId} in ${lanePath}: ${projected.error}`);
	return projected.projection.record_revision;
}

for (const host of ["claude", "pi"] as const) describe(`single-task Lane decision relay through the ${host} Host (S5)`, () => {
	/** Both Hosts drive the same S5 port path with an injected fake session
	 * port: the retired transitional distinction (a supervised claude-code
	 * Executor versus a refused Pi Executor outside Herdr, #426 D4/D5) no
	 * longer exists now that every entry opens a Herdr-shaped session. The
	 * per-child S7 cases below cover Pi and Claude identically. */

	async function waitingHostLane(kind: "unresolved_user_decision" | "replan_required" = "unresolved_user_decision") {
		const f = hostFixture();
		const h = host === "claude" ? claudeHarness(f.root, f.factory) : piHarness(f.root, f.factory);
		if (host === "pi") {
			// The pi relay tools run on the extension's process-global relay
			// runtime, which is constructed without a session factory hook.
			// Point that instance at this fixture's fake port and hermetic
			// env per test: no real Herdr tab may open, and the fake env
			// keeps provider resolution independent of ambient credentials.
			const shared = await getSharedPiProgression();
			(shared as any).runtime.sessionPortFactory = f.factory;
			(shared as any).runtime.env = { ...memoryLanePortEnv };
		}
		let started = await h.start();
		if (started.state !== "started") throw new Error(`start refused: ${JSON.stringify(started)}`);
		const target = findLaneRelayTarget(f.root, TASK)!;
		// What one interactive TUI run leaves behind: seed, then re-enter so the
		// batch observes the waiting decision and keeps the child running.
		f.seed(kind, target.lane_path);
		started = await h.start();
		if (started.state !== "started") throw new Error(`re-entry refused: ${JSON.stringify(started)}`);
		expect(decisionStatus(target.lane_path)).toBe("open");
		expect(started.report.batch_state).toBe("running");
		const startGates = h.gates.length;
		return { f, h, started, target };
	}

	it("reports the waiting Lane, then one native gate applies the decision in the Lane", async () => {
		const { f, h, target } = await waitingHostLane();
		try {
			// Read the facts before matching: the Lane record, not a report
		// object, carries the values used below.
			const revision: string = await laneRevision(target.lane_path, TASK);
			expect(typeof revision).toBe("string");
			expect(decisionStatus(target.lane_path)).toBe("open");
			expect(f.creates.length).toBe(1);
			const opened = h.gates.length;
			const relayed = await h.relay("request_authorization", { record_revision: revision });
			expect(relayed.error).toBeUndefined();
			expect(h.gates.length - opened).toBe(1);
			expect(h.gates.at(-1)!.text).toContain(TASK);
			expect(relayed.lane_relay).toMatchObject({ operation: "request_authorization", applied: true, rebound: false });
			// Port-based resume reuses the one session: one open plus one
			// resume, the answered decision resets no_progress and updates
			// the baseline.
			expect(f.creates.length).toBe(1);
			expect(f.resumes.length).toBe(1);
			const record = readAnyBatchRunState(f.root, target.batch_id) as BatchLaneRunStateRecord;
			expect(record.children.find(child => child.task_id === TASK)?.session).toMatchObject({ generation: 1, no_progress: 0 });
			expect(record.children.find(child => child.task_id === TASK)?.session?.baseline).toBe(await laneRevision(target.lane_path, TASK));
			expect(decisionStatus(target.lane_path)).toBe("resolved");
			// The Parent enrolls nothing itself: it has no TaskRecord.
			expect(readTaskRecordRaw(f.root, TASK).record).toBeFalsy();
		} finally { await h.stopBatch(); }
	}, 40000);

	it("refuses a stale record revision before any gate and applies nothing on a cancelled gate", async () => {
		const { f, h, target } = await waitingHostLane();
		try {
			const opened = h.gates.length;
			const stale = await h.relay("request_authorization", { record_revision: "sha256:not-the-current-revision" });
			expect(stale.error ?? JSON.stringify(stale.raw)).toContain(batchReason("lane_decision_stale").reason);
			expect(h.gates.length).toBe(opened);
			expect(f.creates.length).toBe(1);
			h.answer.approve = false;
			const cancelled = await h.relay("request_authorization");
			expect(h.gates.length - opened).toBe(1);
			expect(cancelled.lane_relay?.applied ?? false).toBe(false);
			expect(decisionStatus(target.lane_path)).toBe("open");
			expect(f.creates.length).toBe(1);
		} finally { await h.stopBatch(); }
	}, 40000);

	it("relays a breaking revision through one gate, rebinds the batch identity and does not refuse plan_changed afterwards", async () => {
		const { f, h, target } = await waitingHostLane("replan_required");
		try {
			// Both Hosts drive the same port path: the transitional Pi-only
			// `lane_executor_requires_tui` refusal is retired by S5 unified
			// sessions, so there is no Pi-only early return anymore.
			const revision: string = await laneRevision(target.lane_path, TASK);
			const revised = JSON.parse(intentJson(2, "A1 holds after the breaking revision"));
			const before = readAnyBatchRunState(f.root, target.batch_id) as BatchLaneRunStateRecord;
			const opened = h.gates.length;
			const relayed = await h.relay("approve_breaking_intent_revision", { record_revision: revision, next_intent: revised });
			expect(relayed.error).toBeUndefined();
			expect(h.gates.length - opened).toBe(1);
			expect(relayed.lane_relay).toMatchObject({ operation: "approve_breaking_intent_revision", applied: true, rebound: true });
			// Port-based resume reuses the one session instead of starting a
			// second supervised generation.
			expect(f.creates.length).toBe(1);
			const lane = readTaskRecordRaw(target.lane_path, TASK).record!;
			expect(lane.intent_snapshot.revision).toBe(2);
			const after = readAnyBatchRunState(f.root, target.batch_id) as BatchLaneRunStateRecord;
			expect(after.intent_identities?.[TASK]?.intent_content_hash).toBe(lane.intent_ref.content_hash);
			expect(after.intent_identities?.[TASK]?.intent_revision).toBe(2);
			expect(after.intent_identities?.[TASK]?.intent_content_hash).not.toBe(before.intent_identities?.[TASK]?.intent_content_hash);
			expect(after.plan_digest).not.toBe(before.plan_digest);
			const next = await h.start();
			expect(next.report.reason).not.toBe(batchReason("plan_changed").reason);
			expect(JSON.stringify(next)).not.toContain("plan_changed");
			expect(next.report.batch_state).toBe("running");
			expect(f.creates.length).toBe(1);
		} finally { await h.stopBatch(); }
	}, 40000);

	it("resumes a parked single-task Lane after an approved breaking revision without plan_changed or extra gates", async () => {
		const control = await waitingHostLane("unresolved_user_decision");
		let controlGates = 0;
		try {
			expect((await control.h.relay("request_authorization")).error).toBeUndefined();
			parkLaneForExecutor(control.f.root, control.target.batch_id, TASK, "lane_executor_no_progress");
			const gatesBefore = control.h.gates.length;
			const controlResume = await control.h.start();
			controlGates = control.h.gates.length - gatesBefore;
			expect(controlResume.report.batch_state).toBe("running");
		} finally { await control.h.stopBatch(); }

		const { f, h, target } = await waitingHostLane("replan_required");
		try {
			const revision: string = await laneRevision(target.lane_path, TASK);
			const revised = JSON.parse(intentJson(2, "A1 holds after the breaking revision"));
			const relayed = await h.relay("approve_breaking_intent_revision", { record_revision: revision, next_intent: revised });
			expect(relayed.error).toBeUndefined();
			parkLaneForExecutor(f.root, target.batch_id, TASK, "lane_executor_no_progress");
			const gatesBefore = h.gates.length;
			const resumed = await h.start();
			expect(JSON.stringify(resumed)).not.toContain("plan_changed");
			expect(resumed.report.batch_state).toBe("running");
			expect(resumed.report.reason).not.toBe(batchReason("plan_changed").reason);
			expect(h.gates.length - gatesBefore).toBe(controlGates);
			expect(resumed.report.lane_rebinds?.[0]?.to_revision).toBe(2);
			expect(readTaskIntent(f.root, TASK).intent.revision).toBe(1);
		} finally { await h.stopBatch(); }
	}, 40000);

	it("a rejected port.stop leaves the child enrolled instead of parking it stopped", async () => {
		const { f, h, target } = await waitingHostLane();
		try {
			expect((await h.relay("request_authorization")).error).toBeUndefined();
			const port = f.factory();
			const handle = (readAnyBatchRunState(f.root, target.batch_id) as BatchLaneRunStateRecord).children.find(child => child.task_id === TASK)?.session?.handle!;
			port.stopSession = async () => ({ ok: false as const, code: "provider_error" as const, reason: "herdr pane stop failed: busy" });
			const stopped = await h.relay("stop");
			expect(stopped.error).toBeUndefined();
			expect(stopped.lane_relay?.next_action).toContain("lane_stop_rejected");
			expect(stopped.lane_relay?.next_action).toContain("busy");
			const record = readAnyBatchRunState(f.root, target.batch_id) as BatchLaneRunStateRecord;
			const child = record.children.find(entry => entry.task_id === TASK)!;
			expect(child.state).toBe("enrolled");
			expect(child.reason).toBeNull();
			// The next reconcile observes the still-running session in place
			// instead of opening another one.
			const reconciled = await reconcileChildSession({
				port: new SessionPortAdapter(port, "claude-code", []), batchId: target.batch_id, taskId: TASK,
				session: child.session!, kernel: { recordRevision: child.session!.baseline ?? "r", settled: false, hasOpenDecision: false, hasReplan: false },
				interactionMode: "interactive_host", entry: `drive ${TASK}`, laneCwd: target.lane_path,
			});
			expect(["held", "stalled_idle"]).toContain(reconciled.action);
			expect(reconciled.session.handle).toBe(handle);
			expect(reconciled.session.generation).toBe(child.session!.generation);
			expect(existsSync(target.lane_path)).toBe(true);
		} finally { await h.stopBatch(); }
	}, 40000);

	it("a rejected start_unattended_batch stop leaves the child enrolled", async () => {
		const { f, h, target } = await waitingHostLane();
		try {
			const port = f.factory();
			port.stopSession = async () => ({ ok: false as const, code: "provider_error" as const, reason: "herdr pane stop failed: busy" });
			const stopped = await h.stop();
			expect(stopped.state ?? stopped.raw?.state).toBe("blocked");
			expect(JSON.stringify(stopped)).toContain("lane_stop_rejected");
			expect(JSON.stringify(stopped)).toContain("busy");
			const record = readAnyBatchRunState(f.root, target.batch_id) as BatchLaneRunStateRecord;
			expect(record.children.find(child => child.task_id === TASK)?.state).toBe("enrolled");
			expect(record.children.find(child => child.task_id === TASK)?.reason ?? null).toBeNull();
			expect(existsSync(target.lane_path)).toBe(true);
		} finally { await h.stopBatch(); }
	}, 40000);

	it("opens the stop gate once, applies it only when accepted, and keeps the Lane", async () => {
		const { f, h, target } = await waitingHostLane();
		try {
			expect((await h.relay("request_authorization")).error).toBeUndefined();
			expect(f.creates.length).toBe(1);
			h.answer.approve = false;
			const opened = h.gates.length;
			const cancelled = await h.relay("stop");
			expect(h.gates.length - opened).toBe(1);
			expect(cancelled.lane_relay?.applied ?? false).toBe(false);
			expect(readTaskRecordRaw(target.lane_path, TASK).record?.lifecycle).toBe("active");
			expect(f.stops).toEqual([]);
			h.answer.approve = true;
			const attached = await h.start();
			expect(attached.report.batch_state).toBe("running");
			expect(f.creates.length).toBe(1);
			const beforeStop = h.gates.length;
			const stopped = await h.relay("stop");
			expect(stopped.error).toBeUndefined();
			expect(h.gates.length - beforeStop).toBe(1);
			expect(stopped.lane_relay).toMatchObject({ operation: "stop", applied: true });
			// The native-gated stop closes only this child's session through
			// the port, parks it, and retains the Lane.
			const handle = (readAnyBatchRunState(f.root, target.batch_id) as BatchLaneRunStateRecord).children.find(child => child.task_id === TASK)?.session?.handle;
			expect(f.stops).toEqual([handle]);
			expect(readAnyBatchRunState(f.root, target.batch_id)).toMatchObject({ batch_state: "needs_human",
				children: [{ task_id: TASK, state: "needs_human", reason: "lane_executor_stopped" }] });
			expect(readTaskTombstone(target.lane_path, TASK)).toMatchObject({ terminal_lifecycle: "stopped" });
			expect(existsSync(target.lane_path)).toBe(true);
		} finally { await h.stopBatch(); }
	}, 40000);
});

/**
 * #426 F19 on the S5 port path: the headless Lane Executor is a real Claude
 * Code MCP runtime rooted in the Lane (no supervisor script spawns it). It
 * asks for a breaking revision; a headless Host opens no native gate, so the
 * request is left for the Parent, whose gate commits it. Afterwards the batch
 * resumes in place through the injected fake port.
 */
function headlessLaneRuntime(lane: string, gates: { count: number }) {
	const entry = realpathSync(mkdtempSync(join(tmpdir(), "imm-f19-entry-")));
	roots.push(entry);
	const session = { session_id: "f19-executor", cwd: lane };
	recordPhaseEntryPrompt({ hook_event_name: "UserPromptSubmit", prompt: "/drive", ...session }, { root: entry, home: entry });
	const runtime = createMcpRuntime({
		consumePhaseAdmission(toolCallId: string, operation: GatedTool) {
			phaseEntryGateHookOutput({ hook_event_name: "PreToolUse", tool_name: `mcp__plugin_immune-brain_immune-brain__${operation}`, tool_use_id: toolCallId, ...session }, { root: entry });
			return consumePhaseAdmission(toolCallId, operation, entry);
		},
		cwd: lane, env: { ...HOST_ENV, [LANE_EXECUTOR_ENV]: LANE_EXECUTOR_HEADLESS }, interactive: true,
		requestConfirmation: async () => { gates.count += 1; return { decision: "decline", requestId: "headless" }; },
	});
	runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
	return runtime;
}

describe("a headless Lane Executor's breaking revision reaches the Parent's gate (#426 F19)", () => {
	it("records the request without a gate, one Parent gate commits it, and a resubmission finds it committed", async () => {
		const f = hostFixture();
		const h = claudeHarness(f.root, f.factory);
		const gates = { count: 0 };
		try {
			const started = await h.start();
			expect(started.state).toBe("started");
			const target = findLaneRelayTarget(f.root, TASK)!;
			const revised = JSON.parse(intentJson(2, "A1 holds after the breaking revision"));
			const headless = headlessLaneRuntime(target.lane_path, gates);
			const first = await headless.callTool("approve_breaking_intent_revision", { task_id: TASK, next_intent: revised }, { toolCallId: "f19-revision" });
			expect(first?.state).toBe("lane_decision_requested");
			expect(gates.count).toBe(0);
			expect(existsSync(laneDecisionRequestPath(target.lane_path))).toBe(true);
			expect(readLaneDecisionRequest(target.lane_path, TASK, await laneRevision(target.lane_path, TASK))).toMatchObject({ operation: "approve_breaking_intent_revision", next_intent: { revision: 2 } });
			expect(readTaskRecordRaw(target.lane_path, TASK).record!.intent_snapshot.revision).toBe(1);
			const opened = h.gates.length;
			const relayed = await h.relay("approve_breaking_intent_revision", { record_revision: await laneRevision(target.lane_path, TASK), next_intent: revised });
			expect(relayed.error).toBeUndefined();
			expect(h.gates.length - opened).toBe(1);
			expect(relayed.lane_relay).toMatchObject({ operation: "approve_breaking_intent_revision", applied: true, rebound: true });
			expect(readTaskRecordRaw(target.lane_path, TASK).record!.intent_snapshot.revision).toBe(2);
			expect(existsSync(laneDecisionRequestPath(target.lane_path))).toBe(false);
			// Leaving the request was progress: the batch resumes in place on
			// the same session with no_progress reset, no second session opens.
			expect(f.creates.length).toBe(1);
			const record = readAnyBatchRunState(f.root, target.batch_id) as BatchLaneRunStateRecord;
			expect(record.children.find(child => child.task_id === TASK)?.session).toMatchObject({ generation: 1, no_progress: 0 });
			// The next headless call that resubmits the committed revision is
			// told it is committed, with no gate.
			const resubmitted = await headless.callTool("approve_breaking_intent_revision", { task_id: TASK, next_intent: revised }, { toolCallId: "f19-resubmit" });
			expect(resubmitted?.state).toBe("intent_revision_committed");
			expect(gates.count).toBe(0);
		} finally { await h.stopBatch(); }
	}, 40000);
});

describe("per-child Lane decisions (S7)", () => {
	const CHILD_A = "child-1";
	const CHILD_B = "child-2";
	const SLUG = "initiative-s7";
	const BATCH = "s7-batch";

	function s7Fixture() {
		const { repo, base } = fixture();
		for (const taskId of [CHILD_A, CHILD_B]) {
			const parsed = JSON.parse(intentJson(1, `A1 holds ${taskId}`));
			parsed.task_id = taskId;
			parsed.goal = `Deliver ${taskId}`;
			writeFileSync(join(repo, `docs/plans/${taskId}.intent.json`), `${JSON.stringify(parsed, null, 2)}\n`);
		}
		git(repo, "add", "docs/plans");
		git(repo, "commit", "-qm", "s7 intents");
		const baseS7 = git(repo, "rev-parse", "HEAD");
		const a = readTaskIntent(repo, CHILD_A);
		const b = readTaskIntent(repo, CHILD_B);
		const kids: BatchPlanChild[] = [
			{ task_id: CHILD_A, slice_id: "A", blocked_by: [], status: "enrollable", reason: null, intent_path: a.intent_ref.path, intent_revision: a.intent_ref.revision, intent_content_hash: canonicalIntentHash(a.intent), intent_authority_hash: intentAuthorityHash(a.intent) },
			{ task_id: CHILD_B, slice_id: "B", blocked_by: [], status: "enrollable", reason: null, intent_path: b.intent_ref.path, intent_revision: b.intent_ref.revision, intent_content_hash: canonicalIntentHash(b.intent), intent_authority_hash: intentAuthorityHash(b.intent) },
		];
		const record = prepareBatchLaneRunState({ batch_id: BATCH, initiative_slug: SLUG, children: kids, plan_digest: computeBatchPlanDigest(kids), base_head: baseS7,
			confirmation_time: CONFIRMED_AT, budget: { max_children: 2, qa_failure_limit: 2 }, max_parallel: 2, now });
		const laneA = realpathSync(mkdtempSync(join(tmpdir(), "imm-s7-a-")));
		const laneB = realpathSync(mkdtempSync(join(tmpdir(), "imm-s7-b-")));
		roots.push(laneA, laneB);
		record.batch_state = "running";
		record.children = record.children.map(value => {
			const lanePath = value.task_id === CHILD_A ? laneA : laneB;
			return { ...value, state: "enrolled" as const, reason: null,
				lane: { path: lanePath, branch: `imm-lane/${SLUG}/${value.task_id}`, base_head: baseS7, lane_commit: null, run_id: `run-${value.task_id}` },
				session: { key: laneSessionKey(BATCH, value.task_id, 1), generation: 1, baseline: "r1", handle: `h-${value.task_id}`, entry_submitted: true, attention: null, no_progress: 1, exit_proof: null } };
		});
		writeBatchLaneRunState(repo, record);
		return { repo, base, laneA, laneB };
	}

	/** Two-child Initiative batch created through the real composition root:
	 * real worktrees and batch record, an injected fake session port, and a
	 * fake Kernel whose revisions and open decisions the test drives. */
	async function s7LanesFixture() {
		const { repo } = fixture();
		for (const taskId of [CHILD_A, CHILD_B]) {
			const parsed = JSON.parse(intentJson(1, `A1 holds ${taskId}`));
			parsed.task_id = taskId;
			parsed.goal = `Deliver ${taskId}`;
			writeFileSync(join(repo, `docs/plans/${taskId}.intent.json`), `${JSON.stringify(parsed, null, 2)}\n`);
		}
		git(repo, "add", "docs/plans");
		git(repo, "commit", "-qm", "s7 intents");
		const base = git(repo, "rev-parse", "HEAD");
		const port: any = memoryLanePort();
		const opens: unknown[] = [];
		const resumes: unknown[] = [];
		const origCreate = port.createSession.bind(port);
		port.createSession = async (input: unknown) => { ((input as any)?.resume ? resumes : opens).push(input); const opened: any = await origCreate(input as never); port.states.set(opened.handle, "idle"); return opened; };
		const revs = new Map([[CHILD_A, "r1"], [CHILD_B, "r1"]]);
		const open = new Map<string, boolean>();
		const runs = new Map([[CHILD_A, "run-a"], [CHILD_B, "run-b"]]);
		const enrolled = new Set<string>();
		const kernel = {
			enrolled,
			async enrollTask({ task_id }: { root: string; task_id: string }) { enrolled.add(task_id); return { record_revision: revs.get(task_id) ?? "r1" }; },
			async advanceTask(): Promise<never> { throw new Error("advanceTask must not run: the child never reaches run_qa in these tests"); },
			async projectTask(_root: string, taskId: string) {
				return { contract: "assurance_kernel/assurance_projection/v1", task_id: taskId, error: null,
					claim: enrolled.has(taskId) ? { task_id: taskId, lifecycle_status: "active" } : null,
					projection: projectionBody({ record_revision: revs.get(taskId) ?? "r1", run_id: runs.get(taskId) ?? `run-${taskId}`,
						open_user_decision_count: open.get(taskId) ? 1 : 0 }) };
			},
			ownsTaskClaim: (taskId: string) => enrolled.has(taskId),
			validateBatchAuthorization: ({ registry, capability, binding }: any) =>
				(registry as any).inspect(capability, { ...binding, branch: "main", actor_id: "user", confirmation_ref: "confirm", nonce: "n" }),
		} as unknown as BatchRunnerKernelPort;
		const a = readTaskIntent(repo, CHILD_A);
		const b = readTaskIntent(repo, CHILD_B);
		const kids: BatchPlanChild[] = [
			{ task_id: CHILD_A, slice_id: "A", blocked_by: [], status: "enrollable", reason: null, intent_path: a.intent_ref.path, intent_revision: a.intent_ref.revision, intent_content_hash: canonicalIntentHash(a.intent), intent_authority_hash: intentAuthorityHash(a.intent) },
			{ task_id: CHILD_B, slice_id: "B", blocked_by: [], status: "enrollable", reason: null, intent_path: b.intent_ref.path, intent_revision: b.intent_ref.revision, intent_content_hash: canonicalIntentHash(b.intent), intent_authority_hash: intentAuthorityHash(b.intent) },
		];
		const planDigest = computeBatchPlanDigest(kids);
		const registry = createBatchAuthorityRegistry();
		const agreement: BatchAgreement = { batch_id: BATCH, initiative_slug: SLUG, children: kids, plan_digest: planDigest, base_head: base,
			budget: { max_children: 2, qa_failure_limit: 2 }, confirmation: { source: "native_gate", ref: "native_gate:s7" },
			final_verification: { required: false, commands: [] }, return_policy: "retain_branch", interaction_mode: "interactive_host" };
		const capability = registry.issue({ batch_id: BATCH, initiative_slug: SLUG, plan_digest: planDigest, branch: "main", base_head: base,
			budget: { max_children: 2, qa_failure_limit: 2 }, actor_id: "user", confirmation_ref: "confirm", nonce: "n" }, kids as never, CONFIRMED_AT);
		const deps = { root: repo, registry, capability, kernel, providers: ["herdr"], host: "claude-code" as const, env: { ...memoryLanePortEnv },
			createPort: () => port, hostArgs: [] as string[], now: CONFIRMED_AT, confirmation_time: CONFIRMED_AT };
		const report = await startLanes(agreement, deps as never) as unknown as { batch_state: string };
		expect(report.batch_state).toBe("running");
		return { repo, base, port, opens, resumes, revs, open, runs, registry, deps };
	}

	/** The fake Kernel revision the relay treats as the decision baseline. */
	async function laneProjectRevision(fx: { revs: Map<string, string> }, taskId: string): Promise<string> {
		return fx.revs.get(taskId) ?? "r1";
	}

	it("findActiveLaneBatchForTask locates Child 2; unknown returns null; ambiguous fails closed", async () => {
		const { repo } = s7Fixture();
		const found = findActiveLaneBatchForTask(repo, CHILD_B)!;
		expect(found.record.batch_id).toBe(BATCH);
		expect(found.child.task_id).toBe(CHILD_B);
		expect(findLaneRelayTarget(repo, CHILD_B)).toMatchObject({ batch_id: BATCH, task_id: CHILD_B });
		expect(findActiveLaneBatchForTask(repo, "unknown-task")).toBeNull();
		expect(findLaneRelayTarget(repo, "unknown-task")).toBeNull();
		const { input } = relayInput(repo, repo, { taskId: "unknown-task" });
		expect(await relayLaneDecision(input)).toEqual({ relayed: false });
		// Two active batches claiming the same child fail closed.
		const dupLane = realpathSync(mkdtempSync(join(tmpdir(), "imm-s7-dup-")));
		roots.push(dupLane);
		const dupKids = [{ task_id: CHILD_B, slice_id: "B", blocked_by: [], status: "enrollable", reason: null,
			intent_path: `docs/plans/${CHILD_B}.intent.json`, intent_revision: 1, intent_content_hash: canonicalIntentHash(readTaskIntent(repo, CHILD_B).intent) } as unknown as BatchPlanChild];
		const second = prepareBatchLaneRunState({ batch_id: "s7-dup", initiative_slug: "other-slug", children: dupKids,
			plan_digest: computeBatchPlanDigest(dupKids), base_head: git(repo, "rev-parse", "HEAD"), confirmation_time: CONFIRMED_AT, budget: { max_children: 1, qa_failure_limit: 2 }, max_parallel: 1, now });
		second.batch_state = "running";
		second.children = second.children.map(c => ({ ...c, state: "enrolled" as const, reason: null,
			lane: { path: dupLane, branch: `imm-lane/other-slug/${CHILD_B}`, base_head: git(repo, "rev-parse", "HEAD"), lane_commit: null, run_id: "run-dup" },
			session: { key: laneSessionKey("s7-dup", CHILD_B, 1), generation: 1, baseline: "r1", handle: "h-dup", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null } }));
		writeBatchLaneRunState(repo, second as unknown as BatchLaneRunStateRecord);
		expect(() => findActiveLaneBatchForTask(repo, CHILD_B)).toThrow("batch_lane_ambiguous");
		expect(() => findLaneRelayTarget(repo, CHILD_B)).toThrow("batch_lane_ambiguous");
	});

	it("relaying a literal-user decision resumes Child 2 through the real advanceLanes path while Child 1 is untouched", async () => {
		const fx = await s7LanesFixture();
		// Seed a waiting literal-user decision on Child 2 at the enrolled revision.
		fx.open.set(CHILD_B, true);
		const target = findLaneRelayTarget(fx.repo, CHILD_B)!;
		expect(target).toMatchObject({ batch_id: BATCH, task_id: CHILD_B });
		expect(target.lane_path).toBeTruthy();
		const revision = await laneProjectRevision(fx, CHILD_B);
		const child1Before = readAnyBatchRunState(fx.repo, BATCH) as BatchLaneRunStateRecord;
		const child1SessionBefore = JSON.stringify(child1Before.children.find(child => child.task_id === CHILD_A)?.session);
		const advanceCalls: string[] = [];
		const project = async (_lanePath: string, taskId: string): Promise<AssuranceProjectionResult> => ({
			contract: "assurance_kernel/assurance_projection/v1", task_id: taskId, error: null,
			claim: { task_id: taskId, lifecycle_status: "active" },
			projection: projectionBody({ record_revision: fx.revs.get(taskId) ?? "r1", run_id: fx.runs.get(taskId) ?? `run-${taskId}`,
				open_user_decision_count: fx.open.get(taskId) ? 1 : 0 }),
		}) as AssuranceProjectionResult;
		const applied: Array<{ taskId: string }> = [];
		const outcome = await relayLaneDecision({
			root: fx.repo, taskId: CHILD_B, operation: "request_authorization", expectedRecordRevision: revision,
			project,
			apply: async () => { applied.push({ taskId: CHILD_B }); fx.open.set(CHILD_B, false); fx.revs.set(CHILD_B, "r2"); return { state: "applied" }; },
			advance: async (batchId: string) => { advanceCalls.push(batchId); return advanceLanes(fx.repo, batchId, fx.deps as never); },
		});
		expect(applied).toHaveLength(1);
		expect(outcome).toMatchObject({ relayed: true, lane_relay: { batch_id: BATCH, applied: true, rebound: false } });
		expect(advanceCalls).toEqual([BATCH]);
		// The real reconciler resumed Child 2 in place: same generation, same
		// handle, baseline advanced to the committed revision, no_progress reset.
		const after = readAnyBatchRunState(fx.repo, BATCH) as BatchLaneRunStateRecord;
		const child2 = after.children.find(child => child.task_id === CHILD_B)!;
		expect(child2.state).toBe("enrolled");
		expect(child2.session).toMatchObject({ generation: 1, no_progress: 0 });
		expect(child2.session?.baseline).toBe("r2");
		expect(fx.opens.length).toBe(2);
		expect(fx.resumes).toHaveLength(1);
		// Child 1 is untouched: still enrolled on the same session key, handle,
		// baseline and counters (an idle stalled_idle attention flag is the
		// designed D20 signal, not execution interference).
		const child1 = after.children.find(child => child.task_id === CHILD_A)!;
		expect(child1.state).toBe("enrolled");
		expect(JSON.stringify({ ...child1.session, attention: null })).toBe(child1SessionBefore && JSON.stringify({ ...JSON.parse(child1SessionBefore), attention: null }));
	});

	it("native-gated stop closes only Child 2 via BatchSessionPort.stop, parks it and retains its Lane while Child 1 runs", async () => {
		const { repo, laneA, laneB } = s7Fixture();
		const stops: string[] = [];
		const sessions = { stop: async (handle: string) => { stops.push(handle); return { ok: true as const }; } } as unknown as import("../plugins/immune-brain/runtime/unattended/batch_session_port").BatchSessionPort;
		const project = async (lanePath: string, taskId: string): Promise<AssuranceProjectionResult> => ({ contract: "assurance_kernel/assurance_projection/v1",
			task_id: taskId, error: null, claim: { task_id: taskId, lifecycle_status: "active" }, projection: projectionBody({ record_revision: "r1" }) }) as AssuranceProjectionResult;
		const { input } = relayInput(repo, laneB, { taskId: CHILD_B, operation: "stop" as LaneDecisionOperation, project, sessions });
		const outcome = await relayLaneDecision(input);
		expect(outcome).toMatchObject({ relayed: true, lane_relay: { batch_id: BATCH, operation: "stop", applied: true } });
		expect(stops).toEqual([`h-${CHILD_B}`]);
		const after = readAnyBatchRunState(repo, BATCH) as BatchLaneRunStateRecord;
		expect(after.children.find(c => c.task_id === CHILD_B)).toMatchObject({ state: "needs_human", reason: "lane_executor_stopped" });
		expect(after.children.find(c => c.task_id === CHILD_A)).toMatchObject({ state: "enrolled" });
		expect(existsSync(laneB)).toBe(true);
		expect(existsSync(laneA)).toBe(true);
		expect(after.batch_state).toBe("running");
	});

	it("a coordinator: correct instruction closes g1 with proof and opens g2", async () => {
		const { repo } = s7Fixture();
		const closes: Array<{ handle: string; key: string }> = [];
		const opens: string[] = [];
		const port = {
			provider: "mem-correct",
			async find(_key: string) { return { ok: true as const, handle: `h-${CHILD_B}` }; },
			async observe(_handle: string) { return { ok: true as const, state: "done" as const }; },
			async resume(_handle: string, _entry: string) { return { ok: true as const, entry_submitted: true as const }; },
			async send(_handle: string, _text: string) { return { ok: true as const, state: "done" as const }; },
			async stop(_handle: string) { return { ok: true as const }; },
			async closeWithProof(handle: string, key: string) { closes.push({ handle, key }); return { ok: true as const, exited: true as const, handle, key }; },
			async open(input: { entry: string }) { opens.push(input.entry); return { ok: true as const, handle: `h-${CHILD_B}-g2`, entry_submitted: true as const }; },
		} as unknown as import("../plugins/immune-brain/runtime/unattended/batch_session_port").BatchSessionPort;
		const rotated = await reconcileChildSession({
			port, batchId: BATCH, taskId: CHILD_B,
			session: { key: laneSessionKey(BATCH, CHILD_B, 1), generation: 1, baseline: "r1", handle: `h-${CHILD_B}`, entry_submitted: true, attention: null, no_progress: 1, exit_proof: null },
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: `drive ${CHILD_B}`, laneCwd: repo,
			pendingCorrection: "design correction",
		});
		expect(rotated.action).toBe("rotated");
		expect(rotated.session.generation).toBe(2);
		expect(closes).toEqual([{ handle: `h-${CHILD_B}`, key: laneSessionKey(BATCH, CHILD_B, 1) }]);
		expect(opens).toEqual(["design correction"]);
	});

	const REBOUND_AT = "2026-01-02T00:00:00.000Z";

	/** Continue a rebound batch the way a Parent re-entry does. */
	async function continueAfterRebind(fx: Awaited<ReturnType<typeof s7LanesFixture>>, record: BatchLaneRunStateRecord) {
		const reboundKids = record.children.map(child => {
			const id = record.intent_identities![child.task_id]!;
			return { task_id: child.task_id, slice_id: child.slice_id, blocked_by: [...child.blocked_by], status: "enrollable" as const, reason: null,
				intent_path: id.intent_path, intent_revision: id.intent_revision, intent_content_hash: id.intent_content_hash,
				...(id.intent_authority_hash ? { intent_authority_hash: id.intent_authority_hash } : {}) };
		});
		expect(computeBatchPlanDigest(reboundKids as never)).toBe(record.plan_digest);
		const capability = fx.registry.issue({ batch_id: BATCH, initiative_slug: SLUG, plan_digest: record.plan_digest, branch: "main", base_head: fx.base,
			budget: { max_children: 2, qa_failure_limit: 2 }, actor_id: "user", confirmation_ref: "confirm", nonce: "n" }, reboundKids as never, REBOUND_AT);
		const continued = await advanceLanes(fx.repo, BATCH, { ...fx.deps, capability, confirmation_time: REBOUND_AT, now: REBOUND_AT } as never) as unknown as { batch_state: string; reason?: unknown };
		expect(continued.batch_state).toBe("running");
		expect(JSON.stringify(continued)).not.toContain("plan_changed");
		expect(JSON.stringify(continued)).not.toContain("retire_stale_batch");
		return continued;
	}

	it("approving a breaking revision rebinds Child 2, advances plan_digest and refuses a stale from_digest", async () => {
		const { repo } = s7Fixture();
		const before = readAnyBatchRunState(repo, BATCH) as BatchLaneRunStateRecord;
		const child1Before = JSON.stringify(before.children.find(c => c.task_id === CHILD_A));
		const revised = { ...(readTaskIntent(repo, CHILD_B).intent), revision: 2, goal: `Deliver ${CHILD_B} revised` };
		const contentHash = canonicalIntentHash(revised as never);
		const rebound = rebindBatchChildIdentity(repo, BATCH, { task_id: CHILD_B, intent: revised as never, content_hash: contentHash });
		expect(rebound.lane_rebinds).toHaveLength(1);
		expect(rebound.lane_rebinds?.[0]).toMatchObject({ task_id: CHILD_B, from_revision: 1, to_revision: 2 });
		expect(rebound.plan_digest).not.toBe(before.plan_digest);
		expect(JSON.stringify(rebound.children.find(c => c.task_id === CHILD_A))).toBe(child1Before);
		expect(hasContiguousLaneRebind(rebound, before.plan_digest)).toBe(true);
		// A stale from_digest refuses without writing.
		const bytes = readFileSync(join(repo, ".imm/state/batches", `${BATCH}.json`), "utf8");
		expect(() => rebindBatchChildIdentity(repo, BATCH, { task_id: CHILD_B, intent: revised as never, content_hash: contentHash, from_digest: before.plan_digest })).toThrow("lane_decision_stale");
		expect(readFileSync(join(repo, ".imm/state/batches", `${BATCH}.json`), "utf8")).toBe(bytes);
	});

	/** Commit a revised intent into a Lane worktree, mirroring what the
	 * native gate commits before a breaking revision is rebound. */
	const commitLaneIntent = (repo: string, lane: string, taskId: string, intent: unknown) => {
		const rel = readTaskIntent(repo, taskId).intent_ref.path;
		writeFileSync(join(lane, rel), `${JSON.stringify(intent, null, 2)}\n`);
		git(lane, "add", "docs/plans");
		git(lane, "commit", "-qm", `breaking revision ${taskId}`);
	};

	it("continuing the batch after a breaking rebind advances without plan_changed or retire", async () => {
		const fx = await s7LanesFixture();
		const before = readAnyBatchRunState(fx.repo, BATCH) as BatchLaneRunStateRecord;
		const revised = { ...(readTaskIntent(fx.repo, CHILD_B).intent), revision: 2, goal: `Deliver ${CHILD_B} revised` };
		commitLaneIntent(fx.repo, before.children.find(child => child.task_id === CHILD_B)!.lane!.path, CHILD_B, revised);
		const rebound = rebindBatchChildIdentity(fx.repo, BATCH, { task_id: CHILD_B, intent: revised as never, content_hash: canonicalIntentHash(revised as never) });
		expect(rebound.lane_rebinds).toHaveLength(1);
		expect(hasContiguousLaneRebind(rebound, before.plan_digest)).toBe(true);
		await continueAfterRebind(fx, rebound);
		const settled = readAnyBatchRunState(fx.repo, BATCH) as BatchLaneRunStateRecord;
		expect(settled.batch_state).toBe("running");
		expect(settled.lane_rebinds).toHaveLength(1);
		expect(settled.children.find(child => child.task_id === CHILD_A)?.state).toBe("enrolled");
		expect(settled.children.find(child => child.task_id === CHILD_B)?.state).toBe("enrolled");
	});

	it("a breaking revision approved after a Revision Delegation reseal still continues cleanly", async () => {
		const fx = await s7LanesFixture();
		const base = readAnyBatchRunState(fx.repo, BATCH) as BatchLaneRunStateRecord;
		// Simulate the delegation era: Child A delegated 1->2, then resealed at
		// integration. The reseal chain ends where the rebind chain begins.
		const aRev2 = { ...(readTaskIntent(fx.repo, CHILD_A).intent), revision: 2, goal: `Deliver ${CHILD_A} revised` };
		const hA2 = canonicalIntentHash(aRev2 as never);
		const authA2 = intentAuthorityHash(aRev2 as never);
		const aPath = readTaskIntent(fx.repo, CHILD_A).intent_ref.path;
		const bId = base.intent_identities![CHILD_B]!;
		const kidsD = [
			{ task_id: CHILD_A, slice_id: "A", blocked_by: [], status: "enrollable", reason: null, intent_path: aPath, intent_revision: 2, intent_content_hash: hA2, intent_authority_hash: authA2 },
			{ task_id: CHILD_B, slice_id: "B", blocked_by: [], status: "enrollable", reason: null, intent_path: bId.intent_path, intent_revision: bId.intent_revision, intent_content_hash: bId.intent_content_hash, ...(bId.intent_authority_hash ? { intent_authority_hash: bId.intent_authority_hash } : {}) },
		];
		const d0d = computeBatchPlanDigest(kidsD as never);
		const laneA = base.children.find(child => child.task_id === CHILD_A)!.lane!.path;
		const laneB = base.children.find(child => child.task_id === CHILD_B)!.lane!.path;
		const commitLane = (lane: string, taskId: string, intent: unknown) => {
			const rel = readTaskIntent(fx.repo, taskId).intent_ref.path;
			writeFileSync(join(lane, rel), `${JSON.stringify(intent, null, 2)}\n`);
			git(lane, "add", "docs/plans");
			git(lane, "commit", "-qm", `breaking revision ${taskId}`);
		};
		// The delegation committed rev 2 in Child A's Lane at delegation time.
		commitLane(laneA, CHILD_A, aRev2);
		writeBatchLaneRunState(fx.repo, { ...base,
			intent_identities: { ...base.intent_identities, [CHILD_A]: { intent_path: aPath, intent_revision: 2, intent_content_hash: hA2, intent_authority_hash: authA2 } },
			plan_digest: d0d,
			revision_delegation: { confirmation_time: CONFIRMED_AT },
			delegated_revisions: [{ at: CONFIRMED_AT, task_id: CHILD_A, from_revision: 1, to_revision: 2, intent_content_hash: hA2, confirmation_ref: `delegated-batch:${BATCH}@${CONFIRMED_AT}` }],
			reseals: [{ at: CONFIRMED_AT, task_id: CHILD_A, from_digest: base.plan_digest, to_digest: d0d, intent_revision: 2, intent_content_hash: hA2 }],
		} as BatchLaneRunStateRecord);
		// Breaking revision for Child B on top of the reseal: the gate commits
		// rev 2 in the Lane first, then the rebind hands off exactly where the
		// reseal chain ended.
		const revised = { ...(readTaskIntent(fx.repo, CHILD_B).intent), revision: 2, goal: `Deliver ${CHILD_B} revised` };
		commitLane(laneB, CHILD_B, revised);
		const rebound = rebindBatchChildIdentity(fx.repo, BATCH, { task_id: CHILD_B, intent: revised as never, content_hash: canonicalIntentHash(revised as never) });
		expect(rebound.lane_rebinds).toHaveLength(1);
		expect(rebound.reseals).toHaveLength(1);
		expect(hasContiguousLaneRebind(rebound, d0d)).toBe(true);
		await continueAfterRebind(fx, rebound);
		const settled = readAnyBatchRunState(fx.repo, BATCH) as BatchLaneRunStateRecord;
		expect(settled.batch_state).toBe("running");
		expect(settled.lane_rebinds?.[0]).toMatchObject({ task_id: CHILD_B, from_revision: 1, to_revision: 2 });
	});

	it("openBatchSessionPort resolves the recorded provider without an injected factory and fails closed without Herdr", async () => {
		const { repo } = s7Fixture();
		const record = readAnyBatchRunState(repo, BATCH) as BatchLaneRunStateRecord;
		const handle = record.children.find(child => child.task_id === CHILD_B)?.session?.handle;
		expect(typeof handle).toBe("string");
		// The injected fake reaches BatchSessionPort.stop with no real Herdr tab.
		const stops: string[] = [];
		const port: any = memoryLanePort();
		const origStop = port.stopSession.bind(port);
		port.stopSession = async (stopped: string) => { stops.push(stopped); return origStop(stopped); };
		const opened = openBatchSessionPort({ root: repo, provider: "herdr", env: { ...memoryLanePortEnv }, host: "pi",
			createPort: () => port });
		expect(opened.ok).toBe(true);
		if (opened.ok) {
			await opened.port.stop(handle!);
			expect(stops).toEqual([handle]);
		}
		// No recorded provider fails closed instead of inventing a session.
		expect(openBatchSessionPort({ root: repo, provider: null, env: { ...memoryLanePortEnv }, host: "pi" }))
			.toMatchObject({ ok: false, reason: expect.stringContaining("lane_session_unavailable") });
		// Production without an injected factory still resolves through the
		// recorded provider entry point; outside Herdr it fails closed with
		// the provider's reason instead of opening anything.
		const refused = openBatchSessionPort({ root: repo, provider: "herdr", env: {}, host: "pi" });
		expect(refused).toMatchObject({ ok: false, reason: expect.stringContaining("lane_session_unavailable") });
	});
});

describe("LEL-AC3 / workflow-friction D3.1: a new single-task start takes layered final verification by risk", () => {
	const savedXdg = process.env.XDG_CONFIG_HOME;
	afterEach(() => { if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = savedXdg; });
	const CONFIGURED = ["bun test", "bun run typecheck"];

	/** A single-task fixture whose project config is `batch`, with no user config. */
	function configuredHost(batch: unknown, risk = "material") {
		const xdg = realpathSync(mkdtempSync(join(tmpdir(), "imm-lel-xdg-")));
		roots.push(xdg);
		process.env.XDG_CONFIG_HOME = xdg;
		const f = hostFixture(risk);
		const writeConfig = (value: unknown) => {
			mkdirSync(join(f.root, ".imm"), { recursive: true });
			writeFileSync(join(f.root, ".imm/config.json"), JSON.stringify({ contract: "immune_brain/project_config/v2", ...(value === undefined ? {} : { batch: value }) }));
		};
		writeConfig(batch);
		const h = claudeHarness(f.root, f.factory);
		const record = () => readAnyBatchRunState(f.root, findActiveLaneBatchForTask(f.root, TASK)!.record.batch_id) as BatchLaneRunStateRecord;
		const recorded = () => record().final_verification;
		return { f, h, writeConfig, recorded, record };
	}

	it.each([
		["a critical task inherits batch.final_verification", "critical", { final_verification: CONFIGURED, single_task_final_verification: ["bun run lint"] }, CONFIGURED],
		["a non-critical task takes batch.single_task_final_verification", "material", { final_verification: ["bun test"], single_task_final_verification: CONFIGURED }, CONFIGURED],
	])("%s, records it as required and lists it in the native confirmation", async (_name, risk, batch, expected) => {
		const { h, recorded, record } = configuredHost(batch, risk);
		const started = await h.start({ agents: { executor: "claude-code" } });
		expect(started.state).toBe("started");
		expect(recorded()).toEqual(expected);
		expect(record().final_verification_required).toBe(true);
		expect(h.gates).toHaveLength(1);
		for (const command of expected) expect(h.gates[0]!.text).toContain(command);
		await h.stopBatch();
	});

	it("a non-critical task ignores batch.final_verification, recording none and leaving it optional", async () => {
		const { h, recorded, record } = configuredHost({ final_verification: CONFIGURED });
		const started = await h.start({ agents: { executor: "claude-code" } });
		expect(started.state).toBe("started");
		expect(recorded() ?? []).toEqual([]);
		expect(record().final_verification_required).toBe(false);
		await h.stopBatch();
	});

	it("lets caller commands win over config", async () => {
		const { h, recorded } = configuredHost({ final_verification: CONFIGURED });
		const started = await h.start({ agents: { executor: "claude-code" }, final_verification: ["bun run lint"] });
		expect(started.state).toBe("started");
		expect(recorded()).toEqual(["bun run lint"]);
		await h.stopBatch();
	});

	it("still starts with neither caller commands nor config, recording none", async () => {
		const { h, recorded } = configuredHost(undefined);
		const started = await h.start({ agents: { executor: "claude-code" } });
		expect(started.state).toBe("started");
		expect(recorded() ?? []).toEqual([]);
		await h.stopBatch();
	});

	it.each([
		["batch.final_verification", { final_verification: "bun test" }],
		["batch.single_task_final_verification", { single_task_final_verification: [""] }],
	])("refuses an invalid %s with lane_config_invalid before any gate", async (_key, batch) => {
		const { h } = configuredHost(batch);
		const refused = await h.start({ agents: { executor: "claude-code" } });
		expect(refused.state).toBe("rejected");
		expect(refused.reason).toContain("lane_config_invalid");
		expect(h.gates).toHaveLength(0);
	});

	it("keeps the recorded commands when re-entering after the config changed", async () => {
		const { h, writeConfig, recorded } = configuredHost({ single_task_final_verification: CONFIGURED });
		expect((await h.start({ agents: { executor: "claude-code" } })).state).toBe("started");
		writeConfig({ single_task_final_verification: ["bun run lint"] });
		expect((await h.start({ agents: { executor: "claude-code" } })).state).toBe("started");
		expect(recorded()).toEqual(CONFIGURED);
		await h.stopBatch();
	});
});
