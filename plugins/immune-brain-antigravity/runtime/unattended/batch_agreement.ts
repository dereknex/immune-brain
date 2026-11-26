// Self-contained BatchAgreement (Spec unified-lane-sessions D3).
// One builder validates and issues it for the Host entry,
// refusing unknown confirmation.source, return_policy, interaction_mode,
// or malformed final_verification with batch_agreement_invalid before
// writing any state.
import { computeBatchPlanDigest, type BatchPlanChild } from "../kernel/batch_authority";

/** ADR 0043 retired the Loop daemon's `tracker_approval` and `policy_auto` sources. */
export type BatchConfirmationSource = "native_gate";
export type BatchReturnPolicy = "checkout_delivery" | "retain_branch";
export type BatchInteractionMode = "interactive_host" | "parent_relayed";

export interface BatchFinalVerificationPolicy {
	required: boolean;
	commands: string[];
}

export interface BatchConfirmation {
	source: BatchConfirmationSource;
	ref: string;
}

export interface BatchAgreement {
	batch_id: string;
	initiative_slug: string;
	children: BatchPlanChild[];
	plan_digest: string;
	plan_source?: "single_task";
	branch?: string;
	base_head: string;
	budget: { max_children: number; qa_failure_limit: number };
	confirmation: BatchConfirmation;
	final_verification: BatchFinalVerificationPolicy;
	return_policy: BatchReturnPolicy;
	interaction_mode: BatchInteractionMode;
	actor?: string;
}

export type AuthorizeBatchInput = {
	batch_id: string;
	initiative_slug: string;
	children: BatchPlanChild[];
	base_head: string;
	branch?: string;
	budget: { max_children: number; qa_failure_limit: number };
	confirmation: { source: string; ref?: string };
	final_verification: { required?: boolean; commands?: unknown };
	return_policy: string;
	interaction_mode: string;
	actor?: string;
	plan_source?: "single_task";
	plan_digest?: string;
};

export type AuthorizeBatchResult =
	| { ok: true; agreement: BatchAgreement }
	| { ok: false; code: "batch_agreement_invalid"; reason: string };

const CONFIRMATION_SOURCES: ReadonlySet<string> = new Set(["native_gate"]);
const RETURN_POLICIES: ReadonlySet<string> = new Set(["checkout_delivery", "retain_branch"]);
const INTERACTION_MODES: ReadonlySet<string> = new Set(["interactive_host", "parent_relayed"]);

function invalid(reason: string): AuthorizeBatchResult {
	return { ok: false, code: "batch_agreement_invalid", reason: `batch_agreement_invalid: ${reason}` };
}

/**
 * Validate one agreement proposal without touching the filesystem.
 * On failure returns batch_agreement_invalid and writes zero files.
 */
export function authorizeBatch(input: AuthorizeBatchInput): AuthorizeBatchResult {
	if (!input || typeof input !== "object") return invalid("agreement must be an object");
	if (typeof input.batch_id !== "string" || !input.batch_id) return invalid("batch_id must be a non-empty string");
	if (typeof input.initiative_slug !== "string" || !input.initiative_slug) return invalid("initiative_slug must be a non-empty string");
	if (!Array.isArray(input.children) || input.children.length === 0) return invalid("children must be a non-empty array");
	if (typeof input.base_head !== "string" || !input.base_head) return invalid("base_head must be a non-empty string");
	if (!input.budget || typeof input.budget !== "object" ||
		!Number.isInteger(input.budget.max_children) || input.budget.max_children <= 0 ||
		!Number.isInteger(input.budget.qa_failure_limit) || input.budget.qa_failure_limit <= 0)
		return invalid("budget must carry positive max_children and qa_failure_limit");
	const confirmation = input.confirmation as { source?: unknown; ref?: unknown };
	if (!confirmation || typeof confirmation !== "object") return invalid("confirmation must be an object");
	if (typeof confirmation.source !== "string" || !CONFIRMATION_SOURCES.has(confirmation.source))
		return invalid(`unknown confirmation.source ${String(confirmation.source)}`);
	if (typeof confirmation.ref !== "string" || !confirmation.ref) return invalid("confirmation.ref must be a non-empty string");
	const fv = input.final_verification as { required?: unknown; commands?: unknown };
	if (!fv || typeof fv !== "object") return invalid("final_verification must be an object");
	if (typeof fv.required !== "boolean") return invalid("final_verification.required must be a boolean");
	if (!Array.isArray(fv.commands)) return invalid("final_verification.commands must be an array");
	for (const command of fv.commands) {
		if (typeof command !== "string" || !command.trim()) return invalid("final_verification.commands must be non-empty strings");
	}
	if (typeof input.return_policy !== "string" || !RETURN_POLICIES.has(input.return_policy))
		return invalid(`unknown return_policy ${String(input.return_policy)}`);
	if (typeof input.interaction_mode !== "string" || !INTERACTION_MODES.has(input.interaction_mode))
		return invalid(`unknown interaction_mode ${String(input.interaction_mode)}`);
	let planDigest: string;
	try {
		planDigest = computeBatchPlanDigest(input.children);
	} catch (error) {
		return invalid(error instanceof Error ? error.message : "invalid child plan");
	}
	if (input.plan_digest !== undefined && input.plan_digest !== planDigest)
		return invalid("plan_digest does not match the confirmed child plan");
	if (input.plan_source !== undefined && input.plan_source !== "single_task")
		return invalid(`unknown plan_source ${String(input.plan_source)}`);
	const agreement: BatchAgreement = {
		batch_id: input.batch_id,
		initiative_slug: input.initiative_slug,
		children: input.children.map(child => ({ ...child, blocked_by: [...child.blocked_by] })),
		plan_digest: planDigest,
		...(input.plan_source ? { plan_source: input.plan_source } : {}),
		...(input.branch ? { branch: input.branch } : {}),
		base_head: input.base_head,
		budget: { ...input.budget },
		confirmation: { source: confirmation.source as BatchConfirmationSource, ref: confirmation.ref as string },
		final_verification: { required: fv.required as boolean, commands: [...(fv.commands as string[])] },
		return_policy: input.return_policy as BatchReturnPolicy,
		interaction_mode: input.interaction_mode as BatchInteractionMode,
		...(input.actor ? { actor: input.actor } : {}),
	};
	return { ok: true, agreement };
}
