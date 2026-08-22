import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
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
import {
	parseBackendClaim,
	readBackendClaim,
	parseTaskTombstone,
	readTaskTombstone,
	type BackendClaim,
	type TaskTombstone,
} from "./backend_claim";
import { parseTaskRecordV2 } from "./validation";
import type {
	TaskPhase,
	TaskRecordV2,
	StoredTaskMutationV2,
	V3AuthorityObservation,
} from "./types";

export const MISSING_REVISION = "missing";

export class KernelStoreConflictError extends Error {
	readonly code = "kernel_store_conflict";

	constructor(message: string) {
		super(message);
		this.name = "KernelStoreConflictError";
	}
}

export class KernelStoreSecurityError extends Error {
	readonly code = "kernel_store_security_error";

	constructor(message: string) {
		super(message);
		this.name = "KernelStoreSecurityError";
	}
}

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
	| "readiness_query_nonqualifying";

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

function revisionFor(content: string): string {
	return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function canonicalRoot(root: string): string {
	try {
		return realpathSync(root);
	} catch {
		throw new KernelStoreSecurityError("project root is unavailable");
	}
}

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
		throw new KernelStoreSecurityError(
			"kernel store lock is not a regular file",
		);
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
	if (
		after.isSymbolicLink() ||
		after.dev !== before.dev ||
		after.ino !== before.ino
	)
		throw new KernelStoreSecurityError(
			"kernel store lock identity changed during recovery",
		);
	rmSync(lockPath);
	return true;
}

