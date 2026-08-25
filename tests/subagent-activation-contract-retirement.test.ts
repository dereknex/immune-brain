import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

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
