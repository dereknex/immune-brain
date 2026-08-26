/**
 * One-release legacy-layout migrator (storage-layout cutover).
 *
 * This module is the ONLY production reader of the old mutable `.imm/tasks/`,
 * `.imm/workspace.json`, `.imm/memory/`, `.imm/journal.jsonl`, and
 * `.imm/templates/` layout paths. It is a compatibility module owned by
 * Kernel/runtime maintainers with an explicit expiry: the immediate successor
 * release deletes this module, its marker handler, and every temporary
 * old-layout test branch. No CLI command or Skill exposes it directly.
 *
 * Eligibility and replay follow the immutable `storage_layout_inspection/v1`
 * contract: only an owner-free, transaction-free, affected-paths-clean legacy
 * layout migrates. Every relocation is exact-byte idempotent; the frozen
 * manifest in `.imm/state/transactions/storage-layout-migration.json` is the
 * only recovery source and is never recomputed. The Git index is never
 * mutated. The original triggering mutation returns `migration_completed`
 * and must be retried after the affected diff is committed.
 */
import { spawnSync } from "node:child_process";
import {
	closeSync,
	constants as FS_CONSTANTS,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import {
	AUDIT_RELATIVE,
	LEGACY_AUTHORITY_RELATIVE,
	LEGACY_CLAIM_RELATIVE,
	LEGACY_JOURNAL_RELATIVE,
	LEGACY_KNOWN_FILES,
	LEGACY_MEMORY_RELATIVE,
	LEGACY_TASKS_RELATIVE,
	LEGACY_TEMPLATES_RELATIVE,
	LEGACY_WORKSPACE_RELATIVE,
	LEGACY_V3_RELATIVE,
	MIGRATION_MARKER_RELATIVE,
	auditTaskRecordPath,
	auditTerminalProofPath,
	inspectStorageLayout,
	legacyV3Path,
	type StorageLayoutInspection,
} from "./storage_paths";

export interface MigrationManifestEntry {
	source: string;
	target: string | null; // null = delete (history is the retention source)
	sha256: string;
	size: number;
}

export interface MigrationManifest {
	contract: "assurance_kernel/storage_layout_migration/v1";
	version: 1;
	entries: MigrationManifestEntry[];
}

export interface MigrationOutcome {
	contract: "immune_brain/storage_layout_migration_result/v1";
	outcome:
		| "migrated"
		| "recovery_required"
		| "migration_blocked_active"
		| "invalid"
		| "already_migrated"
		| "migration_uncommitted";
	affected_paths: string[];
	reason: string | null;
}

const TASK_OWNER_FILE = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127})\.(json|backend-claim\.json)$/;
const MEMORY_FILES = new Set([
	"current_iteration.json",
	"current_iteration_history.jsonl",
	"dispatch_telemetry.jsonl",
	".current_iteration.authority_commit_receipts.jsonl",
	".current_iteration.automatic_observations.jsonl",
	".current_iteration.automatic_observations.lock",
	"MEMORY.md",
]);
const TEMPLATE_FILES = new Set([
	"iteration-plan-template.md",
	"review-report-template.md",
]);

function sha256Hex(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function pathExists(path: string): boolean {
	try {
		return lstatSync(path).isFile() || lstatSync(path).isDirectory();
	} catch {
		return false;
	}
}

function gitLines(root: string, args: string[]): string[] | null {
	const result = spawnSync("git", ["-C", root, ...args], {
		encoding: "utf8",
	});
	if (result.status !== 0) return null;
	return result.stdout.split("\n").filter(Boolean);
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

/** BR-DEC-003: exact affected paths must be clean; unrelated dirt is allowed. */
function affectedGitDirty(root: string): string[] {
	const dirty = new Set<string>();
	const staged = gitLines(root, ["diff", "--cached", "--name-only", "HEAD", "--"]);
	const unstaged = gitLines(root, ["diff", "--name-only", "HEAD", "--"]);
	const untracked = gitLines(root, ["ls-files", "--others", "--exclude-standard", "--"]);
	for (const list of [staged, unstaged, untracked]) {
		if (list === null) throw new Error("Git workspace is unavailable for migration eligibility");
		for (const path of list) {
			if (AFFECTED_GIT_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix)))
				dirty.add(path);
		}
	}
	return [...dirty].sort();
}

