// Claude Code Stop continuation. The session state machine lives in
// `../host-core/run_continuation_session` (Spec
// docs/specs/host-neutral-adapter-core.spec.md D9); this adapter parses Host
// payloads into typed events and renders the outcome back into Hook output.
//
// Interface: `runContinuationHookOutput`, `readRunToolSession`,
// `selectedClaudeParent`.
// Invariants: every continuation decision re-reads the actual Kernel; the
// transport connection ID is never a Hook session; the entry token ends with its
// session, a pause or a settlement.
// Side Effects: through the core, writes private session metadata and Hook output.
// Verification: `bun test tests/claude-run-continuation.test.ts`.

import { realpathSync, openSync, fstatSync, readSync, closeSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { digestOfReviewerBytes } from "../assurance/review_mediation";
import { recognizePhaseEntry } from "../assurance/phase_entry";
import { releasesRunBinding, USER_WAIT_GUIDANCE } from "../assurance/run_continuation";
import { claudeLocalNames, dropPhaseEntryLog, readPhaseEntryState, revokeEntryToken } from "./lane_guard";
import { applyRunContinuationEvent, readSessionToolCall, selectedParentSession,
	type RunContinuationEvent, type RunContinuationHost } from "../host-core/run_continuation_session";
import { CLAUDE_CACHE_DIR } from "./review_host";

const MCP_TOOL = /^mcp__.*immune-brain.*__(\w+)$/;

const claudeContinuationHost = (root: string): RunContinuationHost => ({
	cache_name: CLAUDE_CACHE_DIR,
	entry_state: (sessionId) => readPhaseEntryState(sessionId, root),
	revoke_entry: (sessionId) => revokeEntryToken(sessionId, "spent", root),
	drop_entry_log: (sessionId) => dropPhaseEntryLog(sessionId, root),
});

/** Exact PreToolUse correlation; the transport connection ID is never a Hook session. */
export function readRunToolSession(toolId: string, operation: string, workspace: string, root = tmpdir()): string | null {
	return readSessionToolCall(claudeContinuationHost(root), root, toolId, operation, workspace);
}
export function selectedClaudeParent(toolId: string, workspace: string, slug: string, root = tmpdir()): boolean {
	return selectedParentSession(claudeContinuationHost(root), root, toolId, workspace, slug);
}

/** A transcript assistant UUID identifies a Host turn; local callback counters do not. */
function stopBoundary(payload: Record<string, unknown>): string | null {
	if (typeof payload.transcript_path !== "string" || !payload.transcript_path) return null;
	const fd = openSync(payload.transcript_path, "r");
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile()) throw new Error("Stop transcript must be a regular file");
		const bytes = Buffer.alloc(Math.min(stat.size, 256 * 1024));
		readSync(fd, bytes, 0, bytes.length, stat.size - bytes.length);
		for (const line of bytes.toString("utf8").trim().split("\n").reverse()) {
			let value; try { value = JSON.parse(line); } catch { continue; }
			if (value.type === "assistant" && !value.isSidechain && typeof value.uuid === "string" && value.uuid)
				return digestOfReviewerBytes(`${payload.transcript_path}\n${value.uuid}`);
		}
		return null;
	} finally { closeSync(fd); }
}

function toolResponse(payload: Record<string, unknown>): Record<string, unknown> | null {
	const response = payload.tool_response;
	if (Array.isArray(response)) {
		const text = response.filter(item => item?.type === "text" && typeof item.text === "string").map(item => item.text).join("");
		try { return JSON.parse(text); } catch { return null; }
	}
	if (response && typeof response === "object" && !Array.isArray(response)) {
		const object = response as Record<string, unknown>;
		if (typeof object.state === "string") return object;
		if (Array.isArray(object.content)) {
			const text = object.content.filter(item => item?.type === "text" && typeof item.text === "string").map(item => item.text).join("");
			try { return JSON.parse(text); } catch { return null; }
		}
		return object;
	}
	if (typeof response === "string") { try { return JSON.parse(response); } catch { return null; } }
	return null;
}
function warning(reason: string): string { return JSON.stringify({ systemMessage: `Immune-Brain run paused: ${reason}` }); }

