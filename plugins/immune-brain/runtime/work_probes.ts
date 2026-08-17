import { createHash } from "node:crypto";

export const WORK_PROBE_BOUNDARY =
	"advisory-only; no tools, no edits, no plan writes, no workflow-state mutation, no QA closure";
export const WORK_PROBE_TOOL_POLICY = "no tools";

export const WORK_PROBE_FALLBACK_REASONS = [
	"trigger_not_hit",
	"cost_scope_mismatch",
	"unavailable_environment",
	"explicit_required",
	"config_disabled",
	"host_authorization_required",
	"dispatch_failed",
	"child_timeout",
] as const;

export type WorkProbeFallbackReason =
	(typeof WORK_PROBE_FALLBACK_REASONS)[number];
export type WorkProbeOutcomeStatus =
	| "success"
	| "failed"
	| "timed_out"
	| "fallback";

export interface WorkProbeStep {
	number: number;
	step_id: string;
	result?: string;
	verification?: string;
	scope?: string[];
	parallel_probes?: Array<Record<string, unknown>>;
}

export interface WorkProbeEnvelope {
	probe_id: string;
	candidate: "generalPurpose";
	runtime: "pi";
	probe: {
		scope: string;
		output: string;
		readonly: true;
		[key: string]: unknown;
	};
	message: string;
	tool_policy: typeof WORK_PROBE_TOOL_POLICY;
	boundary: typeof WORK_PROBE_BOUNDARY;
	dispatch_call: Record<string, unknown> | null;
}

export interface WorkProbeResult {
	probe_id: string;
	status: WorkProbeOutcomeStatus;
	fallback_reason: WorkProbeFallbackReason | "none";
	summary: string;
	evidence: Record<string, unknown>;
}

export interface WorkProbeChildEvidence extends WorkProbeResult {
	agent: "work-probe";
	scope: string;
}

const FALLBACK_EXPLANATIONS: Record<WorkProbeFallbackReason, string> = {
	trigger_not_hit: "Solo fallback because the active Step has no parallel_probes.",
	cost_scope_mismatch:
		"Solo fallback because delegation overhead exceeds expected benefit.",
	unavailable_environment:
		"Solo fallback because no supported subagent runtime is available.",
	explicit_required:
		"Solo fallback because configuration requires an explicit subagent request.",
	config_disabled:
		"Solo fallback because configuration disabled work probe dispatch.",
	host_authorization_required:
		"Solo fallback because the host has not authorized read-only subagent dispatch.",
	dispatch_failed: "Solo fallback because probe dispatch failed after retry.",
	child_timeout: "Solo fallback because a probe child timed out.",
};

const RESULT_KEYS = new Set([
	"probe_id",
	"status",
	"fallback_reason",
	"summary",
	"evidence",
]);

function stableValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, child]) => [key, stableValue(child)]),
		);
	}
	return value;
}

