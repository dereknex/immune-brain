// Assurance projection: the single host-neutral, read-only current-facts
// projection that binds a task's backend claim, TaskRecord v3, workspace,
// attestations, findings, and completion facts into one closed result.
//
// This module is deliberately INTERNAL to the Kernel runtime: both host
// adapters import it statically and it is never re-exported from ./index.ts.
// Hosts consume the projection without
// reconstructing evidence/approval freshness or authorization readiness.
//
// It does not know about Pi session state, pending native Review verdicts,
// Pi lifecycle actions, TUI concepts, or presentation. It never decides
// "start QA" or "start Review"; it returns Kernel-owned facts only.

import { readBackendClaim, readTaskTombstone } from "./backend_claim";
import {
	readTaskRecordRaw,
	readAuditTaskPair,
	localRunId,
	readCommittedRecord,
	readWorkspaceStateRaw,
	reconcileKernelAuthority,
} from "./storage";
import { projectTask, resolveProjectedRisk } from "./completion";
import { readRiskFloor, type RiskFloor } from "./risk_floor";
import { inspectSpecBinding } from "./spec_binding";
import { MAX_REWORK_GRANT_ROUNDS } from "./validation";
import { taskDeliveryIdentity } from "../workspace_scope";
import { currentReviewContractHash } from "../role_prompt_bridge";
import { reviewIncompleteHistory } from "./reducer";
import type { AssuranceObligation, TaskIntentV1, TaskRecord, TaskRecordV3 } from "./types";
import type { TaskRecordV2 } from "./legacy_task_record";

export interface TaskDiffSnapshot {
	diff_hash: string;
	changed_paths: readonly string[];
}

export interface AssuranceAuthorizationReadiness {
	/**
	 * Kernel-decidable authorization readiness:
	 * - "resolve_user_decision": exactly one open unresolved-user-decision finding;
	 * - "authorize_rework": an open replan boundary can be overridden by the user;
	 * - "none": nothing uniquely decidable from Kernel facts.
	 */
	state: "resolve_user_decision" | "authorize_rework" | "authorize_review_retry" | "none";
	review_retry?: { review_contract_hash: string; previous_contract_hash: string | null };
	/** Non-null only when Kernel facts prove the authorization is blocked. */
	blocked: string | null;
	/**
	 * Present only with state "authorize_rework": the exits the literal user may
	 * choose at the open replan boundary. Both Hosts render exactly these and map
	 * each to one Kernel action, so the offer cannot drift between them.
	 */
	exits?: ReworkExitsReadiness;
}

export interface ReworkExitsReadiness {
	/** `authorize_rework` with `rounds` in this inclusive range. */
	grant_rounds: { min: number; max: number };
	/** `accept_residual_risk`; offered only when the boundary is a budget exhaustion. */
	accept_residual_risk: boolean;
	/** `approve_breaking_intent_revision`; always available. */
	replan: true;
	/** The open blocking Review findings the user would be accepting. */
	findings: Array<{ id: string; summary: string }>;
}

/** The one exit the literal user picked at the replan boundary. */
export type ReworkChoice =
	| { exit: "grant_rounds"; rounds: number }
	| { exit: "accept_residual_risk"; reason: string }
	| { exit: "replan" };

/**
 * Parse a Host's form content into a choice. Both Hosts call this, so what is
 * accepted cannot drift between them. Unknown keys, an exit the boundary does not
 * offer, an out-of-range grant and a blank reason all yield null.
 */
export function parseReworkChoice(exits: ReworkExitsReadiness, content: unknown): ReworkChoice | null {
	if (typeof content !== "object" || content === null || Array.isArray(content)) return null;
	const fields = content as Record<string, unknown>;
	const allowed = new Set(["exit", "rounds", "reason"]);
	if (Object.keys(fields).some((key) => !allowed.has(key))) return null;
	if (fields.exit === "replan") return { exit: "replan" };
	if (fields.exit === "grant_rounds") {
		const rounds = fields.rounds ?? exits.grant_rounds.min;
		if (!Number.isInteger(rounds)) return null;
		const value = rounds as number;
		if (value < exits.grant_rounds.min || value > exits.grant_rounds.max) return null;
		return { exit: "grant_rounds", rounds: value };
	}
	if (fields.exit === "accept_residual_risk") {
		if (!exits.accept_residual_risk) return null;
		const reason = typeof fields.reason === "string" ? fields.reason.trim() : "";
		return reason ? { exit: "accept_residual_risk", reason } : null;
	}
	return null;
}

