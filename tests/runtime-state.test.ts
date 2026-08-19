import { describe, expect, it } from "bun:test";
import {
	activateStep,
	beginWorkProbes,
	getCompletedSteps,
	recordExecution,
	recordWorkProbeEvidence,
	reviewPass,
	transitionStep,
	validateReadyForReviewEvidence,
	VALID_TRANSITIONS,
	ACTIVE_STATES,
	STEP_STATES,
	applyIntentionalFinish,
	buildRoadmapPhaseCompletionRecord,
	createEmptyStateLedger,
	normalizeCurrentIteration,
	validateTransitionState,
	utcNow,
} from "../plugins/immune-brain/runtime/state_ledger";

function passedEvidence(changedFiles: string | string[]) {
	return {
		changed_files: changedFiles,
		status: "passed",
		checks: [
			{
				kind: "command",
				command: "bun test",
				status: "passed",
				exit_code: 0,
				summary: "all tests passed cleanly",
			},
		],
	};
}

describe("Roadmap Phase completion state", () => {
	const completionInput = {
		plan_path: "docs/plans/roadmap-phase.md",
		plan_signature: "a".repeat(64),
		roadmap_source: "`docs/specs/roadmap.md` Roadmap",
		phase: "P1",
		finished_at: "2026-08-11T00:00:00Z",
		provenance: "runtime_finish" as const,
	};

	it("initializes and backward-normalizes the optional completion collection", () => {
		expect(createEmptyStateLedger().roadmap_phase_completion_history).toEqual([]);
		const legacy = createEmptyStateLedger() as any;
		delete legacy.roadmap_phase_completion_history;
		legacy.future_extension = { preserved: true };
		const normalized = normalizeCurrentIteration(legacy);
		expect(normalized.roadmap_phase_completion_history).toEqual([]);
		expect(normalized.future_extension).toEqual({ preserved: true });
	});

	it("builds deterministic content-addressed completion records", () => {
		const first = buildRoadmapPhaseCompletionRecord(completionInput);
		const second = buildRoadmapPhaseCompletionRecord({ ...completionInput });
		expect(second).toEqual(first);
		expect(first).toMatchObject({
			contract: "roadmap_phase_completion/v1",
			completion_id: expect.stringMatching(/^[0-9a-f]{64}$/),
			...completionInput,
		});
	});

	it("rejects malformed or duplicate completion authority", () => {
		const valid = buildRoadmapPhaseCompletionRecord(completionInput);
		const invalidRecords = [
			{ ...valid, contract: "roadmap_phase_completion/v2" },
			{ ...valid, completion_id: "0".repeat(64) },
			{ ...valid, plan_path: "../escape.md" },
			{ ...valid, plan_signature: "short" },
			{ ...valid, roadmap_source: "" },
			{ ...valid, phase: "" },
			{ ...valid, finished_at: "not-a-time" },
			{ ...valid, finished_at: "2026-02-31T00:00:00Z" },
			{ ...valid, provenance: "ui_guess" },
		];
		for (const record of invalidRecords) {
			const state = createEmptyStateLedger() as any;
			state.roadmap_phase_completion_history = [record];
			expect(() => normalizeCurrentIteration(state)).toThrow();
		}
		const duplicate = createEmptyStateLedger() as any;
		duplicate.roadmap_phase_completion_history = [valid, { ...valid }];
		expect(() => validateTransitionState(duplicate)).toThrow(
			"Duplicate completion_id",
		);
	});

	it("derives finish records only from a complete validated Roadmap snapshot", () => {
		const state = createEmptyStateLedger() as any;
		state.plan_path = completionInput.plan_path;
		state.plan_signature = completionInput.plan_signature;
		state.validated_plan_snapshot = {
			plan_path: completionInput.plan_path,
			plan_signature: completionInput.plan_signature,
			task: {
				roadmap_source: completionInput.roadmap_source,
				current_phase: completionInput.phase,
			},
		};
		applyIntentionalFinish(state, completionInput.finished_at);
		expect(state.roadmap_phase_completion_history).toEqual([
			buildRoadmapPhaseCompletionRecord(completionInput),
		]);

		const noRoadmap = createEmptyStateLedger() as any;
		noRoadmap.validated_plan_snapshot = {
			plan_path: completionInput.plan_path,
			plan_signature: completionInput.plan_signature,
			task: {},
		};
		applyIntentionalFinish(noRoadmap, completionInput.finished_at);
		expect(noRoadmap.roadmap_phase_completion_history).toEqual([]);
	});
});

