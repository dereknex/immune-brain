/**
 * Permanent storage path vocabulary and read-only layout inspection
 * (storage-layout cutover).
 *
 * This module is a leaf: it imports no other Kernel module so storage.ts and
 * backend_claim.ts can depend on it without a cycle. `.imm/state/` is the sole
 * ignored mutable authority store; `.imm/audit/` is the sole tracked terminal
 * evidence store. Old-layout paths are enumerated here ONLY so the layout
 * inspection and the one-release migrator can recognize them; no normal
 * runtime code reads old mutable authority through these constants.
 *
 * `inspectStorageLayout` is read-only and returns exactly one of:
 * ready | migration_required | migration_blocked_active |
 * migration_uncommitted | recovery_required | invalid.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	constants as FS_CONSTANTS,
	lstatSync,
	openSync,
	readFileSync,
	realpathSync,
	readdirSync,
	closeSync,
	fstatSync,
} from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

// ---------------------------------------------------------------------------
// New permanent layout paths
// ---------------------------------------------------------------------------

export const STATE_RELATIVE = ".imm/state";
export const AUDIT_RELATIVE = ".imm/audit";
export const LEGACY_V3_RELATIVE = ".imm/audit/legacy-v3";
export const JOURNAL_RELATIVE = ".imm/state/journal.jsonl";
export const MIGRATION_MARKER_RELATIVE =
	".imm/state/transactions/storage-layout-migration.json";

/** The single worktree authority database (never committed; `.imm/state` is ignored). */
export const KERNEL_DB_RELATIVE = ".imm/state/kernel.sqlite";
export const KERNEL_STORE_SCHEMA_VERSION = 1;
export const KERNEL_DB_SIDECARS = [
	".imm/state/kernel.sqlite-wal",
	".imm/state/kernel.sqlite-shm",
] as const;

/**
 * The retired file-store authority layout (`.imm/state/*.json`) written by the
 * previous runtime. Recognized only so inspection can require the SQLite
 * importer; no current runtime reads or writes mutable authority here.
 */
export const FILE_STORE_CLAIM_RELATIVE = ".imm/state/active-claim.json";
export const FILE_STORE_WORKSPACE_RELATIVE = ".imm/state/workspace.json";
export const FILE_STORE_TASKS_RELATIVE = ".imm/state/tasks";
export const FILE_STORE_TRANSACTIONS_RELATIVE = ".imm/state/transactions";
export const FILE_STORE_LOCKS_RELATIVE = ".imm/state/locks";
/** Session observation receipts: inert output, never authority. */
export const FILE_STORE_OBSERVATIONS_RELATIVE = ".imm/state/observations";
/**
 * Unattended batch run state (`.imm/state/batches/<batch_id>.json`). It is
 * written by the batch runner, not by the retired file-store writer, so the
 * layout inspector must recognize it instead of failing the worktree closed.
 */
export const BATCH_STATE_RELATIVE = ".imm/state/batches";

/** Inert file-store entries that carry no authority after the cutover. */
export const FILE_STORE_INERT_FILES = [
	".imm/state/journal.jsonl",
	".imm/state/locks/kernel-store.lock",
] as const;

/** A file-store migration manifest left by the retired migrator. */
export const FILE_STORE_MIGRATION_MARKER = MIGRATION_MARKER_RELATIVE;

/* Transaction marker file names under `.imm/state/transactions/`. */
export const KERNEL_TRANSACTION_MARKERS = [
	"workspace-transaction-v2.json",
	"enrollment-marker.json",
	"drain-transaction.json",
	"terminal-transaction.json",
	"authority-repair-transaction.json",
] as const;

export function stateDatabasePath(): string {
	return KERNEL_DB_RELATIVE;
}

/**
 * Worktree binding digest: a store is bound to the canonical worktree path it
 * was created in, so a database copied from another worktree is refused
 * instead of granting authority.
 */
export function kernelStoreBindingDigest(canonicalRoot: string, workspaceId: string): string {
	return createHash("sha256").update(`${canonicalRoot}\0${workspaceId}`).digest("hex");
}

