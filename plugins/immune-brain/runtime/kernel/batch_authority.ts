// Batch Authorization for unattended Initiative batch runs. NOT exported from
// kernel/index.ts. One literal-user confirmation binds an ordered child plan;
// each child consumes exactly one slot and derives its own Enrollment
// capability from a freshly recomputed preparation at enroll time.
//
// The confirmation cannot bind a preparation digest: enrollment rejects a moved
// Git HEAD, and every settled child moves it. The batch binds `plan_digest`
// plus an advancing HEAD lineage instead.

import { createHash } from "node:crypto";
import { createCapabilityRegistry } from "./capability_registry";
import type { EnrollmentCapabilityBinding } from "./enrollment_authority";
import { preparePiCanary, type PiCanaryPreparation } from "./pi_canary_prepare";

export const BATCH_AUTHORITY_CAPABILITY_BRAND = Symbol.for(
	"assurance-kernel.batch-authority-capability-brand",
);

const GIT_COMMIT_ID = /^[a-f0-9]{40}$/;

export interface BatchPlanChild {
	task_id: string;
	intent_path: string;
	intent_revision: number;
	intent_content_hash: string;
	blocked_by: string[];
}

export interface BatchBudget {
	max_children: number;
	deadline_at: string;
	qa_failure_limit: number;
}

export interface BatchAuthorizationBinding {
	batch_id: string;
	initiative_slug: string;
	plan_digest: string;
	branch: string;
	base_head: string;
	budget: BatchBudget;
	actor_id: string;
	confirmation_ref: string;
	expires_at: string;
	nonce: string;
}

export interface ValidatedBatchAuthorization {
	batch_id: string;
	initiative_slug: string;
	plan_digest: string;
	branch: string;
	base_head: string;
	budget: BatchBudget;
	actor_id: string;
	confirmation_ref: string;
	issued_at: string;
	expires_at: string;
	nonce: string;
}

export interface BatchAuthorityRegistry {
	readonly brand: symbol;
	/**
	 * Issue one Batch Authorization bound to an exact ordered child plan.
	 * The plan is retained so per-child consumption can prove membership.
	 */
	issue(
		binding: BatchAuthorizationBinding,
		children: BatchPlanChild[],
		issuedAt?: string,
	): object;
	inspect(
		capability: object,
		expected: BatchAuthorizationBinding,
		now?: number,
	): ValidatedBatchAuthorization;
	children(capability: object): BatchPlanChild[];
	consumedChildren(capability: object): string[];
	isChildConsumed(capability: object, taskId: string): boolean;
	/** Mark exactly one child slot used; the authorization stays valid for the rest. */
	consumeChild(
		capability: object,
		expected: BatchAuthorizationBinding,
		taskId: string,
		now?: number,
	): ValidatedBatchAuthorization;
	/** Undo one slot consumption when the bound write did not commit. */
	releaseChild(capability: object, taskId: string): void;
	isExhausted(capability: object): boolean;
}

