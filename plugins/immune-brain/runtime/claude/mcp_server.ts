import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import type { Readable, Writable } from "node:stream";
import { CORE_CONTRACT, HOST_ID, MIN_CLAUDE_CODE_VERSION, probeHost } from "./capability";
import { isPrivilegedOperation, privilegedAnnotations, type NativeDecision } from "./interaction";
import { ClaudeReviewHost, FileHookEventLog, parseHookStdin } from "./review_host";
import { ClaudeRuntime, type ToolMeta } from "./kernel_ports";
import type { AssuranceCoordinatorPorts } from "../assurance/coordinator";

export const TOOLS = [
	{ name: "status", description: "Read the Kernel Assurance Projection for an exact task.", privileged: false },
	{ name: "enroll", description: "Enroll a Git-tracked TaskIntent after native confirmation.", privileged: true },
	{ name: "advance_assurance", description: "Advance frozen Assurance through deterministic QA and Review reservation.", privileged: false },
	{ name: "submit_review", description: "Submit the Parent-mediated Review verdict bound to the correlated receipt.", privileged: false },
	{ name: "request_authorization", description: "Apply exact literal-user authorization.", privileged: true },
	{ name: "approve_breaking_intent_revision", description: "Approve a breaking TaskIntent revision.", privileged: true },
	{ name: "stop", description: "Stop the active task with literal-user authority.", privileged: true },
	{ name: "repair_authority_state", description: "Repair a recoverable stale backend claim.", privileged: true },
] as const;

export function listMcpTools() {
	return TOOLS.map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: {
			type: "object",
			properties: {
				task_id: { type: "string" },
				...(tool.name === "approve_breaking_intent_revision" ? { next_intent: { type: "object" } } : {}),
				...(tool.name === "stop" ? { reason: { type: "string" } } : {}),
				...(tool.name === "submit_review" ? { verdict: { type: "object" } } : {}),
			},
			required: tool.name === "submit_review" ? ["task_id", "verdict"] : ["task_id"],
		},
		annotations: tool.privileged ? privilegedAnnotations() : { readOnlyHint: tool.name === "status" },
	}));
}

export interface McpRuntimeOptions {
	cwd?: string;
	env?: Record<string, string | undefined>;
	ports?: AssuranceCoordinatorPorts;
	host?: ClaudeReviewHost;
	interactive?: boolean;
	decisions?: Map<string, NativeDecision>;
}

export function createMcpRuntime(options: McpRuntimeOptions = {}) {
	const host = options.host ?? new ClaudeReviewHost(new FileHookEventLog());
	const runtime = new ClaudeRuntime({
		cwd: options.cwd ?? process.cwd(),
		env: options.env ?? process.env,
		host,
		ports: options.ports,
		interactive: options.interactive,
		decisions: options.decisions,
	});
	// Trusted Host evidence negotiated on this JSON-RPC connection. Absent
	// handshake evidence means unversioned and non-interactive: fail closed.
	let negotiatedVersion: string | undefined;
	let negotiatedInteractive = false;
	return {
		runtime,
		host,
		listTools: listMcpTools,
		bindClientHandshake(identity: { version: string; interactive: boolean }) {
			negotiatedVersion = identity.version || undefined;
			negotiatedInteractive = identity.interactive;
			runtime.bindHostVersion(negotiatedVersion);
		},
		sessionInteractive: () => negotiatedInteractive,
		async callTool(name: string, args: Record<string, unknown>, meta: Partial<ToolMeta> = {}) {
			const taskId = String(args.task_id ?? "");
			if (!taskId) throw new Error("task_id is required");
			if ("native_decision" in args) throw new Error("native_decision cannot be supplied in tool arguments");
			// Read-only status must stay usable without trusted Host evidence, so it
			// is dispatched before the capability probe rejects unversioned hosts.
			if (name === "status") return runtime.status(taskId);
			// The environment version fallback is disabled on this connection:
			// only a version bound from the trusted initialize handshake may
			// reach authority-mutating tools.
			if (!negotiatedVersion) throw new Error("Claude Code version is unavailable");
			// Every authority-mutating tool requires the handshake to have
			// declared elicitation support: only read-only status works on
			// non-interactive sessions, so QA/review/completion cannot mutate
			// Kernel state without native interaction capability.
			if (!negotiatedInteractive) throw new Error("non-interactive host session cannot execute authority tools");
			const probe = probeHost(options.env ?? process.env, process.platform, negotiatedVersion);
			if (!probe.ok) throw new Error(probe.reason);
			const toolMeta: ToolMeta = {
				sessionId: meta.sessionId ?? "session",
				toolCallId: meta.toolCallId ?? `call-${name}`,
				taskId,
				requiresUserInteraction: meta.requiresUserInteraction ?? isPrivilegedOperation(name),
				permissionMode: meta.permissionMode ?? probe.permissionMode,
				interactive: meta.interactive ?? options.interactive ?? false,
				decision: meta.decision,
			};
			if (name === "enroll") return runtime.enroll(taskId, toolMeta);
			if (name === "advance_assurance") return runtime.advance(taskId, toolMeta.signal);
			if (name === "submit_review") {
				if (!Object.hasOwn(args, "verdict")) throw new Error("verdict is required");
				return runtime.submitReview(taskId, args.verdict);
			}
			if (name === "request_authorization" || name === "approve_breaking_intent_revision" || name === "stop" || name === "repair_authority_state") {
				return runtime.authorize(taskId, name, toolMeta, args);
			}
			throw new Error(`unknown tool ${name}`);
		},
		observe: (event: Parameters<ClaudeReviewHost["observe"]>[0]) => host.observe(event),
		sessionOfElicitation: (toolCallId: string) => host.sessionOfElicitation(toolCallId),
		shutdown: () => runtime.shutdown(),
		aborts: new Map<string | number, AbortController>(),
	};
}

