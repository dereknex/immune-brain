import { PlanValidationError } from "./plan_core";
import type {
	AdvisoryDispatchConfig,
	WorkflowModelOptions,
} from "./agent_config";
import { loadRolePrompt } from "./role_prompt_bridge";

// ── advisory dispatch substrate ─────────────────────────────────────

export type AdvisoryDispatchHost = "pi";
export type AdvisoryModelSource =
	| "lens_override"
	| "lens_tier"
	| "candidate_tier"
	| "workflow_stage"
	| "concrete"
	| "inherit";
export interface ResolvedAdvisoryModel {
	entry?: string;
	model?: string;
	source: AdvisoryModelSource;
}

export interface AdvisoryModelResolutionInput {
	lens?: string;
	candidate?: string;
	lens_model_tiers?: Record<string, string>;
	model_tiers?: Record<string, string>;
	config?: AdvisoryDispatchConfig;
}

const WORKFLOW_MODEL_PRESETS: Record<string, Record<string, string[]>> = {
	off: { default: ["inherit"] },
	budget: {
		default: ["fast"],
		brainstorm_ensemble: ["fast"],
		planner_ensemble: ["fast"],
		executor: ["inherit"],
	},
	balanced: {
		default: ["mid"],
		brainstorm: ["mid"],
		brainstorm_ensemble: ["fast", "mid", "strong"],
		planner: ["mid"],
		planner_ensemble: ["fast", "mid", "strong"],
		preplan_review: ["strong"],
		executor: ["inherit"],
		qa: ["mid"],
		qa_high_risk: ["strong"],
		compounder: ["mid"],
		compounder_adr: ["strong"],
	},
	quality: {
		default: ["strong"],
		brainstorm_ensemble: ["mid", "strong"],
		planner_ensemble: ["mid", "strong"],
		executor: ["inherit"],
	},
	ensemble: {
		default: ["mid"],
		brainstorm_ensemble: ["fast", "mid", "strong"],
		planner_ensemble: ["fast", "mid", "strong"],
		executor: ["inherit"],
	},
};

function listValue(value: string | string[] | undefined): string[] {
	if (Array.isArray(value)) return value.filter(Boolean);
	if (typeof value === "string" && value.trim()) return [value.trim()];
	return [];
}

function isTier(value: string): boolean {
	return ["fast", "mid", "strong", "local", "inherit"].includes(value);
}

function resolveModelEntry(
	entry: string,
	config?: AdvisoryDispatchConfig,
	source: AdvisoryModelSource = "workflow_stage",
): ResolvedAdvisoryModel {
	if (!entry || entry === "inherit") return { entry, source: "inherit" };
	if (!isTier(entry)) return { entry, model: entry, source: "concrete" };
	const mapped = config?.subagent_models?.[entry];
	if (typeof mapped === "string" && mapped && mapped !== "inherit")
		return { entry, model: mapped, source };
	return { entry, source: "inherit" };
}

export function resolveAdvisoryModel(
	input: AdvisoryModelResolutionInput,
): ResolvedAdvisoryModel {
	const config = input.config || {};
	const lens = input.lens || "";
	const candidate = input.candidate || "";
	const override = config.subagent_models?.lens_overrides?.[lens];
	if (override && override !== "inherit")
		return { entry: lens, model: override, source: "lens_override" };

	const lensTier = input.lens_model_tiers?.[lens];
	if (lensTier && lensTier !== "inherit") {
		const resolved = resolveModelEntry(lensTier, config, "lens_tier");
		if (resolved.model) return resolved;
	}

	const candidateTier = input.model_tiers?.[candidate];
	if (candidateTier && candidateTier !== "inherit") {
		const resolved = resolveModelEntry(candidateTier, config, "candidate_tier");
		if (resolved.model) return resolved;
	}

	return { source: "inherit" };
}

