/**
 * Loop Daemon: Cached Read-Only Clarify Framing (S4, S7)
 *
 * Implements D8 of docs/specs/loop-agent-scheduling.spec.md: `clarify` replaces
 * the S4 analysis probe and returns either questions for the owner or the
 * framing planning receives (`scopes`, `seams`, `risks`, `acceptance`). The
 * framing probes read-only and is keyed by
 * `(issue_number, issue_body_digest, base_tree_sha, answers_digest)`, so an
 * unchanged Issue with the same owner answers reuses the framing at
 * `.imm/state/loop/analysis/<key>.json` instead of probing again. The cache is
 * rebuildable state: an unreadable or foreign entry is ignored and the probe
 * runs again.
 */

import { createHash } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureLoopStateDir } from "./state.ts";
import { LOOP_ANALYSIS_CONTRACT } from "./types.ts";

/** What the read-only probe may conclude. Paths are repository-relative. */
export interface CodebaseAnalysisFindings {
	/** D8 framing: areas the plan expects to touch. */
	scopes: string[];
	/** D8 framing: existing modules and seams the plan should extend. */
	seams: string[];
	/** D8 framing: what the plan risks getting wrong. */
	risks: string[];
	/** D8 framing: what the plan will have to prove. */
	acceptance: string[];
	/** Facts the plan must settle before it can enroll. */
	questions?: string[];
}

export interface CodebaseAnalysisProbeInput {
	issue_number: number;
	issue_body: string;
	base_tree_sha: string;
	/** The owner answers already given to this Issue's clarify question, in order. */
	answers?: readonly string[];
}

export type CodebaseAnalysisProbe = (input: CodebaseAnalysisProbeInput) => CodebaseAnalysisFindings;

export interface LoopAnalysisCacheEntry {
	contract: typeof LOOP_ANALYSIS_CONTRACT;
	cache_key: string;
	issue_number: number;
	issue_body_digest: string;
	base_tree_sha: string;
	findings: Required<CodebaseAnalysisFindings>;
	analyzed_at: string;
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

/** Stable cache key: the same Issue body, tree and answers always map to one entry. */
export function analysisCacheKey(input: CodebaseAnalysisProbeInput): string {
	const answers = (input.answers ?? []).join("\n");
	return digest(`${input.issue_number}\n${digest(input.issue_body)}\n${input.base_tree_sha}\n${digest(answers)}`);
}

function analysisPath(stateDir: string, cacheKey: string): string {
	return join(stateDir, "analysis", `${cacheKey}.json`);
}

export function readCachedAnalysis(stateDir: string, cacheKey: string): LoopAnalysisCacheEntry | null {
	try {
		const parsed = JSON.parse(readFileSync(analysisPath(stateDir, cacheKey), "utf8")) as LoopAnalysisCacheEntry;
		if (parsed && parsed.contract === LOOP_ANALYSIS_CONTRACT && parsed.cache_key === cacheKey) return parsed;
	} catch {}
	return null;
}

export interface AnalyzeCodebaseInput extends CodebaseAnalysisProbeInput {
	stateDir: string;
	probe: CodebaseAnalysisProbe;
	/** The instant a fresh entry records; defaults to now. */
	now?: string;
}

export interface AnalyzeCodebaseResult {
	entry: LoopAnalysisCacheEntry;
	cached: boolean;
}

/**
 * Return the cached findings for this Issue revision and tree, or probe once and
 * cache the result. `cached` is the caller's evidence that no probe ran.
 */
export function analyzeCodebase(input: AnalyzeCodebaseInput): AnalyzeCodebaseResult {
	const cacheKey = analysisCacheKey(input);
	const cached = readCachedAnalysis(input.stateDir, cacheKey);
	if (cached !== null) return { entry: cached, cached: true };

	const found = input.probe({
		issue_number: input.issue_number,
		issue_body: input.issue_body,
		base_tree_sha: input.base_tree_sha,
	});
	const entry: LoopAnalysisCacheEntry = {
		contract: LOOP_ANALYSIS_CONTRACT,
		cache_key: cacheKey,
		issue_number: input.issue_number,
		issue_body_digest: digest(input.issue_body),
		base_tree_sha: input.base_tree_sha,
		findings: {
			scopes: [...found.scopes],
			seams: [...found.seams],
			risks: [...found.risks],
			acceptance: [...found.acceptance],
			questions: [...(found.questions ?? [])],
		},
		analyzed_at: input.now ?? new Date().toISOString(),
	};

	ensureLoopStateDir(input.stateDir);
	const path = analysisPath(input.stateDir, cacheKey);
	writeFileSync(path, `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o600 });
	try {
		chmodSync(path, 0o600);
	} catch {}

	return { entry, cached: false };
}
