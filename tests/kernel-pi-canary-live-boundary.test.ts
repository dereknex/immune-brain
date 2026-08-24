// P2B1 U1 preparation boundary over an isolated repository fixture.
// Runtime/package tests must never dereference the live worktree Kernel owner.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  preparePiCanary,
  revalidatePiCanary,
} from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { evaluateCanaryEligibility } from "../plugins/immune-brain/runtime/kernel/canary_eligibility";

const TASK = "isolated-canary-boundary";
const AUTHORITY_PATHS = [
  ".imm/memory/current_iteration.json",
  ".imm/memory/current_iteration_history.jsonl",
  ".imm/memory/.current_iteration.authority_commit_receipts.jsonl",
  ".imm/memory/.current_iteration.automatic_observations.jsonl",
  ".imm/journal.jsonl",
  ".imm/workspace.json",
];
let root: string;

function git(args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

function snapshot(): string {
  const parts: string[] = [];
  for (const path of AUTHORITY_PATHS) {
    try {
      const full = resolve(root, path);
      const stat = statSync(full);
      parts.push(`${path}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`);
      parts.push(`${path}:${readFileSync(full).toString("hex")}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") parts.push(`${path}:ENOENT`);
      else throw error;
    }
  }
  try {
    parts.push(`tasks:${readdirSync(resolve(root, ".imm/tasks")).sort().join(",")}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") parts.push("tasks:ENOENT");
    else throw error;
  }
  return parts.join("\n");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-canary-boundary-"));
  mkdirSync(join(root, "docs/plans"), { recursive: true });
  writeFileSync(
    join(root, `docs/plans/${TASK}.intent.json`),
    JSON.stringify({
      contract: "assurance_kernel/task_intent/v1",
      task_id: TASK,
      goal: "verify isolated preparation",
      owner: "user",
      risk: "routine",
      revision: 1,
      scope_hint: ["tests"],
      acceptance: [{ id: "A1", assertion: "preparation is read-only", verification: "bun test" }],
    }, null, 2) + "\n",
  );
  git(["init", "-q"]);
  git(["config", "user.email", "test@example.invalid"]);
  git(["config", "user.name", "test"]);
  git(["add", "docs/plans"]);
  git(["commit", "-qm", "intent"]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("isolated repository preparation boundary", () => {
  test("preparation is zero-write and new-task eligibility remains a pure projection", () => {
    const before = snapshot();
    const now = "2026-08-13T00:00:00.000Z";
    const preparation = preparePiCanary(root, { task_id: TASK, now });
    expect(snapshot()).toBe(before);
    expect(preparation.intent).not.toBeNull();
    expect(preparation.backend_claim).toEqual({ present: false, task_id: null, lifecycle_status: null });
    expect(preparation.task_tombstone).toEqual({ present: false, terminal_lifecycle: null });
    expect(preparation.task_record_v3).toEqual({ present: false, lifecycle: null, artifact_state: null });
    expect(preparation.workspace).toEqual({ current_working: null });

    const eligibility = evaluateCanaryEligibility({
      task: {
        id: TASK,
        intent_path: preparation.intent!.path,
        intent_revision: preparation.intent!.revision,
        intent_content_hash: preparation.intent!.content_hash,
      },
      now,
    });
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.waived_gates).toEqual([]);
    expect(eligibility.unmet_non_waivable).toEqual([]);
  });

  test("revalidation equality holds while isolated owners remain unchanged", () => {
    const input = { task_id: TASK, now: "2026-08-13T00:00:00.000Z" };
    const first = preparePiCanary(root, input);
    expect(revalidatePiCanary(root, input, first).unchanged).toBe(true);
  });
});
