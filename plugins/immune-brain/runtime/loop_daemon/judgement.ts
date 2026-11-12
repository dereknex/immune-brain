/**
 * Loop Daemon: 4-Tier Judgement Ladder (S2)
 *
 * Implements S2 and D2 of docs/specs/loop-daemon.spec.md (BR-REQ-2, BR-SCN-1).
 * Tier 0 runs the deterministic code guards, Tier 1 the deterministic rule
 * matchers, Tier 2 the decision-model points (`a18_event_prefilter`,
 * `a15_task_granularity`, `a20_issue_duplicate_pair`, `a19_owner_comment_intent`,
 * `a14_ambiguous_user_intent`), and Tier 3 the escalation fallback. Every tier yields one handler from the closed
 * catalogue; nothing here mutates GitHub, a branch or the working tree.
 *
 * An unavailable decision model keeps the baseline behaviour of its tier-1
 * path (the decision-model contract), and a classification below
 * `MIN_CLASSIFIER_CONFIDENCE` escalates instead of acting on a guess.
 */

import {
	type ApplicationPointId,
	type UnavailableReason,
} from "../decision_model/contract.ts";
import { decide } from "../decision_model/decide.ts";
import type { Judgement, JudgementClassification } from "./decision_record.ts";
import {
	GUARD_FALLBACKS,
	type GuardFacts,
	evaluateGuards,
	firstBlock,
} from "./guards.ts";
import type { LoopHandler } from "./handlers.ts";
import { resolveOwnerCommand } from "./owner_commands.ts";
import type { NormalizedLoopEvent } from "./types.ts";

/** Below this confidence a Tier-2 classification escalates rather than acts. */
export const MIN_CLASSIFIER_CONFIDENCE = 0.6;

export type ClassifyResult =
	| { status: "decided"; choice: string; confidence: number }
	| { status: "unavailable"; reason: UnavailableReason; detail: string };

export type ClassifyFn = (point: ApplicationPointId, state: unknown) => Promise<ClassifyResult>;

/** The production seam: one decision-model call per point, honouring the user's bindings and egress. */
export function createDecisionModelClassifier(
	root: string,
	deps: {
		env?: Readonly<Record<string, string | undefined>>;
		fetch?: (input: string, init: RequestInit) => Promise<Response>;
		now?: () => Date;
	} = {},
): ClassifyFn {
	const env = deps.env ?? process.env;
	const doFetch = deps.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
	return async (point, state) => {
		const result = await decide({ point, state }, { root, env, fetch: doFetch, now: deps.now });
		if (result.status === "decided") {
			return { status: "decided", choice: result.envelope.choice, confidence: result.envelope.confidence };
		}
		return { status: "unavailable", reason: result.reason, detail: result.detail };
	};
}

export interface JudgeDeps {
	facts?: GuardFacts;
	classify?: ClassifyFn;
}

type PointOutcome =
	| { kind: "decided"; choice: string; confidence: number }
	| { kind: "low"; choice: string; confidence: number }
	| { kind: "unavailable"; reason: UnavailableReason; detail: string };

async function classifyPoint(
	classify: ClassifyFn | undefined,
	point: ApplicationPointId,
	state: unknown,
): Promise<PointOutcome> {
	if (classify === undefined) {
		return { kind: "unavailable", reason: "no_binding", detail: "no classifier is configured for this daemon run" };
	}
	let result: ClassifyResult;
	try {
		result = await classify(point, state);
	} catch {
		return { kind: "unavailable", reason: "provider_error", detail: `${point} classifier threw` };
	}
	if (result.status === "unavailable") return { kind: "unavailable", reason: result.reason, detail: result.detail };
	if (result.confidence < MIN_CLASSIFIER_CONFIDENCE) {
		return { kind: "low", choice: result.choice, confidence: result.confidence };
	}
	return { kind: "decided", choice: result.choice, confidence: result.confidence };
}