describe("state machine parity", () => {
	it("transitions pending -> active -> ready_for_review -> closed", () => {
		const state = {
			steps: {
				"1": {
					state: "pending",
					step_id: "U1",
					result: "r",
					verification: "v",
				},
			},
		};

		activateStep(state, 1, { step_id: "U1", result: "r", verification: "v" });
		expect(state.steps["1"].state).toBe("active");

		recordExecution(state, 1, passedEvidence(["a.ts"]));
		expect(state.steps["1"].state).toBe("ready_for_review");
		expect("execution_evidence" in state.steps["1"]).toBe(true);

		reviewPass(state, 1);
		expect(state.steps["1"].state).toBe("closed");
		expect("execution_evidence" in state.steps["1"]).toBe(true);
		expect(getCompletedSteps(state)).toEqual([1]);
	});

	it("uses the function-first state transition API", () => {
		const state = {
			steps: {
				"1": {
					state: "pending",
					step_id: "U1",
					result: "r",
					verification: "v",
				},
			},
		};
		activateStep(state, 1, { step_id: "U1", result: "r", verification: "v" });
		expect(state.steps["1"].state).toBe("active");
	});

	it("persists the work probe checkpoint before execution", () => {
		const state = {
			steps: {
				"1": {
					state: "active",
					step_id: "U1",
					parallel_probes: [
						{ scope: "runtime", output: "evidence", readonly: true },
					],
				},
			},
			history: [],
		};
		beginWorkProbes(state, 1);
		expect(state.steps["1"].state).toBe("probing");
		expect(state.history).toHaveLength(1);

		recordWorkProbeEvidence(state, 1, [
			{
				agent: "work-probe",
				probe_id: "work-probe:U1:1:id",
				status: "success",
				fallback_reason: "none",
				scope: "runtime",
				summary: "complete",
				evidence: {},
			},
		]);
		expect(state.steps["1"].state).toBe("executing");
		expect(state.steps["1"].child_evidence).toHaveLength(1);
		expect(state.history).toHaveLength(2);
	});

	it("keeps rework execution compatible when a Step declares probes", () => {
		const state = {
			steps: {
				"1": {
					state: "rework_needed",
					step_id: "U1",
					parallel_probes: [
						{ scope: "runtime", output: "evidence", readonly: true },
					],
				},
			},
		};
		recordExecution(state, 1, passedEvidence(["a.ts"]));
		expect(state.steps["1"].state).toBe("ready_for_review");
	});

	it("rejects illegal transitions with matching error message", () => {
		const state = { steps: { "1": { state: "closed" } } };
		expect(() => transitionStep(state, 1, "active")).toThrow(
			"Illegal transition for step 1: closed -> active. Allowed: []",
		);
	});

	it("rejects activating a second step while one is active", () => {
		const state = {
			steps: {
				"1": { state: "active", step_id: "U1", result: "r", verification: "v" },
				"2": {
					state: "pending",
					step_id: "U2",
					result: "r2",
					verification: "v2",
				},
			},
		};
		expect(() =>
			activateStep(state, 2, {
				step_id: "U2",
				result: "r2",
				verification: "v2",
			}),
		).toThrow("Step 1 is already active");
	});

	it("validates ready_for_review evidence requires changed files", () => {
		expect(() => validateReadyForReviewEvidence(passedEvidence([]))).toThrow(
			"ready_for_review pre-check requires changed files.",
		);
	});

	it("rejects legacy evidence in the current runtime", () => {
		expect(() =>
			validateReadyForReviewEvidence({
				changed_files: ["x"],
				verification_result: "2 failed, 1 error",
			}),
		).toThrow("run imm-migrate");
	});

	it("accepts current structured evidence", () => {
		expect(validateReadyForReviewEvidence(passedEvidence(["a.ts"]))).toEqual({
			changed_files: ["a.ts"],
			evidence_schema: "structured-v1",
			status: "passed",
			checks: [
				{
					kind: "command",
					command: "bun test",
					status: "passed",
					exit_code: 0,
					summary: "all tests passed cleanly",
				},
			],
			notes: "",
		});
	});

	it("normalizes comma-separated changed files in current input", () => {
		expect(
			validateReadyForReviewEvidence(passedEvidence("a.ts, b.ts")),
		).toMatchObject({
			changed_files: ["a.ts", "b.ts"],
			evidence_schema: "structured-v1",
		});
	});

	it("exposes the canonical step states and transitions", () => {
		expect(STEP_STATES).toEqual([
			"pending",
			"active",
			"probing",
			"executing",
			"ready_for_review",
			"closed",
			"rework_needed",
			"replanning",
		]);
		expect(VALID_TRANSITIONS.pending).toEqual(new Set(["active"]));
		expect(VALID_TRANSITIONS.closed).toEqual(new Set());
		expect(ACTIVE_STATES.has("active")).toBe(true);
		expect(ACTIVE_STATES.has("closed")).toBe(false);
	});

	it("produces ISO 8601 UTC timestamps with Z suffix", () => {
		const ts = utcNow();
		expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
	});
});
