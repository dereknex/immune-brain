import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(REPO_ROOT, path), "utf-8");

const BRAINSTORM = read("plugins/immune-brain/dist/imm-brainstorm.md");
const COMPOUNDER = read("plugins/immune-brain/dist/imm-compounder.md");
const PLANNER = read("plugins/immune-brain/dist/imm-planner.md");
const PREPLAN = read("plugins/immune-brain/dist/imm-brainstorm.md");
const GENERAL_BENCHMARK = JSON.parse(
	read("tests/fixtures/immune-brain-benchmark.json"),
);
const FOCUSED_BENCHMARK = JSON.parse(
	read("tests/fixtures/imm-brainstorm-behavior-benchmark.json"),
);
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
			"omit `reconsider_if` when evidence cannot support one",
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

	it("orders dependent probes without expanding the existing budget", () => {
		for (const fragment of [
			"scenario gap (would one concrete user or domain scenario distinguish unresolved behavior, ownership, lifecycle, or scope boundaries?)",
			"surface only the current highest-value blocking question",
			"unresolved probes are independent",
			"within the existing scale-adjusted budget",
			"replaces a lower-value probe inside the existing budget",
			"never increases the question count",
			"must not be forced when framing is already concrete",
			"not a second full serial Grill Mode",
		]) {
			expect(BRAINSTORM).toContain(fragment);
		}
	});

	it("consumes rejected-decision metadata through explicit compatibility branches", () => {
		for (const fragment of [
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
	});

	it("preserves Brainstorm, Planner, and Preplan authority boundaries", () => {
		expect(BRAINSTORM).toContain("**Read-only by default**");
		expect(BRAINSTORM).toContain("lightweight tasks get 1-2 probes at most");
		expect(BRAINSTORM).toContain("larger tasks may need 3-4");
		expect(PLANNER).toContain("Allowed");
		expect(PLANNER).toContain("`CONTEXT.md` at the repo root");
		expect(PREPLAN).toContain("Ask one question at a time");
		expect(PREPLAN).toContain("provide a recommended answer");
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
			"managed-default-mutation",
			"hard-risk-managed-boundary",
			"plugin-boundary",
		]);
		expect(focusedIds).toEqual([
			"dependent-probe-single-question",
			"independent-probes-within-budget",
			"scenario-gap-replaces-probe",
			"clear-frame-no-forced-scenario",
			"rejected-decision-unmet-condition",
		]);
		expect(focusedIds.some((id: string) => generalIds.includes(id))).toBe(
			false,
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
