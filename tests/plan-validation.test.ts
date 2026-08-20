import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
	deriveOriginCoverage,
	projectPlanValidation,
	parsePlan,
	normalizePlan,
	buildPlanSignature,
	validatePlan,
	parseDependsOn,
	parseBrainstormManifestItems,
	parseDiscoveryCache,
	parseParallelProbes,
	workflowProfileForTask,
	compounderPolicyForTask,
	type PlanValidationError,
} from "../plugins/immune-brain/runtime/plan_core";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// REFERENCE_SIGNATURE below is a frozen cross-runtime parity constant, and the
// payload it covers includes this plan's Spec reference. The reference points at
// docs/specs/opencode-native-plugin.spec.md, which now lives under
// docs/specs/archive/. Leave it: rewriting it to the archive path changes the
// signature. This plan is the one archived plan excluded from that rewrite.
const MIGRATION_PLAN = resolve(
	REPO_ROOT,
	"docs/plans/archive/2026-06-29-001-feat-bun-typescript-runtime-migration-plan.md",
);
const TS_RUNTIME = resolve(
	REPO_ROOT,
	"plugins/immune-brain/runtime/v4_runtime.ts",
);

function writeFixturePlan(markdown: string): string {
	const root = mkdtempSync(join(tmpdir(), "imm-plan-validation-"));
	const path = join(root, "plan.md");
	writeFileSync(path, markdown);
	return path;
}

function writeFixtureWithSpec(spec?: string): string {
	const root = mkdtempSync(join(tmpdir(), "imm-plan-design-validation-"));
	const planDir = join(root, "docs", "plans");
	const specDir = join(root, "docs", "specs");
	mkdirSync(planDir, { recursive: true });
	mkdirSync(specDir, { recursive: true });
	if (spec !== undefined) writeFileSync(join(specDir, "fixture.spec.md"), spec);
	const plan = BASE_PLAN.replace(
		"- Summary: Fixture plan",
		"- Summary: Fixture plan\n- Spec: `docs/specs/fixture.spec.md`",
	);
	const path = join(planDir, "fixture-plan.md");
	writeFileSync(path, plan);
	return path;
}

const BASE_PLAN = `# Iteration Plan

## Task

- Summary: Fixture plan

## Steps

### Step 1

- Step ID: U1
- Result: Fixture outcome
- Verification: \`true\`
`;

// Reference values captured from Python `imm_core.plan_runtime` against the same plan.
const REFERENCE_SIGNATURE =
	"e89bf7809875d215c2ca0275c8f6e86e024dd451934fdc04d8e4a422bbd03a6c";