function withExclusiveLock<T>(lockPath: string, operation: () => T): T {
	const noFollow = constants.O_NOFOLLOW ?? 0;
	let fd: number | null = null;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			fd = openSync(
				lockPath,
				constants.O_WRONLY |
					constants.O_CREAT |
					constants.O_EXCL |
					noFollow,
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
			`${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`,
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
		const tempPath = `${candidate.path}.${randomUUID()}.tmp`;
		let fd: number | null = null;
		try {
			fd = openSync(
				tempPath,
				constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
				0o600,
			);
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

function validateTaskId(taskId: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(taskId))
		throw new KernelStoreSecurityError("task_id is not a safe file identity");
}

const STORE_LOCK_NAME = ".workspace.lock";
const JOURNAL_LOCK_NAME = ".journal.lock";
const JOURNAL_READ_LIMIT = 64 * 1024 * 1024;
const TRANSACTION_PATH = ".imm/tasks/.workspace-transaction.json";
// v4 storage retirement: the v1 transaction marker is a permanently retired
// contract. Any production store operation must fail closed when it is
// present; recovery of v1 markers is never performed by the v4 runtime.
const V1_TRANSACTION_RETIRED = "workspace_transaction/v1 is retired after v4 storage retirement; use TaskRecord v2 + workspace_transaction/v2";

let afterTaskTransactionWriteForTest: (() => void) | null = null;

/** Test-only seam for a failure after the first file in a two-file transaction. */
export function setAfterTaskTransactionWriteForTest(
	hook: (() => void) | null,
): void {
	afterTaskTransactionWriteForTest = hook;
}

function runAfterTaskTransactionWriteHook(): void {
	const hook = afterTaskTransactionWriteForTest;
	afterTaskTransactionWriteForTest = null;
	hook?.();
}

function parseWorkspaceContent(content: string): WorkspaceState {
	const raw = JSON.parse(content) as Record<string, unknown>;
	const unknown = Object.keys(raw).filter(
		(key) => !["contract", "current_working"].includes(key),
	);
	if (unknown.length > 0)
		throw new KernelStoreSecurityError(
			`workspace has unknown field: ${unknown[0]}`,
		);
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

export function readWorkspaceStateRaw(root: string): {
	revision: string;
	state: WorkspaceState;
} {
	const relativePath = ".imm/workspace.json";
	if (currentRevision(root, relativePath) === MISSING_REVISION)
		return {
			revision: MISSING_REVISION,
			state: {
				contract: "assurance_kernel/workspace/v1",
				current_working: null,
			},
		};
	const content = readSecureProjectFile(root, relativePath);
	return { revision: revisionFor(content), state: parseWorkspaceContent(content) };
}

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
	return atomicCasWrite(
		root,
		relativePath,
		nextContent,
		expectedRevision,
	);
}

function appendJournalLineLocked(root: string, entry: JournalEntry): void {
	const directory = ensureSecureDirectory(root, ".imm");
	const path = resolve(directory, "journal.jsonl");
	assertNoSymlinkSegments(canonicalRoot(root), path);
	const noFollow = constants.O_NOFOLLOW ?? 0;
	const fd = openSync(
		path,
		constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | noFollow,
		0o600,
	);
	try {
		writeFileSync(fd, `${JSON.stringify(entry)}\n`, "utf8");
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

function withJournalLock<T>(root: string, operation: () => T): T {
	const directory = ensureSecureDirectory(root, ".imm");
	return withExclusiveLock(resolve(directory, JOURNAL_LOCK_NAME), operation);
}

export function appendJournalEntry(root: string, entry: JournalEntry): void {
	withJournalLock(root, () => appendJournalLineLocked(root, entry));
}

export function appendObservationJournalEntry(
	root: string,
	entry: JournalEntry & { observation: V3AuthorityObservation },
): "appended" | "duplicate" {
	return withJournalLock(root, () => {
		let existing = "";
		try {
			existing = readSecureProjectFile(root, ".imm/journal.jsonl");
		} catch (error) {
			if (!(error instanceof Error) || !error.message.startsWith("source_missing:"))
				throw error;
		}
		if (Buffer.byteLength(existing, "utf8") > JOURNAL_READ_LIMIT)
			throw new KernelStoreSecurityError("kernel journal exceeds the observation read limit");
		for (const [index, line] of existing.split("\n").entries()) {
			if (!line.trim()) continue;
			let parsed: Record<string, unknown>;
			try {
				parsed = JSON.parse(line) as Record<string, unknown>;
			} catch {
				throw new KernelStoreSecurityError(
					`kernel journal line ${index + 1} is not valid JSON`,
				);
			}
			const observation = parsed.observation as
				| Record<string, unknown>
				| undefined;
			if (observation?.commit_id !== entry.observation.commit_id) continue;
			if (observation.observation_id === entry.observation.observation_id)
				return "duplicate";
			throw new KernelStoreConflictError(
				`observation commit identity conflict: ${entry.observation.commit_id}`,
			);
		}
		appendJournalLineLocked(root, entry);
		return "appended";
	});
}

// ---------------------------------------------------------------------------
// R2C2 dedicated TaskRecord v2 transaction path.
// Uses the existing exclusive store lock and rejects the retired v1 marker.
// ---------------------------------------------------------------------------

const TRANSACTION_PATH_V2 = ".imm/tasks/.workspace-transaction-v2.json";
const ENROLLMENT_MARKER_PATH = ".imm/tasks/.enrollment-marker.json";
const DRAIN_MARKER_PATH = ".imm/tasks/.drain-transaction.json";
const TERMINAL_MARKER_PATH = ".imm/tasks/.terminal-transaction.json";
const AUTHORITY_REPAIR_MARKER_PATH = ".imm/tasks/.authority-repair-transaction.json";

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

export function revisionForContent(content: string): string {
	return revisionFor(content);
}

function parseWorkspaceTransactionV2(raw: Record<string, unknown>): WorkspaceTransactionV2 {
	const allowed = [
		"contract",
		"task_id",
		"expected_record_hash",
		"next_record_content",
		"expected_workspace_hash",
		"next_workspace_content",
		"artifact_relocations",
	];
	const unknown = Object.keys(raw).filter((key) => !allowed.includes(key));
	if (unknown.length > 0)
		throw new KernelStoreSecurityError(
			`workspace transaction v2 has unknown field: ${unknown[0]}`,
		);
	if (raw.contract !== "assurance_kernel/workspace_transaction/v2")
		throw new KernelStoreSecurityError(
			"workspace transaction v2 contract is invalid",
		);
	for (const field of allowed.slice(1, 6)) {
		if (typeof raw[field] !== "string" || !String(raw[field]).trim())
			throw new KernelStoreSecurityError(
				`workspace transaction v2 ${field} is invalid`,
			);
	}
	const relocationRaw = raw.artifact_relocations;
	if (relocationRaw !== undefined && !Array.isArray(relocationRaw))
		throw new KernelStoreSecurityError("workspace transaction v2 artifact_relocations is invalid");
	const artifactRelocations = (relocationRaw ?? []).map((item, index) => {
		if (!item || typeof item !== "object" || Array.isArray(item))
			throw new KernelStoreSecurityError(`artifact relocation ${index} is invalid`);
		const value = item as Record<string, unknown>;
		const unknownFields = Object.keys(value).filter((key) => !["from_path", "to_path", "content_hash"].includes(key));
		if (unknownFields.length > 0)
			throw new KernelStoreSecurityError(`artifact relocation has unknown field: ${unknownFields[0]}`);
		for (const field of ["from_path", "to_path", "content_hash"])
			if (typeof value[field] !== "string" || !String(value[field]).trim())
				throw new KernelStoreSecurityError(`artifact relocation ${field} is invalid`);
		const relocation = value as unknown as ArtifactRelocationV1;
		assertArtifactRelocation(relocation);
		return relocation;
	});
	const transaction = {
		...(raw as unknown as WorkspaceTransactionV2),
		...(artifactRelocations.length > 0 ? { artifact_relocations: artifactRelocations } : {}),
	};
	validateTaskId(transaction.task_id);
	const record = parseTaskRecordV2(
		JSON.parse(transaction.next_record_content),
	);
	if (record.task_id !== transaction.task_id)
		throw new KernelStoreSecurityError(
			"workspace transaction v2 task identity is inconsistent",
		);
	parseWorkspaceContent(transaction.next_workspace_content);
	return transaction;
}

function readPendingTransactionV2(root: string): WorkspaceTransactionV2 | null {
	if (currentRevision(root, TRANSACTION_PATH_V2) === MISSING_REVISION) return null;
	const raw = JSON.parse(
		readSecureProjectFile(root, TRANSACTION_PATH_V2),
	) as Record<string, unknown>;
	return parseWorkspaceTransactionV2(raw);
}

function removeTransactionMarkerV2(root: string): void {
	const candidate = safeCandidate(root, TRANSACTION_PATH_V2);
	assertNoSymlinkSegments(candidate.root, candidate.path);
	const stat = pathStatOrNull(candidate.path);
	if (!stat) return;
	if (!stat.isFile())
		throw new KernelStoreSecurityError(
			"workspace transaction v2 marker is not a regular file",
		);
	rmSync(candidate.path);
	fsyncDirectory(dirname(candidate.path));
}

function archiveArtifactPath(path: string): string | null {
	const matched = path.match(/^docs\/(plans|specs)\/([^/]+)$/);
	return matched ? `docs/${matched[1]}/archive/${matched[2]}` : null;
}

function assertArtifactRelocation(relocation: ArtifactRelocationV1): void {
	if (!/^sha256:[a-f0-9]{64}$/.test(relocation.content_hash))
		throw new KernelStoreSecurityError("artifact relocation content_hash is invalid");
	if (
		archiveArtifactPath(relocation.from_path) !== relocation.to_path
		&& archiveArtifactPath(relocation.to_path) !== relocation.from_path
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

function completeTransactionV2Locked(
	root: string,
	transaction: WorkspaceTransactionV2,
	invokeTestHook: boolean,
): StoredTaskMutationV2 {
	for (const relocation of transaction.artifact_relocations ?? [])
		convergeArtifactRelocation(root, relocation);
	const taskPath = `.imm/tasks/${transaction.task_id}.json`;
	const taskRevision = convergeFile(
		root,
		taskPath,
		transaction.expected_record_hash,
		transaction.next_record_content,
	);
	if (invokeTestHook) runAfterTaskTransactionWriteHook();
	const workspaceRevision = convergeFile(
		root,
		".imm/workspace.json",
		transaction.expected_workspace_hash,
		transaction.next_workspace_content,
	);
	const record = parseTaskRecordV2(
		JSON.parse(transaction.next_record_content),
	);
	const workspace = parseWorkspaceContent(transaction.next_workspace_content);
	removeTransactionMarkerV2(root);
	return {
		revision: taskRevision,
		record,
		workspace: { revision: workspaceRevision, state: workspace },
	};
}

function recoverPendingTransactionV2Locked(root: string): void {
	const transaction = readPendingTransactionV2(root);
	if (transaction) completeTransactionV2Locked(root, transaction, false);
}

/**
 * v4-only recovery gate: if a retired v1 transaction marker exists, every
 * store recovery (including v2) fails closed with the stable diagnostic.
 * This guarantees no v4 operation can silently complete or discard a legacy
 * v1 transaction; the operator must resolve it with the prior runtime first.
 */
function assertNoRetiredV1Marker(root: string): void {
	if (currentRevision(root, TRANSACTION_PATH) !== MISSING_REVISION)
		throw new KernelStoreSecurityError(V1_TRANSACTION_RETIRED);
}

/** Reject any retired v1 marker before considering v2 recovery. */
function recoverAnyPendingTransactionLocked(root: string): void {
	const hasV1 = currentRevision(root, TRANSACTION_PATH) !== MISSING_REVISION;
	const hasV2 = currentRevision(root, TRANSACTION_PATH_V2) !== MISSING_REVISION;
	const hasEnrollment =
		currentRevision(root, ENROLLMENT_MARKER_PATH) !== MISSING_REVISION;
	const hasDrain = currentRevision(root, DRAIN_MARKER_PATH) !== MISSING_REVISION;
	const hasTerminal = currentRevision(root, TERMINAL_MARKER_PATH) !== MISSING_REVISION;
	const hasAuthorityRepair =
		currentRevision(root, AUTHORITY_REPAIR_MARKER_PATH) !== MISSING_REVISION;
	if (hasV1)
		throw new KernelStoreSecurityError(V1_TRANSACTION_RETIRED);
	const markers = [hasV2, hasEnrollment, hasDrain, hasTerminal, hasAuthorityRepair].filter(Boolean).length;
	if (markers > 1)
		throw new KernelStoreSecurityError(
			"simultaneous workspace transaction markers are forbidden",
		);
	if (hasV2) recoverPendingTransactionV2Locked(root);
	if (hasEnrollment) recoverPendingEnrollmentLocked(root);
	if (hasDrain) recoverPendingDrainLocked(root);
	if (hasTerminal) recoverPendingTerminalLocked(root);
	if (hasAuthorityRepair) recoverPendingAuthorityRepairLocked(root);
}

export function readTaskRecordV2Raw(
	root: string,
	taskId: string,
): { revision: string; record: TaskRecordV2 | null } {
	validateTaskId(taskId);
	const relativePath = `.imm/tasks/${taskId}.json`;
	if (currentRevision(root, relativePath) === MISSING_REVISION)
		return { revision: MISSING_REVISION, record: null };
	const content = readSecureProjectFile(root, relativePath);
	const record = parseTaskRecordV2(JSON.parse(content));
	if (record.task_id !== taskId)
		throw new KernelStoreSecurityError("task record v2 identity is inconsistent");
	return { revision: revisionFor(content), record };
}

export function readTaskRecordV2(
	root: string,
	taskId: string,
): { revision: string; record: TaskRecordV2 | null } {
	return withKernelStoreLockV2(root, () => readTaskRecordV2Raw(root, taskId));
}

/** Commit a v2 reducer result through the dedicated recoverable transaction. */
export function commitTaskRecordV2Locked(
	root: string,
	taskId: string,
	expectedRecordHash: string,
	nextRecord: TaskRecordV2,
	expectedWorkspaceHash: string,
	nextWorkspace: WorkspaceState,
	artifactRelocations: ArtifactRelocationV1[] = [],
): StoredTaskMutationV2 {
	const transaction: WorkspaceTransactionV2 = {
		contract: "assurance_kernel/workspace_transaction/v2",
		task_id: taskId,
		expected_record_hash: expectedRecordHash,
		next_record_content: `${JSON.stringify(nextRecord, null, 2)}\n`,
		expected_workspace_hash: expectedWorkspaceHash,
		next_workspace_content: serializeWorkspace(nextWorkspace),
		...(artifactRelocations.length > 0 ? { artifact_relocations: artifactRelocations } : {}),
	};
	atomicCasWrite(
		root,
		TRANSACTION_PATH_V2,
		`${JSON.stringify(transaction, null, 2)}\n`,
		MISSING_REVISION,
	);
	try {
		return completeTransactionV2Locked(root, transaction, true);
	} catch (error) {
		try {
			return completeTransactionV2Locked(root, transaction, false);
		} catch (recoveryError) {
			throw new KernelStoreConflictError(
				`kernel v2 transaction failed and remains recoverable: ${error instanceof Error ? error.message : error}; recovery: ${recoveryError instanceof Error ? recoveryError.message : recoveryError}`,
			);
		}
	}
}

export function withKernelStoreLockV2<T>(root: string, operation: () => T): T {
	const tasksDirectory = ensureSecureDirectory(root, ".imm/tasks");
	return withExclusiveLock(resolve(tasksDirectory, STORE_LOCK_NAME), () => {
		assertNoRetiredV1Marker(root);
		recoverAnyPendingTransactionLocked(root);
		return operation();
	});
}

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
	owner_phase: TaskPhase | null;
	claim_lifecycle_status: BackendClaim["lifecycle_status"] | null;
	diagnostic: string | null;
	revision: string;
}

/**
 * Recover durable Kernel transactions, then classify all ownership facts under
 * one lock. This is the shared fact boundary for host adapters; it never
 * invents terminality or removes a claim.
 */
function projectKernelAuthorityLocked(
	root: string,
	taskId: string,
): KernelAuthorityProjection {
	try {
			const claim = readBackendClaim(root);
			const ownerTaskId = claim?.task_id ?? null;
			const inspectedTaskId = ownerTaskId ?? taskId;
			const current = readTaskRecordV2Raw(root, inspectedTaskId);
			const tombstone = readTaskTombstone(root, inspectedTaskId);
			const workspace = readWorkspaceStateRaw(root).state;
			const record = current.record;
			const terminal = record?.phase === "done" || record?.phase === "stopped";
			const matchingTerminalProof = Boolean(
				record &&
				tombstone &&
				tombstone.task_id === inspectedTaskId &&
				tombstone.terminal_phase === record.phase &&
				tombstone.final_record_hash === current.revision &&
				workspace.current_working === null,
			);
			const matchingClaimIdentity = Boolean(
				claim &&
				record &&
				claim.task_id === record.task_id &&
				claim.intent_revision === record.intent_revision &&
				claim.intent_content_hash === record.intent_ref.content_hash,
			);
			const sameOwner = claim ? workspace.current_working === claim.task_id : workspace.current_working === null;
			const revision = revisionForContent(JSON.stringify({ claim, current, tombstone, workspace }));

			if (claim && !sameOwner && !matchingTerminalProof)
				return {
					contract: "assurance_kernel/authority_projection/v1",
					requested_task_id: taskId,
					state: "authority_conflict",
					owner_task_id: claim.task_id,
					owner_phase: record?.phase ?? null,
					claim_lifecycle_status: claim.lifecycle_status,
					diagnostic: `workspace owner ${workspace.current_working ?? "null"} contradicts claim ${claim.task_id}`,
					revision,
				};
			if (claim && !record)
				return {
					contract: "assurance_kernel/authority_projection/v1",
					requested_task_id: taskId,
					state: "authority_conflict",
					owner_task_id: claim.task_id,
					owner_phase: null,
					claim_lifecycle_status: claim.lifecycle_status,
					diagnostic: `claim ${claim.task_id} has no TaskRecord v2`,
					revision,
				};
			if (claim && tombstone && matchingTerminalProof && matchingClaimIdentity)
				return {
					contract: "assurance_kernel/authority_projection/v1",
					requested_task_id: taskId,
					state: "repairable_stale_claim",
					owner_task_id: claim.task_id,
					owner_phase: record?.phase ?? null,
					claim_lifecycle_status: claim.lifecycle_status,
					diagnostic: null,
					revision,
				};
			if (claim && tombstone)
				return {
					contract: "assurance_kernel/authority_projection/v1",
					requested_task_id: taskId,
					state: "authority_conflict",
					owner_task_id: claim.task_id,
					owner_phase: record?.phase ?? null,
					claim_lifecycle_status: claim.lifecycle_status,
					diagnostic: `claim ${claim.task_id} has contradictory terminal ownership evidence`,
					revision,
				};
			if (claim && terminal)
				return {
					contract: "assurance_kernel/authority_projection/v1",
					requested_task_id: taskId,
					state: "authority_conflict",
					owner_task_id: claim.task_id,
					owner_phase: record?.phase ?? null,
					claim_lifecycle_status: claim.lifecycle_status,
					diagnostic: `terminal task ${claim.task_id} has no matching tombstone proof`,
					revision,
				};
			if (claim)
				return {
					contract: "assurance_kernel/authority_projection/v1",
					requested_task_id: taskId,
					state: "active_owner",
					owner_task_id: claim.task_id,
					owner_phase: record?.phase ?? null,
					claim_lifecycle_status: claim.lifecycle_status,
					diagnostic: null,
					revision,
				};
			if (record && terminal && matchingTerminalProof)
				return {
					contract: "assurance_kernel/authority_projection/v1",
					requested_task_id: taskId,
					state: "terminal_owner",
					owner_task_id: inspectedTaskId,
					owner_phase: record.phase,
					claim_lifecycle_status: null,
					diagnostic: null,
					revision,
				};
			if (record || tombstone || workspace.current_working !== null)
				return {
					contract: "assurance_kernel/authority_projection/v1",
					requested_task_id: taskId,
					state: "authority_conflict",
					owner_task_id: workspace.current_working,
					owner_phase: record?.phase ?? null,
					claim_lifecycle_status: null,
					diagnostic: "nonterminal owner state exists without a backend claim",
					revision,
				};
			return {
				contract: "assurance_kernel/authority_projection/v1",
				requested_task_id: taskId,
				state: "unowned",
				owner_task_id: null,
				owner_phase: null,
				claim_lifecycle_status: null,
				diagnostic: null,
				revision,
			};
	} catch (error) {
		return {
			contract: "assurance_kernel/authority_projection/v1",
			requested_task_id: taskId,
			state: "authority_conflict",
			owner_task_id: null,
			owner_phase: null,
			claim_lifecycle_status: null,
			diagnostic: error instanceof Error ? error.message : String(error),
			revision: "",
		};
	}
}

export function reconcileKernelAuthority(
	root: string,
	taskId: string,
): KernelAuthorityProjection {
	validateTaskId(taskId);
	return withKernelStoreLockV2(root, () => projectKernelAuthorityLocked(root, taskId));
}

interface AuthorityRepairMarker {
	contract: "assurance_kernel/authority_repair_transaction/v1";
	task_id: string;
	expected_projection_revision: string;
	expected_claim_content: string;
	at: string;
}

function readPendingAuthorityRepairMarker(root: string): AuthorityRepairMarker | null {
	if (currentRevision(root, AUTHORITY_REPAIR_MARKER_PATH) === MISSING_REVISION) return null;
	const raw = JSON.parse(
		readSecureProjectFile(root, AUTHORITY_REPAIR_MARKER_PATH),
	) as Record<string, unknown>;
	const allowed = [
		"contract",
		"task_id",
		"expected_projection_revision",
		"expected_claim_content",
		"at",
	];
	const unknown = Object.keys(raw).filter((key) => !allowed.includes(key));
	if (unknown.length > 0)
		throw new KernelStoreSecurityError(
			`authority repair marker has unknown field: ${unknown[0]}`,
		);
	if (raw.contract !== "assurance_kernel/authority_repair_transaction/v1")
		throw new KernelStoreSecurityError("authority repair marker contract is invalid");
	for (const field of ["task_id", "expected_projection_revision", "expected_claim_content", "at"]) {
		if (typeof raw[field] !== "string" || !String(raw[field]).trim())
			throw new KernelStoreSecurityError(`authority repair marker ${field} is invalid`);
	}
	const marker = raw as unknown as AuthorityRepairMarker;
	validateTaskId(marker.task_id);
	const claim = parseBackendClaim(JSON.parse(marker.expected_claim_content));
	if (claim.task_id !== marker.task_id)
		throw new KernelStoreSecurityError("authority repair claim identity is inconsistent");
	return marker;
}

function removeAuthorityRepairMarker(root: string): void {
	const candidate = safeCandidate(root, AUTHORITY_REPAIR_MARKER_PATH);
	assertNoSymlinkSegments(candidate.root, candidate.path);
	const stat = pathStatOrNull(candidate.path);
	if (!stat) return;
	if (!stat.isFile())
		throw new KernelStoreSecurityError("authority repair marker is not a regular file");
	rmSync(candidate.path);
	fsyncDirectory(dirname(candidate.path));
}

function recoverPendingAuthorityRepairLocked(root: string): void {
	const marker = readPendingAuthorityRepairMarker(root);
	if (!marker) return;
	const projection = projectKernelAuthorityLocked(root, marker.task_id);
	const claimRevision = currentRevision(root, CLAIM_RELATIVE_PATH);
	if (claimRevision === MISSING_REVISION) {
		if (
			projection.state !== "terminal_owner" ||
			projection.owner_task_id !== marker.task_id
		)
			throw new KernelStoreConflictError(
				"authority repair committed claim removal but terminal proof changed",
			);
		removeAuthorityRepairMarker(root);
		return;
	}
	if (
		projection.state !== "repairable_stale_claim" ||
		projection.owner_task_id !== marker.task_id ||
		projection.revision !== marker.expected_projection_revision ||
		claimRevision !== revisionFor(marker.expected_claim_content)
	)
		throw new KernelStoreConflictError(
			"authority repair facts changed after confirmation",
		);
	const claimCandidate = safeCandidate(root, CLAIM_RELATIVE_PATH);
	assertNoSymlinkSegments(claimCandidate.root, claimCandidate.path);
	rmSync(claimCandidate.path);
	fsyncDirectory(dirname(claimCandidate.path));
	removeAuthorityRepairMarker(root);
}

/** Remove one exactly proven stale terminal claim through a replayable marker. */
export function repairKernelAuthority(
	root: string,
	taskId: string,
	expectedProjectionRevision: string,
	at = new Date().toISOString(),
): KernelAuthorityProjection {
	validateTaskId(taskId);
	return withKernelStoreLockV2(root, () => {
		const projection = projectKernelAuthorityLocked(root, taskId);
		if (
			projection.state !== "repairable_stale_claim" ||
			projection.owner_task_id !== taskId ||
			projection.revision !== expectedProjectionRevision
		)
			throw new KernelStoreConflictError("authority repair requires exact stale terminal proof");
		const marker: AuthorityRepairMarker = {
			contract: "assurance_kernel/authority_repair_transaction/v1",
			task_id: taskId,
			expected_projection_revision: expectedProjectionRevision,
			expected_claim_content: readSecureProjectFile(root, CLAIM_RELATIVE_PATH),
			at,
		};
		atomicCasWrite(
			root,
			AUTHORITY_REPAIR_MARKER_PATH,
			`${JSON.stringify(marker, null, 2)}\n`,
			MISSING_REVISION,
		);
		try {
			recoverPendingAuthorityRepairLocked(root);
		} catch (error) {
			throw new KernelStoreConflictError(
				`authority repair failed and remains recoverable: ${error instanceof Error ? error.message : error}`,
			);
		}
		return projectKernelAuthorityLocked(root, taskId);
	});
}

// P2B0 enrollment marker. The enrollment transaction embeds the v2
// task/workspace transaction plus the backend claim; recovery completes the
// v2 convergence then re-writes the claim if it was not yet durable.
// ---------------------------------------------------------------------------

interface EnrollmentMarker {
	contract: "assurance_kernel/enrollment_transaction/v1";
	task_id: string;
	transaction: WorkspaceTransactionV2;
	claim: Record<string, unknown>;
}

function readPendingEnrollmentMarker(root: string): EnrollmentMarker | null {
	if (currentRevision(root, ENROLLMENT_MARKER_PATH) === MISSING_REVISION) return null;
	const raw = JSON.parse(
		readSecureProjectFile(root, ENROLLMENT_MARKER_PATH),
	) as Record<string, unknown>;
	const allowed = ["contract", "task_id", "transaction", "claim"];
	const unknown = Object.keys(raw).filter((key) => !allowed.includes(key));
	if (unknown.length > 0)
		throw new KernelStoreSecurityError(
			`enrollment marker has unknown field: ${unknown[0]}`,
		);
	if (raw.contract !== "assurance_kernel/enrollment_transaction/v1")
		throw new KernelStoreSecurityError(
			"enrollment marker contract is invalid",
		);
	if (typeof raw.task_id !== "string" || !raw.task_id.trim())
		throw new KernelStoreSecurityError(
			"enrollment marker task_id is invalid",
		);
	const transaction = parseWorkspaceTransactionV2(
		raw.transaction as Record<string, unknown>,
	);
	if (transaction.task_id !== raw.task_id)
		throw new KernelStoreSecurityError(
			"enrollment marker task identity is inconsistent",
		);
	return {
		contract: "assurance_kernel/enrollment_transaction/v1",
		task_id: raw.task_id,
		transaction,
		claim: raw.claim as Record<string, unknown>,
	};
}

function removeEnrollmentMarker(root: string): void {
	const candidate = safeCandidate(root, ENROLLMENT_MARKER_PATH);
	assertNoSymlinkSegments(candidate.root, candidate.path);
	const stat = pathStatOrNull(candidate.path);
	if (!stat) return;
	if (!stat.isFile())
		throw new KernelStoreSecurityError(
			"enrollment marker is not a regular file",
		);
	rmSync(candidate.path);
	fsyncDirectory(dirname(candidate.path));
}

/** Recover a pending enrollment marker: complete the embedded v2 transaction, then re-write the claim. */
function recoverPendingEnrollmentLocked(root: string): void {
	const marker = readPendingEnrollmentMarker(root);
	if (!marker) return;
	const transaction = marker.transaction;
	const taskPath = `.imm/tasks/${transaction.task_id}.json`;
	convergeFile(
		root,
		taskPath,
		transaction.expected_record_hash,
		transaction.next_record_content,
	);
	convergeFile(
		root,
		".imm/workspace.json",
		transaction.expected_workspace_hash,
		transaction.next_workspace_content,
	);
	// re-write the backend claim (last step of the enrollment transaction)
	atomicCasWrite(
		root,
		".imm/tasks/.backend-claim.json",
		`${JSON.stringify(marker.claim, null, 2)}\n`,
		MISSING_REVISION,
	);
	removeEnrollmentMarker(root);
}

/**
 * Write an enrollment marker (embedded v2 transaction + claim) and complete it
 * atomically under the store lock. Exported for the enrollment core.
 */
export function commitEnrollmentLocked(
	root: string,
	taskId: string,
	transaction: WorkspaceTransactionV2,
	claim: Record<string, unknown>,
): { record: TaskRecordV2; workspace: WorkspaceState } {
	const marker: EnrollmentMarker = {
		contract: "assurance_kernel/enrollment_transaction/v1",
		task_id: taskId,
		transaction,
		claim,
	};
	atomicCasWrite(
		root,
		ENROLLMENT_MARKER_PATH,
		`${JSON.stringify(marker, null, 2)}\n`,
		MISSING_REVISION,
	);
	try {
		recoverPendingEnrollmentLocked(root);
	} catch (error) {
		throw new KernelStoreConflictError(
			`enrollment transaction failed and remains recoverable: ${error instanceof Error ? error.message : error}`,
		);
	}
	return {
		record: parseTaskRecordV2(JSON.parse(transaction.next_record_content)),
		workspace: parseWorkspaceContent(transaction.next_workspace_content),
	};
}

// ---------------------------------------------------------------------------
// P2B2 drain and terminal ownership transactions. The workspace backend claim
// has exactly one write path: these recoverable markers owned by this module.
// `backend_claim.ts` exports no writer; enrollment uses the marker above.
// ---------------------------------------------------------------------------

interface DrainMarker {
	contract: "assurance_kernel/drain_transaction/v1";
	task_id: string;
	expected_claim_content: string;
	next_claim_content: string;
	at: string;
}

interface TerminalMarker {
	contract: "assurance_kernel/terminal_transaction/v1";
	task_id: string;
	transaction: WorkspaceTransactionV2;
	tombstone: Record<string, unknown>;
}

const CLAIM_RELATIVE_PATH = ".imm/tasks/.backend-claim.json";

function parseDrainMarker(raw: Record<string, unknown>): DrainMarker {
	const allowed = [
		"contract",
		"task_id",
		"expected_claim_content",
		"next_claim_content",
		"at",
	];
	const unknown = Object.keys(raw).filter((key) => !allowed.includes(key));
	if (unknown.length > 0)
		throw new KernelStoreSecurityError(
			`drain marker has unknown field: ${unknown[0]}`,
		);
	if (raw.contract !== "assurance_kernel/drain_transaction/v1")
		throw new KernelStoreSecurityError("drain marker contract is invalid");
	if (typeof raw.task_id !== "string" || !raw.task_id.trim())
		throw new KernelStoreSecurityError("drain marker task_id is invalid");
	for (const field of ["expected_claim_content", "next_claim_content", "at"]) {
		if (typeof raw[field] !== "string" || !String(raw[field]).trim())
			throw new KernelStoreSecurityError(`drain marker ${field} is invalid`);
	}
	const marker = raw as unknown as DrainMarker;
	validateTaskId(marker.task_id);
	const expected = parseBackendClaim(JSON.parse(marker.expected_claim_content));
	const next = parseBackendClaim(JSON.parse(marker.next_claim_content));
	if (expected.task_id !== marker.task_id || next.task_id !== marker.task_id)
		throw new KernelStoreSecurityError("drain marker claim identity is inconsistent");
	if (expected.lifecycle_status !== "active" || next.lifecycle_status !== "draining")
		throw new KernelStoreSecurityError(
			"drain marker must transition active -> draining",
		);
	return marker;
}

function readPendingDrainMarker(root: string): DrainMarker | null {
	if (currentRevision(root, DRAIN_MARKER_PATH) === MISSING_REVISION) return null;
	const raw = JSON.parse(
		readSecureProjectFile(root, DRAIN_MARKER_PATH),
	) as Record<string, unknown>;
	return parseDrainMarker(raw);
}

function removeDrainMarker(root: string): void {
	const candidate = safeCandidate(root, DRAIN_MARKER_PATH);
	assertNoSymlinkSegments(candidate.root, candidate.path);
	const stat = pathStatOrNull(candidate.path);
	if (!stat) return;
	if (!stat.isFile())
		throw new KernelStoreSecurityError(
			"drain marker is not a regular file",
		);
	rmSync(candidate.path);
	fsyncDirectory(dirname(candidate.path));
}

/**
 * Converge the workspace claim to draining. Exact committed replay (claim
 * already equals next content) is idempotent; a conflicting claim fails
 * closed and leaves the marker recoverable.
 */
function recoverPendingDrainLocked(root: string): void {
	const marker = readPendingDrainMarker(root);
	if (!marker) return;
	convergeFile(
		root,
		CLAIM_RELATIVE_PATH,
		revisionFor(marker.expected_claim_content),
		marker.next_claim_content,
	);
	removeDrainMarker(root);
}

/**
 * Commit the recoverable active -> draining claim transition under the store
 * lock. Returns the committed draining claim. Caller must already hold the
 * lock, have validated task/record/workspace ownership, and have consumed the
 * user capability exactly once before the marker write.
 */
export function commitDrainLocked(
	root: string,
	taskId: string,
	expectedClaimContent: string,
	nextClaimContent: string,
	at: string,
): BackendClaim {
	validateTaskId(taskId);
	const expected = parseBackendClaim(JSON.parse(expectedClaimContent));
	const next = parseBackendClaim(JSON.parse(nextClaimContent));
	if (expected.task_id !== taskId || next.task_id !== taskId)
		throw new KernelStoreSecurityError("drain claim identity is inconsistent");
	if (expected.lifecycle_status !== "active" || next.lifecycle_status !== "draining")
		throw new KernelStoreSecurityError(
			"drain transaction must transition active -> draining",
		);
	const marker: DrainMarker = {
		contract: "assurance_kernel/drain_transaction/v1",
		task_id: taskId,
		expected_claim_content: expectedClaimContent,
		next_claim_content: nextClaimContent,
		at,
	};
	atomicCasWrite(
		root,
		DRAIN_MARKER_PATH,
		`${JSON.stringify(marker, null, 2)}\n`,
		MISSING_REVISION,
	);
	try {
		recoverPendingDrainLocked(root);
	} catch (error) {
		throw new KernelStoreConflictError(
			`drain transaction failed and remains recoverable: ${error instanceof Error ? error.message : error}`,
		);
	}
	return next;
}

function tombstoneRelativePath(taskId: string): string {
	return `.imm/tasks/${taskId}.backend-claim.json`;
}

function parseTerminalMarker(raw: Record<string, unknown>): TerminalMarker {
	const allowed = ["contract", "task_id", "transaction", "tombstone"];
	const unknown = Object.keys(raw).filter((key) => !allowed.includes(key));
	if (unknown.length > 0)
		throw new KernelStoreSecurityError(
			`terminal marker has unknown field: ${unknown[0]}`,
		);
	if (raw.contract !== "assurance_kernel/terminal_transaction/v1")
		throw new KernelStoreSecurityError("terminal marker contract is invalid");
	if (typeof raw.task_id !== "string" || !raw.task_id.trim())
		throw new KernelStoreSecurityError("terminal marker task_id is invalid");
	const transaction = parseWorkspaceTransactionV2(
		transactionRawOf(raw),
	);
	if (transaction.task_id !== raw.task_id)
		throw new KernelStoreSecurityError(
			"terminal marker task identity is inconsistent",
		);
	const tombstone = parseTaskTombstone(raw.tombstone as Record<string, unknown>);
	if (tombstone.task_id !== raw.task_id)
		throw new KernelStoreSecurityError(
			"terminal marker tombstone identity is inconsistent",
		);
	return {
		contract: "assurance_kernel/terminal_transaction/v1",
		task_id: raw.task_id,
		transaction,
		tombstone: raw.tombstone as Record<string, unknown>,
	};
}

function transactionRawOf(
	raw: Record<string, unknown>,
): Record<string, unknown> {
	const transaction = raw.transaction;
	if (!transaction || typeof transaction !== "object" || Array.isArray(transaction))
		throw new KernelStoreSecurityError(
			"terminal marker transaction is invalid",
		);
	return transaction as Record<string, unknown>;
}

function readPendingTerminalMarker(root: string): TerminalMarker | null {
	if (currentRevision(root, TERMINAL_MARKER_PATH) === MISSING_REVISION) return null;
	const raw = JSON.parse(
		readSecureProjectFile(root, TERMINAL_MARKER_PATH),
	) as Record<string, unknown>;
	return parseTerminalMarker(raw);
}

function removeTerminalMarker(root: string): void {
	const candidate = safeCandidate(root, TERMINAL_MARKER_PATH);
	assertNoSymlinkSegments(candidate.root, candidate.path);
	const stat = pathStatOrNull(candidate.path);
	if (!stat) return;
	if (!stat.isFile())
		throw new KernelStoreSecurityError(
			"terminal marker is not a regular file",
		);
	rmSync(candidate.path);
	fsyncDirectory(dirname(candidate.path));
}

/**
 * Converge terminal state: TaskRecord, workspace owner, active-claim removal,
 * and task tombstone creation. Each step is idempotent on its committed
 * result and fails closed on contradictory partial bytes.
 */
function recoverPendingTerminalLocked(root: string): void {
	const marker = readPendingTerminalMarker(root);
	if (!marker) return;
	const transaction = marker.transaction;
	for (const relocation of transaction.artifact_relocations ?? [])
		convergeArtifactRelocation(root, relocation);
	const taskPath = `.imm/tasks/${transaction.task_id}.json`;
	convergeFile(
		root,
		taskPath,
		transaction.expected_record_hash,
		transaction.next_record_content,
	);
	convergeFile(
		root,
		".imm/workspace.json",
		transaction.expected_workspace_hash,
		transaction.next_workspace_content,
	);
	// Active-claim removal: absence is the committed outcome; presence is removed.
	const claimCandidate = safeCandidate(root, CLAIM_RELATIVE_PATH);
	assertNoSymlinkSegments(claimCandidate.root, claimCandidate.path);
	const claimStat = pathStatOrNull(claimCandidate.path);
	if (claimStat) {
		if (!claimStat.isFile())
			throw new KernelStoreSecurityError(
				"backend claim is not a regular file",
			);
		rmSync(claimCandidate.path);
		fsyncDirectory(dirname(claimCandidate.path));
	}
	// Task tombstone: created from MISSING; an identical committed tombstone is idempotent.
	const tombstoneContent = `${JSON.stringify(marker.tombstone, null, 2)}\n`;
	convergeFile(
		root,
		tombstoneRelativePath(transaction.task_id),
		MISSING_REVISION,
		tombstoneContent,
	);
	removeTerminalMarker(root);
}

/**
 * Commit the recoverable terminal ownership transfer under the store lock:
 * terminal TaskRecord, cleared workspace owner, removed active claim, created
 * task tombstone. Caller must already hold the lock and have validated the
 * exact before/after identities.
 */
export function commitTerminalLocked(
	root: string,
	taskId: string,
	transaction: WorkspaceTransactionV2,
	tombstone: TaskTombstone,
): { record: TaskRecordV2; workspace: WorkspaceState } {
	validateTaskId(taskId);
	if (transaction.task_id !== taskId)
		throw new KernelStoreSecurityError(
			"terminal transaction task identity is inconsistent",
		);
	if (tombstone.task_id !== taskId)
		throw new KernelStoreSecurityError(
			"terminal tombstone task identity is inconsistent",
		);
	const marker: TerminalMarker = {
		contract: "assurance_kernel/terminal_transaction/v1",
		task_id: taskId,
		transaction,
		tombstone: tombstone as unknown as Record<string, unknown>,
	};
	atomicCasWrite(
		root,
		TERMINAL_MARKER_PATH,
		`${JSON.stringify(marker, null, 2)}\n`,
		MISSING_REVISION,
	);
	try {
		recoverPendingTerminalLocked(root);
	} catch (error) {
		throw new KernelStoreConflictError(
			`terminal transaction failed and remains recoverable: ${error instanceof Error ? error.message : error}`,
		);
	}
	return {
		record: parseTaskRecordV2(JSON.parse(transaction.next_record_content)),
		workspace: parseWorkspaceContent(transaction.next_workspace_content),
	};
}
