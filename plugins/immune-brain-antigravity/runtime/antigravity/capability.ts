export const MIN_ANTIGRAVITY_VERSION = "0.1.0";
export const HOST_ID = "antigravity" as const;
export const CORE_CONTRACT = "assurance_kernel/host_adapter/antigravity/v1";
export const SUPPORTED_PLATFORMS = ["darwin", "linux"] as const;

export type HostProbe =
	| { ok: true; host: typeof HOST_ID; version: string; platform: string }
	| { ok: false; reason: string };

function parseSemver(value: string): [number, number, number] | null {
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
