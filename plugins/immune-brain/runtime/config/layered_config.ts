import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { resolveAgents } from "./agent_roles.ts";
import { resolveLoopRoles, type ResolvedLoopRole } from "../loop_daemon/role_catalog.ts";
import { parseProfiles } from "../decision_model/config.ts";
import { PROVIDER_KINDS, SENSITIVE_CATEGORIES, type PointRegistry } from "../decision_model/contract.ts";
import { POINT_REGISTRY } from "../decision_model/thresholds.ts";

// Two layers resolve every key (ADR 0041): the project's local, unversioned
// `.imm/config.json` overrides the user's `config.json`, which overrides the
// built-in default. Permission keys take the stricter of the two values.

type Obj = Record<string, any>;
type ResolvedLeaf = { value: unknown; source: string };
/**
 * Where a reserved Review or Verification round runs: one explicit supervised
 * session the Parent launches inside Herdr (Spec retire-process-review-transport D1, D2).
 */
export type ReviewTransport = "herdr";
export type ReviewProfile = {
	host: "pi" | "claude-code" | "antigravity";
	model?: string;
	effort?: string;
	transport?: ReviewTransport;
};
export type ConfigDiagnostic = { code: string; severity: "error" | "warning"; file: string; key_path: string; message: string };
const object = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const leaf = (value: unknown, source: string): ResolvedLeaf => ({ value, source });
const has = (o: Obj | undefined | null, k: string) => !!o && Object.hasOwn(o, k);
const envName = /^[A-Z_][A-Z0-9_]*$/;

export const USER_CONFIG_CONTRACT = "immune_brain/user_config/v2";
export const PROJECT_CONFIG_CONTRACT = "immune_brain/project_config/v2";
export const BATCH_MAX_PARALLEL = { min: 1, max: 8, default: 1 } as const;

export const LOOP_MODES = ["off", "observe", "assist", "autonomous"] as const;
export type LoopMode = (typeof LOOP_MODES)[number];
/** `policy_auto` is routine-only; `material` and `critical` always need `tracker_approval` or `user_session`. */
export const LOOP_AUTO_ENROLL_MAX_RISKS = ["none", "routine"] as const;
export type LoopAutoEnrollMaxRisk = (typeof LOOP_AUTO_ENROLL_MAX_RISKS)[number];
export const LOOP_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"] as const;
export type LoopAssociation = (typeof LOOP_ASSOCIATIONS)[number];
/** Spec loop-agent-scheduling D4: where the daemon asks the literal user. */
export const LOOP_INTERACTION_CHANNELS = ["github", "local"] as const;
export type LoopInteractionChannel = (typeof LOOP_INTERACTION_CHANNELS)[number];
export interface LoopConfig {
	mode: LoopMode;
	interval_seconds: number;
	max_concurrent: number;
	max_ready_buffer: number;
	max_pr_buffer: number;
	auto_enroll_max_risk: LoopAutoEnrollMaxRisk;
	allowed_actors: string[];
	allowed_associations: LoopAssociation[];
	interaction: { channel: LoopInteractionChannel };
	budget: { max_ticks_per_day: number | null; max_dispatches_per_day: number | null };
}
/** The `loop.value` shape: the loop switches plus the project role catalog (Spec loop-leader D1.5). */
export type LoopValue = LoopConfig & { roles: ResolvedLoopRole[] };
export const DEFAULT_LOOP_CONFIG: LoopConfig = {
	mode: "off",
	interval_seconds: 60,
	max_concurrent: 2,
	max_ready_buffer: 5,
	max_pr_buffer: 5,
	auto_enroll_max_risk: "none",
	allowed_actors: [],
	allowed_associations: [...LOOP_ASSOCIATIONS],
	interaction: { channel: "github" },
	budget: { max_ticks_per_day: null, max_dispatches_per_day: null },
};

/** The top-level keys either file may set; `profiles` under agents and decision_models stay user-only.
 * `herdr` is retired (warning only, never resolved); `session_providers` selects the Lane session provider. */
const FILE_KEYS = ["contract", "agents", "herdr", "session_providers", "decision_models", "git_integration", "initiative_carrier", "batch", "loop", "review_verifier"];

/** Provider names a user may configure in `session_providers` (test-only `fake`/`process` excluded). */
const REGISTERED_SESSION_PROVIDERS = ["herdr", "herdr-core"] as const;

