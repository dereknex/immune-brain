// Batch run state persistence for unattended Initiative batch runs.
// State lives at .imm/state/batches/<batch_id>.json, written only under the
// kernel store lock, and is Git-ignored with the rest of .imm/state/.
import { existsSync, mkdirSync, openSync, closeSync, writeFileSync, renameSync, lstatSync, constants, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { readSecureProjectFile, readSecureProjectBytes, withKernelStoreLock } from "../kernel/storage";
import type { BatchPlanChild } from "./types";

export type BatchRunState =
	| "prepared"
	| "running"
	| "needs_human"
	| "completed"
	| "budget_stopped"
	| "failed"
	| "rejected"
	/**
	 * Retired by an explicit literal-user disposition after the batch plan moved
	 * past it. Terminal, and not a failure of the batch's own: the record, its
	 * children, its commits and its branch stay as evidence, and the retired
	 * authorization is never reused for the revised plan.
	 */
	| "superseded";

export type BatchChildRunState =
	| "pending"
	| "enrolled"
	| "settled"
	| "committed"
	| "needs_human"
	| "skipped_blocked";

export interface BatchChildRun {
	task_id: string;
	slice_id: string;
	blocked_by: string[];
	state: BatchChildRunState;
	/** Terminal reason for needs_human / skipped_blocked / failed children. */
	reason: string | null;
	/** Commit created after the Kernel reported this child done. */
	commit: string | null;
}

export interface BatchRunStateRecord {
	contract: "assurance_kernel/batch_run_state/v1";
	batch_id: string;
	initiative_slug: string;
	plan_digest: string;
	base_head: string;
	/** Dedicated batch branch, e.g. imm/<initiative-slug>. */
	branch?: string;
	/** Timestamp of the literal-user batch confirmation. */
	confirmation_time: string;
	budget: {
		max_children: number;
		qa_failure_limit: number;
	};
	batch_state: BatchRunState;
	children: BatchChildRun[];
	/** Consecutive deterministic-QA failures across children in this run. */
	consecutive_qa_failures: number;
	/** Commit heads produced by this batch, in child order. */
	commits: string[];
	/**
	 * Fast-forward commits the user made on the batch branch, adopted as the new
	 * expected head. Never attributed to a child and never rewritten.
	 */
	adopted_heads?: Array<{ from: string; to: string }>;
	created_at: string;
	updated_at: string;
}

/**
 * Lane-mode child states. `integrated` plays the role `committed` plays in the
 * serial record: it is what unblocks dependents. `released` is recorded by the
 * lane steward once an integrated Lane is gone.
 */
export type BatchLaneChildRunState =
	| "pending"
	| "lane_admitted"
	| "enrolled"
	| "settled"
	| "lane_committed"
	| "integrated"
	| "released"
	| "needs_human"
	| "skipped_blocked";

export interface BatchLaneBinding {
	/** Absolute, real path of the admitted Lane worktree. */
	path: string;
	branch: string;
	/** The batch head the Lane was provisioned at and the child was enrolled on. */
	base_head: string;
	/** Commit created in the Lane after the Lane Kernel settled the child. */
	lane_commit: string | null;
	/** Kernel run observed at enrollment; absent historical bindings cannot resume a parked child. */
	run_id?: string | null;
}

export interface BatchLaneChildRun {
	task_id: string;
	slice_id: string;
	blocked_by: string[];
	state: BatchLaneChildRunState;
	reason: string | null;
	/** Commit on the batch branch once this child is integrated. */
	commit: string | null;
	lane: BatchLaneBinding | null;
	qa_failures: number;
	/**
	 * The Child Issue was closed by the coordinator after this child's commit was
	 * integrated. Absent until then; a Lane settlement never closes it.
	 */
	tracker_closed?: boolean;
}

/**
 * Lane-mode batch state. A serial batch never writes this contract; a v1
 * record is never upgraded. Every v1-gated reader skips it by contract.
 */
export interface BatchLaneRunStateRecord {
	contract: "assurance_kernel/batch_run_state/v2";
	batch_id: string;
	initiative_slug: string;
	plan_digest: string;
	base_head: string;
	branch?: string;
	confirmation_time: string;
	budget: {
		max_children: number;
		qa_failure_limit: number;
	};
	max_parallel: number;
	batch_state: BatchRunState;
	children: BatchLaneChildRun[];
	/** Batch-branch commits produced by integration, in integration order. */
	commits: string[];
	adopted_heads?: Array<{ from: string; to: string }>;
	/**
	 * Lane writes that leaked into the coordinator checkout and were restored on
	 * re-entry, each with the backup that undoes it. Absent until one happens.
	 */
	restores?: import("./batch_leak_restore").LaneLeakRestore[];
	created_at: string;
	updated_at: string;
}

export type AnyBatchRunStateRecord = BatchRunStateRecord | BatchLaneRunStateRecord;

export function isLaneBatchRecord(record: AnyBatchRunStateRecord): record is BatchLaneRunStateRecord {
	return record.contract === "assurance_kernel/batch_run_state/v2";
}

const BATCH_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const CHILD_RUN_STATES: ReadonlySet<string> = new Set([
	"pending",
	"enrolled",
	"settled",
	"committed",
	"needs_human",
	"skipped_blocked",
]);

export const BATCH_RUN_STATES: ReadonlySet<string> = new Set([
	"prepared",
	"running",
	"needs_human",
	"completed",
	"budget_stopped",
	"failed",
	"rejected",
	"superseded",
]);

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isCanonicalTimestamp(value: unknown): value is string {
	if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)) return false;
	const milliseconds = Date.parse(value);
	return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function validateBatchId(batchId: string): void {
	if (typeof batchId !== "string" || !BATCH_ID_PATTERN.test(batchId))
		throw new Error("batch id is not a safe file identity");
}

