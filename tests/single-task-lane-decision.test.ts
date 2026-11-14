import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { computeBatchPlanDigest, createBatchAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/batch_authority";
import { canonicalIntentHash, intentAuthorityHash, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import type { AssuranceProjectionResult } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import { createBatchKernelPort } from "../plugins/immune-brain/runtime/unattended/batch_kernel_port";
import { createEnrollmentAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { createDefaultBatchGitPort, type BatchRunnerGitPort } from "../plugins/immune-brain/runtime/unattended/batch_git";
import { createDefaultLaneGitPort } from "../plugins/immune-brain/runtime/unattended/batch_lanes";
import { startBatch } from "../plugins/immune-brain/runtime/unattended/batch_runner";
import type { BatchRunnerKernelPort, StartBatchInput } from "../plugins/immune-brain/runtime/unattended/batch_runner";
import { readAnyBatchRunState, rebindSingleTaskIdentity, type BatchLaneRunReport, type BatchLaneRunStateRecord } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { LaneSupervisor } from "../plugins/immune-brain/runtime/unattended/lane_supervisor";
import { LaneDecisionStaleError, laneDecisionFacts, relayLaneDecision, type LaneDecisionOperation } from "../plugins/immune-brain/runtime/unattended/lane_decision";
import { laneDecisionRequestPath, writeLaneDecisionRequest } from "../plugins/immune-brain/runtime/unattended/lane_decision_request";
import type { BatchPlanChild } from "../plugins/immune-brain/runtime/unattended/types";
import { batchReason } from "../plugins/immune-brain/runtime/unattended/batch_reasons";
import { findLaneRelayTarget } from "../plugins/immune-brain/runtime/unattended/lane_decision";
import { findExistingActiveBatch } from "../plugins/immune-brain/runtime/unattended/batch_preflight";
import { readTaskTombstone } from "../plugins/immune-brain/runtime/kernel/backend_claim";
import { prepareBatchLaneRunState, writeBatchLaneRunState } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage";
import { createMcpRuntime, elicitationParams } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { consumePhaseAdmission, phaseEntryGateHookOutput, recordPhaseEntryPrompt, type GatedTool } from "../plugins/immune-brain/runtime/claude/lane_guard";
import { copyGitTemplate } from "./helpers/git-template";
import { mockHostSdkForDeliveryTree } from "./helpers/pi-canary-assurance-harness";

// Delivery QA has no Host SDK packages; the Pi surface runs against the harness seam when they are absent.
await mockHostSdkForDeliveryTree();
afterAll(() => mock.restore());
const { executePiUnattendedBatch } = await import("../plugins/immune-brain/.pi-extension/imm-unattended-batch");
const { default: registerPiWork, recordPiPhaseInput } = await import("../plugins/immune-brain/.pi-extension/imm-canary-work");

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

function intentJson(revision: number, assertion = "A1 holds") {
	return `${JSON.stringify({ contract: "assurance_kernel/task_intent/v1", task_id: TASK, owner: "user", goal: "Deliver the single task",
		acceptance: [{ id: "A1", assertion, verification: VERIFICATION }], scope_hint: ["delivery.txt"], risk: "material", revision })}\n`;
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

function request(repo: string, base: string, fx: { kernel: ReturnType<typeof kernel>; git: BatchRunnerGitPort }): StartBatchInput {
	const intent = readTaskIntent(repo, TASK);
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


function executors(script: string) {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "imm-lane-decision-bin-")));
	roots.push(dir);
	for (const name of ["claude", "pi"]) { const path = join(dir, name); writeFileSync(path, script); chmodSync(path, 0o755); }
	process.env.PATH = `${dir}:${oldPath}`;
}

/** A started single-task batch whose Lane child waits on a literal-user decision. */
async function waitingLane(executor_mode?: "interactive") {
	const { repo, base } = fixture();
	const k = kernel();
	const args = () => ({ ...request(repo, base, { kernel: k, git: Object.assign(createDefaultBatchGitPort(), { lane: createDefaultLaneGitPort() }) }), executor_mode });
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
		supervisor: new LaneSupervisor(), parentHost: "claude-code" as const, pluginDir: "/plugin", waitMs: 20_000, ...over };
	return { input, applied };
}

describe("single-task Lane decision relay (S5)", () => {
	it("applies the gate in the Lane and starts the next Executor generation", async () => {
		executors('#!/bin/sh\nprintf "%s\\n" "$PWD" > gen.txt\nexit 0\n');
		const { repo, lane } = await waitingLane();
		const { input, applied } = relayInput(repo, lane);
		const outcome = await relayLaneDecision(input);
		expect(applied.calls).toBe(1);
		expect(outcome).toMatchObject({ relayed: true, lane_relay: { applied: true, operation: "request_authorization", rebound: false, lane_supervision: { state: "exited" } } });
		expect(readFileSync(join(lane, "gen.txt"), "utf8").trim()).toBe(lane);
	});

	it.each(["request_authorization", "stop"] as const)("applies %s to an interactive Lane without launching a runtime Executor", async operation => {
		executors('#!/bin/sh\nprintf x > gen.txt\n');
		const { repo, lane, args } = await waitingLane("interactive");
		const { input, applied } = relayInput(repo, lane, { operation });
		const outcome = await relayLaneDecision(input);
		expect(applied.calls).toBe(1);
		expect(outcome).toMatchObject({ relayed: true, lane_relay: { applied: true, operation, lane_supervision: null } });
		expect(existsSync(join(lane, "gen.txt"))).toBe(false);
		expect(existsSync(lane)).toBe(true);
		if (operation === "stop") {
			expect(readAnyBatchRunState(repo, BATCH_ID)).toMatchObject({ batch_state: "needs_human",
				children: [{ state: "needs_human", reason: "lane_executor_stopped" }] });
			expect(outcome).toMatchObject({ lane_relay: { next_action: expect.stringContaining("Close") } });
			const next = laneReport(await startBatch(args()));
			expect(next.children[0]!.reason).toBe("lane_executor_stopped");
		}
	});

	it("records an approved stop for an already parked interactive Lane", async () => {
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
		executors('#!/bin/sh\nprintf x > gen.txt\n');
		const { repo, lane } = await waitingLane();
		const { input, applied } = relayInput(repo, lane, { expectedRecordRevision: "r0" });
		await expect(relayLaneDecision(input)).rejects.toBeInstanceOf(LaneDecisionStaleError);
		expect(applied.calls).toBe(0);
		expect(existsSync(join(lane, "gen.txt"))).toBe(false);
	});

	it("refuses a decision for a Lane that waits on none", async () => {
		executors('#!/bin/sh\nprintf x > gen.txt\n');
		const { repo, lane } = await waitingLane();
		const { input, applied } = relayInput(repo, lane, { project: async (_p, taskId) => ({ contract: "assurance_kernel/assurance_projection/v1",
			task_id: taskId, error: null, claim: { task_id: taskId, lifecycle_status: "active" }, projection: projectionBody() }) as AssuranceProjectionResult });
		await expect(relayLaneDecision(input)).rejects.toBeInstanceOf(LaneDecisionStaleError);
		expect(applied.calls).toBe(0);
		expect(existsSync(join(lane, "gen.txt"))).toBe(false);
	});

	it.each([undefined, "interactive"] as const)("starts nothing when the user cancels the gate (mode=%s)", async mode => {
		executors('#!/bin/sh\nprintf x > gen.txt\n');
		const { repo, lane } = await waitingLane(mode);
		const before = readAnyBatchRunState(repo, BATCH_ID);
		const { input } = relayInput(repo, lane, { apply: async () => ({ state: "cancelled" }), applied: result => result.state === "applied" });
		const outcome = await relayLaneDecision(input);
		expect(outcome).toMatchObject({ relayed: true, lane_relay: { applied: false, lane_supervision: null } });
		expect(existsSync(join(lane, "gen.txt"))).toBe(false);
		expect(readAnyBatchRunState(repo, BATCH_ID)).toEqual(before);
	});

	it("reports a record that moved while the gate was open as stale, and keeps other gate errors", async () => {
		executors('#!/bin/sh\nprintf x > gen.txt\n');
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

	it("stops the live generation after a relayed Kernel stop and keeps the Lane", async () => {
		executors("#!/bin/sh\nexec sleep 30\n");
		const { repo, lane } = await waitingLane();
		const supervisor = new LaneSupervisor();
		const running = await relayLaneDecision(relayInput(repo, lane, { supervisor, waitMs: 300 }).input);
		expect(running).toMatchObject({ relayed: true, lane_relay: { lane_supervision: { state: "running" } } });
		const stopped = await relayLaneDecision(relayInput(repo, lane, { supervisor, operation: "stop",
			project: async (_p, taskId) => ({ contract: "assurance_kernel/assurance_projection/v1", task_id: taskId, error: null,
				claim: { task_id: taskId, lifecycle_status: "active" }, projection: advanced() }) as AssuranceProjectionResult }).input);
		expect(stopped).toMatchObject({ relayed: true, lane_relay: { operation: "stop", applied: true, lane_supervision: { state: "stopped" } } });
		expect(existsSync(lane)).toBe(true);
	});

	it("rebinds the batch's approved identity once a breaking revision is committed in the Lane", async () => {
		executors("#!/bin/sh\nexit 0\n");
		const { repo, lane, args } = await waitingLane();
		writeFileSync(join(lane, `docs/plans/${TASK}.intent.json`), intentJson(2, "A1 holds, revised"));
		const revised = readTaskIntent(lane, TASK);
		const record = readAnyBatchRunState(repo, BATCH_ID) as BatchLaneRunReport & { batch_id: string };
		expect(record.batch_id).toBe(BATCH_ID);
		rebindSingleTaskIdentity(repo, BATCH_ID, { task_id: TASK, intent: revised.intent, content_hash: revised.intent_ref.content_hash });
		// Replaying the committed identity changes nothing; an older revision is stale.
		rebindSingleTaskIdentity(repo, BATCH_ID, { task_id: TASK, intent: revised.intent, content_hash: revised.intent_ref.content_hash });
		const older = readTaskIntent(repo, TASK);
		expect(() => rebindSingleTaskIdentity(repo, BATCH_ID, { task_id: TASK, intent: older.intent, content_hash: older.intent_ref.content_hash })).toThrow("lane_decision_stale");
		const next = laneReport(await startBatch(args()));
		expect(next.reason ?? "").not.toContain("batch_child_authority_changed");
		expect(next.batch_state).not.toBe("needs_human");
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
	start(): Promise<any>;
	stopBatch(): Promise<void>;
	relay(op: "request_authorization" | "approve_breaking_intent_revision" | "stop", extra?: { record_revision?: string; next_intent?: unknown }): Promise<Relayed>;
}

/** A repository whose first Executor generation stops on a literal-user decision, and whose later generations stay alive. */
/** `kind` is the open finding the first generation leaves behind: a literal-user decision, or a replan boundary that needs a breaking revision. */
function hostFixture(kind: "unresolved_user_decision" | "replan_required" = "unresolved_user_decision") {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "imm-lane-host-")));
	roots.push(root);
	copyGitTemplate(root);
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	writeFileSync(join(root, `docs/plans/${TASK}.intent.json`), intentJson(1));
	git(root, "add", "docs");
	git(root, "commit", "-qm", "task intent");
	const bin = realpathSync(mkdtempSync(join(tmpdir(), "imm-lane-host-bin-")));
	roots.push(bin);
	const spawnsFile = join(bin, "spawns");
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
	const script = [
		"#!/bin/sh",
		`echo "$PWD" >> ${JSON.stringify(spawnsFile)}`,
		`n=$(wc -l < ${JSON.stringify(spawnsFile)} | tr -d ' ')`,
		`if [ "$n" -ge 2 ]; then exec /bin/sleep 30; fi`,
		`${JSON.stringify(process.execPath)} ${JSON.stringify(join(bin, "seed.ts"))} "$PWD" ${JSON.stringify(TASK)} ${kind} || exit 3`,
		"exit 0",
		"",
	].join("\n");
	for (const name of ["claude", "pi"]) { const path = join(bin, name); writeFileSync(path, script); chmodSync(path, 0o755); }
	process.env.PATH = `${bin}:${oldPath}`;
	return { root, spawnsFile, spawns: () => existsSync(spawnsFile) ? readFileSync(spawnsFile, "utf8").split("\n").filter(Boolean) : [],
		/** What one interactive TUI run leaves in the Lane; a Pi Executor outside Herdr never runs (D4). */
		seed: (kind: "unresolved_user_decision" | "replan_required", lane: string) =>
			execFileSync(process.execPath, [join(bin, "seed.ts"), lane, TASK, kind], { stdio: "ignore" }) };
}

function claudeHarness(root: string): HostHarness {
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
		cwd: root, env: HOST_ENV, interactive: true,
		requestConfirmation: async input => { gates.push({ text: elicitationParams(input).message }); return { decision: answer.approve ? "accept" : "decline", requestId: `native-${gates.length}` }; },
	});
	runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
	let calls = 0;
	const tool = (name: string, args: Record<string, unknown>) => runtime.callTool(name, args, { toolCallId: `s5-${name}-${++calls}` });
	return {
		gates, answer,
		start: () => tool("start_unattended_batch", { task_id: TASK, executor_host: "claude-code", final_verification: FINAL_VERIFICATION }),
		stopBatch: async () => { await tool("start_unattended_batch", { task_id: TASK, stop: true, final_verification: FINAL_VERIFICATION }).catch(() => undefined); },
		relay: async (op, extra = {}) => {
			try { const raw = await tool(op, { task_id: TASK, ...extra }); return { raw, lane_relay: raw.lane_relay }; }
			catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
		},
	};
}

function piHarness(root: string): HostHarness {
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
		start: () => executePiUnattendedBatch({ root, taskId: TASK, executor: { executor_host: "pi" }, confirmBatch: async details => { gates.push({ text: details.summary }); return answer.approve ? "accept" : "cancel"; } }),
		stopBatch: async () => { await executePiUnattendedBatch({ root, taskId: TASK, stop: true }).catch(() => undefined); },
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

for (const host of ["claude", "pi"] as const) describe(`single-task Lane decision relay through the ${host} Host (S5)`, () => {
	let herdrEnv: string | undefined;
	beforeEach(() => { herdrEnv = process.env.HERDR_ENV; delete process.env.HERDR_ENV; });
	afterEach(() => { if (herdrEnv === undefined) delete process.env.HERDR_ENV; else process.env.HERDR_ENV = herdrEnv; });
	/** A claude-code Executor is supervised; a Pi Executor outside Herdr is refused (#426 D4). */
	const supervised = host === "claude";

	async function waitingHostLane(kind: "unresolved_user_decision" | "replan_required" = "unresolved_user_decision") {
		const f = hostFixture(kind);
		const h = host === "claude" ? claudeHarness(f.root) : piHarness(f.root);
		let started = await h.start();
		if (started.state !== "started") throw new Error(`start refused: ${JSON.stringify(started)}`);
		if (!supervised) {
			// The first Pi generation was refused, so seed the decision the interactive TUI run leaves behind.
			f.seed(kind, findLaneRelayTarget(f.root, TASK)!.lane_path);
			started = await h.start();
			if (started.state !== "started") throw new Error(`Pi re-entry refused: ${JSON.stringify(started)}`);
		}
		const startGates = h.gates.length;
		// A wait window can end while the first generation still runs; the documented next step is to call start again.
		for (let attempt = 0; attempt < 30 && !started.report.lane_decision_required && started.report.lane_supervision?.state === "running"; attempt++) {
			started = await h.start();
			if (started.state !== "started") throw new Error(`re-attach refused: ${JSON.stringify(started)}`);
		}
		expect(h.gates.length).toBe(startGates);
		return { f, h, started, target: findLaneRelayTarget(f.root, TASK)! };
	}

	it("reports the waiting Lane, then one native gate applies the decision in the Lane", async () => {
		const { f, h, started, target } = await waitingHostLane();
		try {
			const required = started.report.lane_decision_required;
			// Read the facts before matching: a matcher on the report object must not stand in for the values used below.
			const revision: string = required.record_revision;
			expect(required.task_id).toBe(TASK);
			expect(typeof required.run_id).toBe("string");
			expect(typeof revision).toBe("string");
			expect(required.open_user_decision_count).toBe(1);
			expect(started.report.next_action).toContain(revision);
			expect(f.spawns()).toHaveLength(supervised ? 1 : 0);
			expect(decisionStatus(target.lane_path)).toBe("open");
			const opened = h.gates.length;
			const relayed = await h.relay("request_authorization", { record_revision: revision });
			expect(relayed.error).toBeUndefined();
			expect(h.gates.length - opened).toBe(1);
			expect(h.gates.at(-1)!.text).toContain(TASK);
			expect(relayed.lane_relay).toMatchObject(supervised
				? { operation: "request_authorization", applied: true, rebound: false, lane_supervision: { state: "running", generation: 2 } }
				: { operation: "request_authorization", applied: true, rebound: false, lane_supervision: { state: "unavailable", generation: null, reason: "lane_executor_requires_tui" } });
			expect(f.spawns()).toHaveLength(supervised ? 2 : 0);
			if (supervised) {
				expect(realpathSync(f.spawns()[1]!)).toBe(realpathSync(target.lane_path));
				expect(readTaskRecordRaw(f.root, TASK).record).toBeFalsy();
			}
			expect(decisionStatus(target.lane_path)).toBe("resolved");
		} finally { await h.stopBatch(); }
	}, 40000);

	it("refuses a stale record revision before any gate and applies nothing on a cancelled gate", async () => {
		const { f, h, target } = await waitingHostLane();
		try {
			const opened = h.gates.length;
			const stale = await h.relay("request_authorization", { record_revision: "sha256:not-the-current-revision" });
			expect(stale.error ?? JSON.stringify(stale.raw)).toContain(batchReason("lane_decision_stale").reason);
			expect(h.gates.length).toBe(opened);
			h.answer.approve = false;
			const cancelled = await h.relay("request_authorization");
			expect(h.gates.length - opened).toBe(1);
			expect(cancelled.lane_relay?.applied ?? false).toBe(false);
			expect(decisionStatus(target.lane_path)).toBe("open");
			expect(f.spawns()).toHaveLength(supervised ? 1 : 0);
		} finally { await h.stopBatch(); }
	}, 40000);

	it(`${supervised ? "relays a breaking revision through one gate, rebinds the batch identity and does not refuse plan_changed afterwards" : "refuses a replan-only Lane before its decision facts are read"}`, async () => {
		const { f, h, started, target } = await waitingHostLane("replan_required");
		try {
			if (!supervised) {
				// A replan-only Lane is not one of the early returns, so the Pi refusal is what the report carries.
				expect(started.report.reason).toBe(batchReason("lane_executor_requires_tui").reason);
				expect(started.report.lane_decision_required).toBeUndefined();
				expect(f.spawns()).toHaveLength(0);
				return;
			}
			const required = started.report.lane_decision_required;
			expect(required.replan_required_ids).toEqual([DECISION_ID]);
			const revision: string = required.record_revision;
			const revised = JSON.parse(intentJson(2, "A1 holds after the breaking revision"));
			const before = readAnyBatchRunState(f.root, target.batch_id) as BatchLaneRunStateRecord;
			const opened = h.gates.length;
			const relayed = await h.relay("approve_breaking_intent_revision", { record_revision: revision, next_intent: revised });
			expect(relayed.error).toBeUndefined();
			expect(h.gates.length - opened).toBe(1);
			expect(relayed.lane_relay).toMatchObject(supervised
				? { operation: "approve_breaking_intent_revision", applied: true, rebound: true, lane_supervision: { state: "running", generation: 2 } }
				: { operation: "approve_breaking_intent_revision", applied: true, rebound: true, lane_supervision: { state: "unavailable", generation: null, reason: "lane_executor_requires_tui" } });
			expect(f.spawns()).toHaveLength(supervised ? 2 : 0);
			const lane = readTaskRecordRaw(target.lane_path, TASK).record!;
			expect(lane.intent_snapshot.revision).toBe(2);
			const after = readAnyBatchRunState(f.root, target.batch_id) as BatchLaneRunStateRecord;
			expect(after.intent_identities?.[TASK]?.intent_content_hash).toBe(lane.intent_ref.content_hash);
			expect(after.intent_identities?.[TASK]?.intent_revision).toBe(2);
			expect(after.intent_identities?.[TASK]?.intent_content_hash).not.toBe(before.intent_identities?.[TASK]?.intent_content_hash);
			const next = await h.start();
			expect(next.report.reason).not.toBe(batchReason("plan_changed").reason);
			expect(JSON.stringify(next)).not.toContain("plan_changed");
			expect(next.report.batch_state).toBe("running");
			expect(next.report.lane_supervision).toMatchObject(supervised
				? { state: "running", generation: 2 } : { state: "unavailable", generation: null, reason: "lane_executor_requires_tui" });
			expect(f.spawns()).toHaveLength(supervised ? 2 : 0);
		} finally { await h.stopBatch(); }
	}, 40000);

	it("opens the stop gate once, applies it only when accepted, and keeps the Lane", async () => {
		const { f, h, target } = await waitingHostLane();
		try {
			expect((await h.relay("request_authorization")).error).toBeUndefined();
			expect(f.spawns()).toHaveLength(supervised ? 2 : 0);
			h.answer.approve = false;
			const opened = h.gates.length;
			const cancelled = await h.relay("stop");
			expect(h.gates.length - opened).toBe(1);
			expect(cancelled.lane_relay?.applied ?? false).toBe(false);
			expect(readTaskRecordRaw(target.lane_path, TASK).record?.lifecycle).toBe("active");
			h.answer.approve = true;
			const attached = await h.start();
			expect(attached.report.lane_supervision).toMatchObject(supervised
				? { state: "running", generation: 2 } : { state: "unavailable", generation: null, reason: "lane_executor_requires_tui" });
			expect(f.spawns()).toHaveLength(supervised ? 2 : 0);
			const beforeStop = h.gates.length;
			const stopped = await h.relay("stop");
			expect(stopped.error).toBeUndefined();
			expect(h.gates.length - beforeStop).toBe(1);
			expect(stopped.lane_relay).toMatchObject({ operation: "stop", applied: true, lane_supervision: { state: "stopped", generation: supervised ? 2 : null } });
			expect(readTaskTombstone(target.lane_path, TASK)).toMatchObject({ terminal_lifecycle: "stopped" });
			expect(existsSync(target.lane_path)).toBe(true);
		} finally { await h.stopBatch(); }
	}, 40000);
});

/**
 * #426 F19: the first generation is the real Claude Code MCP runtime of a headless Lane Executor. It asks for a
 * breaking revision; a headless Host cancels any native gate, so every gate it opens is counted in `gatesFile`.
 * Later generations stay alive.
 */
function headlessRevisionFixture() {
	const f = hostFixture();
	const bin = dirname(f.spawnsFile);
	const gatesFile = join(bin, "executor-gates");
	const resubmitFile = join(bin, "executor-resubmit");
	const claude = join(import.meta.dir, "../plugins/immune-brain/runtime/claude");
	writeFileSync(join(bin, "executor.ts"), [
		`import { appendFileSync, mkdtempSync } from "node:fs";`,
		`import { tmpdir } from "node:os";`,
		`import { join } from "node:path";`,
		`import { createMcpRuntime } from ${JSON.stringify(join(claude, "mcp_server"))};`,
		`import { consumePhaseAdmission, phaseEntryGateHookOutput, recordPhaseEntryPrompt } from ${JSON.stringify(join(claude, "lane_guard"))};`,
		`import { writeFileSync } from "node:fs";`,
		`const [lane, taskId, nextIntent, gatesFile, resubmitFile] = process.argv.slice(2);`,
		`const entry = mkdtempSync(join(tmpdir(), "imm-f19-entry-"));`,
		`const session = { session_id: "f19-executor", cwd: lane };`,
		`recordPhaseEntryPrompt({ hook_event_name: "UserPromptSubmit", prompt: "/drive", ...session }, { root: entry, home: entry });`,
		`const runtime = createMcpRuntime({`,
		`	consumePhaseAdmission(id, op) { phaseEntryGateHookOutput({ hook_event_name: "PreToolUse", tool_name: "mcp__plugin_immune-brain_immune-brain__" + op, tool_use_id: id, ...session }, { root: entry }); return consumePhaseAdmission(id, op, entry); },`,
		`	cwd: lane, env: { ...process.env, ...${JSON.stringify(HOST_ENV)} }, interactive: true,`,
		`	requestConfirmation: async () => { appendFileSync(gatesFile, "gate\\n"); return { decision: "decline", requestId: "headless" }; },`,
		`});`,
		`runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });`,
		`const result = await runtime.callTool("approve_breaking_intent_revision", { task_id: taskId, next_intent: JSON.parse(nextIntent) }, { toolCallId: "f19-revision" });`,
		`if (resubmitFile) { writeFileSync(resubmitFile, String(result?.state ?? result?.error)); process.exit(0); }`,
		`process.exit(result?.state === "lane_decision_requested" ? 0 : 5);`,
	].join("\n"));
	const script = [
		"#!/bin/sh",
		`echo "$PWD" >> ${JSON.stringify(f.spawnsFile)}`,
		`n=$(wc -l < ${JSON.stringify(f.spawnsFile)} | tr -d ' ')`,
		`if [ "$n" -ge 3 ]; then exec /bin/sleep 30; fi`,
		`[ "$IMM_LANE_EXECUTOR" = headless ] || exit 4`,
		`run() { ${JSON.stringify(process.execPath)} ${JSON.stringify(join(bin, "executor.ts"))} "$PWD" ${JSON.stringify(TASK)} '${intentJson(2, "A1 holds after the breaking revision").replace(/\n/g, "")}' ${JSON.stringify(gatesFile)} "$@"; }`,
		// The second generation resubmits the revision the Parent already committed, then stays alive.
		`if [ "$n" -eq 2 ]; then run ${JSON.stringify(resubmitFile)}; exec /bin/sleep 30; fi`,
		`run; exit $?`,
		"",
	].join("\n");
	writeFileSync(join(bin, "claude"), script);
	return { ...f, executorGates: () => existsSync(gatesFile) ? readFileSync(gatesFile, "utf8").split("\n").filter(Boolean).length : 0,
		resubmitted: async () => { for (let i = 0; i < 100 && !existsSync(resubmitFile); i++) await Bun.sleep(100); return existsSync(resubmitFile) ? readFileSync(resubmitFile, "utf8") : null; } };
}

describe("a headless Lane Executor's breaking revision reaches the Parent's gate (#426 F19)", () => {
	let herdrEnv: string | undefined;
	beforeEach(() => { herdrEnv = process.env.HERDR_ENV; delete process.env.HERDR_ENV; });
	afterEach(() => { if (herdrEnv === undefined) delete process.env.HERDR_ENV; else process.env.HERDR_ENV = herdrEnv; });

	it("records the request without a gate, one Parent gate commits it, and the next generation finds it committed", async () => {
		const f = headlessRevisionFixture();
		const h = claudeHarness(f.root);
		try {
			let started = await h.start();
			expect(started.state).toBe("started");
			for (let attempt = 0; attempt < 30 && !started.report.lane_decision_required && started.report.lane_supervision?.state === "running"; attempt++)
				started = await h.start();
			const target = findLaneRelayTarget(f.root, TASK)!;
			const required = started.report.lane_decision_required;
			expect(f.spawns()).toHaveLength(1);
			expect(f.executorGates()).toBe(0);
			expect(required?.requested).toMatchObject({ operation: "approve_breaking_intent_revision", next_intent: { revision: 2 } });
			expect(started.report.next_action).toContain("approve_breaking_intent_revision");
			expect(readTaskRecordRaw(target.lane_path, TASK).record!.intent_snapshot.revision).toBe(1);
			const opened = h.gates.length;
			const relayed = await h.relay("approve_breaking_intent_revision", { record_revision: required.record_revision, next_intent: required.requested.next_intent });
			expect(relayed.error).toBeUndefined();
			expect(h.gates.length - opened).toBe(1);
			expect(relayed.lane_relay).toMatchObject({ operation: "approve_breaking_intent_revision", applied: true, rebound: true, lane_supervision: { state: "running", generation: 2 } });
			expect(readTaskRecordRaw(target.lane_path, TASK).record!.intent_snapshot.revision).toBe(2);
			expect(existsSync(laneDecisionRequestPath(target.lane_path))).toBe(false);
			expect(f.spawns()).toHaveLength(2);
			// Leaving the request was progress: the next generation does not start one exit away from the no-progress park.
			const supervisors = join(f.root, ".imm", "state", "lane-supervisors");
			const [generation] = readdirSync(supervisors).map(name => JSON.parse(readFileSync(join(supervisors, name), "utf8")));
			expect(generation).toMatchObject({ generation: 2, no_progress: 0 });
			// The next generation that resubmits the committed revision is told it is committed, with no gate.
			expect(await f.resubmitted()).toBe("intent_revision_committed");
			expect(f.executorGates()).toBe(0);
		} finally { await h.stopBatch(); }
	}, 40000);
});

describe("a relay that does not target a single-task Lane (S5)", () => {
	it("leaves an Initiative batch child alone and applies nothing", async () => {
		const { repo, base } = fixture();
		const read = readTaskIntent(repo, TASK);
		const child: BatchPlanChild = { task_id: TASK, slice_id: "S1", blocked_by: [], status: "enrollable", reason: null, intent_path: read.intent_ref.path,
			intent_revision: read.intent_ref.revision, intent_content_hash: canonicalIntentHash(read.intent), intent_authority_hash: intentAuthorityHash(read.intent) };
		const record = prepareBatchLaneRunState({ batch_id: "initiative-batch", initiative_slug: TASK, children: [child], plan_digest: computeBatchPlanDigest([child]), base_head: base,
			confirmation_time: CONFIRMED_AT, budget: { max_children: 1, qa_failure_limit: 2 }, max_parallel: 2, now });
		const laneDir = realpathSync(mkdtempSync(join(tmpdir(), "imm-lane-initiative-")));
		roots.push(laneDir);
		record.children = record.children.map(value => ({ ...value, state: "needs_human", reason: "parked", lane: { path: laneDir, branch: `imm-lane/${TASK}/${TASK}`, base_head: base, lane_commit: null, run_id: "run-initiative" } }));
		writeBatchLaneRunState(repo, record);
		expect(findExistingActiveBatch(repo, TASK)).toMatchObject({ record: { batch_id: "initiative-batch" } });
		expect(findLaneRelayTarget(repo, TASK)).toBeNull();
		const { input, applied } = relayInput(repo, laneDir);
		expect(await relayLaneDecision(input)).toEqual({ relayed: false });
		expect(applied.calls).toBe(0);
	});
});