/** Tier 1: exact label, marker and command transitions. `null` means Tier 2 must decide. */
function matchTier1(event: NormalizedLoopEvent, facts: GuardFacts): Judgement | null {
	const decided = (handler: LoopHandler, reason: string): Judgement => ({
		tier: 1,
		handler,
		reason,
		guard: null,
		classification: null,
	});

	switch (event.kind) {
		case "E1_NEW_ISSUE":
		case "E2_ISSUE_EDITED":
			if (event.labels.includes("blocked")) return decided("noop_record", "label transitioned to blocked");
			if (event.labels.includes("ready-for-agent")) return decided("enroll_and_drive", "label transitioned to ready-for-agent");
			return null;
		case "E3_OWNER_COMMENT": {
			// A comment only reaches this tier after G7 verified its REST actor. A parsed
			// command that still fails verification settles here as a quiet noop: handing
			// it to Tier 2 would let a classifier turn rejected evidence into authority.
			const resolved = resolveOwnerCommand(event, facts);
			if (resolved.command === null) return null;
			if (resolved.handler !== null) return decided(resolved.handler, resolved.reason);
			return decided("noop_record", `rejected @imm-loop ${resolved.command}: ${resolved.reason}`);
		}
		case "E4_PLAN_APPROVED":
			return decided("enroll_and_drive", "verified plan approval marker");
		case "E5_READY_TASK":
			return decided("enroll_and_drive", "ready-for-agent task with no unresolved blocker");
		case "E6_LANE_DECISION_NEEDED":
			return decided("relay_lane_decision_question", "lane parked on a literal-user decision");
		case "E7_LANE_DECISION_REPLIED":
			return decided("apply_lane_decision_reply", "verified lane decision reply");
		case "E8_PR_CHECK_FAILED":
			return decided("repair_pr_ci", "daemon PR carries a failed check");
		case "E9_PR_CONFLICT":
			return decided("repair_pr_conflict", "daemon PR carries a merge conflict");
		case "E10_PR_REVIEW_COMMENT":
			return null;
		case "E11_PR_READY_OR_MERGED":
			return event.status === "merged"
				? decided("close_out", "daemon PR merged")
				: decided("mark_pr_ready", "daemon PR ready for owner merge");
		default:
			return null;
	}
}

function low(point: string, outcome: { choice: string; confidence: number }): JudgementClassification {
	return { point, choice: outcome.choice, confidence: outcome.confidence };
}

function escalated(reason: string, classification: JudgementClassification | null = null): Judgement {
	return { tier: 3, handler: "escalate", reason, guard: null, classification };
}

function baseline(handler: LoopHandler, reason: string): Judgement {
	return { tier: 3, handler, reason, guard: null, classification: null };
}

async function triageIssue(
	event: Extract<NormalizedLoopEvent, { kind: "E1_NEW_ISSUE" | "E2_ISSUE_EDITED" }>,
	facts: GuardFacts,
	deps: JudgeDeps,
): Promise<Judgement> {
	const prefilter = await classifyPoint(deps.classify, "a18_event_prefilter", {
		event_kind: event.kind,
		issue_number: event.issue_number,
		title: event.title,
		body: event.body,
		labels: event.labels,
	});
	if (prefilter.kind === "low") return escalated("a18_event_prefilter confidence below the action floor", low("a18_event_prefilter", prefilter));
	if (prefilter.kind === "decided" && prefilter.choice === "ignore") {
		return {
			tier: 2,
			handler: "noop_record",
			reason: "a18_event_prefilter judged the edit or comment noise",
			guard: null,
			classification: { point: "a18_event_prefilter", choice: prefilter.choice, confidence: prefilter.confidence },
		};
	}

	const candidate = facts.duplicate_candidate;
	if (candidate !== undefined) {
		const duplicate = await classifyPoint(deps.classify, "a20_issue_duplicate_pair", {
			candidate: { number: event.issue_number, title: event.title, body: event.body },
			existing: candidate,
		});
		if (duplicate.kind === "decided" && duplicate.choice === "duplicate") {
			return {
				tier: 2,
				handler: "escalate",
				reason: `issue duplicates #${candidate.number}`,
				guard: null,
				classification: { point: "a20_issue_duplicate_pair", choice: duplicate.choice, confidence: duplicate.confidence },
			};
		}
	}

	const granularity = await classifyPoint(deps.classify, "a15_task_granularity", { title: event.title, body: event.body });
	if (granularity.kind === "decided") {
		const classification = { point: "a15_task_granularity", choice: granularity.choice, confidence: granularity.confidence };
		switch (granularity.choice) {
			case "clear_single_task":
				return { tier: 2, handler: "triage_issue", reason: "a15_task_granularity judged the issue one clear task", guard: null, classification };
			case "needs_initiative_decomposition":
				return { tier: 2, handler: "draft_plan", reason: "issue must be split into an initiative before it can be driven", guard: null, classification };
			default:
				return { tier: 2, handler: "escalate", reason: "issue needs clarification before it can be planned", guard: null, classification };
		}
	}
	if (granularity.kind === "low") return escalated("a15_task_granularity confidence below the action floor", low("a15_task_granularity", granularity));
	return baseline("triage_issue", `decision model unavailable (${granularity.reason}); falling back to deterministic triage`);
}

