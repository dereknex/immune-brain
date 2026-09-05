#!/usr/bin/env bun
import { spawn } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

export type AdvisoryMetricsSource =
	| "runtime_activation"
	| "deterministic_harness"
	| "child_footer";

export type ReportedTokensSource =
	| "host_runtime"
	| "deterministic_harness"
	| "child_footer";

export type BenchmarkEvidenceStatus = "complete" | "unavailable" | "incomplete";

export type BenchmarkMeasurementStatus =
	| "comparable"
	| "unavailable"
	| "incomplete";

export type BenchmarkClaimScope = "provider_runtime" | "contract_only";

export interface AdvisoryBenchmarkMetrics {
	child_count: number;
	packet_bytes: number;
	truncation_count: number;
}

export interface BenchmarkScenarioQuality {
	completion: string;
	verifier: string;
	authority: string;
}

export type BenchmarkPolicy =
	| "legacy-auto"
	| "bounded-auto"
	| "explicit-subagents"
	| "explicit-only";

export interface BenchmarkComparisonIdentity {
	cohort: string;
	policy: BenchmarkPolicy;
	source_revision: string;
	run_index: number;
	sample_count: number;
	fixture_hash?: string;
	prompt_hash?: string;
	workspace_fingerprint?: string;
	verifier_fingerprint?: string;
}

export interface LifecycleBenchmarkMetrics {
	source: "host_events" | "deterministic_harness" | "unavailable";
	user_interventions: number | null;
	recovery_attempts: number | null;
	recovery_successes: number | null;
	duplicate_qa_runs: number | null;
	scope_revisions: number | null;
}

export interface ScenarioMetrics {
	scenario_id: string;
	scenario_status: string;
	question_count: number;
	tool_uses: number | null;
	reported_tokens: number | null;
	duration_ms: number | null;
	reported_tokens_source?: ReportedTokensSource;
	advisory_metrics?: AdvisoryBenchmarkMetrics;
	advisory_metrics_source?: AdvisoryMetricsSource;
	quality?: BenchmarkScenarioQuality;
	lifecycle_metrics?: LifecycleBenchmarkMetrics;
}

interface BenchmarkFixture {
	version: number;
	targetName: string;
	runner: { model: string; resultTransport?: "foreground_agent_details"; requiresInteractiveHost?: boolean };
	metrics?: { cost?: string; required?: string[] };
	evidence?: {
		claim_scope?: BenchmarkClaimScope;
		runtime_advisory_metrics?: "available" | "unavailable";
	};
	comparison?: BenchmarkComparisonIdentity;
	scenarios: Array<{ id: string }>;
}

interface ParsedSubagentReport extends ScenarioMetrics {
	agent_id?: string;
}

export interface BenchmarkRunRecord {
	schema_version: 1 | 2;
	run_id: string;
	recorded_at: string;
	benchmark: string;
	benchmark_version: number;
	model: string;
	cost: string;
	exit_code: number;
	duration_ms: number;
	metrics_complete: boolean;
	evidence_status?: BenchmarkEvidenceStatus;
	evidence_reason_code?: string;
	claim_scope?: BenchmarkClaimScope;
	comparison?: BenchmarkComparisonIdentity;
	scenarios: ScenarioMetrics[];
}

export interface BenchmarkComparisonResult {
	comparable: boolean;
	measurement_status: BenchmarkMeasurementStatus;
	claim_scope: BenchmarkClaimScope | null;
	reason_code: string;
	accepted: boolean;
	reason: string;
	pair_count: number;
	baseline_median_tokens: number | null;
	current_median_tokens: number | null;
	token_reduction_percent: number | null;
	completion_parity: boolean;
	verifier_parity: boolean;
	authority_parity: boolean;
	advisory_metric_parity: boolean;
}

interface BuildRunRecordOptions {
	fixture: BenchmarkFixture;
	observed: ReadonlyMap<string, ScenarioMetrics>;
	exitCode: number;
	startedAt: number;
	finishedAt: number;
	now?: Date;
	comparison?: BenchmarkComparisonIdentity;
}

type JsonRecord = Record<string, unknown>;

type ToolResult = {
	toolCallId?: string;
	toolName: string;
	result: JsonRecord;
};

const DEFAULT_FIXTURE = "tests/fixtures/immune-brain-benchmark.json";
const DEFAULT_RESULTS_DIR = "benchmark-results/immune-brain";

function asRecord(value: unknown): JsonRecord | undefined {
	return typeof value === "object" && value !== null
		? (value as JsonRecord)
		: undefined;
}

function textContent(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.flatMap((item) => {
			const record = asRecord(item);
			return record?.type === "text" && typeof record.text === "string"
				? [record.text]
				: [];
		})
		.join("\n");
}

export function countQuestions(text: string): number {
	return (text.match(/[?？]/g) ?? []).length;
}

export function parseReportedTokens(value: string): number | null {
	const match = /^([\d.]+)\s*([km]?)(?:\s+tokens?)?$/i.exec(
		value.trim().replaceAll(",", ""),
	);
	if (!match) return null;
	const number = Number(match[1]);
	if (!Number.isFinite(number)) return null;
	let scale = 1;
	if (match[2].toLowerCase() === "k") scale = 1_000;
	if (match[2].toLowerCase() === "m") scale = 1_000_000;
	return Math.round(number * scale);
}

export function parseAdvisoryMetrics(
	text: string,
): AdvisoryBenchmarkMetrics | undefined {
	const match =
		/^Advisory metrics:\s*child_count=(\d+)\s*\|\s*packet_bytes=(\d+)\s*\|\s*truncation_count=(\d+)\s*$/im.exec(
			text,
		);
	if (!match) return undefined;
	return {
		child_count: Number(match[1]),
		packet_bytes: Number(match[2]),
		truncation_count: Number(match[3]),
	};
}

