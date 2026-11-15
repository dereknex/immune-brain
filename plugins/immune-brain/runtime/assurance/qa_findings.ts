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

/** Summary prefix that marks a baseline failure also present at `base_head`. */
export const PRE_EXISTING_BASELINE_PREFIX = "pre-existing baseline failure:";

/** Digest-scoped id for a project baseline check finding; `acceptance_id` stays null. */
export function qaBaselineFindingId(checkId: string, snapshotDigest: string): string {
	return `qa-baseline-${checkId}-${attemptRef(snapshotDigest)}`;
}

function attemptRef(snapshotDigest: string): string {
	const digest8 = snapshotDigest.slice("sha256:".length, "sha256:".length + 8);
	return `${digest8}-${randomUUID().slice(0, 6)}`;
}
