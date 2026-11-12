/**
 * Loop Daemon: Cached Read-Only Codebase Analysis (S4)
 *
 * Implements D4.2 of docs/specs/loop-daemon.spec.md. The planning probes run
 * read-only and are keyed by `(issue_number, issue_body_digest, base_tree_sha)`,
 * so an unchanged Issue on an unchanged tree reuses the structured scope/seam
 * findings at `.imm/state/loop/analysis/<key>.json` instead of probing again.
 * The cache is rebuildable state: an unreadable or foreign entry is ignored and
 * the probe runs again.
 */

import { createHash } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureLoopStateDir } from "./state.ts";
import { LOOP_ANALYSIS_CONTRACT } from "./types.ts";

/** What the read-only probe may conclude. Paths are repository-relative. */
export interface CodebaseAnalysisFindings {
	/** Areas the plan expects to touch. */
	scopes: string[];
	/** Existing modules and seams the plan should extend. */
	seams: string[];
	/** Facts the plan must settle before it can enroll. */
	questions?: string[];
}

export interface CodebaseAnalysisProbeInput {
	issue_number: number;
	issue_body: string;
	base_tree_sha: string;
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

/** Stable cache key: the same Issue body on the same tree always maps to one entry. */
export function analysisCacheKey(input: CodebaseAnalysisProbeInput): string {
	return digest(`${input.issue_number}\n${digest(input.issue_body)}\n${input.base_tree_sha}`);
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
		findings: { scopes: [...found.scopes], seams: [...found.seams], questions: [...(found.questions ?? [])] },
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
