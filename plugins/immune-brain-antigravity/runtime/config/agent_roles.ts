// One `agents` table resolves the Host profile of every agent role (Spec
// loop-agent-scheduling D1, S1). The legacy `lanes` keys are mapped into the
// same table, so a consumer reads one role and only its source differs.

type Obj = Record<string, any>;
const isObject = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);

export type AgentHost = "claude-code" | "pi" | "antigravity";
export type AgentTransport = "process" | "herdr" | "subagent";
export type AgentRole =
	| "executor"
	| "code-review"
	| "review-verifier"
	| "advisory-reviewer"
	| "judging"
	| "clarify"
	| "plan"
	| "repair";

/** Every role a Lane, a Review or the Loop can bind to a Host profile (Spec D1). */
export const AGENT_ROLES: readonly AgentRole[] = ["executor", "code-review", "review-verifier", "advisory-reviewer", "judging", "clarify", "plan", "repair"];
export const AGENT_HOSTS: readonly AgentHost[] = ["claude-code", "pi", "antigravity"];
export const AGENT_TRANSPORTS: readonly AgentTransport[] = ["process", "herdr", "subagent"];
/** The transports a role may use; a profile that names none takes the first. */
export const ROLE_TRANSPORTS: Record<AgentRole, readonly AgentTransport[]> = {
	executor: ["process", "herdr"],
	"code-review": ["herdr"],
	"review-verifier": ["herdr"],
	"advisory-reviewer": ["subagent", "herdr"],
	judging: ["process"],
	clarify: ["process"],
	plan: ["process"],
	repair: ["process"],
};
export const AGENT_MAX_PARALLEL = { min: 1, max: 8, default: 1 } as const;

export interface AgentProfile { host: AgentHost; model?: string; effort?: string; transport?: AgentTransport }
export interface AgentPreset { max_parallel?: number; roles?: Record<string, string> }
/** A role's whole profile: host, model and effort always come from one profile. */
export interface ResolvedAgentRole {
	host: AgentHost | null;
	model: string | null;
	effort: string | null;
	transport: AgentTransport | null;
	preset: string | null;
	layer: string;
}
export type AgentConfigErrorCode = "config_invalid" | "unknown_profile" | "unknown_preset" | "preset_incomplete" | "transport_invalid_for_role" | "review_verifier_host_mismatch";
export interface AgentConfigError { code: AgentConfigErrorCode; file: string; key_path: string; message: string }
/** One preset/profile table and the `active` preset that selects from it. */
export interface AgentTable {
	profiles: Record<string, AgentProfile>;
	presets: Record<string, AgentPreset>;
	active: { value: string; source: string };
	layer: string;
	/** The preset the lookup chain falls back to; `null` when the table has none (the legacy mapping). */
	default_preset?: string | null;
}
/** The `agents` section of `imm-kernel config --json`. */
export interface AgentsSection {
	valid: boolean;
	source: { value: "agents" | "legacy" | "default"; source: string };
	active: { value: string; source: string };
	profiles: { value: Record<string, AgentProfile>; source: string };
	presets: { value: Record<string, AgentPreset>; source: string };
	roles: Record<AgentRole, ResolvedAgentRole>;
	max_parallel: { value: number; source: string };
}
/** The layers `agents` resolves from: only `active` may be set outside the user file. */
export interface AgentRoleLayers {
	file: { user: string; project: string; override: string };
	user: Obj | null;
	project: Obj;
	override: Obj;
	legacy: AgentTable | null;
	projectMaxParallel: unknown;
}

