// Disposable QA materialization of one immutable delivery tree.
// Never binds the user's index, refs, or node_modules.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

export class DeliveryWorkspaceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DeliveryWorkspaceError";
	}
}

export interface DeliveryWorkspace {
	root: string;
	cleanup: () => void;
}

function git(root: string, args: string[], extra: Record<string, string> = {}): string {
	return execFileSync("git", args, {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, ...extra },
	}).trim();
}

function assertTree(tree: string): void {
	if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(tree))
		throw new DeliveryWorkspaceError("delivery tree has invalid identity");
}

function assertNoEscapingSymlinks(root: string, dir = root): void {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) {
			const target = resolve(dir, readlinkSync(path));
			const rel = relative(root, target);
			if (rel.startsWith(`..${sep}`) || rel === "..")
				throw new DeliveryWorkspaceError(`delivery symlink escapes materialization: ${relative(root, path)}`);
		} else if (stat.isDirectory()) {
			assertNoEscapingSymlinks(root, path);
		}
	}
}

function prepareDependencies(root: string): void {
	const lockfile = ["bun.lock", "bun.lockb", "package-lock.json"].find((name) => existsSync(join(root, name)));
	if (!lockfile) return;
	if (!existsSync(join(root, "package.json")))
		throw new DeliveryWorkspaceError("delivery lockfile is missing package.json");
	const result = spawnSync("bun", ["install", "--frozen-lockfile", "--offline"], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.status !== 0)
		throw new DeliveryWorkspaceError("delivery dependency preparation failed from the snapshot lockfile");
}

export function materializeDeliveryWorkspace(sourceRoot: string, tree: string): DeliveryWorkspace {
	assertTree(tree);
	const dest = mkdtempSync(join(tmpdir(), "imm-delivery-"));
	const cleanup = () => rmSync(dest, { recursive: true, force: true });
	try {
		mkdirSync(dest, { recursive: true });
		const archive = execFileSync("git", ["archive", "--format=tar", tree], {
			cwd: sourceRoot,
			encoding: "buffer",
			stdio: ["ignore", "pipe", "pipe"],
			maxBuffer: 64 * 1024 * 1024,
		});
		spawnSync("tar", ["-xf", "-"], { cwd: dest, input: archive, stdio: ["pipe", "ignore", "pipe"] });
		assertNoEscapingSymlinks(dest);
		git(dest, ["init", "-q"]);
		git(dest, ["config", "user.email", "assurance@immune-brain.local"]);
		git(dest, ["config", "user.name", "Immune-Brain Assurance"]);
		git(dest, ["add", "-A"]);
		git(dest, ["commit", "--allow-empty", "-qm", `delivery ${tree}`]);
		prepareDependencies(dest);
		return { root: dest, cleanup };
	} catch (error) {
		cleanup();
		throw error;
	}
}

export function deliveryTreeFromIndex(sourceRoot: string): string {
	const tree = git(sourceRoot, ["write-tree"]);
	assertTree(tree);
	return tree;
}
