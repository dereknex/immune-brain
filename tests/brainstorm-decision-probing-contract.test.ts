import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(REPO_ROOT, path), "utf-8");
const flat = (text: string) => text.replace(/\s+/g, " ");

const BRAINSTORM = read("plugins/immune-brain/dist/imm-brainstorm.md");
const COMPACT_BRAINSTORM = read(
	"plugins/immune-brain/skills/imm-brainstorm/SKILL.md",
);
const COMPOUNDER = read("plugins/immune-brain/dist/role-prompts/compounder.md");
const PLANNER = read("plugins/immune-brain/dist/imm-planner.md");
const HISTORY = read("docs/solutions/grill-me-interaction-mechanics-borrow.md");
const CONTRAST = read("docs/reference/mattpocock-skills-contrast.md");
const GENERAL_BENCHMARK = JSON.parse(
	read("tests/fixtures/immune-brain-benchmark.json"),
);
const FOCUSED_BENCHMARK_TEXT = read(
	"tests/fixtures/imm-brainstorm-behavior-benchmark.json",
);
const FOCUSED_BENCHMARK = JSON.parse(FOCUSED_BENCHMARK_TEXT);
const REJECTED_FIXTURE = read(
	"tests/fixtures/immune-brain-benchmark-workspace/docs/solutions/rejected-generic-dispatcher.md",
);

function frontmatter(text: string): string {
	const match = text.match(/^---\n([\s\S]*?)\n---/);
	if (!match) throw new Error("fixture must contain YAML frontmatter");
	return match[1];
}