function statePath(batchId: string): string {
	validateBatchId(batchId);
	return join(".imm", "state", "batches", `${batchId}.json`);
}

/**
 * A record persisted while batch authorization still carried a clock holds
 * `authorization_expires_at` and `budget.deadline_at`. They are ignored on read
 * and never written back.
 */
function withoutRetiredClock<T extends AnyBatchRunStateRecord>(record: T): T {
	const { authorization_expires_at: _expiry, ...rest } = record as T & { authorization_expires_at?: unknown };
	const { deadline_at: _deadline, ...budget } = rest.budget as T["budget"] & { deadline_at?: unknown };
	return { ...rest, budget } as unknown as T;
}

function canonicalBytes(record: AnyBatchRunStateRecord): string {
	return `${JSON.stringify(withoutRetiredClock(record), null, 2)}\n`;
}

function validateRecordShape(value: unknown, batchId: string): asserts value is BatchRunStateRecord {
	if (typeof value !== "object" || value === null)
		throw new Error(`batch run state ${batchId} is not an object`);
	const record = value as Record<string, unknown>;
	if (record.contract !== "assurance_kernel/batch_run_state/v1")
		throw new Error(`batch run state ${batchId} has an unknown contract`);
	if (record.batch_id !== batchId)
		throw new Error(`batch run state ${batchId} carries batch_id ${String(record.batch_id)}`);
	if (typeof record.plan_digest !== "string" || !record.plan_digest)
		throw new Error(`batch run state ${batchId} has an invalid plan_digest`);
	if (typeof record.base_head !== "string" || !record.base_head)
		throw new Error(`batch run state ${batchId} has an invalid base_head`);
	if (record.branch !== undefined && (typeof record.branch !== "string" || !record.branch))
		throw new Error(`batch run state ${batchId} has an invalid branch`);
	if (!isCanonicalTimestamp(record.confirmation_time))
		throw new Error(`batch run state ${batchId} has an invalid confirmation_time`);
	if (!isCanonicalTimestamp(record.created_at) || !isCanonicalTimestamp(record.updated_at))
		throw new Error(`batch run state ${batchId} has invalid state timestamps`);
	if (!Array.isArray(record.children) || record.children.length === 0)
		throw new Error(`batch run state ${batchId} has no children`);
	if (!BATCH_RUN_STATES.has(String(record.batch_state)))
		throw new Error(`batch run state ${batchId} has an invalid batch_state`);
	if (
		typeof record.consecutive_qa_failures !== "number" ||
		!Number.isInteger(record.consecutive_qa_failures) ||
		record.consecutive_qa_failures < 0
	)
		throw new Error(`batch run state ${batchId} has an invalid consecutive_qa_failures`);
	const budget = record.budget as Record<string, unknown>;
	if (
		typeof record.budget !== "object" ||
		record.budget === null ||
		typeof budget.max_children !== "number" ||
		!Number.isInteger(budget.max_children) ||
		budget.max_children <= 0 ||
		typeof budget.qa_failure_limit !== "number" ||
		!Number.isInteger(budget.qa_failure_limit) ||
		budget.qa_failure_limit <= 0
	)
		throw new Error(`batch run state ${batchId} has an invalid budget`);
	if (!Array.isArray(record.commits) || record.commits.some((c) => typeof c !== "string"))
		throw new Error(`batch run state ${batchId} has an invalid commits list`);
	if (
		record.adopted_heads !== undefined &&
		(!Array.isArray(record.adopted_heads) ||
			record.adopted_heads.some(
				(a: unknown) =>
					typeof a !== "object" ||
					a === null ||
					typeof (a as { from?: unknown }).from !== "string" ||
					!(a as { from: string }).from ||
					typeof (a as { to?: unknown }).to !== "string" ||
					!(a as { to: string }).to,
			))
	)
		throw new Error(`batch run state ${batchId} has an invalid adopted_heads list`);
	const seenTaskIds = new Set<string>();
	for (const child of record.children) {
		if (
			typeof child !== "object" ||
			child === null ||
			typeof child.task_id !== "string" ||
			!child.task_id ||
			typeof child.slice_id !== "string" ||
			!child.slice_id
		)
			throw new Error(`batch run state ${batchId} has an invalid child entry`);
		if (!CHILD_RUN_STATES.has(String(child.state)))
			throw new Error(`batch run state ${batchId} child ${child.task_id} has an invalid state`);
		if (!Array.isArray(child.blocked_by) || child.blocked_by.some((b: unknown) => typeof b !== "string"))
			throw new Error(`batch run state ${batchId} child ${child.task_id} has an invalid blocked_by`);
		if (
			(child.reason !== null && typeof child.reason !== "string") ||
			(child.commit !== null && typeof child.commit !== "string")
		)
			throw new Error(`batch run state ${batchId} child ${child.task_id} has invalid terminal fields`);
		// State invariants: commit/reason pair coherently with the state.
		if (child.state === "committed" && child.commit === null)
			throw new Error(`batch run state ${batchId} child ${child.task_id} is committed without a commit`);
		if (child.state !== "committed" && child.commit !== null)
			throw new Error(`batch run state ${batchId} child ${child.task_id} has a commit but is not committed`);
		if (
			(child.state === "needs_human" || child.state === "skipped_blocked") &&
			child.reason === null
		)
			throw new Error(`batch run state ${batchId} child ${child.task_id} needs a terminal reason`);
		if (seenTaskIds.has(child.task_id))
			throw new Error(`batch run state ${batchId} has a duplicate child ${child.task_id}`);
		seenTaskIds.add(child.task_id);
	}
	// A committed child must appear in the commits list (review-1).
	for (const child of record.children) {
		if (child.state === "committed" && child.commit !== null && !record.commits.includes(child.commit))
			throw new Error(`batch run state ${batchId} child ${child.task_id} commit is missing from commits`);
	}
	if (
		(record.batch_state === "budget_stopped" ||
			record.batch_state === "failed" ||
			record.batch_state === "rejected" ||
			record.batch_state === "superseded") &&
		record.children.some((child) => child.state === "enrolled" || child.state === "settled")
	)
		throw new Error(`batch run state ${batchId} is ${String(record.batch_state)} but a child is still mid-flight`);
	if (
		record.batch_state === "completed" &&
		record.children.some((child) => child.state !== "committed")
	)
		throw new Error(`batch run state ${batchId} is completed but a child is not committed`);
}

