/**
 * Loop Daemon: Deterministic Lexical Duplicate Issue Candidate Search (S10)
 *
 * Implements S10 / D12 item 4 of docs/specs/loop-daemon.spec.md:
 * Computes bounded, deterministic lexical similarity over open GitHub Issues
 * without calling any LLM/embedding API, returning the highest-scoring
 * candidate above `DUPLICATE_SIMILARITY_FLOOR` for `a20_issue_duplicate_pair`.
 */

import type { RawIssue } from "./types.ts";

export interface DuplicateCandidate {
	number: number;
	title: string;
	body: string;
	score: number;
}

export const DUPLICATE_SIMILARITY_FLOOR = 0.25;

const STOP_WORDS = new Set([
	"a",
	"an",
	"the",
	"and",
	"or",
	"but",
	"in",
	"on",
	"at",
	"to",
	"for",
	"of",
	"with",
	"by",
	"from",
	"is",
	"are",
	"was",
	"were",
	"be",
	"been",
	"this",
	"that",
	"it",
	"as",
	"not",
]);

function tokenize(text: string): string[] {
	const raw = text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
	return raw.filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function buildWeightedTermVector(title: string, body: string): Map<string, number> {
	const weights = new Map<string, number>();
	for (const token of tokenize(title)) {
		weights.set(token, (weights.get(token) ?? 0) + 2);
	}
	for (const token of tokenize(body)) {
		weights.set(token, (weights.get(token) ?? 0) + 1);
	}
	return weights;
}

export function lexicalIssueSimilarity(
	target: { title: string; body: string },
	candidate: { title: string; body: string },
): number {
	const a = buildWeightedTermVector(target.title, target.body);
	const b = buildWeightedTermVector(candidate.title, candidate.body);
	if (a.size === 0 || b.size === 0) return 0;

	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (const [term, weight] of a) {
		normA += weight * weight;
		const other = b.get(term);
		if (other !== undefined) {
			dot += weight * other;
		}
	}
	for (const weight of b.values()) {
		normB += weight * weight;
	}
	if (normA === 0 || normB === 0) return 0;
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Selects the best open Issue candidate above `floor` by lexical cosine similarity
 * over normalized title (weight 2) + body (weight 1) tokens.
 * Ties break deterministically by lowest Issue number.
 */
export function selectBestDuplicateCandidate(
	target: { number: number; title: string; body: string },
	openIssues: readonly RawIssue[],
	options: { floor?: number } = {},
): DuplicateCandidate | undefined {
	const floor = options.floor ?? DUPLICATE_SIMILARITY_FLOOR;
	let best: DuplicateCandidate | undefined;

	for (const issue of openIssues) {
		if (issue.state !== "open" || issue.number === target.number) {
			continue;
		}
		const body = issue.body ?? "";
		const score = lexicalIssueSimilarity(target, { title: issue.title, body });
		if (score < floor) {
			continue;
		}
		if (
			!best ||
			score > best.score ||
			(score === best.score && issue.number < best.number)
		) {
			best = {
				number: issue.number,
				title: issue.title,
				body,
				score: Number(score.toFixed(6)),
			};
		}
	}

	return best;
}
