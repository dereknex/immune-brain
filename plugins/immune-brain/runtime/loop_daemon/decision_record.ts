/**
 * Loop Daemon: Decision Record Emission (S2)
 *
 * Implements S2 and D2 of docs/specs/loop-daemon.spec.md (BR-REQ-2, BR-SCN-1).
 * Every judged event becomes one `assurance_kernel/loop_decision_record/v1`
 * record. A record can only name a handler from the closed catalogue, and the
 * ladder never executes that handler, so `mutations` stays empty here.
 */

import { createHash } from "node:crypto";
import type { GuardId, LoopTarget } from "./guards.ts";
import { assertLoopHandler, type LoopHandler } from "./handlers.ts";
import {
	LOOP_DECISION_RECORD_CONTRACT,
	type LoopEventKind,
	type NormalizedLoopEvent,
} from "./types.ts";

export type JudgementTier = 0 | 1 | 2 | 3;

export interface JudgementClassification {
	point: string;
	choice: string;
	confidence: number;
	probabilities?: Record<string, number>;
	profile?: string;
	model?: string;
	model_version?: string | null;
	threshold_set_version?: string;
	truncation?: "possible" | "none" | "unknown";
}

export interface LoopDecisionRecord {
	contract: typeof LOOP_DECISION_RECORD_CONTRACT;
	decision_id: string;
	recorded_at: string;
	event_id: string;
	event_kind: LoopEventKind;
	target: LoopTarget;
	tier: JudgementTier;
	handler: LoopHandler;
	reason: string;
	guard: { id: GuardId; detail: string } | null;
	classification: JudgementClassification | null;
	kept_for_reconciliation?: boolean;
	judging_agent_used?: boolean;
	escalation_key?: string;
	corrected_option?: string;
	lane_option?: string;
	dry_run: boolean;
	mutations: string[];
}

/** The ladder's decision for one event, before it gains a record envelope. */
export interface Judgement {
	tier: JudgementTier;
	handler: LoopHandler;
	reason: string;
	guard: { id: GuardId; detail: string } | null;
	classification: JudgementClassification | null;
	kept_for_reconciliation?: boolean;
	judging_agent_used?: boolean;
	escalation_key?: string;
	corrected_option?: string;
	lane_option?: string;
}

/** Deterministic, so re-judging the same event with the same handler stays idempotent. */
export function decisionId(eventId: string, handler: LoopHandler, tier: JudgementTier): string {
	const digest = createHash("sha256").update(`${eventId}:${tier}:${handler}`).digest("hex");
	return `dec-${digest.slice(0, 16)}`;
}

export function buildDecisionRecord(
	event: NormalizedLoopEvent,
	judgement: Judgement,
	target: LoopTarget,
	options: { recorded_at: string; dry_run: boolean },
): LoopDecisionRecord {
	assertLoopHandler(judgement.handler);
	return {
		contract: LOOP_DECISION_RECORD_CONTRACT,
		decision_id: decisionId(event.event_id, judgement.handler, judgement.tier),
		recorded_at: options.recorded_at,
		event_id: event.event_id,
		event_kind: event.kind,
		target,
		tier: judgement.tier,
		handler: judgement.handler,
		reason: judgement.reason,
		guard: judgement.guard,
		classification: judgement.classification,
		...(judgement.kept_for_reconciliation ? { kept_for_reconciliation: true } : {}),
		...(judgement.judging_agent_used ? { judging_agent_used: true } : {}),
		...(judgement.escalation_key ? { escalation_key: judgement.escalation_key } : {}),
		...(judgement.corrected_option ? { corrected_option: judgement.corrected_option } : {}),
		...(judgement.lane_option ? { lane_option: judgement.lane_option } : {}),
		dry_run: options.dry_run,
		mutations: [],
	};
}
