import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

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

    expect(isIgnored(".imm/state/tasks/any-task.json")).toBe(true);
    expect(isIgnored(".imm/state/workspace.json")).toBe(true);
    expect(isIgnored(".imm/state/active-claim.json")).toBe(true);
    expect(isIgnored(".imm/state/transactions/terminal-transaction.json")).toBe(true);
    expect(isIgnored(".imm/state/locks/kernel-store.lock")).toBe(true);
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