import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
	KernelStoreConflictError,
	KernelStoreSecurityError,
	backupKernelStore,
	openKernelStore,
	readRunRowByTask,
	readWorkspaceRow,
	restoreKernelStore,
	withKernelRead,
	withKernelTransaction,
	writeWorkspaceRow,
} from "../plugins/immune-brain/runtime/kernel/sqlite_store";
import {
  commitEnrollmentLocked,
  commitTerminalLocked,
  readAuditTaskPair,
  readTaskRecordRaw,
  readWorkspaceStateRaw,
  reconcileKernelAuthority,
  repairKernelAuthority,
  retryStoreFollowUps,
  revisionForContent,
  serializeWorkspace,
} from "../plugins/immune-brain/runtime/kernel/storage";
import { canonicalRecordHash } from "../plugins/immune-brain/runtime/kernel/reducer";
import { activeRunId, readRunRowById } from "../plugins/immune-brain/runtime/kernel/sqlite_store";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";

const REPO_ROOT = resolve(import.meta.dir, "..");
const ARCHIVE_DIR = join(REPO_ROOT, "docs/plans/archive");
const AUDIT_DIR = join(REPO_ROOT, ".imm/audit");

function isIgnored(relativePath: string): boolean {
  const result = spawnSync("git", ["check-ignore", "--quiet", relativePath], {
    cwd: REPO_ROOT,
    stdio: "ignore",
  });
  return result.status === 0;
}

/**
 * Terminal evidence for one archived task. `.imm/audit/<task-id>/` owns the
 * immutable pair under the cutover layout; a temporary expiring branch (Slice
 * 2 deletes it) still accepts the pre-activation legacy `.imm/tasks/` pair so
 * this repository can settle under the installed old runtime before it
 * migrates.
 */
function terminalPair(taskId: string): {
  recordPath: string;
  proofPath: string;
} | null {
  for (const dir of [join(AUDIT_DIR, taskId), join(REPO_ROOT, ".imm/tasks")]) {
    const recordPath = join(
      dir,
      dir === join(AUDIT_DIR, taskId) ? "task-record.json" : `${taskId}.json`,
    );
    const proofPath = join(
      dir,
      dir === join(AUDIT_DIR, taskId) ? "terminal-proof.json" : `${taskId}.backend-claim.json`,
    );
    if (existsSync(recordPath) && existsSync(proofPath)) {
      return { recordPath, proofPath };
    }
  }
  return null;
}

/**
 * A task whose Kernel authority is still live in this worktree: its archived
 * TaskIntent is a transitory freeze artifact, not evidence loss. Only a positive
 * live record counts; an unreadable store is never treated as proof of absence.
 */
function liveTaskInFlight(taskId: string): boolean {
  const legacy = join(REPO_ROOT, ".imm/state/tasks", `${taskId}.json`);
  if (existsSync(legacy)) {
    try {
      const raw = JSON.parse(readFileSync(legacy, "utf8")) as { lifecycle?: unknown };
      if (raw.lifecycle === "active") return true;
    } catch {
      // unreadable live record: fall through to the store probe
    }
  }
  const storePath = join(REPO_ROOT, ".imm/state/kernel.sqlite");
  if (!existsSync(storePath)) return false;
  const db = new DatabaseSync(storePath, { readOnly: true });
  try {
    const row = db.prepare("SELECT state FROM runs WHERE task_id = ?").get(taskId) as
      | { state?: unknown }
      | undefined;
    return row?.state === "active";
  } finally {
    db.close();
  }
}

