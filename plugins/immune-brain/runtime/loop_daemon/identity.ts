/**
 * Loop Daemon: Same-UID Identity Posture (S3)
 *
 * Implements D3.2 of docs/specs/loop-daemon.spec.md (BR-REQ-3; BR-DEFER-1 keeps
 * dedicated OS-user privilege separation out of this slice). When the daemon
 * runs under the same OS UID as Executor worktrees, a compromised tool inside a
 * worktree can reach daemon user-space credentials, so the daemon degrades to
 * observe/triage/publish and refuses `policy_auto` enrollment (guard `G10`).
 * `merge_pr` is withheld in every posture: merging stays human-only (ADR 0039
 * decision 11).
 */

import { statSync } from "node:fs";

export type LoopIdentityPosture = "isolated" | "degraded";

export const LOOP_CAPABILITIES = [
	"observe",
	"triage",
	"publish_plan",
	"publish_question",
	"policy_auto",
	"merge_pr",
] as const;

export type LoopCapability = (typeof LOOP_CAPABILITIES)[number];

/** Capabilities the degraded same-UID posture withholds. */
const DEGRADED_DENIED: readonly LoopCapability[] = ["policy_auto", "merge_pr"];

export interface IdentityInspection {
	/** OS UID of the daemon process, or null when the platform cannot report one. */
	daemon_uid: number | null;
	/** OS UID owning the Executor worktree, or null when it cannot be read. */
	worktree_uid: number | null;
	/** True when Executor work runs behind a separate OS identity or sandbox. */
	isolated_runner_boundary: boolean;
	/** True when the worktree can read the daemon's credentials. */
	worktree_shares_credentials: boolean;
}

/**
 * Degrade whenever the boundary is unproven: unknown UIDs, a shared credential
 * pool, or the same UID without an isolated runner boundary. Only a positively
 * separated runner yields `isolated`.
 */
export function detectIdentityPosture(inspection: IdentityInspection): LoopIdentityPosture {
	if (inspection.worktree_shares_credentials) return "degraded";
	if (inspection.daemon_uid === null || inspection.worktree_uid === null) return "degraded";
	if (inspection.daemon_uid === inspection.worktree_uid && !inspection.isolated_runner_boundary) return "degraded";
	return "isolated";
}

/**
 * Read the daemon/worktree UIDs from the running process and the worktree path.
 * Anything unreadable stays null, which `detectIdentityPosture` treats as degraded.
 */
export function inspectDaemonIdentity(
	worktreePath: string,
	overrides: Partial<IdentityInspection> = {},
): IdentityInspection {
	const daemonUid =
		overrides.daemon_uid !== undefined
			? overrides.daemon_uid
			: typeof process.getuid === "function"
				? process.getuid()
				: null;

	let worktreeUid = overrides.worktree_uid ?? null;
	if (overrides.worktree_uid === undefined) {
		try {
			worktreeUid = statSync(worktreePath).uid;
		} catch {
			worktreeUid = null;
		}
	}

	return {
		daemon_uid: daemonUid,
		worktree_uid: worktreeUid,
		isolated_runner_boundary: overrides.isolated_runner_boundary ?? false,
		worktree_shares_credentials: overrides.worktree_shares_credentials ?? false,
	};
}

/** The denial reason for one capability under a posture, or null when it is permitted. */
export function capabilityRefusal(posture: LoopIdentityPosture, capability: LoopCapability): string | null {
	if (capability === "merge_pr") return "merge_pr is human-only in every posture";
	if (posture === "degraded" && DEGRADED_DENIED.includes(capability)) {
		return `same-UID degraded posture withholds ${capability}`;
	}
	return null;
}
