// A4 finding equivalence offline eval (decision-models S5; BR-DEC-4, BR-DEC-6).
// Calls decide() once per labelled corpus row and writes a dated JSON and
// Markdown report that compares the model with the `same_acceptance` baseline
// (today's repeat trigger: a finding on an acceptance that an earlier finding of
// the run already named is the same invariant, any other finding is new). Corpus
// handling, metrics, calibration and report writing live in the shared harness
// (../harness.ts); this module adds the per-task `first_correct_grouping_round`
// beside `repeat_trigger_round`, the round at which the S2 repeat trigger
// (acceptanceRepeatSeries current_streak >= 2) would fire. scripts/decision-eval may not import
// plugins/immune-brain/runtime (tests/decision-model.test.ts isolation contract), so
// `repeatTriggerRound` restates that streak rule locally; tests/decision-eval-a4.test.ts pins
// it to acceptanceRepeatSeries.
//
// Finding is a sensitive input category: with no `egress` entry for the profile's
// provider kind every case is unavailable with `egress_denied` and nothing leaves
// the machine.
//
// Usage: bun scripts/decision-eval/a4/run.ts --corpus <path> --out <dir> [--root <dir>] [--date YYYY-MM-DD]
//
// Exit codes: 0 report written; 1 no_labelled_cases / corpus_invalid / usage;
// 2 no_cases_decided (checked after the report is written).

import { readFileSync, writeFileSync } from "node:fs";
import { decide, resolveProfile } from "../../decision-model/decide.ts";
import { A4_FINDING_EQUIVALENCE } from "../../decision-model/thresholds.ts";
import { CliError, renderMarkdown, runEval } from "../harness.ts";
import { type CorpusRow, type EarlierFinding, isCorpusRow } from "./extract.ts";

export { REPORT_CONTRACT } from "../harness.ts";
const POINT = A4_FINDING_EQUIVALENCE;

/** The same_acceptance rule: the target's acceptance already has an earlier finding in the run. */
export function sameAcceptanceOption(row: CorpusRow): "same_invariant" | "new_defect" {
	return row.acceptance_id !== null && row.earlier.some((e) => e.acceptance_id === row.acceptance_id) ? "same_invariant" : "new_defect";
}

function stateFor(row: CorpusRow): unknown {
	return {
		target: { acceptance_id: row.acceptance_id, round: row.round, summary: row.summary },
		earlier: row.earlier.map((e) => ({ acceptance_id: e.acceptance_id, round: e.round, summary: e.summary })),
	};
}

export interface TaskRow {
	run: string;
	task_id: string;
	latest_round: number;
	/** First round whose repeat series has a non-null acceptance with current_streak >= 2; null when none. */
	repeat_trigger_round: number | null;
	/** First round of a finding the model correctly grouped as same_invariant; null when none. */
	first_correct_grouping_round: number | null;
	/** repeat_trigger_round - first_correct_grouping_round when both exist, else null. */
	rounds_saved: number | null;
}

/** First round r at which a non-null acceptance has findings in rounds r-1 and r, i.e. acceptanceRepeatSeries(findings up to r, r) gives it current_streak >= 2. */
export function repeatTriggerRound(findings: readonly { acceptance_id: string | null; round: number }[]): number | null {
	const rounds = new Map<string, Set<number>>();
	for (const f of findings) if (f.acceptance_id !== null) rounds.set(f.acceptance_id, (rounds.get(f.acceptance_id) ?? new Set()).add(f.round));
	const latest = Math.max(0, ...findings.map((f) => f.round));
	for (let round = 2; round <= latest; round++) if ([...rounds.values()].some((r) => r.has(round) && r.has(round - 1))) return round;
	return null;
}

export function perTask(rows: CorpusRow[], choices: ReadonlyMap<string, string>): TaskRow[] {
	const byRun = new Map<string, CorpusRow[]>();
	for (const row of rows) byRun.set(row.run, [...(byRun.get(row.run) ?? []), row]);
	return [...byRun].map(([run, runRows]) => {
		const findings = new Map<string, EarlierFinding>();
		for (const row of runRows) {
			findings.set(row.finding_id, { id: row.finding_id, acceptance_id: row.acceptance_id, round: row.round, summary: row.summary });
			for (const e of row.earlier) findings.set(e.id, e);
		}
		const all = [...findings.values()];
		const latest = Math.max(...all.map((f) => f.round));
		const trigger = repeatTriggerRound(all);
		const grouped = runRows.filter((r) => r.gold === "same_invariant" && choices.get(r.id) === "same_invariant").map((r) => r.round);
		const first = grouped.length > 0 ? Math.min(...grouped) : null;
		return {
			run,
			task_id: runRows[0]!.task_id,
			latest_round: latest,
			repeat_trigger_round: trigger,
			first_correct_grouping_round: first,
			rounds_saved: trigger !== null && first !== null ? trigger - first : null,
		};
	});
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

const cell = (value: number | null) => (value === null ? "n/a" : String(value));

export async function main(argv: string[]): Promise<number> {
	try {
		const { corpus, out, root, date } = parseArgs(argv);
		const corpusBytes = readFileSync(corpus);
		const deps = { root, env: process.env, fetch: globalThis.fetch.bind(globalThis) };
		const resolved = resolveProfile(POINT.id, deps);
		const options = new Map<string, string>();
		const { report, jsonPath, mdPath, firstDetail } = await runEval<CorpusRow>({
			point: POINT,
			prefix: "a4",
			title: "A4 finding equivalence eval",
			baseline: { name: "same_acceptance", option: "new_defect", predict: (id) => options.get(id) },
			corpusBytes,
			out,
			date,
			profile: resolved.ok ? resolved.value.profile_name : null,
			provider_kind: resolved.ok ? resolved.value.profile.kind : null,
			isRow: isCorpusRow,
			decideRow: (row, rows) => {
				if (options.size === 0) for (const r of rows) options.set(r.id, sameAcceptanceOption(r));
				return decide({ point: POINT.id, state: stateFor(row), trace_id: row.id }, deps);
			},
		});

		const rows = parseCorpusRows(corpusBytes);
		const choices = new Map<string, string>();
		for (const c of report.cases) if ("envelope" in c) choices.set(c.id, c.envelope.choice);
		const per_task = perTask(rows, choices);
		writeFileSync(jsonPath, `${JSON.stringify({ ...report, per_task }, null, 2)}\n`);
		const lines = ["", "## Per task", "", "| Run | Latest round | repeat_trigger_round | first_correct_grouping_round | Rounds saved |", "|---|---|---|---|---|"];
		for (const t of per_task) lines.push(`| \`${t.run}\` | ${t.latest_round} | ${cell(t.repeat_trigger_round)} | ${cell(t.first_correct_grouping_round)} | ${cell(t.rounds_saved)} |`);
		writeFileSync(mdPath, `${renderMarkdown(report, "A4 finding equivalence eval").trimEnd()}\n${lines.join("\n")}\n`);

		if (firstDetail !== null) console.error(`first unavailable case: ${firstDetail}`);
		if (report.counts.decided === 0) {
			console.error("no_cases_decided");
			return 2;
		}
		console.log(`report written: ${jsonPath} (${report.counts.decided}/${report.counts.labelled} decided)`);
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

function parseCorpusRows(bytes: Buffer): CorpusRow[] {
	return bytes
		.toString("utf8")
		.split("\n")
		.filter((l) => l.trim() !== "")
		.map((l) => JSON.parse(l) as CorpusRow);
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