function sha256Hex(bytes: string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
		.join(",")}}`;
}

/**
 * The authorization subject. A TaskIntent carries no Initiative or dependency
 * field, so the confirmed ordered plan — not remote tracker state — is what the
 * literal user approves, and this digest is what binds it.
 */
export function computeBatchPlanDigest(children: BatchPlanChild[]): string {
	const canonical = children.map((child) => ({
		blocked_by: [...child.blocked_by],
		intent_content_hash: child.intent_content_hash,
		intent_path: child.intent_path,
		intent_revision: child.intent_revision,
		task_id: child.task_id,
	}));
	return `sha256:${sha256Hex(stableStringify(canonical))}`;
}

function requireNonEmpty(binding: BatchAuthorizationBinding): void {
	const missing: string[] = [];
	for (const key of [
		"batch_id",
		"initiative_slug",
		"plan_digest",
		"branch",
		"base_head",
		"actor_id",
		"confirmation_ref",
		"expires_at",
		"nonce",
	] as const) {
		const value = binding[key];
		if (value === undefined || value === null || value === "") missing.push(key);
	}
	if (!binding.budget || typeof binding.budget !== "object") missing.push("budget");
	if (missing.length > 0)
		throw new Error(`batch authorization binding is incomplete: ${missing.join(", ")}`);
}

function validateBudget(budget: BatchBudget, issuedAt: string): void {
	if (!Number.isInteger(budget.max_children) || budget.max_children <= 0)
		throw new Error("batch budget max_children must be a positive integer");
	if (!Number.isInteger(budget.qa_failure_limit) || budget.qa_failure_limit <= 0)
		throw new Error("batch budget qa_failure_limit must be a positive integer");
	const deadline = Date.parse(budget.deadline_at);
	if (Number.isNaN(deadline) || deadline <= Date.parse(issuedAt))
		throw new Error("batch budget must have a future deadline_at");
}

function validateChildren(children: BatchPlanChild[], planDigest: string): void {
	if (!Array.isArray(children) || children.length === 0)
		throw new Error("batch authorization requires a non-empty child plan");
	const seen = new Set<string>();
	for (const child of children) {
		if (!child || typeof child !== "object")
			throw new Error("batch plan child must be an object");
		for (const key of ["task_id", "intent_path", "intent_content_hash"] as const) {
			if (typeof child[key] !== "string" || child[key] === "")
				throw new Error(`batch plan child ${key} must be a non-empty string`);
		}
		if (!Number.isInteger(child.intent_revision) || child.intent_revision <= 0)
			throw new Error("batch plan child intent_revision must be a positive integer");
		if (!Array.isArray(child.blocked_by) || child.blocked_by.some((id) => typeof id !== "string" || id === ""))
			throw new Error("batch plan child blocked_by must be an array of task ids");
		if (seen.has(child.task_id))
			throw new Error(`batch plan child ${child.task_id} appears more than once`);
		seen.add(child.task_id);
	}
	for (const child of children) {
		for (const blocker of child.blocked_by) {
			if (!seen.has(blocker))
				throw new Error(
					`batch plan child ${child.task_id} is blocked by ${blocker}, which is not in the confirmed plan`,
				);
		}
	}
	if (computeBatchPlanDigest(children) !== planDigest)
		throw new Error("batch plan digest does not match the confirmed child plan");
}

export function createBatchAuthorityRegistry(): BatchAuthorityRegistry {
	const inner = createCapabilityRegistry<
		BatchAuthorizationBinding,
		BatchAuthorizationBinding,
		ValidatedBatchAuthorization
	>(
		BATCH_AUTHORITY_CAPABILITY_BRAND,
		{
			validateBinding(binding, issuedAt) {
				requireNonEmpty(binding);
				if (binding.actor_id !== "user")
					throw new Error("batch authorization requires a literal-user actor_id");
				if (!GIT_COMMIT_ID.test(binding.base_head))
					throw new Error("batch authorization base_head must be a committed 40-hex commit id");
				const expires = Date.parse(binding.expires_at);
				if (Number.isNaN(expires) || expires <= Date.parse(issuedAt))
					throw new Error("batch authorization must have a future expiry");
				validateBudget(binding.budget, issuedAt);
			},
			validateAndProject(state, expected, now) {
				// Fail closed on an unusable clock. `now` reaches here as
				// Date.parse(...) from callers, and NaN makes every `<=` compare
				// false, which would silently accept an expired authorization.
				if (!Number.isFinite(now))
					throw new Error("batch authorization requires a valid clock");
				const expires = Date.parse(state.expires_at);
				if (Number.isNaN(expires) || expires <= now)
					throw new Error("batch authorization has expired");
				for (const key of Object.keys(expected) as Array<keyof BatchAuthorizationBinding>) {
					if (key === "budget") {
						const a = state.budget ?? ({} as BatchBudget);
						const b = expected.budget ?? ({} as BatchBudget);
						if (
							a.max_children !== b.max_children ||
							a.deadline_at !== b.deadline_at ||
							a.qa_failure_limit !== b.qa_failure_limit
						)
							throw new Error("batch authorization budget mismatch");
						continue;
					}
					if (state[key] !== expected[key])
						throw new Error(`batch authorization ${key} mismatch`);
				}
				return {
					batch_id: state.batch_id,
					initiative_slug: state.initiative_slug,
					plan_digest: state.plan_digest,
					branch: state.branch,
					base_head: state.base_head,
					budget: { ...state.budget },
					actor_id: state.actor_id,
					confirmation_ref: state.confirmation_ref,
					issued_at: state.issued_at,
					expires_at: state.expires_at,
					nonce: state.nonce,
				};
			},
		},
		"batch authorization",
	);

	const plans = new WeakMap<object, BatchPlanChild[]>();
	const consumed = new WeakMap<object, Set<string>>();

	function planOf(capability: object): BatchPlanChild[] {
		const plan = plans.get(capability);
		if (!plan) throw new Error("batch authorization capability is not recognized by this registry");
		return plan;
	}

	function slotsOf(capability: object): Set<string> {
		const slots = consumed.get(capability);
		if (!slots) throw new Error("batch authorization capability is not recognized by this registry");
		return slots;
	}

	return {
		brand: inner.brand,
		issue(binding, children, issuedAt = new Date().toISOString()) {
			requireNonEmpty(binding);
			validateChildren(children, binding.plan_digest);
			const capability = inner.issue(binding, issuedAt) as object;
			plans.set(
				capability,
				children.map((child) => ({ ...child, blocked_by: [...child.blocked_by] })),
			);
			consumed.set(capability, new Set<string>());
			return capability;
		},
		inspect(capability, expected, now = Date.now()) {
			planOf(capability);
			return inner.inspect(capability, expected, now);
		},
		children(capability) {
			return planOf(capability).map((child) => ({ ...child, blocked_by: [...child.blocked_by] }));
		},
		consumedChildren(capability) {
			return [...slotsOf(capability)];
		},
		isChildConsumed(capability, taskId) {
			return slotsOf(capability).has(taskId);
		},
		consumeChild(capability, expected, taskId, now = Date.now()) {
			const validated = this.inspect(capability, expected, now);
			const plan = planOf(capability);
			if (!plan.some((child) => child.task_id === taskId))
				throw new Error(`batch_child_not_in_plan: ${taskId}`);
			const slots = slotsOf(capability);
			if (slots.has(taskId)) throw new Error(`batch_child_slot_consumed: ${taskId}`);
			slots.add(taskId);
			return validated;
		},
		releaseChild(capability, taskId) {
			slotsOf(capability).delete(taskId);
		},
		isExhausted(capability) {
			return slotsOf(capability).size >= planOf(capability).length;
		},
	};
}

export interface DeriveChildEnrollmentInput {
	capability: object;
	binding: BatchAuthorizationBinding;
	task_id: string;
	/** Batch HEAD lineage: base_head, then each commit this batch created. */
	expected_head: string;
	now: string;
}

export interface DerivedChildEnrollment {
	child: BatchPlanChild;
	preparation: PiCanaryPreparation;
	binding: EnrollmentCapabilityBinding;
}

/**
 * Derive one child's Enrollment binding from a Batch Authorization. The
 * preparation digest is recomputed here, never carried from the confirmation.
 */
export function deriveChildEnrollment(
	root: string,
	registry: BatchAuthorityRegistry,
	input: DeriveChildEnrollmentInput,
): DerivedChildEnrollment {
	const validated = registry.inspect(input.capability, input.binding, Date.parse(input.now));
	const child = registry
		.children(input.capability)
		.find((entry) => entry.task_id === input.task_id);
	if (!child) throw new Error(`batch_child_not_in_plan: ${input.task_id}`);
	if (registry.isChildConsumed(input.capability, input.task_id))
		throw new Error(`batch_child_slot_consumed: ${input.task_id}`);
	if (!GIT_COMMIT_ID.test(input.expected_head))
		throw new Error("batch_head_lineage_broken: expected_head is not a commit id");

	const preparation = preparePiCanary(root, { task_id: input.task_id, now: input.now });
	if (!preparation.git_base_head)
		throw new Error(preparation.git_error ?? "enrollment requires a committed Git HEAD");
	if (preparation.git_base_head !== input.expected_head)
		throw new Error(
			`batch_head_lineage_broken: expected ${input.expected_head}, found ${preparation.git_base_head}`,
		);
	if (!preparation.intent)
		throw new Error(`batch_child_intent_changed: ${input.task_id} intent sidecar is unreadable`);
	if (
		preparation.intent.path !== child.intent_path ||
		preparation.intent.revision !== child.intent_revision ||
		preparation.intent.content_hash !== child.intent_content_hash
	)
		throw new Error(`batch_child_intent_changed: ${input.task_id}`);

	// The lineage starts at the confirmed base_head. Until this batch has
	// settled a child there is no commit it could have created, so a
	// caller-supplied expected_head other than base_head is not a lineage.
	// Checked last so the intent-divergence reason keeps its precedence.
	if (
		registry.consumedChildren(input.capability).length === 0 &&
		input.expected_head !== validated.base_head
	)
		throw new Error(
			`batch_head_lineage_broken: the first child must enroll on the confirmed base_head ${validated.base_head}, not ${input.expected_head}`,
		);

	return {
		child,
		preparation,
		binding: {
			task_id: child.task_id,
			intent_path: child.intent_path,
			intent_revision: child.intent_revision,
			intent_content_hash: child.intent_content_hash,
			preparation_digest: preparation.digest,
			actor_id: validated.actor_id,
			confirmation_ref: validated.confirmation_ref,
			expires_at: validated.expires_at,
			nonce: `${validated.nonce}:${child.task_id}`,
		},
	};
}
