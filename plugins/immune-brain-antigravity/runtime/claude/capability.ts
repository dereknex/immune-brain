export const MIN_CLAUDE_CODE_VERSION = "2.1.236";
export const HOST_ID = "claude-code" as const;
export const CORE_CONTRACT = "assurance_kernel/host_adapter/claude-code/v1";
export const SUPPORTED_PLATFORMS = ["darwin", "linux"] as const;

export type PermissionMode = "manual" | "acceptEdits" | "auto" | "bypassPermissions" | "dontAsk";

export type HostProbe =
	| { ok: true; version: string; platform: string }
	| { ok: false; reason: string };

function parseSemver(value: string): [number, number, number] | null {
	// Prerelease and build suffixes are rejected: an unstable build such as
	// Prerelease builds never satisfy the stable minimum.
	const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value.trim());
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemver(left: string, right: string): number {
	const a = parseSemver(left);
	const b = parseSemver(right);
	if (!a || !b) throw new Error(`invalid semver: ${!a ? left : right}`);
	return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function parsePermissionMode(raw: unknown): PermissionMode | null {
	if (
		raw === "manual"
		|| raw === "acceptEdits"
		|| raw === "auto"
		|| raw === "bypassPermissions"
		|| raw === "dontAsk"
	) return raw;
	return null;
}

/**
 * Trusted version sources, in priority order: the MCP handshake clientInfo
 * version announced by the connected Host (hostVersion), then the explicit
 * environment override. An undeclared Host version fails closed.
 */
export function probeHost(
	env: Record<string, string | undefined> = process.env,
	platform = process.platform,
	hostVersion?: string,
): HostProbe {
	const version = hostVersion ?? env.CLAUDE_CODE_VERSION ?? env.CLAUDE_CLI_VERSION;
	if (!version) return { ok: false, reason: "Claude Code version is unavailable" };
	if (!parseSemver(version)) return { ok: false, reason: `Claude Code version is invalid: ${version}` };
	if (compareSemver(version, MIN_CLAUDE_CODE_VERSION) < 0) {
		return {
			ok: false,
			reason: `Claude Code ${version} is below the minimum supported ${MIN_CLAUDE_CODE_VERSION}`,
		};
	}
	if (platform !== "darwin" && platform !== "linux") {
		return { ok: false, reason: `unsupported platform ${platform}; native Windows is out of scope` };
	}
	return { ok: true, version, platform };
}
