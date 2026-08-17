import { describe, expect, it } from "bun:test";
import {
	compareBenchmarkRuns,
	type AdvisoryBenchmarkMetrics,
	type BenchmarkRunRecord,
	type ScenarioMetrics,
} from "../scripts/benchmark_eval";

const advisoryMetrics: AdvisoryBenchmarkMetrics = {
	child_count: 2,
	packet_bytes: 2048,
	truncation_count: 0,
};

function scenario(
	id: string,
	tokens: number,
	source: "runtime_activation" | "deterministic_harness" | "child_footer",
): ScenarioMetrics {
	return {
		scenario_id: id,
		scenario_status: "completed",
		question_count: 0,
		tool_uses: 4,
		reported_tokens: tokens,
		reported_tokens_source: {
			runtime_activation: "host_runtime",
			deterministic_harness: "deterministic_harness",
			child_footer: "child_footer",
		}[source] as ScenarioMetrics["reported_tokens_source"],
		duration_ms: 100,
		advisory_metrics: advisoryMetrics,
		advisory_metrics_source: source,
		quality: {
			completion: "completed",
			verifier: "passed",
			authority: "parent-owned",
		},
	};
}

function runs(
	policy: "legacy-auto" | "bounded-auto",
	sourceRevision: string,
	source:
		| "runtime_activation"
		| "deterministic_harness"
		| "child_footer" = "deterministic_harness",
	count = 10,
): BenchmarkRunRecord[] {
	return Array.from({ length: count }, (_, index) => ({
		schema_version: 2,
		run_id: `${policy}-${index + 1}`,
		recorded_at: `2026-07-29T00:00:${String(index).padStart(2, "0")}Z`,
		benchmark: "imm-auto-dispatch-probe",
		benchmark_version: 1,
		model: "test/model",
		cost: "unavailable_by_host",
		exit_code: 0,
		duration_ms: 100,
		metrics_complete: true,
		evidence_status: "complete",
		evidence_reason_code: "complete",
		claim_scope:
			source === "runtime_activation" ? "provider_runtime" : "contract_only",
		comparison: {
			cohort: "u4-fixed-matrix-v1",
			policy,
			source_revision: sourceRevision,
			run_index: index + 1,
			sample_count: count,
			fixture_hash: "fixture-u4-v1",
			prompt_hash: "prompt-u4-v1",
			workspace_fingerprint: "workspace-u4-v1",
			verifier_fingerprint: "verifier-u4-v1",
		},
		scenarios: [
			scenario(
				"brainstorm-elevated",
				policy === "legacy-auto" ? 1_000 + index : 800 + index,
				source,
			),
			scenario(
				"planner-elevated",
				policy === "legacy-auto" ? 1_200 + index : 900 + index,
				source,
			),
		],
	}));
}

