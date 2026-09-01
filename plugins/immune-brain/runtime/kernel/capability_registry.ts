// Shared opaque capability registry primitive. NOT exported from kernel/index.ts.
// Each registry owns its WeakMap; capabilities are only recognized by the
// registry that issued them. No module-level singleton.

export interface CapabilityRegistryHooks<TBinding, TExpected, TValidated> {
	/** Validate the binding at issue time. Throw on invalid input. */
	validateBinding(binding: TBinding, issuedAt: string): void;
	/** Validate stored state against expected input at inspect time. Return the domain-specific validated result. */
	validateAndProject(
		state: TBinding & { issued_at: string },
		expected: TExpected,
		now: number,
	): TValidated;
}

export interface CapabilityRegistry<TBinding, TExpected, TValidated, TCapability> {
	readonly brand: symbol;
	issue(binding: TBinding, issuedAt?: string): TCapability;
	inspect(capability: TCapability, expected: TExpected, now?: number): TValidated;
	consume(capability: TCapability, expected: TExpected, now?: number): TValidated;
	isConsumed(capability: TCapability): boolean;
}

interface StoredState<TBinding> {
	binding: TBinding;
	issued_at: string;
	consumed: boolean;
}

export function createCapabilityRegistry<TBinding, TExpected, TValidated, TCapability = object>(
	capabilityBrand: symbol,
	hooks: CapabilityRegistryHooks<TBinding, TExpected, TValidated>,
	domainLabel: string,
): CapabilityRegistry<TBinding, TExpected, TValidated, TCapability> {
	const states = new WeakMap<object, StoredState<TBinding>>();
	const brand = Symbol(`${domainLabel}-registry`);

	function isCapability(value: unknown): value is TCapability {
		return (
			!!value &&
			typeof value === "object" &&
			(value as Record<symbol, unknown>)[capabilityBrand] === true &&
			(value as Record<symbol, unknown>)[brand] === true
		);
	}

	function stateOf(capability: TCapability): StoredState<TBinding> {
		const state = states.get(capability as object);
		if (!state) throw new Error(`${domainLabel} capability is not recognized by this registry`);
		return state;
	}

	return {
		brand,
		issue(binding: TBinding, issuedAt = new Date().toISOString()): TCapability {
			hooks.validateBinding(binding, issuedAt);
			const capability = Object.freeze(
				Object.defineProperties(
					{},
					{
						[capabilityBrand]: { value: true, enumerable: false, writable: false, configurable: false },
						[brand]: { value: true, enumerable: false, writable: false, configurable: false },
					},
				),
			) as TCapability;
			states.set(capability as object, { binding: { ...binding }, issued_at: issuedAt, consumed: false });
			return capability;
		},
		inspect(capability: TCapability, expected: TExpected, now = Date.now()): TValidated {
			if (!isCapability(capability))
				throw new Error(`${domainLabel} capability is not recognized by this registry`);
			const state = stateOf(capability);
			if (state.consumed) throw new Error(`${domainLabel} capability already consumed`);
			return hooks.validateAndProject(
				{ ...state.binding, issued_at: state.issued_at },
				expected,
				now,
			);
		},
		consume(capability: TCapability, expected: TExpected, now = Date.now()): TValidated {
			const validated = this.inspect(capability, expected, now);
			stateOf(capability).consumed = true;
			return validated;
		},
		isConsumed(capability: TCapability): boolean {
			return stateOf(capability).consumed;
		},
	};
}
