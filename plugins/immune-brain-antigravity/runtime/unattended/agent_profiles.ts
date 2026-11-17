// The agent profiles a Lane batch runs on (ADR 0041). The runtime is the only
// resolver: a request names a whole profile per role, a new batch freezes the
// resolved profiles, and every later generation reads the frozen record.
import { agentRole, parseAgentValue, type AgentProfile, type ResolvedAgentRole } from "../config/agent_roles";
import { batchConfigErrors, resolveConfig, type ReviewProfile } from "../config/layered_config";
import { chooseExecutor, type ExecutorChoice, type ExecutorHost, type ExecutorPreferences } from "./lane_supervisor";

const executorPreferences = (profile: AgentProfile | ResolvedAgentRole): ExecutorPreferences => ({
	executor_host: profile.host,
	...(profile.model ? { executor_model: profile.model } : {}),
	...(profile.effort ? { executor_effort: profile.effort } : {}),
});

/** The whole profiles a `start_unattended_batch` request names per role. */
export interface RequestedAgents { executor?: ExecutorPreferences; reviewer?: ReviewProfile }

/**
 * Parse the request's `agents: { executor?, reviewer? }`. Each value is a
 * profile name from the user file, a `host:model@effort` shorthand, or an
 * inline object; it replaces the configured role whole. Throws on a malformed value.
 */
export function parseRequestedAgents(root: string, value: unknown): RequestedAgents {
	if (value === undefined) return {};
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid agents: expected { executor?, reviewer? }");
	const unknown = Object.keys(value).filter(key => key !== "executor" && key !== "reviewer");
	if (unknown.length) throw new Error(`invalid agents: unknown role ${unknown.join(", ")}`);
	const profiles = resolveConfig(root).agents.profiles.value;
	const out: RequestedAgents = {};
	for (const role of ["executor", "reviewer"] as const) {
		const raw = (value as Record<string, unknown>)[role];
		if (raw === undefined) continue;
		const parsed = parseAgentValue(raw, profiles);
		if (!parsed.ok) throw new Error(`invalid agents.${role}: ${parsed.message}`);
		if (role === "executor") out.executor = executorPreferences(parsed.profile);
		else out.reviewer = { host: parsed.profile.host, ...(parsed.profile.model ? { model: parsed.profile.model } : {}), ...(parsed.profile.effort ? { effort: parsed.profile.effort } : {}) };
	}
	return out;
}

/**
 * The Executor of a supervised Lane generation (#426 F16, ADR 0041): the batch's frozen profile, else the
 * request's whole profile, else the configured `executor` role, else the Parent's own Host on its default
 * model. Null when `agents` or `batch` has a configuration error and nothing was frozen or requested.
 */
export function laneExecutorChoice(root: string, preferences: ExecutorPreferences | undefined, parentHost: ExecutorHost): ExecutorChoice | null {
	if (preferences?.executor_host) return chooseExecutor([preferences], parentHost);
	const config = resolveConfig(root);
	if (batchConfigErrors(config).length) return null;
	const role = agentRole(config.agents, "executor");
	return chooseExecutor(role ? [executorPreferences(role)] : [], parentHost);
}

/**
 * The whole Executor profile a new batch freezes: the request's, else the
 * configured role's, else the Parent's Host. Undefined when nothing applies
 * or the configuration is invalid.
 */
export function frozenExecutorPreferences(root: string, request: ExecutorPreferences | undefined, parentHost?: ExecutorHost): ExecutorPreferences | undefined {
	if (request?.executor_host) return request;
	const config = resolveConfig(root);
	if (batchConfigErrors(config).length) return undefined;
	const role = agentRole(config.agents, "executor");
	if (role) return executorPreferences(role);
	return parentHost ? { executor_host: parentHost } : undefined;
}

/** The `reviewer` profile a new batch freezes: the request's, else the configured role's. */
export function frozenReviewProfile(root: string, request: ReviewProfile | undefined): ReviewProfile | undefined {
	if (request) return request;
	const role = agentRole(resolveConfig(root).agents, "reviewer");
	return role ? { host: role.host, ...(role.model ? { model: role.model } : {}), ...(role.effort ? { effort: role.effort } : {}) } : undefined;
}
