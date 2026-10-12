import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consumePhaseAdmission, phaseEntryGateHookOutput, recordPhaseEntryPrompt, type GatedTool } from "../plugins/immune-brain/runtime/claude/lane_guard";
import { createMcpRuntime, handleJsonRpc } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { readActiveClaimTaskId } from "../plugins/immune-brain/runtime/unattended/batch_preflight";
import type { GithubInitiativeObservation } from "../plugins/immune-brain/runtime/unattended/types";

const ENV = { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" };
const ENROLL = "mcp__plugin_immune-brain_immune-brain__enroll";
const BATCH = "mcp__plugin_immune-brain_immune-brain__start_unattended_batch";
const RECOVERY = "ask the user to enter imm-run in the current Host";
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function intentFor(taskId: string) {
	return {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		owner: "user",
		goal: `goal for ${taskId}`,
		acceptance: [{ id: "acc-1", assertion: `assertion for ${taskId}`, verification: "bun test" }],
		scope_hint: [`docs/plans/${taskId}.intent.json`, `docs/specs/${taskId}.spec.md`, `docs/specs/archive/${taskId}.spec.md`],
		risk: "routine",
		revision: 1,
	};
}

/** A committed workspace holding one enrollable candidate per task id. */
function workspace(taskIds: string[]): string {
	const root = mkdtempSync(join(tmpdir(), "imm-phase-gate-"));
	roots.push(root);
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
	execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
	mkdirSync(join(root, ".imm", "state"), { recursive: true });
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	for (const taskId of taskIds) writeFileSync(join(root, "docs", "plans", `${taskId}.intent.json`), `${JSON.stringify(intentFor(taskId), null, 2)}\n`);
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-q", "-m", "fixture"], { cwd: root });
	return root;
}

/**
 * One Claude Code session over the real seams: the UserPromptSubmit and
 * PreToolUse hook functions write the private store, and the MCP runtime
 * consumes it through `handleJsonRpc`. Only the store location is a fixture.
 */
async function session(taskIds: string[], extra: Parameters<typeof createMcpRuntime>[0] = {}) {
	const cwd = workspace(taskIds);
	const store = mkdtempSync(join(tmpdir(), "imm-phase-store-"));
	roots.push(store);
	const base = { session_id: "gate-session", cwd };
	const locations = { root: store, home: store };
	let gateCalls = 0;
	let consumed = 0;
	let rpcId = 1;
	const mcp = createMcpRuntime({
		cwd, env: ENV,
		requestConfirmation: async ({ operation }) => { gateCalls++; return { decision: "accept", requestId: `gate-${operation}-${gateCalls}` }; },
		consumePhaseAdmission: (toolCallId: string, operation: GatedTool) => {
			const admitted = consumePhaseAdmission(toolCallId, operation, store);
			if (admitted) consumed++;
			return admitted;
		},
		...extra,
	});
	await handleJsonRpc({
		jsonrpc: "2.0", id: rpcId++, method: "initialize",
		params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1.236" }, capabilities: { elicitation: {} } },
	}, mcp);
	return {
		cwd,
		gateCalls: () => gateCalls,
		consumed: () => consumed,
		prompt: (prompt: string) => recordPhaseEntryPrompt({ hook_event_name: "UserPromptSubmit", prompt, ...base }, locations),
		hook: (tool_name: string, tool_use_id: string) =>
			phaseEntryGateHookOutput({ hook_event_name: "PreToolUse", tool_name, tool_input: {}, tool_use_id, ...base }, locations),
		call: (name: GatedTool, args: Record<string, unknown>, toolUseId: string) =>
			handleJsonRpc({ jsonrpc: "2.0", id: rpcId++, method: "tools/call", params: { name, arguments: args, _meta: { "claudecode/toolUseId": toolUseId } } }, mcp),
	};
}

function expectRunEntryRequired(reply: Awaited<ReturnType<typeof handleJsonRpc>>): void {
	expect(reply?.result).toBeUndefined();
	expect(reply?.error?.data).toEqual({ reason_code: "run_entry_required", recovery_action: RECOVERY });
}

function expectHookDenial(output: string | null): void {
	expect(output).not.toBeNull();
	const decision = (JSON.parse(output!) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } }).hookSpecificOutput;
	expect(decision.permissionDecision).toBe("deny");
	expect(decision.permissionDecisionReason).toStartWith("run_entry_required: ");
	expect(decision.permissionDecisionReason).toEndWith(`; recovery: ${RECOVERY}`);
	expect(decision.permissionDecisionReason.split("recovery:")).toHaveLength(2);
}

