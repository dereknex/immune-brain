import { describe, expect, it } from "bun:test";
import { mapLegacyState } from "../plugins/immune-brain/runtime/kernel";

function legacyFollowUp(
	state: "pending" | "executing" | "ready_for_review" | "rework_needed" | "closed" | "replanning",
): Record<string, unknown> {
	return {
		id: "follow-up-1",
		state,
		scope: ["plugins/immune-brain/runtime/kernel/legacy.ts"],
		change_goal: "Repair the bounded review finding",
		verification_hint: "bun test tests/kernel-core.test.ts",
		origin_review: {
			gate: "imm-code-review",
			evidence_ref: "review://finding-1",
		},
		execution_evidence: null,
		opened_at: "2026-08-11T00:00:00Z",
		round: 1,
	};
}

describe("Assurance Kernel projection and migration", () => {
	it("maps the reproduced v3 contradiction to stopped", () => {
		const mapped = mapLegacyState({
			runtime_status: "idle",
			requires_replan: false,
			active_step: null,
			steps: { "1": { state: "replanning" } },
		});
		expect(mapped).toEqual({
			phase: "stopped",
			reason: "legacy-inconsistent",
			ambiguous: true,
			source_states: ["replanning"],
		});
	});

	it("fails closed when active_step masks another current state", () => {
		expect(
			mapLegacyState({
				requires_replan: false,
				active_step: 1,
				steps: {
					"1": { state: "active" },
					"2": { state: "ready_for_review" },
				},
			}),
		).toMatchObject({
			phase: "stopped",
			reason: "legacy-inconsistent",
			ambiguous: true,
		});
		expect(
			mapLegacyState({
				requires_replan: false,
				active_step: 1,
				steps: {
					"1": { state: "pending" },
					"2": { state: "active" },
				},
			}),
		).toMatchObject({
			phase: "stopped",
			reason: "legacy-inconsistent",
			ambiguous: true,
		});
	});

	it("maps the validated pending follow-up lifecycle", () => {
		const base = {
			plan_path: "docs/plans/follow-up.md",
			plan_terminal: null,
			runtime_status: "idle",
			active_step: null,
			requires_replan: false,
			steps: { "1": { state: "closed" } },
		};
		for (const state of ["pending", "executing", "rework_needed"] as const) {
			expect(
				mapLegacyState({ ...base, pending_follow_up: legacyFollowUp(state) }),
			).toMatchObject({
				phase: "working",
				reason: "legacy-working",
				ambiguous: false,
			});
		}
		expect(
			mapLegacyState({
				...base,
				pending_follow_up: legacyFollowUp("ready_for_review"),
			}),
		).toMatchObject({
			phase: "review",
			reason: "legacy-review",
			ambiguous: false,
		});
		expect(
			mapLegacyState({
				...base,
				requires_replan: true,
				pending_follow_up: legacyFollowUp("replanning"),
			}),
		).toMatchObject({
			phase: "stopped",
			reason: "legacy-replan",
			ambiguous: false,
		});
	});

	it("fails closed for malformed, closed, or conflicting follow-up ownership", () => {
		const base = {
			plan_path: "docs/plans/follow-up.md",
			plan_terminal: null,
			runtime_status: "idle",
			active_step: null,
			requires_replan: false,
			steps: { "1": { state: "closed" } },
		};
		for (const pending_follow_up of [
			{ state: "executing" },
			legacyFollowUp("closed"),
		]) {
			expect(mapLegacyState({ ...base, pending_follow_up })).toMatchObject({
				phase: "stopped",
				reason: "legacy-inconsistent",
				ambiguous: true,
			});
		}
		expect(
			mapLegacyState({
				...base,
				active_step: 1,
				steps: { "1": { state: "executing" } },
				pending_follow_up: legacyFollowUp("executing"),
			}),
		).toMatchObject({
			phase: "stopped",
			reason: "legacy-inconsistent",
			ambiguous: true,
		});
	});

	it("requires positive Plan identity before mapping an all-closed aggregate", () => {
		expect(
			mapLegacyState({
				runtime_status: "idle",
				active_step: null,
				requires_replan: false,
				pending_follow_up: null,
				steps: { "1": { state: "closed" } },
			}),
		).toMatchObject({
			phase: "stopped",
			reason: "legacy-inconsistent",
			ambiguous: true,
		});
	});

	it("maps normal closed/current/future step aggregates", () => {
		expect(
			mapLegacyState({
				requires_replan: false,
				active_step: 2,
				steps: {
					"1": { state: "closed" },
					"2": { state: "active" },
					"3": { state: "pending" },
				},
			}),
		).toMatchObject({ phase: "working", ambiguous: false });
		expect(
			mapLegacyState({
				requires_replan: false,
				active_step: 2,
				steps: {
					"1": { state: "closed" },
					"2": { state: "ready_for_review" },
					"3": { state: "pending" },
				},
			}),
		).toMatchObject({ phase: "review", ambiguous: false });
		expect(
			mapLegacyState({
				plan_path: "docs/plans/reviewing.md",
				plan_terminal: null,
				active_step: null,
				steps: {
					"1": { state: "closed" },
					"2": { state: "closed" },
				},
			}),
		).toMatchObject({
			phase: "review",
			reason: "legacy-review",
			ambiguous: false,
		});
	});

	it("distinguishes a finished Plan from all-closed review state", () => {
		const planPath = "docs/plans/finished.md";
		const closed = {
			plan_path: planPath,
			plan_terminal: null,
			runtime_status: "idle",
			active_step: null,
			requires_replan: false,
			pending_follow_up: null,
			steps: {
				"1": { state: "closed" },
				"2": { state: "closed" },
			},
		};
		const matchingFinish = {
			at: "2026-08-11T03:00:02Z",
			action: "finish_reset",
			details: { plan_path: planPath },
		};

		expect(
			mapLegacyState({
				...closed,
				reset_reason: "intentional_reset",
				history: [matchingFinish],
			}),
		).toEqual({
			phase: "done",
			reason: "legacy-finished",
			ambiguous: false,
			source_states: ["closed"],
		});

		const unverified = [
			{ ...closed, history: [matchingFinish] },
			{ ...closed, reset_reason: "intentional_reset" },
			{
				...closed,
				reset_reason: "intentional_reset",
				history: "malformed",
			},
			{
				...closed,
				reset_reason: "intentional_reset",
				history: [
					{ ...matchingFinish, details: { plan_path: "docs/plans/other.md" } },
				],
			},
			{
				...closed,
				reset_reason: "intentional_reset",
				steps: {
					"1": { state: "closed" },
					"2": {},
				},
				history: [matchingFinish],
			},
			{
				...closed,
				reset_reason: "intentional_reset",
				requires_replan: "true",
				history: [matchingFinish],
			},
			{
				...closed,
				reset_reason: "intentional_reset",
				requires_replan: 1,
				history: [matchingFinish],
			},
			{
				...closed,
				reset_reason: "intentional_reset",
				requires_replan: null,
				history: [matchingFinish],
			},
			{
				...closed,
				reset_reason: "intentional_reset",
				requires_replan: undefined,
				history: [matchingFinish],
			},
			{
				...closed,
				reset_reason: "intentional_reset",
				active_step: {},
				history: [matchingFinish],
			},
			{
				...closed,
				reset_reason: "intentional_reset",
				pending_follow_up: false,
				history: [matchingFinish],
			},
			{
				...closed,
				reset_reason: "intentional_reset",
				pending_follow_up: { id: "follow-up-open" },
				history: [matchingFinish],
			},
			{
				...closed,
				reset_reason: "intentional_reset",
				history: [
					matchingFinish,
					{
						...matchingFinish,
						at: "2026-08-11T03:01:00Z",
						details: { plan_path: "docs/plans/other.md" },
					},
				],
			},
		];
		const failClosed = [
			...unverified.splice(4, 4),
			...unverified.splice(5, 3),
		];
		for (const state of unverified) {
			expect(mapLegacyState(state)).toMatchObject({
				phase: "review",
				reason: "legacy-review",
				ambiguous: false,
			});
		}
		for (const state of failClosed) {
			expect(mapLegacyState(state)).toMatchObject({
				phase: "stopped",
				reason: "legacy-inconsistent",
				ambiguous: true,
			});
		}
		expect(
			mapLegacyState({
				...closed,
				plan_terminal: { status: "superseded", plan_path: planPath },
				reset_reason: "intentional_reset",
				history: [matchingFinish],
			}),
		).toMatchObject({
			phase: "stopped",
			reason: "legacy-terminal",
			ambiguous: true,
		});
		expect(
			mapLegacyState({
				plan_path: planPath,
				plan_terminal: { status: "superseded", plan_path: planPath },
				active_step: null,
				requires_replan: false,
				pending_follow_up: null,
				steps: {},
			}),
		).toMatchObject({
			phase: "stopped",
			reason: "legacy-terminal",
			ambiguous: true,
		});
	});
});