interface JsonRpc {
	jsonrpc: "2.0";
	id?: string | number | null;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code: number; message: string };
}

function hostCallIdentity(
	meta: Record<string, unknown> | undefined,
	resolveSession?: (toolCallId: string) => string | undefined,
): { sessionId: string; toolCallId: string } | undefined {
	if (!meta) return undefined;
	// Real Claude Code wire correlation metadata carries ONLY the namespaced
	// claudecode/toolUseId key; any other correlation key (tool_use_id,
	// toolUseId, toolCallId) is noncanonical and fails closed. The Host session
	// binding is always derived from the sole unconsumed ElicitationResult
	// record for that exact call; no record, or an ambiguous record, means no
	// native interaction: fail closed. A supplied session_id is never trusted
	// and can never bypass ambiguity resolution.
	const toolCallId = meta["claudecode/toolUseId"];
	if (typeof toolCallId !== "string" || !toolCallId) return undefined;
	const sessionId = resolveSession?.(toolCallId);
	return sessionId ? { sessionId, toolCallId } : undefined;
}

function encodeMessage(message: JsonRpc): Buffer {
	return Buffer.from(`${JSON.stringify(message)}\n`);
}

export async function handleJsonRpc(message: JsonRpc, mcp = createMcpRuntime()): Promise<JsonRpc | null> {
	if (message.method === "initialize") {
		const params = (message.params ?? {}) as {
			clientInfo?: { name?: unknown; version?: unknown };
			capabilities?: Record<string, unknown>;
		};
		// Trust binds to the exact Claude Code client identity: name, parseable
		// version at the floor, and elicitation capability. Any other client
		// name stays unversioned and non-interactive; read-only status remains usable.
		const trustedClient = params.clientInfo?.name === HOST_ID;
		const elicitation = params.capabilities?.elicitation;
		mcp.bindClientHandshake({
			version: trustedClient && typeof params.clientInfo?.version === "string" ? params.clientInfo.version : "",
			// A client that does not declare elicitation support cannot surface
			// the native interactions privileged authority requires; only a
			// valid capability object counts, not any non-null value.
			interactive: trustedClient && elicitation !== null && typeof elicitation === "object" && !Array.isArray(elicitation),
		});
		return {
			jsonrpc: "2.0",
			id: message.id ?? null,
			result: {
				protocolVersion: "2024-11-05",
				serverInfo: { name: HOST_ID, version: MIN_CLAUDE_CODE_VERSION, contract: CORE_CONTRACT },
				capabilities: { tools: {} },
			},
		};
	}
	if (message.method === "notifications/initialized") return null;
	if (message.method === "notifications/cancelled") {
		const requestId = (message.params as { requestId?: string | number } | undefined)?.requestId;
		if (requestId !== undefined) mcp.aborts.get(requestId)?.abort(new Error("notifications/cancelled"));
		return null;
	}
	if (message.method === "tools/list") {
		return { jsonrpc: "2.0", id: message.id ?? null, result: { tools: mcp.listTools() } };
	}
	if (message.method === "tools/call") {
		const params = (message.params ?? {}) as { name?: string; arguments?: Record<string, unknown>; _meta?: Record<string, unknown> };
		const requestId = message.id ?? `anon-${Date.now()}`;
		const ac = new AbortController();
		mcp.aborts.set(requestId, ac);
		try {
			const name = String(params.name ?? "");
			const interactive = mcp.sessionInteractive();
			if (isPrivilegedOperation(name) && !interactive) {
				throw new Error("non-interactive host session cannot mint authority");
			}
			const identity = hostCallIdentity(params._meta, (toolCallId) => mcp.sessionOfElicitation(toolCallId));
			if (isPrivilegedOperation(name) && !identity) {
				throw new Error("host correlation metadata missing");
			}
			const sessionId = identity?.sessionId ?? "stdio";
			const toolCallId = identity?.toolCallId ?? String(message.id ?? "stdio");
			const result = await mcp.callTool(name, params.arguments ?? {}, {
				sessionId,
				toolCallId,
				interactive,
				requiresUserInteraction: isPrivilegedOperation(name),
				signal: ac.signal,
			});
			return {
				jsonrpc: "2.0",
				id: message.id ?? null,
				result: { content: [{ type: "text", text: JSON.stringify(result) }] },
			};
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			return {
				jsonrpc: "2.0",
				id: message.id ?? null,
				error: { code: -32000, message: reason },
			};
		} finally {
			mcp.aborts.delete(requestId);
		}
	}
	if (message.id === undefined) return null;
	return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `unknown method ${message.method}` } };
}

