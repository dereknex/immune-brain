// Code-owned application-point registry (Spec D6; #286 §6). The registry is
// the only place a point's option set and threshold-set version live.
// Threshold values stay null until a live form sets them from baseline data.

import type { ApplicationPoint, PointRegistry } from "./contract.ts";

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

export const POINT_REGISTRY: PointRegistry = {
	[A14_PR_COMMENT_TRIAGE.id]: A14_PR_COMMENT_TRIAGE,
	[A15_ISSUE_TRIAGE.id]: A15_ISSUE_TRIAGE,
	[A16_REVISIT_CHAIN_CLASS.id]: A16_REVISIT_CHAIN_CLASS,
	[A4_FINDING_EQUIVALENCE.id]: A4_FINDING_EQUIVALENCE,
};