const PROFILE_KEYS = ["host", "model", "effort", "transport"];
const PRESET_KEYS = ["max_parallel", "roles"];
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** The user file's `agents` table, with every shape error recorded. */
function readTable(agents: Obj, file: string, errors: AgentConfigError[]): { table: AgentTable; present: boolean } {
	const err = (code: AgentConfigErrorCode, key_path: string, message: string) => errors.push({ code, file, key_path, message });
	for (const key of Object.keys(agents)) if (!["profiles", "presets", "active"].includes(key)) err("config_invalid", `agents.${key}`, "unknown key");
	const profiles: Record<string, AgentProfile> = {};
	if (agents.profiles !== undefined) {
		if (!isObject(agents.profiles)) err("config_invalid", "agents.profiles", "expected object");
		else for (const [name, value] of Object.entries(agents.profiles)) {
			const path = `agents.profiles.${name}`;
			if (!isObject(value)) { err("config_invalid", path, "expected object"); continue; }
			for (const key of Object.keys(value)) if (!PROFILE_KEYS.includes(key)) err("config_invalid", `${path}.${key}`, "unknown key");
			if (!(AGENT_HOSTS as readonly unknown[]).includes(value.host)) { err("config_invalid", `${path}.host`, `expected ${AGENT_HOSTS.join(", ")}`); continue; }
			if (value.model !== undefined && !text(value.model)) { err("config_invalid", `${path}.model`, "expected a non-empty string"); continue; }
			if (value.effort !== undefined && !text(value.effort)) { err("config_invalid", `${path}.effort`, "expected a non-empty string"); continue; }
			if (value.transport !== undefined && !(AGENT_TRANSPORTS as readonly unknown[]).includes(value.transport)) { err("config_invalid", `${path}.transport`, `expected ${AGENT_TRANSPORTS.join(", ")}`); continue; }
			profiles[name] = { host: value.host, ...(value.model ? { model: value.model } : {}), ...(value.effort ? { effort: value.effort } : {}), ...(value.transport ? { transport: value.transport } : {}) };
		}
	}
	const presets: Record<string, AgentPreset> = {};
	if (agents.presets !== undefined) {
		if (!isObject(agents.presets)) err("config_invalid", "agents.presets", "expected object");
		else for (const [name, value] of Object.entries(agents.presets)) {
			const path = `agents.presets.${name}`;
			if (!isObject(value)) { err("config_invalid", path, "expected object"); continue; }
			for (const key of Object.keys(value)) if (!PRESET_KEYS.includes(key)) err("config_invalid", `${path}.${key}`, "unknown key");
			if (value.max_parallel !== undefined && !(Number.isSafeInteger(value.max_parallel) && value.max_parallel >= AGENT_MAX_PARALLEL.min && value.max_parallel <= AGENT_MAX_PARALLEL.max)) {
				err("config_invalid", `${path}.max_parallel`, `expected an integer between ${AGENT_MAX_PARALLEL.min} and ${AGENT_MAX_PARALLEL.max}`);
				continue;
			}
			const roles: Record<string, string> = {};
			let ok = true;
			if (value.roles !== undefined) {
				if (!isObject(value.roles)) { err("config_invalid", `${path}.roles`, "expected object"); ok = false; }
				else for (const [role, profile] of Object.entries(value.roles)) {
					if (role !== "*" && !(AGENT_ROLES as readonly string[]).includes(role)) { err("config_invalid", `${path}.roles.${role}`, `expected one of ${[...AGENT_ROLES, "*"].join(", ")}`); ok = false; continue; }
					if (!text(profile)) { err("config_invalid", `${path}.roles.${role}`, "expected a profile name"); ok = false; continue; }
					roles[role] = profile;
				}
			}
			if (ok) presets[name] = { ...(value.max_parallel !== undefined ? { max_parallel: value.max_parallel } : {}), ...(Object.keys(roles).length ? { roles } : {}) };
		}
	}
	let active: string | undefined;
	if (agents.active !== undefined) {
		if (text(agents.active)) active = agents.active;
		else err("config_invalid", "agents.active", "expected preset name");
	}
	return { table: { profiles, presets, active: { value: active ?? "default", source: active ? "user" : "default" }, layer: "user" }, present: Object.keys(agents).length > 0 };
}

