// Claude Code native-gate vocabulary (Spec docs/specs/host-neutral-adapter-core.spec.md
// D7). The table, the error and the entropy live in
// `../host-core/interaction`; this module keeps the Claude name for the
// confirmation reference the Kernel records.
//
// Interface: the shared native-gate exports, plus `confirmationRef`.
// Invariants: one `NativeAuthorityError` definition serves both Hosts.
// Side Effects: none.
// Verification: `bun test tests/claude-host-authority.test.ts -t 'confirmation refs'`.

import { hostConfirmationRef, type ConfirmationRefInput } from "../host-core/interaction";

export * from "../host-core/interaction";

/** The Claude Code confirmation reference: a `claude-` prefix over the shared digest. */
export function confirmationRef(input: ConfirmationRefInput): string {
	return hostConfirmationRef("claude", input);
}
