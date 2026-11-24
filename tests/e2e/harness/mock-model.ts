// Scripted Anthropic Messages server for the L1 journeys (Spec e2e-release-gate D3).
// Black box: no runtime imports. It serves the next cassette turn for each request and
// records a named failure, never a silent fallback, when the request does not match.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface CassetteBlock {
	type: "text" | "tool_use";
	text?: string;
	id?: string;
	name?: string;
	input?: unknown;
}

/** One cassette line: the assistant turn answering request number `turn`. */
export interface CassetteTurn {
	/** Turn index: the number of assistant messages the request already carries. */
	turn: number;
	/** Ordered tool_use names of the assistant message preceding this request ([] for turn 0). */
	after: string[];
	/** Ordered tool_use names of `content`; every one must be offered by the request. */
	tools: string[];
	content: CassetteBlock[];
	stop_reason: "end_turn" | "tool_use";
	/**
	 * Conversation this turn belongs to (default "main"). A journey that runs several Host sessions
	 * against one model (Parent, Executor, Reviewer) keeps one ordered turn list per conversation in
	 * the same cassette file; `turn` counts within the conversation.
	 */
	conv?: string;
	/** Turn 0 only: regex tested against the conversation's first user message to bind a new session to this conversation. */
	entry?: string;
}

export type FailureCode = "cassette_mismatch" | "cassette_exhausted" | "unknown_endpoint" | "cassette_template_unresolved" | "conversation_unmatched";
export interface ModelFailure {
	code: FailureCode;
	message: string;
}
export interface ModelRequest {
	path: string;
	turn: number;
	offeredTools: string[];
	conv: string;
}
export interface MockModel {
	url: string;
	requests: ModelRequest[];
	failures: ModelFailure[];
	stop(): Promise<void>;
}

const toolNames = (blocks: unknown): string[] =>
	(Array.isArray(blocks) ? blocks : []).filter((block) => block?.type === "tool_use").map((block) => String(block.name));

export function parseCassette(text: string, source = "cassette"): CassetteTurn[] {
	const next = new Map<string, number>();
	const turns = text.split("\n").filter((line) => line.trim()).map((line, index) => {
		const turn = JSON.parse(line) as CassetteTurn;
		const conv = turn.conv ?? "main";
		const expected = next.get(conv) ?? 0;
		if (turn.turn !== expected) throw new Error(`${source}: line ${index + 1} is turn ${turn.turn} of conversation ${conv}, expected ${expected}`);
		next.set(conv, expected + 1);
		if (JSON.stringify(turn.tools) !== JSON.stringify(toolNames(turn.content))) throw new Error(`${source}: ${conv} turn ${turn.turn} \`tools\` disagrees with its tool_use blocks`);
		return turn;
	});
	if (!turns.length) throw new Error(`${source}: no turns`);
	return turns;
}

/** Where a journey's cassette for one Host lives: tests/e2e/cassettes/<journey>/<host>.jsonl. */
export const cassettePath = (journey: string, host: string): string => resolve(import.meta.dir, "../cassettes", journey, `${host}.jsonl`);

export const loadCassette = (path: string): CassetteTurn[] => parseCassette(readFileSync(path, "utf8"), path);

/** The key a request presents: its turn index and the ordered tool_use names it answers. */
export function requestKey(body: { messages?: Array<{ role?: string; content?: unknown }> }): { turn: number; after: string[] } {
	const assistant = (body.messages ?? []).filter((message) => message.role === "assistant");
	return { turn: assistant.length, after: toolNames(assistant.at(-1)?.content) };
}

type Message = { role?: string; content?: unknown };
const textOf = (content: unknown): string =>
	typeof content === "string" ? content : (Array.isArray(content) ? content : []).map((block) => (block?.type === "text" ? String(block.text) : block?.type === "tool_result" ? textOf(block.content) : "")).join("\n");

/** The text of the conversation's first user message (every text block, in order). */
export const firstUserText = (messages: Message[] = []): string => textOf(messages.find((message) => message.role === "user")?.content);

/** The text a tool_result block carries for tool_use `id`, or undefined while the request has none. */
export function toolResultText(messages: Message[] = [], id: string): string | undefined {
	for (const message of messages) {
		if (message.role !== "user" || !Array.isArray(message.content)) continue;
		const block = message.content.find((entry: any) => entry?.type === "tool_result" && entry.tool_use_id === id);
		if (block) return textOf(block.content);
	}
	return undefined;
}

const walk = (value: any, path: string): unknown => path.split(".").filter(Boolean).reduce((node, key) => (node === undefined || node === null ? undefined : node[key]), value);

export class TemplateError extends Error {}

