export const MIN_ANTIGRAVITY_VERSION = "0.1.0";
export const HOST_ID = "antigravity" as const;
export const CORE_CONTRACT = "assurance_kernel/host_adapter/antigravity/v1";
export const SUPPORTED_PLATFORMS = ["darwin", "linux"] as const;

import {
	type HostCapabilityDeclaration,
	validateHostCapabilityDeclaration,
} from "../host-core/capability";

export type HostProbe =
	| { ok: true; host: typeof HOST_ID; version: string; platform: string }
	| { ok: false; reason: string };

/** Antigravity reports its own version with a leading `v` (`v1.0.0`); one optional `v` is normalized, anything else is not semver. */
export function parseSemver(value: string): [number, number, number] | null {
	const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value.trim());
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemver(left: string, right: string): number {
	const a = parseSemver(left);
	const b = parseSemver(right);
	if (!a || !b) throw new Error(`invalid semver: ${!a ? left : right}`);
	return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function probeHost(
	env: Record<string, string | undefined> = process.env,
	platform = process.platform,
	hostVersion?: string,
): HostProbe {
	const version = hostVersion ?? env.ANTIGRAVITY_VERSION ?? env.AGY_VERSION;
	if (!version) return { ok: false, reason: "Antigravity version is unavailable" };
	if (!parseSemver(version)) return { ok: false, reason: `Antigravity version is invalid: ${version}` };
	if (compareSemver(version, MIN_ANTIGRAVITY_VERSION) < 0) {
		return { ok: false, reason: `Antigravity version ${version} is older than minimum supported ${MIN_ANTIGRAVITY_VERSION}` };
	}
	if (!SUPPORTED_PLATFORMS.includes(platform as (typeof SUPPORTED_PLATFORMS)[number])) {
		return { ok: false, reason: `platform ${platform} is unsupported` };
	}
	return { ok: true, host: HOST_ID, version, platform };
}

export const ANTIGRAVITY_CAPABILITY: HostCapabilityDeclaration = validateHostCapabilityDeclaration({
	hostId: "antigravity",
	hostName: "Antigravity",
	ports: {
		P1: {
			port: "P1",
			level: "conformance-only",
			evidence: "Conformance-tested MCP tools and Hook handlers; live certification pending S8 (#469)",
		},
		P2: {
			port: "P2",
			level: "conformance-only",
			evidence: "Conformance-tested native confirmation grant files and MCP elicitation; live certification pending S8 (#469)",
		},
		P3: {
			port: "P3",
			level: "conformance-only",
			evidence: "Conformance-tested verifier observation via hook event log; live observation pending S8 (#451)",
		},
		P4: {
			port: "P4",
			level: "conformance-only",
			evidence: "Conformance-tested simplified continuation; shared continuation pending S6 and live certification pending S8",
		},
		P5: {
			port: "P5",
			level: "guard-only",
			evidence: "Tree guard only; agy --print lacks CLI restriction flags, shell-less native roles cannot perform git checks, and untracked files are uncovered (ADR 0037, D9)",
		},
		P6: {
			port: "P6",
			level: "conformance-only",
			evidence: "Conformance-tested Lane Executor spawn via configured executor host",
		},
		P7: {
			port: "P7",
			level: "conformance-only",
			evidence: "Conformance-tested private directory storage; mode, ownership and O_NOFOLLOW security protections pending S2 (D3)",
		},
		P8: {
			port: "P8",
			level: "unsupported",
			evidence: "PreInvocation returns empty steps; active-task notice and model-callable Skill entry pending S8 probe (D10)",
		},
		P9: {
			port: "P9",
			level: "unsupported",
			evidence: "Antigravity provides no background wake mechanism",
		},
	},
});

export const CAPABILITY_DECLARATION = ANTIGRAVITY_CAPABILITY;