export function parseRuntimeAdvisoryMetrics(
	text: string,
): AdvisoryBenchmarkMetrics | undefined {
	const match =
		/^Runtime advisory metrics:\s*child_count=(\d+)\s*\|\s*packet_bytes=(\d+)\s*\|\s*truncation_count=(\d+)\s*$/im.exec(
			text,
		);
	if (!match) return undefined;
	return {
		child_count: Number(match[1]),
		packet_bytes: Number(match[2]),
		truncation_count: Number(match[3]),
	};
}

export function deriveRuntimeAdvisoryMetrics(
	payload: unknown,
): AdvisoryBenchmarkMetrics | undefined {
	const record = asRecord(payload);
	if (!record) return undefined;
	const candidates = Array.isArray(record.candidates)
		? record.candidates
		: Array.isArray(record.children)
			? record.children
			: undefined;
	if (!candidates) return undefined;
	const truncationCount =
		typeof record.truncation_count === "number" &&
		Number.isInteger(record.truncation_count) &&
		record.truncation_count >= 0
			? record.truncation_count
			: 0;
	return {
		child_count: candidates.length,
		packet_bytes: Buffer.byteLength(JSON.stringify(record), "utf8"),
		truncation_count: truncationCount,
	};
}

function parseDuration(value: string, unit: string): number | null {
	const number = Number(value);
	if (!Number.isFinite(number)) return null;
	if (unit.toLowerCase() === "m") return Math.round(number * 60_000);
	if (unit.toLowerCase() === "s") return Math.round(number * 1_000);
	return Math.round(number);
}

export function parseSubagentReport(
	text: string,
	scenarioByAgent: ReadonlyMap<string, string> = new Map(),
): ParsedSubagentReport | undefined {
	const agentId = /^Agent:\s*(\S+)/m.exec(text)?.[1];
	const descriptionMatch = /^Description:\s*Benchmark:\s*([^\s]+)\s*$/im.exec(
		text,
	);
	const scenarioId =
		descriptionMatch?.[1] ??
		(agentId ? scenarioByAgent.get(agentId) : undefined);
	const header =
		/^Type:.*?Status:\s*([^|]+)\|\s*Tool uses:\s*(\d+)\s*\|\s*([^|]+?)\s+tokens?\s*\|.*?Duration:\s*([\d.]+)(ms|s|m)\s*$/im.exec(
			text,
		);
	if (!scenarioId || !header) return undefined;

	let bodyStart = text.length;
	if (descriptionMatch)
		bodyStart = descriptionMatch.index + descriptionMatch[0].length;
	else {
		const divider = text.indexOf("\n\n");
		if (divider >= 0) bodyStart = divider + 2;
	}

	const runtimeAdvisoryMetrics = parseRuntimeAdvisoryMetrics(
		text.slice(bodyStart),
	);
	const advisoryMetrics =
		runtimeAdvisoryMetrics || parseAdvisoryMetrics(text.slice(bodyStart));
	const advisoryMetricsSource = runtimeAdvisoryMetrics
		? "runtime_activation"
		: advisoryMetrics
			? "child_footer"
			: undefined;
	return {
		scenario_id: scenarioId,
		scenario_status: header[1].trim().toLowerCase(),
		question_count: countQuestions(text.slice(bodyStart)),
		tool_uses: Number(header[2]),
		reported_tokens: parseReportedTokens(header[3]),
		reported_tokens_source: "child_footer",
		duration_ms: parseDuration(header[4], header[5]),
		...(advisoryMetrics ? { advisory_metrics: advisoryMetrics } : {}),
		...(advisoryMetricsSource
			? {
					advisory_metrics_source:
						advisoryMetricsSource as AdvisoryMetricsSource,
				}
			: {}),
		agent_id: agentId,
	};
}

function median(values: number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
}

function comparisonFailure(
	reason: string,
	pairCount = 0,
	measurementStatus: BenchmarkMeasurementStatus = "incomplete",
	reasonCode = "comparison_incomplete",
	claimScope: BenchmarkClaimScope | null = null,
): BenchmarkComparisonResult {
	return {
		comparable: false,
		measurement_status: measurementStatus,
		claim_scope: claimScope,
		reason_code: reasonCode,
		accepted: false,
		reason,
		pair_count: pairCount,
		baseline_median_tokens: null,
		current_median_tokens: null,
		token_reduction_percent: null,
		completion_parity: false,
		verifier_parity: false,
		authority_parity: false,
		advisory_metric_parity: false,
	};
}

const pairedIdentityFields = [
	"cohort",
	"sample_count",
	"fixture_hash",
	"prompt_hash",
	"workspace_fingerprint",
	"verifier_fingerprint",
] as const;

