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

/** Parent of every Lane; a checkout below it resolves dependencies as a Lane does. */
export function worktreeDirectory(root: string): string {
	const common = realpathSync(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
	const directory = join(common, "imm", "worktrees");
	mkdirSync(directory, { recursive: true });
	if (realpathSync(directory) !== directory) throw new Error("batch_worktree_failed: worktree directory contains a symlink");
	return directory;
}

/** Read-only collision check, repeated immediately before exclusive creation. */
export function assertLaneWorktreeAvailable(root: string, slug: string, taskId: string): void {
	parentBranchRef(slug);
	parentBranchRef(taskId);
	const common = realpathSync(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
	const path = join(common, "imm", "worktrees", slug, taskId);
	const branch = `refs/heads/imm-lane/${slug}/${taskId}`;
	const found = spawnSync("git", ["-C", root, "show-ref", "--verify", "--quiet", branch]);
	const symbolic = spawnSync("git", ["-C", root, "symbolic-ref", "--quiet", branch]);
	if (lstatSync(path, { throwIfNoEntry: false }) || found.status !== 1 || symbolic.status !== 1 ||
		git(root, ["worktree", "list", "--porcelain", "-z"]).split("\0").includes(`worktree ${path}`))
		throw new Error(`batch_worktree_failed: ${path} (${branch}) has no recorded Lane binding; resource retained`);
}

export function createLaneWorktree(root: string, slug: string, taskId: string, head: string): string {
	assertLaneWorktreeAvailable(root, slug, taskId);
	const branch = `imm-lane/${slug}/${taskId}`;
	const directory = join(worktreeDirectory(root), slug);
	mkdirSync(directory, { recursive: true });
	if (realpathSync(directory) !== directory) throw new Error("batch_worktree_failed: Lane directory contains a symlink");
	const path = join(directory, taskId);
	if (existsSync(path))
		throw new Error(`batch_worktree_failed: ${path} (${branch}) has no recorded Lane binding; resource retained`);
	// Git adopts existing empty directories, so reserve the path before creating any ref.
	try { mkdirSync(path); }
	catch (error) { throw new Error(`batch_worktree_failed: cannot exclusively reserve ${path}; resource retained`, { cause: error }); }
	// Porcelain -b dereferences dangling symbolic refs; create the direct ref exclusively first.
	try {
		git(root, ["update-ref", "--no-deref", `refs/heads/${branch}`, head, "0".repeat(40)]);
		git(root, ["worktree", "add", path, branch]);
	} catch (error) {
		throw new Error(`${error instanceof Error ? error.message : String(error)}; unbound Lane reservation retained at ${path}`, { cause: error });
	}
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
