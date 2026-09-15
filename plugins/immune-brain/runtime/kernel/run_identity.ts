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
import { randomUUID } from "node:crypto";
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

export function drainOperationId(taskId: string, updatedAt: string): string {
	return `drain:${taskId}:${updatedAt}`;
}

export function terminalOperationId(taskId: string, eventId: string): string {
	return `terminal:${taskId}:${eventId}`;
}
