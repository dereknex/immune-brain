export const INTENT_CONTRACT = "assurance_kernel/intent/v1" as const;
export const TASK_RECORD_CONTRACT = "assurance_kernel/task_record/v1" as const;

export const TASK_PHASES = ["working", "review", "done", "stopped"] as const;
export type TaskPhase = (typeof TASK_PHASES)[number];

export const TASK_RISKS = ["routine", "material", "critical"] as const;
export type TaskRisk = (typeof TASK_RISKS)[number];

export interface AcceptanceItem {
	id: string;
	text: string;
}

export interface TaskIntent {
	contract: typeof INTENT_CONTRACT;
	task_id: string;
	revision: number;
	goal: string;
	acceptance: AcceptanceItem[];
	scope_hint: string[];
	risk: TaskRisk;
}

export type EvidenceStatus = "passed" | "failed" | "blocked";

export interface TaskEvidence {
	id: string;
	acceptance_id: string;
	task_revision: number;
	diff_hash: string;
	status: EvidenceStatus;
	actor_id: string;
	summary: string;
}

export type FindingKind =
	| "blocking"
	| "advisory"
	| "unresolved_user_decision"
	| "replan_required";
export type FindingStatus = "open" | "resolved";
export type FindingSource = "execution" | "review" | "kernel" | "migration";

export interface TaskFinding {
	id: string;
	kind: FindingKind;
	status: FindingStatus;
	acceptance_id: string | null;
	source: FindingSource;
	review_round: number | null;
	summary: string;
}

export type ApprovalKind = "review" | "qa" | "user";
export type ApprovalAuthorityRole = "reviewer" | "qa" | "user";

export interface TaskApproval {
	id: string;
	kind: ApprovalKind;
	authority_role: ApprovalAuthorityRole;
	task_revision: number;
	diff_hash: string;
	actor_id: string;
	summary: string;
}

export interface UserAuthorityAudit {
	actor_id: string;
	source: "literal_user";
	confirmation_ref: string;
}

export interface TaskHistoryEntry {
	id: string;
	at: string;
	type: string;
	from_phase: TaskPhase | null;
	to_phase: TaskPhase | null;
	reason: string | null;
	authority?: UserAuthorityAudit;
}

export interface TaskRecord {
	contract: typeof TASK_RECORD_CONTRACT;
	task_id: string;
	intent_revision: number;
	phase: TaskPhase;
	baseline: string;
	evidence: TaskEvidence[];
	findings: TaskFinding[];
	approvals: TaskApproval[];
	history: TaskHistoryEntry[];
}

export interface CompletionDecision {
	complete: boolean;
	fresh_acceptance_ids: string[];
	missing_acceptance_ids: string[];
	stale_evidence_ids: string[];
	missing_approval_kinds: ApprovalKind[];
	blocking_finding_ids: string[];
	unresolved_user_decision_ids: string[];
	replan_required_ids: string[];
	independence_violations: string[];
}

export type KernelNextAction =
	| "submit_review"
	| "resolve_findings"
	| "resolve_user_decision"
	| "revise_intent"
	| "request_rework"
	| "record_evidence"
	| "record_approval"
	| "complete"
	| null;

export interface TaskProjection extends CompletionDecision {
	contract: "assurance_kernel/projection/v1";
	task_id: string;
	intent_revision: number;
	phase: TaskPhase;
	blocked: boolean;
	next_action: KernelNextAction;
}

export interface NewReviewFinding {
	id: string;
	kind: "blocking" | "advisory";
	acceptance_id: string | null;
	summary: string;
}

interface BaseTaskAction {
	event_id: string;
	at: string;
}

export type TaskAction =
	| (BaseTaskAction & { type: "submit_review" })
	| (BaseTaskAction & {
			type: "request_rework";
			findings: NewReviewFinding[];
	  })
	| (BaseTaskAction & {
			type: "complete";
			intent: TaskIntent;
			current_diff_hash: string;
	  })
	| (BaseTaskAction & { type: "stop"; reason: string })
	| (BaseTaskAction & { type: "resolve_finding"; finding_id: string })
	| (BaseTaskAction & {
			type: "resolve_user_decision";
			finding_id: string;
			resolution: string;
	  });

export interface LegacyMapping {
	phase: TaskPhase | null;
	reason: string;
	ambiguous: boolean;
	source_states: string[];
}

export interface V3CommitSourceEvent {
	id: string;
	action: string;
	at: string | null;
}

export interface V3AuthorityObservation {
	contract: "assurance_kernel/v3_authority_observation/v1";
	observer_version: string;
	observation_id: string;
	commit_id: string;
	ledger_revision: string;
	committed_at: string;
	plan_path: string | null;
	plan_signature: string | null;
	source_events: V3CommitSourceEvent[];
	shadow: LegacyMapping;
	divergence: {
		detected: boolean;
		fields: string[];
	};
}

// ---------------------------------------------------------------------------
// P2C1 additive identity contracts (TaskIntent v1 / TaskRecord v2).
// Existing v1 contracts above remain byte-for-byte unchanged.
// ---------------------------------------------------------------------------

export const TASK_INTENT_CONTRACT_V1 = "assurance_kernel/task_intent/v1" as const;
export const TASK_RECORD_CONTRACT_V2 = "assurance_kernel/task_record/v2" as const;

export interface TaskIntentAcceptanceItemV1 {
	id: string;
	assertion: string;
	verification: string;
}

