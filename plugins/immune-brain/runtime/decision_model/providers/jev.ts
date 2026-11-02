// Jev (TypeSafe System One) adapter (decision-models S3, BR-DEC-5).
//
// UNVERIFIED against TypeSafe's reference. The route `<base_url>/v1/systemone`,
// the Clef-shaped request body and the Clef-shaped choice result are taken from
// third-party pages; the sources and what they did not confirm are recorded in
// tests/fixtures/decision-eval/a14/README.md. A response that does not match
// the Clef choice result shape surfaces as `unavailable`, never as a decision.
//
// Details returned to callers never carry the API key or the response body.

import type { AdapterResult, ProviderAdapter } from "../contract.ts";

export const JEV_DEFAULT_BASE_URL = "https://api.typesafe.ai";
export const JEV_DEFAULT_TIMEOUT_MS = 30000;
/** Request `model` value; identical to the Clef adapter body for the `clef` model. */
export const JEV_REQUEST_MODEL = "clef";

export function jevEndpoint(baseUrl: string = JEV_DEFAULT_BASE_URL): string {
	return `${baseUrl.replace(/\/+$/, "")}/v1/systemone`;
}

const TIMEOUT = Symbol("timeout");

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(reason: "provider_error" | "invalid_response" | "credential_missing", detail: string): AdapterResult {
	return { ok: false, reason, detail };
}

export const jevAdapter: ProviderAdapter = async (call, deps): Promise<AdapterResult> => {
	const profile = call.profile;
	if (profile.kind !== "jev") return fail("provider_error", "jev adapter received a non-jev profile");
	const apiKey = deps.env[profile.api_key_env];
	if (!apiKey) return fail("credential_missing", `environment variable ${profile.api_key_env} is not set`);

	const point = call.point;
	const body = {
		model: JEV_REQUEST_MODEL,
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
		}, profile.timeout_ms ?? JEV_DEFAULT_TIMEOUT_MS);
	});

	let status: number;
	let text: string;
	try {
		const response = await Promise.race([
			deps.fetch(jevEndpoint(profile.base_url), {
				method: "POST",
				headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
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
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return fail("invalid_response", "response is not JSON");
	}
	if (!isObject(parsed)) return fail("invalid_response", "response is not an object");
	if (parsed.success === false) return fail("provider_error", "success: false");
	// Accept the bare Clef result or the `{ result }` wrapper Workers AI adds.
	const result = isObject(parsed.result) ? parsed.result : parsed;
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
			context_window: profile.context_window ?? null,
		},
	};
};
