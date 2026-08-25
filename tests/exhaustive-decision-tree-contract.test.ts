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

describe("Brainstorm-owned clarification contract", () => {
	test("Brainstorm exhausts every sourced current-goal branch", () => {
		expectAll(brainstormContracts, [
			"Default exhaustive decision tree",
			"current-goal branch",
			"user request, repository evidence, or a settled parent decision",
			"fixed framing roots",
			"repository fact or a user-owned decision",
			"complete currently unblocked frontier",
			"recommended answer",
			"bulk approval of all recommendations",
			"settle only the current nodes",
			"Recompute the tree after every response",
			"frontier is empty",
			"BR-DEFER-*",
			"BR-Q-*",
		]);
		for (const path of brainstormContracts) {
			const contract = read(path);
			expect(contract).not.toContain(
				"place only decisions that can change Result, Scope, behavior, Verification, or risk treatment on the user frontier",
			);
			expect(contract).not.toContain(
				"Before framing, scan `docs/solutions/` for entries with `rejected: true` frontmatter",
			);
		}
	});

	test("recommendation adoption advances rather than ends traversal", () => {
		expectAll(brainstormContracts, [
			"Direct requirements and adopted recommendations settle only the current nodes",
			"never complete the Brainstorm session by themselves",
			"newly unlocked downstream branches",
			"zero-question fast path",
			"complete seeded and dynamically expanded tree",
			"Do not ask the user to reconfirm decisions reflected without change",
			"explicit confirmation of only that decision delta",
		]);
	});

	test("Brainstorm modes share one protocol and require explicit lens selection", () => {
		expectAll(brainstormContracts, [
			"goal, beneficiary and scenario, current state, desired behavior",
			"failure and edge behavior, compatibility and migration",
			"same exhaustive frontier protocol",
			"explicitly selected by the user",
			"on-demand rejected-decision evidence",
		]);
		const packaged = read(brainstormContracts[1]);
		expect(packaged).not.toContain("lightweight tasks get 1-2 probes");
		expect(packaged).not.toContain("larger tasks may need 3-4");
		expect(packaged).not.toContain("one question at a time");
		expect(packaged).not.toContain(
			"Only use the `adversarial` mode when high-risk signals are present",
		);
	});

	test("Planner supplements Brainstorm without repeating its interview", () => {
		expectAll(plannerContracts, [
			"Clarification supplement",
			"omission, repository conflict, or invalidated assumption",
			"focused decision delta",
			"reopens multiple product branches",
			"Direct Planner entry",
			"ordinary technical choices",
			"return to `imm-brainstorm`",
			"Spec, Plan, or TaskIntent",
		]);
		for (const path of plannerContracts) {
			const contract = read(path);
			expect(contract).not.toContain("## Default exhaustive decision tree");
			expect(contract).not.toContain(
				"Ask the complete currently unblocked frontier",
			);
		}
	});

	test("Planner preserves upstream decisions and focused verification authority", () => {
		expectAll(plannerContracts, [
			"must not repeat, reopen, or rewrite confirmed decisions",
			"Direct Planner entry and Medium/High Design Risk work must inspect relevant ADRs and rejected Learnings",
			"Prefer the highest existing observable behavioral test seam and the fewest sufficient seams",
			"Cite relevant test prior art and explain how the selected seam catches the intended regression",
			"must not weaken acceptance-specific focused verification descriptors or add a mandatory user confirmation",
		]);
	});

	test("project contract files carry the current schema", () => {
		const agents = read("AGENTS.md");
		expect(agents).toContain("<!-- IMMUNE-BRAIN:START -->");
		expect(agents).toContain("<!-- IMMUNE-BRAIN:END -->");
		expect(readFileSync(join(ROOT, "CONTEXT.md"), "utf8")).toStartWith(
			"# Project Context",
		);
	});
});
