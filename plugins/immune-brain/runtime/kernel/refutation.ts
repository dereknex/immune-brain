// Derived refutation liveness. One predicate shared by the reducer, the
// completion projection and the TaskRecord update invariants, so the rule that
// decides whether a refuted finding still blocks cannot drift between them.

import { createHash } from "node:crypto";
import { stableStringify } from "../canonical_json";
import type { FindingEvidence, TaskAttestationV3, TaskFinding } from "./types";

export interface RefutationIdentity {
	intent_revision: number;
	intent_content_hash: string;
	diff_hash: string;
}

export function refutationIdentity(
	record: {
		intent_snapshot: { revision: number };
		intent_ref: { content_hash: string };
	},
	diffHash: string,
): RefutationIdentity {
	return {
		intent_revision: record.intent_snapshot.revision,
		intent_content_hash: record.intent_ref.content_hash,
		diff_hash: diffHash,
	};
}

/**
 * Kernel-side derivation of a review claim's anchor. The Host parses the
 * reviewer's prose into evidence, but the digest that decides refutation
 * inheritance is recomputed from that evidence, so a caller can never bind one
 * claim's identity to another claim's bytes.
 */
export function anchorForEvidence(evidence: FindingEvidence): string {
	return `sha256:${createHash("sha256")
		.update(
			stableStringify({
				violated: evidence.violated,
				caller_chain: evidence.caller_chain,
			}),
		)
		.digest("hex")}`;
}

/**
 * Freshness of one QA attestation for one acceptance: the single rule shared
 * by the refutation predicate and the `refute_finding` transition guard.
 */
export function isFreshPassingQaAttestation(
	attestation: TaskAttestationV3 | undefined,
	acceptanceId: string,
	identity: RefutationIdentity,
): boolean {
	if (!attestation || attestation.kind !== "qa") return false;
	if (attestation.task_revision !== identity.intent_revision) return false;
	if (attestation.intent_content_hash !== identity.intent_content_hash) return false;
	if (attestation.diff_hash !== identity.diff_hash) return false;
	return attestation.acceptance_results.some(
		(result) => result.acceptance_id === acceptanceId && result.status === "passed",
	);
}

/**
 * A refutation is live only while the QA attestation it bound is still fresh
 * for the record's current intent revision, intent hash and diff identity, and
 * still passes the acceptance it was bound to. Liveness is derived here and
 * never stored, so an invalidated refutation counts as blocking again.
 */
export function refutationIsLive(
	finding: TaskFinding,
	attestations: readonly TaskAttestationV3[],
	identity: RefutationIdentity,
): boolean {
	const counterevidence = finding.counterevidence ?? null;
	if (!counterevidence?.attestation_id || !counterevidence.acceptance_id) return false;
	return isFreshPassingQaAttestation(
		attestations.find((item) => item.id === counterevidence.attestation_id),
		counterevidence.acceptance_id,
		identity,
	);
}
