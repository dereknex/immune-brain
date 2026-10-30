import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const BOOKKEEPING = /recorded cleanly|receipt recorded|round recorded|no findings?\b/i;
const EDIT_TOOLS = new Set(["edit", "write", "multiedit", "apply_patch"]);
const VERDICT_START = /\{\s*"contract"\s*:\s*"assurance_kernel\/assurance_verdict\//;

function norm(value: unknown): Record<string, any> {
	if (typeof value === "string") {
		try { value = JSON.parse(value); } catch { return {}; }
	}
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
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

type Pointer = { session: string; line: number; entry_id: string; timestamp: string; role: string; cwd: string; task_id: string; run_id: string };
export type SessionEvent = Pointer & ({ type: "user_input"; skill: string | null; instruction: string; chars: number }
	| { type: "tool_call"; tool_call_id: string; name: string; op: string | null; author: string }
	| { type: "tool_result"; tool_call_id: string; call_line: number | null; is_error: boolean; state?: unknown; lifecycle?: unknown; batch_id?: unknown; batch_state?: unknown; stop_applied?: boolean }
	| { type: "turn_end"; stop_reason: string }
	| { type: "review"; author: string; key: string }
	| { type: "registration"; author: string; taskId: string; without_verdict: boolean }
	| { type: "finding"; author: string; kind: string; summary: string; markers: string[]; acceptance_id: string; registration_line: number | null; registration_index: number | null });
export type SessionFilter = { cutMs: number; untilMs?: number; project: string; exclude: string[] };
export type SessionRead = { cwd: string; session_id: string; used: boolean; skipped: number; turns: number; edits: number; tools: Map<string, number>; events: SessionEvent[] };

export async function readSession(path: string, filter: SessionFilter): Promise<SessionRead | null> {
	const out: SessionRead = { cwd: "", session_id: "unknown", used: false, skipped: 0, turns: 0, edits: 0, tools: new Map(), events: [] };
	let editor: string | null = null, receipt: Record<string, any> | null = null, lineNo = 0, registrationIndex = 0;
	const calls = new Map<string, { line: number; task: string; run: string; op: string | null; review: boolean }>();
	const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }) });
	for await (const raw of rl) {
		lineNo++;
		if (!raw.trim()) continue;
		let o: Record<string, any>;
		try { o = norm(JSON.parse(raw)); } catch { continue; }
		if (o.type === "session") {
			out.cwd = String(o.cwd ?? ""); out.session_id = String(o.id ?? "unknown");
			if ((filter.project && !out.cwd.includes(filter.project)) || filter.exclude.some(s => out.cwd.includes(s))) { rl.close(); return null; }
			continue;
		}
		const ms = parseTimestamp(o.timestamp);
		if (!Number.isFinite(ms) || !Number.isFinite(new Date(ms).getTime())) { out.skipped++; continue; }
		if (ms < filter.cutMs || ms >= (filter.untilMs ?? Infinity)) continue;
		const m = norm(o.message), role = String(m.role ?? "");
		const base: Pointer = { session: path, line: lineNo, entry_id: String(o.id ?? "unknown"), timestamp: new Date(ms).toISOString(), role, cwd: out.cwd, task_id: String(o.task_id ?? m.task_id ?? "unknown"), run_id: String(o.run_id ?? m.run_id ?? "unknown") };
		if (role === "user") {
			out.used = true;
			const text = textOf(m.content), match = text.match(/^\s*<skill\b[^>]*\bname=["']([^"']+)["'][^>]*>[\s\S]*?<\/skill>/);
			out.events.push({ ...base, type: "user_input", skill: match?.[1] ?? null, instruction: text.replace(/<skill\b[^>]*>[\s\S]*?<\/skill>/g, "").trim().slice(0, 240), chars: text.length });
		} else if (role === "toolResult") {
			out.used = true;
			const id = String(m.toolCallId ?? ""), call = calls.get(id), result = norm(textOf(m.content));
			if (call?.review) receipt = observedVerdict(m.content);
			const event: SessionEvent = { ...base, task_id: call?.task !== "unknown" && call?.task ? call.task : String(result.task_id ?? base.task_id), run_id: call?.run !== "unknown" && call?.run ? call.run : String(norm(result.task_state).run_id ?? result.run_id ?? base.run_id), type: "tool_result", tool_call_id: id, call_line: call?.line ?? null, is_error: Boolean(m.isError), ...(result.state !== undefined ? { state: result.state } : {}), ...(result.lifecycle !== undefined ? { lifecycle: result.lifecycle } : {}), ...(result.batch_id !== undefined ? { batch_id: result.batch_id } : {}), ...(result.batch_state !== undefined ? { batch_state: result.batch_state } : {}), ...(call?.op === "request_stop" && result.state === "applied" && result.lifecycle === "stopped" ? { stop_applied: true } : {}) };
			out.events.push(event);
		} else if (role === "assistant") {
			out.used = true; out.turns++;
			const model = `${m.provider ?? "?"}/${m.model ?? "?"}`;
			for (const c of Array.isArray(m.content) ? m.content : []) {
				if (c?.type !== "toolCall") continue;
				const name = String(c.name ?? ""), a = norm(c.arguments), action = norm(a.action), op = typeof action.op === "string" ? action.op : null, id = String(c.id ?? ""), author = editor ?? "no-edit (review-only)";
				const pointer = { ...base, task_id: String(a.task_id ?? base.task_id), run_id: String(a.run_id ?? base.run_id) };
				const review = name === "Agent" && String(a.subagent_type ?? "").toLowerCase() === "review";
				if (id) calls.set(id, { line: lineNo, task: pointer.task_id, run: pointer.run_id, op, review });
				out.tools.set(name || "?", (out.tools.get(name || "?") ?? 0) + 1);
				out.events.push({ ...pointer, type: "tool_call", tool_call_id: id, name, op, author });
				if (EDIT_TOOLS.has(name)) { out.edits++; editor = model; }
				else if (review) out.events.push({ ...pointer, type: "review", author, key: `${String(a.description ?? "")}${String(a.prompt ?? "").slice(0, 240)}` });
				else if (name === "imm_kernel_canary" && (op === "submit_review" || op === "record_finding")) {
					const verdict = action.verdict === undefined ? receipt : norm(action.verdict);
					if (op === "submit_review") {
						registrationIndex++;
						out.events.push({ ...pointer, type: "registration", author, taskId: String(a.task_id ?? ""), without_verdict: action.verdict === undefined && !receipt });
						receipt = null;
					}
					const findings = op === "record_finding" ? [action.finding] : Array.isArray(verdict?.findings) ? verdict.findings : [];
					for (const rawFinding of findings) {
						const f = norm(rawFinding), summary = String(f.summary ?? "");
						out.events.push({ ...pointer, type: "finding", author, kind: String(f.kind ?? ""), summary, markers: BOOKKEEPING.test(summary) ? ["bookkeeping"] : [], acceptance_id: String(f.acceptance_id ?? "unknown"), registration_line: op === "submit_review" ? lineNo : null, registration_index: op === "submit_review" ? registrationIndex : null });
					}
				}
			}
			if (typeof m.stopReason === "string" && m.stopReason !== "toolUse") out.events.push({ ...base, type: "turn_end", stop_reason: m.stopReason });
		}
	}
	return out;
}
