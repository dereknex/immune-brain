/**
 * Explicit claimless import of the retired file store into the SQLite authority.
 *
 * The legacy layout is authority for at most terminal tasks: an owner-free,
 * committed worktree whose tasks all settled. The importer therefore refuses
 * any layout that still carries live authority, copies each legacy record's raw
 * bytes into tracked audit evidence first, builds a candidate store at
 * `.imm/state/kernel.sqlite.importing`, verifies it row by row, and only then
 * publishes it with one rename. A crash before the rename leaves the canonical
 * store absent; a crash after it leaves a complete store, so no reader observes
 * a half-imported database. Retry is idempotent through the recorded receipt.
 */
import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
	FILE_STORE_CLAIM_RELATIVE,
	FILE_STORE_TASKS_RELATIVE,
	FILE_STORE_WORKSPACE_RELATIVE,
	KERNEL_DB_RELATIVE,
	LEGACY_TASKS_RELATIVE,
	LEGACY_WORKSPACE_RELATIVE,
	STATE_RELATIVE,
	auditTaskRecordPath,
	auditTerminalProofPath,
} from "./storage_paths";
import {
	createMigrationStoreFile,
	insertRunRow,
	publishMigrationStoreFile,
	updateRunTerminal,
	verifyStoreFile,
} from "./sqlite_store";
import { parseTaskRecordV3 } from "./validation";
import { canonicalRecordHash } from "./reducer";

/** The candidate store the importer builds before publication. */
export const MIGRATION_STORE_RELATIVE = `${KERNEL_DB_RELATIVE}.importing`;
/** Import identity of a published migration, used to make retry idempotent. */
export const MIGRATION_RECEIPT_RELATIVE = `${STATE_RELATIVE}/migration-receipt.json`;

export interface SqliteImportOutcome {
	contract: "assurance_kernel/sqlite_import_result/v1";
	outcome: "imported" | "already_imported" | "refused" | "failed";
	reason: string | null;
	imported_task_ids: string[];
	/** Paths that must be committed before the source may be retired. */
	uncommitted_evidence: string[];
}

interface LegacySource {
	directory: string;
	recordFile: string;
	/** Beside the record in the oldest layout; null when the proof is tracked audit evidence. */
	proofFile: string | null;
}

interface LegacyTask {
	taskId: string;
	sources: LegacySource[];
	recordBytes: Buffer;
	recordJson: string;
	proofBytes: Buffer;
	proofJson: string;
	recordHash: string;
	state: "done" | "stopped";
	importedAt: string;
}

function refusal(reason: string, uncommitted: string[] = []): SqliteImportOutcome {
	return {
		contract: "assurance_kernel/sqlite_import_result/v1",
		outcome: "refused",
		reason,
		imported_task_ids: [],
		uncommitted_evidence: uncommitted,
	};
}

/**
 * Historical bytes are only safe to retire once the audit copies that preserve
 * them are committed, so the import stops after writing evidence and the
 * operator commits those paths before rerunning it.
 */
function uncommittedEvidencePaths(root: string, paths: string[]): string[] {
	const result = spawnSync("git", ["-C", root, "status", "--porcelain", "--", ...paths], { encoding: "utf8" });
	if (result.status !== 0) return paths;
	return result.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => line.replace(/^\S+\s+/, ""));
}

function sha256Hex(bytes: Buffer | string): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function readReceipt(root: string): { identity: string; task_ids: string[] } | null {
	const path = join(root, MIGRATION_RECEIPT_RELATIVE);
	if (!existsSync(path)) return null;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		if (parsed.contract !== "assurance_kernel/sqlite_import_receipt/v1") return null;
		if (typeof parsed.identity !== "string" || !Array.isArray(parsed.task_ids)) return null;
		return { identity: parsed.identity, task_ids: parsed.task_ids.map(String) };
	} catch {
		return null;
	}
}

