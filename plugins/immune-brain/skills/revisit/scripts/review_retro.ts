#!/usr/bin/env bun
/**
 * Workflow-health retro over recent pi sessions: usage, rework signal and finding totals.
 *
 * Usage: bun review_retro.ts <days> [--root <sessions-dir>] [--project <substr>] [--exclude <substr>]...
 *
 * Counting rules (the 口径 that keeps the numbers honest):
 *   session              = one pi JSONL file; its header `cwd` drives --project / --exclude
 *   window               = timestamps parsed to epoch ms (ISO with any offset, or numeric ms);
 *                          a line with a missing or unparsable timestamp is skipped and counted
 *   review executed      = Agent(subagent_type="Review", any case) tool call
 *   kernel:submit_review = the *registration* of a review; rounds/task is registrations per (cwd, task_id),
 *                          registrations without a task_id are counted separately
 *   author               = the model behind the most recent edit/write/multiedit/apply_patch before a
 *                          review or finding; kept on events for downstream readers, never ranked
 *   findings             = submit_review verdict.findings plus legacy record_finding, deduped per session,
 *                          harness bookkeeping split out
 */
import { createReadStream, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const BOOKKEEPING = /recorded cleanly|receipt recorded|round recorded|no findings?\b/i;
const EDIT_TOOLS = new Set(["edit", "write", "multiedit", "apply_patch"]);
const NO_EDIT = "no-edit (review-only)";
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;

function norm(a: unknown): Record<string, unknown> {
	if (typeof a === "string") {
		try {
			return JSON.parse(a) as Record<string, unknown>;
		} catch {
			return {};
		}
	}
	return a && typeof a === "object" ? (a as Record<string, unknown>) : {};
}

function bump(map: Map<string, number>, key: string, n = 1): void {
	map.set(key, (map.get(key) ?? 0) + n);
}

/** Epoch milliseconds from an ISO string (any offset) or a numeric millisecond value; NaN otherwise. */
function parseTimestamp(value: unknown): number {
	if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
	if (typeof value === "string" && ISO_TIMESTAMP.test(value)) return Date.parse(value);
	return Number.NaN;
}

export type SessionEvent =
	| { type: "review"; author: string; key: string }
	| { type: "registration"; author: string; taskId: string }
	| { type: "finding"; author: string; kind: string; summary: string };

export type SessionFilter = { cutMs: number; project: string; exclude: string[] };

export type SessionRead = {
	cwd: string;
	used: boolean;
	skipped: number;
	turns: number;
	edits: number;
	tools: Map<string, number>;
	events: SessionEvent[];
};

function cwdKept(cwd: string, filter: SessionFilter): boolean {
	if (filter.project && !cwd.includes(filter.project)) return false;
	return !filter.exclude.some((s) => cwd.includes(s));
}

/** Read one session file. Returns null when its cwd is filtered out by --project / --exclude. */
export async function readSession(path: string, filter: SessionFilter): Promise<SessionRead | null> {
	const out: SessionRead = { cwd: "", used: false, skipped: 0, turns: 0, edits: 0, tools: new Map(), events: [] };
	let editor: string | null = null;
	const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }) });
	for await (const raw of rl) {
		const line = raw.trim();
		if (!line) continue;
		let o: Record<string, unknown>;
		try {
			o = JSON.parse(line) as Record<string, unknown>;
		} catch {
			continue;
		}
		if (o.type === "session") {
			out.cwd = String(o.cwd ?? "");
			if (!cwdKept(out.cwd, filter)) {
				rl.close();
				return null;
			}
			continue;
		}
		const ms = parseTimestamp(o.timestamp);
		if (Number.isNaN(ms)) {
			out.skipped += 1;
			continue;
		}
		if (ms < filter.cutMs) continue;
		const m = (o.message && typeof o.message === "object" ? o.message : {}) as Record<string, unknown>;
		if (m.role !== "assistant") continue;
		out.used = true;
		const mo = `${m.provider ?? "?"}/${m.model ?? "?"}`;
		out.turns += 1;
		const content = Array.isArray(m.content) ? m.content : [];
		for (const c of content) {
			if (!c || typeof c !== "object") continue;
			const call = c as Record<string, unknown>;
			if (call.type !== "toolCall") continue;
			const name = String(call.name ?? "");
			const a = norm(call.arguments);
			bump(out.tools, name || "?");
			const author = editor ?? NO_EDIT;
			if (EDIT_TOOLS.has(name)) {
				out.edits += 1;
				editor = mo;
			} else if (name === "Agent" && String(a.subagent_type ?? "").toLowerCase() === "review") {
				out.events.push({
					type: "review",
					author,
					key: `${String(a.description ?? "")}${String(a.prompt ?? "").slice(0, 240)}`,
				});
			} else if (name === "imm_kernel_canary") {
				const act = norm(a.action);
				if (act.op === "submit_review") {
					out.events.push({ type: "registration", author, taskId: String(a.task_id ?? "") });
					const found = norm(act.verdict).findings;
					if (Array.isArray(found)) for (const f of found) out.events.push(findingEvent(author, f));
				} else if (act.op === "record_finding") {
					out.events.push(findingEvent(author, act.finding));
				}
			}
		}
	}
	return out;
}

function findingEvent(author: string, finding: unknown): SessionEvent {
	const f = norm(finding);
	const summary = String(f.summary ?? "");
	return { type: "finding", author, kind: BOOKKEEPING.test(summary) ? "bookkeeping" : String(f.kind ?? ""), summary };
}

