// P2B2 backend claim ownership. NOT exported from kernel/index.ts.
// The workspace-wide `.imm/tasks/.backend-claim.json` is the unique
// workspace-active claim and may be `active | draining` only; terminal state
// lives exclusively in the immutable task-scoped tombstone
// `.imm/tasks/<task-id>.backend-claim.json`. No writer is exported from this
// module: every claim change goes through the recoverable Kernel store
// transactions owned by storage.ts (enrollment, drain, terminalization).

import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { TaskPhase } from "./types";

const CLAIM_PATH = ".imm/tasks/.backend-claim.json";

export type BackendLifecycleStatus = "active" | "draining";

export interface BackendClaim {
	contract: "assurance_kernel/backend_claim/v1";
	backend: "kernel";
	task_id: string;
	intent_revision: number;
	intent_content_hash: string;
	enrollment_event_id: string;
	readiness_digest: string;
	evidence_digest: string;
	lifecycle_status: BackendLifecycleStatus;
	created_at: string;
	updated_at: string;
}

const ALLOWED = [
	"contract",
	"backend",
	"task_id",
	"intent_revision",
	"intent_content_hash",
	"enrollment_event_id",
	"readiness_digest",
	"evidence_digest",
	"lifecycle_status",
	"created_at",
	"updated_at",
];

export const TASK_TOMBSTONE_CONTRACT = "assurance_kernel/task_tombstone/v1" as const;

export interface TaskTombstone {
	contract: typeof TASK_TOMBSTONE_CONTRACT;
	task_id: string;
	lifecycle_status: "terminal";
	terminal_phase: TaskPhase;
	terminal_event_id: string;
	final_record_hash: string;
	terminalized_at: string;
}

const TOMBSTONE_ALLOWED = [
	"contract",
	"task_id",
	"lifecycle_status",
	"terminal_phase",
	"terminal_event_id",
	"final_record_hash",
	"terminalized_at",
];

export class KernelBackendClaimError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "KernelBackendClaimError";
	}
}

function validateTaskId(taskId: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(taskId))
		throw new KernelBackendClaimError("task_id is not a safe file identity");
}

function readJsonOrNull(path: string): Record<string, unknown> | null {
	try {
		const stat = lstatSync(path);
		if (stat.isSymbolicLink())
			throw new KernelBackendClaimError("owner file must not be a symlink");
		if (!stat.isFile())
			throw new KernelBackendClaimError("owner file is not a regular file");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

export function parseBackendClaim(raw: Record<string, unknown>): BackendClaim {
	const unknown = Object.keys(raw).filter((key) => !ALLOWED.includes(key));
	if (unknown.length > 0)
		throw new KernelBackendClaimError(`backend claim has unknown field: ${unknown[0]}`);
	if (raw.contract !== "assurance_kernel/backend_claim/v1")
		throw new KernelBackendClaimError("backend claim contract is invalid");
	if (raw.backend !== "kernel")
		throw new KernelBackendClaimError("backend claim backend must be kernel");
	if (typeof raw.task_id !== "string" || !raw.task_id.trim())
		throw new KernelBackendClaimError("backend claim task_id is invalid");
	validateTaskId(raw.task_id);
	if (typeof raw.intent_revision !== "number" || !Number.isInteger(raw.intent_revision) || raw.intent_revision < 1)
		throw new KernelBackendClaimError("backend claim intent_revision is invalid");
	for (const field of ["intent_content_hash", "enrollment_event_id", "readiness_digest", "evidence_digest", "created_at", "updated_at"]) {
		if (typeof raw[field] !== "string" || !String(raw[field]).trim())
			throw new KernelBackendClaimError(`backend claim ${field} is invalid`);
	}
	if (raw.lifecycle_status !== "active" && raw.lifecycle_status !== "draining")
		throw new KernelBackendClaimError(
			`backend claim lifecycle_status must be active or draining; terminal state lives only in the task tombstone`,
		);
	return raw as unknown as BackendClaim;
}

export function readBackendClaim(root: string): BackendClaim | null {
	const raw = readJsonOrNull(join(root, CLAIM_PATH));
	if (!raw) return null;
	return parseBackendClaim(raw);
}

/** Serialize a validated claim to the canonical file bytes. Transaction-only writer consumers. */
export function serializeBackendClaim(claim: BackendClaim): string {
	parseBackendClaim(claim as unknown as Record<string, unknown>);
	return `${JSON.stringify(claim, null, 2)}\n`;
}

export function parseTaskTombstone(raw: Record<string, unknown>): TaskTombstone {
	const unknown = Object.keys(raw).filter((key) => !TOMBSTONE_ALLOWED.includes(key));
	if (unknown.length > 0)
		throw new KernelBackendClaimError(`task tombstone has unknown field: ${unknown[0]}`);
	if (raw.contract !== TASK_TOMBSTONE_CONTRACT)
		throw new KernelBackendClaimError("task tombstone contract is invalid");
	if (typeof raw.task_id !== "string" || !raw.task_id.trim())
		throw new KernelBackendClaimError("task tombstone task_id is invalid");
	validateTaskId(raw.task_id);
	if (raw.lifecycle_status !== "terminal")
		throw new KernelBackendClaimError("task tombstone lifecycle_status must be terminal");
	if (raw.terminal_phase !== "done" && raw.terminal_phase !== "stopped")
		throw new KernelBackendClaimError("task tombstone terminal_phase must be done or stopped");
	for (const field of ["terminal_event_id", "final_record_hash", "terminalized_at"]) {
		if (typeof raw[field] !== "string" || !String(raw[field]).trim())
			throw new KernelBackendClaimError(`task tombstone ${field} is invalid`);
	}
	if (!/^sha256:[a-f0-9]{64}$/.test(raw.final_record_hash as string))
		throw new KernelBackendClaimError("task tombstone final_record_hash must be a canonical sha256 hash");
	return raw as unknown as TaskTombstone;
}

/** Fail-closed task-scoped tombstone read. Malformed/unreadable/symlinked state throws; only ENOENT means absent. */
export function readTaskTombstone(root: string, taskId: string): TaskTombstone | null {
	validateTaskId(taskId);
	const raw = readJsonOrNull(join(root, ".imm", "tasks", `${taskId}.backend-claim.json`));
	if (!raw) return null;
	const tombstone = parseTaskTombstone(raw);
	if (tombstone.task_id !== taskId)
		throw new KernelBackendClaimError("task tombstone identity is inconsistent");
	return tombstone;
}

/** Serialize a validated tombstone to canonical bytes. Transaction-only writer consumers. */
export function serializeTaskTombstone(tombstone: TaskTombstone): string {
	parseTaskTombstone(tombstone as unknown as Record<string, unknown>);
	return `${JSON.stringify(tombstone, null, 2)}\n`;
}

/**
 * v3 routing guard: while a workspace-active Kernel claim exists (active or
 * draining) for ANY task, canonical v3 managed mutations must fail closed.
 * A terminal task leaves no workspace claim (only an immutable task tombstone),
 * so v3 routing for unrelated tasks is released. Read-only commands are
 * unaffected.
 */
export function assertNoKernelBackendForV3(root: string, _commandTask?: string): void {
	const claim = readBackendClaim(root);
	if (!claim) return;
	throw new KernelBackendClaimError(
		`backend-owned workspace: task ${claim.task_id} is managed by the Kernel backend (${claim.lifecycle_status}); v3 managed mutation is rejected`,
	);
}

export function backendClaimPath(root: string): string {
	return join(resolve(root), CLAIM_PATH);
}
