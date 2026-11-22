/**
 * Loop Daemon: 4-Tier Judgement Ladder (S2 / S10)
 *
 * Implements D2 and D12 of docs/specs/loop-daemon.spec.md (BR-REQ-2, BR-SCN-1):
 * - Tier 0: deterministic code guards (`G1`-`G10`).
 * - Tier 1: exact label, marker, and verified `@imm-loop` command transitions.
 * - Tier 2: decision-model points with D12 `/v1` correctable-direction thresholds:
 *   `a18_event_prefilter` (`ignore >= 0.90`), `a20_issue_duplicate_pair`
 *   (`duplicate >= 0.85`), `a15_task_granularity` (`0.75`),
 *   `a19_owner_comment_intent` (`0.80`; `approve_plan` and `command` always yield
 *   a deduplicated format reminder and never `enroll_and_drive`), and
 *   `a14_pr_comment_triage` (`0.80`).
 * - Tier 3: escalation and the D12 point baselines. The read-only judging
 *   session is retired (Spec loop-leader D3.4): a `needs_judging` outcome applies
 *   the point baseline and is listed as a leader reconcile candidate, so no
 *   session starts and nothing is invented in its place.
 */

import {
	type ApplicationPointId,
	type Envelope,
	type Truncation,
	type UnavailableReason,
} from "../decision_model/contract.ts";
import { decide } from "../decision_model/decide.ts";
import { POINT_REGISTRY } from "../decision_model/thresholds.ts";
import type { Judgement, JudgementClassification } from "./decision_record.ts";
import {
	GUARD_FALLBACKS,
	type GuardFacts,
	evaluateGuards,
	firstBlock,
} from "./guards.ts";
import { type LoopHandler } from "./handlers.ts";
import { LOOP_JOB_MAX_ATTEMPTS } from "./jobs.ts";
import { resolveOwnerCommand } from "./owner_commands.ts";
import type { NormalizedLoopEvent } from "./types.ts";

export type ClassifyResult =
	| {
			status: "decided";
			choice: string;
			confidence: number;
			envelope?: Envelope;
			truncation?: Truncation;
	  }
	| { status: "unavailable"; reason: UnavailableReason; detail: string };

export type ClassifyFn = (point: ApplicationPointId, state: unknown) => Promise<ClassifyResult>;

/** The production seam: one decision-model call per point, honouring the user's bindings and egress. */
export function createDecisionModelClassifier(
	root: string,
	deps: {
		env?: Readonly<Record<string, string | undefined>>;
		fetch?: (input: string, init: RequestInit) => Promise<Response>;
		now?: () => Date;
		userConfigPath?: string;
	} = {},
): ClassifyFn {
	const env = deps.env ?? process.env;
	const doFetch = deps.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
	return async (point, state) => {
		const result = await decide(
			{ point, state },
			{ root, env, fetch: doFetch, now: deps.now, userConfigPath: deps.userConfigPath },
		);
		if (result.status === "decided") {
			return {
				status: "decided",
				choice: result.envelope.choice,
				confidence: result.envelope.confidence,
				envelope: result.envelope,
				truncation: result.envelope.truncation,
			};
		}
		return { status: "unavailable", reason: result.reason, detail: result.detail };
	};
}

export interface JudgingBudgetTracker {
	canInvoke(): boolean;
	recordInvocation(): void;
}

export interface JudgeDeps {
	facts?: GuardFacts;
	classify?: ClassifyFn;
	enabledPoints?: readonly string[];
	budgetTracker?: JudgingBudgetTracker;
}

type PointOutcome =
	| {
			kind: "decided";
			choice: string;
			confidence: number;
			classification: JudgementClassification;
	  }
	| {
			kind: "needs_judging";
			reason: string;
			detail: string;
			classification: JudgementClassification | null;
			choice?: string;
			confidence?: number;
			truncation?: Truncation;
	  };

function toClassification(
	point: ApplicationPointId,
	result: Extract<ClassifyResult, { status: "decided" }>,
): JudgementClassification {
	if (result.envelope) {
		return {
			point: result.envelope.application_point,
			choice: result.envelope.choice,
			confidence: result.envelope.confidence,
			probabilities: result.envelope.probabilities,
			profile: result.envelope.profile,
			model: result.envelope.model,
			model_version: result.envelope.model_version,
			threshold_set_version: result.envelope.threshold_set_version,
			truncation: result.envelope.truncation,
		};
	}
	return {
		point,
		choice: result.choice,
		confidence: result.confidence,
		...(result.truncation !== undefined ? { truncation: result.truncation } : {}),
	};
}

