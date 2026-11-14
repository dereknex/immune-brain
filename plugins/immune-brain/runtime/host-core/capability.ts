/**
 * Host capability declaration contract (docs/specs/tri-host-capability-alignment.spec.md D1, D2).
 *
 * Defines the nine port IDs P1-P9 and four evidence levels:
 * - certified
 * - conformance-only
 * - guard-only
 * - unsupported
 *
 * Declarations are documentation and conformance inputs only, never runtime dispatch (ADR 0004, ADR 0039).
 */

export const CAPABILITY_PORT_IDS = [
	"P1",
	"P2",
	"P3",
	"P4",
	"P5",
	"P6",
	"P7",
	"P8",
	"P9",
] as const;

export type CapabilityPortId = (typeof CAPABILITY_PORT_IDS)[number];

export const CAPABILITY_LEVELS = [
	"certified",
	"conformance-only",
	"guard-only",
	"unsupported",
] as const;

export type CapabilityLevel = (typeof CAPABILITY_LEVELS)[number];

export interface CapabilityPortDefinition {
	id: CapabilityPortId;
	name: string;
	description: string;
}

export const CAPABILITY_PORTS: Record<CapabilityPortId, CapabilityPortDefinition> = {
	P1: {
		id: "P1",
		name: "call correlation/phase admission",
		description: "Correlation of tool calls and host events with phase admission gates",
	},
	P2: {
		id: "P2",
		name: "native confirmation",
		description: "Interactive native host dialog for literal-user confirmation",
	},
	P3: {
		id: "P3",
		name: "verifier observation",
		description: "Observation of subagent dispatch and verification receipt settlement",
	},
	P4: {
		id: "P4",
		name: "run continuation",
		description: "State-machine driven continuation across tool turns and stop boundaries",
	},
	P5: {
		id: "P5",
		name: "Review/Verify CLI isolation",
		description: "Isolated CLI execution for authority review and verifier processes",
	},
	P6: {
		id: "P6",
		name: "Lane Executor spawn",
		description: "Spawning isolated Lane Executor processes in child worktrees",
	},
	P7: {
		id: "P7",
		name: "private cache storage",
		description: "Tamper-resistant storage for authority correlation and grant state",
	},
	P8: {
		id: "P8",
		name: "active-task/model-entry Host integration",
		description: "Host-native active-task guidance injection and model skill-entry admission",
	},
	P9: {
		id: "P9",
		name: "background wake",
		description: "Waking the parent host turn from background completion or external event",
	},
};

export interface CapabilityCell {
	port: CapabilityPortId;
	level: CapabilityLevel;
	evidence: string;
}

export interface HostCapabilityDeclaration {
	hostId: string;
	hostName: string;
	ports: Record<CapabilityPortId, CapabilityCell>;
}

export function validateHostCapabilityDeclaration(declaration: unknown): HostCapabilityDeclaration {
	if (!declaration || typeof declaration !== "object") {
		throw new Error("Capability declaration must be a non-null object");
	}
	const candidate = declaration as Partial<HostCapabilityDeclaration>;
	if (typeof candidate.hostId !== "string" || !candidate.hostId.trim()) {
		throw new Error("Capability declaration missing valid hostId");
	}
	if (typeof candidate.hostName !== "string" || !candidate.hostName.trim()) {
		throw new Error("Capability declaration missing valid hostName");
	}
	if (!candidate.ports || typeof candidate.ports !== "object") {
		throw new Error("Capability declaration missing ports object");
	}

	const seenPorts = new Set<string>();
	const portsRecord = candidate.ports as Record<string, unknown>;

	for (const key of Object.keys(portsRecord)) {
		if (!CAPABILITY_PORT_IDS.includes(key as CapabilityPortId)) {
			throw new Error(`Unknown capability port ID: ${key}`);
		}
	}

	const validatedPorts = {} as Record<CapabilityPortId, CapabilityCell>;

	for (const portId of CAPABILITY_PORT_IDS) {
		if (!(portId in portsRecord)) {
			throw new Error(`Missing capability port: ${portId} in declaration for ${candidate.hostId}`);
		}
		seenPorts.add(portId);

		const cell = portsRecord[portId] as Partial<CapabilityCell> | undefined;
		if (!cell || typeof cell !== "object") {
			throw new Error(`Invalid cell for port ${portId} in declaration for ${candidate.hostId}`);
		}
		if (cell.port !== portId) {
			throw new Error(`Mismatched port ID in cell: expected ${portId}, got ${cell.port}`);
		}
		if (!CAPABILITY_LEVELS.includes(cell.level as CapabilityLevel)) {
			throw new Error(`Invalid capability level "${cell.level}" for port ${portId} in declaration for ${candidate.hostId}`);
		}
		if (typeof cell.evidence !== "string" || !cell.evidence.trim()) {
			throw new Error(`Missing evidence/limitation text for port ${portId} in declaration for ${candidate.hostId}`);
		}

		validatedPorts[portId] = {
			port: portId,
			level: cell.level as CapabilityLevel,
			evidence: cell.evidence.trim(),
		};
	}

	if (seenPorts.size !== CAPABILITY_PORT_IDS.length) {
		throw new Error(`Declaration for ${candidate.hostId} covers ${seenPorts.size} ports, expected ${CAPABILITY_PORT_IDS.length}`);
	}

	return {
		hostId: candidate.hostId,
		hostName: candidate.hostName,
		ports: validatedPorts,
	};
}
