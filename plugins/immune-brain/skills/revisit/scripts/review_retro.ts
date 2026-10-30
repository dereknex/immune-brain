#!/usr/bin/env bun
/**
 * Workflow-health retro over recent pi sessions: usage, rework signal and finding totals.
 *
 * Usage: bun review_retro.ts <days> [--root <sessions-dir>] [--project <substr>] [--exclude <substr>]...
 *                                   [--audit <project-root> [--sessions] [--sample <n>]]
 *
 * Without --audit the session report runs. With --audit the committed-audit report runs (HEAD of one project,
 * see audit_reader.ts) and session logs are read only when --sessions is also given.
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
import { type AuditRun, AuditUsageError, readCommittedAudit, type ReviewFinding, SKIP_REASONS } from "./audit_reader.ts";

const BOOKKEEPING = /recorded cleanly|receipt recorded|round recorded|no findings?\b/i;
const EDIT_TOOLS = new Set(["edit", "write", "multiedit", "apply_patch"]);
const NO_EDIT = "no-edit (review-only)";
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;
/** A review finding that records a missing or cleaned-up reviewer agent, or an empty verdict, not a content defect. */
const JITTER =
	/(?:review(?:er)? agent|reserved foreground agent)\b[^.\n]{0,80}?\b(?:missing|cleaned[- ]?up|not found|not observed|no longer exists?|disappeared)\b|\b(?:missing|cleaned[- ]?up)\b[^.\n]{0,40}?review(?:er)? agent|\bempty (?:review )?verdict\b|\bverdict (?:was |is )?empty\b/i;
const GROUP_POINTERS = 3;
const HIGH_ROUND_REWORK = 3;

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

type Args = {
	days: number;
	root: string;
	project: string;
	exclude: string[];
	audit: string;
	sessions: boolean;
	sample: number;
};

const USAGE =
	"usage: review_retro.ts <days> [--root <dir>] [--project <substr>] [--exclude <substr>]... [--audit <project-root> [--sessions] [--sample <n>]]";

function parseArgs(argv: string[]): Args {
	const out: Args = {
		days: Number.NaN,
		root: join(homedir(), ".pi/agent/sessions"),
		project: "",
		exclude: [],
		audit: "",
		sessions: false,
		sample: 10,
	};
	const rest: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a === "--root") out.root = argv[++i] ?? "";
		else if (a === "--project") out.project = argv[++i] ?? "";
		else if (a === "--exclude") {
			const v = argv[++i] ?? "";
			if (!v) throw new Error(`--exclude needs a value; ${USAGE}`);
			out.exclude.push(v);
		} else if (a === "--audit") {
			out.audit = argv[++i] ?? "";
			if (!out.audit) throw new Error(`--audit needs a project root; ${USAGE}`);
		} else if (a === "--sessions") out.sessions = true;
		else if (a === "--sample") {
			out.sample = Number(argv[++i]);
			if (!Number.isInteger(out.sample) || out.sample < 1) throw new Error(`--sample needs a positive integer; ${USAGE}`);
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

function cutOf(days: number): { cutMs: number; cut: string } {
	const cutMs = Date.now() - days * 86400000;
	return { cutMs, cut: new Date(cutMs).toISOString().slice(0, 19) };
}

export async function run(argv: string[]): Promise<string> {
	const args = parseArgs(argv);
	if (!args.audit) return sessionReport(args);
	const audit = auditReport(args);
	return args.sessions ? `${audit}\n${await sessionReport(args)}` : audit;
}

const DASH = "-";

function cell(n: number | null): string {
	return n === null ? DASH : String(n);
}

function sumOf(runs: AuditRun[], pick: (r: AuditRun) => number | null): number | null {
	const values = runs.map(pick).filter((n): n is number => n !== null);
	return values.length ? values.reduce((a, b) => a + b, 0) : null;
}

function findingCell(findings: Map<string, number>): string {
	return [...findings.entries()]
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([k, n]) => `${k}:${n}`)
		.join(" ") || DASH;
}

