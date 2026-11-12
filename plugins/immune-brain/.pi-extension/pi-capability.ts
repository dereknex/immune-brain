import {
	type HostCapabilityDeclaration,
	validateHostCapabilityDeclaration,
} from "../runtime/host-core/capability";

export const HOST_ID = "pi" as const;

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
			evidence: "Conformance-tested dedicated Pi verifier observation; shared VerifierObservation alignment pending S3 (D4)",
		},
		P4: {
			port: "P4",
			level: "conformance-only",
			evidence: "Conformance-tested dedicated Pi run continuation; shared continuation alignment pending S5 (D6)",
		},
		P5: {
			port: "P5",
			level: "guard-only",
			evidence: "Tree guard only; Pi reviewer argv currently lacks ambient restriction flags, and Bash arguments cannot be restricted to Git (ADR 0037, D8)",
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
