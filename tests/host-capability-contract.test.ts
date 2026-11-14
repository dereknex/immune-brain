/**
 * Host capability contract tests (docs/specs/tri-host-capability-alignment.spec.md D1, D2; S1 AC1, AC2).
 *
 * AC1 (BR-REQ-1, BR-SCN-1):
 * - Every adapter declaration covers P1-P9 exactly once using only certified,
 *   conformance-only, guard-only, or unsupported with evidence/limitation text.
 * - The generated table renders every Host and port exactly once.
 * - Negative: unknown port, duplicate/missing cell, or unsupported level is rejected.
 * - Bound: no fifth level or runtime-selected host is accepted.
 * - Done looks like: a maintainer opens docs/reference/host-capability.md and sees the complete matrix.
 *
 * AC2 (BR-DEC-4):
 * - Renderer and tests explicitly import the three composition-root declarations.
 * - Production runtime performs no capability-based registry lookup or dispatch.
 * - Cross-adapter imports or production registry/dispatcher fail the boundary.
 * - Empty host-to-host baseline stays empty.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	CAPABILITY_LEVELS,
	CAPABILITY_PORT_IDS,
	CAPABILITY_PORTS,
	type CapabilityLevel,
	type CapabilityPortId,
	type HostCapabilityDeclaration,
	validateHostCapabilityDeclaration,
} from "../plugins/immune-brain/runtime/host-core/capability";
import { CLAUDE_CAPABILITY } from "../plugins/immune-brain/runtime/claude/capability";
import { ANTIGRAVITY_CAPABILITY } from "../plugins/immune-brain/runtime/antigravity/capability";
import { PI_CAPABILITY } from "../plugins/immune-brain/.pi-extension/pi-capability";
import {
	HOST_CAPABILITY_PATH,
	renderHostCapabilityMatrix,
} from "../scripts/render-host-capability";

const ROOT = resolve(import.meta.dir, "..");

describe("host capability contract", () => {
	const declarations = [CLAUDE_CAPABILITY, ANTIGRAVITY_CAPABILITY, PI_CAPABILITY];

	describe("AC1: capability declarations and maintainer table", () => {
		it("every adapter exports a valid declaration covering P1-P9 exactly once", () => {
			expect(declarations.length).toBe(3);

			for (const decl of declarations) {
				const validated = validateHostCapabilityDeclaration(decl);
				expect(validated.hostId).toBeTruthy();
				expect(validated.hostName).toBeTruthy();

				const coveredPorts = Object.keys(validated.ports);
				expect(coveredPorts.sort()).toEqual([...CAPABILITY_PORT_IDS].sort());

				for (const portId of CAPABILITY_PORT_IDS) {
					const cell = validated.ports[portId];
					expect(cell.port).toBe(portId);
					expect(CAPABILITY_LEVELS).toContain(cell.level);
					expect(cell.evidence.length).toBeGreaterThan(0);
				}
			}
		});

		it("positive (BR-SCN-1): generated table renders every Host and port exactly once", () => {
			const rendered = renderHostCapabilityMatrix(declarations);

			// Renders markdown document title and headers
			expect(rendered).toContain("# Host Capability Matrix");
			expect(rendered).toContain("## Capability Matrix");
			expect(rendered).toContain("## Detailed Evidence and Limitations");

			// Every host name appears in the table header exactly once
			const headerLine = rendered.split("\n").find((line) => line.startsWith("| Port | Capability |"));
			expect(headerLine).toBeDefined();
			expect(headerLine).toBe("| Port | Capability | Claude Code | Antigravity | Pi |");
			for (const decl of declarations) {
				const hostOccurrences = (headerLine!.match(new RegExp(escapeRegex(decl.hostName), "g")) || []).length;
				expect(hostOccurrences).toBe(1);
			}

			// Table has exactly 9 port rows (P1-P9)
			const tableRows = rendered.split("\n").filter((line) => /^\|\s*P\d\s*\|/.test(line));
			expect(tableRows.length).toBe(CAPABILITY_PORT_IDS.length);

			// Every port P1-P9 appears in the table exactly once, with exactly one detail section
			for (const portId of CAPABILITY_PORT_IDS) {
				const portDef = CAPABILITY_PORTS[portId];

				// Row in table: `| P1 | call correlation/phase admission | ...` exactly once
				const matchingRows = tableRows.filter((row) => row.startsWith(`| ${portId} |`));
				expect(matchingRows.length).toBe(1);
				expect(matchingRows[0]).toContain(`| ${portId} | ${portDef.name} |`);

				// Detail section: `### P1 — call correlation/phase admission` exactly once
				const headingMatches = (rendered.match(new RegExp(`### ${portId} — ${escapeRegex(portDef.name)}`, "g")) || []).length;
				expect(headingMatches).toBe(1);

				// Each host has exactly one entry under the detail section
				for (const decl of declarations) {
					const hostDetailMatches = (rendered.match(new RegExp(`- \\*\\*${escapeRegex(decl.hostName)}\\*\\*`, "g")) || []).length;
					expect(hostDetailMatches).toBe(CAPABILITY_PORT_IDS.length); // 1 per port across 9 ports
				}
			}

			// All four levels appear in the rendered output
			for (const level of CAPABILITY_LEVELS) {
				expect(rendered).toContain(`\`${level}\``);
			}

			// The reference file docs/reference/host-capability.md exists and matches
			const filePath = resolve(ROOT, HOST_CAPABILITY_PATH);
			expect(existsSync(filePath)).toBe(true);
			const onDisk = readFileSync(filePath, "utf8");
			expect(onDisk).toBe(rendered);
		});

		it("negative: rejects duplicate cell (port mismatch in cell)", () => {
			const invalid = cloneDeclaration(CLAUDE_CAPABILITY);
			// P2 cell carried as P1 (duplicate P1 under P2)
			invalid.ports.P2 = {
				port: "P1",
				level: "certified",
				evidence: "duplicate P1 cell under P2",
			};
			expect(() => validateHostCapabilityDeclaration(invalid)).toThrow(
				"Mismatched port ID in cell: expected P2, got P1",
			);
		});

		it("negative: rejects duplicate Host declaration in renderer", () => {
			expect(() =>
				renderHostCapabilityMatrix([CLAUDE_CAPABILITY, CLAUDE_CAPABILITY, ANTIGRAVITY_CAPABILITY]),
			).toThrow("Duplicate host declaration in matrix renderer: claude-code");
		});

		it("negative: rejects unknown port ID", () => {
			const invalid = cloneDeclaration(CLAUDE_CAPABILITY);
			(invalid.ports as Record<string, unknown>).P10 = {
				port: "P10",
				level: "certified",
				evidence: "unknown port",
			};
			expect(() => validateHostCapabilityDeclaration(invalid)).toThrow("Unknown capability port ID: P10");
		});

		it("negative: rejects missing port", () => {
			const invalid = cloneDeclaration(CLAUDE_CAPABILITY);
			delete (invalid.ports as Record<string, unknown>).P9;
			expect(() => validateHostCapabilityDeclaration(invalid)).toThrow("Missing capability port: P9");
		});

		it("negative: rejects unsupported level (5th level rejection)", () => {
			const invalid = cloneDeclaration(CLAUDE_CAPABILITY);
			(invalid.ports.P1 as { level: string }).level = "partial";
			expect(() => validateHostCapabilityDeclaration(invalid)).toThrow('Invalid capability level "partial"');

			(invalid.ports.P1 as { level: string }).level = "experimental";
			expect(() => validateHostCapabilityDeclaration(invalid)).toThrow('Invalid capability level "experimental"');
		});

		it("negative: rejects empty evidence text", () => {
			const invalid = cloneDeclaration(CLAUDE_CAPABILITY);
			invalid.ports.P1.evidence = "   ";
			expect(() => validateHostCapabilityDeclaration(invalid)).toThrow("Missing evidence/limitation text for port P1");
		});

		it("bound: exactly four evidence levels are permitted", () => {
			expect(CAPABILITY_LEVELS).toEqual([
				"certified",
				"conformance-only",
				"guard-only",
				"unsupported",
			]);
		});
	});

	describe("AC2: no capability-based registry lookup or dynamic dispatch", () => {
		it("declarations are explicitly imported composition roots, not dynamic discovery", () => {
			// Explicit imports pass
			expect(CLAUDE_CAPABILITY.hostId).toBe("claude-code");
			expect(ANTIGRAVITY_CAPABILITY.hostId).toBe("antigravity");
			expect(PI_CAPABILITY.hostId).toBe("pi");
		});

		it("host-core capability module exposes only declaration types and validator, no registry or dispatcher", () => {
			const hostCoreCap = require("../plugins/immune-brain/runtime/host-core/capability");
			const exportedKeys = Object.keys(hostCoreCap);
			expect(exportedKeys).toContain("CAPABILITY_PORT_IDS");
			expect(exportedKeys).toContain("CAPABILITY_LEVELS");
			expect(exportedKeys).toContain("CAPABILITY_PORTS");
			expect(exportedKeys).toContain("validateHostCapabilityDeclaration");

			// No host registry, lookup, or dispatcher functions are exported
			expect(exportedKeys).not.toContain("registerHost");
			expect(exportedKeys).not.toContain("getHostByCapability");
			expect(exportedKeys).not.toContain("dispatchCapability");
			expect(exportedKeys).not.toContain("resolveHost");
		});
	});

	describe("S7 AC2: Review CLI residual risk and guard-only declarations (D8, D9)", () => {
		it("Pi and Antigravity P5 remain guard-only with residual risks disclosed", () => {
			expect(PI_CAPABILITY.ports.P5.level).toBe("guard-only");
			expect(ANTIGRAVITY_CAPABILITY.ports.P5.level).toBe("guard-only");

			// Pi P5 evidence discloses Bash arguments and untracked files
			expect(PI_CAPABILITY.ports.P5.evidence).toContain("Bash arguments cannot be restricted to Git");
			expect(PI_CAPABILITY.ports.P5.evidence).toContain("untracked files are uncovered");
			expect(PI_CAPABILITY.ports.P5.evidence).toContain("read,grep,find,ls,bash");

			// Antigravity P5 evidence discloses absence of restriction flags, shell-less limits, and untracked files
			expect(ANTIGRAVITY_CAPABILITY.ports.P5.evidence).toContain("agy --print lacks CLI restriction flags");
			expect(ANTIGRAVITY_CAPABILITY.ports.P5.evidence).toContain("shell-less native roles cannot perform git checks");
			expect(ANTIGRAVITY_CAPABILITY.ports.P5.evidence).toContain("untracked files are uncovered");
		});

		it("negative: no declaration text claims either CLI is preventively read-only or certifies native AG review", () => {
			for (const decl of [PI_CAPABILITY, ANTIGRAVITY_CAPABILITY]) {
				const p5 = decl.ports.P5;
				expect(p5.evidence).not.toMatch(/preventive(?:ly)?\s+read-only/i);
				expect(p5.evidence).not.toContain("certified");
			}
			expect(ANTIGRAVITY_CAPABILITY.ports.P5.level).not.toBe("certified");
		});

		it("positive: maintainer reading rendered table sees the residual risks for both hosts", () => {
			const rendered = renderHostCapabilityMatrix(declarations);
			expect(rendered).toContain("| P5 | Review/Verify CLI isolation | `certified` | `guard-only` | `guard-only` |");
			expect(rendered).toContain("Bash arguments cannot be restricted to Git");
			expect(rendered).toContain("agy --print lacks CLI restriction flags");
			expect(rendered).toContain("shell-less native roles cannot perform git checks");
			expect(rendered).toContain("untracked files are uncovered");
		});
	});
});

function cloneDeclaration(decl: HostCapabilityDeclaration): HostCapabilityDeclaration {
	return JSON.parse(JSON.stringify(decl));
}

function escapeRegex(text: string): string {
	return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}
