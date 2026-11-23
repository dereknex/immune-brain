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
}

export type FailureCode = "cassette_mismatch" | "cassette_exhausted" | "unknown_endpoint";
export interface ModelFailure {
	code: FailureCode;
	message: string;
}
export interface ModelRequest {
	path: string;
	turn: number;
	offeredTools: string[];
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
	const turns = text.split("\n").filter((line) => line.trim()).map((line, index) => {
		const turn = JSON.parse(line) as CassetteTurn;
		if (turn.turn !== index) throw new Error(`${source}: line ${index + 1} is turn ${turn.turn}, expected ${index}`);
		if (JSON.stringify(turn.tools) !== JSON.stringify(toolNames(turn.content))) throw new Error(`${source}: turn ${index} \`tools\` disagrees with its tool_use blocks`);
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

export async function startMockModel(options: MockModelOptions): Promise<MockModel> {
	const requests: ModelRequest[] = [];
	const failures: ModelFailure[] = [];
	const refuse = (code: FailureCode, message: string, status: number) => {
		failures.push({ code, message });
		// 4xx is not retried by the Host, so a failed journey ends at the first refusal.
		return Response.json({ type: "error", error: { type: code, message } }, { status });
	};
	const server = Bun.serve({
		hostname: options.hostname ?? "127.0.0.1",
		port: 0,
		async fetch(request) {
			const { pathname } = new URL(request.url);
			if (request.method !== "POST" || pathname !== "/v1/messages") {
				return refuse("unknown_endpoint", `${request.method} ${pathname} is not served by the mock model`, 404);
			}
			const body = await request.json() as { model?: string; stream?: boolean; messages?: Array<{ role?: string; content?: unknown }>; tools?: Array<{ name?: string }> };
			const key = requestKey(body);
			requests.push({ path: pathname, turn: key.turn, offeredTools: (body.tools ?? []).map((tool) => String(tool.name)) });
			const expected = options.turns[key.turn];
			if (!expected) return refuse("cassette_exhausted", `request for turn ${key.turn} but the cassette has ${options.turns.length} turn(s)`, 400);
			const reason = mismatch(expected, body);
			if (reason) return refuse("cassette_mismatch", reason, 400);
			const model = body.model ?? "mock";
			if (body.stream) return new Response(streamTurn(expected, model), { headers: { "content-type": "text/event-stream" } });
			return Response.json({ id: `msg_cassette_${expected.turn}`, type: "message", role: "assistant", model, content: expected.content, stop_reason: expected.stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 2 } });
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
