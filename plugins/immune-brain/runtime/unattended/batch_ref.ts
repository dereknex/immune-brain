// The hidden ref a batch advances instead of a user-visible branch (D10, T2 of
// docs/specs/content-delivery-authority.spec.md). Progress and Lane bases live
// on `refs/imm/batches/<batch_id>`, built with Git plumbing and a temporary
// index, so the user's HEAD, branch and index never move. A delivery reaches the
// user's working tree only by an explicit, conflict-checked scoped apply.
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const BATCH_REF_PREFIX = "refs/imm/batches/";

/** Fully qualified Parent refs distinguish new records from legacy checked-out branches. */
export function parentBranchRef(slug: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug) || slug.includes("..") || slug.endsWith(".lock"))
		throw new Error("invalid Parent branch slug");
	return `refs/heads/imm/${slug}`;
}

export function isParentBranch(branch: string | undefined | null): branch is string {
	return typeof branch === "string" && branch.startsWith("refs/heads/imm/");
}

export function isProgressRef(branch: string | undefined | null): branch is string {
	return isBatchRef(branch) || isParentBranch(branch);
}
const NULL_OID = "0".repeat(40);

/** The hidden ref one batch owns. */
export function batchRefName(batchId: string): string {
	const ref = `${BATCH_REF_PREFIX}${batchId}`;
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(batchId) || batchId.endsWith(".lock") || batchId.includes(".."))
		throw new Error(`batch id ${JSON.stringify(batchId)} cannot name a hidden ref`);
	return ref;
}

/** Whether a recorded batch `branch` is a hidden ref rather than a legacy user branch. */
export function isBatchRef(branch: string | undefined | null): branch is string {
	return typeof branch === "string" && branch.startsWith(BATCH_REF_PREFIX) && branch.length > BATCH_REF_PREFIX.length;
}

export const BATCH_COMMITTER_ENV = {
	GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "Immune-Brain Batch",
	GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "immune-brain@local",
	GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "Immune-Brain Batch",
	GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "immune-brain@local",
};

function run(root: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}) {
	return spawnSync("git", ["-C", root, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
		encoding: "utf8",
		input: options.input,
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env, ...options.env },
	});
}

function out(root: string, args: string[], failure: string, options?: { input?: string; env?: NodeJS.ProcessEnv }): string {
	const result = run(root, args, options);
	if (result.status !== 0) throw new Error(`${failure}: ${result.stderr.trim() || `git ${args[0]} failed`}`);
	return result.stdout;
}

const splitZ = (text: string): string[] => text.split("\0").filter((entry) => entry.length > 0);

