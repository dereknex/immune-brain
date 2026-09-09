import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (path: string) =>
	readFileSync(join(ROOT, path), "utf8").replace(/\s+/g, " ");

const brainstormContracts = [
	"plugins/immune-brain/dist/imm-brainstorm.md",
];
const brainstormLoader = "plugins/immune-brain/skills/imm-brainstorm/SKILL.md";
const plannerContracts = [
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
	test("the loader resolves the canonical contract and section routes", () => {
		const loader = read(brainstormLoader);
		expect(loader).toContain("../../dist/imm-brainstorm.md");
		expect(loader).toContain("Default clarification");
		expect(loader).toContain("roundtable");
		expect(loader).toContain("adversarial");
		expect(loader).not.toContain("Seed the fixed framing roots");
		// the common entry must not require every reference or mode
		expect(loader).not.toContain("brainstorm_ensemble");
		expect(loader).toContain("load a section's instructions only when its branch applies");
	});

	test("Brainstorm defaults to proportionate evidence-backed clarification", () => {
		expectAll(brainstormContracts, [
			"Default clarification",
			"current-goal branch",
			"user request, repository evidence, or a settled parent decision",
			"repository fact, a delegated technical choice, or a material user-owned decision",
			"complete currently unblocked frontier",
			"recommended answer",
			"bulk approval of all recommendations",
			"settle their decisions without another approval round",
			"frontier is empty",
			"BR-DEFER-*",
			"BR-Q-*",
		]);
		for (const path of brainstormContracts) {
			const contract = read(path);
			expect(contract).not.toContain("Do not use materiality");
			expect(contract).not.toContain("never complete the Brainstorm session by themselves");
			expect(contract).not.toContain("do not short-circuit its exhaustive traversal");
			expect(contract).not.toContain(
				"Before framing, scan `docs/solutions/` for entries with `rejected: true` frontmatter",
			);
		}
	});

	test("clear requests and unchanged bulk approvals can finish without another round", () => {
		expectAll(brainstormContracts, [
			"Direct requirements and adopted recommendations settle their decisions without another approval round",
			"ask again only for a newly evidenced material decision",
			"zero-question fast path",
			"Do not seed or expand a complete tree by default",
			"Do not ask the user to reconfirm decisions reflected without change",
			"explicit confirmation of only that decision delta",
		]);
	});

	test("exhaustive interrogation and analysis lenses require explicit selection", () => {
		expectAll(brainstormContracts, [
			"goal, beneficiary and scenario, current state, desired behavior",
			"failure and edge behavior, compatibility and migration",
			"Read this section only when the user explicitly requests thorough or exhaustive interrogation",
			"selecting a lens alone does not require it",
			"explicitly selected by the user",
			"on-demand rejected-decision evidence",
		]);
		const raw = readFileSync(join(ROOT, brainstormContracts[0]), "utf8");
		const defaultSection = raw.split("## Default clarification\n")[1].split("\n## ")[0];
		expect(defaultSection).not.toContain("Seed the fixed framing roots");
		const optIn = raw.split("## Explicit exhaustive interrogation\n")[1].split("\n## ")[0];
		expect(optIn).toContain("Seed the fixed framing roots");
		expect(optIn).toContain("Recompute the tree after every response");
		const packaged = read(brainstormContracts[0]);
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
			"TaskIntent",
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
			"Consult relevant ADRs and rejected Learnings only when an architectural decision, known historical constraint, or conflict with the existing design makes them relevant",
			"absent relevant history is not a planning blocker",
			"Prefer the highest existing observable behavioral test seam and the fewest sufficient seams",
			"Cite relevant test prior art and explain how the selected seam catches the intended regression",
			"must not weaken acceptance-specific focused verification descriptors or add a mandatory user confirmation",
		]);
		for (const path of plannerContracts) {
			expect(read(path)).not.toContain("Direct Planner entry and Medium/High Design Risk work must inspect");
		}
	});

	test("an independent local draft can continue while a dependent product decision is unanswered", () => {
		expectAll(plannerContracts, [
			"Finalization and dependent commitments are blocked until required `BR-Q-*` items are answered",
			"Independent investigation and explicitly unapproved alternative drafts may continue",
			"silence is not consent",
		]);
		expectAll(brainstormContracts, [
			"Independent framing may continue while a dependent subtree is blocked",
			"no required fact blocks the handoff",
		]);
	});

	test("project contract files carry the current schema", () => {
		const agents = read("AGENTS.md");
		expect(agents).toContain("规则优先级");
		expect(agents).toContain("## Skill 使用");
		expect(agents).toContain("Initiative carrier default: github");
		expect(agents).not.toContain("普通输入保持 host-native");
		expect(agents).not.toContain("Managed owner");
		expect(agents).not.toContain("TaskIntent");
		expect(agents).not.toContain("Kernel QA/Review");
		expect(agents).not.toContain(".imm");
		expect(agents).not.toContain("<!-- IMMUNE-BRAIN:START -->");
		expect(lstatSync(join(ROOT, "CLAUDE.md")).isSymbolicLink()).toBe(true);
		expect(readlinkSync(join(ROOT, "CLAUDE.md"))).toBe("AGENTS.md");
		const changeset = ".changeset/trim-agent-instruction-immune-rules.md";
		if (existsSync(join(ROOT, changeset))) {
			expect(read(changeset)).toContain(
				"Reduce Immune-Brain interference with unrelated Skills",
			);
		}
		expect(readFileSync(join(ROOT, "CONTEXT.md"), "utf8")).toStartWith(
			"# Project Context",
		);
	});
});
