// A4 corpus extractor (decision-models S5; BR-DEC-4, BR-DEC-6). Reads the audit
// pairs committed at HEAD of a project root through the revisit audit reader and
// writes one JSONL corpus row per review finding at round >= 2 of every run with
// at least MIN_REWORK_ROUNDS review rework rounds, carrying the run's earlier
// findings as context. It never opens the network.
//
// Usage: bun scripts/decision-eval/a4/extract.ts --corpus <path> [--root <project-root>]
//
// Re-extraction into an existing corpus keeps every existing row's labels by id,
// keeps rows absent from the new audit, adds new rows unlabeled and writes rows
// sorted by id. An invalid existing label stops the run before anything is written.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readCommittedAudit, AuditUsageError } from "../../../plugins/immune-brain/skills/revisit/scripts/audit_reader.ts";
import { A4_FINDING_EQUIVALENCE } from "../../decision-model/thresholds.ts";
import { CliError, goldLabelsFor, parseJsonl } from "../harness.ts";

export { CliError };

export const MIN_REWORK_ROUNDS = 5;
export const MIN_ROUND = 2;
export const GOLD_LABELS = goldLabelsFor(A4_FINDING_EQUIVALENCE);
export type GoldLabel = string;

export interface EarlierFinding {
	id: string;
	acceptance_id: string | null;
	round: number;
	summary: string;
}

export interface CorpusRow {
	id: string;
	run: string;
	task_id: string;
	finding_id: string;
	acceptance_id: string | null;
	round: number;
	summary: string;
	earlier: EarlierFinding[];
	gold: GoldLabel;
	labeler: string | null;
	labelled_at: string | null;
}

export const isCorpusRow = (value: unknown): value is CorpusRow =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as CorpusRow).id === "string" &&
	typeof (value as CorpusRow).run === "string" &&
	typeof (value as CorpusRow).round === "number" &&
	Array.isArray((value as CorpusRow).earlier);

export function isGoldLabel(value: unknown): value is GoldLabel {
	return typeof value === "string" && GOLD_LABELS.includes(value);
}

/** Parse a JSONL corpus. Throws `corpus_invalid: <line>` on a malformed line. */
export function parseCorpus(text: string): { row: CorpusRow; lineNumber: number }[] {
	return parseJsonl(text, isCorpusRow);
}

/** Rows of every committed run at HEAD of `root` with enough review rework rounds. */
export function rowsFromAudit(root: string): CorpusRow[] {
	const rows: CorpusRow[] = [];
	for (const run of readCommittedAudit(root).runs) {
		if (run.reviewRework < MIN_REWORK_ROUNDS) continue;
		const rounded = run.reviewFindings.flatMap((f) => (f.round === null ? [] : [{ f, round: f.round }]));
		for (const { f, round } of rounded) {
			if (round < MIN_ROUND) continue;
			const earlier = rounded
				.filter((e) => e.round < round)
				.map((e) => ({ id: e.f.id, acceptance_id: e.f.acceptanceKey, round: e.round, summary: e.f.summary }));
			rows.push({
				id: `${run.path}/${f.id}`,
				run: run.path,
				task_id: run.taskId,
				finding_id: f.id,
				acceptance_id: f.acceptanceKey,
				round,
				summary: f.summary,
				earlier,
				gold: "unlabeled",
				labeler: null,
				labelled_at: null,
			});
		}
	}
	return rows;
}

/** Merge fresh rows into an existing corpus, keeping labels by id. */
export function mergeCorpus(existing: CorpusRow[], fresh: CorpusRow[]): CorpusRow[] {
	for (const old of existing) if (!isGoldLabel(old.gold)) throw new CliError(`invalid_gold_label: ${old.id}`);
	const byId = new Map<string, CorpusRow>();
	for (const old of existing) byId.set(old.id, old);
	for (const next of fresh) {
		const old = byId.get(next.id);
		byId.set(next.id, old === undefined ? next : { ...next, gold: old.gold, labeler: old.labeler, labelled_at: old.labelled_at });
	}
	return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function serializeCorpus(rows: CorpusRow[]): string {
	return rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length > 0 ? "\n" : "");
}

function parseArgs(argv: string[]): { root: string; corpus: string } {
	let root = ".";
	let corpus: string | null = null;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const value = argv[i + 1];
		if (arg !== "--root" && arg !== "--corpus") throw new CliError(`unknown argument: ${arg}`);
		if (value === undefined) throw new CliError(`missing value for ${arg}`);
		if (arg === "--root") root = value;
		else corpus = value;
		i++;
	}
	if (corpus === null) throw new CliError("usage: extract.ts --corpus <path> [--root <project-root>]");
	return { root, corpus };
}

export function main(argv: string[]): number {
	try {
		const { root, corpus } = parseArgs(argv);
		const existing = existsSync(corpus) ? parseCorpus(readFileSync(corpus, "utf8")).map(({ row }) => row) : [];
		let fresh: CorpusRow[];
		try {
			fresh = rowsFromAudit(root);
		} catch (error) {
			if (error instanceof AuditUsageError) throw new CliError(error.message);
			throw error;
		}
		const merged = mergeCorpus(existing, fresh);
		writeFileSync(corpus, serializeCorpus(merged));
		const known = new Set(existing.map((r) => r.id));
		const added = merged.filter((r) => !known.has(r.id)).length;
		console.log(`extracted ${fresh.length} rows (${added} new, ${merged.length} total) -> ${corpus}`);
		return 0;
	} catch (error) {
		if (error instanceof CliError) {
			console.error(error.message);
			return 1;
		}
		throw error;
	}
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
