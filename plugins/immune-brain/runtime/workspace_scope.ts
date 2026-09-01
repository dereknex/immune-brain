import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	readFileSync,
	readlinkSync,
	realpathSync,
} from "node:fs";
import { resolve } from "node:path";

export interface GitWorkspaceSnapshot {
	kind: "git-workspace-v1";
	repository_root: string;
	head: string;
	dirty_files: Record<string, string>;
}

function git(root: string, args: string[]): string | null {
	const result = spawnSync("git", ["-C", root, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return result.status === 0 ? result.stdout : null;
}

function splitNull(value: string): string[] {
	return value.split("\0").filter((entry) => entry.length > 0);
}

function comparePaths(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function isRuntimeAuthorityPath(path: string): boolean {
	return (
		// Kernel v2 task state, workspace coordination, and authority journals are
		// runtime-owned and must not change the code/workspace diff identity.
		// State-layout cutover: .imm/state/ is wholly ignored runtime state;
		// .imm/audit/ is tracked evidence and must NEVER be excluded here.
		// The legacy .imm/tasks/.imm/memory/ paths remain excluded until the
		// one-release migration relocates them (Slice 2 deletes those arms).
		path === ".imm/workspace.json" ||
		path.startsWith(".imm/tasks/") ||
		path.startsWith(".imm/memory/") ||
		path.startsWith(".imm/state/") ||
		path.startsWith(".imm/authority/") ||
		path.startsWith(".imm/journal") ||
		path === "HANDOFF.md"
	);
}

function fileFingerprint(root: string, relativePath: string): string {
	const absolutePath = resolve(root, relativePath);
	if (!existsSync(absolutePath)) return "missing";
	const stat = lstatSync(absolutePath);
	if (stat.isSymbolicLink()) return `symlink:${readlinkSync(absolutePath)}`;
	if (!stat.isFile()) return `other:${stat.mode}:${stat.size}`;
	return `file:${stat.mode}:${createHash("sha256")
		.update(readFileSync(absolutePath))
		.digest("hex")}`;
}

function dirtyPaths(root: string): string[] | null {
	const tracked = git(root, ["diff", "--name-only", "-z", "HEAD", "--"]);
	const untracked = git(root, [
		"ls-files",
		"--others",
		"--exclude-standard",
		"-z",
		"--",
	]);
	if (tracked === null || untracked === null) return null;
	return [...new Set([...splitNull(tracked), ...splitNull(untracked)])]
		.filter((path) => !isRuntimeAuthorityPath(path))
		.sort(comparePaths);
}

export function captureGitWorkspaceSnapshot(
	projectRoot: string,
): GitWorkspaceSnapshot | null {
	const root = realpathSync(resolve(projectRoot));
	const repositoryRoot = git(root, ["rev-parse", "--show-toplevel"])?.trim();
	const head = git(root, ["rev-parse", "HEAD"])?.trim();
	if (
		!repositoryRoot ||
		!head ||
		realpathSync(resolve(repositoryRoot)) !== root
	)
		return null;
	const paths = dirtyPaths(root);
	if (!paths) return null;
	return {
		kind: "git-workspace-v1",
		repository_root: root,
		head,
		dirty_files: Object.fromEntries(
			paths.map((path) => [path, fileFingerprint(root, path)]),
		),
	};
}

export function workspaceDiffHash(projectRoot: string): string {
	const snapshot = captureGitWorkspaceSnapshot(projectRoot);
	if (!snapshot) throw new Error("Cannot derive workspace diff without a Git workspace.");
	return `sha256:${createHash("sha256")
		.update(JSON.stringify(snapshot))
		.digest("hex")}`;
}

export interface GitTaskIndexEntry {
	status: "added" | "modified" | "deleted";
	mode: "100644" | "100755" | "120000" | null;
	oid: string | null;
	base_mode: "100644" | "100755" | "120000" | null;
	base_oid: string | null;
}

export interface GitTaskSnapshot {
	kind: "git-task-index-v1";
	repository_root: string;
	head: string;
	scope: string[];
	staged_files: Record<string, GitTaskIndexEntry>;
}

const GIT_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const TASK_GIT_MODES = new Set(["100644", "100755", "120000"] as const);
const fatalUtf8 = new TextDecoder("utf-8", { fatal: true });
const portablePathCollator = new Intl.Collator("und", {
	usage: "search",
	sensitivity: "base",
	numeric: false,
	ignorePunctuation: false,
});
let gitTaskSnapshotTestHook: (() => void) | undefined;

export function setGitTaskSnapshotTestHook(hook: () => void): () => void {
	const previous = gitTaskSnapshotTestHook;
	gitTaskSnapshotTestHook = hook;
	return () => {
		if (gitTaskSnapshotTestHook === hook) gitTaskSnapshotTestHook = previous;
	};
}

function gitBytes(root: string, args: string[]): Buffer {
	const result = spawnSync("git", ["-C", root, ...args], {
		encoding: null,
		stdio: ["ignore", "pipe", "pipe"],
		maxBuffer: 8 * 1024 * 1024,
	});
	if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
		throw new Error(`Git task snapshot command failed: git ${args.join(" ")}`);
	}
	return result.stdout;
}

function decodeCanonicalGitPath(bytes: Buffer, label: string): string {
	let value: string;
	try {
		value = fatalUtf8.decode(bytes);
	} catch {
		throw new Error(`${label} contains invalid UTF-8 path bytes`);
	}
	if (!Buffer.from(value, "utf8").equals(bytes))
		throw new Error(`${label} path does not round-trip through UTF-8`);
	if (value.normalize("NFC") !== value)
		throw new Error(`${label} path is not NFC-normalized: ${value}`);
	if (
		!value ||
		value.includes("\0") ||
		value.includes("\\") ||
		value.startsWith("/") ||
		/^[A-Za-z]:\//.test(value) ||
		value.split("/").some((part) => !part || part === "." || part === "..")
	)
		throw new Error(`${label} is not a canonical project-relative path: ${value}`);
	return value;
}

function decodeNullPaths(bytes: Buffer, label: string): string[] {
	if (bytes.length === 0) return [];
	if (bytes[bytes.length - 1] !== 0)
		throw new Error(`${label} is not NUL-terminated`);
	const paths: string[] = [];
	let start = 0;
	for (let index = 0; index < bytes.length; index += 1) {
		if (bytes[index] !== 0) continue;
		if (index === start) throw new Error(`${label} contains an empty path`);
		paths.push(decodeCanonicalGitPath(bytes.subarray(start, index), label));
		start = index + 1;
	}
	return paths;
}

function decodeIndexFlaggedPaths(bytes: Buffer, label: string): Array<{ path: string; flag: "assume-unchanged" | "skip-worktree" }> {
	if (bytes.length === 0) return [];
	if (bytes[bytes.length - 1] !== 0) throw new Error(`${label} is not NUL-terminated`);
	const flagged: Array<{ path: string; flag: "assume-unchanged" | "skip-worktree" }> = [];
	let start = 0;
	for (let index = 0; index < bytes.length; index += 1) {
		if (bytes[index] !== 0) continue;
		const record = bytes.subarray(start, index);
		if (record.length < 3 || record[1] !== 0x20) throw new Error(`${label} contains a malformed entry`);
		const tag = String.fromCharCode(record[0]);
		if (tag === "h" || tag === "S") {
			flagged.push({
				path: decodeCanonicalGitPath(record.subarray(2), label),
				flag: tag === "h" ? "assume-unchanged" : "skip-worktree",
			});
		}
		start = index + 1;
	}
	return flagged;
}

function assertNoScopedIndexFlags(root: string, scope: string[], label: string): void {
	const flagged = decodeIndexFlaggedPaths(gitBytes(root, ["ls-files", "-v", "-z", "--"]), "Git index flags")
		.filter(({ path }) => taskPathMatchesScope(path, scope));
	if (flagged.length > 0)
		throw new Error(`${label} contains unsupported index flags: ${flagged.map(({ path, flag }) => `${path} (${flag})`).join(", ")}`);
}

function assertNoCaseFoldCollisions(paths: string[], label: string): void {
	const prefixes: string[] = [];
	for (const path of paths) {
		let prefix = "";
		for (const component of path.split("/")) {
			prefix = prefix ? `${prefix}/${component}` : component;
			const prior = prefixes.find(
				(candidate) => candidate !== prefix && portablePathCollator.compare(candidate, prefix) === 0,
			);
			if (prior !== undefined)
				throw new Error(`${label} contains a case-fold path collision: ${prior} and ${prefix}`);
			if (!prefixes.includes(prefix)) prefixes.push(prefix);
		}
	}
}

function assertCanonicalTaskScope(scope: unknown): string[] {
	if (!Array.isArray(scope) || scope.length === 0)
		throw new Error("task scope must contain at least one canonical path");
	const paths = scope.map((entry, index) => {
		if (typeof entry !== "string")
			throw new Error(`task scope entry ${index} must be a string`);
		return decodeCanonicalGitPath(Buffer.from(entry, "utf8"), `task scope entry ${index}`);
	});
	assertNoCaseFoldCollisions(paths, "task scope");
	const canonical = [...new Set(paths)].sort(comparePaths).filter(
		(path, _index, all) =>
			!all.some(
				(candidate) =>
					candidate !== path &&
					!candidate.includes("*") &&
					!candidate.includes("?") &&
					path.startsWith(`${candidate}/`),
			),
	);
	if (JSON.stringify(canonical) !== JSON.stringify(paths))
		throw new Error("task scope must already be canonical, sorted, and non-overlapping");
	return paths;
}

type GitTreeEntry = {
	mode: GitTaskIndexEntry["mode"];
	oid: string;
};

function parseGitTreeEntry(
	bytes: Buffer,
	path: string,
	kind: "index" | "HEAD",
): GitTreeEntry | null {
	if (bytes.length === 0) return null;
	if (bytes[bytes.length - 1] !== 0)
		throw new Error(`${kind} entry for ${path} is not NUL-terminated`);
	const record = bytes.subarray(0, bytes.length - 1);
	if (record.includes(0)) throw new Error(`${kind} returned multiple entries for ${path}`);
	const tab = record.indexOf(9);
	if (tab < 0) throw new Error(`${kind} entry for ${path} is malformed`);
	const metadata = record.subarray(0, tab).toString("ascii").split(" ");
	const returnedPath = decodeCanonicalGitPath(record.subarray(tab + 1), `${kind} entry`);
	if (returnedPath !== path) throw new Error(`${kind} returned an unexpected path: ${returnedPath}`);
	const mode = metadata[0];
	const oid = kind === "index" ? metadata[1] : metadata[2];
	const stage = kind === "index" ? metadata[2] : undefined;
	if (!TASK_GIT_MODES.has(mode as "100644" | "100755" | "120000"))
		throw new Error(`${kind} entry for ${path} has unsupported mode ${mode}`);
	if (!oid || !GIT_OBJECT_ID.test(oid) || /^0+$/.test(oid))
		throw new Error(`${kind} entry for ${path} has invalid object identity`);
	if (stage !== undefined && stage !== "0")
		throw new Error(`index entry for ${path} is not at stage zero`);
	return { mode: mode as GitTaskIndexEntry["mode"], oid };
}

function indexEntry(root: string, path: string): GitTreeEntry | null {
	return parseGitTreeEntry(
		gitBytes(root, ["ls-files", "--stage", "-z", "--", path]),
		path,
		"index",
	);
}

function headEntry(root: string, head: string, path: string): GitTreeEntry | null {
	return parseGitTreeEntry(
		gitBytes(root, ["ls-tree", "-z", head, "--", path]),
		path,
		"HEAD",
	);
}

function taskPathMatchesScope(path: string, scope: string[]): boolean {
	return scope.some((scopePath) => pathMatchesScope(path, scopePath));
}

function taskSnapshotOnce(root: string, scope: string[]): GitTaskSnapshot {
	const repositoryRoot = git(root, ["rev-parse", "--show-toplevel"])?.trim();
	const head = git(root, ["rev-parse", "--verify", "HEAD^{commit}"])?.trim();
	if (!repositoryRoot || !head || !GIT_OBJECT_ID.test(head))
		throw new Error("cannot derive task snapshot outside a committed Git workspace");
	if (realpathSync(resolve(repositoryRoot)) !== root)
		throw new Error("task snapshot repository root does not match the project root");
	const sparseCheckout = git(root, ["config", "--bool", "core.sparseCheckout"])?.trim();
	const sparseIndex = git(root, ["config", "--bool", "index.sparse"])?.trim();
	if (sparseCheckout === "true" || sparseIndex === "true")
		throw new Error("task snapshot does not support sparse checkout or sparse index");
	if (gitBytes(root, ["ls-files", "--unmerged", "-z"]).length > 0)
		throw new Error("task snapshot does not support unmerged index entries");
	assertNoScopedIndexFlags(root, scope, "task snapshot");

	const stagedPaths = decodeNullPaths(
		gitBytes(root, ["diff", "--cached", "--no-renames", "--name-only", "-z", head, "--"]),
		"staged task paths",
	);
	const unstagedPaths = decodeNullPaths(
		gitBytes(root, ["diff", "--no-renames", "--name-only", "-z", "--"]),
		"unstaged task paths",
	);
	const untrackedPaths = decodeNullPaths(
		gitBytes(root, ["ls-files", "--others", "--exclude-standard", "-z", "--"]),
		"untracked task paths",
	);
	assertNoCaseFoldCollisions([...stagedPaths, ...unstagedPaths, ...untrackedPaths], "Git task paths");
	const uncommittedInScope = [...new Set([...unstagedPaths, ...untrackedPaths])]
		.filter((path) => taskPathMatchesScope(path, scope))
		.sort(comparePaths);
	if (uncommittedInScope.length > 0)
		throw new Error(`task scope contains unstaged or untracked changes: ${uncommittedInScope.join(", ")}`);

	const taskPaths = [...new Set(stagedPaths)]
		.filter((path) => taskPathMatchesScope(path, scope))
		.sort(comparePaths);
	const stagedFiles: Record<string, GitTaskIndexEntry> = {};
	for (const path of taskPaths) {
		const current = indexEntry(root, path);
		const base = headEntry(root, head, path);
		if (!current && !base) throw new Error(`task path has no index or HEAD identity: ${path}`);
		stagedFiles[path] = {
			status: !base ? "added" : !current ? "deleted" : "modified",
			mode: current?.mode ?? null,
			oid: current?.oid ?? null,
			base_mode: base?.mode ?? null,
			base_oid: base?.oid ?? null,
		};
	}
	return {
		kind: "git-task-index-v1",
		repository_root: root,
		head,
		scope,
		staged_files: stagedFiles,
	};
}

export function captureGitTaskSnapshot(
	projectRoot: string,
	scopeHint: unknown,
): GitTaskSnapshot {
	const requestedRoot = resolve(projectRoot);
	const requestedStat = lstatSync(requestedRoot);
	if (requestedStat.isSymbolicLink() || !requestedStat.isDirectory())
		throw new Error("task snapshot root must be a real directory");
	const root = realpathSync(requestedRoot);
	const scope = assertCanonicalTaskScope(scopeHint);
	const before = taskSnapshotOnce(root, scope);
	gitTaskSnapshotTestHook?.();
	const after = taskSnapshotOnce(root, scope);
	if (JSON.stringify(after) !== JSON.stringify(before))
		throw new Error("Git task snapshot changed while being captured");
	return before;
}

export function taskDiffHash(projectRoot: string, scopeHint: unknown): string {
	const snapshot = captureGitTaskSnapshot(projectRoot, scopeHint);
	return `sha256:${createHash("sha256")
		.update(JSON.stringify(snapshot))
		.digest("hex")}`;
}

function gitRequired(root: string, args: string[], failure: string): string {
	const output = git(root, args);
	if (output === null) throw new Error(failure);
	return output.trim();
}

/**
 * The v4 scoped revision snapshot: the exact delta between the Enrollment base
 * commit and the current index, restricted to the TaskIntent mutation envelope.
 * It deliberately omits the current HEAD so an out-of-scope commit never
 * invalidates task identity, and it never reads unchanged scope matches.
 */
export interface GitTaskRevisionSnapshot {
	kind: "git-task-revision-v1";
	repository_root: string;
	base_head: string;
	base_tree: string;
	scope: string[];
	changed_paths: Record<string, GitTaskIndexEntry>;
}

function taskRevisionSnapshotOnce(
	root: string,
	scope: string[],
	baseHead: string,
): GitTaskRevisionSnapshot {
	const repositoryRoot = git(root, ["rev-parse", "--show-toplevel"])?.trim();
	const head = git(root, ["rev-parse", "--verify", "HEAD^{commit}"])?.trim();
	if (!repositoryRoot || !head || !GIT_OBJECT_ID.test(head))
		throw new Error("cannot derive a task revision outside a committed Git workspace");
	if (realpathSync(resolve(repositoryRoot)) !== root)
		throw new Error("task revision repository root does not match the project root");
	if (gitRequired(root, ["cat-file", "-t", baseHead], `task revision base is unreadable: ${baseHead}`) !== "commit")
		throw new Error(`task revision base is not a commit: ${baseHead}`);
	if (git(root, ["merge-base", "--is-ancestor", baseHead, head]) === null)
		throw new Error(
			`task revision base ${baseHead} is no longer an ancestor of HEAD; rewrite the task history or re-enroll`,
		);
	const baseTree = gitRequired(root, ["rev-parse", `${baseHead}^{tree}`], "task revision base tree is unreadable");
	if (!GIT_OBJECT_ID.test(baseTree)) throw new Error("task revision base tree has invalid identity");
	const sparseCheckout = git(root, ["config", "--bool", "core.sparseCheckout"])?.trim();
	const sparseIndex = git(root, ["config", "--bool", "index.sparse"])?.trim();
	if (sparseCheckout === "true" || sparseIndex === "true")
		throw new Error("task revision does not support sparse checkout or sparse index");
	if (gitBytes(root, ["ls-files", "--unmerged", "-z"]).length > 0)
		throw new Error("task revision does not support unmerged index entries");
	assertNoScopedIndexFlags(root, scope, "task revision");

	const stagedPaths = decodeNullPaths(
		gitBytes(root, ["diff", "--cached", "--no-renames", "--name-only", "-z", baseHead, "--"]),
		"task revision paths",
	);
	const unstagedPaths = decodeNullPaths(
		gitBytes(root, ["diff", "--no-renames", "--name-only", "-z", "--"]),
		"unstaged task revision paths",
	);
	const untrackedPaths = decodeNullPaths(
		gitBytes(root, ["ls-files", "--others", "--exclude-standard", "-z", "--"]),
		"untracked task revision paths",
	);
	const scopedStagedPaths = stagedPaths.filter((path) => taskPathMatchesScope(path, scope));
	const scopedUnstagedPaths = unstagedPaths.filter((path) => taskPathMatchesScope(path, scope));
	const scopedUntrackedPaths = untrackedPaths.filter((path) => taskPathMatchesScope(path, scope));
	assertNoCaseFoldCollisions(
		[...scopedStagedPaths, ...scopedUnstagedPaths, ...scopedUntrackedPaths],
		"Git task revision paths",
	);
	const drift = [...new Set([...scopedUnstagedPaths, ...scopedUntrackedPaths])].sort(comparePaths);
	if (drift.length > 0)
		throw new Error(`task scope contains unstaged or untracked changes: ${drift.join(", ")}`);

	const changed = [...new Set(scopedStagedPaths)].sort(comparePaths);
	const changedPaths: Record<string, GitTaskIndexEntry> = {};
	for (const path of changed) {
		const current = indexEntry(root, path);
		const base = headEntry(root, baseHead, path);
		if (!current && !base) throw new Error(`task revision path has no index or base identity: ${path}`);
		if (current && base && current.oid === base.oid && current.mode === base.mode)
			throw new Error(`task revision path is not actually changed: ${path}`);
		changedPaths[path] = {
			status: !base ? "added" : !current ? "deleted" : "modified",
			mode: current?.mode ?? null,
			oid: current?.oid ?? null,
			base_mode: base?.mode ?? null,
			base_oid: base?.oid ?? null,
		};
	}
	return {
		kind: "git-task-revision-v1",
		repository_root: root,
		base_head: baseHead,
		base_tree: baseTree,
		scope,
		changed_paths: changedPaths,
	};
}

export function captureGitTaskRevisionSnapshot(
	projectRoot: string,
	scopeHint: unknown,
	baseHead: unknown,
): GitTaskRevisionSnapshot {
	const requestedRoot = resolve(projectRoot);
	const requestedStat = lstatSync(requestedRoot);
	if (requestedStat.isSymbolicLink() || !requestedStat.isDirectory())
		throw new Error("task revision root must be a real directory");
	const root = realpathSync(requestedRoot);
	if (typeof baseHead !== "string" || !GIT_OBJECT_ID.test(baseHead.toLowerCase()))
		throw new Error("task revision base must be a Git commit id");
	const scope = assertCanonicalTaskScope(scopeHint);
	const normalizedBase = baseHead.toLowerCase();
	const before = taskRevisionSnapshotOnce(root, scope, normalizedBase);
	gitTaskSnapshotTestHook?.();
	const after = taskRevisionSnapshotOnce(root, scope, normalizedBase);
	if (JSON.stringify(after) !== JSON.stringify(before))
		throw new Error("Git task revision changed while being captured");
	return before;
}

/** The single v4 freshness identity shared by QA, Review, authorization, and completion. */
export function taskRevisionDiffHash(
	projectRoot: string,
	scopeHint: unknown,
	baseHead: string,
): string {
	const snapshot = captureGitTaskRevisionSnapshot(projectRoot, scopeHint, baseHead);
	return `sha256:${createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}`;
}

function isGitWorkspaceSnapshot(value: unknown): value is GitWorkspaceSnapshot {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		(value as Record<string, unknown>).kind === "git-workspace-v1" &&
		typeof (value as Record<string, unknown>).repository_root === "string" &&
		typeof (value as Record<string, unknown>).head === "string" &&
		typeof (value as Record<string, unknown>).dirty_files === "object" &&
		(value as Record<string, unknown>).dirty_files !== null
	);
}

function canonicalizeClaimedPath(value: string): string {
	const normalized = value.trim().replace(/\\/g, "/");
	if (
		!normalized ||
		normalized.includes("\0") ||
		normalized.startsWith("/") ||
		/^[A-Za-z]:\//.test(normalized)
	) {
		throw new Error(`Invalid replacement changed file claim: ${value}`);
	}
	const parts: string[] = [];
	for (const part of normalized.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") {
			throw new Error(`Invalid replacement changed file claim: ${value}`);
		}
		parts.push(part);
	}
	if (parts.length === 0) {
		throw new Error(`Invalid replacement changed file claim: ${value}`);
	}
	return parts.join("/");
}