function metrics(r: AuditRun): string {
	return [
		`qa_pass=${r.qaPass}`,
		`qa_exec_fail=${r.qaExecutionFailures}`,
		`review_rework=${r.reviewRework}`,
		`review_pass=${r.reviewPass}`,
		`compat_rev=${cell(r.compatibleRevisions)}`,
		`breaking_rev=${r.breakingRevisions}`,
		`user_rework=${cell(r.authorizedRework)}`,
		`stops=${r.stops}`,
		`bindings=${r.intentBindings}i/${r.diffBindings}d`,
		`findings=${findingCell(r.findings)}`,
	].join(" ");
}

/** Spec D6 key: lowercase, collapsed whitespace; backtick-quoted paths, hex digests and digits become placeholders. */
export function summaryKey(summary: string): string {
	return summary
		.toLowerCase()
		.replace(/`[^`]*(?:\/|\.[a-z0-9]+)[^`]*`/g, "<path>")
		.replace(/\b(?:sha\d+:)?[0-9a-f]{8,}\b/g, "<hex>")
		.replace(/\d+/g, "<n>")
		.replace(/\s+/g, " ")
		.trim();
}

type Pointed = ReviewFinding & { run: AuditRun };

function candidateImprovements(inWindow: AuditRun[], emit: (s?: string) => void): void {
	const all: Pointed[] = inWindow.flatMap((run) => run.reviewFindings.map((f) => ({ ...f, run })));
	const jitter = all.filter((f) => JITTER.test(f.summary));
	const content = all.filter((f) => !JITTER.test(f.summary));

	emit("");
	emit("=== candidate improvements (evidence only; no improvement level or disposition is suggested) ===");
	emit(`review findings: ${all.length} | content rework: ${content.length} | infrastructure jitter: ${jitter.length}`);

	const groups = new Map<string, Pointed[]>();
	for (const f of content) groups.set(summaryKey(f.summary), [...(groups.get(summaryKey(f.summary)) ?? []), f]);
	const repeats = [...groups.entries()]
		.map(([key, items]) => ({ key, items, runs: new Set(items.map((f) => f.run.path)).size }))
		.filter((g) => g.runs >= 2)
		.sort((a, b) => b.runs - a.runs || b.items.length - a.items.length || (a.key < b.key ? -1 : 1));
	emit("-- repeat groups (same normalized summary in at least 2 runs) --");
	if (repeats.length === 0) emit("(none)");
	for (const g of repeats) {
		emit(`runs=${g.runs} findings=${g.items.length} key: ${g.key.slice(0, 160)}`);
		emit(`    ${g.items.slice(0, GROUP_POINTERS).map((f) => `${f.run.path}#${f.id}`).join(" ")}`);
	}

	emit("-- infrastructure jitter (kept out of the content rework count) --");
	if (jitter.length === 0) emit("(none)");
	for (const f of jitter) emit(`${f.run.path}#${f.id} ${f.summary.replace(/\s+/g, " ").slice(0, 120)}`);

	emit(`-- high-round runs (>= ${HIGH_ROUND_REWORK} review rework events; acceptance ids per round, '*' = id repeats across rounds) --`);
	const high = inWindow
		.filter((r) => r.reworkRounds.length >= HIGH_ROUND_REWORK)
		.sort((a, b) => b.reworkRounds.length - a.reworkRounds.length || (a.path < b.path ? -1 : 1));
	if (high.length === 0) emit("(none)");
	for (const r of high) {
		emit(`${r.path} review_rework=${r.reworkRounds.length}`);
		const rounds = [...new Set([...r.reworkRounds, ...r.reviewFindings.flatMap((f) => (f.round === null ? [] : [f.round]))])].sort(
			(a, b) => a - b,
		);
		const idsOf = (round: number) => [...new Set(r.reviewFindings.filter((f) => f.round === round).map((f) => f.acceptanceId))];
		const seen = new Map<string, number>();
		for (const round of rounds) for (const id of idsOf(round)) seen.set(id, (seen.get(id) ?? 0) + 1);
		for (const round of rounds) {
			const ids = idsOf(round);
			const jitterOnly =
				ids.length > 0 && r.reviewFindings.filter((f) => f.round === round).every((f) => JITTER.test(f.summary));
			const shown = ids.map((id) => (seen.get(id)! > 1 ? `${id}*` : id)).join(" ") || "(no findings)";
			emit(`    round ${round}: ${shown}${jitterOnly ? " [infrastructure jitter]" : ""}`);
		}
	}
}

function auditReport(args: Args): string {
	let audit: ReturnType<typeof readCommittedAudit>;
	try {
		audit = readCommittedAudit(args.audit);
	} catch (err) {
		if (err instanceof AuditUsageError) throw new Error(`${err.message}; ${USAGE}`);
		throw err;
	}
	const { cutMs, cut } = cutOf(args.days);
	const inWindow = audit.runs.filter((r) => r.terminalizedMs >= cutMs);
	const schemas = (["v4", "v3", "v2"] as const).map((v) => `${v}=${inWindow.filter((r) => r.schema === v).length}`);
	const lifecycle = (state: string) => inWindow.filter((r) => r.lifecycle === state).length;
	const ordered = [...inWindow].sort(
		(a, b) => b.terminalizedMs - a.terminalizedMs || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
	);
	const findings = new Map<string, number>();
	for (const r of inWindow) for (const [k, n] of r.findings) findings.set(k, (findings.get(k) ?? 0) + n);

	const lines: string[] = [];
	const emit = (s = "") => lines.push(s);
	emit(`audit: project root ${audit.projectRoot} | HEAD ${audit.head}`);
	emit(
		`window: last ${args.days}d (terminalized_at >= ${cut}Z) | terminal runs: ${inWindow.length} (done ${lifecycle("done")}, stopped ${lifecycle("stopped")}) | outside window: ${audit.runs.length - inWindow.length}`,
	);
	emit(`schemas: ${schemas.join(" ")}`);
	emit(`skipped: ${SKIP_REASONS.map((reason) => `${reason}=${audit.skipped[reason]}`).join(" ")}`);
	emit(
		"bias: only merged terminal runs are present; unmerged Lane branches, non-terminal runs and stopped runs whose pair was never committed are absent.",
	);
	emit("counts are raw per-run facts; '-' marks a field the record schema cannot carry (not zero).");

	emit("");
	emit("=== totals ===");
	emit(
		[
			`qa_pass=${cell(sumOf(inWindow, (r) => r.qaPass))}`,
			`qa_exec_fail=${cell(sumOf(inWindow, (r) => r.qaExecutionFailures))}`,
			`review_rework=${cell(sumOf(inWindow, (r) => r.reviewRework))}`,
			`review_pass=${cell(sumOf(inWindow, (r) => r.reviewPass))}`,
			`compat_rev=${cell(sumOf(inWindow, (r) => r.compatibleRevisions))}`,
			`breaking_rev=${cell(sumOf(inWindow, (r) => r.breakingRevisions))}`,
			`user_rework=${cell(sumOf(inWindow, (r) => r.authorizedRework))}`,
			`stops=${cell(sumOf(inWindow, (r) => r.stops))}`,
			`findings=${findingCell(findings)}`,
		].join(" "),
	);

	emit("");
	emit(`=== runs (newest terminalized_at first; ${Math.min(args.sample, ordered.length)} of ${ordered.length}) ===`);
	if (ordered.length === 0) emit("(no committed terminal runs in this window)");
	for (const r of ordered.slice(0, args.sample)) {
		emit(`${r.terminalizedAt} ${r.lifecycle} ${r.schema} ${r.path}`);
		emit(`    ${metrics(r)}`);
	}
	candidateImprovements(inWindow, emit);
	return `${lines.join("\n")}\n`;
}

async function sessionReport(args: Args): Promise<string> {
	const { cutMs, cut } = cutOf(args.days);
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
