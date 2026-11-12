// Antigravity run continuation: typed-event mapping over the shared state
// machine (Spec docs/specs/tri-host-capability-alignment.spec.md D6, D7).
//
// Interface: `antigravityContinuationHost`, `readRunToolSession`,
// `selectedAntigravityParent`, `stopBoundary`, `antigravityRunContinuationHook`,
// `antigravityRunContinuationPreToolUse`, `antigravityRunContinuationPostToolUse`.
// Invariants: `conversationId` is the continuation session; `${conversationId}:${stepIdx}`
// is the correlated tool ID; Stop maps to a boundary only with a usable
// transcript/execution identity; paused native gates refuse; 7-stop boundary pauses
// with same-Host recovery.
// Side Effects: reads and writes session/correlation files under ANTIGRAVITY_CACHE_DIR.
// Verification: `bun test tests/antigravity-assurance-conformance.test.ts`.

import { closeSync, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestOfReviewerBytes } from "../assurance/review_mediation";
import { USER_WAIT_GUIDANCE } from "../assurance/run_continuation";
import {
	appendPrivate,
	cacheDir,
	ensurePrivateDir,
	sessionHash,
} from "../host-core/private_file";
import {
	applyRunContinuationEvent,
	readSessionMetadata,
	readSessionToolCall,
	selectedParentSession,
	type RunContinuationEvent,
	type RunContinuationHost,
} from "../host-core/run_continuation_session";
import {
	dropPhaseEntryLog,
	readPhaseEntryState,
	revokeEntryToken,
	type AntigravityPostToolUsePayload,
	type AntigravityPreToolUsePayload,
	type AntigravityStopPayload,
	type PreToolUseHookDecision,
} from "./lane_guard";
import { ANTIGRAVITY_CACHE_DIR } from "./review_host";

const IMMUNE_BRAIN_DIRECT_TOOL = /^(?:mcp__.*immune-brain.*__|immune-brain__)?(\w+)$/;
const IMMUNE_BRAIN_SERVERS = new Set(["immune-brain", "immune-brain_immune-brain"]);

export const antigravityContinuationHost = (root: string): RunContinuationHost => ({
	cache_name: ANTIGRAVITY_CACHE_DIR,
	host_name: "Antigravity",
	entry_state: (sessionId) => readPhaseEntryState(sessionId, root),
	revoke_entry: (sessionId) => revokeEntryToken(sessionId, "spent", root),
	drop_entry_log: (sessionId) => dropPhaseEntryLog(sessionId, root),
});

/** Exact PreToolUse correlation for Antigravity: toolId is `${conversationId}:${stepIdx}`. */
export function readRunToolSession(toolId: string, operation: string, workspace: string, root = tmpdir()): string | null {
	return readSessionToolCall(antigravityContinuationHost(root), root, toolId, operation, workspace);
}

export function selectedAntigravityParent(toolId: string, workspace: string, slug: string, root = tmpdir()): boolean {
	return selectedParentSession(antigravityContinuationHost(root), root, toolId, workspace, slug);
}

/** Check whether a session is paused under the Antigravity cache. */
export function isSessionPaused(sessionId: string, root = tmpdir()): string | null {
	if (!sessionId) return null;
	const host = antigravityContinuationHost(root);
	try {
		const metadata = readSessionMetadata(host, root, sessionId);
		return metadata.paused;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `continuation facts could not be verified: ${message}`;
	}
}

/**
 * A transcript assistant entry or executionNum identifies a Host turn (D7);
 * missing usable boundary identity fails closed to null.
 */
export function stopBoundary(payload: Record<string, unknown>): string | null {
	const transcriptPath = payload.transcriptPath ?? payload.transcript_path;
	if (typeof transcriptPath === "string" && transcriptPath) {
		try {
			const fd = openSync(transcriptPath, "r");
			try {
				const stat = fstatSync(fd);
				if (stat.isFile() && stat.size > 0) {
					const bytes = Buffer.alloc(Math.min(stat.size, 256 * 1024));
					readSync(fd, bytes, 0, bytes.length, Math.max(0, stat.size - bytes.length));
					for (const line of bytes.toString("utf8").trim().split("\n").reverse()) {
						let value;
						try { value = JSON.parse(line); } catch { continue; }
						if (typeof value?.step_index === "number") {
							return digestOfReviewerBytes(`${transcriptPath}\n${value.step_index}`);
						}
						if (typeof value?.uuid === "string" && value.uuid) {
							return digestOfReviewerBytes(`${transcriptPath}\n${value.uuid}`);
						}
					}
				}
			} finally {
				closeSync(fd);
			}
		} catch {
			// fall through to executionNum if transcript reading fails
		}
	}
	if (typeof payload.executionNum === "number") {
		const conversation = typeof payload.conversationId === "string" ? payload.conversationId : "";
		return digestOfReviewerBytes(`${conversation}\nexecutionNum:${payload.executionNum}`);
	}
	return null;
}