/** Any batch state that is not terminal still owns work, so the layout is live. */
function recoverableBatch(root: string): string | null {
	const directory = join(root, STATE_RELATIVE, "batches");
	if (!existsSync(directory)) return null;
	for (const entry of readdirSync(directory).sort()) {
		if (!entry.endsWith(".json")) continue;
		try {
			const parsed = JSON.parse(readFileSync(join(directory, entry), "utf8")) as Record<string, unknown>;
			const state = typeof parsed.batch_state === "string" ? parsed.batch_state : null;
			if (state === "completed" || state === "stopped") continue;
			return `batch ${entry} is not terminal (${state ?? "unknown"})`;
		} catch {
			return `batch ${entry} is unreadable`;
		}
	}
	return null;
}
/**
 * Read every legacy terminal task from both retired layouts: `.imm/tasks`
 * (pre-cutover owner files) and `.imm/state/tasks` (the v4 file store this
 * release retires). A record that cannot be parsed, is not terminal, or has no
 * matching terminal proof refuses the whole import: a partial authority import
 * is worse than none.
 */
function readLegacyTasks(root: string): { tasks: LegacyTask[]; reason: string | null } {
	const tasks: LegacyTask[] = [];
	const byId = new Map<string, LegacyTask>();
	const seenFolded = new Map<string, string>();
	for (const relative of [LEGACY_TASKS_RELATIVE, FILE_STORE_TASKS_RELATIVE]) {
		const directory = join(root, relative);
		if (!existsSync(directory)) continue;
		if (lstatSync(directory).isSymbolicLink()) return { tasks: [], reason: `${relative} is a symlink` };
		for (const entry of readdirSync(directory).sort()) {
			if (!entry.endsWith(".json") || entry.endsWith(".backend-claim.json") || entry.startsWith(".")) continue;
			const taskId = entry.slice(0, -".json".length);
			const recordPath = join(directory, entry);
			// The v4 file store kept its records under .imm/state/tasks and its
			// terminal proofs as tracked audit evidence; the older layout kept the
			// proof beside the record.
			const besideRecord = relative === LEGACY_TASKS_RELATIVE;
			const proofRelative = besideRecord ? null : auditTerminalProofPath(taskId);
			const proofPath = besideRecord ? join(directory, `${taskId}.backend-claim.json`) : join(root, proofRelative!);
			if (!statSync(recordPath).isFile()) return { tasks: [], reason: `${relative}/${entry} is not a regular file` };
			if (!existsSync(proofPath))
				return {
					tasks: [],
					reason: besideRecord
						? `task ${taskId} has no terminal proof`
						: `task ${taskId} has no tracked terminal proof at ${proofRelative}`,
				};
			const recordBytes = readFileSync(recordPath);
			const proofBytes = readFileSync(proofPath);
			let record: ReturnType<typeof parseTaskRecordV3>;
			try {
				record = parseTaskRecordV3(JSON.parse(recordBytes.toString("utf8")));
			} catch (error) {
				return { tasks: [], reason: `task ${taskId} is not a readable legacy record: ${error instanceof Error ? error.message : String(error)}` };
			}
			if (record.lifecycle !== "done" && record.lifecycle !== "stopped")
				return { tasks: [], reason: `task ${taskId} is ${record.lifecycle}; a live legacy task must settle on the prior runtime` };
			let proof: Record<string, unknown>;
			try {
				proof = JSON.parse(proofBytes.toString("utf8")) as Record<string, unknown>;
			} catch {
				return { tasks: [], reason: `task ${taskId} has an unreadable terminal proof` };
			}
			if (proof.contract !== "assurance_kernel/task_tombstone/v2" || proof.task_id !== taskId)
				return { tasks: [], reason: `task ${taskId} terminal proof does not match its record` };
			// The record hash is the historical identity: the raw bytes the previous
			// runtime committed, not a re-serialization of the parsed value.
			const recordHash = sha256Hex(recordBytes);
			if (proof.final_record_hash !== recordHash)
				return { tasks: [], reason: `task ${taskId} terminal proof does not bind its record bytes` };
			if (proof.terminal_lifecycle !== undefined && proof.terminal_lifecycle !== record.lifecycle)
				return { tasks: [], reason: `task ${taskId} terminal proof lifecycle does not match its record` };
			// Two task ids that differ only by case cannot keep distinct evidence on
			// the default case-insensitive filesystem, and the same id in both
			// layouts is an ambiguous authority, so the import refuses both.
			const folded = taskId.toLowerCase();
			const foldedOwner = seenFolded.get(folded);
			if (foldedOwner !== undefined && foldedOwner !== taskId)
				return { tasks: [], reason: `case-fold source collision between ${foldedOwner} and ${taskId}` };
			seenFolded.set(folded, taskId);
			if (byId.has(taskId)) return { tasks: [], reason: `task ${taskId} exists in more than one legacy layout` };
			const task: LegacyTask = {
				taskId,
				sources: [{ directory: relative, recordFile: entry, proofFile: besideRecord ? `${taskId}.backend-claim.json` : null }],
				recordBytes,
				recordJson: `${JSON.stringify(record, null, 2)}\n`,
				proofBytes,
				proofJson: `${JSON.stringify(proof, null, 2)}\n`,
				recordHash,
				state: record.lifecycle,
				importedAt: typeof proof.terminalized_at === "string" ? proof.terminalized_at : new Date(0).toISOString(),
			};
			byId.set(taskId, task);
			tasks.push(task);
		}
	}
	return { tasks, reason: null };
}


