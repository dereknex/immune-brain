// P2B1 enrollment authority. NOT exported from kernel/index.ts.
// Uses the shared capability registry factory; enrollment-specific binding
// validation and projection remain here.

import { createCapabilityRegistry } from "./capability_registry";

export const ENROLLMENT_CAPABILITY_BRAND = Symbol.for("assurance-kernel.enrollment-capability-brand");

/**
 * The two fields every capability binding shares, whichever authority issues
 * it. `nonce` is deliberately not part of this base: the enrollment and batch
 * bindings carry it for their own replay digest, while `CapabilityBindingV2`
 * uses `action_digest` instead and has no `nonce` field at all.
 */
export interface BaseCapabilityBinding {
	actor_id: string;
	confirmation_ref: string;
}

export interface EnrollmentCapabilityBinding extends BaseCapabilityBinding {
	task_id: string;
	intent_path: string;
	intent_revision: number;
	intent_content_hash: string;
	preparation_digest: string;
	nonce: string;
}

export interface ValidatedEnrollment {
	task_id: string;
	intent_path: string;
	intent_revision: number;
	intent_content_hash: string;
	preparation_digest: string;
	actor_id: string;
	confirmation_ref: string;
	issued_at: string;
	nonce: string;
}

export interface EnrollmentAuthorityRegistry {
	readonly brand: symbol;
	/** Issue one capability bound to an exact binding. Library primitive. */
	issue(binding: EnrollmentCapabilityBinding, issuedAt?: string): object;
	inspect(capability: object, expected: EnrollmentCapabilityBinding): ValidatedEnrollment;
	consume(capability: object, expected: EnrollmentCapabilityBinding): ValidatedEnrollment;
	isConsumed(capability: object): boolean;
}

export function createEnrollmentAuthorityRegistry(): EnrollmentAuthorityRegistry {
	return createCapabilityRegistry<EnrollmentCapabilityBinding, EnrollmentCapabilityBinding, ValidatedEnrollment>(
		ENROLLMENT_CAPABILITY_BRAND,
		{
			validateBinding(binding) {
				const missing: string[] = [];
				for (const [key, value] of Object.entries(binding)) {
					if (value === undefined || value === null || value === "") missing.push(key);
				}
				if (missing.length > 0)
					throw new Error(`enrollment capability binding is incomplete: ${missing.join(", ")}`);
			},
			validateAndProject(state, expected) {
				for (const key of Object.keys(expected) as Array<keyof EnrollmentCapabilityBinding>) {
					if (state[key] !== expected[key])
						throw new Error(`enrollment capability ${key} mismatch`);
				}
				return {
					task_id: state.task_id,
					intent_path: state.intent_path,
					intent_revision: state.intent_revision,
					intent_content_hash: state.intent_content_hash,
					preparation_digest: state.preparation_digest,
					actor_id: state.actor_id,
					confirmation_ref: state.confirmation_ref,
					issued_at: state.issued_at,
					nonce: state.nonce,
				};
			},
		},
		"enrollment",
	);
}
