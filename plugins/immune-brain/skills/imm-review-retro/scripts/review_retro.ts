#!/usr/bin/env bun
/**
 * Retro: how many code reviews did each model's own code trigger, across recent pi sessions.
 *
 * Usage: bun review_retro.ts <days> [--root <sessions-dir>] [--project <substr>] [--top N]
 *
 * Counting rules (the 口径 that keeps the numbers honest):
 *   review executed      = Agent(subagent_type="Review") tool call
 *   avgSc / pass%        = average score (0-10) and PASS rate from [SCORE: ...] tags in Review toolResult
 *   kernel:submit_review = the *registration* of that same review, reported separately (never added)
 *   attribution          = the model behind the most recent edit/write before the review (the code's author)
 *   findings             = imm_kernel_canary record_finding, deduped per session, harness bookkeeping split out
 */
import { createReadStream, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const BOOKKEEPING = /recorded cleanly|receipt recorded|round recorded|no findings?\b/i;
const EDIT_TOOLS = new Set(["edit", "write", "multiedit"]);
const SCORE_RE = /\[SCORE:\s*([\d.]+)\s*(?:\/\s*10)?\]/i;
const VERDICT_RE = /\[VERDICT:\s*(\w+)\]/i;
const RISK_RE = /\[RISK:\s*(\w+)\]/i;
const BLOCK_RE = /\[BLOCKING:\s*(\d+)\]/i;
const ADVIS_RE = /\[ADVISORY:\s*(\d+)\]/i;

type ReviewTag = {
	score: number;
	verdict: string;
	risk: string;
	blocking: number;
	advisory: number;
};

function parseReviewTag(text: string): ReviewTag | null {
	if (!text.includes("[SCORE:")) return null;
	const sc = SCORE_RE.exec(text);
	if (!sc) return null;
	const score = Number(sc[1]);
	if (!Number.isFinite(score)) return null;
	return {
		score,
		verdict: (VERDICT_RE.exec(text)?.[1] ?? "UNKNOWN").toUpperCase(),
		risk: (RISK_RE.exec(text)?.[1] ?? "UNKNOWN").toUpperCase(),
		blocking: Number(BLOCK_RE.exec(text)?.[1] ?? 0),
		advisory: Number(ADVIS_RE.exec(text)?.[1] ?? 0),
	};
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((item) => {
				if (typeof item === "string") return item;
				if (item && typeof item === "object") {
					const rec = item as Record<string, unknown>;
					if ("text" in rec) return String(rec.text);
					if ("result" in rec) return String(rec.result);
				}
				return "";
			})
			.join("\n");
	}
	return "";
}

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

type Args = { days: number; root: string; project: string; top: number };