async function classifyPoint(
	point: ApplicationPointId,
	state: unknown,
	deps: JudgeDeps,
): Promise<PointOutcome> {
	if (deps.enabledPoints && !deps.enabledPoints.includes(point)) {
		return {
			kind: "needs_judging",
			reason: "point_disabled",
			detail: `application point ${point} is disabled by decision_models.bindings`,
			classification: null,
		};
	}
	if (deps.classify === undefined) {
		return {
			kind: "needs_judging",
			reason: "no_binding",
			detail: "no classifier is configured for this daemon run",
			classification: null,
		};
	}

	let result: ClassifyResult;
	try {
		result = await deps.classify(point, state);
	} catch {
		return {
			kind: "needs_judging",
			reason: "provider_error",
			detail: `${point} classifier threw`,
			classification: null,
		};
	}

	if (result.status === "unavailable") {
		return {
			kind: "needs_judging",
			reason: result.reason,
			detail: result.detail,
			classification: null,
		};
	}

	const classification = toClassification(point, result);
	const truncation = result.envelope?.truncation ?? result.truncation;
	if (truncation !== undefined && truncation !== "none") {
		return {
			kind: "needs_judging",
			reason: `truncation_${truncation}`,
			detail: `${point} answer truncation is ${truncation}`,
			classification,
			choice: result.choice,
			confidence: result.confidence,
			truncation,
		};
	}

	// D12 item 1 & S10-AC2: `a19` approve_plan/command are format-reminded at any confidence.
	if (
		point === "a19_owner_comment_intent" &&
		(result.choice === "approve_plan" || result.choice === "command")
	) {
		return {
			kind: "decided",
			choice: result.choice,
			confidence: result.confidence,
			classification,
		};
	}

	const thresholdValues = POINT_REGISTRY[point]?.threshold_set.values;
	const threshold = thresholdValues ? thresholdValues[result.choice] : undefined;
	if (threshold !== undefined && result.confidence < threshold) {
		return {
			kind: "needs_judging",
			reason: "below_threshold",
			detail: `${point} choice ${result.choice} confidence ${result.confidence} < threshold ${threshold}`,
			classification,
			choice: result.choice,
			confidence: result.confidence,
		};
	}

	return {
		kind: "decided",
		choice: result.choice,
		confidence: result.confidence,
		classification,
	};
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

	/**
	 * D5 / BR-GAP-A1: `ready-for-agent` is the approval signal only once a plan is
	 * published; without one it routes to planning and never skips to enrollment.
	 */
	const readyTask = (issueNumber: number): Judgement => {
		const published = facts.expected_plan_digests?.[issueNumber] ?? null;
		return published
			? decided("enroll_and_drive", "ready-for-agent with a published plan is the approval signal")
			: decided("draft_plan", "ready-for-agent without a published plan routes to planning");
	};

	switch (event.kind) {
		case "E1_NEW_ISSUE":
		case "E2_ISSUE_EDITED":
			if (event.labels.includes("blocked")) return decided("noop_record", "label transitioned to blocked");
			if (event.labels.includes("ready-for-agent")) return readyTask(event.issue_number);
			return null;
		case "E3_OWNER_COMMENT": {
			const resolved = resolveOwnerCommand(event, facts);
			if (resolved.command === null) {
				// D8: a comment on an Issue that waits on its clarify question is the answer.
				const pending = facts.pending_clarify?.[event.issue_number];
				return pending
					? decided("apply_clarify_reply", `issue #${event.issue_number} waits on clarify ${pending}`)
					: null;
			}
			if (resolved.handler !== null) return decided(resolved.handler, resolved.reason);
			return decided("noop_record", `rejected @imm-loop ${resolved.command}: ${resolved.reason}`);
		}
		case "E4_PLAN_APPROVED":
			return decided("enroll_and_drive", "verified plan approval marker");
		case "E5_READY_TASK":
			return readyTask(event.issue_number);
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
		case "E12_JOB_FINISHED":
			// D6: a lost job is restarted once; the second loss is owner-visible.
			if (event.outcome === "lost")
				return event.attempts < LOOP_JOB_MAX_ATTEMPTS
					? decided("enroll_and_drive", `job ${event.job_id} was lost; restarting it once`)
					: decided("escalate", `job ${event.job_id} was lost ${event.attempts} times`);
			if (event.outcome === "settled") return decided("noop_record", `job ${event.job_id} settled; E13 opens the PR`);
			return decided("escalate", `job ${event.job_id} failed: ${event.detail}`);
		case "E13_LANE_SETTLED":
			return decided("open_pr", "lane settled with a Kernel projection");
		default:
			return null;
	}
}

