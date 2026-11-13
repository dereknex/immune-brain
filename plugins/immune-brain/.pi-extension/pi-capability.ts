import {
	type HostCapabilityDeclaration,
	validateHostCapabilityDeclaration,
} from "../runtime/host-core/capability";

export const HOST_ID = "pi" as const;
export const SUPPORTED_PLATFORMS = ["darwin", "linux"] as const;

export type HostProbe =
	| { ok: true; host: typeof HOST_ID; platform: string; version?: string }
	| { ok: false; reason: string };

export function probeHost(
	_env: Record<string, string | undefined> = process.env,
	platform: NodeJS.Platform = process.platform,
	hostVersion?: string,
): HostProbe {
	if (!SUPPORTED_PLATFORMS.includes(platform as (typeof SUPPORTED_PLATFORMS)[number])) {
		return { ok: false, reason: `platform ${platform} is unsupported` };
	}
	return { ok: true, host: HOST_ID, platform, ...(hostVersion ? { version: hostVersion } : {}) };
}

export const PI_CAPABILITY: HostCapabilityDeclaration = validateHostCapabilityDeclaration({
	hostId: "pi",
	hostName: "Pi",
	ports: {
		P1: {
			port: "P1",
			level: "certified",
			evidence: "Native in-process Extension API tool handlers with live TUI correlation and phase admission",
		},
		P2: {
			port: "P2",
			level: "certified",
			evidence: "Native in-process ctx.ui.confirm interactive confirmation dialog",
		},
		P3: {
			port: "P3",
			level: "conformance-only",
			evidence: "Conformance-tested Pi verifier observation via in-memory typed event log and shared VerifierObservation (D4)",
		},
		P4: {
			port: "P4",
			level: "conformance-only",
			evidence: "Shared continuation persistence and events with task/Parent binding, native failure pause and common boundary limits (D6)",
		},
		P5: {
			port: "P5",
			level: "guard-only",
			evidence: "Tree guard only; Pi reviewer disables ambient extensions/skills/mcp with narrowed tools (read,grep,find,ls,bash), but Bash arguments cannot be restricted to Git and untracked files are uncovered (ADR 0037, D8)",
		},
		P6: {
			port: "P6",
			level: "conformance-only",
			evidence: "Conformance-tested Lane Executor spawn via pi CLI",
		},
		P7: {
			port: "P7",
			level: "certified",
			evidence: "Native in-process Extension API state with no filesystem trust boundary (D1)",
		},
		P8: {
			port: "P8",
			level: "certified",
			evidence: "Native Task Rail in TUI and interactive extension commands",
		},
		P9: {
			port: "P9",
			level: "unsupported",
			evidence: "Pi background wake remains unsupported and no MCP transport is added (BR-OUT-2, BR-OUT-3)",
		},
	},
});

export const CAPABILITY_DECLARATION = PI_CAPABILITY;
