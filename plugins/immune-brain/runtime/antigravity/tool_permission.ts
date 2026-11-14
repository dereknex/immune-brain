import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Path to Antigravity's CLI user settings file under `home`. */
export function antigravitySettingsPath(home = homedir()): string {
	return join(home, ".gemini", "antigravity-cli", "settings.json");
}

/**
 * Reads `permissions.allow` from Antigravity's user settings for confirmation
 * provenance only. Whether a native dialog surfaces is agy's decision
 * (`toolPermission`, launch flags); an unreadable or malformed file yields no
 * rules rather than a refusal.
 */
export function readAntigravityAllowRules(home = homedir()): ReadonlyArray<string> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(antigravitySettingsPath(home), "utf8"));
	} catch {
		return [];
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
	const permissions = (parsed as Record<string, unknown>).permissions;
	if (typeof permissions !== "object" || permissions === null || Array.isArray(permissions)) return [];
	const allow = (permissions as Record<string, unknown>).allow;
	if (!Array.isArray(allow)) return [];
	return allow.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Checks whether any `permissions.allow` entry covers the named MCP server/tool.
 * Supports the exact forms `mcp(<server>/<tool>)`, `mcp(<server>/*)`,
 * `mcp(<server>)`, and `mcp(*)`.
 */
export function matchesMcpAllowRule(
	allowRules: ReadonlyArray<unknown>,
	servers: ReadonlySet<string> | ReadonlyArray<string>,
	tool: string,
): boolean {
	if (!tool || allowRules.length === 0) return false;
	const serverSet = servers instanceof Set ? servers : new Set(servers);
	if (serverSet.size === 0) return false;
	for (const entry of allowRules) {
		if (typeof entry !== "string") continue;
		const match = /^mcp\(([^)]+)\)$/.exec(entry.trim());
		if (!match) continue;
		const inner = match[1];
		if (inner === "*") return true;
		const slashIndex = inner.indexOf("/");
		if (slashIndex === -1) {
			if (serverSet.has(inner)) return true;
			continue;
		}
		if (inner.indexOf("/", slashIndex + 1) !== -1) continue;
		const server = inner.slice(0, slashIndex);
		const ruleTool = inner.slice(slashIndex + 1);
		if (!server || !ruleTool || !serverSet.has(server)) continue;
		if (ruleTool === "*" || ruleTool === tool) return true;
	}
	return false;
}
