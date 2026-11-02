// A16 revisit chain class offline eval (decision-models S6; BR-DEC-6). Calls
// decide() once per labelled `user_resume` chain row and writes a dated JSON and
// Markdown report that compares the model with the `majority_class` baseline
// (always `necessary_decision`, the most common class in the #336 sample).
// Corpus handling, metrics, calibration and report writing live in the shared
// harness (../harness.ts). Unlabeled rows are never decided or counted.
//
// Usage: bun scripts/decision-eval/a16/run.ts --corpus <path> --out <dir> [--root <dir>] [--date YYYY-MM-DD]
//
// Exit codes: 0 report written; 1 no_labelled_cases / corpus_invalid / usage;
// 2 no_cases_decided (checked after the report is written).

import { readFileSync } from "node:fs";
import { decide, resolveProfile } from "../../decision-model/decide.ts";
import { A16_REVISIT_CHAIN_CLASS } from "../../decision-model/thresholds.ts";
import { CliError, runEval } from "../harness.ts";
import { type CorpusRow, isCorpusRow } from "./extract.ts";

export { REPORT_CONTRACT } from "../harness.ts";
const POINT = A16_REVISIT_CHAIN_CLASS;

function stateFor(row: CorpusRow): unknown {
	return {
		chain: {
			key: row.key,
			occurrences: row.occurrences,
			pointers: row.pointers,
			last_result: row.last_result,
			last_result_is_error: row.last_result_is_error,
			last_result_state: row.last_result_state,
			reply_chars: row.reply_chars,
		},
	};
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
		const deps = { root, env: process.env, fetch: globalThis.fetch.bind(globalThis) };
		const resolved = resolveProfile(POINT.id, deps);
		const { report, jsonPath, firstDetail } = await runEval<CorpusRow>({
			point: POINT,
			prefix: "a16",
			title: "A16 revisit chain class eval",
			baseline: { name: "majority_class", option: "necessary_decision" },
			corpusBytes,
			out,
			date,
			profile: resolved.ok ? resolved.value.profile_name : null,
			provider_kind: resolved.ok ? resolved.value.profile.kind : null,
			isRow: isCorpusRow,
			decideRow: (row) => decide({ point: POINT.id, state: stateFor(row), trace_id: row.id }, deps),
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
