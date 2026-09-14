// One frozen table is the only producer of batch-gate reason and recovery prose.
// Both Host adapters render from it, so a condition reads identically on either
// Host by construction rather than because two copies still agree. The table is
// Host-neutral: it names no Host, no SDK, and no transport.
//
// Deliberately NOT in this table: a Host's own transport prose, which names that
// Host's interaction form — Pi's interactive-TUI refusal and its missing-port
// message, Claude's MCP elicitation refusal — and a transport error's own
// `message`/`recoveryAction`, which the transport owns. Those stay in the
// adapter that owns the transport.

export type BatchReasonKey =
	| "invalid_slug"
	| "batch_state_unreadable"
	| "claim_already_active"
	| "git_head_unreadable"
	| "branch_already_exists"
	| "git_status_unreadable"
	| "working_tree_dirty"
	| "authorized_scope_underivable"
	| "working_tree_unstaged"
	| "working_tree_out_of_scope"
	| "empty_enrollable_set"
	| "plan_projection_failed"
	| "confirmation_port_unavailable"
	| "confirmation_timed_out"
	| "confirmation_cancelled"
	| "confirmation_declined"
	| "confirmation_no_decision"
	| "confirmation_failed"
	| "claim_appeared_during_confirmation"
	| "plan_became_unreadable"
	| "plan_changed"
	| "repository_became_unreadable"
	| "head_moved"
	| "cancelled_before_execution"
	| "batch_run_rejected";

export interface BatchReasonSpec {
	readonly state: "rejected" | "cancelled" | "blocked";
	/** A fixed sentence, or a template given the condition's own detail. */
	readonly reason: string | ((detail: string) => string);
	readonly recovery_action: string;
}

export const BATCH_REASONS: Readonly<Record<BatchReasonKey, BatchReasonSpec>> = Object.freeze({
	invalid_slug: {
		state: "rejected",
		reason: (detail: string) => `invalid initiative slug: ${detail}`,
		recovery_action: "specify a valid initiative slug and retry in the current Host",
	},
	batch_state_unreadable: {
		state: "blocked",
		reason: (detail: string) => `batch run state is unreadable or invalid: ${detail}`,
		recovery_action: "resolve or remove the invalid batch state file, then retry in the current Host",
	},
	claim_already_active: {
		state: "blocked",
		reason: (detail: string) => `an active workspace claim already exists for task: ${detail}`,
		recovery_action: "resolve or stop the active task before starting a batch in the current Host",
	},
	git_head_unreadable: {
		state: "rejected",
		reason: (detail: string) => detail,
		recovery_action: "commit working changes and ensure a committed Git HEAD exists in the current Host",
	},
	branch_already_exists: {
		state: "rejected",
		reason: (detail: string) => `branch preflight failed: branch refs/heads/${detail} already exists`,
		recovery_action: "delete or rename the conflicting branch, or commit working changes in the current Host",
	},
	git_status_unreadable: {
		state: "rejected",
		reason: "branch preflight failed: git status is unreadable",
		recovery_action: "check the repository integrity and retry in the current Host",
	},
	working_tree_dirty: {
		state: "rejected",
		reason: "branch preflight failed: working tree is dirty",
		recovery_action: "delete or rename the conflicting branch, or commit working changes in the current Host",
	},
	authorized_scope_underivable: {
		state: "rejected",
		reason: "branch preflight failed: cannot derive the in-flight child's authorized scope",
		recovery_action: "resolve the child's intent record, then retry in the current Host",
	},
	working_tree_unstaged: {
		state: "rejected",
		reason: "branch preflight failed: working tree has unstaged or untracked changes",
		recovery_action: "stage the in-flight changes with git add, then retry in the current Host",
	},
	working_tree_out_of_scope: {
		state: "rejected",
		reason: "branch preflight failed: working tree has changes outside the authorized child scope",
		recovery_action: "commit or unstage changes outside the active task scope, then retry in the current Host",
	},
	empty_enrollable_set: {
		state: "rejected",
		reason: "empty enrollable child set: no enrollable child tasks found in the initiative plan",
		recovery_action: "ensure the initiative has uncompleted, non-critical child tasks in the current Host",
	},
	plan_projection_failed: {
		state: "rejected",
		reason: (detail: string) => `failed to project batch plan: ${detail}`,
		recovery_action: "review initiative issues and planning sidecars in the current Host",
	},
	confirmation_port_unavailable: {
		state: "rejected",
		reason: "native confirmation port is unavailable",
		recovery_action: "retry through a fresh native gate in the current Host",
	},
	confirmation_timed_out: {
		state: "rejected",
		reason: "native confirmation timed out waiting for user interaction",
		recovery_action: "retry through a fresh native gate in the current Host",
	},
	confirmation_cancelled: {
		state: "cancelled",
		reason: "native interaction cancelled",
		recovery_action: "wait for a fresh literal-user request",
	},
	confirmation_declined: {
		state: "rejected",
		reason: "native interaction declined",
		recovery_action: "wait for a fresh literal-user request",
	},
	confirmation_no_decision: {
		state: "rejected",
		reason: "native interaction returned no decision",
		recovery_action: "retry through a fresh native gate in the current Host",
	},
	confirmation_failed: {
		state: "rejected",
		reason: (detail: string) => detail,
		recovery_action: "retry through a fresh native gate in the current Host",
	},
	claim_appeared_during_confirmation: {
		state: "blocked",
		reason: (detail: string) => `an active workspace claim appeared during confirmation for task: ${detail}`,
		recovery_action: "resolve or stop the active task before starting a batch in the current Host",
	},
	plan_became_unreadable: {
		state: "rejected",
		reason: "batch plan became unreadable after native confirmation",
		recovery_action: "review the current workspace and retry through a fresh native gate in the current Host",
	},
	plan_changed: {
		state: "rejected",
		reason: "batch plan changed after native confirmation",
		recovery_action: "review the current workspace and retry through a fresh native gate in the current Host",
	},
	repository_became_unreadable: {
		state: "rejected",
		reason: "Git repository became unreadable after native confirmation",
		recovery_action: "review the current workspace and retry through a fresh native gate in the current Host",
	},
	head_moved: {
		state: "rejected",
		reason: "Git HEAD moved after native confirmation",
		recovery_action: "review the current workspace and retry through a fresh native gate in the current Host",
	},
	cancelled_before_execution: {
		state: "cancelled",
		reason: "user cancelled before batch execution",
		recovery_action: "wait for a fresh literal-user request",
	},
	batch_run_rejected: {
		state: "rejected",
		// The runner owns the specific reason; the fallback is this entry's own text.
		reason: (detail: string) => detail || "batch run rejected",
		recovery_action: "delete or rename the conflicting branch, or commit working changes and retry in the current Host",
	},
});

export interface BatchReason {
	state: "rejected" | "cancelled" | "blocked";
	reason: string;
	recovery_action: string;
}

/** Resolve one key into the envelope fields both Hosts return. */
export function batchReason(key: BatchReasonKey, detail = ""): BatchReason {
	const spec = BATCH_REASONS[key];
	return {
		state: spec.state,
		reason: typeof spec.reason === "function" ? spec.reason(detail) : spec.reason,
		recovery_action: spec.recovery_action,
	};
}