describe("Claude phase entry gate: enroll", () => {
	test("a live run entry and the hook admission let enroll reach the native gate", async () => {
		const s = await session(["gate-a"]);
		expect(s.prompt("/immune-brain:imm-run gate-a")).toBe(true);
		expect(s.hook(ENROLL, "toolu_1")).toBeNull();
		const reply = await s.call("enroll", { task_id: "gate-a" }, "toolu_1");
		expect(reply?.error).toBeUndefined();
		expect(s.gateCalls()).toBe(1);
		expect(readActiveClaimTaskId(s.cwd)).toBe("gate-a");
	});

	test("the run entry stays live for a later Slice after ordinary prompts", async () => {
		const s = await session(["gate-a"]);
		s.prompt("/imm-run gate-a");
		s.prompt("continue with the next slice");
		expect(s.hook(ENROLL, "toolu_later")).toBeNull();
		expect((await s.call("enroll", { task_id: "gate-a" }, "toolu_later"))?.error).toBeUndefined();
		expect(s.gateCalls()).toBe(1);
	});

	test("with no entry the hook denies and the tool refuses before the native gate", async () => {
		const s = await session(["gate-a"]);
		s.prompt("confirm");
		expectHookDenial(s.hook(ENROLL, "toolu_1"));
		expectRunEntryRequired(await s.call("enroll", { task_id: "gate-a" }, "toolu_1"));
		expect(s.gateCalls()).toBe(0);
		expect(readActiveClaimTaskId(s.cwd)).toBeNull();
	});

	test("a session that never submitted a prompt has no store and refuses", async () => {
		const s = await session(["gate-a"]);
		expectHookDenial(s.hook(ENROLL, "toolu_1"));
		expectRunEntryRequired(await s.call("enroll", { task_id: "gate-a" }, "toolu_1"));
		expect(s.gateCalls()).toBe(0);
	});

	test("a later plan entry revokes the run entry", async () => {
		const s = await session(["gate-a"]);
		s.prompt("/imm-run gate-a");
		s.prompt("/imm-planner something else");
		s.prompt("confirm");
		expectHookDenial(s.hook(ENROLL, "toolu_1"));
		expectRunEntryRequired(await s.call("enroll", { task_id: "gate-a" }, "toolu_1"));
		expect(s.gateCalls()).toBe(0);
	});

	test("a live entry without the hook admission for this exact call refuses", async () => {
		const s = await session(["gate-a"]);
		s.prompt("/imm-run gate-a");
		// No PreToolUse hook ran for this call at all.
		expectRunEntryRequired(await s.call("enroll", { task_id: "gate-a" }, "toolu_unseen"));
		// The hook admitted a different call id.
		expect(s.hook(ENROLL, "toolu_other")).toBeNull();
		expectRunEntryRequired(await s.call("enroll", { task_id: "gate-a" }, "toolu_unseen"));
		expect(s.gateCalls()).toBe(0);
		expect(readActiveClaimTaskId(s.cwd)).toBeNull();
	});

	test("an admission is single-use and bound to its operation", async () => {
		const s = await session(["gate-a"], { readInitiative: async () => { throw new Error("must not be read"); } });
		s.prompt("/imm-run gate-a");
		expect(s.hook(BATCH, "toolu_batch")).toBeNull();
		expectRunEntryRequired(await s.call("enroll", { task_id: "gate-a" }, "toolu_batch"));
		// The mismatched read spent it: it no longer admits its own operation either.
		expectRunEntryRequired(await s.call("start_unattended_batch", { initiative_slug: "demo" }, "toolu_batch"));
		expect(s.hook(ENROLL, "toolu_1")).toBeNull();
		expect((await s.call("enroll", { task_id: "gate-a" }, "toolu_1"))?.error).toBeUndefined();
		expectRunEntryRequired(await s.call("enroll", { task_id: "gate-a" }, "toolu_1"));
		expect(s.gateCalls()).toBe(1);
	});

	test("a hook that ran twice for one call still admits it exactly once", async () => {
		const s = await session(["gate-a"]);
		s.prompt("/imm-run gate-a");
		// Two enabled copies of the plugin both match the tool name.
		expect(s.hook(ENROLL, "toolu_twice")).toBeNull();
		expect(s.hook(ENROLL, "toolu_twice")).toBeNull();
		expect((await s.call("enroll", { task_id: "gate-a" }, "toolu_twice"))?.error).toBeUndefined();
		expectRunEntryRequired(await s.call("enroll", { task_id: "gate-a" }, "toolu_twice"));
		expect(s.gateCalls()).toBe(1);
		expect(s.consumed()).toBe(1);
	});

	test("repeated admissions that disagree on the operation refuse", async () => {
		const s = await session(["gate-a"]);
		s.prompt("/imm-run gate-a");
		expect(s.hook(ENROLL, "toolu_mixed")).toBeNull();
		expect(s.hook(BATCH, "toolu_mixed")).toBeNull();
		expectRunEntryRequired(await s.call("enroll", { task_id: "gate-a" }, "toolu_mixed"));
		expect(s.gateCalls()).toBe(0);
	});
});

