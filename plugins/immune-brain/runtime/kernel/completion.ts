import type {
	ApprovalKind,
	CompletionDecision,
	TaskIntent,
	TaskProjection,
	TaskProjectionV2,
	TaskRecord,
	TaskRecordV2,
	TaskIntentV1,
} from "./types";
import { assertKernelInvariants, assertKernelInvariantsV2 } from "./validation";

const REQUIRED_APPROVALS: Record<TaskIntent["risk"], ApprovalKind[]> = {
	routine: [],
	material: ["review"],
	critical: ["qa", "review", "user"],
};

function hasDistinctAuthorityAssignment(
	required: ApprovalKind[],
	candidates: TaskRecord["approvals"],
	index = 0,
	usedActors = new Set<string>(),
): boolean {
	if (index >= required.length) return true;
	for (const approval of candidates.filter(
		(item) => item.kind === required[index],
	)) {
		if (usedActors.has(approval.actor_id)) continue;
		const nextActors = new Set(usedActors);
		nextActors.add(approval.actor_id);
		if (hasDistinctAuthorityAssignment(required, candidates, index + 1, nextActors))
			return true;
	}
	return false;
}

export function completionDecision(
	intent: TaskIntent,
	record: TaskRecord,
	currentDiffHash: string,
): CompletionDecision {
	assertKernelInvariants(intent, record);
	const freshEvidence = record.evidence.filter(
		(item) =>
			item.status === "passed" &&
			item.task_revision === intent.revision &&
			item.diff_hash === currentDiffHash,
	);
	const freshAcceptanceIds = intent.acceptance
		.map((item) => item.id)
		.filter((id) => freshEvidence.some((evidence) => evidence.acceptance_id === id));
	const freshAcceptanceSet = new Set(freshAcceptanceIds);
	const missingAcceptanceIds = intent.acceptance
		.map((item) => item.id)
		.filter((id) => !freshAcceptanceSet.has(id));
	const staleEvidenceIds = record.evidence
		.filter(
			(item) =>
				item.task_revision !== intent.revision ||
				item.diff_hash !== currentDiffHash,
		)
		.map((item) => item.id);

	const requiredApprovalKinds = REQUIRED_APPROVALS[intent.risk];
	const executorIds = new Set(freshEvidence.map((item) => item.actor_id));
	const freshApprovalContext = record.approvals.filter(
		(item) =>
			item.task_revision === intent.revision &&
			item.diff_hash === currentDiffHash &&
			requiredApprovalKinds.includes(item.kind),
	);
	const selfApprovalIds = new Set(
		freshApprovalContext
			.filter((item) => executorIds.has(item.actor_id))
			.map((item) => item.id),
	);
	const independentCandidates = freshApprovalContext.filter(
		(item) => !selfApprovalIds.has(item.id),
	);
	const missingApprovalKinds = requiredApprovalKinds.filter(
		(kind) => !independentCandidates.some((approval) => approval.kind === kind),
	);
	const separationFailure =
		missingApprovalKinds.length === 0 &&
		!hasDistinctAuthorityAssignment(
			requiredApprovalKinds,
			independentCandidates,
		);
	const repeatedAuthorityActors = new Set<string>();
	if (separationFailure) {
		for (const approval of independentCandidates) {
			const actorKinds = new Set(
				independentCandidates
					.filter((candidate) => candidate.actor_id === approval.actor_id)
					.map((candidate) => candidate.kind),
			);
			if (actorKinds.size > 1) repeatedAuthorityActors.add(approval.actor_id);
		}
	}
	const independenceViolations = freshApprovalContext
		.filter(
			(item) =>
				selfApprovalIds.has(item.id) ||
				repeatedAuthorityActors.has(item.actor_id),
		)
		.map((item) => item.id);

	const blockingFindingIds = record.findings
		.filter((item) => item.status === "open" && item.kind === "blocking")
		.map((item) => item.id);
	const unresolvedUserDecisionIds = record.findings
		.filter(
			(item) =>
				item.status === "open" && item.kind === "unresolved_user_decision",
		)
		.map((item) => item.id);
	const replanRequiredIds = record.findings
		.filter((item) => item.status === "open" && item.kind === "replan_required")
		.map((item) => item.id);

	return {
		complete:
			missingAcceptanceIds.length === 0 &&
			missingApprovalKinds.length === 0 &&
			blockingFindingIds.length === 0 &&
			unresolvedUserDecisionIds.length === 0 &&
			replanRequiredIds.length === 0 &&
			independenceViolations.length === 0,
		fresh_acceptance_ids: freshAcceptanceIds,
		missing_acceptance_ids: missingAcceptanceIds,
		stale_evidence_ids: staleEvidenceIds,
		missing_approval_kinds: missingApprovalKinds,
		blocking_finding_ids: blockingFindingIds,
		unresolved_user_decision_ids: unresolvedUserDecisionIds,
		replan_required_ids: replanRequiredIds,
		independence_violations: independenceViolations,
	};
}