/**
 * Fills `{{<source>|<op>}}` placeholders in a cassette string from what the Host has already
 * seen: source `prompt` is the first user message, `result:<tool_use id>` that tool's result text;
 * op `re:<regex>` yields the first capture group (or the match) and `json:<a.b.c>` a path into
 * the source parsed as JSON. An unresolved placeholder fails the journey, never fills in blank.
 */
export function fillTemplate(text: string, messages: Message[] = []): string {
	// A trailing `|with:<needle>=<source>|<op>` (repeatable) replaces every `<needle>` in the value, the way a Host
	// fills a placeholder in a returned command from another tool's result.
	const resolve = (whole: string, source: string, op: string): string => {
		const raw = source === "prompt" ? firstUserText(messages) : source.startsWith("result:") ? toolResultText(messages, source.slice(7)) : undefined;
		if (raw === undefined) throw new TemplateError(`${whole}: no such source in this request`);
		if (op.startsWith("re:")) {
			const match = new RegExp(op.slice(3)).exec(raw);
			if (!match) throw new TemplateError(`${whole}: pattern not found in ${source}`);
			return match[1] ?? match[0];
		}
		if (op.startsWith("json:")) {
			let parsed: unknown;
			try { parsed = JSON.parse(raw.slice(raw.indexOf("{"))); } catch { throw new TemplateError(`${whole}: ${source} is not JSON`); }
			const found = walk(parsed, op.slice(5));
			if (found === undefined) throw new TemplateError(`${whole}: path not found in ${source}`);
			return typeof found === "string" ? found : JSON.stringify(found);
		}
		throw new TemplateError(`${whole}: unknown op`);
	};
	return text.replace(/\{\{([^|{}]+)\|((?:[^{}]|\{[^{}]*\})*?)\}\}/g, (whole, source: string, op: string) => {
		const [main, ...withs] = op.split("|with:");
		let value = resolve(whole, source, main);
		for (const clause of withs) {
			const eq = clause.indexOf("=");
			const [fromSource, ...fromOp] = clause.slice(eq + 1).split("|");
			if (eq < 1 || !fromOp.length) throw new TemplateError(`${whole}: malformed |with: clause`);
			value = value.split(clause.slice(0, eq)).join(resolve(whole, fromSource, fromOp.join("|")));
		}
		return value;
	});
}

const fillDeep = (value: unknown, messages: Message[]): unknown =>
	typeof value === "string" ? fillTemplate(value, messages) : Array.isArray(value) ? value.map((item) => fillDeep(item, messages)) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillDeep(item, messages)])) : value;

/** Why a cassette turn does not answer this request, or undefined when it does. */
export function mismatch(expected: CassetteTurn, body: { messages?: Array<{ role?: string; content?: unknown }>; tools?: Array<{ name?: string }> }): string | undefined {
	const key = requestKey(body);
	if (JSON.stringify(key.after) !== JSON.stringify(expected.after)) {
		return `turn ${expected.turn} expected prior tools [${expected.after.join(", ")}] but the request carries [${key.after.join(", ")}]`;
	}
	const offered = new Set((body.tools ?? []).map((tool) => String(tool.name)));
	const missing = expected.tools.filter((name) => !offered.has(name));
	if (missing.length) return `turn ${expected.turn} expected tools [${expected.tools.join(", ")}] but the request does not offer [${missing.join(", ")}]`;
	return undefined;
}

const MAX_MCP_WAITS = 6;
const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function streamTurn(turn: CassetteTurn, model: string): string {
	let out = sse("message_start", { type: "message_start", message: { id: `msg_cassette_${turn.turn}`, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
	turn.content.forEach((block, index) => {
		if (block.type === "text") {
			out += sse("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
			out += sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text ?? "" } });
		} else {
			out += sse("content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
			out += sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input ?? {}) } });
		}
		out += sse("content_block_stop", { type: "content_block_stop", index });
	});
	out += sse("message_delta", { type: "message_delta", delta: { stop_reason: turn.stop_reason, stop_sequence: null }, usage: { output_tokens: 2 } });
	return out + sse("message_stop", { type: "message_stop" });
}

export interface MockModelOptions {
	turns: CassetteTurn[];
	/** Bind address; loopback by default. */
	hostname?: string;
}

/** Which Host session a request belongs to: Claude Code names it in a header; otherwise its first user message does. */
export function sessionKey(request: Request, body: { metadata?: { user_id?: string }; messages?: Message[] }): string {
	const header = request.headers.get("x-claude-code-session-id");
	if (header) return header;
	try {
		const id = JSON.parse(body.metadata?.user_id ?? "{}").session_id;
		if (id) return String(id);
	} catch { /* not JSON */ }
	return `first:${firstUserText(body.messages)}`;
}