function completeReportedTokens(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function completeAdvisoryMetrics(
	metrics: AdvisoryBenchmarkMetrics | undefined,
): metrics is AdvisoryBenchmarkMetrics {
	return Boolean(
		metrics &&
			Number.isInteger(metrics.child_count) &&
			metrics.child_count >= 0 &&
			Number.isInteger(metrics.packet_bytes) &&
			metrics.packet_bytes >= 0 &&
			Number.isInteger(metrics.truncation_count) &&
			metrics.truncation_count >= 0,
	);
}

function completeLifecycleMetrics(metrics: LifecycleBenchmarkMetrics | undefined): boolean {
	return Boolean(metrics && ["host_events", "deterministic_harness"].includes(metrics.source) &&
		[metrics.user_interventions, metrics.recovery_attempts, metrics.recovery_successes,
			metrics.duplicate_qa_runs, metrics.scope_revisions]
			.every((value) => typeof value === "number" && Number.isInteger(value) && value >= 0) &&
		metrics.recovery_successes! <= metrics.recovery_attempts!);
}

function completeQuality(
	quality: BenchmarkScenarioQuality | undefined,
): quality is BenchmarkScenarioQuality {
	return Boolean(
		quality &&
			quality.completion.trim() &&
			quality.verifier.trim() &&
			quality.authority.trim(),
	);
}

function validateRunSet(
	records: readonly BenchmarkRunRecord[],
	policy: BenchmarkPolicy,
): string | undefined {
	const first = records[0];
	const firstIdentity = first?.comparison;
	if (!first || !firstIdentity)
		return "Both run sets require comparison identity.";
	const indexes = new Set<number>();
	for (const record of records) {
		const identity = record.comparison;
		if (
			record.schema_version !== 2 ||
			record.evidence_status === undefined ||
			record.claim_scope === undefined
		)
			return "Schema-v1 or evidence-incomplete records cannot support a provider comparison.";
		if (!identity) return "Every paired run requires comparison identity.";
		if (
			record.benchmark !== first.benchmark ||
			record.benchmark_version !== first.benchmark_version ||
			record.model !== first.model
		)
			return "Every run in a cohort must share the same benchmark, version, and model.";
		if (identity.policy !== policy)
			return `The comparison requires ${policy} records.`;
		if (identity.sample_count !== records.length)
			return "Every run must declare the complete paired sample count.";
		if (
			!Number.isInteger(identity.run_index) ||
			identity.run_index < 1 ||
			identity.run_index > records.length ||
			indexes.has(identity.run_index)
		)
			return "Paired runs require unique contiguous run indexes.";
		indexes.add(identity.run_index);
		if (
			!identity.source_revision ||
			pairedIdentityFields.some((field) => {
				const value = identity[field];
				return field === "sample_count"
					? typeof value !== "number" || !Number.isInteger(value)
					: typeof value !== "string" || value.length === 0;
			})
		)
			return "Paired runs require complete fixture, prompt, workspace, and verifier identity.";
		for (const field of pairedIdentityFields) {
			if (identity[field] !== firstIdentity[field])
				return "Every run in a cohort must share the same paired identity.";
		}
	}
	if (indexes.size !== records.length)
		return "Paired runs require unique contiguous run indexes.";
	return undefined;
}

export function compareBenchmarkRuns(
	baseline: readonly BenchmarkRunRecord[],
	current: readonly BenchmarkRunRecord[],
): BenchmarkComparisonResult {
	const minimumSamples = 10;
	if (baseline.length === 0 || current.length === 0)
		return comparisonFailure(
			"A legacy-auto and bounded-auto cohort are both required.",
			Math.min(baseline.length, current.length),
			"unavailable",
			"baseline_cohort_unavailable",
		);
	if (baseline.length !== current.length || baseline.length < minimumSamples)
		return comparisonFailure(
			`At least ${minimumSamples} equally sized paired runs are required.`,
			Math.min(baseline.length, current.length),
			"incomplete",
			"minimum_pair_count",
		);

	const allRecords = [...baseline, ...current];
	if (
		allRecords.some(
			(record) =>
				record.schema_version !== 2 ||
				record.evidence_status === undefined ||
				record.claim_scope === undefined,
		)
	)
		return comparisonFailure(
			"Schema-v1 or evidence-incomplete records cannot support a provider comparison.",
			baseline.length,
			"incomplete",
			"legacy_record_missing_evidence",
		);
	if (allRecords.some((record) => record.evidence_status === "unavailable"))
		return comparisonFailure(
			"A declared host capability is unavailable for the paired evidence.",
			baseline.length,
			"unavailable",
			"runtime_advisory_metrics_unavailable",
		);
	if (allRecords.some((record) => record.evidence_status !== "complete"))
		return comparisonFailure(
			"Every paired run must have complete evidence.",
			baseline.length,
			"incomplete",
			"run_evidence_incomplete",
		);
	if (allRecords.some((record) => !record.metrics_complete))
		return comparisonFailure(
			"Every paired run must declare complete metrics.",
			baseline.length,
			"incomplete",
			"run_metrics_incomplete",
		);
	if (allRecords.some((record) => record.exit_code !== 0))
		return comparisonFailure(
			"Failed benchmark executions cannot support a paired comparison.",
			baseline.length,
			"incomplete",
			"run_execution_failed",
		);

	const claimScopes = new Set(allRecords.map((record) => record.claim_scope));
	if (
		claimScopes.size !== 1 ||
		(!claimScopes.has("provider_runtime") && !claimScopes.has("contract_only"))
	)
		return comparisonFailure(
			"Paired runs must share a valid claim scope.",
			baseline.length,
			"incomplete",
			"claim_scope_mismatch",
		);
	const claimScope = [...claimScopes][0] as BenchmarkClaimScope;
	const baselineIdentity = baseline[0].comparison;
	const currentIdentity = current[0].comparison;
	const baselineValidation = validateRunSet(baseline, "legacy-auto");
	const currentValidation = validateRunSet(current, "bounded-auto");
	if (baselineValidation || currentValidation)
		return comparisonFailure(
			baselineValidation ?? currentValidation ?? "Paired identity is invalid.",
			baseline.length,
			"incomplete",
			baselineValidation?.includes("Schema-v1") ||
				currentValidation?.includes("Schema-v1")
				? "legacy_record_missing_evidence"
				: "paired_identity_invalid",
			claimScope,
		);
	if (!baselineIdentity || !currentIdentity)
		return comparisonFailure(
			"Both run sets require comparison identity.",
			baseline.length,
			"incomplete",
			"paired_identity_missing",
			claimScope,
		);
	if (baselineIdentity.source_revision === currentIdentity.source_revision)
		return comparisonFailure(
			"Baseline and current runs require distinct source revisions.",
			baseline.length,
			"incomplete",
			"source_revision_not_distinct",
			claimScope,
		);
	if (
		baseline[0].benchmark !== current[0].benchmark ||
		baseline[0].benchmark_version !== current[0].benchmark_version ||
		baseline[0].model !== current[0].model ||
		pairedIdentityFields.some(
			(field) => baselineIdentity[field] !== currentIdentity[field],
		)
	)
		return comparisonFailure(
			"Baseline and current runs must share the same scenario and execution identity.",
			baseline.length,
			"incomplete",
			"paired_identity_mismatch",
			claimScope,
		);

	const expectedScenarioIds = baseline[0].scenarios
		.map((scenario) => scenario.scenario_id)
		.sort();
	if (new Set(expectedScenarioIds).size !== expectedScenarioIds.length)
		return comparisonFailure(
			"Scenario IDs must be unique within every run.",
			baseline.length,
			"incomplete",
			"duplicate_scenario_id",
			claimScope,
		);
	const expectedScenarioMatrix = JSON.stringify(expectedScenarioIds);
	for (const record of allRecords) {
		const scenarioIds = record.scenarios
			.map((scenario) => scenario.scenario_id)
			.sort();
		if (new Set(scenarioIds).size !== scenarioIds.length)
			return comparisonFailure(
				"Scenario IDs must be unique within every run.",
				baseline.length,
				"incomplete",
				"duplicate_scenario_id",
				claimScope,
			);
		if (JSON.stringify(scenarioIds) !== expectedScenarioMatrix)
			return comparisonFailure(
				"Every paired run must share the same scenario matrix.",
				baseline.length,
				"incomplete",
				"scenario_matrix_mismatch",
				claimScope,
			);
	}

	const baselineByIndex = new Map<number, BenchmarkRunRecord>();
	for (const record of baseline) {
		const index = record.comparison?.run_index;
		if (index === undefined)
			return comparisonFailure(
				"Every paired run requires a run index.",
				baseline.length,
				"incomplete",
				"paired_index_missing",
				claimScope,
			);
		baselineByIndex.set(index, record);
	}
	const currentByIndex = new Map<number, BenchmarkRunRecord>();
	for (const record of current) {
		const index = record.comparison?.run_index;
		if (index === undefined)
			return comparisonFailure(
				"Every paired run requires a run index.",
				baseline.length,
				"incomplete",
				"paired_index_missing",
				claimScope,
			);
		currentByIndex.set(index, record);
	}
	const baselineTokens: number[] = [];
	const currentTokens: number[] = [];
	let completionParity = true;
	let verifierParity = true;
	let authorityParity = true;
	let advisoryMetricParity = true;
	for (const [index, baselineRecord] of baselineByIndex) {
		const currentRecord = currentByIndex.get(index);
		if (!currentRecord)
			return comparisonFailure(
				"Paired runs require matching run indexes.",
				baseline.length,
				"incomplete",
				"paired_index_mismatch",
				claimScope,
			);
		const baselineScenarios = new Map(
			baselineRecord.scenarios.map((scenario) => [
				scenario.scenario_id,
				scenario,
			]),
		);
		const currentScenarios = new Map(
			currentRecord.scenarios.map((scenario) => [
				scenario.scenario_id,
				scenario,
			]),
		);
		if (
			baselineScenarios.size !== baselineRecord.scenarios.length ||
			currentScenarios.size !== currentRecord.scenarios.length
		)
			return comparisonFailure(
				"Scenario IDs must be unique within every run.",
				baseline.length,
				"incomplete",
				"duplicate_scenario_id",
				claimScope,
			);
		if (
			baselineScenarios.size !== currentScenarios.size ||
			[...baselineScenarios.keys()].some(
				(scenarioId) => !currentScenarios.has(scenarioId),
			)
		)
			return comparisonFailure(
				"Paired runs require identical scenario IDs.",
				baseline.length,
				"incomplete",
				"scenario_matrix_mismatch",
				claimScope,
			);
		for (const [scenarioId, baselineScenario] of baselineScenarios) {
			const currentScenario = currentScenarios.get(scenarioId);
			if (!currentScenario)
				return comparisonFailure(
					"Paired runs require identical scenario IDs.",
					baseline.length,
					"incomplete",
					"scenario_matrix_mismatch",
					claimScope,
				);
			if (
				!completeReportedTokens(baselineScenario.reported_tokens) ||
				!completeReportedTokens(currentScenario.reported_tokens)
			)
				return comparisonFailure(
					"Every paired scenario requires a valid reported token count.",
					baseline.length,
					"incomplete",
					"malformed_reported_tokens",
					claimScope,
				);
			if (
				!completeQuality(baselineScenario.quality) ||
				!completeQuality(currentScenario.quality)
			)
				return comparisonFailure(
					"Every paired scenario requires reported tokens and complete quality outcomes.",
					baseline.length,
					"incomplete",
					"scenario_quality_or_token_missing",
					claimScope,
				);
			if (
				!completeAdvisoryMetrics(baselineScenario.advisory_metrics) ||
				!completeAdvisoryMetrics(currentScenario.advisory_metrics)
			)
				return comparisonFailure(
					"Every paired scenario requires structurally valid advisory metrics.",
					baseline.length,
					"incomplete",
					"malformed_advisory_metrics",
					claimScope,
				);
			const providerSourcesValid =
				baselineScenario.reported_tokens_source === "host_runtime" &&
				currentScenario.reported_tokens_source === "host_runtime" &&
				baselineScenario.advisory_metrics_source === "runtime_activation" &&
				currentScenario.advisory_metrics_source === "runtime_activation";
			const contractSourcesValid =
				baselineScenario.advisory_metrics_source !== undefined &&
				currentScenario.advisory_metrics_source !== undefined &&
				baselineScenario.advisory_metrics_source !== "child_footer" &&
				currentScenario.advisory_metrics_source !== "child_footer";
			if (
				(claimScope === "provider_runtime" && !providerSourcesValid) ||
				(claimScope === "contract_only" && !contractSourcesValid)
			)
				return comparisonFailure(
					"Paired metrics do not have an approved evidence source.",
					baseline.length,
					"incomplete",
					"untrusted_metric_source",
					claimScope,
				);
			baselineTokens.push(baselineScenario.reported_tokens);
			currentTokens.push(currentScenario.reported_tokens);
			completionParity &&=
				baselineScenario.scenario_status === "completed" &&
				currentScenario.scenario_status === "completed" &&
				baselineScenario.quality.completion === "completed" &&
				currentScenario.quality.completion === "completed" &&
				baselineScenario.quality.completion ===
					currentScenario.quality.completion;
			verifierParity &&=
				baselineScenario.quality.verifier === "passed" &&
				currentScenario.quality.verifier === "passed" &&
				baselineScenario.quality.verifier === currentScenario.quality.verifier;
			authorityParity &&=
				baselineScenario.quality.authority === "parent-owned" &&
				currentScenario.quality.authority === "parent-owned" &&
				baselineScenario.quality.authority ===
					currentScenario.quality.authority;
			advisoryMetricParity &&=
				completeAdvisoryMetrics(baselineScenario.advisory_metrics) &&
				completeAdvisoryMetrics(currentScenario.advisory_metrics);
		}
	}
	const baselineMedian = median(baselineTokens);
	const currentMedian = median(currentTokens);
	const tokenReductionPercent =
		baselineMedian > 0
			? ((baselineMedian - currentMedian) / baselineMedian) * 100
			: null;
	const accepted =
		claimScope === "provider_runtime" &&
		completionParity &&
		verifierParity &&
		authorityParity &&
		advisoryMetricParity &&
		currentMedian < baselineMedian;
	let reasonCode: string;
	let reason: string;
	if (claimScope === "contract_only") {
		reasonCode = "contract_only_evidence";
		reason =
			"Deterministic evidence validates comparator behavior but cannot establish provider token reduction.";
	} else if (accepted) {
		reasonCode = "lower_median_with_quality_and_metric_parity";
		reason =
			"Bounded auto has a lower paired provider median with quality and metric parity.";
	} else if (
		!completionParity ||
		!verifierParity ||
		!authorityParity ||
		!advisoryMetricParity
	) {
		reasonCode = "quality_or_metric_parity_failed";
		reason = "Paired quality or advisory metric parity is incomplete.";
	} else {
		reasonCode = "no_token_reduction";
		reason = "Bounded auto did not produce a lower paired median.";
	}
	return {
		comparable: true,
		measurement_status: "comparable",
		claim_scope: claimScope,
		reason_code: reasonCode,
		accepted,
		reason,
		pair_count: baseline.length,
		baseline_median_tokens: baselineMedian,
		current_median_tokens: currentMedian,
		token_reduction_percent: tokenReductionPercent,
		completion_parity: completionParity,
		verifier_parity: verifierParity,
		authority_parity: authorityParity,
		advisory_metric_parity: advisoryMetricParity,
	};
}

export function buildRunRecord(
	options: BuildRunRecordOptions,
): BenchmarkRunRecord {
	const { fixture, observed, exitCode, startedAt, finishedAt } = options;
	const scenarios: ScenarioMetrics[] = fixture.scenarios.map(({ id }) => {
		const observedScenario = observed.get(id);
		return {
			scenario_id: id,
			scenario_status: "not_reported",
			question_count: 0,
			tool_uses: null,
			reported_tokens: null,
			duration_ms: null,
			...observedScenario,
			lifecycle_metrics: observedScenario?.lifecycle_metrics ?? {
				source: "unavailable",
				user_interventions: null,
				recovery_attempts: null,
				recovery_successes: null,
				duplicate_qa_runs: null,
				scope_revisions: null,
			},
		};
	});
	const requiredMetrics = new Set(fixture.metrics?.required ?? []);
	const expectedScenarioIds = new Set(fixture.scenarios.map(({ id }) => id));
	const hasUnexpectedScenario = [...observed.keys()].some(
		(scenarioId) => !expectedScenarioIds.has(scenarioId),
	);
	const basicMetricsComplete =
		!hasUnexpectedScenario &&
		scenarios.every(
			(scenario) =>
				scenario.scenario_status === "completed" &&
				scenario.tool_uses !== null &&
				completeReportedTokens(scenario.reported_tokens) &&
				scenario.duration_ms !== null,
		);
	const qualityComplete = scenarios.every((scenario) =>
		completeQuality(scenario.quality),
	);
	const reportedTokenSourcesComplete = scenarios.every(
		(scenario) =>
			scenario.reported_tokens_source === "host_runtime" ||
			scenario.reported_tokens_source === "deterministic_harness",
	);
	const advisoryMetricsComplete = scenarios.every(
		(scenario) =>
			completeAdvisoryMetrics(scenario.advisory_metrics) &&
			(scenario.advisory_metrics_source === "runtime_activation" ||
				scenario.advisory_metrics_source === "deterministic_harness"),
	);
	const deterministicEvidence = scenarios.some(
		(scenario) =>
			scenario.reported_tokens_source === "deterministic_harness" ||
			scenario.advisory_metrics_source === "deterministic_harness" ||
			scenario.lifecycle_metrics?.source === "deterministic_harness",
	);
	const claimScope: BenchmarkClaimScope = deterministicEvidence
		? "contract_only"
		: (fixture.evidence?.claim_scope ?? "contract_only");
	const providerSourcesComplete = scenarios.every(
		(scenario) =>
			scenario.reported_tokens_source === "host_runtime" &&
			(!requiredMetrics.has("advisory_metrics") ||
				scenario.advisory_metrics_source === "runtime_activation"),
	);
	const sourceScopeComplete =
		claimScope !== "provider_runtime" || providerSourcesComplete;
	const lifecycleMetricsComplete = !requiredMetrics.has("lifecycle_metrics") ||
		scenarios.every((scenario) => completeLifecycleMetrics(scenario.lifecycle_metrics) &&
			(claimScope !== "provider_runtime" || scenario.lifecycle_metrics?.source === "host_events"));
	const metricsComplete =
		exitCode === 0 &&
		lifecycleMetricsComplete &&
		basicMetricsComplete &&
		qualityComplete &&
		reportedTokenSourcesComplete &&
		(!requiredMetrics.has("advisory_metrics") || advisoryMetricsComplete) &&
		sourceScopeComplete;
	const explicitAdvisoryUnavailable =
		fixture.evidence?.runtime_advisory_metrics === "unavailable";
	let evidenceStatus: BenchmarkEvidenceStatus;
	let evidenceReasonCode: string;
	if (hasUnexpectedScenario) {
		evidenceStatus = "incomplete";
		evidenceReasonCode = "unexpected_scenario";
	} else if (!basicMetricsComplete) {
		evidenceStatus = "incomplete";
		evidenceReasonCode = "scenario_metrics_missing";
	} else if (explicitAdvisoryUnavailable) {
		evidenceStatus = "unavailable";
		evidenceReasonCode = "runtime_advisory_metrics_unavailable";
	} else if (exitCode !== 0) {
		evidenceStatus = "incomplete";
		evidenceReasonCode = "execution_failed";
	} else if (!lifecycleMetricsComplete) {
		evidenceStatus = "incomplete";
		evidenceReasonCode = "lifecycle_metrics_missing_or_untrusted";
	} else if (!qualityComplete) {
		evidenceStatus = "incomplete";
		evidenceReasonCode = "scenario_quality_missing";
	} else if (!reportedTokenSourcesComplete) {
		evidenceStatus = "incomplete";
		evidenceReasonCode = "reported_token_source_missing_or_untrusted";
	} else if (
		requiredMetrics.has("advisory_metrics") &&
		!advisoryMetricsComplete
	) {
		evidenceStatus = "incomplete";
		evidenceReasonCode = "advisory_metrics_missing_or_untrusted";
	} else if (!sourceScopeComplete) {
		evidenceStatus = "incomplete";
		evidenceReasonCode = "claim_scope_source_mismatch";
	} else {
		evidenceStatus = "complete";
		evidenceReasonCode = "complete";
	}
	const recordedAt = (options.now ?? new Date(finishedAt)).toISOString();

	return {
		schema_version: 2,
		run_id: recordedAt.replaceAll(":", "-").replace(".000Z", "Z"),
		recorded_at: recordedAt,
		benchmark: fixture.targetName,
		benchmark_version: fixture.version,
		model: fixture.runner.model,
		cost: fixture.metrics?.cost ?? "unavailable_by_host",
		exit_code: exitCode,
		duration_ms: Math.max(0, finishedAt - startedAt),
		metrics_complete: metricsComplete && !explicitAdvisoryUnavailable,
		evidence_status: evidenceStatus,
		evidence_reason_code: evidenceReasonCode,
		claim_scope: claimScope,
		...(options.comparison ? { comparison: options.comparison } : {}),
		scenarios,
	};
}

function comparisonKey(comparison: BenchmarkComparisonIdentity): string {
	return JSON.stringify(comparison);
}

export function persistRunRecord(
	record: BenchmarkRunRecord,
	resultsDir: string,
): void {
	mkdirSync(resultsDir, { recursive: true });
	const latestPath = resolve(resultsDir, "latest.json");
	const historyPath = resolve(resultsDir, "history.jsonl");
	if (record.comparison && existsSync(historyPath)) {
		const key = comparisonKey(record.comparison);
		const duplicate = readFileSync(historyPath, "utf8")
			.split("\n")
			.filter(Boolean)
			.some((line) => {
				try {
					const historical = JSON.parse(line) as BenchmarkRunRecord;
					return historical.comparison
						? comparisonKey(historical.comparison) === key
						: false;
				} catch {
					return false;
				}
			});
		if (duplicate)
			throw new Error("Duplicate benchmark comparison identity in history.");
	}
	const temporaryPath = `${latestPath}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
	renameSync(temporaryPath, latestPath);
	appendFileSync(historyPath, `${JSON.stringify(record)}\n`, "utf8");
}

function extractToolResult(event: unknown): ToolResult | undefined {
	const record = asRecord(event);
	if (!record) return undefined;
	if (
		record.type === "tool_execution_end" &&
		typeof record.toolName === "string"
	) {
		const result = asRecord(record.result);
		if (!result) return undefined;
		return {
			toolName: record.toolName,
			result,
			...(typeof record.toolCallId === "string"
				? { toolCallId: record.toolCallId }
				: {}),
		};
	}
	if (record.type !== "message_end") return undefined;
	const message = asRecord(record.message);
	if (message?.role !== "toolResult" || typeof message.toolName !== "string")
		return undefined;
	return {
		toolName: message.toolName,
		result: message,
		...(typeof message.toolCallId === "string"
			? { toolCallId: message.toolCallId }
			: {}),
	};
}

function scenarioIdFromDescription(description: unknown): string | undefined {
	if (typeof description !== "string") return undefined;
	return /^Benchmark:\s*([^\s]+)\s*$/i.exec(description)?.[1];
}

export class BenchmarkCollector {
	private readonly agentScenarios = new Map<string, string>();
	private readonly observed = new Map<string, ScenarioMetrics>();
	private readonly consumedToolCalls = new Set<string>();
	private readonly expectedScenarioIds: ReadonlySet<string>;

	constructor(
		private readonly resultTransport?: string,
		expectedScenarioIds: readonly string[] = [],
	) {
		this.expectedScenarioIds = new Set(expectedScenarioIds);
	}

	consume(event: unknown): void {
		const toolResult = extractToolResult(event);
		if (!toolResult) return;
		if (toolResult.toolCallId) {
			if (this.consumedToolCalls.has(toolResult.toolCallId)) return;
			this.consumedToolCalls.add(toolResult.toolCallId);
		}
		if (toolResult.toolName === "Agent") this.consumeAgent(toolResult.result);
		if (
			toolResult.toolName === "get_subagent_result" &&
			this.resultTransport !== "foreground_agent_details"
		)
			this.consumeCompletedAgent(toolResult.result);
	}

	metrics(): ReadonlyMap<string, ScenarioMetrics> {
		return this.observed;
	}

	private consumeAgent(result: JsonRecord): void {
		const details = asRecord(result.details);
		const text = textContent(result.content);
		const structuredScenarioId = scenarioIdFromDescription(
			details?.description,
		);
		const agentId =
			typeof details?.agentId === "string"
				? details.agentId
				: /Agent ID:\s*(\S+)/i.exec(text)?.[1];
		const scenarioId =
			this.resultTransport === "foreground_agent_details"
				? structuredScenarioId
				: (structuredScenarioId ??
					/^Description:\s*Benchmark:\s*([^\s]+)\s*$/im.exec(text)?.[1]);
		if (agentId && scenarioId) this.agentScenarios.set(agentId, scenarioId);
		const status =
			typeof details?.status === "string"
				? details.status.trim().toLowerCase()
				: undefined;
		if (!details || !scenarioId || !status || status === "background") return;
		if (
			this.resultTransport === "foreground_agent_details" &&
			this.expectedScenarioIds.size > 0 &&
			!this.expectedScenarioIds.has(scenarioId)
		) {
			this.observed.set(scenarioId, {
				scenario_id: scenarioId,
				scenario_status: "unexpected_scenario",
				question_count: 0,
				tool_uses: null,
				reported_tokens: null,
				duration_ms: null,
			});
			return;
		}
		if (
			this.resultTransport === "foreground_agent_details" &&
			!["completed", "error", "aborted", "stopped", "steered"].includes(status)
		) {
			this.observed.set(scenarioId, {
				scenario_id: scenarioId,
				scenario_status: "invalid_status",
				question_count: 0,
				tool_uses: null,
				reported_tokens: null,
				duration_ms: null,
			});
			return;
		}

		let reportedTokens: number | null = null;
		let reportedTokensSource: ReportedTokensSource | undefined;
		let tokenCandidate: number | null = null;
		if (typeof details.tokens === "number") tokenCandidate = details.tokens;
		else if (typeof details.tokens === "string")
			tokenCandidate = parseReportedTokens(details.tokens);
		if (completeReportedTokens(tokenCandidate)) {
			reportedTokens = tokenCandidate;
			reportedTokensSource = "host_runtime";
		}
		const runtimeAdvisoryMetrics = parseRuntimeAdvisoryMetrics(text);
		const advisoryMetrics =
			runtimeAdvisoryMetrics || parseAdvisoryMetrics(text);
		const advisoryMetricsSource = runtimeAdvisoryMetrics
			? "runtime_activation"
			: advisoryMetrics
				? "child_footer"
				: undefined;
		if (
			this.resultTransport === "foreground_agent_details" &&
			this.observed.has(scenarioId)
		) {
			this.observed.set(scenarioId, {
				scenario_id: scenarioId,
				scenario_status: "duplicate",
				question_count: 0,
				tool_uses: null,
				reported_tokens: null,
				duration_ms: null,
			});
			return;
		}
		this.observed.set(scenarioId, {
			scenario_id: scenarioId,
			scenario_status: status,
			question_count: countQuestions(text),
			tool_uses:
				typeof details.toolUses === "number" &&
				Number.isFinite(details.toolUses)
					? details.toolUses
					: null,
			reported_tokens: reportedTokens,
			...(reportedTokensSource
				? { reported_tokens_source: reportedTokensSource }
				: {}),
			duration_ms:
				typeof details.durationMs === "number" &&
				Number.isFinite(details.durationMs)
					? details.durationMs
					: null,
			...(advisoryMetrics ? { advisory_metrics: advisoryMetrics } : {}),
			...(advisoryMetricsSource
				? {
						advisory_metrics_source:
							advisoryMetricsSource as AdvisoryMetricsSource,
					}
				: {}),
		});
	}

	private consumeCompletedAgent(result: JsonRecord): void {
		const parsed = parseSubagentReport(
			textContent(result.content),
			this.agentScenarios,
		);
		if (!parsed) return;
		const { agent_id: _agentId, ...metrics } = parsed;
		this.observed.set(metrics.scenario_id, metrics);
	}
}

function loadFixture(repoRoot: string, fixturePath: string): BenchmarkFixture {
	const absoluteFixture = resolve(repoRoot, fixturePath);
	try {
		return JSON.parse(
			readFileSync(absoluteFixture, "utf8"),
		) as BenchmarkFixture;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Cannot read benchmark fixture ${fixturePath}: ${message}`);
	}
}

