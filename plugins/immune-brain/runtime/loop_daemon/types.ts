/**
 * Loop Daemon: Types and Schemas (S1)
 *
 * Implements S1 and D2 of docs/specs/loop-daemon.spec.md and ADR 0039.
 * Defines the state, lock, lease, and normalized events (E1-E11).
 */

export const LOOP_DAEMON_STATE_CONTRACT = "assurance_kernel/loop_daemon_state/v1" as const;
export const LOOP_DAEMON_LOCK_CONTRACT = "assurance_kernel/loop_daemon_lock/v1" as const;
export const LOOP_DAEMON_LEASE_CONTRACT = "assurance_kernel/loop_daemon_lease/v1" as const;
export const LOOP_DAEMON_EVENT_CONTRACT = "assurance_kernel/loop_daemon_event/v1" as const;
export const LOOP_DECISION_RECORD_CONTRACT = "assurance_kernel/loop_decision_record/v1" as const;
export const LOOP_ANALYSIS_CONTRACT = "assurance_kernel/loop_analysis/v1" as const;

export type LoopEventKind =
	| "E1_NEW_ISSUE"
	| "E2_ISSUE_EDITED"
	| "E3_OWNER_COMMENT"
	| "E4_PLAN_APPROVED"
	| "E5_READY_TASK"
	| "E6_LANE_DECISION_NEEDED"
	| "E7_LANE_DECISION_REPLIED"
	| "E8_PR_CHECK_FAILED"
	| "E9_PR_CONFLICT"
	| "E10_PR_REVIEW_COMMENT"
	| "E11_PR_READY_OR_MERGED";

export interface BaseLoopEvent {
	contract: typeof LOOP_DAEMON_EVENT_CONTRACT;
	event_id: string;
	kind: LoopEventKind;
	timestamp: string;
}

export interface E1NewIssueEvent extends BaseLoopEvent {
	kind: "E1_NEW_ISSUE";
	issue_number: number;
	title: string;
	body: string;
	author: string;
	labels: string[];
	created_at: string;
	updated_at: string;
	sub_issue_of?: number | null;
	blocked_by?: number[];
}

export interface E2IssueEditedEvent extends BaseLoopEvent {
	kind: "E2_ISSUE_EDITED";
	issue_number: number;
	title: string;
	body: string;
	author: string;
	labels: string[];
	updated_at: string;
	previous_updated_at?: string;
	sub_issue_of?: number | null;
	blocked_by?: number[];
}

export interface E3OwnerCommentEvent extends BaseLoopEvent {
	kind: "E3_OWNER_COMMENT";
	issue_number: number;
	comment_id: number;
	author: string;
	author_association: string;
	body: string;
	created_at: string;
	updated_at: string;
}

export interface E4PlanApprovedEvent extends BaseLoopEvent {
	kind: "E4_PLAN_APPROVED";
	issue_number: number;
	comment_id: number;
	author: string;
	author_association: string;
	plan_digest: string;
	approved_at: string;
	raw_command?: string;
}

export interface E5ReadyTaskEvent extends BaseLoopEvent {
	kind: "E5_READY_TASK";
	issue_number: number;
	task_id?: string;
	initiative_slug?: string;
	slice_id?: string;
	plan_digest?: string;
	risk?: string;
}

export interface E6LaneDecisionNeededEvent extends BaseLoopEvent {
	kind: "E6_LANE_DECISION_NEEDED";
	task_id: string;
	run_id: string;
	record_revision: string;
	question: string;
	options: Array<{ id: string; label: string }>;
	issue_number?: number;
}

export interface E7LaneDecisionRepliedEvent extends BaseLoopEvent {
	kind: "E7_LANE_DECISION_REPLIED";
	issue_number: number;
	comment_id: number;
	author: string;
	author_association: string;
	run_id: string;
	record_revision: string;
	selected_option: string;
	reply_body: string;
	task_id?: string;
}

export interface E8PRCheckFailedEvent extends BaseLoopEvent {
	kind: "E8_PR_CHECK_FAILED";
	pr_number: number;
	branch: string;
	head_sha: string;
	check_name: string;
	failure_signature: string;
	details_url?: string;
}

