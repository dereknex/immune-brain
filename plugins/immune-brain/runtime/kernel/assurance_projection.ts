// Assurance projection: the single host-neutral, read-only current-facts
// projection that binds a task's backend claim, TaskRecord v2, workspace,
// evidence, approvals, findings, and completion facts into one closed result.
//
// This module is deliberately INTERNAL to the Kernel runtime: it is imported
// by the Pi extension only through the structural runtime-stub adapter and is
// never re-exported from ./index.ts. Hosts consume the projection without
// reconstructing evidence/approval freshness or authorization readiness.
//
// It does not know about Pi session state, pending native Review verdicts,
// Pi lifecycle actions, TUI concepts, or presentation. It never decides
// "start QA" or "start Review"; it returns Kernel-owned facts only.

import { readBackendClaim, readTaskTombstone } from "./backend_claim";
import { readTaskRecordV2, readWorkspaceStateRaw } from "./storage";
import { projectTaskV2 } from "./completion";
import type { TaskIntentV1, TaskRecordV2 } from "./types";

export interface AssuranceAuthorizationReadiness {
	/**
	 * Kernel-decidable authorization readiness:
	 * - "resolve_user_decision": exactly one open unresolved-user-decision finding;
	 * - "record_user_approval": critical task in review phase with fresh qa and
	 *   review approvals and no fresh user approval;
	 * - "none": nothing uniquely decidable from Kernel facts.
	 * A pending Pi native Review verdict is a session fact and is NOT visible
	 * here; the host composes it before this readiness.
	 */
	state: "resolve_user_decision" | "record_user_approval" | "none";
	/** Non-null only when Kernel facts prove the authorization is blocked. */
	blocked: string | null;
}

export interface AssuranceProjection {
	record_revision: string;
	workspace_revision: string;
	intent_revision: number;
	intent_content_hash: string;
	diff_hash: string;
	phase: string;
	fresh_acceptance_ids: string[];
	missing_acceptance_ids: string[];
	stale_evidence_ids: string[];
	fresh_approval_kinds: string[];
	missing_approval_kinds: string[];
	blocking_finding_ids: string[];
	unresolved_user_decision_ids: string[];
	replan_required_ids: string[];
	independence_violations: string[];
	open_user_decision_count: number;
	completion_ready: boolean;
	authorization: AssuranceAuthorizationReadiness;
}

export interface AssuranceProjectionResult {
	contract: "assurance_kernel/assurance_projection/v1";
	task_id: string;
	error: string | null;
	claim: { task_id: string; lifecycle_status: string } | null;
	projection: AssuranceProjection;
}

export function deriveAssuranceAuthorization(input: {
	risk: string;
	phase: string;
	fresh_approval_kinds: readonly string[];
	open_user_decision_count: number;
}): AssuranceAuthorizationReadiness {
	if (input.open_user_decision_count === 1)
		return { state: "resolve_user_decision", blocked: null };
	if (input.open_user_decision_count > 1)
		return {
			state: "none",
			blocked: `resolve-user-decision requires exactly one open user decision; found ${input.open_user_decision_count}`,
		};
	if (
		input.risk === "critical" &&
		input.phase === "review" &&
		input.fresh_approval_kinds.includes("qa") &&
		input.fresh_approval_kinds.includes("review") &&
		!input.fresh_approval_kinds.includes("user")
	)
		return { state: "record_user_approval", blocked: null };
	return { state: "none", blocked: null };
}

function emptyProjection(): AssuranceProjection {
	return {
		record_revision: "",
		workspace_revision: "",
		intent_revision: 0,
		intent_content_hash: "",
		diff_hash: "",
		phase: "",
		fresh_acceptance_ids: [],
		missing_acceptance_ids: [],
		stale_evidence_ids: [],
		fresh_approval_kinds: [],
		missing_approval_kinds: [],
		blocking_finding_ids: [],
		unresolved_user_decision_ids: [],
		replan_required_ids: [],
		independence_violations: [],
		open_user_decision_count: 0,
		completion_ready: false,
		authorization: { state: "none", blocked: null },
	};
}

function freshApprovalKinds(
	record: TaskRecordV2,
	currentIntentContentHash: string,
	diffHash: string,
): string[] {
	const kinds: string[] = [];
	const seen = new Set<string>();
	for (const approval of record.approvals) {
		if (
			approval.task_revision !== record.intent_revision ||
			approval.intent_content_hash !== currentIntentContentHash ||
			approval.diff_hash !== diffHash
		)
			continue;
		if (seen.has(approval.kind)) continue;
		seen.add(approval.kind);
		kinds.push(approval.kind);
	}
	return kinds;
}

