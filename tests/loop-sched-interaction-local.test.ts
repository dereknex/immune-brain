// Spec loop-agent-scheduling S4 / D4, BR-SCN-2, BR-DEC-7 (S4-AC1).
//
// The `local` Interaction channel: the daemon writes one request file per
// interaction under `.imm/state/loop/interactions/`, a Host session lists the
// pending requests through `loop_interactions`, and one answer recorded by the
// privileged `answer_loop_interaction` under its native confirmation is applied
// through the Lane decision relay. An answer file without that confirmation
// record is ignored, an answer bound to a record revision that moved is refused,
// and a `plan_approval` is answered by the user's own `drive` entry instead.

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpRuntime, listMcpTools } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { DEFAULT_LOOP_CONFIG, resolveConfig } from "../plugins/immune-brain/runtime/config/layered_config";
import { listPendingLoopInteractions } from "../plugins/immune-brain/runtime/host-core/loop_interactions";
import { readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage";
import type { relayLaneDecision } from "../plugins/immune-brain/runtime/unattended/lane_decision";
import type { RelayInputFactory } from "../plugins/immune-brain/runtime/loop_daemon/decision_relay";
import {
	applyLocalLaneDecisionAnswers,
	createLocalInteractionChannel,
	laneDecisionInteractionRequest,
	localDecisionAuthorityRoot,
	localDecisionRecordRevision,
	localInteractionsDir,
	loopInteractionStateDir,
	readLocalAnswer,
	readLocalRequest,
	writeLocalAnswer,
} from "../plugins/immune-brain/runtime/loop_daemon/interaction/local_channel";
import { askOwnerQuestion } from "../plugins/immune-brain/runtime/loop_daemon/replan";
import { dispatchDecisions } from "../plugins/immune-brain/runtime/loop_daemon/dispatch";
import { initLoopState } from "../plugins/immune-brain/runtime/loop_daemon/state";
import { listWaitingStatus } from "../plugins/immune-brain/runtime/loop_daemon/waiting";
import { prepareBatchLaneRunState } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { loopInteractionToolDefinitions } from "../plugins/immune-brain/.pi-extension/imm-canary-work";
import { enrollTaskForTest } from "./helpers/kernel-enroll";

setDefaultTimeout(60_000);

const TASK = "loop-sched-local-task";
const OPTION = "authorize";
const ENV = { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" };
const TS = "2026-01-01T00:00:00.000Z";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]): string {
	return execFileSync("git", ["-C", dir, "-c", "user.name=T", "-c", "user.email=t@t", ...args], { encoding: "utf8" }).trim();
}

function verification(): string {
	return JSON.stringify({
		contract: "assurance_kernel/verification_descriptor/v2",
		command: { executable: "sh", argv: ["-c", "exit 0"], cwd: ".", timeout_ms: 60_000, max_output_bytes: 4_096 },
		environment: { prepare: null, writable_paths: [] },
	});
}

