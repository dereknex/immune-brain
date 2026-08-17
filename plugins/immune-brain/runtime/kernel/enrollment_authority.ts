// P2B1 enrollment authority. NOT exported from kernel/index.ts.
// Explicit registry factory: each registry owns its WeakMap; capabilities are
// only recognized by the registry that issued them. No module-level singleton.
// The production registry is created only inside the Pi extension activation
// closure; tests create isolated registries via the fixture seam.

import { MUTATION_AUTHORITY_CAPABILITY_BRAND } from "./types";

export const ENROLLMENT_CAPABILITY_BRAND = Symbol.for("assurance-kernel.enrollment-capability-brand");

export interface EnrollmentCapabilityBinding {
	task_id: string;
	intent_path: string;
	intent_revision: number;
	intent_content_hash: string;
	preparation_digest: string;
	// Compatibility mirror fields: retained for claim schema continuity but
	// never read as authority after v4 storage retirement.
	readiness_digest: string;
	evidence_digest: string;
	waiver_gate: string;
	actor_id: string;
	confirmation_ref: string;
	expires_at: string;
	nonce: string;
}

interface EnrollmentCapabilityState extends EnrollmentCapabilityBinding {
	issued_at: string;
	consumed: boolean;
}

export interface ValidatedEnrollment {
	task_id: string;
	intent_path: string;
	intent_revision: number;
	intent_content_hash: string;
	preparation_digest: string;
	readiness_digest: string;
	evidence_digest: string;
	waiver_gate: string;
	actor_id: string;
	confirmation_ref: string;
	issued_at: string;
	expires_at: string;
	nonce: string;
}

export interface EnrollmentAuthorityRegistry {
	readonly brand: symbol;
	/** Issue one capability bound to an exact binding. Library primitive. */
	issue(binding: EnrollmentCapabilityBinding, issuedAt?: string): object;
	inspect(capability: object, expected: EnrollmentCapabilityBinding, now?: number): ValidatedEnrollment;
	consume(capability: object, expected: EnrollmentCapabilityBinding, now?: number): ValidatedEnrollment;
	isConsumed(capability: object): boolean;
}

export function createEnrollmentAuthorityRegistry(): EnrollmentAuthorityRegistry {
	const states = new WeakMap<object, EnrollmentCapabilityState>();
	const brand = Symbol.for("assurance-kernel.enrollment-capability-registry");

	function isEnrollmentCapability(value: unknown): value is object {
		return (
			!!value &&
			typeof value === "object" &&
			(value as Record<symbol, unknown>)[ENROLLMENT_CAPABILITY_BRAND] === true &&
			(value as Record<symbol, unknown>)[brand] === true
		);
	}

	function stateOf(capability: object): EnrollmentCapabilityState {
		const state = states.get(capability);
		if (!state) throw new Error("enrollment capability is not recognized by this registry");
		return state;
	}

	return {
		brand,
		issue(binding: EnrollmentCapabilityBinding, issuedAt = new Date().toISOString()): object {
			const missing: string[] = [];
			for (const [key, value] of Object.entries(binding)) {
				if (value === undefined || value === null || value === "") missing.push(key);
			}
			if (missing.length > 0)
				throw new Error(`enrollment capability binding is incomplete: ${missing.join(", ")}`);
			if (Number.isNaN(Date.parse(binding.expires_at)) || Date.parse(binding.expires_at) <= Date.parse(issuedAt))
				throw new Error("enrollment capability must have a future expiry");
			const capability = Object.freeze(
				Object.defineProperties(
					{},
					{
						[ENROLLMENT_CAPABILITY_BRAND]: { value: true, enumerable: false, writable: false, configurable: false },
						[brand]: { value: true, enumerable: false, writable: false, configurable: false },
					},
				),
			);
			states.set(capability, { ...binding, issued_at: issuedAt, consumed: false });
			return capability;
		},
		inspect(capability: object, expected: EnrollmentCapabilityBinding, now = Date.now()): ValidatedEnrollment {
			if (!isEnrollmentCapability(capability)) throw new Error("enrollment capability required");
			const state = stateOf(capability);
			if (state.consumed) throw new Error("enrollment capability already consumed");
			if (Date.parse(state.expires_at) <= now) throw new Error("enrollment capability has expired");
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
				readiness_digest: state.readiness_digest,
				evidence_digest: state.evidence_digest,
				waiver_gate: state.waiver_gate,
				actor_id: state.actor_id,
				confirmation_ref: state.confirmation_ref,
				issued_at: state.issued_at,
				expires_at: state.expires_at,
				nonce: state.nonce,
			};
		},
		consume(capability: object, expected: EnrollmentCapabilityBinding, now = Date.now()): ValidatedEnrollment {
			const validated = this.inspect(capability, expected, now);
			stateOf(capability).consumed = true;
			return validated;
		},
		isConsumed(capability: object): boolean {
			return stateOf(capability).consumed;
		},
	};
}
