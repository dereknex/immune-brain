// Batch run state persistence for unattended Initiative batch runs.
// State lives at .imm/state/batches/<batch_id>.json, written only under the
// kernel store lock, and is Git-ignored with the rest of .imm/state/.
import { existsSync, mkdirSync, openSync, closeSync, writeFileSync, renameSync, lstatSync, constants, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { readSecureProjectFile, withKernelStoreLock } from "../kernel/storage";
import type { BatchPlanChild } from "./types";

export type BatchRunState =
	| "prepared"
	| "running"
	| "needs_human"
	| "completed"
	| "budget_stopped"
	| "failed"
	| "rejected";

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
	/** Authorization expiry from the batch capability binding. */
	authorization_expires_at: string;
	budget: {
		max_children: number;
		deadline_at: string;
		qa_failure_limit: number;
	};
	batch_state: BatchRunState;
	children: BatchChildRun[];
	/** Consecutive deterministic-QA failures across children in this run. */
	consecutive_qa_failures: number;
	/** Commit heads produced by this batch, in child order. */
	commits: string[];
	created_at: string;
	updated_at: string;
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

const BATCH_RUN_STATES: ReadonlySet<string> = new Set([
	"prepared",
	"running",
	"needs_human",
	"completed",
	"budget_stopped",
	"failed",
	"rejected",
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

function canonicalBytes(record: BatchRunStateRecord): string {
	return `${JSON.stringify(record, null, 2)}\n`;
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
	if (!isCanonicalTimestamp(record.authorization_expires_at))
		throw new Error(`batch run state ${batchId} has an invalid authorization_expires_at`);
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
		!isCanonicalTimestamp(budget.deadline_at) ||
		typeof budget.qa_failure_limit !== "number" ||
		!Number.isInteger(budget.qa_failure_limit) ||
		budget.qa_failure_limit <= 0
	)
		throw new Error(`batch run state ${batchId} has an invalid budget`);
	if (!Array.isArray(record.commits) || record.commits.some((c) => typeof c !== "string"))
		throw new Error(`batch run state ${batchId} has an invalid commits list`);
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
			record.batch_state === "rejected") &&
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
	authorization_expires_at: string;
	budget: { max_children: number; deadline_at: string; qa_failure_limit: number };
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
		authorization_expires_at: input.authorization_expires_at,
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

export function readBatchRunState(root: string, batchId: string): BatchRunStateRecord | null {
	const path = statePath(batchId);
	if (!existsSync(join(root, path))) return null;
	const parsed: unknown = JSON.parse(readSecureProjectFile(root, path));
	validateRecordShape(parsed, batchId);
	return parsed;
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

export function writeBatchRunState(
	root: string,
	record: BatchRunStateRecord,
): BatchRunStateRecord {
	const path = statePath(record.batch_id);
	validateRecordShape(record, record.batch_id);
	return withKernelStoreLock(root, () => {
		const existing = existsSync(join(root, path)) ? readSecureProjectFile(root, path) : null;
		if (existing !== null && existing === canonicalBytes(record)) return record;
		const stored: BatchRunStateRecord = {
			...record,
			updated_at: new Date().toISOString(),
		};
		// review-4: secure directory + atomic no-symlink write.
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
	/** The single next action for the operator. */
	next_action: string;
	created_at: string;
}

function reportPath(batchId: string): string {
	validateBatchId(batchId);
	return join(".imm", "state", "batches", `${batchId}.report.json`);
}

/** Persist one current stop report per batch. Terminal reports are immutable;
 * a resumable needs_human report may be replaced by the later stop reached
 * after a fresh literal-user confirmation. */
export function writeBatchRunReport(root: string, report: BatchRunReport): BatchRunReport {
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
			const prior = original as BatchRunReport;
			if (canonicalReportBytes(prior) === canonicalReportBytes(report)) return prior;
			if (prior.batch_state !== "needs_human") return prior;
		}
		ensureSecureDirectory(root, join(".imm", "state", "batches"));
		writeFileAtomically(root, relative, canonicalReportBytes(report));
		return report;
	});
}

function canonicalReportBytes(report: BatchRunReport): string {
	return `${JSON.stringify(report, null, 2)}\n`;
}

/** All terminal batch states; needs_human is a park, not terminal. */
export function isTerminalBatchState(state: BatchRunState): boolean {
	return state === "completed" || state === "budget_stopped" || state === "failed" || state === "rejected";
}