export function parseImmuneBrainTool(
	toolName: string,
	args: Record<string, unknown>,
): { operation: string; opArgs: Record<string, unknown>; taskId: string | null } | null {
	if (toolName === "invoke_subagent" || toolName === "Subagent") {
		return { operation: "invoke_subagent", opArgs: args, taskId: null };
	}
	if (toolName === "call_mcp_tool") {
		const server = String(args.ServerName ?? "");
		if (!IMMUNE_BRAIN_SERVERS.has(server)) return null;
		const op = String(args.ToolName ?? "");
		if (!op) return null;
		const raw = args.Arguments;
		const opArgs = typeof raw === "object" && raw !== null && !Array.isArray(raw)
			? (raw as Record<string, unknown>)
			: {};
		const taskId = typeof opArgs.task_id === "string" ? opArgs.task_id : null;
		return { operation: op, opArgs, taskId };
	}
	if (toolName.includes("immune-brain")) {
		const match = IMMUNE_BRAIN_DIRECT_TOOL.exec(toolName);
		if (!match) return null;
		const op = match[1];
		const taskId = typeof args.task_id === "string" ? args.task_id : null;
		return { operation: op, opArgs: args, taskId };
	}
	return null;
}

export function parseToolResponse(raw: unknown): Record<string, unknown> | null {
	let value = raw;
	if (typeof value === "string") {
		try { value = JSON.parse(value); } catch { return null; }
	}
	if (Array.isArray(value)) {
		const text = value.filter(item => item?.type === "text" && typeof item?.text === "string").map(item => item.text).join("");
		try { return JSON.parse(text); } catch { return null; }
	}
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const obj = value as Record<string, unknown>;
		if (Array.isArray(obj.content)) {
			const text = obj.content.filter(item => item?.type === "text" && typeof item?.text === "string").map(item => item.text).join("");
			try {
				const inner = JSON.parse(text);
				if (inner && typeof inner === "object" && !Array.isArray(inner)) return inner as Record<string, unknown>;
			} catch { return null; }
		}
		return obj;
	}
	return null;
}

export function recordPreToolUseCorrelationSync(
	payload: AntigravityPreToolUsePayload,
	root = tmpdir(),
): void {
	if (!payload.conversationId || payload.stepIdx === undefined) return;
	const host = antigravityContinuationHost(root);
	if (!host.entry_state(payload.conversationId)?.run_live) return;
	const tool = parseImmuneBrainTool(payload.toolCall.name, payload.toolCall.args ?? {});
	if (!tool || tool.operation === "invoke_subagent") return;
	let workspace: string;
	try {
		workspace = realpathSync(payload.workspacePaths?.[0] ?? process.cwd());
	} catch {
		workspace = payload.workspacePaths?.[0] ?? process.cwd();
	}
	const toolId = `${payload.conversationId}:${payload.stepIdx}`;
	const correlation = {
		session_id: payload.conversationId,
		workspace,
		tool_use_id: toolId,
		operation: tool.operation,
		task_id: tool.taskId,
	};
	const dir = cacheDir(root, host.cache_name);
	if (!ensurePrivateDir(dir)) return;
	const callFile = join(dir, `${sessionHash(toolId)}.continuation-call`);
	appendPrivate(callFile, dir, JSON.stringify(correlation) + "\n");
}