function resolveWorkflowModelOptions(
	stage: string,
	config: AdvisoryDispatchConfig,
): WorkflowModelOptions {
	const raw = config.workflow_model_options?.[stage];
	if (!raw) return {};
	const options: WorkflowModelOptions = {};
	if (raw.reasoning_effort !== undefined) {
		if (
			!["low", "medium", "high", "xhigh", "max"].includes(raw.reasoning_effort)
		) {
			throw new PlanValidationError(
				`Invalid workflow_model_options.${stage}.reasoning_effort: ${raw.reasoning_effort}`,
			);
		}
		options.reasoning_effort = raw.reasoning_effort;
	}
	if (raw.verbosity !== undefined) {
		if (!["low", "medium", "high"].includes(raw.verbosity)) {
			throw new PlanValidationError(
				`Invalid workflow_model_options.${stage}.verbosity: ${raw.verbosity}`,
			);
		}
		options.verbosity = raw.verbosity;
	}
	return options;
}

export function resolveWorkflowStageModels(
	stage: string,
	config: AdvisoryDispatchConfig = {},
): {
	preset: string;
	entries: string[];
	models: ResolvedAdvisoryModel[];
	model_options: WorkflowModelOptions;
	dispatch_mode: "single_model" | "multi_model" | "single_model_fallback";
} {
	const presetName = config.workflow?.model_preset || "off";
	const preset =
		WORKFLOW_MODEL_PRESETS[presetName] || WORKFLOW_MODEL_PRESETS.off;
	const entries = listValue(
		config.workflow_models?.[stage] ??
			preset[stage] ??
			preset.default?.[0] ??
			"inherit",
	);
	const resolved = entries.map((entry) =>
		resolveModelEntry(entry, config, "workflow_stage"),
	);
	const deduped: ResolvedAdvisoryModel[] = [];
	const seen = new Set<string>();
	for (const model of resolved) {
		const identity = model.model || "inherit";
		if (seen.has(identity)) continue;
		seen.add(identity);
		deduped.push(model);
	}
	return {
		preset: presetName,
		entries,
		models: deduped,
		model_options: resolveWorkflowModelOptions(stage, config),
		dispatch_mode:
			deduped.length > 1
				? "multi_model"
				: entries.length > 1
					? "single_model_fallback"
					: "single_model",
	};
}

export function buildAdvisoryDelegationPrompt(input: {
	shared_context_summary: {
		goal: string;
		changed_surface: string;
		project_constraints: string;
		domain_vocabulary?: string;
	};
	focus_delta: {
		role: string;
		lens: string;
		specific_changes: string[];
		audit_question: string;
	};
}): string {
	const lens = input.focus_delta.lens.trim();
	if (!lens) {
		throw new PlanValidationError("advisory review requires an explicit lens");
	}
	const changes = input.focus_delta.specific_changes.length
		? input.focus_delta.specific_changes
				.map((path) => `    - ${path}`)
				.join("\n")
		: "    - none";
	return [
		"internal role: advisory-reviewer",
		"tool_policy: no tools",
		"do not discover or load Pi Skills; execute this internal role contract directly",
		loadRolePrompt("advisory-reviewer").trim(),
		"shared_context_summary:",
		`  goal: ${input.shared_context_summary.goal}`,
		`  changed_surface: ${input.shared_context_summary.changed_surface}`,
		`  project_constraints: ${input.shared_context_summary.project_constraints}`,
		input.shared_context_summary.domain_vocabulary
			? `  domain_vocabulary: ${input.shared_context_summary.domain_vocabulary}`
			: null,
		"focus_delta:",
		`  role: ${input.focus_delta.role}`,
		`  lens: ${lens}`,
		"  specific_changes:",
		changes,
		`  audit_question: ${input.focus_delta.audit_question}`,
		"  tool_policy: no tools",
		"  output_expectation: concise advisory findings in the candidate standard output artifact format",
		"  boundary: advisory-only; no code edits; no plan writes; no workflow-state mutation; no QA closure",
	]
		.filter(Boolean)
		.join("\n");
}

