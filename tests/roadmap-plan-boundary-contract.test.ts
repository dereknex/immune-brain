import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(REPO_ROOT, path), "utf-8");

const PLANNER = read("plugins/immune-brain/dist/imm-planner.md");
const QUALITY_GATE = read("docs/reference/planning-quality-gate.md");
const PACKAGED_QUALITY_GATE = read(
	"plugins/immune-brain/dist/docs/reference/planning-quality-gate.md",
);
const CONTEXT = read("CONTEXT.md");
// Storage-layout cutover: the retired prose Plan template has been deleted;
// archived plans remain readable only through Git history and the parser.
// The template-vocabulary assertions below verify the parser compatibility
// fields live in the canonical contract instead of a deleted template.
const PLAN_TEMPLATE = read("docs/specs/imm-storage-layout-cutover.spec.md");

function expectAll(text: string, fragments: string[]) {
	for (const fragment of fragments) expect(text).toContain(fragment);
}

function expectNone(text: string, fragments: string[]) {
	for (const fragment of fragments) expect(text).not.toContain(fragment);
}

describe("Roadmap Plan boundary authoring contract", () => {
	it("keeps Plan granularity separate from outcome Step granularity", () => {
		expectAll(PLANNER, [
			"Plan Boundary Discipline",
			"Step granularity and Plan granularity are separate decisions",
			"authority, risk, verification, promotion, review, or rollback boundaries",
			"successor Plans instead of larger Steps",
			"Infrastructure that establishes an invariant should normally close and pass review before broad consumer rollout",
		]);

		expectAll(CONTEXT, [
			"**Plan boundary**:",
			"one coherent executable slice",
			"**Scope pressure**:",
			"semantic retain-or-split rationale",
		]);
	});

	it("retires unfollowable Roadmap-backed prose Plan instructions: v3 mutation retired, imm-plan is read-only, roadmap-slice is historical", () => {
		// Retirement markers must be present
		expectAll(PLANNER, [
			"v3 prose Plan mutation is retired",
			"read-only validator",
			"(historical — read-only)",
			"plan_core.ts",
		]);

		// Old instructive phrases that told agents to produce Roadmap-backed Plans must be gone
		expectNone(PLANNER, [
			"When a Spec contains a Roadmap or phase map and only part of it is ready to execute, add a current-slice banner to the Plan",
			"Add a coverage matrix for compound requirements",
			"New successor-ready slices may opt into `Plan contract: roadmap-slice/v1`",
			"Deferred roadmap phases must keep enough information for a future planner to continue without replaying the conversation",
			"Roadmap-backed Plans also record their executable boundary and deferred continuation",
		]);

		// CONTEXT still defines roadmap-family terms for parser compatibility, but marked historical (checked in vocabulary contract)
		expectAll(CONTEXT, [
			"**Successor candidate**:",
			"Zero or one stable Roadmap Phase",
			"does not create or validate a Plan",
		]);

		// The retired iteration-plan template is deleted; its vocabulary now
		// lives only in the archived plans it parsed. The spec owns the
		// storage-layout contract instead.
		expectAll(PLAN_TEMPLATE, [
			"# Immune-Brain Storage Layout Cutover",
			".imm/state/",
			".imm/audit/",
		]);
	});

	it("keeps scope pressure advisory and session lifecycle user-owned", () => {
		expectAll(PLANNER, [
			"file count, domain count, tokens, compactions, elapsed time, and review rounds are evidence for Planner reasoning, never universal workflow gates",
			"Session Lifecycle Ownership",
			"The user decides whether progression continues in the current session or a new session",
			"must not turn Plan boundaries, tokens, compactions, tool calls, elapsed time, or review rounds into automatic session creation, closure, or forced-stop policy",
		]);

		expectAll(QUALITY_GATE, [
			"scope-pressure reasoning",
			"semantic retain-or-split rationale",
			"successor authority",
			"session neutrality",
			"no planning field may force session creation or closure",
		]);

		expectAll(PLAN_TEMPLATE, [
			"one-release",
			"immediate successor release",
		]);
	});

	it("keeps the canonical and packaged quality gates synchronized", () => {
		expect(PACKAGED_QUALITY_GATE).toBe(QUALITY_GATE);
	});
});
