// A14 corpus extractor (Spec D7). Reads saved `imm-pr-diag <PR>` JSON files and
// writes one JSONL corpus row per review thread, non-empty PR comment and
// non-empty review body. It never calls `gh` or the network.
//
// Usage: bun scripts/decision-eval/a14/extract.ts --diag <file>... --corpus <path>
//
// Re-extraction into an existing corpus keeps every existing row's labels by id,
// keeps rows absent from the new diags, adds new rows unlabeled and writes rows
// sorted by id. An invalid existing label stops the run before anything is written.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CliError, parseJsonl } from "../harness.ts";

export { CliError };

export const GOLD_LABELS = ["unlabeled", "blocking", "nit", "out_of_scope", "duplicate"] as const;
export type GoldLabel = (typeof GOLD_LABELS)[number];

export type ItemKind = "thread" | "comment" | "review";

export interface CorpusRow {
	id: string;
	repository: string;
	pr: number;
	kind: ItemKind;
	author: string | null;
	created_at: string | null;
	body: string;
	discussion: string[];
	path: string | null;
	line: number | null;
	resolved: boolean | null;
	outdated: boolean | null;
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

export const isCorpusRow =(value: unknown): value is CorpusRow => isObject(value) && typeof value.id === "string" && typeof value.repository === "string" && typeof value.pr === "number";

/** Parse a JSONL corpus. Throws `corpus_invalid: <line>` on a malformed line. */
export function parseCorpus(text: string): { row: CorpusRow; lineNumber: number }[] {
	return parseJsonl(text, isCorpusRow);
}

function row(repository: string, pr: number, kind: ItemKind, itemId: string, fields: Omit<CorpusRow, "id" | "repository" | "pr" | "kind" | "gold" | "labeler" | "labelled_at">): CorpusRow {
	return { id: `${repository}#${pr}/${kind}/${itemId}`, repository, pr, kind, ...fields, gold: "unlabeled", labeler: null, labelled_at: null };
}

/** Rows for one `imm-pr-diag` output. Throws `diag_invalid: <file>` on a missing PR target. */
export function rowsFromDiag(diag: unknown, file: string): CorpusRow[] {
	if (!isObject(diag) || !isObject(diag.pr_target)) throw new CliError(`diag_invalid: ${file}`);
	const repository = str(diag.pr_target.repository);
	const pr = diag.pr_target.number;
	if (repository === null || typeof pr !== "number") throw new CliError(`diag_invalid: ${file}`);
	const rows: CorpusRow[] = [];

	for (const thread of asArray(diag.review_threads)) {
		if (!isObject(thread) || str(thread.id) === null) continue;
		const comments = asArray(thread.comments).filter(isObject);
		const first = comments[0];
		const author = first && isObject(first.author) ? str(first.author.login) : null;
		rows.push(
			row(repository, pr, "thread", thread.id as string, {
				author,
				created_at: first ? str(first.createdAt) : null,
				body: (first ? str(first.body) : null) ?? str(thread.body) ?? "",
				discussion: comments.slice(1).map((c) => str(c.body) ?? ""),
				path: str(thread.path),
				line: typeof thread.line === "number" ? thread.line : null,
				resolved: typeof thread.isResolved === "boolean" ? thread.isResolved : null,
				outdated: typeof thread.isOutdated === "boolean" ? thread.isOutdated : null,
			}),
		);
	}

	const flat = (kind: "comment" | "review", items: unknown, createdKey: string) => {
		for (const item of asArray(items)) {
			if (!isObject(item) || (typeof item.id !== "string" && typeof item.id !== "number")) continue;
			const body = str(item.body) ?? "";
			if (body.trim() === "") continue;
			rows.push(
				row(repository, pr, kind, String(item.id), {
					author: str(item.author),
					created_at: str(item[createdKey]),
					body,
					discussion: [],
					path: null,
					line: null,
					resolved: null,
					outdated: null,
				}),
			);
		}
	};
	flat("comment", diag.comments, "created_at");
	flat("review", diag.reviews, "submitted_at");
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

function parseArgs(argv: string[]): { diags: string[]; corpus: string } {
	const diags: string[] = [];
	let corpus: string | null = null;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--diag") {
			while (i + 1 < argv.length && !(argv[i + 1] as string).startsWith("--")) diags.push(argv[++i] as string);
		} else if (arg === "--corpus") {
			corpus = argv[++i] ?? null;
		} else {
			throw new CliError(`unknown argument: ${arg}`);
		}
	}
	if (diags.length === 0 || corpus === null) throw new CliError("usage: extract.ts --diag <file>... --corpus <path>");
	return { diags, corpus };
}

export function main(argv: string[]): number {
	try {
		const { diags, corpus } = parseArgs(argv);
		const existing = existsSync(corpus) ? parseCorpus(readFileSync(corpus, "utf8")).map(({ row }) => row) : [];
		const fresh: CorpusRow[] = [];
		for (const file of diags) {
			let diag: unknown;
			try {
				diag = JSON.parse(readFileSync(file, "utf8"));
			} catch {
				throw new CliError(`diag_invalid: ${file}`);
			}
			fresh.push(...rowsFromDiag(diag, file));
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
