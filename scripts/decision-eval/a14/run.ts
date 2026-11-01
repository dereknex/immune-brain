// A14 PR comment triage offline eval (Spec D8). Calls decide() once per
// labelled corpus row and writes a dated JSON and Markdown report that compares
// the model with the `all_blocking` baseline (today's `fix-pr`, which repairs
// every unresolved thread).
//
// Usage: bun scripts/decision-eval/a14/run.ts --corpus <path> --out <dir> [--root <dir>] [--date YYYY-MM-DD]
//
// Exit codes: 0 report written; 1 no_labelled_cases / corpus_invalid / usage;
// 2 no_cases_decided (checked after the report is written).

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Envelope, UnavailableReason } from "../../decision-model/contract.ts";
import { decide, resolveProfile } from "../../decision-model/decide.ts";
import { A14_PR_COMMENT_TRIAGE } from "../../decision-model/thresholds.ts";
import { CliError, type CorpusRow, isGoldLabel, parseCorpus } from "./extract.ts";

export const REPORT_CONTRACT = "immune_brain/decision_eval_report/v1";
export const EARLIER_LIMIT = 20;
const POINT = A14_PR_COMMENT_TRIAGE;
const CLASSES = POINT.options;

type Case = { id: string; gold: string; envelope: Envelope } | { id: string; gold: string; unavailable: UnavailableReason };

interface ClassStats {
	precision: number | null;
	recall: number | null;
	support: number;
}

function classMetrics(pairs: { gold: string; pred: string | null }[]): { per_class: Record<string, ClassStats>; macro_f1: number | null } {
	const per_class: Record<string, ClassStats> = {};
	const f1s: number[] = [];
	for (const c of CLASSES) {
		const support = pairs.filter((p) => p.gold === c).length;
		const predicted = pairs.filter((p) => p.pred === c).length;
		const tp = pairs.filter((p) => p.gold === c && p.pred === c).length;
		const precision = predicted > 0 ? tp / predicted : null;
		const recall = support > 0 ? tp / support : null;
		per_class[c] = { precision, recall, support };
		if (support > 0) {
			const p = precision ?? 0;
			const r = recall ?? 0;
			f1s.push(p + r > 0 ? (2 * p * r) / (p + r) : 0);
		}
	}
	return { per_class, macro_f1: f1s.length > 0 ? f1s.reduce((a, b) => a + b, 0) / f1s.length : null };
}

function stateFor(row: CorpusRow, all: CorpusRow[]): unknown {
	const created = row.created_at;
	const earlier =
		created === null
			? []
			: all
					.filter((r) => r.repository === row.repository && r.pr === row.pr && r.id !== row.id && r.created_at !== null && r.created_at < created)
					.sort((a, b) => ((a.created_at as string) < (b.created_at as string) ? -1 : 1))
					.slice(-EARLIER_LIMIT)
					.map((r) => r.body);
	return { target: { kind: row.kind, author: row.author, body: row.body }, discussion: row.discussion, path: row.path, line: row.line, earlier };
}

export function buildReport(cases: Case[], meta: { date: string; corpus_sha256: string; total: number; labelled: number; profile: string | null; provider_kind: string | null }) {
	const decided = cases.filter((c): c is Extract<Case, { envelope: Envelope }> => "envelope" in c);
	const unavailable: Partial<Record<UnavailableReason, number>> = {};
	for (const c of cases) if ("unavailable" in c) unavailable[c.unavailable] = (unavailable[c.unavailable] ?? 0) + 1;
	const correct = decided.filter((c) => c.envelope.choice === c.gold).length;
	const n = cases.length;

	const brier = decided.length === 0 ? null : decided.reduce((sum, c) => sum + CLASSES.reduce((s, k) => s + ((c.envelope.probabilities[k] ?? 0) - (k === c.gold ? 1 : 0)) ** 2, 0), 0) / decided.length;

	let ece: number | null = null;
	if (decided.length > 0) {
		ece = 0;
		for (let b = 0; b < 10; b++) {
			const inBin = decided.filter((c) => Math.min(9, Math.floor(c.envelope.confidence * 10)) === b);
			if (inBin.length === 0) continue;
			const acc = inBin.filter((c) => c.envelope.choice === c.gold).length / inBin.length;
			const conf = inBin.reduce((s, c) => s + c.envelope.confidence, 0) / inBin.length;
			ece += (Math.abs(acc - conf) * inBin.length) / decided.length;
		}
	}

	const coverage_at = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95].map((pct) => {
		const threshold = pct / 100;
		const kept = decided.filter((c) => c.envelope.confidence >= threshold);
		return { confidence: threshold, coverage: n > 0 ? kept.length / n : 0, accuracy: kept.length > 0 ? kept.filter((c) => c.envelope.choice === c.gold).length / kept.length : null };
	});

	const model = classMetrics(cases.map((c) => ({ gold: c.gold, pred: "envelope" in c ? c.envelope.choice : null })));
	const baseline = classMetrics(cases.map((c) => ({ gold: c.gold, pred: "blocking" })));

	return {
		contract: REPORT_CONTRACT,
		application_point: POINT.id,
		date: meta.date,
		corpus_sha256: meta.corpus_sha256,
		profile: meta.profile,
		provider_kind: meta.provider_kind,
		model: decided[0]?.envelope.model ?? null,
		threshold_set_version: POINT.threshold_set.version,
		counts: { total: meta.total, labelled: meta.labelled, unlabeled: meta.total - meta.labelled, decided: decided.length, unavailable },
		metrics: {
			accuracy: n > 0 ? correct / n : null,
			decided_accuracy: decided.length > 0 ? correct / decided.length : null,
			macro_f1: model.macro_f1,
			per_class: model.per_class,
			brier,
			ece,
			coverage_at,
		},
		baseline: { name: "all_blocking", accuracy: n > 0 ? cases.filter((c) => c.gold === "blocking").length / n : null, macro_f1: baseline.macro_f1 },
		cases,
	};
}

