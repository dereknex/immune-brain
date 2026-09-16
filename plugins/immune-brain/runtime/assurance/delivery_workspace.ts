// Disposable QA materialization of one immutable delivery tree.
// Never binds the user's index, refs, or node_modules.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FrozenRunner } from "./verification";
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

function assertNoEscapingSymlinks(root: string, dir = root): void {
	const realRoot = realpathSync(root);
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) {
			let resolved: string;
			try {
				resolved = realpathSync(path);
			} catch {
				const target = resolve(dir, readlinkSync(path));
				assertInside(realRoot, target, `symlink ${relative(root, path)}`);
				continue;
			}
			assertInside(realRoot, resolved, `symlink ${relative(root, path)}`);
		} else if (stat.isDirectory()) {
			assertNoEscapingSymlinks(root, path);
		}
	}
}

function prepareDependencies(root: string, runner?: FrozenRunner): void {
	const lockfile = ["bun.lock", "bun.lockb"].find((name) => existsSync(join(root, name)));
	if (!lockfile) return;
	if (!existsSync(join(root, "package.json")))
		throw new DeliveryWorkspaceError("delivery lockfile is missing package.json");
	const bun = runner?.path ?? "bun";
	const result = spawnSync(bun, ["install", "--frozen-lockfile", "--offline", "--ignore-scripts"], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 60_000,
		env: isolatedGitEnv(),
	});
	if (result.error || result.status !== 0)
		throw new DeliveryWorkspaceError("delivery dependency preparation failed from the snapshot lockfile");
	const modules = join(root, "node_modules");
	if (existsSync(modules)) {
		const lock = spawnSync("chmod", ["-R", "a-w", modules], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		if (lock.error || lock.status !== 0)
			throw new DeliveryWorkspaceError("delivery dependencies could not be locked against mutation");
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

function workspaceSeal(root: string): string {
	return git(root, ["status", "--porcelain", "-z", "--untracked-files=all", "--ignored=matching"]);
}

export function assertDeliveryClean(root: string, tree: string, seal?: string): void {
	const porcelain = workspaceSeal(root);
	if (seal !== undefined) {
		if (porcelain !== seal) throw new DeliveryWorkspaceError("delivery workspace was contaminated");
	} else if (porcelain.length > 0) {
		throw new DeliveryWorkspaceError("delivery workspace was contaminated");
	}
	const current = git(root, ["rev-parse", "HEAD^{tree}"]);
	if (current !== tree) throw new DeliveryWorkspaceError("delivery workspace tree drifted from the frozen identity");
}

export function materializeDeliveryWorkspace(
	sourceRoot: string,
	tree: string,
	runner?: FrozenRunner,
): DeliveryWorkspace {
	assertTree(tree);
	const dest = mkdtempSync(join(tmpdir(), "imm-delivery-"));
	const cleanup = () => {
		spawnSync("chmod", ["-R", "u+w", dest], { stdio: ["ignore", "ignore", "ignore"] });
		rmSync(dest, { recursive: true, force: true });
	};
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
		prepareDependencies(dest, runner);
		const seal = workspaceSeal(dest);
		assertDeliveryClean(dest, tree, seal);
		return { root: dest, tree, seal, cleanup };
	} catch (error) {
		cleanup();
		throw error;
	}
}
