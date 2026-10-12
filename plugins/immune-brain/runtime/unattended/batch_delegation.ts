// Delegated in-Lane Intent revision (ADR 0018). A lane batch whose literal-user
// confirmation granted `revision_delegation` lets the coordinator approve a
// Lane child's breaking Intent revision that stays inside the child's TaskIntent
// as authorized for the batch. The approval is the ordinary Kernel
// `approve_breaking_intent_revision`, applied in the Lane's own Authority Store
// with user authority whose actor and confirmation reference name the batch, so
// the audit history tells it apart from an approval by the user in person.
// Out-of-bounds revisions are refused here and stay with the user's own gate.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { projectAssurance } from "../kernel/assurance_projection";
import { createMutationAuthorityRegistry, digestOfAction, type CapabilityBindingV2 } from "../kernel/authority_port";
import { capabilityActionFor, createCanaryApplication } from "../kernel/canary_application";
import { canonicalIntentHash, classifyIntentRevision, parseTaskIntentV1, readTaskIntent } from "../kernel/intent";
import { boundSpecPath } from "../kernel/spec_binding";
import { readTaskRecordRaw, recoverKernelStoreFollowUps } from "../kernel/storage";
import type { TaskIntentV1 } from "../kernel/types";
import { stagePlanningArtifactTransition } from "../assurance/verdict_authority";
import { captureStagedIntent, restoreStagedIntent } from "../staged_intent";
import { taskDeliveryIdentity } from "../workspace_scope";

/** The grant and its bounds, stated in the gate that grants it (both Hosts). */
export const REVISION_DELEGATION_TEXT =
	"Optional, off by default: also let the batch coordinator approve a Lane child's breaking Intent revisions that stay inside that child's authorized TaskIntent (acceptance changes, a narrower scope_hint). Widening scope, changing risk, goal or the bound Spec still needs your own confirmation. The grant ends with this batch.";

/** The actor every delegated approval records; never the literal user. */
export const DELEGATED_ACTOR_ID = "batch-coordinator";

export interface RevisionDelegationGrant {
	/** The confirmation that granted it; a fresh confirmation replaces it. */
	confirmation_time: string;
}

export interface DelegatedRevisionRecord {
	at: string;
	task_id: string;
	from_revision: number;
	to_revision: number;
	intent_content_hash: string;
	confirmation_ref: string;
}

export interface LaneRevisionRequest {
	task_id: string;
	next_intent: TaskIntentV1;
}

/** The confirmation reference that traces a delegated approval to its batch authorization. */
export function delegatedConfirmationRef(batchId: string, grant: RevisionDelegationGrant): string {
	return `delegated-batch:${batchId}@${grant.confirmation_time}`;
}

/** Untrusted tool input: shape only; the bounds are decided against Kernel facts. */
export function parseLaneRevision(value: unknown): LaneRevisionRequest | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "object" || Array.isArray(value)) throw new Error("invalid lane_revision: expected an object");
	const { task_id: taskId, next_intent: nextIntent, ...rest } = value as Record<string, unknown>;
	if (Object.keys(rest).length > 0) throw new Error("invalid lane_revision: unknown field");
	if (typeof taskId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(taskId))
		throw new Error("invalid lane_revision: task_id is not a valid task id");
	const intent = parseTaskIntentV1(nextIntent);
	if (intent.task_id !== taskId) throw new Error("invalid lane_revision: next_intent belongs to another task");
	return { task_id: taskId, next_intent: intent };
}

/**
 * Whether the delegation covers this revision. `authorized` is the child's
 * TaskIntent as the batch authorized it; `current` is the Lane's enrolled one.
 * Null means covered.
 */