export function buildAdvisoryDispatchEnvelope(
	input: {
		candidate: string;
		lens: string;
		prompt: string;
		model?: string;
		description?: string;
	},
): {
	ok: true;
	host: "pi";
	primitive: "Agent";
	call: Record<string, unknown>;
} {
	const lens = input.lens.trim();
	if (!lens) {
		throw new PlanValidationError("advisory dispatch requires an explicit lens");
	}
	const description =
		input.description || `${input.candidate}/${lens} review`;
	const model = input.model ? { model: input.model } : {};
	return {
		ok: true,
		host: "pi",
		primitive: "Agent",
		call: {
			subagent_type: "general-purpose",
			description,
			prompt: input.prompt,
			...model,
			inherit_context: false,
			run_in_background: false,
		},
	};
}

export interface AdvisoryPacketBudget {
	max_candidates: number;
	max_context_chars: number;
	max_result_entries: number;
	max_entry_chars: number;
}

export const DEFAULT_ADVISORY_PACKET_BUDGET: AdvisoryPacketBudget = {
	max_candidates: 3,
	max_context_chars: 4000,
	max_result_entries: 3,
	max_entry_chars: 240,
};

function advisoryBudgetForRisk(
	risk: "normal" | "elevated" | "explicit",
): AdvisoryPacketBudget {
	let maxCandidates = 1;
	if (risk === "elevated") maxCandidates = 2;
	if (risk === "explicit") maxCandidates = 3;
	return {
		...DEFAULT_ADVISORY_PACKET_BUDGET,
		max_candidates: maxCandidates,
	};
}

function selectEnsembleModelIndexes(
	modelCount: number,
	risk: "normal" | "elevated" | "explicit",
): number[] {
	if (risk === "explicit")
		return Array.from({ length: Math.min(modelCount, 3) }, (_, index) => index);
	if (risk === "elevated") {
		if (modelCount >= 3) return [1, 2];
		return Array.from({ length: Math.min(modelCount, 2) }, (_, index) => index);
	}
	return modelCount > 0 ? [0] : [];
}

function capText(
	value: string,
	limit: number,
): { value: string; truncated: boolean } {
	if (value.length <= limit) return { value, truncated: false };
	const suffix = "...[truncated]";
	return {
		value: `${value.slice(0, Math.max(0, limit - suffix.length))}${suffix}`,
		truncated: true,
	};
}

function boundedStringList(
	value: unknown,
	budget: AdvisoryPacketBudget,
): { values: string[]; truncated: boolean } {
	const raw = stringList(value);
	const selected = raw.slice(0, budget.max_result_entries);
	let truncated = raw.length > selected.length;
	const values = selected.map((item) => {
		const capped = capText(item, budget.max_entry_chars);
		truncated = truncated || capped.truncated;
		return capped.value;
	});
	return { values, truncated };
}

interface AdvisoryChildSignals {
	recommendations: string[];
	disagreements: string[];
	blockers: string[];
	open_questions: string[];
	truncated: boolean;
	degraded: boolean;
}

function normalizeChildSignals(
	input: {
		recommendations?: unknown;
		disagreements?: unknown;
		blockers?: unknown;
		open_questions?: unknown;
	},
	budget: AdvisoryPacketBudget,
	degraded = false,
): AdvisoryChildSignals {
	const recommendations = boundedStringList(input.recommendations, budget);
	const disagreements = boundedStringList(input.disagreements, budget);
	const blockers = boundedStringList(input.blockers, budget);
	const open_questions = boundedStringList(input.open_questions, budget);
	const truncated =
		recommendations.truncated ||
		disagreements.truncated ||
		blockers.truncated ||
		open_questions.truncated;
	return {
		recommendations: recommendations.values,
		disagreements: disagreements.values,
		blockers: blockers.values,
		open_questions: open_questions.values,
		truncated,
		degraded: degraded || truncated,
	};
}

