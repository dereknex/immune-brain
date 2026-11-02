// A15 issue triage offline eval (BR-DEC-6). Calls decide() once per labelled
// corpus row with the issue title and body and writes a dated JSON and Markdown
// report that compares the model with the `majority_class` baseline (always
// predict the most frequent gold label). The repository's labels and the issue's
// stateReason, which pre-fill gold, are never sent to the provider.
//
// Usage: bun scripts/decision-eval/a15/run.ts --corpus <path> --out <dir> [--root <dir>] [--date YYYY-MM-DD]
//
// Exit codes: 0 report written; 1 no_labelled_cases / corpus_invalid / usage;
// 2 no_cases_decided (checked after the report is written).

import { readFileSync } from "node:fs";
import { decide, resolveProfile } from "../../decision-model/decide.ts";
import { A15_ISSUE_TRIAGE } from "../../decision-model/thresholds.ts";
import { CliError, goldLabelsFor, loadCorpus, runEval, UNLABELED } from "../harness.ts";
import { type CorpusRow, isCorpusRow } from "./extract.ts";

export { REPORT_CONTRACT } from "../harness.ts";
const POINT = A15_ISSUE_TRIAGE;

/** The most frequent gold label among labelled rows; ties go to the earlier option. */
export function majorityClass(rows: { gold: string }[]): string {
	const counts = new Map<string, number>();
	for (const row of rows) if (row.gold !== UNLABELED) counts.set(row.gold, (counts.get(row.gold) ?? 0) + 1);
	let best = POINT.options[0] as string;
	for (const option of POINT.options) if ((counts.get(option) ?? 0) > (counts.get(best) ?? 0)) best = option;
	return best;
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
		const corpusBytes = readFileSync(corpus);
		const baselineOption = majorityClass(loadCorpus(corpusBytes.toString("utf8"), goldLabelsFor(POINT), isCorpusRow));
		const deps = { root, env: process.env, fetch: globalThis.fetch.bind(globalThis) };
		const resolved = resolveProfile(POINT.id, deps);
		const { report, jsonPath, firstDetail } = await runEval<CorpusRow>({
			point: POINT,
			prefix: "a15",
			title: "A15 issue triage eval",
			baseline: { name: "majority_class", option: baselineOption },
			corpusBytes,
			out,
			date,
			profile: resolved.ok ? resolved.value.profile_name : null,
			provider_kind: resolved.ok ? resolved.value.profile.kind : null,
			isRow: isCorpusRow,
			decideRow: (row) => decide({ point: POINT.id, state: { title: row.title, body: row.body }, trace_id: row.id }, deps),
		});
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

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
