import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { consumePhaseAdmission, phaseEntryGateHookOutput, recordPhaseEntryPrompt, revokeEntryToken, type GatedTool } from "../plugins/immune-brain/runtime/claude/lane_guard";
import { runContinuationHookOutput } from "../plugins/immune-brain/runtime/claude/run_continuation";
import { confirmationRef, entryTokenRequestId } from "../plugins/immune-brain/runtime/claude/interaction";
import { createMcpRuntime, handleJsonRpc } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { readActiveClaimTaskId } from "../plugins/immune-brain/runtime/kernel/backend_claim";
import { watchBundleIdentity } from "../plugins/immune-brain/runtime/plugin_source_skew";

const ENV = { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" };
const ENROLL = "mcp__plugin_immune-brain_immune-brain__enroll";
const RECOVERY = "ask the user to enter /drive (or /immune-brain:drive on Claude Code) in the current Host";
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

/** A committed workspace holding one candidate per task id. */
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
async function session(taskIds: string[], extra: Parameters<typeof createMcpRuntime>[0] = {}, decision: "accept" | "decline" = "accept") {
	const cwd = workspace(taskIds);
	const store = mkdtempSync(join(tmpdir(), "imm-phase-store-"));
	roots.push(store);
	const base = { session_id: "gate-session", cwd };
	const locations = { root: store, home: store };
	const confirmations: string[] = [];
	let gateCalls = 0;
	let consumed = 0;
	let rpcId = 1;
	const mcp = createMcpRuntime({
		cwd, env: ENV,
		requestConfirmation: async ({ operation }) => { gateCalls++; confirmations.push(operation); return { decision, requestId: `gate-${operation}-${gateCalls}` }; },
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
		store,
		gateCalls: () => gateCalls,
		confirmations: () => confirmations,
		consumed: () => consumed,
		prompt: (prompt: string, at: Partial<typeof base> = {}) => recordPhaseEntryPrompt({ hook_event_name: "UserPromptSubmit", prompt, ...base, ...at }, locations),
		hook: (tool_name: string, tool_use_id: string, at: Partial<typeof base> = {}) =>
			phaseEntryGateHookOutput({ hook_event_name: "PreToolUse", tool_name, tool_input: {}, tool_use_id, ...base, ...at }, locations),
		endSession: () => runContinuationHookOutput({ hook_event_name: "SessionEnd", ...base }, store),
		call: (name: GatedTool | "status", args: Record<string, unknown>, toolUseId: string) =>
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


const TASK = "gate-a";
const ARGS = { task_id: TASK };
const gateSession = (decision: "accept" | "decline" = "accept", extra: Parameters<typeof createMcpRuntime>[0] = {}) =>
	session([TASK], extra, decision);
const worktrees = (cwd: string) => execFileSync("git", ["worktree", "list"], { cwd, encoding: "utf8" }).trim().split("\n");

describe("Claude phase entry gate: in-place enroll admission", () => {
	test("a live run entry opens one native gate and claims the task in this workspace", async () => {
		const s = await gateSession();
		expect(s.prompt(`/immune-brain:drive ${TASK}`)).toBe(true);
		expect(s.hook(ENROLL, "toolu_1")).toBeNull();
		const reply = await s.call("enroll", ARGS, "toolu_1");
		expect(reply?.error).toBeUndefined();
		expect(s.confirmations()).toEqual(["enroll"]);
		expect(readActiveClaimTaskId(s.cwd)).toBe(TASK);
		expect(worktrees(s.cwd)).toHaveLength(1);
	});

	test("a live entry token alone never enrolls: the gate still opens, and a decline claims nothing", async () => {
		// The token sits in a same-uid cache file a model could write by hand
		// (ADR 0025 Context), so it must not replace the gate on starting work.
		const s = await gateSession("decline");
		s.prompt("/drive");
		expect(s.hook(ENROLL, "toolu_forged")).toBeNull();
		expect((await s.call("enroll", ARGS, "toolu_forged"))?.error).toBeDefined();
		expect(s.confirmations()).toEqual(["enroll"]);
		expect(readActiveClaimTaskId(s.cwd)).toBeNull();
	});

	test("a supplied entry_token or native_decision argument refuses with no Kernel mutation", async () => {
		const s = await gateSession();
		s.prompt("/drive");
		for (const [field, id] of [["entry_token", "toolu_t"], ["native_decision", "toolu_n"]] as const) {
			expect(s.hook(ENROLL, id)).toBeNull();
			const reply = await s.call("enroll", { ...ARGS, [field]: "accept" }, id);
			expect(reply?.error?.message).toContain(`${field} cannot be supplied`);
		}
		expect(readActiveClaimTaskId(s.cwd)).toBeNull();
		expect(s.gateCalls()).toBe(0);
	});

	test("another session's entry, a SessionEnd, a spent token and another workspace all refuse", async () => {
		const s = await gateSession();
		// Minted by one session, called from another.
		s.prompt("/drive", { session_id: "other-session" });
		expectHookDenial(s.hook(ENROLL, "toolu_s"));
		expectRunEntryRequired(await s.call("enroll", ARGS, "toolu_s"));
		// SessionEnd drops the token the hook already admitted.
		s.prompt("/drive");
		expect(s.hook(ENROLL, "toolu_e")).toBeNull();
		await s.endSession();
		expectRunEntryRequired(await s.call("enroll", ARGS, "toolu_e"));
		expectHookDenial(s.hook(ENROLL, "toolu_e2"));
		// A token minted in another workspace does not authorize this one: the Hook
		// denies the drifted cwd and the MCP server refuses the same call.
		const elsewhere = mkdtempSync(join(tmpdir(), "imm-phase-elsewhere-"));
		roots.push(elsewhere);
		s.prompt("/drive", { cwd: elsewhere });
		expect(s.hook(ENROLL, "toolu_w")).toContain("was called from");
		expect(JSON.parse(s.hook(ENROLL, "toolu_w")!).hookSpecificOutput.permissionDecision).toBe("deny");
		// Admitted at its own workspace, the call still refuses at the MCP server.
		expect(s.hook(ENROLL, "toolu_w", { cwd: elsewhere })).toBeNull();
		const reply = await s.call("enroll", ARGS, "toolu_w");
		expect(reply?.error?.data?.reason_code).toBe("run_entry_required");
		expect(reply?.error?.message).toContain("workspace other than");
		expect(readActiveClaimTaskId(s.cwd)).toBeNull();
		expect(s.gateCalls()).toBe(0);
	});

	test("a revoked entry refuses at tools/call even with an admission recorded before the revocation", async () => {
		const s = await gateSession();
		s.prompt("/drive");
		expect(s.hook(ENROLL, "toolu_p")).toBeNull();
		// A lost or terminal bound identity spends the entry (workflow-friction D1.1).
		revokeEntryToken("gate-session", "spent", s.store);
		expectRunEntryRequired(await s.call("enroll", ARGS, "toolu_p"));
		expect(s.gateCalls()).toBe(0);
		expect(readActiveClaimTaskId(s.cwd)).toBeNull();
	});

	test("a run suspended by native failures keeps its entry; enroll after a plain reply reaches its native gate", async () => {
		const s = await gateSession();
		s.prompt("/drive");
		// The third native-operation failure suspends the run without spending the entry (workflow-friction D1.1).
		for (let attempt = 1; attempt <= 3; attempt++) {
			const failure = { tool_name: "mcp__plugin_immune-brain_immune-brain__request_authorization", tool_use_id: `toolu_f${attempt}`,
				tool_input: { task_id: TASK }, session_id: "gate-session", cwd: s.cwd };
			await runContinuationHookOutput({ hook_event_name: "PreToolUse", ...failure }, s.store);
			await runContinuationHookOutput({ hook_event_name: "PostToolUseFailure", ...failure, error: "rejected" }, s.store);
		}
		s.prompt("go on");
		expect(s.hook(ENROLL, "toolu_resumed")).toBeNull();
		expect((await s.call("enroll", ARGS, "toolu_resumed"))?.error).toBeUndefined();
		expect(s.gateCalls()).toBe(1);
	});

	test("the run entry stays live after ordinary prompts", async () => {
		const s = await gateSession();
		s.prompt("/drive");
		s.prompt("continue");
		expect(s.hook(ENROLL, "toolu_later")).toBeNull();
		expect((await s.call("enroll", ARGS, "toolu_later"))?.error).toBeUndefined();
		expect(s.gateCalls()).toBe(1);
	});

	test("ordinary prose, a session with no prompt and a later plan entry all refuse before the native gate", async () => {
		const fresh = await gateSession();
		expectHookDenial(fresh.hook(ENROLL, "toolu_none"));
		expectRunEntryRequired(await fresh.call("enroll", ARGS, "toolu_none"));
		const s = await gateSession();
		s.prompt("please drive this task");
		expectHookDenial(s.hook(ENROLL, "toolu_prose"));
		expectRunEntryRequired(await s.call("enroll", ARGS, "toolu_prose"));
		s.prompt("/drive");
		s.prompt("/immune-brain:draw-up more work");
		s.prompt("confirm");
		expectHookDenial(s.hook(ENROLL, "toolu_plan"));
		expectRunEntryRequired(await s.call("enroll", ARGS, "toolu_plan"));
		expect(fresh.gateCalls() + s.gateCalls()).toBe(0);
		expect(readActiveClaimTaskId(s.cwd)).toBeNull();
	});

	test("a drifted shell cwd is denied before the native gate and admitted again after cd back (D4)", async () => {
		const s = await gateSession();
		s.prompt("/drive");
		const home = realpathSync(s.cwd);
		const drifted = join(home, ".git", "imm", "worktrees", "drifted-slug", "drifted-task");
		mkdirSync(drifted, { recursive: true });
		const denial = JSON.parse(s.hook(ENROLL, "toolu_drift", { cwd: drifted })!) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
		expect(denial.hookSpecificOutput.permissionDecision).toBe("deny");
		expect(denial.hookSpecificOutput.permissionDecisionReason).toContain(drifted);
		expect(denial.hookSpecificOutput.permissionDecisionReason).toContain(home);
		expect(denial.hookSpecificOutput.permissionDecisionReason).toContain(`cd ${home}`);
		// No admission was written, so the tool side refuses and the gate never opens.
		expectRunEntryRequired(await s.call("enroll", ARGS, "toolu_drift"));
		expect(s.gateCalls()).toBe(0);
		expect(readActiveClaimTaskId(s.cwd)).toBeNull();
		// A symlinked route to the same workspace is the bound workspace, not a drift.
		s.prompt("/drive");
		const link = join(mkdtempSync(join(tmpdir(), "imm-phase-link-")), "linked-workspace");
		roots.push(dirname(link));
		symlinkSync(home, link);
		expect(s.hook(ENROLL, "toolu_linked", { cwd: link })).toBeNull();
		expect((await s.call("enroll", ARGS, "toolu_linked"))?.error).toBeUndefined();
		expect(s.gateCalls()).toBe(1);
		// An unresolvable cwd is denied by the same rule.
		const missing = join(home, ".git", "imm", "worktrees", "drifted-slug", "absent");
		const unresolvable = JSON.parse(s.hook(ENROLL, "toolu_missing", { cwd: missing })!) as { hookSpecificOutput: { permissionDecisionReason: string } };
		expect(unresolvable.hookSpecificOutput.permissionDecisionReason).toContain("run_entry_required: ");
		expect(unresolvable.hookSpecificOutput.permissionDecisionReason).toContain("an unresolvable cwd");
	});

	test("a live entry without the hook admission for this exact call refuses", async () => {
		const s = await gateSession();
		s.prompt("/drive");
		// No PreToolUse hook ran for this call at all.
		expectRunEntryRequired(await s.call("enroll", ARGS, "toolu_unseen"));
		// The hook admitted a different call id.
		expect(s.hook(ENROLL, "toolu_other")).toBeNull();
		expectRunEntryRequired(await s.call("enroll", ARGS, "toolu_unseen"));
		expect(s.gateCalls()).toBe(0);
		expect(readActiveClaimTaskId(s.cwd)).toBeNull();
	});

	test("an admission is single-use, even when the hook ran twice for one call", async () => {
		const s = await gateSession("decline");
		s.prompt("/drive");
		// Two enabled copies of the plugin both match the tool name.
		expect(s.hook(ENROLL, "toolu_twice")).toBeNull();
		expect(s.hook(ENROLL, "toolu_twice")).toBeNull();
		await s.call("enroll", ARGS, "toolu_twice");
		expectRunEntryRequired(await s.call("enroll", ARGS, "toolu_twice"));
		expect(s.gateCalls()).toBe(1);
		expect(s.consumed()).toBe(1);
	});
});

describe("Claude entry token confirmation reference", () => {
	test("a token-backed reference is of kind entry and still binds the intent hash", () => {
		const ref = (requestId: string, extra: { planDigest?: string; intentContentHash?: string } = {}) =>
			confirmationRef({ connectionId: "s", toolCallId: "t", requestId, operation: "enroll", ...extra });
		const token = entryTokenRequestId("token-1");
		expect(ref(token, { intentContentHash: "h1" })).toStartWith("claude-entry-");
		expect(ref("elicitation-1", { intentContentHash: "h1" })).toStartWith("claude-confirm-");
		expect(ref(token, { intentContentHash: "h1" })).not.toBe(ref(token, { intentContentHash: "h2" }));
	});
});

describe("Claude phase entry gate behind a stale MCP bundle", () => {
	// Spec branch-boundary D3: a server running an old bundle names that cause
	// instead of the run_entry_required refusal the old bundle would report.
	test("with no admission a stale bundle refuses as plugin_bundle_stale and a current one as run_entry_required", async () => {
		const bundleDir = mkdtempSync(join(tmpdir(), "imm-phase-bundle-"));
		roots.push(bundleDir);
		const stalePath = join(bundleDir, "stale.mjs"), currentPath = join(bundleDir, "current.mjs");
		writeFileSync(stalePath, "// build 1\n");
		writeFileSync(currentPath, "// build 1\n");
		const stale = await gateSession("accept", { bundleIdentity: watchBundleIdentity(stalePath) });
		writeFileSync(stalePath, "// build 2\n");
		const staleReply = await stale.call("enroll", ARGS, "toolu_no_admission");
		expect(staleReply?.error?.data?.reason_code).toBe("plugin_bundle_stale");
		const current = await gateSession("accept", { bundleIdentity: watchBundleIdentity(currentPath) });
		expectRunEntryRequired(await current.call("enroll", ARGS, "toolu_no_admission"));
		expect(readActiveClaimTaskId(stale.cwd)).toBeNull();
		expect(readActiveClaimTaskId(current.cwd)).toBeNull();
	});
});