export interface PlannerEnsembleCandidate {
	candidate_id: string;
	tier: string;
	model?: string;
	model_options?: WorkflowModelOptions;
	role: string;
	advisory_only: true;
	tool_policy: "no tools";
}

export function buildPlannerEnsembleRequest(input: {
	task_summary: string;
	planning_risk: "small" | "normal" | "elevated" | "explicit";
	config?: AdvisoryDispatchConfig;
}): {
	dispatch: boolean;
	stage: "planner_ensemble";
	fallback_reason?: "cost_scope_mismatch" | "single_model_fallback";
	candidates: PlannerEnsembleCandidate[];
	budget?: AdvisoryPacketBudget;
} {
	const stage = "planner_ensemble" as const;
	if (input.planning_risk === "small")
		return {
			dispatch: false,
			stage,
			fallback_reason: "cost_scope_mismatch",
			candidates: [],
		};
	const resolved = resolveWorkflowStageModels(stage, input.config);
	if (resolved.dispatch_mode !== "multi_model")
		return {
			dispatch: false,
			stage,
			fallback_reason: "single_model_fallback",
			candidates: [],
		};
	const budget = advisoryBudgetForRisk(input.planning_risk);
	const roles = ["divergent_options", "repo_grounded_plan", "risk_review"];
	const indexes = selectEnsembleModelIndexes(
		resolved.models.length,
		input.planning_risk,
	);
	return {
		dispatch: true,
		stage,
		budget,
		candidates: indexes.map((index) => {
			const model = resolved.models[index];
			return {
				candidate_id: `planner-${roles[index] || `candidate_${index + 1}`}`,
				tier: model.entry || "inherit",
				...(model.model ? { model: model.model } : {}),
				...(Object.keys(resolved.model_options).length
					? { model_options: resolved.model_options }
					: {}),
				role: roles[index] || "advisory_candidate",
				advisory_only: true,
				tool_policy: "no tools",
			};
		}),
	};
}

export function buildBrainstormEnsembleRequest(input: {
	task_summary: string;
	brainstorm_risk: "small" | "normal" | "elevated" | "explicit";
	config?: AdvisoryDispatchConfig;
}): {
	dispatch: boolean;
	stage: "brainstorm_ensemble";
	fallback_reason?: "cost_scope_mismatch" | "single_model_fallback";
	candidates: PlannerEnsembleCandidate[];
	budget?: AdvisoryPacketBudget;
} {
	const stage = "brainstorm_ensemble" as const;
	if (input.brainstorm_risk === "small")
		return {
			dispatch: false,
			stage,
			fallback_reason: "cost_scope_mismatch",
			candidates: [],
		};
	const resolved = resolveWorkflowStageModels(stage, input.config);
	if (resolved.dispatch_mode !== "multi_model")
		return {
			dispatch: false,
			stage,
			fallback_reason: "single_model_fallback",
			candidates: [],
		};
	const budget = advisoryBudgetForRisk(input.brainstorm_risk);
	const roles = [
		"clarify_scope",
		"divergent_options",
		"risk_review",
		"minimal_solution",
	];
	const indexes = selectEnsembleModelIndexes(
		resolved.models.length,
		input.brainstorm_risk,
	);
	return {
		dispatch: true,
		stage,
		budget,
		candidates: indexes.map((index) => {
			const model = resolved.models[index];
			return {
				candidate_id: `brainstorm-${roles[index] || `candidate_${index + 1}`}`,
				tier: model.entry || "inherit",
				...(model.model ? { model: model.model } : {}),
				...(Object.keys(resolved.model_options).length
					? { model_options: resolved.model_options }
					: {}),
				role: roles[index] || "advisory_candidate",
				advisory_only: true,
				tool_policy: "no tools",
			};
		}),
	};
}