describe("Claude phase entry gate: start_unattended_batch", () => {
	const slug = "gate-init";
	const observation: GithubInitiativeObservation = {
		contract: "immune_brain/github_initiative_observation/v1",
		initiative_id: slug,
		issue_number: 100,
		tasks: [{ task_id: `${slug}-c1`, slice_id: "S1", issue_number: 101, blocked_by: [] }],
	};
	const batchOptions = () => {
		let reads = 0;
		return {
			reads: () => reads,
			options: {
				readInitiative: async () => { reads++; return observation; },
				batchKernel: { advanceTask: async () => ({ state: "review_ready" as const, operation_id: "op-1", agent_params: { prompt: "review" } as never }) },
			},
		};
	};

	test("with no entry the hook denies and the tool refuses before reading the plan or opening the gate", async () => {
		const b = batchOptions();
		const s = await session([`${slug}-c1`], b.options);
		s.prompt("start the batch");
		expectHookDenial(s.hook(BATCH, "toolu_b"));
		expectRunEntryRequired(await s.call("start_unattended_batch", { initiative_slug: slug }, "toolu_b"));
		expect(b.reads()).toBe(0);
		expect(s.gateCalls()).toBe(0);
		expect(readActiveClaimTaskId(s.cwd)).toBeNull();
	});

	test("one admitted start opens the gate once, and the batch enrolls its child without another admission", async () => {
		const b = batchOptions();
		const s = await session([`${slug}-c1`], b.options);
		s.prompt(`/imm-run ${slug}`);
		expect(s.hook(BATCH, "toolu_b")).toBeNull();
		const reply = await s.call("start_unattended_batch", { initiative_slug: slug }, "toolu_b");
		expect(reply?.error).toBeUndefined();
		expect(s.gateCalls()).toBe(1);
		// The batch's own child Enrollment is authorized by the batch, not by the
		// phase entry gate: exactly one admission was consumed for the whole run.
		expect(s.consumed()).toBe(1);
		expect(readActiveClaimTaskId(s.cwd)).toBe(`${slug}-c1`);
	});
});
