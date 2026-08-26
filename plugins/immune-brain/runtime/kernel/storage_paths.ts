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
import {
	constants as FS_CONSTANTS,
	lstatSync,
	openSync,
	readFileSync,
	readdirSync,
	closeSync,
	fstatSync,
} from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// New permanent layout paths
// ---------------------------------------------------------------------------

export const STATE_RELATIVE = ".imm/state";
export const AUDIT_RELATIVE = ".imm/audit";
export const LEGACY_V3_RELATIVE = ".imm/audit/legacy-v3";
export const JOURNAL_RELATIVE = ".imm/state/journal.jsonl";
export const MIGRATION_MARKER_RELATIVE =
	".imm/state/transactions/storage-layout-migration.json";

/* Transaction marker file names under `.imm/state/transactions/`. */
export const KERNEL_TRANSACTION_MARKERS = [
	"workspace-transaction-v2.json",
	"enrollment-marker.json",
	"drain-transaction.json",
	"terminal-transaction.json",
	"authority-repair-transaction.json",
] as const;

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
			if (kind === "marker") {
				facts.pending_marker ??= path;
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

function pendingNewMarker(root: string): string | null {
	const entries = listEntries(root, ".imm/state/transactions");
	if (!entries) return null;
	for (const entry of entries) {
		if (entry === "storage-layout-migration.json") return `.imm/state/transactions/${entry}`;
		if ((KERNEL_TRANSACTION_MARKERS as readonly string[]).includes(entry))
			return `.imm/state/transactions/${entry}`;
	}
	return entries.find((entry) => entry.endsWith(".json"))
		? `.imm/state/transactions/${entries.find((entry) => entry.endsWith(".json")) ?? ""}`
		: null;
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

	const newMarker = pendingNewMarker(root);
	const auditPresent = entryStatus(root, AUDIT_RELATIVE) !== "absent";
	const dirty = gitDirtyAffected(root);

	if (oldFacts.pending_marker || newMarker) {
		return {
			contract: "assurance_kernel/storage_layout_inspection/v1",
			layout: "recovery_required",
			old_authority_present: oldFacts.old_authority_present,
			pending_marker: oldFacts.pending_marker ?? newMarker,
			dirty_affected_paths: dirty ?? [],
			reason: "a recoverable migration or Kernel transaction marker exists; mutation must recover it under lock first",
		};
	}
	if (oldFacts.blocked_active) {
		return {
			contract: "assurance_kernel/storage_layout_inspection/v1",
			layout: "migration_blocked_active",
			old_authority_present: true,
			pending_marker: null,
			dirty_affected_paths: dirty ?? [],
			reason: "an active claim, nonterminal TaskRecord, non-null workspace owner, or non-idle v3 Ledger exists in the old layout; settle or stop it with the prior runtime first",
		};
	}
	if (oldFacts.old_authority_present) {
		return {
			contract: "assurance_kernel/storage_layout_inspection/v1",
			layout: "migration_required",
			old_authority_present: true,
			pending_marker: null,
			dirty_affected_paths: dirty ?? [],
			reason: "an owner-free legacy layout exists; the next eligible stateful mutation runs the one-release migration and stops",
		};
	}
	if (dirty !== null && dirty.length > 0) {
		// review-2: cleanup-only migrations (deleted templates, MEMORY.md,
		// owner-free workspace) still leave an affected diff that must be
		// committed before the layout can be ready.
		return {
			contract: "assurance_kernel/storage_layout_inspection/v1",
			layout: "migration_uncommitted",
			old_authority_present: false,
			pending_marker: null,
			dirty_affected_paths: dirty,
			reason: "affected audit or retired legacy paths differ from HEAD; commit the migration diff before any managed mutation",
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