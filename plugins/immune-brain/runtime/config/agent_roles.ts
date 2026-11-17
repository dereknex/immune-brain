// One `agents` table binds each of the four agent roles to one whole Host
// profile (ADR 0041). The project file `.imm/config.json` overrides the user
// file per role; a role's host, model and effort always come from one place.

type Obj = Record<string, any>;
const isObject = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export type AgentHost = "claude-code" | "pi" | "antigravity";
/**
 * `executor` writes code in a worktree (Lane Executor and loop repair);
 * `reviewer` judges a change (code review, its verifier, advisory review);
 * `planner` runs the read-only loop clarify and plan sessions; `triage`
 * runs loop judging.
 */
export type AgentRole = "executor" | "reviewer" | "planner" | "triage";
export const AGENT_ROLES: readonly AgentRole[] = ["executor", "reviewer", "planner", "triage"];
export const AGENT_HOSTS: readonly AgentHost[] = ["claude-code", "pi", "antigravity"];
/** The effort levels a shorthand recognises after its last `@`. */
export const AGENT_EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export interface AgentProfile { host: AgentHost; model?: string; effort?: string }
/** A role's whole profile and the layer it came from. */
export interface ResolvedAgentRole { host: AgentHost; model: string | null; effort: string | null; source: string }
/** The `agents` section of `imm-kernel config --json`. */
export interface AgentsSection {
	valid: boolean;
	profiles: { value: Record<string, AgentProfile>; source: string };
	roles: Record<AgentRole, ResolvedAgentRole | null>;
}
export interface AgentConfigError { code: "config_invalid" | "unknown_profile"; file: string; key_path: string; message: string }
/** A retired preset binding that is ignored but still reported once (Spec loop-leader D3.4). */
export interface AgentPresetJudgingBinding { file: string; key_path: string }

/**
 * `host`, `host:model`, `host@effort` or `host:model@effort`. The first `:`
 * splits the host; a trailing `@<level>` is the effort only when `<level>` is a
 * known effort, so a model id that itself carries `@` or `:` stays whole.
 */