export function buildBrainstormEnsembleDispatchEnvelopes(
	input: {
		request: {
			dispatch: boolean;
			candidates?: PlannerEnsembleCandidate[];
			fallback_reason?: string;
			budget?: AdvisoryPacketBudget;
		};
		task_summary: string;
		shared_context_summary?: string;
	},
):
	| {
			ok: true;
			host: "pi";
			envelopes: Array<{
				candidate_id: string;
				role: string;
				primitive: "Agent";
				call: Record<string, unknown>;
				routing_metadata?: { model_options: WorkflowModelOptions };
			}>;
	  }
	| { ok: false; host: "pi"; envelopes: []; fallback_reason: string } {
	const host = "pi" as const;
	if (!input.request.dispatch || !input.request.candidates?.length) {
		return {
			ok: false,
			host,
			envelopes: [],
			fallback_reason: input.request.fallback_reason || "trigger_not_hit",
		};
	}
	const budget = input.request.budget || DEFAULT_ADVISORY_PACKET_BUDGET;
	const taskSummary = capText(
		input.task_summary,
		budget.max_context_chars,
	).value;
	const sharedContext = input.shared_context_summary
		? capText(input.shared_context_summary, budget.max_context_chars).value
		: null;
	const envelopes = [];
	for (const candidate of input.request.candidates.slice(
		0,
		budget.max_candidates,
	)) {
		const lens = candidate.role.trim();
		if (!lens) {
			throw new PlanValidationError("advisory candidate requires an explicit lens");
		}
		const prompt = [
			`Task: ${taskSummary}`,
			sharedContext ? `Shared context: ${sharedContext}` : null,
			`Brainstorm candidate role: ${lens}`,
			`Result budget: max ${budget.max_result_entries} entries per field; max ${budget.max_entry_chars} characters per entry`,
			"Return JSON fields: recommendations, disagreements, open_questions, blockers",
			"tool_policy: no tools",
			"boundary: advisory-only; no code edits; no plan writes; no workflow-state mutation; no QA closure",
		]
			.filter(Boolean)
			.join("\n");
		const envelope = buildAdvisoryDispatchEnvelope({
			candidate: candidate.candidate_id,
			lens,
			prompt,
			model: candidate.model,
			description: `${lens} brainstorm for ${taskSummary}`,
		});
		envelopes.push({
			candidate_id: candidate.candidate_id,
			role: candidate.role,
			primitive: "Agent" as const,
			call: envelope.call,
			...(candidate.model_options
				? { routing_metadata: { model_options: candidate.model_options } }
				: {}),
		});
	}
	return { ok: true, host, envelopes };
}

function stringList(value: unknown): string[] {
	if (Array.isArray(value))
		return value.flatMap((item) =>
			typeof item === "string" && item.trim().length > 0 ? [item.trim()] : [],
		);
	if (typeof value === "string" && value.trim()) return [value.trim()];
	return [];
}

function parseBrainstormChildOutput(
	output: unknown,
): Record<string, unknown> | null {
	if (typeof output === "string") {
		try {
			const parsed = JSON.parse(output);
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: null;
		} catch {
			return null;
		}
	}
	return output && typeof output === "object" && !Array.isArray(output)
		? (output as Record<string, unknown>)
		: null;
}