const fmt = (value: number | null) => (value === null ? "n/a" : value.toFixed(3));

export function renderMarkdown(report: ReturnType<typeof buildReport>): string {
	const lines = [
		`# A14 PR comment triage eval — ${report.date}`,
		"",
		`- Profile: ${report.profile ?? "n/a"} (provider kind ${report.provider_kind ?? "n/a"}, model ${report.model ?? "n/a"})`,
		`- Threshold set: ${report.threshold_set_version}`,
		`- Corpus: ${report.corpus_sha256}`,
		`- Cases: ${report.counts.labelled} labelled of ${report.counts.total}; ${report.counts.decided} decided; unavailable ${JSON.stringify(report.counts.unavailable)}`,
		"",
		"| | Accuracy | Macro F1 |",
		"|---|---|---|",
		`| Model | ${fmt(report.metrics.accuracy)} | ${fmt(report.metrics.macro_f1)} |`,
		`| Baseline (all_blocking) | ${fmt(report.baseline.accuracy)} | ${fmt(report.baseline.macro_f1)} |`,
		"",
		`Decided accuracy ${fmt(report.metrics.decided_accuracy)}; Brier ${fmt(report.metrics.brier)}; ECE ${fmt(report.metrics.ece)}.`,
		"",
		"## Cases",
		"",
	];
	for (const c of report.cases) {
		if ("envelope" in c) {
			const e = c.envelope;
			const probs = e.option_set.map((o) => `${o}=${(e.probabilities[o] ?? 0).toFixed(3)}`).join(", ");
			lines.push(`- \`${c.id}\` gold ${c.gold}, choice ${e.choice} (${probs}); model ${e.model}, model version ${e.model_version ?? "null"}, threshold set ${e.threshold_set_version}, truncation ${e.truncation}`);
		} else {
			lines.push(`- \`${c.id}\` gold ${c.gold}, unavailable: ${c.unavailable}`);
		}
	}
	return `${lines.join("\n")}\n`;
}

function parseArgs(argv: string[]): { corpus: string; out: string; root: string; date: string } {
	let corpus: string | null = null;
	let out: string | null = null;
	let root = process.cwd();
	let date = new Date().toISOString().slice(0, 10);
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const value = argv[i + 1];
		if (value === undefined) throw new CliError(`missing value for ${arg}`);
		if (arg === "--corpus") corpus = value;
		else if (arg === "--out") out = value;
		else if (arg === "--root") root = value;
		else if (arg === "--date") {
			if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new CliError("--date must be YYYY-MM-DD");
			date = value;
		} else throw new CliError(`unknown argument: ${arg}`);
		i++;
	}
	if (corpus === null || out === null) throw new CliError("usage: run.ts --corpus <path> --out <dir> [--root <dir>] [--date YYYY-MM-DD]");
	return { corpus, out, root, date };
}

export async function main(argv: string[]): Promise<number> {
	try {
		const { corpus, out, root, date } = parseArgs(argv);
		const bytes = readFileSync(corpus);
		const rows = parseCorpus(bytes.toString("utf8"));
		rows.forEach((r, i) => {
			if (!isGoldLabel(r.gold)) throw new CliError(`corpus_invalid: ${i + 1}`);
		});
		const labelled = rows.filter((r) => r.gold !== "unlabeled");
		if (labelled.length === 0) throw new CliError("no_labelled_cases");

		const deps = { root, env: process.env, fetch: globalThis.fetch.bind(globalThis) };
		const resolved = resolveProfile(POINT.id, deps);
		const cases: Case[] = [];
		let firstDetail: string | null = null;
		for (const row of labelled) {
			const result = await decide({ point: POINT.id, state: stateFor(row, rows), trace_id: row.id }, deps);
			if (result.status === "decided") cases.push({ id: row.id, gold: row.gold, envelope: result.envelope });
			else {
				cases.push({ id: row.id, gold: row.gold, unavailable: result.reason });
				firstDetail ??= `${result.reason}: ${result.detail}`;
			}
		}

		const report = buildReport(cases, {
			date,
			corpus_sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
			total: rows.length,
			labelled: labelled.length,
			profile: resolved.ok ? resolved.value.profile_name : null,
			provider_kind: resolved.ok ? resolved.value.profile.kind : null,
		});
		mkdirSync(out, { recursive: true });
		const jsonPath = join(out, `a14-${date}.json`);
		writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
		writeFileSync(join(out, `a14-${date}.md`), renderMarkdown(report));
		if (firstDetail !== null) console.error(`first unavailable case: ${firstDetail}`);
		if (report.counts.decided === 0) {
			console.error("no_cases_decided");
			return 2;
		}
		console.log(`report written: ${jsonPath} (${report.counts.decided}/${labelled.length} decided)`);
		return 0;
	} catch (error) {
		if (error instanceof CliError) {
			console.error(error.message);
			return 1;
		}
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			console.error(`file not found: ${error.message}`);
			return 1;
		}
		throw error;
	}
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
