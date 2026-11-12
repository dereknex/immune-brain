import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
	createMcpRuntime as createHostMcpRuntime,
	runMcpEntry,
	serveStdio as serveHostStdio,
	type McpHostProfile,
	type McpRuntime,
	type McpRuntimeOptions,
	type ServeStdioOptions,
} from "../host-core/mcp_runtime";
import { readSessionToolCall, type RunContinuationHost } from "../host-core/run_continuation_session";
import { AntigravityReviewHost, antigravityHookEventLog, ANTIGRAVITY_CACHE_DIR, type AntigravityHookEvent } from "./review_host";
import {
	antigravityPostToolUseHook,
	antigravityPreInvocationHook,
	antigravityPreToolUseHookAsync,
	consumeNativeConfirmation,
	consumePhaseAdmission,
	dropPhaseEntryLog,
	readPhaseEntryState,
	revokeEntryToken,
	type AntigravityPostToolUsePayload,
	type AntigravityPreInvocationPayload,
	type AntigravityPreToolUsePayload,
	type AntigravityStopPayload,
} from "./lane_guard";
import { antigravityRunContinuationHook } from "./run_continuation";
import { CORE_CONTRACT, MIN_ANTIGRAVITY_VERSION, probeHost } from "./capability";
import { AntigravityRuntime } from "./kernel_ports";

/**
 * The Antigravity continuation store, built from this adapter's own phase-entry
 * ports. Antigravity records no tool-call correlation, so no gated call resolves
 * a Hook session here.
 */
const antigravityContinuationHost = (root: string): RunContinuationHost => ({
	cache_name: ANTIGRAVITY_CACHE_DIR,
	entry_state: (sessionId) => readPhaseEntryState(sessionId, root),
	revoke_entry: (sessionId) => revokeEntryToken(sessionId, "spent", root),
	drop_entry_log: (sessionId) => dropPhaseEntryLog(sessionId, root),
});

/** The Antigravity composition root: every Antigravity-specific fact the shared MCP server needs. */
const ANTIGRAVITY_MCP_PROFILE: McpHostProfile = {
	serverInfo: { name: "antigravity", minimumHostVersion: MIN_ANTIGRAVITY_VERSION },
	contract: CORE_CONTRACT,
	// Antigravity reports itself as `antigravity-client` (CLI 1.5.3)
	// and `antigravity`, with a `v`-prefixed version.
	trustedClientNames: ["antigravity-client", "antigravity"],
	correlationMissingRefusal: "antigravity.google/conversation_id metadata is missing",
	// D4: Antigravity names the conversation, and the step its `progressToken`
	// ends with keys the admission the Hook wrote for that step.
	resolveHostCall: (operation, meta, messageId) => {
		const conversation = meta?.["antigravity.google/conversation_id"];
		if (typeof conversation !== "string" || !conversation) return undefined;
		const step = metaProgressStep(meta);
		return { toolCallId: String(messageId), ...(step === null ? {} : { admissionId: `${conversation}:${step}:${operation}` }) };
	},
	elicitationUnavailableRefusal: "interactive MCP elicitation is unavailable",
	probeHost,
	createHost: () => new AntigravityReviewHost(antigravityHookEventLog()),
	createRuntime: (options) => new AntigravityRuntime({ parentHost: "antigravity", ...options }).runtime,
	// ADR 0004: Antigravity opens literal-user confirmations through its native
	// `PreToolUse` `force_ask` channel and consumes the step-correlated grant here,
	// never through server-initiated MCP `elicitation/create`.
	requestConfirmation: (input) => consumeNativeConfirmation(input),
	consumePhaseAdmission: (toolCallId, operation) => consumePhaseAdmission(toolCallId, operation),
	readRunToolSession: (toolCallId, operation, workspace) =>
		readSessionToolCall(antigravityContinuationHost(tmpdir()), tmpdir(), toolCallId, operation, workspace),
	dispatchHook: runHook,
	bundlePath: fileURLToPath(import.meta.url),
};

export interface AntigravityMcpRuntimeOptions extends McpRuntimeOptions {
	/** Private store root for PreToolUse native confirmation grants; defaults to `os.tmpdir()`. */
	confirmationStoreRoot?: string;
}

export interface AntigravityServeStdioOptions extends ServeStdioOptions {
	/** Private store root for PreToolUse native confirmation grants; defaults to `os.tmpdir()`. */
	confirmationStoreRoot?: string;
}

function withConfirmationStore<T extends McpRuntimeOptions>(options: T & { confirmationStoreRoot?: string }): T {
	const { confirmationStoreRoot, ...rest } = options;
	if (!confirmationStoreRoot) return rest as T;
	return {
		...rest,
		requestConfirmation: rest.requestConfirmation ?? ((input) => consumeNativeConfirmation(input, confirmationStoreRoot)),
		consumePhaseAdmission:
			rest.consumePhaseAdmission ?? ((toolCallId, operation) => consumePhaseAdmission(toolCallId, operation, confirmationStoreRoot)),
	} as T;
}

