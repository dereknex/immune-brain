import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

const BINDING_CONTRACTS = [
	"AGENTS.md",
	"plugins/immune-brain/dist/imm-planner.md",
	"plugins/immune-brain/dist/imm-brainstorm.md",
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
		...listTypeScriptFiles(resolve(ROOT, "tests")),
	].filter((abs) => !abs.endsWith("subagent-activation-contract-retirement.test.ts"));
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

	test("the four binding contracts no longer condition behavior on the machinery", () => {
		for (const rel of BINDING_CONTRACTS) {
			const content = read(rel);
			expect(content).not.toContain("subagent_activation");
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