function validateTaskId(taskId: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(taskId))
		throw new Error(
			`task id must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}: ${taskId}`,
		);
}

export function stateTaskRecordPath(taskId: string): string {
	validateTaskId(taskId);
	return `${STATE_RELATIVE}/tasks/${taskId}.json`;
}

export function stateWorkspacePath(): string {
	return `${STATE_RELATIVE}/workspace.json`;
}

export function stateClaimPath(): string {
	return `${STATE_RELATIVE}/active-claim.json`;
}

export function stateStoreLockPath(): string {
	return `${STATE_RELATIVE}/locks/kernel-store.lock`;
}

export function stateTransactionPath(name: string): string {
	if (!/^[A-Za-z0-9._-]+\.json$/.test(name))
		throw new Error(`invalid transaction marker name: ${name}`);
	return `${STATE_RELATIVE}/transactions/${name}`;
}

export function auditTaskDirPath(taskId: string): string {
	validateTaskId(taskId);
	return `${AUDIT_RELATIVE}/${taskId}`;
}

export function auditTaskRecordPath(taskId: string): string {
	return `${auditTaskDirPath(taskId)}/task-record.json`;
}

export function auditTerminalProofPath(taskId: string): string {
	return `${auditTaskDirPath(taskId)}/terminal-proof.json`;
}

/** Historical v3 machine evidence root under the tracked audit store. */
export function legacyV3Path(...segments: string[]): string {
	for (const segment of segments)
		if (!segment || segment.includes("/") || segment.includes("\\"))
			throw new Error(`invalid legacy-v3 segment: ${segment}`);
	return [LEGACY_V3_RELATIVE, ...segments].join("/");
}

// ---------------------------------------------------------------------------
// Old layout recognition (inspection and one-release migrator only)
// ---------------------------------------------------------------------------

export const LEGACY_CLAIM_RELATIVE = ".imm/tasks/.backend-claim.json";
export const LEGACY_WORKSPACE_RELATIVE = ".imm/workspace.json";
export const LEGACY_TASKS_RELATIVE = ".imm/tasks";
export const LEGACY_MEMORY_RELATIVE = ".imm/memory";
export const LEGACY_TEMPLATES_RELATIVE = ".imm/templates";
export const LEGACY_JOURNAL_RELATIVE = ".imm/journal.jsonl";
export const LEGACY_AUTHORITY_RELATIVE = ".imm/authority";

export const LEGACY_KNOWN_FILES = {
	".imm/tasks/.workspace.lock": "lock",
	".imm/tasks/.journal.lock": "lock",
	".imm/tasks/.workspace-transaction.json": "old-marker",
	".imm/tasks/.workspace-transaction-v2.json": "old-marker",
	".imm/tasks/.enrollment-marker.json": "old-marker",
	".imm/tasks/.drain-transaction.json": "old-marker",
	".imm/tasks/.terminal-transaction.json": "old-marker",
	".imm/tasks/.authority-repair-transaction.json": "old-marker",
	".imm/tasks/.backend-claim.json": "claim",
	".imm/memory/current_iteration.json": "memory",
	".imm/memory/current_iteration_history.jsonl": "memory",
	".imm/memory/dispatch_telemetry.jsonl": "memory",
	".imm/memory/.current_iteration.authority_commit_receipts.jsonl": "memory",
	".imm/memory/.current_iteration.automatic_observations.jsonl": "memory",
	".imm/memory/.current_iteration.automatic_observations.lock": "memory",
	".imm/memory/MEMORY.md": "retired",
	".imm/templates/iteration-plan-template.md": "retired",
	".imm/templates/review-report-template.md": "retired",
} as const;

/** Old task-scoped owner files: `<task-id>.json` and `<task-id>.backend-claim.json`. */
const TASK_OWNER_FILE = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127})\.(json|backend-claim\.json)$/;

// ---------------------------------------------------------------------------
// Layout inspection
// ---------------------------------------------------------------------------

export type StorageLayoutStatus =
	| "ready"
	| "migration_required"
	| "migration_blocked_active"
	| "migration_uncommitted"
	| "recovery_required"
	| "invalid";

