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
	PlanValidationError,
	projectPlanValidation,
} from "../plugins/immune-brain/runtime/plan_core";

// plan_core now exposes only the surface production reaches: `PlanValidationError`
// and `projectPlanValidation`. The parser, normalizer, and validator are private,
// so every parity assertion below is read back through the live projection —
// either its returned payload or its rejection text — instead of an internal
// symbol. The one behavior that retired with the export surface is the plan
// signature (see the note inside the describe block).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION_PLAN = resolve(
	REPO_ROOT,
	"docs/plans/archive/2026-06-29-001-feat-bun-typescript-runtime-migration-plan.md",
);
const TS_RUNTIME = resolve(
	REPO_ROOT,
	"plugins/immune-brain/runtime/v4_runtime.ts",
);

function projection(planPath: string) {
	return projectPlanValidation(planPath, dirname(planPath));
}

/**
 * The live rejection text: `Plan validation failed: <errors joined with "; ">`,
 * or `Plan could not be read: <parse error>`. Empty when the Plan is accepted.
 */
function rejection(planPath: string): string {
	try {
		projection(planPath);
	} catch (error) {
		if (error instanceof PlanValidationError) return error.message;
		throw error;
	}
	return "";
}

function expectAccepted(planPath: string): void {
	expect(rejection(planPath)).toBe("");
}

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