export type ReplacementChangedFiles = {
	changedFiles: string[] | null;
	carriedFiles: string[];
	workspaceSnapshot: GitWorkspaceSnapshot;
};

export function replacementChangedFilesSinceSnapshot(
	projectRoot: string,
	baseline: unknown,
	claimedFiles: string[],
): ReplacementChangedFiles | null {
	const baselineSnapshot = isGitWorkspaceSnapshot(baseline) ? baseline : null;
	const current = captureGitWorkspaceSnapshot(projectRoot);
	if (!current) {
		if (!baselineSnapshot) return null;
		throw new Error(
			"Cannot verify execution scope because the Git workspace is unavailable.",
		);
	}
	if (!baselineSnapshot || current.head !== baselineSnapshot.head) {
		return {
			changedFiles: null,
			carriedFiles: [],
			workspaceSnapshot: current,
		};
	}
	if (current.repository_root !== baselineSnapshot.repository_root) {
		throw new Error("Git workspace root changed after Step activation.");
	}

	const currentDirty = new Set(Object.keys(current.dirty_files));
	const claimed = new Set(claimedFiles.map(canonicalizeClaimedPath));
	const carriedFiles = Object.keys(baselineSnapshot.dirty_files)
		.filter((path) => !isRuntimeAuthorityPath(path))
		.filter((path) => claimed.has(path))
		.filter((path) => currentDirty.has(path))
		.sort(comparePaths);
	const changedFiles = [
		...new Set([
			...Object.keys(baselineSnapshot.dirty_files),
			...Object.keys(current.dirty_files),
		]),
	]
		.filter((path) => !isRuntimeAuthorityPath(path))
		.filter(
			(path) =>
				baselineSnapshot.dirty_files[path] !== current.dirty_files[path],
		)
		.filter((path) => currentDirty.has(path));

	return {
		changedFiles: [...new Set([...changedFiles, ...carriedFiles])].sort(
			comparePaths,
		),
		carriedFiles,
		workspaceSnapshot: current,
	};
}

