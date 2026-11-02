// Shared offline decision-eval harness (decision-models S4). Every eval owns its
// corpus row shape and its decide() call; this module owns everything else:
// JSONL parsing with physical line numbers, gold label validation against an
// application point's label set, accuracy / per-option precision and recall /
// macro F1, calibration, the constant-option baseline comparison and the dated
// JSON and Markdown report files.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ApplicationPoint, Envelope, UnavailableReason } from "../decision-model/contract.ts";

export const REPORT_CONTRACT = "immune_brain/decision_eval_report/v1";
export const UNLABELED = "unlabeled";

export class CliError extends Error {
	constructor(message: string) {
		super(message);
	}
}

export interface CorpusRowBase {
	id: string;
	gold: string;
}

export type Case = { id: string; gold: string; envelope: Envelope } | { id: string; gold: string; unavailable: UnavailableReason };

/** The shape of `decide()`'s result that the harness consumes. */
export type DecideOutcome = { status: "decided"; envelope: Envelope } | { status: "unavailable"; reason: UnavailableReason; detail: string };

/** Gold labels a corpus may carry for a point: its options plus `unlabeled`. */
export function goldLabelsFor(point: Pick<ApplicationPoint, "options">): string[] {
	return [UNLABELED, ...point.options];
}

/** Parse JSONL. Throws `corpus_invalid: <line>` (physical, 1-based) on a malformed line. */
export function parseJsonl<T>(text: string, isRow: (value: unknown) => value is T): { row: T; lineNumber: number }[] {
	const rows: { row: T; lineNumber: number }[] = [];
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] as string;
		if (line.trim() === "") continue;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			throw new CliError(`corpus_invalid: ${i + 1}`);
		}
		if (!isRow(value)) throw new CliError(`corpus_invalid: ${i + 1}`);
		rows.push({ row: value, lineNumber: i + 1 });
	}
	return rows;
}

/** Parse a corpus and validate every gold label against `labels`. Throws `corpus_invalid: <line>`. */
export function loadCorpus<T extends CorpusRowBase>(text: string, labels: readonly string[], isRow: (value: unknown) => value is T): T[] {
	return parseJsonl(text, isRow).map(({ row, lineNumber }) => {
		if (typeof row.gold !== "string" || !labels.includes(row.gold)) throw new CliError(`corpus_invalid: ${lineNumber}`);
		return row;
	});
}

interface OptionStats {
	precision: number | null;
	recall: number | null;
	support: number;
}

export function optionMetrics(options: readonly string[], pairs: { gold: string; pred: string | null }[]): { per_class: Record<string, OptionStats>; macro_f1: number | null } {
	const per_class: Record<string, OptionStats> = {};
	const f1s: number[] = [];
	for (const option of options) {
		const support = pairs.filter((p) => p.gold === option).length;
		const predicted = pairs.filter((p) => p.pred === option).length;
		const tp = pairs.filter((p) => p.gold === option && p.pred === option).length;
		const precision = predicted > 0 ? tp / predicted : null;
		const recall = support > 0 ? tp / support : null;
		per_class[option] = { precision, recall, support };
		if (support > 0) {
			const p = precision ?? 0;
			const r = recall ?? 0;
			f1s.push(p + r > 0 ? (2 * p * r) / (p + r) : 0);
		}
	}
	return { per_class, macro_f1: f1s.length > 0 ? f1s.reduce((a, b) => a + b, 0) / f1s.length : null };
}

/** Multi-class Brier score averaged over cases with a decision; unavailable cases are excluded and counted. */
export function calibration(cases: Case[], options: readonly string[]): { brier: number | null; excluded: number } {
	const decided = cases.filter((c): c is Extract<Case, { envelope: Envelope }> => "envelope" in c);
	const brier = decided.length === 0 ? null : decided.reduce((sum, c) => sum + options.reduce((s, k) => s + ((c.envelope.probabilities[k] ?? 0) - (k === c.gold ? 1 : 0)) ** 2, 0), 0) / decided.length;
	return { brier, excluded: cases.length - decided.length };
}

export interface ReportMeta {
	date: string;
	corpus_sha256: string;
	total: number;
	labelled: number;
	profile: string | null;
	provider_kind: string | null;
}

/** The comparison baseline predicts one constant option for every case. */
export interface Baseline {
	name: string;
	option: string;
}

