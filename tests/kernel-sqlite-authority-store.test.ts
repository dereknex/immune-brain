/**
 * S1 acceptance: the SQLite authority store is the single transaction boundary.
 *
 * A1 one enrollment commits one run + owner + claim together, or nothing.
 * A2 revisions are monotonic integers: a stale writer is refused, never merged.
 * A3 a lost response replays from committed facts; an interrupted audit export
 *    stays retryable and never reactivates a settled run.
 * A4 a competing writer either waits for the committed fact or fails closed;
 *    an absent or incompatible store never recovers silently.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
	commitEnrollmentLocked,
	commitTerminalLocked,
	commitTaskRecordLocked,
	readAuditTaskPair,
	readTaskRecordRaw,
	readWorkspaceStateRaw,
	KernelSchemaError,
	KernelStoreConflictError,
	KernelStoreSecurityError,
	reconcileKernelAuthority,
	repairKernelAuthority,
	retryStoreFollowUps,
	revisionForContent,
	serializeWorkspace,
} from "../plugins/immune-brain/runtime/kernel/storage";
import {
	activeRunId,
	insertRunRow,
	openKernelStore,
	readOperationRow,
	readRunRowByTask,
	readRunRowById,
	readWorkspaceRow,
	withKernelRead,
	withKernelTransaction,
} from "../plugins/immune-brain/runtime/kernel/sqlite_store";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { canonicalRecordHash } from "../plugins/immune-brain/runtime/kernel/reducer";
import { KERNEL_STORE_SCHEMA_VERSION } from "../plugins/immune-brain/runtime/kernel/sqlite_store";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";

const TASK = "store-task";
const OTHER = "store-other";
const NOW = "2026-08-12T10:00:00.000Z";
const LATER = "2026-08-12T10:00:05.000Z";

const roots: string[] = [];

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "kernel-store-"));
	roots.push(root);
	execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "store fixture",
	acceptance: [{ id: "A1", assertion: "a1", verification: "bun test tests/x.test.ts" }],
	scope_hint: ["docs/plans"],
	risk: "routine" as const,
	revision: 1,
	owner: "user",
};
const INTENT_HASH = canonicalIntentHash(parseTaskIntentV1(INTENT));

function activeRecord(taskId = TASK): Record<string, unknown> {
	const snapshot = { ...INTENT, task_id: taskId };
	return {
		contract: "assurance_kernel/task_record/v4",
		task_id: taskId,
		intent_snapshot: snapshot,
		intent_ref: {
			path: `docs/plans/${taskId}.intent.json`,
			content_hash: canonicalIntentHash(parseTaskIntentV1(snapshot)),
		},
		lifecycle: "active",
		artifact_state: "active",
		baseline: `sha256:${"a".repeat(64)}`,
		git_base_head: "a".repeat(40),
		attestations: [],
		findings: [],
		history: [],
	};
}

function terminalRecord(taskId = TASK): Record<string, unknown> {
	return {
		...activeRecord(taskId),
		lifecycle: "done",
		artifact_state: "frozen",
		intent_ref: {
			path: `docs/plans/archive/${taskId}.intent.json`,
			content_hash: canonicalIntentHash(parseTaskIntentV1({ ...INTENT, task_id: taskId })),
		},
	};
}

function claimFor(taskId = TASK): Record<string, unknown> {
	return {
		contract: "assurance_kernel/backend_claim/v2",
		backend: "kernel",
		task_id: taskId,
		intent_revision: 1,
		intent_content_hash: canonicalIntentHash(parseTaskIntentV1({ ...INTENT, task_id: taskId })),
		enrollment_event_id: `enroll-${taskId}-${NOW}`,
		lifecycle_status: "active",
		created_at: NOW,
		updated_at: NOW,
	};
}

function enroll(root: string, taskId = TASK): { runId: string } {
	const recordBytes = `${JSON.stringify(activeRecord(taskId), null, 2)}\n`;
	const before = readWorkspaceStateRaw(root);
	const mutation = commitEnrollmentLocked(
		root,
		taskId,
		{
			contract: "assurance_kernel/workspace_transaction/v2",
			task_id: taskId,
			expected_record_hash: before.revision,
			next_record_content: recordBytes,
			expected_workspace_hash: before.revision,
			next_workspace_content: serializeWorkspace({
				contract: "assurance_kernel/workspace/v1",
				current_working: taskId,
			}),
		},
		claimFor(taskId),
	);
	expect(mutation.record.task_id).toBe(taskId);
	const run = withKernelRead(root, (db) => readRunRowByTask(db, taskId))!;
	return { runId: run.run_id };
}

describe("A1 single worktree authority", () => {
	test("one transaction writes the run, the owner and the derived claim together", () => {
		const root = tempRoot();
		const { runId } = enroll(root);
		const run = withKernelRead(root, (db) => readRunRowById(db, runId))!;
		expect(run.state).toBe("active");
		expect(run.claim_status).toBe("active");
		expect(withKernelRead(root, (db) => activeRunId(db))).toBe(runId);
		expect(readWorkspaceStateRaw(root).state.current_working).toBe(TASK);
		// No retired file store is created by the commit.
		expect(existsSync(join(root, ".imm/state/workspace.json"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/active-claim.json"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/tasks"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/transactions"))).toBe(false);
	});

	test("a second enrollment is refused while one owner is active", () => {
		const root = tempRoot();
		enroll(root);
		expect(() => enroll(root, OTHER)).toThrow(KernelStoreConflictError);
		// The refusal wrote nothing: the original owner is intact and the
		// rejected task has no run row.
		expect(readWorkspaceStateRaw(root).state.current_working).toBe(TASK);
		expect(withKernelRead(root, (db) => readRunRowByTask(db, OTHER))).toBeNull();
	});

	test("a failed commit leaves no partial authority and no owner", () => {
		const root = tempRoot();
		const recordBytes = `${JSON.stringify(activeRecord(), null, 2)}\n`;
		const before = readWorkspaceStateRaw(root);
		expect(() =>
			withKernelTransaction(root, (db) => {
				insertRunRow(db, {
					run_id: "run-partial",
					task_id: TASK,
					record_json: recordBytes,
					intent_revision: 1,
					intent_content_hash: INTENT_HASH,
					enrollment_event_id: "enroll-x",
					claim_status: "active",
					created_at: NOW,
					updated_at: NOW,
				});
				throw new Error("simulated crash before commit");
			}),
		).toThrow(/simulated crash before commit/);
		expect(withKernelRead(root, (db) => readRunRowByTask(db, TASK))).toBeNull();
		expect(withKernelRead(root, (db) => readWorkspaceRow(db))?.current_run_id).toBeNull();
		expect(readWorkspaceStateRaw(root).state.current_working).toBe(before.state.current_working);
	});
});

describe("A2 revision-checked writes", () => {
	test("a superseded writer is refused instead of merged", () => {
		const root = tempRoot();
		enroll(root);
		const run = withKernelRead(root, (db) => readRunRowByTask(db, TASK))!;
		const stale = canonicalRecordHash(JSON.parse(run.record_json) as never);
		const record = JSON.parse(run.record_json) as Record<string, unknown>;
		record.baseline = `sha256:${"b".repeat(64)}`;
		const nextBytes = `${JSON.stringify(record, null, 2)}\n`;
		commitTaskRecordLocked(
			root,
			TASK,
			stale,
			record as never,
			readWorkspaceStateRaw(root).revision,
			{ contract: "assurance_kernel/workspace/v1", current_working: TASK },
		);
		// The first write moved the record identity; the second one is refused.
		expect(() =>
			commitTaskRecordLocked(
				root,
				TASK,
				stale,
				record as never,
				readWorkspaceStateRaw(root).revision,
				{ contract: "assurance_kernel/workspace/v1", current_working: TASK },
			),
		).toThrow(KernelStoreConflictError);
		expect(withKernelRead(root, (db) => readRunRowByTask(db, TASK))?.record_json).toBe(nextBytes);
	});

	test("a deleted store never recovers silently", () => {
		const root = tempRoot();
		enroll(root);
		rmSync(join(root, ".imm/state/kernel.sqlite"), { force: true });
		rmSync(join(root, ".imm/state/kernel.sqlite-wal"), { force: true });
		rmSync(join(root, ".imm/state/kernel.sqlite-shm"), { force: true });
		// Absent facts read as absent; nothing is reconstructed from the code or
		// from any leftover file.
		expect(readTaskRecordRaw(root, TASK).record).toBeNull();
		expect(readWorkspaceStateRaw(root).state.current_working).toBeNull();
		expect(reconcileKernelAuthority(root, TASK).state).toBe("unowned");
	});

	test("an incompatible store schema is refused", () => {
		const root = tempRoot();
		enroll(root);
		const db = openKernelStore(root, { create: false })!;
		db.prepare("UPDATE store_meta SET value = ? WHERE key = 'schema_version'").run(
			String(KERNEL_STORE_SCHEMA_VERSION + 1),
		);
		db.close();
		expect(() => withKernelRead(root, (inner) => readWorkspaceRow(inner))).toThrow(KernelSchemaError);
		expect(() =>
			commitTaskRecordLocked(root, TASK, "rev:1", activeRecord() as never, "rev:0", {
				contract: "assurance_kernel/workspace/v1",
				current_working: TASK,
			}),
		).toThrow(KernelSchemaError);
	});
});

describe("A3 idempotent replay and auditable follow-ups", () => {
	test("a replayed enrollment returns the committed run instead of writing again", () => {
		const root = tempRoot();
		const { runId } = enroll(root);
		const recordBytes = `${JSON.stringify(activeRecord(), null, 2)}\n`;
		// The same enrollment event arrives twice (a lost response). The stored
		// operation fact decides the outcome, so no second run and no owner race.
		const again = commitEnrollmentLocked(
			root,
			TASK,
			{
				contract: "assurance_kernel/workspace_transaction/v2",
				task_id: TASK,
				expected_record_hash: "rev:0",
				next_record_content: recordBytes,
				expected_workspace_hash: "rev:0",
				next_workspace_content: serializeWorkspace({
					contract: "assurance_kernel/workspace/v1",
					current_working: TASK,
				}),
			},
			claimFor(),
		);
		expect(again.record.task_id).toBe(TASK);
		// Exactly one run exists, and it is the originally committed one.
		expect(withKernelRead(root, (db) => readRunRowByTask(db, TASK))?.run_id).toBe(runId);
		expect(withKernelRead(root, (db) => readRunRowById(db, runId))?.revision).toBe(1);
		const replays = withKernelRead(root, (db) =>
			db
				.prepare("SELECT operation_id FROM operations WHERE kind = 'enrollment'")
				.all() as Array<{ operation_id: string }>,
		)!;
		expect(replays).toHaveLength(1);
	});

	test("settlement commits atomically and an interrupted audit export stays retryable", () => {
		const root = tempRoot();
		enroll(root);
		const run = withKernelRead(root, (db) => readRunRowByTask(db, TASK))!;
		const record = JSON.parse(run.record_json) as Record<string, unknown>;
		record.lifecycle = "done";
		record.artifact_state = "frozen";
		record.intent_ref = { path: `docs/plans/archive/${TASK}.intent.json`, content_hash: INTENT_HASH };
		const terminalBytes = `${JSON.stringify(record, null, 2)}\n`;
		const workspace = readWorkspaceStateRaw(root);
		commitTerminalLocked(
			root,
			TASK,
			{
				contract: "assurance_kernel/workspace_transaction/v2",
				task_id: TASK,
				expected_record_hash: revisionForContent(run.record_json),
				next_record_content: terminalBytes,
				expected_workspace_hash: workspace.revision,
				next_workspace_content: serializeWorkspace({
					contract: "assurance_kernel/workspace/v1",
					current_working: null,
				}),
			},
			{
				contract: "assurance_kernel/task_tombstone/v2",
				task_id: TASK,
				lifecycle_status: "terminal",
				terminal_lifecycle: "done",
				terminal_event_id: `complete:${TASK}:${LATER}`,
				final_record_hash: revisionForContent(terminalBytes),
				terminalized_at: LATER,
			},
		);
		// The settlement is durable as one state: no active run, cleared owner,
		// terminal proof committed.
		expect(withKernelRead(root, (db) => activeRunId(db))).toBeNull();
		expect(withKernelRead(root, (db) => readRunRowByTask(db, TASK))?.state).toBe("done");
		expect(readWorkspaceStateRaw(root).state.current_working).toBeNull();
		const terminalTransaction = {
			contract: "assurance_kernel/workspace_transaction/v2" as const,
			task_id: TASK,
			expected_record_hash: revisionForContent(terminalBytes),
			next_record_content: terminalBytes,
			expected_workspace_hash: readWorkspaceStateRaw(root).revision,
			next_workspace_content: serializeWorkspace({
				contract: "assurance_kernel/workspace/v1",
				current_working: null,
			}),
		};
		const terminalTombstone = {
			contract: "assurance_kernel/task_tombstone/v2" as const,
			task_id: TASK,
			lifecycle_status: "terminal" as const,
			terminal_lifecycle: "done" as const,
			terminal_event_id: `complete:${TASK}:${LATER}`,
			final_record_hash: revisionForContent(terminalBytes),
			terminalized_at: LATER,
		};
		// The same terminal event replays from the committed operation fact: one
		// settlement, reported twice, never a second write.
		const replayed = commitTerminalLocked(root, TASK, terminalTransaction, terminalTombstone);
		expect(replayed.record.lifecycle).toBe("done");
		expect(withKernelRead(root, (db) => readRunRowByTask(db, TASK))?.state).toBe("done");
		// A different terminal event for an already settled run is refused.
		expect(() =>
			commitTerminalLocked(
				root,
				TASK,
				terminalTransaction,
				{ ...terminalTombstone, terminal_event_id: `complete:${TASK}:other` },
			),
		).toThrow(KernelStoreConflictError);
		// The export is a deterministic follow-up: it converges on the next lock
		// and the retry does not change the settled verdict.
		retryStoreFollowUps(root);
		expect(readAuditTaskPair(root, TASK)?.proof.terminal_lifecycle).toBe("done");
		expect(withKernelRead(root, (db) => readRunRowByTask(db, TASK))?.audit_exported_at).not.toBeNull();
		expect(reconcileKernelAuthority(root, TASK).state).toBe("terminal_owner");
	});

	test("a proven stale claim cannot exist, so repair reports the settled authority", () => {
		const root = tempRoot();
		seedKernelRunForTest(root, {
			task_id: TASK,
			record: terminalRecord(),
			created_at: NOW,
			updated_at: NOW,
			terminal: { lifecycle: "done", terminalized_at: LATER },
		});
		retryStoreFollowUps(root);
		// A leftover retired claim file is inert: the store already answers.
		writeFileSync(
			join(root, ".imm/state/active-claim.json"),
			`${JSON.stringify(claimFor(), null, 2)}\n`,
		);
		const projection = reconcileKernelAuthority(root, TASK);
		expect(projection.state).toBe("terminal_owner");
		const repaired = repairKernelAuthority(root, TASK, projection.revision);
		expect(repaired.state).toBe("terminal_owner");
		expect(repaired.owner_task_id).toBe(TASK);
		expect(existsSync(join(root, ".imm/state/active-claim.json"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/transactions/authority-repair-transaction.json"))).toBe(false);
	});
});

describe("A4 isolation and concurrency", () => {
	test("one worktree holds one owner: a competing task is refused, not merged", () => {
		const root = tempRoot();
		enroll(root);
		// A second active run cannot be inserted at all — not even as an orphan
		// row — which is what makes the derived owner single-valued.
		expect(() =>
			seedKernelRunForTest(root, {
				task_id: OTHER,
				leave_workspace_idle: true,
				record: activeRecord(OTHER),
			}),
		).toThrow(KernelStoreConflictError);
		expect(() =>
			withKernelTransaction(root, (db) =>
				insertRunRow(db, {
					run_id: "run-competing",
					task_id: "store-third",
					record_json: `${JSON.stringify(activeRecord("store-third"), null, 2)}\n`,
					intent_revision: 1,
					intent_content_hash: INTENT_HASH,
					enrollment_event_id: "enroll-third",
					claim_status: "active",
					created_at: NOW,
					updated_at: NOW,
				}),
			),
		).toThrow(KernelStoreConflictError);
		expect(reconcileKernelAuthority(root, TASK).owner_task_id).toBe(TASK);
	});

	test("a second writer waits for the committed fact instead of interleaving", () => {
		const root = tempRoot();
		enroll(root);
		const dbPath = join(root, ".imm/state/kernel.sqlite");
		// Hold the write lock from an independent connection, as a second
		// process would.
		const competing = new DatabaseSync(dbPath);
		competing.exec("PRAGMA busy_timeout = 1");
		competing.exec("BEGIN IMMEDIATE");
		let busy: unknown = null;
		try {
			withKernelTransaction(
				root,
				(db) => readWorkspaceRow(db),
				{ busyTimeoutMs: 50 },
			);
		} catch (error) {
			busy = error;
		} finally {
			competing.exec("ROLLBACK");
			competing.close();
		}
		expect(busy).toBeInstanceOf(KernelStoreConflictError);
		// Once the competing writer releases, the committed fact is read exactly.
		const run = withKernelRead(root, (db) => readRunRowByTask(db, TASK))!;
		expect(run.state).toBe("active");
		expect(run.revision).toBe(1);
		expect(withKernelRead(root, (db) => readOperationRow(db, `enroll:${TASK}:${claimFor().enrollment_event_id}`))).not.toBeNull();
	});

	test("a store copied from another worktree is refused", () => {
		const source = tempRoot();
		enroll(source);
		const target = tempRoot();
		mkdirSync(join(target, ".imm", "state"), { recursive: true });
		// A worktree copy carries the database with its write-ahead log, exactly
		// as a directory copy would.
		for (const name of ["kernel.sqlite", "kernel.sqlite-wal"]) {
			const from = join(source, ".imm", "state", name);
			if (existsSync(from))
				writeFileSync(join(target, ".imm", "state", name), readFileSync(from));
		}
		expect(() => withKernelRead(target, (db) => readWorkspaceRow(db))).toThrow(
			KernelStoreSecurityError,
		);
		expect(() =>
			commitTaskRecordLocked(
				target,
				TASK,
				canonicalRecordHash(activeRecord() as never),
				activeRecord() as never,
				readWorkspaceStateRaw(target).revision,
				{ contract: "assurance_kernel/workspace/v1", current_working: TASK },
			),
		).toThrow(KernelStoreSecurityError);
	});

	test("the reviewed record is the canonical revision of the committed bytes", () => {
		const root = tempRoot();
		enroll(root);
		const run = withKernelRead(root, (db) => readRunRowByTask(db, TASK))!;
		const record = readTaskRecordRaw(root, TASK);
		// The reviewed revision is the canonical content hash of the committed
		// record, derived from the parsed form so reformatting cannot split it.
		expect(record.revision).toBe(canonicalRecordHash(record.record!));
		expect(record.revision).toBe(canonicalRecordHash(JSON.parse(run.record_json) as never));
		expect(record.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
	});
});