export function defaultUserConfigPath(): string {
	return join(process.env.XDG_CONFIG_HOME && isAbsolute(process.env.XDG_CONFIG_HOME) ? process.env.XDG_CONFIG_HOME : join(homedir(), ".config"), "immune-brain/config.json");
}

/**
 * The main checkout's root: the project file is local and unversioned, so a Lane
 * worktree reads the one beside the main checkout instead of its own copy.
 */
export function mainCheckoutRoot(root: string): string {
	try {
		const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
		return basename(common) === ".git" ? dirname(common) : root;
	} catch { return root; }
}

export function projectConfigPath(root: string): string {
	return join(mainCheckoutRoot(root), ".imm/config.json");
}

export function resolveConfig(root: string, options: { userConfigPath?: string; projectConfigPath?: string; checkEnv?: boolean; registry?: PointRegistry } = {}) {
	const registry = options.registry ?? POINT_REGISTRY;
	const diagnostics: ConfigDiagnostic[] = [];
	const diag = (code: string, severity: "error" | "warning", file: string, key_path: string, message: string) => {
		diagnostics.push({ code, severity, file, key_path, message: `${file}: ${key_path}: ${message}` });
	};
	const invalid = (file: string, key: string, message: string) => diag("config_invalid", "error", file, key, message);
	const userPath = options.userConfigPath ?? defaultUserConfigPath();
	const projectPath = options.projectConfigPath ?? projectConfigPath(root);
	/** A file that fails to parse is void as a whole; a missing file is empty. */
	const read = (path: string, contract: string): Obj | null => {
		if (!existsSync(path)) return null;
		try {
			const data: unknown = JSON.parse(readFileSync(path, "utf8"));
			if (!object(data)) { invalid(path, "$", "expected object"); return null; }
			if (data.contract !== contract) {
				invalid(path, "contract", typeof data.contract === "string" && data.contract.endsWith("/v1")
					? `${data.contract} is retired; run \`imm-kernel config migrate\` to rewrite it as ${contract}`
					: `expected ${contract}`);
				return null;
			}
			for (const key of Object.keys(data)) if (!FILE_KEYS.includes(key)) invalid(path, key, "unknown key");
			return data;
		} catch { invalid(path, "$", "unreadable or malformed JSON"); return null; }
	};
	const user = read(userPath, USER_CONFIG_CONTRACT);
	const project = read(projectPath, PROJECT_CONFIG_CONTRACT);
	const layers = [["project", project, projectPath], ["user", user, userPath]] as const;
	/** A nested object of one layer, or {} with an error when it is not one. */
	const part = (o: Obj | null, file: string, path: string): Obj => {
		let value: unknown = o;
		for (const key of path.split(".")) { if (!object(value)) return {}; value = value[key]; }
		if (value === undefined) return {};
		if (!object(value)) { invalid(file, path, "expected object"); return {}; }
		return value;
	};
	const knownKeys = (o: Obj, keys: readonly string[], file: string, path: string) => {
		for (const key of Object.keys(o)) if (!keys.includes(key)) invalid(file, `${path}.${key}`, "unknown key");
	};
	/** The first layer whose value passes `ok`; an invalid value counts as unset and records an error. */
	const pick = (get: (o: Obj) => unknown, key: string, ok: (v: unknown) => boolean, message: string, fallback: unknown = null): ResolvedLeaf => {
		for (const [layer, o, file] of layers) {
			const value = o ? get(o) : undefined;
			if (value === undefined) continue;
			if (ok(value)) return leaf(value, layer);
			invalid(file, key, message);
		}
		return leaf(fallback, "default");
	};
	/** Every layer's valid value for a key, project first. */
	const valid = (get: (o: Obj) => unknown, key: string, ok: (v: unknown) => boolean, message: string): Array<{ value: any; source: string }> => {
		const out: Array<{ value: any; source: string }> = [];
		for (const [layer, o, file] of layers) {
			const value = o ? get(o) : undefined;
			if (value === undefined) continue;
			if (ok(value)) out.push({ value, source: layer });
			else invalid(file, key, message);
		}
		return out;
	};
	const errorsUnder = (prefix: string) => diagnostics.some((d) => d.severity === "error" && (d.key_path === prefix || d.key_path.startsWith(`${prefix}.`)));
	const integerWithin = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
	const oneOf = (values: readonly unknown[]) => (v: unknown) => values.includes(v);

	// agents
	const agentLayers = resolveAgents({ user: user ? (user.agents ?? null) : null, project: project ? (project.agents ?? null) : null, files: { user: userPath, project: projectPath } });
	for (const error of agentLayers.errors) diag(error.code, "error", error.file, error.key_path, error.message);
	const agents = agentLayers.agents;
	// Retired top-level `herdr` switch: ignored, warned once per layer that sets it, never resolved.
	for (const [, o, file] of layers) if (o && Object.hasOwn(o, "herdr"))
		diag("retired_key", "warning", file, "herdr", "herdr is retired and ignored; remove it (imm-kernel config migrate --write deletes it)");
	// Ordered session-provider list: project replaces user. The default names
	// only `herdr` (Spec D9), so a refusal outside Herdr lists one reason and
	// recovery; resolution still admits `herdr` only when HERDR_ENV is 1, so no
	// session opens outside Herdr.
	const sessionProviders = pick((o) => o.session_providers, "session_providers",
		(v) => Array.isArray(v) && v.length > 0 && v.every((name) => (REGISTERED_SESSION_PROVIDERS as readonly string[]).includes(name)) && new Set(v).size === v.length,
		`expected a non-empty list of distinct registered providers (${REGISTERED_SESSION_PROVIDERS.join(", ")})`, ["herdr"]);

	// batch
	for (const [, o, file] of layers) knownKeys(part(o, file, "batch"), ["max_parallel", "final_verification"], file, "batch");
	const maxParallel = pick((o) => o.batch?.max_parallel, "batch.max_parallel", (v) => integerWithin(v, BATCH_MAX_PARALLEL.min, BATCH_MAX_PARALLEL.max), `expected an integer between ${BATCH_MAX_PARALLEL.min} and ${BATCH_MAX_PARALLEL.max}`, BATCH_MAX_PARALLEL.default);
	const finalVerification = pick((o) => o.batch?.final_verification, "batch.final_verification", (v) => Array.isArray(v) && v.length <= 8 && v.every((c) => typeof c === "string" && c.length > 0), "expected at most eight command strings");

	// plain keys
	const reviewVerifier = pick((o) => o.review_verifier, "review_verifier", oneOf(["off", "on"]), "expected off or on", "off");
	const carrier = pick((o) => o.initiative_carrier, "initiative_carrier", oneOf(["github", "local"]), "expected github or local");
	// Permission key: `manual` wins wherever it is set, and an invalid value or a void file behaves as `manual`.
	const git = valid((o) => o.git_integration, "git_integration", oneOf(["manual", "auto"]), "expected manual or auto");
	const gitBroken = diagnostics.find((d) => d.severity === "error" && ["git_integration", "$", "contract"].includes(d.key_path));
	const gitIntegration = gitBroken ? { value: "manual", source: gitBroken.file === projectPath ? "project" : "user" }
		: git.find((g) => g.value === "manual") ?? git[0] ?? { value: "manual", source: "default" };

	// loop
	const loopKeys = ["mode", "interval_seconds", "max_concurrent", "max_ready_buffer", "max_pr_buffer", "auto_enroll_max_risk", "allowed_actors", "allowed_associations", "interaction", "budget"];
	// `loop.roles` is project-only: the catalog names roles for this repository's Loop.
	for (const [layer, o, file] of layers) {
		knownKeys(part(o, file, "loop"), layer === "project" ? [...loopKeys, "roles"] : loopKeys, file, "loop");
		if (layer === "user" && has(part(o, file, "loop"), "roles")) invalid(file, "loop.roles", "loop.roles is defined only in the project file");
		knownKeys(part(o, file, "loop.budget"), ["max_ticks_per_day", "max_dispatches_per_day"], file, "loop.budget");
		knownKeys(part(o, file, "loop.interaction"), ["channel"], file, "loop.interaction");
	}
	const distinct = (v: unknown) => Array.isArray(v) && v.every((item) => typeof item === "string" && item.trim().length > 0) && new Set(v).size === v.length;
	const loopPick = (key: string, ok: (v: unknown) => boolean, message: string): any => pick((o) => o.loop?.[key], `loop.${key}`, ok, message, (DEFAULT_LOOP_CONFIG as any)[key]).value;
	/** Permission lists keep only what both layers allow. */
	const intersect = (key: string, ok: (v: unknown) => boolean, message: string) => {
		const values = valid((o) => o.loop?.[key], `loop.${key}`, ok, message);
		if (!values.length) return (DEFAULT_LOOP_CONFIG as any)[key];
		return values.map((v) => v.value as string[]).reduce((a, b) => a.filter((item) => b.includes(item)));
	};
	const risks = valid((o) => o.loop?.auto_enroll_max_risk, "loop.auto_enroll_max_risk", oneOf(LOOP_AUTO_ENROLL_MAX_RISKS), "expected none or routine; material and critical require tracker_approval");
	const budgetPick = (key: string): any => pick((o) => o.loop?.budget?.[key], `loop.budget.${key}`, (v) => integerWithin(v, 1), "expected a positive integer", null).value;
	const loopCatalog = resolveLoopRoles({ roles: project?.loop?.roles, root });
	for (const error of loopCatalog.errors) diag(error.code, "error", projectPath, error.key_path, error.message);
	const resolvedLoop: LoopValue = {
		mode: loopPick("mode", oneOf(LOOP_MODES), `expected one of ${LOOP_MODES.join(", ")}`),
		interval_seconds: loopPick("interval_seconds", (v) => integerWithin(v, 15), "expected an integer of at least 15"),
		max_concurrent: loopPick("max_concurrent", (v) => integerWithin(v, 1, 8), "expected an integer between 1 and 8"),
		max_ready_buffer: loopPick("max_ready_buffer", (v) => integerWithin(v, 1, 20), "expected an integer between 1 and 20"),
		max_pr_buffer: loopPick("max_pr_buffer", (v) => integerWithin(v, 1, 20), "expected an integer between 1 and 20"),
		auto_enroll_max_risk: risks.length ? (risks.some((r) => r.value === "none") ? "none" : "routine") : DEFAULT_LOOP_CONFIG.auto_enroll_max_risk,
		allowed_actors: intersect("allowed_actors", distinct, "expected distinct non-empty GitHub logins"),
		allowed_associations: intersect("allowed_associations", (v) => distinct(v) && (v as string[]).length > 0 && (v as string[]).every((a) => (LOOP_ASSOCIATIONS as readonly string[]).includes(a)), `expected a subset of ${LOOP_ASSOCIATIONS.join(", ")}`),
		interaction: { channel: pick((o) => o.loop?.interaction?.channel, "loop.interaction.channel", oneOf(LOOP_INTERACTION_CHANNELS), `expected one of ${LOOP_INTERACTION_CHANNELS.join(", ")}`, "github").value as LoopInteractionChannel },
		budget: { max_ticks_per_day: budgetPick("max_ticks_per_day"), max_dispatches_per_day: budgetPick("max_dispatches_per_day") },
		roles: loopCatalog.roles,
	};
	// BR-DEC-7: an agents binding that used to choose a loop role's profile is ignored
	// now; the session uses the catalog, so the owner is told once per affected role.
	const deprecated = [
		["agents.planner", agentLayers.agents.roles.planner, ["clarify", "plan"]],
		["agents.executor", agentLayers.agents.roles.executor, ["repair"]],
	] as const;
	for (const [key, bound, bases] of deprecated) {
		if (!bound) continue;
		for (const base of bases)
			diag("deprecated_config_source", "warning", bound.source === "project" ? projectPath : userPath, "loop.roles",
				`${key} no longer chooses the loop ${base} role; bind a base ${base} role under loop.roles in .imm/config.json`);
	}

	// decision_models
	for (const [layer, o, file] of layers) knownKeys(part(o, file, "decision_models"), layer === "user" ? ["profiles", "default_profile", "bindings", "egress"] : ["default_profile", "bindings", "egress"], file, "decision_models");
	let profiles: Obj = {};
	const rawProfiles = part(user, userPath, "decision_models.profiles");
	if (has(user?.decision_models, "profiles")) {
		let ok = true;
		for (const [name, profile] of Object.entries(rawProfiles)) if (object(profile)) for (const [key, value] of Object.entries(profile)) if (key.endsWith("_env") && (typeof value !== "string" || !envName.test(value))) { invalid(userPath, `decision_models.profiles.${name}.${key}`, "expected environment variable name"); ok = false; }
		const parsed = parseProfiles({ profiles: rawProfiles });
		if (!parsed.ok) { invalid(userPath, "decision_models.profiles", parsed.error.detail.replace(/^.*?: /, "")); ok = false; }
		if (ok) profiles = rawProfiles;
	}
	/** A profile name; a project reference to an unknown profile falls back to the user value. */
	const profileRef = (get: (o: Obj) => unknown, key: string, allowOff: boolean): ResolvedLeaf => {
		for (const [layer, o, file] of layers) {
			const value = o ? get(o) : undefined;
			if (value === undefined) continue;
			if (typeof value !== "string" || !value) { invalid(file, key, "expected profile name"); continue; }
			if (allowOff && value === "off") return leaf(value, layer);
			if (!Object.hasOwn(profiles, value)) { diag("unknown_profile", "error", file, key, `unknown profile ${value}`); continue; }
			return leaf(value, layer);
		}
		return leaf(null, "default");
	};
	const defaultProfile = profileRef((o) => o.decision_models?.default_profile, "decision_models.default_profile", false);
	const bindings: Obj = {};
	const points = new Set<string>();
	for (const [, o, file] of layers) for (const point of Object.keys(part(o, file, "decision_models.bindings"))) {
		if (Object.hasOwn(registry, point)) points.add(point);
		else invalid(file, `decision_models.bindings.${point}`, "unknown application point");
	}
	for (const point of [...points].sort()) bindings[point] = profileRef((o) => o.decision_models?.bindings?.[point], `decision_models.bindings.${point}`, true);
	for (const [, o, file] of layers) for (const kind of Object.keys(part(o, file, "decision_models.egress"))) if (!(PROVIDER_KINDS as readonly string[]).includes(kind)) invalid(file, `decision_models.egress.${kind}`, "unknown provider kind");
	const egress: Obj = {};
	for (const kind of PROVIDER_KINDS) egress[kind] = pick((o) => o.decision_models?.egress?.[kind], `decision_models.egress.${kind}`,
		(v) => Array.isArray(v) && v.every((c) => (SENSITIVE_CATEGORIES as readonly unknown[]).includes(c)) && new Set(v).size === v.length, "invalid egress list", []);
	const decisionModels: Obj = { valid: !errorsUnder("decision_models"), profiles: leaf(profiles, Object.keys(profiles).length ? "user" : "default"), default_profile: defaultProfile, bindings, egress };
	if (options.checkEnv) decisionModels.environment = Object.fromEntries(Object.entries(profiles).map(([name, profile]) => [name, object(profile) ? Object.fromEntries(Object.entries(profile).filter(([k, v]) => k.endsWith("_env") && typeof v === "string" && envName.test(v)).map(([k, v]) => [k, process.env[v as string] !== undefined ? "set" : "unset"])) : {}]));

	const catalogPrefix = "loop.roles";
	const loopErrorsOutsideCatalog = () => diagnostics.some((d) => d.severity === "error" && (d.key_path === "loop" || d.key_path.startsWith("loop.")) && d.key_path !== catalogPrefix && !d.key_path.startsWith(`${catalogPrefix}.`));
	const loopSource = has(project, "loop") ? "project" : has(user, "loop") ? "user" : "default";
	return {
		contract: "immune_brain/effective_config/v2",
		files: { user: userPath, project: projectPath },
		agents,
		session_providers: sessionProviders,
		batch: { valid: !errorsUnder("batch"), max_parallel: maxParallel, final_verification: finalVerification },
		decision_models: decisionModels,
		git_integration: leaf(gitIntegration.value, gitIntegration.source),
		initiative_carrier: carrier,
		// A rejected role is excluded and reported, never a reason to stop the daemon.
		loop: { valid: !loopErrorsOutsideCatalog(), value: resolvedLoop, source: loopSource },
		review_verifier: reviewVerifier,
		diagnostics,
	};
}

export type EffectiveConfig = ReturnType<typeof resolveConfig>;

/** A batch may start only while `agents`, `batch` and `session_providers` resolve without an error. */
export function batchConfigErrors(config: EffectiveConfig): ConfigDiagnostic[] {
	return config.diagnostics.filter((d) => d.severity === "error" && (/^(agents|batch|session_providers)(\.|$)/.test(d.key_path) || d.key_path === "$" || d.key_path === "contract"));
}