const unsetRoles = (): Record<AgentRole, ResolvedAgentRole> =>
	Object.fromEntries(AGENT_ROLES.map((role) => [role, { host: null, model: null, effort: null, transport: null, preset: null, layer: "unset" }])) as Record<AgentRole, ResolvedAgentRole>;

/**
 * Role lookup for `r`: active `roles[r]` → default `roles[r]` → active
 * `roles["*"]` → default `roles["*"]`; `max_parallel`: active → default →
 * project `lanes.max_parallel` → default (Spec D1).
 */
function resolveTable(table: AgentTable, options: { strict: boolean; file?: string; projectMaxParallel?: unknown }): { roles: Record<AgentRole, ResolvedAgentRole>; max_parallel: { value: number; source: string }; errors: AgentConfigError[] } {
	const errors: AgentConfigError[] = [];
	const file = options.file;
	const err = (code: AgentConfigErrorCode, key_path: string, message: string) => { if (options.strict && file) errors.push({ code, file, key_path, message }); };
	const preset = (name: string) => (Object.hasOwn(table.presets, name) ? table.presets[name] : undefined);
	const fallbackName = table.default_preset === undefined ? "default" : table.default_preset;
	const activePreset = preset(table.active.value), defaultPreset = fallbackName === null ? undefined : preset(fallbackName);
	if (table.active.source !== "default" && !activePreset) err("unknown_preset", "agents.active", "unknown preset");
	if (defaultPreset && fallbackName === "default" && !text(defaultPreset.roles?.["*"])) err("preset_incomplete", "agents.presets.default.roles", "a default preset must bind \"*\"");
	const rolesOf = (p?: AgentPreset) => (p && isObject(p.roles) ? p.roles : {});
	const roles = unsetRoles();
	for (const role of AGENT_ROLES) {
		const fallback = fallbackName ?? "";
		const order: Array<[string, AgentPreset | undefined, string]> = [[table.active.value, activePreset, role], [fallback, defaultPreset, role], [table.active.value, activePreset, "*"], [fallback, defaultPreset, "*"]];
		let pick: { preset: string; profile: string; key: string } | undefined;
		for (const [name, item, key] of order) {
			const profile = rolesOf(item)[key];
			if (text(profile)) { pick = { preset: name, profile, key }; break; }
		}
		if (!pick) continue;
		const profile = Object.hasOwn(table.profiles, pick.profile) ? table.profiles[pick.profile] : undefined;
		if (!profile) { err("unknown_profile", `agents.presets.${pick.preset}.roles.${pick.key}`, `unknown profile ${pick.profile}`); continue; }
		const transport = profile.transport ?? ROLE_TRANSPORTS[role][0]!;
		if (!ROLE_TRANSPORTS[role].includes(transport)) err("transport_invalid_for_role", `agents.profiles.${pick.profile}.transport`, `${role} runs only on ${ROLE_TRANSPORTS[role].join(" or ")}`);
		// The legacy mapping may bind a transport without a host; no other table can.
		roles[role] = { host: (profile.host ?? null) as AgentHost | null, model: profile.model ?? null, effort: profile.effort ?? null, transport, preset: pick.preset, layer: table.layer };
	}
	const review = roles["code-review"], verifier = roles["review-verifier"];
	if (review.host && verifier.host && review.host !== verifier.host)
		err("review_verifier_host_mismatch", `agents.presets.${verifier.preset}.roles.review-verifier`, `review-verifier must run on code-review's host ${review.host}`);
	const maxOf = (p?: AgentPreset) => (typeof p?.max_parallel === "number" ? p.max_parallel : undefined);
	const activeMax = maxOf(activePreset), defaultMax = maxOf(defaultPreset);
	const projectMax = typeof options.projectMaxParallel === "number" ? options.projectMaxParallel : undefined;
	const max_parallel = activeMax !== undefined ? { value: activeMax, source: table.active.source }
		: defaultMax !== undefined ? { value: defaultMax, source: "default" }
		: projectMax !== undefined ? { value: projectMax, source: "project" }
		: { value: AGENT_MAX_PARALLEL.default, source: "default" };
	return { roles, max_parallel, errors };
}

