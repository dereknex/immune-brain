// Assurance projection: the single host-neutral, read-only current-facts
// projection that binds a task's backend claim, TaskRecord v3, workspace,
// attestations, findings, and completion facts into one closed result.
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
import { readTaskRecord, readAuditTaskPair, readWorkspaceStateRaw, reconcileKernelAuthority } from "./storage";
import { projectTask } from "./completion";
import type { AssuranceObligation, TaskIntentV1, TaskRecordV2, TaskRecordV3 } from "./types";

export interface AssuranceAuthorizationReadiness {
	/**
	 * Kernel-decidable authorization readiness:
	 * - "resolve_user_decision": exactly one open unresolved-user-decision finding;
	 * - "record_user_approval": Kernel projects authorize_user after fresh QA
	 *   and Review attestations for a critical task;
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
	lifecycle: string;
	artifact_state: string;
	risk: TaskIntentV1["risk"] | "";
	next_obligation: AssuranceObligation;
	fresh_acceptance_ids: string[];
	missing_acceptance_ids: string[];
	stale_attestation_ids: string[];
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
	next_obligation: AssuranceObligation;
	open_user_decision_count: number;
}): AssuranceAuthorizationReadiness {
	if (input.open_user_decision_count === 1)
		return { state: "resolve_user_decision", blocked: null };
	if (input.open_user_decision_count > 1)
		return {
			state: "none",
			blocked: `resolve-user-decision requires exactly one open user decision; found ${input.open_user_decision_count}`,
		};
	if (input.next_obligation === "authorize_user")
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
		lifecycle: "",
		artifact_state: "",
		risk: "",
		next_obligation: "none",
		fresh_acceptance_ids: [],
		missing_acceptance_ids: [],
		stale_attestation_ids: [],
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

function projectHistoricalTerminal(
	record: TaskRecordV2,
	recordRevision: string,
	workspaceRevision: string,
): AssuranceProjection {
	const approvalKinds = [...new Set(record.approvals.map((item) => item.kind))];
	return {
		...emptyProjection(),
		record_revision: recordRevision,
		workspace_revision: workspaceRevision,
		intent_revision: record.intent_revision,
		intent_content_hash: record.intent_ref.content_hash,
		lifecycle: record.phase,
		artifact_state: "frozen",
		risk: record.intent_snapshot.risk,
		fresh_acceptance_ids: [...new Set(record.evidence.filter((item) => item.status === "passed").map((item) => item.acceptance_id))],
		fresh_approval_kinds: approvalKinds,
		completion_ready: record.phase === "done",
	};
}

function freshApprovalKinds(
	record: TaskRecordV3,
	currentIntentContentHash: string,
	diffHash: string,
): string[] {
	const kinds: string[] = [];
	const seen = new Set<string>();
	for (const approval of record.attestations) {
		if (
			approval.task_revision !== record.intent_snapshot.revision ||
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
	record: TaskRecordV3,
	recordRevision: string,
	workspaceRevision: string,
	diffHash: string,
): AssuranceProjection {
	const intent: TaskIntentV1 = record.intent_snapshot;
	const decision = projectTask(intent, record, diffHash, record.intent_ref.content_hash);
	const approvalKinds = freshApprovalKinds(record, record.intent_ref.content_hash, diffHash);
	const openUserDecisionCount = record.findings.filter(
		(finding) => finding.kind === "unresolved_user_decision" && finding.status === "open",
	).length;
	return {
		record_revision: recordRevision,
		workspace_revision: workspaceRevision,
		intent_revision: record.intent_snapshot.revision,
		intent_content_hash: record.intent_ref.content_hash,
		diff_hash: diffHash,
		lifecycle: record.lifecycle,
		artifact_state: record.artifact_state,
		risk: intent.risk,
		next_obligation: decision.next_obligation,
		fresh_acceptance_ids: decision.fresh_acceptance_ids,
		missing_acceptance_ids: decision.missing_acceptance_ids,
		stale_attestation_ids: decision.stale_attestation_ids,
		fresh_approval_kinds: approvalKinds,
		missing_approval_kinds: decision.missing_approval_kinds,
		blocking_finding_ids: decision.blocking_finding_ids,
		unresolved_user_decision_ids: decision.unresolved_user_decision_ids,
		replan_required_ids: decision.replan_required_ids,
		independence_violations: decision.independence_violations,
		open_user_decision_count: openUserDecisionCount,
		completion_ready: decision.complete,
		authorization: deriveAssuranceAuthorization({
			next_obligation: decision.next_obligation,
			open_user_decision_count: openUserDecisionCount,
		}),
	};
}

/**
 * One closed read-only projection for a task. The injected diffProvider keeps
 * this module free of git/worktree concerns; hosts supply it from their own
 * task-scope diff implementation.
 *
 * Error semantics:
 * - no authority facts          -> error null, claim null, empty projection
 * - matching terminal proof     -> error null, claim null, done/stopped projection
 * - repairable stale claim      -> error requiring repair_authority_state
 * - authority conflict          -> fail-closed authority diagnostic
 * - missing/mismatched record   -> fail-closed identity diagnostic
 * - any read failure            -> error message, claim null, empty projection
 */
export async function projectAssurance(
	root: string,
	taskId: string,
	diffProvider: (root: string, intent: { scope_hint?: unknown }) => string,
): Promise<AssuranceProjectionResult> {
	const fail = (
		error: string,
		claim: AssuranceProjectionResult["claim"] = null,
	): AssuranceProjectionResult => ({
		contract: "assurance_kernel/assurance_projection/v1",
		task_id: taskId,
		error,
		claim,
		projection: emptyProjection(),
	});
	try {
		const claim = readBackendClaim(root);
		let terminalOwner = false;
		if (claim?.task_id !== undefined && claim.task_id !== taskId)
			return fail(`backend claim belongs to ${claim.task_id}, not ${taskId}`, claim);
		if (claim) {
			const tombstone = readTaskTombstone(root, taskId);
			if (tombstone) {
				const authority = reconcileKernelAuthority(root, taskId);
				if (authority.state === "repairable_stale_claim")
					return fail(`task ${taskId} has a repairable stale backend claim`, claim);
				return fail(authority.diagnostic ?? `authority state conflicts for ${taskId}`, claim);
			}
		} else {
			const authority = reconcileKernelAuthority(root, taskId);
			if (authority.state === "unowned")
				return { contract: "assurance_kernel/assurance_projection/v1", task_id: taskId, error: null, claim: null, projection: emptyProjection() };
			if (authority.state !== "terminal_owner")
				return fail(authority.diagnostic ?? `authority state conflicts for ${taskId}`);
			terminalOwner = true;
			if (readBackendClaim(root)) return fail(`authority state changed while projecting ${taskId}`);
		}
		let read;
		try {
			read = await readTaskRecord(root, taskId);
		} catch (error) {
			if (!terminalOwner || !(error instanceof Error) || !error.message.startsWith("TaskRecord v2")) throw error;
			return fail(error instanceof Error ? error.message : String(error));
		}
		if (!read.record) {
			if (!terminalOwner) return fail(`task ${taskId} has no TaskRecord v3`, claim);
			const auditPair = await readAuditTaskPair(root, taskId);
			if (!auditPair) return fail(`task ${taskId} has no terminal audit pair`, claim);
			const workspace = await readWorkspaceStateRaw(root);
			if (auditPair.record.contract === "assurance_kernel/task_record/v2")
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: projectHistoricalTerminal(auditPair.record, auditPair.recordRevision, workspace.revision),
				};
			return {
				contract: "assurance_kernel/assurance_projection/v1",
				task_id: taskId,
				error: null,
				claim: null,
				projection: projectFromRecord(auditPair.record, auditPair.recordRevision, workspace.revision, diffProvider(root, auditPair.record.intent_snapshot)),
			};
		}
		if (read.record.task_id !== taskId)
			return fail(`task record identity is inconsistent for ${taskId}`, claim);
		if (claim && read.record.lifecycle !== "active")
			return fail(`terminal task ${taskId} has no matching tombstone proof`, claim);
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
		return fail(error instanceof Error ? error.message : String(error));
	}
}
