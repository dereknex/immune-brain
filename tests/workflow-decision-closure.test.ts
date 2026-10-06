// S1 of docs/specs/workflow-decision-closure.spec.md: relevant decision
// traversal and conserved Planner handoff.
//
// Two layers, both required by the S1 acceptance:
//   1. the canonical Brainstorm/Planner contracts carry the four closing states,
//      the zero-question coverage check, and the outcome-conservation rule;
//   2. the handoff completeness check named by that contract is decisive: the
//      generalized integration-to-CLI and prototype-first-to-prototype-only
//      counterexamples fail it, and an unchanged clear request does not acquire
//      an extra confirmation.
//
// The checker below is the focused executable seam for the documented rule. It
// is a contract check over supplied planning data; it is not a second decision
// engine, scheduler, or store.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const flat = (text: string) => text.replace(/\s+/g, " ");

const BRAINSTORM = read("plugins/immune-brain/dist/imm-brainstorm.md");
const PLANNER = read("plugins/immune-brain/dist/imm-planner.md");
const COMPACT_BRAINSTORM = read("plugins/immune-brain/skills/imm-brainstorm/SKILL.md");
const COMPACT_PLANNER = read("plugins/immune-brain/skills/imm-planner/SKILL.md");
const BENCHMARK_PATH = "tests/fixtures/imm-brainstorm-behavior-benchmark.json";
const BENCHMARK_TEXT = read(BENCHMARK_PATH);
const BENCHMARK = JSON.parse(BENCHMARK_TEXT);

/**
 * The four closing states a sourced branch may end in. `out` and `deferred`
 * are recorded decisions, so both require a reason; there is no fifth state.
 */
type BranchClosing = "covered" | "decisioned" | "deferred" | "out";

interface HandoffMapping {
	/** Upstream manifest item or required phase identifier. */
	item: string;
	closing: BranchClosing;
	/** Required for `out` and `deferred`; a silent omission is a failure. */
	reason?: string;
}

interface HandoffPlan {
	/** Every phase the confirmed outcome needs; each one must be delivered. */
	requiredPhases: string[];
	/** Phases the plan actually delivers. */
	deliveredPhases: string[];
	mappings: HandoffMapping[];
}

const REASON_REQUIRED: ReadonlySet<BranchClosing> = new Set(["out", "deferred"]);

/**
 * The handoff completeness check: map every upstream item AND every required
 * phase exactly once, and reject a plan that conserves a smaller deliverable
 * than the confirmed outcome. Both counterexamples named by the S1 contract are
 * ordinary inputs here — a required phase that is not delivered is a
 * conservation failure, whatever label the plan puts on it. A delivered phase
 * still needs its own mapping: delivering it is not the same as accounting for
 * it in the closed-world manifest check.
 *
 * An `out`/`deferred` reason excuses an *upstream manifest item* only. It never
 * excuses a `requiredPhases` entry: those entries are the confirmed outcome
 * itself, so a reason cannot drop one. A genuine reduction changes what the user
 * confirmed and returns to Brainstorm, after which the phase is no longer
 * required at all — a reason attached to a still-required phase is exactly the
 * silent narrowing this check exists to reject.
 */
function checkHandoffCompleteness(
	plan: HandoffPlan,
	requiredItems: readonly string[],
): { ok: boolean; failures: string[] } {
	const failures: string[] = [];
	const closings = new Map<string, number>();
	for (const mapping of plan.mappings) {
		closings.set(mapping.item, (closings.get(mapping.item) ?? 0) + 1);
		if (REASON_REQUIRED.has(mapping.closing) && !mapping.reason?.trim()) {
			failures.push(`silent omission: ${mapping.item} closes as ${mapping.closing} without a reason`);
		}
	}
	for (const [item, count] of closings) {
		if (count > 1) failures.push(`duplicate mapping: ${item} is mapped ${count} times`);
	}
	const delivered = new Set(plan.deliveredPhases);
	// One union: an upstream item and a required phase are equally part of the
	// closed-world check, so a delivered-but-unmapped phase is still unmapped.
	for (const item of new Set([...requiredItems, ...plan.requiredPhases])) {
		if (!closings.has(item)) failures.push(`unmapped upstream item: ${item}`);
	}
	for (const phase of plan.requiredPhases) {
		if (delivered.has(phase)) continue;
		failures.push(`conservation failure: required phase ${phase} is not delivered`);
	}
	return { ok: failures.length === 0, failures };
}