describe("plan validation parity", () => {
	it("parses the migration plan with matching summary and step count", () => {
		const projected = projection(MIGRATION_PLAN);
		expect(projected.summary).toBe(
			"Migrate Immune-Brain production host runtime from Python to Bun + TypeScript across OpenCode, Cursor, Codex, and Claude, using Python only as a temporary parity reference.",
		);
		expect(projected.steps.length).toBe(4);
		expect(projected.steps[0].step_id).toBe("U1");
		expect(projected.steps[0].result).toBe(
			"TypeScript runtime parity harness covers the public runtime contract",
		);
		expect(projected.steps[1].depends_on).toEqual([1]);
		expect(projected.steps[0].discovery_cache.length).toBe(3);
		expect(projected.steps[0].parallel_probes.length).toBe(3);
	});

	// The cross-runtime plan signature parity case retired with its export: the
	// signature helpers had no production caller left (the projection never
	// carried a signature), the compiler proved them unreachable, and they were
	// deleted. The v3 CLI wall and the projection are what remain observable.

	it("validates the migration plan with no errors", () => {
		expectAccepted(MIGRATION_PLAN);
	});

	it("defaults legacy Plans to strict workflow semantics", () => {
		const path = writeFixturePlan(BASE_PLAN);
		expectAccepted(path);
		// The default is observable through the strict-only Compounder rule: a
		// legacy Plan cannot opt into the optional policy.
		const optionalCompounder = writeFixturePlan(
			BASE_PLAN.replace(
				"- Summary: Fixture plan",
				"- Summary: Fixture plan\n- Compounder: optional",
			),
		);
		expect(rejection(optionalCompounder)).toContain(
			"Strict workflow profile requires Compounder: required.",
		);
	});

	it("accepts an explicit standard profile with automated verification", () => {
		const path = writeFixturePlan(
			BASE_PLAN.replace(
				"- Summary: Fixture plan",
				"- Summary: Fixture plan\n- Workflow profile: standard\n- Compounder: optional",
			),
		);
		expect(projection(path).task.workflow_profile).toBe("standard");
		expect(projection(path).task.compounder).toBe("optional");
		expectAccepted(path);
	});

	it("rejects Direct Path and unknown managed profiles", () => {
		for (const profile of ["direct", "turbo"]) {
			const path = writeFixturePlan(
				BASE_PLAN.replace(
					"- Summary: Fixture plan",
					`- Summary: Fixture plan\n- Workflow profile: ${profile}`,
				),
			);
			expect(rejection(path)).toContain(
				"Workflow profile must be standard or strict; Direct Path does not use a Plan.",
			);
		}
	});

	it("requires automated verification for standard Plans", () => {
		const path = writeFixturePlan(
			BASE_PLAN.replace(
				"- Summary: Fixture plan",
				"- Summary: Fixture plan\n- Workflow profile: standard",
			).replace("- Verification: `true`", "- Verification: Inspect manually"),
		);
		expect(rejection(path)).toContain(
			"Standard workflow profile requires automated Verification for Step 1.",
		);
	});

	it("rejects optional Compounder for strict Plans", () => {
		const path = writeFixturePlan(
			BASE_PLAN.replace(
				"- Summary: Fixture plan",
				"- Summary: Fixture plan\n- Workflow profile: strict\n- Compounder: optional",
			),
		);
		expect(rejection(path)).toContain(
			"Strict workflow profile requires Compounder: required.",
		);
	});

	it("normalizes Depends on Step ID references", () => {
		const path = writeFixturePlan(`${BASE_PLAN}
### Step 2

- Step ID: U2
- Result: Second fixture outcome
- Verification: \`true\`
- Depends on: U1

### Step 3

- Step ID: U3
- Result: Third fixture outcome
- Verification: \`true\`
- Depends on: 2
`);
		const projected = projection(path);
		expect(projected.steps[1].depends_on).toEqual([1]);
		expect(projected.steps[2].depends_on).toEqual([2]);

		const invalid = writeFixturePlan(
			BASE_PLAN.replace(
				"- Verification: `true`",
				"- Verification: `true`\n- Depends on: step-one",
			),
		);
		expect(rejection(invalid)).toContain(
			"Use a step number like 1 or a Step ID like U1",
		);
	});

	it("does not reject natural Chinese result punctuation", () => {
		const path = writeFixturePlan(
			BASE_PLAN.replace(
				"- Result: Fixture outcome",
				"- Result: Runtime 接口支持 help、flags 以及 JSON evidence",
			),
		);
		expect(projection(path).steps[0].result).toBe(
			"Runtime 接口支持 help、flags 以及 JSON evidence",
		);
		expectAccepted(path);
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
		const projected = projection(planPath);
		expect(projected.origin_coverage).toEqual({
			applicable: true,
			declared_items: 3,
			mapped_items: 3,
			unmapped_items: 0,
			reason_required_without_reason: 1,
			deferred_or_out_of_scope_without_reason: 1,
			complete: false,
		});
		expect(projected.steps).toHaveLength(1);
		expect(projected.task).not.toHaveProperty("origin_coverage");
	});

	it("reports historical Plans without a manifest as not applicable", () => {
		const planPath = writeFixturePlan(BASE_PLAN);
		expect(
			projection(planPath).origin_coverage,
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
		const unmapped = writeFixturePlan(
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
		);
		expect(rejection(unmapped)).toContain(
			"Brainstorm manifest item BR-REQ-004 is not mapped in Brainstorm Trace.",
		);

		// Every reason-required status counts once each declared ID is mapped.
		const mapped = writeFixturePlan(
			BASE_PLAN.replace(
				"- Summary: Fixture plan",
				"- Summary: Fixture plan\n- Brainstorm manifest: BR-REQ-001; BR-REQ-002; BR-REQ-003",
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
		);
		expect(projection(mapped).origin_coverage).toMatchObject({
			declared_items: 3,
			mapped_items: 3,
			unmapped_items: 0,
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
		const planPath = writeFixturePlan(
			BASE_PLAN.replace(
				"- Summary: Fixture plan",
				"- Summary: Fixture plan\n- Brainstorm manifest: BR-REQ-001; BR-REQ-002, BR-DEC-001",
			).replace(
				"## Steps",
				`## Brainstorm Trace

| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-001 | covered_by_step | U1 | |
| BR-REQ-002 | covered_by_step | U1 | |
| BR-DEC-001 | covered_by_step | U1 | |

## Steps`,
			),
		);
		expect(projection(planPath).origin_coverage).toMatchObject({
			applicable: true,
			declared_items: 3,
			mapped_items: 3,
			complete: true,
		});
	});

	it("parses discovery cache entries in path (reason) format", () => {
		const planPath = writeFixturePlan(
			BASE_PLAN.replace(
				"- Verification: `true`",
				"- Verification: `true`\n- Discovery cache: path/to/file.py (reason one); other.md (reason two)",
			),
		);
		expect(projection(planPath).steps[0].discovery_cache).toEqual([
			{ path: "path/to/file.py", reason: "reason one" },
			{ path: "other.md", reason: "reason two" },
		]);
	});

	it("parses parallel probes from key=value pairs", () => {
		const planPath = writeFixturePlan(
			BASE_PLAN.replace(
				"- Verification: `true`",
				"- Verification: `true`\n- Parallel probes: scope=a.py,output=foo,readonly=true; scope=b.py,output=bar,readonly=true",
			),
		);
		expect(projection(planPath).steps[0].parallel_probes).toEqual([
			{ scope: "a.py", output: "foo", readonly: true },
			{ scope: "b.py", output: "bar", readonly: true },
		]);
	});

	it("rejects discovery cache entries without reason", () => {
		const planPath = writeFixturePlan(
			BASE_PLAN.replace(
				"- Verification: `true`",
				"- Verification: `true`\n- Discovery cache: path-without-reason",
			),
		);
		expect(rejection(planPath)).toContain(
			"Discovery cache entries must use 'path (reason)' format.",
		);
	});

	it("rejects parallel probes without readonly: true", () => {
		const planPath = writeFixturePlan(
			BASE_PLAN.replace(
				"- Verification: `true`",
				"- Verification: `true`\n- Parallel probes: scope=a.py,output=foo,readonly=false",
			),
		);
		expect(rejection(planPath)).toContain(
			"Parallel probes must declare readonly: true.",
		);
	});

	it("accepts declared medium-risk design with a required Mermaid diagram", () => {
		const path = writeFixtureWithSpec(`# Spec

**Design risk**: Medium
**Diagram decision**: required
**Diagram reason**: The cross-module data flow needs a diagram.

## Technical Design

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`
`);

		expectAccepted(path);
		expect(projection(path).warnings).toEqual([]);
	});

	it("rejects declared medium-risk design without Technical Design", () => {
		const path = writeFixtureWithSpec(`# Spec

**Design risk**: Medium
**Diagram decision**: not_required
**Diagram reason**: Prose fully describes the local contract.
`);

		expect(rejection(path)).toContain(
			"Referenced medium-risk Spec is missing a Technical Design section.",
		);
	});

	it("rejects required diagram decisions without Mermaid", () => {
		const path = writeFixtureWithSpec(`# Spec

**Design risk**: High
**Diagram decision**: required
**Diagram reason**: The state transition needs a diagram.

## Technical Design
`);

		expect(rejection(path)).toContain(
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
		expect(rejection(path)).toContain(
			"High-risk Specs require Workflow profile: strict.",
		);
	});

	it("rejects diagram decisions without a reason", () => {
		const path = writeFixtureWithSpec(`# Spec

**Design risk**: Low
**Diagram decision**: not_required
`);

		expect(rejection(path)).toContain(
			"Referenced Spec is missing Diagram reason.",
		);
	});

	it("rejects missing referenced Specs", () => {
		const path = writeFixtureWithSpec();

		expect(rejection(path)).toContain("Referenced Spec does not exist:");
	});

	it("does not accept Mermaid outside Technical Design", () => {
		const path = writeFixtureWithSpec(`# Spec

**Design risk**: High
**Diagram decision**: required
**Diagram reason**: The state transition needs a diagram.

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

## Technical Design

Prose only.
`);

		expect(rejection(path)).toContain(
			"Referenced Spec requires a Mermaid diagram but does not contain one.",
		);
	});

	it("ignores design metadata examples inside code fences", () => {
		const path = writeFixtureWithSpec(`# Legacy Spec

\`\`\`md
**Design risk**: High
**Diagram decision**: required
**Diagram reason**: Example only.
\`\`\`
`);

		const projected = projection(path);
		expect(projected.warnings).toContainEqual(
			expect.objectContaining({
				code: "spec_design_metadata_missing",
			}),
		);
	});

	it("keeps legacy Specs compatible with an actionable warning", () => {
		const path = writeFixtureWithSpec("# Legacy Spec\n");

		expect(projection(path).warnings).toContainEqual(
			expect.objectContaining({
				code: "spec_design_metadata_missing",
				field: "design_metadata",
			}),
		);
	});

	it("warns when three-phase Roadmaps omit or empty acceptance criteria", () => {
		const path = writeFixturePlan(`${BASE_PLAN}
## Roadmap

### Phase 1

- promotion_criteria: API is available

### Phase 2

- acceptance_criteria:
- promotion_criteria: Reviewer approves

### Phase 3

- acceptance_criteria: The export button produces a CSV
- promotion_criteria: Stakeholder approves
`);
		expectAccepted(path);
		const warnings = projection(path).warnings;

		expect(warnings).toContainEqual(
			expect.objectContaining({
				code: "roadmap_acceptance_criteria_missing",
				phase: "Phase 1",
				field: "acceptance_criteria",
			}),
		);
		expect(warnings).toContainEqual(
			expect.objectContaining({
				code: "roadmap_acceptance_criteria_empty",
				phase: "Phase 2",
				field: "acceptance_criteria",
			}),
		);
	});

	it("keeps one-phase and two-phase Roadmaps warning-free without criteria", () => {
		const path = writeFixturePlan(`${BASE_PLAN}
## Roadmap

### Phase 1

- goal: Alpha

### Phase 2

- goal: Beta
`);

		expect(projection(path).warnings).toEqual([]);
	});

	it("reports non-behavioral acceptance criteria separately from promotion criteria", () => {
		const path = writeFixturePlan(`${BASE_PLAN}
## Roadmap

### Phase 1

- acceptance_criteria: implementation complete

### Phase 2

- acceptance_criteria: User can export the visible table
- promotion_criteria: API is available

### Phase 3

- acceptance_criteria: User sees a success message
- promotion_criteria:
`);
		const warnings = projection(path).warnings;

		expect(warnings).toContainEqual(
			expect.objectContaining({
				code: "roadmap_acceptance_criteria_non_behavioral",
				phase: "Phase 1",
				field: "acceptance_criteria",
			}),
		);
		expect(warnings).toContainEqual(
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
		const path = writeFixturePlan(roadmapSlicePlan());
		expectAccepted(path);
		expect(projection(path).warnings).toEqual([]);
		expect(projection(path).task).toMatchObject({
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
			const planPath = writeFixturePlan(roadmapSlicePlan(overrides));
			expect(rejection(planPath), label).toContain(expected);
		}
	});

	it("accepts an explicit terminal roadmap slice", () => {
		const path = writeFixturePlan(
			roadmapSlicePlan({
				"Successor candidate": "none",
				"Successor preconditions": "none",
			}),
		);

		expectAccepted(path);
		expect(projection(path).warnings).toEqual([]);
	});

	it("keeps legacy and free-text continuation Plans compatible", () => {
		const path = writeFixturePlan(`${BASE_PLAN}
## Notes

The next follow-up may use a handoff in another session.
`);

		expectAccepted(path);
		expect(projection(path).warnings).toEqual([]);
		expect(projection(path).task.plan_contract).toBeUndefined();
		expect(projection(path).task.successor_candidate).toBeUndefined();
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