/** Presets may only name profiles the same file defines (Spec D1). */
function validateRefs(table: AgentTable, file: string, errors: AgentConfigError[]) {
	for (const [preset, value] of Object.entries(table.presets))
		for (const [role, profile] of Object.entries(value.roles ?? {}))
			if (!Object.hasOwn(table.profiles, profile)) errors.push({ code: "unknown_profile", file, key_path: `agents.presets.${preset}.roles.${role}`, message: `unknown profile ${profile}` });
}

/**
 * One role profile, or null when the role is unset. `preset` names a preset
 * that overrides `active` for this call, as a request may for one batch.
 */
export function agentRole(agents: AgentsSection, role: AgentRole, preset?: string): ResolvedAgentRole | null {
	const resolved = preset === undefined || preset === agents.active.value
		? agents.roles[role]
		: resolveTable({ profiles: agents.profiles.value, presets: agents.presets.value, active: { value: preset, source: "request" }, layer: "request",
			...(agents.source.value === "legacy" ? { default_preset: null } : {}) }, { strict: false }).roles[role];
	return resolved !== undefined && resolved.preset !== null ? resolved : null;
}

/**
 * Resolve `agents` over its layers. An error in the `agents` table falls the
 * whole section back to the legacy `lanes` mapping, else to built-in values.
 */
export function resolveAgentRoles(layers: AgentRoleLayers): { agents: AgentsSection; errors: AgentConfigError[] } {
	const errors: AgentConfigError[] = [];
	const read = layers.user === null ? null : readTable(layers.user, layers.file.user, errors);
	if (layers.user === null) errors.push({ code: "config_invalid", file: layers.file.user, key_path: "agents", message: "the user file is unreadable" });
	for (const key of Object.keys(layers.project)) if (key !== "active") errors.push({ code: "config_invalid", file: layers.file.project, key_path: `agents.${key}`, message: "only `active` may be set in the project file" });
	const name = (value: unknown, file: string, key_path: string) => {
		if (value === undefined) return undefined;
		if (text(value)) return value;
		errors.push({ code: "config_invalid", file, key_path, message: "expected preset name" });
		return undefined;
	};
	const overrideActive = name(layers.override.active, layers.file.override, "agents.active");
	const projectActive = name(layers.project.active, layers.file.project, "agents.active");
	const configured: AgentTable | null = read?.present ? {
		profiles: read.table.profiles,
		presets: read.table.presets,
		active: overrideActive ? { value: overrideActive, source: "user:project" } : projectActive ? { value: projectActive, source: "project" } : read.table.active,
		layer: "user",
	} : null;
	if (configured) {
		validateRefs(configured, layers.file.user, errors);
		errors.push(...resolveTable(configured, { strict: true, file: layers.file.user, projectMaxParallel: layers.projectMaxParallel }).errors);
	}
	const table = configured && errors.length === 0 ? configured : layers.legacy;
	const resolved = table ? resolveTable(table, { strict: false, projectMaxParallel: layers.projectMaxParallel }) : null;
	const maxOf = typeof layers.projectMaxParallel === "number" ? { value: layers.projectMaxParallel, source: "project" } : { value: AGENT_MAX_PARALLEL.default, source: "default" };
	return {
		agents: {
			valid: errors.length === 0,
			source: { value: table === null ? "default" : table === configured ? "agents" : "legacy", source: table?.layer ?? "default" },
			active: table?.active ?? { value: "default", source: "default" },
			profiles: { value: table?.profiles ?? {}, source: table?.layer ?? "default" },
			presets: { value: table?.presets ?? {}, source: table?.layer ?? "default" },
			roles: resolved?.roles ?? unsetRoles(),
			max_parallel: resolved?.max_parallel ?? maxOf,
		},
		errors,
	};
}