export async function antigravityRunContinuationPreToolUse(
	payload: AntigravityPreToolUsePayload,
	root = tmpdir(),
): Promise<PreToolUseHookDecision | null> {
	if (!payload.conversationId) return null;
	let workspace: string;
	try {
		workspace = realpathSync(payload.workspacePaths?.[0] ?? process.cwd());
	} catch {
		workspace = payload.workspacePaths?.[0] ?? process.cwd();
	}
	const tool = parseImmuneBrainTool(payload.toolCall.name, payload.toolCall.args ?? {});
	if (!tool) return null;

	if (payload.stepIdx === undefined) return null;
	const toolId = `${payload.conversationId}:${payload.stepIdx}`;

	try {
		if (tool.operation === "invoke_subagent") {
			const prompt = typeof tool.opArgs.Prompt === "string" ? tool.opArgs.Prompt : null;
			const promptDigest = prompt ? digestOfReviewerBytes(prompt) : null;
			await applyRunContinuationEvent(
				antigravityContinuationHost(root),
				root,
				{ session_id: payload.conversationId, workspace },
				{ kind: "reviewer", phase: "dispatch", call_id: toolId, prompt_digest: promptDigest, agent_id: null, asynchronous: false },
			);
			return null;
		}

		const outcome = await applyRunContinuationEvent(
			antigravityContinuationHost(root),
			root,
			{ session_id: payload.conversationId, workspace },
			{ kind: "tool_call", operation: tool.operation, tool_id: toolId, task_id: tool.taskId },
		);
		if (outcome.kind === "deny") {
			return {
				decision: "deny",
				reason: `Run paused: ${outcome.reason}; enter drive explicitly before another native gate`,
			};
		}
		return null;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			decision: "deny",
			reason: `continuation facts could not be verified: ${message}`,
		};
	}
}

export async function antigravityRunContinuationPostToolUse(
	payload: AntigravityPostToolUsePayload,
	root = tmpdir(),
): Promise<void> {
	if (!payload.conversationId || payload.stepIdx === undefined) return;
	let workspace: string;
	try {
		workspace = realpathSync(payload.workspacePaths?.[0] ?? process.cwd());
	} catch {
		workspace = payload.workspacePaths?.[0] ?? process.cwd();
	}
	const tool = parseImmuneBrainTool(payload.toolCall.name, payload.toolCall.args ?? {});
	if (!tool) return;

	const toolId = `${payload.conversationId}:${payload.stepIdx}`;
	try {
		if (tool.operation === "invoke_subagent") {
			await applyRunContinuationEvent(
				antigravityContinuationHost(root),
				root,
				{ session_id: payload.conversationId, workspace },
				{ kind: "reviewer", phase: "return", call_id: toolId, prompt_digest: null, agent_id: String(payload.stepIdx), asynchronous: false },
			);
			return;
		}

		const failed = typeof payload.error === "string" && payload.error.length > 0;
		const response = parseToolResponse(payload.result);
		await applyRunContinuationEvent(
			antigravityContinuationHost(root),
			root,
			{ session_id: payload.conversationId, workspace },
			{ kind: "tool_result", operation: tool.operation, tool_id: toolId, response, failed },
		);
	} catch {
		// PostToolUse observation failures fail closed without unhandled rejection crashing mcp-server.mjs --hook
	}
}

export async function antigravityRunContinuationHook(
	payload: AntigravityStopPayload,
	root = tmpdir(),
): Promise<{ decision?: "continue"; reason?: string; systemMessage?: string }> {
	if (!payload.conversationId) return {};
	let workspace: string;
	try {
		workspace = realpathSync(payload.workspacePaths?.[0] ?? process.cwd());
	} catch {
		workspace = payload.workspacePaths?.[0] ?? process.cwd();
	}

	const event: RunContinuationEvent = {
		kind: "stop",
		boundary: () => stopBoundary(payload as unknown as Record<string, unknown>),
		stop_hook_active: (payload as unknown as Record<string, unknown>).stop_hook_active !== false,
	};

	try {
		const outcome = await applyRunContinuationEvent(
			antigravityContinuationHost(root),
			root,
			{ session_id: payload.conversationId, workspace },
			event,
		);
		switch (outcome.kind) {
			case "continue":
				return {
					decision: "continue",
					reason: `Explicit drive is bound to ${outcome.label}; Kernel settlement is incomplete. ${outcome.next_action}. Continue the authorized Loop. ${USER_WAIT_GUIDANCE}`,
				};
			case "paused":
				return {
					reason: outcome.reason,
					systemMessage: `Immune-Brain run paused: ${outcome.reason}`,
				};
			default:
				return {};
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			reason: `continuation facts could not be verified: ${message}`,
			systemMessage: `Immune-Brain run paused: continuation facts could not be verified: ${message}`,
		};
	}
}
