import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
  commitTaskRecordLocked,
  commitTerminalLocked,
  MISSING_REVISION,
  readCommittedRecord,
  readTaskRecordRaw,
  withKernelStoreLockForTask,
  readWorkspaceStateRaw,
  reconcileKernelAuthority,
  recoverKernelStoreFollowUps,
  repairKernelAuthority,
  retryStoreFollowUps,
  revisionForContent,
  serializeWorkspace,
} from "../plugins/immune-brain/runtime/kernel/storage";
import {
  createMutationAuthorityRegistry,
  digestOfAction,
} from "../plugins/immune-brain/runtime/kernel/authority_port";
import { writeBatchRunState } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { projectAssurance } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import {
  auditEvidencePaths,
  auditRunRecordPath,
  auditRunTerminalProofPath,
  BATCH_STATE_RELATIVE,
  inspectStorageLayout,
} from "../plugins/immune-brain/runtime/kernel/storage_paths";
import { readAuditTaskPair } from "../plugins/immune-brain/runtime/kernel/storage";
import { canonicalRecordHash } from "../plugins/immune-brain/runtime/kernel/reducer";
import { applyTaskAction } from "../plugins/immune-brain/runtime/kernel/application";
import { activeRunId, readRunRowById } from "../plugins/immune-brain/runtime/kernel/sqlite_store";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";
import {
  canonicalIntentHash,
  parseTaskIntentV1,
  readTaskIntent,
} from "../plugins/immune-brain/runtime/kernel/intent";

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
 * Terminal evidence for one archived task. A settled run exports
 * `.imm/audit/<task-id>/<run-id>/`; the flat task directory stays readable for
 * repositories that predate run-scoped export, and a temporary expiring branch
 * (the storage-migration slice deletes it) still accepts the pre-activation
 * legacy `.imm/tasks/` pair so this repository can settle under the installed
 * old runtime before it migrates.
 */