export interface TaskIntentV1 {
	contract: typeof TASK_INTENT_CONTRACT_V1;
	task_id: string;
	goal: string;
	acceptance: TaskIntentAcceptanceItemV1[];
	scope_hint: string[];
	risk: TaskRisk;
	revision: number;
	owner: "user";
}

export interface TaskIntentRefV1 {
	path: string;
	revision: number;
	content_hash: string;
}

export interface TaskEvidenceV2 {
	id: string;
	acceptance_id: string;
	task_revision: number;
	intent_content_hash: string;
	diff_hash: string;
	status: EvidenceStatus;
	actor_id: string;
	summary: string;
}

export interface TaskApprovalV2 {
	id: string;
	kind: ApprovalKind;
	authority_role: ApprovalAuthorityRole;
	task_revision: number;
	intent_content_hash: string;
	diff_hash: string;
	actor_id: string;
	summary: string;
}

export interface TaskHistoryEntryV2 {
	id: string;
	at: string;
	type: string;
	from_phase: TaskPhase;
	to_phase: TaskPhase;
	reason: string;
	authority?: AuthorityAuditDescriptorV2;
}

export interface TaskRecordV2 {
	contract: typeof TASK_RECORD_CONTRACT_V2;
	task_id: string;
	intent_revision: number;
	intent_snapshot: TaskIntentV1;
	intent_ref: TaskIntentRefV1;
	phase: TaskPhase;
	baseline: string;
	evidence: TaskEvidenceV2[];
	findings: TaskFinding[];
	approvals: TaskApprovalV2[];
	history: TaskHistoryEntryV2[];
}

export interface TaskProjectionV2 extends CompletionDecision {
	contract: "assurance_kernel/projection/v2";
	task_id: string;
	intent_revision: number;
	phase: TaskPhase;
	blocked: boolean;
	next_action: KernelNextAction;
}

export type IntentRevisionClass =
	| "unchanged"
	| "compatible"
	| "breaking";

// ---------------------------------------------------------------------------
// R2C2 additive TaskAction v2, authority audit, and branded mutation result.
// ---------------------------------------------------------------------------

export const TASK_RECORD_CONTRACT_V2_MUTATION = "assurance_kernel/task_action/v2" as const;

export type MutationAuthorityKindV2 = "review" | "qa" | "user";

export interface AuthorityAuditDescriptorV2 {
	authority_kind: MutationAuthorityKindV2;
	actor_id: string;
	confirmation_ref: string;
	issued_at: string;
	expires_at: string;
}

export interface TaskActionV2Base {
	event_id: string;
	at: string;
	actor_id: string;
	expected_record_hash: string;
	expected_workspace_hash: string;
	diff_hash: string;
}

export type TaskActionV2 =
	| (TaskActionV2Base & { type: "record_evidence"; evidence: TaskEvidenceV2 })
	| (TaskActionV2Base & { type: "record_finding"; finding: TaskFinding })
	| (TaskActionV2Base & { type: "resolve_finding"; finding_id: string })
	| (TaskActionV2Base & { type: "record_approval"; approval: TaskApprovalV2 })
	| (TaskActionV2Base & { type: "record_user_approval"; approval: TaskApprovalV2 })
	| (TaskActionV2Base & {
			type: "revise_intent";
			next_intent: TaskIntentV1;
			next_intent_ref: TaskIntentRefV1;
	  })
	| (TaskActionV2Base & {
			type: "approve_breaking_intent_revision";
			next_intent: TaskIntentV1;
			next_intent_ref: TaskIntentRefV1;
	  })
	| (TaskActionV2Base & { type: "submit_review" })
	| (TaskActionV2Base & { type: "request_rework"; findings: TaskFinding[] })
	| (TaskActionV2Base & { type: "complete" })
	| (TaskActionV2Base & { type: "stop"; reason: string })
	| (TaskActionV2Base & { type: "resolve_user_decision"; finding_id: string; resolution: string });

export const PRIVILEGED_ACTION_V2_KINDS: Record<
	MutationAuthorityKindV2,
	ReadonlySet<TaskActionV2["type"]>
> = {
	review: new Set<TaskActionV2["type"]>(["record_approval"]),
	qa: new Set<TaskActionV2["type"]>(["record_approval"]),
	user: new Set<TaskActionV2["type"]>([
		"record_user_approval",
		"approve_breaking_intent_revision",
		"stop",
		"resolve_user_decision",
	]),
};

/** Branded, non-serializable reducer v2 result. */
export const REDUCED_MUTATION_BRAND = Symbol("assurance-kernel-reduced-mutation-v2");

export interface ReducedTaskMutationV2 {
	readonly [REDUCED_MUTATION_BRAND]: true;
	readonly record: TaskRecordV2;
	readonly next_workspace_working: string | null;
}

export interface StoredTaskMutationV2 {
	revision: string;
	record: TaskRecordV2;
	workspace: {
		revision: string;
		state: WorkspaceStateLike;
	};
}

export interface WorkspaceStateLike {
	contract: "assurance_kernel/workspace/v1";
	current_working: string | null;
}

export const MUTATION_AUTHORITY_CAPABILITY_BRAND = Symbol(
	"assurance-kernel-mutation-authority-capability",
);

export interface MutationAuthorityCapabilityV2 {
	readonly [MUTATION_AUTHORITY_CAPABILITY_BRAND]: true;
}