export interface StorageLayoutInspection {
	contract: "assurance_kernel/storage_layout_inspection/v1";
	layout: StorageLayoutStatus;
	old_authority_present: boolean;
	pending_marker: string | null;
	dirty_affected_paths: string[];
	reason: string | null;
}

type EntryStatus = "absent" | "file" | "directory" | "symlink" | "other";

function entryStatus(root: string, relativePath: string): EntryStatus {
	const candidate = resolve(root, relativePath);
	let stat;
	try {
		stat = lstatSync(candidate);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return "absent";
		return "other";
	}
	if (stat.isSymbolicLink()) return "symlink";
	if (stat.isFile()) return "file";
	if (stat.isDirectory()) return "directory";
	return "other";
}

function listEntries(root: string, relativePath: string): string[] | null {
	const candidate = resolve(root, relativePath);
	try {
		return readdirSync(candidate).sort();
	} catch {
		return null;
	}
}

function readSmallFile(root: string, relativePath: string): string | null {
	const candidate = resolve(root, relativePath);
	try {
		const fd = openSync(candidate, FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0));
		try {
			const stat = fstatSync(fd);
			if (stat.size > 4 * 1024 * 1024) throw new Error("file exceeds the inspection read bound");
			return readFileSync(fd, "utf8");
		} finally {
			closeSync(fd);
		}
	} catch {
		return null;
	}
}

interface OldLayoutFacts {
	old_authority_present: boolean;
	blocked_active: boolean;
	pending_marker: string | null;
	fail_reason: string | null;
}

function readJsonField(root: string, path: string, field: string): unknown {
	const content = readSmallFile(root, path);
	if (content === null) throw new Error(`${path} is unreadable`);
	try {
		return (JSON.parse(content) as Record<string, unknown>)[field];
	} catch {
		throw new Error(`${path} is not valid JSON`);
	}
}

