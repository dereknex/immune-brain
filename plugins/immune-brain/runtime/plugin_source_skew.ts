// Read-only observation for working on Immune-Brain with Immune-Brain: when
// the workspace is this plugin's own source repository but the Host loaded the
// plugin from somewhere else (an installed package or cache), tool behavior
// follows the loaded build, not the workspace changes. The plugin version does
// not move during development, so the generated Claude bundle stands in for
// the build: every runtime change regenerates it under the build parity check.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { runningRuntimeSource } from "./kernel/runtime_contracts";

const WORKSPACE_PLUGIN_DIR = join("plugins", "immune-brain");
const PLUGIN_MANIFEST = join(".claude-plugin", "plugin.json");
const BUILD_PROXY = join("dist", "claude", "mcp-server.mjs");
const MAX_LEVELS = 8;

export interface PluginSourceSkewWarning {
	code: "loaded_plugin_differs_from_workspace";
	paths: string[];
	message: string;
}

function pluginRootAbove(dir: string): string | null {
	let current = dir;
	for (let level = 0; level < MAX_LEVELS; level++) {
		if (existsSync(join(current, PLUGIN_MANIFEST))) return current;
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
	return null;
}

function sameBuild(a: string, b: string): boolean {
	const left = join(a, BUILD_PROXY), right = join(b, BUILD_PROXY);
	if (!existsSync(left) || !existsSync(right)) return false;
	if (statSync(left).size !== statSync(right).size) return false;
	return readFileSync(left).equals(readFileSync(right));
}

/** Null unless `root` is the plugin source repository and the loaded plugin is a different, differing build. */
export function pluginSourceSkewWarning(root: string, loadedFrom: string = runningRuntimeSource()): PluginSourceSkewWarning | null {
	try {
		const workspace = join(root, WORKSPACE_PLUGIN_DIR);
		if (!existsSync(join(workspace, PLUGIN_MANIFEST))) return null;
		const loaded = pluginRootAbove(loadedFrom);
		if (!loaded) return null;
		const workspaceReal = realpathSync(workspace), loadedReal = realpathSync(loaded);
		if (workspaceReal === loadedReal || sameBuild(loadedReal, workspaceReal)) return null;
		return {
			code: "loaded_plugin_differs_from_workspace",
			paths: [loadedReal, workspaceReal],
			message: `this Host runs Immune-Brain from ${loadedReal}, whose build differs from the workspace plugin ${workspaceReal}; tools follow the loaded build, so reload the Host with the workspace plugin before relying on workspace runtime changes`,
		};
	} catch {
		// An observation never blocks status.
		return null;
	}
}

export interface BundleIdentityWatch {
	/** The file whose identity was recorded at startup. */
	readonly path: string;
	readonly sha256: string | null;
	/** True once the file on disk no longer matches the startup identity; stays true. */
	stale(): boolean;
}

/**
 * The long-lived MCP server keeps running the bundle it started with while
 * hooks run every new build (Spec branch-boundary D3, T3). The identity is the
 * file's SHA-256, re-read only when a cheap size and mtime check moves. An
 * unreadable file, at startup or later, counts as stale: the server can no
 * longer show it runs the build on disk.
 */
export function watchBundleIdentity(path: string): BundleIdentityWatch {
	type Stamp = { size: number; mtimeMs: number };
	const read = (): { stamp: Stamp; hash: string } | null => {
		try {
			const stat = statSync(path);
			return { stamp: { size: stat.size, mtimeMs: stat.mtimeMs }, hash: createHash("sha256").update(readFileSync(path)).digest("hex") };
		} catch {
			return null;
		}
	};
	const startup = read();
	let stamp = startup?.stamp ?? null;
	let stale = startup === null;
	return {
		path,
		sha256: startup?.hash ?? null,
		stale() {
			if (stale || !startup) return true;
			let current: Stamp;
			try {
				const stat = statSync(path);
				current = { size: stat.size, mtimeMs: stat.mtimeMs };
			} catch {
				return (stale = true);
			}
			if (stamp && current.size === stamp.size && current.mtimeMs === stamp.mtimeMs) return false;
			const now = read();
			if (!now || now.hash !== startup.hash) return (stale = true);
			stamp = now.stamp;
			return false;
		},
	};
}
