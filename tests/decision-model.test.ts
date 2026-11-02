import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { ApplicationPoint, DecideDeps, FetchLike, PointRegistry } from "../plugins/immune-brain/runtime/decision_model/contract.ts";
import { decide } from "../plugins/immune-brain/runtime/decision_model/decide.ts";
import { POINT_REGISTRY } from "../plugins/immune-brain/runtime/decision_model/thresholds.ts";

const REPO = resolve(import.meta.dir, "..");
const A14 = "a14_pr_comment_triage";
const ACCOUNT = "acct-9f3e1c";
const TOKEN = "tok-s3cr3t-value";
const ENV = { CF_ACCOUNT: ACCOUNT, CF_TOKEN: TOKEN };

const DIFF_POINT: ApplicationPoint = {
	id: "test_diff_point",
	question_type: "choice",
	input_category: "diff",
	options: ["yes", "no"],
	criteria: { yes: "Yes", no: "No" },
	instructions: "Does the diff do it?",
	threshold_set: { version: "test/v0", values: null },
};
const DIFF_REGISTRY: PointRegistry = { ...POINT_REGISTRY, [DIFF_POINT.id]: DIFF_POINT };

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function bindingsFile(over: Record<string, unknown> = {}) {
	return { contract: "immune_brain/decision_bindings/v1", default_profile: "default", bindings: {}, egress: {}, ...over };
}

function makeRoot(files: { bindings?: unknown; local?: unknown }): string {
	const root = mkdtempSync(join(tmpdir(), "decision-model-"));
	roots.push(root);
	mkdirSync(join(root, ".imm"));
	const write = (name: string, value: unknown) => writeFileSync(join(root, ".imm", name), typeof value === "string" ? value : JSON.stringify(value));
	if (files.bindings !== undefined) write("decision-bindings.json", files.bindings);
	if (files.local !== undefined) write("decision-models.local.json", files.local);
	return root;
}

const clefProfile = (over: Record<string, unknown> = {}) => ({ kind: "clef", model: "clef", account_id_env: "CF_ACCOUNT", token_env: "CF_TOKEN", ...over });
const fakeProfile = (over: Record<string, unknown> = {}) => ({ kind: "fake", answers: {}, default: { blocking: 0.7, nit: 0.2, out_of_scope: 0.05, duplicate: 0.05 }, ...over });

interface Recorded {
	url: string;
	init: RequestInit;
}

function recordingFetch(respond: () => Promise<Response> | Response = () => clefOk()): { fetch: FetchLike; calls: Recorded[] } {
	const calls: Recorded[] = [];
	return {
		calls,
		fetch: async (url, init) => {
			calls.push({ url, init });
			return respond();
		},
	};
}

function clefOk(answer: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, point = A14): Response {
	const probabilities = { blocking: 0.6, nit: 0.3, out_of_scope: 0.05, duplicate: 0.05 };
	return Response.json({
		result: {
			model: "clef",
			answers: { [point]: { type: "choice", choice: "blocking", probabilities, confidence: 0.6, ...answer } },
			usage: { input_tokens: 120 },
			...extra,
		},
		success: true,
		errors: [],
		messages: [],
	});
}

function deps(root: string, fetchImpl: FetchLike, over: Partial<DecideDeps> = {}): DecideDeps {
	return { root, env: ENV, fetch: fetchImpl, ...over };
}