export function changedFilesSinceSnapshot(
	projectRoot: string,
	baseline: unknown,
): string[] | null {
	if (!isGitWorkspaceSnapshot(baseline)) return null;
	const current = captureGitWorkspaceSnapshot(projectRoot);
	if (!current) {
		throw new Error(
			"Cannot verify execution scope because the Git workspace is unavailable.",
		);
	}
	if (current.repository_root !== baseline.repository_root) {
		throw new Error("Git workspace root changed after Step activation.");
	}
	if (current.head !== baseline.head) {
		// Commits after activation invalidate git-delta derivation (the baseline
		// dirty set cannot be compared against a different tree). Rather than
		// blocking execution recording entirely — which strands HITL steps that
		// legitimately commit deploy fixes mid-step — fall back to the same
		// self-reported provenance path used when no baseline exists. The
		// claimed files still pass the Step Scope check and independent QA.
		return null;
	}
	return [
		...new Set([
			...Object.keys(baseline.dirty_files),
			...Object.keys(current.dirty_files),
		]),
	]
		.filter((path) => !isRuntimeAuthorityPath(path))
		.filter((path) => baseline.dirty_files[path] !== current.dirty_files[path])
		.sort(comparePaths);
}

function normalizeBoundaryPath(value: string): string {
	return value
		.trim()
		.replace(/^\.\//, "")
		.replace(/\\/g, "/")
		.replace(/\/+$/, "");
}

function globMatches(path: string, pattern: string): boolean {
	const memo = new Map<string, boolean>();
	const match = (pathIndex: number, patternIndex: number): boolean => {
		const key = `${pathIndex}:${patternIndex}`;
		const cached = memo.get(key);
		if (cached !== undefined) return cached;
		let result: boolean;
		if (patternIndex === pattern.length) result = pathIndex === path.length;
		else if (pattern[patternIndex] === "*") {
			const recursive = pattern[patternIndex + 1] === "*";
			const nextPatternIndex = patternIndex + (recursive ? 2 : 1);
			result = match(pathIndex, nextPatternIndex);
			if (!result && pathIndex < path.length) {
				result =
					(recursive || path[pathIndex] !== "/") &&
					match(pathIndex + 1, patternIndex);
			}
		} else if (pathIndex === path.length) result = false;
		else if (pattern[patternIndex] === "?") {
			result =
				path[pathIndex] !== "/" && match(pathIndex + 1, patternIndex + 1);
		} else {
			result =
				path[pathIndex] === pattern[patternIndex] &&
				match(pathIndex + 1, patternIndex + 1);
		}
		memo.set(key, result);
		return result;
	};
	return match(0, 0);
}

export function pathMatchesScope(path: string, scopePath: string): boolean {
	const normalizedPath = normalizeBoundaryPath(path);
	const normalizedScope = normalizeBoundaryPath(scopePath);
	if (!normalizedPath || !normalizedScope) return false;
	if (normalizedScope.includes("*") || normalizedScope.includes("?")) {
		return globMatches(normalizedPath, normalizedScope);
	}
	return (
		normalizedPath === normalizedScope ||
		normalizedPath.startsWith(`${normalizedScope}/`)
	);
}

const TEST_FILE_REFERENCE = /[\w./-]*\.(?:test|spec)\.[cm]?[jt]sx?\b/g;

/**
 * `bun test` treats its arguments as filters rather than paths, so a command
 * naming three files where one was renamed away runs the other two and still
 * exits 0. Left unchecked the evidence records a pass whose coverage silently
 * shrank. Verification runs after the work is done, so a cited test file is
 * expected to exist by the time evidence is recorded.
 *
 * Only passing checks are held to this. A failure must stay recordable — that
 * is how a missing test file gets reported in the first place, since a command
 * naming nothing else exits non-zero — and it cannot manufacture false
 * confidence because QA refuses to pass on failed evidence.
 */
export function assertCheckCommandsCiteExistingTests(
	checks: unknown,
	root: string,
): void {
	if (!Array.isArray(checks)) return;
	const missing = new Set<string>();
	for (const check of checks) {
		if (typeof check !== "object" || check === null || Array.isArray(check))
			continue;
		const entry = check as Record<string, unknown>;
		if (entry.kind === "manual" || entry.status !== "passed") continue;
		const command = entry.command;
		if (typeof command !== "string") continue;
		// A command that moves elsewhere first resolves its paths against that
		// directory, not the project root, so the check cannot be trusted.
		if (/(^|\s|&|;)cd\s/.test(command)) continue;
		for (const [candidate] of command.matchAll(TEST_FILE_REFERENCE)) {
			// A glob is resolved by the shell or the runner, which reports its own
			// miss; only a literal path can be confirmed here.
			if (!candidate.includes("/") || /[*?[\]]/.test(candidate)) continue;
			if (!existsSync(resolve(root, candidate))) missing.add(candidate);
		}
	}
	if (missing.size > 0) {
		throw new Error(
			`Evidence cites test files that do not exist: ${[...missing].join(", ")}. A renamed or deleted test leaves the command passing on a smaller set than it names.`,
		);
	}
}

export function assertChangedFilesWithinScope(
	changedFiles: string[],
	scope: unknown,
	boundaryName: string,
): void {
	if (!Array.isArray(scope) || scope.length === 0) return;
	const scopePaths = scope.filter(
		(value): value is string =>
			typeof value === "string" && value.trim().length > 0,
	);
	if (scopePaths.length !== scope.length) {
		throw new Error(`${boundaryName} contains an invalid path.`);
	}
	if (scopePaths.length === 0) return;
	const outside = changedFiles.filter(
		(path) =>
			!scopePaths.some((scopePath) => pathMatchesScope(path, scopePath)),
	);
	if (outside.length > 0) {
		throw new Error(
			`Changed files outside the ${boundaryName}: ${outside.join(", ")}. Allowed: ${scopePaths.join(", ")}.`,
		);
	}
}