export function normalizePiBrainstormAgentResults(input: {
	request: {
		candidates?: PlannerEnsembleCandidate[];
		budget?: AdvisoryPacketBudget;
	};
	results: Array<{ candidate_id: string; output?: unknown; error?: string }>;
}):
	| {
			ok: true;
			host: "pi";
			children: Array<
				{ candidate_id: string; tier: string } & AdvisoryChildSignals
			>;
			packet: ReturnType<typeof normalizeBrainstormEnsemblePacket>;
	  }
	| {
			ok: false;
			host: "pi";
			fallback_reason:
				| "unknown_candidate"
				| "duplicate_candidate_result"
				| "missing_candidate_result"
				| "invalid_child_output";
			candidate_id?: string;
	  } {
	const candidates = input.request.candidates || [];
	if (!candidates.length)
		return {
			ok: false,
			host: "pi",
			fallback_reason: "missing_candidate_result",
		};
	const budget = input.request.budget || DEFAULT_ADVISORY_PACKET_BUDGET;
	const candidateById = new Map(
		candidates.map((candidate) => [candidate.candidate_id, candidate]),
	);
	const resultById = new Map<
		string,
		{ candidate_id: string; output?: unknown; error?: string }
	>();
	for (const result of input.results) {
		if (!candidateById.has(result.candidate_id))
			return {
				ok: false,
				host: "pi",
				fallback_reason: "unknown_candidate",
				candidate_id: result.candidate_id,
			};
		if (resultById.has(result.candidate_id))
			return {
				ok: false,
				host: "pi",
				fallback_reason: "duplicate_candidate_result",
				candidate_id: result.candidate_id,
			};
		resultById.set(result.candidate_id, result);
	}

	const children = candidates
		.slice(0, budget.max_candidates)
		.map((candidate) => {
			const result = resultById.get(candidate.candidate_id);
			if (!result) return null;
			const output = parseBrainstormChildOutput(result.output);
			if (!output && !result.error) return null;
			const signals = normalizeChildSignals(
				{
					recommendations: output?.recommendations,
					disagreements: output?.disagreements,
					blockers: [
						...stringList(output?.blockers),
						...(result.error && !output ? [result.error] : []),
					],
					open_questions: output?.open_questions,
				},
				budget,
				Boolean(result.error),
			);
			return {
				candidate_id: candidate.candidate_id,
				tier: candidate.tier,
				...signals,
			};
		});
	const missing = children.findIndex((child) => child === null);
	if (missing >= 0) {
		const candidate = candidates[missing];
		const fallback_reason = resultById.has(candidate.candidate_id)
			? "invalid_child_output"
			: "missing_candidate_result";
		return {
			ok: false,
			host: "pi",
			fallback_reason,
			candidate_id: candidate.candidate_id,
		};
	}

	const completeChildren = children as Array<
		{ candidate_id: string; tier: string } & AdvisoryChildSignals
	>;
	return {
		ok: true,
		host: "pi",
		children: completeChildren,
		packet: normalizeBrainstormEnsemblePacket(completeChildren, budget),
	};
}

function collectEnsembleSignals(
	children: Array<{
		tier: string;
		recommendations?: string[];
		disagreements?: string[];
		blockers?: string[];
	}>,
): {
	agreement_evidence: string[];
	decision_criteria: string[];
	risk_verification_requirements: string[];
} {
	const recommendationCounts = new Map<string, number>();
	const decisionCriteria = new Set<string>();
	const riskRequirements = new Set<string>();
	for (const child of children) {
		for (const recommendation of child.recommendations || [])
			recommendationCounts.set(
				recommendation,
				(recommendationCounts.get(recommendation) || 0) + 1,
			);
		for (const disagreement of child.disagreements || [])
			decisionCriteria.add(disagreement);
		if (child.tier === "strong") {
			for (const blocker of child.blockers || []) riskRequirements.add(blocker);
		}
	}
	return {
		agreement_evidence: [...recommendationCounts.entries()]
			.filter(([, count]) => count > 1)
			.map(([value]) => value),
		decision_criteria: [...decisionCriteria],
		risk_verification_requirements: [...riskRequirements],
	};
}