export async function startMockModel(options: MockModelOptions): Promise<MockModel> {
	const requests: ModelRequest[] = [];
	const failures: ModelFailure[] = [];
	const conversations = new Map<string, CassetteTurn[]>();
	for (const turn of options.turns) conversations.set(turn.conv ?? "main", [...(conversations.get(turn.conv ?? "main") ?? []), turn]);
	const bound = new Map<string, string>();
	const mcpWaits = new Map<string, number>();
	const claimed = new Set<string>();
	const refuse = (code: FailureCode, message: string, status: number) => {
		failures.push({ code, message });
		// 4xx is not retried by the Host, so a failed journey ends at the first refusal.
		return Response.json({ type: "error", error: { type: code, message } }, { status });
	};
	/** A session's conversation: bound on its first request to the first unclaimed conversation whose entry matches. */
	const conversationFor = (key: string, messages: Message[], turn: number): string | undefined => {
		const known = bound.get(key);
		if (known && turn > 0) return known;
		const text = firstUserText(messages);
		const found = [...conversations].find(([name, list]) => !claimed.has(name) && (list[0].entry === undefined ? conversations.size === 1 || name === "main" : new RegExp(list[0].entry).test(text)));
		if (!found) return known;
		claimed.add(found[0]);
		bound.set(key, found[0]);
		return found[0];
	};
	const server = Bun.serve({
		hostname: options.hostname ?? "127.0.0.1",
		port: 0,
		async fetch(request) {
			const { pathname } = new URL(request.url);
			if (request.method !== "POST" || pathname !== "/v1/messages") {
				return refuse("unknown_endpoint", `${request.method} ${pathname} is not served by the mock model`, 404);
			}
			const body = await request.json() as { model?: string; stream?: boolean; metadata?: { user_id?: string }; messages?: Message[]; tools?: Array<{ name?: string }> };
			const key = requestKey(body);
			const conv = conversationFor(sessionKey(request, body), body.messages ?? [], key.turn);
			requests.push({ path: pathname, turn: key.turn, offeredTools: (body.tools ?? []).map((tool) => String(tool.name)), conv: conv ?? "?" });
			if (!conv) return refuse("conversation_unmatched", `no unclaimed cassette conversation has an entry matching this session's first message: ${firstUserText(body.messages).slice(0, 160)}`, 400);
			const expected = conversations.get(conv)?.[key.turn];
			if (!expected) return refuse("cassette_exhausted", `request for ${conv} turn ${key.turn} but the cassette has ${conversations.get(conv)?.length ?? 0} turn(s)`, 400);
			const reason = mismatch(expected, body);
			// A Host sends early requests before its MCP servers finish connecting; those offer no mcp__ tool yet.
			// The Host re-reads its tools after a rejected request, so a bounded 400 is answered without recording a cassette failure.
			const waitKey = `${conv}:${key.turn}`;
			if (reason && expected.tools.some((name) => name.startsWith("mcp__")) && (body.tools ?? []).every((tool) => !String(tool.name).startsWith("mcp__")) && mcpWaits.get(waitKey) !== -1) {
				const waited = (mcpWaits.get(waitKey) ?? 0) + 1;
				mcpWaits.set(waitKey, waited > MAX_MCP_WAITS ? -1 : waited);
				if (waited <= MAX_MCP_WAITS) return Response.json({ type: "error", error: { type: "invalid_request_error", message: "mock model: MCP tools not connected yet" } }, { status: 400 });
			}
			if (reason) return refuse("cassette_mismatch", conv === "main" ? reason : `${conv}: ${reason}`, 400);
			let turn = expected;
			try {
				turn = { ...expected, content: fillDeep(expected.content, body.messages ?? []) as CassetteBlock[] };
			} catch (error) {
				if (error instanceof TemplateError) return refuse("cassette_template_unresolved", `${conv} turn ${expected.turn}: ${error.message}`, 400);
				throw error;
			}
			const model = body.model ?? "mock";
			if (body.stream) return new Response(streamTurn(turn, model), { headers: { "content-type": "text/event-stream" } });
			return Response.json({ id: `msg_cassette_${turn.turn}`, type: "message", role: "assistant", model, content: turn.content, stop_reason: turn.stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 2 } });
		},
	});
	return {
		url: `http://${server.hostname}:${server.port}`,
		requests,
		failures,
		stop: async () => { await server.stop(true); },
	};
}

/** Throws the first recorded failure; journeys call it so an unmatched turn can never pass. */
export function assertNoFailures(model: MockModel): void {
	const [first] = model.failures;
	if (first) throw new Error(`${first.code}: ${first.message}`);
}