export function projectTask(
	intent: TaskIntent,
	record: TaskRecord,
	currentDiffHash: string,
): TaskProjection {
	const decision = completionDecision(intent, record, currentDiffHash);
	const blocked =
		decision.blocking_finding_ids.length > 0 ||
		decision.unresolved_user_decision_ids.length > 0 ||
		decision.replan_required_ids.length > 0;
	let nextAction: TaskProjection["next_action"] = null;
	if (record.phase === "working") {
		if (decision.unresolved_user_decision_ids.length > 0)
			nextAction = "resolve_user_decision";
		else if (decision.blocking_finding_ids.length > 0)
			nextAction = "resolve_findings";
		else nextAction = "submit_review";
	} else if (record.phase === "review") {
		if (decision.replan_required_ids.length > 0)
			nextAction = "revise_intent";
		else if (decision.unresolved_user_decision_ids.length > 0)
			nextAction = "resolve_user_decision";
		else if (decision.blocking_finding_ids.length > 0)
			nextAction = "request_rework";
		else if (decision.missing_acceptance_ids.length > 0)
			nextAction = "record_evidence";
		else if (
			decision.missing_approval_kinds.length > 0 ||
			decision.independence_violations.length > 0
		)
			nextAction = "record_approval";
		else if (decision.complete) nextAction = "complete";
	}
	return {
		contract: "assurance_kernel/projection/v1",
		task_id: record.task_id,
		intent_revision: record.intent_revision,
		phase: record.phase,
		blocked,
		next_action: nextAction,
		...decision,
	};
}

// ---------------------------------------------------------------------------
// P2C1 additive TaskRecord v2 completion/projection APIs.
// v1 APIs above remain byte-for-byte unchanged.
// ---------------------------------------------------------------------------

