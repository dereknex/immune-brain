import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { createMcpRuntime, handleJsonRpc, type McpRuntimeOptions, type JsonRpc } from "../claude/mcp_server";
import { AntigravityReviewHost, FileHookEventLog, type AntigravityHookEvent } from "./review_host";
import {
	antigravityPreInvocationHook,
	antigravityPreToolUseHook,
	type AntigravityPreInvocationPayload,
	type AntigravityPreToolUsePayload,
	type AntigravityStopPayload,
} from "./lane_guard";
import { antigravityRunContinuationHook } from "./run_continuation";

export function createAntigravityMcpRuntime(options: McpRuntimeOptions = {}) {
	const host = options.host ?? new AntigravityReviewHost(new FileHookEventLog());
	return createMcpRuntime({
		...options,
		parentHost: "antigravity",
		host,
	});
}

export async function serveStdio(options: McpRuntimeOptions = {}): Promise<void> {
	const runtime = createAntigravityMcpRuntime(options);
	const rl = createInterface({ input: stdin, terminal: false });
	for await (const line of rl) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const message = JSON.parse(trimmed) as JsonRpc;
			const response = await handleJsonRpc(message, runtime);
			if (response) stdout.write(JSON.stringify(response) + "\n");
		} catch (err: unknown) {
			const errorResponse = {
				jsonrpc: "2.0",
				id: null,
				error: { code: -32700, message: "Parse error" },
			};
			stdout.write(JSON.stringify(errorResponse) + "\n");
		}
	}
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
				new FileHookEventLog().append(event);
			}
			stdout.write("{}\n");
			return;
		}

		// PreToolUse
		const result = antigravityPreToolUseHook(payload as unknown as AntigravityPreToolUsePayload);
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
if (entry.endsWith("mcp_server.ts") || entry.endsWith("mcp-server.mjs") || entry.endsWith("antigravity/mcp-server.mjs")) {
	if (process.argv.includes("--hook")) void runHook();
	else void serveStdio();
}