export function normalizePlannerEnsemblePacket(
	children: Array<{
		candidate_id: string;
		tier: string;
		recommendations?: string[];
		disagreements?: string[];
		blockers?: string[];
		truncated?: boolean;
		degraded?: boolean;
	}>,
	budget: AdvisoryPacketBudget = DEFAULT_ADVISORY_PACKET_BUDGET,
): {
	owner: "imm-planner";
	children_advisory_only: true;
	agreement_evidence: string[];
	decision_criteria: string[];
	risk_verification_requirements: string[];
	final_spec_and_plan_owner: "imm-planner";
	budget: AdvisoryPacketBudget;
	truncated: boolean;
	degraded: boolean;
} {
	const normalizedChildren = children.map((child) => {
		const signals = normalizeChildSignals(
			child,
			budget,
			Boolean(child.degraded),
		);
		return {
			candidate_id: child.candidate_id,
			tier: child.tier,
			...signals,
			truncated: Boolean(child.truncated) || signals.truncated,
			degraded: Boolean(child.degraded) || signals.degraded,
		};
	});
	const signals = collectEnsembleSignals(normalizedChildren);
	const agreementEvidence = boundedStringList(
		signals.agreement_evidence,
		budget,
	);
	const decisionCriteria = boundedStringList(signals.decision_criteria, budget);
	const riskRequirements = boundedStringList(
		signals.risk_verification_requirements,
		budget,
	);
	const aggregateTruncated =
		agreementEvidence.truncated ||
		decisionCriteria.truncated ||
		riskRequirements.truncated;
	const truncated =
		aggregateTruncated || normalizedChildren.some((child) => child.truncated);
	return {
		owner: "imm-planner",
		children_advisory_only: true,
		agreement_evidence: agreementEvidence.values,
		decision_criteria: decisionCriteria.values,
		risk_verification_requirements: riskRequirements.values,
		final_spec_and_plan_owner: "imm-planner",
		budget,
		truncated,
		degraded: truncated || normalizedChildren.some((child) => child.degraded),
	};
}

export function normalizeBrainstormEnsemblePacket(
	children: Array<{
		candidate_id: string;
		tier: string;
		recommendations?: string[];
		disagreements?: string[];
		blockers?: string[];
		open_questions?: string[];
		truncated?: boolean;
		degraded?: boolean;
	}>,
	budget: AdvisoryPacketBudget = DEFAULT_ADVISORY_PACKET_BUDGET,
): {
	owner: "imm-brainstorm";
	children_advisory_only: true;
	framing_evidence: string[];
	decision_criteria: string[];
	open_questions: string[];
	risk_verification_requirements: string[];
	planner_handoff_owner: "imm-planner";
	budget: AdvisoryPacketBudget;
	truncated: boolean;
	degraded: boolean;
} {
	const normalizedChildren = children.map((child) => {
		const signals = normalizeChildSignals(
			child,
			budget,
			Boolean(child.degraded),
		);
		return {
			candidate_id: child.candidate_id,
			tier: child.tier,
			...signals,
			truncated: Boolean(child.truncated) || signals.truncated,
			degraded: Boolean(child.degraded) || signals.degraded,
		};
	});
	const signals = collectEnsembleSignals(normalizedChildren);
	const framingEvidence = boundedStringList(signals.agreement_evidence, budget);
	const decisionCriteria = boundedStringList(signals.decision_criteria, budget);
	const openQuestions = boundedStringList(
		[...new Set(normalizedChildren.flatMap((child) => child.open_questions))],
		budget,
	);
	const riskRequirements = boundedStringList(
		signals.risk_verification_requirements,
		budget,
	);
	const aggregateTruncated =
		framingEvidence.truncated ||
		decisionCriteria.truncated ||
		openQuestions.truncated ||
		riskRequirements.truncated;
	const truncated =
		aggregateTruncated || normalizedChildren.some((child) => child.truncated);
	return {
		owner: "imm-brainstorm",
		children_advisory_only: true,
		framing_evidence: framingEvidence.values,
		decision_criteria: decisionCriteria.values,
		open_questions: openQuestions.values,
		risk_verification_requirements: riskRequirements.values,
		planner_handoff_owner: "imm-planner",
		budget,
		truncated,
		degraded: truncated || normalizedChildren.some((child) => child.degraded),
	};
}