function stableStringify(value: unknown): string {
	return JSON.stringify(stableValue(value));
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function normalizeProbe(
	value: unknown,
	index: number,
): WorkProbeEnvelope["probe"] {
	const probe = requireRecord(value, `parallel_probes[${index}]`);
	const scope = typeof probe.scope === "string" ? probe.scope.trim() : "";
	const output = typeof probe.output === "string" ? probe.output.trim() : "";
	if (!scope)
		throw new Error(`parallel_probes[${index}] requires a non-empty scope.`);
	if (!output)
		throw new Error(`parallel_probes[${index}] requires a non-empty output.`);
	if (probe.readonly !== true)
		throw new Error(`parallel_probes[${index}] must declare readonly: true.`);
	return { ...probe, scope, output, readonly: true };
}

function probeIdFor(
	planIdentity: string,
	step: WorkProbeStep,
	index: number,
): string {
	const identity = `${planIdentity}\0${step.number}\0${step.step_id}\0${index}`;
	const digest = createHash("sha256").update(identity).digest("hex").slice(0, 16);
	return `work-probe:${step.step_id}:${index}:${digest}`;
}

function buildMessage(input: {
	plan_identity: string;
	plan_summary?: string;
	step: WorkProbeStep;
	probe: WorkProbeEnvelope["probe"];
	probe_id: string;
}): string {
	const payload = {
		shared_context_summary: {
			goal: input.plan_summary || "Complete the active Immune-Brain Plan Step.",
			changed_surface: input.step.scope || [],
			project_constraints: [
				"The State Ledger is the sole workflow mutation authority.",
				"Probe evidence is advisory input for the executor only.",
			],
			plan_identity: input.plan_identity,
		},
		focus_delta: {
			role: "Work Probe",
			probe_id: input.probe_id,
			active_step: {
				step_number: input.step.number,
				step_id: input.step.step_id,
				result: input.step.result || "",
				verification: input.step.verification || "",
			},
			scope: input.probe.scope,
			output_expectation: input.probe.output,
			tool_policy: WORK_PROBE_TOOL_POLICY,
			boundary: WORK_PROBE_BOUNDARY,
		},
	};
	return [
		"Act as a read-only work probe for imm-work.",
		"Return concise structured evidence for the executor; do not propose patches.",
		JSON.stringify(payload, null, 2),
	].join("\n");
}

function buildDispatchCall(
	probe: WorkProbeEnvelope["probe"],
	message: string,
): Record<string, unknown> {
	return {
		tool: "Agent",
		args: {
			subagent_type: "general-purpose",
			description: `Read-only probe for ${probe.scope}`,
			prompt: message,
			inherit_context: false,
			run_in_background: true,
		},
	};
}

export function buildWorkProbeInvocationEnvelopes(input: {
	plan_identity: string;
	plan_summary?: string;
	step: WorkProbeStep;
}): WorkProbeEnvelope[] {
	return (input.step.parallel_probes || []).map((value, index) => {
		const probe = normalizeProbe(value, index);
		const probeId = probeIdFor(input.plan_identity, input.step, index + 1);
		const message = buildMessage({
			...input,
			probe,
			probe_id: probeId,
		});
		return {
			probe_id: probeId,
			candidate: "generalPurpose",
			runtime: "pi",
			probe,
			message,
			tool_policy: WORK_PROBE_TOOL_POLICY,
			boundary: WORK_PROBE_BOUNDARY,
			dispatch_call: buildDispatchCall(probe, message),
		};
	});
}

export function resolveWorkProbeDispatch(input: {
	activation_mode: string;
	activation_mode_reason: string;
	dispatch_available: boolean;
	authorized: boolean;
}): {
	dispatch: boolean;
	fallback_reason: WorkProbeFallbackReason | null;
	fallback_explanation: string | null;
} {
	let fallbackReason: WorkProbeFallbackReason | null = null;
	if (input.activation_mode_reason === "explicit_solo")
		fallbackReason = "cost_scope_mismatch";
	else if (input.activation_mode === "disabled")
		fallbackReason = "config_disabled";
	else if (
		input.activation_mode === "explicit_only" &&
		input.activation_mode_reason !== "explicit_subagents"
	)
		fallbackReason = "explicit_required";
	else if (!input.dispatch_available)
		fallbackReason = "unavailable_environment";
	else if (
		!input.authorized &&
		input.activation_mode_reason !== "explicit_subagents"
	)
		fallbackReason = "host_authorization_required";
	return {
		dispatch: fallbackReason === null,
		fallback_reason: fallbackReason,
		fallback_explanation: fallbackReason
			? FALLBACK_EXPLANATIONS[fallbackReason]
			: null,
	};
}

export function buildWorkProbeFallbackResults(
	envelopes: WorkProbeEnvelope[],
	reason: WorkProbeFallbackReason,
): WorkProbeResult[] {
	return envelopes.map((envelope) => ({
		probe_id: envelope.probe_id,
		status: "fallback",
		fallback_reason: reason,
		summary: FALLBACK_EXPLANATIONS[reason],
		evidence: {},
	}));
}

function normalizeResult(
	envelope: WorkProbeEnvelope,
	value: unknown,
	index: number,
): WorkProbeChildEvidence {
	const result = requireRecord(value, `results[${index}]`);
	const unknownKeys = Object.keys(result).filter((key) => !RESULT_KEYS.has(key));
	if (unknownKeys.length > 0) {
		throw new Error(
			`results[${index}] contains unsupported fields: ${unknownKeys.join(", ")}.`,
		);
	}
	if (result.probe_id !== envelope.probe_id) {
		throw new Error(
			`Probe result identity mismatch: expected ${envelope.probe_id}.`,
		);
	}
	const status = result.status;
	if (!['success', 'failed', 'timed_out', 'fallback'].includes(String(status))) {
		throw new Error(`Probe ${envelope.probe_id} has invalid status.`);
	}
	const fallbackReason = result.fallback_reason ?? "none";
	if (
		fallbackReason !== "none" &&
		!WORK_PROBE_FALLBACK_REASONS.includes(
			fallbackReason as WorkProbeFallbackReason,
		)
	) {
		throw new Error(`Probe ${envelope.probe_id} has invalid fallback_reason.`);
	}
	if (status === "success" && fallbackReason !== "none")
		throw new Error("Successful probe results cannot carry a fallback reason.");
	if (status === "failed" && fallbackReason !== "dispatch_failed")
		throw new Error("Failed probe results require fallback_reason dispatch_failed.");
	if (status === "timed_out" && fallbackReason !== "child_timeout")
		throw new Error("Timed-out probe results require fallback_reason child_timeout.");
	if (status === "fallback" && fallbackReason === "none")
		throw new Error("Fallback probe results require a fallback reason.");
	const summary = typeof result.summary === "string" ? result.summary.trim() : "";
	if (!summary) throw new Error(`Probe ${envelope.probe_id} requires a summary.`);
	const evidence = result.evidence ?? {};
	if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
		throw new Error(`Probe ${envelope.probe_id} evidence must be an object.`);
	}
	return {
		agent: "work-probe",
		probe_id: envelope.probe_id,
		status: status as WorkProbeOutcomeStatus,
		fallback_reason: fallbackReason as WorkProbeFallbackReason | "none",
		scope: envelope.probe.scope,
		summary,
		evidence: structuredClone(evidence as Record<string, unknown>),
	};
}