/** Deterministic run identity: the same legacy facts always import to one run. */
function migratedRunId(task: LegacyTask): string {
	return `run-migrated-${createHash("sha256").update(`${task.taskId}:${task.recordHash}`).digest("hex").slice(0, 24)}`;
}

/**
 * Refuse to write through any symlinked segment of an evidence path: the audit
 * directory is inside the worktree, and a linked subdirectory would let a
 * legitimate-looking import write outside it.
 */
function assertNoSymlinkSegments(root: string, relativePath: string): void {
	const segments = relativePath.split("/").filter(Boolean);
	let current = root;
	for (const segment of segments) {
		current = join(current, segment);
		if (!existsSync(current)) break;
		if (lstatSync(current).isSymbolicLink())
			throw new Error(`symlinked evidence path is forbidden during import: ${relativePath}`);
	}
}

/** Whether this worktree already recorded a completed import identity. */
export function hasMigrationReceipt(rootInput: string): boolean {
	return readReceipt(realpathSync(rootInput)) !== null;
}

/**
 * Copy the historical bytes into tracked audit evidence. This is the only place
 * the importer writes evidence, and it never rewrites a file that already
 * exists with different bytes.
 */
function writeAuditEvidence(root: string, task: LegacyTask): void {
	const recordPath = join(root, auditTaskRecordPath(task.taskId));
	const proofPath = join(root, auditTerminalProofPath(task.taskId));
	for (const relative of [auditTaskRecordPath(task.taskId), auditTerminalProofPath(task.taskId)])
		assertNoSymlinkSegments(root, relative);
	mkdirSync(dirname(recordPath), { recursive: true });
	for (const [path, bytes] of [[recordPath, task.recordBytes], [proofPath, task.proofBytes]] as const) {
		if (existsSync(path)) {
			if (!readFileSync(path).equals(bytes))
				throw new Error(`audit evidence already exists with different bytes: ${path}`);
			continue;
		}
		writeFileSync(path, bytes);
	}
}