describe("Brainstorm decision probing contracts", () => {
	it("makes Compounder produce evidence-backed reconsideration conditions", () => {
		for (const fragment of [
			"optional `reconsider_if` as a YAML `list<string>`",
			"use the list form even for one condition",
			"independently sufficient trigger (OR semantics)",
			"write them as one complete condition string",
			"Never invent a reconsideration condition",
			"If evidence cannot support one, omit `reconsider_if`.",
			"require no bulk backfill",
		]) {
			expect(COMPOUNDER).toContain(fragment);
		}
	});

	it("keeps the canonical rejected-decision fixture in list form", () => {
		const metadata = frontmatter(REJECTED_FIXTURE);

		expect(metadata).toContain("rejected: true");
		expect(metadata).toContain("rejection_reason:");
		expect(metadata).toMatch(/reconsider_if:\n(?: {2}- .+\n?)+/);
		expect(
			metadata.split("\n").find((line) => line.startsWith("reconsider_if:")),
		).toBe("reconsider_if:");
		expect(metadata.match(/^ {2}- /gm)).toHaveLength(4);
	});

	it("orders sourced probes through dependency-aware frontiers", () => {
		const brainstorm = flat(BRAINSTORM);
		for (const fragment of [
			"Every branch must trace to the current user request, repository evidence, or a settled parent decision",
			"Ask every independent question on the complete currently unblocked frontier together",
			"Hold downstream questions until their prerequisites are decided",
			"Number every question, include grounded options and one recommended answer",
			"Direct requirements and adopted recommendations settle only the current nodes",
			"Recompute the tree after every response",
			"Ask fewer questions only because dependencies keep downstream branches blocked",
			"never because of an arbitrary question budget",
		]) {
			expect(brainstorm).toContain(fragment);
		}
		expect(COMPACT_BRAINSTORM).toContain("current-goal branch");
		expect(COMPACT_BRAINSTORM).toContain(
			"never complete the Brainstorm session by themselves",
		);
		expect(BRAINSTORM).not.toContain("lightweight tasks get 1-2 probes");
		expect(BRAINSTORM).not.toContain("larger tasks may need 3-4");
	});

	it("consumes rejected-decision metadata only when a live branch reaches it", () => {
		for (const fragment of [
			"When a live branch resembles a rejected decision",
			"resolve its recorded reason and optional `reconsider_if` conditions through code/docs inspection before asking the user",
			"available evidence satisfies none",
			"if evidence satisfies one",
			"ask only for that concrete missing fact",
			"When `reconsider_if` is absent",
			"backwards-compatible",
			"When `rejection_reason` is absent",
			"without inventing a reason or reconsideration condition",
		]) {
			expect(BRAINSTORM).toContain(fragment);
		}
		expect(BRAINSTORM).toContain("on-demand rejected-decision evidence");
		expect(BRAINSTORM).not.toContain(
			"Before framing, scan `docs/solutions/` for entries with `rejected: true` frontmatter",
		);
	});

	it("preserves Brainstorm and Planner authority boundaries", () => {
		expect(BRAINSTORM).toContain("**Read-only by default**");
		expect(BRAINSTORM).toContain("complete currently unblocked frontier");
		expect(BRAINSTORM).toContain("zero-question fast path");
		expect(BRAINSTORM).toContain(
			"Ask every independent question on the complete currently unblocked frontier together",
		);
		expect(BRAINSTORM).toContain("recommended answer");
		expect(BRAINSTORM).not.toContain("Ask one question at a time");
		expect(PLANNER).toContain("Allowed");
		expect(PLANNER).toContain("`CONTEXT.md` at the repo root");
		expect(PLANNER).toContain("## Clarification supplement");
		expect(PLANNER).not.toContain("## Default exhaustive decision tree");
	});

	it("records the retired Preplan mechanics as migrated to Brainstorm", () => {
		expect(HISTORY).toContain("## Retirement update");
		expect(flat(HISTORY)).toContain(
			"These interaction mechanics now belong to `imm-brainstorm`",
		);
		expect(CONTRAST).toContain(
			"exhaustive clarification owner; `adversarial` is an explicit analysis lens",
		);
		expect(CONTRAST).not.toContain("IB 拆为 framing 和高压 gate");
	});

	it("keeps focused Brainstorm behavior scenarios separate from the general baseline", () => {
		const generalIds = GENERAL_BENCHMARK.scenarios.map(
			(scenario: { id: string }) => scenario.id,
		);
		const focusedIds = FOCUSED_BENCHMARK.scenarios.map(
			(scenario: { id: string }) => scenario.id,
		);

		expect(generalIds).toEqual([
			"entrypoint-routing",
			"multi-skill-follow-up",
			"host-native-mutation",
			"explicit-managed-boundary",
			"plugin-boundary",
		]);
		expect(focusedIds).toEqual([
			"dependent-frontier-blocks-downstream",
			"independent-complete-frontier",
			"scenario-qualified-frontier",
			"recommendation-adoption-continues",
			"rejected-decision-unmet-condition",
		]);
		expect(new Set(focusedIds).size).toBe(focusedIds.length);
		expect(focusedIds.some((id: string) => generalIds.includes(id))).toBe(
			false,
		);
		for (const legacyFragment of [
			"dependent-probe-single-question",
			"independent-probes-within-budget",
			"scenario-gap-replaces-probe",
			"lightweight probe budget",
			"exactly one narrowing question",
			"no more than two narrowing questions",
		]) {
			expect(FOCUSED_BENCHMARK_TEXT).not.toContain(legacyFragment);
		}
		expect(FOCUSED_BENCHMARK_TEXT).toContain(
			"Adopting recommendations closes only the current frontier nodes",
		);
		expect(FOCUSED_BENCHMARK.kind).toBe("pi-agent-benchmark");
		expect(FOCUSED_BENCHMARK.runner.type).toBe("pi-agent");
		expect(FOCUSED_BENCHMARK.runner.model).toBe("antigravity/gemini-3.6-flash");
		expect(FOCUSED_BENCHMARK.runner.parallel).toBe(true);
		expect(FOCUSED_BENCHMARK.metrics.required).toContain("advisory_metrics");
		expect(FOCUSED_BENCHMARK.metrics.cost).toBe("unavailable_by_host");
		expect(FOCUSED_BENCHMARK.workspace.sourcePath).toBe(
			"tests/fixtures/immune-brain-benchmark-workspace",
		);
		for (const scenario of FOCUSED_BENCHMARK.scenarios) {
			expect(scenario.successChecklist.length).toBeGreaterThanOrEqual(3);
			expect(scenario.userInput).toContain("Do not create or edit any files");
		}
	});
});