export const createAntigravityMcpRuntime = (options: AntigravityMcpRuntimeOptions = {}): McpRuntime =>
	createHostMcpRuntime(ANTIGRAVITY_MCP_PROFILE, withConfirmationStore(options));

/**
 * The shared bidirectional transport can serve `roots/list`; `ANTIGRAVITY_MCP_PROFILE`
 * keeps its Hook-backed `requestConfirmation` port instead of `elicitation/create`.
 */
export const serveStdio = (options: AntigravityServeStdioOptions = {}): Promise<void> =>
	serveHostStdio(ANTIGRAVITY_MCP_PROFILE, withConfirmationStore(options));

/**
 * The step index Antigravity appends to a call's `progressToken` (E4): the final
 * `:<decimal>` suffix. The token's prefix is evidence, never a session credential.
 */
function metaProgressStep(meta: Record<string, unknown> | undefined): number | null {
	const token = meta?.progressToken;
	if (typeof token !== "string") return null;
	const match = /:(\d+)$/.exec(token);
	return match ? Number(match[1]) : null;
}

/** Append the start event for a subagent dispatch that may complete the same `stepIdx`. */
function appendSubagentStart(toolCall: { name: string; args?: Record<string, unknown> }, payload: Record<string, unknown>): void {
	if (toolCall.name !== "invoke_subagent" && toolCall.name !== "Subagent") return;
	if (typeof payload.stepIdx !== "number") return;
	const args = toolCall.args ?? {};
	const event: AntigravityHookEvent = {
		type: "start",
		sessionId: String(payload.conversationId ?? ""),
		agent: typeof args.TypeName === "string" ? args.TypeName : "",
		agentId: String(payload.stepIdx),
		...(typeof args.Prompt === "string" ? { prompt: args.Prompt } : {}),
		...(typeof args.Model === "string" ? { model: args.Model } : {}),
	};
	antigravityHookEventLog().append(event);
}

export async function runHook(): Promise<void> {
	const lines: string[] = [];
	const rl = createInterface({ input: stdin, terminal: false });
	for await (const line of rl) lines.push(line);
	const raw = lines.join("\n").trim();
	if (!raw) return;

	let payload: Record<string, unknown> | null = null;
	try {
		payload = JSON.parse(raw);
	} catch {
		return;
	}

	if (!payload) return;

	// D1: the payload's own shape decides the response, most specific first. A tool
	// payload carries `lastUserInput` too (#469), so it is a tool before it is a
	// PreInvocation; a Stop marker outranks the PreInvocation marker.
	if ("toolCall" in payload && typeof payload.toolCall === "object" && payload.toolCall !== null) {
		const toolCall = payload.toolCall as { name: string; args?: Record<string, unknown> };

		// PostToolUse observation: this Host's terminal event for a dispatch.
		if ("stepIdx" in payload && ("error" in payload || "result" in payload)) {
			if (toolCall.name === "invoke_subagent" || toolCall.name === "Subagent") {
				const args = toolCall.args ?? {};
				const model = typeof args.Model === "string" ? args.Model : undefined;
				const prompt = typeof args.Prompt === "string" ? args.Prompt : undefined;
				const result = typeof payload.result === "string" ? payload.result : "";
				const event: AntigravityHookEvent = {
					type: "result",
					sessionId: String(payload.conversationId ?? ""),
					agentId: String(payload.stepIdx ?? ""),
					result,
					...(model ? { model } : {}),
					...(prompt ? { prompt } : {}),
				};
				antigravityHookEventLog().append(event);
			}
			antigravityPostToolUseHook(payload as unknown as AntigravityPostToolUsePayload);
			stdout.write("{}\n");
			return;
		}

		// PreToolUse: an allowed subagent dispatch is the start event of the call
		// the matching PostToolUse terminates (Spec D4).
		const result = await antigravityPreToolUseHookAsync(payload as unknown as AntigravityPreToolUsePayload);
		if (result.decision === "allow") appendSubagentStart(toolCall, payload);
		stdout.write(JSON.stringify(result) + "\n");
		return;
	}

	// Stop hook: has terminationReason or executionNum
	if ("terminationReason" in payload || "executionNum" in payload) {
		const result = await antigravityRunContinuationHook(payload as unknown as AntigravityStopPayload);
		stdout.write(JSON.stringify(result) + "\n");
		return;
	}

	// PreInvocation: has lastUserInput or invocationNum
	if ("invocationNum" in payload || "lastUserInput" in payload) {
		const result = antigravityPreInvocationHook(payload as unknown as AntigravityPreInvocationPayload);
		stdout.write(JSON.stringify(result) + "\n");
		return;
	}

	stdout.write("{}\n");
}

// Only this module's own entrypoint starts the Antigravity server: the bundle
// also contains the Claude module entrypoint, which must not start here.
runMcpEntry(ANTIGRAVITY_MCP_PROFILE, ["/antigravity/mcp_server.ts", "/antigravity/mcp-server.mjs"]);
