/**
 * Kernel authority store adapter.
 *
 * One worktree-local SQLite database (`.imm/state/kernel.sqlite`) is the single
 * transaction boundary for runs, lifecycle, revisions, findings, attestations
 * and operation outcomes. This module owns the authority decisions that used to
 * be spread across file-level CAS writes and recoverable transaction markers:
 *
 * - the workspace owner is derived from the single active run,
 * - concurrent writes are checked by monotonic integer revisions,
 * - every replayable operation records its result in the same transaction, so a
 *   lost response reuses durable facts instead of writing again,
 * - terminal settlement commits atomically and exports audit evidence
 *   afterwards, where an interrupted export stays retryable and can never
 *   reactivate a settled run.
 *
 * File-level helpers still exist for tracked evidence: documentation artifacts
 * (freeze/rework relocation) and the immutable audit pair under `.imm/audit/`.
 */
import { createHash } from "node:crypto";
import {
	constants,
	closeSync,
	existsSync,
	fstatSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
	claimFromRunRow,
	parseBackendClaim,
	parseTaskTombstone,
	serializeBackendClaim,
	serializeTaskTombstone,
	type BackendClaim,
	type TaskTombstone,
} from "./backend_claim";
import {
	auditTaskRecordPath,
	auditTerminalProofPath,
	FILE_STORE_CLAIM_RELATIVE,
	FILE_STORE_TRANSACTIONS_RELATIVE,
	FILE_STORE_WORKSPACE_RELATIVE,
	stateDatabasePath,
} from "./storage_paths";
import { canonicalRecordHash } from "./reducer";
import { parseTaskRecord, parseTaskRecordV2 } from "./validation";
import {
	assertRunBinding,
	drainOperationId,
	enrollmentOperationId,
	mintRunId,
	runIdentity,
	terminalOperationId,
	type RunIdentity,
} from "./run_identity";
import {
	KernelStoreConflictError,
	KernelStoreSecurityError,
	activeRunId,
	appendJournalRow,
	findJournalObservation,
	insertOperationRow,
	insertRunRow,
	listPendingAuditExports,
	listPendingRelocations,
	markAuditExported,
	setPendingRelocations,
	readOperationRow,
	readRunRowById,
	readRunRowByTask,
	readWorkspaceRow,
	setStoreFaultForTest,
	updateRunClaim,
	updateRunRecord,
	updateRunTerminal,
	withKernelRead,
	withKernelTransaction,
	writeWorkspaceRow,
	type KernelRunRow,
} from "./sqlite_store";
import type {
	TaskLifecycle,
	TaskPhase,
	TaskRecordV2,
	TaskRecord,
	StoredTaskMutationV3,
	V3AuthorityObservation,
} from "./types";

export {
	KernelSchemaError,
	KernelStoreConflictError,
	KernelStoreSecurityError,
} from "./sqlite_store";

export const MISSING_REVISION = "missing";

/**
 * The revision token of a workspace that has recorded no write yet. A worktree
 * whose store has not been created reports this same token, so a preparation
 * taken before the store exists still matches the store's own bootstrap
 * revision instead of changing identity when the first writer creates it.
 */
export const INITIAL_WORKSPACE_REVISION = recordRevision(0);

export interface WorkspaceState {
	contract: "assurance_kernel/workspace/v1";
	current_working: string | null;
}

export type JournalReasonCode =
	| "command_ok"
	| "authority_commit_observed"
	| "invalid_command"
	| "dry_run_required"
	| "source_missing"
	| "source_invalid"
	| "source_read_failed"
	| "shadow_divergence"
	| "migration_ambiguous"
	| "readiness_query_nonqualifying"
	// Emitted by runtime/commands/kernel.ts. Absent from this union until the
	// journal types were first exported and type checked.
	| "routing_policy_invalid"
	| "routing_unavailable"
	| "kernel_owner_active"
	| "v3_owner_nonterminal"
	| "input_oversize"
	| "input_invalid"
	| "intent_invalid"
	| "task_path_mismatch"
	| "destination_invalid"
	| "destination_parent_invalid"
	| "destination_parent_missing"
	| "destination_exists"
	| "destination_write_failed";

export interface JournalEntry {
	contract: "assurance_kernel/journal/v1";
	timestamp: string;
	task_id: string | null;
	command: string;
	entry_phase: TaskPhase | null;
	result: "ok" | "rejected" | "escalated";
	reason_code: JournalReasonCode;
	recovery_hint: string | null;
	planner_reentry: boolean;
	user_intervention: boolean;
	observation?: V3AuthorityObservation;
}

// ---------------------------------------------------------------------------
// Revision vocabulary: monotonic integers instead of serialized byte hashes.
// ---------------------------------------------------------------------------

function revisionFor(content: string): string {
	return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function revisionForContent(content: string): string {
	return revisionFor(content);
}

/**
 * The workspace CAS token. The contract requires a `sha256:` token, and the
 * value must be revision-based: two workspaces with identical serialized
 * content at different revisions are different states, so the token binds the
 * store's monotonic revision instead of the bytes.
 */
function recordRevision(revision: number): string {
	return revisionFor(`assurance_kernel/workspace_revision/v1:${revision}`);
}

function nowIso(): string {
	return new Date().toISOString();
}

function validateTaskId(taskId: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(taskId))
		throw new KernelStoreSecurityError("task_id is not a safe file identity");
}

function canonicalRoot(root: string): string {
	try {
		return realpathSync(root);
	} catch {
		throw new KernelStoreSecurityError("project root is unavailable");
	}
}

// ---------------------------------------------------------------------------
// Retired file-store guard: a worktree must never mix two authority stores.
// ---------------------------------------------------------------------------

/**
 * Retire the retired claim/owner files that provably duplicate this task's own
 * committed run. Called only from an authority repair, whose proof is what
 * authorizes the deletion; ordinary mutations never delete retired authority.
 */
function retireSupersededRetiredFiles(root: string, db: DatabaseSync, taskId: string): void {
	const canonical = canonicalRoot(root);
	for (const path of [FILE_STORE_CLAIM_RELATIVE, FILE_STORE_WORKSPACE_RELATIVE]) {
		const full = resolve(canonical, path);
		if (!existsSync(full)) continue;
		if (isRetiredFileProvablySuperseded(full, db, taskId)) rmSync(full, { force: true });
	}
}

/**
 * True only when the retired file's own identity matches the committed run for
 * this task: the same task id, and — when the file carries them — the same
 * enrollment event and intent hash. An unreadable or foreign file is never
 * treated as superseded.
 */
function isRetiredFileProvablySuperseded(
	path: string,
	db: DatabaseSync,
	taskId: string,
): boolean {
	const run = readRunRowByTask(db, taskId);
	if (!run) return false;
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch {
		return false;
	}
	// Ownership, not freshness: a stale copy of this task's own claim is exactly
	// what a repair removes, while another task's claim is never this task's to
	// retire. The store holding this task's run is what makes the file a
	// duplicate of committed authority.
	if (raw.task_id !== taskId) return false;
	if (raw.contract !== "assurance_kernel/backend_claim/v2") {
		// The retired workspace owner names its owner directly.
		if (raw.current_working !== taskId) return false;
	}
	return true;
}

/**
 * Refuse mutation while the retired `.imm/state/*.json` file store (or the
 * pre-cutover `.imm/tasks` layout) still holds authority. The check is bounded
 * to `existsSync` paths so it can run on every locked mutation.
 */
