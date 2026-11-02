// A15 corpus extractor (BR-DEC-6). Reads a saved
//   gh issue list --state all --json number,title,body,labels,state,stateReason
// output and writes one JSONL corpus row per issue, pre-filling `gold` from the
// repository's own labels. It never calls `gh` or the network.
//
// Usage: bun scripts/decision-eval/a15/extract.ts --issues <file>... --repository <owner/name> --corpus <path>
//
// Pre-fill: label `ready-for-agent` -> ready_for_agent, `needs-spec` -> needs_spec,
// stateReason DUPLICATE -> duplicate, labeler `repo-labels`. No signal, or signals
// that disagree, leave the row unlabeled. Re-extraction keeps rows absent from the
// new listing, refreshes the issue fields of the rows it sees, and keeps a gold label
// a human set or changed; only a still-machine label (or an unlabeled row) is
// recomputed. An invalid existing label stops the run before anything is written.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { A15_ISSUE_TRIAGE } from "../../../plugins/immune-brain/runtime/decision_model/thresholds.ts";
import { CliError, goldLabelsFor, parseJsonl, UNLABELED } from "../harness.ts";

export { CliError };

export const LABELER = "repo-labels";
export const GOLD_LABELS = goldLabelsFor(A15_ISSUE_TRIAGE);

const LABEL_GOLD: Readonly<Record<string, string>> = { "ready-for-agent": "ready_for_agent", "needs-spec": "needs_spec" };

export interface CorpusRow {
	id: string;
	repository: string;
	number: number;
	title: string;
	body: string;
	labels: string[];
	state: string | null;
	state_reason: string | null;
	gold: string;
	labeler: string | null;
	labelled_at: string | null;
}

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

export function isGoldLabel(value: unknown): value is string {
	return typeof value === "string" && GOLD_LABELS.includes(value);
}

export const isCorpusRow = (value: unknown): value is CorpusRow =>
	isObject(value) && typeof value.id === "string" && typeof value.repository === "string" && typeof value.number === "number" && typeof value.gold === "string";

/** Parse a JSONL corpus. Throws `corpus_invalid: <line>` on a malformed line. */
export function parseCorpus(text: string): { row: CorpusRow; lineNumber: number }[] {
	return parseJsonl(text, isCorpusRow);
}

/** The gold label the repository's own signals imply, or `unlabeled` when there is none or they disagree. */
export function prefillGold(row: Pick<CorpusRow, "labels" | "state_reason">): string {
	const signals = new Set<string>();
	for (const label of row.labels) {
		const gold = LABEL_GOLD[label];
		if (gold !== undefined) signals.add(gold);
	}
	if (row.state_reason?.toUpperCase() === "DUPLICATE") signals.add("duplicate");
	return signals.size === 1 ? ([...signals][0] as string) : UNLABELED;
}

/** Rows for one saved `gh issue list --json` output. Throws `issues_invalid: <file>` when it is not a list of issues. */
export function rowsFromIssues(listing: unknown, repository: string, file: string, now: string): CorpusRow[] {
	if (!Array.isArray(listing)) throw new CliError(`issues_invalid: ${file}`);
	const rows: CorpusRow[] = [];
	for (const issue of listing) {
		if (!isObject(issue) || typeof issue.number !== "number") throw new CliError(`issues_invalid: ${file}`);
		const labels = (Array.isArray(issue.labels) ? issue.labels : []).map((l) => (isObject(l) ? str(l.name) : str(l))).filter((l): l is string => l !== null);
		const partial = { labels, state_reason: str(issue.stateReason) };
		const gold = prefillGold(partial);
		rows.push({
			id: `${repository}#${issue.number}`,
			repository,
			number: issue.number,
			title: str(issue.title) ?? "",
			body: str(issue.body) ?? "",
			labels,
			state: str(issue.state),
			state_reason: partial.state_reason,
			gold,
			labeler: gold === UNLABELED ? null : LABELER,
			labelled_at: gold === UNLABELED ? null : now,
		});
	}
	return rows;
}

/** A label is the human's when it is not what the repository signals of the stored row would produce. */
function humanLabelled(old: CorpusRow): boolean {
	if (old.gold === UNLABELED) return old.labeler !== null;
	return old.labeler !== LABELER || old.gold !== prefillGold(old);
}

/** Merge fresh rows into an existing corpus. */
export function mergeCorpus(existing: CorpusRow[], fresh: CorpusRow[]): CorpusRow[] {
	for (const old of existing) if (!isGoldLabel(old.gold)) throw new CliError(`invalid_gold_label: ${old.id}`);
	const byId = new Map<string, CorpusRow>();
	for (const old of existing) byId.set(old.id, old);
	for (const next of fresh) {
		const old = byId.get(next.id);
		if (old === undefined) byId.set(next.id, next);
		else if (humanLabelled(old)) byId.set(next.id, { ...next, gold: old.gold, labeler: old.labeler, labelled_at: old.labelled_at });
		else byId.set(next.id, old.gold === next.gold ? { ...next, labelled_at: old.labelled_at } : next);
	}
	return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function serializeCorpus(rows: CorpusRow[]): string {
	return rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length > 0 ? "\n" : "");
}

function parseArgs(argv: string[]): { issues: string[]; repository: string; corpus: string } {
	const issues: string[] = [];
	let repository: string | null = null;
	let corpus: string | null = null;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--issues") {
			while (i + 1 < argv.length && !(argv[i + 1] as string).startsWith("--")) issues.push(argv[++i] as string);
		} else if (arg === "--repository") {
			repository = argv[++i] ?? null;
		} else if (arg === "--corpus") {
			corpus = argv[++i] ?? null;
		} else {
			throw new CliError(`unknown argument: ${arg}`);
		}
	}
	if (issues.length === 0 || repository === null || corpus === null) throw new CliError("usage: extract.ts --issues <file>... --repository <owner/name> --corpus <path>");
	return { issues, repository, corpus };
}

export function main(argv: string[], now: () => Date = () => new Date()): number {
	try {
		const { issues, repository, corpus } = parseArgs(argv);
		const existing = existsSync(corpus) ? parseCorpus(readFileSync(corpus, "utf8")).map(({ row }) => row) : [];
		const fresh: CorpusRow[] = [];
		for (const file of issues) {
			let listing: unknown;
			try {
				listing = JSON.parse(readFileSync(file, "utf8"));
			} catch {
				throw new CliError(`issues_invalid: ${file}`);
			}
			fresh.push(...rowsFromIssues(listing, repository, file, now().toISOString()));
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
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			console.error(`file not found: ${error.message}`);
			return 1;
		}
		throw error;
	}
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
