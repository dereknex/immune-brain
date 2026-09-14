// Which authority operation a Host may request is Kernel projection policy, not
// Host policy: the Kernel's own readiness is the sole source. Both Hosts derive
// the operation here, so the derivation cannot drift between them — Claude used
// to re-implement this mapping inline.

import type { AssuranceAuthorizationReadiness } from "./kernel/assurance_projection";

export type DerivedAuthorizationOperation =
	| "resolve-user-decision"
	| "authorize-rework";

// Kernel projection is the sole source of authorization readiness.
export function deriveAuthorizationOperation(input: {
	readiness: AssuranceAuthorizationReadiness;
}): { operation: DerivedAuthorizationOperation } | { blocked: string } {
	if (input.readiness.state === "resolve_user_decision") return { operation: "resolve-user-decision" };
	if (input.readiness.state === "authorize_rework") return { operation: "authorize-rework" };
	if (input.readiness.blocked) return { blocked: input.readiness.blocked };
	return { blocked: "no unique host-derived authorization operation" };
}
