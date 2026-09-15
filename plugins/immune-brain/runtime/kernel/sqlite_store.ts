/**
 * Kernel authority store: one worktree-local SQLite database is the single
 * transaction boundary for runs, lifecycle, revisions, findings, attestations
 * and operation outcomes.
 *
 * Layout: `.imm/state/kernel.sqlite` with WAL, `synchronous=FULL`, foreign
 * keys and a bounded busy timeout. `.imm/state/` stays Git-ignored; the
 * database is never committed, and audit evidence is exported separately as
 * tracked, deterministic files.
 *
 * This module is mechanical: it opens/validates the database, runs bounded
 * transactions with revision-checked CAS helpers, and exposes row access.
 * Authority decisions (owner matrix, settlement rules, replay identity) stay
 * in `storage.ts` and the reducer.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
	constants,
	closeSync,
	copyFileSync,
	existsSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { KERNEL_DB_RELATIVE, KERNEL_STORE_SCHEMA_VERSION, kernelStoreBindingDigest } from "./storage_paths";

export { KERNEL_STORE_SCHEMA_VERSION };

export const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

/** Schema/version rejection and unsafe-store diagnostics. */
export class KernelStoreSecurityError extends Error {
	readonly code: string = "kernel_store_security_error";

	constructor(message: string) {
		super(message);
		this.name = "KernelStoreSecurityError";
	}
}

/** Revision conflicts, busy stores and unrecoverable transaction failures. */
export class KernelStoreConflictError extends Error {
	readonly code: string = "kernel_store_conflict";

	constructor(message: string) {
		super(message);
		this.name = "KernelStoreConflictError";
	}
}

/** The database exists but its schema version is not the one this runtime owns. */
export class KernelSchemaError extends KernelStoreSecurityError {
	readonly code = "kernel_schema_error";

	constructor(message: string) {
		super(message);
		this.name = "KernelSchemaError";
	}
}

export type RunLifecycleState = "active" | "done" | "stopped";
export type RunClaimStatus = "active" | "draining";

export interface KernelWorkspaceRow {
	revision: number;
	current_run_id: string | null;
	updated_at: string;
}

export interface KernelRunRow {
	run_id: string;
	task_id: string;
	state: RunLifecycleState;
	revision: number;
	record_json: string;
	intent_revision: number;
	intent_content_hash: string;
	enrollment_event_id: string;
	claim_status: RunClaimStatus | null;
	created_at: string;
	updated_at: string;
	terminal_proof_json: string | null;
	terminal_at: string | null;
	audit_exported_at: string | null;
	pending_relocations_json: string | null;
}

export interface KernelOperationRow {
	operation_id: string;
	kind: string;
	run_id: string | null;
	result_json: string;
	committed_at: string;
}

export interface KernelJournalRow {
	seq: number;
	entry_json: string;
	task_id: string | null;
	observation_commit_id: string | null;
	observation_id: string | null;
}

export interface KernelRunInsert {
	run_id: string;
	task_id: string;
	record_json: string;
	intent_revision: number;
	intent_content_hash: string;
	enrollment_event_id: string;
	claim_status: RunClaimStatus;
	created_at: string;
	updated_at: string;
}

interface OpenStore {
	db: DatabaseSync;
	depth: number;
}

const openStores = new Map<string, OpenStore>();

let storeFaultForTest: (() => void) | null = null;

/**
 * Test-only seam: runs after every authority write of the current transaction
 * and immediately before COMMIT, so a thrown fault must roll the transaction
 * back completely.
 */
export function setStoreFaultForTest(hook: (() => void) | null): void {
	storeFaultForTest = hook;
}

function runStoreFault(): void {
	const hook = storeFaultForTest;
	storeFaultForTest = null;
	hook?.();
}

function canonicalRoot(root: string): string {
	try {
		return realpathSync(root);
	} catch {
		throw new KernelStoreSecurityError("project root is unavailable");
	}
}

function storeKey(root: string): string {
	return canonicalRoot(root);
}

export function kernelStorePath(root: string): string {
	return resolve(canonicalRoot(root), KERNEL_DB_RELATIVE);
}

