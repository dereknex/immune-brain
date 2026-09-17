// Disposable QA materialization of one immutable delivery tree.
// Never binds the user's index, refs, or node_modules.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

import type { GitTaskRevisionSnapshot } from "../workspace_scope";

export class DeliveryWorkspaceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DeliveryWorkspaceError";
	}
}

export interface DeliveryWorkspace {
	root: string;
	tree: string;
	seal: string;
	cleanup: () => void;
}

export function removeTaskOwnedTree(root: string): void {
	const makeDirectoriesWritable = (path: string): void => {
		let stat;
		try { stat = lstatSync(path); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
		if (!stat.isDirectory() || stat.isSymbolicLink()) return;
		chmodSync(path, (stat.mode & 0o7777) | 0o700);
		for (const name of readdirSync(path)) makeDirectoriesWritable(join(path, name));
	};
	makeDirectoriesWritable(root);
	rmSync(root, { recursive: true, force: true });
}

const GIT_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function isolatedGitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
	const env = { ...process.env };
	delete env.GIT_DIR;
	delete env.GIT_WORK_TREE;
	delete env.GIT_INDEX_FILE;
	delete env.GIT_OBJECT_DIRECTORY;
	delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
	return {
		...env,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_TERMINAL_PROMPT: "0",
		GIT_OPTIONAL_LOCKS: "0",
		...extra,
	};
}

function git(cwd: string, args: string[], extra: Record<string, string> = {}): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: isolatedGitEnv(extra),
	}).trim();
}

function assertTree(tree: string): void {
	if (!GIT_OBJECT_ID.test(tree)) throw new DeliveryWorkspaceError("delivery tree has invalid identity");
}

function assertInside(root: string, candidate: string, label: string): void {
	const rel = relative(root, candidate);
	if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel))
		throw new DeliveryWorkspaceError(`delivery ${label} escapes materialization: ${rel}`);
}

function resolvedSymlinkTarget(path: string): string {
	const target = readlinkSync(path);
	let current = isAbsolute(target) ? parse(target).root : parse(path).root;
	let pending = (isAbsolute(target)
		? target.split(sep)
		: [...relative(current, dirname(path)).split(sep), ...target.split(sep)]
	).filter(Boolean);
	let links = 0;
	while (pending.length) {
		const part = pending.shift()!;
		if (part === ".") continue;
		if (part === "..") { current = dirname(current); continue; }
		const next = join(current, part);
		try {
			if (!lstatSync(next).isSymbolicLink()) { current = next; continue; }
			if (++links > 40) throw new DeliveryWorkspaceError("delivery symlink chain is too deep");
			const nested = readlinkSync(next);
			if (isAbsolute(nested)) current = parse(nested).root;
			pending = [...nested.split(sep).filter(Boolean), ...pending];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			current = next;
		}
	}
	return current;
}

function assertNoEscapingSymlinks(root: string, dir = root): void {
	const realRoot = realpathSync(root);
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) {
			assertInside(realRoot, resolvedSymlinkTarget(path), `symlink ${relative(root, path)}`);
		} else if (stat.isDirectory()) {
			assertNoEscapingSymlinks(root, path);
		}
	}
}


export function writeDeliveryTree(sourceRoot: string, snapshot: GitTaskRevisionSnapshot): string {
	const indexDirectory = mkdtempSync(join(tmpdir(), "imm-delivery-index-"));
	try {
		git(sourceRoot, ["read-tree", snapshot.base_tree], {
			GIT_INDEX_FILE: join(indexDirectory, "index"),
			GIT_DIR: join(sourceRoot, ".git"),
		});
		for (const [path, entry] of Object.entries(snapshot.changed_paths)) {
			if (entry.oid && entry.mode) {
				git(sourceRoot, ["update-index", "--add", "--cacheinfo", `${entry.mode},${entry.oid},${path}`], {
					GIT_INDEX_FILE: join(indexDirectory, "index"),
					GIT_DIR: join(sourceRoot, ".git"),
				});
			} else {
				git(sourceRoot, ["update-index", "--force-remove", "--", path], {
					GIT_INDEX_FILE: join(indexDirectory, "index"),
					GIT_DIR: join(sourceRoot, ".git"),
				});
			}
		}
		const next = git(sourceRoot, ["write-tree"], {
			GIT_INDEX_FILE: join(indexDirectory, "index"),
			GIT_DIR: join(sourceRoot, ".git"),
		});
		assertTree(next);
		return next;
	} finally {
		rmSync(indexDirectory, { recursive: true, force: true });
	}
}

