// P2B2 mutation authority test seam. NOT part of the packaged runtime.
// The runtime kernel exports no issuer; tests issue capabilities through a
// registry created by this fixture so runtime files contain no ForTest issuer.

import {
	createMutationAuthorityRegistry,
	type CapabilityBindingV2,
	type MutationAuthorityInspection,
	type MutationAuthorityRegistry,
	type ValidatedAuthorityV2,
} from "../../plugins/immune-brain/runtime/kernel/authority_port";

export function createTestMutationRegistry(): MutationAuthorityRegistry {
	return createMutationAuthorityRegistry();
}

export function createMutationAuthorityCapabilityForTest(
	registry: MutationAuthorityRegistry,
	binding: CapabilityBindingV2,
	issuedAt?: string,
) {
	return registry.issue(binding, issuedAt);
}

export type {
	CapabilityBindingV2,
	MutationAuthorityInspection,
	MutationAuthorityRegistry,
	ValidatedAuthorityV2,
};
