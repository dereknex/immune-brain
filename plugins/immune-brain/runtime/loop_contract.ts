/**
 * Runtime validation for `imm-loop` subagent output.
 *
 * The loop parent collects QA and reviewer decisions from isolated children.
 * Those decisions are untrusted input: they arrive as free-form JSON produced
 * by a model and are then converted into State Ledger writes. This module owns
 * the machine-checkable half of that contract so the loop skill does not have
 * to re-derive it in prose.
 */
import {
	buildRoleDelegationPacket,
	type RoleDelegationContext,
	type RoleDelegationPacket,
	type InternalRole,
} from "./role_prompt_bridge";

export type LoopRole = InternalRole;

export type LoopRoleContext = RoleDelegationPacket;

export type LoopRouteOwnership =
	| "plan"
	| "kernel"
	| "brainstorm"
	| "planner"
	| "loop";
export type LoopRouteTarget =
	| "step"
	| "test-repair"
	| "pr-repair"
	| "architecture-exploration"
	| "advisory-review"
	| "compounder";
export type LoopRouteNext =
	| "executor"
	| "test-fixer"
	| "pr-fix"
	| "arch-explorer"
	| "advisory-reviewer"
	| "compounder"
	| "imm_kernel_canary"
	| "imm-planner";

export interface LoopRoute {
	entry: "imm-loop";
	next: LoopRouteNext;
}

/**
 * Project the authoritative task owner and bounded target into Loop's next
 * authority. This is routing only; State Ledger and Kernel remain authoritative.
 */
export function resolveLoopRoute(input: {
	ownership: LoopRouteOwnership;
	target: LoopRouteTarget;
	scope_expansion?: boolean;
}): LoopRoute {
	if (input.scope_expansion) return { entry: "imm-loop", next: "imm-planner" };
	if (
		input.target === "architecture-exploration" &&
		(input.ownership === "brainstorm" || input.ownership === "planner")
	) {
		return { entry: "imm-loop", next: "arch-explorer" };
	}
	if (
		input.target === "advisory-review" &&
		(input.ownership === "brainstorm" || input.ownership === "planner")
	) {
		return { entry: "imm-loop", next: "advisory-reviewer" };
	}
	if (input.target === "compounder") {
		if (input.ownership !== "loop") {
			throw new Error("Compounder routing requires Loop ownership");
		}
		return { entry: "imm-loop", next: "compounder" };
	}
	if (input.ownership === "kernel") {
		return { entry: "imm-loop", next: "imm_kernel_canary" };
	}
	const nextByTarget: Record<"step" | "test-repair" | "pr-repair", LoopRouteNext> = {
		step: "executor",
		"test-repair": "test-fixer",
		"pr-repair": "pr-fix",
	};
	if (!(input.target in nextByTarget)) {
		throw new Error(
			`${input.ownership} ownership cannot route ${input.target} through Loop`,
		);
	}
	return {
		entry: "imm-loop",
		next: nextByTarget[
			input.target as "step" | "test-repair" | "pr-repair"
		],
	};
}

export type LoopAction =
	| { entry: "imm-loop"; next: "executor"; context: LoopRoleContext }
	| {
			entry: "imm-loop";
			next: "test-fixer" | "pr-fix" | "arch-explorer" | "advisory-reviewer" | "compounder";
			dispatch: LoopRoleDispatch;
	  }
	| {
			entry: "imm-loop";
			next: "imm_kernel_canary";
			tool: {
				name: "imm_kernel_canary";
				operation:
					| "status"
					| "record_evidence"
					| "advance_assurance"
					| "submit_review"
					| "request_authorization"
					| "complete";
			};
	  }
	| { entry: "imm-loop"; next: "imm-planner"; reason: "scope_expansion" }
	| { entry: "imm-loop"; next: "none"; reason: "no_reusable_learning" };

function hasReusableLearningEvidence(context: RoleDelegationContext): boolean {
	if (
		context.workflow_phase !== "complete" ||
		context.assurance_complete !== true ||
		context.required_reviews_complete !== true
	) {
		return false;
	}
	if (!Array.isArray(context.closed_steps)) return false;
	return context.closed_steps.some((rawStep) => {
		const step = asRecord(rawStep);
		if (step.state !== "closed") return false;
		const evidence = asRecord(step.learning_evidence);
		return (
			evidence.reusable === true &&
			nonEmptyString(evidence.summary) !== null &&
			nonEmptyString(evidence.evidence_ref) !== null
		);
	});
}