export function prepareBatchRunState(input: {
	batch_id: string;
	initiative_slug: string;
	children: BatchPlanChild[];
	plan_digest: string;
	base_head: string;
	branch?: string;
	confirmation_time: string;
	budget: { max_children: number; qa_failure_limit: number };
	now: string;
}): BatchRunStateRecord {
	validateBatchId(input.batch_id);
	const prepared: BatchRunStateRecord = {
		contract: "assurance_kernel/batch_run_state/v1",
		batch_id: input.batch_id,
		initiative_slug: input.initiative_slug,
		plan_digest: input.plan_digest,
		base_head: input.base_head,
		branch: input.branch ?? `imm/${input.initiative_slug}`,
		confirmation_time: input.confirmation_time,
		budget: input.budget,
		batch_state: "prepared",
		children: input.children.map((child) => ({
			task_id: child.task_id,
			slice_id: child.slice_id,
			blocked_by: [...child.blocked_by],
			state: "pending",
			reason: null,
			commit: null,
		})),
		consecutive_qa_failures: 0,
		commits: [],
		created_at: input.now,
		updated_at: input.now,
	};
	return prepared;
}

/** Validate a captured snapshot without reading or writing filesystem state. */
export function parseBatchRunState(raw: string, batchId: string): BatchRunStateRecord {
	validateBatchId(batchId);
	const parsed: unknown = JSON.parse(raw);
	validateRecordShape(parsed, batchId);
	return withoutRetiredClock(parsed);
}