function buildCandidateStore(root: string, tasks: LegacyTask[], now: string): void {
	const target = join(root, MIGRATION_STORE_RELATIVE);
	createMigrationStoreFile(root, target, now);
	const db = new DatabaseSync(target);
	try {
		db.exec("BEGIN IMMEDIATE");
		try {
			for (const task of tasks) {
				insertRunRow(db, {
					run_id: migratedRunId(task),
					task_id: task.taskId,
					record_json: task.recordJson,
					intent_revision: 1,
					intent_content_hash: task.recordHash,
					enrollment_event_id: `migrated:${task.taskId}`,
					claim_status: "active",
					created_at: task.importedAt,
					updated_at: task.importedAt,
				});
				updateRunTerminal(db, migratedRunId(task), task.state, task.recordJson, `${task.proofJson}`, task.importedAt);
			}
			db.exec("COMMIT");
			// Fold the WAL back into the main file so publication moves exactly
			// one self-contained database.
			db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
			db.exec("PRAGMA journal_mode=DELETE");
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
	} finally {
		db.close();
	}
}

/** Verify the candidate store row by row before anything is published. */
function verifyCandidateStore(root: string, tasks: LegacyTask[]): void {
	const target = join(root, MIGRATION_STORE_RELATIVE);
	// Schema version and worktree binding are verified before any row compare, so
	// a candidate built for another worktree can never be published here.
	verifyStoreFile(root, target);
	const db = new DatabaseSync(target, { readOnly: true });
	try {
		const rows = db
			.prepare("SELECT run_id, task_id, state, record_json, terminal_proof_json, intent_content_hash, claim_status FROM runs")
			.all() as Array<Record<string, unknown>>;
		if (rows.length !== tasks.length) throw new Error(`candidate store holds ${rows.length} run(s), expected ${tasks.length}`);
		const byTask = new Map(rows.map((row) => [String(row.task_id), row]));
		for (const task of tasks) {
			const row = byTask.get(task.taskId);
			if (!row) throw new Error(`candidate store is missing ${task.taskId}`);
			if (row.run_id !== migratedRunId(task)) throw new Error(`candidate store run identity differs for ${task.taskId}`);
			if (row.state !== task.state) throw new Error(`candidate store state differs for ${task.taskId}`);
			if (row.claim_status !== null) throw new Error(`candidate store kept a live claim for ${task.taskId}`);
			if (String(row.record_json) !== task.recordJson) throw new Error(`candidate store record bytes differ for ${task.taskId}`);
			if (String(row.terminal_proof_json) !== task.proofJson) throw new Error(`candidate store terminal proof differs for ${task.taskId}`);
			if (row.intent_content_hash !== task.recordHash) throw new Error(`candidate store record hash differs for ${task.taskId}`);
			if (
				canonicalRecordHash(parseTaskRecordV3(JSON.parse(String(row.record_json)))) !==
				canonicalRecordHash(parseTaskRecordV3(JSON.parse(task.recordJson)))
			)
				throw new Error(`candidate store record is not canonical for ${task.taskId}`);
		}
		const workspace = db.prepare("SELECT current_run_id FROM workspace WHERE id = 1").get() as Record<string, unknown> | undefined;
		if (!workspace) throw new Error("candidate store has no workspace row");
		if (workspace.current_run_id !== null) throw new Error("candidate store claims a current run");
	} finally {
		db.close();
	}
}

/**
 * Remove the retired authority once the published store owns it. The raw bytes
 * are already preserved as audit evidence, so this deletes a second authority
 * source rather than history.
 */
function removeRetiredAuthority(root: string, tasks: LegacyTask[]): void {
	for (const task of tasks) {
		for (const source of task.sources) {
			rmSync(join(root, source.directory, source.recordFile), { force: true });
			// A proof that lives in the audit tree is preserved evidence, not
			// retired authority: only a beside-the-record proof is removed.
			if (source.proofFile) rmSync(join(root, source.directory, source.proofFile), { force: true });
		}
	}
	for (const relative of [FILE_STORE_CLAIM_RELATIVE, FILE_STORE_WORKSPACE_RELATIVE, LEGACY_WORKSPACE_RELATIVE])
		rmSync(join(root, relative), { force: true });
	for (const relative of [LEGACY_TASKS_RELATIVE, FILE_STORE_TASKS_RELATIVE]) {
		const directory = join(root, relative);
		if (existsSync(directory) && readdirSync(directory).length === 0) rmSync(directory, { recursive: true, force: true });
	}
}

function importIdentity(tasks: LegacyTask[]): string {
	return sha256Hex(tasks.map((task) => `${task.taskId}:${task.recordHash}`).sort().join("\n"));
}

/**
 * Import the retired file store into the SQLite authority. `now` stamps the
 * store's creation metadata; it never rewrites historical evidence.
 */
export function importLegacyWorkspace(rootInput: string, now = new Date().toISOString()): SqliteImportOutcome {
	// Bind one canonical root: a temp-directory root on macOS reaches the same
	// files through /var and /private/var, and mixing them would look like a
	// traversal attempt to the store's path safety checks.
	const root = realpathSync(rootInput);
	const canonical = join(root, KERNEL_DB_RELATIVE);
	const receipt = readReceipt(root);
	if (existsSync(canonical)) {
		if (!receipt) return refusal("a kernel store already exists; the importer never overwrites one");
		// The publication rename already happened. Verify the published store and
		// finish any cleanup the crash interrupted instead of refusing the retry.
		try {
			verifyStoreFile(root, canonical);
		} catch (error) {
			return refusal(`the published store failed verification: ${error instanceof Error ? error.message : String(error)}`);
		}
		const pending = readLegacyTasks(root);
		if (pending.reason) return refusal(pending.reason);
		if (pending.tasks.length > 0) {
			if (importIdentity(pending.tasks) !== receipt.identity)
				return refusal("the recorded import identity does not match the remaining legacy facts");
			removeRetiredAuthority(root, pending.tasks);
		}
		return {
			contract: "assurance_kernel/sqlite_import_result/v1",
			outcome: "already_imported",
			reason: null,
			imported_task_ids: receipt.task_ids,
			uncommitted_evidence: [],
		};
	}
	const live = recoverableBatch(root);
	if (live) return refusal(`${live}; a recoverable batch must be settled or stopped before import`);
	const { tasks, reason } = readLegacyTasks(root);
	if (reason) return refusal(reason);
	if (tasks.length === 0) return refusal("no legacy terminal task is present to import");
	const identity = importIdentity(tasks);
	if (receipt && receipt.identity !== identity)
		return refusal("the recorded import identity does not match the legacy facts");
	try {
		for (const task of tasks) writeAuditEvidence(root, task);
		const evidencePaths = tasks.flatMap((task) => [auditTaskRecordPath(task.taskId), auditTerminalProofPath(task.taskId)]);
		const dirty = uncommittedEvidencePaths(root, evidencePaths);
		const candidateReady = existsSync(join(root, MIGRATION_STORE_RELATIVE));
		if (dirty.length > 0 && !candidateReady)
			return refusal("the preserved audit evidence is not committed yet", dirty);
		if (!candidateReady) buildCandidateStore(root, tasks, now);
		verifyCandidateStore(root, tasks);
		// The receipt is written before publication so a crash between the rename
		// and the cleanup still leaves a retry that converges: the next run finds
		// the store, verifies it, and finishes removing the retired files.
		writeFileSync(
			join(root, MIGRATION_RECEIPT_RELATIVE),
			`${JSON.stringify({
				contract: "assurance_kernel/sqlite_import_receipt/v1",
				imported_at: now,
				identity,
				task_ids: tasks.map((task) => task.taskId).sort(),
			}, null, 2)}\n`,
		);
		publishMigrationStoreFile(root, join(root, MIGRATION_STORE_RELATIVE));
		removeRetiredAuthority(root, tasks);
		return {
			contract: "assurance_kernel/sqlite_import_result/v1",
			outcome: "imported",
			reason: null,
			imported_task_ids: tasks.map((task) => task.taskId).sort(),
			uncommitted_evidence: [],
		};
	} catch (error) {
		return {
			contract: "assurance_kernel/sqlite_import_result/v1",
			outcome: "failed",
			reason: error instanceof Error ? error.message : String(error),
			imported_task_ids: [],
			uncommitted_evidence: [],
		};
	}
}

/** Read-only diagnosis of an interrupted import, for operators and tests. */
export function inspectImportState(root: string): { candidate: boolean; receipt: boolean } {
	return {
		candidate: existsSync(resolve(root, MIGRATION_STORE_RELATIVE)),
		receipt: existsSync(resolve(root, MIGRATION_RECEIPT_RELATIVE)),
	};
}
