// Read-only identification of a Lane worktree from its checked-out branch.
// A Lane sits on `imm-lane/<initiative-slug>/<task-id>` (ADR 0013), so the
// settling Host can tell a Lane settlement from a coordinator or single-task
// settlement without reading any batch state.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

const LANE_BRANCH = /^imm-lane\/[^/]+\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/;

/** The task id the Lane at `root` was cut for, or null when `root` is not a Lane. */
export function laneTaskOfWorkspace(root: string): string | null {
	const branch = spawnSync("git", ["-C", root, "symbolic-ref", "--quiet", "--short", "HEAD"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (branch.status !== 0) return null;
	return LANE_BRANCH.exec((branch.stdout ?? "").trim())?.[1] ?? null;
}

/** True when `root` is the Lane of `taskId`: its tracker close waits for integration. */
export function isLaneWorkspaceForTask(root: string, taskId: string): boolean {
	return laneTaskOfWorkspace(root) === taskId;
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
 * Refusal text for an `edit`/`write` a Lane session aims outside its Lane, or
 * null when `cwd` is not a Lane or the target is inside it. The target is
 * resolved against `cwd` and through symlinks of its nearest existing
 * ancestor. Only file-editing tools are checked: a shell command is not
 * intercepted, and the contract says so.
 */
export function laneWriteRefusal(cwd: string, target: unknown): string | null {
	if (typeof target !== "string" || !target) return null;
	if (laneTaskOfWorkspace(cwd) === null) return null;
	const top = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
	if (top.status !== 0) return null;
	const laneRoot = realpathOfNearest((top.stdout ?? "").trim());
	const resolved = realpathOfNearest(isAbsolute(target) ? target : resolve(cwd, target));
	const inside = relative(laneRoot, resolved);
	if (inside === "" || (!inside.startsWith("..") && !isAbsolute(inside))) return null;
	return `Lane write refused: ${resolved} is outside this Lane. In a batch Lane every edit and write stays under ${laneRoot}; use the same repository-relative path inside the Lane.`;
}