function assertNoRetiredFileStore(
	root: string,
	db?: DatabaseSync,
	taskId?: string | null,
): void {
	const canonical = canonicalRoot(root);
	// Real authority in the retired store: must be imported, never ignored.
	const retired: Array<[string, string]> = [
		[".imm/tasks", "pre-cutover task store"],
		[".imm/workspace.json", "pre-cutover workspace owner"],
		[".imm/state/tasks", "task records"],
	];
	for (const [path, label] of retired) {
		if (existsSync(resolve(canonical, path)))
			throw new KernelStoreSecurityError(
				`retired file-store authority is present (${label}: ${path}); import it with the supported migration before mutating this worktree`,
			);
	}
	// A retired claim/owner file is inert only when its own bytes prove that this
	// exact task and enrollment already own the SQLite run: it is then a
	// duplicate of committed authority. Nothing is deleted here — removal
	// belongs to the supported migration — and a file whose owner is anything
	// else keeps its authority and fails the mutation closed.
	const derived: Array<[string, string]> = [
		[FILE_STORE_CLAIM_RELATIVE, "workspace claim"],
		[FILE_STORE_WORKSPACE_RELATIVE, "workspace owner"],
	];
	for (const [path, label] of derived) {
		const full = resolve(canonical, path);
		if (!existsSync(full)) continue;
		if (db === undefined || typeof taskId !== "string" || taskId.length === 0)
			throw new KernelStoreSecurityError(
				`retired file-store authority is present (${label}: ${path}); import it with the supported migration before mutating this worktree`,
			);
		if (!isRetiredFileProvablySuperseded(full, db, taskId))
			throw new KernelStoreSecurityError(
				`retired file-store authority is present (${label}: ${path}) and does not belong to this task; import it with the supported migration before mutating this worktree`,
			);
	}
	if (existsSync(resolve(canonical, FILE_STORE_TRANSACTIONS_RELATIVE))) {
		const entries = readdirNames(resolve(canonical, FILE_STORE_TRANSACTIONS_RELATIVE));
		const pending = entries.filter((entry) => entry.endsWith(".json") && entry !== "storage-layout-migration.json");
		if (pending.length > 0)
			throw new KernelStoreSecurityError(
				`retired file-store transaction marker is present (${pending[0]}); settle it with the runtime that wrote it before mutating this worktree`,
			);
	}
}

/**
 * Read-only file-store conflict inspection. Real authority in the retired store
 * always conflicts; a derived claim/owner file conflicts only while the store
 * has no run for the requested task (a leftover for a known task is inert and
 * gets retired by the next mutation).
 */
function retiredFileStoreConflict(
	root: string,
	db: DatabaseSync | null,
	taskId: string | null,
): string | null {
	const canonical = canonicalRoot(root);
	const authority: Array<[string, string]> = [
		[".imm/tasks", "pre-cutover task store"],
		[".imm/workspace.json", "pre-cutover workspace owner"],
		[".imm/state/tasks", "task records"],
	];
	for (const [path, label] of authority)
		if (existsSync(resolve(canonical, path)))
			return `retired file-store authority is present (${label}: ${path}); import it with the supported migration before mutating this worktree`;
	const storeHasTask = db !== null && taskId !== null && readRunRowByTask(db, taskId) !== null;
	if (!storeHasTask) {
		const derived: Array<[string, string]> = [
			[FILE_STORE_CLAIM_RELATIVE, "workspace claim"],
			[FILE_STORE_WORKSPACE_RELATIVE, "workspace owner"],
		];
		for (const [path, label] of derived)
			if (existsSync(resolve(canonical, path)))
				return `retired file-store authority is present (${label}: ${path}); import it with the supported migration before mutating this worktree`;
	}
	const transactions = resolve(canonical, FILE_STORE_TRANSACTIONS_RELATIVE);
	if (existsSync(transactions)) {
		const pending = readdirNames(transactions).filter(
			(entry) => entry.endsWith(".json") && entry !== "storage-layout-migration.json",
		);
		if (pending.length > 0)
			return `retired file-store transaction marker is present (${pending[0]}); settle it with the runtime that wrote it before mutating this worktree`;
	}
	return null;
}

