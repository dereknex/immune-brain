import type {
	ApprovalKind,
	CompletionDecision,
	TaskAttestationV3,
	TaskIntentV1,
	TaskProjectionV3,
	TaskRecordV3,
} from "./types";
import { assertKernelInvariantsV3 } from "./validation";

const REQUIRED_ATTESTATIONS: Record<TaskIntentV1["risk"], ApprovalKind[]> = {
	routine: ["qa"],
	material: ["qa", "review"],
	critical: ["qa", "review", "user"],
};

function hasDistinctAuthorityAssignment(
	required: ApprovalKind[],
	candidates: TaskAttestationV3[],
	index = 0,
	usedActors = new Set<string>(),
): boolean {
	if (index >= required.length) return true;
	for (const attestation of candidates.filter((item) => item.kind === required[index])) {
		if (usedActors.has(attestation.actor_id)) continue;
		const nextActors = new Set(usedActors);
		nextActors.add(attestation.actor_id);
		if (hasDistinctAuthorityAssignment(required, candidates, index + 1, nextActors)) return true;
	}
	return false;
}

export function completionDecision(
	intent: TaskIntentV1,
	record: TaskRecordV3,
	currentDiffHash: string,
	currentIntentContentHash: string,
): CompletionDecision {
	assertKernelInvariantsV3(intent, record);
	const freshAttestations = record.attestations.filter(
		(item) =>
			item.task_revision === intent.revision &&
			item.intent_content_hash === currentIntentContentHash &&
			item.diff_hash === currentDiffHash,
	);
	const freshQaResults = freshAttestations
		.filter((item) => item.kind === "qa")
		.flatMap((item) => item.acceptance_results)
		.filter((item) => item.status === "passed");
	const freshAcceptanceIds = intent.acceptance
		.map((item) => item.id)
		.filter((id) => freshQaResults.some((result) => result.acceptance_id === id));
	const freshAcceptanceSet = new Set(freshAcceptanceIds);
	const missingAcceptanceIds = intent.acceptance
		.map((item) => item.id)
		.filter((id) => !freshAcceptanceSet.has(id));
	const staleAttestationIds = record.attestations
		.filter(
			(item) =>
				item.task_revision !== intent.revision ||
				item.intent_content_hash !== currentIntentContentHash ||
				item.diff_hash !== currentDiffHash,
		)
		.map((item) => item.id);

	const requiredKinds = REQUIRED_ATTESTATIONS[intent.risk];
	const candidates = freshAttestations.filter((item) => requiredKinds.includes(item.kind));
	const missingApprovalKinds = requiredKinds.filter(
		(kind) => !candidates.some((attestation) => attestation.kind === kind),
	);
	const separationFailure =
		missingApprovalKinds.length === 0 &&
		!hasDistinctAuthorityAssignment(requiredKinds, candidates);
	const repeatedActors = new Set<string>();
	if (separationFailure) {
		for (const attestation of candidates) {
			const kinds = new Set(
				candidates
					.filter((candidate) => candidate.actor_id === attestation.actor_id)
					.map((candidate) => candidate.kind),
			);
			if (kinds.size > 1) repeatedActors.add(attestation.actor_id);
		}
	}
	const independenceViolations = candidates
		.filter((item) => repeatedActors.has(item.actor_id))
		.map((item) => item.id);

	const blockingFindingIds = record.findings
		.filter((item) => item.status === "open" && item.kind === "blocking")
		.map((item) => item.id);
	const unresolvedUserDecisionIds = record.findings
		.filter((item) => item.status === "open" && item.kind === "unresolved_user_decision")
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
		stale_attestation_ids: staleAttestationIds,
		missing_approval_kinds: missingApprovalKinds,
		blocking_finding_ids: blockingFindingIds,
		unresolved_user_decision_ids: unresolvedUserDecisionIds,
		replan_required_ids: replanRequiredIds,
		independence_violations: independenceViolations,
	};
}

export function projectTask(
	intent: TaskIntentV1,
	record: TaskRecordV3,
	currentDiffHash: string,
	currentIntentContentHash: string,
): TaskProjectionV3 {
	const decision = completionDecision(intent, record, currentDiffHash, currentIntentContentHash);
	const blocked =
		decision.blocking_finding_ids.length > 0 ||
		decision.unresolved_user_decision_ids.length > 0 ||
		decision.replan_required_ids.length > 0 ||
		decision.independence_violations.length > 0;
	let nextObligation: TaskProjectionV3["next_obligation"] = "none";
	if (record.lifecycle === "active") {
		if (decision.unresolved_user_decision_ids.length > 0) {
			nextObligation = "resolve_user_decision";
		} else if (decision.replan_required_ids.length > 0) {
			nextObligation = "revise_intent";
		} else if (decision.blocking_finding_ids.length > 0 || decision.independence_violations.length > 0) {
			nextObligation = "resolve_findings";
		} else if (record.artifact_state === "active") {
			nextObligation = "submit_assurance";
		} else if (decision.missing_acceptance_ids.length > 0 || decision.missing_approval_kinds.includes("qa")) {
			nextObligation = "run_qa";
		} else if (decision.missing_approval_kinds.includes("review")) {
			nextObligation = "run_review";
		} else if (decision.missing_approval_kinds.includes("user")) {
			nextObligation = "authorize_user";
		} else if (decision.complete) {
			nextObligation = "complete";
		}
	}
	return {
		contract: "assurance_kernel/projection/v3",
		task_id: record.task_id,
		intent_revision: record.intent_snapshot.revision,
		lifecycle: record.lifecycle,
		artifact_state: record.artifact_state,
		blocked,
		next_obligation: nextObligation,
		...decision,
	};
}