describe("decide() resolution (AC1)", () => {
	test("a per-point binding wins over the default profile", async () => {
		const root = makeRoot({ bindings: bindingsFile({ default_profile: "missing", bindings: { [A14]: "chosen" } }), local: { profiles: { chosen: fakeProfile() } } });
		const result = await decide({ point: A14, state: "s" }, deps(root, recordingFetch().fetch));
		expect(result.status).toBe("decided");
		if (result.status === "decided") expect(result.envelope.profile).toBe("chosen");
	});

	test("a binding key present with null beats a non-null default", async () => {
		const root = makeRoot({ bindings: bindingsFile({ default_profile: "default", bindings: { [A14]: null } }), local: { profiles: { default: fakeProfile() } } });
		const result = await decide({ point: A14, state: "s" }, deps(root, recordingFetch().fetch));
		expect(result).toMatchObject({ status: "unavailable", reason: "no_binding" });
	});

	const cases: [string, { bindings?: unknown; local?: unknown }, string][] = [
		["default_profile null with no binding", { bindings: bindingsFile({ default_profile: null }), local: { profiles: { default: clefProfile() } } }, "no_binding"],
		["missing bindings file", { local: { profiles: { default: clefProfile() } } }, "no_binding"],
		["missing local file", { bindings: bindingsFile() }, "no_local_config"],
		["profile absent from local file", { bindings: bindingsFile(), local: { profiles: { other: clefProfile() } } }, "unknown_profile"],
		["malformed local JSON", { bindings: bindingsFile(), local: "{ not json" }, "config_invalid"],
		["malformed bindings JSON", { bindings: "{ nope", local: { profiles: { default: clefProfile() } } }, "config_invalid"],
		["unknown top-level local key", { bindings: bindingsFile(), local: { profiles: { default: clefProfile() }, extra: 1 } }, "config_invalid"],
		["unknown profile key", { bindings: bindingsFile(), local: { profiles: { default: clefProfile({ api_key: "x" }) } } }, "config_invalid"],
		["unknown top-level bindings key", { bindings: bindingsFile({ thresholds: {} }), local: { profiles: { default: clefProfile() } } }, "config_invalid"],
		["unknown application point in bindings", { bindings: bindingsFile({ bindings: { a99_nope: "default" } }), local: { profiles: { default: clefProfile() } } }, "config_invalid"],
		["unknown provider kind", { bindings: bindingsFile(), local: { profiles: { default: { kind: "gpt" } } } }, "config_invalid"],
	];
	for (const [name, files, reason] of cases) {
		test(`${name} returns ${reason} without calling fetch`, async () => {
			const root = makeRoot(files);
			const rec = recordingFetch();
			const result = await decide({ point: A14, state: "s" }, deps(root, rec.fetch));
			expect(result).toMatchObject({ status: "unavailable", reason });
			expect(rec.calls).toHaveLength(0);
		});
	}
});

describe("egress gate (AC2)", () => {
	test("an unlisted sensitive category is denied before any adapter or fetch call", async () => {
		for (const [kind, profile] of [
			["clef", clefProfile()],
			["fake", { kind: "fake", answers: {}, default: { yes: 0.9, no: 0.1 } }],
		] as const) {
			const root = makeRoot({ bindings: bindingsFile({ egress: { clef: kind === "fake" ? ["diff"] : [] } }), local: { profiles: { default: profile } } });
			const rec = recordingFetch(() => clefOk({}, {}, DIFF_POINT.id));
			let adapterCalls = 0;
			const counting = async () => {
				adapterCalls++;
				return { ok: false as const, reason: "provider_error" as const, detail: "should not run" };
			};
			const result = await decide({ point: DIFF_POINT.id, state: "diff --git" }, deps(root, rec.fetch, { registry: DIFF_REGISTRY, adapters: { [kind]: counting } }));
			expect(result).toMatchObject({ status: "unavailable", reason: "egress_denied" });
			if (result.status === "unavailable") {
				expect(result.detail).toContain("diff");
				expect(result.detail).toContain(kind);
			}
			expect(rec.calls).toHaveLength(0);
			expect(adapterCalls).toBe(0);
		}
	});

	test("listing the sensitive category for clef lets the same request reach fetch exactly once", async () => {
		const root = makeRoot({ bindings: bindingsFile({ egress: { clef: ["diff"] } }), local: { profiles: { default: clefProfile() } } });
		const rec = recordingFetch(() =>
			Response.json({ success: true, result: { model: "clef", answers: { [DIFF_POINT.id]: { type: "choice", choice: "yes", probabilities: { yes: 0.8, no: 0.2 }, confidence: 0.8 } } } }),
		);
		const result = await decide({ point: DIFF_POINT.id, state: "diff --git" }, deps(root, rec.fetch, { registry: DIFF_REGISTRY }));
		expect(result.status).toBe("decided");
		expect(rec.calls).toHaveLength(1);
	});

	test("listing a non-sensitive category in egress is config_invalid", async () => {
		const root = makeRoot({ bindings: bindingsFile({ egress: { clef: ["pr_comment"] } }), local: { profiles: { default: clefProfile() } } });
		const rec = recordingFetch();
		const result = await decide({ point: A14, state: "s" }, deps(root, rec.fetch));
		expect(result).toMatchObject({ status: "unavailable", reason: "config_invalid" });
		expect(rec.calls).toHaveLength(0);
	});

	test("listing issue_text in egress is config_invalid as a non-sensitive category", async () => {
		const root = makeRoot({ bindings: bindingsFile({ egress: { clef: ["issue_text"] } }), local: { profiles: { default: clefProfile() } } });
		const rec = recordingFetch();
		const result = await decide({ point: "a15_issue_triage", state: "s" }, deps(root, rec.fetch));
		expect(result).toMatchObject({ status: "unavailable", reason: "config_invalid" });
		expect(rec.calls).toHaveLength(0);
	});
});

