// Clef adapter over Workers AI REST (Spec D5).
//
// Request and inner response shape: https://developers.cloudflare.com/workers-ai/models/clef/
// (schema-input.json / schema-output.json, fetched 2026-11-01).
// The `{ result, success, errors, messages }` wrapper every v4 REST call returns:
// https://developers.cloudflare.com/workers-ai/get-started/rest-api/ (fetched 2026-11-01).
//
// Details returned to callers never carry the token, the account id, or the
// response body.

import type { AdapterResult, ProviderAdapter } from "../contract.ts";

export const CLEF_DEFAULT_CONTEXT_WINDOW = 65536;
export const CLEF_DEFAULT_TIMEOUT_MS = 30000;

export function clefEndpoint(accountId: string): string {
	return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/@cf/cloudflare/clef`;
}

const TIMEOUT = Symbol("timeout");

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(reason: "provider_error" | "invalid_response" | "credential_missing", detail: string): AdapterResult {
	return { ok: false, reason, detail };
}

export const clefAdapter: ProviderAdapter = async (call, deps): Promise<AdapterResult> => {
	const profile = call.profile;
	if (profile.kind !== "clef") return fail("provider_error", "clef adapter received a non-clef profile");
	const accountId = deps.env[profile.account_id_env];
	if (!accountId) return fail("credential_missing", `environment variable ${profile.account_id_env} is not set`);
	const token = deps.env[profile.token_env];
	if (!token) return fail("credential_missing", `environment variable ${profile.token_env} is not set`);

	const point = call.point;
	const body = {
		model: profile.model,
		state: call.request.state,
		questions: {
			[point.id]: { type: "choice", instructions: point.instructions, criteria: { ...point.criteria } },
		},
	};

	// One deadline covers the request and the body read; racing it also covers
	// a fetch implementation that ignores the abort signal.
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<typeof TIMEOUT>((resolve) => {
		timer = setTimeout(() => {
			controller.abort();
			resolve(TIMEOUT);
		}, profile.timeout_ms ?? CLEF_DEFAULT_TIMEOUT_MS);
	});

	let status: number;
	let text: string;
	try {
		const response = await Promise.race([
			deps.fetch(clefEndpoint(accountId), {
				method: "POST",
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal: controller.signal,
			}),
			deadline,
		]);
		if (response === TIMEOUT) return fail("provider_error", "timeout");
		status = response.status;
		const read = await Promise.race([response.text(), deadline]);
		if (read === TIMEOUT) return fail("provider_error", "timeout");
		text = read;
	} catch (error) {
		if (controller.signal.aborted) return fail("provider_error", "timeout");
		const name = error instanceof Error ? error.name : "error";
		return fail("provider_error", `request failed (${name})`);
	} finally {
		clearTimeout(timer);
	}

	if (status < 200 || status > 299) return fail("provider_error", `HTTP ${status}`);
	let wrapper: unknown;
	try {
		wrapper = JSON.parse(text);
	} catch {
		return fail("invalid_response", "response is not JSON");
	}
	if (!isObject(wrapper)) return fail("invalid_response", "response is not an object");
	if (wrapper.success !== true) return fail("provider_error", "success: false");
	const result = wrapper.result;
	if (!isObject(result)) return fail("invalid_response", "result is missing");
	if (typeof result.model !== "string") return fail("invalid_response", "result.model is missing");
	const answers = result.answers;
	if (!isObject(answers)) return fail("invalid_response", "result.answers is missing");
	const answer = answers[point.id];
	if (!isObject(answer)) return fail("invalid_response", `answers.${point.id} is missing`);
	if (answer.type !== "choice") return fail("invalid_response", `answers.${point.id}.type is not choice`);
	if (typeof answer.choice !== "string") return fail("invalid_response", `answers.${point.id}.choice is missing`);
	if (typeof answer.confidence !== "number") return fail("invalid_response", `answers.${point.id}.confidence is missing`);
	if (!isObject(answer.probabilities)) return fail("invalid_response", `answers.${point.id}.probabilities is missing`);
	const probabilities: Record<string, number> = {};
	for (const [option, p] of Object.entries(answer.probabilities)) {
		if (typeof p !== "number") return fail("invalid_response", `answers.${point.id}.probabilities.${option} is not a number`);
		probabilities[option] = p;
	}
	const usage = result.usage;
	const inputTokens = isObject(usage) && typeof usage.input_tokens === "number" ? usage.input_tokens : null;

	return {
		ok: true,
		answer: {
			model: result.model,
			model_version: null,
			probabilities,
			choice: answer.choice,
			confidence: answer.confidence,
			input_tokens: inputTokens,
			context_window: profile.context_window ?? CLEF_DEFAULT_CONTEXT_WINDOW,
		},
	};
};
