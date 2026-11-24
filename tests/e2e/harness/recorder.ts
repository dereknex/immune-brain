// Pass-through recorder (Spec e2e-release-gate D3): a proxy between a Host and the real
// Anthropic API that writes the exchange as a cassette. Running it against the real API
// needs the maintainer's credentials, so it is a maintainer action (`bun run e2e:record`),
// never a QA descriptor. Black box: no runtime imports.

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { type CassetteBlock, type CassetteTurn, type MockModel, cassettePath, loadCassette, requestKey, startMockModel } from "./mock-model";

/** Redacts secrets, home paths and timestamps from text that would land in a checked-in cassette. */
export function redactText(text: string, home = homedir()): string {
	let out = home && home !== "/" ? text.split(home).join("<home>") : text;
	out = out.replace(/\/(?:Users|home)\/[^/\s"'\\]+/g, "<home>");
	out = out.replace(/sk-ant-[A-Za-z0-9_-]+/g, "<redacted-secret>");
	out = out.replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/g, "$1 <redacted-secret>");
	return out.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g, "<timestamp>");
}

const redactDeep = (value: unknown): unknown => {
	if (typeof value === "string") return redactText(value);
	if (Array.isArray(value)) return value.map(redactDeep);
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactDeep(entry)]));
	return value;
};

/** Rebuilds the assistant turn from a streamed (SSE) or plain JSON Messages response. */
export function assembleTurn(body: string, contentType: string): { content: CassetteBlock[]; stop_reason: CassetteTurn["stop_reason"] } | undefined {
	if (!contentType.includes("text/event-stream")) {
		const parsed = JSON.parse(body);
		return Array.isArray(parsed.content) ? { content: parsed.content, stop_reason: parsed.stop_reason === "tool_use" ? "tool_use" : "end_turn" } : undefined;
	}
	const blocks: Array<CassetteBlock & { json?: string }> = [];
	let stop: CassetteTurn["stop_reason"] = "end_turn";
	for (const frame of body.split("\n\n")) {
		const data = frame.split("\n").find((line) => line.startsWith("data: "));
		if (!data) continue;
		const event = JSON.parse(data.slice(6));
		if (event.type === "content_block_start") blocks[event.index] = event.content_block.type === "tool_use" ? { type: "tool_use", id: event.content_block.id, name: event.content_block.name, json: "" } : { type: "text", text: event.content_block.text ?? "" };
		if (event.type === "content_block_delta" && event.delta.type === "text_delta") blocks[event.index].text += event.delta.text;
		if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") blocks[event.index].json += event.delta.partial_json;
		if (event.type === "message_delta" && event.delta.stop_reason === "tool_use") stop = "tool_use";
	}
	const content = blocks.filter(Boolean).map(({ json, ...block }) => (block.type === "tool_use" ? { ...block, input: json ? JSON.parse(json) : {} } : block));
	return content.length ? { content, stop_reason: stop } : undefined;
}

/**
 * The low-cost model tier of a live run (Spec e2e-release-gate D6): `E2E_LIVE_MODEL` names the model
 * the proxy sends upstream in place of whatever the Host asked for. A body that is not a JSON object
 * with a string `model` passes through unchanged.
 */
export function rewriteRequestModel(raw: string, model: string | undefined): string {
	if (!model) return raw;
	try {
		const body = JSON.parse(raw);
		if (!body || typeof body !== "object" || typeof body.model !== "string") return raw;
		return JSON.stringify({ ...body, model });
	} catch {
		return raw;
	}
}

export interface Recorder {
	url: string;
	/** Stops the proxy and writes the cassette. */
	stop(): Promise<void>;
}

export interface RecorderOptions {
	cassettePath: string;
	upstream?: string;
	/** Model the proxy substitutes in every upstream request (default: the Host's own). */
	model?: string;
}

export async function startRecorder(options: RecorderOptions): Promise<Recorder> {
	const upstream = (options.upstream ?? "https://api.anthropic.com").replace(/\/$/, "");
	const turns = new Map<number, CassetteTurn>();
	const pending: Promise<void>[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const target = new URL(request.url);
			const sent = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
			const raw = sent === undefined ? undefined : rewriteRequestModel(sent, options.model);
			const headers = new Headers(request.headers);
			for (const name of ["host", "content-length", "accept-encoding"]) headers.delete(name);
			const response = await fetch(`${upstream}${target.pathname}${target.search}`, { method: request.method, headers, body: raw });
			const recordable = request.method === "POST" && target.pathname === "/v1/messages" && response.status === 200 && response.body;
			if (!recordable) return response;
			const request_body = JSON.parse(raw ?? "{}");
			const [toClient, toRecord] = response.body!.tee();
			pending.push((async () => {
				const turn = assembleTurn(await new Response(toRecord).text(), response.headers.get("content-type") ?? "");
				const key = requestKey(request_body);
				if (!turn || turns.has(key.turn)) return;
				const content = redactDeep(turn.content) as CassetteBlock[];
				turns.set(key.turn, { turn: key.turn, after: key.after, tools: content.filter((block) => block.type === "tool_use").map((block) => String(block.name)), content, stop_reason: turn.stop_reason });
			})());
			const outHeaders = new Headers(response.headers);
			for (const name of ["content-encoding", "content-length"]) outHeaders.delete(name);
			return new Response(toClient, { status: response.status, headers: outHeaders });
		},
	});
	return {
		url: `http://127.0.0.1:${server.port}`,
		stop: async () => {
			await server.stop(true);
			await Promise.all(pending);
			const ordered = [...turns.values()].sort((left, right) => left.turn - right.turn);
			mkdirSync(dirname(options.cassettePath), { recursive: true });
			writeFileSync(options.cassettePath, ordered.map((turn) => JSON.stringify(turn)).join("\n") + "\n");
		},
	};
}

export interface JourneyModel {
	url: string;
	/** Set when replaying a cassette; absent while recording. */
	mock?: MockModel;
	/** The API key the Host should use: a real one only while recording. */
	apiKey?: string;
	stop(): Promise<void>;
}

/**
 * The model endpoint for one journey and Host: the scripted mock replaying its cassette, or,
 * under `bun run e2e:record` (E2E_RECORD=1), the recorder in front of the real API.
 */
export async function startJourneyModel(journey: string, host: string, turns?: Parameters<typeof startMockModel>[0]["turns"]): Promise<JourneyModel> {
	if (process.env.E2E_RECORD === "1") {
		const apiKey = process.env.ANTHROPIC_API_KEY;
		if (!apiKey) throw new Error("record_credentials_missing: bun run e2e:record needs ANTHROPIC_API_KEY in the maintainer's environment");
		const recorder = await startRecorder({ cassettePath: cassettePath(journey, host), upstream: process.env.E2E_UPSTREAM, model: process.env.E2E_LIVE_MODEL || undefined });
		return { url: recorder.url, apiKey, stop: recorder.stop };
	}
	const mock = await startMockModel({ turns: turns ?? loadCassette(cassettePath(journey, host)) });
	return { url: mock.url, mock, stop: mock.stop };
}
