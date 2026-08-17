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
const PLAN_TEMPLATE = read(".imm/templates/iteration-plan-template.md");

function expectAll(text: string, fragments: string[]) {
	for (const fragment of fragments) expect(text).toContain(fragment);
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

	it("documents one non-authoritative linear successor candidate", () => {
		expectAll(PLANNER, [
			"Plan contract: roadmap-slice/v1",
			"zero or one `Successor candidate`",
			"static, non-authoritative planning metadata",
			"does not create, validate, approve, activate, queue, or execute another Plan",
		]);

		expectAll(CONTEXT, [
			"**Successor candidate**:",
			"Zero or one stable Roadmap Phase",
			"does not create or validate a Plan",
		]);

		expectAll(PLAN_TEMPLATE, [
			"- Plan contract: <optional: roadmap-slice/v1",
			"- Current phase:",
			"- Plan boundary:",
			"- Boundary rationale:",
			"- Scope pressure:",
			"- Successor candidate:",
			"- Successor preconditions:",
			"- Current-slice warning:",
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
			"never a fixed workflow/session gate",
			"session 是否延续由用户决定",
		]);
	});

	it("keeps the canonical and packaged quality gates synchronized", () => {
		expect(PACKAGED_QUALITY_GATE).toBe(QUALITY_GATE);
	});
});
