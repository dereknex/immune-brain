/**
 * Loop Daemon: Project Role Catalog (S1)
 *
 * Implements D1 of docs/specs/loop-leader.spec.md (BR-REQ-1, BR-DEC-6,
 * BR-DEC-8, BR-DEC-9). `loop.roles` in the project file `.imm/config.json`
 * names the roles a loop session may run as. Every role binds exactly one
 * closed capability base; the base, not the configuration, fixes what the
 * role may do, which Host flags it runs with and what it produces. A role
 * that fails a check is absent from the catalog and reported once, so the
 * daemon keeps running while one broken role is excluded.
 */

import { existsSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { AGENT_HOSTS, type AgentHost, type AgentsSection } from "../config/agent_roles.ts";

/** The closed capability bases a project role may bind (D1.2); configuration never widens one. */
export const LOOP_ROLE_BASES = ["leader", "clarify", "plan", "execute", "repair", "analyze"] as const;
export type LoopRoleBase = (typeof LOOP_ROLE_BASES)[number];
/** Bases that only read: their session argv never grants write permission. */
export const READ_ONLY_LOOP_BASES: readonly LoopRoleBase[] = ["leader", "clarify", "plan", "analyze"];
export const LOOP_ROLE_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
export const LOOP_ROLE_WHEN_MAX = 500;

/** One limit per key: its accepted range and the value a role that omits it takes (D1.1). */
export const LOOP_LIMIT_BOUNDS = {
	turn_budget: { min: 1, max: 200, default: 40 },
	timeout_s: { min: 60, max: 3600, default: 900 },
	max_parallel: { min: 1, max: 8, default: 1 },
} as const;
export type LoopLimitKey = keyof typeof LOOP_LIMIT_BOUNDS;
export type LoopRoleLimits = Record<LoopLimitKey, number>;
export const DEFAULT_LOOP_ROLE_LIMITS: LoopRoleLimits = { turn_budget: 40, timeout_s: 900, max_parallel: 1 };
/** The Host a built-in role runs on; the documented fallback for every base (D1.3). */
export const LOOP_ROLE_DEFAULT_HOST: AgentHost = "claude-code";

export interface ResolvedLoopRole {
	name: string;
	base: LoopRoleBase;
	host: AgentHost;
	model: string | null;
	effort: string | null;
	/** Advisory selection hint for the leader (`S3`); never a permission. */
	when: string | null;
	/** Repository-relative path of the advisory instructions file, or null. */
	instructions: string | null;
	limits: LoopRoleLimits;
	source: "project" | "default";
}

/** One rejected role, or one rejected key inside it. */
export interface LoopRoleDiagnostic {
	code: string;
	key_path: string;
	message: string;
}

const ROLE_KEYS = ["base", "host", "model", "effort", "when", "instructions", "limits"];
const isObject = (v: unknown): v is Record<string, any> => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** The built-in role for a base with no configured role: the base's own name on `claude-code` (D1.3). */
export function defaultLoopRole(base: LoopRoleBase): ResolvedLoopRole {
	return {
		name: base,
		base,
		host: LOOP_ROLE_DEFAULT_HOST,
		model: null,
		effort: null,
		when: null,
		instructions: null,
		limits: { ...DEFAULT_LOOP_ROLE_LIMITS },
		source: "default",
	};
}

function parseLoopRole(name: string, value: unknown, root: string): { role: ResolvedLoopRole } | { error: LoopRoleDiagnostic } {
	const fail = (code: string, message: string, key = `loop.roles.${name}`) => ({ error: { code, key_path: key, message } });
	if (!LOOP_ROLE_NAME_PATTERN.test(name)) return fail("role_name_invalid", `role name must match ${LOOP_ROLE_NAME_PATTERN.source}`);
	if (!isObject(value)) return fail("config_invalid", "expected object");
	for (const key of Object.keys(value)) if (!ROLE_KEYS.includes(key)) return fail("config_invalid", `unknown key ${key}`, `loop.roles.${name}.${key}`);
	const base = value.base;
	if (!(LOOP_ROLE_BASES as readonly unknown[]).includes(base)) return fail("role_base_unknown", `expected base ${LOOP_ROLE_BASES.join(", ")}`, `loop.roles.${name}.base`);
	if (value.host !== undefined && !(AGENT_HOSTS as readonly unknown[]).includes(value.host)) return fail("role_host_unknown", `expected host ${AGENT_HOSTS.join(", ")}`, `loop.roles.${name}.host`);
	for (const key of ["model", "effort"]) if (value[key] !== undefined && !text(value[key])) return fail("config_invalid", "expected a non-empty string", `loop.roles.${name}.${key}`);
	if (value.when !== undefined && (typeof value.when !== "string" || value.when.length === 0 || value.when.length > LOOP_ROLE_WHEN_MAX))
		return fail("config_invalid", `expected 1 to ${LOOP_ROLE_WHEN_MAX} characters`, `loop.roles.${name}.when`);
	let instructions: string | null = null;
	if (value.instructions !== undefined) {
		const key = `loop.roles.${name}.instructions`;
		if (!text(value.instructions)) return fail("config_invalid", "expected a repository-relative path", key);
		// `resolve` normalizes `../x.md` out of the root before the containment check, so an
		// absolute path or an escape is refused, never read.
		const path = resolve(root, value.instructions);
		if (isAbsolute(value.instructions) || !path.startsWith(root.endsWith(sep) ? root : root + sep))
			return fail("role_instructions_outside_repo", `must name a file inside ${root}`, key);
		if (!existsSync(path) || !statSync(path).isFile()) return fail("role_instructions_missing", "no such file", key);
		instructions = relative(root, path);
	}
	const limits: LoopRoleLimits = { ...DEFAULT_LOOP_ROLE_LIMITS };
	if (value.limits !== undefined) {
		if (!isObject(value.limits)) return fail("config_invalid", "expected object", `loop.roles.${name}.limits`);
		for (const key of Object.keys(value.limits)) if (!Object.hasOwn(LOOP_LIMIT_BOUNDS, key)) return fail("config_invalid", `unknown key ${key}`, `loop.roles.${name}.limits.${key}`);
		for (const key of Object.keys(LOOP_LIMIT_BOUNDS) as LoopLimitKey[]) {
			const set = value.limits[key];
			if (set === undefined) continue;
			const bounds = LOOP_LIMIT_BOUNDS[key];
			if (!Number.isSafeInteger(set) || set < bounds.min || set > bounds.max)
				return fail("role_limit_out_of_range", `expected an integer between ${bounds.min} and ${bounds.max}`, `loop.roles.${name}.limits.${key}`);
			limits[key] = set;
		}
	}
	return {
		role: {
			name,
			base: base as LoopRoleBase,
			host: (value.host as AgentHost | undefined) ?? LOOP_ROLE_DEFAULT_HOST,
			model: (value.model as string | undefined) ?? null,
			effort: (value.effort as string | undefined) ?? null,
			when: (value.when as string | undefined) ?? null,
			instructions,
			limits,
			source: "project",
		},
	};
}

/**
 * The catalog one project's `loop.roles` resolves to: one entry per base in
 * table order — the configured roles for that base, else the built-in default —
 * and every rejected role left out with one diagnostic.
 */
export function resolveLoopRoles(input: {
	/** The raw `loop.roles` value; undefined when the key is absent. */
	roles: unknown;
	/** The repository root every `instructions` path resolves against. */
	root: string;
}): { roles: ResolvedLoopRole[]; errors: LoopRoleDiagnostic[] } {
	const errors: LoopRoleDiagnostic[] = [];
	const accepted: ResolvedLoopRole[] = [];
	if (input.roles !== undefined) {
		if (!isObject(input.roles)) errors.push({ code: "config_invalid", key_path: "loop.roles", message: "expected object" });
		else
			for (const [name, value] of Object.entries(input.roles)) {
				const parsed = parseLoopRole(name, value, input.root);
				if ("error" in parsed) errors.push(parsed.error);
				else accepted.push(parsed.role);
			}
	}
	// Exactly one role may lead: two claims are both refused, so neither silently wins.
	const leaders = accepted.filter((role) => role.base === "leader");
	if (leaders.length > 1)
		for (const leader of leaders)
			errors.push({
				code: "leader_role_duplicate",
				key_path: `loop.roles.${leader.name}`,
				message: `${leaders.map((role) => role.name).join(", ")} all claim base leader; exactly one role may`,
			});
	const usable = leaders.length > 1 ? accepted.filter((role) => role.base !== "leader") : accepted;
	const roles = LOOP_ROLE_BASES.flatMap((base) => {
		const named = usable.filter((role) => role.base === base);
		return named.length > 0 ? named : [defaultLoopRole(base)];
	});
	return { roles, errors };
}

/** The catalog role of one base, or null while the catalog has none (never in a resolved config). */
export function catalogRole(roles: readonly ResolvedLoopRole[], base: LoopRoleBase): ResolvedLoopRole | null {
	return roles.find((role) => role.base === base) ?? null;
}

/** The two resolved sources one loop session's profile and limits come from. */
export interface LoopSessionConfig {
	agents: AgentsSection;
	loop: { value: { roles: readonly ResolvedLoopRole[] } };
}