function projectFromRecord(
	record: TaskRecordV2,
	recordRevision: string,
	workspaceRevision: string,
	diffHash: string,
): AssuranceProjection {
	const intent: TaskIntentV1 = record.intent_snapshot;
	const decision = projectTaskV2(intent, record, diffHash, record.intent_ref.content_hash);
	const approvalKinds = freshApprovalKinds(record, record.intent_ref.content_hash, diffHash);
	const openUserDecisionCount = record.findings.filter(
		(finding) => finding.kind === "unresolved_user_decision" && finding.status === "open",
	).length;
	return {
		record_revision: recordRevision,
		workspace_revision: workspaceRevision,
		intent_revision: record.intent_revision,
		intent_content_hash: record.intent_ref.content_hash,
		diff_hash: diffHash,
		phase: record.phase,
		fresh_acceptance_ids: decision.fresh_acceptance_ids,
		missing_acceptance_ids: decision.missing_acceptance_ids,
		stale_evidence_ids: decision.stale_evidence_ids,
		fresh_approval_kinds: approvalKinds,
		missing_approval_kinds: decision.missing_approval_kinds,
		blocking_finding_ids: decision.blocking_finding_ids,
		unresolved_user_decision_ids: decision.unresolved_user_decision_ids,
		replan_required_ids: decision.replan_required_ids,
		independence_violations: decision.independence_violations,
		open_user_decision_count: openUserDecisionCount,
		completion_ready: decision.complete,
		authorization: deriveAssuranceAuthorization({
			risk: intent.risk,
			phase: record.phase,
			fresh_approval_kinds: approvalKinds,
			open_user_decision_count: openUserDecisionCount,
		}),
	};
}

/**
 * One closed read-only projection for a task. The injected diffProvider keeps
 * this module free of git/worktree concerns; hosts supply it from their own
 * task-scope diff implementation.
 *
 * Error semantics (identical to the previous host reconstruction):
 * - no backend claim            -> error null, claim null, empty projection
 * - tombstone                   -> error "task X is terminal (...); it is not reactivatable"
 * - missing record              -> error "task X has no TaskRecord v2"
 * - record identity mismatch    -> error "task record identity is inconsistent for X"
 * - claim mismatch              -> error "backend claim belongs to Y, not X"
 * - any read failure            -> error message, claim null, empty projection
 */
export async function projectAssurance(
	root: string,
	taskId: string,
	diffProvider: (root: string, intent: { scope_hint?: unknown }) => string,
): Promise<AssuranceProjectionResult> {
	try {
		const claim = await readBackendClaim(root);
		if (!claim)
			return { contract: "assurance_kernel/assurance_projection/v1", task_id: taskId, error: null, claim: null, projection: emptyProjection() };
		const read = await readTaskRecordV2(root, taskId);
		const tombstone = await readTaskTombstone(root, taskId);
		if (tombstone)
			return {
				contract: "assurance_kernel/assurance_projection/v1",
				task_id: taskId,
				error: `task ${taskId} is terminal (${tombstone.terminal_phase}); it is not reactivatable`,
				claim,
				projection: emptyProjection(),
			};
		if (!read.record)
			return {
				contract: "assurance_kernel/assurance_projection/v1",
				task_id: taskId,
				error: `task ${taskId} has no TaskRecord v2`,
				claim,
				projection: emptyProjection(),
			};
		if (read.record.task_id !== taskId)
			return {
				contract: "assurance_kernel/assurance_projection/v1",
				task_id: taskId,
				error: `task record identity is inconsistent for ${taskId}`,
				claim,
				projection: emptyProjection(),
			};
		if (claim.task_id !== taskId)
			return {
				contract: "assurance_kernel/assurance_projection/v1",
				task_id: taskId,
				error: `backend claim belongs to ${claim.task_id}, not ${taskId}`,
				claim,
				projection: emptyProjection(),
			};
		const workspace = await readWorkspaceStateRaw(root);
		const diffHash = diffProvider(root, read.record.intent_snapshot);
		return {
			contract: "assurance_kernel/assurance_projection/v1",
			task_id: taskId,
			error: null,
			claim,
			projection: projectFromRecord(read.record, read.revision, workspace.revision, diffHash),
		};
	} catch (error) {
		return {
			contract: "assurance_kernel/assurance_projection/v1",
			task_id: taskId,
			error: error instanceof Error ? error.message : String(error),
			claim: null,
			projection: emptyProjection(),
		};
	}
}