export function normalizeWorkProbeResults(
	envelopes: WorkProbeEnvelope[],
	results: unknown,
): WorkProbeChildEvidence[] {
	if (!Array.isArray(results)) throw new Error("results must be a list.");
	const expected = new Set(envelopes.map((envelope) => envelope.probe_id));
	const seen = new Set<string>();
	for (const value of results) {
		const result = requireRecord(value, "probe result");
		const probeId = typeof result.probe_id === "string" ? result.probe_id : "";
		if (!expected.has(probeId)) throw new Error(`Unknown probe_id: ${probeId}.`);
		if (seen.has(probeId)) throw new Error(`Duplicate probe_id: ${probeId}.`);
		seen.add(probeId);
	}
	const missing = [...expected].filter((probeId) => !seen.has(probeId));
	if (missing.length > 0)
		throw new Error(`Missing probe results: ${missing.join(", ")}.`);
	const byId = new Map(
		results.map((value) => {
			const result = value as Record<string, unknown>;
			return [result.probe_id as string, result];
		}),
	);
	return envelopes.map((envelope, index) =>
		normalizeResult(envelope, byId.get(envelope.probe_id), index),
	);
}

export function validateCommittedWorkProbeEvidence(
	envelopes: WorkProbeEnvelope[],
	evidence: unknown,
): WorkProbeChildEvidence[] {
	if (!Array.isArray(evidence))
		throw new Error("Committed work probe child_evidence must be a list.");
	const results = evidence.map((value, index) => {
		const record = requireRecord(value, `child_evidence[${index}]`);
		if (record.agent !== "work-probe")
			throw new Error(`child_evidence[${index}] has an invalid agent.`);
		const envelope = envelopes.find(
			(candidate) => candidate.probe_id === record.probe_id,
		);
		if (!envelope) throw new Error(`Unknown probe_id: ${String(record.probe_id)}.`);
		if (record.scope !== envelope.probe.scope)
			throw new Error(`Probe ${envelope.probe_id} scope does not match the Plan.`);
		return {
			probe_id: record.probe_id,
			status: record.status,
			fallback_reason: record.fallback_reason,
			summary: record.summary,
			evidence: record.evidence,
		};
	});
	return normalizeWorkProbeResults(envelopes, results);
}

export function sameWorkProbeEvidence(left: unknown, right: unknown): boolean {
	return stableStringify(left) === stableStringify(right);
}
