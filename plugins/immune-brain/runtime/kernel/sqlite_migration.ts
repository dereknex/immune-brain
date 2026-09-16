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
	KERNEL_DB_RELATIVE,
	LEGACY_TASKS_RELATIVE,
	STATE_RELATIVE,
	auditTaskRecordPath,
	auditTerminalProofPath,
} from "./storage_paths";
import {
	createMigrationStoreFile,
	insertRunRow,
	publishMigrationStoreFile,
	updateRunTerminal,
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

interface LegacyTask {
	taskId: string;
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
 * Read every legacy terminal task. A record that cannot be parsed, is not
 * terminal, or has no matching terminal proof refuses the whole import: a
 * partial authority import is worse than none.
 */
function readLegacyTasks(root: string): { tasks: LegacyTask[]; reason: string | null } {
	const directory = join(root, LEGACY_TASKS_RELATIVE);
	if (!existsSync(directory)) return { tasks: [], reason: null };
	const tasks: LegacyTask[] = [];
	const seenFolded = new Map<string, string>();
	for (const entry of readdirSync(directory).sort()) {
		if (!entry.endsWith(".json") || entry.endsWith(".backend-claim.json") || entry.startsWith(".")) continue;
		const taskId = entry.slice(0, -".json".length);
		const recordPath = join(directory, entry);
		const proofPath = join(directory, `${taskId}.backend-claim.json`);
		if (!statSync(recordPath).isFile()) return { tasks: [], reason: `${LEGACY_TASKS_RELATIVE}/${entry} is not a regular file` };
		if (!existsSync(proofPath)) return { tasks: [], reason: `task ${taskId} has no terminal proof` };
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
		// the default case-insensitive filesystem, so the import refuses rather
		// than merging or overwriting one task's history.
		const folded = taskId.toLowerCase();
		const previous = seenFolded.get(folded);
		if (previous !== undefined && previous !== taskId)
			return { tasks: [], reason: `case-fold source collision between ${previous} and ${taskId}` };
		seenFolded.set(folded, taskId);
		tasks.push({
			taskId,
			recordBytes,
			recordJson: `${JSON.stringify(record, null, 2)}\n`,
			proofBytes,
			proofJson: `${JSON.stringify(proof, null, 2)}\n`,
			recordHash,
			state: record.lifecycle,
			importedAt: typeof proof.terminalized_at === "string" ? proof.terminalized_at : new Date(0).toISOString(),
		});
	}
	return { tasks, reason: null };
}

/** Deterministic run identity: the same legacy facts always import to one run. */
function migratedRunId(task: LegacyTask): string {
	return `run-migrated-${createHash("sha256").update(`${task.taskId}:${task.recordHash}`).digest("hex").slice(0, 24)}`;
}

/**
 * Copy the historical bytes into tracked audit evidence. This is the only place
 * the importer writes evidence, and it never rewrites a file that already
 * exists with different bytes.
 */
function writeAuditEvidence(root: string, task: LegacyTask): void {
	const recordPath = join(root, auditTaskRecordPath(task.taskId));
	const proofPath = join(root, auditTerminalProofPath(task.taskId));
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
	const db = new DatabaseSync(target, { readOnly: true });
	try {
		const rows = db.prepare("SELECT run_id, task_id, state, record_json, intent_content_hash, claim_status FROM runs ORDER BY task_id").all() as Array<Record<string, unknown>>;
		if (rows.length !== tasks.length) throw new Error(`candidate store holds ${rows.length} run(s), expected ${tasks.length}`);
		for (const [index, task] of [...tasks].sort((left, right) => left.taskId.localeCompare(right.taskId)).entries()) {
			const row = rows[index];
			if (row.task_id !== task.taskId) throw new Error(`candidate store row ${index} is ${String(row.task_id)}, expected ${task.taskId}`);
			if (row.run_id !== migratedRunId(task)) throw new Error(`candidate store run identity differs for ${task.taskId}`);
			if (row.state !== task.state) throw new Error(`candidate store state differs for ${task.taskId}`);
			if (row.claim_status !== null) throw new Error(`candidate store kept a live claim for ${task.taskId}`);
			if (String(row.record_json) !== task.recordJson) throw new Error(`candidate store record bytes differ for ${task.taskId}`);
			if (row.intent_content_hash !== task.recordHash) throw new Error(`candidate store record hash differs for ${task.taskId}`);
			if (canonicalRecordHash(parseTaskRecordV3(JSON.parse(String(row.record_json)))) !== canonicalRecordHash(parseTaskRecordV3(JSON.parse(task.recordJson))))
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
	const directory = join(root, LEGACY_TASKS_RELATIVE);
	for (const task of tasks) {
		rmSync(join(directory, `${task.taskId}.json`), { force: true });
		rmSync(join(directory, `${task.taskId}.backend-claim.json`), { force: true });
	}
	rmSync(join(root, ".imm", "workspace.json"), { force: true });
	if (existsSync(directory) && readdirSync(directory).length === 0) rmSync(directory, { recursive: true, force: true });
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
	if (existsSync(canonical)) {
		const receipt = readReceipt(root);
		if (!receipt) return refusal("a kernel store already exists; the importer never overwrites one");
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
	const receipt = readReceipt(root);
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
		publishMigrationStoreFile(root, join(root, MIGRATION_STORE_RELATIVE));
		writeFileSync(
			join(root, MIGRATION_RECEIPT_RELATIVE),
			`${JSON.stringify({
				contract: "assurance_kernel/sqlite_import_receipt/v1",
				imported_at: now,
				identity,
				task_ids: tasks.map((task) => task.taskId).sort(),
			}, null, 2)}\n`,
		);
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