/** Inspect every known old path and the .imm/tasks owner file set. */
function inspectOldLayout(root: string): OldLayoutFacts {
	const facts: OldLayoutFacts = {
		old_authority_present: false,
		blocked_active: false,
		pending_marker: null,
		fail_reason: null,
	};
	try {
		// 1. Known old files, one by one. Locks are inert; markers, the claim,
		//    non-idle memory, and active records carry authority signals.
		for (const [path, kind] of Object.entries(LEGACY_KNOWN_FILES)) {
			const status = entryStatus(root, path);
			if (status === "absent") continue;
			if (status === "symlink" || status === "other")
				throw new Error(`${path} is ${status}`);
			if (status !== "file") throw new Error(`${path} is not a regular file`);
			facts.old_authority_present = true;
			if (kind === "lock") continue;
			if (kind === "old-marker") {
				// review-1: legacy Kernel transaction markers require the
				// prior runtime to settle/recover; they never auto-recover
				// through the new runtime or the migrator. They block
				// migration (migration_blocked_active) and never set
				// pending_marker, which is reserved for new-layout markers
				// the new runtime CAN recover.
				facts.blocked_active = true;
				continue;
			}
			if (kind === "claim") {
				facts.blocked_active = true;
				continue;
			}
			if (kind === "memory" && path === ".imm/memory/current_iteration.json") {
				const runtimeStatus = readJsonField(root, path, "runtime_status");
				if (typeof runtimeStatus === "string" && runtimeStatus !== "idle")
					facts.blocked_active = true;
			}
		}

		// 2. .imm/tasks directory: reject unknown files; active records block.
		const tasksStatus = entryStatus(root, LEGACY_TASKS_RELATIVE);
		if (tasksStatus === "symlink" || tasksStatus === "other")
			throw new Error(`${LEGACY_TASKS_RELATIVE} is ${tasksStatus}`);
		if (tasksStatus === "directory") {
			facts.old_authority_present = true;
			const entries = listEntries(root, LEGACY_TASKS_RELATIVE) ?? [];
			for (const entry of entries) {
				const full = `.imm/tasks/${entry}`;
				if (full in LEGACY_KNOWN_FILES) continue;
				const matched = TASK_OWNER_FILE.exec(entry);
				if (!matched)
					throw new Error(`unknown file under .imm/tasks: ${entry}`);
				if (entry.endsWith(".backend-claim.json")) continue; // tombstone
				const lifecycle = readJsonField(root, `.imm/tasks/${entry}`, "lifecycle")
					?? readJsonField(root, `.imm/tasks/${entry}`, "phase");
				if (lifecycle !== "done" && lifecycle !== "stopped")
					facts.blocked_active = true;
			}
		}

		// 3. Workspace owner is the third active-owner signal.
		if (entryStatus(root, LEGACY_WORKSPACE_RELATIVE) !== "absent") {
			const workspaceStatus = entryStatus(root, LEGACY_WORKSPACE_RELATIVE);
			if (workspaceStatus === "symlink" || workspaceStatus === "other")
				throw new Error(`${LEGACY_WORKSPACE_RELATIVE} is ${workspaceStatus}`);
			if (workspaceStatus !== "file")
				throw new Error(`${LEGACY_WORKSPACE_RELATIVE} is not a regular file`);
			facts.old_authority_present = true;
			const owner = readJsonField(root, LEGACY_WORKSPACE_RELATIVE, "current_working");
			if (typeof owner === "string" && owner.length > 0)
				facts.blocked_active = true;
		}

		// 4. Old mutable directories and journal are old layout (owner-free).
		for (const dir of [
			LEGACY_MEMORY_RELATIVE,
			LEGACY_TEMPLATES_RELATIVE,
			LEGACY_AUTHORITY_RELATIVE,
		]) {
			const status = entryStatus(root, dir);
			if (status === "absent") continue;
			if (status === "symlink" || status === "other")
				throw new Error(`${dir} is ${status}`);
			if (status !== "directory") throw new Error(`${dir} is not a directory`);
			facts.old_authority_present = true;
			// Unknown entries in these directories fail closed like the migrator.
			for (const entry of listEntries(root, dir) ?? []) {
				const full = `${dir}/${entry}`;
				const known = LEGACY_KNOWN_FILES[full as keyof typeof LEGACY_KNOWN_FILES];
				if (known === undefined)
					throw new Error(`unknown file under ${dir}: ${entry}`);
			}
		}
		if (entryStatus(root, LEGACY_JOURNAL_RELATIVE) !== "absent") {
			const journalStatus = entryStatus(root, LEGACY_JOURNAL_RELATIVE);
			if (journalStatus === "symlink" || journalStatus === "other")
				throw new Error(`${LEGACY_JOURNAL_RELATIVE} is ${journalStatus}`);
			if (journalStatus !== "file")
				throw new Error(`${LEGACY_JOURNAL_RELATIVE} is not a regular file`);
			facts.old_authority_present = true;
		}
	} catch (error) {
		facts.fail_reason = error instanceof Error ? error.message : String(error);
	}
	return facts;
}

const AFFECTED_GIT_PREFIXES = [
	".imm/audit/",
	".imm/tasks/",
	".imm/workspace.json",
	".imm/memory/",
	".imm/templates/",
	".imm/authority/",
	".imm/journal.jsonl",
];

function gitDirtyAffected(root: string): string[] | null {
	const tracked = spawnSync(
		"git", ["-C", root, "diff", "--name-only", "-z", "HEAD", "--"],
		{ encoding: "utf8" },
	);
	const untracked = spawnSync(
		"git", ["-C", root, "ls-files", "--others", "--exclude-standard", "-z", "--"],
		{ encoding: "utf8" },
	);
	if (tracked.status !== 0 || untracked.status !== 0) return null;
	const dirty = new Set<string>();
	for (const output of [tracked.stdout, untracked.stdout]) {
		for (const path of output.split("\0")) {
			if (!path) continue;
			if (AFFECTED_GIT_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix)))
				dirty.add(path);
		}
	}
	return [...dirty].sort();
}

