// P2B2 mutation authority test seam. NOT part of the packaged runtime.
// The runtime kernel exports no issuer; tests issue capabilities through a
// registry created by this fixture so runtime files contain no ForTest issuer.
//
// The same module owns the SQLite authority fixtures: tests seed runs through
// the store transaction, because the workspace owner is derived from the single
// active run and can no longer be fabricated as a standalone file.

import {
	createMutationAuthorityRegistry,
	type CapabilityBindingV2,
	type MutationAuthorityInspection,
	type MutationAuthorityRegistry,
	type ValidatedAuthorityV2,
} from "../../plugins/immune-brain/runtime/kernel/authority_port";
import { createHash } from "node:crypto";

import {
	insertRunRow,
	openKernelStore,
	readRunRowByTask,
	readWorkspaceRow,
	updateRunTerminal,
	withKernelRead,
	writeWorkspaceRow,
	withKernelTransaction,
	type KernelRunRow,
} from "../../plugins/immune-brain/runtime/kernel/sqlite_store";
import { mintRunId } from "../../plugins/immune-brain/runtime/kernel/run_identity";
import { parseTaskRecord } from "../../plugins/immune-brain/runtime/kernel/validation";
import type { TaskRecord } from "../../plugins/immune-brain/runtime/kernel/types";

export function createTestMutationRegistry(): MutationAuthorityRegistry {
	return createMutationAuthorityRegistry();
}

export function createMutationAuthorityCapabilityForTest(
	registry: MutationAuthorityRegistry,
	binding: CapabilityBindingV2,
	issuedAt?: string,
) {
	return registry.issue(binding, issuedAt);
}

export type {
	CapabilityBindingV2,
	MutationAuthorityInspection,
	MutationAuthorityRegistry,
	ValidatedAuthorityV2,
};

export interface SeedRunOptions {
	task_id: string;
	/** The committed TaskRecord for the run. */
	record: Record<string, unknown>;
	intent_revision?: number;
	intent_content_hash?: string;
	enrollment_event_id?: string;
	claim_status?: "active" | "draining";
	created_at?: string;
	updated_at?: string;
	run_id?: string;
	/** Seed a settled run instead of an active owner. */
	terminal?: {
		lifecycle: "done" | "stopped";
		terminal_event_id?: string;
		terminalized_at?: string;
	};
	/** Seed the run row without claiming the workspace (orphan evidence). */
	leave_workspace_idle?: boolean;
}

export interface SeededRun {
	run_id: string;
	run_revision: number;
	workspace_revision: number;
	record: TaskRecord;
}

const SEED_NOW = "2026-08-12T00:00:00.000Z";

/** Seed one authority run through the store transaction (never a JSON file). */
export function seedKernelRunForTest(root: string, options: SeedRunOptions): SeededRun {
	const record = parseTaskRecord(options.record);
	if (record.task_id !== options.task_id)
		throw new Error("seeded record identity must match task_id");
	const recordJson = `${JSON.stringify(options.record, null, 2)}\n`;
	const createdAt = options.created_at ?? SEED_NOW;
	const updatedAt = options.updated_at ?? createdAt;
	return withKernelTransaction(root, (db) => {
		const run = insertRunRow(db, {
			run_id: options.run_id ?? mintRunId(),
			task_id: options.task_id,
			record_json: recordJson,
			intent_revision: options.intent_revision ?? record.intent_snapshot.revision,
			intent_content_hash: options.intent_content_hash ?? record.intent_ref.content_hash,
			enrollment_event_id: options.enrollment_event_id ?? `seed-${options.task_id}`,
			claim_status: options.claim_status ?? "active",
			created_at: createdAt,
			updated_at: updatedAt,
		});
		let workspaceRevision = readWorkspaceRow(db).revision;
		if (!options.leave_workspace_idle) {
			workspaceRevision = writeWorkspaceRow(db, workspaceRevision, run.run_id, updatedAt);
		}
		if (options.terminal) {
			const terminalizedAt = options.terminal.terminalized_at ?? updatedAt;
			if (record.lifecycle === "active")
				throw new Error("a terminal seed requires a terminal record lifecycle");
			updateRunTerminal(
				db,
				run.run_id,
				options.terminal.lifecycle,
				recordJson,
				`${JSON.stringify(
					{
						contract: "assurance_kernel/task_tombstone/v2",
						task_id: options.task_id,
						lifecycle_status: "terminal",
						terminal_lifecycle: options.terminal.lifecycle,
						terminal_event_id: options.terminal.terminal_event_id ?? `terminal-${options.task_id}`,
						final_record_hash: `sha256:${createHash("sha256").update(recordJson).digest("hex")}`,
						terminalized_at: terminalizedAt,
					},
					null,
					2,
				)}\n`,
				terminalizedAt,
			);
			if (!options.leave_workspace_idle) {
				const row = readWorkspaceRow(db);
				writeWorkspaceRow(db, row.revision, null, terminalizedAt);
			}
		}
		const stored = readRunRowByTask(db, options.task_id);
		if (!stored) throw new Error("seeded run did not converge");
		return {
			run_id: stored.run_id,
			run_revision: stored.revision,
			workspace_revision: workspaceRevision,
			record,
		};
	});
}

export interface SeededClaim {
	claim: Record<string, unknown>;
	claim_bytes: string;
}

/** Read the derived workspace claim for a seeded active run. */
export function readSeededClaim(root: string, taskId: string): SeededClaim | null {
	const run = readSeededRun(root, taskId);
	if (!run || run.state !== "active" || run.claim_status === null) return null;
	const claim = {
		contract: "assurance_kernel/backend_claim/v2",
		backend: "kernel",
		task_id: run.task_id,
		intent_revision: run.intent_revision,
		intent_content_hash: run.intent_content_hash,
		enrollment_event_id: run.enrollment_event_id,
		lifecycle_status: run.claim_status,
		created_at: run.created_at,
		updated_at: run.updated_at,
	};
	return { claim, claim_bytes: `${JSON.stringify(claim, null, 2)}\n` };
}

export function readSeededRun(root: string, taskId: string): KernelRunRow | null {
	return withKernelRead(root, (db) => readRunRowByTask(db, taskId)) ?? null;
}

export function readSeededWorkspaceRevision(root: string): number | null {
	return withKernelRead(root, (db) => readWorkspaceRow(db).revision) ?? null;
}

export function kernelStoreDbForTest(root: string) {
	return openKernelStore(root, { create: false });
}
