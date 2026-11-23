import { createReadStream, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";

export type Host = "pi" | "claude" | "antigravity";

const BOOKKEEPING = /recorded cleanly|receipt recorded|round recorded|no findings?\b/i;
const VERDICT_START = /\{\s*"contract"\s*:\s*"assurance_kernel\/assurance_verdict\//;
const CLAUDE_KERNEL_TOOL = /^mcp__.*immune[-_]brain.*__([a-z0-9_]+)$/;
const MAX_REPR_BYTES = 512 * 1024;
const MAX_REPR_DEPTH = 64;

// Host-injected pseudo-user frames (F3): whole envelopes and fixed Host notices with no
// human text left once they are removed. A notice is matched whole, so a human line
// typed after it keeps the turn human.
const HOST_ENVELOPE = /<(task-notification|system-reminder|local-command-[a-z-]+|command-name|bash-stdout|bash-stderr)\b[^>]*>[\s\S]*?<\/\1>/gi;
const HOST_NOTICE = new RegExp([
	String.raw`Tool loaded\.`,
	String.raw`Your claude\.ai usage limit has reset\.(?:[ \t]*Continue the task you were working on when the limit was reached; do not repeat work that is already complete\.)?`,
	String.raw`\[Earlier usage-limit notes no longer apply\.[^\]\n]*\]`,
	String.raw`\[plan review[^\]\n]*\]`,
	String.raw`\[Request interrupted by user(?: for tool use)?\]`,
].join("|"), "gi");
// Claude Code's Stop hook output, fed back as a user frame: no human wrote any of it.
const STOP_HOOK_FEEDBACK = /^Stop hook feedback:/;
// A Claude Code skill expansion: the skill's own text, then the human's `ARGUMENTS:` when any.
const SKILL_PREAMBLE = /^Base directory for this skill:/i;
const SKILL_ARGUMENTS = "\nARGUMENTS:";

const EDIT_TOOLS_BY_HOST: Record<Host, ReadonlySet<string>> = {
	pi: new Set(["edit", "write", "multiedit", "apply_patch"]),
	claude: new Set(["Edit", "Write", "MultiEdit"]),
	antigravity: new Set(["edit_file", "write_file", "replace_file_content", "write_to_file"]),
};

/**
 * A `/skill` block, a skill expansion carrying `ARGUMENTS:`, or any text outside a
 * Host envelope or notice means a human wrote the turn; Stop hook feedback never does.
 */
function isSyntheticInput(text: string): boolean {
	if (/<skill\b/i.test(text)) return false;
	const trimmed = text.trim();
	if (STOP_HOOK_FEEDBACK.test(trimmed)) return true;
	if (SKILL_PREAMBLE.test(trimmed)) {
		const at = trimmed.lastIndexOf(SKILL_ARGUMENTS);
		return at < 0 || !trimmed.slice(at + SKILL_ARGUMENTS.length).trim();
	}
	const remainder = trimmed.replace(HOST_ENVELOPE, "").replace(HOST_NOTICE, "").trim();
	return remainder !== trimmed && !remainder;
}

export const KERNEL_OPS = new Set([
	"status",
	"advance_assurance",
	"submit_review",
	"submit_verification",
	"request_authorization",
	"revise_intent",
	"approve_breaking_intent_revision",
	"stop",
	"request_stop",
	"start_unattended_batch",
	"retire_stale_batch",
	"repair_authority_state",
	"resolve_finding",
	"refute_finding",
	"accept_residual_risk",
	"record_finding",
]);

function norm(value: unknown): Record<string, any> {
	if (typeof value === "string") {
		try { value = JSON.parse(value); } catch { return {}; }
	}
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

/** Bounded parser for Antigravity Python-repr (or JSON) Arguments strings. */
export function parsePythonRepr(raw: string): Record<string, any> | null {
	if (typeof raw !== "string" || !raw.trim() || raw.length > MAX_REPR_BYTES) return null;
	try {
		const json = JSON.parse(raw);
		if (json && typeof json === "object" && !Array.isArray(json)) return json as Record<string, any>;
	} catch {
		// Fall through to bounded Python-repr reader.
	}
	let pos = 0;
	const len = raw.length;
	const skipWs = () => {
		while (pos < len && (raw[pos] === " " || raw[pos] === "\t" || raw[pos] === "\n" || raw[pos] === "\r")) pos++;
	};
	const fail = (): never => { throw new Error("repr_parse_error"); };
	const readString = (quote: string): string => {
		pos++;
		let out = "";
		while (pos < len) {
			const ch = raw[pos]!;
			if (ch === quote) { pos++; return out; }
			if (ch === "\\") {
				pos++;
				if (pos >= len) fail();
				const esc = raw[pos]!;
				pos++;
				if (esc === "n") out += "\n";
				else if (esc === "r") out += "\r";
				else if (esc === "t") out += "\t";
				else if (esc === "b") out += "\b";
				else if (esc === "f") out += "\f";
				else if (esc === "v") out += "\v";
				else if (esc === "0") out += "\0";
				else if (esc === "x") {
					const hex = raw.slice(pos, pos + 2);
					if (!/^[0-9a-fA-F]{2}$/.test(hex)) fail();
					out += String.fromCharCode(parseInt(hex, 16));
					pos += 2;
				} else if (esc === "u") {
					const hex = raw.slice(pos, pos + 4);
					if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail();
					out += String.fromCharCode(parseInt(hex, 16));
					pos += 4;
				} else if (esc === "U") {
					const hex = raw.slice(pos, pos + 8);
					if (!/^[0-9a-fA-F]{8}$/.test(hex)) fail();
					out += String.fromCodePoint(parseInt(hex, 16));
					pos += 8;
				} else {
					out += esc;
				}
			} else {
				out += ch;
				pos++;
			}
		}
		return fail();
	};
	const readValue = (depth: number): unknown => {
		if (depth > MAX_REPR_DEPTH) fail();
		skipWs();
		if (pos >= len) fail();
		const ch = raw[pos]!;
		if (ch === "'" || ch === '"') return readString(ch);
		if (ch === "{") {
			pos++;
			const obj: Record<string, unknown> = {};
			skipWs();
			if (raw[pos] === "}") { pos++; return obj; }
			while (pos < len) {
				const key = readValue(depth + 1);
				if (typeof key !== "string" && typeof key !== "number" && typeof key !== "boolean") fail();
				skipWs();
				if (raw[pos] !== ":") fail();
				pos++;
				obj[String(key)] = readValue(depth + 1);
				skipWs();
				if (raw[pos] === ",") {
					pos++;
					skipWs();
					if (raw[pos] === "}") { pos++; return obj; }
					continue;
				}
				if (raw[pos] === "}") { pos++; return obj; }
				fail();
			}
			fail();
		}
		if (ch === "[" || ch === "(") {
			const close = ch === "[" ? "]" : ")";
			pos++;
			const arr: unknown[] = [];
			skipWs();
			if (raw[pos] === close) { pos++; return arr; }
			while (pos < len) {
				arr.push(readValue(depth + 1));
				skipWs();
				if (raw[pos] === ",") {
					pos++;
					skipWs();
					if (raw[pos] === close) { pos++; return arr; }
					continue;
				}
				if (raw[pos] === close) { pos++; return arr; }
				fail();
			}
			fail();
		}
		const rest = raw.slice(pos);
		const kw = /^(True|False|None|true|false|null)(?![A-Za-z0-9_])/.exec(rest);
		if (kw) {
			pos += kw[1]!.length;
			if (kw[1] === "True" || kw[1] === "true") return true;
			if (kw[1] === "False" || kw[1] === "false") return false;
			return null;
		}
		const num = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?(?![A-Za-z0-9_])/.exec(rest);
		if (num) {
			pos += num[0].length;
			const parsed = Number(num[0]);
			if (!Number.isFinite(parsed)) fail();
			return parsed;
		}
		return fail();
	};
	try {
		const value = readValue(0);
		skipWs();
		if (pos !== len || !value || typeof value !== "object" || Array.isArray(value)) return null;
		return value as Record<string, any>;
	} catch {
		return null;
	}
}

export function parseTimestamp(value: unknown): number {
	if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN;
}

function textOf(content: unknown): string {
	return typeof content === "string" ? content : Array.isArray(content) ? content.map(c => c?.text ?? "").join("\n") : "";
}

function observedVerdict(content: unknown): Record<string, any> | null {
	const text = textOf(content);
	const start = text.search(VERDICT_START);
	if (start < 0) return null;
	let depth = 0, quoted = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (quoted) { if (ch === "\\") i++; else if (ch === '"') quoted = false; }
		else if (ch === '"') quoted = true;
		else if (ch === "{") depth++;
		else if (ch === "}" && --depth === 0) {
			const verdict = norm(text.slice(start, i + 1));
			return Object.keys(verdict).length ? verdict : null;
		}
	}
	return null;
}

type Pointer = { host: Host; session: string; line: number; entry_id: string; timestamp: string; role: string; cwd: string; task_id: string; run_id: string };
export type SessionEvent = Pointer & ({ type: "user_input"; skill: string | null; instruction: string; chars: number; synthetic: boolean }
	| { type: "tool_call"; tool_call_id: string; name: string; op: string | null; author: string }
	| { type: "tool_result"; tool_call_id: string; call_line: number | null; is_error: boolean; state?: unknown; lifecycle?: unknown; batch_id?: unknown; batch_state?: unknown; stop_applied?: boolean }
	| { type: "turn_end"; stop_reason: string }
	| { type: "review"; author: string; key: string }
	| { type: "registration"; author: string; taskId: string; without_verdict: boolean }
	| { type: "finding"; author: string; kind: string; summary: string; markers: string[]; acceptance_id: string; violatedKind?: string; registration_line: number | null; registration_index: number | null }
	| { type: "disposition"; author: string; kind: "resolve" | "refute" | "accept_residual_risk" });
export type SessionFilter = { cutMs: number; untilMs?: number; project: string; exclude: string[] };
export type SessionRead = { host: Host; cwd: string; session_id: string; used: boolean; skipped: number; turns: number; edits: number; tools: Map<string, number>; events: SessionEvent[] };

type RegistrationEvent = Extract<SessionEvent, { type: "registration" }>;
/** `registration`: a `submit_review` with no verdict in hand yet; a completed Kernel result settles it (CliReviewHost reads the reviewer's result slot). */
type CallRecord = { line: number; task: string; run: string; op: string | null; review: boolean; registration?: RegistrationEvent };
type ReaderState = { editor: string | null; receipt: Record<string, any> | null; registrationIndex: number; calls: Map<string, CallRecord> };

function makeRead(host: Host): { out: SessionRead; state: ReaderState } {
	return {
		out: { host, cwd: "", session_id: "unknown", used: false, skipped: 0, turns: 0, edits: 0, tools: new Map(), events: [] },
		state: { editor: null, receipt: null, registrationIndex: 0, calls: new Map() },
	};
}

function cwdFiltered(cwd: string, filter: SessionFilter): boolean {
	return Boolean((filter.project && !cwd.includes(filter.project)) || filter.exclude.some(s => cwd.includes(s)));
}

function isReviewSubagent(subagentType: unknown): boolean {
	const value = String(subagentType ?? "").toLowerCase();
	return value === "review" || value === "immune-brain:immune-brain-review" || value === "immune-brain:immune-brain-code-review";
}

function emitUserInput(out: SessionRead, base: Pointer, text: string): void {
	out.used = true;
	const match = text.match(/^\s*<skill\b[^>]*\bname=["']([^"']+)["'][^>]*>[\s\S]*?<\/skill>/);
	out.events.push({
		...base,
		type: "user_input",
		skill: match?.[1] ?? null,
		instruction: text.replace(/<skill\b[^>]*>[\s\S]*?<\/skill>/g, "").trim().slice(0, 240),
		chars: text.length,
		synthetic: isSyntheticInput(text),
	});
}

function emitToolResult(out: SessionRead, state: ReaderState, base: Pointer, id: string, content: unknown, isError: boolean): void {
	out.used = true;
	const call = id ? state.calls.get(id) : undefined;
	const result = norm(textOf(content));
	if (call?.review) state.receipt = observedVerdict(content);
	// Review states that record a verdict (`completed`, or `rework` from blocking findings);
	// `blocked`, `review_incomplete` and `settlement_unknown` record none.
	if (call?.registration?.without_verdict && !isError && (result.state === "completed" || result.state === "rework")) call.registration.without_verdict = false;
	const stopOp = call?.op === "request_stop" || call?.op === "stop";
	const stopApplied = stopOp && result.lifecycle === "stopped" && (result.state === "applied" || result.state === undefined);
	out.events.push({
		...base,
		task_id: call?.task !== "unknown" && call?.task ? call.task : String(result.task_id ?? base.task_id),
		run_id: call?.run !== "unknown" && call?.run ? call.run : String(norm(result.task_state).run_id ?? result.run_id ?? base.run_id),
		type: "tool_result",
		tool_call_id: id,
		call_line: call?.line ?? null,
		is_error: isError,
		...(result.state !== undefined ? { state: result.state } : {}),
		...(result.lifecycle !== undefined ? { lifecycle: result.lifecycle } : {}),
		...(result.batch_id !== undefined ? { batch_id: result.batch_id } : {}),
		...(result.batch_state !== undefined ? { batch_state: result.batch_state } : {}),
		...(stopApplied ? { stop_applied: true } : {}),
	});
}

function emitToolCall(
	out: SessionRead,
	state: ReaderState,
	base: Pointer,
	opts: {
		id: string;
		rawName: string;
		normName: string;
		op: string | null;
		payload: Record<string, any>;
		rawVerdict: unknown;
		rawFinding: unknown;
		model: string;
		review: boolean;
	},
): void {
	const { id, rawName, normName, op, payload, rawVerdict, rawFinding, model, review } = opts;
	const author = state.editor ?? "no-edit (review-only)";
	const pointer: Pointer = { ...base, task_id: String(payload.task_id ?? base.task_id), run_id: String(payload.run_id ?? base.run_id) };
	if (id) state.calls.set(id, { line: base.line, task: pointer.task_id, run: pointer.run_id, op, review });
	out.tools.set(normName || "?", (out.tools.get(normName || "?") ?? 0) + 1);
	out.events.push({ ...pointer, type: "tool_call", tool_call_id: id, name: normName, op, author });
	if (EDIT_TOOLS_BY_HOST[out.host].has(rawName)) {
		out.edits++;
		state.editor = model;
	} else if (review) {
		out.events.push({ ...pointer, type: "review", author, key: `${String(payload.description ?? "")}${String(payload.prompt ?? "").slice(0, 240)}` });
	} else if (normName === "imm_kernel_canary" && (op === "submit_review" || op === "record_finding")) {
		const verdict = rawVerdict === undefined ? state.receipt : norm(rawVerdict);
		if (op === "submit_review") {
			state.registrationIndex++;
			const registration: RegistrationEvent = { ...pointer, type: "registration", author, taskId: String(payload.task_id ?? ""), without_verdict: rawVerdict === undefined && !state.receipt };
			out.events.push(registration);
			const record = id ? state.calls.get(id) : undefined;
			if (record && registration.without_verdict) record.registration = registration;
			state.receipt = null;
		}
		const findings = op === "record_finding" ? [rawFinding] : Array.isArray(verdict?.findings) ? verdict.findings : [];
		for (const item of findings) {
			const f = norm(item), summary = String(f.summary ?? "");
			const violatedKind = typeof norm(f.evidence).violated?.kind === "string" ? String(norm(f.evidence).violated.kind) : undefined;
			out.events.push({
				...pointer,
				type: "finding",
				author,
				kind: String(f.kind ?? ""),
				summary,
				markers: BOOKKEEPING.test(summary) ? ["bookkeeping"] : [],
				acceptance_id: String(f.acceptance_id ?? "unknown"),
				...(violatedKind === undefined ? {} : { violatedKind }),
				registration_line: op === "submit_review" ? base.line : null,
				registration_index: op === "submit_review" ? state.registrationIndex : null,
			});
		}
	} else if (normName === "imm_kernel_canary" && (op === "resolve_finding" || op === "refute_finding" || op === "accept_residual_risk")) {
		out.events.push({ ...pointer, type: "disposition", author, kind: op === "resolve_finding" ? "resolve" : op === "refute_finding" ? "refute" : "accept_residual_risk" });
	}
}

export async function readSession(path: string, filter: SessionFilter): Promise<SessionRead | null> {
	const { out, state } = makeRead("pi");
	let lineNo = 0;
	const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }) });
	for await (const raw of rl) {
		lineNo++;
		if (!raw.trim()) continue;
		let o: Record<string, any>;
		try { o = norm(JSON.parse(raw)); } catch { continue; }
		if (o.type === "session") {
			out.cwd = String(o.cwd ?? ""); out.session_id = String(o.id ?? "unknown");
			if (cwdFiltered(out.cwd, filter)) { rl.close(); return null; }
			continue;
		}
		const ms = parseTimestamp(o.timestamp);
		if (!Number.isFinite(ms) || !Number.isFinite(new Date(ms).getTime())) { out.skipped++; continue; }
		if (ms < filter.cutMs || ms >= (filter.untilMs ?? Infinity)) continue;
		const m = norm(o.message), role = String(m.role ?? "");
		const base: Pointer = { host: "pi", session: path, line: lineNo, entry_id: String(o.id ?? "unknown"), timestamp: new Date(ms).toISOString(), role, cwd: out.cwd, task_id: String(o.task_id ?? m.task_id ?? "unknown"), run_id: String(o.run_id ?? m.run_id ?? "unknown") };
		if (role === "user") {
			emitUserInput(out, base, textOf(m.content));
		} else if (role === "toolResult") {
			emitToolResult(out, state, base, String(m.toolCallId ?? ""), m.content, Boolean(m.isError));
		} else if (role === "assistant") {
			out.used = true; out.turns++;
			const model = `${m.provider ?? "?"}/${m.model ?? "?"}`;
			for (const c of Array.isArray(m.content) ? m.content : []) {
				if (c?.type !== "toolCall") continue;
				const name = String(c.name ?? ""), a = norm(c.arguments), action = norm(a.action), op = typeof action.op === "string" ? action.op : null;
				const review = name === "Agent" && isReviewSubagent(a.subagent_type);
				emitToolCall(out, state, base, {
					id: String(c.id ?? ""),
					rawName: name,
					normName: name,
					op,
					payload: { ...a, description: a.description, prompt: a.prompt },
					rawVerdict: action.verdict,
					rawFinding: action.finding,
					model,
					review,
				});
			}
			if (typeof m.stopReason === "string" && m.stopReason !== "toolUse") out.events.push({ ...base, type: "turn_end", stop_reason: m.stopReason });
		}
	}
	return out;
}