/**
 * A pending transaction under the retired file store: a Kernel transaction
 * marker needing the runtime that wrote it, or an interrupted file-target
 * migration manifest. Either way the next mutation must stop and diagnose.
 */
function pendingNewMarker(root: string): string | null {
	const entries = listEntries(root, FILE_STORE_TRANSACTIONS_RELATIVE);
	if (!entries) return null;
	const first = entries.find((entry) => entry.endsWith(".json"));
	return first ? `${FILE_STORE_TRANSACTIONS_RELATIVE}/${first}` : null;
}

/** Read one `store_meta` value without opening the runtime store module. */
function readStoreMeta(db: DatabaseSync, key: string): string | null {
	const row = db.prepare("SELECT value FROM store_meta WHERE key = ?").get(key) as
		| { value?: unknown }
		| undefined;
	return row && typeof row.value === "string" ? row.value : null;
}

/**
 * SQLite authority store facts: presence plus schema/binding validity. The
 * inspector stays read-only and never repairs; an incompatible or foreign
 * store reports `invalid` so no worktree silently mixes authority stores.
 */
function readKernelStoreFacts(root: string): { present: boolean; reason: string | null } {
	const status = entryStatus(root, KERNEL_DB_RELATIVE);
	if (status === "absent") return { present: false, reason: null };
	if (status !== "file")
		return { present: true, reason: `${KERNEL_DB_RELATIVE} is ${status}` };
	let db: DatabaseSync | null = null;
	try {
		db = new DatabaseSync(resolve(root, KERNEL_DB_RELATIVE), { readOnly: true });
		const version = readStoreMeta(db, "schema_version");
		if (version !== String(KERNEL_STORE_SCHEMA_VERSION))
			return {
				present: true,
				reason: `kernel store schema version ${version ?? "missing"} is incompatible with this runtime (${KERNEL_STORE_SCHEMA_VERSION})`,
			};
		const workspaceId = readStoreMeta(db, "workspace_id");
		const binding = readStoreMeta(db, "workspace_binding");
		if (!workspaceId || !binding)
			return { present: true, reason: "kernel store identity metadata is missing" };
		if (kernelStoreBindingDigest(realpathSync(root), workspaceId) !== binding)
			return {
				present: true,
				reason: "kernel store belongs to a different worktree; restore it into its binding worktree or run the supported rebinding",
			};
		return { present: true, reason: null };
	} catch (error) {
		return {
			present: true,
			reason: `kernel store is unreadable: ${error instanceof Error ? error.message : String(error)}`,
		};
	} finally {
		try {
			db?.close();
		} catch {
			// The connection is already closed.
		}
	}
}

interface FileStoreFacts {
	present: boolean;
	/** Retired per-task TaskRecords: authority no migration may ignore. */
	records_present: boolean;
	blocked_active: boolean;
	pending_marker: string | null;
	fail_reason: string | null;
}

const KERNEL_DB_ENTRIES = ["kernel.sqlite", "kernel.sqlite-wal", "kernel.sqlite-shm"];

/**
 * Facts about the retired `.imm/state/*.json` file store. Its authority must be
 * imported through the supported migration before this runtime may mutate the
 * worktree; the inspector only describes what it finds.
 */
