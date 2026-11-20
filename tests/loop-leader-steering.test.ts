// Spec loop-leader S5 / D5.2-D5.4 (S5-AC2, BR-REQ-6, BR-DEC-11).
//
// Local owner steering: the privileged `steer_loop_work_item` Tool writes one
// natively confirmed request under `.imm/state/loop/steering/`, the daemon
// applies it on its next tick, and a paused or abandoned target yields no
// candidate from Tier-1/2 dispatch, leader dispatch or scheduler admission.
// A denied native confirmation writes nothing, and `abandon` never touches a
// running Kernel run.

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpRuntime, listMcpTools } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { createAntigravityMcpRuntime } from "../plugins/immune-brain/runtime/antigravity/mcp_server";
import { PRIVILEGED_OPERATIONS } from "../plugins/immune-brain/runtime/host-core/interaction";
import { steerLoopWorkItemToolDefinition } from "../plugins/immune-brain/.pi-extension/imm-canary-work";
import { runLoopDaemonCli } from "../plugins/immune-brain/runtime/loop_daemon/cli";
import { dispatchDecisions } from "../plugins/immune-brain/runtime/loop_daemon/dispatch";
import { createFakeLoopGitHubPort } from "../plugins/immune-brain/runtime/loop_daemon/github_port";
import { applyLeaderProposal, type LeaderDispatchDeps } from "../plugins/immune-brain/runtime/loop_daemon/leader_dispatch";
import { candidatePriority, scheduleLoopWork } from "../plugins/immune-brain/runtime/loop_daemon/scheduler";
import { initLoopState, saveLoopState } from "../plugins/immune-brain/runtime/loop_daemon/state";
import {
	LOOP_STEERING_REQUEST_CONTRACT,
	STEER_LOOP_WORK_ITEM_TOOL,
	applySteeringRequests,
	listSteeringRequests,
	steeringDir,
	writeSteeringRequest,
	type LoopSteeringAction,
} from "../plugins/immune-brain/runtime/loop_daemon/steering";
import { LOOP_DAEMON_EVENT_CONTRACT, type E5ReadyTaskEvent, type ObservationInput } from "../plugins/immune-brain/runtime/loop_daemon/types";
import { DEFAULT_LOOP_CONFIG } from "../plugins/immune-brain/runtime/config/layered_config";
import {
	newWorkItem,
	readWorkItem,
	takeResumeExemption,
	writeWorkItem,
	type WorkItem,
	type WorkItemState,
} from "../plugins/immune-brain/runtime/loop_daemon/work_items";
import { discardAbandonedBatches } from "../plugins/immune-brain/runtime/loop_daemon/discard";
import { driveGate } from "../plugins/immune-brain/runtime/loop_daemon/agent_handlers";
import { createDefaultRelayInputFactory } from "../plugins/immune-brain/runtime/loop_daemon/dispatch";
import { prepareBatchLaneRunState, readAnyBatchRunState, writeBatchLaneRunState } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { reconcileChildSession } from "../plugins/immune-brain/runtime/unattended/child_session_reconciler";
import type { BatchSessionPort } from "../plugins/immune-brain/runtime/unattended/batch_session_port";
import type { SupervisedSessionPort } from "../plugins/immune-brain/runtime/session/supervised_session_port";

setDefaultTimeout(60_000);

const TS = "2026-02-01T00:00:00.000Z";
const ENV = { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" };

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]): string {
	return execFileSync("git", ["-C", dir, "-c", "user.name=T", "-c", "user.email=t@t", ...args], { encoding: "utf8" }).trim();
}

