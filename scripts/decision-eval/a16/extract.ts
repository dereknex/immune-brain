// A16 corpus extractor (decision-models S6). Reads saved `revisit --json` output
// (contract immune_brain/revisit_evidence/v2) and writes one JSONL corpus row per
// `user_resume` chain. Other candidate kinds are skipped. It reads no session
// file and never calls a model or the network.
//
// Usage: bun scripts/decision-eval/a16/extract.ts --evidence <file>... --corpus <path>
//
// Re-extraction into an existing corpus keeps every existing row's labels by id,
// keeps rows absent from the new evidence, adds new rows unlabeled and writes rows
// sorted by id. An invalid existing label stops the run before anything is written.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CliError, parseJsonl } from "../harness.ts";
import { A16_REVISIT_CHAIN_CLASS } from "../../../plugins/immune-brain/runtime/decision_model/thresholds.ts";

export { CliError };

export const EVIDENCE_CONTRACT = "immune_brain/revisit_evidence/v2";
export const GOLD_LABELS = ["unlabeled", ...A16_REVISIT_CHAIN_CLASS.options] as const;
export type GoldLabel = (typeof GOLD_LABELS)[number];

export interface CorpusRow {
	/** `<group key> <first pointer>`: the first pointer is unique per chain. */
	id: string;
	key: string;
	occurrences: number;
	pointers: string[];
	last_result: string | null;
	last_result_is_error: boolean | null;
	last_result_state: string | null;
	reply_chars: number | null;
	gold: GoldLabel;
	labeler: string | null;
	labelled_at: string | null;
}

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function isGoldLabel(value: unknown): value is GoldLabel {
	return typeof value === "string" && (GOLD_LABELS as readonly string[]).includes(value);
}

export const isCorpusRow = (value: unknown): value is CorpusRow =>
	isObject(value) && typeof value.id === "string" && typeof value.key === "string" && Array.isArray(value.pointers);

/** Parse a JSONL corpus. Throws `corpus_invalid: <line>` on a malformed line. */
export function parseCorpus(text: string): { row: CorpusRow; lineNumber: number }[] {
	return parseJsonl(text, isCorpusRow);
}

/** Rows for one `revisit --json` output. Throws `contract_unsupported: <contract>` or `evidence_invalid: <file>`. */
export function rowsFromEvidence(evidence: unknown, file: string): CorpusRow[] {
	if (!isObject(evidence)) throw new CliError(`evidence_invalid: ${file}`);
	if (evidence.contract !== EVIDENCE_CONTRACT) throw new CliError(`contract_unsupported: ${String(evidence.contract)} (${file}; expected ${EVIDENCE_CONTRACT})`);
	const rows: CorpusRow[] = [];
	for (const group of asArray(evidence.candidates)) {
		if (!isObject(group) || group.kind !== "user_resume" || str(group.key) === null) continue;
		const chains = asArray(group.chains).filter(isObject);
		for (const chain of chains) {
			const pointers = asArray(chain.pointers).filter((p): p is string => typeof p === "string");
			if (pointers.length === 0) continue;
			rows.push({
				id: `${group.key as string} ${pointers[0] as string}`,
				key: group.key as string,
				occurrences: chains.length,
				pointers,
				last_result: str(chain.last_result),
				last_result_is_error: typeof chain.last_result_is_error === "boolean" ? chain.last_result_is_error : null,
				last_result_state: str(chain.last_result_state),
				reply_chars: typeof chain.reply_chars === "number" ? chain.reply_chars : null,
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

function parseArgs(argv: string[]): { files: string[]; corpus: string } {
	const files: string[] = [];
	let corpus: string | null = null;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--evidence") {
			while (i + 1 < argv.length && !(argv[i + 1] as string).startsWith("--")) files.push(argv[++i] as string);
		} else if (arg === "--corpus") {
			corpus = argv[++i] ?? null;
		} else {
			throw new CliError(`unknown argument: ${arg}`);
		}
	}
	if (files.length === 0 || corpus === null) throw new CliError("usage: extract.ts --evidence <file>... --corpus <path>");
	return { files, corpus };
}

export function main(argv: string[]): number {
	try {
		const { files, corpus } = parseArgs(argv);
		const existing = existsSync(corpus) ? parseCorpus(readFileSync(corpus, "utf8")).map(({ row }) => row) : [];
		const fresh: CorpusRow[] = [];
		for (const file of files) {
			let evidence: unknown;
			try {
				evidence = JSON.parse(readFileSync(file, "utf8"));
			} catch {
				throw new CliError(`evidence_invalid: ${file}`);
			}
			fresh.push(...rowsFromEvidence(evidence, file));
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
