import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MIN_CLAUDE_CODE_VERSION } from "../plugins/immune-brain/runtime/claude/capability";

const ROOT = join(import.meta.dir, "..");
const REPORT = join(ROOT, "docs/verification/claude-native-elicitation-authority-conformance.md");
const SERVER = join(ROOT, "plugins/immune-brain/runtime/claude/mcp_server.ts");
const OBSERVED_PLUGIN_VERSION = "3.4.0";

describe("Claude native elicitation promotion evidence", () => {
	test("binds the supported Host floor to the observed plugin and MCP protocol", () => {
		const report = readFileSync(REPORT, "utf8");
		const server = readFileSync(SERVER, "utf8");
		expect(report).toContain(`plugin_version: ${OBSERVED_PLUGIN_VERSION}`);
		expect(report).toContain(`- Immune-Brain plugin: \`${OBSERVED_PLUGIN_VERSION}\``);
		expect(report).toContain(`claude_code_version: ${MIN_CLAUDE_CODE_VERSION}`);
		expect(report).toContain(`minimum_supported_version: ${MIN_CLAUDE_CODE_VERSION}`);
		expect(report).toContain("mcp_protocol: 2025-06-18");
		expect(server).toContain('MCP_PROTOCOL_VERSION = "2025-06-18"');
	});

	test("records real Host scenarios without promoting them to Kernel authority", () => {
		const report = readFileSync(REPORT, "utf8");
		const normalized = report.replace(/\s+/g, " ");
		for (const scenario of ["Plan-only", "Accept", "Decline", "Cancel", "Allowlisted headless", "Auto", "Accept edits"]) {
			expect(report).toContain(`| ${scenario} |`);
		}
		expect(report).toContain("real-host-conformance");
		expect(normalized).toContain("not a Kernel attestation or user authority artifact");
		expect(normalized).toContain("no result is represented as a human authorization for production work");
	});
});