export async function readClaudeSession(path: string, filter: SessionFilter): Promise<SessionRead | null> {
	const { out, state } = makeRead("claude");
	let lineNo = 0;
	const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }) });
	for await (const raw of rl) {
		lineNo++;
		if (!raw.trim()) continue;
		let o: Record<string, any>;
		try { o = norm(JSON.parse(raw)); } catch { continue; }
		if (typeof o.cwd === "string" && o.cwd && !out.cwd) {
			out.cwd = o.cwd;
			if (cwdFiltered(out.cwd, filter)) { rl.close(); return null; }
		}
		if (typeof o.sessionId === "string" && o.sessionId && out.session_id === "unknown") out.session_id = o.sessionId;
		if (o.type === "file-history-snapshot" || o.type === "summary") continue;
		const ms = parseTimestamp(o.timestamp);
		if (!Number.isFinite(ms) || !Number.isFinite(new Date(ms).getTime())) { out.skipped++; continue; }
		if (ms < filter.cutMs || ms >= (filter.untilMs ?? Infinity)) continue;
		const m = norm(o.message), role = String(m.role ?? o.type ?? "");
		const base: Pointer = {
			host: "claude",
			session: path,
			line: lineNo,
			entry_id: String(o.uuid ?? o.id ?? "unknown"),
			timestamp: new Date(ms).toISOString(),
			role,
			cwd: out.cwd,
			task_id: String(o.task_id ?? m.task_id ?? "unknown"),
			run_id: String(o.run_id ?? m.run_id ?? "unknown"),
		};
		if (o.type === "user" || role === "user") {
			if (typeof m.content === "string") {
				emitUserInput(out, { ...base, role: "user" }, m.content);
			} else if (Array.isArray(m.content)) {
				const texts: string[] = [];
				for (const block of m.content) {
					if (block?.type === "tool_result") {
						emitToolResult(out, state, { ...base, role: "toolResult" }, String(block.tool_use_id ?? ""), block.content, Boolean(block.is_error));
					} else if (block?.type === "text" && typeof block.text === "string") {
						texts.push(block.text);
					}
				}
				if (texts.length > 0) emitUserInput(out, { ...base, role: "user" }, texts.join("\n"));
			}
		} else if (o.type === "assistant" || role === "assistant") {
			out.used = true; out.turns++;
			const model = m.provider ? `${m.provider}/${m.model ?? "?"}` : String(m.model ?? "?");
			for (const c of Array.isArray(m.content) ? m.content : []) {
				if (c?.type !== "tool_use") continue;
				const rawName = String(c.name ?? ""), input = norm(c.input);
				const mcpMatch = CLAUDE_KERNEL_TOOL.exec(rawName);
				const mcpOp = mcpMatch?.[1] && KERNEL_OPS.has(mcpMatch[1]) ? mcpMatch[1] : null;
				const action = norm(input.action);
				const op = mcpOp ?? (rawName === "imm_kernel_canary" && typeof action.op === "string" ? action.op : null);
				const normName = mcpOp ? "imm_kernel_canary" : rawName;
				const review = rawName === "Agent" && isReviewSubagent(input.subagent_type);
				emitToolCall(out, state, { ...base, role: "assistant" }, {
					id: String(c.id ?? ""),
					rawName,
					normName,
					op,
					payload: input,
					rawVerdict: mcpOp ? input.verdict : action.verdict,
					rawFinding: mcpOp ? input.finding : action.finding,
					model,
					review,
				});
			}
			const rawStop = typeof m.stop_reason === "string" ? m.stop_reason : typeof m.stopReason === "string" ? m.stopReason : null;
			if (rawStop && rawStop !== "tool_use" && rawStop !== "toolUse") {
				const stopReason = rawStop === "end_turn" ? "stop" : rawStop;
				out.events.push({ ...base, role: "assistant", type: "turn_end", stop_reason: stopReason });
			} else if (o.isApiErrorMessage === true) {
				out.events.push({ ...base, role: "assistant", type: "turn_end", stop_reason: "error" });
			}
		}
	}
	if (cwdFiltered(out.cwd, filter)) return null;
	return out;
}