// The seal lives in host memory, outside the project. Compare bytes directly:
// project commands can rewrite their disposable index or porcelain state.
function workspaceFiles(
	root: string,
	dir = root,
	result: Record<string, string> = Object.create(null) as Record<string, string>,
): Record<string, string> {
	if (dir === root) result["."] = `${lstatSync(root).mode & 0o7777}:directory`;
	for (const name of readdirSync(dir).sort()) {
		const path = join(dir, name), rel = relative(root, path);
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) result[rel] = `link:${stat.mode & 0o7777}:${readlinkSync(path)}`;
		else if (stat.isDirectory()) { result[rel] = `${stat.mode & 0o7777}:directory`; workspaceFiles(root, path, result); }
		else if (stat.isFile()) result[rel] = `${stat.mode & 0o7777}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
		else throw new DeliveryWorkspaceError("delivery contains an unsupported filesystem entry");
	}
	return result;
}

function workspaceSeal(root: string): string {
	return JSON.stringify(workspaceFiles(root));
}

export function assertDeliveryClean(root: string, tree: string, seal?: string, writablePaths: string[] = []): void {
	assertTree(tree);
	if (seal === undefined) {
		if (git(root, ["status", "--porcelain", "--untracked-files=all", "--ignored=matching"]))
			throw new DeliveryWorkspaceError("delivery workspace was contaminated");
		if (git(root, ["rev-parse", "HEAD^{tree}"]) !== tree)
			throw new DeliveryWorkspaceError("delivery workspace tree drifted from the frozen identity");
		return;
	}
	if (seal === "[]") {
		for (const name of readdirSync(root)) {
			const stat = lstatSync(join(root, name));
			if (!stat.isDirectory() || name !== ".git") throw new DeliveryWorkspaceError("delivery workspace was contaminated");
		}
		return;
	}
	const expected = JSON.parse(seal) as Record<string, string>;
	for (const path of writablePaths) {
		if (path === "." || path === ".git" || path.startsWith(".git/") || isAbsolute(path) || path.split("/").includes("..")
			|| Object.keys(expected).some(p => p === path || p.startsWith(`${path}/`)))
			throw new DeliveryWorkspaceError("delivery writable path overlaps protected inputs");
	}
	const current = workspaceFiles(root);
	for (const [path, bytes] of Object.entries(expected))
		if (current[path] !== bytes) throw new DeliveryWorkspaceError("delivery protected input was contaminated");
	for (const [path, bytes] of Object.entries(current)) {
		if (Object.hasOwn(expected, path)) continue;
		const permitted = writablePaths.some(p => path === p || path.startsWith(`${p}/`)
			|| (bytes.endsWith(":directory") && p.startsWith(`${path}/`)));
		if (!permitted) throw new DeliveryWorkspaceError("delivery undeclared output was contaminated");
		if (bytes.startsWith("link:")) {
			assertInside(realpathSync(root), resolvedSymlinkTarget(join(root, path)), "generated symlink");
		}
	}
}


export function materializeDeliveryWorkspace(
	sourceRoot: string,
	tree: string,
): DeliveryWorkspace {
	assertTree(tree);
	const dest = mkdtempSync(join(tmpdir(), "imm-delivery-"));
	const cleanup = () => removeTaskOwnedTree(dest);
	try {
		mkdirSync(dest, { recursive: true });
		const commit = git(sourceRoot, ["commit-tree", tree, "-m", `delivery ${tree}`], {
			GIT_DIR: join(sourceRoot, ".git"),
			GIT_AUTHOR_NAME: "Immune-Brain Assurance",
			GIT_AUTHOR_EMAIL: "assurance@immune-brain.local",
			GIT_AUTHOR_DATE: "1970-01-01T00:00:00 +0000",
			GIT_COMMITTER_NAME: "Immune-Brain Assurance",
			GIT_COMMITTER_EMAIL: "assurance@immune-brain.local",
			GIT_COMMITTER_DATE: "1970-01-01T00:00:00 +0000",
		});
		if (!GIT_OBJECT_ID.test(commit)) throw new DeliveryWorkspaceError("delivery commit write failed");
		git(dest, ["init", "-q"]);
		git(dest, ["fetch", "--depth=1", `file://${resolve(sourceRoot)}`, `${commit}:refs/heads/delivery`]);
		git(dest, ["checkout", "-q", "delivery"]);
		const got = git(dest, ["rev-parse", "HEAD^{tree}"]);
		if (got !== tree) throw new DeliveryWorkspaceError("delivery materialization does not match the frozen tree");
		assertNoEscapingSymlinks(dest);
		const seal = workspaceSeal(dest);
		assertDeliveryClean(dest, tree, seal);
		return { root: dest, tree, seal, cleanup };
	} catch (error) {
		cleanup();
		throw error;
	}
}
