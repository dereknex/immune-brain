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
			"non-blocking correction window",
			"final decisions",
			"question transcript",
		]);
	});

	test("confirmed decisions are not reconfirmed unless the summary changes them", () => {
		expectAll([...brainstormContracts, ...plannerContracts], [
			"Treat the user's direct requirements, answers to numbered questions, and bulk approval of recommendations as confirmation of those decisions",
			"Do not ask the user to reconfirm decisions reflected without material change",
			"introduces or changes a material decision affecting Result, Scope, behavior, Verification, or risk treatment",
			"explicit confirmation of only that decision delta",
		]);
		expectAll(brainstormContracts, [
			"Agent judgment alone never confirms a proposed direction or scope",
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

	test("Brainstorm separates repository facts from user-owned decisions throughout clarification", () => {
		expectAll(brainstormContracts, [
			"At every round, classify each newly surfaced uncertainty as either a repository fact or a user-owned decision",
			"Resolve repository facts with bounded read-only evidence",
			"place only decisions that can change Result, Scope, behavior, Verification, or risk treatment on the user frontier",
		]);
	});

	test("Planner reuses decision history and selects the highest sufficient behavioral test seam", () => {
		expectAll(plannerContracts, [
			"Direct Planner entry and Medium/High Design Risk work must inspect relevant ADRs and rejected Learnings",
			"Reuse constraints already covered by an upstream Brainstorm manifest instead of repeating that discovery",
			"Prefer the highest existing observable behavioral test seam and the fewest sufficient seams",
			"Cite relevant test prior art and explain how the selected seam catches the intended regression",
			"must not weaken acceptance-specific focused verification descriptors or add a mandatory user confirmation",
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