export function parseAgentShorthand(value: string): AgentProfile | null {
	let rest = value.trim(), effort: string | undefined;
	const at = rest.lastIndexOf("@");
	if (at > 0 && (AGENT_EFFORTS as readonly string[]).includes(rest.slice(at + 1))) { effort = rest.slice(at + 1); rest = rest.slice(0, at); }
	const colon = rest.indexOf(":");
	const host = colon < 0 ? rest : rest.slice(0, colon), model = colon < 0 ? undefined : rest.slice(colon + 1);
	if (!(AGENT_HOSTS as readonly string[]).includes(host) || (model !== undefined && !text(model))) return null;
	return { host: host as AgentHost, ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}

/** An inline `{ host, model?, effort? }` object, or the reason it is not one. */
export function parseAgentObject(value: unknown): AgentProfile | string {
	if (!isObject(value)) return "expected an object";
	for (const key of Object.keys(value)) if (!["host", "model", "effort"].includes(key)) return `unknown key ${key}`;
	if (!(AGENT_HOSTS as readonly unknown[]).includes(value.host)) return `expected host ${AGENT_HOSTS.join(", ")}`;
	if (value.model !== undefined && !text(value.model)) return "expected a non-empty model";
	if (value.effort !== undefined && !text(value.effort)) return "expected a non-empty effort";
	return { host: value.host, ...(value.model ? { model: value.model } : {}), ...(value.effort ? { effort: value.effort } : {}) };
}

/**
 * One role value: a profile name from `profiles`, a shorthand string, or an
 * inline object. A name wins over a shorthand that reads the same.
 */
export function parseAgentValue(value: unknown, profiles: Record<string, AgentProfile>): { ok: true; profile: AgentProfile } | { ok: false; code: AgentConfigError["code"]; message: string } {
	if (typeof value === "string") {
		if (Object.hasOwn(profiles, value)) return { ok: true, profile: profiles[value]! };
		const parsed = parseAgentShorthand(value);
		return parsed ? { ok: true, profile: parsed } : { ok: false, code: "unknown_profile", message: `${JSON.stringify(value)} is neither a profile name nor host:model@effort` };
	}
	const parsed = parseAgentObject(value);
	return typeof parsed === "string" ? { ok: false, code: "config_invalid", message: parsed } : { ok: true, profile: parsed };
}

/**
 * Resolve the four roles: project value, else user value, else unset. An
 * invalid value counts as unset and records an error.
 */
export function resolveAgents(layers: { user: Obj | null; project: Obj | null; files: { user: string; project: string } }): {
	agents: AgentsSection;
	errors: AgentConfigError[];
	preset_judging: AgentPresetJudgingBinding[];
} {
	const errors: AgentConfigError[] = [];
	const err = (code: AgentConfigError["code"], file: string, key_path: string, message: string) => errors.push({ code, file, key_path, message });
	const section = (value: Obj | null, file: string, keys: readonly string[]): Obj => {
		if (value === null || value === undefined) return {};
		if (!isObject(value)) { err("config_invalid", file, "agents", "expected object"); return {}; }
		for (const key of Object.keys(value)) if (!keys.includes(key)) err("config_invalid", file, `agents.${key}`, key === "profiles" ? "profiles are defined only in the user file" : "unknown key");
		return value;
	};
	// Spec loop-leader D3.4: a retired `roles.judging` binding is ignored, never
	// `config_invalid`, and the executor beside it still resolves exactly as before.
	const presetJudging: AgentPresetJudgingBinding[] = [];
	const withoutJudgingPresets = (value: Obj | null, file: string): Obj | null => {
		if (value === null || value === undefined || !isObject(value) || !isObject(value.presets)) return value;
		const presets = value.presets as Obj;
		const entries = Object.entries(presets);
		const onlyJudging =
			entries.length > 0 &&
			entries.every(
				([, preset]) =>
					isObject(preset) &&
					Object.keys(preset).every((key) => key === "roles") &&
					isObject(preset.roles) &&
					Object.keys(preset.roles).length > 0 &&
					Object.keys((preset as Obj).roles).every((air) => air === "judging"),
			);
		if (!onlyJudging) return value;
		for (const [name] of entries) presetJudging.push({ file, key_path: `agents.presets.${name}.roles.judging` });
		const stripped: Obj = { ...value };
		delete stripped.presets;
		return stripped;
	};
	const user = section(withoutJudgingPresets(layers.user, layers.files.user), layers.files.user, ["profiles", ...AGENT_ROLES]);
	const project = section(withoutJudgingPresets(layers.project, layers.files.project), layers.files.project, AGENT_ROLES);
	const profiles: Record<string, AgentProfile> = {};
	if (user.profiles !== undefined) {
		if (!isObject(user.profiles)) err("config_invalid", layers.files.user, "agents.profiles", "expected object");
		else for (const [name, value] of Object.entries(user.profiles)) {
			const parsed = parseAgentObject(value);
			if (typeof parsed === "string") err("config_invalid", layers.files.user, `agents.profiles.${name}`, parsed);
			else profiles[name] = parsed;
		}
	}
	const roles = {} as Record<AgentRole, ResolvedAgentRole | null>;
	for (const role of AGENT_ROLES) {
		roles[role] = null;
		// Every layer is checked, so an invalid value stays an error even when a higher layer overrides it.
		for (const [layer, values, file] of [["project", project, layers.files.project], ["user", user, layers.files.user]] as const) {
			if (values[role] === undefined) continue;
			const parsed = parseAgentValue(values[role], profiles);
			if (!parsed.ok) { err(parsed.code, file, `agents.${role}`, parsed.message); continue; }
			roles[role] ??= { host: parsed.profile.host, model: parsed.profile.model ?? null, effort: parsed.profile.effort ?? null, source: layer };
		}
	}
	return { agents: { valid: errors.length === 0, profiles: { value: profiles, source: user.profiles !== undefined ? "user" : "default" }, roles }, errors, preset_judging: presetJudging };
}

/** One role's profile, or null while no layer binds it. */
export function agentRole(agents: AgentsSection, role: AgentRole): ResolvedAgentRole | null {
	return agents.roles[role] ?? null;
}