export interface E9PRConflictEvent extends BaseLoopEvent {
	kind: "E9_PR_CONFLICT";
	pr_number: number;
	branch: string;
	base_branch: string;
	head_sha: string;
}

export interface E10PRReviewCommentEvent extends BaseLoopEvent {
	kind: "E10_PR_REVIEW_COMMENT";
	pr_number: number;
	branch: string;
	review_id?: number;
	comment_id: number;
	author: string;
	author_association: string;
	body: string;
	path?: string;
	line?: number;
}

export interface E11PRReadyOrMergedEvent extends BaseLoopEvent {
	kind: "E11_PR_READY_OR_MERGED";
	pr_number: number;
	branch: string;
	head_sha: string;
	status: "ready" | "merged";
}

export type NormalizedLoopEvent =
	| E1NewIssueEvent
	| E2IssueEditedEvent
	| E3OwnerCommentEvent
	| E4PlanApprovedEvent
	| E5ReadyTaskEvent
	| E6LaneDecisionNeededEvent
	| E7LaneDecisionRepliedEvent
	| E8PRCheckFailedEvent
	| E9PRConflictEvent
	| E10PRReviewCommentEvent
	| E11PRReadyOrMergedEvent;

export interface LoopLease {
	contract: typeof LOOP_DAEMON_LEASE_CONTRACT;
	target_id: string;
	kind: "plan" | "drive" | "repair";
	owner_pid: number;
	host_token: string;
	worktree_path?: string;
	scope_hint?: string[];
	acquired_at: string;
	heartbeat_at: string;
	status: "active" | "parked_for_decision" | "releasing";
}

export interface LoopDaemonWatermarks {
	issues_updated_at: string | null;
	comments_updated_at: string | null;
	prs_updated_at: string | null;
	etag_by_resource: Record<string, string>;
}

export interface LoopDaemonState {
	contract: typeof LOOP_DAEMON_STATE_CONTRACT;
	updated_at: string;
	watermarks: LoopDaemonWatermarks;
	active_leases: Record<string, LoopLease>;
	paused: boolean;
	pause_reason: string | null;
	stats: {
		ticks_total: number;
		events_observed_total: number;
		last_tick_at: string | null;
		ticks_today?: number;
		dispatches_today?: number;
		dispatches_total?: number;
		today_date?: string;
	};
}

export interface LoopDaemonLock {
	contract: typeof LOOP_DAEMON_LOCK_CONTRACT;
	pid: number;
	hostname: string;
	started_at: string;
	host_token: string;
	heartbeat_at: string;
}

export interface RawIssue {
	id: number;
	number: number;
	title: string;
	body: string | null;
	state: "open" | "closed";
	created_at: string;
	updated_at: string;
	author: { login: string };
	labels?: Array<{ name: string } | string>;
	sub_issue_of?: number | null;
	blocked_by?: number[];
	comments?: RawComment[];
}

export interface RawComment {
	id: number;
	body: string;
	user: { login: string };
	author_association: string;
	created_at: string;
	updated_at: string;
}

export interface RawPRCheck {
	name: string;
	status: string;
	conclusion: string | null;
	details_url?: string;
}

export interface RawPRReview {
	id: number;
	user: { login: string };
	author_association: string;
	state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";
	body: string;
	submitted_at: string;
}

export interface RawPRReviewComment {
	id: number;
	user: { login: string };
	author_association: string;
	body: string;
	path: string;
	line?: number;
	created_at: string;
	updated_at: string;
}

export interface RawPR {
	number: number;
	title: string;
	body?: string;
	head_ref_name: string;
	head_sha: string;
	base_ref_name: string;
	state: "open" | "closed" | "merged";
	merged: boolean;
	mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
	mergeable_state?: string;
	updated_at?: string;
	merged_at?: string;
	checks?: RawPRCheck[];
	reviews?: RawPRReview[];
	review_comments?: RawPRReviewComment[];
	comments?: RawComment[];
}

export interface RawLaneDecisionFact {
	task_id: string;
	run_id: string;
	record_revision: string;
	question: string;
	options: Array<{ id: string; label: string }>;
}

export interface ObservationInput {
	issues: RawIssue[];
	pull_requests: RawPR[];
	lane_decisions?: RawLaneDecisionFact[];
	observed_at: string;
}