export function readBatchRunState(root: string, batchId: string): BatchRunStateRecord | null {
	const path = statePath(batchId);
	if (!existsSync(join(root, path))) return null;
	return parseBatchRunState(readSecureProjectFile(root, path), batchId);
}

function ensureSecureDirectory(root: string, relative: string): string {
	// review-4: create the directory with lstat verification so a pre-existing
	// symlink cannot redirect state writes outside the project; mirrors the
	// kernel storage boundary.
	const target = join(root, relative);
	const parent = dirname(target);
	if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
	if (existsSync(target)) {
		const stats = lstatSync(target);
		if (!stats.isDirectory()) throw new Error(`${relative} exists but is not a directory`);
	} else {
		mkdirSync(target);
	}
	return target;
}

function writeFileAtomically(root: string, relative: string, bytes: string): void {
	// review-4: no-symlink atomic write; lstat each created directory and the
	// target so writes cannot be redirected by a pre-existing symlink.
	const target = join(root, relative);
	const targetDir = dirname(target);
	const stats = lstatSync(targetDir);
	if (!stats.isDirectory()) throw new Error(`${dirname(relative)} is not a directory`);
	const tempPath = `${target}.${randomUUID()}.tmp`;	let fd: number | null = null;
	try {
		fd = openSync(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
		writeFileSync(fd, bytes, "utf8");
		closeSync(fd);
		fd = null;
		renameSync(tempPath, target);
	} finally {
		if (fd !== null) closeSync(fd);
		if (existsSync(tempPath)) { try { rmSync(tempPath); } catch { /* temp already moved */ } }
	}
}

/** Replace an existing authorization only after a locked expected-byte check. */
export function replaceBatchRunState(root: string, expected: Buffer, next: BatchRunStateRecord, validate: () => void): BatchRunStateRecord {
	const path = statePath(next.batch_id);
	validateRecordShape(next, next.batch_id);
	return withKernelStoreLock(root, () => {
		if (!readSecureProjectBytes(root, path).equals(expected)) throw new Error("batch state CAS mismatch");
		validate();
		const stored = withoutRetiredClock({ ...next, updated_at: new Date().toISOString() });
		writeFileAtomically(root, path, canonicalBytes(stored));
		return stored;
	});
}

/** Replace a record of either version only after a locked expected-byte check. */
export function replaceAnyBatchRunState(
	root: string,
	expected: Buffer,
	next: AnyBatchRunStateRecord,
	validate: () => void,
): AnyBatchRunStateRecord {
	const path = statePath(next.batch_id);
	if (isLaneBatchRecord(next)) validateLaneRecordShape(next, next.batch_id);
	else validateRecordShape(next, next.batch_id);
	return withKernelStoreLock(root, () => {
		if (!readSecureProjectBytes(root, path).equals(expected)) throw new Error("batch state CAS mismatch");
		validate();
		const stored = withoutRetiredClock({ ...next, updated_at: new Date().toISOString() });
		writeFileAtomically(root, path, canonicalBytes(stored));
		return stored;
	});
}

export function writeBatchRunState(
	root: string,
	record: BatchRunStateRecord,
): BatchRunStateRecord {
	const path = statePath(record.batch_id);
	validateRecordShape(record, record.batch_id);
	return withKernelStoreLock(root, () => {
		const existing = existsSync(join(root, path)) ? readSecureProjectFile(root, path) : null;
		if (existing !== null && existing === canonicalBytes(record)) return record;
		const stored = withoutRetiredClock({
			...record,
			updated_at: new Date().toISOString(),
		});
		// review-4: secure directory + atomic no-symlink write.
		ensureSecureDirectory(root, join(".imm", "state", "batches"));
		writeFileAtomically(root, path, canonicalBytes(stored));
		return stored;
	});
}


const LANE_CHILD_STATES: ReadonlySet<string> = new Set([
	"pending",
	"lane_admitted",
	"enrolled",
	"settled",
	"lane_committed",
	"integrated",
	"released",
	"needs_human",
	"skipped_blocked",
]);

/** Lane-mode states whose child must carry a Lane binding. */
const LANE_BOUND_STATES: ReadonlySet<string> = new Set([
	"lane_admitted",
	"enrolled",
	"settled",
	"lane_committed",
	"integrated",
	"released",
]);

function validateLaneRecordShape(value: unknown, batchId: string): asserts value is BatchLaneRunStateRecord {
	if (typeof value !== "object" || value === null)
		throw new Error(`batch run state ${batchId} is not an object`);
	const record = value as Record<string, unknown>;
	if (record.contract !== "assurance_kernel/batch_run_state/v2")
		throw new Error(`batch run state ${batchId} has an unknown contract`);
	if (record.batch_id !== batchId)
		throw new Error(`batch run state ${batchId} carries batch_id ${String(record.batch_id)}`);
	if (typeof record.plan_digest !== "string" || !record.plan_digest)
		throw new Error(`batch run state ${batchId} has an invalid plan_digest`);
	if (typeof record.base_head !== "string" || !record.base_head)
		throw new Error(`batch run state ${batchId} has an invalid base_head`);
	if (record.branch !== undefined && (typeof record.branch !== "string" || !record.branch))
		throw new Error(`batch run state ${batchId} has an invalid branch`);
	if (!isCanonicalTimestamp(record.confirmation_time))
		throw new Error(`batch run state ${batchId} has an invalid confirmation_time`);
	if (!isCanonicalTimestamp(record.created_at) || !isCanonicalTimestamp(record.updated_at))
		throw new Error(`batch run state ${batchId} has invalid state timestamps`);
	if (!Array.isArray(record.children) || record.children.length === 0)
		throw new Error(`batch run state ${batchId} has no children`);
	if (!BATCH_RUN_STATES.has(String(record.batch_state)))
		throw new Error(`batch run state ${batchId} has an invalid batch_state`);
	if (typeof record.max_parallel !== "number" || !Number.isSafeInteger(record.max_parallel) || record.max_parallel <= 0)
		throw new Error(`batch run state ${batchId} has an invalid max_parallel`);
	const budget = record.budget as Record<string, unknown>;
	if (
		typeof record.budget !== "object" ||
		record.budget === null ||
		typeof budget.max_children !== "number" ||
		!Number.isInteger(budget.max_children) ||
		budget.max_children <= 0 ||
		typeof budget.qa_failure_limit !== "number" ||
		!Number.isInteger(budget.qa_failure_limit) ||
		budget.qa_failure_limit <= 0
	)
		throw new Error(`batch run state ${batchId} has an invalid budget`);
	if (!Array.isArray(record.commits) || record.commits.some((c) => typeof c !== "string"))
		throw new Error(`batch run state ${batchId} has an invalid commits list`);
	if (
		record.adopted_heads !== undefined &&
		(!Array.isArray(record.adopted_heads) ||
			record.adopted_heads.some(
				(a: unknown) =>
					typeof a !== "object" ||
					a === null ||
					typeof (a as { from?: unknown }).from !== "string" ||
					!(a as { from: string }).from ||
					typeof (a as { to?: unknown }).to !== "string" ||
					!(a as { to: string }).to,
			))
	)
		throw new Error(`batch run state ${batchId} has an invalid adopted_heads list`);
	if (
		record.restores !== undefined &&
		(!Array.isArray(record.restores) ||
			record.restores.some(
				(r: unknown) =>
					typeof r !== "object" || r === null ||
					typeof (r as { backup?: unknown }).backup !== "string" ||
					!Array.isArray((r as { paths?: unknown }).paths),
			))
	)
		throw new Error(`batch run state ${batchId} has an invalid restores list`);
	const seenTaskIds = new Set<string>();
	for (const child of record.children) {
		if (
			typeof child !== "object" ||
			child === null ||
			typeof child.task_id !== "string" ||
			!child.task_id ||
			typeof child.slice_id !== "string" ||
			!child.slice_id
		)
			throw new Error(`batch run state ${batchId} has an invalid child entry`);
		if (!LANE_CHILD_STATES.has(String(child.state)))
			throw new Error(`batch run state ${batchId} child ${child.task_id} has an invalid state`);
		if (!Array.isArray(child.blocked_by) || child.blocked_by.some((b: unknown) => typeof b !== "string"))
			throw new Error(`batch run state ${batchId} child ${child.task_id} has an invalid blocked_by`);
		if (
			(child.reason !== null && typeof child.reason !== "string") ||
			(child.commit !== null && typeof child.commit !== "string")
		)
			throw new Error(`batch run state ${batchId} child ${child.task_id} has invalid terminal fields`);
		if (typeof child.qa_failures !== "number" || !Number.isInteger(child.qa_failures) || child.qa_failures < 0)
			throw new Error(`batch run state ${batchId} child ${child.task_id} has an invalid qa_failures`);
		if (child.tracker_closed !== undefined && child.tracker_closed !== true)
			throw new Error(`batch run state ${batchId} child ${child.task_id} has an invalid tracker_closed`);
		if (child.tracker_closed === true && child.state !== "integrated" && child.state !== "released")
			throw new Error(`batch run state ${batchId} child ${child.task_id} closed its tracker Issue before integration`);
		const lane = child.lane as BatchLaneBinding | null | undefined;
		if (lane !== null) {
			if (
				typeof lane !== "object" ||
				typeof lane.path !== "string" ||
				!lane.path ||
				typeof lane.branch !== "string" ||
				!lane.branch ||
				typeof lane.base_head !== "string" ||
				!lane.base_head ||
				(lane.lane_commit !== null && typeof lane.lane_commit !== "string") ||
				(lane.run_id !== undefined && lane.run_id !== null && (typeof lane.run_id !== "string" || !lane.run_id))
			)
				throw new Error(`batch run state ${batchId} child ${child.task_id} has an invalid lane`);
		}
		if (LANE_BOUND_STATES.has(child.state) && lane === null)
			throw new Error(`batch run state ${batchId} child ${child.task_id} is ${child.state} without a lane`);
		if ((child.state === "pending" || child.state === "skipped_blocked") && lane !== null)
			throw new Error(`batch run state ${batchId} child ${child.task_id} is ${child.state} but holds a lane`);
		const integrated = child.state === "integrated" || child.state === "released";
		if (integrated && child.commit === null)
			throw new Error(`batch run state ${batchId} child ${child.task_id} is ${child.state} without a commit`);
		if (!integrated && child.commit !== null)
			throw new Error(`batch run state ${batchId} child ${child.task_id} has a commit but is not integrated`);
		if (integrated && lane?.lane_commit === null)
			throw new Error(`batch run state ${batchId} child ${child.task_id} is ${child.state} without a lane commit`);
		if (child.state === "lane_committed" && lane?.lane_commit === null)
			throw new Error(`batch run state ${batchId} child ${child.task_id} is lane_committed without a lane commit`);
		if ((child.state === "needs_human" || child.state === "skipped_blocked") && child.reason === null)
			throw new Error(`batch run state ${batchId} child ${child.task_id} needs a terminal reason`);
		if (seenTaskIds.has(child.task_id))
			throw new Error(`batch run state ${batchId} has a duplicate child ${child.task_id}`);
		seenTaskIds.add(child.task_id);
	}
	for (const child of record.children) {
		if (child.commit !== null && !record.commits.includes(child.commit))
			throw new Error(`batch run state ${batchId} child ${child.task_id} commit is missing from commits`);
	}
	const inFlight = (child: { state: string }) =>
		child.state === "lane_admitted" ||
		child.state === "enrolled" ||
		child.state === "settled" ||
		child.state === "lane_committed";
	if (
		(record.batch_state === "budget_stopped" || record.batch_state === "failed" || record.batch_state === "rejected" ||
			record.batch_state === "superseded") &&
		record.children.some(inFlight)
	)
		throw new Error(`batch run state ${batchId} is ${String(record.batch_state)} but a child is still mid-flight`);
	if (
		record.batch_state === "completed" &&
		record.children.some((child) => child.state !== "integrated" && child.state !== "released")
	)
		throw new Error(`batch run state ${batchId} is completed but a child is not integrated`);
}

export function prepareBatchLaneRunState(input: {
	batch_id: string;
	initiative_slug: string;
	children: BatchPlanChild[];
	plan_digest: string;
	base_head: string;
	branch?: string;
	confirmation_time: string;
	budget: { max_children: number; qa_failure_limit: number };
	max_parallel: number;
	now: string;
}): BatchLaneRunStateRecord {
	validateBatchId(input.batch_id);
	return {
		contract: "assurance_kernel/batch_run_state/v2",
		batch_id: input.batch_id,
		initiative_slug: input.initiative_slug,
		plan_digest: input.plan_digest,
		base_head: input.base_head,
		branch: input.branch ?? `imm/${input.initiative_slug}`,
		confirmation_time: input.confirmation_time,
		budget: input.budget,
		max_parallel: input.max_parallel,
		batch_state: "prepared",
		children: input.children.map((child) => ({
			task_id: child.task_id,
			slice_id: child.slice_id,
			blocked_by: [...child.blocked_by],
			state: "pending",
			reason: null,
			commit: null,
			lane: null,
			qa_failures: 0,
		})),
		commits: [],
		created_at: input.now,
		updated_at: input.now,
	};
}

/** Validate a captured v2 snapshot without reading or writing filesystem state. */
export function parseBatchLaneRunState(raw: string, batchId: string): BatchLaneRunStateRecord {
	validateBatchId(batchId);
	const parsed: unknown = JSON.parse(raw);
	validateLaneRecordShape(parsed, batchId);
	return withoutRetiredClock(parsed);
}

/** Parse either record version by its contract; an unknown contract is refused. */
export function parseAnyBatchRunState(raw: string, batchId: string): AnyBatchRunStateRecord {
	validateBatchId(batchId);
	const parsed: unknown = JSON.parse(raw);
	if (typeof parsed === "object" && parsed !== null && (parsed as { contract?: unknown }).contract === "assurance_kernel/batch_run_state/v2")
		return parseBatchLaneRunState(raw, batchId);
	return parseBatchRunState(raw, batchId);
}

/** Read the persisted record of either version; null when the batch has none. */
export function readAnyBatchRunState(root: string, batchId: string): AnyBatchRunStateRecord | null {
	const path = statePath(batchId);
	if (!existsSync(join(root, path))) return null;
	return parseAnyBatchRunState(readSecureProjectFile(root, path), batchId);
}

export function readBatchLaneRunState(root: string, batchId: string): BatchLaneRunStateRecord | null {
	const path = statePath(batchId);
	if (!existsSync(join(root, path))) return null;
	return parseBatchLaneRunState(readSecureProjectFile(root, path), batchId);
}

export function writeBatchLaneRunState(root: string, record: BatchLaneRunStateRecord): BatchLaneRunStateRecord {
	const path = statePath(record.batch_id);
	validateLaneRecordShape(record, record.batch_id);
	return withKernelStoreLock(root, () => {
		const existing = existsSync(join(root, path)) ? readSecureProjectFile(root, path) : null;
		if (existing !== null && existing === canonicalBytes(record)) return record;
		const stored = withoutRetiredClock({ ...record, updated_at: new Date().toISOString() });
		ensureSecureDirectory(root, join(".imm", "state", "batches"));
		writeFileAtomically(root, path, canonicalBytes(stored));
		return stored;
	});
}

export interface BatchRunReport {
	contract: "assurance_kernel/batch_run_report/v1";
	batch_id: string;
	initiative_slug: string;
	batch_state: BatchRunState;
	children: BatchChildRun[];
	commits: string[];
	reason: string | null;
	/** Non-authoritative foreground implementation obligation, never persisted as readiness. */
	handoff?: {
		role: "executor";
		task_id: string;
		run_id: string | null;
		record_revision: string;
		next_obligation: import("../kernel/types").AssuranceObligation;
	};
	/** Safe observation only; never an execution-readiness certificate. */
	recovery?: import("../assurance/coordinator").AssuranceRecovery;
	diagnostics?: import("../assurance/qa").QaCheckDiagnostic[];
	/** The single next action for the operator. */
	next_action: string;
	created_at: string;
}

/**
 * The lane-mode report: the serial report's identity fields with lane children
 * and `handoffs[]` in place of the single `handoff`. Handoffs are observations,
 * never readiness.
 */
export interface BatchLaneRunReport {
	contract: "assurance_kernel/batch_run_report/v1";
	batch_id: string;
	initiative_slug: string;
	batch_state: BatchRunState;
	max_parallel: number;
	children: BatchLaneChildRun[];
	commits: string[];
	reason: string | null;
	handoffs: BatchLaneHandoff[];
	/** Offers refused at admission; a refused offer wrote nothing. */
	lane_refusals?: Array<{ task_id: string; path: string; reason: string }>;
	/**
	 * Child Issue closures this tick attempted after integration. A failure is a
	 * tracker observation beside the batch result, retried by the next tick.
	 */
	tracker_observations?: Array<{ task_id: string; status: string; message: string }>;
	/** Restored Lane leaks with their backup location (see BatchLaneRunStateRecord.restores). */
	restores?: import("./batch_leak_restore").LaneLeakRestore[];
	next_action: string;
	created_at: string;
}

export type BatchLaneHandoff =
	| {
			role: "lane-steward";
			action: "provision";
			task_id: string;
			lane_branch: string;
			base_head: string;
			executor_hosts: readonly string[];
	  }
	| { role: "lane-steward"; action: "release"; task_id: string; lane_branch: string }
	| {
			role: "executor";
			task_id: string;
			run_id: string | null;
			record_revision: string;
			next_obligation: import("../kernel/types").AssuranceObligation;
			lane_branch: string;
			/** Where the Executor Host must be rooted; an observation, never authority. */
			lane_path: string;
	  };

type PersistableReport = Pick<BatchRunReport | BatchLaneRunReport, "contract" | "batch_id" | "batch_state">;

function reportPath(batchId: string): string {
	validateBatchId(batchId);
	return join(".imm", "state", "batches", `${batchId}.report.json`);
}

/** Persist one current stop report per batch. Terminal reports are immutable;
 * a resumable needs_human report may be replaced by the later stop reached
 * after a fresh literal-user confirmation. */
export function writeBatchRunReport<T extends PersistableReport>(root: string, report: T): T {
	const relative = reportPath(report.batch_id);
	return withKernelStoreLock(root, () => {
		const path = join(root, relative);
		if (existsSync(path)) {
			const original: unknown = JSON.parse(readSecureProjectFile(root, relative));
			if (
				typeof original !== "object" ||
				original === null ||
				(original as BatchRunReport).contract !== "assurance_kernel/batch_run_report/v1"
			)
				throw new Error(`batch run report ${report.batch_id} has an unknown contract`);
			const prior = original as T;
			if (canonicalReportBytes(prior) === canonicalReportBytes(report)) return prior;
			if (prior.batch_state !== "needs_human") return prior;
		}
		ensureSecureDirectory(root, join(".imm", "state", "batches"));
		writeFileAtomically(root, relative, canonicalReportBytes(report));
		return report;
	});
}

function canonicalReportBytes(report: PersistableReport): string {
	return `${JSON.stringify(report, null, 2)}\n`;
}

/** All terminal batch states; needs_human is a park, not terminal. */
export function isTerminalBatchState(state: BatchRunState): boolean {
	return (
		state === "completed" ||
		state === "budget_stopped" ||
		state === "failed" ||
		state === "rejected" ||
		state === "superseded"
	);
}
