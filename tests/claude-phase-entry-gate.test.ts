import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consumePhaseAdmission, phaseEntryGateHookOutput, recordPhaseEntryPrompt, type GatedTool } from "../plugins/immune-brain/runtime/claude/lane_guard";
import { runContinuationHookOutput } from "../plugins/immune-brain/runtime/claude/run_continuation";
import { confirmationRef, entryTokenRequestId } from "../plugins/immune-brain/runtime/claude/interaction";
import { createMcpRuntime, handleJsonRpc } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { readActiveClaimTaskId } from "../plugins/immune-brain/runtime/unattended/batch_preflight";
import { watchBundleIdentity } from "../plugins/immune-brain/runtime/plugin_source_skew";
import type { GithubInitiativeObservation } from "../plugins/immune-brain/runtime/unattended/types";

const ENV = { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" };
const ENROLL = "mcp__plugin_immune-brain_immune-brain__enroll";
const BATCH = "mcp__plugin_immune-brain_immune-brain__start_unattended_batch";
const RETIRE = "mcp__plugin_immune-brain_immune-brain__retire_stale_batch";
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

	test("a live entry token alone never starts work: enroll still opens the gate, and a decline claims nothing", async () => {
		// The token sits in a same-uid cache file a model could write by hand
		// (ADR 0025 Context), so it must not replace the gate on starting work.
		const s = await session(["gate-a"], {}, "decline");
		s.prompt("/imm-run gate-a");
		expect(s.hook(ENROLL, "toolu_forged")).toBeNull();
		await s.call("enroll", { task_id: "gate-a" }, "toolu_forged");
		expect(s.confirmations()).toEqual(["enroll"]);
		expect(readActiveClaimTaskId(s.cwd)).toBeNull();
	});

	test("a supplied entry_token or native_decision argument refuses with no Kernel mutation", async () => {
		const s = await session(["gate-a"]);
		s.prompt("/imm-run gate-a");
		for (const [field, id] of [["entry_token", "toolu_t"], ["native_decision", "toolu_n"]] as const) {
			expect(s.hook(ENROLL, id)).toBeNull();
			const reply = await s.call("enroll", { task_id: "gate-a", [field]: "accept" }, id);
			expect(reply?.error?.message).toContain(`${field} cannot be supplied`);
		}
		expect(readActiveClaimTaskId(s.cwd)).toBeNull();
		expect(s.gateCalls()).toBe(0);
	});

	test("another session's entry, a SessionEnd, a spent token and another workspace all refuse", async () => {
		const s = await session(["gate-a"]);
		// Minted by one session, called from another.
		s.prompt("/imm-run gate-a", { session_id: "other-session" });
		expectHookDenial(s.hook(ENROLL, "toolu_s"));
		expectRunEntryRequired(await s.call("enroll", { task_id: "gate-a" }, "toolu_s"));
		// SessionEnd drops the token the hook already admitted.
		s.prompt("/imm-run gate-a");
		expect(s.hook(ENROLL, "toolu_e")).toBeNull();
		await s.endSession();
		expectRunEntryRequired(await s.call("enroll", { task_id: "gate-a" }, "toolu_e"));
		expectHookDenial(s.hook(ENROLL, "toolu_e2"));
		// A token minted in another workspace does not authorize this one.
		const elsewhere = mkdtempSync(join(tmpdir(), "imm-phase-elsewhere-"));
		roots.push(elsewhere);
		s.prompt("/imm-run gate-a", { cwd: elsewhere });
		expect(s.hook(ENROLL, "toolu_w")).toBeNull();
		const reply = await s.call("enroll", { task_id: "gate-a" }, "toolu_w");
		expect(reply?.error?.data?.reason_code).toBe("run_entry_required");
		expect(reply?.error?.message).toContain("workspace other than");
		expect(readActiveClaimTaskId(s.cwd)).toBeNull();
		expect(s.gateCalls()).toBe(0);
	});

	test("a paused run refuses enroll, batch start and retire at tools/call even with admissions recorded before the pause", async () => {
		const s = await session(["gate-a"]);
		s.prompt("/imm-run gate-a");
		for (const [tool, id] of [[ENROLL, "toolu_pe"], [BATCH, "toolu_pb"], [RETIRE, "toolu_pr"]] as const) expect(s.hook(tool, id)).toBeNull();
		// The third native-operation failure under this entry pauses the run (Spec D9).
		for (let attempt = 1; attempt <= 3; attempt++) {
			const failure = { tool_name: "mcp__plugin_immune-brain_immune-brain__request_authorization", tool_use_id: `toolu_f${attempt}`,
				tool_input: { task_id: "gate-a" }, session_id: "gate-session", cwd: s.cwd };
			await runContinuationHookOutput({ hook_event_name: "PreToolUse", ...failure }, s.store);
			await runContinuationHookOutput({ hook_event_name: "PostToolUseFailure", ...failure, error: "rejected" }, s.store);
		}
		expectRunEntryRequired(await s.call("enroll", { task_id: "gate-a" }, "toolu_pe"));
		expectRunEntryRequired(await s.call("start_unattended_batch", { initiative_slug: "gate-init" }, "toolu_pb"));
		expectRunEntryRequired(await s.call("retire_stale_batch", { initiative_slug: "gate-init" }, "toolu_pr"));
		expect(s.gateCalls()).toBe(0);
		expect(readActiveClaimTaskId(s.cwd)).toBeNull();
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

	test("a later literal plan entry revokes the run entry", async () => {
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

describe("Claude entry token confirmation reference", () => {
	test("a token-backed reference is of kind entry and still binds the plan digest and intent hash", () => {
		const ref = (requestId: string, extra: { planDigest?: string; intentContentHash?: string } = {}) =>
			confirmationRef({ connectionId: "s", toolCallId: "t", requestId, operation: "retire_stale_batch", ...extra });
		const token = entryTokenRequestId("token-1");
		expect(ref(token, { planDigest: "p1" })).toStartWith("claude-entry-");
		expect(ref("elicitation-1", { planDigest: "p1" })).toStartWith("claude-confirm-");
		expect(ref(token, { planDigest: "p1" })).not.toBe(ref(token, { planDigest: "p2" }));
		expect(ref(token, { intentContentHash: "h1" })).not.toBe(ref(token, { intentContentHash: "h2" }));
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

	test("one admitted start opens the gate once, returns the manifest, and the batch enrolls its child without another admission", async () => {
		const b = batchOptions();
		const s = await session([`${slug}-c1`], b.options);
		s.prompt(`/imm-run ${slug}`);
		expect(s.hook(BATCH, "toolu_b")).toBeNull();
		const reply = await s.call("start_unattended_batch", { initiative_slug: slug }, "toolu_b");
		expect(reply?.error).toBeUndefined();
		expect(s.gateCalls()).toBe(1);
		const result = JSON.parse((reply?.result as { content: Array<{ text: string }> }).content[0].text);
		expect(result.manifest).toEqual({
			children: [{ task_id: `${slug}-c1`, slice_id: "S1", risk: "routine", scope: [...intentFor(`${slug}-c1`).scope_hint].sort(), verification: ["bun test"] }],
		});
		// The batch's own child Enrollment is authorized by the batch, not by the
		// phase entry gate: exactly one admission was consumed for the whole run.
		expect(s.consumed()).toBe(1);
		// Spec branch-boundary-r2 D18: the child enrolls inside its runtime-created
		// Lane, so the claim is held there and the coordinating checkout stays free.
		const lane = result.report.children[0].lane;
		expect(lane.branch).toBe(`imm-lane/${slug}/${slug}-c1`);
		expect(readActiveClaimTaskId(lane.path)).toBe(`${slug}-c1`);
		expect(readActiveClaimTaskId(s.cwd)).toBeNull();
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
		const stale = await session(["gate-a"], { bundleIdentity: watchBundleIdentity(stalePath) });
		writeFileSync(stalePath, "// build 2\n");
		const staleReply = await stale.call("enroll", { task_id: "gate-a" }, "toolu_no_admission");
		expect(staleReply?.error?.data?.reason_code).toBe("plugin_bundle_stale");
		const current = await session(["gate-a"], { bundleIdentity: watchBundleIdentity(currentPath) });
		expectRunEntryRequired(await current.call("enroll", { task_id: "gate-a" }, "toolu_no_admission"));
		expect(readActiveClaimTaskId(stale.cwd)).toBeNull();
		expect(readActiveClaimTaskId(current.cwd)).toBeNull();
	});
});