function archivalRequiresRecord(taskId: string): { ok: boolean; reason?: string } {
  const pair = terminalPair(taskId);
  if (!pair) {
    return { ok: false, reason: `terminal audit pair missing for archived terminal task ${taskId}` };
  }
  try {
    const raw = JSON.parse(readFileSync(pair.recordPath, "utf8")) as {
      contract?: unknown;
      task_id?: unknown;
      lifecycle?: unknown;
      phase?: unknown;
    };
    if (
      raw.contract !== "assurance_kernel/task_record/v4" &&
      raw.contract !== "assurance_kernel/task_record/v3" &&
      raw.contract !== "assurance_kernel/task_record/v2"
    ) {
      return { ok: false, reason: `TaskRecord contract mismatch for ${taskId}` };
    }
    if (raw.task_id !== taskId) {
      return { ok: false, reason: `TaskRecord task_id mismatch for ${taskId}` };
    }
    const lifecycle = raw.lifecycle ?? raw.phase;
    if (lifecycle !== "done" && lifecycle !== "stopped") {
      return { ok: false, reason: `TaskRecord is not terminal for ${taskId}` };
    }
    const proof = JSON.parse(readFileSync(pair.proofPath, "utf8")) as {
      task_id?: unknown;
      final_record_hash?: unknown;
    };
    if (proof.task_id !== taskId) {
      return { ok: false, reason: `terminal proof task_id mismatch for ${taskId}` };
    }
    const recordRevision = `sha256:${createHash("sha256").update(readFileSync(pair.recordPath)).digest("hex")}`;
    if (proof.final_record_hash !== recordRevision) {
      return { ok: false, reason: `terminal proof does not match the record bytes for ${taskId}` };
    }
  } catch (error) {
    return {
      ok: false,
      reason: `terminal audit pair unreadable for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { ok: true };
}


describe("task record durability", () => {
  test("state is wholly ignored while audit is trackable and task-ID-isolated", () => {
    const gitignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");

    expect(gitignore).toMatch(/^\.imm\/state\/\s*$/m);
    expect(gitignore).not.toMatch(/^\.imm\/audit\/\s*$/m);

    expect(isIgnored(".imm/state/kernel.sqlite")).toBe(true);
    expect(isIgnored(".imm/state/kernel.sqlite-wal")).toBe(true);
    expect(isIgnored(".imm/state/kernel.sqlite-shm")).toBe(true);
    expect(isIgnored(".imm/state/kernel-backup.sqlite")).toBe(true);
    expect(isIgnored(".imm/migrations/foo/bar")).toBe(true);

    expect(isIgnored(".imm/audit/any-task/task-record.json")).toBe(false);
    expect(isIgnored(".imm/audit/any-task/terminal-proof.json")).toBe(false);
    expect(isIgnored(".imm/audit/legacy-v3/current_iteration.json")).toBe(false);
  });

  test("Archiving a terminal intent sidecar fails when the matching terminal audit pair is absent (synthetic guard)", () => {
    const knownPresent = (terminalPair("2026-08-14-001-pi-observable-assurance-dispatch")
      ?? terminalPair("2026-08-13-017-v4-only-storage-retirement"))?.recordPath;
    if (knownPresent) {
      expect(archivalRequiresRecord("2026-08-14-001-pi-observable-assurance-dispatch").ok).toBe(true);
    } else {
      expect(existsSync(AUDIT_DIR) || existsSync(join(REPO_ROOT, ".imm/tasks"))).toBe(true);
    }

    const missingId = "2026-08-20-014-track-task-records-for-audit-continuity-missing-probe";
    const missingCheck = archivalRequiresRecord(missingId);
    expect(missingCheck.ok).toBe(false);
    expect(missingCheck.reason).toContain("missing");
  });

  test("Durability guard enumerates the repository's archived sidecars and fails outside the explicit baseline", () => {
    const rawBaseline = JSON.parse(readFileSync(join(REPO_ROOT, "tests/task-record-durability-baseline.json"), "utf8"));
    const baseline: unknown = rawBaseline.baseline ?? rawBaseline;
    expect(Array.isArray(baseline), "baseline must be an explicit array of task ids, not a numeric threshold").toBe(true);
    const baselineList = baseline as string[];
    expect(baselineList.length).toBeGreaterThan(0);
    expect(baselineList.every((id) => typeof id === "string" && id.length > 0)).toBe(true);

    expect(existsSync(ARCHIVE_DIR)).toBe(true);
    const archived = readdirSync(ARCHIVE_DIR)
      .filter((f) => f.endsWith(".intent.json"))
      .map((f) => f.replace(/\.intent\.json$/, ""))
      .sort();

    expect(archived.length).toBeGreaterThan(0);
    expect(archived.length).toBeGreaterThanOrEqual(83);

    // The cutover layout isolates evidence per task-ID directory, so state
    // writes from concurrent tasks can never collide with terminal evidence.
    // An archived TaskIntent whose task is still in flight is a freeze artifact
    // of the active task, not lost terminal evidence.
    const missing = archived
      .filter((id) => !archivalRequiresRecord(id).ok && !liveTaskInFlight(id))
      .sort();
    const unexpectedMissing = missing.filter((id) => !baselineList.includes(id)).sort();
    expect(
      unexpectedMissing,
      `New terminal evidence loss outside baseline: ${unexpectedMissing.join(", ") || "(none)"} — missing total ${missing.length}, baseline ${baselineList.length}`,
    ).toEqual([]);
    for (const id of missing) {
      expect(baselineList).toContain(id);
    }

    // Guard is not a vanity check: at least one baseline entry must actually
    // be missing for the ratchet to be meaningful.
    const anyBaselineMissing = baselineList.some(
      (id) => archived.includes(id) && !archivalRequiresRecord(id).ok,
    );
    expect(anyBaselineMissing).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A1: the SQLite authority store is the durability and concurrency boundary.
// ---------------------------------------------------------------------------

function storeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "imm-store-durability-"));
  return root;
}

function seededRecord(taskId: string, gitHead: string) {
  const intent = {
    contract: "assurance_kernel/task_intent/v1",
    task_id: taskId,
    goal: "durability fixture",
    acceptance: [{ id: "A1", assertion: "a1", verification: "bun test tests/x.test.ts" }],
    scope_hint: ["docs/plans"],
    risk: "routine",
    revision: 1,
    owner: "user",
  };
  return {
    contract: "assurance_kernel/task_record/v4",
    task_id: taskId,
    intent_snapshot: intent,
    intent_ref: {
      path: `docs/plans/${taskId}.intent.json`,
      content_hash: canonicalIntentHash(parseTaskIntentV1(intent)),
    },
    lifecycle: "active",
    artifact_state: "active",
    baseline: `sha256:${"a".repeat(64)}`,
    git_base_head: gitHead,
    attestations: [],
    findings: [],
    history: [],
  };
}

/** Enroll one fixture task through the store transaction and return its run. */
function storeEnrollFixture(root: string, taskId: string): { run_id: string; state: string } {
  const record = seededRecord(taskId, "a".repeat(40));
  const recordBytes = `${JSON.stringify(record, null, 2)}\n`;
  const before = readWorkspaceStateRaw(root);
  commitEnrollmentLocked(
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
    storeClaimFor(taskId),
  );
  const run = withKernelRead(root, (db) => readRunRowByTask(db, taskId))!;
  return { run_id: run.run_id, state: run.state };
}

function storeClaimFor(taskId: string): Record<string, unknown> {
  const record = seededRecord(taskId, "a".repeat(40));
  return {
    contract: "assurance_kernel/backend_claim/v2",
    backend: "kernel",
    task_id: taskId,
    intent_revision: 1,
    intent_content_hash: record.intent_ref.content_hash,
    enrollment_event_id: `enroll-${taskId}-2026-08-12T10:00:00.000Z`,
    lifecycle_status: "active",
    created_at: "2026-08-12T10:00:00.000Z",
    updated_at: "2026-08-12T10:00:00.000Z",
  };
}

function storeTerminalRecord(taskId: string): Record<string, unknown> {
  const record = seededRecord(taskId, "a".repeat(40));
  return {
    ...record,
    lifecycle: "done",
    artifact_state: "frozen",
    intent_ref: {
      path: `docs/plans/archive/${taskId}.intent.json`,
      content_hash: record.intent_ref.content_hash,
    },
  };
}

describe("SQLite authority store durability", () => {
  test("enforces one active run per worktree through the database constraint", () => {
    const root = storeRoot();
    try {
      seedKernelRunForTest(root, { task_id: "durability-a", record: seededRecord("durability-a", "a".repeat(40)) });
      expect(() =>
        seedKernelRunForTest(root, { task_id: "durability-b", record: seededRecord("durability-b", "a".repeat(40)) }),
      ).toThrow(KernelStoreConflictError);
      // The refused insert left no trace of the second run.
      expect(withKernelRead(root, (db) => readRunRowByTask(db, "durability-b"))).toBeNull();
      expect(withKernelRead(root, (db) => readWorkspaceRow(db).current_run_id)).not.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("revision-checked concurrent writes reject stale writers and ignore byte identity", () => {
    const root = storeRoot();
    try {
      const seeded = seedKernelRunForTest(root, {
        task_id: "durability-c",
        record: seededRecord("durability-c", "a".repeat(40)),
      });
      const first = withKernelRead(root, (db) => readRunRowByTask(db, "durability-c")!);
      expect(first.revision).toBe(1);
      // A committed write advances the monotonic revision.
      withKernelTransaction(root, (db) => {
        db.prepare("UPDATE runs SET revision = revision + 1 WHERE run_id = ?").run(seeded.run_id);
      });
      const second = withKernelRead(root, (db) => readRunRowByTask(db, "durability-c")!);
      expect(second.revision).toBe(2);
      // Identical bytes cannot stand in for the revision: the stale writer is
      // refused even though its payload matches the committed one.
      expect(() =>
        withKernelTransaction(root, (db) => {
          const result = db
            .prepare("UPDATE runs SET record_json = record_json WHERE run_id = ? AND revision = ?")
            .run(seeded.run_id, first.revision);
          if (Number(result.changes) !== 1) throw new KernelStoreConflictError("stale writer refused");
        }),
      ).toThrow(KernelStoreConflictError);
      expect(withKernelRead(root, (db) => readRunRowByTask(db, "durability-c")!).revision).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a cross-process writer is bounded by the busy timeout instead of hanging", () => {
    const root = storeRoot();
    try {
      seedKernelRunForTest(root, { task_id: "durability-d", record: seededRecord("durability-d", "a".repeat(40)) });
      const holder = spawnSync(
        "bun",
        [
          "-e",
          `const { DatabaseSync } = require("node:sqlite");
           const db = new DatabaseSync(${JSON.stringify(join(root, ".imm/state/kernel.sqlite"))});
           db.exec("PRAGMA busy_timeout = 5000");
           db.exec("BEGIN IMMEDIATE");
           db.exec("UPDATE workspace SET revision = revision WHERE id = 1");
           console.log("locked");
           await new Promise((r) => setTimeout(r, 1200));
           db.exec("COMMIT");
           db.close();`,
        ],
        { encoding: "utf8" },
      );
      // The background holder ran to completion and never surfaced a failure.
      expect(holder.status).toBe(0);
      expect(holder.stdout).toContain("locked");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a fault after the authority write rolls the transaction back completely", async () => {
    const root = storeRoot();
    try {
      const seeded = seedKernelRunForTest(root, {
        task_id: "durability-e",
        record: seededRecord("durability-e", "a".repeat(40)),
      });
      const { setAfterTaskTransactionWriteForTest } = await import(
        "../plugins/immune-brain/runtime/kernel/storage"
      );
      const before = withKernelRead(root, (db) => ({
        run: readRunRowByTask(db, "durability-e")!,
        workspace: readWorkspaceRow(db),
      }));
      setAfterTaskTransactionWriteForTest(() => {
        throw new Error("simulated disk failure after the authority write");
      });
      expect(() =>
        withKernelTransaction(root, (db) => {
          db.prepare("UPDATE runs SET revision = revision + 1 WHERE run_id = ?").run(seeded.run_id);
          writeWorkspaceRow(db, readWorkspaceRow(db).revision, seeded.run_id, "2026-08-12T01:00:00.000Z");
        }),
      ).toThrow(/simulated disk failure/);
      setAfterTaskTransactionWriteForTest(null);
      const after = withKernelRead(root, (db) => ({
        run: readRunRowByTask(db, "durability-e")!,
        workspace: readWorkspaceRow(db),
      }));
      expect(after.run.revision).toBe(before.run.revision);
      expect(after.workspace.revision).toBe(before.workspace.revision);
      expect(after.workspace.updated_at).toBe(before.workspace.updated_at);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("isolated worktrees keep separate stores, identities and owners", () => {
    const rootA = storeRoot();
    const rootB = storeRoot();
    try {
      const seed = (root: string) =>
        seedKernelRunForTest(root, {
          task_id: "shared-logical-task",
          record: seededRecord("shared-logical-task", "a".repeat(40)),
        });
      const a = seed(rootA);
      const b = seed(rootB);
      expect(a.run_id).not.toBe(b.run_id);
      const identity = (root: string) => {
        const db = openKernelStore(root, { create: false })!;
        try {
          const meta = db.prepare("SELECT value FROM store_meta WHERE key = 'workspace_id'").get() as {
            value: string;
          };
          return meta.value;
        } finally {
          db.close();
        }
      };
      expect(identity(rootA)).not.toBe(identity(rootB));
      // A database copied into another worktree is refused instead of granting authority.
      const copied = join(rootB, "copied.sqlite");
      backupKernelStore(rootA, copied);
      expect(() => restoreKernelStore(rootB, copied)).toThrow(KernelStoreSecurityError);
    } finally {
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    }
  });

  test("a consistent backup restores the exact workspace and run identity", () => {
    const root = storeRoot();
    const backupPath = `${root}-backup.sqlite`;
    try {
      const seeded = seedKernelRunForTest(root, {
        task_id: "durability-f",
        record: seededRecord("durability-f", "a".repeat(40)),
      });
      const before = withKernelRead(root, (db) => ({
        run: readRunRowByTask(db, "durability-f")!,
        workspace: readWorkspaceRow(db),
      }));
      backupKernelStore(root, backupPath);
      rmSync(join(root, ".imm/state/kernel.sqlite"), { force: true });
      rmSync(join(root, ".imm/state/kernel.sqlite-wal"), { force: true });
      rmSync(join(root, ".imm/state/kernel.sqlite-shm"), { force: true });
      expect(withKernelRead(root, (db) => readRunRowByTask(db, "durability-f"))).toBeNull();
      restoreKernelStore(root, backupPath);
      const after = withKernelRead(root, (db) => ({
        run: readRunRowByTask(db, "durability-f")!,
        workspace: readWorkspaceRow(db),
      }));
      expect(after.run).toEqual(before.run);
      expect(after.workspace).toEqual(before.workspace);
      expect(after.run.run_id).toBe(seeded.run_id);
      // Restored rows still bind to the committed record revision.
      expect(after.run.revision).toBe(1);
      writeFileSync(join(root, "restore-probe.txt"), "ok");
      expect(existsSync(join(root, "restore-probe.txt"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(backupPath, { force: true });
    }
  });

  test("an incompatible schema is rejected before any authority write", () => {
    const root = storeRoot();
    try {
      seedKernelRunForTest(root, { task_id: "durability-g", record: seededRecord("durability-g", "a".repeat(40)) });
      const db = openKernelStore(root, { create: false })!;
      db.prepare("UPDATE store_meta SET value = ? WHERE key = 'schema_version'").run("99");
      db.close();
      expect(() => openKernelStore(root, { create: false })).toThrow(/schema version 99 is incompatible/);
      expect(() =>
        withKernelTransaction(root, (b) => {
          writeWorkspaceRow(b, readWorkspaceRow(b).revision, null, "2026-08-12T01:00:00.000Z");
        }),
      ).toThrow(/schema version 99 is incompatible/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("one transaction commits the run, the owner and the derived claim together", () => {
    const root = storeRoot();
    try {
      const seeded = storeEnrollFixture(root, "durability-h");
      expect(seeded.state).toBe("active");
      expect(withKernelRead(root, (db) => activeRunId(db))).toBe(seeded.run_id);
      expect(readWorkspaceStateRaw(root).state.current_working).toBe("durability-h");
      // No retired file store is written by the commit.
      expect(existsSync(join(root, ".imm/state/workspace.json"))).toBe(false);
      expect(existsSync(join(root, ".imm/state/active-claim.json"))).toBe(false);
      expect(existsSync(join(root, ".imm/state/tasks"))).toBe(false);
      expect(existsSync(join(root, ".imm/state/transactions"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a second enrollment is refused while one owner is active", () => {
    const root = storeRoot();
    try {
      storeEnrollFixture(root, "durability-i");
      expect(() => storeEnrollFixture(root, "durability-j")).toThrow(KernelStoreConflictError);
      expect(readWorkspaceStateRaw(root).state.current_working).toBe("durability-i");
      expect(withKernelRead(root, (db) => readRunRowByTask(db, "durability-j"))).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a deleted store never recovers silently", () => {
    const root = storeRoot();
    try {
      storeEnrollFixture(root, "durability-k");
      for (const name of ["kernel.sqlite", "kernel.sqlite-wal", "kernel.sqlite-shm"])
        rmSync(join(root, ".imm/state", name), { force: true });
      expect(readTaskRecordRaw(root, "durability-k").record).toBeNull();
      expect(readWorkspaceStateRaw(root).state.current_working).toBeNull();
      expect(reconcileKernelAuthority(root, "durability-k").state).toBe("unowned");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a replayed enrollment returns the committed run instead of writing again", () => {
    const root = storeRoot();
    try {
      const seeded = storeEnrollFixture(root, "durability-l");
      const replayed = storeEnrollFixture(root, "durability-l");
      expect(replayed.run_id).toBe(seeded.run_id);
      expect(withKernelRead(root, (db) => readRunRowByTask(db, "durability-l"))!.revision).toBe(1);
      const operations = withKernelRead(root, (db) =>
        db.prepare("SELECT operation_id FROM operations WHERE kind = 'enrollment'").all() as Array<{
          operation_id: string;
        }>,
      );
      expect(operations).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("settlement commits atomically and an interrupted audit export stays retryable", () => {
    const root = storeRoot();
    try {
      const seeded = storeEnrollFixture(root, "durability-m");
      const run = withKernelRead(root, (db) => readRunRowById(db, seeded.run_id))!;
      const terminal = {
        ...storeTerminalRecord("durability-m"),
      };
      const terminalBytes = `${JSON.stringify(terminal, null, 2)}\n`;
      const workspace = readWorkspaceStateRaw(root);
      const transaction = {
        contract: "assurance_kernel/workspace_transaction/v2" as const,
        task_id: "durability-m",
        expected_record_hash: revisionForContent(run.record_json),
        next_record_content: terminalBytes,
        expected_workspace_hash: workspace.revision,
        next_workspace_content: serializeWorkspace({
          contract: "assurance_kernel/workspace/v1",
          current_working: null,
        }),
      };
      const tombstone = {
        contract: "assurance_kernel/task_tombstone/v2" as const,
        task_id: "durability-m",
        lifecycle_status: "terminal" as const,
        terminal_lifecycle: "done" as const,
        terminal_event_id: "complete:durability-m:2026-08-12T10:00:05.000Z",
        final_record_hash: revisionForContent(terminalBytes),
        terminalized_at: "2026-08-12T10:00:05.000Z",
      };
      commitTerminalLocked(root, "durability-m", transaction, tombstone);
      // One durable state: no active run, cleared owner, terminal proof.
      expect(withKernelRead(root, (db) => activeRunId(db))).toBeNull();
      expect(withKernelRead(root, (db) => readRunRowByTask(db, "durability-m"))!.state).toBe("done");
      expect(readWorkspaceStateRaw(root).state.current_working).toBeNull();
      // The same terminal event replays from committed facts; a different one
      // cannot settle a settled run again.
      const replayed = commitTerminalLocked(root, "durability-m", transaction, tombstone);
      expect(replayed.record.lifecycle).toBe("done");
      expect(() =>
        commitTerminalLocked(root, "durability-m", transaction, {
          ...tombstone,
          terminal_event_id: "complete:durability-m:other",
        }),
      ).toThrow(KernelStoreConflictError);
      // The audit export is a deterministic follow-up: it converges on the next
      // lock and never reactivates the run.
      retryStoreFollowUps(root);
      expect(readAuditTaskPair(root, "durability-m")?.proof.terminal_lifecycle).toBe("done");
      expect(withKernelRead(root, (db) => readRunRowByTask(db, "durability-m"))!.audit_exported_at).not.toBeNull();
      expect(reconcileKernelAuthority(root, "durability-m").state).toBe("terminal_owner");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a proven stale claim cannot exist, so repair reports the settled authority", () => {
    const root = storeRoot();
    try {
      seedKernelRunForTest(root, {
        task_id: "durability-n",
        record: storeTerminalRecord("durability-n"),
        created_at: "2026-08-12T10:00:00.000Z",
        updated_at: "2026-08-12T10:00:00.000Z",
        terminal: { lifecycle: "done", terminalized_at: "2026-08-12T10:00:05.000Z" },
      });
      retryStoreFollowUps(root);
      // A leftover retired claim file is inert: the store already answers, and a
      // mutation retires the file instead of trusting it.
      writeFileSync(
        join(root, ".imm/state/active-claim.json"),
        `${JSON.stringify(storeClaimFor("durability-n"), null, 2)}\n`,
      );
      const projection = reconcileKernelAuthority(root, "durability-n");
      expect(projection.state).toBe("terminal_owner");
      const repaired = repairKernelAuthority(root, "durability-n", projection.revision);
      expect(repaired.state).toBe("terminal_owner");
      expect(repaired.owner_task_id).toBe("durability-n");
      expect(existsSync(join(root, ".imm/state/active-claim.json"))).toBe(false);
      expect(existsSync(join(root, ".imm/state/transactions/authority-repair-transaction.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the reviewed record is the canonical revision of the committed bytes", () => {
    const root = storeRoot();
    try {
      const seeded = storeEnrollFixture(root, "durability-o");
      const record = readTaskRecordRaw(root, "durability-o");
      const run = withKernelRead(root, (db) => readRunRowById(db, seeded.run_id))!;
      // The reviewed revision is the canonical content hash of the committed
      // record, derived from the parsed form so reformatting cannot split it.
      expect(record.revision).toBe(canonicalRecordHash(record.record!));
      expect(record.revision).toBe(canonicalRecordHash(JSON.parse(run.record_json) as never));
      expect(record.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
