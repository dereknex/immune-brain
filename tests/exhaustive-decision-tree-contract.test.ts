import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (path: string) =>
	readFileSync(join(ROOT, path), "utf8").replace(/\s+/g, " ");

const brainstormContracts = [
	"plugins/immune-brain/skills/imm-brainstorm/SKILL.md",
	"plugins/immune-brain/dist/imm-brainstorm.md",
];
const plannerContracts = [
	"plugins/immune-brain/skills/imm-planner/SKILL.md",
	"plugins/immune-brain/dist/imm-planner.md",
];

const expectAll = (paths: string[], phrases: string[]) => {
	for (const path of paths) {
		const contract = read(path);
		for (const phrase of phrases) {
			expect(contract, `${path} must contain ${JSON.stringify(phrase)}`).toContain(
				phrase,
			);
		}
	}
};

describe("default exhaustive decision-tree skill contract", () => {
	test("both stages use dependency-aware complete-frontier rounds", () => {
		expectAll([...brainstormContracts, ...plannerContracts], [
			"Default exhaustive decision tree",
			"repository facts",
			"currently unblocked frontier",
			"recommended answer",
			"bulk approval of all recommendations",
			"zero-question fast path",
			"result-only summary",
			"explicit confirmation",
			"final decisions",
			"question transcript",
		]);
	});

	test("Brainstorm owns product framing without a fixed question budget", () => {
		expectAll(brainstormContracts, [
			"product-framing",
			"goal, beneficiary and scenario",
			"scope, non-goals, behavior boundaries",
			"success criteria",
			"deferred items",
			"orthogonal analysis lenses",
		]);
		const packaged = read(brainstormContracts[1]);
		expect(packaged).not.toContain("lightweight tasks get 1-2 probes");
		expect(packaged).not.toContain("larger tasks may need 3-4");
		expect(packaged).not.toContain("one question at a time");
	});

	test("Planner owns execution design and returns product uncertainty", () => {
		expectAll(plannerContracts, [
			"Direct Planner entry",
			"execution-design",
			"component boundaries",
			"failure behavior",
			"compatibility, migration",
			"recovery and rollback",
			"Product-level uncertainty",
			"return to `imm-brainstorm`",
			"Spec, Plan, or TaskIntent",
		]);
	});

	test("Managed Path bootstrap files carry the current schema", () => {
		const agents = read("AGENTS.md");
		expect(agents).toContain("<!-- IMMUNE-BRAIN:START -->");
		expect(agents).toContain("<!-- IMMUNE-BRAIN:END -->");
		expect(readFileSync(join(ROOT, "CONTEXT.md"), "utf8")).toStartWith(
			"# Project Context",
		);
	});
});
