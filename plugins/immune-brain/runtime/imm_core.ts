/**
 * Immune-Brain public runtime barrel.
 *
 * Focused modules own implementation; this file exposes the current runtime API.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PlanValidationError } from "./plan_core";
import type { AdvisoryDispatchConfig } from "./advisory_dispatch";

export * from "./plan_core";
export * from "./state_ledger";
export { normalizePlanPath } from "./plan_core";

export * from "./activation";
export * from "./environment";
export * from "./loop_contract";
export * from "./role_prompt_bridge";
export * from "./handoff";
export * from "./workspace_scope";
export * from "./advisory_dispatch";
export * from "./work_probes";

// ── agent-local Immune-Brain config ─────────────────────────────────

export interface ImmuneBrainLocalRootInput {
	home_dir?: string;
	env?: Record<string, string | undefined>;
}

export interface ImmuneBrainLocalRoot {
	root: string;
	config_path: string;
}

export interface ImmuneBrainConfigLoadResult {
	config: AdvisoryDispatchConfig;
	root?: string;
	config_paths: string[];
}

const PI_LOCAL_ROOT = ".pi/agent/immune-brain";

function homeDir(input: ImmuneBrainLocalRootInput): string {
	return input.home_dir || input.env?.HOME || process.env.HOME || "";
}

export function resolveImmuneBrainLocalRoot(
	input: ImmuneBrainLocalRootInput = {},
): ImmuneBrainLocalRoot {
	const baseHome = homeDir(input);
	const root = resolve(baseHome, PI_LOCAL_ROOT);
	return { root, config_path: join(root, "config.toml") };
}

export function resolveImmuneBrainLocalPath(
	input: ImmuneBrainLocalRootInput & { relative_path: string },
): string {
	const relativePath = input.relative_path.trim();
	if (
		!relativePath ||
		relativePath.startsWith("/") ||
		relativePath.includes("..") ||
		relativePath.includes("\\")
	) {
		throw new PlanValidationError(
			`Invalid Immune-Brain local path: ${input.relative_path}`,
		);
	}
	return join(resolveImmuneBrainLocalRoot(input).root, relativePath);
}

function parseTomlValue(raw: string): unknown {
	const value = raw.trim();
	if (value.startsWith("[") && value.endsWith("]")) {
		const inner = value.slice(1, -1).trim();
		if (!inner) return [];
		return inner
			.split(",")
			.map((part) => parseTomlValue(part))
			.filter((part) => typeof part === "string" && part);
	}
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	)
		return value.slice(1, -1);
	if (value === "true") return true;
	if (value === "false") return false;
	return value;
}

function parseImmuneBrainConfigToml(content: string): AdvisoryDispatchConfig {
	const config: Record<string, any> = {};
	let table: Record<string, any> = config;
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.replace(/\s+#.*$/, "").trim();
		if (!line || line.startsWith("#")) continue;
		const tableMatch = line.match(/^\[([a-zA-Z0-9_.-]+)\]$/);
		if (tableMatch) {
			table = config;
			for (const part of tableMatch[1].split(".")) table = table[part] ||= {};
			continue;
		}
		const match = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/);
		if (match) table[match[1]] = parseTomlValue(match[2]);
	}
	return config as AdvisoryDispatchConfig;
}

function mergeConfig(
	base: Record<string, any>,
	overlay: Record<string, any>,
): Record<string, any> {
	const merged = { ...base };
	for (const [key, value] of Object.entries(overlay)) {
		if (
			value &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			merged[key] &&
			typeof merged[key] === "object" &&
			!Array.isArray(merged[key])
		) {
			merged[key] = mergeConfig(merged[key], value as Record<string, any>);
		} else {
			merged[key] = value;
		}
	}
	return merged;
}

export function readImmuneBrainConfig(
	input: ImmuneBrainLocalRootInput = {},
): ImmuneBrainConfigLoadResult {
	const env = input.env || process.env;
	const root = resolveImmuneBrainLocalRoot({ ...input, env });
	const paths = [
		root.config_path,
		env.IMMUNE_BRAIN_CONFIG,
		env.IMMUNE_BRAIN_AGENT_CONFIG,
	].filter((path, index, all): path is string => Boolean(path) && all.indexOf(path) === index);

	let config: Record<string, any> = {};
	const configPaths: string[] = [];
	for (const path of paths) {
		const resolved = resolve(path.replace(/^~/, homeDir({ ...input, env })));
		if (!existsSync(resolved)) continue;
		config = mergeConfig(
			config,
			parseImmuneBrainConfigToml(readFileSync(resolved, "utf8")) as Record<
				string,
				any
			>,
		);
		configPaths.push(resolved);
	}
	return {
		config: config as AdvisoryDispatchConfig,
		root: root.root,
		config_paths: configPaths,
	};
}
