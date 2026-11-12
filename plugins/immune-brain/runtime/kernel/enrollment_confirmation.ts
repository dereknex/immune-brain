/**
 * Kernel Enrollment confirmation sources (ADR 0005, ADR 0019, ADR 0039
 * Decision 8): `user_session` is the interactive literal-user gate and stays
 * the default; `tracker_approval` and `policy_auto` are the unattended sources
 * the Loop daemon uses.
 *
 * This module holds only the membrane itself, split out of
 * `enrollment_authority.ts` so that file stays the thin capability-registry
 * adapter its line budget guards. `enrollment_authority.ts` re-exports the
 * surface: enrollment code and tests read the confirmation contract there.
 */

import { NO_TOUCH_PATH, noTouchPaths, readNoTouch } from "../no_touch";
import { raiseRisk, readRiskFloor, scopeRiskFloor } from "./risk_floor";
import type { EnrollmentConfirmationSource, TaskRisk } from "./types";

/**
 * Enrollment confirmation membrane (ADR 0005, ADR 0019, ADR 0039 Decision 8).
 *
 * `user_session` is the interactive literal-user gate and is always permitted.
 * The two unattended sources are decided here, in code, before the capability
 * is consumed: `tracker_approval` from GitHub comment metadata the daemon
 * fetched, and `policy_auto` from the daemon's own posture plus the project's
 * risk floor. Nothing in this section calls a model or the network.
 */

/** The GitHub comment metadata an owner plan approval must carry (ADR 0039 Decision 9). */
export interface TrackerApprovalProof {
	issue_number: number;
	comment_id: number;
	actor_login: string;
	author_association: string;
	created_at: string;
	updated_at: string;
	plan_digest: string;
}

/**
 * What the proof is checked against: `loop.allowed_actors`,
 * `loop.allowed_associations` and the daemon's own login from `.imm/config.json`,
 * plus the plan the daemon published and when.
 */
export interface TrackerApprovalPolicy {
	allowed_actors: readonly string[];
	allowed_associations: readonly string[];
	/** The daemon's GitHub login; a daemon-authored comment is never an approval. */
	daemon_identity: string;
	/** The `plan_digest` of the published plan; the approval must name exactly it. */
	plan_digest: string;
	/** When that plan was published; the approval must be strictly later. */
	plan_published_at: string;
}

/** The daemon's own reading of `loop.mode`, `loop.auto_enroll_max_risk` and its identity posture. */
export interface PolicyAutoPolicy {
	mode: string;
	auto_enroll_max_risk: string;
	identity_posture: string;
}

/** One Enrollment confirmation request, as the caller states it. */
export interface EnrollmentConfirmationInput {
	source: EnrollmentConfirmationSource;
	/** `tracker_approval` only. */
	tracker_approval?: { proof: TrackerApprovalProof; policy: TrackerApprovalPolicy };
	/** `policy_auto` only. */
	policy_auto?: PolicyAutoPolicy;
}

export type EnrollmentConfirmationVerdict = { ok: true } | { ok: false; reason: string };

const ok: EnrollmentConfirmationVerdict = { ok: true };
const refuse = (reason: string): EnrollmentConfirmationVerdict => ({ ok: false, reason });