export function delegatedRevisionRefusal(authorized: TaskIntentV1, current: TaskIntentV1, next: TaskIntentV1): string | null {
	if (classifyIntentRevision(current, next) !== "breaking") return "only a breaking revision needs this approval; apply a compatible one with revise_intent";
	if (next.revision <= current.revision) return "the revision number must increase";
	if (next.goal !== authorized.goal || next.owner !== authorized.owner || next.task_id !== authorized.task_id)
		return "goal, owner and task identity are outside the delegation";
	if (next.risk !== authorized.risk || next.risk !== current.risk) return "a risk change is outside the delegation";
	if ((boundSpecPath(next) ?? null) !== (boundSpecPath(authorized) ?? null)) return "a change of the bound Spec is outside the delegation";
	const allowed = new Set(authorized.scope_hint);
	const widened = next.scope_hint.filter((entry) => !allowed.has(entry));
	if (widened.length > 0) return `widening scope_hint is outside the delegation: ${widened.join(", ")}`;
	return null;
}

/**
 * Apply one delegated breaking revision in the Lane, exactly as a Host applies
 * an approved one: write and stage the next sidecar, re-read the projection,
 * issue a user capability bound to that snapshot, execute, and stage the
 * planning transition. The prior sidecar bytes and index entry come back on any
 * failure before commit.
 */
export function applyDelegatedIntentRevision(input: {
	lane_root: string;
	task_id: string;
	next_intent: TaskIntentV1;
	confirmation_ref: string;
	now: string;
}): Promise<{ from_revision: number; to_revision: number; intent_content_hash: string }> {
	return (async () => {
		const { lane_root: root, task_id: taskId, next_intent: nextIntent, now } = input;
		recoverKernelStoreFollowUps(root, taskId);
		const prior = readTaskIntent(root, taskId, readTaskRecordRaw(root, taskId).record?.intent_ref.path);
		const before = await projectAssurance(root, taskId, taskDeliveryIdentity);
		if (before.error || before.claim?.task_id !== taskId || before.projection.lifecycle !== "active")
			throw new Error(`the Lane does not hold an active run of ${taskId}`);
		const nextHash = canonicalIntentHash(nextIntent);
		const nextRef = { path: `docs/plans/${taskId}.intent.json`, content_hash: nextHash };
		const snapshot = captureStagedIntent(root, prior.intent_ref.path);
		try {
			writeFileSync(join(root, prior.intent_ref.path), `${JSON.stringify(nextIntent, null, 2)}\n`);
			execFileSync("git", ["add", "--", prior.intent_ref.path], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
			const prepared = await projectAssurance(root, taskId, taskDeliveryIdentity);
			if (prepared.error || prepared.projection.record_revision !== before.projection.record_revision)
				throw new Error("the Lane's TaskRecord changed while the delegated revision was prepared");
			const registry = createMutationAuthorityRegistry();
			const action = capabilityActionFor({
				op: "approve_breaking_intent_revision",
				task_id: taskId,
				at: now,
				actor_id: DELEGATED_ACTOR_ID,
				next_intent: nextIntent,
				next_intent_ref: nextRef,
			});
			const binding: CapabilityBindingV2 = {
				authority_kind: "user",
				task_id: taskId,
				...(prepared.projection.run_id ? { run_id: prepared.projection.run_id } : {}),
				action_digest: digestOfAction(action),
				expected_record_hash: prepared.projection.record_revision,
				intent_revision: nextIntent.revision,
				intent_content_hash: nextHash,
				diff_hash: prepared.projection.diff_hash,
				actor_id: DELEGATED_ACTOR_ID,
				confirmation_ref: input.confirmation_ref,
				findings_digest: null,
			};
			const capability = registry.issue(binding);
			const result = createCanaryApplication(registry).execute({
				root,
				task_id: taskId,
				operation: {
					op: "approve_breaking_intent_revision",
					capability,
					actor_id: DELEGATED_ACTOR_ID,
					next_intent: nextIntent,
					next_intent_ref: nextRef,
				} as never,
				prior_intent_token: prior.token,
				diffProvider: taskDeliveryIdentity,
				now,
			});
			stagePlanningArtifactTransition(root, result.record);
			return { from_revision: prior.intent.revision, to_revision: nextIntent.revision, intent_content_hash: nextHash };
		} catch (error) {
			const current = readTaskRecordRaw(root, taskId);
			if (current.record?.intent_snapshot.revision === prior.intent.revision) restoreStagedIntent(root, snapshot);
			throw error;
		}
	})();
}
