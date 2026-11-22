/**
 * Loop Daemon: Reconciliation of Model-Skipped Decisions (S10 / Spec loop-leader D3.4)
 *
 * A model skip (`ignore` / `discussion` / `duplicate`) is a decision the daemon
 * records without acting. `imm-loop reconcile` and the scheduled pass collect
 * every skip kept for reconciliation since the last pass and publish it as a
 * briefing reconcile candidate. No session starts here: the read-only judging
 * agent is retired, so whether a skip is wrong is the leader's call, and a
 * leader `next` for such a target passes the same Tier-0 guards an override did.
 */

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type LoopDecisionRecord } from "./decision_record.ts";
import { ensureLoopStateDir, loadLoopDecisions, loadLoopState, saveLoopState } from "./state.ts";
import type { LoopDaemonState } from "./types.ts";

export const RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RECONCILE_STATE_FILENAME = "reconcile.json";

const SKIPPED_CHOICES_FOR_RECONCILE = new Set(["ignore", "discussion", "duplicate"]);

export interface ReconcileState {
	last_reconcile_at: string | null;
	reconciled_decision_ids: string[];
}

/** One model-skipped decision the leader may act on, in briefing vocabulary. */
export interface ReconcileCandidate {
	decision_id: string;
	event_id: string;
	/** The WorkItem target the skip belongs to, e.g. `issue-42`. */
	target: string;
	/** The point and choice that skipped it; null when the classifier could not answer. */
	point: string | null;
	choice: string | null;
}

export interface ReconcileSkippedOptions {
	stateDir: string;
	dryRun: boolean;
	now?: string;
	/** Explicit state override if caller already loaded state. */
	state?: LoopDaemonState;
}

export interface ReconcileResult {
	checked: number;
	candidates: ReconcileCandidate[];
}

export function loadReconcileState(stateDir: string): ReconcileState {
	const path = join(stateDir, RECONCILE_STATE_FILENAME);
	if (!existsSync(path)) {
		return { last_reconcile_at: null, reconciled_decision_ids: [] };
	}
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<ReconcileState>;
		return {
			last_reconcile_at: typeof raw.last_reconcile_at === "string" ? raw.last_reconcile_at : null,
			reconciled_decision_ids: Array.isArray(raw.reconciled_decision_ids)
				? raw.reconciled_decision_ids.filter((id): id is string => typeof id === "string")
				: [],
		};
	} catch {
		return { last_reconcile_at: null, reconciled_decision_ids: [] };
	}
}

export function saveReconcileState(stateDir: string, state: ReconcileState): void {
	ensureLoopStateDir(stateDir);
	const path = join(stateDir, RECONCILE_STATE_FILENAME);
	writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
	try {
		chmodSync(path, 0o600);
	} catch {}
}

export function shouldRunScheduledReconcile(stateDir: string, nowIso: string): boolean {
	const recState = loadReconcileState(stateDir);
	const loopState = loadLoopState(stateDir);
	const lastIso = recState.last_reconcile_at ?? loopState?.stats?.last_reconcile_at ?? null;
	if (!lastIso) return true;
	const lastMs = Date.parse(lastIso);
	const nowMs = Date.parse(nowIso);
	if (Number.isNaN(lastMs) || Number.isNaN(nowMs)) return true;
	return nowMs - lastMs >= RECONCILE_INTERVAL_MS;
}

export function isModelSkippedDecision(decision: LoopDecisionRecord): boolean {
	if (decision.kept_for_reconciliation === true) return true;
	return (
		decision.handler === "noop_record" &&
		decision.classification !== null &&
		SKIPPED_CHOICES_FOR_RECONCILE.has(decision.classification.choice)
	);
}

/**
 * A reconcile candidate is a model skip or a Tier-2 `needs_judging` outcome that
 * applied its point baseline: both are decisions with no judging session behind
 * them, so the leader is the one that may propose the next move (D3.4).
 */
export function isReconcileCandidate(decision: LoopDecisionRecord): boolean {
	return isModelSkippedDecision(decision) || decision.needs_judging === true;
}

/**
 * The skips the leader has not been shown a decision for yet. The stored target
 * is the decision's own, so a candidate names the same WorkItem target the
 * briefing and the leader proposal use.
 */
export function reconcileCandidates(stateDir: string): ReconcileCandidate[] {
	const seen = new Set(loadReconcileState(stateDir).reconciled_decision_ids);
	const candidates: ReconcileCandidate[] = [];
	for (const decision of loadLoopDecisions<LoopDecisionRecord>(stateDir)) {
		if (!isReconcileCandidate(decision) || seen.has(decision.decision_id)) continue;
		const classification = decision.classification;
		candidates.push({
			decision_id: decision.decision_id,
			event_id: decision.event_id,
			target: `${decision.target.kind}-${decision.target.id}`,
			point: classification?.point ?? null,
			choice: classification?.choice ?? null,
		});
	}
	return candidates;
}

/**
 * Collect the skips since the last pass and report them. Nothing is dispatched,
 * no session starts, and no label is written: the leader decides what, if
 * anything, each candidate deserves.
 */
export async function reconcileSkippedDecisions(options: ReconcileSkippedOptions): Promise<ReconcileResult> {
	const now = options.now ?? new Date().toISOString();
	const candidates = reconcileCandidates(options.stateDir);
	if (!options.dryRun) {
		const state =
			options.state ??
			loadLoopState(options.stateDir) ?? {
				contract: "assurance_kernel/loop_daemon_state/v1" as const,
				updated_at: now,
				watermarks: {
					issues_updated_at: null,
					comments_updated_at: null,
					prs_updated_at: null,
					etag_by_resource: {},
				},
				active_leases: {},
				paused: false,
				pause_reason: null,
				stats: { ticks_total: 0, events_observed_total: 0, last_tick_at: null },
			};
		// D3.4: a pass reports the skips since the last pass and retires them, so
		// the candidate list cannot grow without bound. A skip the leader never
		// acts on stays in the decision log, only not re-reported.
		state.stats.last_reconcile_at = now;
		state.updated_at = now;
		saveLoopState(options.stateDir, state);
		const previous = loadReconcileState(options.stateDir);
		saveReconcileState(options.stateDir, {
			last_reconcile_at: now,
			reconciled_decision_ids: [...new Set([...previous.reconciled_decision_ids, ...candidates.map((candidate) => candidate.decision_id)])],
		});
	}
	return { checked: candidates.length, candidates };
}
