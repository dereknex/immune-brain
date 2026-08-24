export const TASK_PHASES = ["working", "review", "done", "stopped"] as const;
export type TaskPhase = (typeof TASK_PHASES)[number];

export const TASK_LIFECYCLES = ["active", "done", "stopped"] as const;
export type TaskLifecycle = (typeof TASK_LIFECYCLES)[number];
export const TASK_ARTIFACT_STATES = ["active", "frozen"] as const;
export type TaskArtifactState = (typeof TASK_ARTIFACT_STATES)[number];

export const TASK_RISKS = ["routine", "material", "critical"] as const;
export type TaskRisk = (typeof TASK_RISKS)[number];

export type EvidenceStatus = "passed" | "failed" | "blocked";

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

export interface UserAuthorityAudit {
	actor_id: string;
	source: "literal_user";
	confirmation_ref: string;
}

export interface CompletionDecision {
	complete: boolean;
	fresh_acceptance_ids: string[];
	missing_acceptance_ids: string[];
	stale_attestation_ids: string[];
	missing_approval_kinds: ApprovalKind[];
	blocking_finding_ids: string[];
	unresolved_user_decision_ids: string[];
	replan_required_ids: string[];
	independence_violations: string[];
}

export type AssuranceObligation =
	| "resolve_findings"
	| "resolve_user_decision"
	| "revise_intent"
	| "submit_assurance"
	| "run_qa"
	| "run_review"
	| "authorize_user"
	| "complete"
	| "none";

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
export const TASK_RECORD_CONTRACT_V3 = "assurance_kernel/task_record/v3" as const;

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

export interface TaskIntentRefV3 {
	path: string;
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
	authority?: AuthorityAuditDescriptor;
}

export interface TaskAttestationV3 extends TaskApprovalV2 {
	acceptance_results: Array<{
		acceptance_id: string;
		status: EvidenceStatus;
		summary: string;
	}>;
}

export interface TaskHistoryEntryV3 {
	id: string;
	at: string;
	type: string;
	from_state: string;
	to_state: string;
	reason: string;
	authority?: AuthorityAuditDescriptor;
}

export interface TaskRecordV2 {
	contract: typeof TASK_RECORD_CONTRACT_V2;
	task_id: string;
	intent_revision: number;
	intent_snapshot: TaskIntentV1;
	intent_ref: TaskIntentRefV1;
	artifact_ref?: { state: "active" | "frozen"; spec_path?: string };
	phase: TaskPhase;
	baseline: string;
	evidence: TaskEvidenceV2[];
	findings: TaskFinding[];
	approvals: TaskApprovalV2[];
	history: TaskHistoryEntryV2[];
}

export interface TaskRecordV3 {
	contract: typeof TASK_RECORD_CONTRACT_V3;
	task_id: string;
	intent_snapshot: TaskIntentV1;
	intent_ref: TaskIntentRefV3;
	lifecycle: TaskLifecycle;
	artifact_state: TaskArtifactState;
	baseline: string;
	attestations: TaskAttestationV3[];
	findings: TaskFinding[];
	history: TaskHistoryEntryV3[];
}

export interface TaskProjectionV3 extends CompletionDecision {
	contract: "assurance_kernel/projection/v3";
	task_id: string;
	intent_revision: number;
	lifecycle: TaskLifecycle;
	artifact_state: TaskArtifactState;
	blocked: boolean;
	next_obligation: AssuranceObligation;
}

export type IntentRevisionClass =
	| "unchanged"
	| "compatible"
	| "breaking";

export const TASK_ACTION_CONTRACT = "assurance_kernel/task_action/v2" as const;

export type MutationAuthorityKind = "review" | "qa" | "user";

export interface AuthorityAuditDescriptor {
	authority_kind: MutationAuthorityKind;
	actor_id: string;
	confirmation_ref: string;
	issued_at: string;
	expires_at: string;
}

export interface TaskActionBase {
	event_id: string;
	at: string;
	actor_id: string;
	expected_record_hash: string;
	expected_workspace_hash: string;
	diff_hash: string;
}

export type TaskAction =
	| (TaskActionBase & { type: "record_finding"; finding: TaskFinding })
	| (TaskActionBase & { type: "resolve_finding"; finding_id: string })
	| (TaskActionBase & { type: "record_approval"; approval: TaskApprovalV2 })
	| (TaskActionBase & { type: "record_user_approval"; approval: TaskApprovalV2 })
	| (TaskActionBase & {
			type: "revise_intent";
			next_intent: TaskIntentV1;
			next_intent_ref: TaskIntentRefV3;
	  })
	| (TaskActionBase & {
			type: "approve_breaking_intent_revision";
			next_intent: TaskIntentV1;
			next_intent_ref: TaskIntentRefV3;
	  })
	| (TaskActionBase & { type: "request_rework"; findings: TaskFinding[] })
	| (TaskActionBase & { type: "complete" })
	| (TaskActionBase & { type: "stop"; reason: string })
	| (TaskActionBase & { type: "resolve_user_decision"; finding_id: string; resolution: string });


/** Branded, non-serializable reducer result. */
export const REDUCED_MUTATION_BRAND = Symbol("assurance-kernel-reduced-mutation-v2");

export interface ReducedTaskMutation {
	readonly [REDUCED_MUTATION_BRAND]: true;
	readonly record: TaskRecordV3;
	readonly next_workspace_working: string | null;
}

export interface StoredTaskMutationV3 {
	revision: string;
	record: TaskRecordV3;
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
