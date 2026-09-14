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
//
// A Host-specific spelling is reported whenever the token is a call target,
// either because a Host registers it as a Tool or because the contract itself
// names it as one (the word Tool/Operation right after it). The second source is
// what makes a Tool no Host registers any more — the HTN-2 regression this guard
// exists to catch — a failure instead of a silent pass: a registration that no
// longer exists leaves nothing to derive from, but the contract still spells the
// obligation as the Tool it claims.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
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
/** The word Tool/Operation right after a token marks it as a call target. */
const TOOL_WORD_AFTER = /^\s*(?:Tool|Tools|Operation|Operations)\b/;

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
 * Host-specific when it is a call target and is neither a shared operation nor
 * registered on every Host; a call target no Host registers at all is the
 * worst case of the same rule, not an exemption from it.
 */
function hostSpecificToolSpellings(text: string): string[] {
	const found = new Set<string>();
	for (const match of text.matchAll(BACKTICKED)) {
		const token = match[1]!;
		if (!TOOL_SPELLING.test(token)) continue;
		if (SHARED_OPERATIONS.has(token) || EVERY_HOST_TOOLS.has(token)) continue;
		const index = match.index ?? 0;
		const registered = CLAUDE_TOOLS.has(token) || PI_TOOLS.has(token);
		const named = TOOL_WORD_AFTER.test(text.slice(index + match[0].length));
		if (registered || named) found.add(token);
	}
	return [...found].sort();
}

/** The violations one contract text contributes, in line order. */
function contractViolationsIn(rel: string, text: string): string[] {
	const violations: string[] = [];
	text.split("\n").forEach((line, index) => {
		for (const token of hostSpecificToolSpellings(line)) violations.push(`${rel}:${index + 1}: \`${token}\``);
	});
	return violations;
}

function contractViolations(): string[] {
	return markdownContracts().flatMap((abs) => contractViolationsIn(abs.slice(ROOT.length + 1), read(abs)));
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
		// The commit immediately before S1's first contract change owns the actual
		// pre-change text, read here at test time: a paraphrase of the old sentences
		// could drift from what the guard actually rejected.
		const path = "plugins/immune-brain/dist/imm-loop.md";
		const before = execFileSync("git", ["show", `aecf5dd^:${path}`], { cwd: ROOT, encoding: "utf8" });
		const violations = contractViolationsIn(path, before);
		expect(violations.length).toBeGreaterThan(0);
		expect(violations.join("\n")).toContain("`imm_kernel_canary`");
		expect(violations.join("\n")).toContain("`imm_loop_action`");
	});

	test("the guard rejects a tool spelling no Host registers any more", () => {
		// HTN-2's exact regression: a contract names a Tool that no Host surface
		// registers. Zero surfaces is a failure, not a silent pass.
		expect(hostSpecificToolSpellings("The read-only `retired_host_tool` Tool projects authority.")).toEqual([
			"retired_host_tool",
		]);
		expect(hostSpecificToolSpellings("Call the `retired_kernel_operation` Operation first.")).toEqual([
			"retired_kernel_operation",
		]);
	});

	test("a shared Kernel operation and an every-Host tool name stay accepted", () => {
		expect(hostSpecificToolSpellings("Call `advance_assurance` in the foreground. Read `status` first.")).toEqual([]);
		expect(hostSpecificToolSpellings("The only unattended batch entry is `start_unattended_batch`.")).toEqual([]);
	});
});
