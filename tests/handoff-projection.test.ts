import { describe, expect, it } from "bun:test";
import {
	applyHandoffState,
	HANDOFF_END_MARKER,
	HANDOFF_START_MARKER,
	renderHandoffState,
} from "../plugins/immune-brain/runtime/imm_core";

const LEDGER = {
	plan_path: "docs/plans/2026-08-01-001-feat-example-plan.md",
	plan_summary: "Example plan",
	completed_steps: [1],
	active_step: 2,
	steps: {
		"1": { number: 1, step_id: "U1", result: "First outcome", state: "closed" },
		"2": { number: 2, step_id: "U2", result: "Second outcome", state: "active" },
	},
};

describe("HANDOFF generated region", () => {
	it("preserves narrative written outside the markers", () => {
		const existing = `# Immune-Brain Handoff

${HANDOFF_START_MARKER}
stale generated content
${HANDOFF_END_MARKER}

## Decisions this session

- Chose the marker-region split so the runtime never clobbers narrative.
`;

		const updated = applyHandoffState(existing, LEDGER);

		expect(updated).toContain("## Decisions this session");
		expect(updated).toContain(
			"- Chose the marker-region split so the runtime never clobbers narrative.",
		);
		expect(updated).not.toContain("stale generated content");
	});

	it("adopts a marker-less file without destroying its content", () => {
		const existing = `# Immune-Brain Handoff

## Completed plan

- Plan: \`docs/plans/old-plan.md\`

## Decisions this session

- Handwritten note that predates the markers.
`;

		const updated = applyHandoffState(existing, LEDGER);

		expect(updated).toContain(HANDOFF_START_MARKER);
		expect(updated).toContain(HANDOFF_END_MARKER);
		expect(updated).toContain(
			"- Handwritten note that predates the markers.",
		);
		expect(updated).toContain("- Plan: `docs/plans/old-plan.md`");
	});

	it("stays idempotent across repeated renders", () => {
		const first = applyHandoffState("# Immune-Brain Handoff\n", LEDGER);
		const second = applyHandoffState(first, LEDGER);

		expect(second).toBe(first);
		expect(second.split(HANDOFF_START_MARKER).length - 1).toBe(1);
	});
});

describe("HANDOFF derivable fields", () => {
	it("lists completed steps with their step ids and results", () => {
		const rendered = renderHandoffState(LEDGER);

		expect(rendered).toContain("U1");
		expect(rendered).toContain("First outcome");
	});

	it("names the active step as the next action", () => {
		const rendered = renderHandoffState(LEDGER);

		expect(rendered).toContain("U2");
		expect(rendered).toContain("Second outcome");
	});

	it("reports no active step when the plan is idle", () => {
		const rendered = renderHandoffState({
			...LEDGER,
			active_step: null,
			steps: {
				"1": {
					number: 1,
					step_id: "U1",
					result: "First outcome",
					state: "closed",
				},
			},
			completed_steps: [1],
		});

		expect(rendered).toContain("None");
	});
});

describe("HANDOFF blockers", () => {
	it("surfaces a recorded failure exit as a known blocker", () => {
		const rendered = renderHandoffState({
			...LEDGER,
			active_step: 2,
			steps: {
				"1": {
					number: 1,
					step_id: "U1",
					result: "First outcome",
					state: "closed",
				},
				"2": {
					number: 2,
					step_id: "U2",
					result: "Second outcome",
					state: "rework_needed",
					execution_evidence: {
						status: "blocked",
						failure_exit: "missing credentials",
					},
				},
			},
		});

		expect(rendered).toContain("Known blockers");
		expect(rendered).toContain("U2");
		expect(rendered).toContain("missing credentials");
	});

	it("reports no blockers when every recorded attempt passed", () => {
		const rendered = renderHandoffState({
			...LEDGER,
			steps: {
				"1": {
					number: 1,
					step_id: "U1",
					result: "First outcome",
					state: "closed",
					execution_evidence: { status: "passed" },
				},
			},
			completed_steps: [1],
			active_step: null,
		});

		expect(rendered).toContain("Known blockers");
		expect(rendered).not.toContain("missing credentials");
	});
});