function parseArgs(argv: string[]): Args {
	const out: Args = {
		days: NaN,
		root: join(homedir(), ".pi/agent/sessions"),
		project: "",
		top: 15,
	};
	const rest: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a === "--root") out.root = argv[++i] ?? "";
		else if (a === "--project") out.project = argv[++i] ?? "";
		else if (a === "--top") out.top = Number(argv[++i]);
		else if (a.startsWith("-")) throw new Error(`unknown flag: ${a}`);
		else rest.push(a);
	}
	out.days = Number(rest[0]);
	if (!(out.days > 0) || rest[1] !== undefined) {
		throw new Error("usage: review_retro.ts <days> [--root <dir>] [--project <substr>] [--top N]");
	}
	if (!Number.isFinite(out.top) || out.top <= 0) throw new Error("--top must be > 0");
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
	const cut = new Date(Date.now() - args.days * 86400000).toISOString().slice(0, 19);
	const home = homedir();
	const dev = new Map<string, number>();
	const turns = new Map<string, number>();
	const rev = new Map<string, number>();
	const sub = new Map<string, number>();
	const tools = new Map<string, number>();
	const proj = new Map<string, number>();
	const episode = new Map<string, Set<string>>();
	const tasks = new Map<string, Set<string>>();
	const findUniq = new Map<string, Set<string>>();
	const findingsRaw = new Map<string, number>();
	const scores = new Map<string, number[]>();
	const verdicts = new Map<string, number>();
	const risks = new Map<string, number>();
	let files = 0;

	for (const path of listJsonl(args.root)) {
		let editor: string | null = null;
		let cwd = "";
		let used = false;
		const pending = new Map<string, string>();
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
				cwd = String(o.cwd ?? "");
				continue;
			}
			const m = (o.message && typeof o.message === "object" ? o.message : {}) as Record<string, unknown>;
			const role = m.role;
			if (String(o.timestamp ?? "") < cut) continue;
			if (args.project && !cwd.includes(args.project)) continue;

			if (role === "assistant") {
				used = true;
				const mo = `${m.provider ?? "?"}/${m.model ?? "?"}`;
				bump(turns, mo);
				const content = Array.isArray(m.content) ? m.content : [];
				for (const c of content) {
					if (!c || typeof c !== "object") continue;
					const call = c as Record<string, unknown>;
					if (call.type !== "toolCall") continue;
					const name = String(call.name ?? "");
					const a = norm(call.arguments);
					const cid = typeof call.id === "string" ? call.id : "";
					bump(tools, name || "?");
					if (EDIT_TOOLS.has(name)) {
						bump(dev, mo);
						editor = mo;
					} else if (name === "Agent" && a.subagent_type === "Review") {
						const owner = editor ?? "no-edit (review-only)";
						bump(rev, owner);
						const ep = episode.get(owner) ?? new Set();
						ep.add(`${path}\0${String(a.description ?? "")}${String(a.prompt ?? "").slice(0, 240)}`);
						episode.set(owner, ep);
						const projKey = `${cwd.replace(home, "~")}\0${owner}`;
						bump(proj, projKey);
						if (cid) pending.set(cid, owner);
					} else if (name === "imm_kernel_canary") {
						const act = norm(a.action);
						const op = act.op;
						const owner = editor ?? "no-edit (review-only)";
						if (op === "submit_review") {
							bump(sub, owner);
							const t = tasks.get(owner) ?? new Set();
							t.add(`${cwd}\0${String(a.task_id ?? "")}`);
							tasks.set(owner, t);
						} else if (op === "record_finding") {
							const f = norm(act.finding);
							const summ = String(f.summary ?? "");
							const kind = BOOKKEEPING.test(summ) ? "bookkeeping" : String(f.kind ?? "");
							const rawKey = `${owner}\0${kind}`;
							bump(findingsRaw, rawKey);
							const uniq = findUniq.get(rawKey) ?? new Set();
							uniq.add(`${path}\0${summ.slice(0, 160)}`);
							findUniq.set(rawKey, uniq);
						}
					}
				}
			} else if (role === "toolResult") {
				const tcid = String(m.toolCallId ?? "");
				const owner = pending.get(tcid);
				if (!owner) continue;
				pending.delete(tcid);
				const tag = parseReviewTag(extractText(m.content));
				if (!tag) continue;
				const sl = scores.get(owner) ?? [];
				sl.push(tag.score);
				scores.set(owner, sl);
				bump(verdicts, `${owner}\0${tag.verdict}`);
				bump(risks, `${owner}\0${tag.risk}`);
			}
		}
		if (used) files += 1;
	}

	const lines: string[] = [];
	const emit = (s = "") => lines.push(s);
	emit(`window: last ${args.days}d (UTC >= ${cut}Z) | sessions with activity: ${files} | root: ${args.root}`);
	emit("review = Agent(Review) executed; attributed to the model that last edited the code under review");
	emit("avgSc/pass% = parsed from Review [SCORE: .../10] [VERDICT: ...] tags (shows '-' if untagged)");
	emit("");
	const hdr =
		`${"model".padEnd(42)}${"devEdits".padStart(9)}${"turns".padStart(6)}${"reviews".padStart(8)}${"uniq".padStart(5)}${"rev/100ed".padStart(10)}${"avgSc".padStart(6)}${"pass%".padStart(6)}${"registr".padStart(8)}${"block".padStart(6)}${"advis".padStart(6)}${"noisy".padStart(6)}`;
	emit(hdr);
	emit("-".repeat(hdr.length));

	const models = [...new Set([...rev.keys(), ...dev.keys()])].sort(
		(a, b) => (rev.get(b) ?? 0) - (rev.get(a) ?? 0),
	);
	const shown: string[] = [];
	for (const mo of models) {
		if (!rev.get(mo) && (dev.get(mo) ?? 0) < 30) continue;
		shown.push(mo);
		const uq = episode.get(mo)?.size ?? 0;
		const d = dev.get(mo) ?? 0;
		const r = rev.get(mo) ?? 0;
		const rate = d ? ((100 * r) / d).toFixed(1) : "-";
		const sl = scores.get(mo) ?? [];
		const avgSc = sl.length ? (sl.reduce((x, y) => x + y, 0) / sl.length).toFixed(1) : "-";
		const passCnt = verdicts.get(`${mo}\0PASS`) ?? 0;
		const passPct = sl.length ? `${Math.round((100 * passCnt) / sl.length)}%` : "-";
		const block = findUniq.get(`${mo}\0blocking`)?.size ?? 0;
		const advis = findUniq.get(`${mo}\0advisory`)?.size ?? 0;
		const noisy = findUniq.get(`${mo}\0bookkeeping`)?.size ?? 0;
		emit(
			`${mo.padEnd(42)}${String(d).padStart(9)}${String(turns.get(mo) ?? 0).padStart(6)}${String(r).padStart(8)}${String(uq).padStart(5)}${rate.padStart(10)}${avgSc.padStart(6)}${passPct.padStart(6)}${String(sub.get(mo) ?? 0).padStart(8)}${String(block).padStart(6)}${String(advis).padStart(6)}${String(noisy).padStart(6)}`,
		);
	}
	emit("-".repeat(hdr.length));
	const totalScores = [...scores.values()].flat();
	const totAvg = totalScores.length
		? (totalScores.reduce((x, y) => x + y, 0) / totalScores.length).toFixed(1)
		: "-";
	const totPass = shown.reduce((n, mo) => n + (verdicts.get(`${mo}\0PASS`) ?? 0), 0);
	const totPassPct = totalScores.length ? `${Math.round((100 * totPass) / totalScores.length)}%` : "-";
	const totBlock = [...findUniq.entries()].reduce((n, [k, v]) => n + (k.endsWith("\0blocking") ? v.size : 0), 0);
	const totAdvis = [...findUniq.entries()].reduce((n, [k, v]) => n + (k.endsWith("\0advisory") ? v.size : 0), 0);
	const totNoisy = [...findUniq.entries()].reduce((n, [k, v]) => n + (k.endsWith("\0bookkeeping") ? v.size : 0), 0);
	const totDev = [...dev.values()].reduce((a, b) => a + b, 0);
	const totTurns = [...turns.values()].reduce((a, b) => a + b, 0);
	const totRev = [...rev.values()].reduce((a, b) => a + b, 0);
	const totUniq = [...episode.values()].reduce((n, s) => n + s.size, 0);
	const totSub = [...sub.values()].reduce((a, b) => a + b, 0);
	emit(
		`${"TOTAL".padEnd(42)}${String(totDev).padStart(9)}${String(totTurns).padStart(6)}${String(totRev).padStart(8)}${String(totUniq).padStart(5)}${"".padStart(10)}${totAvg.padStart(6)}${totPassPct.padStart(6)}${String(totSub).padStart(8)}${String(totBlock).padStart(6)}${String(totAdvis).padStart(6)}${String(totNoisy).padStart(6)}`,
	);

	emit("");
	emit("=== usage (sessions / turns / edits / tools) ===");
	emit(`sessions: ${files} | turns: ${totTurns} | edits: ${totDev}`);
	const toolRows = [...tools.entries()].sort((a, b) => b[1] - a[1]);
	if (toolRows.length === 0) emit("(no tool calls in this window)");
	else for (const [name, n] of toolRows) emit(`${String(n).padStart(5)}  ${name}`);

	emit("");
	emit("=== review quality & scores (new rubric) ===");
	const scoredModels = [...scores.keys()]
		.filter((m) => (scores.get(m) ?? []).length > 0)
		.sort((a, b) => (scores.get(b)?.length ?? 0) - (scores.get(a)?.length ?? 0));
	if (scoredModels.length) {
		const qHdr = `${"model".padEnd(42)}${"scored".padStart(7)}${"avgScore".padStart(9)}${"PASS".padStart(6)}${"REVISE".padStart(7)}${"REJECT".padStart(7)}${"highRisk".padStart(9)}`;
		emit(qHdr);
		emit("-".repeat(qHdr.length));
		for (const mo of scoredModels) {
			const sl = scores.get(mo) ?? [];
			const avgS = (sl.reduce((x, y) => x + y, 0) / sl.length).toFixed(2);
			const pC = verdicts.get(`${mo}\0PASS`) ?? 0;
			const revC = verdicts.get(`${mo}\0REVISE`) ?? 0;
			const rejC = verdicts.get(`${mo}\0REJECT`) ?? 0;
			const highR = (risks.get(`${mo}\0HIGH`) ?? 0) + (risks.get(`${mo}\0CRITICAL`) ?? 0);
			emit(
				`${mo.padEnd(42)}${String(sl.length).padStart(7)}${avgS.padStart(9)}${String(pC).padStart(6)}${String(revC).padStart(7)}${String(rejC).padStart(7)}${String(highR).padStart(9)}`,
			);
		}
	} else {
		emit("(no scored reviews found in this window yet; reviews with [SCORE: .../10] will appear here)");
	}

	emit("");
	emit("=== where the reviews landed (project x author) ===");
	const projRows = [...proj.entries()].sort((a, b) => b[1] - a[1]).slice(0, args.top);
	for (const [key, v] of projRows) {
		const [p, mo] = key.split("\0");
		emit(`${String(v).padStart(5)}  ${String(p).padEnd(58)} ${mo}`);
	}

	emit("");
	emit("=== review rounds per kernel task (rework signal) ===");
	const taskModels = [...tasks.keys()].sort((a, b) => (sub.get(b) ?? 0) - (sub.get(a) ?? 0));
	for (const mo of taskModels) {
		const nt = tasks.get(mo)?.size ?? 0;
		if (!nt) continue;
		const s = sub.get(mo) ?? 0;
		emit(
			`${(s / nt).toFixed(1).padStart(6)} rounds/task   ${String(s).padStart(4)} registrations / ${String(nt).padStart(3)} tasks   ${mo}`,
		);
	}

	const rawSum = [...findingsRaw.values()].reduce((a, b) => a + b, 0);
	const uniqSum = [...findUniq.values()].reduce((n, s) => n + s.size, 0);
	if (rawSum && rawSum !== uniqSum) {
		emit("");
		emit(
			`(findings: ${rawSum} raw calls deduped to ${uniqSum} distinct — re-submits of the same finding are counted once)`,
		);
	}
	emit("caveats: 'bookkeep' = kernel self-entries mislabelled as findings, excluded from blocking/advisory;");
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