export function buildReport(point: ApplicationPoint, baselineSpec: Baseline, cases: Case[], meta: ReportMeta) {
	const options = point.options;
	const decided = cases.filter((c): c is Extract<Case, { envelope: Envelope }> => "envelope" in c);
	const unavailable: Partial<Record<UnavailableReason, number>> = {};
	for (const c of cases) if ("unavailable" in c) unavailable[c.unavailable] = (unavailable[c.unavailable] ?? 0) + 1;
	const correct = decided.filter((c) => c.envelope.choice === c.gold).length;
	const n = cases.length;

	const calib = calibration(cases, options);

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

	const model = optionMetrics(options, cases.map((c) => ({ gold: c.gold, pred: "envelope" in c ? c.envelope.choice : null })));
	const baseline = optionMetrics(options, cases.map((c) => ({ gold: c.gold, pred: baselineSpec.option })));

	return {
		contract: REPORT_CONTRACT,
		application_point: point.id,
		date: meta.date,
		corpus_sha256: meta.corpus_sha256,
		profile: meta.profile,
		provider_kind: meta.provider_kind,
		model: decided[0]?.envelope.model ?? null,
		threshold_set_version: point.threshold_set.version,
		counts: { total: meta.total, labelled: meta.labelled, unlabeled: meta.total - meta.labelled, decided: decided.length, unavailable },
		metrics: {
			accuracy: n > 0 ? correct / n : null,
			decided_accuracy: decided.length > 0 ? correct / decided.length : null,
			macro_f1: model.macro_f1,
			per_class: model.per_class,
			brier: calib.brier,
			ece,
			coverage_at,
		},
		calibration: calib,
		baseline: { name: baselineSpec.name, accuracy: n > 0 ? cases.filter((c) => c.gold === baselineSpec.option).length / n : null, macro_f1: baseline.macro_f1 },
		cases,
	};
}

export type Report = ReturnType<typeof buildReport>;

const fmt = (value: number | null) => (value === null ? "n/a" : value.toFixed(3));

export function renderMarkdown(report: Report, title: string): string {
	const lines = [
		`# ${title} — ${report.date}`,
		"",
		`- Profile: ${report.profile ?? "n/a"} (provider kind ${report.provider_kind ?? "n/a"}, model ${report.model ?? "n/a"})`,
		`- Threshold set: ${report.threshold_set_version}`,
		`- Corpus: ${report.corpus_sha256}`,
		`- Cases: ${report.counts.labelled} labelled of ${report.counts.total}; ${report.counts.decided} decided; unavailable ${JSON.stringify(report.counts.unavailable)}`,
		"",
		"| | Accuracy | Macro F1 |",
		"|---|---|---|",
		`| Model | ${fmt(report.metrics.accuracy)} | ${fmt(report.metrics.macro_f1)} |`,
		`| Baseline (${report.baseline.name}) | ${fmt(report.baseline.accuracy)} | ${fmt(report.baseline.macro_f1)} |`,
		"",
		`Decided accuracy ${fmt(report.metrics.decided_accuracy)}; Brier ${fmt(report.metrics.brier)}; ECE ${fmt(report.metrics.ece)}.`,
		`Calibration: Brier ${fmt(report.calibration.brier)} over ${report.counts.decided} decided cases; ${report.calibration.excluded} unavailable excluded.`,
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

export interface EvalSpec<R extends CorpusRowBase> {
	point: ApplicationPoint;
	/** Report file prefix: `<prefix>-<date>.json` / `.md`. */
	prefix: string;
	/** Markdown heading, without the date. */
	title: string;
	baseline: Baseline;
	corpusBytes: Buffer;
	out: string;
	date: string;
	profile: string | null;
	provider_kind: string | null;
	isRow: (value: unknown) => value is R;
	/** Called once per labelled row, in corpus order, with the whole corpus for context. */
	decideRow: (row: R, rows: R[]) => Promise<DecideOutcome>;
}

export interface EvalResult {
	report: Report;
	jsonPath: string;
	mdPath: string;
	/** `<reason>: <detail>` of the first unavailable case, if any. */
	firstDetail: string | null;
}

/**
 * Run one eval. Throws `corpus_invalid: <line>` or `no_labelled_cases` (CliError)
 * before any decision is made or any file is written.
 */
export async function runEval<R extends CorpusRowBase>(spec: EvalSpec<R>): Promise<EvalResult> {
	const rows = loadCorpus(spec.corpusBytes.toString("utf8"), goldLabelsFor(spec.point), spec.isRow);
	const labelled = rows.filter((r) => r.gold !== UNLABELED);
	if (labelled.length === 0) throw new CliError("no_labelled_cases");

	const cases: Case[] = [];
	let firstDetail: string | null = null;
	for (const row of labelled) {
		const result = await spec.decideRow(row, rows);
		if (result.status === "decided") cases.push({ id: row.id, gold: row.gold, envelope: result.envelope });
		else {
			cases.push({ id: row.id, gold: row.gold, unavailable: result.reason });
			firstDetail ??= `${result.reason}: ${result.detail}`;
		}
	}

	const report = buildReport(spec.point, spec.baseline, cases, {
		date: spec.date,
		corpus_sha256: `sha256:${createHash("sha256").update(spec.corpusBytes).digest("hex")}`,
		total: rows.length,
		labelled: labelled.length,
		profile: spec.profile,
		provider_kind: spec.provider_kind,
	});
	mkdirSync(spec.out, { recursive: true });
	const jsonPath = join(spec.out, `${spec.prefix}-${spec.date}.json`);
	const mdPath = join(spec.out, `${spec.prefix}-${spec.date}.md`);
	writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
	writeFileSync(mdPath, renderMarkdown(report, spec.title));
	return { report, jsonPath, mdPath, firstDetail };
}
