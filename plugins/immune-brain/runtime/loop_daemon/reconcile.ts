/**
 * Loop Daemon: Reconciliation of Model-Skipped Decisions (S10)
 *
 * Implements D12 item 4 of docs/specs/loop-daemon.spec.md:
 * `imm-loop reconcile` and `imm-loop run` (on startup and every 24h) inspect
 * model-skipped decisions (`ignore` / `discussion` / `duplicate` kept for
 * reconciliation) since the last pass via the read-only judging agent. When the
 * judging agent overrides a skip, the override is gated by Tier-0 guards and
 * dispatched through `scheduleLoopWork()`, and a verified gold label row is
 * appended to `.imm/state/loop/labels.jsonl` (mode `0600`).
 */

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LoopConfig } from "../config/layered_config.ts";
import type { relayLaneDecision } from "../unattended/lane_decision.ts";
import type { AgentHandlerPort } from "./agent_handlers.ts";
import { buildDecisionRecord, type LoopDecisionRecord } from "./decision_record.ts";
import { dispatchDecisions, type LoopDispatchRecord, type RelayInputFactory } from "./dispatch.ts";
import type { LoopGitHubPort } from "./github_port.ts";
import { evaluateGuards, firstBlock, GUARD_FALLBACKS, type GuardFacts } from "./guards.ts";
import type { LoopHandler } from "./handlers.ts";
import type { JudgingAgentFn } from "./judging_agent.ts";
import { appendLoopLabel, isValidLabelChoice } from "./labels.ts";
import { budgetExhausted, type ScheduleBudget } from "./scheduler.ts";
import {
	appendLoopDecision,
	ensureLoopStateDir,
	loadLoopDecisions,
	loadLoopEvents,
	loadLoopState,
	saveLoopState,
} from "./state.ts";
import type { LoopDaemonState, NormalizedLoopEvent, ObservationInput } from "./types.ts";

export const RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RECONCILE_STATE_FILENAME = "reconcile.json";

const POINT_OPTIONS: Readonly<Record<string, readonly string[]>> = {
	a14_pr_comment_triage: ["blocking", "nit", "out_of_scope", "duplicate"],
	a15_task_granularity: ["clear_single_task", "needs_initiative_decomposition", "needs_clarification"],
	a18_event_prefilter: ["actionable", "ignore"],
	a19_owner_comment_intent: [
		"approve_plan",
		"request_plan_revision",
		"answer_lane_decision",
		"command",
		"discussion",
	],
	a20_issue_duplicate_pair: ["duplicate", "related", "unrelated"],
};

const SKIPPED_CHOICES_FOR_RECONCILE = new Set(["ignore", "discussion", "duplicate"]);

export interface ReconcileState {
	last_reconcile_at: string | null;
	reconciled_decision_ids: string[];
}

export interface ReconcileSkippedOptions {
	root: string;
	stateDir: string;
	loopConfig: LoopConfig;
	snapshot: ObservationInput;
	gitHubPort: LoopGitHubPort;
	guardFacts: GuardFacts;
	dryRun: boolean;
	now?: string;
	judgingAgent?: JudgingAgentFn;
	agentPort?: AgentHandlerPort;
	standingDaemon?: boolean;
	relayDecision?: typeof relayLaneDecision;
	relayInputFactory?: RelayInputFactory<unknown>;
	/** Explicit state override if caller already loaded state. */
	state?: LoopDaemonState;
}