function withExclusiveFileLock(path: string, operation: () => void): void {
	let fd: number | null = null;
	mkdirSync(dirname(path), { recursive: true });
	try {
		fd = openSync(path, FS_CONSTANTS.O_WRONLY | FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL, 0o600);
		writeFileSync(fd, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`, "utf8");
		fsyncSync(fd);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new Error(`migration lock is busy: ${path}; retry after the concurrent operation settles`);
		}
		throw new Error(`migration lock failed: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		if (fd !== null) closeSync(fd);
	}
	try {
		operation();
	} finally {
		rmSync(path, { force: true });
	}
}

function fsyncDirectory(path: string): void {
	const fd = openSync(path, FS_CONSTANTS.O_RDONLY);
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

function readRegularFileOrNull(path: string): Buffer | null {
	try {
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) throw new Error(`${path} is a symlink`);
		if (!stat.isFile()) throw new Error(`${path} is not a regular file`);
		return readFileSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

/** Source-only moves, target-only with matching hash is complete, matching source+target removes source only after verification. */
function convergeRelocation(root: string, entry: MigrationManifestEntry): void {
	const source = resolve(root, entry.source);
	const target = entry.target ? resolve(root, entry.target) : null;
	const sourceBytes = readRegularFileOrNull(source);
	const targetBytes = target ? readRegularFileOrNull(target) : null;
	if (sourceBytes === null && targetBytes === null)
		throw new Error(`migration relocation missing both sides: ${entry.source}`);
	if (target && targetBytes !== null && sha256Hex(targetBytes) !== entry.sha256)
		throw new Error(`migration target hash mismatch for ${entry.target}`);
	if (sourceBytes !== null && sha256Hex(sourceBytes) !== entry.sha256)
		throw new Error(`migration source hash mismatch for ${entry.source}`);
	if (sourceBytes !== null && target === null) {
		// Delete entry: history is the retention source.
		rmSync(source);
		fsyncDirectory(dirname(source));
		return;
	}
	if (sourceBytes === null) return; // already relocated
	if (targetBytes !== null && targetBytes.length === entry.size) {
		// Complete relocation replayed after target creation: the verified
		// source duplicate must be removed so recovery never leaves legacy
		// authority bytes behind (review-1).
		rmSync(source);
		fsyncDirectory(dirname(source));
		return;
	}
	if (target) {
		mkdirSync(dirname(target), { recursive: true });
		const temp = `${target}.${process.pid}.mig-tmp`;
		const fd = openSync(temp, FS_CONSTANTS.O_WRONLY | FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL, 0o600);
		try {
			writeFileSync(fd, sourceBytes);
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		renameSync(temp, target);
		fsyncDirectory(dirname(target));
		rmSync(source);
		fsyncDirectory(dirname(source));
	}
}

function buildManifest(root: string): { manifest: MigrationManifest; affected: string[] } {
	const entries: MigrationManifestEntry[] = [];
	const affected: string[] = [];
	const addFile = (source: string, target: string | null): void => {
		const bytes = readRegularFileOrNull(resolve(root, source));
		if (bytes === null) return;
		affected.push(source);
		if (target) affected.push(target);
		entries.push({ source, target, sha256: sha256Hex(bytes), size: bytes.length });
	};

	// Terminal task pairs and record-only terminal records.
	const taskDir = resolve(root, LEGACY_TASKS_RELATIVE);
	if (pathExists(taskDir)) {
		for (const entry of readdirSync(taskDir).sort()) {
			if (entry in legacyKnownNames()) continue;
			const matched = TASK_OWNER_FILE.exec(entry);
			if (!matched) throw new Error(`unknown file under ${LEGACY_TASKS_RELATIVE}: ${entry}`);
			const taskId = matched[1];
			if (entry.endsWith(".backend-claim.json")) {
				addFile(`${LEGACY_TASKS_RELATIVE}/${entry}`, auditTerminalProofPath(taskId));
			} else {
				addFile(`${LEGACY_TASKS_RELATIVE}/${entry}`, auditTaskRecordPath(taskId));
			}
		}
	}

	// Legacy machine v3 evidence moves byte-for-byte.
	if (pathExists(resolve(root, LEGACY_MEMORY_RELATIVE))) {
		for (const entry of readdirSync(resolve(root, LEGACY_MEMORY_RELATIVE)).sort()) {
			if (!MEMORY_FILES.has(entry))
				throw new Error(`unknown file under ${LEGACY_MEMORY_RELATIVE}: ${entry}`);
			const source = `${LEGACY_MEMORY_RELATIVE}/${entry}`;
			if (entry === "MEMORY.md") {
				addFile(source, null); // deleted; history retains the bytes
			} else if (entry === ".current_iteration.automatic_observations.lock") {
				addFile(source, null); // process lock, not evidence
			} else {
				addFile(source, legacyV3Path(entry));
			}
		}
	}

	// Retired templates are deleted.
	if (pathExists(resolve(root, LEGACY_TEMPLATES_RELATIVE))) {
		for (const entry of readdirSync(resolve(root, LEGACY_TEMPLATES_RELATIVE)).sort()) {
			if (!TEMPLATE_FILES.has(entry))
				throw new Error(`unknown file under ${LEGACY_TEMPLATES_RELATIVE}: ${entry}`);
			addFile(`${LEGACY_TEMPLATES_RELATIVE}/${entry}`, null);
		}
	}

	// Journal and authority residues are historical machine evidence.
	addFile(LEGACY_JOURNAL_RELATIVE, legacyV3Path("journal.jsonl"));
	if (pathExists(resolve(root, LEGACY_AUTHORITY_RELATIVE)))
		throw new Error(
			`${LEGACY_AUTHORITY_RELATIVE} contains unknown legacy residue; settle it manually before migration`,
		);

	// Owner-free workspace shell and claim cannot exist here (inspect gates),
	// but a leftover empty shell is deleted, never migrated.
	addFile(LEGACY_WORKSPACE_RELATIVE, null);
	addFile(LEGACY_CLAIM_RELATIVE, null);

	// Case-fold collisions fail closed (portable filesystems).
	const byLower = new Map<string, string>();
	for (const entry of entries) {
		const key = `${entry.source}\0${entry.target ?? ""}`.toLowerCase();
		const prior = byLower.get(key);
		if (prior !== undefined)
			throw new Error(`migration case-fold collision: ${prior} and ${entry.source}`);
		byLower.set(key, entry.source);
	}

	return { manifest: { contract: "assurance_kernel/storage_layout_migration/v1", version: 1, entries }, affected };
}

function legacyKnownNames(): Record<string, string> {
	return LEGACY_KNOWN_FILES as unknown as Record<string, string>;
}

const LEGACY_SOURCE_PREFIXES = [
	LEGACY_CLAIM_RELATIVE,
	LEGACY_WORKSPACE_RELATIVE,
	`${LEGACY_TASKS_RELATIVE}/`,
	`${LEGACY_MEMORY_RELATIVE}/`,
	`${LEGACY_TEMPLATES_RELATIVE}/`,
	LEGACY_JOURNAL_RELATIVE,
	`${LEGACY_AUTHORITY_RELATIVE}/`,
];
const LEGACY_TARGET_PREFIXES = [
	`${AUDIT_RELATIVE}/`,
	`${LEGACY_V3_RELATIVE}/`,
];

function canonicalProjectRelative(root: string, candidate: string, label: string): string {
	if (
		typeof candidate !== "string" ||
		!candidate ||
		candidate.includes("\0") ||
		candidate.includes("\\") ||
		candidate.startsWith("/") ||
		/^[A-Za-z]:\//.test(candidate) ||
		candidate.split("/").some((part) => !part || part === "." || part === "..")
	)
		throw new Error(`migration marker ${label} is not a canonical project-relative path: ${candidate}`);
	return candidate;
}

/** Directories of a canonical relative path must not contain symlink segments (review-3). */
function assertNoSymlinkParentSegments(root: string, relativePath: string): void {
	let cursor = resolve(root);
	for (const segment of relativePath.split("/").slice(0, -1)) {
		cursor = resolve(cursor, segment);
		let stat;
		try {
			stat = lstatSync(cursor);
		} catch {
			continue;
		}
		if (stat.isSymbolicLink())
			throw new Error(`migration marker path traverses a symlink parent: ${relativePath}`);
	}
}

function validateMarkerEntry(
	root: string,
	entry: MigrationManifestEntry,
	index: number,
): void {
	if (!entry || typeof entry !== "object" || Array.isArray(entry))
		throw new Error(`migration marker entry ${index} is invalid`);
	const source = canonicalProjectRelative(root, entry.source, `entry ${index} source`);
	if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256))
		throw new Error(`migration marker entry ${index} sha256 is invalid`);
	if (typeof entry.size !== "number" || !Number.isInteger(entry.size) || entry.size < 0)
		throw new Error(`migration marker entry ${index} size is invalid`);
	if (!LEGACY_SOURCE_PREFIXES.some((prefix) => source === prefix || source.startsWith(prefix)))
		throw new Error(`migration marker entry ${index} source is outside the legacy layout: ${source}`);
	assertNoSymlinkParentSegments(root, source);
	if (entry.target === null) return;
	const target = canonicalProjectRelative(root, entry.target, `entry ${index} target`);
	if (!LEGACY_TARGET_PREFIXES.some((prefix) => target === prefix || target.startsWith(prefix)))
		throw new Error(`migration marker entry ${index} target is outside the audit layout: ${target}`);
	assertNoSymlinkParentSegments(root, target);
}

function readPendingMigrationMarker(root: string): MigrationManifest | null {
	const path = resolve(root, MIGRATION_MARKER_RELATIVE);
	const bytes = readRegularFileOrNull(path);
	if (bytes === null) return null;
	const raw = JSON.parse(bytes.toString("utf8")) as MigrationManifest;
	if (raw.contract !== "assurance_kernel/storage_layout_migration/v1" || raw.version !== 1)
		throw new Error("migration marker contract is invalid");
	if (!Array.isArray(raw.entries))
		throw new Error("migration marker entries are invalid");
	for (const [index, entry] of raw.entries.entries())
		validateMarkerEntry(root, entry as MigrationManifestEntry, index);
	return raw;
}

function writeMigrationMarker(root: string, manifest: MigrationManifest): void {
	const path = resolve(root, MIGRATION_MARKER_RELATIVE);
	mkdirSync(dirname(path), { recursive: true });
	const fd = openSync(path, FS_CONSTANTS.O_WRONLY | FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL, 0o600);
	try {
		writeFileSync(fd, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	fsyncDirectory(dirname(path));
}

/** Remove legacy directories that migration emptied; empty legacy dirs must
 *  not keep inspectStorageLayout reporting an old layout (review-2). */
function removeEmptyLegacyDirectories(root: string): void {
	for (const relative of [LEGACY_TASKS_RELATIVE, LEGACY_MEMORY_RELATIVE, LEGACY_TEMPLATES_RELATIVE, LEGACY_AUTHORITY_RELATIVE]) {
		const path = resolve(root, relative);
		let stat;
		try {
			stat = lstatSync(path);
		} catch {
			continue;
		}
		if (stat.isSymbolicLink()) {
			rmSync(path);
			fsyncDirectory(dirname(path));
			continue;
		}
		if (!stat.isDirectory()) continue;
		try {
			if (readdirSync(path).length === 0) {
				rmSync(path);
				fsyncDirectory(dirname(path));
			}
		} catch {
			// raced or unreadable: leave for the next recovery attempt
		}
	}
}

function removeMigrationMarker(root: string): void {
	const path = resolve(root, MIGRATION_MARKER_RELATIVE);
	rmSync(path, { force: true });
	fsyncDirectory(dirname(path));
}

/**
 * Run the one-release migration. Read-only inspection first; no Git index
 * writes; the triggering mutation must stop and report `migration_completed`
 * until the affected diff is committed.
 */
export function migrateLegacyLayout(root: string): MigrationOutcome {
	const inspection = inspectStorageLayout(root);
	if (inspection.layout === "ready" || inspection.layout === "migration_uncommitted")
		return {
			contract: "immune_brain/storage_layout_migration_result/v1",
			outcome: inspection.layout === "ready" ? "already_migrated" : "migration_uncommitted",
			affected_paths: inspection.dirty_affected_paths,
			reason: inspection.reason,
		};
	if (inspection.layout === "migration_blocked_active")
		return {
			contract: "immune_brain/storage_layout_migration_result/v1",
			outcome: "migration_blocked_active",
			affected_paths: [],
			reason: inspection.reason,
		};
	if (inspection.layout === "invalid")
		return {
			contract: "immune_brain/storage_layout_migration_result/v1",
			outcome: "invalid",
			affected_paths: [],
			reason: inspection.reason,
		};
	if (inspection.layout === "recovery_required") {
		// A Kernel transaction marker must be recovered by the Kernel runtime;
		// a migration marker is replayed here under the dual lock.
		const marker = readPendingMigrationMarker(root);
		if (!marker)
			return {
				contract: "immune_brain/storage_layout_migration_result/v1",
				outcome: "recovery_required",
				affected_paths: [],
				reason: inspection.reason,
			};
		const oldLock = resolve(root, LEGACY_TASKS_RELATIVE, ".workspace.lock");
		const newLock = resolve(root, ".imm/state/locks/kernel-store.lock");
		withExclusiveFileLock(oldLock, () => {
			withExclusiveFileLock(newLock, () => {
				for (const entry of marker.entries) convergeRelocation(root, entry);
				removeEmptyLegacyDirectories(root);
				removeMigrationMarker(root);
			});
		});
		return {
			contract: "immune_brain/storage_layout_migration_result/v1",
			outcome: "migrated",
			affected_paths: marker.entries.flatMap((entry) => [entry.source, entry.target].filter((p): p is string => p !== null)),
			reason: "recovered the pending migration manifest idempotently",
		};
	}

	// migration_required: eligibility is the inspection's fail-closed verdict.
	const dirty = affectedGitDirty(root);
	if (dirty.length > 0)
		return {
			contract: "immune_brain/storage_layout_migration_result/v1",
			outcome: "migration_uncommitted",
			affected_paths: dirty,
			reason: "affected legacy/audit paths differ from HEAD; commit or restore them before migration",
		};
	const { manifest, affected } = buildManifest(root);
	if (manifest.entries.length === 0)
		return {
			contract: "immune_brain/storage_layout_migration_result/v1",
			outcome: "already_migrated",
			affected_paths: [],
			reason: "no legacy evidence remains to relocate",
		};

	// Acquire the old task lock then the new store lock; hold both through
	// convergence. The new store lock is the same one storage.ts uses, so no
	// Kernel mutation can interleave with the relocation.
	const oldLock = resolve(root, LEGACY_TASKS_RELATIVE, ".workspace.lock");
	const newLock = resolve(root, ".imm/state/locks/kernel-store.lock");
	withExclusiveFileLock(oldLock, () => {
		withExclusiveFileLock(newLock, () => {
			writeMigrationMarker(root, manifest);
			try {
				for (const entry of manifest.entries) convergeRelocation(root, entry);
				removeEmptyLegacyDirectories(root);
				removeMigrationMarker(root);
			} catch (error) {
				throw new Error(
					`migration failed and remains recoverable from the frozen manifest: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		});
	});
	return {
		contract: "immune_brain/storage_layout_migration_result/v1",
		outcome: "migrated",
		affected_paths: affected,
		reason: "relocated legacy evidence without mutating the Git index; commit the affected paths and retry the original operation",
	};
}