describe("S1 relevant traversal and conserved handoff", () => {
	test("Brainstorm closes every sourced branch into one of four states", () => {
		const contract = flat(BRAINSTORM);
		for (const fragment of [
			"Every sourced branch closes as resolved, explicitly excluded, explicitly deferred, or dependent-blocked with its blocking prerequisite named",
			"Coverage is complete when every sourced branch carries exactly one of those four states",
			"no branch is dropped for being inconvenient, expensive, or downstream",
			"Exhaustive-interview mode changes interview breadth, never this coverage",
			"A clear zero-question request performs the same coverage check over the request, repository evidence, and confirmed parent decisions before it hands off",
			"**Relevant Coverage**: Traverse every sourced branch",
			"a dependent-blocked branch stays open instead of being asked early or silently omitted",
			"Coverage is a property of the traversal, not of the question count",
		]) {
			expect(contract).toContain(fragment);
		}
		// Coverage is additive to the existing proportionate-clarification rules.
		expect(contract).toContain("zero-question fast path");
		expect(contract).toContain("bulk approval of all recommendations");
		expect(contract).toContain("do not invent speculative future needs");
		expect(contract).toContain("Independent framing may continue while a dependent subtree is blocked");
	});

	test("Brainstorm keeps a confirmed outcome from becoming a smaller deliverable", () => {
		const contract = flat(BRAINSTORM);
		for (const fragment of [
			"Do not narrow a confirmed outcome into a smaller deliverable",
			"is not satisfied by",
			"is not a scope reduction such as",
			"integration-to-CLI or prototype-first-to-prototype-only narrowing presented as the complete result is a conservation failure",
			"the handoff completeness check rejects it instead of accepting the smaller deliverable",
		]) {
			expect(contract).toContain(fragment);
		}
	});

	test("Planner runs one handoff completeness check and reports the remaining gap", () => {
		const contract = flat(PLANNER);
		for (const fragment of [
			"run one handoff completeness check over the closed-world manifest",
			"map every upstream item and every required phase exactly once, report each Slice's closable result plus the remaining gap, and confirm the complete confirmed outcome and its phases are actually delivered",
			"Upstream items close as covered, decisioned, deferred, or out with a reason",
			"A reason excuses an upstream item, never a still-required phase",
			"The check fails, and the candidate is not handoff-ready, when a required phase or upstream item has no mapping, or when the plan conserves a smaller deliverable than the confirmed outcome",
			"a confirmed full integration presented as one pairwise CLI, or a `prototype first` dependency presented as `prototype only`",
			"Coverage is independent of question count, so a clear request and an already-confirmed decision still pass the same check without acquiring an extra confirmation",
			"**Outcome Conservation**: The plan conserves the complete confirmed outcome and its required phases",
			"**Handoff Completeness Check**: Before reporting a candidate as handoff-ready",
			"The handoff completeness check passed while a required phase or upstream item is unmapped, or while the plan delivers only part of the confirmed outcome",
			"**Conservation failure**: a full integration is not a pairwise CLI and `prototype first` is not `prototype only`",
		]) {
			expect(contract).toContain(fragment);
		}
		// The check is a guard, not an extra gate.
		expect(contract).toContain("add a mandatory user confirmation");
		expect(contract).toContain("must not weaken acceptance-specific focused verification descriptors");
	});

	test("Planner names one source per decision and rejects an unsourced user-owned one", () => {
		const contract = flat(PLANNER);
		for (const fragment of [
			"**Decision Provenance**: Every Spec decision and every acceptance names exactly one source",
			"an upstream `BR-*` ID, repository evidence with a concrete path, or a delegated technical choice",
			"The rule applies with or without an upstream Brainstorm manifest",
			"that names no source is a defect the Planner removes or returns for clarification",
			"A user-owned Spec decision or acceptance names no source",
		]) {
			expect(contract).toContain(fragment);
		}
		// Negative control: provenance is not a `BR-DEC`-only rule, and both
		// pre-existing legitimate sources keep working.
		expect(contract).toContain("the source does not have to be a `BR-DEC` item");
		expect(contract).toContain("Direct Planner entry and delegated technical choices stay legitimate sources");
		expect(contract).toContain(
			"**Planning Bootstrap**: When no upstream `imm-brainstorm` manifest exists, preserve Direct Planner entry",
		);
		expect(contract).toContain(
			"Simple TaskIntent-only work satisfies the rule when each acceptance traces to the request text and adds no table",
		);
	});

	test("both section-route loaders carry the closure and conservation constraints", () => {
		for (const loader of [COMPACT_BRAINSTORM, COMPACT_PLANNER]) {
			expect(loader).toContain("../../dist/imm-");
			expect(loader).not.toMatch(/^## /m);
		}
		expect(flat(COMPACT_BRAINSTORM)).toContain(
			"Every sourced branch closes as resolved, explicitly excluded, explicitly deferred, or dependent-blocked",
		);
		expect(flat(COMPACT_BRAINSTORM)).toContain(
			"a confirmed outcome is never conserved as a smaller deliverable",
		);
		expect(flat(COMPACT_PLANNER)).toContain(
			"Before handoff it maps every upstream item and required phase exactly once",
		);
		expect(flat(COMPACT_PLANNER)).toContain(
			"reject a plan that conserved only part of the confirmed outcome",
		);
		// The loader lists mandatory constraints, so provenance gets one line.
		expect(flat(COMPACT_PLANNER)).toContain(
			"Every Spec decision and every acceptance names exactly one source",
		);
	});

	test("the generalized integration-to-CLI counterexample fails the completeness check", () => {
		const result = checkHandoffCompleteness(
			{
				requiredPhases: ["full-provider-integration"],
				deliveredPhases: ["pairwise-cli"],
				mappings: [
					{ item: "BR-REQ-1", closing: "covered" },
					{ item: "full-provider-integration", closing: "covered" },
				],
			},
			["BR-REQ-1"],
		);
		expect(result.ok).toBe(false);
		expect(result.failures.join("\n")).toContain(
			"conservation failure: required phase full-provider-integration is not delivered",
		);
	});

	test("the prototype-first-to-prototype-only counterexample fails the completeness check", () => {
		const result = checkHandoffCompleteness(
			{
				requiredPhases: ["prototype", "full-app"],
				deliveredPhases: ["prototype"],
				mappings: [
					{ item: "BR-REQ-2", closing: "covered" },
					{ item: "prototype", closing: "covered" },
					{ item: "full-app", closing: "covered" },
				],
			},
			["BR-REQ-2"],
		);
		expect(result.ok).toBe(false);
		expect(result.failures.join("\n")).toContain("conservation failure: required phase full-app");
	});

	test("a delivered but unmapped required phase still fails the completeness check", () => {
		const result = checkHandoffCompleteness(
			{
				requiredPhases: ["prototype", "full-app"],
				deliveredPhases: ["prototype", "full-app"],
				mappings: [{ item: "BR-REQ-1", closing: "covered" }],
			},
			["BR-REQ-1"],
		);
		expect(result.ok).toBe(false);
		expect(result.failures.sort()).toEqual([
			"unmapped upstream item: full-app",
			"unmapped upstream item: prototype",
		]);
	});

	test("a reason cannot excuse an undelivered required phase", () => {
		// The S1 contract's counterexamples, each dressed up with a plausible
		// reason: a reason excuses an upstream manifest item, never a phase the
		// confirmed outcome still requires.
		for (const closing of ["out", "deferred"] as const) {
			const integration = checkHandoffCompleteness(
				{
					requiredPhases: ["full-provider-integration"],
					deliveredPhases: ["pairwise-cli"],
					mappings: [
						{ item: "BR-REQ-1", closing: "covered" },
						{ item: "full-provider-integration", closing, reason: "the CLI is enough for this handoff" },
					],
				},
				["BR-REQ-1"],
			);
			expect(integration.ok).toBe(false);
			expect(integration.failures.join("\n")).toContain(
				"conservation failure: required phase full-provider-integration is not delivered",
			);

			const prototype = checkHandoffCompleteness(
				{
					requiredPhases: ["prototype", "full-app"],
					deliveredPhases: ["prototype"],
					mappings: [
						{ item: "BR-REQ-2", closing: "covered" },
						{ item: "prototype", closing: "covered" },
						{ item: "full-app", closing, reason: "prototype is sufficient for this handoff" },
					],
				},
				["BR-REQ-2"],
			);
			expect(prototype.ok).toBe(false);
			expect(prototype.failures.join("\n")).toContain(
				"conservation failure: required phase full-app is not delivered",
			);
		}
	});

	test("a conserved outcome, a reasoned exclusion, and dependency order all pass", () => {
		const conserved = checkHandoffCompleteness(
			{
				requiredPhases: ["prototype", "full-app"],
				deliveredPhases: ["prototype", "full-app"],
				mappings: [
					{ item: "BR-REQ-1", closing: "covered" },
					{ item: "BR-DEC-1", closing: "decisioned" },
					{ item: "BR-DEFER-1", closing: "deferred", reason: "declared out of the current scope by the user" },
					{ item: "BR-OUT-1", closing: "out", reason: "recorded non-goal" },
					{ item: "prototype", closing: "covered" },
					{ item: "full-app", closing: "covered" },
				],
			},
			["BR-REQ-1", "BR-DEC-1", "BR-DEFER-1", "BR-OUT-1"],
		);
		expect(conserved.failures).toEqual([]);
		expect(conserved.ok).toBe(true);

		// Sequence-only reduction is not a conservation failure.
		const staged = checkHandoffCompleteness(
			{
				requiredPhases: ["prototype", "full-app"],
				deliveredPhases: ["prototype", "full-app"],
				mappings: [
					{ item: "BR-REQ-1", closing: "covered" },
					{ item: "prototype", closing: "covered" },
					{ item: "full-app", closing: "covered" },
				],
			},
			["BR-REQ-1"],
		);
		expect(staged.ok).toBe(true);
	});

	test("an unmapped item or an unreasoned exclusion fails the completeness check", () => {
		const unmapped = checkHandoffCompleteness(
			{ requiredPhases: [], deliveredPhases: [], mappings: [] },
			["BR-REQ-9"],
		);
		expect(unmapped.failures).toEqual(["unmapped upstream item: BR-REQ-9"]);

		const silent = checkHandoffCompleteness(
			{
				requiredPhases: [],
				deliveredPhases: [],
				mappings: [{ item: "BR-OUT-1", closing: "out" }],
			},
			["BR-OUT-1"],
		);
		expect(silent.failures.join("\n")).toContain("silent omission");

		const duplicated = checkHandoffCompleteness(
			{
				requiredPhases: [],
				deliveredPhases: [],
				mappings: [
					{ item: "BR-REQ-1", closing: "covered" },
					{ item: "BR-REQ-1", closing: "decisioned" },
				],
			},
			["BR-REQ-1"],
		);
		expect(duplicated.failures.join("\n")).toContain("duplicate mapping");
	});

	test("the sanitized multi-turn fixture carries both decision-closure scenarios", () => {
		const scenarios = BENCHMARK.scenarios as Array<{
			id: string;
			userInput: string;
			turns?: Array<{ role: string; content: string }>;
			successChecklist: string[];
		}>;
		const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));

		const coverage = byId.get("multi-turn-relevant-coverage-complete");
		expect(coverage).toBeDefined();
		expect(coverage!.turns?.length ?? 0).toBeGreaterThanOrEqual(2);
		expect(coverage!.turns![0].content).toBe(coverage!.userInput);
		expect(coverage!.successChecklist.length).toBeGreaterThanOrEqual(3);
		expect([coverage!.userInput, ...coverage!.successChecklist].join("\n")).toContain(
			"dependent-blocked",
		);

		const conserved = byId.get("full-outcome-conserved-not-narrowed");
		expect(conserved).toBeDefined();
		expect(conserved!.turns?.length ?? 0).toBeGreaterThanOrEqual(2);
		expect(conserved!.successChecklist.length).toBeGreaterThanOrEqual(3);
		const conservedText = [conserved!.userInput, ...conserved!.successChecklist].join("\n");
		expect(conservedText).toContain("prototype only");
		expect(conservedText).toContain("conservation failure");

		// Sanitized fixture: no model call, no provider routing, no private data.
		for (const scenario of [coverage!, conserved!]) {
			expect(scenario.userInput).toContain("Do not create or edit any files");
			for (const turn of scenario.turns ?? []) {
				expect(["user", "assistant"]).toContain(turn.role);
				expect(turn.content.trim().length).toBeGreaterThan(0);
			}
		}
		expect(BENCHMARK_TEXT).not.toMatch(/sk-[A-Za-z0-9]/);
		expect(BENCHMARK_TEXT).not.toMatch(/\/Users\//);
		expect(BENCHMARK.runner.type).toBe("pi-agent");
	});
});