async function writeReply(output: Writable, reply: JsonRpc): Promise<void> {
	const payload = encodeMessage(reply);
	if (output.write(payload)) return;
	await new Promise<void>((resolve) => output.once("drain", resolve));
}

export async function serveStdio(options: {
	input?: Readable;
	output?: Writable;
	runtime?: ReturnType<typeof createMcpRuntime>;
	exit?: (code: number) => void;
} = {}): Promise<void> {
	const input = options.input ?? stdin;
	const output = options.output ?? stdout;
	const mcp = options.runtime ?? createMcpRuntime({ cwd: process.cwd() });
	const exit = options.exit ?? ((code: number) => { process.exit(code); });
	let buffer = Buffer.alloc(0);
	let accepting = true;
	const inFlight = new Set<Promise<void>>();
	let chain = Promise.resolve();

	const runCall = (parsed: JsonRpc): void => {
		const task = handleJsonRpc(parsed, mcp).then(async (reply) => {
			if (reply) await writeReply(output, reply);
		});
		inFlight.add(task);
		void task.finally(() => inFlight.delete(task));
	};

	const drainStdio = async (): Promise<void> => {
		while (true) {
			const newline = buffer.indexOf("\n");
			if (newline < 0) return;
			const body = buffer.subarray(0, newline).toString("utf8").trim();
			buffer = buffer.subarray(newline + 1);
			if (!body) continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(body);
			} catch {
				await writeReply(output, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
				continue;
			}
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
				await writeReply(output, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
				continue;
			}
			const obj = parsed as Record<string, unknown>;
			if (obj.jsonrpc !== "2.0") {
				await writeReply(output, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: jsonrpc must be '2.0'" } });
				continue;
			}
			if (typeof obj.method !== "string" || !obj.method) {
				const id = obj.id !== undefined && (typeof obj.id === "string" || typeof obj.id === "number") ? obj.id : null;
				await writeReply(output, { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request: missing method" } });
				continue;
			}
			if (obj.id !== undefined && typeof obj.id !== "string" && typeof obj.id !== "number" && obj.id !== null) {
				await writeReply(output, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: invalid id type" } });
				continue;
			}
			// tools/call is a request requiring a reply; notification-form tools/call (no id) is an invalid request
			if (obj.method === "tools/call" && obj.id === undefined) {
				await writeReply(output, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: tools/call requires an id" } });
				continue;
			}
			const rpc = parsed as JsonRpc;
			if (rpc.method === "notifications/cancelled") {
				const requestId = (rpc.params as { requestId?: string | number } | undefined)?.requestId;
				if (requestId !== undefined) mcp.aborts.get(requestId)?.abort(new Error("notifications/cancelled"));
				continue;
			}
			if (parsed.method === "tools/call") {
				if (!accepting) {
					if (rpc.id !== undefined) await writeReply(output, { jsonrpc: "2.0", id: rpc.id, error: { code: -32000, message: "stdio closed" } });
					continue;
				}
				runCall(rpc);
				continue;
			}
			const reply = await handleJsonRpc(rpc, mcp);
			if (reply) await writeReply(output, reply);
		}
	};

	let shutdownPromise: Promise<void> | null = null;
	const executeShutdown = (code = 0): Promise<void> => {
		if (shutdownPromise) return shutdownPromise;
		shutdownPromise = (async () => {
			accepting = false;
			for (const ac of mcp.aborts.values()) ac.abort(new Error("stdio closed"));
			await Promise.allSettled([...inFlight]);
			await mcp.shutdown();
			if (output.writable && typeof output.end === "function") {
				await new Promise<void>((cb) => output.end(() => cb()));
			}
			process.exitCode = code;
			exit(code);
		})();
		return shutdownPromise;
	};

	await new Promise<void>((resolve) => {
		input.on("data", (chunk: Buffer | string) => {
			chain = chain.then(async () => {
				buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
				await drainStdio();
			});
		});
		input.on("end", () => {
			void chain.then(() => executeShutdown(0)).finally(resolve);
		});
		input.on("close", () => {
			void chain.then(() => executeShutdown(0)).finally(resolve);
		});
		input.on("error", () => {
			void chain.then(() => executeShutdown(1)).finally(resolve);
		});
	});
}

async function runHook(): Promise<void> {
	const lines: string[] = [];
	const rl = createInterface({ input: stdin });
	for await (const line of rl) lines.push(line);
	const event = parseHookStdin(lines.join("\n"));
	if (!event) return;
	new FileHookEventLog().append(event);
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("mcp_server.ts") || entry.endsWith("mcp-server.mjs")) {
	if (process.argv.includes("--hook")) void runHook();
	else void serveStdio();
}