export function completionDecisionV2(
	intent: TaskIntentV1,
	record: TaskRecordV2,
	currentDiffHash: string,
	currentIntentContentHash: string,
): CompletionDecision {
	assertKernelInvariantsV2(intent, record);
	const freshEvidence = record.evidence.filter(
		(item) =>
			item.status === "passed" &&
			item.task_revision === intent.revision &&
			item.intent_content_hash === currentIntentContentHash &&
			item.diff_hash === currentDiffHash,
	);
	const freshAcceptanceIds = intent.acceptance
		.map((item) => item.id)
		.filter((id) => freshEvidence.some((evidence) => evidence.acceptance_id === id));
	const freshAcceptanceSet = new Set(freshAcceptanceIds);
	const missingAcceptanceIds = intent.acceptance
		.map((item) => item.id)
		.filter((id) => !freshAcceptanceSet.has(id));
	const staleEvidenceIds = record.evidence
		.filter(
			(item) =>
				item.task_revision !== intent.revision ||
				item.intent_content_hash !== currentIntentContentHash ||
				item.diff_hash !== currentDiffHash,
		)
		.map((item) => item.id);

	const requiredApprovalKinds = REQUIRED_APPROVALS[intent.risk];
	const executorIds = new Set(freshEvidence.map((item) => item.actor_id));
	const freshApprovalContext = record.approvals.filter(
		(item) =>
			item.task_revision === intent.revision &&
			item.intent_content_hash === currentIntentContentHash &&
			item.diff_hash === currentDiffHash &&
			requiredApprovalKinds.includes(item.kind),
	);
	const selfApprovalIds = new Set(
		freshApprovalContext
			.filter((item) => executorIds.has(item.actor_id))
			.map((item) => item.id),
	);
	const independentCandidates = freshApprovalContext.filter(
		(item) => !selfApprovalIds.has(item.id),
	);
	const missingApprovalKinds = requiredApprovalKinds.filter(
		(kind) => !independentCandidates.some((approval) => approval.kind === kind),
	);
	const separationFailure =
		missingApprovalKinds.length === 0 &&
		!hasDistinctAuthorityAssignment(
			requiredApprovalKinds,
			independentCandidates,
		);
	const repeatedAuthorityActors = new Set<string>();
	if (separationFailure) {
		for (const approval of independentCandidates) {
			const actorKinds = new Set(
				independentCandidates
					.filter((candidate) => candidate.actor_id === approval.actor_id)
					.map((candidate) => candidate.kind),
			);
			if (actorKinds.size > 1) repeatedAuthorityActors.add(approval.actor_id);
		}
	}
	const independenceViolations = freshApprovalContext
		.filter(
			(item) =>
				selfApprovalIds.has(item.id) ||
				repeatedAuthorityActors.has(item.actor_id),
		)
		.map((item) => item.id);

	const blockingFindingIds = record.findings
		.filter((item) => item.status === "open" && item.kind === "blocking")
		.map((item) => item.id);
	const unresolvedUserDecisionIds = record.findings
		.filter(
			(item) =>
				item.status === "open" && item.kind === "unresolved_user_decision",
		)
		.map((item) => item.id);
	const replanRequiredIds = record.findings
		.filter((item) => item.status === "open" && item.kind === "replan_required")
		.map((item) => item.id);

	return {
		complete:
			missingAcceptanceIds.length === 0 &&
			missingApprovalKinds.length === 0 &&
			blockingFindingIds.length === 0 &&
			unresolvedUserDecisionIds.length === 0 &&
			replanRequiredIds.length === 0 &&
			independenceViolations.length === 0,
		fresh_acceptance_ids: freshAcceptanceIds,
		missing_acceptance_ids: missingAcceptanceIds,
		stale_evidence_ids: staleEvidenceIds,
		missing_approval_kinds: missingApprovalKinds,
		blocking_finding_ids: blockingFindingIds,
		unresolved_user_decision_ids: unresolvedUserDecisionIds,
		replan_required_ids: replanRequiredIds,
		independence_violations: independenceViolations,
	};
}

export function projectTaskV2(
	intent: TaskIntentV1,
	record: TaskRecordV2,
	currentDiffHash: string,
	currentIntentContentHash: string,
): TaskProjectionV2 {
	const decision = completionDecisionV2(
		intent,
		record,
		currentDiffHash,
		currentIntentContentHash,
	);
	const blocked =
		decision.blocking_finding_ids.length > 0 ||
		decision.unresolved_user_decision_ids.length > 0 ||
		decision.replan_required_ids.length > 0;
	let nextAction: TaskProjectionV2["next_action"] = null;
	if (record.phase === "working") {
		if (decision.unresolved_user_decision_ids.length > 0)
			nextAction = "resolve_user_decision";
		else if (decision.blocking_finding_ids.length > 0)
			nextAction = "resolve_findings";
		else nextAction = "submit_review";
	} else if (record.phase === "review") {
		if (decision.replan_required_ids.length > 0)
			nextAction = "revise_intent";
		else if (decision.unresolved_user_decision_ids.length > 0)
			nextAction = "resolve_user_decision";
		else if (decision.blocking_finding_ids.length > 0)
			nextAction = "request_rework";
		else if (decision.missing_acceptance_ids.length > 0)
			nextAction = "record_evidence";
		else if (
			decision.missing_approval_kinds.length > 0 ||
			decision.independence_violations.length > 0
		)
			nextAction = "record_approval";
		else if (decision.complete) nextAction = "complete";
	}
	return {
		contract: "assurance_kernel/projection/v2",
		task_id: record.task_id,
		intent_revision: record.intent_revision,
		phase: record.phase,
		blocked,
		next_action: nextAction,
		...decision,
	};
}