/** The exits as the lines both Hosts show, so the offer reads the same everywhere. */
export function reworkExitLines(exits: ReworkExitsReadiness): string[] {
	return [
		`Exit grant_rounds: grant ${exits.grant_rounds.min}-${exits.grant_rounds.max} more Review round(s)`,
		...(exits.accept_residual_risk
			? ["Exit accept_residual_risk: accept the open Review findings below as residual risk (a reason is required)"]
			: []),
		"Exit replan: revise the Intent through approve_breaking_intent_revision",
		...(exits.findings.length > 0
			? [`Open blocking Review findings (${exits.findings.length}):`, ...exits.findings.map((finding) => `  - ${finding.id}: ${finding.summary}`)]
			: []),
	];
}

export function deriveReworkExits(record: Pick<TaskRecord, "findings">): ReworkExitsReadiness {
	const boundaries = record.findings.filter(
		(finding) => finding.kind === "replan_required" && finding.status === "open",
	);
	const findings = record.findings
		.filter(
			(finding) =>
				finding.kind === "blocking" && finding.source === "review" && finding.status === "open",
		)
		.map((finding) => ({ id: finding.id, summary: finding.summary }));
	return {
		grant_rounds: { min: 1, max: MAX_REWORK_GRANT_ROUNDS },
		accept_residual_risk:
			boundaries.length > 0 &&
			boundaries.every((finding) => finding.replan_cause === "budget_exhausted") &&
			findings.length > 0,
		replan: true,
		findings,
	};
}

export interface AssuranceProjection {
	/**
	 * The exact run this projection describes: one worktree owns one store and
	 * one active run, so the run id is the authority identity a capability must
	 * bind. Null when no run is committed.
	 */
	run_id: string | null;
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
	exits?: ReworkExitsReadiness;
}): AssuranceAuthorizationReadiness {
	if (input.open_user_decision_count === 1)
		return { state: "resolve_user_decision", blocked: null };
	if (input.open_user_decision_count > 1)
		return {
			state: "none",
			blocked: `resolve-user-decision requires exactly one open user decision; found ${input.open_user_decision_count}`,
		};
	if (input.next_obligation === "revise_intent")
		return {
			state: "authorize_rework",
			blocked: null,
			...(input.exits ? { exits: input.exits } : {}),
		};
	return { state: "none", blocked: null };
}