function assertSafeSegments(canonical: string, candidate: string): void {
	let current = canonical;
	for (const segment of relative(canonical, candidate).split(sep).filter(Boolean)) {
		current = resolve(current, segment);
		let stat;
		try {
			stat = lstatSync(current);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT" || code === "ENOTDIR") continue;
			throw error;
		}
		if (stat.isSymbolicLink())
			throw new KernelStoreSecurityError(
				`symlink storage segment is forbidden: ${relative(canonical, current)}`,
			);
	}
}

function ensureStoreDirectory(canonical: string): void {
	const target = resolve(canonical, KERNEL_DB_RELATIVE);
	const directory = dirname(target);
	assertSafeSegments(canonical, directory);
	let current = canonical;
	for (const segment of relative(canonical, directory).split(sep).filter(Boolean)) {
		current = resolve(current, segment);
		let stat;
		try {
			stat = lstatSync(current);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
			stat = null;
		}
		if (!stat) {
			mkdirSync(current);
			continue;
		}
		if (stat.isSymbolicLink())
			throw new KernelStoreSecurityError(
				`symlink storage segment is forbidden: ${relative(canonical, current)}`,
			);
		if (!stat.isDirectory())
			throw new KernelStoreSecurityError(
				`storage segment is not a directory: ${relative(canonical, current)}`,
			);
	}
	assertSafeSegments(canonical, target);
	try {
		const stat = lstatSync(target);
		if (!stat.isFile())
			throw new KernelStoreSecurityError("kernel store is not a regular file");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

export function kernelStoreExists(root: string): boolean {
	return existsSync(kernelStorePath(root));
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS store_meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	revision INTEGER NOT NULL,
	current_run_id TEXT,
	updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
	run_id TEXT PRIMARY KEY,
	task_id TEXT NOT NULL UNIQUE,
	state TEXT NOT NULL CHECK (state IN ('active','done','stopped')),
	revision INTEGER NOT NULL,
	record_json TEXT NOT NULL,
	intent_revision INTEGER NOT NULL,
	intent_content_hash TEXT NOT NULL,
	enrollment_event_id TEXT NOT NULL,
	claim_status TEXT CHECK (claim_status IN ('active','draining')),
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	terminal_proof_json TEXT,
	terminal_at TEXT,
	audit_exported_at TEXT,
	pending_relocations_json TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS runs_single_active ON runs((1)) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS runs_state ON runs(state);
CREATE TABLE IF NOT EXISTS operations (
	operation_id TEXT PRIMARY KEY,
	kind TEXT NOT NULL,
	run_id TEXT,
	result_json TEXT NOT NULL,
	committed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS journal (
	seq INTEGER PRIMARY KEY AUTOINCREMENT,
	entry_json TEXT NOT NULL,
	task_id TEXT,
	observation_commit_id TEXT,
	observation_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS journal_observation_commit ON journal(observation_commit_id) WHERE observation_commit_id IS NOT NULL;
`;

function workspaceBinding(root: string, workspaceId: string): string {
	return kernelStoreBindingDigest(root, workspaceId);
}

function gitCommonDir(root: string): string | null {
	const result = spawnSync("git", ["-C", root, "rev-parse", "--git-common-dir"], {
		encoding: "utf8",
	});
	if (result.status !== 0) return null;
	const value = result.stdout.trim();
	if (!value) return null;
	return isAbsolute(value) ? value : resolve(root, value);
}

function readMeta(db: DatabaseSync, key: string): string | null {
	const row = db.prepare("SELECT value FROM store_meta WHERE key = ?").get(key) as
		| { value?: unknown }
		| undefined;
	return row && typeof row.value === "string" ? row.value : null;
}

function writeMeta(db: DatabaseSync, key: string, value: string): void {
	db.prepare(
		"INSERT INTO store_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
	).run(key, value);
}

function applyPragmas(db: DatabaseSync, busyTimeoutMs: number, writable: boolean): void {
	// Read-only accessors must not switch journal mode or checkpoint: a read
	// never changes the store bytes it observes.
	if (writable) {
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA synchronous = FULL");
	}
	db.exec("PRAGMA foreign_keys = ON");
	db.exec(`PRAGMA busy_timeout = ${Math.max(1, Math.trunc(busyTimeoutMs))}`);
}

function assertSchema(db: DatabaseSync, root: string): void {
	const rows = db
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
		.all() as Array<{ name?: unknown }>;
	const tables = new Set(rows.map((row) => String(row.name)));
	if (tables.size === 0) return; // fresh file: schema is created by the caller
	if (!tables.has("store_meta") || !tables.has("runs") || !tables.has("workspace")) {
		throw new KernelSchemaError(
			"kernel store schema is not recognizable; the database was not created by this runtime",
		);
	}
	const version = readMeta(db, "schema_version");
	if (version !== String(KERNEL_STORE_SCHEMA_VERSION)) {
		throw new KernelSchemaError(
			`kernel store schema version ${version ?? "missing"} is incompatible with this runtime (${KERNEL_STORE_SCHEMA_VERSION}); run the supported migration before mutating`,
		);
	}
	const workspaceId = readMeta(db, "workspace_id");
	const binding = readMeta(db, "workspace_binding");
	if (!workspaceId || !binding)
		throw new KernelSchemaError("kernel store identity metadata is missing");
	if (workspaceBinding(root, workspaceId) !== binding)
		throw new KernelStoreSecurityError(
			"kernel store belongs to a different worktree; restore it into its binding worktree or run the supported rebinding",
		);
}

function initializeSchema(db: DatabaseSync, root: string, now: string): void {
	db.exec("BEGIN IMMEDIATE");
	try {
		db.exec(SCHEMA_SQL);
		const workspaceId = readMeta(db, "workspace_id") ?? randomUUID();
		writeMeta(db, "workspace_id", workspaceId);
		writeMeta(db, "schema_version", String(KERNEL_STORE_SCHEMA_VERSION));
		writeMeta(db, "workspace_binding", workspaceBinding(root, workspaceId));
		writeMeta(db, "created_at", readMeta(db, "created_at") ?? now);
		const common = gitCommonDir(root);
		if (common) writeMeta(db, "git_common_dir", common);
		db.prepare(
			"INSERT INTO workspace (id, revision, current_run_id, updated_at) VALUES (1, 0, NULL, ?) ON CONFLICT(id) DO NOTHING",
		).run(now);
		db.exec("COMMIT");
	} catch (error) {
		try {
			db.exec("ROLLBACK");
		} catch {
			// The transaction is already closed.
		}
		throw error;
	}
}

/**
 * Open the worktree authority store. `create: false` returns null when the
 * database does not exist yet, so read-only paths never create one.
 */
export function openKernelStore(
	root: string,
	options: { create?: boolean; busyTimeoutMs?: number; now?: string; readOnly?: boolean } = {},
): DatabaseSync | null {
	const canonical = canonicalRoot(root);
	const path = resolve(canonical, KERNEL_DB_RELATIVE);
	const create = options.create ?? true;
	if (!existsSync(path) && !create) return null;
	if (!options.readOnly) ensureStoreDirectory(canonical);
	return openStoreFile(canonical, path, options);
}

/**
 * Open and validate one store file against a worktree binding. `assertSchema`
 * runs before the caller can read or write anything, which is what lets a
 * restore validate a backup copy in place without touching the live store.
 */
function openStoreFile(
	canonical: string,
	path: string,
	options: { busyTimeoutMs?: number; now?: string; readOnly?: boolean } = {},
): DatabaseSync | null {
	let db: DatabaseSync;
	try {
		db = new DatabaseSync(path, options.readOnly ? { readOnly: true } : {});
	} catch (error) {
		throw new KernelStoreSecurityError(
			`kernel store could not be opened at ${KERNEL_DB_RELATIVE}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	try {
		applyPragmas(db, options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS, !options.readOnly);
		assertSchema(db, canonical);
		const initialized =
			(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='store_meta'").get() as
				| { name?: unknown }
				| undefined) !== undefined;
		if (!initialized) initializeSchema(db, canonical, options.now ?? new Date().toISOString());
		return db;
	} catch (error) {
		try {
			db.close();
		} catch {
			// nothing to close
		}
		throw error;
	}
}

function closeQuietly(db: DatabaseSync): void {
	try {
		db.close();
	} catch {
		// Already closed.
	}
}

/**
 * Run `operation` inside one bounded, revision-checked write transaction.
 * Nested calls in the same process reuse the open connection, so authority
 * helpers that assume an already-held lock stay composable. Cross-process
 * writers are serialized by SQLite's write lock and the bounded busy timeout.
 */
export function withKernelTransaction<T>(
	root: string,
	operation: (db: DatabaseSync) => T,
	options: { busyTimeoutMs?: number; now?: string } = {},
): T {
	const key = storeKey(root);
	const existing = openStores.get(key);
	if (existing) {
		existing.depth += 1;
		try {
			return operation(existing.db);
		} finally {
			existing.depth -= 1;
		}
	}
	let db: DatabaseSync | null = null;
	try {
		db = openKernelStore(root, options);
	} catch (error) {
		if (error instanceof Error && error.message.includes("database is locked"))
			throw new KernelStoreConflictError(
				"kernel store is busy: another writer holds the store lock",
			);
		throw error;
	}
	if (!db) throw new KernelStoreSecurityError("kernel store could not be opened");
	const handle: OpenStore = { db, depth: 1 };
	openStores.set(key, handle);
	try {
		try {
			db.exec("BEGIN IMMEDIATE");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes("locked") || message.includes("busy"))
				throw new KernelStoreConflictError(
					"kernel store is busy: another writer holds the store lock",
				);
			throw new KernelStoreConflictError(`kernel store transaction could not start: ${message}`);
		}
		let result: T;
		try {
			result = operation(db);
			// The fault seam runs after the authority writes and before COMMIT,
			// so a thrown fault must roll the whole transaction back.
			runStoreFault();
			db.exec("COMMIT");
		} catch (error) {
			try {
				db.exec("ROLLBACK");
			} catch {
				// A failed rollback leaves recovery to SQLite's own journal.
			}
			if (error instanceof Error && error.message.startsWith("kernel store transaction failed to commit"))
				throw error;
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes("SQLITE_BUSY") || message.includes("database is locked"))
				throw new KernelStoreConflictError(
					`kernel store transaction failed to commit: ${message}`,
				);
			throw error;
		}
		return result;
	} finally {
		openStores.delete(key);
		closeQuietly(db);
	}
}

/** Run a read-only operation against the store when it exists. */
export function withKernelRead<T>(
	root: string,
	operation: (db: DatabaseSync) => T,
	options: { busyTimeoutMs?: number } = {},
): T | null {
	const existing = openStores.get(storeKey(root));
	if (existing) return operation(existing.db);
	let db: DatabaseSync | null;
	try {
		db = openKernelStore(root, { ...options, create: false, readOnly: true });
	} catch (error) {
		// A cleanly closed WAL database keeps no `-shm` file, and a read-only
		// connection is not allowed to rebuild it. Fall back to a plain
		// connection: reading still never changes authority, and SQLite only
		// materializes its own journal state.
		const message = error instanceof Error ? error.message : String(error);
		if (!/unable to open database file|CANTOPEN|readonly/i.test(message)) throw error;
		db = openKernelStore(root, { ...options, create: false });
	}
	if (!db) return null;
	try {
		return operation(db);
	} finally {
		closeQuietly(db);
	}
}

export function activeRunId(db: DatabaseSync): string | null {
	const row = db.prepare("SELECT current_run_id FROM workspace WHERE id = 1").get() as
		| { current_run_id?: unknown }
		| undefined;
	const value = row?.current_run_id;
	return typeof value === "string" && value.length > 0 ? value : null;
}

export function readWorkspaceRow(db: DatabaseSync): KernelWorkspaceRow {
	const row = db
		.prepare("SELECT revision, current_run_id, updated_at FROM workspace WHERE id = 1")
		.get() as { revision?: unknown; current_run_id?: unknown; updated_at?: unknown } | undefined;
	if (!row) throw new KernelStoreSecurityError("kernel store workspace row is missing");
	return {
		revision: Number(row.revision),
		current_run_id:
			typeof row.current_run_id === "string" && row.current_run_id.length > 0
				? row.current_run_id
				: null,
		updated_at: String(row.updated_at ?? ""),
	};
}

/** CAS workspace: `expectedRevision` must equal the stored revision. */
export function writeWorkspaceRow(
	db: DatabaseSync,
	expectedRevision: number,
	currentRunId: string | null,
	updatedAt: string,
): number {
	const result = db
		.prepare(
			"UPDATE workspace SET revision = revision + 1, current_run_id = ?, updated_at = ? WHERE id = 1 AND revision = ?",
		)
		.run(currentRunId, updatedAt, expectedRevision);
	if (Number(result.changes) !== 1)
		throw new KernelStoreConflictError(
			`CAS mismatch for workspace: expected revision ${expectedRevision}`,
		);
	return expectedRevision + 1;
}

function mapRunRow(raw: Record<string, unknown>): KernelRunRow {
	return {
		run_id: String(raw.run_id),
		task_id: String(raw.task_id),
		state: raw.state as RunLifecycleState,
		revision: Number(raw.revision),
		record_json: String(raw.record_json),
		intent_revision: Number(raw.intent_revision),
		intent_content_hash: String(raw.intent_content_hash),
		enrollment_event_id: String(raw.enrollment_event_id),
		claim_status: (raw.claim_status ?? null) as RunClaimStatus | null,
		created_at: String(raw.created_at),
		updated_at: String(raw.updated_at),
		terminal_proof_json:
			typeof raw.terminal_proof_json === "string" ? raw.terminal_proof_json : null,
		terminal_at: typeof raw.terminal_at === "string" ? raw.terminal_at : null,
		audit_exported_at:
			typeof raw.audit_exported_at === "string" ? raw.audit_exported_at : null,
		pending_relocations_json:
			typeof raw.pending_relocations_json === "string" ? raw.pending_relocations_json : null,
	};
}

export function readRunRowByTask(db: DatabaseSync, taskId: string): KernelRunRow | null {
	const row = db.prepare("SELECT * FROM runs WHERE task_id = ?").get(taskId) as
		| Record<string, unknown>
		| undefined;
	return row ? mapRunRow(row) : null;
}

export function readRunRowById(db: DatabaseSync, runId: string): KernelRunRow | null {
	const row = db.prepare("SELECT * FROM runs WHERE run_id = ?").get(runId) as
		| Record<string, unknown>
		| undefined;
	return row ? mapRunRow(row) : null;
}

export function readActiveRun(db: DatabaseSync): KernelRunRow | null {
	const row = db.prepare("SELECT * FROM runs WHERE state = 'active'").get() as
		| Record<string, unknown>
		| undefined;
	return row ? mapRunRow(row) : null;
}

export function listTerminalRuns(db: DatabaseSync): KernelRunRow[] {
	const rows = db
		.prepare("SELECT * FROM runs WHERE state <> 'active' ORDER BY updated_at, task_id")
		.all() as Array<Record<string, unknown>>;
	return rows.map(mapRunRow);
}

export function listPendingAuditExports(db: DatabaseSync): KernelRunRow[] {
	const rows = db
		.prepare(
			"SELECT * FROM runs WHERE state <> 'active' AND terminal_proof_json IS NOT NULL AND audit_exported_at IS NULL ORDER BY updated_at, task_id",
		)
		.all() as Array<Record<string, unknown>>;
	return rows.map(mapRunRow);
}

export function insertRunRow(db: DatabaseSync, run: KernelRunInsert): KernelRunRow {
	try {
		db.prepare(
			`INSERT INTO runs (run_id, task_id, state, revision, record_json, intent_revision, intent_content_hash, enrollment_event_id, claim_status, created_at, updated_at, terminal_proof_json, terminal_at, audit_exported_at, pending_relocations_json)
			 VALUES (?, ?, 'active', 1, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`,
		).run(
			run.run_id,
			run.task_id,
			run.record_json,
			run.intent_revision,
			run.intent_content_hash,
			run.enrollment_event_id,
			run.claim_status,
			run.created_at,
			run.updated_at,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("runs_single_active") || message.includes("runs.task_id"))
			throw new KernelStoreConflictError(
				`kernel store refused a second active run: ${message}`,
			);
		throw error;
	}
	const inserted = readRunRowById(db, run.run_id);
	if (!inserted) throw new KernelStoreSecurityError("kernel store run insert did not converge");
	return inserted;
}

/** CAS a record update on one exact run. */
export function updateRunRecord(
	db: DatabaseSync,
	runId: string,
	expectedRevision: number,
	recordJson: string,
	updatedAt: string,
): number {
	const result = db
		.prepare(
			"UPDATE runs SET revision = revision + 1, record_json = ?, updated_at = ? WHERE run_id = ? AND revision = ?",
		)
		.run(recordJson, updatedAt, runId, expectedRevision);
	if (Number(result.changes) !== 1)
		throw new KernelStoreConflictError(
			`CAS mismatch for run ${runId}: expected revision ${expectedRevision}`,
		);
	return expectedRevision + 1;
}

export function updateRunClaim(
	db: DatabaseSync,
	runId: string,
	expectedClaimStatus: RunClaimStatus,
	nextClaimStatus: RunClaimStatus,
	updatedAt: string,
): void {
	const result = db
		.prepare(
			"UPDATE runs SET claim_status = ?, updated_at = ? WHERE run_id = ? AND claim_status = ?",
		)
		.run(nextClaimStatus, updatedAt, runId, expectedClaimStatus);
	if (Number(result.changes) !== 1)
		throw new KernelStoreConflictError(
			`CAS mismatch for run ${runId} claim ${expectedClaimStatus}`,
		);
}

export function updateRunTerminal(
	db: DatabaseSync,
	runId: string,
	state: Exclude<RunLifecycleState, "active">,
	recordJson: string,
	proofJson: string,
	updatedAt: string,
): void {
	const result = db
		.prepare(
			`UPDATE runs SET state = ?, record_json = ?, terminal_proof_json = ?, terminal_at = ?, updated_at = ?, claim_status = NULL
			 WHERE run_id = ? AND state = 'active'`,
		)
		.run(state, recordJson, proofJson, updatedAt, updatedAt, runId);
	if (Number(result.changes) !== 1)
		throw new KernelStoreConflictError(
			`terminal settlement refused for run ${runId}: the run is not active`,
		);
}

/** Record the document relocations a committed record write still owes. */
export function setPendingRelocations(
	db: DatabaseSync,
	runId: string,
	relocationsJson: string | null,
): void {
	db.prepare("UPDATE runs SET pending_relocations_json = ? WHERE run_id = ?").run(
		relocationsJson,
		runId,
	);
}

export function listPendingRelocations(db: DatabaseSync): KernelRunRow[] {
	const rows = db
		.prepare("SELECT * FROM runs WHERE pending_relocations_json IS NOT NULL ORDER BY updated_at, task_id")
		.all() as Array<Record<string, unknown>>;
	return rows.map(mapRunRow);
}

export function markAuditExported(db: DatabaseSync, runId: string, at: string): void {
	db.prepare("UPDATE runs SET audit_exported_at = ? WHERE run_id = ?").run(at, runId);
}

export function readOperationRow(
	db: DatabaseSync,
	operationId: string,
): KernelOperationRow | null {
	const row = db.prepare("SELECT * FROM operations WHERE operation_id = ?").get(operationId) as
		| Record<string, unknown>
		| undefined;
	if (!row) return null;
	return {
		operation_id: String(row.operation_id),
		kind: String(row.kind),
		run_id: typeof row.run_id === "string" ? row.run_id : null,
		result_json: String(row.result_json),
		committed_at: String(row.committed_at),
	};
}

export function insertOperationRow(db: DatabaseSync, row: KernelOperationRow): void {
	try {
		db.prepare(
			"INSERT INTO operations (operation_id, kind, run_id, result_json, committed_at) VALUES (?, ?, ?, ?, ?)",
		).run(row.operation_id, row.kind, row.run_id, row.result_json, row.committed_at);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new KernelStoreConflictError(`operation ${row.operation_id} was already committed: ${message}`);
	}
}

export function appendJournalRow(
	db: DatabaseSync,
	entryJson: string,
	taskId: string | null,
	observationCommitId: string | null,
	observationId: string | null,
): number {
	const result = db
		.prepare(
			"INSERT INTO journal (entry_json, task_id, observation_commit_id, observation_id) VALUES (?, ?, ?, ?)",
		)
		.run(entryJson, taskId, observationCommitId, observationId);
	return Number(result.lastInsertRowid);
}

export function findJournalObservation(
	db: DatabaseSync,
	observationCommitId: string,
): { observation_id: string | null } | null {
	const row = db
		.prepare("SELECT observation_id FROM journal WHERE observation_commit_id = ? LIMIT 1")
		.get(observationCommitId) as { observation_id?: unknown } | undefined;
	if (!row) return null;
	return {
		observation_id: typeof row.observation_id === "string" ? row.observation_id : null,
	};
}

export function readJournalRows(db: DatabaseSync, limit = 1000): KernelJournalRow[] {
	const rows = db
		.prepare("SELECT * FROM journal ORDER BY seq LIMIT ?")
		.all(limit) as Array<Record<string, unknown>>;
	return rows.map((raw) => ({
		seq: Number(raw.seq),
		entry_json: String(raw.entry_json),
		task_id: typeof raw.task_id === "string" ? raw.task_id : null,
		observation_commit_id:
			typeof raw.observation_commit_id === "string" ? raw.observation_commit_id : null,
		observation_id: typeof raw.observation_id === "string" ? raw.observation_id : null,
	}));
}

/** Stable path digests used for snapshot refs and audit identity metadata. */
export function workspaceIdentity(db: DatabaseSync): string {
	const value = readMeta(db, "workspace_id");
	if (!value) throw new KernelSchemaError("kernel store identity metadata is missing");
	return value;
}

/**
 * Consistent, closed-state backup. `VACUUM INTO` writes a checkpointed copy
 * that never contains a half-applied transaction.
 */
export function backupKernelStore(root: string, targetPath: string): void {
	const canonical = canonicalRoot(root);
	if (openStores.has(canonical))
		throw new KernelStoreConflictError("kernel store backup requires the store to be idle");
	const db = openKernelStore(root, { create: false });
	if (!db) throw new KernelStoreConflictError("kernel store does not exist");
	try {
		const target = resolve(targetPath);
		if (existsSync(target)) rmSync(target);
		db.prepare(`VACUUM INTO '${target.replace(/'/g, "''")}'`).run();
		const fd = openSync(target, constants.O_RDONLY);
		try {
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
	} finally {
		closeQuietly(db);
	}
}

/**
 * Restore a consistent backup into this worktree. All accessors must be
 * stopped; the restored database is revalidated against the worktree binding
 * so a copy from another worktree is refused instead of granting authority.
 */
export function restoreKernelStore(root: string, sourcePath: string): void {
	const canonical = canonicalRoot(root);
	if (openStores.has(canonical))
		throw new KernelStoreConflictError("kernel store restore requires the store to be idle");
	const source = resolve(sourcePath);
	if (!existsSync(source)) throw new KernelStoreConflictError("kernel store backup is missing");
	ensureStoreDirectory(canonical);
	const target = resolve(canonical, KERNEL_DB_RELATIVE);
	const temp = `${target}.${randomUUID()}.restore`;
	try {
		copyFileSync(source, temp);
		const fd = openSync(temp, constants.O_RDONLY);
		try {
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		// Validate the backup copy *before* publishing it: an unreadable,
		// incompatible or foreign-workspace backup must leave the live store and
		// its sidecars exactly as they were.
		const probe = openStoreFile(canonical, temp, { readOnly: true });
		if (!probe) throw new KernelStoreConflictError("kernel store backup could not be opened");
		closeQuietly(probe);
	} catch (error) {
		rmSync(temp, { force: true });
		throw error;
	}
	// Only a validated backup reaches the swap. Fold the live database's write
	// ahead log into its main file first: deleting the sidecars is otherwise a
	// window in which committed transactions only exist in the WAL.
	checkpointLiveStore(canonical, target);
	for (const suffix of ["-wal", "-shm"]) rmSync(`${target}${suffix}`, { force: true });
	renameSync(temp, target);
	const directory = openSync(dirname(target), constants.O_RDONLY);
	try {
		fsyncSync(directory);
	} finally {
		closeSync(directory);
	}
	const db = openStoreFile(canonical, target, {});
	if (!db) throw new KernelStoreConflictError("restored kernel store could not be opened");
	closeQuietly(db);
}

/**
 * Fold committed write-ahead-log content into the main database file so a
 * later swap cannot lose transactions that had not reached it yet.
 */
function checkpointLiveStore(canonical: string, target: string): void {
	if (!existsSync(target)) return;
	let db: DatabaseSync;
	try {
		db = new DatabaseSync(target);
	} catch {
		return;
	}
	try {
		db.exec("PRAGMA busy_timeout = 5000");
		db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
	} finally {
		try {
			db.close();
		} catch {
			// A close failure leaves the checkpointed file in place.
		}
	}
	const fd = openSync(target, constants.O_RDONLY);
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

export function readStoreBytes(path: string): Buffer {
	return readFileSync(path);
}

export function writeStoreBytes(path: string, bytes: Buffer): void {
	writeFileSync(path, bytes);
}