/** A checkout with one committed project config file, which the resolver only honours when Git tracks it. */
function checkout(loopConfig?: unknown): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "imm-loop-local-")));
	roots.push(root);
	mkdirSync(join(root, ".imm"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	writeFileSync(join(root, "base.txt"), "base\n");
	if (loopConfig !== undefined)
		writeFileSync(
			join(root, ".imm/config.json"),
			JSON.stringify({ contract: "immune_brain/project_config/v2", loop: loopConfig }),
		);
	git(root, "init", "-q", "-b", "main");
	git(root, "add", "-A");
	git(root, "commit", "-qm", "init");
	return root;
}

/** The same checkout, enrolled at the Kernel so a request can bind a real record revision. */
async function enrolledCheckout(): Promise<{ root: string; recordRevision: string }> {
	const root = checkout({ interaction: { channel: "local" } });
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	writeFileSync(
		join(root, "docs/plans", `${TASK}.intent.json`),
		JSON.stringify({
			contract: "assurance_kernel/task_intent/v1",
			task_id: TASK,
			owner: "user",
			goal: "a pending Lane decision is answerable from the local Host session",
			acceptance: [{ id: "S4-AC1", assertion: "the pending request is answered", verification: verification() }],
			scope_hint: ["docs/plans"],
			risk: "critical",
			revision: 1,
		}),
	);
	git(root, "add", "-A");
	git(root, "commit", "-qm", "intent");
	await enrollTaskForTest(root, TASK);
	const revision = readTaskRecordRaw(root, TASK).revision;
	if (!revision || revision === "missing") throw new Error("the fixture task did not enroll");
	return { root, recordRevision: revision };
}

function daemonChannel(root: string) {
	return createLocalInteractionChannel({ stateDir: loopInteractionStateDir(root) });
}

function laneRequest(recordRevision: string) {
	return laneDecisionInteractionRequest({
		task_id: TASK,
		run_id: `run-${TASK}`,
		record_revision: recordRevision,
		question: "The Lane needs your decision on the breaking Intent revision.",
		options: [{ id: OPTION, label: "Authorize the revision" }],
	});
}

/** The shared MCP tool runtime, trusted and interactive as a connected Host session. */
function mcpFor(root: string, decision: "accept" | "decline" | "cancel" = "accept") {
	const mcp = createMcpRuntime({
		cwd: root,
		env: ENV,
		interactive: true,
		requestConfirmation: async () => ({ decision, requestId: "test-native-confirmation-1" }),
	});
	mcp.bindClientHandshake({ version: ENV.CLAUDE_CODE_VERSION, interactive: true, protocolVersion: "2025-06-18" });
	return mcp;
}

function toolMeta(root: string, toolCallId: string) {
	return { workspace: root, toolCallId, sessionId: "test-session", taskId: TASK, interactive: true };
}

describe("loop.interaction.channel", () => {
	test("defaults to github, accepts local, refuses any other value as config_invalid", () => {
		expect((resolveConfig(checkout()).loop.value as { interaction: { channel: string } }).interaction.channel).toBe("github");
		const local = resolveConfig(checkout({ interaction: { channel: "local" } }));
		expect(local.loop.valid).toBe(true);
		expect((local.loop.value as { interaction: { channel: string } }).interaction.channel).toBe("local");
		const invalid = resolveConfig(checkout({ interaction: { channel: "slack" } }));
		expect(invalid.loop.valid).toBe(false);
		const diagnostic = invalid.diagnostics.find((entry) => entry.key_path === "loop.interaction.channel");
		expect(diagnostic?.code).toBe("config_invalid");
	});
});

/**
 * A single-task Lane owns the decision's TaskRecord: the batch record binds the
 * Lane directory, and the Lane's own store carries the revision the daemon
 * published. The checkout itself holds no record for the task.
 */
async function laneOwnedCheckout(): Promise<{ root: string; lanePath: string; laneRevision: string }> {
	const root = checkout({ interaction: { channel: "local" } });
	const batchId = "batch-s4-local";
	const lanePath = join(root, ".imm/batches", batchId, "lanes", TASK);
	mkdirSync(join(lanePath, "docs/plans"), { recursive: true });
	writeFileSync(join(lanePath, "base.txt"), "base\n");
	writeFileSync(
		join(lanePath, "docs/plans", `${TASK}.intent.json`),
		JSON.stringify({
			contract: "assurance_kernel/task_intent/v1",
			task_id: TASK,
			owner: "user",
			goal: "a Lane decision is answered from the store that owns it",
			acceptance: [{ id: "S4-AC1", assertion: "the Lane's revision is the binding", verification: verification() }],
			scope_hint: ["docs/plans"],
			risk: "critical",
			revision: 1,
		}),
	);
	git(lanePath, "init", "-q", "-b", "main");
	git(lanePath, "add", "-A");
	git(lanePath, "commit", "-qm", "lane intent");
	await enrollTaskForTest(lanePath, TASK);
	const head = git(root, "rev-parse", "HEAD");
	const now = new Date().toISOString();
	const record = prepareBatchLaneRunState({
		plan_source: "single_task",
		batch_id: batchId,
		initiative_slug: TASK,
		children: [
			{
				task_id: TASK,
				slice_id: "S4",
				blocked_by: [],
				status: "ready",
				reason: null,
				intent_path: `docs/plans/${TASK}.intent.json`,
				intent_revision: 1,
				intent_content_hash: `sha256:${"a".repeat(64)}`,
			},
		] as never,
		plan_digest: `sha256:${"b".repeat(64)}`,
		base_head: head,
		confirmation_time: now,
		budget: { max_children: 1, qa_failure_limit: 1 },
		max_parallel: 1,
		now,
	});
	mkdirSync(join(root, ".imm/state/batches"), { recursive: true });
	writeFileSync(
		join(root, ".imm/state/batches", `${batchId}.json`),
		`${JSON.stringify({
			...record,
			batch_state: "running",
			children: record.children.map((child) => ({
				...child,
				state: "enrolled",
				lane: { path: lanePath, branch: `imm/${TASK}`, base_head: head, lane_commit: null, run_id: `run-${TASK}` },
			})),
		}, null, 2)}\n`,
	);
	const laneRevision = readTaskRecordRaw(lanePath, TASK).revision;
	if (!laneRevision || laneRevision === "missing") throw new Error("the Lane fixture task did not enroll");
	return { root, lanePath, laneRevision };
}

describe("local Interaction channel", () => {
	test("a Lane decision is checked against the Lane's record, not the checkout's", async () => {
		const { root, lanePath, laneRevision } = await laneOwnedCheckout();
		expect(localDecisionAuthorityRoot(root, TASK)).toBe(lanePath);
		expect(localDecisionRecordRevision(root, TASK)).toBe(laneRevision);
		// The checkout holds no record for this task: reading it would refuse the
		// answer as stale, which is the regression this pins.
		expect(readTaskRecordRaw(root, TASK).revision).not.toBe(laneRevision);

		const stateDir = loopInteractionStateDir(root);
		const request = laneRequest(laneRevision);
		expect(await daemonChannel(root).post(request)).toBe("posted");

		const answered = (await mcpFor(root).callTool(
			"answer_loop_interaction",
			{ task_id: TASK, interaction_id: request.interaction_id, answer: OPTION },
			toolMeta(root, "call-lane-answer"),
		)) as { state: string };
		expect(answered.state).toBe("interaction_answered");
		expect((await daemonChannel(root).poll(request.interaction_id)).state).toBe("answered");

		const relayed: string[] = [];
		const outcomes = await applyLocalLaneDecisionAnswers({
			stateDir,
			guardFacts: {},
			recordRevision: (taskId) => localDecisionRecordRevision(root, taskId),
			relayInputFactory: () => ((operation: string) => ({
				root,
				taskId: TASK,
				operation,
				project: async () => ({}),
				apply: async () => ({ state: "authorized" }),
				supervisor: {},
				parentHost: "pi",
				pluginDir: root,
				waitMs: 1,
			})) as unknown as RelayInputFactory<unknown>,
			relayDecision: (async (input: { operation: string }) => {
				relayed.push(input.operation);
				return { relayed: true as const, result: {}, lane_relay: { batch_id: "batch-s4-local", operation: input.operation, applied: true, rebound: false, lane_supervision: {} } };
			}) as unknown as typeof relayLaneDecision,
		});
		expect(outcomes.map((outcome) => outcome.action)).toEqual(["relayed"]);
		expect(relayed).toEqual(["request_authorization"]);
	});

	test("a pending Lane decision is listed and a confirmed answer is applied through the relay", async () => {
		const { root, recordRevision } = await enrolledCheckout();
		const stateDir = loopInteractionStateDir(root);
		const channel = daemonChannel(root);
		expect(await channel.post(laneRequest(recordRevision))).toBe("posted");
		expect(statSync(join(localInteractionsDir(stateDir), `lane-decision:run-${TASK}:${recordRevision}.json`)).mode & 0o777).toBe(0o600);

		// The Host session sees exactly this request, and can answer it.
		const mcp = mcpFor(root);
		expect(listMcpTools().find((tool) => tool.name === "answer_loop_interaction")?.annotations).toEqual({ destructiveHint: true });
		const listed = (await mcp.callTool("loop_interactions", { task_id: TASK }, toolMeta(root, "call-list"))) as {
			contract: string;
			pending_count: number;
			pending: Array<{ interaction_id: string; kind: string; answerable: boolean; answered: boolean; options?: string[] }>;
		};
		expect(listed.contract).toBe("immune_brain/loop_interactions/v1");
		expect(listed.pending_count).toBe(1);
		expect(listed.pending[0]).toMatchObject({ kind: "lane_decision", answerable: true, answered: false, options: [OPTION] });

		const answered = (await mcp.callTool(
			"answer_loop_interaction",
			{ task_id: TASK, interaction_id: listed.pending[0]!.interaction_id, answer: OPTION },
			toolMeta(root, "call-answer"),
		)) as { state: string; interaction_id: string; answer: string; next: string };
		expect(answered.state).toBe("interaction_answered");
		expect(answered.answer).toBe(OPTION);
		// The answer carries the privileged tool's confirmation record, and only that.
		const record = readLocalAnswer(stateDir, listed.pending[0]!.interaction_id);
		expect(record?.confirmation.tool).toBe("answer_loop_interaction");
		expect(record?.confirmation.confirmation_ref).toBeTruthy();
		expect((await channel.poll(listed.pending[0]!.interaction_id)).state).toBe("answered");
		expect(listPendingLoopInteractions(root).pending[0]).toMatchObject({ answered: true });

		// The daemon applies it through the same relay a GitHub reply uses.
		const relayed: Array<{ operation: string; expectedRecordRevision?: string }> = [];
		const relayDecision = (async (input: { operation: string; expectedRecordRevision?: string }) => {
			relayed.push({ operation: input.operation, expectedRecordRevision: input.expectedRecordRevision });
			return {
				relayed: true as const,
				result: { state: "authorized" },
				lane_relay: { batch_id: "batch-1", operation: input.operation, applied: true, rebound: false, lane_supervision: {} },
			};
		}) as unknown as typeof relayLaneDecision;
		const relayInputFactory = ((operation: string, revision: string) => ({
			root,
			taskId: TASK,
			operation,
			expectedRecordRevision: revision,
			project: async () => ({}),
			apply: async () => ({ state: "authorized" }),
			supervisor: {},
			parentHost: "pi",
			pluginDir: root,
			waitMs: 1,
		})) as unknown as RelayInputFactory<unknown>;

		const outcomes = await applyLocalLaneDecisionAnswers({
			stateDir,
			guardFacts: { allowed_actors: [], daemon_identity: "imm-loop" },
			recordRevision: () => recordRevision,
			relayInputFactory: () => relayInputFactory,
			relayDecision,
		});
		expect(outcomes).toHaveLength(1);
		expect(outcomes[0]!.action).toBe("relayed");
		expect(relayed).toEqual([{ operation: "request_authorization", expectedRecordRevision: recordRevision }]);
		// The answer is consumed once: the retired request is no longer pending,
		// so the next tick cannot relay it a second time.
		expect(readLocalRequest(stateDir, listed.pending[0]!.interaction_id)).toBeNull();
		expect(listPendingLoopInteractions(root).pending).toEqual([]);
	});

	test("an answer file without the privileged tool's confirmation record is ignored", async () => {
		const { root, recordRevision } = await enrolledCheckout();
		const stateDir = loopInteractionStateDir(root);
		const request = laneRequest(recordRevision);
		await daemonChannel(root).post(request);
		// A file written by hand, or by anything that did not open the native gate.
		writeFileSync(
			join(localInteractionsDir(stateDir), `${request.interaction_id}.answer.json`),
			JSON.stringify({
				contract: "immune_brain/interaction_answer/v1",
				interaction_id: request.interaction_id,
				kind: request.kind,
				subject: request.subject,
				binding: request.binding,
				value: OPTION,
				actor: "literal-user",
				answered_at: new Date().toISOString(),
			}),
		);
		expect(readLocalAnswer(stateDir, request.interaction_id)).toBeNull();
		expect((await daemonChannel(root).poll(request.interaction_id)).state).toBe("pending");
		expect(listPendingLoopInteractions(root).pending[0]!.answered).toBe(false);

		const outcomes = await applyLocalLaneDecisionAnswers({
			stateDir,
			guardFacts: {},
			recordRevision: () => recordRevision,
			relayInputFactory: () => undefined,
		});
		expect(outcomes).toEqual([]);
	});

	test("an answer to a stale request is refused", async () => {
		const { root, recordRevision } = await enrolledCheckout();
		const stateDir = loopInteractionStateDir(root);
		const request = laneRequest("record-revision-that-moved");
		await daemonChannel(root).post(request);

		const mcp = mcpFor(root);
		await expect(
			mcp.callTool(
				"answer_loop_interaction",
				{ task_id: TASK, interaction_id: request.interaction_id, answer: OPTION },
				toolMeta(root, "call-stale"),
			),
		).rejects.toThrow(/interaction_stale/);
		expect(readLocalAnswer(stateDir, request.interaction_id)).toBeNull();

		// The channel agrees, and retires the request rather than collecting the answer.
		const staleChannel = createLocalInteractionChannel({
			stateDir,
			binding: () => ({ record_revision: recordRevision }),
		});
		expect((await staleChannel.poll(request.interaction_id)).state).toBe("stale");
		expect(readLocalRequest(stateDir, request.interaction_id)).toBeNull();
	});

	test("a declined native confirmation writes no answer", async () => {
		const { root, recordRevision } = await enrolledCheckout();
		const stateDir = loopInteractionStateDir(root);
		const request = laneRequest(recordRevision);
		await daemonChannel(root).post(request);
		const mcp = mcpFor(root, "decline");
		await expect(
			mcp.callTool(
				"answer_loop_interaction",
				{ task_id: TASK, interaction_id: request.interaction_id, answer: OPTION },
				toolMeta(root, "call-declined"),
			),
		).rejects.toThrow(/user_denied/);
		expect(readLocalAnswer(stateDir, request.interaction_id)).toBeNull();
		expect((await daemonChannel(root).poll(request.interaction_id)).state).toBe("pending");
	});

	test("a plan_approval is never answered by the tool and points to drive", async () => {
		const { root } = await enrolledCheckout();
		const stateDir = loopInteractionStateDir(root);
		const channel = daemonChannel(root);
		const request = {
			contract: "immune_brain/interaction_request/v1" as const,
			interaction_id: "plan-approval:issue-7:digest",
			kind: "plan_approval" as const,
			subject: { issue: 7, task_id: TASK },
			binding: { plan_digest: "sha256:plan" },
			prompt: "Approve the published plan.",
			answer: "approve_digest" as const,
			authority: "literal_user" as const,
		};
		expect(await channel.post(request)).toBe("notice_only");
		const listed = listPendingLoopInteractions(root).pending[0]!;
		expect(listed.answerable).toBe(false);
		expect(listed.local_action).toContain("drive");

		await expect(
			mcpFor(root).callTool(
				"answer_loop_interaction",
				{ interaction_id: request.interaction_id, answer: "sha256:plan" },
				toolMeta(root, "call-plan"),
			),
		).rejects.toThrow(/answer_with_drive/);
		expect(readLocalAnswer(stateDir, request.interaction_id)).toBeNull();
	});
});

describe("Pi tool registration", () => {
	test("registers the two local Interaction tools against the shared runtime", async () => {
		const bound: string[] = [];
		const calls: Array<{ interaction_id: string; answer: string; meta: { toolCallId: string; workspace?: string; interactive?: boolean } }> = [];
		const host = {
			bindWorkspace: (cwd: string) => bound.push(cwd),
			runtime: {
				listLoopInteractions: async (taskId?: string) => ({ contract: "immune_brain/loop_interactions/v1", pending: [], task_id: taskId }),
				answerLoopInteraction: async (
					interaction_id: string,
					answer: string,
					meta: { toolCallId: string; workspace?: string; interactive?: boolean },
				) => {
					calls.push({ interaction_id, answer, meta });
					return { state: "interaction_answered", interaction_id };
				},
			},
		} as unknown as Parameters<typeof loopInteractionToolDefinitions>[0];
		const tools = loopInteractionToolDefinitions(host);
		expect(tools.map((tool) => tool.name)).toEqual(["loop_interactions", "answer_loop_interaction"]);

		const ctx = { cwd: "/work/tree", mode: "tui", sessionManager: { getSessionId: () => "session-1" } };
		const answerTool = tools[1]!;
		const result = (await answerTool.execute(
			"tool-call-1",
			{ interaction_id: "lane-decision:run:rev", answer: OPTION, task_id: TASK },
			undefined,
			undefined,
			ctx as never,
		)) as { content: Array<{ text: string }> };
		expect(JSON.parse(result.content[0]!.text).state).toBe("interaction_answered");
		expect(calls).toEqual([
			{
				interaction_id: "lane-decision:run:rev",
				answer: OPTION,
				meta: { sessionId: "session-1", toolCallId: "tool-call-1", workspace: "/work/tree", taskId: TASK, interactive: true, signal: undefined },
			},
		]);
		expect(bound).toEqual(["/work/tree"]);
		// A non-TUI session cannot show the Host's native confirmation, so it refuses.
		await expect(
			answerTool.execute("tool-call-2", { interaction_id: "x", answer: OPTION }, undefined, undefined, { ...ctx, mode: "print" } as never),
		).rejects.toThrow(/native confirmation/);
	});
});

// S4-AC2: the local channel stores the same context pack the GitHub channel
// renders, `ask_owner` annotates a pending `literal_user` request in place, a
// new advisory question supersedes the pending one, and status shows a pointer.
const CONTEXT = {
	blocked_on: "the Lane waits on a decision only you can make",
	tried: ["relayed the question once"],
	options: [{ id: OPTION, label: "Authorize", consequence: "the revision is applied" }],
	evidence: [{ label: "run", ref: "https://example.test/runs/4" }],
};

describe("local interaction context and waiting pointers (S4-AC2)", () => {
	test("stores the context pack and returns it from loop_interactions", async () => {
		const root = checkout({ interaction: { channel: "local" } });
		const stateDir = loopInteractionStateDir(root);
		const request = { ...laneRequest("rev-ctx"), context: CONTEXT };
		expect(await createLocalInteractionChannel({ stateDir }).post(request)).toBe("posted");

		expect(readLocalRequest(stateDir, request.interaction_id)?.context).toEqual(CONTEXT);
		expect(listPendingLoopInteractions(root, TASK).pending[0]?.context).toEqual(CONTEXT);
	});

	test("annotates a pending lane_decision in place and still applies the owner's answer", async () => {
		const root = checkout({ interaction: { channel: "local" } });
		const stateDir = loopInteractionStateDir(root);
		const request = laneRequest("rev-annotate");
		const channel = createLocalInteractionChannel({
			stateDir,
			binding: () => ({ record_revision: "rev-annotate" }),
		});
		expect(await channel.post(request)).toBe("posted");

		const asked = await askOwnerQuestion(
			{
				stateDir,
				now: TS,
				target: `lane-${TASK}`,
				channel,
				pending_literal_user: [{ interaction_id: request.interaction_id, kind: "lane_decision" }],
			},
			{ subject: request.subject, context: CONTEXT },
		);
		expect(asked.action).toBe("annotated");
		expect(asked.interaction_id).toBe(request.interaction_id);

		// The rewrite keeps the request's identity and answer semantics.
		const stored = readLocalRequest(stateDir, request.interaction_id)!;
		expect(stored).toMatchObject({
			interaction_id: request.interaction_id,
			kind: "lane_decision",
			binding: { record_revision: "rev-annotate" },
			answer: "choice",
			context: CONTEXT,
		});
		// A second `ask_owner` for the same subject annotates rather than duplicates.
		expect(listPendingLoopInteractions(root, TASK).pending_count).toBe(1);

		writeLocalAnswer(stateDir, {
			interaction_id: request.interaction_id,
			kind: "lane_decision",
			subject: request.subject,
			binding: { record_revision: "rev-annotate" },
			value: OPTION,
			confirmation: { tool: "answer_loop_interaction", confirmed_at: TS, confirmation_ref: "call-annotate" },
		});
		expect(await channel.poll(request.interaction_id)).toMatchObject({ state: "answered", value: OPTION });
	});

	test("supersedes a pending advisory request but never a literal_user one", async () => {
		const root = checkout({ interaction: { channel: "local" } });
		const stateDir = loopInteractionStateDir(root);
		const channel = createLocalInteractionChannel({ stateDir });
		const advisory = (id: string, prompt: string) => ({
			contract: "immune_brain/interaction_request/v1" as const,
			interaction_id: id,
			kind: "escalation" as const,
			subject: { issue: 42 },
			binding: {},
			prompt,
			answer: "none" as const,
			authority: "advisory" as const,
			context: CONTEXT,
		});
		await channel.post(advisory("escalation:first", "first question"));
		await channel.post(advisory("escalation:second", "second question"));

		expect(readLocalRequest(stateDir, "escalation:first")).toBeNull();
		expect(readLocalRequest(stateDir, "escalation:second")).not.toBeNull();

		// A pending literal_user request on the same subject is never superseded.
		const approval = {
			contract: "immune_brain/interaction_request/v1" as const,
			interaction_id: "plan-approval:issue-42",
			kind: "plan_approval" as const,
			subject: { issue: 42 },
			binding: { plan_digest: "sha256:plan" },
			prompt: "approve the plan",
			answer: "approve_digest" as const,
			authority: "literal_user" as const,
		};
		await channel.post(approval);
		await channel.post(advisory("escalation:third", "third question"));
		expect(readLocalRequest(stateDir, approval.interaction_id)).not.toBeNull();
		expect(readLocalRequest(stateDir, "escalation:second")).toBeNull();
	});

	test("keeps one pointer per target and drops it when the request is retired", async () => {
		const root = checkout({ interaction: { channel: "local" } });
		const stateDir = loopInteractionStateDir(root);
		const channel = createLocalInteractionChannel({ stateDir });

		await askOwnerQuestion(
			{ stateDir, now: TS, target: "issue-42", channel, pending_literal_user: [] },
			{ subject: { issue: 42 }, context: CONTEXT },
		);
		const second = await askOwnerQuestion(
			{ stateDir, now: TS, target: "issue-42", channel, pending_literal_user: [] },
			{ subject: { issue: 42 }, context: { ...CONTEXT, blocked_on: "the blocker changed" } },
		);

		// The superseded request retired its own pointer with it.
		expect(listWaitingStatus(stateDir)).toHaveLength(1);
		expect(listWaitingStatus(stateDir)[0]!.link).toContain(second.interaction_id);

		await channel.withdraw(second.interaction_id);
		expect(listWaitingStatus(stateDir)).toEqual([]);
	});

	test("the Status Issue renders the waiting link, not the question", async () => {
		const root = checkout({ interaction: { channel: "local" } });
		const stateDir = loopInteractionStateDir(root);
		const asked = await askOwnerQuestion(
			{ stateDir, now: TS, target: "issue-42", channel: createLocalInteractionChannel({ stateDir }), pending_literal_user: [] },
			{ subject: { issue: 42 }, context: CONTEXT },
		);

		const edits: Array<{ number: number; body: string }> = [];
		const created: string[] = [];
		const port = {
			async postComment() {
				return { id: 1 };
			},
			async editComment() {},
			async createIssue(_title: string, body: string) {
				created.push(body);
				return { number: 900 };
			},
			async editIssue(number: number, body: string) {
				edits.push({ number, body });
			},
			async upsertPullRequest() {
				return { number: 1, url: "https://example.test/pr/1" };
			},
			async markPrReady() {},
			async checkLog() {
				return null;
			},
			async prReviewComments() {
				return [];
			},
		};
		const statusIssue = {
			id: 900,
			number: 900,
			title: "Loop daemon status",
			body: "<!-- immune-brain:kind=loop-status -->\nold status",
			state: "open" as const,
			created_at: TS,
			updated_at: TS,
			author: { login: "imm-bot" },
		};
		await dispatchDecisions({
			root,
			stateDir,
			loopConfig: DEFAULT_LOOP_CONFIG,
			events: [],
			decisions: [],
			snapshot: { issues: [statusIssue], pull_requests: [], observed_at: TS },
			state: initLoopState(),
			gitHubPort: port as never,
			guardFacts: { identity_posture: "isolated" },
			dryRun: false,
			now: TS,
		});

		expect(created).toEqual([]);
		expect(edits).toHaveLength(1);
		// The pointer the daemon recorded is the link the Status Issue shows.
		expect(edits[0]!.body).toContain("### Waiting on owner");
		expect(edits[0]!.body).toContain(asked.link!);
		expect(edits[0]!.body).not.toContain(CONTEXT.blocked_on);
	});

	test("records the local pointer status lists for an owner question", async () => {
		const root = checkout({ interaction: { channel: "local" } });
		const stateDir = loopInteractionStateDir(root);
		const channel = createLocalInteractionChannel({ stateDir });

		const asked = await askOwnerQuestion(
			{ stateDir, now: TS, target: "issue-42", channel, pending_literal_user: [] },
			{ subject: { issue: 42 }, context: CONTEXT },
		);

		expect(asked.action).toBe("posted");
		const waiting = listWaitingStatus(stateDir);
		expect(waiting).toHaveLength(1);
		expect(waiting[0]).toMatchObject({ target: "issue-42", kind: "escalation", channel: "local" });
		expect(waiting[0]!.link).toContain(asked.interaction_id);
		// The pointer is a link, not the question.
		expect(JSON.stringify(waiting)).not.toContain(CONTEXT.blocked_on);
	});
});