function resolveAntigravityIdentity(transcriptPath: string, metadataPath?: string): { sessionId: string; cwd: string } {
	const logsDir = dirname(transcriptPath);
	const sysGenDir = dirname(logsDir);
	const isStandardLayout = basename(logsDir) === "logs" && basename(sysGenDir) === ".system_generated";
	const convDir = isStandardLayout ? dirname(sysGenDir) : logsDir;
	const sessionId = basename(convDir) || "unknown";
	const brainDir = dirname(convDir);
	const resolvedMeta = metadataPath ?? join(dirname(brainDir), "cache", "conversation_metadata.json");
	let cwd = "unknown";
	try {
		const meta = norm(JSON.parse(readFileSync(resolvedMeta, "utf8")));
		const uris = norm(norm(norm(meta.conversations)[sessionId]).summary).WorkspaceURIs;
		if (Array.isArray(uris) && typeof uris[0] === "string" && uris[0].trim()) {
			const stripped = uris[0].replace(/^file:\/\//, "").trim();
			if (stripped) cwd = stripped;
		}
	} catch {
		// Absent or unreadable conversation_metadata.json yields cwd "unknown".
	}
	return { sessionId, cwd };
}

export async function readAntigravitySession(path: string, filter: SessionFilter, metadataPath?: string): Promise<SessionRead | null> {
	const { out, state } = makeRead("antigravity");
	const { sessionId, cwd } = resolveAntigravityIdentity(path, metadataPath);
	out.session_id = sessionId;
	out.cwd = cwd;
	if (cwdFiltered(out.cwd, filter)) return null;

	let lineNo = 0;
	const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }) });
	for await (const raw of rl) {
		lineNo++;
		if (!raw.trim()) continue;
		let o: Record<string, any>;
		try { o = norm(JSON.parse(raw)); } catch { continue; }
		const ms = parseTimestamp(o.created_at ?? o.timestamp);
		if (!Number.isFinite(ms) || !Number.isFinite(new Date(ms).getTime())) { out.skipped++; continue; }
		if (ms < filter.cutMs || ms >= (filter.untilMs ?? Infinity)) continue;
		const stepType = String(o.type ?? "");
		const role = stepType === "USER_INPUT" ? "user" : stepType === "GENERIC" ? "toolResult" : stepType === "PLANNER_RESPONSE" ? "assistant" : stepType.toLowerCase() || "unknown";
		const base: Pointer = {
			host: "antigravity",
			session: path,
			line: lineNo,
			entry_id: o.step_index !== undefined ? String(o.step_index) : String(o.id ?? "unknown"),
			timestamp: new Date(ms).toISOString(),
			role,
			cwd: out.cwd,
			task_id: String(o.task_id ?? "unknown"),
			run_id: String(o.run_id ?? "unknown"),
		};
		if (stepType === "USER_INPUT") {
			emitUserInput(out, base, textOf(o.content));
		} else if (stepType === "GENERIC") {
			// Antigravity GENERIC steps carry no call id; never join to a tool call.
			emitToolResult(out, state, base, "", o.content, o.status === "ERROR");
		} else if (stepType === "PLANNER_RESPONSE") {
			out.used = true; out.turns++;
			const model = typeof o.model === "string" && o.model ? o.model : "?";
			const toolCalls = Array.isArray(o.tool_calls) ? o.tool_calls : [];
			for (const c of toolCalls) {
				const rawName = String(c?.name ?? ""), args = norm(c?.args);
				let normName = rawName;
				let op: string | null = null;
				let payload: Record<string, any> = args;
				if (rawName === "call_mcp_tool") {
					const server = String(args.ServerName ?? "");
					const toolName = String(args.ToolName ?? "");
					if (server.startsWith("immune-brain") && KERNEL_OPS.has(toolName)) {
						normName = "imm_kernel_canary";
						op = toolName;
						const rawArgs = args.Arguments;
						if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
							payload = rawArgs as Record<string, any>;
						} else if (typeof rawArgs === "string") {
							payload = parsePythonRepr(rawArgs) ?? {};
						} else {
							payload = {};
						}
					}
				}
				emitToolCall(out, state, base, {
					id: "",
					rawName,
					normName,
					op,
					payload,
					rawVerdict: op ? payload.verdict : undefined,
					rawFinding: op ? payload.finding : undefined,
					model,
					review: false, // Antigravity invoke_subagent is not counted as a review dispatch.
				});
			}
			if (toolCalls.length === 0) {
				if (o.status === "ERROR") out.events.push({ ...base, type: "turn_end", stop_reason: "error" });
				else if (o.status === "DONE") out.events.push({ ...base, type: "turn_end", stop_reason: "stop" });
			}
		}
	}
	return out;
}

export async function readHostSession(host: Host, path: string, filter: SessionFilter): Promise<SessionRead | null> {
	if (host === "pi") return readSession(path, filter);
	if (host === "claude") return readClaudeSession(path, filter);
	return readAntigravitySession(path, filter);
}
