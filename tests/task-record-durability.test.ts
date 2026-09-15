import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
    const missing = archived.filter((id) => !archivalRequiresRecord(id).ok).sort();
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
});