type Args = { days: number; root: string; project: string; exclude: string[] };

const USAGE = "usage: review_retro.ts <days> [--root <dir>] [--project <substr>] [--exclude <substr>]...";

function parseArgs(argv: string[]): Args {
	const out: Args = { days: Number.NaN, root: join(homedir(), ".pi/agent/sessions"), project: "", exclude: [] };
	const rest: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a === "--root") out.root = argv[++i] ?? "";
		else if (a === "--project") out.project = argv[++i] ?? "";
		else if (a === "--exclude") {
			const v = argv[++i] ?? "";
			if (!v) throw new Error(`--exclude needs a value; ${USAGE}`);
			out.exclude.push(v);
		} else if (a.startsWith("-")) throw new Error(`unknown flag: ${a}`);
		else rest.push(a);
	}
	out.days = Number(rest[0]);
	if (!(out.days > 0) || rest[1] !== undefined) throw new Error(USAGE);
	return out;
}

function listJsonl(root: string): string[] {
	if (!existsSync(root)) return [];
	const paths: string[] = [];
	for (const dir of readdirSync(root, { withFileTypes: true })) {
		if (!dir.isDirectory()) continue;
		const folder = join(root, dir.name);
		for (const name of readdirSync(folder)) {
			if (name.endsWith(".jsonl")) paths.push(join(folder, name));
		}
	}
	return paths;
}

export async function run(argv: string[]): Promise<string> {
	const args = parseArgs(argv);
	const cutMs = Date.now() - args.days * 86400000;
	const cut = new Date(cutMs).toISOString().slice(0, 19);
	const filter: SessionFilter = { cutMs, project: args.project, exclude: args.exclude };
	const tools = new Map<string, number>();
	const tasks = new Set<string>();
	const findRaw = new Map<string, number>();
	const findUniq = new Map<string, Set<string>>();
	let files = 0;
	let skipped = 0;
	let turns = 0;
	let edits = 0;
	let registrations = 0;
	let anonymous = 0;

	for (const path of listJsonl(args.root)) {
		const session = await readSession(path, filter);
		if (!session) continue;
		if (session.used) files += 1;
		skipped += session.skipped;
		turns += session.turns;
		edits += session.edits;
		for (const [name, n] of session.tools) bump(tools, name, n);
		for (const ev of session.events) {
			if (ev.type === "registration") {
				registrations += 1;
				if (ev.taskId) tasks.add(`${session.cwd}\0${ev.taskId}`);
				else anonymous += 1;
			} else if (ev.type === "finding") {
				bump(findRaw, ev.kind);
				const uniq = findUniq.get(ev.kind) ?? new Set();
				uniq.add(`${path}\0${ev.summary.slice(0, 160)}`);
				findUniq.set(ev.kind, uniq);
			}
		}
	}

	const lines: string[] = [];
	const emit = (s = "") => lines.push(s);
	const filters = [
		...(args.project ? [`project~${args.project}`] : []),
		...args.exclude.map((s) => `exclude~${s}`),
	];
	emit(
		`window: last ${args.days}d (UTC >= ${cut}Z) | sessions with activity: ${files} | skipped lines (no usable timestamp): ${skipped} | root: ${args.root}`,
	);
	emit(`filters: ${filters.length ? filters.join(", ") : "none"}`);
	emit("block/advis = submit_review verdict.findings plus legacy record_finding, deduped per session");

	emit("");
	emit("=== usage (sessions / turns / edits / tools) ===");
	emit(`sessions: ${files} | turns: ${turns} | edits: ${edits}`);
	const toolRows = [...tools.entries()].sort((a, b) => b[1] - a[1]);
	if (toolRows.length === 0) emit("(no tool calls in this window)");
	else for (const [name, n] of toolRows) emit(`${String(n).padStart(5)}  ${name}`);

	emit("");
	emit("=== review rounds per kernel task (rework signal) ===");
	const withTask = registrations - anonymous;
	if (tasks.size) {
		emit(
			`${(withTask / tasks.size).toFixed(1).padStart(6)} rounds/task   ${String(withTask).padStart(4)} registrations / ${String(tasks.size).padStart(3)} tasks`,
		);
	} else {
		emit("(no kernel tasks with registrations in this window)");
	}
	if (anonymous) emit(`${String(anonymous).padStart(6)} registrations without task_id (not counted as a task)`);

	emit("");
	emit("=== findings (deduped per session) ===");
	const uniqOf = (kind: string) => findUniq.get(kind)?.size ?? 0;
	emit(`blocking: ${uniqOf("blocking")} | advisory: ${uniqOf("advisory")} | bookkeeping: ${uniqOf("bookkeeping")}`);
	const rawSum = [...findRaw.values()].reduce((a, b) => a + b, 0);
	const uniqSum = [...findUniq.values()].reduce((n, s) => n + s.size, 0);
	if (rawSum && rawSum !== uniqSum) {
		emit(
			`(findings: ${rawSum} raw calls deduped to ${uniqSum} distinct — re-submits of the same finding are counted once)`,
		);
	}
	emit("caveats: 'bookkeeping' = kernel self-entries mislabelled as findings, excluded from blocking/advisory;");
	emit("         high rounds/task can be canary/QA harness re-registration, not human-visible rework.");
	return `${lines.join("\n")}\n`;
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]!).href === import.meta.url;
if (isMain) {
	run(process.argv.slice(2))
		.then((text) => {
			process.stdout.write(text);
		})
		.catch((err: unknown) => {
			console.error(err);
			process.exit(1);
		});
}
