/**
 * Exact execution identity.
 *
 * A worktree owns one storage identity (`workspace_id`) and every enrolled
 * execution owns one `run_id`. Authority mutations bind the exact run instead
 * of resolving "the latest task occurrence", and every replayable operation
 * derives its identity from committed facts so a replayed call returns the
 * recorded result instead of writing again.
 *
 * `task_id` names the logical task: different worktrees may each run the same
 * logical task with distinct run identities, and a terminal task cannot be
 * re-enrolled in the same worktree.
 */
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { KernelStoreSecurityError, workspaceIdentity } from "./sqlite_store";

export interface RunIdentity {
	workspace_id: string;
	task_id: string;
	run_id: string;
}

export interface RunRowIdentity {
	task_id: string;
	run_id: string;
}

export function mintRunId(): string {
	return `run-${randomUUID()}`;
}

export function runIdentity(db: DatabaseSync, row: RunRowIdentity): RunIdentity {
	return { workspace_id: workspaceIdentity(db), task_id: row.task_id, run_id: row.run_id };
}

/** Bind a mutation to one exact run; a mismatch fails before any write. */
export function assertRunBinding(
	identity: RunIdentity,
	expected: RunRowIdentity,
	operation: string,
): void {
	if (identity.run_id !== expected.run_id || identity.task_id !== expected.task_id)
		throw new KernelStoreSecurityError(
			`${operation} is bound to run ${expected.run_id} (task ${expected.task_id}) but the store holds run ${identity.run_id} (task ${identity.task_id})`,
		);
}

/**
 * Deterministic replay identity for the authority operations that can lose a
 * response. The event identifier is part of the committed authority bytes, so
 * an identical request maps to an identical operation id and a replayed call
 * returns the recorded result instead of writing again.
 */
export function enrollmentOperationId(taskId: string, eventId: string): string {
	return `enroll:${taskId}:${eventId}`;
}

/**
 * Digest of an enrollment request's own content. The capability object is
 * opaque and excluded, so a lost-response retry of the *same* confirmation
 * matches, while a different path, digest, actor, nonce or event time is a
 * different request and must not be answered from the committed operation.
 */
export function enrollmentRequestDigest(request: {
	task_id: string;
	intent_path: string;
	intent_revision: number;
	intent_content_hash: string;
	preparation_digest: string;
	enrollment_event_id: string;
	actor_id: string;
	confirmation_ref: string;
	nonce: string;
}): string {
	const canonical = JSON.stringify({
		task_id: request.task_id,
		intent_path: request.intent_path,
		intent_revision: request.intent_revision,
		intent_content_hash: request.intent_content_hash,
		preparation_digest: request.preparation_digest,
		enrollment_event_id: request.enrollment_event_id,
		actor_id: request.actor_id,
		confirmation_ref: request.confirmation_ref,
		nonce: request.nonce,
	});
	return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function drainOperationId(taskId: string, updatedAt: string): string {
	return `drain:${taskId}:${updatedAt}`;
}

/**
 * Digest of a terminal request's own content. The capability is deliberately
 * opaque and excluded, so a retry that re-mints authority for the *same*
 * request produces the same digest, while a different reason, actor or event
 * time produces a different one and must be authorized again instead of being
 * answered from the committed operation.
 */
export function terminalRequestDigest(action: {
	type: string;
	event_id: string;
	at: string;
	actor_id: string;
	reason?: unknown;
}): string {
	const canonical = JSON.stringify({
		type: action.type,
		event_id: action.event_id,
		at: action.at,
		actor_id: action.actor_id,
		reason: typeof action.reason === "string" ? action.reason : null,
	});
	return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function terminalOperationId(taskId: string, eventId: string): string {
	return `terminal:${taskId}:${eventId}`;
}