describe("Clef adapter (AC3)", () => {
	const clefRoot = (over: Record<string, unknown> = {}) => makeRoot({ bindings: bindingsFile(), local: { profiles: { default: clefProfile(over) } } });

	test("a valid wrapped response yields an envelope from one exact POST", async () => {
		const rec = recordingFetch();
		const result = await decide({ point: A14, state: { target: "x" } }, deps(clefRoot(), rec.fetch));
		expect(result.status).toBe("decided");
		if (result.status === "decided") {
			expect(result.envelope).toMatchObject({ choice: "blocking", provider_kind: "clef", model: "clef", model_version: null, input_tokens: 120, context_window: 65536, truncation: "none" });
		}
		expect(rec.calls).toHaveLength(1);
		const call = rec.calls[0] as Recorded;
		expect(call.url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/cloudflare/clef`);
		expect(call.init.method).toBe("POST");
		expect((call.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
		const body = JSON.parse(call.init.body as string);
		expect(body).toEqual({
			model: "clef",
			state: { target: "x" },
			questions: { [A14]: { type: "choice", instructions: POINT_REGISTRY[A14]?.instructions, criteria: POINT_REGISTRY[A14]?.criteria } },
		});
	});

	test("an unset token env is credential_missing with zero fetch calls", async () => {
		const rec = recordingFetch();
		const result = await decide({ point: A14, state: "s" }, deps(clefRoot(), rec.fetch, { env: { CF_ACCOUNT: ACCOUNT } }));
		expect(result).toMatchObject({ status: "unavailable", reason: "credential_missing" });
		expect(rec.calls).toHaveLength(0);
	});

	const bad: [string, () => Response, string][] = [
		["HTTP 500", () => new Response("boom", { status: 500 }), "provider_error"],
		["success:false", () => Response.json({ success: false, errors: [{ message: "nope" }], result: null }), "provider_error"],
		["probability keys differing from the option set", () => clefOk({ probabilities: { blocking: 0.5, nit: 0.5 } }), "invalid_response"],
		["a probability sum of 1.002", () => clefOk({ probabilities: { blocking: 0.502, nit: 0.5, out_of_scope: 0, duplicate: 0 } }), "invalid_response"],
		["a choice outside the option set", () => clefOk({ choice: "maybe" }), "invalid_response"],
		["a missing answer for the point", () => clefOk({}, { answers: {} }), "invalid_response"],
	];
	for (const [name, respond, reason] of bad) {
		test(`${name} returns ${reason} and leaks no credential`, async () => {
			const result = await decide({ point: A14, state: "s" }, deps(clefRoot(), recordingFetch(respond).fetch));
			expect(result).toMatchObject({ status: "unavailable", reason });
			if (result.status === "unavailable") {
				expect(result.detail).not.toContain(TOKEN);
				expect(result.detail).not.toContain(ACCOUNT);
			}
		});
	}

	test("a probability sum of 1.0009 is accepted", async () => {
		const respond = () => clefOk({ probabilities: { blocking: 0.5009, nit: 0.5, out_of_scope: 0, duplicate: 0 }, confidence: 0.5009 });
		const result = await decide({ point: A14, state: "s" }, deps(clefRoot(), recordingFetch(respond).fetch));
		expect(result.status).toBe("decided");
	});

	test("a fetch that never resolves within timeout_ms is provider_error timeout", async () => {
		const never: FetchLike = () => new Promise<Response>(() => {});
		const result = await decide({ point: A14, state: "s" }, deps(clefRoot({ timeout_ms: 1000 }), never));
		expect(result).toEqual({ status: "unavailable", reason: "provider_error", detail: "timeout" });
	});

	test("truncation is possible at floor(0.99 x window) and none one token below", async () => {
		const window = 1000;
		const at = Math.floor(0.99 * window);
		for (const [tokens, expected] of [
			[at, "possible"],
			[at - 1, "none"],
		] as const) {
			const respond = () => clefOk({}, { usage: { input_tokens: tokens } });
			const result = await decide({ point: A14, state: "s" }, deps(clefRoot({ context_window: window }), recordingFetch(respond).fetch));
			expect(result.status).toBe("decided");
			if (result.status === "decided") expect(result.envelope.truncation).toBe(expected);
		}
	});

	test("a rejected fetch reports provider_error without the credential values", async () => {
		const failing: FetchLike = async (url) => {
			throw new TypeError(`connect failed for ${url} with ${TOKEN}`);
		};
		const result = await decide({ point: A14, state: "s" }, deps(clefRoot(), failing));
		expect(result).toMatchObject({ status: "unavailable", reason: "provider_error" });
		if (result.status === "unavailable") {
			expect(result.detail).not.toContain(TOKEN);
			expect(result.detail).not.toContain(ACCOUNT);
		}
	});
});

const JEV_KEY = "jev-s3cr3t-key";
const jevProfile = (over: Record<string, unknown> = {}) => ({ kind: "jev", api_key_env: "JEV_KEY", ...over });

describe("Jev adapter (BR-DEC-5)", () => {
	const jevRoot = (over: Record<string, unknown> = {}) => makeRoot({ bindings: bindingsFile(), local: { profiles: { default: jevProfile(over) } } });
	const jevDeps = (root: string, fetchImpl: FetchLike, env: Record<string, string | undefined> = { JEV_KEY }, registry?: PointRegistry) => deps(root, fetchImpl, { env, ...(registry ? { registry } : {}) });

	test("sends one Clef-shaped POST to the default endpoint and returns a jev envelope", async () => {
		const state = { target: "x" };
		const clefRec = recordingFetch();
		await decide({ point: A14, state }, deps(makeRoot({ bindings: bindingsFile(), local: { profiles: { default: clefProfile() } } }), clefRec.fetch));

		const rec = recordingFetch();
		const result = await decide({ point: A14, state }, jevDeps(jevRoot(), rec.fetch));
		expect(rec.calls).toHaveLength(1);
		const call = rec.calls[0] as Recorded;
		expect(call.url).toBe("https://api.typesafe.ai/v1/systemone");
		expect(call.init.method).toBe("POST");
		expect((call.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${JEV_KEY}`);
		expect(JSON.parse(call.init.body as string)).toEqual(JSON.parse((clefRec.calls[0] as Recorded).init.body as string));

		expect(result.status).toBe("decided");
		if (result.status !== "decided") return;
		expect(result.envelope).toMatchObject({ provider_kind: "jev", choice: "blocking", model: "clef", input_tokens: 120, context_window: null, truncation: "unknown" });
		const sum = Object.values(result.envelope.probabilities).reduce((a, b) => a + b, 0);
		expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
		expect(Object.keys(result.envelope.probabilities)).toEqual(POINT_REGISTRY[A14]?.options as string[]);
	});

	test("base_url overrides the endpoint and a bare (unwrapped) result is accepted", async () => {
		const rec = recordingFetch(() => Response.json(JSON.parse(JSON.stringify({ model: "m", answers: { [A14]: { type: "choice", choice: "nit", probabilities: { blocking: 0.1, nit: 0.7, out_of_scope: 0.1, duplicate: 0.1 }, confidence: 0.7 } } }))));
		const result = await decide({ point: A14, state: "s" }, jevDeps(jevRoot({ base_url: "https://gw.example.test/jev/" }), rec.fetch));
		expect((rec.calls[0] as Recorded).url).toBe("https://gw.example.test/jev/v1/systemone");
		expect(result.status === "decided" && result.envelope.choice).toBe("nit");
	});

	test("an unset api_key_env is credential_missing with zero fetch calls", async () => {
		const rec = recordingFetch();
		const result = await decide({ point: A14, state: "s" }, jevDeps(jevRoot(), rec.fetch, {}));
		expect(result).toMatchObject({ status: "unavailable", reason: "credential_missing" });
		expect(rec.calls).toHaveLength(0);
	});

	const bad: [string, () => Response, string, string?][] = [
		["HTTP 401", () => new Response(`denied for ${JEV_KEY}`, { status: 401 }), "provider_error", "401"],
		["a body missing the choice result", () => Response.json({ ok: true }), "invalid_response"],
		["probabilities naming an option outside the point's options", () => clefOk({ probabilities: { blocking: 0.5, nit: 0.3, out_of_scope: 0.1, maybe: 0.1 } }), "invalid_response"],
		["a non-JSON body", () => new Response(`<html>${JEV_KEY}</html>`), "invalid_response"],
	];
	for (const [name, respond, reason, detail] of bad) {
		test(`${name} returns ${reason} and leaks no credential`, async () => {
			const result = await decide({ point: A14, state: "s" }, jevDeps(jevRoot(), recordingFetch(respond).fetch));
			expect(result).toMatchObject({ status: "unavailable", reason });
			if (result.status === "unavailable") {
				if (detail !== undefined) expect(result.detail).toContain(detail);
				expect(result.detail).not.toContain(JEV_KEY);
			}
		});
	}

	test("a fetch that never resolves within timeout_ms is provider_error timeout", async () => {
		const never: FetchLike = () => new Promise<Response>(() => {});
		const result = await decide({ point: A14, state: "s" }, jevDeps(jevRoot({ timeout_ms: 1000 }), never));
		expect(result).toEqual({ status: "unavailable", reason: "provider_error", detail: "timeout" });
	});

	test("a rejected fetch reports provider_error without the credential", async () => {
		const failing: FetchLike = async () => {
			throw new TypeError(`connect failed with ${JEV_KEY}`);
		};
		const result = await decide({ point: A14, state: "s" }, jevDeps(jevRoot(), failing));
		expect(result).toMatchObject({ status: "unavailable", reason: "provider_error" });
		if (result.status === "unavailable") expect(result.detail).not.toContain(JEV_KEY);
	});

	test("a sensitive category needs egress.jev, and only that listing opens one jev fetch", async () => {
		const respond = () => Response.json({ model: "m", answers: { [DIFF_POINT.id]: { type: "choice", choice: "yes", probabilities: { yes: 0.8, no: 0.2 }, confidence: 0.8 } } });
		const denied = recordingFetch(respond);
		const deniedRoot = makeRoot({ bindings: bindingsFile({ egress: { clef: ["diff"] } }), local: { profiles: { default: jevProfile() } } });
		const result = await decide({ point: DIFF_POINT.id, state: "diff --git" }, jevDeps(deniedRoot, denied.fetch, { JEV_KEY }, DIFF_REGISTRY));
		expect(result).toMatchObject({ status: "unavailable", reason: "egress_denied" });
		expect(denied.calls).toHaveLength(0);

		const allowed = recordingFetch(respond);
		const allowedRoot = makeRoot({ bindings: bindingsFile({ egress: { jev: ["diff"] } }), local: { profiles: { default: jevProfile() } } });
		const ok = await decide({ point: DIFF_POINT.id, state: "diff --git" }, jevDeps(allowedRoot, allowed.fetch, { JEV_KEY }, DIFF_REGISTRY));
		expect(ok.status).toBe("decided");
		expect(allowed.calls).toHaveLength(1);
	});

	const invalidProfiles: [string, Record<string, unknown>][] = [
		["an unknown key", { model: "jev-1" }],
		["a non-string api_key_env", { api_key_env: 7 }],
		["an empty api_key_env", { api_key_env: "" }],
		["a non-URL base_url", { base_url: "not a url" }],
		["a base_url with embedded credentials", { base_url: "https://user:pw@api.typesafe.ai" }],
		["a timeout_ms below 1000", { timeout_ms: 10 }],
		["a non-positive context_window", { context_window: 0 }],
	];
	for (const [name, over] of invalidProfiles) {
		test(`a jev profile with ${name} is config_invalid without calling fetch`, async () => {
			const rec = recordingFetch();
			const result = await decide({ point: A14, state: "s" }, jevDeps(jevRoot(over), rec.fetch));
			expect(result).toMatchObject({ status: "unavailable", reason: "config_invalid" });
			expect(rec.calls).toHaveLength(0);
		});
	}
});

