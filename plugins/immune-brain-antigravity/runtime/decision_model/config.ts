// Parsers shared by the layered configuration resolver and decision models.
// Credentials appear only as environment variable names.
import {
	type ClefProfile,
	type FakeProfile,
	type JevProfile,
	isProviderKind,
	type ProbabilityMap,
	type Profile,
	type ProviderKind,
	type SensitiveCategory,
	type Unavailable,
	unavailable,
} from "./contract.ts";

/** The label parse errors name: profiles live only in the user file's `decision_models.profiles`. */
const PROFILES_LABEL = "decision_models.profiles";

/** The decision-model egress allowance per provider kind. */
export type Egress = Partial<Record<ProviderKind, SensitiveCategory[]>>;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: Unavailable };

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(file: string, why: string): { ok: false; error: Unavailable } {
	return { ok: false, error: unavailable("config_invalid", `${file}: ${why}`) };
}

function unknownKey(obj: JsonObject, allowed: readonly string[]): string | null {
	for (const key of Object.keys(obj)) if (!allowed.includes(key)) return key;
	return null;
}

const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

export function parseProfiles(raw: unknown): Parsed<Record<string, Profile>> {
	const file = PROFILES_LABEL;
	if (!isObject(raw)) return invalid(file, "top level must be an object");
	const extra = unknownKey(raw, ["profiles"]);
	if (extra !== null) return invalid(file, `unknown key "${extra}"`);
	if (!isObject(raw.profiles)) return invalid(file, "profiles must be an object");
	const profiles: Record<string, Profile> = {};
	for (const [name, value] of Object.entries(raw.profiles)) {
		const parsed = parseProfile(name, value);
		if (!parsed.ok) return parsed;
		profiles[name] = parsed.value;
	}
	return { ok: true, value: profiles };
}

function parseProfile(name: string, raw: unknown): Parsed<Profile> {
	const file = PROFILES_LABEL;
	const where = `profiles.${name}`;
	if (!isObject(raw)) return invalid(file, `${where} must be an object`);
	if (!isProviderKind(raw.kind)) return invalid(file, `${where}.kind is not a known provider kind`);
	switch (raw.kind) {
		case "clef":
			return parseClefProfile(where, raw);
		case "fake":
			return parseFakeProfile(where, raw);
		case "jev":
			return parseJevProfile(where, raw);
	}
}

function parseClefProfile(where: string, raw: JsonObject): Parsed<ClefProfile> {
	const file = PROFILES_LABEL;
	const extra = unknownKey(raw, ["kind", "model", "account_id_env", "token_env", "context_window", "timeout_ms"]);
	if (extra !== null) return invalid(file, `${where}: unknown key "${extra}"`);
	if (raw.model !== "clef" && raw.model !== "clef-flash") return invalid(file, `${where}.model must be "clef" or "clef-flash"`);
	if (!nonEmptyString(raw.account_id_env)) return invalid(file, `${where}.account_id_env must name an environment variable`);
	if (!nonEmptyString(raw.token_env)) return invalid(file, `${where}.token_env must name an environment variable`);
	const profile: ClefProfile = { kind: "clef", model: raw.model, account_id_env: raw.account_id_env, token_env: raw.token_env };
	if (raw.context_window !== undefined) {
		if (!Number.isInteger(raw.context_window) || (raw.context_window as number) <= 0) return invalid(file, `${where}.context_window must be a positive integer`);
		profile.context_window = raw.context_window as number;
	}
	if (raw.timeout_ms !== undefined) {
		const t = raw.timeout_ms;
		if (!Number.isInteger(t) || (t as number) < 1000 || (t as number) > 120000) return invalid(file, `${where}.timeout_ms must be an integer in 1000..120000`);
		profile.timeout_ms = t as number;
	}
	return { ok: true, value: profile };
}

function parseJevProfile(where: string, raw: JsonObject): Parsed<JevProfile> {
	const file = PROFILES_LABEL;
	const extra = unknownKey(raw, ["kind", "api_key_env", "base_url", "context_window", "timeout_ms"]);
	if (extra !== null) return invalid(file, `${where}: unknown key "${extra}"`);
	if (!nonEmptyString(raw.api_key_env)) return invalid(file, `${where}.api_key_env must name an environment variable`);
	const profile: JevProfile = { kind: "jev", api_key_env: raw.api_key_env };
	if (raw.base_url !== undefined) {
		const baseUrl = raw.base_url;
		let url: URL | null = null;
		if (nonEmptyString(baseUrl)) {
			try {
				url = new URL(baseUrl);
			} catch {}
		}
		if (!nonEmptyString(baseUrl) || url === null || (url.protocol !== "https:" && url.protocol !== "http:") || url.username !== "" || url.password !== "") {
			return invalid(file, `${where}.base_url must be an http(s) URL without credentials`);
		}
		profile.base_url = baseUrl;
	}
	if (raw.context_window !== undefined) {
		if (!Number.isInteger(raw.context_window) || (raw.context_window as number) <= 0) return invalid(file, `${where}.context_window must be a positive integer`);
		profile.context_window = raw.context_window as number;
	}
	if (raw.timeout_ms !== undefined) {
		const t = raw.timeout_ms;
		if (!Number.isInteger(t) || (t as number) < 1000 || (t as number) > 120000) return invalid(file, `${where}.timeout_ms must be an integer in 1000..120000`);
		profile.timeout_ms = t as number;
	}
	return { ok: true, value: profile };
}

function parseProbabilityMap(value: unknown): ProbabilityMap | null {
	if (!isObject(value)) return null;
	const out: ProbabilityMap = {};
	for (const [key, p] of Object.entries(value)) {
		if (typeof p !== "number") return null;
		out[key] = p;
	}
	return out;
}

function parseFakeProfile(where: string, raw: JsonObject): Parsed<FakeProfile> {
	const file = PROFILES_LABEL;
	const extra = unknownKey(raw, ["kind", "answers", "default"]);
	if (extra !== null) return invalid(file, `${where}: unknown key "${extra}"`);
	if (!isObject(raw.answers)) return invalid(file, `${where}.answers must be an object`);
	const answers: Record<string, ProbabilityMap> = {};
	for (const [trace, map] of Object.entries(raw.answers)) {
		const parsed = parseProbabilityMap(map);
		if (parsed === null) return invalid(file, `${where}.answers.${trace} must map options to numbers`);
		answers[trace] = parsed;
	}
	const profile: FakeProfile = { kind: "fake", answers };
	if (raw.default !== undefined) {
		const parsed = parseProbabilityMap(raw.default);
		if (parsed === null) return invalid(file, `${where}.default must map options to numbers`);
		profile.default = parsed;
	}
	return { ok: true, value: profile };
}
