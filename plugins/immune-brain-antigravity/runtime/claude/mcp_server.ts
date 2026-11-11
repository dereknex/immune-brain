// Claude Code MCP adapter (Issue #414 slice S4, Spec
// docs/specs/host-neutral-adapter-core.spec.md D8). The server itself is
// `../host-core/mcp_runtime`; this module supplies the Claude profile, the
// `--hook` dispatch and the entrypoint guard.
//
// Interface: `createMcpRuntime`, `handleJsonRpc`, `serveStdio`, `runHook`, and
// the shared runtime's tool surface re-exported for existing callers.
// Invariants: every Claude-specific fact lives in `CLAUDE_MCP_PROFILE`; this
// module implements no transport; it imports no other adapter.
// Side Effects: Hook stdout and the Claude private event log.
// Verification: `bun test tests/claude-host-authority.test.ts`.

import { existsSync, readdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { stdin } from "node:process";
import { fileURLToPath } from "node:url";
import { readActiveClaimTaskId } from "../unattended/batch_preflight";
import { BatchRuntimeTooOldError, isTerminalBatchState, readAnyBatchRunState } from "../unattended/batch_state";
import {
	createMcpRuntime as createHostMcpRuntime,
	handleJsonRpc as handleHostJsonRpc,
	runMcpEntry,
	serveStdio as serveHostStdio,
	type JsonRpc,
	type McpHostProfile,
	type McpRuntime,
	type McpRuntimeOptions,
	type ServeStdioOptions,
} from "../host-core/mcp_runtime";
import { CORE_CONTRACT, HOST_ID, MIN_CLAUDE_CODE_VERSION, probeHost } from "./capability";
import { ClaudeReviewHost, claudeHookEventLog, parseHookStdin } from "./review_host";
import { activeTaskHookOutput, consumePhaseAdmission, laneGuardHookOutput, phaseEntryGateHookOutput, recordPhaseEntryPrompt } from "./lane_guard";
import { readRunToolSession, runContinuationHookOutput } from "./run_continuation";
import { ClaudeRuntime } from "./kernel_ports";

export {
	MCP_PROTOCOL_VERSION,
	TOOLS,
	elicitationParams,
	listMcpTools,
	supportsElicitationProtocol,
	withCompletionDelivery,
	type JsonRpc,
	type McpHostProfile,
	type McpRuntimeOptions,
	type ServeStdioOptions,
} from "../host-core/mcp_runtime";

/** The Claude Code composition root: every Claude-specific fact the shared MCP server needs. */
const CLAUDE_MCP_PROFILE: McpHostProfile = {
	serverInfo: { name: HOST_ID, minimumHostVersion: MIN_CLAUDE_CODE_VERSION },
	contract: CORE_CONTRACT,
	trustedClientNames: [HOST_ID],
	toolCallIdMetaKey: "claudecode/toolUseId",
	correlationMissingRefusal: "canonical claudecode/toolUseId metadata is missing",
	elicitationUnavailableRefusal: "interactive MCP elicitation is unavailable",
	elicitationRejectedRefusal: "Claude Code rejected MCP elicitation/create",
	probeHost,
	createHost: () => new ClaudeReviewHost(claudeHookEventLog()),
	createRuntime: (options) => new ClaudeRuntime(options).runtime,
	consumePhaseAdmission: (toolCallId, operation) => consumePhaseAdmission(toolCallId, operation),
	readRunToolSession: (toolCallId, operation, workspace) => readRunToolSession(toolCallId, operation, workspace),
	dispatchHook: runHook,
	bundlePath: fileURLToPath(import.meta.url),
};

export const createMcpRuntime = (options: McpRuntimeOptions = {}): McpRuntime => createHostMcpRuntime(CLAUDE_MCP_PROFILE, options);

export const handleJsonRpc = (message: JsonRpc, mcp: McpRuntime = createMcpRuntime()): Promise<JsonRpc | null> =>
	handleHostJsonRpc(message, mcp);

export const serveStdio = (options: ServeStdioOptions = {}): Promise<void> => serveHostStdio(CLAUDE_MCP_PROFILE, options);

async function runHook(): Promise<void> {
	const lines: string[] = [];
	const rl = createInterface({ input: stdin });
	for await (const line of rl) lines.push(line);
	const raw = lines.join("\n");
	let payload: Record<string, unknown> | null = null;
	try { payload = JSON.parse(raw) as Record<string, unknown>; } catch { payload = null; }
	if (payload?.hook_event_name === "PreToolUse") {
		const decision = laneGuardHookOutput(payload) ?? phaseEntryGateHookOutput(payload) ?? await runContinuationHookOutput(payload);
		if (decision) process.stdout.write(`${decision}\n`);
		return;
	}
	if (payload?.hook_event_name === "UserPromptSubmit") {
		recordPhaseEntryPrompt(payload);
		await runContinuationHookOutput(payload);
		const notice = await activeTaskHookOutput(payload);
		if (notice) process.stdout.write(`${notice}\n`);
		return;
	}
	if (payload) {
		const continuation = await runContinuationHookOutput(payload);
		if (continuation) process.stdout.write(`${continuation}\n`);
	}
	const event = parseHookStdin(raw);
	if (!event) return;
	const cwd = typeof payload?.cwd === "string" && payload.cwd ? payload.cwd : process.cwd();
	if (!readActiveClaimTaskId(cwd)) {
		const batchesDir = join(cwd, ".imm", "state", "batches");
		const activeBatch = existsSync(batchesDir) && readdirSync(batchesDir).some((file) => {
			if (!file.endsWith(".json") || file.endsWith(".report.json")) return false;
			try {
				const batch = readAnyBatchRunState(cwd, file.slice(0, -5));
				return batch !== null && !isTerminalBatchState(batch.batch_state);
			} catch (error) {
				if (error instanceof BatchRuntimeTooOldError) return true;
				throw error;
			}
		});
		if (!activeBatch) return;
	}
	claudeHookEventLog().append(event);
}

// Only this module's own entrypoint starts the server: the Antigravity bundle
// includes this module and must not start a second stdio server.
runMcpEntry(CLAUDE_MCP_PROFILE, ["/claude/mcp_server.ts", "/claude/mcp-server.mjs"]);
