// S1 / HTN-1, HTN-2: Host tool-surface guard for the packaged contracts.
//
// Every file under `plugins/immune-brain/dist/` is shipped to every Host, so a
// packaged contract may name only tool spellings that resolve on every Host. A
// spelling that exists on one Host alone belongs in that Host's adapter, not in
// a shared contract: the contract states the obligation and lets each Host map
// it onto its own Tool.
//
// The guard derives both sides from their own sources instead of a hand-written
// list, so it cannot rot silently:
//   - Claude Code's tool names come from the MCP server's `TOOLS` table.
//   - Pi's tool names come from the extension entry files its host manifest loads.
//   - The shared Kernel operation vocabulary is the intersection of Claude's tool
//     names with the operation literals Pi's Tools declare. A name both Hosts
//     accept as an operation is Host-neutral; a name only one Host registers as a
//     Tool is a Host-specific spelling.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { TOOLS } from "../plugins/immune-brain/runtime/claude/mcp_server";

const ROOT = resolve(import.meta.dir, "..");
const DIST_DIR = join(ROOT, "plugins/immune-brain/dist");
const PI_EXTENSION_DIR = join(ROOT, "plugins/immune-brain/.pi-extension");
const PI_MANIFEST = join(PI_EXTENSION_DIR, "package.json");

/** Packaged contracts name call targets only through backticked identifiers. */
const BACKTICKED = /`([^`\n]+)`/g;
/** Pi's Tool schemas declare their operation literals inline. */
const PI_OPERATION_LITERAL = /Type\.Literal\("([a-z0-9_]+)"\)/g;
/** A Tool declaration in a Pi extension file. */
const PI_TOOL_DECLARATION = /^\s+name: "([a-z][a-z0-9_]*)"[,]?$/gm;
const TOOL_SPELLING = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

function read(abs: string): string {
	return readFileSync(abs, "utf8");
}

function markdownContracts(): string[] {
	return readdirSync(DIST_DIR, { recursive: true })
		.map((entry) => resolve(DIST_DIR, typeof entry === "string" ? entry : entry.toString()))
		.filter((abs) => abs.endsWith(".md") && statSync(abs).isFile())
		.sort();
}

/** The Pi extension entry files the host manifest actually loads. */
function piEntryFiles(): string[] {
	const manifest = JSON.parse(read(PI_MANIFEST)) as { pi: { extensions: string[] } };
	return manifest.pi.extensions.map((rel) => resolve(PI_EXTENSION_DIR, rel));
}

function piToolNames(): Set<string> {
	const names = new Set<string>();
	for (const abs of piEntryFiles())
		for (const [, name] of read(abs).matchAll(PI_TOOL_DECLARATION)) names.add(name);
	return names;
}

function piOperationNames(): Set<string> {
	const names = new Set<string>();
	for (const abs of piEntryFiles())
		for (const [, name] of read(abs).matchAll(PI_OPERATION_LITERAL)) names.add(name);
	return names;
}

/** Tool names Claude Code's MCP server registers. */
const CLAUDE_TOOLS = new Set(TOOLS.map((tool) => tool.name));
/** Tool names Pi's loaded extension entry files register. */
const PI_TOOLS = piToolNames();
const EVERY_HOST_TOOLS = new Set([...PI_TOOLS].filter((name) => CLAUDE_TOOLS.has(name)));
/** Operation names both Hosts accept, so a contract may state them Host-neutrally. */
const SHARED_OPERATIONS = new Set([...piOperationNames()].filter((name) => CLAUDE_TOOLS.has(name)));

/**
 * The Host-specific Tool spellings a contract text names. A spelling is
 * Host-specific when some Host registers it as a Tool and it is neither a
 * shared operation nor registered on every Host.
 */
function hostSpecificToolSpellings(text: string): string[] {
	const found = new Set<string>();
	for (const [, token] of text.matchAll(BACKTICKED)) {
		if (!TOOL_SPELLING.test(token)) continue;
		if (SHARED_OPERATIONS.has(token) || EVERY_HOST_TOOLS.has(token)) continue;
		if (CLAUDE_TOOLS.has(token) || PI_TOOLS.has(token)) found.add(token);
	}
	return [...found].sort();
}

function contractViolations(): string[] {
	const violations: string[] = [];
	for (const abs of markdownContracts()) {
		const rel = abs.slice(ROOT.length + 1);
		read(abs)
			.split("\n")
			.forEach((line, index) => {
				for (const token of hostSpecificToolSpellings(line)) violations.push(`${rel}:${index + 1}: \`${token}\``);
			});
	}
	return violations;
}

describe("packaged contract tool surface", () => {
	test("both Host tool surfaces are actually discovered", () => {
		// A regex that silently stops matching would turn this guard into a no-op.
		expect(CLAUDE_TOOLS.size).toBeGreaterThan(0);
		for (const abs of piEntryFiles()) {
			const declarations = [...read(abs).matchAll(PI_TOOL_DECLARATION)];
			expect(declarations.length, abs).toBeGreaterThan(0);
		}
		expect(SHARED_OPERATIONS.size).toBeGreaterThan(0);
		expect(markdownContracts().length).toBeGreaterThan(0);
	});

	test("no packaged contract names a Host-specific tool spelling", () => {
		expect(contractViolations()).toEqual([]);
	});

	test("the guard rejects the pre-change contracts", () => {
		// Verbatim pre-change sentences from the packaged contracts this slice fixed.
		// The guard has to fail against these, or it does not catch the regression it names.
		expect(
			hostSpecificToolSpellings(
				[
					"Host's `imm_kernel_canary` `status` first and verify the exact active backend",
					"At every internal role boundary call the read-only `imm_loop_action` Tool. Use",
				].join("\n"),
			),
		).toEqual(["imm_kernel_canary", "imm_loop_action"]);
	});

	test("a shared Kernel operation and an every-Host tool name stay accepted", () => {
		expect(hostSpecificToolSpellings("Call `advance_assurance` in the foreground. Read `status` first.")).toEqual([]);
		expect(hostSpecificToolSpellings("The only unattended batch entry is `start_unattended_batch`.")).toEqual([]);
	});
});