function inspectFileStoreLayout(root: string): FileStoreFacts {
	const facts: FileStoreFacts = {
		present: false,
		records_present: false,
		blocked_active: false,
		pending_marker: null,
		fail_reason: null,
	};
	try {
		const stateStatus = entryStatus(root, STATE_RELATIVE);
		if (stateStatus === "symlink" || stateStatus === "other")
			throw new Error(`${STATE_RELATIVE} is ${stateStatus}`);
		if (stateStatus !== "directory") return facts;
		for (const entry of listEntries(root, STATE_RELATIVE) ?? []) {
			const full = `${STATE_RELATIVE}/${entry}`;
			const status = entryStatus(root, full);
			if (status === "symlink" || status === "other")
				throw new Error(`${full} is ${status}`);
			if (KERNEL_DB_ENTRIES.includes(entry)) {
				if (status !== "file") throw new Error(`${full} is not a regular file`);
				continue;
			}
			if (status === "directory") {
				if (
					![
						FILE_STORE_TASKS_RELATIVE,
						FILE_STORE_TRANSACTIONS_RELATIVE,
						FILE_STORE_LOCKS_RELATIVE,
						FILE_STORE_OBSERVATIONS_RELATIVE,
						BATCH_STATE_RELATIVE,
					].includes(full)
				)
					throw new Error(`unknown directory under ${STATE_RELATIVE}: ${entry}`);
				continue;
			}
			if ((FILE_STORE_INERT_FILES as readonly string[]).includes(full)) continue;
			facts.present = true;
			if (full === FILE_STORE_CLAIM_RELATIVE) {
				// The file-store claim is the workspace owner regardless of contents.
				facts.blocked_active = true;
				continue;
			}
			if (full === FILE_STORE_WORKSPACE_RELATIVE) {
				const owner = readJsonField(root, full, "current_working");
				if (typeof owner === "string" && owner.length > 0) facts.blocked_active = true;
				continue;
			}
			throw new Error(`unknown file under ${STATE_RELATIVE}: ${entry}`);
		}
		for (const entry of listEntries(root, FILE_STORE_TASKS_RELATIVE) ?? []) {
			const full = `${FILE_STORE_TASKS_RELATIVE}/${entry}`;
			const status = entryStatus(root, full);
			if (status === "symlink" || status === "other")
				throw new Error(`${full} is ${status}`);
			if (status !== "file") throw new Error(`${full} is not a regular file`);
			if (!entry.endsWith(".json"))
				throw new Error(`unknown file under ${FILE_STORE_TASKS_RELATIVE}: ${entry}`);
			facts.present = true;
			facts.records_present = true;
			const lifecycle =
				readJsonField(root, full, "lifecycle") ?? readJsonField(root, full, "phase");
			if (lifecycle !== "done" && lifecycle !== "stopped") facts.blocked_active = true;
		}
		const marker = pendingNewMarker(root);
		if (marker) {
			facts.present = true;
			facts.pending_marker = marker;
		}
	} catch (error) {
		facts.fail_reason = error instanceof Error ? error.message : String(error);
	}
	return facts;
}