function readdirNames(path: string): string[] {
	try {
		return readdirSync(path);
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Secure file helpers (tracked evidence + artifact relocation only).
// ---------------------------------------------------------------------------

function withinRoot(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return (
		rel === "" ||
		(!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
	);
}

function safeCandidate(root: string, relativePath: string): {
	root: string;
	path: string;
} {
	if (
		!relativePath ||
		relativePath.includes("\0") ||
		isAbsolute(relativePath) ||
		relativePath.includes("\\")
	)
		throw new KernelStoreSecurityError("project-relative path is invalid");
	const canonical = canonicalRoot(root);
	const candidate = resolve(canonical, relativePath);
	if (!withinRoot(canonical, candidate))
		throw new KernelStoreSecurityError("path escapes the project root");
	return { root: canonical, path: candidate };
}

function pathStatOrNull(path: string): ReturnType<typeof lstatSync> | null {
	try {
		return lstatSync(path);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return null;
		throw error;
	}
}

function assertNoSymlinkSegments(root: string, candidate: string): void {
	const rel = relative(root, candidate);
	let current = root;
	for (const segment of rel.split(sep).filter(Boolean)) {
		current = resolve(current, segment);
		const stat = pathStatOrNull(current);
		if (!stat) continue;
		if (stat.isSymbolicLink())
			throw new KernelStoreSecurityError(
				`symlink storage segment is forbidden: ${relative(root, current)}`,
			);
	}
}

function capturePathIdentities(
	root: string,
	candidate: string,
): Array<{ path: string; dev: number; ino: number }> {
	const paths = [root];
	let current = root;
	for (const segment of relative(root, candidate).split(sep).filter(Boolean)) {
		current = resolve(current, segment);
		paths.push(current);
	}
	return paths.map((path) => {
		const stat = lstatSync(path);
		if (stat.isSymbolicLink())
			throw new KernelStoreSecurityError(
				`symlink storage segment is forbidden: ${relative(root, path)}`,
			);
		return { path, dev: stat.dev, ino: stat.ino };
	});
}

function assertPathIdentitiesUnchanged(
	before: Array<{ path: string; dev: number; ino: number }>,
): void {
	for (const identity of before) {
		const after = lstatSync(identity.path);
		if (
			after.isSymbolicLink() ||
			after.dev !== identity.dev ||
			after.ino !== identity.ino
		)
			throw new KernelStoreSecurityError(
				`path identity changed during access: ${identity.path}`,
			);
	}
}

function ensureSecureDirectory(root: string, relativePath: string): string {
	const target = safeCandidate(root, relativePath);
	const rel = relative(target.root, target.path);
	let current = target.root;
	for (const segment of rel.split(sep).filter(Boolean)) {
		current = resolve(current, segment);
		const stat = pathStatOrNull(current);
		if (stat) {
			if (stat.isSymbolicLink())
				throw new KernelStoreSecurityError(
					`symlink storage segment is forbidden: ${relative(target.root, current)}`,
				);
			if (!stat.isDirectory())
				throw new KernelStoreSecurityError(
					`storage segment is not a directory: ${relative(target.root, current)}`,
				);
			continue;
		}
		mkdirSync(current);
	}
	return target.path;
}

export function readSecureProjectFile(
	root: string,
	relativePath: string,
): string {
	const candidate = safeCandidate(root, relativePath);
	assertNoSymlinkSegments(candidate.root, candidate.path);
	const before = pathStatOrNull(candidate.path);
	if (!before) throw new Error(`source_missing: ${relativePath}`);
	const identities = capturePathIdentities(candidate.root, candidate.path);
	if (!before.isFile())
		throw new KernelStoreSecurityError(`source is not a regular file: ${relativePath}`);
	const noFollow = constants.O_NOFOLLOW ?? 0;
	let fd: number | null = null;
	try {
		fd = openSync(candidate.path, constants.O_RDONLY | noFollow);
		const opened = fstatSync(fd);
		if (opened.dev !== before.dev || opened.ino !== before.ino)
			throw new KernelStoreSecurityError(`source identity changed: ${relativePath}`);
		const content = readFileSync(fd, "utf8");
		const after = lstatSync(candidate.path);
		if (after.dev !== opened.dev || after.ino !== opened.ino)
			throw new KernelStoreSecurityError(`source identity changed: ${relativePath}`);
		assertPathIdentitiesUnchanged(identities);
		return content;
	} finally {
		if (fd !== null) closeSync(fd);
	}
}

function currentRevision(root: string, relativePath: string): string {
	const candidate = safeCandidate(root, relativePath);
	const stat = pathStatOrNull(candidate.path);
	if (!stat) return MISSING_REVISION;
	if (stat.isSymbolicLink())
		throw new KernelStoreSecurityError(`symlink storage target is forbidden: ${relativePath}`);
	return revisionFor(readSecureProjectFile(root, relativePath));
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

function clearStaleLock(lockPath: string): boolean {
	const before = pathStatOrNull(lockPath);
	if (!before) return true;
	if (before.isSymbolicLink() || !before.isFile())
		throw new KernelStoreSecurityError("kernel store lock is not a regular file");
	let stale = false;
	let fd: number | null = null;
	try {
		fd = openSync(lockPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const raw = JSON.parse(readFileSync(fd, "utf8")) as Record<string, unknown>;
		stale =
			Number.isInteger(raw.pid) &&
			Number(raw.pid) > 0 &&
			!processIsAlive(Number(raw.pid));
	} catch {
		stale = Date.now() - Number(before.mtimeMs) > 30_000;
	} finally {
		if (fd !== null) closeSync(fd);
	}
	if (!stale) return false;
	const after = lstatSync(lockPath);
	if (after.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino)
		throw new KernelStoreSecurityError(
			"kernel store lock identity changed during recovery",
		);
	rmSync(lockPath);
	return true;
}

/** Bounded exclusive file lock for tracked-evidence writes. */
function withExclusiveLock<T>(lockPath: string, operation: () => T): T {
	const noFollow = constants.O_NOFOLLOW ?? 0;
	let fd: number | null = null;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			fd = openSync(
				lockPath,
				constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
				0o600,
			);
			break;
		} catch (error) {
			if (
				attempt === 0 &&
				(error as NodeJS.ErrnoException).code === "EEXIST" &&
				clearStaleLock(lockPath)
			)
				continue;
			throw new KernelStoreConflictError(
				`kernel store lock is busy: ${error instanceof Error ? error.message : error}`,
			);
		}
	}
	if (fd === null)
		throw new KernelStoreConflictError("kernel store lock could not be acquired");
	const identity = fstatSync(fd);
	try {
		writeFileSync(
			fd,
			`${JSON.stringify({ pid: process.pid, started_at: nowIso() })}\n`,
			"utf8",
		);
		fsyncSync(fd);
		return operation();
	} finally {
		closeSync(fd);
		const current = pathStatOrNull(lockPath);
		if (
			current &&
			!current.isSymbolicLink() &&
			current.dev === identity.dev &&
			current.ino === identity.ino
		)
			rmSync(lockPath);
	}
}

function fsyncDirectory(path: string): void {
	const fd = openSync(path, constants.O_RDONLY);
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

function atomicCasWrite(
	root: string,
	relativePath: string,
	content: string,
	expectedRevision: string,
): string {
	const candidate = safeCandidate(root, relativePath);
	const parentRelative = relative(candidate.root, dirname(candidate.path));
	ensureSecureDirectory(root, parentRelative);
	assertNoSymlinkSegments(candidate.root, candidate.path);
	return withExclusiveLock(`${candidate.path}.lock`, () => {
		const actualRevision = currentRevision(root, relativePath);
		if (actualRevision !== expectedRevision)
			throw new KernelStoreConflictError(
				`CAS mismatch for ${relativePath}: expected ${expectedRevision}, got ${actualRevision}`,
			);
		const tempPath = `${candidate.path}.${process.pid}.tmp`;
		let fd: number | null = null;
		try {
			fd = openSync(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
			writeFileSync(fd, content, "utf8");
			fsyncSync(fd);
			closeSync(fd);
			fd = null;
			assertNoSymlinkSegments(candidate.root, candidate.path);
			renameSync(tempPath, candidate.path);
			fsyncDirectory(dirname(candidate.path));
		} finally {
			if (fd !== null) closeSync(fd);
			rmSync(tempPath, { force: true });
		}
		return revisionFor(content);
	});
}

/** Converge a tracked evidence file to exact bytes: same bytes are idempotent. */
function convergeFile(
	root: string,
	relativePath: string,
	expectedRevision: string,
	nextContent: string,
): string {
	const nextRevision = revisionFor(nextContent);
	const actualRevision = currentRevision(root, relativePath);
	if (actualRevision === nextRevision) return nextRevision;
	if (actualRevision !== expectedRevision)
		throw new KernelStoreConflictError(
			`transaction conflict for ${relativePath}: expected ${expectedRevision} or ${nextRevision}, got ${actualRevision}`,
		);
	return atomicCasWrite(root, relativePath, nextContent, expectedRevision);
}

// ---------------------------------------------------------------------------
// Artifact relocation (documentation artifacts only; S2 removes the relocation).
// ---------------------------------------------------------------------------

export interface ArtifactRelocationV1 {
	from_path: string;
	to_path: string;
	content_hash: string;
}

interface WorkspaceTransactionV2 {
	contract: "assurance_kernel/workspace_transaction/v2";
	task_id: string;
	expected_record_hash: string;
	next_record_content: string;
	expected_workspace_hash: string;
	next_workspace_content: string;
	artifact_relocations?: ArtifactRelocationV1[];
}

export type { WorkspaceTransactionV2 };

function archiveArtifactPath(path: string): string | null {
	const matched = path.match(/^docs\/(plans|specs)\/([^/]+)$/);
	return matched ? `docs/${matched[1]}/archive/${matched[2]}` : null;
}

function assertArtifactRelocation(relocation: ArtifactRelocationV1): void {
	if (!/^sha256:[a-f0-9]{64}$/.test(relocation.content_hash))
		throw new KernelStoreSecurityError("artifact relocation content_hash is invalid");
	if (
		archiveArtifactPath(relocation.from_path) !== relocation.to_path &&
		archiveArtifactPath(relocation.to_path) !== relocation.from_path
	)
		throw new KernelStoreSecurityError("artifact relocation paths must be one active/archive pair");
}

function convergeArtifactRelocation(root: string, relocation: ArtifactRelocationV1): void {
	assertArtifactRelocation(relocation);
	const fromRevision = currentRevision(root, relocation.from_path);
	const toRevision = currentRevision(root, relocation.to_path);
	if (fromRevision === MISSING_REVISION && toRevision === relocation.content_hash) return;
	if (fromRevision !== relocation.content_hash || toRevision !== MISSING_REVISION)
		throw new KernelStoreConflictError(
			`artifact relocation conflict for ${relocation.from_path} -> ${relocation.to_path}`,
		);
	const from = safeCandidate(root, relocation.from_path);
	const to = safeCandidate(root, relocation.to_path);
	ensureSecureDirectory(root, relative(to.root, dirname(to.path)));
	assertNoSymlinkSegments(from.root, from.path);
	assertNoSymlinkSegments(to.root, to.path);
	renameSync(from.path, to.path);
	fsyncDirectory(dirname(from.path));
	if (dirname(from.path) !== dirname(to.path)) fsyncDirectory(dirname(to.path));
}

// ---------------------------------------------------------------------------
// Test seams.
// ---------------------------------------------------------------------------

/**
 * Test-only seam. Runs after the authority writes of the current transaction
 * and immediately before COMMIT, so a thrown fault must roll the whole
 * transaction back with no partial authority.
 */
export function setAfterTaskTransactionWriteForTest(
	hook: (() => void) | null,
): void {
	setStoreFaultForTest(hook);
}

let auditExportFaultForTest: (() => void) | null = null;

/** Test-only seam: fail the terminal audit export after settlement commits. */
export function setAuditExportFaultForTest(hook: (() => void) | null): void {
	auditExportFaultForTest = hook;
}

function runAuditExportFault(): void {
	const hook = auditExportFaultForTest;
	auditExportFaultForTest = null;
	hook?.();
}

// ---------------------------------------------------------------------------
// Workspace and TaskRecord reads.
// ---------------------------------------------------------------------------

function parseWorkspaceContent(content: string): WorkspaceState {
	const raw = JSON.parse(content) as Record<string, unknown>;
	const unknown = Object.keys(raw).filter(
		(key) => !["contract", "current_working"].includes(key),
	);
	if (unknown.length > 0)
		throw new KernelStoreSecurityError(`workspace has unknown field: ${unknown[0]}`);
	if (raw.contract !== "assurance_kernel/workspace/v1")
		throw new KernelStoreSecurityError("workspace contract is invalid");
	if (
		raw.current_working !== null &&
		(typeof raw.current_working !== "string" || !raw.current_working.trim())
	)
		throw new KernelStoreSecurityError("workspace current_working is invalid");
	if (typeof raw.current_working === "string") validateTaskId(raw.current_working);
	return raw as unknown as WorkspaceState;
}

function serializeWorkspace(state: WorkspaceState): string {
	return `${JSON.stringify(state, null, 2)}\n`;
}

export { serializeWorkspace };

function workspaceStateFromRow(db: DatabaseSync, runId: string | null): WorkspaceState {
	if (!runId) return { contract: "assurance_kernel/workspace/v1", current_working: null };
	const run = readRunRowById(db, runId);
	return {
		contract: "assurance_kernel/workspace/v1",
		current_working: run && run.state === "active" ? run.task_id : null,
	};
}

/**
 * The run this worktree currently holds for a task, read straight from the
 * store. Capability validation needs only this identity, so it never pays for
 * a full authority projection on the mutation path.
 */
export function currentRunId(root: string, taskId: string): string | null {
	validateTaskId(taskId);
	const read = withKernelRead(root, (db) => {
		const run = readRunRowByTask(db, taskId);
		return run && run.state === "active" ? run.run_id : null;
	});
	return read ?? null;
}

export function readWorkspaceStateRaw(root: string): {
	revision: string;
	state: WorkspaceState;
} {
	const read = withKernelRead(root, (db) => {
		const row = readWorkspaceRow(db);
		return {
			// The CAS token is the store's monotonic revision, never a hash of the
			// serialized owner: two idle workspaces with identical content are
			// still different revisions.
			revision: recordRevision(row.revision),
			state: workspaceStateFromRow(db, row.current_run_id),
		};
	});
	if (read) return read;
	return {
		revision: INITIAL_WORKSPACE_REVISION,
		state: { contract: "assurance_kernel/workspace/v1", current_working: null },
	};
}

function recordFromRun(run: KernelRunRow): TaskRecord {
	const record = parseTaskRecord(JSON.parse(run.record_json) as Record<string, unknown>);
	if (record.task_id !== run.task_id)
		throw new KernelStoreSecurityError("task record identity is inconsistent with its run");
	return record;
}

export function readTaskRecordRaw(
	root: string,
	taskId: string,
): { revision: string; record: TaskRecord | null } {
	validateTaskId(taskId);
	const read = withKernelRead(root, (db) => {
		const run = readRunRowByTask(db, taskId);
		if (!run) return { revision: MISSING_REVISION, record: null };
		// Terminal records stay durable in the store as the run index; the
		// active-record surface mirrors the previous layout, where terminal
		// evidence lives in the immutable audit pair.
		if (run.state !== "active") return { revision: MISSING_REVISION, record: null };
		const record = recordFromRun(run);
		return { revision: canonicalRecordHash(record), record };
	});
	return read ?? { revision: MISSING_REVISION, record: null };
}

/**
 * The committed record straight from the store, for a run of any lifecycle.
 * This is the authority for a settled task; the audit pair is exported
 * evidence and may still be in flight.
 */
export function readCommittedRecord(
	root: string,
	taskId: string,
): { revision: string; record: TaskRecord } | null {
	validateTaskId(taskId);
	const read = withKernelRead(root, (db) => {
		const run = readRunRowByTask(db, taskId);
		if (!run) return null;
		// A settled run always carries the proof its settlement committed; a store
		// missing it is corrupt and must never project as a settled task.
		if (run.state !== "active" && run.terminal_proof_json === null)
			throw new KernelStoreConflictError(
				`task ${taskId} is ${run.state} without a committed terminal proof`,
			);
		const record = recordFromRun(run);
		return { revision: canonicalRecordHash(record), record };
	});
	return read ?? null;
}

/**
 * Read the immutable terminal audit pair for one task:
 * `.imm/audit/<task-id>/task-record.json` plus `terminal-proof.json`.
 * Both files must exist, be identity-consistent, and the proof's
 * `final_record_hash` must equal the record bytes' revision. Only ENOENT on
 * the whole task directory means absent; a partial pair fails closed.
 * The audit record may be TaskRecord v3/v4 or historical terminal v2.
 */
export function readAuditTaskPair(
	root: string,
	taskId: string,
): {
	recordRevision: string;
	record: TaskRecord | TaskRecordV2;
	proof: TaskTombstone;
} | null {
	validateTaskId(taskId);
	const recordPath = auditTaskRecordPath(taskId);
	const proofPath = auditTerminalProofPath(taskId);
	const recordRevision = currentRevision(root, recordPath);
	const proofRevision = currentRevision(root, proofPath);
	if (recordRevision === MISSING_REVISION && proofRevision === MISSING_REVISION)
		return null;
	if (recordRevision === MISSING_REVISION || proofRevision === MISSING_REVISION)
		throw new KernelStoreSecurityError("terminal audit pair is incomplete");
	const recordContent = readSecureProjectFile(root, recordPath);
	const proof = parseTaskTombstone(
		JSON.parse(readSecureProjectFile(root, proofPath)) as Record<string, unknown>,
	);
	if (proof.task_id !== taskId)
		throw new KernelStoreSecurityError("terminal audit proof identity is inconsistent");
	if (proof.final_record_hash !== recordRevision)
		throw new KernelStoreSecurityError("terminal audit proof does not match its task record");
	const raw = JSON.parse(recordContent) as { contract?: unknown };
	let record: TaskRecord | TaskRecordV2;
	if (raw.contract === "assurance_kernel/task_record/v2") {
		const legacy = parseTaskRecordV2(raw);
		if (
			legacy.task_id !== taskId ||
			(legacy.phase !== "done" && legacy.phase !== "stopped")
		)
			throw new KernelStoreSecurityError(
				"historical audit TaskRecord v2 must be terminal and identity-consistent",
			);
		record = legacy;
	} else {
		const current = parseTaskRecord(raw);
		if (
			current.task_id !== taskId ||
			(current.lifecycle !== "done" && current.lifecycle !== "stopped")
		)
			throw new KernelStoreSecurityError(
				"audit TaskRecord must be terminal and identity-consistent",
			);
		record = current;
	}
	return { recordRevision, record, proof };
}

export function readTaskRecord(
	root: string,
	taskId: string,
): { revision: string; record: TaskRecord | null } {
	return readTaskRecordRaw(root, taskId);
}

// ---------------------------------------------------------------------------
// Audit export: deterministic, idempotent, retryable, never authority.
// ---------------------------------------------------------------------------

function exportTerminalAudit(root: string, run: KernelRunRow): void {
	runAuditExportFault();
	if (!run.terminal_proof_json)
		throw new KernelStoreSecurityError(
			`terminal run ${run.run_id} has no committed terminal proof`,
		);
	convergeFile(root, auditTaskRecordPath(run.task_id), MISSING_REVISION, run.record_json);
	convergeFile(
		root,
		auditTerminalProofPath(run.task_id),
		MISSING_REVISION,
		run.terminal_proof_json,
	);
}

/** Retry any terminal settlement whose audit export did not complete. */
function retryPendingAuditExports(root: string, db: DatabaseSync): void {
	for (const run of listPendingAuditExports(db)) {
		exportTerminalAudit(root, run);
		markAuditExported(db, run.run_id, nowIso());
	}
}

/**
 * Converge document relocations that a committed record write still owes.
 * Relocation is a file move, so it runs after COMMIT and stays idempotent:
 * an interruption leaves the committed record authoritative and the move is
 * retried under the next lock.
 */
function convergePendingRelocations(root: string, db: DatabaseSync): void {
	for (const run of listPendingRelocations(db)) {
		const relocations = JSON.parse(run.pending_relocations_json ?? "[]") as ArtifactRelocationV1[];
		for (const relocation of relocations) convergeArtifactRelocation(root, relocation);
		setPendingRelocations(db, run.run_id, null);
	}
}

// ---------------------------------------------------------------------------
// Journal.
// ---------------------------------------------------------------------------

export function appendJournalEntry(root: string, entry: JournalEntry): void {
	withKernelStoreLock(root, () => {
		withKernelTransaction(root, (db) => {
			appendJournalRow(
				db,
				JSON.stringify(entry),
				entry.task_id,
				entry.observation?.commit_id ?? null,
				entry.observation?.observation_id ?? null,
			);
		});
	});
}

export function appendObservationJournalEntry(
	root: string,
	entry: JournalEntry & { observation: V3AuthorityObservation },
): "appended" | "duplicate" {
	return withKernelTransaction(root, (db) => {
		const existing = findJournalObservation(db, entry.observation.commit_id);
		if (existing) {
			if (existing.observation_id === entry.observation.observation_id) return "duplicate";
			throw new KernelStoreConflictError(
				`observation commit identity conflict: ${entry.observation.commit_id}`,
			);
		}
		appendJournalRow(
			db,
			JSON.stringify(entry),
			entry.task_id,
			entry.observation.commit_id,
			entry.observation.observation_id,
		);
		return "appended";
	});
}

// ---------------------------------------------------------------------------
// Locked transaction boundary.
// ---------------------------------------------------------------------------

/**
 * Run one authority operation under the workspace write transaction. Retired
 * file-store authority blocks every mutation, and interrupted audit exports are
 * retried before the operation observes state.
 */
/**
 * Run one authority operation under the workspace write transaction for an
 * explicit task. A leftover derived claim/owner file whose task the store
 * already superseded is retired here; anything else fails closed.
 */
export function withKernelStoreLockForTask<T>(
	root: string,
	taskId: string,
	operation: () => T,
): T {
	validateTaskId(taskId);
	return withKernelTransaction(root, (db) => {
		assertNoRetiredFileStore(root, db, taskId);
		convergePendingRelocations(root, db);
		retryPendingAuditExports(root, db);
		return operation();
	});
}

/**
 * Converge committed-but-unapplied store work (pending artifact relocations and
 * terminal audit exports) before a Host reads anything the record points at.
 * Both Hosts call this at their mutation entry, so a freeze interrupted between
 * its commit and its file moves completes instead of failing the next read.
 */
export function recoverKernelStoreFollowUps(root: string, taskId?: string): void {
	if (typeof taskId === "string" && taskId.length > 0)
		return void withKernelStoreLockForTask(root, taskId, () => undefined);
	return void withKernelStoreLock(root, () => undefined);
}

export function withKernelStoreLock<T>(root: string, operation: () => T): T {
	const result = withKernelTransaction(root, (db) => {
		assertNoRetiredFileStore(root);
		return operation();
	});
	// Deterministic follow-ups run after the authority transaction committed:
	// document relocation and audit evidence can never roll back or revive an
	// already settled run, and an interruption stays retryable here.
	retryStoreFollowUps(root);
	return result;
}

/** Converge owed document relocations and interrupted audit exports. */
export function retryStoreFollowUps(root: string): void {
	withKernelTransaction(root, (db) => {
		convergePendingRelocations(root, db);
		retryPendingAuditExports(root, db);
	});
}

// ---------------------------------------------------------------------------
// CAS writes.
// ---------------------------------------------------------------------------

function assertWorkspaceExpectation(db: DatabaseSync, expected: string, label: string): number {
	const row = readWorkspaceRow(db);
	const currentRevision = recordRevision(row.revision);
	if (expected === MISSING_REVISION) {
		// The store itself is created by this transaction: only the pristine
		// workspace may accept a missing expectation.
		if (row.revision !== 0)
			throw new KernelStoreConflictError(
				`CAS mismatch for ${label}: expected ${expected}, got ${currentRevision}`,
			);
		return row.revision;
	}
	if (currentRevision !== expected)
		throw new KernelStoreConflictError(
			`CAS mismatch for ${label}: expected ${expected}, got ${currentRevision}`,
		);
	return row.revision;
}

interface CommittedOperationResult {
	record_json: string;
	workspace_json: string;
}

function decodeOperationResult(
	resultJson: string,
): { record: TaskRecord; workspace: WorkspaceState } {
	const parsed = JSON.parse(resultJson) as CommittedOperationResult;
	return {
		record: parseTaskRecord(JSON.parse(parsed.record_json) as Record<string, unknown>),
		workspace: parseWorkspaceContent(parsed.workspace_json),
	};
}

function requireActiveRun(db: DatabaseSync, taskId: string): KernelRunRow {
	const run = readRunRowByTask(db, taskId);
	if (!run)
		throw new KernelStoreConflictError(`task ${taskId} has no enrolled run in this worktree`);
	if (run.state !== "active")
		throw new KernelStoreConflictError(
			`task ${taskId} is ${run.state}; only an active run can be mutated`,
		);
	if (run.claim_status === null)
		throw new KernelStoreConflictError(`task ${taskId} has no workspace claim to mutate`);
	return run;
}

/**
 * Read-only store probe for commands that must not create authority state:
 * retired file-store authority fails closed, and an existing store is opened
 * and validated without writing.
 */
export function probeKernelStore(root: string): void {
	assertNoRetiredFileStore(root);
	withKernelRead(root, () => undefined);
}

/** Commit a TaskRecord result through one revision-checked transaction. */
export function commitTaskRecordLocked(
	root: string,
	taskId: string,
	expectedRecordHash: string,
	nextRecord: TaskRecord,
	expectedWorkspaceHash: string,
	nextWorkspace: WorkspaceState,
	artifactRelocations: ArtifactRelocationV1[] = [],
	capabilityRunId?: string,
): StoredTaskMutationV3 {
	validateTaskId(taskId);
	const nextRecordContent = `${JSON.stringify(nextRecord, null, 2)}\n`;
	const timestamp = nowIso();
	const committed = withKernelTransaction(root, (db) => {
		assertNoRetiredFileStore(root);
		const run = requireActiveRun(db, taskId);
		const identity = runIdentity(db, run);
		assertRunBinding(identity, { task_id: taskId, run_id: run.run_id }, "task record commit");
		assertCapabilityRun(identity, capabilityRunId, "task record commit");
		const committedRecord = parseTaskRecord(nextRecord as unknown as Record<string, unknown>);
		const currentRevision = canonicalRecordHash(recordFromRun(run));
		if (currentRevision !== expectedRecordHash)
			throw new KernelStoreConflictError(
				`CAS mismatch for run ${run.run_id}: expected ${expectedRecordHash}, got ${currentRevision}`,
			);
		for (const relocation of artifactRelocations) assertArtifactRelocation(relocation);
		updateRunRecord(db, run.run_id, run.revision, nextRecordContent, timestamp);
		if (artifactRelocations.length > 0)
			setPendingRelocations(db, run.run_id, JSON.stringify(artifactRelocations));
		const workspaceRevision = assertWorkspaceExpectation(db, expectedWorkspaceHash, "workspace");
		const workspaceRevisionAfter = writeWorkspaceRow(
			db,
			workspaceRevision,
			run.run_id,
			timestamp,
		);
		return {
			revision: canonicalRecordHash(committedRecord),
			record: committedRecord,
			workspace: {
				revision: recordRevision(workspaceRevisionAfter),
				state: nextWorkspace,
			},
		};
	});
	return committed;
}

/**
 * A native capability names the exact run it was issued for. Two worktrees can
 * hold the same logical task with identical record, intent and diff content, so
 * task and content bindings alone cannot keep authority in the worktree that
 * issued it; the run identity can.
 */
export function assertCapabilityRun(
	current: RunIdentity,
	capabilityRunId: string | undefined,
	operation: string,
): void {
	if (capabilityRunId === undefined) return;
	if (capabilityRunId !== current.run_id)
		throw new KernelStoreSecurityError(
			`${operation} authority was issued for run ${capabilityRunId} but this worktree holds run ${current.run_id}`,
		);
}

function claimBytesFromRun(run: KernelRunRow): string {
	return serializeBackendClaim(claimFromRunRow(run));
}

/**
 * Enroll one run: the TaskRecord, the workspace owner and the derived claim
 * commit together, or nothing does. A replayed call with the same enrollment
 * event returns the committed result instead of writing again.
 */
export function commitEnrollmentLocked(
	root: string,
	taskId: string,
	transaction: WorkspaceTransactionV2,
	claim: Record<string, unknown>,
): { record: TaskRecord; workspace: WorkspaceState } {
	validateTaskId(taskId);
	if (transaction.task_id !== taskId)
		throw new KernelStoreSecurityError("enrollment transaction task identity is inconsistent");
	const parsedClaim = parseBackendClaim(claim);
	if (parsedClaim.task_id !== taskId)
		throw new KernelStoreSecurityError("enrollment claim task identity is inconsistent");
	if (parsedClaim.lifecycle_status !== "active")
		throw new KernelStoreSecurityError("enrollment claim must be active");
	const nextRecord = parseTaskRecord(
		JSON.parse(transaction.next_record_content) as Record<string, unknown>,
	);
	if (nextRecord.task_id !== taskId)
		throw new KernelStoreSecurityError("enrollment task record identity is inconsistent");
	const nextWorkspace = parseWorkspaceContent(transaction.next_workspace_content);
	if (nextWorkspace.current_working !== taskId)
		throw new KernelStoreSecurityError("enrollment must claim the workspace for its task");

	return withKernelTransaction(root, (db) => {
		assertNoRetiredFileStore(root, db, taskId);
		const runId = mintRunId();
		const operationId = enrollmentOperationId(taskId, parsedClaim.enrollment_event_id);
		const replay = readOperationRow(db, operationId);
		if (replay) return decodeOperationResult(replay.result_json);
		const existing = readRunRowByTask(db, taskId);
		if (existing)
			throw new KernelStoreConflictError(
				`task ${taskId} already has run ${existing.run_id} (${existing.state}); same-task re-enrollment is forbidden`,
			);
		const active = readRunRowById(db, activeRunId(db) ?? "");
		if (active)
			throw new KernelStoreConflictError(
				`workspace is already owned by ${active.task_id} (run ${active.run_id})`,
			);
		const workspaceRevision = assertWorkspaceExpectation(
			db,
			transaction.expected_workspace_hash,
			"workspace",
		);
		const run = insertRunRow(db, {
			run_id: runId,
			task_id: taskId,
			record_json: transaction.next_record_content,
			intent_revision: parsedClaim.intent_revision,
			intent_content_hash: parsedClaim.intent_content_hash,
			enrollment_event_id: parsedClaim.enrollment_event_id,
			claim_status: "active",
			created_at: parsedClaim.created_at,
			updated_at: parsedClaim.updated_at,
		});
		writeWorkspaceRow(db, workspaceRevision, run.run_id, parsedClaim.updated_at);
		insertOperationRow(db, {
			operation_id: operationId,
			kind: "enrollment",
			run_id: run.run_id,
			result_json: JSON.stringify({
				record_json: transaction.next_record_content,
				workspace_json: transaction.next_workspace_content,
			} satisfies CommittedOperationResult),
			committed_at: parsedClaim.updated_at,
		});
		return { record: nextRecord, workspace: nextWorkspace };
	});
}

/**
 * Commit the recoverable active -> draining claim transition under the store
 * transaction. The derived claim bytes are the CAS identity, so a divergent
 * claim fails closed before anything is written.
 */
export function commitDrainLocked(
	root: string,
	taskId: string,
	expectedClaimContent: string,
	nextClaimContent: string,
	at: string,
	capabilityRunId?: string,
): BackendClaim {
	validateTaskId(taskId);
	const expected = parseBackendClaim(JSON.parse(expectedClaimContent) as Record<string, unknown>);
	const next = parseBackendClaim(JSON.parse(nextClaimContent) as Record<string, unknown>);
	if (expected.task_id !== taskId || next.task_id !== taskId)
		throw new KernelStoreSecurityError("drain claim identity is inconsistent");
	if (expected.lifecycle_status !== "active" || next.lifecycle_status !== "draining")
		throw new KernelStoreSecurityError("drain transaction must transition active -> draining");
	return withKernelTransaction(root, (db) => {
		assertNoRetiredFileStore(root);
		const run = readRunRowByTask(db, taskId);
		if (!run)
			throw new KernelStoreConflictError(`task ${taskId} has no enrolled run in this worktree`);
		const operationId = drainOperationId(taskId, next.updated_at);
		const replay = readOperationRow(db, operationId);
		if (replay) {
			// A replay returns the committed claim, never the caller's request:
			// the same task and timestamp with different content is a conflicting
			// reuse of one operation identity, not a successful replay.
			const committed = parseBackendClaim(
				JSON.parse(replay.result_json) as Record<string, unknown>,
			);
			if (
				committed.task_id !== next.task_id ||
				committed.lifecycle_status !== next.lifecycle_status ||
				committed.intent_content_hash !== next.intent_content_hash ||
				committed.enrollment_event_id !== next.enrollment_event_id
			)
				throw new KernelStoreConflictError(
					`drain transaction ${operationId} was already committed with different facts`,
				);
			return committed;
		}
		const active = requireActiveRun(db, taskId);
		const identity = runIdentity(db, active);
		assertRunBinding(identity, { task_id: taskId, run_id: active.run_id }, "drain transaction");
		assertCapabilityRun(identity, capabilityRunId, "drain transaction");
		if (claimBytesFromRun(active) !== expectedClaimContent)
			throw new KernelStoreConflictError(
				`drain transaction claim bytes changed for ${taskId}`,
			);
		updateRunClaim(db, active.run_id, "active", "draining", at);
		insertOperationRow(db, {
			operation_id: operationId,
			kind: "drain",
			run_id: active.run_id,
			result_json: JSON.stringify(next),
			committed_at: at,
		});
		return next;
	});
}

/**
 * Commit terminal ownership transfer under the store transaction: the terminal
 * TaskRecord, the cleared workspace owner and the released claim commit
 * together. Audit evidence is exported afterwards; an interrupted export stays
 * retryable and never reactivates the run.
 */
export function commitTerminalLocked(
	root: string,
	taskId: string,
	transaction: WorkspaceTransactionV2,
	tombstone: TaskTombstone,
	capabilityRunId?: string,
): { record: TaskRecord; workspace: WorkspaceState } {
	validateTaskId(taskId);
	if (transaction.task_id !== taskId)
		throw new KernelStoreSecurityError("terminal transaction task identity is inconsistent");
	if (tombstone.task_id !== taskId)
		throw new KernelStoreSecurityError("terminal tombstone task identity is inconsistent");
	const nextWorkspaceState = parseWorkspaceContent(transaction.next_workspace_content);
	if (nextWorkspaceState.current_working !== null)
		throw new KernelStoreSecurityError("terminal settlement requires a cleared workspace owner");
	if (tombstone.final_record_hash !== revisionFor(transaction.next_record_content))
		throw new KernelStoreSecurityError(
			"terminal proof must match the terminal record bytes",
		);
	const terminalRecord = parseTaskRecord(
		JSON.parse(transaction.next_record_content) as Record<string, unknown>,
	);
	if (terminalRecord.task_id !== taskId)
		throw new KernelStoreSecurityError("terminal record identity is inconsistent");
	if (tombstone.terminal_lifecycle !== terminalRecord.lifecycle)
		throw new KernelStoreSecurityError(
			"terminal proof lifecycle contradicts the terminal TaskRecord",
		);
	const proofBytes = serializeTaskTombstone(tombstone);

	const committed = withKernelTransaction(root, (db) => {
		assertNoRetiredFileStore(root, db, taskId);
		const run = readRunRowByTask(db, taskId);
		if (!run)
			throw new KernelStoreConflictError(`task ${taskId} has no enrolled run in this worktree`);
		const operationId = terminalOperationId(taskId, tombstone.terminal_event_id);
		// A lost response replays the same event identity: the committed
		// settlement is reused before any state guard runs.
		const replay = readOperationRow(db, operationId);
		if (replay) return decodeOperationResult(replay.result_json);
		if (run.state !== "active")
			throw new KernelStoreConflictError(
				`terminal settlement refused: run ${run.run_id} is already ${run.state}`,
			);
		if (run.claim_status !== "active" && run.claim_status !== "draining")
			throw new KernelStoreSecurityError("terminal settlement claim must be active or draining");
		const identity = runIdentity(db, run);
		assertRunBinding(identity, { task_id: taskId, run_id: run.run_id }, "terminal settlement");
		assertCapabilityRun(identity, capabilityRunId, "terminal settlement");
		for (const relocation of transaction.artifact_relocations ?? [])
			assertArtifactRelocation(relocation);
		const workspaceRevision = assertWorkspaceExpectation(
			db,
			transaction.expected_workspace_hash,
			"workspace",
		);
		const lifecycle = terminalRecord.lifecycle === "done" ? "done" : "stopped";
		updateRunTerminal(
			db,
			run.run_id,
			lifecycle,
			transaction.next_record_content,
			proofBytes,
			tombstone.terminalized_at,
		);
		writeWorkspaceRow(db, workspaceRevision, null, tombstone.terminalized_at);
		if ((transaction.artifact_relocations ?? []).length > 0)
			setPendingRelocations(db, run.run_id, JSON.stringify(transaction.artifact_relocations));
		insertOperationRow(db, {
			operation_id: operationId,
			kind: "terminal",
			run_id: run.run_id,
			result_json: JSON.stringify({
				record_json: transaction.next_record_content,
				workspace_json: transaction.next_workspace_content,
			} satisfies CommittedOperationResult),
			committed_at: tombstone.terminalized_at,
		});
		return { record: terminalRecord, workspace: nextWorkspaceState };
	});

	// Settlement is committed. The relocation and the audit export are
	// deterministic follow-ups performed after this transaction by
	// `withKernelStoreLock` (or by the next locked operation); an interruption
	// stays retryable and can never reactivate the run.
	return committed;
}

// ---------------------------------------------------------------------------
// Authority projection (owner matrix) derived from the store.
// ---------------------------------------------------------------------------

export type KernelAuthorityState =
	| "unowned"
	| "active_owner"
	| "terminal_owner"
	| "repairable_stale_claim"
	| "authority_conflict";

export interface KernelAuthorityProjection {
	contract: "assurance_kernel/authority_projection/v1";
	requested_task_id: string;
	state: KernelAuthorityState;
	owner_task_id: string | null;
	owner_run_id: string | null;
	owner_lifecycle: TaskLifecycle | null;
	claim_lifecycle_status: BackendClaim["lifecycle_status"] | null;
	diagnostic: string | null;
	revision: string;
}

interface AuthorityFacts {
	workspace_revision: number;
	current_run_id: string | null;
	active_run_id: string | null;
	requested_run_state: TaskLifecycle | null;
	requested_run_id: string | null;
	terminal_proof_present: boolean;
}

function authorityFacts(
	db: DatabaseSync,
	root: string,
	taskId: string,
): AuthorityFacts {
	const workspace = readWorkspaceRow(db);
	const active = readRunRowById(db, activeRunId(db) ?? "");
	const requested = readRunRowByTask(db, taskId);
	return {
		workspace_revision: workspace.revision,
		current_run_id: workspace.current_run_id,
		active_run_id: active && active.state === "active" ? active.run_id : null,
		requested_run_state: requested ? requested.state : null,
		requested_run_id: requested ? requested.run_id : null,
		// Settlement commits the terminal proof with the run. The audit export is
		// evidence with its own retryable state, so it never gates the projection.
		terminal_proof_present: requested?.terminal_proof_json !== null && requested !== null,
	};
}

function projectKernelAuthorityLocked(
	db: DatabaseSync,
	root: string,
	taskId: string,
): KernelAuthorityProjection {
	const projection = (fields: {
		state: KernelAuthorityState;
		owner_task_id?: string | null;
		owner_run_id?: string | null;
		owner_lifecycle?: TaskLifecycle | null;
		claim_lifecycle_status?: BackendClaim["lifecycle_status"] | null;
		diagnostic?: string | null;
		revision: string;
	}): KernelAuthorityProjection => ({
		contract: "assurance_kernel/authority_projection/v1",
		requested_task_id: taskId,
		state: fields.state,
		owner_task_id: fields.owner_task_id ?? null,
		owner_run_id: fields.owner_run_id ?? null,
		owner_lifecycle: fields.owner_lifecycle ?? null,
		claim_lifecycle_status: fields.claim_lifecycle_status ?? null,
		diagnostic: fields.diagnostic ?? null,
		revision: fields.revision,
	});
	try {
		const facts = authorityFacts(db, root, taskId);
		const revision = revisionFor(JSON.stringify(facts));
		const active = facts.active_run_id ? readRunRowById(db, facts.active_run_id) : null;
		if (facts.current_run_id && !active)
			return projection({
				state: "authority_conflict",
				owner_task_id: facts.current_run_id,
				diagnostic: `workspace owner references run ${facts.current_run_id}, which is not active`,
				revision,
			});
		if (active) {
			if (facts.current_run_id !== active.run_id)
				return projection({
					state: "authority_conflict",
					owner_task_id: active.task_id,
					owner_run_id: active.run_id,
					diagnostic: "workspace owner contradicts the active run",
					revision,
				});
			if (active.claim_status === null)
				return projection({
					state: "authority_conflict",
					owner_task_id: active.task_id,
					owner_run_id: active.run_id,
					diagnostic: "active run carries no workspace claim",
					revision,
				});
			return projection({
				state: "active_owner",
				owner_task_id: active.task_id,
				owner_run_id: active.run_id,
				owner_lifecycle: "active",
				claim_lifecycle_status: active.claim_status,
				revision,
			});
		}
		if (facts.requested_run_state && facts.requested_run_state !== "active")
			return projection({
				state: "terminal_owner",
				owner_task_id: taskId,
				owner_run_id: facts.requested_run_id,
				owner_lifecycle: facts.requested_run_state,
				revision,
			});
		if (facts.requested_run_state)
			return projection({
				state: "authority_conflict",
				owner_task_id: taskId,
				owner_run_id: facts.requested_run_id,
				diagnostic: "nonterminal run exists without a workspace owner",
				revision,
			});
		return projection({ state: "unowned", revision });
	} catch (error) {
		return projection({
			state: "authority_conflict",
			diagnostic: error instanceof Error ? error.message : String(error),
			revision: "",
		});
	}
}

function conflictProjection(taskId: string, diagnostic: string): KernelAuthorityProjection {
	return {
		contract: "assurance_kernel/authority_projection/v1",
		requested_task_id: taskId,
		state: "authority_conflict",
		owner_task_id: null,
		owner_run_id: null,
		owner_lifecycle: null,
		claim_lifecycle_status: null,
		diagnostic,
		revision: "",
	};
}

export function reconcileKernelAuthority(
	root: string,
	taskId: string,
): KernelAuthorityProjection {
	validateTaskId(taskId);
	const projected = withKernelRead(root, (db) => {
		const conflict = retiredFileStoreConflict(root, db, taskId);
		if (conflict) return conflictProjection(taskId, conflict);
		return projectKernelAuthorityLocked(db, root, taskId);
	});
	if (projected) return projected;
	// A worktree without a store yet can still hold committed audit evidence
	// (fresh clone): terminal evidence alone classifies as terminal_owner.
	const legacy = retiredFileStoreDiagnostic(root, null, taskId);
	if (legacy) return conflictProjection(taskId, legacy);
	try {
		const audit = readAuditTaskPair(root, taskId);
		if (audit)
			return {
				contract: "assurance_kernel/authority_projection/v1",
				requested_task_id: taskId,
				state: "terminal_owner",
				owner_task_id: taskId,
				owner_run_id: null,
				owner_lifecycle: null,
				claim_lifecycle_status: null,
				diagnostic: null,
				revision: audit.recordRevision,
			};
	} catch (error) {
		return {
			contract: "assurance_kernel/authority_projection/v1",
			requested_task_id: taskId,
			state: "authority_conflict",
			owner_task_id: taskId,
			owner_run_id: null,
			owner_lifecycle: null,
			claim_lifecycle_status: null,
			diagnostic: error instanceof Error ? error.message : String(error),
			revision: "",
		};
	}
	return {
		contract: "assurance_kernel/authority_projection/v1",
		requested_task_id: taskId,
		state: "unowned",
		owner_task_id: null,
		owner_run_id: null,
		owner_lifecycle: null,
		claim_lifecycle_status: null,
		diagnostic: null,
		revision: "",
	};
}

function retiredFileStoreDiagnostic(
	root: string,
	db: DatabaseSync | null = null,
	taskId: string | null = null,
): string | null {
	return retiredFileStoreConflict(root, db, taskId);
}

/**
 * Remove one exactly proven stale terminal claim.
 *
 * The SQLite store derives ownership from the single active run, so a claim
 * that disagrees with the run index cannot exist: the state this operation
 * repaired is unreachable by construction. The entry point stays fail-closed
 * and is retained until the coordinated major release retires the tool.
 */
export function repairKernelAuthority(
	root: string,
	taskId: string,
	expectedProjectionRevision: string,
	_at = nowIso(),
): KernelAuthorityProjection {
	validateTaskId(taskId);
	return withKernelTransaction(root, (db) => {
		assertNoRetiredFileStore(root, db, taskId);
		retireSupersededRetiredFiles(root, db, taskId);
		const projection = projectKernelAuthorityLocked(db, root, taskId);
		if (projection.state === "repairable_stale_claim") {
			if (
				projection.owner_task_id !== taskId ||
				projection.revision !== expectedProjectionRevision
			)
				throw new KernelStoreConflictError(
					"authority repair requires exact stale terminal proof",
				);
			return projection;
		}
		// The workspace owner is derived from the single active run, so a claim
		// that contradicts the run index cannot exist. This task's own retired
		// claim file is a proved duplicate and was just retired; the committed
		// authority is the answer.
		if (projection.state === "terminal_owner" || projection.state === "unowned")
			return projection;
		throw new KernelStoreConflictError(
			`authority repair is not available while authority is ${projection.state}`,
		);
	});
}

export { stateDatabasePath };
