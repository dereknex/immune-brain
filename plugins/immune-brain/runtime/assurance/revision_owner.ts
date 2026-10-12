// Host-neutral revision-owner guard (Spec ceremony-trim-r647 T3, D7-D9). A
// session whose latest literal entry is a plan entry must not edit files inside
// the scope of the task another session is executing: the Loop owner prepares
// scope and acceptance revisions in the executing session. The guard prevents
// one mistake; it is not an authority boundary, so an unreadable entry store or
// claim denies nothing. The decision is pure; a Host supplies the entry state
// and `revisionOwnerEditRefusal` reads the active claim's scope for it.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readTaskRecordRaw } from "../kernel/storage";
import { readActiveClaimTaskId } from "../unattended/batch_preflight";
import { pathMatchesScope } from "../workspace_scope";
import type { PhaseEntryState } from "./phase_entry";

export const REVISION_OWNER_REQUIRED = "revision_owner_required";
export const REVISION_OWNER_RECOVERY =
	"return the proposed change to the executing session, which prepares the revision through its Loop";

// Planning sidecars stay editable from a Planner session.
const PLANNING_SIDECARS = ["docs/plans", "docs/specs"];

export interface RevisionOwnerRefusal {
	reason_code: typeof REVISION_OWNER_REQUIRED;
	detail: string;
	recovery_action: string;
}

/**
 * `path` is repository-relative with forward slashes. `activeScope` is the
 * active claim's scope, or null when there is no active claim or it is unreadable.
 */
export function revisionOwnerRefusal(
	state: PhaseEntryState | null,
	activeScope: readonly string[] | null,
	path: string,
): RevisionOwnerRefusal | null {
	if (!state?.plan_latest || !activeScope || activeScope.length === 0) return null;
	if (PLANNING_SIDECARS.some((dir) => pathMatchesScope(path, dir))) return null;
	if (!activeScope.some((entry) => pathMatchesScope(path, entry))) return null;
	return {
		reason_code: REVISION_OWNER_REQUIRED,
		detail: `${path} is inside the scope of the task another session is executing, and this session's latest entry is a plan entry`,
		recovery_action: REVISION_OWNER_RECOVERY,
	};
}

/** The single-line message both Hosts return for a refusal. */
export function revisionOwnerMessage(refusal: RevisionOwnerRefusal): string {
	return `${refusal.reason_code}: ${refusal.detail}; recovery: ${refusal.recovery_action}`;
}

function realpathOfNearest(path: string): string {
	let current = path;
	const suffix: string[] = [];
	for (;;) {
		try {
			return join(realpathSync(current), ...suffix.reverse());
		} catch {
			const parent = dirname(current);
			if (parent === current) return path;
			suffix.push(basename(current));
			current = parent;
		}
	}
}

/**
 * A Host file-edit tool call: the refusal message when this session's latest
 * entry is a plan entry, the workspace has an active claim, and `target` lies
 * inside that claim's scope. Anything unreadable denies nothing (D7).
 */
export function revisionOwnerEditRefusal(cwd: string, target: unknown, state: PhaseEntryState | null): string | null {
	if (typeof target !== "string" || !target || !state?.plan_latest) return null;
	try {
		const top = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
		const root = realpathOfNearest(top.status === 0 ? (top.stdout ?? "").trim() : cwd);
		const taskId = readActiveClaimTaskId(root);
		if (!taskId) return null;
		const record = readTaskRecordRaw(root, taskId).record;
		if (!record || record.lifecycle === "done" || record.lifecycle === "stopped") return null;
		const inside = relative(root, realpathOfNearest(isAbsolute(target) ? target : resolve(cwd, target)));
		if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return null;
		const refusal = revisionOwnerRefusal(state, record.intent_snapshot.scope_hint, inside.split(sep).join("/"));
		return refusal ? revisionOwnerMessage(refusal) : null;
	} catch {
		return null;
	}
}
