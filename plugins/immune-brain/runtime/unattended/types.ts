import type { GithubInitiativeObservation } from "../github_issue_tracker";

export interface BatchPlanBudget {
	max_children: number;
	deadline_at: string;
	qa_failure_limit: number;
}

export interface BatchPlanBudgetInput {
	max_children?: number;
	deadline_at?: string;
	qa_failure_limit?: number;
}

export interface BatchPlanDigestChild {
	task_id: string;
	intent_path: string;
	intent_revision: number;
	intent_content_hash: string;
	blocked_by: string[];
}

export type BatchPlanChildStatus =
	| "enrollable"
	| "already_settled"
	| "already_owned"
	| "needs_human"
	| "blocked";

/**
 * Stable per-child exclusion reasons a Host renders verbatim. The Spec-binding
 * reasons mirror the shared enrollment precondition, and the incomplete form
 * names every path the TaskIntent has to add.
 */
export type BatchPlanChildReason =
	| "critical"
	| "invalid_intent"
	| "dependency_unavailable"
	| "spec_binding_missing"
	| "spec_binding_ambiguous"
	| `spec_binding_incomplete: ${string}`;

export interface BatchPlanChild {
	task_id: string;
	slice_id: string;
	blocked_by: string[];
	status: BatchPlanChildStatus;
	reason: BatchPlanChildReason | null;
	intent_path: string | null;
	intent_revision: number | null;
	intent_content_hash: string | null;
}

export interface BatchPlan {
	contract: "assurance_kernel/batch_plan/v1";
	initiative_slug: string;
	confirmation_time: string;
	tracker_observation: GithubInitiativeObservation;
	children: BatchPlanChild[];
	enrollable: BatchPlanDigestChild[];
	plan_digest: string;
	budget: BatchPlanBudget;
}

export interface ProjectBatchPlanInput {
	confirmation_time: string;
	budget?: BatchPlanBudgetInput;
}

export type InitiativeObservationReader = (
	root: string,
	initiativeSlug: string,
) => Promise<GithubInitiativeObservation>;