/** A checkout with one commit; the daemon state directory lives under `.imm/state/loop`. */
function checkout(): { root: string; stateDir: string } {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "imm-loop-steering-")));
	roots.push(root);
	mkdirSync(join(root, ".imm"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	writeFileSync(join(root, "base.txt"), "base\n");
	git(root, "init", "-q", "-b", "main");
	git(root, "add", "-A");
	git(root, "commit", "-qm", "init");
	mkdirSync(join(root, ".imm/state/loop"), { recursive: true });
	return { root, stateDir: join(root, ".imm/state/loop") };
}

function seed(stateDir: string, target: string, state: WorkItemState = "triage", extra: Partial<WorkItem> = {}): WorkItem {
	const item: WorkItem = { ...newWorkItem(target, state, TS), ...extra };
	writeWorkItem(stateDir, item);
	return readWorkItem(stateDir, target)!;
}

function mcpFor(root: string, decision: "accept" | "decline" | "cancel" = "accept") {
	const mcp = createMcpRuntime({
		cwd: root,
		env: ENV,
		interactive: true,
		requestConfirmation: async () => ({ decision, requestId: "test-native-steering-1" }),
	});
	mcp.bindClientHandshake({ version: ENV.CLAUDE_CODE_VERSION, interactive: true, protocolVersion: "2025-06-18" });
	return mcp;
}

function toolMeta(root: string, toolCallId: string) {
	return { workspace: root, toolCallId, sessionId: "test-session", taskId: "", interactive: true };
}

function request(stateDir: string, target: string, action: LoopSteeringAction, reason: string | null = null): string {
	const path = writeSteeringRequest(stateDir, {
		contract: LOOP_STEERING_REQUEST_CONTRACT,
		target,
		action,
		reason,
		requested_at: TS,
		confirmation: { tool: STEER_LOOP_WORK_ITEM_TOOL, confirmed_at: TS, confirmation_ref: "pi-confirm-test" },
	});
	return path;
}

function readyTaskEvent(issueNumber: number): E5ReadyTaskEvent {
	return {
		contract: LOOP_DAEMON_EVENT_CONTRACT,
		event_id: `evt-e5-${issueNumber}`,
		kind: "E5_READY_TASK",
		timestamp: TS,
		issue_number: issueNumber,
		title: "Ready",
		body: "Ready for an agent.",
		author: "owner",
		labels: ["ready-for-agent"],
		created_at: TS,
		updated_at: TS,
	};
}

const EMPTY_SNAPSHOT: ObservationInput = { issues: [], pull_requests: [], lane_decisions: [] };

function leaderDeps(input: { root: string; stateDir: string }, overrides: Partial<LeaderDispatchDeps> = {}): LeaderDispatchDeps {
	return {
		root: input.root,
		stateDir: input.stateDir,
		now: TS,
		dry_run: false,
		fingerprint: "sha256:test",
		roles: [],
		guardFacts: {},
		events: [readyTaskEvent(42)],
		candidates: [],
		max_concurrent: 3,
		dispatches_today: 0,
		max_dispatches_per_day: null,
		runNext: async () => [],
		planInitiative: async () => null,
		runKernel: () => ({ exit_code: 1, json: { reason: "kernel_unavailable" } }),
		startSession: async () => ({ completed: false, reason: "session_provider_unavailable" }),
		resolveFacts: async () => ({
			risk: null,
			pending_literal_user: [],
			batch_state: null,
			authority_blockers: [],
		}) as never,
		resumeBatch: () => ({ resumed: false, reason: "batch_unknown" }),
		askOwner: async () => ({ action: "posted", interaction_id: "i-1" }) as never,
		...overrides,
	};
}

describe("S5-AC2: steer_loop_work_item is a privileged Tool on every Host", () => {
	test("the Tool is in PRIVILEGED_OPERATIONS and registered on Claude Code, Antigravity and Pi", () => {
		expect([...PRIVILEGED_OPERATIONS]).toContain(STEER_LOOP_WORK_ITEM_TOOL);
		const antigravityTools = createAntigravityMcpRuntime({ cwd: process.cwd(), env: {} }).listTools();
		expect(antigravityTools.map((tool) => tool.name)).toContain(STEER_LOOP_WORK_ITEM_TOOL);
		for (const tools of [listMcpTools(), antigravityTools]) {
			const tool = tools.find((entry) => entry.name === STEER_LOOP_WORK_ITEM_TOOL);
			expect(tool).toBeDefined();
			expect(tool?.annotations).toEqual({ destructiveHint: true });
			expect(tool?.inputSchema.required).toEqual(["target", "action"]);
			expect(tool?.inputSchema.properties).toHaveProperty("action");
		}
		const piTool = steerLoopWorkItemToolDefinition({
			bindWorkspace: () => undefined,
			runtime: {
				listLoopInteractions: async () => ({}),
				answerLoopInteraction: async () => ({}),
				steerLoopWorkItem: async () => ({}),
			},
		});
		expect(piTool.name).toBe(STEER_LOOP_WORK_ITEM_TOOL);
		expect(Object.keys(piTool.parameters.properties)).toEqual(["target", "action", "reason", "task_id"]);
	});

	test("a confirmed pause is written once and applied on the next tick; resume clears it", async () => {
		const { root, stateDir } = checkout();
		seed(stateDir, "issue-42");

		const paused = (await mcpFor(root).callTool(
			STEER_LOOP_WORK_ITEM_TOOL,
			{ target: "issue-42", action: "pause", reason: "maintenance window" },
			toolMeta(root, "call-steer-pause"),
		)) as { state: string; target: string; action: string; confirmation_ref: string; request_path: string };
		expect(paused).toMatchObject({ state: "steering_requested", target: "issue-42", action: "pause" });
		expect(paused.confirmation_ref).toBeTruthy();
		// One request file, private, carrying the confirmation record.
		const pending = listSteeringRequests(stateDir);
		expect(pending).toHaveLength(1);
		expect(pending[0]!.request).toMatchObject({
			contract: LOOP_STEERING_REQUEST_CONTRACT,
			target: "issue-42",
			action: "pause",
			reason: "maintenance window",
			confirmation: { tool: STEER_LOOP_WORK_ITEM_TOOL },
		});
		expect(statSync(pending[0]!.path).mode & 0o777).toBe(0o600);
		expect(readWorkItem(stateDir, "issue-42")?.paused).toBeUndefined();

		// The daemon applies it on its next tick and removes the request.
		const applied = applySteeringRequests(stateDir, TS);
		expect(applied.applied).toEqual([{ target: "issue-42", action: "pause", state: "triage", paused: true }]);
		expect(listSteeringRequests(stateDir)).toHaveLength(0);
		expect(readWorkItem(stateDir, "issue-42")?.paused).toBe(true);

		// `imm-loop status --json` shows the paused item beside the leader facts.
		const status = await runLoopDaemonCli(["status", "--json"], root, { stateDir, loopConfig: DEFAULT_LOOP_CONFIG });
		expect(status.returncode).toBe(0);
		const projected = JSON.parse(status.stdout) as {
			paused_items: Array<{ target: string; state: string }>;
			leader: { last_wake_at: string | null; wakes_today: number; last_proposal_items: number };
		};
		expect(projected.paused_items).toEqual([{ target: "issue-42", state: "triage", updated_at: TS }]);
		expect(projected.leader).toEqual({ last_wake_at: null, wakes_today: 0, last_proposal_items: 0 });

		request(stateDir, "issue-42", "resume");
		expect(applySteeringRequests(stateDir, TS).applied).toEqual([
			{ target: "issue-42", action: "resume", state: "triage", paused: false },
		]);
		expect(readWorkItem(stateDir, "issue-42")?.paused).toBe(false);
	});

	test("a denied native confirmation writes nothing", async () => {
		const { root, stateDir } = checkout();
		seed(stateDir, "issue-42");
		await expect(
			mcpFor(root, "decline").callTool(
				STEER_LOOP_WORK_ITEM_TOOL,
				{ target: "issue-42", action: "abandon" },
				toolMeta(root, "call-steer-declined"),
			),
		).rejects.toThrow(/user_denied/);
		expect(listSteeringRequests(stateDir)).toHaveLength(0);
		expect(readWorkItem(stateDir, "issue-42")?.state).toBe("triage");
	});

	test("abandon reaches the terminal state and leaves a running Kernel run untouched", async () => {
		const { root, stateDir } = checkout();
		seed(stateDir, "issue-43", "driving", { binding: { plan_digest: "sha256:plan", task_ids: ["task-43"], run_id: "run-43", pr: null } });
		const recordPath = join(root, ".imm/audit/issue-43/run-43/task-record.json");
		mkdirSync(join(root, ".imm/audit/issue-43/run-43"), { recursive: true });
		writeFileSync(recordPath, `${JSON.stringify({ contract: "assurance_kernel/task_record/v1", state: "active" })}\n`);
		const before = readFileSync(recordPath, "utf8");

		await mcpFor(root).callTool(
			STEER_LOOP_WORK_ITEM_TOOL,
			{ target: "issue-43", action: "abandon", reason: "owner dropped this" },
			toolMeta(root, "call-steer-abandon"),
		);
		expect(applySteeringRequests(stateDir, TS).applied).toEqual([
			{ target: "issue-43", action: "abandon", state: "abandoned", paused: false },
		]);
		expect(readWorkItem(stateDir, "issue-43")).toMatchObject({ state: "abandoned", binding: { run_id: "run-43" } });
		// The running Kernel run is not stopped, moved or rewritten.
		expect(readFileSync(recordPath, "utf8")).toBe(before);

		// `abandon` is terminal: a later steer request changes nothing.
		request(stateDir, "issue-43", "resume");
		applySteeringRequests(stateDir, TS);
		expect(readWorkItem(stateDir, "issue-43")?.state).toBe("abandoned");
	});

	test("an unknown target is refused and its request removed", () => {
		const { stateDir } = checkout();
		request(stateDir, "issue-404", "pause");
		expect(applySteeringRequests(stateDir, TS)).toEqual({
			applied: [],
			refused: [{ target: "issue-404", action: "pause", reason: "work_item_unknown" }],
		});
		expect(listSteeringRequests(stateDir)).toHaveLength(0);
	});
});

describe("S5-AC2: a paused or abandoned item yields no candidate", () => {
	test("Tier-1/2 dispatch records skipped with the gate reason", async () => {
		const { root, stateDir } = checkout();
		seed(stateDir, "issue-42", "triage", { paused: true });
		seed(stateDir, "issue-43", "abandoned" as WorkItemState);
		const state = initLoopState();
		saveLoopState(stateDir, state);
		const event42 = readyTaskEvent(42);
		const event43 = readyTaskEvent(43);
		const decision = (event: E5ReadyTaskEvent) => ({
			contract: "assurance_kernel/loop_decision_record/v1" as const,
			decision_id: `dec-${event.event_id}`,
			event_id: event.event_id,
			event_kind: event.kind,
			target: { kind: "issue" as const, id: String(event.issue_number) },
			handler: "enroll_and_drive" as const,
			tier: 2,
			reason: "ready-for-agent with a published plan",
			guards_passed: ["G1"],
			mutations: [],
			dry_run: false,
			recorded_at: TS,
		});

		const result = await dispatchDecisions({
			root,
			stateDir,
			loopConfig: DEFAULT_LOOP_CONFIG,
			events: [event42, event43],
			decisions: [decision(event42), decision(event43)],
			snapshot: EMPTY_SNAPSHOT,
			state,
			gitHubPort: createFakeLoopGitHubPort(),
			guardFacts: {},
			dryRun: false,
			now: TS,
		});

		expect(result.dispatches.map((dispatch) => [dispatch.outcome, dispatch.detail])).toEqual([
			["skipped", "work_item_paused"],
			["skipped", "work_item_abandoned"],
		]);
		expect(result.dispatches.every((dispatch) => dispatch.handler === "enroll_and_drive")).toBe(true);
	});

	test("scheduler admission holds a gated candidate before any slot is taken", () => {
		const scheduled = scheduleLoopWork({
			candidates: [
				{ target_id: "issue-42", handler: "draft_plan", work_item_gate: "work_item_paused" },
				{ target_id: "issue-43", handler: "draft_plan", work_item_gate: "work_item_abandoned" },
			],
			active_leases: [],
			ready_buffer: 0,
			open_daemon_prs: 0,
			limits: { max_concurrent: 3, max_ready_buffer: 5, max_pr_buffer: 5 },
			budget: { ticks_today: 0, dispatches_today: 0, max_ticks_per_day: null, max_dispatches_per_day: null },
		});
		expect(scheduled.dispatched).toEqual([]);
		expect(scheduled.entries.map((entry) => [entry.action, entry.reason])).toEqual([
			["hold", "work_item_paused"],
			["hold", "work_item_abandoned"],
		]);
		// The local daemon-wide pause still holds everything, gate or not.
		expect(
			scheduleLoopWork({
				candidates: [{ target_id: "issue-44", handler: "draft_plan" }],
				active_leases: [],
				ready_buffer: 0,
				open_daemon_prs: 0,
				limits: { max_concurrent: 3, max_ready_buffer: 5, max_pr_buffer: 5 },
				budget: { ticks_today: 0, dispatches_today: 0, max_ticks_per_day: null, max_dispatches_per_day: null },
				paused: true,
			}).guard,
		).toEqual({ id: "G1", detail: "daemon paused" });
	});

	test("leader dispatch refuses a paused target and journals why", async () => {
		const workspace = checkout();
		seed(workspace.stateDir, "issue-42", "triage", { paused: true });
		const results = await applyLeaderProposal([{ target: "issue-42", action: "next", handler: "draft_plan" }], leaderDeps(workspace));
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({ outcome: "rejected", reason: "work_item_paused" });
		// Nothing moved: the item is still the paused triage item it was.
		expect(readWorkItem(workspace.stateDir, "issue-42")).toMatchObject({ state: "triage", paused: true });
	});

	test("the gate never lifts an item above its scheduler class", () => {
		expect(candidatePriority({ target_id: "issue-42", handler: "draft_plan", work_item_gate: "work_item_paused" })).toBe("planning");
		expect(steeringDir("/tmp/state/loop")).toBe("/tmp/state/loop/steering");
	});
});

// Spec loop-leader-uls-alignment D4 / S4-AC1, S4-AC2: steering acts on the item's ULS batch.
const HERDR_ENV = { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "ws-test" } as const;
const BATCH_ID = "batch-steer";
const SLUG = "init-steer";

/** A Herdr-shaped port that proves exit only for keys it owns, and records every stop and close. */
function fakeHerdr(owned: Set<string>) {
	const calls = { stop: [] as string[], close: [] as string[] };
	const port = {
		provider: "herdr",
		protocolVersion: 1,
		probe: async () => ({ ok: true }),
		createSession: async () => ({ ok: false, code: "provider_error", reason: "discard never opens a session" }),
		sendInstruction: async () => ({ ok: false, code: "provider_error", reason: "unused" }),
		awaitTransition: async () => ({ ok: true, transition: "changed", state: "idle", provenance: "detected" }),
		readOutput: async () => ({ ok: true, text: "", source: "visible" }),
		observeState: async () => ({ ok: true, state: "working", provenance: "detected" }),
		stopSession: async (handle: string) => { calls.stop.push(handle); return { ok: true }; },
		closeSession: async () => ({ ok: true }),
		reconcile: async () => ({ ok: true, sessions: [] }),
		findSession: async () => ({ ok: true, not_found: true }),
		closeWithProof: async (handle: string, key: string) => {
			calls.close.push(handle);
			return owned.has(key) ? { ok: true, exited: true, handle, key } : { ok: false, code: "not_owned", reason: `${handle} was not created for ${key}` };
		},
	};
	return { port: port as unknown as SupervisedSessionPort, calls };
}

/** An abandoned item bound to an active two-child batch with a real Lane worktree per child. */
function abandonedBatch(provider: string | null = "herdr") {
	const workspace = checkout();
	const { root, stateDir } = workspace;
	const base = git(root, "rev-parse", "HEAD");
	git(root, "branch", `imm/${SLUG}`, base);
	const lanes = ["child-1", "child-2"].map((task) => {
		const path = join(root, "..", `${task}-${BATCH_ID}`);
		const branch = `imm-lane/${SLUG}/${task}`;
		git(root, "worktree", "add", "-q", "-b", branch, path);
		roots.push(path);
		return { task, path, branch, key: `imm-${task}-g1-${task.slice(-1).repeat(12)}`, handle: `h-${task}` };
	});
	const kids = lanes.map((l) => ({ task_id: l.task, slice_id: l.task, blocked_by: [] as string[], status: "enrollable" as const, reason: null,
		intent_path: `docs/plans/${l.task}.intent.json`, intent_revision: 1, intent_content_hash: "0".repeat(64) }));
	const record = prepareBatchLaneRunState({ batch_id: BATCH_ID, initiative_slug: SLUG, children: kids as never, plan_digest: "d".repeat(64), base_head: base,
		confirmation_time: TS, budget: { max_children: 2, qa_failure_limit: 3 }, max_parallel: 2, now: TS, session_provider: provider });
	record.branch = `refs/heads/imm/${SLUG}`;
	record.batch_state = "running";
	record.children = lanes.map((l) => ({ task_id: l.task, slice_id: l.task, blocked_by: [], state: "enrolled", reason: null, commit: null,
		lane: { path: l.path, branch: l.branch, base_head: base, lane_commit: base }, qa_failures: 0,
		session: { key: l.key, generation: 1, baseline: "r", handle: l.handle, entry_submitted: true, attention: null, no_progress: 0, exit_proof: null } }) as never);
	writeBatchLaneRunState(root, record);
	seed(stateDir, SLUG, "abandoned" as WorkItemState, { binding: { ...newWorkItem(SLUG, "triage", TS).binding, batch_id: BATCH_ID, initiative_slug: SLUG, task_ids: lanes.map((l) => l.task) } });
	const refs = () => git(root, "for-each-ref", "--format=%(refname:short)", "refs/heads/imm-lane", "refs/heads/imm").split("\n").filter(Boolean).sort();
	return { ...workspace, lanes, refs };
}

describe("S4-AC1: abandon discards the item's batch on the tick", () => {
	test("abandon applies, then the tick proof-closes both sessions, removes both Lanes and imm/<slug>, and the item stays abandoned", async () => {
		const fx = abandonedBatch();
		const { port, calls } = fakeHerdr(new Set(fx.lanes.map((l) => l.key)));
		const entries = await discardAbandonedBatches({ root: fx.root, stateDir: fx.stateDir, now: TS, host: "claude-code", env: { ...HERDR_ENV }, createPort: () => port });
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ target: SLUG, batch_id: BATCH_ID, batch_state: "discarded", retained: [] });
		expect([...entries[0]!.removed].sort()).toEqual(["child-1", "child-2"]);
		expect(calls.close.sort()).toEqual(["h-child-1", "h-child-2"]);
		expect(fx.lanes.map((l) => existsSync(l.path))).toEqual([false, false]);
		expect(fx.refs()).toEqual([]);
		expect(readAnyBatchRunState(fx.root, BATCH_ID)!.batch_state).toBe("discarded");
		expect(readWorkItem(fx.stateDir, SLUG)?.state).toBe("abandoned");
		// A terminal record is never touched again: the next tick reports nothing and closes nothing.
		const again = await discardAbandonedBatches({ root: fx.root, stateDir: fx.stateDir, now: TS, host: "claude-code", env: { ...HERDR_ENV }, createPort: () => port });
		expect(again).toEqual([]);
		expect(calls.close).toHaveLength(2);
	});

	test("a session whose ownership does not match is retained with a named condition, and the next tick retries only that Lane", async () => {
		const fx = abandonedBatch();
		const [one, two] = fx.lanes as [typeof fx.lanes[number], typeof fx.lanes[number]];
		const first = fakeHerdr(new Set([one.key]));
		const [partial] = await discardAbandonedBatches({ root: fx.root, stateDir: fx.stateDir, now: TS, host: "claude-code", env: { ...HERDR_ENV }, createPort: () => first.port });
		expect(partial).toMatchObject({ batch_state: "discarding", removed: ["child-1"] });
		expect(partial!.retained).toHaveLength(1);
		expect(partial!.retained[0]).toMatchObject({ task_id: "child-2" });
		expect(partial!.retained[0]!.condition).toContain("not_owned");
		// Child 2's Lane and the shared imm/<slug> stay.
		expect(existsSync(two.path)).toBe(true);
		expect(fx.refs()).toEqual([two.branch, `imm/${SLUG}`].sort());
		expect(readAnyBatchRunState(fx.root, BATCH_ID)!.batch_state).toBe("discarding");

		const second = fakeHerdr(new Set([two.key]));
		const [done] = await discardAbandonedBatches({ root: fx.root, stateDir: fx.stateDir, now: TS, host: "claude-code", env: { ...HERDR_ENV }, createPort: () => second.port });
		expect(done).toMatchObject({ batch_state: "discarded", retained: [] });
		expect(second.calls.close).toEqual(["h-child-2"]);
		expect(fx.refs()).toEqual([]);
	});

	test("an unusable session provider retains every session-bearing Lane instead of guessing", async () => {
		const fx = abandonedBatch();
		const { port, calls } = fakeHerdr(new Set(fx.lanes.map((l) => l.key)));
		// Outside Herdr the recorded provider cannot be opened.
		const [entry] = await discardAbandonedBatches({ root: fx.root, stateDir: fx.stateDir, now: TS, host: "claude-code", env: {}, createPort: () => port });
		expect(entry).toMatchObject({ batch_state: "discarding", removed: [] });
		expect(entry!.retained.map((r) => r.task_id).sort()).toEqual(["child-1", "child-2"]);
		expect(entry!.retained[0]!.condition).toContain("HERDR_ENV");
		expect(calls.close).toEqual([]);
		expect(fx.lanes.map((l) => existsSync(l.path))).toEqual([true, true]);
		expect(fx.refs()).toContain(`imm/${SLUG}`);
	});

	test("a non-abandoned item's batch is never discarded", async () => {
		const fx = abandonedBatch();
		writeWorkItem(fx.stateDir, { ...readWorkItem(fx.stateDir, SLUG)!, state: "driving" as WorkItemState, paused: true });
		const { port, calls } = fakeHerdr(new Set(fx.lanes.map((l) => l.key)));
		expect(await discardAbandonedBatches({ root: fx.root, stateDir: fx.stateDir, now: TS, host: "claude-code", env: { ...HERDR_ENV }, createPort: () => port })).toEqual([]);
		expect(calls.close).toEqual([]);
		expect(readAnyBatchRunState(fx.root, BATCH_ID)!.batch_state).toBe("running");
	});
});

