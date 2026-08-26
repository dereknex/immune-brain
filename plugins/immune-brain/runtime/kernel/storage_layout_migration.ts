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

const TASK_OWNER_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}(\.json|\.backend-claim\.json)$/;

/** Strip the owner suffix without greedy-capture ambiguity. */
function taskIdFromOwnerFile(entry: string): string | null {
	if (!TASK_OWNER_FILE.test(entry)) return null;
	const id = entry.endsWith(".backend-claim.json")
		? entry.slice(0, -".backend-claim.json".length)
		: entry.slice(0, -".json".length);
	return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) ? id : null;
}
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

function pathStatOrNull(path: string): ReturnType<typeof lstatSync> | null {
	try {
		return lstatSync(path);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return null;
		throw error;
	}
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

/** Runtime lock files created by the migration itself are not evidence. */
const MIGRATION_RUNTIME_LOCKS = new Set([
	".imm/tasks/.workspace.lock",
	".imm/tasks/.journal.lock",
]);

/** BR-DEC-003: exact affected paths must be clean; unrelated dirt is allowed. */
function affectedGitDirty(root: string): string[] {
	const dirty = new Set<string>();
	const staged = gitLines(root, ["diff", "--cached", "--name-only", "HEAD", "--"]);
	const unstaged = gitLines(root, ["diff", "--name-only", "HEAD", "--"]);
	const untracked = gitLines(root, ["ls-files", "--others", "--exclude-standard", "--"]);
	for (const list of [staged, unstaged, untracked]) {
		if (list === null) throw new Error("Git workspace is unavailable for migration eligibility");
		for (const path of list) {
			if (MIGRATION_RUNTIME_LOCKS.has(path)) continue;
			if (AFFECTED_GIT_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix)))
				dirty.add(path);
		}
	}
	return [...dirty].sort();
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

/** Remove a lock whose recorded owner process is dead (review-3). */
function clearStaleMigrationLock(path: string, holder: string): boolean {
	let stale = false;
	try {
		const record = JSON.parse(holder) as { pid?: unknown };
		stale = typeof record.pid === "number" && record.pid > 0 && !processIsAlive(record.pid);
	} catch {
		stale = Date.now() - Number(lstatSync(path).mtimeMs) > 30_000;
	}
	if (!stale) return false;
	rmSync(path, { force: true });
	return true;
}

