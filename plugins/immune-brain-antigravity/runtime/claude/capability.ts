export const MIN_CLAUDE_CODE_VERSION = "2.1.236";
export const HOST_ID = "claude-code" as const;
export const CORE_CONTRACT = "assurance_kernel/host_adapter/claude-code/v1";
export const SUPPORTED_PLATFORMS = ["darwin", "linux"] as const;

import type { PermissionMode } from "../host-core/runtime";
import {
	type HostCapabilityDeclaration,
	validateHostCapabilityDeclaration,
} from "../host-core/capability";

export type { PermissionMode };

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

export const CLAUDE_CAPABILITY: HostCapabilityDeclaration = validateHostCapabilityDeclaration({
	hostId: "claude-code",
	hostName: "Claude Code",
	ports: {
		P1: {
			port: "P1",
			level: "certified",
			evidence: "Live Hook correlation (PreToolUse/PostToolUse) with session:stepIdx and phase admission",
		},
		P2: {
			port: "P2",
			level: "certified",
			evidence: "Native interactive confirmation dialog via confirm_dialog and HostConfirmationRef",
		},
		P3: {
			port: "P3",
			level: "certified",
			evidence: "Verifier observation state machine through hook event log",
		},
		P4: {
			port: "P4",
			level: "certified",
			evidence: "Run continuation state machine through hook event log and automated stop",
		},
		P5: {
			port: "P5",
			level: "certified",
			evidence: "Fresh claude --print process with --dangerously-skip-permissions, tool allowlist, no session persistence, and immutable tree guard",
		},
		P6: {
			port: "P6",
			level: "certified",
			evidence: "Lane Executor process spawn in isolated worktree",
		},
		P7: {
			port: "P7",
			level: "certified",
			evidence: "Shared private file helpers with 0700/0600 permissions, O_NOFOLLOW, regular file, and ownership checks",
		},
		P8: {
			port: "P8",
			level: "certified",
			evidence: "PreInvocation active-task notice and prompt injection",
		},
		P9: {
			port: "P9",
			level: "unsupported",
			evidence: "Claude Code provides no background wake or external turn wakeup mechanism",
		},
	},
});

export const CAPABILITY_DECLARATION = CLAUDE_CAPABILITY;
