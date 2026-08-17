// P2B1 test-only enrollment capability seam.
// Tests create isolated registries via createEnrollmentAuthorityRegistry and
// issue capabilities through this fixture. Never shipped: excluded by packlist
// (tests/ is outside the package files).

import type { EnrollmentAuthorityRegistry } from "../../plugins/immune-brain/runtime/kernel/enrollment_authority";
import type { EnrollmentCapabilityBinding } from "../../plugins/immune-brain/runtime/kernel/enrollment_authority";

/**
 * Issue a capability bound to an exact binding through a caller-owned
 * registry. Test-only; production issuance happens exclusively inside the Pi
 * extension activation closure through the same registry interface.
 */
export function createTestEnrollmentCapability(
	registry: EnrollmentAuthorityRegistry,
	binding: EnrollmentCapabilityBinding,
	issuedAt = new Date().toISOString(),
): object {
	return registry.issue(binding, issuedAt);
}