function withExclusiveFileLock<T>(path: string, operation: () => T): T {
	let fd: number | null = null;
	mkdirSync(dirname(path), { recursive: true });
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			fd = openSync(path, FS_CONSTANTS.O_WRONLY | FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL, 0o600);
			writeFileSync(fd, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`, "utf8");
			fsyncSync(fd);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") {
				if (attempt === 0) {
					let holder = "";
					try {
						holder = readFileSync(path, "utf8");
					} catch {
						// unreadable holder: leave the lock busy
					}
					if (holder && clearStaleMigrationLock(path, holder)) continue;
				}
				throw new Error(`migration lock is busy: ${path}; retry after the concurrent operation settles`);
			}
			throw new Error(`migration lock failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (fd === null) throw new Error(`migration lock could not be acquired: ${path}`);
	try {
		return operation();
	} finally {
		closeSync(fd);
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
function assertNoSymlinkParents(root: string, relativePath: string): void {
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
			throw new Error(`migration path traverses a symlink parent: ${relativePath}`);
	}
}

function convergeRelocation(root: string, entry: MigrationManifestEntry): void {
	assertNoSymlinkParents(root, entry.source);
	if (entry.target) assertNoSymlinkParents(root, entry.target);
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
		assertNoSymlinkParents(root, source);
		if (target) assertNoSymlinkParents(root, target);
		const bytes = readRegularFileOrNull(resolve(root, source));
		if (bytes === null) return;
		affected.push(source);
		if (target) affected.push(target);
		entries.push({ source, target, sha256: sha256Hex(bytes), size: bytes.length });
	};

	// Terminal task pairs: a task record is migrated ONLY with its matching
	// terminal proof (review-7). The proof must bind the task identity, the
	// record lifecycle, and the final record hash; a record-only or
	// proof-only legacy file is partial evidence and fails the migration
	// with zero writes instead of producing an incomplete audit pair.
	const taskDir = resolve(root, LEGACY_TASKS_RELATIVE);
	if (pathExists(taskDir)) {
		const byTask = new Map<string, { record: string | null; proof: string | null }>();
		for (const entry of readdirSync(taskDir).sort()) {
			if (entry in legacyKnownNames()) continue;
			const taskId = taskIdFromOwnerFile(entry);
			if (taskId === null) throw new Error(`unknown file under ${LEGACY_TASKS_RELATIVE}: ${entry}`);
			const slot = byTask.get(taskId) ?? { record: null, proof: null };
			if (entry.endsWith(".backend-claim.json")) slot.proof = entry;
			else slot.record = entry;
			byTask.set(taskId, slot);
		}
		for (const [taskId, slot] of [...byTask.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
			if (slot.record === null || slot.proof === null)
				throw new Error(
					`legacy task ${taskId} has partial terminal evidence (record=${slot.record !== null}, proof=${slot.proof !== null}); resolve before migration`,
				);
			const recordRelative = `${LEGACY_TASKS_RELATIVE}/${slot.record}`;
			const proofRelative = `${LEGACY_TASKS_RELATIVE}/${slot.proof}`;
			const recordBytes = readRegularFileOrNull(resolve(root, recordRelative));
			const proofBytes = readRegularFileOrNull(resolve(root, proofRelative));
			if (recordBytes === null || proofBytes === null)
				throw new Error(`legacy task ${taskId} terminal evidence is unreadable`);
			const recordRaw = JSON.parse(recordBytes.toString("utf8")) as {
				contract?: unknown;
				lifecycle?: unknown;
				phase?: unknown;
				task_id?: unknown;
			};
			const proofRaw = JSON.parse(proofBytes.toString("utf8")) as {
				task_id?: unknown;
				terminal_lifecycle?: unknown;
				terminal_phase?: unknown;
				final_record_hash?: unknown;
			};
			const lifecycle = recordRaw.lifecycle ?? recordRaw.phase;
			const terminalLifecycle = proofRaw.terminal_lifecycle ?? proofRaw.terminal_phase;
			if (recordRaw.task_id !== taskId || proofRaw.task_id !== taskId)
				throw new Error(`legacy task ${taskId} terminal identity is inconsistent`);
			if (lifecycle !== terminalLifecycle || (lifecycle !== "done" && lifecycle !== "stopped"))
				throw new Error(`legacy task ${taskId} terminal lifecycle is inconsistent`);
			if (proofRaw.final_record_hash !== `sha256:${sha256Hex(recordBytes)}`)
				throw new Error(`legacy task ${taskId} terminal proof does not bind its record bytes`);
			addFile(recordRelative, auditTaskRecordPath(taskId));
			addFile(proofRelative, auditTerminalProofPath(taskId));
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

	// Case-fold collisions fail closed per axis (portable filesystems):
	// distinct task IDs such as `Foo` and `foo` produce distinct sources but
	// case-colliding audit directories, and must be rejected before any
	// relocation (review-1).
	const sourceLower = new Map<string, string>();
	const targetLower = new Map<string, string>();
	for (const entry of entries) {
		const srcKey = entry.source.toLowerCase();
		const priorSource = sourceLower.get(srcKey);
		if (priorSource !== undefined)
			throw new Error(`migration case-fold source collision: ${priorSource} and ${entry.source}`);
		sourceLower.set(srcKey, entry.source);
		if (entry.target !== null) {
			const tgtKey = entry.target.toLowerCase();
			const priorTarget = targetLower.get(tgtKey);
			if (priorTarget !== undefined)
				throw new Error(`migration case-fold target collision: ${priorTarget} and ${entry.target}`);
			targetLower.set(tgtKey, entry.target);
		}
	}

	// review-2 preflight: an existing audit target (committed conflicting or
	// exact duplicate) is never adopted by a fresh migration; it is an
	// invalid repository state that must be resolved manually with zero
	// writes. Recovery replays are the only path that accepts a present
	// target (with matching hash). review-3: the comparison is
	// case-insensitive per directory level, so committed `.imm/audit/foo`
	// evidence blocks migrating `Foo` on case-sensitive filesystems too.
	const existingAuditEntries = new Map<string, string>();
	{
		const auditRoot = resolve(root, AUDIT_RELATIVE);
		if (pathExists(auditRoot)) {
			for (const top of readdirSync(auditRoot)) {
				const lower = top.toLowerCase();
				const prior = existingAuditEntries.get(lower);
				if (prior !== undefined && prior !== top)
					throw new Error(
						`existing audit evidence has a case-fold collision: ${prior} and ${top}`,
					);
				existingAuditEntries.set(lower, top);
			}
		}
	}
	for (const entry of entries) {
		if (entry.target === null) continue;
		const stat = pathStatOrNull(resolve(root, entry.target));
		if (stat && stat.isFile())
			throw new Error(
				`migration target already exists before relocation: ${entry.target}; resolve the duplicate or conflicting audit evidence manually`,
			);
		const targetSegments = entry.target.split("/");
		if (targetSegments[1] !== undefined) {
			const lowered = targetSegments[1].toLowerCase();
			const existingTop = existingAuditEntries.get(lowered);
			if (existingTop !== undefined && existingTop !== targetSegments[1])
				throw new Error(
					`migration target case-collides with existing audit evidence: ${entry.target} conflicts with .imm/audit/${existingTop}`,
				);
		}
	}

	return { manifest: { contract: "assurance_kernel/storage_layout_migration/v1", version: 1, entries }, affected };
}

function legacyKnownNames(): Record<string, string> {
	// The migration's own runtime lock files are never evidence and are
	// skipped by manifest construction.
	return {
		...LEGACY_KNOWN_FILES as unknown as Record<string, string>,
		".workspace.lock": "lock",
		".journal.lock": "lock",
	};
}

/**
 * Exact emitted-mapping validation (review round 7): a recovery marker may
 * only reference the exact source/target/deletion shapes buildManifest
 * emits. Anything else -- broad prefixes, unknown subpaths, duplicate
 * sources, case-colliding targets -- is rejected before any relocation.
 */
const LEGACY_TARGET_PREFIXES = [
	`${AUDIT_RELATIVE}/`,
	`${LEGACY_V3_RELATIVE}/`,
];

/** Sources that are delete-only entries (history is the retention source). */
const LEGACY_DELETE_SOURCES = new Set([
	LEGACY_CLAIM_RELATIVE,
	LEGACY_WORKSPACE_RELATIVE,
	".imm/memory/MEMORY.md",
	".imm/memory/.current_iteration.automatic_observations.lock",
	".imm/templates/iteration-plan-template.md",
	".imm/templates/review-report-template.md",
]);

/** Singleton sources whose migration target is a fixed file (not per-task). */
const LEGACY_FIXED_TARGETS = new Map<string, string>([
	[LEGACY_JOURNAL_RELATIVE, legacyV3Path("journal.jsonl")],
]);

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

const TASK_OWNER_FILE_STRICT =
	/^([A-Za-z0-9][A-Za-z0-9._-]{0,127})\.(json|backend-claim\.json)$/;

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
	assertNoSymlinkParentSegments(root, source);

	const sourceBase = source.split("/").at(-1) ?? "";
	// review-1: task owner sources must live under the exact .imm/tasks/
	// prefix; a bare project-root *.json basename must never be accepted.
	if (taskIdFromOwnerFile(sourceBase) !== null) {
		if (!source.startsWith(`${LEGACY_TASKS_RELATIVE}/`))
			throw new Error(`migration marker entry ${index} task source is outside .imm/tasks: ${source}`);
		const taskId = taskIdFromOwnerFile(sourceBase)!;
		const isTombstone = sourceBase.endsWith(".backend-claim.json");
		const expectedTarget = isTombstone
			? auditTerminalProofPath(taskId)
			: auditTaskRecordPath(taskId);
		if (entry.target !== expectedTarget)
			throw new Error(`migration marker entry ${index} target does not match task mapping: ${source} -> ${String(entry.target)}`);
		return;
	}
	if (LEGACY_DELETE_SOURCES.has(source)) {
		if (entry.target !== null)
			throw new Error(`migration marker entry ${index} delete source must have a null target: ${source}`);
		return;
	}
	const fixedTarget = LEGACY_FIXED_TARGETS.get(source);
	if (fixedTarget !== undefined) {
		if (entry.target !== fixedTarget)
			throw new Error(`migration marker entry ${index} target does not match the fixed mapping: ${source}`);
		return;
	}
	// Known `.imm/memory/` evidence relocates byte-for-byte to legacy-v3.
	// review-1: only the exact MEMORY_FILES allowlist is accepted; an
	// unknown .imm/memory child is never exposed under tracked audit.
	const MEMORY_FILES = new Set([
		".imm/memory/current_iteration.json",
		".imm/memory/current_iteration_history.jsonl",
		".imm/memory/dispatch_telemetry.jsonl",
		".imm/memory/.current_iteration.authority_commit_receipts.jsonl",
		".imm/memory/.current_iteration.automatic_observations.jsonl",
	]);
	if (source.startsWith(`${LEGACY_MEMORY_RELATIVE}/`)) {
		if (!MEMORY_FILES.has(source))
			throw new Error(`migration marker entry ${index} memory source is not in the allowlist: ${source}`);
		if (
			entry.target !== null &&
			entry.target.startsWith(`${LEGACY_V3_RELATIVE}/`) &&
			entry.target.split("/").length === LEGACY_V3_RELATIVE.split("/").length + 1 &&
			entry.target.endsWith(`/${sourceBase}`)
		) {
			assertNoSymlinkParentSegments(root, entry.target);
			return;
		}
	}
	throw new Error(`migration marker entry ${index} is not an emitted mapping: ${source} -> ${String(entry.target)}`);
}

/** Duplicate and case-collision checks across the whole recovered marker. */
function validateMarkerEntrySet(entries: MigrationManifestEntry[]): void {
	const sources = new Set<string>();
	const targets = new Map<string, string>();
	for (const entry of entries) {
		// review-2: record each normalized source and reject any duplicate
		// source or target (exact or case-fold).
		if (sources.has(entry.source))
			throw new Error(`migration marker contains a duplicate source: ${entry.source}`);
		sources.add(entry.source);
		if (entry.target === null) continue;
		const tgtKey = entry.target.toLowerCase();
		const priorTarget = targets.get(tgtKey);
		if (priorTarget !== undefined)
			throw new Error(`migration marker contains a duplicate or case-colliding target: ${priorTarget} and ${entry.target}`);
		targets.set(tgtKey, entry.target);
	}
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
	validateMarkerEntrySet(raw.entries as MigrationManifestEntry[]);
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
				rmSync(path, { recursive: true, force: true });
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
	const initial = inspectStorageLayout(root);
	if (["ready", "migration_uncommitted"].includes(initial.layout))
		return {
			contract: "immune_brain/storage_layout_migration_result/v1",
			outcome: initial.layout === "ready" ? "already_migrated" : "migration_uncommitted",
			affected_paths: initial.dirty_affected_paths,
			reason: initial.reason,
		};
	if (["migration_blocked_active", "invalid"].includes(initial.layout))
		return {
			contract: "immune_brain/storage_layout_migration_result/v1",
			outcome: initial.layout,
			affected_paths: [],
			reason: initial.reason,
		};

	const oldLock = resolve(root, LEGACY_TASKS_RELATIVE, ".workspace.lock");
	const newLock = resolve(root, ".imm/state/locks/kernel-store.lock");

	// recovery_required: a migration marker is replayed under the dual lock;
	// a Kernel transaction marker must be recovered by the Kernel runtime.
	if (initial.layout === "recovery_required") {
		const marker = readPendingMigrationMarker(root);
		if (!marker)
			return {
				contract: "immune_brain/storage_layout_migration_result/v1",
				outcome: "recovery_required",
				affected_paths: [],
				reason: initial.reason,
			};
		withExclusiveFileLock(oldLock, () => {
			withExclusiveFileLock(newLock, () => {
				for (const entry of marker.entries) convergeRelocation(root, entry);
				removeMigrationMarker(root);
			});
		});
		// Lock files were removed by the lock holders; now the emptied legacy
		// directories can disappear too.
		removeEmptyLegacyDirectories(root);
		return {
			contract: "immune_brain/storage_layout_migration_result/v1",
			outcome: "migrated",
			affected_paths: marker.entries.flatMap((entry) => [entry.source, entry.target].filter((p): p is string => p !== null)),
			reason: "recovered the pending migration manifest idempotently",
		};
	}

	// migration_required: eligibility checks, Git cleanliness, and the frozen
	// manifest build ALL happen under the dual lock so no old-runtime
	// mutation can slip into the check-to-lock window (review-2).
	const outcome = withExclusiveFileLock(oldLock, () => {
		return withExclusiveFileLock(newLock, () => {
			const inspection = inspectStorageLayout(root);
			if (inspection.layout !== "migration_required")
				return {
					contract: "immune_brain/storage_layout_migration_result/v1",
					outcome: inspection.layout === "ready" ? "already_migrated" : inspection.layout as MigrationOutcome["outcome"],
					affected_paths: inspection.dirty_affected_paths,
					reason: inspection.reason,
				} as MigrationOutcome;
			const dirty = affectedGitDirty(root);
			if (dirty.length > 0)
				return {
					contract: "immune_brain/storage_layout_migration_result/v1",
					outcome: "migration_uncommitted",
					affected_paths: dirty,
					reason: "affected legacy/audit paths differ from HEAD; commit or restore them before migration",
				} as MigrationOutcome;
			const { manifest, affected } = buildManifest(root);
			if (manifest.entries.length === 0)
				return {
					contract: "immune_brain/storage_layout_migration_result/v1",
					outcome: "already_migrated",
					affected_paths: [],
					reason: "no legacy evidence remains to relocate",
				} as MigrationOutcome;
			writeMigrationMarker(root, manifest);
			try {
				for (const entry of manifest.entries) convergeRelocation(root, entry);
				removeMigrationMarker(root);
			} catch (error) {
				throw new Error(
					`migration failed and remains recoverable from the frozen manifest: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			removeEmptyLegacyDirectories(root);
			return {
				contract: "immune_brain/storage_layout_migration_result/v1",
				outcome: "migrated",
				affected_paths: affected,
				reason: "relocated legacy evidence without mutating the Git index; commit the affected paths and retry the original operation",
			} as MigrationOutcome;
		});
	});
	removeEmptyLegacyDirectories(root);
	return outcome;
}