export interface ReconcileResult {
	checked: number;
	overrides: number;
	labels_appended: number;
	dispatches: LoopDispatchRecord[];
	skipped_budget: boolean;
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

function inferOverrideGoldLabel(
	point: string,
	modelChoice: string,
	handler: LoopHandler,
	correctedOption?: string,
): string | null {
	if (correctedOption && isValidLabelChoice(point, correctedOption)) {
		return correctedOption;
	}
	if (point === "a18_event_prefilter" && modelChoice === "ignore") {
		return "actionable";
	}
	if (point === "a19_owner_comment_intent" && modelChoice === "discussion") {
		if (handler === "apply_lane_decision_reply") return "answer_lane_decision";
		return "request_plan_revision";
	}
	if (point === "a14_pr_comment_triage" && modelChoice === "duplicate") {
		if (handler === "escalate") return "out_of_scope";
		return "blocking";
	}
	return null;
}

function consumeBudgetForJudging(
	state: LoopDaemonState,
	loopConfig: LoopConfig,
	now: string,
	dryRun: boolean,
): boolean {
	const today = now.slice(0, 10);
	if (!dryRun && state.stats.today_date !== today) {
		state.stats.today_date = today;
		state.stats.ticks_today = 0;
		state.stats.dispatches_today = 0;
	}
	const budget: ScheduleBudget = {
		ticks_today: state.stats.ticks_today ?? state.stats.ticks_total,
		dispatches_today: state.stats.dispatches_today ?? 0,
		max_ticks_per_day: loopConfig.budget.max_ticks_per_day,
		max_dispatches_per_day: loopConfig.budget.max_dispatches_per_day,
	};
	if (budgetExhausted(budget) === "max_dispatches_per_day") {
		return false;
	}
	if (!dryRun) {
		state.stats.dispatches_today = (state.stats.dispatches_today ?? 0) + 1;
		state.stats.dispatches_total = (state.stats.dispatches_total ?? 0) + 1;
	}
	return true;
}

/**
 * Re-check model-skipped decisions kept for reconciliation since the last pass.
 */
export async function reconcileSkippedDecisions(
	options: ReconcileSkippedOptions,
): Promise<ReconcileResult> {
	const now = options.now ?? new Date().toISOString();
	const state = options.state ?? loadLoopState(options.stateDir) ?? {
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

	const reconcileState = loadReconcileState(options.stateDir);
	const seenIds = new Set(reconcileState.reconciled_decision_ids);
	const decisions = loadLoopDecisions<LoopDecisionRecord>(options.stateDir);
	const events = loadLoopEvents(options.stateDir);
	const eventById = new Map<string, NormalizedLoopEvent>(events.map((e) => [e.event_id, e]));

	const pending = decisions.filter(
		(d) => isModelSkippedDecision(d) && !seenIds.has(d.decision_id),
	);

	let checked = 0;
	let overrides = 0;
	let labelsAppended = 0;
	let skippedBudget = false;
	const overrideRecords: LoopDecisionRecord[] = [];
	const overrideEvents: NormalizedLoopEvent[] = [];

	for (const decision of pending) {
		const classification = decision.classification;
		const event = eventById.get(decision.event_id);
		if (!classification || !event) {
			seenIds.add(decision.decision_id);
			continue;
		}
		if (!options.judgingAgent) {
			break;
		}
		if (!consumeBudgetForJudging(state, options.loopConfig, now, options.dryRun)) {
			skippedBudget = true;
			break;
		}

		checked += 1;
		let judged = null;
		try {
			judged = await options.judgingAgent({
				point: classification.point,
				escalation_reason: `reconcile skipped choice ${classification.choice}`,
				event,
				model_choice: classification.choice,
				model_confidence: classification.confidence,
				options: POINT_OPTIONS[classification.point],
			});
		} catch {
			judged = null;
		}

		if (judged === null) {
			// Unavailable or invalid judging agent leaves decision un-reconciled or falls back safely;
			// per D12 it executes no side-effecting handler.
			continue;
		}

		seenIds.add(decision.decision_id);

		const isOverride =
			judged.handler !== "noop_record" ||
			(judged.corrected_option !== undefined && judged.corrected_option !== classification.choice);

		if (!isOverride) {
			continue;
		}

		const gold = inferOverrideGoldLabel(
			classification.point,
			classification.choice,
			judged.handler,
			judged.corrected_option,
		);

		// Gate every override through Tier-0 deterministic guards before scheduling.
		const blocked = firstBlock(evaluateGuards(event, options.guardFacts));
		const effectiveHandler = blocked ? GUARD_FALLBACKS[blocked.guard] : judged.handler;
		const overrideDecision = buildDecisionRecord(
			event,
			{
				tier: blocked ? 0 : 3,
				handler: effectiveHandler,
				reason: blocked
					? `${blocked.guard}: ${blocked.detail}`
					: `reconcile override: ${judged.reason}`,
				guard: blocked ? { id: blocked.guard, detail: blocked.detail } : null,
				classification,
				judging_agent_used: true,
				...(gold ? { corrected_option: gold } : {}),
				...(judged.lane_option ? { lane_option: judged.lane_option } : {}),
			},
			decision.target,
			{ recorded_at: now, dry_run: options.dryRun },
		);

		overrides += 1;
		if (effectiveHandler !== "noop_record") {
			overrideRecords.push(overrideDecision);
			overrideEvents.push(event);
		}

		if (!options.dryRun) {
			appendLoopDecision(options.stateDir, overrideDecision);
			if (gold) {
				appendLoopLabel(options.stateDir, {
					id: `reconcile:${decision.decision_id}`,
					point: classification.point,
					gold,
					model_choice: classification.choice,
					source: "judging_agent",
					recorded_at: now,
					decision_id: decision.decision_id,
					event_id: decision.event_id,
					target_id: `${decision.target.kind}-${decision.target.id}`,
					handler: effectiveHandler,
					reason: judged.reason,
				});
				labelsAppended += 1;
			}
		}
	}

	let dispatches: LoopDispatchRecord[] = [];
	if (overrideRecords.length > 0) {
		const dispatchResult = await dispatchDecisions({
			root: options.root,
			stateDir: options.stateDir,
			loopConfig: options.loopConfig,
			events: overrideEvents,
			decisions: overrideRecords,
			snapshot: options.snapshot,
			state,
			gitHubPort: options.gitHubPort,
			guardFacts: options.guardFacts,
			dryRun: options.dryRun,
			now,
			agentPort: options.agentPort,
			standingDaemon: options.standingDaemon === true,
			judgingAgent: options.judgingAgent,
			relayDecision: options.relayDecision,
			relayInputFactory: options.relayInputFactory,
		});
		dispatches = dispatchResult.dispatches;
	}

	if (!options.dryRun) {
		state.stats.last_reconcile_at = now;
		state.updated_at = now;
		saveLoopState(options.stateDir, state);
		saveReconcileState(options.stateDir, {
			last_reconcile_at: now,
			reconciled_decision_ids: [...seenIds],
		});
	}

	return {
		checked,
		overrides,
		labels_appended: labelsAppended,
		dispatches,
		skipped_budget: skippedBudget,
	};
}
