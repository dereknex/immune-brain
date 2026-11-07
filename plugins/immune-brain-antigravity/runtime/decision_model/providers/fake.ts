// Test provider (Spec D2): answers from the profile's `answers[trace_id]`,
// else `default`. Never touches the network.

import type { AdapterResult, ProviderAdapter } from "../contract.ts";

export const fakeAdapter: ProviderAdapter = async (call): Promise<AdapterResult> => {
	if (call.profile.kind !== "fake") return { ok: false, reason: "provider_error", detail: "fake adapter received a non-fake profile" };
	const trace = call.request.trace_id;
	const probabilities = (trace !== undefined ? call.profile.answers[trace] : undefined) ?? call.profile.default;
	if (probabilities === undefined) return { ok: false, reason: "provider_error", detail: "fake profile has no answer for this trace_id and no default" };
	let choice = call.point.options[0] ?? "";
	let confidence = -Infinity;
	for (const option of call.point.options) {
		const p = probabilities[option];
		if (typeof p === "number" && p > confidence) {
			choice = option;
			confidence = p;
		}
	}
	return {
		ok: true,
		answer: {
			model: "fake",
			model_version: null,
			probabilities: { ...probabilities },
			choice,
			confidence: Number.isFinite(confidence) ? confidence : 0,
			input_tokens: null,
			context_window: null,
		},
	};
};
