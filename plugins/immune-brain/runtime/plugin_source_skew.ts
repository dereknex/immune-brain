// Read-only observation for working on Immune-Brain with Immune-Brain: when
// the workspace is this plugin's own source repository but the Host loaded the
// plugin from somewhere else (an installed package or cache), tool behavior
// follows the loaded build, not the workspace changes. The plugin version does
// not move during development, so the generated Claude bundle stands in for
// the build: every runtime change regenerates it under the build parity check.
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
