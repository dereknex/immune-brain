import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import type { Readable, Writable } from "node:stream";
import { createMcpRuntime, serveStdio as serveSharedStdio, type McpRuntimeOptions } from "../claude/mcp_server";
import { AntigravityReviewHost, antigravityHookEventLog, type AntigravityHookEvent } from "./review_host";
import {
	antigravityPreInvocationHook,
	antigravityPreToolUseHook,
	type AntigravityPreInvocationPayload,
	type AntigravityPreToolUsePayload,
	type AntigravityStopPayload,
} from "./lane_guard";
import { antigravityRunContinuationHook } from "./run_continuation";
import { MIN_ANTIGRAVITY_VERSION, probeHost } from "./capability";

export function createAntigravityMcpRuntime(options: McpRuntimeOptions = {}) {
	const host = options.host ?? new AntigravityReviewHost(antigravityHookEventLog());
	return createMcpRuntime({
		...options,
		parentHost: "antigravity",
		probeHost: options.probeHost ?? probeHost,
		host,
		// Antigravity reports itself as `antigravity-client` (CLI 1.5.3)
		// and `antigravity`, with a `v`-prefixed version.
		trustedClientNames: options.trustedClientNames ?? ["antigravity-client", "antigravity"],
		serverInfo: options.serverInfo ?? { name: "antigravity", minimumHostVersion: MIN_ANTIGRAVITY_VERSION },
	});
}

export async function serveStdio(
	options: McpRuntimeOptions & { input?: Readable; output?: Writable; exit?: (code: number) => void } = {},
): Promise<void> {
	const { input, output, exit, ...runtimeOptions } = options;
	// The shared bidirectional transport can serve `roots/list`; the readline
	// loop this replaced could not issue server-to-client requests.
	await serveSharedStdio({ input, output, exit, runtime: createAntigravityMcpRuntime(runtimeOptions) });
}

/** Append the start event for a subagent dispatch that may complete the same `stepIdx`. */
function appendSubagentStart(toolCall: { name: string; args?: Record<string, unknown> }, payload: Record<string, unknown>): void {
	if (toolCall.name !== "invoke_subagent" && toolCall.name !== "Subagent") return;
	if (typeof payload.stepIdx !== "number") return;
	const args = toolCall.args ?? {};
	const event: AntigravityHookEvent = {
		type: "SubagentStart",
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

	// PreInvocation: has lastUserInput or invocationNum
	if ("invocationNum" in payload || "lastUserInput" in payload) {
		const result = antigravityPreInvocationHook(payload as unknown as AntigravityPreInvocationPayload);
		stdout.write(JSON.stringify(result) + "\n");
		return;
	}

	// Tool hook: has toolCall
	if ("toolCall" in payload && typeof payload.toolCall === "object" && payload.toolCall !== null) {
		const toolCall = payload.toolCall as { name: string; args?: Record<string, unknown> };

		// PostToolUse observation
		if ("stepIdx" in payload && ("error" in payload || "result" in payload)) {
			if (toolCall.name === "invoke_subagent" || toolCall.name === "Subagent") {
				const args = toolCall.args ?? {};
				const model = typeof args.Model === "string" ? args.Model : undefined;
				const prompt = typeof args.Prompt === "string" ? args.Prompt : undefined;
				const result = typeof payload.result === "string" ? payload.result : "";
				const event: AntigravityHookEvent = {
					type: "PostToolUse",
					sessionId: String(payload.conversationId ?? ""),
					agentId: String(payload.stepIdx ?? ""),
					toolName: "invoke_subagent",
					result,
					model,
					prompt,
				};
				antigravityHookEventLog().append(event);
			}
			stdout.write("{}\n");
			return;
		}

		// PreToolUse: an allowed subagent dispatch is the start event of the call
		// the matching PostToolUse terminates (Spec D4).
		const result = antigravityPreToolUseHook(payload as unknown as AntigravityPreToolUsePayload);
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

	stdout.write("{}\n");
}

const entry = process.argv[1] ?? "";
// Only this module's own entrypoint starts the Antigravity server: the bundle
// also contains the Claude module entrypoint, which must not start here.
if (entry.endsWith("/antigravity/mcp_server.ts") || entry.endsWith("/antigravity/mcp-server.mjs")) {
	if (process.argv.includes("--hook")) void runHook();
	else void serveStdio();
}
