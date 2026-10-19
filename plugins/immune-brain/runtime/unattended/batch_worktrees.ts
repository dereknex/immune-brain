// Runtime-owned worktrees for Parent-branch batches (ADR 0027).
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { observeEnrollmentTaskIntent } from "../kernel/intent";
import { readBoundActiveSpec } from "../kernel/spec_binding";
import { readSecureProjectFile } from "../kernel/storage";
import { parentBranchRef } from "./batch_ref";

function git(root: string, args: string[]): string {
	const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
	if (result.status !== 0) throw new Error(`batch_worktree_failed: ${result.stderr.trim() || args.join(" ")}`);
	return result.stdout.trim();
}

function worktreeDirectory(root: string): string {
	const common = realpathSync(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
	const directory = join(common, "imm", "worktrees");
	mkdirSync(directory, { recursive: true });
	if (realpathSync(directory) !== directory) throw new Error("batch_worktree_failed: worktree directory contains a symlink");
	return directory;
}

export function createLaneWorktree(root: string, slug: string, taskId: string, head: string): string {
	parentBranchRef(slug);
	parentBranchRef(taskId);
	const branch = `imm-lane/${slug}/${taskId}`;
	const directory = join(worktreeDirectory(root), slug);
	mkdirSync(directory, { recursive: true });
	if (realpathSync(directory) !== directory) throw new Error("batch_worktree_failed: Lane directory contains a symlink");
	const path = join(directory, taskId);
	if (existsSync(path)) {
		// Recover only the exact clean Lane left between worktree creation and admission.
		if (realpathSync(path) !== path ||
			realpathSync(git(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"])) !==
			realpathSync(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])) ||
			git(path, ["symbolic-ref", "--short", "HEAD"]) !== branch || git(path, ["rev-parse", "HEAD"]) !== head ||
			git(path, ["status", "--porcelain", "--untracked-files=all"]))
			throw new Error("batch_worktree_failed: existing Lane does not match the requested clean base");
		return path;
	}
	git(root, ["worktree", "add", "-b", branch, path, head]);
	return path;
}

/** Carry only planning inputs, never arbitrary coordinator edits or its index. */
export function copyLanePlanningInput(root: string, lane: string, taskId: string, kind: "intent" | "spec"): void {
	const read = observeEnrollmentTaskIntent(root, taskId);
	const input = kind === "intent"
		? { path: read.intent_ref.path, content: readSecureProjectFile(root, read.intent_ref.path) }
		: readBoundActiveSpec(root, read.intent);
	if (!input) return;
	const parts = input.path.split("/");
	let directory = lane;
	for (const part of parts.slice(0, -1)) {
		directory = join(directory, part);
		if (!existsSync(directory)) mkdirSync(directory);
		if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
			throw new Error("batch_worktree_failed: planning directory is not a real directory");
	}
	const target = join(lane, input.path);
	const stat = lstatSync(target, { throwIfNoEntry: false });
	if (stat && (!stat.isFile() || stat.isSymbolicLink()))
		throw new Error("batch_worktree_failed: planning input is not a regular file");
	writeFileSync(target, input.content);
	git(lane, ["add", "--", input.path]);
}

/** Refuses dirty/unowned paths; no --force on a child Lane. */
export function removeLaneWorktree(root: string, path: string, branch: string, commit: string): boolean {
	if (!existsSync(path)) return false;
	const directory = worktreeDirectory(root);
	if (!path.startsWith(`${directory}/`) || realpathSync(path) !== path ||
		git(path, ["symbolic-ref", "--short", "HEAD"]) !== branch ||
		git(path, ["rev-parse", "HEAD"]) !== commit ||
		git(path, ["status", "--porcelain", "--untracked-files=all"])) return false;
	git(root, ["worktree", "remove", path]);
	git(root, ["update-ref", "-d", `refs/heads/${branch}`, commit]);
	return true;
}

/** The detached checkout is disposable, including files produced by verification. */
export async function withParentWorktree<T>(root: string, head: string, use: (path: string) => Promise<T>): Promise<T> {
	const path = mkdtempSync(join(worktreeDirectory(root), "verify-"));
	rmdirSync(path);
	git(root, ["worktree", "add", "--detach", path, head]);
	try {
		return await use(path);
	} finally {
		git(root, ["worktree", "remove", "--force", path]);
	}
}