export function inspectStorageLayout(root: string): StorageLayoutInspection {
	const rootFailure = assertNewLayoutRootsSafe(root);
	if (rootFailure) {
		return {
			contract: "assurance_kernel/storage_layout_inspection/v1",
			layout: "invalid",
			old_authority_present: false,
			pending_marker: null,
			dirty_affected_paths: [],
			reason: rootFailure,
		};
	}
	const oldFacts = inspectOldLayout(root);
	if (oldFacts.fail_reason) {
		return {
			contract: "assurance_kernel/storage_layout_inspection/v1",
			layout: "invalid",
			old_authority_present: oldFacts.old_authority_present,
			pending_marker: null,
			dirty_affected_paths: [],
			reason: oldFacts.fail_reason,
		};
	}
	const fileFacts = inspectFileStoreLayout(root);
	if (fileFacts.fail_reason) {
		return {
			contract: "assurance_kernel/storage_layout_inspection/v1",
			layout: "invalid",
			old_authority_present: fileFacts.present,
			pending_marker: null,
			dirty_affected_paths: [],
			reason: fileFacts.fail_reason,
		};
	}

	const store = readKernelStoreFacts(root);
	const auditPresent = entryStatus(root, AUDIT_RELATIVE) !== "absent";
	const dirty = gitDirtyAffected(root);
	const legacyAuthority = oldFacts.old_authority_present || fileFacts.present;
	// With a SQLite store present, a derived claim/owner file is decided by the
	// task-scoped mutation path (which refuses a foreign owner), so only retired
	// TaskRecords and pending markers make the layout itself invalid.
	const storeConflictAuthority =
		oldFacts.old_authority_present ||
		fileFacts.records_present ||
		fileFacts.pending_marker !== null;

	if (store.present) {
		if (store.reason) {
			return {
				contract: "assurance_kernel/storage_layout_inspection/v1",
				layout: "invalid",
				old_authority_present: legacyAuthority,
				pending_marker: null,
				dirty_affected_paths: dirty ?? [],
				reason: store.reason,
			};
		}
		if (storeConflictAuthority) {
			return {
				contract: "assurance_kernel/storage_layout_inspection/v1",
				layout: "invalid",
				old_authority_present: true,
				pending_marker: fileFacts.pending_marker,
				dirty_affected_paths: dirty ?? [],
				reason:
					"both a SQLite authority store and retired file-store authority exist; import or remove the retired store with the supported migration before mutating",
			};
		}
		return {
			contract: "assurance_kernel/storage_layout_inspection/v1",
			layout: "ready",
			old_authority_present: false,
			pending_marker: null,
			dirty_affected_paths: [],
			reason: null,
		};
	}

	if (fileFacts.pending_marker || oldFacts.pending_marker) {
		return {
			contract: "assurance_kernel/storage_layout_inspection/v1",
			layout: "recovery_required",
			old_authority_present: legacyAuthority,
			pending_marker: fileFacts.pending_marker ?? oldFacts.pending_marker,
			dirty_affected_paths: dirty ?? [],
			reason:
				"a retired transaction marker exists; settle it with the runtime that wrote it before importing authority into SQLite",
		};
	}
	if (fileFacts.blocked_active || oldFacts.blocked_active) {
		return {
			contract: "assurance_kernel/storage_layout_inspection/v1",
			layout: "migration_blocked_active",
			old_authority_present: true,
			pending_marker: null,
			dirty_affected_paths: dirty ?? [],
			reason:
				"an active claim, nonterminal TaskRecord or non-null workspace owner exists in the retired file store; settle or stop it with the prior runtime first",
		};
	}
	if (legacyAuthority) {
		return {
			contract: "assurance_kernel/storage_layout_inspection/v1",
			layout: "migration_required",
			old_authority_present: true,
			pending_marker: null,
			dirty_affected_paths: dirty ?? [],
			reason:
				"an owner-free retired file store exists; it must be imported into the SQLite authority store by the supported migration",
		};
	}
	if (dirty !== null && dirty.length > 0) {
		// Cleanup-only migrations (deleted templates, MEMORY.md, owner-free
		// workspace) still leave an affected diff that must be committed first.
		return {
			contract: "assurance_kernel/storage_layout_inspection/v1",
			layout: "migration_uncommitted",
			old_authority_present: false,
			pending_marker: null,
			dirty_affected_paths: dirty,
			reason: "affected audit or retired legacy paths differ from HEAD; commit the diff before any managed mutation",
		};
	}
	if (auditPresent && dirty === null) {
		return {
			contract: "assurance_kernel/storage_layout_inspection/v1",
			layout: "invalid",
			old_authority_present: false,
			pending_marker: null,
			dirty_affected_paths: [],
			reason: "audit evidence exists but the Git workspace is unavailable; committed state cannot be verified",
		};
	}
	return {
		contract: "assurance_kernel/storage_layout_inspection/v1",
		layout: "ready",
		old_authority_present: false,
		pending_marker: null,
		dirty_affected_paths: [],
		reason: null,
	};
}

/** Validate that the new-layout roots are not symlinked outside the
 *  repository (review-10). Called before any lock acquisition or write. */
function assertNewLayoutRootsSafe(root: string): string | null {
	for (const relative of [STATE_RELATIVE, AUDIT_RELATIVE]) {
		const path = resolve(root, relative);
		let stat;
		try {
			stat = lstatSync(path);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT" || code === "ENOTDIR") continue;
			return `${relative} is unreadable`;
		}
		if (stat.isSymbolicLink())
			return `${relative} is a symlink`;
		// Walk parent segments to detect symlinked ancestors.
		let cursor = resolve(root);
		for (const segment of relative.split("/")) {
			cursor = resolve(cursor, segment);
			try {
				const parentStat = lstatSync(cursor);
				if (parentStat.isSymbolicLink())
					return `${relative} traverses a symlink parent`;
			} catch {
				continue;
			}
		}
	}
	return null;
}