describe("envelope and isolation (AC4)", () => {
	test("a fake profile returns exactly the envelope fields", async () => {
		const root = makeRoot({ bindings: bindingsFile(), local: { profiles: { default: fakeProfile() } } });
		const result = await decide({ point: A14, state: "s", trace_id: "t1" }, deps(root, recordingFetch().fetch));
		expect(result.status).toBe("decided");
		if (result.status !== "decided") return;
		expect(Object.keys(result.envelope).sort()).toEqual(
			[
				"application_point",
				"question_type",
				"option_set",
				"probabilities",
				"choice",
				"confidence",
				"provider_kind",
				"profile",
				"model",
				"model_version",
				"threshold_set_version",
				"input_tokens",
				"context_window",
				"truncation",
			].sort(),
		);
		expect(result.envelope).toMatchObject({
			application_point: A14,
			question_type: "choice",
			option_set: ["blocking", "nit", "out_of_scope", "duplicate"],
			choice: "blocking",
			confidence: 0.7,
			provider_kind: "fake",
			model: "fake",
			threshold_set_version: "a14/v0",
			truncation: "unknown",
		});
	});

	test("the fake answer for a trace_id takes precedence over default", async () => {
		const root = makeRoot({ bindings: bindingsFile(), local: { profiles: { default: fakeProfile({ answers: { t2: { blocking: 0.1, nit: 0.1, out_of_scope: 0.1, duplicate: 0.7 } } }) } } });
		const result = await decide({ point: A14, state: "s", trace_id: "t2" }, deps(root, recordingFetch().fetch));
		expect(result.status === "decided" && result.envelope.choice).toBe("duplicate");
	});

	test("an adapter that throws returns provider_error instead of throwing", async () => {
		const root = makeRoot({ bindings: bindingsFile(), local: { profiles: { default: fakeProfile() } } });
		const throwing = async () => {
			throw new Error("kaboom");
		};
		const result = await decide({ point: A14, state: "s" }, deps(root, recordingFetch().fetch, { adapters: { fake: throwing } }));
		expect(result).toMatchObject({ status: "unavailable", reason: "provider_error" });
	});

	test("decision-model imports respect the plugin and authority boundaries", () => {
		const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;
		const walk = (dir: string): string[] =>
			readdirSync(dir).flatMap((name) => {
				if (name === "node_modules") return [];
				const path = join(dir, name);
				return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(name) ? [path] : [];
			});
		const targets = (file: string) =>
			[...readFileSync(file, "utf8").matchAll(SPEC)].map((m) => {
				const spec = m[1] as string;
				return spec.startsWith(".") ? relative(REPO, resolve(dirname(file), spec)) : spec;
			});

		const component = "plugins/immune-brain/runtime/decision_model";
		expect(existsSync(join(REPO, "scripts/decision-model"))).toBe(false);
		const authorityPaths = ["runtime/kernel", "runtime/assurance", "runtime/unattended", "runtime/claude", ".pi-extension"];
		for (const dir of authorityPaths) {
			for (const file of walk(join(REPO, "plugins/immune-brain", dir))) {
				for (const target of targets(file)) expect(target === component || target.startsWith(`${component}/`)).toBe(false);
			}
		}
		for (const file of walk(join(REPO, "plugins/immune-brain"))) {
			for (const target of targets(file)) expect(target === "scripts" || target.startsWith("scripts/")).toBe(false);
		}
		const evalImports = walk(join(REPO, "scripts/decision-eval")).flatMap(targets);
		expect(evalImports.some((target) => target.startsWith(`${component}/`))).toBe(true);
		for (const target of evalImports) expect(target.includes("scripts/decision-model")).toBe(false);
	});
});

describe("configuration files (AC7)", () => {
	test("the tracked bindings file ships with no binding and no egress", () => {
		const raw = JSON.parse(readFileSync(join(REPO, ".imm/decision-bindings.json"), "utf8"));
		expect(raw).toEqual({ contract: "immune_brain/decision_bindings/v1", default_profile: "default", bindings: {}, egress: {} });
	});

	test("the user-local profiles file is ignored by Git", () => {
		const check = spawnSync("git", ["check-ignore", "-q", ".imm/decision-models.local.json"], { cwd: REPO });
		expect(check.status).toBe(0);
	});

	test("CONTEXT.md defines Decision model and names its directory", () => {
		const context = readFileSync(join(REPO, "CONTEXT.md"), "utf8");
		expect(context).toContain("**Decision model**:");
		expect(context).toContain("plugins/immune-brain/runtime/decision_model/");
		expect(context).not.toContain("scripts/decision-model/");
	});
});
