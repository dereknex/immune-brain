import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildRunRecord,
	BenchmarkCollector,
	countQuestions,
	parseAdvisoryMetrics,
	parseRuntimeAdvisoryMetrics,
	deriveRuntimeAdvisoryMetrics,
	parseReportedTokens,
	parseSubagentReport,
	persistRunRecord,
	type ScenarioMetrics,
} from "../scripts/benchmark_eval";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("benchmark eval runner", () => {
	it("does not equate missing lifecycle telemetry with zero user interventions", () => {
		const observed: ScenarioMetrics = {
			scenario_id: "lifecycle", scenario_status: "completed", question_count: 0,
			tool_uses: 2, reported_tokens: 100, reported_tokens_source: "host_runtime", duration_ms: 10,
			quality: { completion: "completed", verifier: "passed", authority: "parent-owned" },
		};
		const recordFor = (lifecycle?: ScenarioMetrics["lifecycle_metrics"]) => buildRunRecord({
			fixture: {
				version: 3, targetName: "immune-brain", runner: { model: "test/model" },
				metrics: { required: ["lifecycle_metrics"] },
				evidence: { claim_scope: "provider_runtime" }, scenarios: [{ id: "lifecycle" }],
			},
			observed: new Map([["lifecycle", { ...observed, lifecycle_metrics: lifecycle }]]),
			exitCode: 0, startedAt: 0, finishedAt: 10,
		});
		const missing = recordFor();
		expect(missing).toMatchObject({ metrics_complete: false, evidence_reason_code: "lifecycle_metrics_missing_or_untrusted" });
		expect(missing.scenarios[0].lifecycle_metrics).toEqual({
			source: "unavailable", user_interventions: null, recovery_attempts: null,
			recovery_successes: null, duplicate_qa_runs: null, scope_revisions: null,
		});
		const captured = {
			source: "host_events" as const, user_interventions: 0, recovery_attempts: 0,
			recovery_successes: 0, duplicate_qa_runs: 0, scope_revisions: 0,
		};
		expect(recordFor(captured)).toMatchObject({ metrics_complete: true, claim_scope: "provider_runtime" });
		for (const invalid of [
			{ ...captured, recovery_successes: 1 },
			{ ...captured, scope_revisions: -1 },
			{ ...captured, user_interventions: null },
			{ ...captured, source: "child_footer" } as never,
		]) expect(recordFor(invalid).metrics_complete).toBe(false);
		expect(recordFor({ ...captured, source: "deterministic_harness" })).toMatchObject({
			metrics_complete: true, claim_scope: "contract_only",
		});
	});

	it("accepts structured foreground Agent details as host runtime telemetry", () => {
		const collector = new BenchmarkCollector("foreground_agent_details");
		collector.consume({
			type: "message_end",
			message: {
				role: "toolResult",
				toolName: "Agent",
				content: [
					{
						type: "text",
						text: "Runtime advisory metrics: child_count=0 | packet_bytes=0 | truncation_count=0",
					},
				],
				details: {
					agentId: "agent-structured",
					description: "Benchmark: entrypoint-routing",
					status: "completed",
					toolUses: 2,
					tokens: "1.4k token",
					durationMs: 1_000,
				},
			},
		});

		expect(collector.metrics().get("entrypoint-routing")).toMatchObject({
			reported_tokens: 1_400,
			reported_tokens_source: "host_runtime",
		});

		collector.consume({
			type: "message_end",
			message: {
				role: "assistant",
				usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
			},
		});
		expect(collector.metrics()).toHaveLength(1);
		expect(parseReportedTokens("1.5k token")).toBe(1_500);
	});

	it("does not promote background text or malformed structured tokens", () => {
		const background = new BenchmarkCollector("foreground_agent_details");
		background.consume({
			type: "message_end",
			message: {
				role: "toolResult",
				toolName: "get_subagent_result",
				content: [
					{
						type: "text",
						text: [
							"Agent: agent-background",
							"Type: Agent | Status: completed | Tool uses: 1 | 2k token | Duration: 1s",
							"Description: Benchmark: background-only",
						].join("\\n"),
					},
				],
			},
		});
		expect(background.metrics()).toHaveLength(0);

		const malformed = new BenchmarkCollector("foreground_agent_details");
		malformed.consume({
			type: "message_end",
			message: {
				role: "toolResult",
				toolName: "Agent",
				content: [],
				details: {
					description: "Benchmark: malformed-tokens",
					status: "completed",
					toolUses: 1,
					tokens: "not-a-token",
					durationMs: 1_000,
				},
			},
		});
		const metric = malformed.metrics().get("malformed-tokens");
		expect(metric).toMatchObject({
			reported_tokens: null,
		});
		expect(metric?.reported_tokens_source).toBeUndefined();
		const record = buildRunRecord({
			fixture: {
				version: 2,
				targetName: "immune-brain",
				runner: {
					model: "test/model",
					resultTransport: "foreground_agent_details",
				},
				scenarios: [{ id: "malformed-tokens" }],
			},
			observed: malformed.metrics(),
			exitCode: 0,
			startedAt: 1_000,
			finishedAt: 2_000,
		});
		expect(record.metrics_complete).toBe(false);
	});

	it("rejects malformed token values, invalid status, and unexpected scenarios", () => {
		const values: unknown[] = [
			0,
			-1,
			1.5,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			"0k",
			"not-a-token",
		];
		const scenarioIds = values.map((_, index) => `malformed-${index}`);
		const collector = new BenchmarkCollector(
			"foreground_agent_details",
			scenarioIds,
		);
		for (const [index, tokens] of values.entries()) {
			collector.consume({
				type: "message_end",
				message: {
					role: "toolResult",
					toolName: "Agent",
					details: {
						description: `Benchmark: ${scenarioIds[index]}`,
						status: "completed",
						toolUses: 1,
						tokens,
						durationMs: 1_000,
					},
				},
			});
		}
		for (const scenarioId of scenarioIds) {
			const metric = collector.metrics().get(scenarioId);
			expect(metric?.reported_tokens).toBeNull();
			expect(metric?.reported_tokens_source).toBeUndefined();
		}

		const missingStatus = new BenchmarkCollector("foreground_agent_details", [
			"missing-status",
		]);
		missingStatus.consume({
			type: "message_end",
			message: {
				role: "toolResult",
				toolName: "Agent",
				details: {
					description: "Benchmark: missing-status",
					tokens: 100,
					toolUses: 1,
					durationMs: 1_000,
				},
			},
		});
		expect(missingStatus.metrics()).toHaveLength(0);

		const invalidStatus = new BenchmarkCollector("foreground_agent_details", [
			"invalid-status",
		]);
		invalidStatus.consume({
			type: "message_end",
			message: {
				role: "toolResult",
				toolName: "Agent",
				details: {
					description: "Benchmark: invalid-status",
					status: "mystery",
					tokens: 100,
					toolUses: 1,
					durationMs: 1_000,
				},
			},
		});
		expect(invalidStatus.metrics().get("invalid-status")).toMatchObject({
			scenario_status: "invalid_status",
		});

		const unknown = new BenchmarkCollector("foreground_agent_details", [
			"known",
		]);
		unknown.consume({
			type: "message_end",
			message: {
				role: "toolResult",
				toolName: "Agent",
				details: {
					description: "Benchmark: unknown",
					status: "completed",
					tokens: 100,
					toolUses: 1,
					durationMs: 1_000,
				},
			},
		});
		const record = buildRunRecord({
			fixture: {
				version: 2,
				targetName: "immune-brain",
				runner: {
					model: "test/model",
					resultTransport: "foreground_agent_details",
				},
				scenarios: [{ id: "known" }],
			},
			observed: unknown.metrics(),
			exitCode: 0,
			startedAt: 1_000,
			finishedAt: 2_000,
		});
		expect(record).toMatchObject({
			metrics_complete: false,
			evidence_reason_code: "unexpected_scenario",
		});
	});

	it("deduplicates transport events but rejects distinct duplicate calls", () => {
		const collector = new BenchmarkCollector("foreground_agent_details", [
			"dedup",
			"duplicate",
		]);
		const result = {
			content: [],
			details: {
				description: "Benchmark: dedup",
				status: "completed",
				tokens: 100,
				toolUses: 1,
				durationMs: 1_000,
			},
		};
		collector.consume({
			type: "tool_execution_end",
			toolName: "Agent",
			toolCallId: "call-dedup",
			result,
		});
		collector.consume({
			type: "message_end",
			message: {
				role: "toolResult",
				toolName: "Agent",
				toolCallId: "call-dedup",
				...result,
			},
		});
		expect(collector.metrics().get("dedup")).toMatchObject({
			scenario_status: "completed",
		});

		collector.consume({
			type: "message_end",
			message: {
				role: "toolResult",
				toolName: "Agent",
				toolCallId: "call-duplicate",
				content: [],
				details: {
					description: "Benchmark: duplicate",
					status: "completed",
					tokens: 100,
					toolUses: 1,
					durationMs: 1_000,
				},
			},
		});
		collector.consume({
			type: "message_end",
			message: {
				role: "toolResult",
				toolName: "Agent",
				toolCallId: "call-duplicate-2",
				content: [],
				details: {
					description: "Benchmark: duplicate",
					status: "completed",
					tokens: 100,
					toolUses: 1,
					durationMs: 1_000,
				},
			},
		});

		const missingId = new BenchmarkCollector("foreground_agent_details", [
			"missing-id",
		]);
		const missingIdResult = {
			content: [],
			details: {
				description: "Benchmark: missing-id",
				status: "completed",
				tokens: 100,
				toolUses: 1,
				durationMs: 1_000,
			},
		};
		missingId.consume({
			type: "tool_execution_end",
			toolName: "Agent",
			result: missingIdResult,
		});
		missingId.consume({
			type: "message_end",
			message: {
				role: "toolResult",
				toolName: "Agent",
				...missingIdResult,
			},
		});
		expect(missingId.metrics().get("missing-id")).toMatchObject({
			scenario_status: "duplicate",
			reported_tokens: null,
		});
	});

	it("parses the host-reported scenario metrics", () => {
		const report = [
			"Agent: agent-123",
			"Type: Agent | Status: completed | Tool uses: 14 | 91.6k token | Context: 3% | Duration: 57.4s",
			"Description: Benchmark: entrypoint-routing",
			"",
			"The scenario completed. Is a follow-up needed?",
		].join("\n");

		expect(parseSubagentReport(report)).toEqual({
			scenario_id: "entrypoint-routing",
			scenario_status: "completed",
			question_count: 1,
			tool_uses: 14,
			reported_tokens: 91_600,
			reported_tokens_source: "child_footer",
			duration_ms: 57_400,
			agent_id: "agent-123",
		});
	});

	it("parses bounded advisory metrics from a scenario footer", () => {
		const report = [
			"Agent: agent-789",
			"Type: Agent | Status: completed | Tool uses: 2 | 12k tokens | Context: 1% | Duration: 2s",
			"Description: Benchmark: advisory-budget",
			"",
			"The scenario completed.",
			"Advisory metrics: child_count=2 | packet_bytes=4096 | truncation_count=1",
		].join("\n");

		expect(parseAdvisoryMetrics(report)).toEqual({
			child_count: 2,
			packet_bytes: 4096,
			truncation_count: 1,
		});
		expect(parseSubagentReport(report)).toMatchObject({
			advisory_metrics: {
				child_count: 2,
				packet_bytes: 4096,
				truncation_count: 1,
			},
			advisory_metrics_source: "child_footer",
		});
	});

	it("parses runtime-derived advisory metrics separately from child footers", () => {
		const report = [
			"Agent: agent-runtime",
			"Type: Agent | Status: completed | Tool uses: 2 | 12k tokens | Context: 1% | Duration: 2s",
			"Description: Benchmark: runtime-metrics",
			"",
			"Runtime advisory metrics: child_count=2 | packet_bytes=4096 | truncation_count=0",
			"Advisory metrics: child_count=99 | packet_bytes=99999 | truncation_count=9",
		].join("\n");

		expect(parseRuntimeAdvisoryMetrics(report)).toEqual({
			child_count: 2,
			packet_bytes: 4096,
			truncation_count: 0,
		});
		expect(parseSubagentReport(report)).toMatchObject({
			advisory_metrics: {
				child_count: 2,
				packet_bytes: 4096,
				truncation_count: 0,
			},
			advisory_metrics_source: "runtime_activation",
		});
	});

	it("derives advisory metrics from runtime activation JSON", () => {
		const payload = {
			dispatch: true,
			candidates: [
				{ candidate_id: "planner-risk" },
				{ candidate_id: "planner-plan" },
			],
			truncation_count: 1,
		};
		expect(deriveRuntimeAdvisoryMetrics(payload)).toEqual({
			child_count: 2,
			packet_bytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
			truncation_count: 1,
		});
	});

	it("supports agent-id mapping and normalized token units", () => {
		const report = [
			"Agent: agent-456",
			"Type: Agent | Status: completed | Tool uses: 4 | 1.25m tokens | Context: 2% | Duration: 850ms",
			"Description: completed worker",
			"",
			"No question here.",
		].join("\n");

		expect(
			parseSubagentReport(report, new Map([["agent-456", "plugin-boundary"]])),
		).toMatchObject({
			scenario_id: "plugin-boundary",
			reported_tokens: 1_250_000,
			duration_ms: 850,
		});
		expect(parseReportedTokens("1,234")).toBe(1_234);
		expect(countQuestions("One? Two？ Done.")).toBe(2);
	});

	it("marks a run incomplete when a fixture scenario is not reported", () => {
		const fixture = {
			version: 2,
			targetName: "immune-brain",
			runner: { model: "test/model" },
			scenarios: [{ id: "reported" }, { id: "missing" }],
		};
		const metric: ScenarioMetrics = {
			scenario_id: "reported",
			scenario_status: "completed",
			question_count: 0,
			tool_uses: 3,
			reported_tokens: 2_000,
			duration_ms: 500,
		};
		const record = buildRunRecord({
			fixture,
			observed: new Map([["reported", metric]]),
			exitCode: 0,
			startedAt: 1_000,
			finishedAt: 2_000,
			now: new Date("2026-07-28T08:00:00.000Z"),
		});

		expect(record.metrics_complete).toBe(false);
		expect(record.scenarios[1]).toEqual({
			scenario_id: "missing",
			scenario_status: "not_reported",
			question_count: 0,
			tool_uses: null,
			reported_tokens: null,
			duration_ms: null,
			lifecycle_metrics: {
				source: "unavailable", user_interventions: null, recovery_attempts: null,
				recovery_successes: null, duplicate_qa_runs: null, scope_revisions: null,
			},
		});
	});

	it("requires declared advisory metrics before marking a run complete", () => {
		const fixture = {
			version: 2,
			targetName: "immune-brain",
			runner: { model: "test/model" },
			metrics: { required: ["advisory_metrics"] },
			scenarios: [{ id: "scenario" }],
		};
		const metric: ScenarioMetrics = {
			scenario_id: "scenario",
			scenario_status: "completed",
			question_count: 0,
			tool_uses: 3,
			reported_tokens: 2_000,
			reported_tokens_source: "host_runtime",
			duration_ms: 500,
			quality: {
				completion: "completed",
				verifier: "passed",
				authority: "parent-owned",
			},
		};
		const incomplete = buildRunRecord({
			fixture,
			observed: new Map([["scenario", metric]]),
			exitCode: 0,
			startedAt: 1_000,
			finishedAt: 2_000,
		});
		expect(incomplete.metrics_complete).toBe(false);

		const missingSource = buildRunRecord({
			fixture,
			observed: new Map([
				[
					"scenario",
					{
						...metric,
						advisory_metrics: {
							child_count: 0,
							packet_bytes: 0,
							truncation_count: 0,
						},
					},
				],
			]),
			exitCode: 0,
			startedAt: 1_000,
			finishedAt: 2_000,
		});
		expect(missingSource.metrics_complete).toBe(false);

		const complete = buildRunRecord({
			fixture,
			observed: new Map([
				[
					"scenario",
					{
						...metric,
						reported_tokens_source: "deterministic_harness",
						advisory_metrics: {
							child_count: 0,
							packet_bytes: 0,
							truncation_count: 0,
						},
						advisory_metrics_source: "deterministic_harness",
					},
				],
			]),
			exitCode: 0,
			startedAt: 1_000,
			finishedAt: 2_000,
		});
		expect(complete.metrics_complete).toBe(true);
		expect(complete.evidence_status).toBe("complete");
		expect(complete.claim_scope).toBe("contract_only");
	});

	it("fails run evidence closed on execution, quality, and source-scope gaps", () => {
		const fixture = {
			version: 2,
			targetName: "immune-brain",
			runner: { model: "test/model" },
			metrics: { required: ["advisory_metrics"] },
			evidence: {
				claim_scope: "provider_runtime" as const,
				runtime_advisory_metrics: "available" as const,
			},
			scenarios: [{ id: "scenario" }],
		};
		const completeMetric: ScenarioMetrics = {
			scenario_id: "scenario",
			scenario_status: "completed",
			question_count: 0,
			tool_uses: 3,
			reported_tokens: 2_000,
			reported_tokens_source: "host_runtime",
			duration_ms: 500,
			advisory_metrics: {
				child_count: 1,
				packet_bytes: 512,
				truncation_count: 0,
			},
			advisory_metrics_source: "runtime_activation",
			quality: {
				completion: "completed",
				verifier: "passed",
				authority: "parent-owned",
			},
		};

		const failed = buildRunRecord({
			fixture,
			observed: new Map([["scenario", completeMetric]]),
			exitCode: 1,
			startedAt: 1_000,
			finishedAt: 2_000,
		});
		expect(failed).toMatchObject({
			metrics_complete: false,
			evidence_status: "incomplete",
			evidence_reason_code: "execution_failed",
		});

		const malformedTokens = buildRunRecord({
			fixture,
			observed: new Map([
				[
					"scenario",
					{
						...completeMetric,
						reported_tokens: "2000" as unknown as number,
					},
				],
			]),
			exitCode: 0,
			startedAt: 1_000,
			finishedAt: 2_000,
		});
		expect(malformedTokens).toMatchObject({
			metrics_complete: false,
			evidence_status: "incomplete",
			evidence_reason_code: "scenario_metrics_missing",
		});

		const missingQuality = buildRunRecord({
			fixture,
			observed: new Map([
				["scenario", { ...completeMetric, quality: undefined }],
			]),
			exitCode: 0,
			startedAt: 1_000,
			finishedAt: 2_000,
		});
		expect(missingQuality).toMatchObject({
			metrics_complete: false,
			evidence_status: "incomplete",
			evidence_reason_code: "scenario_quality_missing",
		});

		const deterministic = buildRunRecord({
			fixture,
			observed: new Map([
				[
					"scenario",
					{
						...completeMetric,
						reported_tokens_source: "deterministic_harness",
						advisory_metrics_source: "deterministic_harness",
					},
				],
			]),
			exitCode: 0,
			startedAt: 1_000,
			finishedAt: 2_000,
		});
		expect(deterministic).toMatchObject({
			metrics_complete: true,
			evidence_status: "complete",
			claim_scope: "contract_only",
		});
	});

	it("classifies an explicit host capability gap as unavailable", () => {
		const fixture = {
			version: 2,
			targetName: "immune-brain",
			runner: { model: "test/model" },
			metrics: { required: ["advisory_metrics"] },
			evidence: {
				claim_scope: "provider_runtime" as const,
				runtime_advisory_metrics: "unavailable" as const,
			},
			scenarios: [{ id: "scenario" }],
		};
		const record = buildRunRecord({
			fixture,
			observed: new Map([
				[
					"scenario",
					{
						scenario_id: "scenario",
						scenario_status: "completed",
						question_count: 0,
						tool_uses: 3,
						reported_tokens: 2_000,
						reported_tokens_source: "host_runtime" as const,
						duration_ms: 500,
					},
				],
			]),
			exitCode: 0,
			startedAt: 1_000,
			finishedAt: 2_000,
		});

		expect(record).toMatchObject({
			schema_version: 2,
			evidence_status: "unavailable",
			evidence_reason_code: "runtime_advisory_metrics_unavailable",
			claim_scope: "provider_runtime",
			metrics_complete: false,
		});
	});

	it("rejects duplicate paired identities in history", () => {
		const directory = mkdtempSync(join(tmpdir(), "benchmark-eval-duplicate-"));
		temporaryDirectories.push(directory);
		const fixture = {
			version: 2,
			targetName: "immune-brain",
			runner: { model: "test/model" },
			scenarios: [],
		};
		const record = buildRunRecord({
			fixture,
			observed: new Map(),
			exitCode: 0,
			startedAt: 100,
			finishedAt: 200,
			comparison: {
				cohort: "u4",
				policy: "bounded-auto",
				source_revision: "working",
				run_index: 1,
				sample_count: 10,
				fixture_hash: "fixture",
				prompt_hash: "prompt",
				workspace_fingerprint: "workspace",
				verifier_fingerprint: "verifier",
			},
		});

		persistRunRecord(record, directory);
		expect(() => persistRunRecord(record, directory)).toThrow(
			"Duplicate benchmark comparison identity",
		);
	});
	it("writes latest.json and appends history.jsonl", () => {
		const directory = mkdtempSync(join(tmpdir(), "benchmark-eval-"));
		temporaryDirectories.push(directory);
		const fixture = {
			version: 2,
			targetName: "immune-brain",
			runner: { model: "test/model" },
			scenarios: [],
		};
		const record = buildRunRecord({
			fixture,
			observed: new Map(),
			exitCode: 0,
			startedAt: 100,
			finishedAt: 200,
		});

		persistRunRecord(record, directory);
		persistRunRecord(record, directory);

		expect(
			JSON.parse(readFileSync(join(directory, "latest.json"), "utf8")),
		).toEqual(record);
		expect(
			readFileSync(join(directory, "history.jsonl"), "utf8").trim().split("\n"),
		).toHaveLength(2);
	});
});