export function buildLoopAction(input: {
	ownership: LoopRouteOwnership;
	target: LoopRouteTarget;
	context?: RoleDelegationContext;
	scope_expansion?: boolean;
	kernel_operation?: Extract<LoopAction, { next: "imm_kernel_canary" }>["tool"]["operation"];
}): LoopAction {
	const route = resolveLoopRoute(input);
	if (route.next === "imm-planner") {
		return { entry: "imm-loop", next: "imm-planner", reason: "scope_expansion" };
	}
	if (route.next === "compounder") {
		if (!input.context || !hasReusableLearningEvidence(input.context)) {
			return {
				entry: "imm-loop",
				next: "none",
				reason: "no_reusable_learning",
			};
		}
		return {
			entry: "imm-loop",
			next: "compounder",
			dispatch: buildLoopRoleDispatch({ role: "compounder", context: input.context }),
		};
	}
	if (!input.context) throw new Error(`Loop ${route.next} action requires context`);
	if (route.next === "executor") {
		return {
			entry: "imm-loop",
			next: "executor",
			context: buildRoleDelegationPacket({ role: "executor", context: input.context }),
		};
	}
	if (route.next === "test-fixer") {
		return {
			entry: "imm-loop",
			next: "test-fixer",
			dispatch: buildLoopRoleDispatch({ role: "test-fixer", context: input.context }),
		};
	}
	if (route.next === "pr-fix") {
		return {
			entry: "imm-loop",
			next: "pr-fix",
			dispatch: buildLoopRoleDispatch({ role: "pr-fix", context: input.context }),
		};
	}
	if (route.next === "arch-explorer") {
		return {
			entry: "imm-loop",
			next: "arch-explorer",
			dispatch: buildLoopRoleDispatch({ role: "arch-explorer", context: input.context }),
		};
	}
	if (route.next === "advisory-reviewer") {
		if (!nonEmptyString(input.context.lens)) {
			throw new Error("advisory review requires an explicit lens");
		}
		return {
			entry: "imm-loop",
			next: "advisory-reviewer",
			dispatch: buildLoopRoleDispatch({ role: "advisory-reviewer", context: input.context }),
		};
	}
	return {
		entry: "imm-loop",
		next: "imm_kernel_canary",
		tool: {
			name: "imm_kernel_canary",
			operation: input.kernel_operation ?? "status",
		},
	};
}

export interface LoopRoleDispatch {
	packet: RoleDelegationPacket;
	call: {
		subagent_type: "general-purpose";
		description: string;
		prompt: string;
		inherit_context: false;
		isolated: true;
		isolation: "worktree";
		run_in_background: false;
	};
}

export function buildLoopRoleDispatch(input: {
	role: LoopRole;
	context: RoleDelegationContext;
	description?: string;
}): LoopRoleDispatch {
	const packet = buildRoleDelegationPacket(input);
	return {
		packet,
		call: {
			subagent_type: "general-purpose",
			description: input.description ?? `${input.role} internal role`,
			prompt: packet.prompt,
			inherit_context: false,
			isolated: true,
			isolation: "worktree",
			run_in_background: false,
		},
	};
}

function asRecord(raw: unknown): Record<string, unknown> {
	return raw && typeof raw === "object" && !Array.isArray(raw)
		? (raw as Record<string, unknown>)
		: {};
}

function nonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Any field the child invents is treated as authority-widening: the loop parent
 * turns this payload into a Ledger write, so silently ignoring extras would let
 * a child smuggle in gate, successor, or scope intent the contract never grants.
 */
function collectUnknownFields(
	record: Record<string, unknown>,
	allowed: string[],
): string[] {
	return Object.keys(record)
		.filter((key) => !allowed.includes(key))
		.map((key) => `unknown field: ${key}`);
}

export interface InternalRoleOutputRejection {
	valid: false;
	role: "arch-explorer" | "advisory-reviewer";
	violations: string[];
}

export interface ArchitectureExplorerOutputAcceptance {
	valid: true;
	role: "arch-explorer";
	candidates: unknown[];
	evidence: unknown[];
	risks: unknown[];
	open_questions: unknown[];
}

export interface AdvisoryReviewerOutputAcceptance {
	valid: true;
	role: "advisory-reviewer";
	recommendations: unknown[];
	disagreements: unknown[];
	open_questions: unknown[];
	blockers: unknown[];
}

export type ArchitectureExplorerOutputValidation =
	| ArchitectureExplorerOutputAcceptance
	| InternalRoleOutputRejection;
export type AdvisoryReviewerOutputValidation =
	| AdvisoryReviewerOutputAcceptance
	| InternalRoleOutputRejection;

type StructuredRoleOutputResult =
	| InternalRoleOutputRejection
	| { valid: true; values: Record<string, unknown[]> };

function normalizeStructuredRoleOutput(
	role: "arch-explorer" | "advisory-reviewer",
	raw: unknown,
	fields: string[],
): StructuredRoleOutputResult {
	const record = asRecord(raw);
	const violations = collectUnknownFields(record, fields);
	const values: Record<string, unknown[]> = {};
	for (const field of fields) {
		if (!Array.isArray(record[field])) {
			violations.push(`${field} must be an array`);
			continue;
		}
		values[field] = record[field] as unknown[];
	}
	if (violations.length > 0) return { valid: false, role, violations };
	return { valid: true, values };
}

export function normalizeArchitectureExplorerOutput(
	raw: unknown,
): ArchitectureExplorerOutputValidation {
	const values = normalizeStructuredRoleOutput(
		"arch-explorer",
		raw,
		["candidates", "evidence", "risks", "open_questions"],
	);
	if (!values.valid) return values;
	return {
		valid: true,
		role: "arch-explorer",
		candidates: values.values.candidates,
		evidence: values.values.evidence,
		risks: values.values.risks,
		open_questions: values.values.open_questions,
	};
}

export function normalizeAdvisoryReviewerOutput(
	raw: unknown,
): AdvisoryReviewerOutputValidation {
	const values = normalizeStructuredRoleOutput(
		"advisory-reviewer",
		raw,
		["recommendations", "disagreements", "open_questions", "blockers"],
	);
	if (!values.valid) return values;
	return {
		valid: true,
		role: "advisory-reviewer",
		recommendations: values.values.recommendations,
		disagreements: values.values.disagreements,
		open_questions: values.values.open_questions,
		blockers: values.values.blockers,
	};
}
