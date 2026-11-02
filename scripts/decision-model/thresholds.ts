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

export const POINT_REGISTRY: PointRegistry = {
	[A14_PR_COMMENT_TRIAGE.id]: A14_PR_COMMENT_TRIAGE,
	[A15_ISSUE_TRIAGE.id]: A15_ISSUE_TRIAGE,
};
