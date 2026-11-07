// Which authority operation a Host may request is Kernel projection policy, not
// Host policy: the Kernel's own readiness is the sole source. Both Hosts derive
// the operation here, so the derivation cannot drift between them — Claude used
// to re-implement this mapping inline.

import type { AssuranceAuthorizationReadiness } from "./kernel/assurance_projection";

export type DerivedAuthorizationOperation =
	| "resolve-user-decision"
	| "authorize-rework"
	| "authorize-review-retry";

export function reviewRetryNotice(retry: NonNullable<AssuranceAuthorizationReadiness["review_retry"]>): string {
	return `Authorize exactly one additional Review of this frozen snapshot under contract ${retry.review_contract_hash}. Previous contract: ${retry.previous_contract_hash ?? "unknown (legacy history; contract change cannot be verified)"}. Preserve all incomplete history and QA; this does not approve Review or permit implementation changes.`;
}

// Kernel projection is the sole source of authorization readiness.
export function deriveAuthorizationOperation(input: {
	readiness: AssuranceAuthorizationReadiness;
}): { operation: DerivedAuthorizationOperation } | { blocked: string } {
	if (input.readiness.state === "resolve_user_decision") return { operation: "resolve-user-decision" };
	if (input.readiness.state === "authorize_review_retry") return { operation: "authorize-review-retry" };
	if (input.readiness.state === "authorize_rework") return { operation: "authorize-rework" };
	if (input.readiness.blocked) return { blocked: input.readiness.blocked };
	return { blocked: "no unique host-derived authorization operation" };
}