/** The commit a hidden ref points at, or null when it does not exist. */
export function readBatchRef(root: string, ref: string): string | null {
	const result = run(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
	if (result.status === 0) return result.stdout.trim() || null;
	if (result.status === 1) return null;
	throw new Error(`failed to read ${ref}: ${result.stderr.trim() || "git rev-parse failed"}`);
}

function assertParentNotCheckedOut(root: string, ref: string): void {
	if (!isParentBranch(ref)) return;
	const worktrees = out(root, ["worktree", "list", "--porcelain", "-z"], "failed to inspect Parent checkouts");
	if (worktrees.split("\0").includes(`branch ${ref}`))
		throw new Error(`batch_parent_branch_checked_out: ${ref} is checked out`);
}

/** Create the progress ref; an existing ref at the same commit is a retry. */
export function createBatchRef(root: string, ref: string, base: string): void {
	assertParentNotCheckedOut(root, ref);
	const created = run(root, ["update-ref", ref, base, NULL_OID]);
	if (created.status === 0) return;
	if (readBatchRef(root, ref) === base) return;
	throw new Error(`batch_ref_exists: ${ref} already exists at a different commit`);
}

/** Move the hidden ref only from the commit the caller expects it to hold. */
export function moveBatchRef(root: string, ref: string, from: string, to: string): void {
	assertParentNotCheckedOut(root, ref);
	const moved = run(root, ["update-ref", ref, to, from]);
	if (moved.status !== 0)
		throw new Error(`batch_head_lineage_broken: ${ref} did not move from ${from} to ${to}: ${moved.stderr.trim() || "git update-ref failed"}`);
}

function withTemporaryIndex<T>(root: string, commit: string, use: (env: NodeJS.ProcessEnv) => T): T {
	const directory = mkdtempSync(join(tmpdir(), "imm-batch-index-"));
	try {
		const env = { GIT_INDEX_FILE: join(directory, "index") };
		out(root, ["read-tree", commit], `failed to read the tree of ${commit}`, { env });
		return use(env);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

/**
 * Paths whose working-tree content differs from `commit`: tracked edits and
 * deletions plus untracked, non-ignored files. Reads the user's working tree and
 * never touches the user's index.
 */
export function pathsDirtyAgainst(root: string, commit: string): string[] {
	return withTemporaryIndex(root, commit, (env) => {
		const tracked = out(root, ["diff", "--name-only", "-z", "--no-renames", "--ignore-submodules=none"], "failed to inspect the working tree", { env });
		const untracked = out(root, ["ls-files", "--others", "--exclude-standard", "-z"], "failed to inspect untracked files", { env });
		return [...new Set([...splitZ(tracked), ...splitZ(untracked)])];
	});
}

/**
 * The given paths a `.gitignore` rule would keep out of a commit. A tracked path
 * is never reported, matching what `git add -A` would skip.
 */
export function ignoredPaths(root: string, paths: readonly string[]): string[] {
	if (paths.length === 0) return [];
	const result = spawnSync("git", ["-C", root, "check-ignore", "-z", "--stdin"], {
		encoding: "utf8",
		input: `${paths.join("\0")}\0`,
		stdio: ["pipe", "pipe", "pipe"],
	});
	if (result.status === 1) return [];
	if (result.status !== 0) throw new Error(`failed to check ignore rules: ${result.stderr.trim() || "git check-ignore failed"}`);
	return splitZ(result.stdout);
}

export interface BatchCommitInput {
	parent: string;
	/** Exact repository-relative paths whose working-tree content becomes the commit's content. */
	paths: readonly string[];
	message: string;
}

/**
 * An unreferenced commit whose tree is `parent`'s tree with `paths` taken from
 * the working tree. A temporary index carries the change, so the user's index is
 * untouched. The caller moves the hidden ref.
 */
export function buildScopedCommit(root: string, input: BatchCommitInput): string {
	return withTemporaryIndex(root, input.parent, (env) => {
		if (input.paths.length > 0)
			out(root, ["--literal-pathspecs", "add", "-A", "--", ...input.paths], "failed to stage the batch delivery", { env });
		const tree = out(root, ["write-tree"], "failed to write the batch tree", { env }).trim();
		const commit = out(root, ["commit-tree", tree, "-p", input.parent, "-F", "-"], "failed to create the batch commit", {
			input: input.message,
			env: BATCH_COMMITTER_ENV,
		}).trim();
		if (!commit) throw new Error("failed to create the batch commit: no commit produced");
		return commit;
	});
}

/** Paths whose content, mode or presence differs between two commits. */
export function changedPaths(root: string, from: string, to: string): string[] {
	return splitZ(out(root, ["diff-tree", "-r", "--name-only", "-z", "--no-renames", "--no-commit-id", from, to], `failed to compare ${from} and ${to}`));
}

interface TreeEntry {
	mode: string;
	oid: string;
}

function entryAt(root: string, commit: string, path: string): TreeEntry | null {
	const listed = out(root, ["ls-tree", "-z", commit, "--", path], `failed to read ${path} at ${commit}`);
	const record = splitZ(listed)[0];
	if (!record) return null;
	const match = /^(\d+) \w+ ([0-9a-f]+)\t/.exec(record);
	return match ? { mode: match[1]!, oid: match[2]! } : null;
}

function blob(root: string, oid: string): Buffer {
	const result = spawnSync("git", ["-C", root, "cat-file", "blob", oid], { stdio: ["ignore", "pipe", "pipe"] });
	if (result.status !== 0) throw new Error(`failed to read blob ${oid}: ${result.stderr.toString().trim()}`);
	return result.stdout;
}

function hashOf(root: string, bytes: Buffer): string {
	const result = spawnSync("git", ["-C", root, "hash-object", "--stdin"], { input: bytes, stdio: ["pipe", "pipe", "pipe"] });
	if (result.status !== 0) throw new Error(`failed to hash a working-tree file: ${result.stderr.toString().trim()}`);
	return result.stdout.toString().trim();
}

/** The working-tree state of one path as a tree entry, or null when absent. */
function workingEntry(root: string, path: string): TreeEntry | null {
	const full = join(root, path);
	let stat;
	try {
		stat = lstatSync(full);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") return null;
		throw error;
	}
	if (stat.isSymbolicLink()) return { mode: "120000", oid: hashOf(root, Buffer.from(readlinkSync(full))) };
	if (!stat.isFile()) return { mode: "other", oid: "" };
	return { mode: (stat.mode & 0o111) !== 0 ? "100755" : "100644", oid: hashOf(root, readFileSync(full)) };
}

const sameEntry = (a: TreeEntry | null, b: TreeEntry | null): boolean =>
	a === null || b === null ? a === b : a.oid === b.oid && a.mode === b.mode;

export interface DeltaApplication {
	applied: string[];
	/** Paths whose working-tree content is neither the old nor the new version. */
	conflicts: string[];
}

/**
 * Check, without writing, whether the delta `from → to` over `paths` can land in
 * the working tree. A path is safe when it still holds the `from` version (the
 * delivery is not applied yet) or already holds the `to` version (a retried
 * apply). Anything else is a local edit the delivery would overwrite.
 */
export function checkDeltaApplies(root: string, from: string, to: string, paths: readonly string[]): string[] {
	const conflicts: string[] = [];
	for (const path of paths) {
		const before = entryAt(root, from, path);
		const after = entryAt(root, to, path);
		if (after?.mode === "160000" || before?.mode === "160000") {
			conflicts.push(path);
			continue;
		}
		const current = workingEntry(root, path);
		if (!sameEntry(current, before) && !sameEntry(current, after)) conflicts.push(path);
	}
	return conflicts.sort();
}

/**
 * Write the delta `from → to` over `paths` into the user's working tree. The
 * index and HEAD are never touched. Refuses, writing nothing, when any path
 * holds a local edit; the refusal names every conflicting path.
 */
export function applyDeltaToWorkingTree(root: string, from: string, to: string, paths: readonly string[]): DeltaApplication {
	const conflicts = checkDeltaApplies(root, from, to, paths);
	if (conflicts.length > 0) return { applied: [], conflicts };
	const applied: string[] = [];
	for (const path of paths) {
		const full = join(root, path);
		const after = entryAt(root, to, path);
		if (sameEntry(workingEntry(root, path), after)) continue;
		if (after === null) {
			try {
				unlinkSync(full);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		} else {
			mkdirSync(dirname(full), { recursive: true });
			try {
				unlinkSync(full);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			const bytes = blob(root, after.oid);
			if (after.mode === "120000") symlinkSync(bytes.toString("utf8"), full);
			else {
				writeFileSync(full, bytes);
				chmodSync(full, after.mode === "100755" ? 0o755 : 0o644);
			}
		}
		applied.push(path);
	}
	return { applied, conflicts: [] };
}

/**
 * The commit a batch currently stands on: the tip of its hidden ref, or HEAD
 * for a legacy batch recorded against a checked-out branch. Null when unreadable.
 */
export function liveBatchHead(root: string, branch: string | null | undefined): string | null {
	if (isProgressRef(branch)) return readBatchRef(root, branch);
	const head = run(root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
	return head.status === 0 ? head.stdout.trim() || null : null;
}