function benchmarkPrompt(
	fixturePath: string,
	fixture: BenchmarkFixture,
): string {
	if (fixture.runner.resultTransport !== "foreground_agent_details") {
		throw new Error(
			"Benchmark fixture must declare resultTransport=foreground_agent_details",
		);
	}
	return [
		`Run Immune-Brain benchmark baseline using ${fixturePath}.`,
		"Follow the fixture runner contract exactly.",
		"Launch every scenario in one parallel foreground Agent batch.",
		"Set run_in_background=false for every Agent call.",
		"Use the exact Agent description `Benchmark: <scenario-id>` for every scenario.",
		"Do not call get_subagent_result; foreground Agent tool results are the scenario evidence.",
		"Report runtime-derived metrics as `Runtime advisory metrics: child_count=<n> | packet_bytes=<n> | truncation_count=<n>` from the exact activation or packet JSON; a child footer is supplementary only.",
		"End each scenario report with `Advisory metrics: child_count=<n> | packet_bytes=<n> | truncation_count=<n>` only as a supplementary footer.",
	].join(" ");
}

async function executePiBenchmark(
	repoRoot: string,
	fixturePath: string,
	fixture: BenchmarkFixture,
): Promise<{
	exitCode: number;
	observed: ReadonlyMap<string, ScenarioMetrics>;
}> {
	const collector = new BenchmarkCollector(
		fixture.runner.resultTransport,
		fixture.scenarios.map(({ id }) => id),
	);
	const child = spawn(
		"pi",
		[
			"--mode",
			"json",
			"--no-session",
			"--model",
			fixture.runner.model,
			"-p",
			benchmarkPrompt(fixturePath, fixture),
		],
		{ cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
	);
	const childExit = new Promise<number>((resolveExit) => {
		child.once("error", (error) => {
			process.stderr.write(
				`[benchmark-eval] cannot start pi: ${error.message}\n`,
			);
			resolveExit(1);
		});
		child.once("close", (code) => resolveExit(code ?? 1));
	});
	child.stderr.pipe(process.stderr);

	const lines = createInterface({ input: child.stdout });
	for await (const line of lines) {
		try {
			collector.consume(JSON.parse(line));
		} catch {
			// Ignore non-JSON output so dependency warnings cannot corrupt the metrics stream.
		}
	}
	return { exitCode: await childExit, observed: collector.metrics() };
}

export async function runBenchmark(
	repoRoot: string,
	fixturePath = DEFAULT_FIXTURE,
	resultsPath = DEFAULT_RESULTS_DIR,
): Promise<{ record: BenchmarkRunRecord; exitCode: number }> {
	const fixture = loadFixture(repoRoot, fixturePath);
	if (fixture.runner.requiresInteractiveHost) {
		throw new Error("This fixture requires interactive native authority gates; the non-interactive benchmark runner cannot execute it. No child was started and no lifecycle evidence was recorded.");
	}
	const resultsDir = resolve(repoRoot, resultsPath);
	const startedAt = Date.now();
	process.stderr.write(
		`[benchmark-eval] running ${fixture.scenarios.length} scenarios with ${fixture.runner.model}\n`,
	);
	const execution = await executePiBenchmark(repoRoot, fixturePath, fixture);
	const record = buildRunRecord({
		fixture,
		observed: execution.observed,
		exitCode: execution.exitCode,
		startedAt,
		finishedAt: Date.now(),
		comparison: fixture.comparison,
	});
	persistRunRecord(record, resultsDir);
	process.stdout.write(
		`${JSON.stringify(
			{
				...record,
				latest_file: `${resultsPath}/latest.json`,
				history_file: `${resultsPath}/history.jsonl`,
			},
			null,
			2,
		)}\n`,
	);

	const exitCode =
		execution.exitCode !== 0 || record.evidence_status === "incomplete" ? 1 : 0;
	if (record.evidence_status === "incomplete") {
		process.stderr.write(
			`[benchmark-eval] incomplete evidence: ${record.evidence_reason_code}\n`,
		);
	} else if (record.evidence_status === "unavailable") {
		process.stderr.write(
			`[benchmark-eval] evidence unavailable: ${record.evidence_reason_code}\n`,
		);
	}
	return { record, exitCode };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
	let fixturePath = DEFAULT_FIXTURE;
	let resultsPath = DEFAULT_RESULTS_DIR;
	for (let index = 0; index < argv.length; index++) {
		if (argv[index] === "--fixture" && argv[index + 1])
			fixturePath = argv[++index];
		else if (argv[index] === "--results-dir" && argv[index + 1])
			resultsPath = argv[++index];
		else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
	}
	const result = await runBenchmark(process.cwd(), fixturePath, resultsPath);
	return result.exitCode;
}

if (import.meta.main) process.exit(await main());
