// P2B2 mutation authority consumption port. NOT exported from kernel/index.ts.
// Registry/application pairing: each registry owns its capability state in a
// closure-private WeakMap, and capabilities are only recognized by the
// registry that issued them. No module-level singleton and no test issuer
// exist here; the production registry/application pair is created inside the
// Pi lifecycle extension activation closure, and tests issue capabilities
// through tests/fixtures/mutation-authority-test-seam.ts.

import { createHash } from "node:crypto";

import {
	MUTATION_AUTHORITY_CAPABILITY_BRAND,
	type AuthorityAuditDescriptorV2,
	type MutationAuthorityCapabilityV2,
	type MutationAuthorityKindV2,
	type TaskActionV2,
} from "./types";

export interface CapabilityBindingV2 {
	authority_kind: MutationAuthorityKindV2;
	task_id: string;
	action_digest: string;
	expected_record_hash: string;
	intent_revision: number;
	intent_content_hash: string;
	diff_hash: string;
	actor_id: string;
	confirmation_ref: string;
	expires_at: string;
	/** Normalized findings digest required for request_rework; null for other operations. */
	findings_digest: string | null;
}

interface CapabilityState extends CapabilityBindingV2 {
	issued_at: string;
	consumed: boolean;
}

export interface ValidatedAuthorityV2 {
	audit: AuthorityAuditDescriptorV2;
	action_digest: string;
	expected_record_hash: string;
	intent_revision: number;
	intent_content_hash: string;
	diff_hash: string;
	task_id: string;
}

export interface MutationAuthorityInspection {
	task_id: string;
	action: TaskActionV2;
	expected_record_hash: string;
	intent_revision: number;
	intent_content_hash: string;
	diff_hash: string;
	/** Present only for request_rework bindings. */
	findings_digest?: string;
}

export interface MutationAuthorityRegistry {
	readonly brand: symbol;
	/** Issue one capability bound to an exact binding. Library primitive; no production caller in P2B2. */
	issue(binding: CapabilityBindingV2, issuedAt?: string): MutationAuthorityCapabilityV2;
	/** Inspect without consuming. Fails on missing, expired, mismatched, or reused capability. */
	inspect(
		capability: MutationAuthorityCapabilityV2 | undefined,
		expected: MutationAuthorityInspection,
		now?: number,
	): ValidatedAuthorityV2;
	/** Consume irreversibly. Returns the validated authority. */
	consume(
		capability: MutationAuthorityCapabilityV2,
		expected: MutationAuthorityInspection,
		now?: number,
	): ValidatedAuthorityV2;
	isConsumed(capability: MutationAuthorityCapabilityV2): boolean;
}

export function digestOfAction(action: TaskActionV2): string {
	const { expected_record_hash: _r, expected_workspace_hash: _w, diff_hash: _d, ...rest } = action;
	return createHash("sha256")
		.update(JSON.stringify(rest))
		.digest("hex");
}

export function createMutationAuthorityRegistry(): MutationAuthorityRegistry {
	const states = new WeakMap<object, CapabilityState>();
	const brand = Symbol("assurance-kernel-mutation-authority-registry");

	function isCapability(value: unknown): value is MutationAuthorityCapabilityV2 {
		return (
			!!value &&
			typeof value === "object" &&
			(value as Record<symbol, unknown>)[MUTATION_AUTHORITY_CAPABILITY_BRAND] === true &&
			(value as Record<symbol, unknown>)[brand] === true
		);
	}

	function stateOf(capability: MutationAuthorityCapabilityV2): CapabilityState {
		const state = states.get(capability);
		if (!state) throw new Error("authority capability is not recognized by this registry");
		return state;
	}

	function validateBinding(binding: CapabilityBindingV2, issuedAt: string): void {
		const missing: string[] = [];
		for (const [key, value] of Object.entries(binding)) {
			if (key === "findings_digest") continue;
			if (value === undefined || value === null || value === "") missing.push(key);
		}
		if (missing.length > 0)
			throw new Error(`authority capability binding is incomplete: ${missing.join(", ")}`);
		if (binding.findings_digest !== null && !/^sha256:[a-f0-9]{64}$/.test(binding.findings_digest))
			throw new Error("authority capability findings_digest must be a canonical sha256 hash");
		if (Number.isNaN(Date.parse(binding.expires_at)) || Date.parse(binding.expires_at) <= Date.parse(issuedAt))
			throw new Error("authority capability must have a future expiry");
	}

	return {
		brand,
		issue(binding: CapabilityBindingV2, issuedAt = new Date().toISOString()): MutationAuthorityCapabilityV2 {
			validateBinding(binding, issuedAt);
			const capability = Object.freeze(
				Object.defineProperties(
					{},
					{
						[MUTATION_AUTHORITY_CAPABILITY_BRAND]: {
							value: true,
							enumerable: false,
							writable: false,
							configurable: false,
						},
						[brand]: {
							value: true,
							enumerable: false,
							writable: false,
							configurable: false,
						},
					},
				),
			) as MutationAuthorityCapabilityV2;
			states.set(capability, {
				...binding,
				issued_at: issuedAt,
				consumed: false,
			});
			return capability;
		},
		inspect(
			capability: MutationAuthorityCapabilityV2 | undefined,
			expected: MutationAuthorityInspection,
			now = Date.now(),
		): ValidatedAuthorityV2 {
			if (!capability || !isCapability(capability))
				throw new Error("privileged action requires an opaque authority capability");
			const state = stateOf(capability);
			if (state.consumed) throw new Error("authority capability is already consumed");
			if (Date.parse(state.expires_at) <= now)
				throw new Error("authority capability has expired");
			const actionDigest = digestOfAction(expected.action);
			if (state.action_digest !== actionDigest)
				throw new Error("authority capability action digest mismatch");
			if (state.task_id !== expected.task_id)
				throw new Error("authority capability task mismatch");
			if (state.expected_record_hash !== expected.expected_record_hash)
				throw new Error("authority capability record hash mismatch");
			if (state.intent_revision !== expected.intent_revision)
				throw new Error("authority capability intent revision mismatch");
			if (state.intent_content_hash !== expected.intent_content_hash)
				throw new Error("authority capability intent hash mismatch");
			if (state.diff_hash !== expected.diff_hash)
				throw new Error("authority capability diff hash mismatch");
			if (expected.findings_digest !== undefined) {
				if (state.findings_digest === null)
					throw new Error("authority capability is not bound to findings");
				if (state.findings_digest !== expected.findings_digest)
					throw new Error("authority capability findings digest mismatch");
			}
			return {
				audit: {
					authority_kind: state.authority_kind,
					actor_id: state.actor_id,
					confirmation_ref: state.confirmation_ref,
					issued_at: state.issued_at,
					expires_at: state.expires_at,
				},
				action_digest: actionDigest,
				expected_record_hash: state.expected_record_hash,
				intent_revision: state.intent_revision,
				intent_content_hash: state.intent_content_hash,
				diff_hash: state.diff_hash,
				task_id: state.task_id,
			};
		},
		consume(
			capability: MutationAuthorityCapabilityV2,
			expected: MutationAuthorityInspection,
			now = Date.now(),
		): ValidatedAuthorityV2 {
			const validated = this.inspect(capability, expected, now);
			stateOf(capability).consumed = true;
			return validated;
		},
		isConsumed(capability: MutationAuthorityCapabilityV2): boolean {
			return stateOf(capability).consumed;
		},
	};
}