describe("benchmark baseline comparison contract", () => {
	it("keeps deterministic harness evidence contract-only", () => {
		const result = compareBenchmarkRuns(
			runs("legacy-auto", "legacy-revision-abc123"),
			runs("bounded-auto", "working-revision-def456"),
		);

		expect(result).toMatchObject({
			comparable: true,
			measurement_status: "comparable",
			claim_scope: "contract_only",
			accepted: false,
			reason_code: "contract_only_evidence",
			pair_count: 10,
			completion_parity: true,
			verifier_parity: true,
			authority_parity: true,
			advisory_metric_parity: true,
		});
		expect(result.current_median_tokens).toBeLessThan(
			result.baseline_median_tokens!,
		);
		expect(result.token_reduction_percent).toBeGreaterThan(0);
	});

	it("accepts a lower provider-runtime median only with parity", () => {
		const result = compareBenchmarkRuns(
			runs("legacy-auto", "legacy-revision-abc123", "runtime_activation"),
			runs("bounded-auto", "working-revision-def456", "runtime_activation"),
		);

		expect(result).toMatchObject({
			comparable: true,
			measurement_status: "comparable",
			claim_scope: "provider_runtime",
			accepted: true,
			reason_code: "lower_median_with_quality_and_metric_parity",
		});
	});

	it("rejects failed executions and scenario-matrix drift across run indexes", () => {
		const failedBaseline = runs(
			"legacy-auto",
			"legacy-revision-abc123",
			"runtime_activation",
		);
		failedBaseline[0].exit_code = 1;
		const failedResult = compareBenchmarkRuns(
			failedBaseline,
			runs("bounded-auto", "working-revision-def456", "runtime_activation"),
		);
		expect(failedResult).toMatchObject({
			comparable: false,
			measurement_status: "incomplete",
			accepted: false,
			reason_code: "run_execution_failed",
		});

		const driftingBaseline = runs(
			"legacy-auto",
			"legacy-revision-abc123",
			"runtime_activation",
		);
		const driftingCurrent = runs(
			"bounded-auto",
			"working-revision-def456",
			"runtime_activation",
		);
		for (const record of [driftingBaseline[1], driftingCurrent[1]]) {
			record.scenarios = record.scenarios.map((scenario) => ({
				...scenario,
				scenario_id: `drifted-${scenario.scenario_id}`,
			}));
		}
		const driftResult = compareBenchmarkRuns(driftingBaseline, driftingCurrent);
		expect(driftResult).toMatchObject({
			comparable: false,
			measurement_status: "incomplete",
			accepted: false,
			reason_code: "scenario_matrix_mismatch",
		});
	});

	it("rejects benchmark execution identity drift in any cohort record", () => {
		for (const field of ["benchmark", "benchmark_version", "model"] as const) {
			const current = runs(
				"bounded-auto",
				"working-revision-def456",
				"runtime_activation",
			);
			if (field === "benchmark_version") current[9].benchmark_version += 1;
			else current[9][field] = `${current[9][field]}-drifted`;

			const result = compareBenchmarkRuns(
				runs("legacy-auto", "legacy-revision-abc123", "runtime_activation"),
				current,
			);
			expect(result).toMatchObject({
				comparable: false,
				measurement_status: "incomplete",
				accepted: false,
				reason_code: "paired_identity_invalid",
			});
		}
	});

	it("rejects malformed advisory metrics despite approved source labels", () => {
		const malformedMetrics = [
			{},
			{ child_count: 1, truncation_count: 0 },
			{ child_count: -1, packet_bytes: 2_048, truncation_count: 0 },
			{ child_count: 1, packet_bytes: Number.NaN, truncation_count: 0 },
		];
		for (const metrics of malformedMetrics) {
			const current = runs(
				"bounded-auto",
				"working-revision-def456",
				"runtime_activation",
			);
			current[9].scenarios[0].advisory_metrics =
				metrics as AdvisoryBenchmarkMetrics;

			const result = compareBenchmarkRuns(
				runs("legacy-auto", "legacy-revision-abc123", "runtime_activation"),
				current,
			);
			expect(result).toMatchObject({
				comparable: false,
				measurement_status: "incomplete",
				accepted: false,
				reason_code: "malformed_advisory_metrics",
			});
		}
	});

	it("rejects malformed reported tokens before median calculation", () => {
		const malformedTokens = [
			"0",
			-1,
			1.5,
			Number.NaN,
			Number.POSITIVE_INFINITY,
		];
		for (const tokens of malformedTokens) {
			const current = runs(
				"bounded-auto",
				"working-revision-def456",
				"runtime_activation",
			);
			current[9].scenarios[0].reported_tokens = tokens as unknown as number;

			const result = compareBenchmarkRuns(
				runs("legacy-auto", "legacy-revision-abc123", "runtime_activation"),
				current,
			);
			expect(result).toMatchObject({
				comparable: false,
				measurement_status: "incomplete",
				accepted: false,
				reason_code: "malformed_reported_tokens",
			});
		}
	});

	it("does not treat equally invalid quality or authority as parity", () => {
		const invalidOutcomes = [
			{ field: "completion", value: "failed", parity: "completion_parity" },
			{ field: "verifier", value: "failed", parity: "verifier_parity" },
			{ field: "authority", value: "child-owned", parity: "authority_parity" },
		] as const;
		for (const invalid of invalidOutcomes) {
			const baseline = runs(
				"legacy-auto",
				"legacy-revision-abc123",
				"runtime_activation",
			);
			const current = runs(
				"bounded-auto",
				"working-revision-def456",
				"runtime_activation",
			);
			for (const record of [...baseline, ...current]) {
				for (const scenario of record.scenarios) {
					scenario.quality = {
						...scenario.quality!,
						[invalid.field]: invalid.value,
					};
				}
			}

			const result = compareBenchmarkRuns(baseline, current);
			expect(result.comparable).toBe(true);
			expect(result.accepted).toBe(false);
			expect(result.reason_code).toBe("quality_or_metric_parity_failed");
			expect(result[invalid.parity]).toBe(false);
		}
	});

	it("rejects an explicit-only or undersampled control as a reduction baseline", () => {
		const undersampled = compareBenchmarkRuns(
			runs("legacy-auto", "legacy-revision-abc123", "deterministic_harness", 9),
			runs(
				"bounded-auto",
				"working-revision-def456",
				"deterministic_harness",
				9,
			),
		);
		expect(undersampled.accepted).toBe(false);
		expect(undersampled.reason).toContain("10");

		const wrongPolicy = runs("legacy-auto", "legacy-revision-abc123");
		wrongPolicy[0].comparison = {
			...wrongPolicy[0].comparison!,
			policy: "explicit-only",
		};
		const policyResult = compareBenchmarkRuns(
			wrongPolicy,
			runs("bounded-auto", "working-revision-def456"),
		);
		expect(policyResult.accepted).toBe(false);
		expect(policyResult.reason).toContain("legacy-auto");
	});

	it("rejects child-authored footer metrics and quality regressions", () => {
		const footerResult = compareBenchmarkRuns(
			runs("legacy-auto", "legacy-revision-abc123", "child_footer"),
			runs("bounded-auto", "working-revision-def456", "child_footer"),
		);
		expect(footerResult.comparable).toBe(false);
		expect(footerResult.measurement_status).toBe("incomplete");
		expect(footerResult.reason_code).toBe("untrusted_metric_source");
		expect(footerResult.advisory_metric_parity).toBe(false);

		const current = runs(
			"bounded-auto",
			"working-revision-def456",
			"runtime_activation",
		);
		current[0].scenarios[0].quality = {
			completion: "completed",
			verifier: "failed",
			authority: "parent-owned",
		};
		const qualityResult = compareBenchmarkRuns(
			runs("legacy-auto", "legacy-revision-abc123", "runtime_activation"),
			current,
		);
		expect(qualityResult.comparable).toBe(true);
		expect(qualityResult.accepted).toBe(false);
		expect(qualityResult.reason_code).toBe("quality_or_metric_parity_failed");
		expect(qualityResult.verifier_parity).toBe(false);
	});

	it("rejects legacy records, duplicate indexes, identity mismatches, and missing quality", () => {
		const legacy = runs(
			"legacy-auto",
			"legacy-revision-abc123",
			"runtime_activation",
		);
		legacy[0] = { ...legacy[0], schema_version: 1 };
		delete legacy[0].evidence_status;
		delete legacy[0].claim_scope;
		const legacyResult = compareBenchmarkRuns(
			legacy,
			runs("bounded-auto", "working-revision-def456", "runtime_activation"),
		);
		expect(legacyResult.reason_code).toBe("legacy_record_missing_evidence");

		const duplicate = runs(
			"legacy-auto",
			"legacy-revision-abc123",
			"runtime_activation",
		);
		duplicate[1].comparison = {
			...duplicate[1].comparison!,
			run_index: 1,
		};
		const duplicateResult = compareBenchmarkRuns(
			duplicate,
			runs("bounded-auto", "working-revision-def456", "runtime_activation"),
		);
		expect(duplicateResult.reason_code).toBe("paired_identity_invalid");

		const mismatched = runs(
			"bounded-auto",
			"working-revision-def456",
			"runtime_activation",
		);
		for (const record of mismatched) {
			record.comparison = {
				...record.comparison!,
				prompt_hash: "different-prompt",
			};
		}
		const mismatchResult = compareBenchmarkRuns(
			runs("legacy-auto", "legacy-revision-abc123", "runtime_activation"),
			mismatched,
		);
		expect(mismatchResult.reason_code).toBe("paired_identity_mismatch");

		const missingQuality = runs(
			"bounded-auto",
			"working-revision-def456",
			"runtime_activation",
		);
		missingQuality[0].scenarios[0].quality = undefined;
		const qualityResult = compareBenchmarkRuns(
			runs("legacy-auto", "legacy-revision-abc123", "runtime_activation"),
			missingQuality,
		);
		expect(qualityResult.reason_code).toBe("scenario_quality_or_token_missing");
	});
});
