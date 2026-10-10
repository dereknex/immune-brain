// Host-neutral Review submission mediation (ADR 0017).
//
// Both host adapters resolve the verdict source before the shared submit path:
// the Parent's relayed bytes when provided, or the host-observed reviewer
// receipt when the verdict is omitted. The Parent keeps exclusive trigger
// authority; only the transcription step is optional. The coordinator itself
// stays single-verdict-input and never knows where the bytes came from.

import { createHash } from "node:crypto";
import type { AssuranceCoordinator, AssuranceSubmitReviewResult, HostContext } from "./coordinator";

export function extractVerdictJson(input: unknown): Record<string, unknown> | null {
	if (typeof input === "string") {
		// Agent transport prefixes a status line to the strict JSON verdict.
		const first = input.indexOf("{");
		const last = input.lastIndexOf("}");
		const cleaned = first >= 0 && last >= first ? input.slice(first, last + 1) : "";
		if (!cleaned) return null;
		try { return JSON.parse(cleaned) as Record<string, unknown>; } catch { return null; }
	}
	if (typeof input === "object" && input !== null && !Array.isArray(input)) return input as Record<string, unknown>;
	return null;
}

function verdictFingerprint(raw: Record<string, unknown>): string {
	return JSON.stringify({
		contract: raw.contract ?? null,
		role: raw.role ?? null,
		task_id: raw.task_id ?? null,
		snapshot_digest: raw.snapshot_digest ?? null,
		decision: raw.decision ?? null,
		approval: raw.approval ?? null,
		findings: raw.findings ?? null,
	});
}

/** sha256 over the reviewer's own result bytes, bound into the review attestation. */
export function digestOfReviewerBytes(bytes: string): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** The host-observation shape both adapters supply; mirrors ClaudeReviewHost's. */
export type ReviewObservation =
	| { ok: true; receipt: { actorId: string; result: string } }
	| { ok: false; release: boolean; reason: string };

const RELEASED_REVIEW_RECOVERY =
	"Call advance_assurance to obtain a new Review reservation, then dispatch one fresh reviewer with the returned envelope unchanged";
const RETAINED_REVIEW_RECOVERY =
	"Wait for the dispatched reviewer to finish, then call submit_review again with its verdict; do not dispatch or continue another reviewer";
const MISMATCH_REVIEW_RECOVERY =
	"Resubmit without a verdict to apply the observed reviewer receipt, or resubmit the reviewer's verdict exactly as the reviewer returned it";

function withReviewRecovery(
	result: AssuranceSubmitReviewResult,
	recovery_action: string,
): AssuranceSubmitReviewResult {
	if (result.state !== "blocked" || result.code === "verdict_invalid") return result;
	return { ...result, recovery_action };
}

export async function submitMediatedReview(
	coordinator: AssuranceCoordinator,
	ctx: HostContext,
	taskId: string,
	verdictInput: unknown,
	inspect: () => ReviewObservation,
): Promise<AssuranceSubmitReviewResult> {
	// Preserve uncertain authority settlement before inspecting a released receipt.
	if (coordinator.active(taskId)?.state === "settlement_unknown") {
		return coordinator.submitReview(taskId, ctx, verdictInput);
	}
	const observed = inspect();
	if (!observed.ok) {
		if (observed.release) return withReviewRecovery(coordinator.abandonReview(taskId, observed.reason), RELEASED_REVIEW_RECOVERY);
		return { state: "blocked", reason: observed.reason, recovery_action: RETAINED_REVIEW_RECOVERY };
	}
	const receiptBytes = observed.receipt.result;
	const options = {
		receiptRecoveryAction: RETAINED_REVIEW_RECOVERY,
		reviewer_verdict_sha256: digestOfReviewerBytes(receiptBytes),
		validateReceipt: () => {
			const current = inspect();
			if (!current.ok) return current.reason;
			return current.receipt.actorId === observed.receipt.actorId && current.receipt.result === receiptBytes
				? null : "reviewer receipt changed during submission";
		},
	};
	if (verdictInput === undefined) {
		// ADR 0017: the host-observed reviewer bytes are the submission.
		if (!coordinator.isReviewVerdictValid(taskId, receiptBytes)) {
			return withReviewRecovery(coordinator.abandonReview(taskId, "reviewer receipt is not a valid verdict"), RELEASED_REVIEW_RECOVERY);
		}
		return coordinator.submitReview(taskId, ctx, receiptBytes, options);
	}
	const parentValid = coordinator.isReviewVerdictValid(taskId, verdictInput);
	if (!parentValid) return coordinator.submitReview(taskId, ctx, verdictInput);
	if (!coordinator.isReviewVerdictValid(taskId, receiptBytes)) {
		return withReviewRecovery(coordinator.abandonReview(taskId, "reviewer receipt is not a valid verdict"), RELEASED_REVIEW_RECOVERY);
	}
	const parentJson = extractVerdictJson(verdictInput);
	const receiptJson = extractVerdictJson(receiptBytes);
	if (!parentJson || !receiptJson || verdictFingerprint(parentJson) !== verdictFingerprint(receiptJson)) {
		return { state: "blocked", reason: "parent verdict does not match reviewer receipt", recovery_action: MISMATCH_REVIEW_RECOVERY };
	}
	return coordinator.submitReview(taskId, ctx, verdictInput, options);
}
