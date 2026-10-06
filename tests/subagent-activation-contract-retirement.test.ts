import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { INTERNAL_ROLE_PROMPTS } from "../plugins/immune-brain/runtime/role_prompt_bridge";

const ROOT = resolve(import.meta.dir, "..");

const WORKFLOW_REFERENCE = "docs/reference/workflow-and-subagents.md";

/**
 * Roster names that were never runtime roles. They came from an upstream agent
 * list, and the manifest prose that carried them described subagents this
 * runtime cannot dispatch. Their absence is what keeps the reference from
 * growing a second roster.
 */
const RETIRED_ROSTER_NAMES = [
	"context-mapper",
	"scope-reviewer",
	"qa-verifier",
	"knowledge-compounder",
	"code-reviewer",
	"ui-reviewer",
] as const;

/** Headings of the deleted manifest prose, matched without their anchor level. */
const RETIRED_HEADINGS = [
	"Subagent Manifest Contract",
	"首版核心 Subagents",
	"场景化启用矩阵",
] as const;

function roleMappingRows(markdown: string): string[] {
	const lines = markdown.split("\n");
	const headerIndex = lines.findIndex((line) => line.trim().startsWith("| Internal role |"));
	expect(headerIndex).toBeGreaterThanOrEqual(0);
	const rows: string[] = [];
	for (const line of lines.slice(headerIndex + 1)) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("|")) break;
		if (/^\|[\s|:-]+\|$/.test(trimmed)) continue;
		const name = trimmed.split("|")[1]?.trim().replace(/`/g, "");
		if (!name) break;
		rows.push(name);
	}
	return rows;
}

const BINDING_CONTRACTS = [
	"AGENTS.md",
	"README.md",
	"docs/reference/immune-brain-config.md",
	"docs/reference/subagent-dispatch-protocol.md",
	"docs/reference/workflow-and-subagents.md",
	"plugins/immune-brain/USER_GUIDE.md",
	"plugins/immune-brain/skills/imm-planner/SKILL.md",
	"plugins/immune-brain/skills/imm-brainstorm/SKILL.md",
	"plugins/immune-brain/dist/imm-planner.md",
	"plugins/immune-brain/dist/imm-brainstorm.md",
] as const;

const RETIRED_CONFIG_TOKENS = [
	"IMMUNE_BRAIN_AGENT_CONFIG",
	"IMMUNE_BRAIN_CONFIG",
	"[subagent_activation]",
	"[workflow_models]",
	"[subagent_models]",
	"[output_language]",
	"[dev_insights]",
] as const;

function read(rel: string): string {
	return readFileSync(resolve(ROOT, rel), "utf8");
}

function listTypeScriptFiles(dir: string): string[] {
	return readdirSync(dir, { recursive: true })
		.map((entry) => resolve(dir, typeof entry === "string" ? entry : entry.toString()))
		.filter((path) => statSync(path).isFile() && path.endsWith(".ts"));
}

function liveSourceFiles(): string[] {
	return [
		...listTypeScriptFiles(resolve(ROOT, "plugins/immune-brain/runtime")),
		...listTypeScriptFiles(resolve(ROOT, "plugins/immune-brain/.pi-extension")),
	];
}

describe("subagent activation machinery retirement", () => {
	test("the agent config loader is gone and nothing resolves a [subagent_activation] setting", () => {
		expect(
			existsSync(resolve(ROOT, "plugins/immune-brain/runtime/agent_config.ts")),
		).toBe(false);

		const offenders: string[] = [];
		for (const abs of liveSourceFiles()) {
			const rel = relative(ROOT, abs).split(sep).join("/");
			const source = readFileSync(abs, "utf8");
			if (source.includes("subagent_activation") || source.includes("runtime/agent_config")) {
				offenders.push(rel);
			}
		}
		expect(offenders).toEqual([]);
	});

	test("the workflow reference retires the manifest prose and its fictional roster", () => {
		const content = read(WORKFLOW_REFERENCE);

		for (const heading of RETIRED_HEADINGS)
			expect({ heading, present: content.includes(heading) }).toEqual({ heading, present: false });
		for (const name of RETIRED_ROSTER_NAMES)
			expect({ name, present: content.includes(name) }).toEqual({ name, present: false });

		// The minimal JSON output contract belonged to that roster; nothing else
		// in the runtime emits it.
		expect(content).not.toContain("ok | partial | blocked | failed");
		expect(content).not.toContain("\"confidence\": 0.0");
		expect(content).not.toContain("authority_class");

		// What survives is the boundary prose, not the roster.
		expect(content).toContain("#### Authority 与 Routing Boundary");
		expect(content).toContain("#### Authorization Policy");
		expect(content).toContain("#### 条件风险 Advisory Lenses");
		expect(content).toContain("#### Subagent Model Selection");
	});

	test("the one role mapping table equals the runtime INTERNAL_ROLE_PROMPTS keys", () => {
		const documented = roleMappingRows(read(WORKFLOW_REFERENCE));
		const runtime = Object.keys(INTERNAL_ROLE_PROMPTS);

		// Exactly one such table: a second mapping is how a second roster returns.
		expect(read(WORKFLOW_REFERENCE).match(/\| Internal role \|/g)?.length).toBe(1);

		expect({ runtimeMissingFromDoc: runtime.filter((role) => !documented.includes(role)) }).toEqual({
			runtimeMissingFromDoc: [],
		});
		expect({ documentedAbsentFromRuntime: documented.filter((role) => !runtime.includes(role)) }).toEqual({
			documentedAbsentFromRuntime: [],
		});
		expect(new Set(documented).size).toBe(documented.length);

		// Each documented row keeps the authority the runtime declares for it.
		for (const line of read(WORKFLOW_REFERENCE).split("\n")) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("| `")) continue;
			const cells = trimmed.split("|").map((cell) => cell.trim().replace(/`/g, ""));
			const role = cells[1];
			if (!role || !(role in INTERNAL_ROLE_PROMPTS)) continue;
			const spec = INTERNAL_ROLE_PROMPTS[role as keyof typeof INTERNAL_ROLE_PROMPTS];
			expect({ role, gate: cells[2] }).toEqual({ role, gate: spec.review_gate ?? "—" });
			expect({ role, authority: cells[3] }).toEqual({ role, authority: spec.authority });
			expect({ role, tool_policy: cells[4] }).toEqual({ role, tool_policy: spec.tool_policy });
		}
	});

	test("current binding contracts no longer condition behavior on retired config", () => {
		for (const rel of BINDING_CONTRACTS) {
			const content = read(rel);
			for (const token of RETIRED_CONFIG_TOKENS)
				expect({ rel, token, present: content.includes(token) }).toEqual({
					rel,
					token,
					present: false,
				});
			expect(content).not.toContain("imm-activation-plan");
			expect(content).not.toContain("CLI activation plan");
		}
	});

	test("the authorization is preserved unconditionally in AGENTS.md", () => {
		const content = read("AGENTS.md");
		expect(content).toContain(
			"This project authorizes readonly advisory subagents and parallel probes unless the user asks for solo work.",
		);
		expect(content).toContain(
			"this project instruction does not override host tool policy",
		);
		expect(content).not.toContain("[subagent_activation]");
		expect(content).not.toContain("resolves to");
	});
});
