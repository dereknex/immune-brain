import { randomUUID } from "node:crypto";

/**
 * QA finding ids must stay globally unique for the lifetime of a task: the
 * Kernel reducer rejects any finding id that was ever recorded, including
 * resolved ones. Scoping each id to the snapshot digest plus a per-invocation
 * suffix guarantees repeated rework attempts (even on an identical snapshot)
 * never collide, while keeping the acceptance id traceable in the id itself.
 */

/** Digest-scoped id for a per-acceptance QA rework finding. */
export function qaFindingId(acceptanceId: string, snapshotDigest: string): string {
	return `qa-${acceptanceId}-${attemptRef(snapshotDigest)}`;
}

/** Digest-scoped id for an evidence-freshness QA rework finding. */
export function qaEvidenceFreshnessId(snapshotDigest: string): string {
	const digest16 = snapshotDigest.slice("sha256:".length, "sha256:".length + 16);
	return `qa-evidence-freshness-${digest16}-${attemptRef(snapshotDigest)}`;
}

function attemptRef(snapshotDigest: string): string {
	const digest8 = snapshotDigest.slice("sha256:".length, "sha256:".length + 8);
	return `${digest8}-${randomUUID().slice(0, 6)}`;
}

/**
 * Preserve the original QA verdict details (which acceptance failed and why)
 * when applying an authority verdict fails. The raw reducer error alone masks
 * the failure reason that matters; append the verdict findings when present.
 */
export function describeQaFailure(
	boundedBase: string,
	findings?: Array<{ id: string; summary: string }>,
): string {
	if (!findings?.length) return boundedBase;
	const detail = findings.map((finding) => `${finding.id}: ${finding.summary}`).join(" | ");
	const marker = "; verdict: ";
	const totalBudget = 300;
	// Reserve room for at least the first 160 chars of verdict detail.
	const baseBudget = Math.max(0, totalBudget - marker.length - Math.min(detail.length, 160));
	const trimmedBase =
		boundedBase.length <= baseBudget
			? boundedBase
			: `${boundedBase.slice(0, Math.max(0, baseBudget - 1))}…`;
	const detailBudget = Math.max(0, totalBudget - trimmedBase.length - marker.length);
	const bounded =
		detail.length <= detailBudget ? detail : `${detail.slice(0, Math.max(0, detailBudget - 3))}...`;
	return `${trimmedBase}${marker}${bounded}`;
}