function escalated(
	reason: string,
	classification: JudgementClassification | null = null,
	extra: Partial<Pick<Judgement, "escalation_key" | "needs_judging">> = {},
): Judgement {
	return { tier: 3, handler: "escalate", reason, guard: null, classification, ...extra };
}

function baseline(
	handler: LoopHandler,
	reason: string,
	classification: JudgementClassification | null = null,
	extra: Partial<Pick<Judgement, "needs_judging">> = {},
): Judgement {
	return { tier: 3, handler, reason, guard: null, classification, ...extra };
}

function withNeedsJudging(judgement: Judgement, needsJudging: boolean): Judgement {
	return needsJudging ? { ...judgement, needs_judging: true } : judgement;
}

async function triageIssue(
	event: Extract<NormalizedLoopEvent, { kind: "E1_NEW_ISSUE" | "E2_ISSUE_EDITED" }>,
	facts: GuardFacts,
	deps: JudgeDeps,
): Promise<Judgement> {
	const prefilter = await classifyPoint(
		"a18_event_prefilter",
		{
			event_kind: event.kind,
			issue_number: event.issue_number,
			title: event.title,
			body: event.body,
			labels: event.labels,
		},
		deps,
	);
	if (prefilter.kind === "decided" && prefilter.choice === "ignore") {
		return {
			tier: 2,
			handler: "noop_record",
			reason: "a18_event_prefilter judged the issue noise",
			guard: null,
			classification: prefilter.classification,
			kept_for_reconciliation: true,
		};
	}
	// D3.4 / ADR 0042 Decision 1: when a18 or a20 falls back to its point baseline
	// (`actionable` / `unrelated`), carry `needs_judging: true` onto the final
	// decision so reconcile surfaces it as a leader candidate.
	let needsJudging = prefilter.kind === "needs_judging";

	const candidate = facts.duplicate_candidate ?? facts.duplicate_candidates_by_issue?.[event.issue_number];
	if (candidate !== undefined) {
		const duplicate = await classifyPoint(
			"a20_issue_duplicate_pair",
			{
				candidate: { number: event.issue_number, title: event.title, body: event.body },
				existing: { number: candidate.number, title: candidate.title, body: candidate.body },
			},
			deps,
		);
		if (duplicate.kind === "decided" && duplicate.choice === "duplicate") {
			return withNeedsJudging(
				{
					tier: 2,
					handler: "escalate",
					reason: `issue #${event.issue_number} duplicates #${candidate.number}`,
					guard: null,
					classification: duplicate.classification,
				},
				needsJudging,
			);
		}
		if (duplicate.kind === "needs_judging") needsJudging = true;
	}

	const granularity = await classifyPoint(
		"a15_task_granularity",
		{ title: event.title, body: event.body },
		deps,
	);
	if (granularity.kind === "decided") {
		switch (granularity.choice) {
			case "clear_single_task":
				return withNeedsJudging(
					{
						tier: 2,
						handler: "draft_plan",
						reason: "a15_task_granularity judged the issue one clear task; planning one intent",
						guard: null,
						classification: granularity.classification,
					},
					needsJudging,
				);
			case "needs_initiative_decomposition":
				return withNeedsJudging(
					{
						tier: 2,
						handler: "draft_plan",
						reason: "issue must be split into an initiative before it can be driven; planning a decomposition",
						guard: null,
						classification: granularity.classification,
					},
					needsJudging,
				);
			case "needs_clarification":
				return withNeedsJudging(
					{
						tier: 2,
						handler: "clarify_issue",
						reason: "issue needs clarification before it can be planned",
						guard: null,
						classification: granularity.classification,
					},
					needsJudging,
				);
			default:
				return withNeedsJudging(
					escalated(
						`a15_task_granularity returned an unknown choice: ${granularity.choice}`,
						granularity.classification,
					),
					needsJudging,
				);
		}
	}

	return escalated(
		`a15_task_granularity fallback to escalate (${granularity.detail})`,
		granularity.classification,
		{ needs_judging: true },
	);
}

function a19FormatReminder(
	event: Extract<NormalizedLoopEvent, { kind: "E3_OWNER_COMMENT" }>,
	choice: "approve_plan" | "command",
	classification: JudgementClassification | null,
): Judgement {
	const key = `a19_format_reminder:issue:${event.issue_number}:comment:${event.comment_id}`;
	const detail =
		choice === "approve_plan"
			? `comment #${event.comment_id} looks like plan approval; post \`/approve <digest>\` or \`@imm-loop approve <digest>\` (never auto-enrolled via model classification)`
			: `comment #${event.comment_id} looks like a command; post an explicit \`@imm-loop <command>\` directive`;
	return {
		tier: 2,
		handler: "escalate",
		reason: detail,
		guard: null,
		classification,
		escalation_key: key,
	};
}

