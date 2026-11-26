/**
 * Kernel Enrollment confirmation membrane (ADR 0005, ADR 0019): `user_session`,
 * the interactive literal-user gate, is the only live source. ADR 0043 retired
 * the Loop daemon's unattended `tracker_approval` and `policy_auto` sources,
 * so naming either one is refused like any other unknown source.
 *
 * This module holds only the membrane itself, split out of
 * `enrollment_authority.ts` so that file stays the thin capability-registry
 * adapter its line budget guards. `enrollment_authority.ts` re-exports the
 * surface: enrollment code and tests read the confirmation contract there.
 */

import type { EnrollmentConfirmationSource } from "./types";

/** One Enrollment confirmation request, as the caller states it. */
export interface EnrollmentConfirmationInput {
	source: EnrollmentConfirmationSource;
}

export type EnrollmentConfirmationVerdict = { ok: true } | { ok: false; reason: string };

/**
 * The membrane. It is decided in code before the capability is consumed and
 * calls no model or network; a source arriving from untyped input is checked
 * at runtime, so a retired source fails closed.
 */
export function verifyEnrollmentConfirmation(
	_root: string,
	input: EnrollmentConfirmationInput,
	_intent: { risk: string; scope_hint: readonly string[] },
): EnrollmentConfirmationVerdict {
	if ((input.source as string) === "user_session") return { ok: true };
	return { ok: false, reason: `unknown_confirmation_source: ${String(input.source)}` };
}