function emptyProjection(): AssuranceProjection {
	return {
		run_id: null,
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

// Terminal proof validates historical settlement, not the caller's live checkout.
// Current integrated delivery remains independently checked by the batch boundary.
function projectSettledTerminal(
	record: TaskRecordV3 | TaskRecord,
	recordRevision: string,
	workspaceRevision: string,
): AssuranceProjection {
	const freshAcceptanceIds = [
		...new Set(
			record.attestations
				.filter((item) => item.kind === "qa")
				.flatMap((item) => item.acceptance_results)
				.filter((item) => item.status === "passed")
				.map((item) => item.acceptance_id),
		),
	];
	const approvalKinds = [...new Set(record.attestations.map((item) => item.kind))];
	return {
		...emptyProjection(),
		record_revision: recordRevision,
		workspace_revision: workspaceRevision,
		intent_revision: record.intent_snapshot.revision,
		intent_content_hash: record.intent_ref.content_hash,
		lifecycle: record.lifecycle,
		artifact_state: "frozen",
		risk: record.intent_snapshot.risk,
		fresh_acceptance_ids: freshAcceptanceIds,
		fresh_approval_kinds: approvalKinds,
		completion_ready: record.lifecycle === "done",
	};
}

function freshApprovalKinds(
	record: TaskRecord,
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
	record: TaskRecord,
	recordRevision: string,
	workspaceRevision: string,
	snapshot: TaskDiffSnapshot,
	floor: RiskFloor,
): AssuranceProjection {
	const intent: TaskIntentV1 = record.intent_snapshot;
	const decision = projectTask(
		intent,
		record,
		snapshot.diff_hash,
		record.intent_ref.content_hash,
		snapshot.changed_paths,
		floor,
	);
	const approvalKinds = freshApprovalKinds(record, record.intent_ref.content_hash, snapshot.diff_hash);
	const incomplete = decision.next_obligation === "run_review" && record.artifact_state === "frozen"
		? reviewIncompleteHistory(record.history, { intent_content_hash: record.intent_ref.content_hash, diff_hash: snapshot.diff_hash })
		: null;
	const retryContract = incomplete?.count === 2 && !incomplete.retry_authorized ? currentReviewContractHash() : null;
	const retryAuthorization: AssuranceAuthorizationReadiness | null = retryContract && retryContract !== incomplete?.last_contract_hash
		? { state: "authorize_review_retry", blocked: null, review_retry: { review_contract_hash: retryContract, previous_contract_hash: incomplete?.last_contract_hash ?? null } }
		: null;
	const openUserDecisionCount = record.findings.filter(
		(finding) => finding.kind === "unresolved_user_decision" && finding.status === "open",
	).length;
	return {
		// Filled by the caller from the committed run row.
		run_id: null,
		record_revision: recordRevision,
		workspace_revision: workspaceRevision,
		intent_revision: record.intent_snapshot.revision,
		intent_content_hash: record.intent_ref.content_hash,
		diff_hash: snapshot.diff_hash,
		lifecycle: record.lifecycle,
		artifact_state: record.artifact_state,
		risk: resolveProjectedRisk(intent, snapshot.changed_paths, floor),
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
		authorization: !inspectSpecBinding(intent).ok
			? { state: "none", blocked: "invalid Spec binding requires a valid breaking intent revision" }
			: retryAuthorization ?? deriveAssuranceAuthorization({
			next_obligation: decision.next_obligation,
			open_user_decision_count: openUserDecisionCount,
			exits: deriveReworkExits(record),
		}),
	};
}

/**
 * One closed read-only projection for a task. The injected diffProvider keeps
 * this module free of git/worktree concerns; hosts supply it from their own
 * task-scope diff implementation. When no provider is supplied the shared
 * delivery identity selector (workspace_scope.taskDeliveryIdentity) computes
 * it; a supplied provider still overrides it (I5).
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
	diffProvider: (root: string, record: TaskRecord) => TaskDiffSnapshot = taskDeliveryIdentity,
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
				// A terminal proof keyed by task id may have been exported by
				// another worktree's run of this same task: it is that run's
				// evidence, not a conflict with this worktree's own run. The local
				// store decides, and an active local run keeps its authority.
				if (authority.state === "active_owner") {
					// fall through: the local run owns this task here
				} else if (authority.state === "repairable_stale_claim")
					return fail(`task ${taskId} has a repairable stale backend claim`, claim);
				else
					return fail(
						authority.diagnostic ?? `authority state conflicts for ${taskId}`,
						claim,
					);
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
			read = await readTaskRecordRaw(root, taskId);
		} catch (error) {
			if (!terminalOwner || !(error instanceof Error) || !error.message.startsWith("TaskRecord v2")) throw error;
			return fail(error instanceof Error ? error.message : String(error));
		}
		if (!read.record) {
			if (!terminalOwner) return fail(`task ${taskId} has no TaskRecord v3`, claim);
			const committedRunId = reconcileKernelAuthority(root, taskId).owner_run_id;
			// The store keeps the terminal record itself, so a settled task projects
			// from committed facts even while its audit export is still in flight.
			const committed = await readCommittedRecord(root, taskId);
			if (committed) {
				const workspace = await readWorkspaceStateRaw(root);
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: {
						...projectSettledTerminal(committed.record, committed.revision, workspace.revision),
						run_id: committedRunId,
					},
				};
			}
			// Run-aware: with a local run row the store already answered above;
			// without one (a fresh clone or pre-run-layout evidence) only the
			// resolved pair may serve, never another run's directory by drift.
			const auditPair = await readAuditTaskPair(root, taskId, localRunId(root, taskId) ?? undefined);
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
				projection: projectSettledTerminal(auditPair.record, auditPair.recordRevision, workspace.revision),
			};
		}
		if (read.record.task_id !== taskId)
			return fail(`task record identity is inconsistent for ${taskId}`, claim);
		if (claim && read.record.lifecycle !== "active")
			return fail(`terminal task ${taskId} has no matching tombstone proof`, claim);
		const workspace = await readWorkspaceStateRaw(root);
		const snapshot = diffProvider(root, read.record);
		return {
			contract: "assurance_kernel/assurance_projection/v1",
			task_id: taskId,
			error: null,
			claim,
			projection: {
				...projectFromRecord(read.record, read.revision, workspace.revision, snapshot, readRiskFloor(root)),
				run_id: reconcileKernelAuthority(root, taskId).owner_run_id,
			},
		};
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error));
	}
}