function terminalPair(taskId: string): {
  recordPath: string;
  proofPath: string;
} | null {
  const taskDir = join(AUDIT_DIR, taskId);
  const runDirs = (existsSync(taskDir) ? readdirSync(taskDir, { withFileTypes: true }) : [])
    .filter((entry) => entry.isDirectory() && /^run-[A-Za-z0-9-]+$/.test(entry.name))
    .map((entry) => join(taskDir, entry.name))
    .sort();
  for (const dir of [...runDirs, taskDir, join(REPO_ROOT, ".imm/tasks")]) {
    const flat = dir === taskDir;
    const legacy = dir === join(REPO_ROOT, ".imm/tasks");
    const recordPath = join(dir, legacy ? `${taskId}.json` : "task-record.json");
    const proofPath = join(
      dir,
      legacy ? `${taskId}.backend-claim.json` : "terminal-proof.json",
    );
    if (flat && runDirs.length > 0) continue;
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

  test("a competing writer is refused within its busy timeout while another holds the lock", async () => {
    const root = storeRoot();
    try {
      seedKernelRunForTest(root, { task_id: "durability-d", record: seededRecord("durability-d", "a".repeat(40)) });
      const holder = Bun.spawn(
        [
          "bun",
          "-e",
          `const { DatabaseSync } = require("node:sqlite");
           const db = new DatabaseSync(${JSON.stringify(join(root, ".imm/state/kernel.sqlite"))});
           db.exec("PRAGMA busy_timeout = 5000");
           db.exec("BEGIN IMMEDIATE");
           db.exec("UPDATE workspace SET revision = revision WHERE id = 1");
           console.log("locked");
           await new Promise((r) => setTimeout(r, 1500));
           db.exec("COMMIT");
           db.close();
           console.log("released");`,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      // Wait until the other process really holds the write lock.
      const reader = holder.stdout.getReader();
      const decoder = new TextDecoder();
      let seen = "";
      while (!seen.includes("locked")) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`holder exited before locking: ${seen}`);
        seen += decoder.decode(chunk.value);
      }
      // While the lock is held, a competing writer must fail inside its bound
      // instead of hanging or interleaving.
      const started = Date.now();
      let refused: unknown = null;
      try {
        withKernelTransaction(
          root,
          (db) => writeWorkspaceRow(db, readWorkspaceRow(db).revision, null, "2026-08-12T11:00:00.000Z"),
          { busyTimeoutMs: 100 },
        );
      } catch (error) {
        refused = error;
      }
      const elapsed = Date.now() - started;
      expect(refused).toBeInstanceOf(KernelStoreConflictError);
      expect(elapsed).toBeLessThan(3000);
      // The refused writer wrote nothing and the holder ran to completion.
      expect(withKernelRead(root, (db) => readWorkspaceRow(db).current_run_id)).not.toBeNull();
      await holder.exited;
      expect(holder.exitCode).toBe(0);
      // The lock is released: the same write now commits.
      expect(() =>
        withKernelTransaction(root, (db) =>
          writeWorkspaceRow(db, readWorkspaceRow(db).revision, null, "2026-08-12T11:05:00.000Z"),
        ),
      ).not.toThrow();
      expect(withKernelRead(root, (db) => readWorkspaceRow(db).current_run_id)).toBeNull();
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
      // The live store must survive a refused restore byte-for-byte: validation
      // happens on the backup copy, never after the swap.
      const liveBefore = readFileSync(join(rootB, ".imm/state/kernel.sqlite"));
      expect(() => restoreKernelStore(rootB, copied)).toThrow(KernelStoreSecurityError);
      expect(readFileSync(join(rootB, ".imm/state/kernel.sqlite"))).toEqual(liveBefore);
      expect(withKernelRead(rootB, (db) => readRunRowByTask(db, "shared-logical-task"))!.run_id).toBe(b.run_id);
      // A corrupt backup is refused the same way.
      const corrupt = join(rootB, "corrupt.sqlite");
      writeFileSync(corrupt, "not a database");
      expect(() => restoreKernelStore(rootB, corrupt)).toThrow(/not a database|could not be opened/);
      expect(readFileSync(join(rootB, ".imm/state/kernel.sqlite"))).toEqual(liveBefore);
      expect(withKernelRead(rootB, (db) => readRunRowByTask(db, "shared-logical-task"))!.run_id).toBe(b.run_id);
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
      // An authority repair retires this task's own proved-duplicate claim file;
      // ordinary mutations (covered below) never delete retired authority.
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

  test("an idle workspace with identical content refuses a stale revision", () => {
    const root = storeRoot();
    try {
      const pristine = readWorkspaceStateRaw(root);
      storeEnrollFixture(root, "durability-q");
      // Settle the only owner: the workspace is idle again, byte-identical to the
      // pristine state, but it is a different revision.
      const run = withKernelRead(root, (db) => readRunRowByTask(db, "durability-q"))!;
      const terminalBytes = `${JSON.stringify(storeTerminalRecord("durability-q"), null, 2)}\n`;
      commitTerminalLocked(
        root,
        "durability-q",
        {
          contract: "assurance_kernel/workspace_transaction/v2",
          task_id: "durability-q",
          expected_record_hash: revisionForContent(run.record_json),
          next_record_content: terminalBytes,
          expected_workspace_hash: readWorkspaceStateRaw(root).revision,
          next_workspace_content: serializeWorkspace({
            contract: "assurance_kernel/workspace/v1",
            current_working: null,
          }),
        },
        {
          contract: "assurance_kernel/task_tombstone/v2",
          task_id: "durability-q",
          lifecycle_status: "terminal",
          terminal_lifecycle: "done",
          terminal_event_id: "complete:durability-q:2026-08-12T10:00:05.000Z",
          final_record_hash: revisionForContent(terminalBytes),
          terminalized_at: "2026-08-12T10:00:05.000Z",
        },
      );
      const idled = readWorkspaceStateRaw(root);
      expect(idled.state).toEqual(pristine.state);
      expect(idled.revision).not.toBe(pristine.revision);
      // The stale snapshot cannot enroll: the token moved with the revision even
      // though the serialized owner is byte-identical.
      expect(() =>
        commitEnrollmentLocked(
          root,
          "durability-r",
          {
            contract: "assurance_kernel/workspace_transaction/v2",
            task_id: "durability-r",
            expected_record_hash: MISSING_REVISION,
            next_record_content: `${JSON.stringify(seededRecord("durability-r", "a".repeat(40)), null, 2)}\n`,
            expected_workspace_hash: pristine.revision,
            next_workspace_content: serializeWorkspace({
              contract: "assurance_kernel/workspace/v1",
              current_working: "durability-r",
            }),
          },
          storeClaimFor("durability-r"),
        ),
      ).toThrow(KernelStoreConflictError);
      expect(withKernelRead(root, (db) => readRunRowByTask(db, "durability-r"))).toBeNull();
      // The current revision is accepted.
      expect(storeEnrollFixture(root, "durability-r").state).toBe("active");
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
  test("authority issued for one run is refused in a worktree holding another", () => {
    const rootA = storeRoot();
    const rootB = storeRoot();
    try {
      const a = storeEnrollFixture(rootA, "durability-s");
      const b = storeEnrollFixture(rootB, "durability-s");
      expect(a.run_id).not.toBe(b.run_id);
      const recordB = withKernelRead(rootB, (db) => readRunRowById(db, b.run_id))!;
      const before = readTaskRecordRaw(rootB, "durability-s").revision;
      // A capability minted in A names A's run. Applied here, the store refuses
      // it before any write: identical task, intent and record content cannot
      // stand in for the run identity.
      expect(() =>
        commitTaskRecordLocked(
          rootB,
          "durability-s",
          before,
          JSON.parse(recordB.record_json) as never,
          readWorkspaceStateRaw(rootB).revision,
          { contract: "assurance_kernel/workspace/v1", current_working: "durability-s" },
          [],
          a.run_id,
        ),
      ).toThrow(KernelStoreSecurityError);
      expect(readTaskRecordRaw(rootB, "durability-s").revision).toBe(before);
      // The application reads the sidecar the record points at and requires it
      // to be tracked, so the fixture materializes and stages it.
      execFileSync("git", ["init", "-q"], { cwd: rootB, stdio: "ignore" });
      mkdirSync(join(rootB, "docs/plans"), { recursive: true });
      writeFileSync(
        join(rootB, "docs/plans/durability-s.intent.json"),
        `${JSON.stringify(JSON.parse(recordB.record_json).intent_snapshot, null, 2)}\n`,
      );
      execFileSync("git", ["add", "--", "docs/plans/durability-s.intent.json"], { cwd: rootB });
      // The real application entry refuses it too: the run the worktree holds
      // is what the registry is asked to match, so a capability tied to another
      // run cannot pass inspection and nothing is written.
      const runRowB = withKernelRead(rootB, (db) => readRunRowById(db, b.run_id))!;
      const registryEntry = createMutationAuthorityRegistry();
      const foreignCapability = registryEntry.issue({
        authority_kind: "user",
        task_id: "durability-s",
        run_id: a.run_id,
        action_digest: "irrelevant-because-the-run-check-fails-first",
        expected_record_hash: before,
        intent_revision: 1,
        intent_content_hash: `sha256:${"a".repeat(64)}`,
        diff_hash: `sha256:${"b".repeat(64)}`,
        actor_id: "user",
        confirmation_ref: "confirmation",
        expires_at: "2099-01-01T00:00:00.000Z",
        findings_digest: null,
      });
      expect(() =>
        applyTaskAction({
          root: rootB,
          task_id: "durability-s",
          action: {
            type: "record_approval",
            event_id: "event-1",
            at: "2026-08-12T10:00:00.000Z",
            actor_id: "user",
            expected_record_hash: before,
            expected_workspace_hash: readWorkspaceStateRaw(rootB).revision,
            diff_hash: `sha256:${"b".repeat(64)}`,
            approval: {
              id: "approval-1",
              kind: "qa",
              authority_role: "qa",
              task_revision: 1,
              intent_content_hash: `sha256:${"a".repeat(64)}`,
              diff_hash: `sha256:${"b".repeat(64)}`,
              actor_id: "user",
              summary: "cross-worktree attempt",
            },
          } as never,
          registry: registryEntry,
          capability: foreignCapability,
          // A fresh token from this worktree, exactly as an attacker in B would hold.
          prior_intent_token: readTaskIntent(rootB, "durability-s").token,
          diffProvider: () => ({
            diff_hash: `sha256:${"b".repeat(64)}`,
            changed_paths: [],
          }),
        }),
      ).toThrow(/run mismatch|authority/i);
      expect(JSON.parse(withKernelRead(rootB, (db) => readRunRowById(db, b.run_id))!.record_json).attestations).toEqual([]);
      expect(runRowB.run_id).toBe(b.run_id);

      // The registry itself refuses the cross-run inspection as well.
      const registry = createMutationAuthorityRegistry();
      const stopAction = {
        type: "stop",
        event_id: "e",
        at: "2026-08-12T10:00:00.000Z",
        actor_id: "user",
        expected_record_hash: before,
        expected_workspace_hash: "w",
        diff_hash: `sha256:${"b".repeat(64)}`,
        reason: "stop",
      } as never;
      const capability = registry.issue({
        authority_kind: "user",
        task_id: "durability-s",
        run_id: a.run_id,
        action_digest: digestOfAction(stopAction),
        expected_record_hash: before,
        intent_revision: 1,
        intent_content_hash: `sha256:${"a".repeat(64)}`,
        diff_hash: `sha256:${"b".repeat(64)}`,
        actor_id: "user",
        confirmation_ref: "confirmation",
        expires_at: "2099-01-01T00:00:00.000Z",
        findings_digest: null,
      });
      expect(() =>
        registry.inspect(capability, {
          task_id: "durability-s",
          run_id: b.run_id,
          action: stopAction,
          expected_record_hash: before,
          intent_revision: 1,
          intent_content_hash: `sha256:${"a".repeat(64)}`,
          diff_hash: `sha256:${"b".repeat(64)}`,
        }),
      ).toThrow(/run mismatch/);
    } finally {
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    }
  });

  test("a backup never costs the previous backup or the live store", () => {
    const root = storeRoot();
    const backupDir = mkdtempSync(join(tmpdir(), "imm-backup-"));
    try {
      const seeded = storeEnrollFixture(root, "durability-w");
      const backup = join(backupDir, "store.sqlite");
      backupKernelStore(root, backup);
      const good = readFileSync(backup);
      expect(good.length).toBeGreaterThan(0);
      // A second backup replaces the first atomically.
      backupKernelStore(root, backup);
      expect(readFileSync(backup).length).toBeGreaterThan(0);
      // The live store and its sidecars can never be a backup target.
      for (const forbidden of [
        join(root, ".imm/state/kernel.sqlite"),
        join(root, ".imm/state/kernel.sqlite-wal"),
      ])
        expect(() => backupKernelStore(root, forbidden)).toThrow(KernelStoreSecurityError);
      // The live authority is untouched by those refusals.
      expect(withKernelRead(root, (db) => readRunRowByTask(db, "durability-w"))!.run_id).toBe(seeded.run_id);
      expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(true);
    } finally {
      rmSync(backupDir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a refused restore never costs the live store its committed facts", () => {
    // The publication boundary is the risky window: the live write-ahead log is
    // folded into the main file before any sidecar is removed, so a failure
    // between validation and the swap cannot lose committed transactions.
    if (process.getuid?.() === 0) return;
    const root = storeRoot();
    try {
      const seeded = storeEnrollFixture(root, "durability-t");
      const foreign = storeRoot();
      try {
        storeEnrollFixture(foreign, "durability-t");
        const backup = join(root, "foreign.sqlite");
        backupKernelStore(foreign, backup);
        const stateDir = join(root, ".imm", "state");
        chmodSync(stateDir, 0o555);
        let failure: unknown = null;
        try {
          restoreKernelStore(root, backup);
        } catch (error) {
          failure = error;
        } finally {
          chmodSync(stateDir, 0o755);
        }
        expect(failure).not.toBeNull();
        // The commit survived: the run, its record and its owner are intact.
        expect(withKernelRead(root, (db) => readRunRowByTask(db, "durability-t"))!.run_id).toBe(seeded.run_id);
        expect(readWorkspaceStateRaw(root).state.current_working).toBe("durability-t");
        expect(readTaskRecordRaw(root, "durability-t").record?.lifecycle).toBe("active");
      } finally {
        rmSync(foreign, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("persisted batch state no longer blocks Kernel mutations", () => {
    const root = storeRoot();
    try {
      // A batch run leaves .imm/state/batches behind. The layout gate must
      // recognize it as a supported directory instead of failing the worktree
      // closed, which is what blocked every later Kernel mutation.
      mkdirSync(join(root, ".imm/state/batches"), { recursive: true });
      writeFileSync(
        join(root, ".imm/state/batches/batch-1.json"),
        `${JSON.stringify({ batch_id: "batch-1" }, null, 2)}\n`,
      );
      expect(inspectStorageLayout(root).layout).toBe("ready");
      // The whitelist cannot drift from the writer: the batch owner's own path
      // is the directory the inspector accepts.
      expect(dirname(join(root, ".imm/state/batches", "batch-1.json"))).toBe(
        join(root, BATCH_STATE_RELATIVE),
      );
      // A registered mutation still commits with that state present.
      expect(storeEnrollFixture(root, "durability-u").state).toBe("active");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a terminal proof from another worktree's run of the same task is not a local conflict", async () => {
    const rootA = storeRoot();
    const rootB = storeRoot();
    try {
      const a = storeEnrollFixture(rootA, "durability-y");
      const b = storeEnrollFixture(rootB, "durability-y");
      expect(a.run_id).not.toBe(b.run_id);
      // A settles and its tracked audit pair reaches B (for example through Git).
      mkdirSync(join(rootA, ".imm/audit/durability-y"), { recursive: true });
      const foreignTerminalBytes = `${JSON.stringify(storeTerminalRecord("durability-y"), null, 2)}\n`;
      writeFileSync(join(rootA, ".imm/audit/durability-y/task-record.json"), foreignTerminalBytes);
      writeFileSync(
        join(rootA, ".imm/audit/durability-y/terminal-proof.json"),
        `${JSON.stringify(
          {
            contract: "assurance_kernel/task_tombstone/v2",
            task_id: "durability-y",
            lifecycle_status: "terminal",
            terminal_lifecycle: "done",
            terminal_event_id: "complete:durability-y:2026-08-12T10:00:05.000Z",
            final_record_hash: revisionForContent(foreignTerminalBytes),
            terminalized_at: "2026-08-12T10:00:05.000Z",
          },
          null,
          2,
        )}\n`,
      );
      // The foreign evidence arrives in B under A's own run directory.
      const foreignDir = join(rootB, ".imm/audit/durability-y", a.run_id);
      mkdirSync(foreignDir, { recursive: true });
      for (const name of ["task-record.json", "terminal-proof.json"])
        writeFileSync(join(foreignDir, name), readFileSync(join(rootA, ".imm/audit/durability-y", name)));
      // B's own active run is not displaced by another run's evidence.
      expect(reconcileKernelAuthority(rootB, "durability-y")).toMatchObject({
        state: "active_owner",
        owner_run_id: b.run_id,
      });
      const before = readTaskRecordRaw(rootB, "durability-y").revision;
      const projected = await projectAssurance(rootB, "durability-y", () => ({
        diff_hash: `sha256:${"b".repeat(64)}`,
        changed_paths: [],
      }));
      expect(projected.error).toBeNull();
      expect(projected.projection).toMatchObject({ lifecycle: "active", artifact_state: "active" });
      expect(readTaskRecordRaw(rootB, "durability-y").revision).toBe(before);

      // B settles too: its own export must succeed beside A's evidence, and A's
      // bytes must survive untouched.
      const aBefore = readFileSync(join(rootB, ".imm/audit/durability-y", a.run_id, "task-record.json"));
      const localTerminalBytes = `${JSON.stringify(storeTerminalRecord("durability-y"), null, 2)}\n`;
      commitTerminalLocked(
        rootB,
        "durability-y",
        {
          contract: "assurance_kernel/workspace_transaction/v2",
          task_id: "durability-y",
          expected_record_hash: before,
          next_record_content: localTerminalBytes,
          expected_workspace_hash: readWorkspaceStateRaw(rootB).revision,
          next_workspace_content: serializeWorkspace({
            contract: "assurance_kernel/workspace/v1",
            current_working: null,
          }),
        },
        {
          contract: "assurance_kernel/task_tombstone/v2",
          task_id: "durability-y",
          lifecycle_status: "terminal",
          terminal_lifecycle: "done",
          terminal_event_id: "complete:durability-y:2026-08-12T10:00:07.000Z",
          final_record_hash: revisionForContent(localTerminalBytes),
          terminalized_at: "2026-08-12T10:00:07.000Z",
        },
      );
      expect(() =>
        withKernelStoreLockForTask(rootB, "durability-y", () => undefined),
      ).not.toThrow();
      const own = join(rootB, ".imm/audit/durability-y", b.run_id);
      expect(existsSync(join(own, "task-record.json"))).toBe(true);
      expect(existsSync(join(own, "terminal-proof.json"))).toBe(true);
      expect(
        readFileSync(join(rootB, ".imm/audit/durability-y", a.run_id, "task-record.json")),
      ).toEqual(aBefore);
      expect(withKernelRead(rootB, (db) => readRunRowByTask(db, "durability-y"))!.audit_exported_at).not.toBeNull();
    } finally {
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    }
  });

  test("a settled run-scoped audit pair is recognized as terminal evidence", () => {
    const root = storeRoot();
    try {
      const taskId = "durability-scoped";
      storeEnrollFixture(root, taskId);
      const run = withKernelRead(root, (db) => readRunRowByTask(db, taskId))!;
      const terminalBytes = `${JSON.stringify(storeTerminalRecord(taskId), null, 2)}\n`;
      commitTerminalLocked(
        root,
        taskId,
        {
          contract: "assurance_kernel/workspace_transaction/v2",
          task_id: taskId,
          expected_record_hash: readTaskRecordRaw(root, taskId).revision,
          next_record_content: terminalBytes,
          expected_workspace_hash: readWorkspaceStateRaw(root).revision,
          next_workspace_content: serializeWorkspace({
            contract: "assurance_kernel/workspace/v1",
            current_working: null,
          }),
        },
        {
          contract: "assurance_kernel/task_tombstone/v2",
          task_id: taskId,
          lifecycle_status: "terminal",
          terminal_lifecycle: "done",
          terminal_event_id: `complete:${taskId}:2026-08-12T10:00:09.000Z`,
          final_record_hash: revisionForContent(terminalBytes),
          terminalized_at: "2026-08-12T10:00:09.000Z",
        },
      );
      withKernelStoreLockForTask(root, taskId, () => undefined);
      const paths = auditEvidencePaths(root, taskId);
      expect(paths.record).toBe(auditRunRecordPath(taskId, run.run_id));
      expect(paths.proof).toBe(auditRunTerminalProofPath(taskId, run.run_id));
      expect(existsSync(join(root, paths.record))).toBe(true);
      expect(existsSync(join(root, paths.proof))).toBe(true);
      const pair = readAuditTaskPair(root, taskId, run.run_id)!;
      expect(pair.proof.terminal_lifecycle).toBe("done");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("historical audit evidence still projects as terminal after the store exists", () => {
    const root = storeRoot();
    try {
      // A fresh clone of a pre-run-scoped repository carries only the audit pair.
      const taskId = "durability-historical";
      const terminalBytes = `${JSON.stringify(storeTerminalRecord(taskId), null, 2)}\n`;
      mkdirSync(join(root, ".imm/audit", taskId), { recursive: true });
      writeFileSync(join(root, ".imm/audit", taskId, "task-record.json"), terminalBytes);
      writeFileSync(
        join(root, ".imm/audit", taskId, "terminal-proof.json"),
        `${JSON.stringify(
          {
            contract: "assurance_kernel/task_tombstone/v2",
            task_id: taskId,
            lifecycle_status: "terminal",
            terminal_lifecycle: "done",
            terminal_event_id: `complete:${taskId}:2026-08-12T10:00:05.000Z`,
            final_record_hash: revisionForContent(terminalBytes),
            terminalized_at: "2026-08-12T10:00:05.000Z",
          },
          null,
          2,
        )}\n`,
      );
      expect(reconcileKernelAuthority(root, taskId)).toMatchObject({ state: "terminal_owner" });
      // Another task's run creates the store and then settles, leaving the
      // workspace idle again. The historical task must not turn into an empty
      // projection just because a database now exists.
      storeEnrollFixture(root, "durability-live");
      withKernelTransaction(root, (db) => {
        db.prepare("UPDATE workspace SET current_run_id = NULL WHERE id = 1").run();
        db.prepare("DELETE FROM runs WHERE state = 'active'").run();
      });
      expect(existsSync(join(root, ".imm/state/kernel.sqlite"))).toBe(true);
      expect(reconcileKernelAuthority(root, taskId)).toMatchObject({ state: "terminal_owner" });
      expect(withKernelRead(root, (db) => readRunRowByTask(db, taskId))).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a retired claim that belongs to another task is never deleted and never ignored", () => {
    const root = storeRoot();
    try {
      storeEnrollFixture(root, "durability-x");
      const retired = join(root, ".imm/state");
      mkdirSync(retired, { recursive: true });
      // A retired claim for a task this worktree does not own: the mutation must
      // fail closed and the bytes must survive untouched.
      const foreign = `${JSON.stringify(
        {
          contract: "assurance_kernel/backend_claim/v2",
          backend: "kernel",
          task_id: "some-other-task",
          intent_revision: 1,
          intent_content_hash: `sha256:${"a".repeat(64)}`,
          enrollment_event_id: "enroll-some-other-task-2026-08-12T10:00:00.000Z",
          lifecycle_status: "active",
          created_at: "2026-08-12T10:00:00.000Z",
          updated_at: "2026-08-12T10:00:00.000Z",
        },
        null,
        2,
      )}\n`;
      const claimPath = join(root, ".imm/state/active-claim.json");
      writeFileSync(claimPath, foreign);
      expect(() =>
        withKernelStoreLockForTask(root, "durability-x", () => undefined),
      ).toThrow(/retired file-store authority/);
      expect(readFileSync(claimPath, "utf8")).toBe(foreign);

      // A claim that provably belongs to the same task and enrollment is inert:
      // the mutation proceeds and the bytes are still left for the migration.
      const own = JSON.parse(foreign) as Record<string, unknown>;
      own.task_id = "durability-x";
      own.enrollment_event_id = "enroll-durability-x-2026-08-12T10:00:00.000Z";
      own.intent_content_hash = JSON.parse(
        withKernelRead(root, (db) => readRunRowByTask(db, "durability-x"))!.record_json,
      ).intent_ref.content_hash;
      writeFileSync(claimPath, `${JSON.stringify(own, null, 2)}\n`);
      expect(() =>
        withKernelStoreLockForTask(root, "durability-x", () => undefined),
      ).not.toThrow();
      expect(existsSync(claimPath)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a committed relocation that never reached the filesystem is recovered before a read", () => {
    const root = storeRoot();
    try {
      storeEnrollFixture(root, "durability-v");
      const run = withKernelRead(root, (db) => readRunRowByTask(db, "durability-v"))!;
      // The interrupted freeze state: the record points at the archive path,
      // the source is still in place and the target was never written.
      mkdirSync(join(root, "docs/plans"), { recursive: true });
      const sidecarBytes = "{}\n";
      writeFileSync(join(root, "docs/plans/durability-v.intent.json"), sidecarBytes);
      // The record already points at the archive path and the move is recorded
      // as pending, exactly as an interrupted freeze leaves it.
      const record = JSON.parse(run.record_json) as Record<string, unknown>;
      record.intent_ref = {
        path: "docs/plans/archive/durability-v.intent.json",
        content_hash: (record.intent_ref as { content_hash: string }).content_hash,
      };
      record.artifact_state = "frozen";
      withKernelTransaction(root, (db) => {
        db.prepare("UPDATE runs SET pending_relocations_json = ? WHERE run_id = ?").run(
          JSON.stringify([
            {
              from_path: "docs/plans/durability-v.intent.json",
              to_path: "docs/plans/archive/durability-v.intent.json",
              content_hash: revisionForContent(sidecarBytes),
            },
          ]),
          run.run_id,
        );
      });
      // The recovery entry completes the recorded move.
      recoverKernelStoreFollowUps(root, "durability-v");
      expect(existsSync(join(root, "docs/plans/archive/durability-v.intent.json"))).toBe(true);
      expect(existsSync(join(root, "docs/plans/durability-v.intent.json"))).toBe(false);
      expect(withKernelRead(root, (db) => readRunRowByTask(db, "durability-v"))!.pending_relocations_json).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