async function classifyOwnerComment(
	event: Extract<NormalizedLoopEvent, { kind: "E3_OWNER_COMMENT" }>,
	deps: JudgeDeps,
): Promise<Judgement> {
	const prefilter = await classifyPoint(
		"a18_event_prefilter",
		{
			event_kind: event.kind,
			issue_number: event.issue_number,
			comment_body: event.body,
			author: event.author,
			author_association: event.author_association,
		},
		deps,
	);
	if (prefilter.kind === "decided" && prefilter.choice === "ignore") {
		return {
			tier: 2,
			handler: "noop_record",
			reason: "a18_event_prefilter judged the verified comment informational",
			guard: null,
			classification: prefilter.classification,
			kept_for_reconciliation: true,
		};
	}
	// D3.4 / ADR 0042 Decision 1: when a18 falls back to its `actionable` baseline,
	// carry `needs_judging: true` onto the final decision so reconcile surfaces it.
	const needsJudging = prefilter.kind === "needs_judging";

	const intent = await classifyPoint(
		"a19_owner_comment_intent",
		{
			issue_number: event.issue_number,
			comment_body: event.body,
			author: event.author,
			author_association: event.author_association,
		},
		deps,
	);
	if (intent.kind === "decided") {
		switch (intent.choice) {
			case "approve_plan":
			case "command":
				return withNeedsJudging(a19FormatReminder(event, intent.choice, intent.classification), needsJudging);
			case "request_plan_revision":
				return withNeedsJudging(
					{
						tier: 2,
						handler: "draft_plan",
						reason: "verified owner requested a plan revision",
						guard: null,
						classification: intent.classification,
					},
					needsJudging,
				);
			case "answer_lane_decision":
				return withNeedsJudging(
					{
						tier: 2,
						handler: "apply_lane_decision_reply",
						reason: "verified owner answered a parked lane decision",
						guard: null,
						classification: intent.classification,
					},
					needsJudging,
				);
			default:
				return withNeedsJudging(
					{
						tier: 2,
						handler: "noop_record",
						reason: "verified owner comment is discussion",
						guard: null,
						classification: intent.classification,
						kept_for_reconciliation: true,
					},
					needsJudging,
				);
		}
	}

	return escalated(
		`a19_owner_comment_intent fallback to escalate (${intent.detail})`,
		intent.classification,
		{ needs_judging: true },
	);
}

async function classifyPrComment(
	event: Extract<NormalizedLoopEvent, { kind: "E10_PR_REVIEW_COMMENT" }>,
	deps: JudgeDeps,
): Promise<Judgement> {
	// Only PR review comment metadata goes to the model; CI logs never enter Tier 2.
	const intent = await classifyPoint(
		"a14_pr_comment_triage",
		{
			pr_number: event.pr_number,
			comment_id: event.comment_id,
			comment_body: event.body,
			author: event.author,
			author_association: event.author_association,
			path: event.path ?? null,
			line: event.line ?? null,
		},
		deps,
	);
	if (intent.kind === "decided") {
		switch (intent.choice) {
			case "blocking":
			case "nit":
				return {
					tier: 2,
					handler: "address_pr_review",
					reason: `a14_pr_comment_triage classified PR review comment as ${intent.choice}`,
					guard: null,
					classification: intent.classification,
				};
			case "out_of_scope":
				return {
					tier: 2,
					handler: "escalate",
					reason: "a14_pr_comment_triage classified PR review comment as out_of_scope",
					guard: null,
					classification: intent.classification,
				};
			default:
				return {
					tier: 2,
					handler: "noop_record",
					reason: "a14_pr_comment_triage classified PR review comment as duplicate",
					guard: null,
					classification: intent.classification,
					kept_for_reconciliation: true,
				};
		}
	}

	return baseline(
		"address_pr_review",
		`a14_pr_comment_triage fallback to address_pr_review (${intent.detail})`,
		intent.classification,
		{ needs_judging: true },
	);
}

/** Tiers 2-3: the decision-model points and the D12 point baselines. */
async function judgeTier2(
	event: NormalizedLoopEvent,
	facts: GuardFacts,
	deps: JudgeDeps,
): Promise<Judgement> {
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

export async function judgeEvents(
	events: readonly NormalizedLoopEvent[],
	deps: JudgeDeps = {},
): Promise<Judgement[]> {
	const judgements: Judgement[] = [];
	for (const event of events) {
		judgements.push(await judgeEvent(event, deps));
	}
	return judgements;
}
