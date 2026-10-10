// Read-only identification of a Lane worktree from its checked-out branch.
// A Lane sits on `imm-lane/<initiative-slug>/<task-id>` (ADR 0013), so the
// settling Host can tell a Lane settlement from a coordinator or single-task
// settlement without reading any batch state.
import { spawnSync } from "node:child_process";

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