async function classifyOwnerComment(
	event: Extract<NormalizedLoopEvent, { kind: "E3_OWNER_COMMENT" }>,
	deps: JudgeDeps,
): Promise<Judgement> {
	const prefilter = await classifyPoint(deps.classify, "a18_event_prefilter", {
		event_kind: event.kind,
		issue_number: event.issue_number,
		comment_body: event.body,
		author: event.author,
		author_association: event.author_association,
	});
	if (prefilter.kind === "low") return escalated("a18_event_prefilter confidence below the action floor", low("a18_event_prefilter", prefilter));
	if (prefilter.kind === "decided" && prefilter.choice === "ignore") {
		return {
			tier: 2,
			handler: "noop_record",
			reason: "a18_event_prefilter judged the verified comment informational",
			guard: null,
			classification: { point: "a18_event_prefilter", choice: prefilter.choice, confidence: prefilter.confidence },
		};
	}

	const intent = await classifyPoint(deps.classify, "a19_owner_comment_intent", {
		issue_number: event.issue_number,
		comment_body: event.body,
		author: event.author,
		author_association: event.author_association,
	});
	if (intent.kind === "decided") {
		const classification = { point: "a19_owner_comment_intent", choice: intent.choice, confidence: intent.confidence };
		switch (intent.choice) {
			case "approve_plan":
				return { tier: 2, handler: "enroll_and_drive", reason: "verified owner approved the plan", guard: null, classification };
			case "request_plan_revision":
				return { tier: 2, handler: "draft_plan", reason: "verified owner requested a plan revision", guard: null, classification };
			case "answer_lane_decision":
				return { tier: 2, handler: "apply_lane_decision_reply", reason: "verified owner answered a parked lane decision", guard: null, classification };
			case "command":
				return { tier: 2, handler: "escalate", reason: "verified owner command needs an explicit handler", guard: null, classification };
			default:
				return { tier: 2, handler: "noop_record", reason: "verified owner comment is discussion", guard: null, classification };
		}
	}
	if (intent.kind === "low") return escalated("a19_owner_comment_intent confidence below the action floor", low("a19_owner_comment_intent", intent));
	return baseline("noop_record", `decision model unavailable (${intent.reason}); a comment alone is not actionable`);
}

async function classifyPrComment(
	event: Extract<NormalizedLoopEvent, { kind: "E10_PR_REVIEW_COMMENT" }>,
	deps: JudgeDeps,
): Promise<Judgement> {
	const intent = await classifyPoint(deps.classify, "a14_ambiguous_user_intent", {
		pr_number: event.pr_number,
		comment_body: event.body,
		author: event.author,
		author_association: event.author_association,
		path: event.path ?? null,
		line: event.line ?? null,
	});
	if (intent.kind === "decided") {
		const classification = { point: "a14_ambiguous_user_intent", choice: intent.choice, confidence: intent.confidence };
		switch (intent.choice) {
			case "clear_single_task":
				return { tier: 2, handler: "address_pr_review", reason: "review comment asks for one clear change", guard: null, classification };
			case "needs_initiative_decomposition":
				return { tier: 2, handler: "draft_plan", reason: "review comment asks for more work than one repair", guard: null, classification };
			default:
				return { tier: 2, handler: "escalate", reason: "review comment intent is ambiguous", guard: null, classification };
		}
	}
	if (intent.kind === "low") return escalated("a14_ambiguous_user_intent confidence below the action floor", low("a14_ambiguous_user_intent", intent));
	return baseline("address_pr_review", `decision model unavailable (${intent.reason}); addressing the review is the safe baseline`);
}

/** Tiers 2-3: the decision-model points, then the escalation fallback. */
async function judgeTier2(event: NormalizedLoopEvent, facts: GuardFacts, deps: JudgeDeps): Promise<Judgement> {
	switch (event.kind) {
		case "E1_NEW_ISSUE":
		case "E2_ISSUE_EDITED":
			return triageIssue(event, facts, deps);
		case "E3_OWNER_COMMENT":
			return classifyOwnerComment(event, deps);
		case "E10_PR_REVIEW_COMMENT":
			return classifyPrComment(event, deps);
		default:
			return escalated(`no tier-1 rule and no decision-model point covers ${event.kind}`);
	}
}

export async function judgeEvent(event: NormalizedLoopEvent, deps: JudgeDeps = {}): Promise<Judgement> {
	const facts = deps.facts ?? {};
	const blocked = firstBlock(evaluateGuards(event, facts));
	if (blocked !== null) {
		return {
			tier: 0,
			handler: GUARD_FALLBACKS[blocked.guard],
			reason: `${blocked.guard}: ${blocked.detail}`,
			guard: { id: blocked.guard, detail: blocked.detail },
			classification: null,
		};
	}
	const tier1 = matchTier1(event, facts);
	if (tier1 !== null) return tier1;
	return judgeTier2(event, facts, deps);
}

export async function judgeEvents(events: readonly NormalizedLoopEvent[], deps: JudgeDeps = {}): Promise<Judgement[]> {
	const judgements: Judgement[] = [];
	for (const event of events) {
		judgements.push(await judgeEvent(event, deps));
	}
	return judgements;
}
