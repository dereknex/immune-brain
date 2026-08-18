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

export function buildLoopRoleContext(input: {
	role: LoopRole;
	context: RoleDelegationContext;
}): LoopRoleContext {
	return buildLoopRoleDelegationPacket(input);
}

export type LoopRouteOwnership = "plan" | "kernel";
export type LoopRouteTarget = "step" | "test-repair" | "pr-repair";
export type LoopRouteNext =
	| "executor"
	| "test-fixer"
	| "pr-fix"
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
	if (input.ownership === "kernel") {
		return { entry: "imm-loop", next: "imm_kernel_canary" };
	}
	const nextByTarget: Record<LoopRouteTarget, LoopRouteNext> = {
		step: "executor",
		"test-repair": "test-fixer",
		"pr-repair": "pr-fix",
	};
	return { entry: "imm-loop", next: nextByTarget[input.target] };
}

export type LoopAction =
	| { entry: "imm-loop"; next: "executor"; context: LoopRoleContext }
	| {
			entry: "imm-loop";
			next: "test-fixer" | "pr-fix";
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
	| { entry: "imm-loop"; next: "imm-planner"; reason: "scope_expansion" };

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
	if (!input.context) throw new Error(`Loop ${route.next} action requires context`);
	if (route.next === "executor") {
		return {
			entry: "imm-loop",
			next: "executor",
			context: buildLoopRoleContext({ role: "executor", context: input.context }),
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
	return {
		entry: "imm-loop",
		next: "imm_kernel_canary",
		tool: {
			name: "imm_kernel_canary",
			operation: input.kernel_operation ?? "status",
		},
	};
}

export function buildLoopRoleDelegationPacket(input: {
	role: LoopRole;
	context: RoleDelegationContext;
}): RoleDelegationPacket {
	return buildRoleDelegationPacket(input);
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
	const packet = buildLoopRoleDelegationPacket(input);
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

export type ChildOutputReason = "qa_output_invalid" | "reviewer_output_invalid";

export interface ChildOutputRejection {
	valid: false;
	reason: ChildOutputReason;
	violations: string[];
}

export type QaChildDecision = "pass" | "rework" | "replan";

const QA_DECISIONS: QaChildDecision[] = ["pass", "rework", "replan"];

const QA_FIELDS = [
	"decision",
	"evidence",
	"target_id",
	"repair_target",
	"notes",
	"artifacts",
];

export interface QaChildOutputAcceptance {
	valid: true;
	decision: QaChildDecision;
	evidence: string;
	target_id: string;
	repair_target: string | null;
	notes: string | null;
	artifacts: string | null;
}

export type QaChildOutputValidation =
	| QaChildOutputAcceptance
	| ChildOutputRejection;

export interface QaChildOutputExpectation {
	target_id: string;
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

export function validateQaChildOutput(
	raw: unknown,
	expected: QaChildOutputExpectation,
): QaChildOutputValidation {
	const record = asRecord(raw);
	const violations: string[] = collectUnknownFields(record, QA_FIELDS);

	if (!QA_DECISIONS.includes(record.decision as QaChildDecision)) {
		violations.push(`decision must be one of ${QA_DECISIONS.join(", ")}`);
	}

	const evidence = nonEmptyString(record.evidence);
	if (!evidence) {
		violations.push("evidence must be a non-empty string");
	}

	if (String(record.target_id ?? "") !== expected.target_id) {
		violations.push(
			`target_id must equal the current target ${expected.target_id}`,
		);
	}

	const repairTarget = nonEmptyString(record.repair_target);
	if (record.decision === "rework" && !repairTarget) {
		violations.push("repair_target is required for a rework decision");
	}
	if (record.decision !== "rework" && record.repair_target !== undefined) {
		violations.push(
			`repair_target must be omitted for a ${String(record.decision)} decision`,
		);
	}

	// `imm-review` refuses a rejection without a reason, so the parent needs one
	// from the child. A rework already names what to repair; a replan forbids
	// repair_target, which leaves notes as its only place to say why.
	const notes =
		nonEmptyString(record.notes) ??
		(record.decision === "rework" ? repairTarget : null);
	if (record.decision === "replan" && !notes) {
		violations.push("notes is required for a replan decision");
	}

	if (violations.length > 0) {
		return { valid: false, reason: "qa_output_invalid", violations };
	}

	return {
		valid: true,
		decision: record.decision as QaChildDecision,
		evidence: evidence as string,
		target_id: expected.target_id,
		repair_target: repairTarget,
		notes,
		artifacts: nonEmptyString(record.artifacts),
	};
}

export type ReviewChildDecision = "pass" | "follow_up" | "replan";

const REVIEW_DECISIONS: ReviewChildDecision[] = ["pass", "follow_up", "replan"];

const REVIEW_FIELDS = [
	"decision",
	"evidence_ref",
	"findings",
	"review_gate",
	"changed_files_signature",
	"scope",
	"change_goal",
	"verification_hint",
];

export interface ReviewChildOutputAcceptance {
	valid: true;
	decision: ReviewChildDecision;
	evidence_ref: string;
	findings: unknown[];
	review_gate: string;
	changed_files_signature: string;
	scope: string[] | null;
	change_goal: string | null;
	verification_hint: string | null;
}

export type ReviewChildOutputValidation =
	| ReviewChildOutputAcceptance
	| ChildOutputRejection;

export interface ReviewChildOutputExpectation {
	review_gate: string;
	changed_files_signature: string;
}

export function validateReviewChildOutput(
	raw: unknown,
	expected: ReviewChildOutputExpectation,
): ReviewChildOutputValidation {
	const record = asRecord(raw);
	const violations: string[] = collectUnknownFields(record, REVIEW_FIELDS);

	if (!REVIEW_DECISIONS.includes(record.decision as ReviewChildDecision)) {
		violations.push(`decision must be one of ${REVIEW_DECISIONS.join(", ")}`);
	}

	const evidenceRef = nonEmptyString(record.evidence_ref);
	if (!evidenceRef) {
		violations.push("evidence_ref must be a non-empty string");
	}

	const findings = Array.isArray(record.findings) ? record.findings : [];
	if (record.decision === "pass" && findings.length > 0) {
		violations.push("findings must be empty for a pass decision");
	}
	if (record.decision !== "pass" && findings.length === 0) {
		violations.push(
			`findings must be non-empty for a ${String(record.decision)} decision`,
		);
	}

	if (String(record.review_gate ?? "") !== expected.review_gate) {
		violations.push(`review_gate must equal ${expected.review_gate}`);
	}
	if (
		String(record.changed_files_signature ?? "") !==
		expected.changed_files_signature
	) {
		violations.push(
			`changed_files_signature must equal ${expected.changed_files_signature}`,
		);
	}

	const scope = Array.isArray(record.scope)
		? (record.scope as string[]).filter((path) => nonEmptyString(path))
		: null;
	const changeGoal = nonEmptyString(record.change_goal);
	const verificationHint = nonEmptyString(record.verification_hint);
	if (record.decision === "follow_up") {
		if (!scope || scope.length === 0) {
			violations.push("scope is required for a follow_up decision");
		}
		if (!changeGoal) {
			violations.push("change_goal is required for a follow_up decision");
		}
		if (!verificationHint) {
			violations.push("verification_hint is required for a follow_up decision");
		}
	}

	if (violations.length > 0) {
		return { valid: false, reason: "reviewer_output_invalid", violations };
	}

	return {
		valid: true,
		decision: record.decision as ReviewChildDecision,
		evidence_ref: evidenceRef as string,
		findings,
		review_gate: expected.review_gate,
		changed_files_signature: expected.changed_files_signature,
		scope,
		change_goal: changeGoal,
		verification_hint: verificationHint,
	};
}
