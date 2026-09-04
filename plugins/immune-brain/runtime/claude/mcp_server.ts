import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import type { Readable, Writable } from "node:stream";
import { CORE_CONTRACT, HOST_ID, MIN_CLAUDE_CODE_VERSION, probeHost } from "./capability";
import { PLUGIN_VERSION } from "../plugin_version";
import {
	isPrivilegedOperation,
	NativeAuthorityError,
	privilegedAnnotations,
	type NativeConfirmationInput,
	type NativeConfirmationPort,
} from "./interaction";
import { ClaudeReviewHost, FileHookEventLog, parseHookStdin } from "./review_host";
import { ClaudeRuntime, type ToolMeta } from "./kernel_ports";
import type { AssuranceCoordinatorPorts } from "../assurance/coordinator";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export const TOOLS = [
	{ name: "status", description: "Read the Kernel Assurance Projection for an exact task.", privileged: false },
	{ name: "enroll", description: "Enroll a Git-tracked TaskIntent after native confirmation.", privileged: true },
	{ name: "advance_assurance", description: "Advance frozen Assurance through deterministic QA and Review reservation.", privileged: false },
	{ name: "submit_review", description: "Submit the Parent-mediated Review verdict bound to the correlated receipt.", privileged: false },
	{ name: "request_authorization", description: "Apply exact literal-user authorization.", privileged: true },
	{ name: "approve_breaking_intent_revision", description: "Approve a breaking TaskIntent revision.", privileged: true },
	{ name: "stop", description: "Stop the active task with literal-user authority.", privileged: true },
	{ name: "repair_authority_state", description: "Repair a proven recoverable stale backend claim.", privileged: false },
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

export function supportsElicitationProtocol(value: unknown): boolean {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= MCP_PROTOCOL_VERSION;
}

export interface McpRuntimeOptions {
	cwd?: string;
	env?: Record<string, string | undefined>;
	ports?: AssuranceCoordinatorPorts;
	host?: ClaudeReviewHost;
	interactive?: boolean;
	requestConfirmation?: NativeConfirmationPort;
}

export function createMcpRuntime(options: McpRuntimeOptions = {}) {
	const host = options.host ?? new ClaudeReviewHost(new FileHookEventLog());
	const runtime = new ClaudeRuntime({
		cwd: options.cwd ?? process.cwd(),
		env: options.env ?? process.env,
		host,
		ports: options.ports,
		interactive: options.interactive,
		requestConfirmation: options.requestConfirmation,
	});
	// Trusted Host evidence negotiated on this JSON-RPC connection. Absent
	// handshake evidence means unversioned and non-interactive: fail closed.
	let negotiatedVersion: string | undefined;
	let negotiatedInteractive = false;
	const connectionId = randomUUID();
	return {
		runtime,
		host,
		connectionId,
		listTools: listMcpTools,
		bindClientHandshake(identity: { version: string; interactive: boolean; protocolVersion?: string }) {
			negotiatedVersion = identity.version || undefined;
			negotiatedInteractive = identity.interactive && supportsElicitationProtocol(identity.protocolVersion);
			runtime.bindHostVersion(negotiatedVersion);
		},
		bindNativeConfirmation(port: NativeConfirmationPort) {
			runtime.bindNativeConfirmation(port);
		},
		sessionInteractive: () => negotiatedInteractive,
		async callTool(name: string, args: Record<string, unknown>, meta: Partial<ToolMeta> = {}) {
			const taskId = String(args.task_id ?? "");
			if (!taskId) throw new Error("task_id is required");
			if ("native_decision" in args) throw new Error("native_decision cannot be supplied in tool arguments");
			// Read-only status must stay usable without trusted Host evidence, so it
			// is dispatched before the capability probe rejects unversioned hosts.
			if (name === "status") return { plugin_version: PLUGIN_VERSION, ...(await runtime.status(taskId)) };
			// The environment version fallback is disabled on this connection:
			// only a version bound from the trusted initialize handshake may
			// reach authority-mutating tools.
			if (!negotiatedVersion) throw new NativeAuthorityError("unsupported_host", "Claude Code version is unavailable");
			// Automatic stale-claim repair is deterministic and needs no native
			// interaction; other mutations retain the Host capability requirement.
			if (!negotiatedInteractive && name !== "repair_authority_state") {
				throw new NativeAuthorityError("unsupported_host", "interactive MCP elicitation is unavailable");
			}
			const probe = probeHost(options.env ?? process.env, process.platform, negotiatedVersion);
			if (!probe.ok) throw new NativeAuthorityError("unsupported_host", probe.reason);
			const toolMeta: ToolMeta = {
				sessionId: meta.sessionId ?? connectionId,
				toolCallId: meta.toolCallId ?? `call-${name}`,
				taskId,
				interactive: meta.interactive ?? options.interactive ?? negotiatedInteractive,
				signal: meta.signal,
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
	error?: { code: number; message: string; data?: Record<string, unknown> };
}

function hostCallIdentity(meta: Record<string, unknown> | undefined): { toolCallId: string } | undefined {
	if (!meta) return undefined;
	const toolCallId = meta["claudecode/toolUseId"];
	return typeof toolCallId === "string" && toolCallId ? { toolCallId } : undefined;
}

function rpcError(error: unknown): { code: number; message: string; data?: Record<string, unknown> } {
	if (error instanceof NativeAuthorityError) {
		return {
			code: -32000,
			message: error.message,
			data: { reason_code: error.reasonCode, recovery_action: error.recoveryAction },
		};
	}
	return { code: -32000, message: error instanceof Error ? error.message : String(error) };
}

function encodeMessage(message: JsonRpc): Buffer {
	return Buffer.from(`${JSON.stringify(message)}\n`);
}

export async function handleJsonRpc(message: JsonRpc, mcp = createMcpRuntime()): Promise<JsonRpc | null> {
	if (message.method === "initialize") {
		const params = (message.params ?? {}) as {
			protocolVersion?: unknown;
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
			protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : undefined,
			interactive: trustedClient && elicitation !== null && typeof elicitation === "object" && !Array.isArray(elicitation),
		});
		return {
			jsonrpc: "2.0",
			id: message.id ?? null,
			result: {
				protocolVersion: MCP_PROTOCOL_VERSION,
				serverInfo: {
					name: HOST_ID,
					version: PLUGIN_VERSION,
					contract: CORE_CONTRACT,
					minimumHostVersion: MIN_CLAUDE_CODE_VERSION,
				},
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
				throw new NativeAuthorityError("unsupported_host", "interactive MCP elicitation is unavailable");
			}
			const identity = hostCallIdentity(params._meta);
			if (isPrivilegedOperation(name) && !identity) {
				throw new NativeAuthorityError("correlation_missing", "canonical claudecode/toolUseId metadata is missing");
			}
			const sessionId = mcp.connectionId;
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
			return {
				jsonrpc: "2.0",
				id: message.id ?? null,
				error: rpcError(error),
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
	await new Promise<void>((resolve, reject) => {
		if (!output.writable) {
			reject(new Error("output stream is not writable"));
			return;
		}
		let settled = false;
		const cleanup = () => {
			output.off("drain", onDrain);
			output.off("error", onError);
			output.off("close", onClose);
		};
		const onDrain = () => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve();
		};
		const onError = (error: Error) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};
		const onClose = () => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(new Error("output stream closed before write drained"));
		};
		output.once("error", onError);
		output.once("close", onClose);
		const ok = output.write(payload, (error) => {
			if (settled) return;
			if (error) {
				settled = true;
				cleanup();
				reject(error);
			}
		});
		if (ok) {
			settled = true;
			cleanup();
			resolve();
			return;
		}
		output.once("drain", onDrain);
	});
}

export function elicitationParams(input: NativeConfirmationInput) {
	const details = [
		`Operation: ${input.operation}`,
		`Task: ${input.taskId}`,
		input.risk ? `Risk: ${input.risk}` : null,
		input.intentRevision !== undefined ? `Intent revision: ${input.intentRevision}` : null,
		input.intentContentHash ? `Intent hash: ${input.intentContentHash}` : null,
		input.bindingDigest ? `Binding digest: ${input.bindingDigest}` : null,
	].filter(Boolean);
	return {
		mode: "form",
		message: `Authorize this exact Immune-Brain operation?\n\n${details.join("\n")}`,
		requestedSchema: { type: "object", properties: {} },
	};
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
	let requestSequence = 0;
	const inFlight = new Set<Promise<void>>();
	const pending = new Map<string, {
		resolve: (response: JsonRpc) => void;
		reject: (error: Error) => void;
	}>();
	let chain = Promise.resolve();

	const rejectPending = (error: Error): void => {
		for (const item of pending.values()) item.reject(error);
		pending.clear();
	};

	mcp.bindNativeConfirmation(async (input) => {
		if (!accepting) throw new NativeAuthorityError("interaction_not_opened", "MCP connection is closed");
		if (input.signal?.aborted) throw new NativeAuthorityError("user_cancelled", "Tool call was cancelled");
		const requestId = `immune-brain:elicitation:${mcp.connectionId}:${++requestSequence}`;
		let abortListener: (() => void) | undefined;
		const response = new Promise<JsonRpc>((resolve, reject) => {
			pending.set(requestId, { resolve, reject });
			abortListener = () => {
				pending.delete(requestId);
				reject(new NativeAuthorityError("user_cancelled", "Tool call was cancelled"));
			};
			input.signal?.addEventListener("abort", abortListener, { once: true });
		});
		try {
			await writeReply(output, {
				jsonrpc: "2.0",
				id: requestId,
				method: "elicitation/create",
				params: elicitationParams(input),
			});
			const reply = await response;
			if (reply.error) {
				if (reply.error.code === -32601) {
					throw new NativeAuthorityError("unsupported_host", "Claude Code rejected MCP elicitation/create");
				}
				throw new NativeAuthorityError("correlation_missing", `MCP elicitation failed: ${reply.error.message}`);
			}
			const result = reply.result;
			const action = typeof result === "object" && result !== null && !Array.isArray(result)
				? (result as { action?: unknown }).action
				: undefined;
			if (action !== "accept" && action !== "decline" && action !== "cancel") {
				throw new NativeAuthorityError("correlation_missing", "MCP elicitation returned an invalid action");
			}
			if (action === "accept") {
				const content = (result as { content?: unknown }).content;
				if (typeof content !== "object" || content === null || Array.isArray(content) || Object.keys(content).length !== 0) {
					throw new NativeAuthorityError("correlation_missing", "MCP elicitation accept content did not match the requested schema");
				}
			}
			return { decision: action, requestId };
		} finally {
			pending.delete(requestId);
			if (abortListener) input.signal?.removeEventListener("abort", abortListener);
		}
	});

	const runCall = (parsed: JsonRpc): void => {
		const task = handleJsonRpc(parsed, mcp).then(async (reply) => {
			if (reply) await writeReply(output, reply);
		}).catch(() => {
			void executeShutdown(1);
		});
		inFlight.add(task);
		void task.finally(() => inFlight.delete(task));
	};

	const routeResponse = (obj: Record<string, unknown>): boolean => {
		const id = typeof obj.id === "string" ? obj.id : "";
		const waiter = id ? pending.get(id) : undefined;
		if (waiter) {
			pending.delete(id);
			const hasResult = Object.hasOwn(obj, "result");
			const hasError = Object.hasOwn(obj, "error");
			if (obj.jsonrpc !== "2.0" || obj.method !== undefined || hasResult === hasError) {
				waiter.reject(new NativeAuthorityError("correlation_missing", "malformed MCP elicitation response"));
			} else {
				waiter.resolve(obj as unknown as JsonRpc);
			}
			return true;
		}
		return obj.method === undefined && obj.id !== undefined;
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
			if (routeResponse(obj)) continue;
			if (obj.jsonrpc !== "2.0") {
				await writeReply(output, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: jsonrpc must be '2.0'" } });
				continue;
			}
			if (routeResponse(obj)) continue;
			if (typeof obj.method !== "string" || !obj.method) {
				const id = obj.id !== undefined && (typeof obj.id === "string" || typeof obj.id === "number") ? obj.id : null;
				await writeReply(output, { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request: missing method" } });
				continue;
			}
			if (obj.id !== undefined && typeof obj.id !== "string" && typeof obj.id !== "number" && obj.id !== null) {
				await writeReply(output, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: invalid id type" } });
				continue;
			}
			if (obj.method === "tools/call" && obj.id === undefined) {
				await writeReply(output, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: tools/call requires an id" } });
				continue;
			}
			const rpc = parsed as JsonRpc;
			if (rpc.method === "notifications/cancelled") {
				const requestId = (rpc.params as { requestId?: string | number } | undefined)?.requestId;
				if (typeof requestId === "string" && pending.has(requestId)) {
					pending.get(requestId)?.reject(new NativeAuthorityError("user_cancelled", "native interaction was cancelled"));
					pending.delete(requestId);
				} else if (requestId !== undefined) {
					mcp.aborts.get(requestId)?.abort(new Error("notifications/cancelled"));
				}
				continue;
			}
			if (rpc.method === "tools/call") {
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

	let resolveStdio = () => {};
	let shutdownPromise: Promise<void> | null = null;
	const executeShutdown = (code = 0): Promise<void> => {
		if (shutdownPromise) return shutdownPromise;
		shutdownPromise = (async () => {
			accepting = false;
			for (const ac of mcp.aborts.values()) ac.abort(new Error("stdio closed"));
			rejectPending(new NativeAuthorityError("user_cancelled", "MCP connection closed during native interaction"));
			await Promise.race([
				Promise.allSettled([...inFlight]),
				new Promise<void>((resolve) => setTimeout(resolve, 200)),
			]);
			await mcp.shutdown();
			if (output.writable && typeof output.end === "function") {
				await new Promise<void>((cb) => output.end(() => cb()));
			}
			process.exitCode = code;
			exit(code);
			resolveStdio();
		})();
		return shutdownPromise;
	};

	await new Promise<void>((resolve) => {
		resolveStdio = resolve;
		output.on("error", () => {
			void executeShutdown(1);
		});
		output.on("close", () => {
			void executeShutdown(0);
		});
		input.on("data", (chunk: Buffer | string) => {
			if (!accepting) return;
			chain = chain.then(async () => {
				if (!accepting) return;
				buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
				await drainStdio();
			}).catch(() => {
				void executeShutdown(1);
			});
		});
		input.on("end", () => {
			void chain.then(() => executeShutdown(0));
		});
		input.on("close", () => {
			void chain.then(() => executeShutdown(0));
		});
		input.on("error", () => {
			void executeShutdown(1);
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