describe("plan validation parity", () => {
	it("parses the migration plan with matching summary and step count", () => {
		const parsed = parsePlan(MIGRATION_PLAN);
		expect(parsed.summary).toBe(
			"Migrate Immune-Brain production host runtime from Python to Bun + TypeScript across OpenCode, Cursor, Codex, and Claude, using Python only as a temporary parity reference.",
		);
		expect(parsed.steps.length).toBe(4);
		expect(parsed.steps[0].step_id).toBe("U1");
		expect(parsed.steps[0].result).toBe(
			"TypeScript runtime parity harness covers the public runtime contract",
		);
		expect(parsed.steps[1].depends_on).toEqual([1]);
		expect(parsed.steps[0].discovery_cache.length).toBe(3);
		expect(parsed.steps[0].parallel_probes.length).toBe(3);
	});

	it("produces the same plan signature as the Python reference", () => {
		const parsed = parsePlan(MIGRATION_PLAN);
		const normalized = normalizePlan(parsed, REPO_ROOT);
		const sig = buildPlanSignature(normalized);
		expect(sig).toBe(REFERENCE_SIGNATURE);
		expect(sig.length).toBe(64);
	});

	it("validates the migration plan with no errors", () => {
		const parsed = parsePlan(MIGRATION_PLAN);
		const { errors } = validatePlan(parsed);
		expect(errors).toEqual([]);
	});

	it("defaults legacy Plans to strict workflow semantics", () => {
		const parsed = parsePlan(writeFixturePlan(BASE_PLAN));
		expect(workflowProfileForTask(parsed.task)).toBe("strict");
		expect(compounderPolicyForTask(parsed.task)).toBe("required");
		expect(validatePlan(parsed).errors).toEqual([]);
	});

	it("accepts an explicit standard profile with automated verification", () => {
		const parsed = parsePlan(
			writeFixturePlan(
				BASE_PLAN.replace(
					"- Summary: Fixture plan",
					"- Summary: Fixture plan\n- Workflow profile: standard\n- Compounder: optional",
				),
			),
		);
		expect(workflowProfileForTask(parsed.task)).toBe("standard");
		expect(compounderPolicyForTask(parsed.task)).toBe("optional");
		expect(validatePlan(parsed).errors).toEqual([]);
	});

	it("rejects Direct Path and unknown managed profiles", () => {
		for (const profile of ["direct", "turbo"]) {
			const parsed = parsePlan(
				writeFixturePlan(
					BASE_PLAN.replace(
						"- Summary: Fixture plan",
						`- Summary: Fixture plan\n- Workflow profile: ${profile}`,
					),
				),
			);
			expect(validatePlan(parsed).errors).toContain(
				"Workflow profile must be standard or strict; Direct Path does not use a Plan.",
			);
		}
	});

	it("requires automated verification for standard Plans", () => {
		const parsed = parsePlan(
			writeFixturePlan(
				BASE_PLAN.replace(
					"- Summary: Fixture plan",
					"- Summary: Fixture plan\n- Workflow profile: standard",
				).replace("- Verification: `true`", "- Verification: Inspect manually"),
			),
		);
		expect(validatePlan(parsed).errors).toContain(
			"Standard workflow profile requires automated Verification for Step 1.",
		);
	});

	it("rejects optional Compounder for strict Plans", () => {
		const parsed = parsePlan(
			writeFixturePlan(
				BASE_PLAN.replace(
					"- Summary: Fixture plan",
					"- Summary: Fixture plan\n- Workflow profile: strict\n- Compounder: optional",
				),
			),
		);
		expect(validatePlan(parsed).errors).toContain(
			"Strict workflow profile requires Compounder: required.",
		);
	});

	it("normalizes Depends on Step ID references", () => {
		expect(parseDependsOn("U1, 2")).toEqual([1, 2]);
		expect(() => parseDependsOn("step-one")).toThrow(
			"Use a step number like 1 or a Step ID like U1",
		);
	});

	it("does not reject natural Chinese result punctuation", () => {
		const parsed = parsePlan(MIGRATION_PLAN);
		parsed.steps[0].result = "Runtime 接口支持 help、flags 以及 JSON evidence";
		const { errors } = validatePlan(parsed);
		expect(errors.filter((e) => e.includes("multi-result marker"))).toEqual([]);
	});

	it("derives closed-world origin coverage without polluting normalized Plan fields", () => {
		const planPath = writeFixturePlan(
			BASE_PLAN.replace(
				"- Summary: Fixture plan",
				"- Summary: Fixture plan\n- Brainstorm manifest: BR-REQ-001; BR-DEFER-001; BR-OUT-001",
			).replace(
				"## Steps",
				`## Brainstorm Trace

| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-001 | covered_by_step | U1 | |
| BR-DEFER-001 | deferred | successor | Later boundary |
| BR-OUT-001 | out_of_scope | non-goal | |

## Steps`,
			),
		);
		const parsed = parsePlan(planPath);
		expect(deriveOriginCoverage(parsed)).toEqual({
			applicable: true,
			declared_items: 3,
			mapped_items: 3,
			unmapped_items: 0,
			reason_required_without_reason: 1,
			deferred_or_out_of_scope_without_reason: 1,
			complete: false,
		});
		const projected = projectPlanValidation(planPath, dirname(planPath));
		expect(projected.origin_coverage.complete).toBe(false);
		expect(projected.steps).toHaveLength(1);
	});

	it("reports historical Plans without a manifest as not applicable", () => {
		const planPath = writeFixturePlan(BASE_PLAN);
		expect(
			projectPlanValidation(planPath, dirname(planPath)).origin_coverage,
		).toEqual({
			applicable: false,
			declared_items: 0,
			mapped_items: 0,
			unmapped_items: 0,
			reason_required_without_reason: 0,
			deferred_or_out_of_scope_without_reason: 0,
			complete: true,
		});
	});

	it("counts unmapped manifest IDs and all reason-required statuses", () => {
		const parsed = parsePlan(
			writeFixturePlan(
				BASE_PLAN.replace(
					"- Summary: Fixture plan",
					"- Summary: Fixture plan\n- Brainstorm manifest: BR-REQ-001; BR-REQ-002; BR-REQ-003; BR-REQ-004",
				).replace(
					"## Steps",
					`## Brainstorm Trace

| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-001 | partially_covered | U1 | |
| BR-REQ-002 | deferred | successor | |
| BR-REQ-003 | out_of_scope | non-goal | |

## Steps`,
				),
			),
		);
		expect(deriveOriginCoverage(parsed)).toMatchObject({
			declared_items: 4,
			mapped_items: 3,
			unmapped_items: 1,
			reason_required_without_reason: 3,
			deferred_or_out_of_scope_without_reason: 3,
			complete: false,
		});
	});

	it("rejects semantically invalid Plans through the pure projection", () => {
		const planPath = writeFixturePlan(
			BASE_PLAN.replace("- Verification: `true`", ""),
		);
		expect(() => projectPlanValidation(planPath, dirname(planPath))).toThrow(
			"Plan validation failed",
		);
	});

	it("parses brainstorm manifest items with semicolon and comma separators", () => {
		expect(
			parseBrainstormManifestItems("BR-REQ-001; BR-REQ-002, BR-DEC-001"),
		).toEqual(["BR-REQ-001", "BR-REQ-002", "BR-DEC-001"]);
	});

	it("parses discovery cache entries in path (reason) format", () => {
		expect(
			parseDiscoveryCache(
				"path/to/file.py (reason one); other.md (reason two)",
			),
		).toEqual([
			{ path: "path/to/file.py", reason: "reason one" },
			{ path: "other.md", reason: "reason two" },
		]);
	});

	it("parses parallel probes from key=value pairs", () => {
		expect(
			parseParallelProbes(
				"scope=a.py,output=foo,readonly=true; scope=b.py,output=bar,readonly=true",
			),
		).toEqual([
			{ scope: "a.py", output: "foo", readonly: true },
			{ scope: "b.py", output: "bar", readonly: true },
		]);
	});

	it("rejects discovery cache entries without reason", () => {
		expect(() => parseDiscoveryCache("path-without-reason")).toThrow();
	});

	it("rejects parallel probes without readonly: true", () => {
		expect(() =>
			parseParallelProbes("scope=a.py,output=foo,readonly=false"),
		).toThrow();
	});

	it("accepts declared medium-risk design with a required Mermaid diagram", () => {
		const parsed = parsePlan(
			writeFixtureWithSpec(`# Spec

**Design risk**: Medium
**Diagram decision**: required
**Diagram reason**: The cross-module data flow needs a diagram.

## Technical Design

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`
`),
		);

		expect(validatePlan(parsed)).toEqual({ errors: [], warnings: [] });
	});

	it("rejects declared medium-risk design without Technical Design", () => {
		const parsed = parsePlan(
			writeFixtureWithSpec(`# Spec

**Design risk**: Medium
**Diagram decision**: not_required
**Diagram reason**: Prose fully describes the local contract.
`),
		);

		expect(validatePlan(parsed).errors).toContain(
			"Referenced medium-risk Spec is missing a Technical Design section.",
		);
	});

	it("rejects required diagram decisions without Mermaid", () => {
		const parsed = parsePlan(
			writeFixtureWithSpec(`# Spec

**Design risk**: High
**Diagram decision**: required
**Diagram reason**: The state transition needs a diagram.

## Technical Design
`),
		);

		expect(validatePlan(parsed).errors).toContain(
			"Referenced Spec requires a Mermaid diagram but does not contain one.",
		);
	});

	it("rejects standard workflow for High-risk Specs", () => {
		const path = writeFixtureWithSpec(`# Spec

**Design risk**: High
**Diagram decision**: not_required
**Diagram reason**: The state transition is fully described in prose.

## Technical Design

One bounded transition.
`);
		const markdown = readFileSync(path, "utf8");
		writeFileSync(
			path,
			markdown.replace(
				"- Summary: Fixture plan",
				"- Summary: Fixture plan\n- Workflow profile: standard",
			),
		);
		const parsed = parsePlan(path);
		expect(validatePlan(parsed).errors).toContain(
			"High-risk Specs require Workflow profile: strict.",
		);
	});

	it("rejects diagram decisions without a reason", () => {
		const parsed = parsePlan(
			writeFixtureWithSpec(`# Spec

**Design risk**: Low
**Diagram decision**: not_required
`),
		);

		expect(validatePlan(parsed).errors).toContain(
			"Referenced Spec is missing Diagram reason.",
		);
	});

	it("rejects missing referenced Specs", () => {
		const parsed = parsePlan(writeFixtureWithSpec());

		expect(validatePlan(parsed).errors[0]).toContain(
			"Referenced Spec does not exist:",
		);
	});

	it("does not accept Mermaid outside Technical Design", () => {
		const parsed = parsePlan(
			writeFixtureWithSpec(`# Spec

**Design risk**: High
**Diagram decision**: required
**Diagram reason**: The state transition needs a diagram.

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

## Technical Design

Prose only.
`),
		);

		expect(validatePlan(parsed).errors).toContain(
			"Referenced Spec requires a Mermaid diagram but does not contain one.",
		);
	});

	it("ignores design metadata examples inside code fences", () => {
		const parsed = parsePlan(
			writeFixtureWithSpec(`# Legacy Spec

\`\`\`md
**Design risk**: High
**Diagram decision**: required
**Diagram reason**: Example only.
\`\`\`
`),
		);

		expect(validatePlan(parsed).warnings).toContainEqual(
			expect.objectContaining({
				code: "spec_design_metadata_missing",
			}),
		);
	});

	it("keeps legacy Specs compatible with an actionable warning", () => {
		const parsed = parsePlan(writeFixtureWithSpec("# Legacy Spec\n"));

		expect(validatePlan(parsed).warnings).toContainEqual(
			expect.objectContaining({
				code: "spec_design_metadata_missing",
				field: "design_metadata",
			}),
		);
	});

	it("warns when three-phase Roadmaps omit or empty acceptance criteria", () => {
		const parsed = parsePlan(
			writeFixturePlan(`${BASE_PLAN}
## Roadmap

### Phase 1

- promotion_criteria: API is available

### Phase 2

- acceptance_criteria:
- promotion_criteria: Reviewer approves

### Phase 3

- acceptance_criteria: The export button produces a CSV
- promotion_criteria: Stakeholder approves
`),
		);
		const validation = validatePlan(parsed);

		expect(validation.errors).toEqual([]);
		expect(validation.warnings).toContainEqual(
			expect.objectContaining({
				code: "roadmap_acceptance_criteria_missing",
				phase: "Phase 1",
				field: "acceptance_criteria",
			}),
		);
		expect(validation.warnings).toContainEqual(
			expect.objectContaining({
				code: "roadmap_acceptance_criteria_empty",
				phase: "Phase 2",
				field: "acceptance_criteria",
			}),
		);
	});

	it("keeps one-phase and two-phase Roadmaps warning-free without criteria", () => {
		const parsed = parsePlan(
			writeFixturePlan(`${BASE_PLAN}
## Roadmap

### Phase 1

- goal: Alpha

### Phase 2

- goal: Beta
`),
		);

		expect(validatePlan(parsed).warnings).toEqual([]);
	});

	it("reports non-behavioral acceptance criteria separately from promotion criteria", () => {
		const parsed = parsePlan(
			writeFixturePlan(`${BASE_PLAN}
## Roadmap

### Phase 1

- acceptance_criteria: implementation complete

### Phase 2

- acceptance_criteria: User can export the visible table
- promotion_criteria: API is available

### Phase 3

- acceptance_criteria: User sees a success message
- promotion_criteria:
`),
		);
		const validation = validatePlan(parsed);

		expect(validation.warnings).toContainEqual(
			expect.objectContaining({
				code: "roadmap_acceptance_criteria_non_behavioral",
				phase: "Phase 1",
				field: "acceptance_criteria",
			}),
		);
		expect(validation.warnings).toContainEqual(
			expect.objectContaining({
				code: "roadmap_promotion_criteria_empty",
				phase: "Phase 3",
				field: "promotion_criteria",
			}),
		);
	});

	it("exposes Roadmap criteria warnings in imm-plan JSON output", () => {
		const planPath = writeFixturePlan(`${BASE_PLAN}
## Roadmap

### Phase 1

- promotion_criteria: API is available

### Phase 2

- acceptance_criteria: implementation complete

### Phase 3

- acceptance_criteria: User sees a success message
`);
		const result = spawnSync(
			"bun",
			[TS_RUNTIME, "cli", "imm-plan", planPath, "--json"],
			{
				cwd: REPO_ROOT,
				encoding: "utf8",
			},
		);

		expect(result.status).toBe(0);
		const payload = JSON.parse(result.stdout);
		expect(payload.steps.length).toBe(1);
		expect(payload.origin_coverage.complete).toBe(true);
		expect(payload.warnings).toContainEqual(
			expect.objectContaining({
				code: "roadmap_acceptance_criteria_missing",
				phase: "Phase 1",
			}),
		);
		expect(payload.warnings).toContainEqual(
			expect.objectContaining({
				code: "roadmap_acceptance_criteria_non_behavioral",
				phase: "Phase 2",
			}),
		);
	});

	const roadmapSliceFields: Record<string, string> = {
		"Plan contract": "roadmap-slice/v1",
		"Roadmap source": "docs/specs/roadmap.spec.md Roadmap",
		"Current phase": "P1",
		"Plan boundary": "Static successor-ready planning contract",
		"Boundary rationale": "One planning authority and rollback boundary",
		"Scope pressure": "Contract docs and pure validation only",
		"Successor candidate": "P2",
		"Successor preconditions": "P1 acceptance criteria pass",
		"Current-slice warning": "Deferred phases are not implemented by this Plan",
	};

	function roadmapSlicePlan(
		overrides: Record<string, string | undefined> = {},
	): string {
		const fields = { ...roadmapSliceFields, ...overrides };
		const metadata = Object.entries(fields)
			.filter((entry): entry is [string, string] => entry[1] !== undefined)
			.map(([key, value]) => `- ${key}: ${value}`)
			.join("\n");
		return BASE_PLAN.replace(
			"- Summary: Fixture plan",
			`- Summary: Fixture plan\n${metadata}`,
		);
	}

	it("accepts and preserves complete roadmap-slice/v1 metadata", () => {
		const parsed = parsePlan(writeFixturePlan(roadmapSlicePlan()));
		const validation = validatePlan(parsed);
		const normalized = normalizePlan(parsed);

		expect(validation).toEqual({ errors: [], warnings: [] });
		expect(normalized.task).toMatchObject({
			plan_contract: "roadmap-slice/v1",
			current_phase: "P1",
			successor_candidate: "P2",
			successor_preconditions: "P1 acceptance criteria pass",
		});
	});

	it("rejects incomplete or malformed opt-in successor metadata", () => {
		const fixtures: Array<
			[string, Record<string, string | undefined>, string]
		> = [
			[
				"missing field",
				{ "Boundary rationale": undefined },
				"roadmap-slice/v1 is missing required Task field: Boundary rationale.",
			],
			[
				"invalid current phase",
				{ "Current phase": "Phase 1" },
				"roadmap-slice/v1 has invalid Current phase: Phase 1",
			],
			[
				"multiple successors",
				{ "Successor candidate": "P2,P3" },
				"roadmap-slice/v1 has invalid Successor candidate: P2,P3",
			],
			[
				"self successor",
				{ "Successor candidate": "P1" },
				"roadmap-slice/v1 Successor candidate must differ from Current phase.",
			],
			[
				"missing preconditions",
				{ "Successor preconditions": "none" },
				"roadmap-slice/v1 requires Successor preconditions for non-terminal candidate P2.",
			],
			[
				"unknown contract",
				{ "Plan contract": "roadmap-slice/v2" },
				"Unsupported Plan contract: roadmap-slice/v2",
			],
		];

		for (const [label, overrides, expected] of fixtures) {
			const validation = validatePlan(
				parsePlan(writeFixturePlan(roadmapSlicePlan(overrides))),
			);
			expect(validation.errors, label).toContain(expected);
		}
	});

	it("accepts an explicit terminal roadmap slice", () => {
		const parsed = parsePlan(
			writeFixturePlan(
				roadmapSlicePlan({
					"Successor candidate": "none",
					"Successor preconditions": "none",
				}),
			),
		);

		expect(validatePlan(parsed)).toEqual({ errors: [], warnings: [] });
	});

	it("keeps legacy and free-text continuation Plans compatible", () => {
		const legacy = parsePlan(
			writeFixturePlan(`${BASE_PLAN}
## Notes

The next follow-up may use a handoff in another session.
`),
		);

		expect(validatePlan(legacy)).toEqual({ errors: [], warnings: [] });
		expect(legacy.task.plan_contract).toBeUndefined();
		expect(legacy.task.successor_candidate).toBeUndefined();
	});

	it("keeps validate-only roadmap-slice CLI execution free of State Ledger writes", () => {
		const root = mkdtempSync(join(tmpdir(), "imm-plan-pure-validation-"));
		const planPath = join(root, "plan.md");
		writeFileSync(planPath, roadmapSlicePlan());

		const result = spawnSync(
			"bun",
			[TS_RUNTIME, "cli", "imm-plan", planPath, "--json"],
			{
				cwd: root,
				encoding: "utf8",
			},
		);

		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout).task.plan_contract).toBe(
			"roadmap-slice/v1",
		);
		expect(
			existsSync(join(root, ".imm", "memory", "current_iteration.json")),
		).toBe(false);
	});
});
