/**
 * Kernel Enrollment confirmation membrane (ADR 0005, ADR 0019): `user_session`
 * is the interactive literal-user gate. `external_approval` is the opt-in
 * headless `imm-kernel approve` seam (ADR 0043 Slice 2): the Kernel reads no
 * configuration, so the caller states whether the resolved `external_approval`
 * permission key enables it, and anything short of an explicit `true` fails
 * closed. ADR 0043 retired the Loop daemon's unattended `tracker_approval` and
 * `policy_auto` sources, so naming either one is refused like any other
 * unknown source.
 *
 * This module holds only the membrane itself, split out of
 * `enrollment_authority.ts` so that file stays the thin capability-registry
 * adapter its line budget guards. `enrollment_authority.ts` re-exports the
 * surface: enrollment code and tests read the confirmation contract there.
 */

/** One Enrollment confirmation request, as the caller states it. */
export type EnrollmentConfirmationInput =
	| { source: "user_session" }
	| { source: "external_approval"; external_approval_enabled?: boolean };

export type EnrollmentConfirmationVerdict = { ok: true } | { ok: false; reason: string };

/**
 * The membrane. It is decided in code before the capability is consumed and
 * calls no model or network; a source arriving from untyped input is checked
 * at runtime, so a retired source fails closed. The risk tier does not change
 * the verdict: an enabled `external_approval` admits routine, material and
 * critical intents alike.
 */
export function verifyEnrollmentConfirmation(
	_root: string,
	input: EnrollmentConfirmationInput,
	_intent: { risk: string; scope_hint: readonly string[] },
): EnrollmentConfirmationVerdict {
	const source = (input as { source?: unknown }).source;
	if (source === "user_session") return { ok: true };
	if (source === "external_approval") {
		return (input as { external_approval_enabled?: unknown }).external_approval_enabled === true
			? { ok: true }
			: { ok: false, reason: "external_approval_disabled" };
	}
	return { ok: false, reason: `unknown_confirmation_source: ${String(source)}` };
}