describe("S4-AC2: pause holds the item's batch and resume exempts one stall judgment", () => {
	const withBatch = (extra: Partial<WorkItem> = {}) => {
		const { stateDir, root } = checkout();
		const item = seed(stateDir, "issue-60", "driving" as WorkItemState, { binding: { ...newWorkItem("issue-60", "triage", TS).binding, batch_id: BATCH_ID }, ...extra });
		return { stateDir, root, item };
	};

	test("a paused item's drive pass advances nothing and a resumed one is exempt exactly once", () => {
		const { stateDir } = withBatch();
		request(stateDir, "issue-60", "pause");
		applySteeringRequests(stateDir, TS);
		expect(readWorkItem(stateDir, "issue-60")).toMatchObject({ paused: true, resume_pending: false });
		// Paused: the drive pass is skipped (no advanceLanes), and the exemption is not spent.
		expect(driveGate(stateDir, "issue-60", TS)).toMatchObject({ run: false, result: { reason: "lane running", paused: true, batch_id: BATCH_ID } });

		request(stateDir, "issue-60", "resume");
		applySteeringRequests(stateDir, TS);
		expect(readWorkItem(stateDir, "issue-60")).toMatchObject({ paused: false, resume_pending: true });
		expect(driveGate(stateDir, "issue-60", TS)).toEqual({ run: true, stall_exempt: true });
		expect(driveGate(stateDir, "issue-60", TS)).toEqual({ run: true, stall_exempt: false });
		expect(readWorkItem(stateDir, "issue-60")?.resume_pending).toBe(false);
	});

	test("a resume on an item with no batch owes nothing, and a re-pause withdraws the debt", () => {
		const bare = checkout();
		seed(bare.stateDir, "issue-61", "driving" as WorkItemState, { paused: true });
		request(bare.stateDir, "issue-61", "resume");
		applySteeringRequests(bare.stateDir, TS);
		expect(readWorkItem(bare.stateDir, "issue-61")).toMatchObject({ paused: false, resume_pending: false });
		expect(takeResumeExemption(bare.stateDir, "issue-61", TS)).toBe(false);

		const { stateDir } = withBatch({ paused: true });
		request(stateDir, "issue-60", "resume");
		applySteeringRequests(stateDir, TS);
		request(stateDir, "issue-60", "pause");
		applySteeringRequests(stateDir, TS);
		expect(readWorkItem(stateDir, "issue-60")).toMatchObject({ paused: true, resume_pending: false });
	});

	test("an abandoned item is refused by the drive gate", () => {
		const { stateDir } = withBatch({ state: "abandoned" as WorkItemState });
		expect(driveGate(stateDir, "issue-60", TS)).toMatchObject({ run: false, result: { settled: false, batch_id: BATCH_ID } });
		expect(readWorkItem(stateDir, "issue-60")?.state).toBe("abandoned");
	});

	test("a relayed decision for a paused item's batch is recorded but its advance is skipped", async () => {
		const { stateDir, root } = withBatch({ paused: true });
		const input = createDefaultRelayInputFactory(root, "issue-60", { laneRuntime: (() => { throw new Error("unused"); }) as never, stateDir })("replan" as never, "r", { option_id: "replan" } as never);
		expect(await input.advance!(BATCH_ID)).toMatchObject({ ok: true, skipped: "work_item_paused", batch_id: BATCH_ID });
	});

	/** An idle session at an unchanged baseline under the parent_relayed rule, behind a port that counts proofs. */
	function relayedIdle() {
		const closes: string[] = [];
		const opens: string[] = [];
		const port = {
			provider: "fake",
			find: async () => ({ ok: true as const, handle: "h-1" }),
			observe: async () => ({ ok: true as const, state: "idle" as const }),
			resume: async () => ({ ok: true as const, entry_submitted: true as const }),
			send: async () => ({ ok: true as const, state: "idle" as const }),
			stop: async () => ({ ok: true as const }),
			closeWithProof: async (handle: string, key: string) => { closes.push(handle); return { ok: true as const, exited: true as const, handle, key }; },
			open: async (input: { key: string }) => { opens.push(input.key); return { ok: true as const, handle: "h-2", entry_submitted: true as const }; },
		} as unknown as BatchSessionPort;
		const session = { key: "imm-child-1-g1-111111111111", generation: 1, baseline: "r1", handle: "h-1", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null };
		const base = { port, batchId: BATCH_ID, taskId: "child-1", session, kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed" as const, entry: "drive child-1", laneCwd: "/tmp/lane" };
		return { base, closes, opens };
	}

	test("the first tick after resume holds an idle session unchanged, and the second judges it by the parent_relayed rule", async () => {
		const { base, closes, opens } = relayedIdle();
		const exempt = await reconcileChildSession({ ...base, stallExempt: true });
		expect(exempt.action).toBe("held");
		expect(exempt.session).toMatchObject({ generation: 1, no_progress: 0, handle: "h-1" });
		expect(closes).toEqual([]);
		expect(opens).toEqual([]);

		const judged = await reconcileChildSession({ ...base });
		expect(judged.action).toBe("rotated");
		expect(judged.session).toMatchObject({ generation: 2, no_progress: 1 });
		expect(closes).toEqual(["h-1"]);
	});

	test("an exited session observed on the exempt tick is still handled as exited", async () => {
		const { base, closes } = relayedIdle();
		(base.port as { observe: unknown }).observe = async () => ({ ok: true as const, state: "exited" as const });
		const handled = await reconcileChildSession({ ...base, stallExempt: true });
		expect(handled.action).toBe("rotated");
		expect(closes).toEqual(["h-1"]);
	});
});
