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
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
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
	writeWorkItem,
	type WorkItem,
	type WorkItemState,
} from "../plugins/immune-brain/runtime/loop_daemon/work_items";

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
