// decide(): resolve one profile for an application point, enforce the egress
// allowlist, call exactly one provider adapter, validate its answer and return
// a result envelope or an `unavailable` reason (Spec D3-D5). It never throws;
// every `unavailable` means the caller keeps its baseline behaviour. There is
// no retry and no second profile.

import { BINDINGS_PATH, type Bindings, loadBindings, loadProfiles } from "./config.ts";
import {
	type AdapterResult,
	type ApplicationPoint,
	type DecideDeps,
	type DecideRequest,
	type DecideResult,
	type Envelope,
	isSensitiveCategory,
	type PointRegistry,
	type Profile,
	type ProviderAdapter,
	type ProviderAnswer,
	type ProviderKind,
	type Truncation,
	type Unavailable,
	unavailable,
} from "./contract.ts";
import { clefAdapter } from "./providers/clef.ts";
import { fakeAdapter } from "./providers/fake.ts";
import { POINT_REGISTRY } from "./thresholds.ts";

const DEFAULT_ADAPTERS: Partial<Record<ProviderKind, ProviderAdapter>> = { clef: clefAdapter, fake: fakeAdapter };

/** Allowed distance of a probability sum from 1. */
export const PROBABILITY_SUM_TOLERANCE = 1e-3;
/** A state that fills at least this share of the window may have been truncated (Clef truncates silently). */
export const TRUNCATION_SHARE = 0.99;

export interface ResolvedProfile {
	point: ApplicationPoint;
	profile_name: string;
	profile: Profile;
	egress: Bindings["egress"];
}

/** Steps 1-2 of the decide path: binding, then the named local profile. */
export function resolveProfile(pointId: string, deps: Pick<DecideDeps, "root" | "registry">): { ok: true; value: ResolvedProfile } | { ok: false; error: Unavailable } {
	const registry: PointRegistry = deps.registry ?? POINT_REGISTRY;
	const point = Object.hasOwn(registry, pointId) ? registry[pointId] : undefined;
	if (point === undefined) return { ok: false, error: unavailable("config_invalid", `unknown application point "${pointId}"`) };

	const bindings = loadBindings(deps.root, registry);
	if (bindings === "missing") return { ok: false, error: unavailable("no_binding", `${BINDINGS_PATH} is absent`) };
	if (!bindings.ok) return bindings;
	const bound = Object.hasOwn(bindings.value.bindings, pointId) ? bindings.value.bindings[pointId] : bindings.value.default_profile;
	if (bound === null || bound === undefined) return { ok: false, error: unavailable("no_binding", `no profile is bound to ${pointId}`) };

	const profiles = loadProfiles(deps.root);
	if (profiles === "missing") return { ok: false, error: unavailable("no_local_config", ".imm/decision-models.local.json is absent") };
	if (!profiles.ok) return profiles;
	const profile = Object.hasOwn(profiles.value, bound) ? profiles.value[bound] : undefined;
	if (profile === undefined) return { ok: false, error: unavailable("unknown_profile", `profile "${bound}" is not defined in .imm/decision-models.local.json`) };
	return { ok: true, value: { point, profile_name: bound, profile, egress: bindings.value.egress } };
}

export function truncationOf(inputTokens: number | null, contextWindow: number | null): Truncation {
	if (inputTokens === null || contextWindow === null) return "unknown";
	return inputTokens >= Math.floor(TRUNCATION_SHARE * contextWindow) ? "possible" : "none";
}

const inUnitInterval = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;

function validateAnswer(point: ApplicationPoint, answer: ProviderAnswer): Unavailable | null {
	const keys = Object.keys(answer.probabilities);
	if (keys.length !== point.options.length || !point.options.every((option) => Object.hasOwn(answer.probabilities, option))) {
		return unavailable("invalid_response", "probability keys differ from the option set");
	}
	let sum = 0;
	for (const option of point.options) {
		const p = answer.probabilities[option] as number;
		if (!inUnitInterval(p)) return unavailable("invalid_response", `probability for ${option} is outside [0, 1]`);
		sum += p;
	}
	if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) return unavailable("invalid_response", "probabilities do not sum to 1");
	if (!point.options.includes(answer.choice)) return unavailable("invalid_response", "choice is outside the option set");
	if (!inUnitInterval(answer.confidence)) return unavailable("invalid_response", "confidence is outside [0, 1]");
	return null;
}

export async function decide(request: DecideRequest, deps: DecideDeps): Promise<DecideResult> {
	try {
		const resolved = resolveProfile(request.point, deps);
		if (!resolved.ok) return resolved.error;
		const { point, profile, profile_name, egress } = resolved.value;

		if (profile.kind === "jev") return unavailable("unsupported_provider_kind", "provider kind jev has no adapter yet");
		const adapter = deps.adapters?.[profile.kind] ?? DEFAULT_ADAPTERS[profile.kind];
		if (adapter === undefined) return unavailable("unsupported_provider_kind", `provider kind ${profile.kind} has no adapter`);

		// Egress gate: before credential lookup and before any adapter call.
		if (isSensitiveCategory(point.input_category)) {
			const allowed = egress[profile.kind] ?? [];
			if (!allowed.includes(point.input_category)) {
				return unavailable("egress_denied", `input category ${point.input_category} is not enabled for provider kind ${profile.kind} in ${BINDINGS_PATH} egress`);
			}
		}

		let result: AdapterResult;
		try {
			result = await adapter({ point, profile, profile_name, request }, { env: deps.env, fetch: deps.fetch });
		} catch {
			return unavailable("provider_error", "adapter threw");
		}
		if (!result.ok) return unavailable(result.reason, result.detail);
		const answer = result.answer;
		const invalid = validateAnswer(point, answer);
		if (invalid !== null) return invalid;

		const envelope: Envelope = {
			application_point: point.id,
			question_type: point.question_type,
			option_set: [...point.options],
			probabilities: Object.fromEntries(point.options.map((option) => [option, answer.probabilities[option] as number])),
			choice: answer.choice,
			confidence: answer.confidence,
			provider_kind: profile.kind,
			profile: profile_name,
			model: answer.model,
			model_version: answer.model_version,
			threshold_set_version: point.threshold_set.version,
			input_tokens: answer.input_tokens,
			context_window: answer.context_window,
			truncation: truncationOf(answer.input_tokens, answer.context_window),
		};
		return { status: "decided", envelope };
	} catch {
		return unavailable("provider_error", "decide failed unexpectedly");
	}
}