/** Hook payload into one typed event; an event this Host does not decide is null. */
function continuationEvent(payload: Record<string, unknown>, workspace: string): RunContinuationEvent | null {
	const event = String(payload.hook_event_name ?? "");
	const operation = MCP_TOOL.exec(String(payload.tool_name ?? ""))?.[1];
	const toolId = typeof payload.tool_use_id === "string" ? payload.tool_use_id : "";
	if (event === "SessionEnd") return { kind: "session_end" };
	if (event === "UserPromptSubmit") {
		const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
		const entry = recognizePhaseEntry(prompt, claudeLocalNames(workspace, homedir()), "claude");
		return { kind: "prompt", releases: releasesRunBinding(prompt, entry === "plan" ? "planner" : null) || entry === "run" };
	}
	if (event === "PreToolUse" && operation && toolId) {
		const input = (payload.tool_input ?? {}) as Record<string, unknown>;
		return { kind: "tool_call", operation, tool_id: toolId, task_id: typeof input.task_id === "string" ? input.task_id : null };
	}
	if ((event === "PostToolUse" || event === "PostToolUseFailure") && operation && toolId)
		return { kind: "tool_result", operation, tool_id: toolId, response: toolResponse(payload), failed: event === "PostToolUseFailure" };
	if (payload.tool_name === "Agent" && (event === "PreToolUse" || event === "PostToolUse" || event === "PostToolUseFailure")) {
		const input = payload.tool_input as { prompt?: unknown } | undefined;
		const response = event === "PreToolUse" ? null : toolResponse(payload);
		return { kind: "reviewer", phase: event === "PreToolUse" ? "dispatch" : "return", call_id: toolId,
			prompt_digest: typeof input?.prompt === "string" ? digestOfReviewerBytes(input.prompt) : null,
			agent_id: typeof response?.agentId === "string" ? response.agentId : null,
			asynchronous: response?.isAsync === true || response?.status === "async_launched" };
	}
	if (event === "SubagentStop") return { kind: "reviewer_stop", agent_id: typeof payload.agent_id === "string" ? payload.agent_id : null };
	if (event === "Stop") return { kind: "stop", boundary: () => stopBoundary(payload), stop_hook_active: payload.stop_hook_active === true };
	return null;
}

function render(outcome: Awaited<ReturnType<typeof applyRunContinuationEvent>>): string | null {
	switch (outcome.kind) {
		case "deny": return JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
			permissionDecisionReason: `Run paused: ${outcome.reason}; enter drive explicitly before another native gate` } });
		case "paused": return warning(outcome.reason);
		case "continue": return JSON.stringify({ decision: "block",
			reason: `Explicit drive is bound to ${outcome.label}; Kernel settlement is incomplete. ${outcome.next_action}. Continue the authorized Loop. ${USER_WAIT_GUIDANCE}` });
		default: return null;
	}
}

/** Hook metadata only. Every continuation decision re-reads the actual Kernel. */
export async function runContinuationHookOutput(payload: Record<string, unknown>, root = tmpdir()): Promise<string | null> {
	const sessionId = typeof payload.session_id === "string" ? payload.session_id : "";
	if (!sessionId) return null;
	const workspace = realpathSync(typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd());
	// A literal prompt's local command aliases are read before the guarded section, as they always were.
	const event = continuationEvent(payload, workspace);
	if (!event) return null;
	try {
		return render(await applyRunContinuationEvent(claudeContinuationHost(root), root, { session_id: sessionId, workspace }, event));
	} catch (error) {
		return warning(`continuation facts could not be verified: ${error instanceof Error ? error.message : String(error)}`);
	}
}
