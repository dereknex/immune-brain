// Code-owned application-point registry (Spec D6; #286 §6). The registry is
// the only place a point's option set and threshold-set version live.
// Threshold values stay null until a live form sets them from baseline data.

import type { ApplicationPoint, PointRegistry } from "./contract.ts";

export const A1_REVIEW_FINDING_PRESCREEN: ApplicationPoint = {
	id: "a1_review_finding_prescreen",
	question_type: "choice",
	input_category: "finding",
	options: ["likely_true", "likely_false", "uncertain"],
	criteria: {
		likely_true: "The finding describes a reachable defect",
		likely_false: "The finding does not describe a reachable defect",
		uncertain: "The evidence does not support either conclusion",
	},
	instructions: "Given a review finding's trigger, caller chain, and violated invariant, which option best describes it?",
	threshold_set: { version: "a1/v0", values: null },
};

export const A14_PR_COMMENT_TRIAGE: ApplicationPoint = {
	id: "a14_pr_comment_triage",
	question_type: "choice",
	input_category: "pr_comment",
	options: ["blocking", "nit", "out_of_scope", "duplicate"],
	criteria: {
		blocking: "Must change before merge",
		nit: "Optional polish",
		out_of_scope: "Valid but belongs to another change",
		duplicate: "Restates an earlier comment in the same PR",
	},
	instructions:
		"Given the target review comment, its thread discussion and the earlier comments of the same pull request, which option best describes the target comment?",
	threshold_set: { version: "a14/v0", values: null },
};

export const A15_ISSUE_TRIAGE: ApplicationPoint = {
	id: "a15_issue_triage",
	question_type: "choice",
	input_category: "issue_text",
	options: ["duplicate", "needs_spec", "ready_for_agent"],
	criteria: {
		duplicate: "Restates an issue that already exists",
		needs_spec: "Too under-specified to implement; needs a spec first",
		ready_for_agent: "Specified well enough for an agent to implement as written",
	},
	instructions:
		"Given the issue title and body, which option best describes how the issue should be triaged: a duplicate of an existing issue, in need of a spec before work can start, or ready for an agent to implement?",
	threshold_set: { version: "a15/v0", values: null },
};

export const A16_REVISIT_CHAIN_CLASS: ApplicationPoint = {
	id: "a16_revisit_chain_class",
	question_type: "choice",
	input_category: "session_event",
	options: ["avoidable_friction", "necessary_decision", "error_recovery", "unknown"],
	criteria: {
		avoidable_friction: "The user stepped in only because the workflow stalled or asked something it could have resolved itself",
		necessary_decision: "The user stepped in to make a decision only they could make",
		error_recovery: "The user stepped in to recover from a failed or errored step",
		unknown: "The located fields do not support any other class",
	},
	instructions:
		"Given one revisit candidate chain (the task, how often the same task resumed, the last tool result before the stop and the length of the user's reply), which option best describes why the user resumed the task?",
	threshold_set: { version: "a16/v0", values: null },
};

export const A4_FINDING_EQUIVALENCE: ApplicationPoint = {
	id: "a4_finding_equivalence",
	question_type: "choice",
	input_category: "finding",
	options: ["same_invariant", "new_defect", "out_of_contract"],
	criteria: {
		same_invariant: "Violates the same invariant class as an earlier finding of the same run",
		new_defect: "A distinct defect that no earlier finding covers",
		out_of_contract: "Outside the accepted contract of the task",
	},
	instructions:
		"Given the target blocking review finding and the earlier findings of the same run, which option best describes the target finding: the same invariant class as an earlier finding, a new defect, or outside the task's accepted contract?",
	threshold_set: { version: "a4/v0", values: null },
};

export const A17_REVIEW_FINDING_KIND: ApplicationPoint = {
	id: "a17_review_finding_kind",
	question_type: "choice",
	input_category: "finding",
	options: ["acceptance", "security_boundary"],
	criteria: { acceptance: "Violates an acceptance assertion", security_boundary: "Violates a security boundary" },
	instructions: "Classify the violated invariant using only the finding trigger and caller chain; do not infer the reviewer's declared kind.",
	threshold_set: { version: "a17/v0", values: null },
};

export const A18_EVENT_PREFILTER: ApplicationPoint = {
	id: "a18_event_prefilter",
	question_type: "choice",
	input_category: "session_event",
	options: ["actionable", "ignore"],
	criteria: {
		actionable: "The event requires daemon action or triage",
		ignore: "The event is noisy, informational, or requires no action",
	},
	instructions:
		"Given a GitHub event or notification, which option best describes whether the daemon must act on it?",
	threshold_set: { version: "a18/v0", values: null },
};

export const A19_OWNER_COMMENT_INTENT: ApplicationPoint = {
	id: "a19_owner_comment_intent",
	question_type: "choice",
	input_category: "issue_text",
	options: ["approve_plan", "request_plan_revision", "answer_lane_decision", "command", "discussion"],
	criteria: {
		approve_plan: "The owner intends to approve the proposed plan",
		request_plan_revision: "The owner requests changes or revision to the proposed plan",
		answer_lane_decision: "The owner answers an in-Lane decision or clarification question",
		command: "The owner issues a direct daemon command",
		discussion: "General discussion not requiring execution",
	},
	instructions:
		"Given a comment from a verified repository owner, which option best describes the author's intent?",
	threshold_set: { version: "a19/v0", values: null },
};

export const A20_ISSUE_DUPLICATE_PAIR: ApplicationPoint = {
	id: "a20_issue_duplicate_pair",
	question_type: "choice",
	input_category: "issue_text",
	options: ["duplicate", "related", "unrelated"],
	criteria: {
		duplicate: "The candidate issue describes the same underlying problem as the existing issue",
		related: "The candidate issue is related but addresses a different problem",
		unrelated: "The candidate issue is unrelated to the existing issue",
	},
	instructions:
		"Given two GitHub issues, which option best describes their relationship?",
	threshold_set: { version: "a20/v0", values: null },
};

export const POINT_REGISTRY: PointRegistry = {
	[A17_REVIEW_FINDING_KIND.id]: A17_REVIEW_FINDING_KIND,
	[A1_REVIEW_FINDING_PRESCREEN.id]: A1_REVIEW_FINDING_PRESCREEN,
	[A14_PR_COMMENT_TRIAGE.id]: A14_PR_COMMENT_TRIAGE,
	[A15_ISSUE_TRIAGE.id]: A15_ISSUE_TRIAGE,
	[A16_REVISIT_CHAIN_CLASS.id]: A16_REVISIT_CHAIN_CLASS,
	[A4_FINDING_EQUIVALENCE.id]: A4_FINDING_EQUIVALENCE,
	[A18_EVENT_PREFILTER.id]: A18_EVENT_PREFILTER,
	[A19_OWNER_COMMENT_INTENT.id]: A19_OWNER_COMMENT_INTENT,
	[A20_ISSUE_DUPLICATE_PAIR.id]: A20_ISSUE_DUPLICATE_PAIR,
};
