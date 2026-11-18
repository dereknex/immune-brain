// Role-indexed session provider registry (unified-lane-sessions S2, Spec D5/D10).
//
// One descriptor per provider: a pure environment check, recovery text, adapter
// factory, and role admissions. `resolveSessionProvider` is pure (zero I/O: it
// never calls a factory, probe, or createSession) and selects the first
// configured provider whose env check holds and whose role admits the host.

import { createHerdrSessionProvider, createHerdrViewer } from "./herdr_provider";
import { createHerdrCoreSessionProvider } from "./herdr_core_provider";
import {
	admitSessionProvider,
	type ExecutorHostKind,
	type SessionProviderName,
	type SupervisedSessionPort,
} from "./supervised_session_port";

export type SessionRole = "executor" | "authority" | "advisory";

export interface ExecutorRoleAdmission {
	hosts: readonly ExecutorHostKind[];
	workspace: "local_path";
	find_by_key: boolean;
	exit_proof: boolean;
}

export interface HostRoleAdmission {
	hosts: readonly ExecutorHostKind[];
}

export interface SessionProviderDescriptor {
	readonly name: Extract<SessionProviderName, "herdr" | "herdr-core">;
	readonly checkEnv: (env: Record<string, string | undefined>) => { ok: true } | { ok: false; reason: string };
	readonly recovery: string;
	readonly factory: (env: Record<string, string | undefined>) => SupervisedSessionPort;
	readonly roles: {
		executor?: ExecutorRoleAdmission;
		authority?: HostRoleAdmission;
		advisory?: HostRoleAdmission;
	};
}

export interface ProviderUnavailableReason {
	provider: string;
	reason: string;
	recovery: string;
}

export type ResolveSessionProviderResult =
	| { ok: true; provider: string; descriptor: SessionProviderDescriptor }
	| { ok: false; code: "lane_session_unavailable"; reasons: ProviderUnavailableReason[] };

const EXECUTOR_HOSTS = ["claude-code", "pi", "antigravity"] as const satisfies readonly ExecutorHostKind[];

function herdrCheck(env: Record<string, string | undefined>): { ok: true } | { ok: false; reason: string } {
	if (env.HERDR_ENV !== "1") return { ok: false, reason: "not running inside Herdr (HERDR_ENV is not 1)" };
	if (!env.HERDR_WORKSPACE_ID) return { ok: false, reason: "HERDR_WORKSPACE_ID is not set" };
	return { ok: true };
}

const HERDR_RECOVERY = "run inside Herdr with HERDR_ENV=1 and HERDR_WORKSPACE_ID set to the Parent workspace";
const HERDR_CORE_RECOVERY = "ensure hc 0.1.19+ is installed and a core server answers (hc server status --json)";

export const HERDR_DESCRIPTOR: SessionProviderDescriptor = {
	name: "herdr",
	checkEnv: herdrCheck,
	recovery: HERDR_RECOVERY,
	factory: env => createHerdrSessionProvider({ env }),
	roles: {
		executor: { hosts: [...EXECUTOR_HOSTS], workspace: "local_path", find_by_key: true, exit_proof: true },
		authority: { hosts: [...EXECUTOR_HOSTS] },
		advisory: { hosts: [...EXECUTOR_HOSTS] },
	},
};

export const HERDR_CORE_DESCRIPTOR: SessionProviderDescriptor = {
	name: "herdr-core",
	checkEnv: () => ({ ok: true }),
	recovery: HERDR_CORE_RECOVERY,
	factory: env => createHerdrCoreSessionProvider({ env, viewer: createHerdrViewer({ env }) ?? undefined }),
	roles: {
		// No Executor Host is admitted until #495; find stays available for the conformance suite.
		executor: { hosts: [], workspace: "local_path", find_by_key: true, exit_proof: false },
	},
};

/** Config-visible registry: exactly herdr and herdr-core; `fake` stays test-only. */
export const SESSION_PROVIDER_REGISTRY: readonly SessionProviderDescriptor[] = [HERDR_DESCRIPTOR, HERDR_CORE_DESCRIPTOR];

export function resolveSessionProvider(options: {
	role: SessionRole;
	providers: string[];
	host: ExecutorHostKind;
	env: Record<string, string | undefined>;
	registry?: readonly SessionProviderDescriptor[];
}): ResolveSessionProviderResult {
	const registry = options.registry ?? SESSION_PROVIDER_REGISTRY;
	const reasons: ProviderUnavailableReason[] = [];
	for (const name of options.providers) {
		const descriptor = registry.find(d => d.name === name);
		if (!descriptor) {
			reasons.push({ provider: name, reason: `unknown session provider ${JSON.stringify(name)}`, recovery: "choose one of herdr, herdr-core" });
			continue;
		}
		const envCheck = descriptor.checkEnv(options.env);
		if (!envCheck.ok) {
			reasons.push({ provider: name, reason: envCheck.reason, recovery: descriptor.recovery });
			continue;
		}
		if (options.role === "executor") {
			const admission = descriptor.roles.executor;
			if (!admission) {
				reasons.push({ provider: name, reason: "no executor role", recovery: descriptor.recovery });
				continue;
			}
			if (!admission.hosts.includes(options.host)) {
				reasons.push({ provider: name, reason: `host ${options.host} not admitted`, recovery: `use one of ${admission.hosts.join(", ") || "none admitted"}` });
				continue;
			}
			if (admission.workspace !== "local_path") {
				reasons.push({ provider: name, reason: "no local_path workspace", recovery: descriptor.recovery });
				continue;
			}
			if (!admission.find_by_key) {
				reasons.push({ provider: name, reason: "no find_by_key", recovery: descriptor.recovery });
				continue;
			}
			return { ok: true, provider: name, descriptor };
		}
		const admission = descriptor.roles[options.role];
		if (!admission) {
			reasons.push({ provider: name, reason: `no ${options.role} role`, recovery: descriptor.recovery });
			continue;
		}
		if (!admission.hosts.includes(options.host)) {
			reasons.push({ provider: name, reason: `host ${options.host} not admitted`, recovery: `use one of ${admission.hosts.join(", ") || "none admitted"}` });
			continue;
		}
		return { ok: true, provider: name, descriptor };
	}
	return { ok: false, code: "lane_session_unavailable", reasons };
}

/** A declared role capability the adapter omits fails conformance. */
export function checkProviderConformance(
	descriptor: SessionProviderDescriptor,
	port: SupervisedSessionPort,
): { ok: true } | { ok: false; reason: string } {
	if (port.provider !== descriptor.name) return { ok: false, reason: `adapter provider ${port.provider} does not match descriptor ${descriptor.name}` };
	const admitted = admitSessionProvider(port);
	if (!admitted.ok) return { ok: false, reason: admitted.reason };
	if (descriptor.roles.executor?.find_by_key && typeof port.findSession !== "function") {
		return { ok: false, reason: `${descriptor.name} declares find_by_key but omits findSession` };
	}
	if (descriptor.roles.executor?.exit_proof && typeof port.closeWithProof !== "function") {
		return { ok: false, reason: `${descriptor.name} declares exit_proof but omits closeWithProof` };
	}
	return { ok: true };
}