function timestamp(value: string): number | null {
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? null : parsed;
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Rules 1-5 of the Settlement-Design contract, in code. The daemon-identity
 * refusal is checked before the allowlist so a daemon-authored comment is named
 * as such instead of as an anonymous stranger; both refuse.
 */
export function verifyTrackerApproval(
	proof: TrackerApprovalProof,
	policy: TrackerApprovalPolicy,
): EnrollmentConfirmationVerdict {
	if (!isPositiveInteger(proof.issue_number) || !isPositiveInteger(proof.comment_id))
		return refuse(`tracker_approval_proof_shape: issue_number and comment_id must be positive integers`);
	if (policy.daemon_identity === "") return refuse("tracker_approval_policy_shape: daemon identity is empty");
	if (proof.actor_login === policy.daemon_identity)
		return refuse(`tracker_approval_daemon_authored: ${proof.actor_login}`);
	if (!policy.allowed_actors.includes(proof.actor_login))
		return refuse(`tracker_approval_actor_not_allowed: ${proof.actor_login}`);
	if (!policy.allowed_associations.includes(proof.author_association))
		return refuse(`tracker_approval_association_not_allowed: ${proof.author_association}`);
	const created = timestamp(proof.created_at);
	const published = timestamp(policy.plan_published_at);
	if (created === null || published === null)
		return refuse("tracker_approval_timestamp_invalid: created_at and plan_published_at must be timestamps");
	if (created <= published)
		return refuse(`tracker_approval_predates_plan: ${proof.created_at} is not after ${policy.plan_published_at}`);
	if (proof.updated_at !== proof.created_at)
		return refuse(`tracker_approval_comment_edited: updated_at ${proof.updated_at} differs from created_at`);
	if (proof.plan_digest !== policy.plan_digest)
		return refuse(`tracker_approval_digest_mismatch: ${proof.plan_digest} is not the published ${policy.plan_digest}`);
	return ok;
}

/** The ceiling `policy_auto` is allowed to reach; anything above it is never auto-started. */
const POLICY_AUTO_MAX_RISK: TaskRisk = "routine";

/**
 * `policy_auto` is routine-only: autonomous mode, an isolated identity, a
 * `routine` cap, and a task whose declared *and* elevated risk are both
 * `routine`. A risk floor that cannot be read reports `critical`, so a broken
 * declaration refuses auto-enrollment instead of opening it.
 */
export function verifyPolicyAuto(
	policy: PolicyAutoPolicy,
	risk: { declared: TaskRisk; elevated: TaskRisk },
): EnrollmentConfirmationVerdict {
	if (policy.mode !== "autonomous")
		return refuse(`policy_auto_mode_not_autonomous: loop.mode is ${policy.mode}`);
	if (policy.identity_posture !== "isolated")
		return refuse(`policy_auto_requires_isolated_identity: ${policy.identity_posture}`);
	if (policy.auto_enroll_max_risk !== POLICY_AUTO_MAX_RISK)
		return refuse(`policy_auto_disabled: loop.auto_enroll_max_risk is ${policy.auto_enroll_max_risk}`);
	if (risk.declared !== POLICY_AUTO_MAX_RISK)
		return refuse(`policy_auto_requires_routine_risk: declared ${risk.declared}`);
	if (risk.elevated !== POLICY_AUTO_MAX_RISK)
		return refuse(`policy_auto_requires_routine_risk: elevated ${risk.elevated}`);
	return ok;
}

/**
 * The scope entries that reach a no-touch path: the path itself, a descendant,
 * or an ancestor directory that would swallow it. A declaration edit is itself
 * no-touch, because a task that can rewrite the no-touch list is not protected
 * by it.
 */
function noTouchScopeMatches(scopeHint: readonly string[], declared: readonly string[]): string[] {
	const forbidden = [NO_TOUCH_PATH, ...declared];
	const literal = (entry: string) => entry.replace(/\/\*\*$/, "").replace(/\/\*$/, "").replace(/\/$/, "");
	return scopeHint.filter((entry) => {
		const path = literal(entry);
		if (path === "" || !entry) return false;
		if (noTouchPaths([path], forbidden).length > 0) return true;
		return forbidden.some((declaration) => declaration.startsWith(`${path}/`));
	});
}

/**
 * The membrane. `intent` is the live TaskIntent being enrolled, so the risk and
 * scope that decide `policy_auto` are the ones that will be recorded, never a
 * caller's summary of them.
 */
export function verifyEnrollmentConfirmation(
	root: string,
	input: EnrollmentConfirmationInput,
	intent: { risk: TaskRisk; scope_hint: readonly string[] },
): EnrollmentConfirmationVerdict {
	if (input.source === "user_session") return ok;
	if (input.source === "tracker_approval") {
		if (!input.tracker_approval)
			return refuse("tracker_approval_missing_proof: a tracker approval needs a comment proof and its policy");
		return verifyTrackerApproval(input.tracker_approval.proof, input.tracker_approval.policy);
	}
	if (input.source !== "policy_auto")
		return refuse(`unknown_confirmation_source: ${String(input.source)}`);
	if (!input.policy_auto)
		return refuse("policy_auto_missing_policy: policy_auto needs loop.mode, the risk cap and the identity posture");
	let declaredNoTouch: string[];
	try {
		declaredNoTouch = readNoTouch(root);
	} catch (error) {
		return refuse(
			`policy_auto_no_touch_unreadable: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const elevated = raiseRisk(intent.risk, scopeRiskFloor(intent.scope_hint, readRiskFloor(root)));
	const verdict = verifyPolicyAuto(input.policy_auto, { declared: intent.risk, elevated });
	if (!verdict.ok) return verdict;
	const touched = noTouchScopeMatches(intent.scope_hint, declaredNoTouch);
	if (touched.length > 0) return refuse(`policy_auto_touches_no_touch: ${touched.join(", ")}`);
	return ok;
}
