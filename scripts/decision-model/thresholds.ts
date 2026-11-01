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

export const POINT_REGISTRY: PointRegistry = {
	[A14_PR_COMMENT_TRIAGE.id]: A14_PR_COMMENT_TRIAGE,
};
