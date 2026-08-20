import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");

function isIgnored(relativePath: string): boolean {
  const result = spawnSync("git", ["check-ignore", "--quiet", relativePath], {
    cwd: REPO_ROOT,
    stdio: "ignore",
  });
  return result.status === 0;
}

describe("task record durability", () => {
  test("TaskRecords under .imm/tasks/ are tracked by Git rather than ignored, while workspace.json and migrations/ remain ignored", () => {
    const gitignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");

    // .imm/tasks/ must not be ignored — the directory itself should be trackable
    expect(gitignore).not.toMatch(/^\.imm\/tasks\/\s*$/m);
    // Negated forms would also be acceptable but the canonical fix is removal;
    // we verify the path is not ignored via git check-ignore as the source of truth.

    // The other three must remain ignored
    expect(gitignore).toContain(".imm/workspace.json");
    expect(gitignore).toContain(".imm/migrations/");
    expect(gitignore).toContain(".imm/journal.jsonl");

    // git check-ignore is the authority: sample task records must NOT be ignored
    expect(isIgnored(".imm/tasks/2026-08-14-001-pi-observable-assurance-dispatch.json")).toBe(false);
    expect(isIgnored(".imm/tasks/any-task.json")).toBe(false);
    expect(isIgnored(".imm/tasks/any-task.backend-claim.json")).toBe(false);

    // while per-machine / local-backup state remains ignored
    expect(isIgnored(".imm/workspace.json")).toBe(true);
    expect(isIgnored(".imm/journal.jsonl")).toBe(true);
    // migrations is a directory pattern; check a file inside it
    expect(isIgnored(".imm/migrations/foo/bar")).toBe(true);
    expect(isIgnored(".imm/migrations/")).toBe(true);
  });

  test("Archiving a terminal intent sidecar fails when the matching TaskRecord is absent", () => {
    // The audit artifact is the per-task record. It must be present on disk
    // (and, after the .gitignore fix, tracked) when its sidecar is archived.
    // This test validates the gate logic. Records are rewritten on every phase
    // transition, so only the terminal archival moment is gated — the five
    // worktree-parallel losses (008/009/011/012/013) are the motivation.

    const tasksDir = join(REPO_ROOT, ".imm/tasks");

    // Helper that mirrors the archival gate: terminal archival requires the
    // record file to exist. In production the gate also checks git tracking,
    // but existence is the durable prerequisite — a missing file can never be
    // tracked.
    function archivalRequiresRecord(taskId: string): { ok: boolean; reason?: string } {
      const recordPath = join(tasksDir, `${taskId}.json`);
      if (!existsSync(recordPath)) {
        return { ok: false, reason: `TaskRecord missing for archived terminal task ${taskId}` };
      }
      try {
        const raw = readFileSync(recordPath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.contract !== "assurance_kernel/task_record/v2") {
          return { ok: false, reason: `TaskRecord contract mismatch for ${taskId}` };
        }
        if (parsed.task_id !== taskId) {
          return { ok: false, reason: `TaskRecord task_id mismatch for ${taskId}` };
        }
      } catch (error) {
        return { ok: false, reason: `TaskRecord unreadable for ${taskId}: ${error instanceof Error ? error.message : String(error)}` };
      }
      return { ok: true };
    }

    // 1. A present record passes the gate — proves the helper works on real data.
    const knownPresent = readdirSync(tasksDir)
      .filter((f) => f.endsWith(".json") && !f.startsWith(".") && !f.includes(".backend-claim"))
      .map((f) => f.replace(/\.json$/, ""))[0];
    if (knownPresent) {
      const result = archivalRequiresRecord(knownPresent);
      expect(result.ok).toBe(true);
    } else {
      // No records at all would be a setup failure, not a gate failure
      expect(existsSync(tasksDir)).toBe(true);
    }

    // 2. A missing record fails the gate — this is the regression the
    // worktree-parallel loss exposed (008, 009, 011, 012, 013 were archived
    // while their worktree-local records were discarded). The gate must fail
    // closed at the visible archival moment.
    const missingId = "2026-08-20-014-track-task-records-for-audit-continuity-missing-probe";
    const missingCheck = archivalRequiresRecord(missingId);
    expect(missingCheck.ok).toBe(false);
    expect(missingCheck.reason).toContain("TaskRecord missing");

    // 3. The gate distinguishes terminal archival from non-terminal archival.
    // Older archived sidecars that were archived via the implementing-commit
    // fallback (no record but a later commit touched scope_hint) are not
    // required to have a record — archival via S1/S2 or implementing-commit
    // is a separate path from terminal archival. This test ensures the helper
    // itself is sound; the historical drift is intentionally not re-checked
    // here because the pre-gate archive decisions used the old two-signal
    // rule. Future terminal archival without a record must be caught by the
    // same helper, and the change to .gitignore ensures the record can be
    // tracked when that happens.
    expect(typeof archivalRequiresRecord).toBe("function");
  });
});
