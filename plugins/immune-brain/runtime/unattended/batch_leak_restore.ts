// Coordinator-side recovery for a Lane Executor's writes that landed in the
// coordinator checkout instead of its Lane. On a lane-batch re-entry with a
// dirty coordinator working tree, every dirty path must be provably a Lane's:
// that Lane changed the path (its bytes differ from the Lane's base) and the
// coordinator's bytes equal the Lane's, in its worktree or a commit on its
// branch. Planning is read-only, so the batch preflight can run it before any
// gate; only the runner, after authorization, backs the paths up, restores
// them to HEAD and records the restore. Anything else (a staged change, a
// deletion, bytes no Lane wrote) leaves every file untouched, so a user's own
// uncommitted work is never restored.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BatchLaneRunStateRecord } from "./batch_state";

export interface LaneLeakRestore {
	at: string;
	/** Repository-relative directory holding the backed-up bytes and `restore.json`. */
	backup: string;
	paths: Array<{ path: string; kind: "modified" | "untracked"; lane_task_id: string }>;
}

function git(root: string, args: string[]): { status: number | null; stdout: string } {
	const result = spawnSync("git", ["-C", root, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
	});
	return { status: result.status, stdout: result.stdout ?? "" };
}

function blobOfFile(root: string, file: string): string | null {
	const hashed = git(root, ["hash-object", "--no-filters", "--", file]);
	return hashed.status === 0 ? hashed.stdout.trim() : null;
}

function blobAt(root: string, commit: string, path: string): string | null {
	const blob = git(root, ["rev-parse", "--verify", "--quiet", `${commit}:${path}`]);
	return blob.status === 0 ? blob.stdout.trim() : null;
}

/**
 * The Lane of this batch that wrote `blob` at `path`, or null. A Lane only
 * counts when its bytes for the path differ from the Lane's own base: a Lane
 * that never touched the path still holds its base bytes, and matching those
 * would mistake a user's revert for a Lane write.
 */
function laneOrigin(root: string, record: BatchLaneRunStateRecord, path: string, blob: string): string | null {
	for (const child of record.children) {
		const lane = child.lane;
		if (!lane) continue;
		if (blobAt(root, lane.base_head, path) === blob) continue;
		if (existsSync(join(lane.path, path)) && blobOfFile(lane.path, join(lane.path, path)) === blob) return child.task_id;
		const commits = git(root, ["rev-list", `${lane.base_head}..${lane.branch}`]);
		if (commits.status !== 0) continue;
		for (const commit of commits.stdout.split("\n").filter(Boolean))
			if (blobAt(root, commit, path) === blob) return child.task_id;
	}
	return null;
}

export type LeakRestorePlan =
	| { kind: "clean" }
	| { kind: "provable"; paths: LaneLeakRestore["paths"] }
	| { kind: "unprovable"; path: string; detail: string };

/** Read-only: attribute every dirty path to a Lane of this batch, or name the first that cannot be. */
export function planLaneLeakRestore(
	root: string,
	record: BatchLaneRunStateRecord,
	entries: Array<{ code: string; path: string }>,
): LeakRestorePlan {
	if (entries.length === 0) return { kind: "clean" };
	const planned: LaneLeakRestore["paths"] = [];
	for (const { code, path } of entries) {
		if (path.startsWith(".imm/")) return { kind: "unprovable", path, detail: "Immune-Brain state is never restored" };
		const kind = code === "??" ? "untracked" : code === " M" ? "modified" : null;
		if (!kind) return { kind: "unprovable", path, detail: `status ${code.trim() || code} is not a Lane write` };
		const blob = blobOfFile(root, join(root, path));
		if (!blob) return { kind: "unprovable", path, detail: "its bytes cannot be read" };
		const origin = laneOrigin(root, record, path, blob);
		if (!origin) return { kind: "unprovable", path, detail: "its bytes match no Lane of this batch" };
		planned.push({ path, kind, lane_task_id: origin });
	}
	return { kind: "provable", paths: planned };
}

/**
 * Back up and restore an already planned, fully provable set. Called only by
 * the runner after the batch is authorized; it re-plans against the current
 * status first, so a change since the preflight is never restored blind.
 */
export function restoreProvableLaneLeaks(
	root: string,
	record: BatchLaneRunStateRecord,
	entries: Array<{ code: string; path: string }>,
	now: string,
): { kind: "clean" } | { kind: "restored"; restore: LaneLeakRestore } | { kind: "unprovable"; path: string; detail: string } {
	const plan = planLaneLeakRestore(root, record, entries);
	if (plan.kind !== "provable") return plan;
	const planned = plan.paths;
	const stamp = now.replace(/[^0-9TZ]/g, "");
	const backup = join(".imm", "state", "batches", "restores", record.batch_id, stamp);
	const backupRoot = join(root, backup);
	mkdirSync(join(backupRoot, "files"), { recursive: true });
	const tracked = planned.filter((p) => p.kind === "modified").map((p) => p.path);
	if (tracked.length > 0) {
		const diff = git(root, ["diff", "--binary", "HEAD", "--", ...tracked]);
		writeFileSync(join(backupRoot, "restore.patch"), diff.stdout);
	}
	// Back every modified path up before changing any of them; an untracked
	// path is moved into the backup below, so it keeps exactly one copy.
	for (const { path, kind } of planned) {
		mkdirSync(dirname(join(backupRoot, "files", path)), { recursive: true });
		if (kind === "modified") copyFileSync(join(root, path), join(backupRoot, "files", path));
	}
	const restore: LaneLeakRestore = { at: now, backup, paths: planned };
	writeFileSync(join(backupRoot, "restore.json"), `${JSON.stringify({
		...restore,
		undo: "copy each file under files/ back to the same repository path",
	}, null, 2)}\n`);
	for (const { path, kind } of planned) {
		if (kind === "untracked") {
			renameSync(join(root, path), join(backupRoot, "files", path));
			continue;
		}
		const restored = git(root, ["restore", "--source=HEAD", "--worktree", "--", path]);
		if (restored.status !== 0) throw new Error(`failed to restore ${path} from HEAD; its bytes are backed up under ${backup}`);
	}
	return { kind: "restored", restore };
}
