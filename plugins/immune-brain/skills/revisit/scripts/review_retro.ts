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
 *                          harness bookkeeping split out; a submit_review without a verdict takes the observed
 *                          receipt (the verdict JSON in the latest Review Agent toolResult), as the Kernel does
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type AuditRun, AuditUsageError, readCommittedAudit, type ReviewFinding, SKIP_REASONS } from "./audit_reader.ts";
import { readSession, parseTimestamp, type SessionEvent, type SessionFilter } from "./session_evidence.ts";
export { readSession } from "./session_evidence.ts";
export type { SessionEvent, SessionFilter, SessionRead } from "./session_evidence.ts";

const JITTER =
	/(?:review(?:er)? agent|reserved foreground agent)\b[^.\n]{0,80}?\b(?:missing|cleaned[- ]?up|not found|not observed|no longer exists?|disappeared)\b|\b(?:missing|cleaned[- ]?up)\b[^.\n]{0,40}?review(?:er)? agent|\bempty (?:review )?verdict\b|\bverdict (?:was |is )?empty\b/i;
const GROUP_POINTERS = 3;
const HIGH_ROUND_REWORK = 3;

function bump(map: Map<string, number>, key: string, n = 1): void {
	map.set(key, (map.get(key) ?? 0) + n);
}

type Args = {
	days: number;
	since: number;
	until: number;
	json: boolean;
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
		since: Number.NaN,
		until: Number.NaN,
		json: false,
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
		if (a === "--json") out.json = true;
		else if (a === "--since" || a === "--until") {
			const value = argv[++i];
			const parsed = parseTimestamp(value);
			if (!Number.isFinite(parsed)) throw new Error(USAGE);
			if (a === "--since") out.since = parsed; else out.until = parsed;
		}
		else if (a === "--root") out.root = argv[++i] ?? "";
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
	const now = Date.now();
	if (rest.length) {
		out.days = Number(rest[0]);
		if (rest.length !== 1 || !Number.isFinite(out.days) || !(out.days > 0) || Number.isFinite(out.since) || Number.isFinite(out.until)) throw new Error(USAGE);
		out.until = now;
		out.since = now - out.days * 86400000;
	} else {
		if (!Number.isFinite(out.since)) throw new Error(USAGE);
		if (!Number.isFinite(out.until)) out.until = now;
	}
	if (!(out.until > out.since) || !Number.isFinite(new Date(out.since).getTime())) throw new Error(USAGE);
	if (out.json && out.audit) throw new Error(`--json is only supported for session reports; ${USAGE}`);
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
	return paths.sort();
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
	emit(`review findings: ${all.length} | content rework: ${content.length} | jitter marker (unverified): ${jitter.length}`);

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

	emit("-- jitter marker (unverified; kept out of the content rework count) --");
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
			emit(`    round ${round}: ${shown}${jitterOnly ? " [jitter marker (unverified)]" : ""}`);
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
	const cut = new Date(args.since).toISOString();
	const inWindow = audit.runs.filter((r) => r.terminalizedMs >= args.since && r.terminalizedMs < args.until);
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
		`window: terminalized_at ${cut} <= t < ${new Date(args.until).toISOString()} | terminal runs: ${inWindow.length} (done ${lifecycle("done")}, stopped ${lifecycle("stopped")}) | outside window: ${audit.runs.length - inWindow.length}`,
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

type Candidate = { kind: string; key: string; pointers: string[] };
function candidates(events: SessionEvent[]): Candidate[] {
	const result: Candidate[] = [];
	const blocks = new Map<string, Map<string, SessionEvent>>();
	const batches = new Map<string, { first: SessionEvent; gap?: SessionEvent }>();
	const states = new Map<string, { last?: SessionEvent; stop?: SessionEvent; user?: SessionEvent; stopped: Set<number> }>();
	const pointer = (event: SessionEvent) => `${event.session}#${event.line}`;
	for (const e of events) {
		const state = states.get(e.session) ?? { stopped: new Set<number>() };
		states.set(e.session, state);
		if (e.type === "finding" && e.kind === "blocking" && e.registration_line !== null && e.task_id !== "unknown" && e.acceptance_id !== "unknown") {
			const key = `${e.cwd} / ${e.task_id} / ${e.acceptance_id}`;
			const registrations = blocks.get(key) ?? new Map<string, SessionEvent>();
			registrations.set(`${e.session}#${e.registration_index}`, e); blocks.set(key, registrations);
		}
		if (e.type === "registration" && e.without_verdict) result.push({ kind: "review_without_verdict", key: `${e.cwd} / ${e.task_id}`, pointers: [pointer(e)] });
		if (e.type === "tool_result") {
			if (e.stop_applied && e.call_line !== null) state.stopped.add(e.call_line);
			if (typeof e.batch_id === "string" && typeof e.batch_state === "string") {
				const previous = batches.get(e.batch_id);
				if (e.batch_state === "needs_human") {
					if (previous?.gap) result.push({ kind: "batch_oscillation", key: e.batch_id, pointers: [pointer(previous.first), pointer(previous.gap), pointer(e)] });
					batches.set(e.batch_id, { first: e });
				} else if (previous && !previous.gap) previous.gap = e;
			}
		}
		if (e.type === "turn_end" && ["stop", "error", "aborted"].includes(e.stop_reason)) {
			state.stop = e; state.user = undefined;
		} else if (e.type === "user_input" && state.stop) state.user = e;
		else if (e.type === "tool_call" && e.name === "imm_kernel_canary") {
			if (state.stop && state.user && state.last && state.last.task_id !== "unknown" && e.task_id === state.last.task_id && !state.stopped.has(state.last.line)) {
				result.push({ kind: "user_resume", key: `${e.cwd} / ${e.task_id} / ${state.stop.type === "turn_end" ? state.stop.stop_reason : ""}`, pointers: [pointer(state.last), pointer(state.stop), pointer(state.user), pointer(e)] });
			}
			state.last = e; state.stop = undefined; state.user = undefined;
		}
	}
	for (const [key, registrations] of blocks) if (registrations.size >= 2) result.push({ kind: "repeated_block", key, pointers: [...registrations.values()].slice(0, 5).map(pointer) });
	return result;
}

async function sessionReport(args: Args): Promise<string> {
	const filter: SessionFilter = { cutMs: args.since, untilMs: args.until, project: args.project, exclude: args.exclude };
	const tools = new Map<string, number>(), tasks = new Set<string>(), findRaw = new Map<string, number>(), findUniq = new Map<string, Set<string>>();
	const sessions: { path: string; cwd: string; session_id: string }[] = [], events: SessionEvent[] = [];
	let files = 0, skipped = 0, turns = 0, edits = 0, registrations = 0, anonymous = 0;
	for (const path of listJsonl(args.root)) {
		const session = await readSession(path, filter);
		if (!session) continue;
		sessions.push({ path, cwd: session.cwd, session_id: session.session_id });
		events.push(...session.events);
		if (session.used) files++;
		skipped += session.skipped; turns += session.turns; edits += session.edits;
		for (const [name, n] of session.tools) bump(tools, name, n);
		for (const ev of session.events) {
			if (ev.type === "registration") {
				registrations++;
				if (ev.taskId) tasks.add(`${session.cwd}\0${ev.taskId}`); else anonymous++;
			} else if (ev.type === "finding") {
				const kind = ev.markers.includes("bookkeeping") ? "bookkeeping" : ev.kind;
				bump(findRaw, kind);
				const uniq = findUniq.get(kind) ?? new Set<string>(); uniq.add(`${path}\0${ev.summary.slice(0, 160)}`); findUniq.set(kind, uniq);
			}
		}
	}
	const window = { since: new Date(args.since).toISOString(), until: new Date(args.until).toISOString() };
	const chains = candidates(events);
	if (args.json) return `${JSON.stringify({ contract: "immune_brain/revisit_evidence/v1", window, scope: { root: args.root, project: args.project, exclude: args.exclude }, skipped_lines: skipped, sessions, events, candidates: chains }, null, 2)}\n`;
	const lines: string[] = [], emit = (s = "") => lines.push(s);
	const filters = [...(args.project ? [`project~${args.project}`] : []), ...args.exclude.map(s => `exclude~${s}`)];
	emit(`window: ${window.since} <= t < ${window.until} | sessions with activity: ${files} | skipped lines (no usable timestamp): ${skipped} | root: ${args.root}`);
	emit(`filters: ${filters.length ? filters.join(", ") : "none"}`);
	emit("block/advis = submit_review verdict.findings plus legacy record_finding, deduped per session");
	emit(""); emit("=== candidate chains (locating only; not causes) ===");
	if (!chains.length) emit("(none)");
	for (const c of chains) emit(`${c.kind}: ${c.key} ${c.pointers.join(" ")}`);
	emit(`user inputs: ${events.filter(e => e.type === "user_input").length}`);
	emit(""); emit("=== findings (deduped per session) ===");
	const uniqOf = (kind: string) => findUniq.get(kind)?.size ?? 0;
	emit(`blocking: ${uniqOf("blocking")} | advisory: ${uniqOf("advisory")} | bookkeeping marker (unverified): ${uniqOf("bookkeeping")}`);
	const rawSum = [...findRaw.values()].reduce((a, b) => a + b, 0), uniqSum = [...findUniq.values()].reduce((n, set) => n + set.size, 0);
	if (rawSum && rawSum !== uniqSum) emit(`(findings: ${rawSum} raw calls deduped to ${uniqSum} distinct — re-submits of the same finding are counted once)`);
	emit("caveats: marker matches are excluded from blocking/advisory totals.");
	emit(""); emit("=== appendix: locating context (never a cause) ===");
	emit("=== usage (sessions / turns / edits / tools) ===");
	emit(`sessions: ${files} | turns: ${turns} | edits: ${edits}`);
	const toolRows = [...tools.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	if (!toolRows.length) emit("(no tool calls in this window)"); else for (const [name, n] of toolRows) emit(`${String(n).padStart(5)}  ${name}`);
	emit(""); emit("=== review rounds per kernel task (rework signal) ===");
	const withTask = registrations - anonymous;
	if (tasks.size) emit(`${(withTask / tasks.size).toFixed(1).padStart(6)} rounds/task   ${String(withTask).padStart(4)} registrations / ${String(tasks.size).padStart(3)} tasks`);
	else emit("(no kernel tasks with registrations in this window)");
	if (anonymous) emit(`${String(anonymous).padStart(6)} registrations without task_id (not counted as a task)`);
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
