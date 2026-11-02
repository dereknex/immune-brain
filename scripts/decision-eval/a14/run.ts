// A14 PR comment triage offline eval (Spec D8). Calls decide() once per
// labelled corpus row and writes a dated JSON and Markdown report that compares
// the model with the `all_blocking` baseline (today's `fix-pr`, which repairs
// every unresolved thread). Corpus handling, metrics, calibration and report
// writing live in the shared harness (../harness.ts).
//
// Usage: bun scripts/decision-eval/a14/run.ts --corpus <path> --out <dir> [--root <dir>] [--date YYYY-MM-DD]
//
// Exit codes: 0 report written; 1 no_labelled_cases / corpus_invalid / usage;
// 2 no_cases_decided (checked after the report is written).

import { readFileSync } from "node:fs";
import { decide, resolveProfile } from "../../../plugins/immune-brain/runtime/decision_model/decide.ts";
import { A14_PR_COMMENT_TRIAGE } from "../../../plugins/immune-brain/runtime/decision_model/thresholds.ts";
import { CliError, runEval } from "../harness.ts";
import { type CorpusRow, isCorpusRow } from "./extract.ts";

export { REPORT_CONTRACT } from "../harness.ts";
export const EARLIER_LIMIT = 20;
const POINT = A14_PR_COMMENT_TRIAGE;

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
			prefix: "a14",
			title: "A14 PR comment triage eval",
			baseline: { name: "all_blocking", option: "blocking" },
			corpusBytes,
			out,
			date,
			profile: resolved.ok ? resolved.value.profile_name : null,
			provider_kind: resolved.ok ? resolved.value.profile.kind : null,
			isRow: isCorpusRow,
			decideRow: (row, rows) => decide({ point: POINT.id, state: stateFor(row, rows), trace_id: row.id }, deps),
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
