import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const BASELINE_PATH = join(REPO_ROOT, "tests/task-record-durability-baseline.json");
const ARCHIVE_DIR = join(REPO_ROOT, "docs/plans/archive");
const TASKS_DIR = join(REPO_ROOT, ".imm/tasks");

function isIgnored(relativePath: string): boolean {
  const result = spawnSync("git", ["check-ignore", "--quiet", relativePath], {
    cwd: REPO_ROOT,
    stdio: "ignore",
  });
  return result.status === 0;
}

function archivalRequiresRecord(taskId: string): { ok: boolean; reason?: string } {
  const recordPath = join(TASKS_DIR, `${taskId}.json`);
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

describe("task record durability", () => {
  test("TaskRecords under .imm/tasks/ are tracked by Git rather than ignored, while workspace.json and migrations/ remain ignored", () => {
    const gitignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");

    expect(gitignore).not.toMatch(/^\.imm\/tasks\/\s*$/m);

    expect(gitignore).toContain(".imm/workspace.json");
    expect(gitignore).toContain(".imm/migrations/");
    expect(gitignore).toContain(".imm/journal.jsonl");

    expect(isIgnored(".imm/tasks/2026-08-14-001-pi-observable-assurance-dispatch.json")).toBe(false);
    expect(isIgnored(".imm/tasks/any-task.json")).toBe(false);
    expect(isIgnored(".imm/tasks/any-task.backend-claim.json")).toBe(false);

    expect(isIgnored(".imm/workspace.json")).toBe(true);
    expect(isIgnored(".imm/journal.jsonl")).toBe(true);
    expect(isIgnored(".imm/migrations/foo/bar")).toBe(true);
    expect(isIgnored(".imm/migrations/")).toBe(true);
  });

  test("Archiving a terminal intent sidecar fails when the matching TaskRecord is absent (synthetic guard)", () => {
    // Unit coverage for the helper itself — proves fail-closed on missing.
    const knownPresent = readdirSync(TASKS_DIR)
      .filter((f) => f.endsWith(".json") && !f.startsWith(".") && !f.includes(".backend-claim"))
      .map((f) => f.replace(/\.json$/, ""))[0];
    if (knownPresent) {
      expect(archivalRequiresRecord(knownPresent).ok).toBe(true);
    } else {
      expect(existsSync(TASKS_DIR)).toBe(true);
    }

    const missingId = "2026-08-20-014-track-task-records-for-audit-continuity-missing-probe";
    const missingCheck = archivalRequiresRecord(missingId);
    expect(missingCheck.ok).toBe(false);
    expect(missingCheck.reason).toContain("TaskRecord missing");
  });

  test("Durability guard enumerates the repository's archived sidecars and fails outside the explicit baseline", () => {
    // Baseline must be an explicit named list, not a count — a count lets a new loss hide behind a recovery.
    const rawBaseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    const baseline: unknown = rawBaseline.baseline ?? rawBaseline;

    expect(Array.isArray(baseline), "baseline must be an explicit array of task ids, not a numeric threshold").toBe(true);
    const baselineList = baseline as string[];
    expect(baselineList.length).toBeGreaterThan(0);
    expect(baselineList.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    // Hard gate: must not be a bare count file
    expect(typeof rawBaseline).not.toBe("number");
    if (typeof rawBaseline.count === "number") {
      // If a count field exists, baseline array is still required — count alone is forbidden
      expect(Array.isArray(baseline)).toBe(true);
    }

    // Enumerate archived sidecars — the repository it guards.
    expect(existsSync(ARCHIVE_DIR)).toBe(true);
    const archived = readdirSync(ARCHIVE_DIR)
      .filter((f) => f.endsWith(".intent.json"))
      .map((f) => f.replace(/\.intent\.json$/, ""))
      .sort();

    expect(archived.length).toBeGreaterThan(0);
    expect(archived.length).toBeGreaterThanOrEqual(83); // snapshot at 017 authoring; may grow as new tasks archive with records

    const missing = archived.filter((id) => !existsSync(join(TASKS_DIR, `${id}.json`))).sort();
    const unexpectedMissing = missing.filter((id) => !baselineList.includes(id)).sort();

    // Core ratchet: no new loss outside baseline
    expect(
      unexpectedMissing,
      `New TaskRecord loss outside baseline: ${unexpectedMissing.join(", ") || "(none)"} — missing total ${missing.length}, baseline ${baselineList.length}`,
    ).toEqual([]);

    // Baseline may only shrink: every missing must be in baseline (equivalently unexpectedMissing === 0)
    // Recovery (baseline id now present) is tolerated — indicates shrink opportunity, not failure.
    for (const id of missing) {
      expect(baselineList).toContain(id);
    }

    // Prove guard is not a vanity check: helper actually distinguishes present/missing
    if (archived.length > 0) {
      const probe = archivalRequiresRecord(archived.find((id) => baselineList.includes(id)) ?? archived[0]);
      // baseline entries are missing, so probe should fail for at least one baseline id
      const anyBaselineMissing = baselineList.some((id) => archived.includes(id) && !archivalRequiresRecord(id).ok);
      expect(anyBaselineMissing).toBe(true);
    }
  });
});
