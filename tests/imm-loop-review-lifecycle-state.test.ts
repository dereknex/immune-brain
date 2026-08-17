import { describe, expect, it } from "bun:test";
import {
	buildReviewChangedFilesSignature,
	collectReviewChangedFiles,
	compounderRequirement,
	followUpBudgetState,
	getReviewPassForChangedFiles,
	normalizeCurrentIteration,
	recordReviewPass,
} from "../plugins/immune-brain/runtime/imm_core";

function evidence(changedFiles: string[]) {
	return {
		evidence_schema: "structured-v1",
		changed_files: changedFiles,
		status: "passed",
		checks: [
			{
				kind: "manual",
				command: "inspect fixture",
				status: "passed",
				exit_code: null,
				summary: "fixture passed",
			},
		],
		notes: "",
	};
}

function currentState(overrides: Record<string, unknown> = {}) {
	return {
		schema_version: 3,
		steps: {},
		pending_follow_up: null,
		last_review: null,
		validated_plan_snapshot: null,
		history: [],
		requires_replan: false,
		runtime_status: "idle",
		closed_plan_history: [],
		plan_transition_history: [],
		...overrides,
	};
}

describe("imm-loop persisted review lifecycle state", () => {
	it("stores compact reviewer pass state by changed-files signature", () => {
		const state = normalizeCurrentIteration(currentState());

		const entry = recordReviewPass(state, {
			gate: "imm-code-review",
			changed_files: ["b.ts", "a.ts", "a.ts"],
			evidence_ref: "review-log:42",
			reviewer_skill: "imm-code-review",
			reviewed_at: "2026-07-02T09:00:00Z",
		});

		expect(entry).toEqual({
			gate: "imm-code-review",
			decision: "pass",
			reviewed_changed_files: ["a.ts", "b.ts"],
			changed_files_signature: buildReviewChangedFilesSignature([
				"a.ts",
				"b.ts",
			]),
			evidence_ref: "review-log:42",
			reviewer_skill: "imm-code-review",
			reviewed_at: "2026-07-02T09:00:00Z",
		});
		expect((state as any).review_state.gates["imm-code-review"]).toEqual(entry);
	});

	it("retrieves a pass for the same changed-files signature", () => {
		const state = normalizeCurrentIteration(currentState());
		const recorded = recordReviewPass(state, {
			gate: "imm-ui-review",
			changed_files: ["src/App.tsx", "src/styles.css"],
			evidence_ref: "ui-review:pass",
			reviewer_skill: "imm-ui-review",
			reviewed_at: "2026-07-02T09:01:00Z",
		});

		expect(
			getReviewPassForChangedFiles(state, "imm-ui-review", [
				"src/styles.css",
				"src/App.tsx",
			]),
		).toEqual(recorded);
	});

	it("does not retrieve a pass for a different changed-files signature", () => {
		const state = normalizeCurrentIteration(currentState());
		recordReviewPass(state, {
			gate: "imm-code-review",
			changed_files: ["runtime.ts"],
			evidence_ref: "code-review:pass",
			reviewer_skill: "imm-code-review",
			reviewed_at: "2026-07-02T09:02:00Z",
		});

		expect(
			getReviewPassForChangedFiles(state, "imm-code-review", [
				"runtime.ts",
				"new-test.ts",
			]),
		).toBeNull();
	});

	it("derives standard Compounder triggers from immutable current-Plan state", () => {
		const base = currentState({
			validated_plan_snapshot: {
				task: { workflow_profile: "standard", compounder: "optional" },
			},
			review_follow_up_start_index: 1,
			follow_up_history: [{ state: "closed" }],
		});
		const state = normalizeCurrentIteration(base);
		expect(compounderRequirement(state, ["runtime.ts"])).toEqual({
			required: false,
			reasons: [],
		});
		expect(compounderRequirement(state, ["CONTEXT.md"])).toEqual({
			required: true,
			reasons: ["durable_learning_surface_changed"],
		});

		state.follow_up_history = [
			{ state: "closed" },
			{ state: "closed" },
			{ state: "closed" },
		];
		expect(followUpBudgetState(state)).toMatchObject({
			current: 2,
			limit: 2,
			budget_stop: true,
		});
		expect(compounderRequirement(state, ["runtime.ts"])).toEqual({
			required: true,
			reasons: ["multiple_follow_ups"],
		});
	});

	it("loads current State Ledger shapes without review_state", () => {
		const state = normalizeCurrentIteration(
			currentState({ steps: { "1": { state: "pending" } } }),
		);

		expect((state as any).review_state).toBeUndefined();
		expect(state.steps["1"].state).toBe("pending");
	});

	it("defaults a missing review follow-up boundary to all current history", () => {
		const state = normalizeCurrentIteration(
			currentState({
				steps: {
					"1": { state: "closed", execution_evidence: evidence(["step.ts"]) },
				},
				follow_up_history: [
					{
						state: "closed",
						execution_evidence: evidence(["current-follow-up.ts"]),
					},
				],
			}),
		);

		expect(state.review_follow_up_start_index).toBe(0);
		expect(collectReviewChangedFiles(state)).toEqual([
			"current-follow-up.ts",
			"step.ts",
		]);
	});

	it("collects only marker-visible follow-ups while preserving closed Step files", () => {
		const state = normalizeCurrentIteration(
			currentState({
				review_follow_up_start_index: 1,
				steps: {
					"1": { state: "closed", execution_evidence: evidence(["step.ts"]) },
				},
				follow_up_history: [
					{ state: "closed", execution_evidence: evidence(["prior-plan.ts"]) },
					{
						state: "closed",
						execution_evidence: evidence(["current-follow-up.ts", "step.ts"]),
					},
				],
			}),
		);

		expect(state.review_follow_up_start_index).toBe(1);
		expect(collectReviewChangedFiles(state)).toEqual([
			"current-follow-up.ts",
			"step.ts",
		]);
	});

	it("fails closed on invalid explicit review follow-up boundaries", () => {
		const history = [
			{ state: "closed", execution_evidence: evidence(["follow-up.ts"]) },
		];

		for (const marker of [-1, 0.5, "0", 2]) {
			const state = normalizeCurrentIteration(
				currentState({
					review_follow_up_start_index: marker,
					steps: {},
					follow_up_history: history,
				}),
			);
			expect(() => collectReviewChangedFiles(state)).toThrow(
				"review_follow_up_start_index",
			);
		}
	});
});
