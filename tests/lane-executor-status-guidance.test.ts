import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectTaskStatus } from "../plugins/immune-brain/runtime/assurance/coordinator";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage";
import { pluginSourceSkewWarning } from "../plugins/immune-brain/runtime/plugin_source_skew";
import { laneRuntimeContractRefusal } from "../plugins/immune-brain/runtime/unattended/batch_lanes";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const temp = () => { const root = mkdtempSync(join(tmpdir(), "imm-status-guidance-")); roots.push(root); return root; };
const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, ...args], {
 encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "f@f", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "f@f" },
}).trim();
function plugin(root: string, build: string) {
 mkdirSync(join(root, ".claude-plugin"), { recursive: true });
 mkdirSync(join(root, "dist/claude"), { recursive: true });
 writeFileSync(join(root, ".claude-plugin/plugin.json"), "{}\n");
 writeFileSync(join(root, "dist/claude/mcp-server.mjs"), build);
 return root;
}

// A Git repository rooted beneath its common directory exercises the Lane path
// boundary without creating or switching a worktree in the developer repository.
test("Lane skew is non-blocking; ordinary source and coordinator preflight retain reload/refusal", async () => {
 const container = temp();
 const common = join(container, "common.git");
 const lane = join(common, "imm/worktrees/batch/task");
 mkdirSync(lane, { recursive: true });
 git(lane, "init", "-q", `--separate-git-dir=${common}`);
 plugin(join(lane, "plugins/immune-brain"), "workspace");
 const loaded = plugin(temp(), "installed");
 const warning = pluginSourceSkewWarning(lane, loaded)!;
 expect(warning.code).toBe("loaded_plugin_differs_from_workspace");
 expect(warning.message).toContain("expected in a Lane");
 expect(warning.message).toContain("non-blocking and needs no reload");
 expect((await projectTaskStatus(lane, "absent-task", loaded)).warnings).toContainEqual(warning);
 const lookalike = join(common, "imm/worktrees-other/task");
 mkdirSync(lookalike, { recursive: true });
 // Git discovers the same common directory, but the path is outside the Lane prefix.
 writeFileSync(join(lookalike, ".git"), `gitdir: ${common}\n`);
 plugin(join(lookalike, "plugins/immune-brain"), "workspace");
 expect(pluginSourceSkewWarning(lookalike, loaded)?.message).toContain("reload the Host with the workspace plugin");
 const ordinary = temp();
 git(ordinary, "init", "-q");
 plugin(join(ordinary, "plugins/immune-brain"), "workspace");
 expect(pluginSourceSkewWarning(ordinary, loaded)?.message).toContain("reload the Host with the workspace plugin");
 expect(laneRuntimeContractRefusal(ordinary, undefined, loaded)).toStartWith("batch_runtime_contract_mismatch:");
 expect(pluginSourceSkewWarning(lane, plugin(temp(), "workspace"))).toBeNull();
});

function fixture(artifactState: "active" | "frozen" = "active") {
 const root = temp(), taskId = "status-guidance";
 const intent = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: taskId, owner: "user",
  goal: "status guidance", risk: "routine", revision: 1,
  scope_hint: ["work.ts", "new.ts", `docs/plans/${taskId}.intent.json`],
  acceptance: [{ id: "AC1", assertion: "work passes", verification: "bun test" }] });
 mkdirSync(join(root, "docs/plans"), { recursive: true });
 writeFileSync(join(root, `docs/plans/${taskId}.intent.json`), JSON.stringify(intent));
 writeFileSync(join(root, "work.ts"), "export const value = 1;\n");
 writeFileSync(join(root, ".gitignore"), ".imm/\n");
 git(root, "init", "-q"); git(root, "add", ".gitignore", "work.ts", "docs/plans"); git(root, "commit", "-qm", "base");
 const hash = canonicalIntentHash(intent);
 seedKernelRunForTest(root, { task_id: taskId, created_at: "2026-08-12T10:00:00.000Z", updated_at: "2026-08-12T10:00:00.000Z", record: {
  contract: "assurance_kernel/task_record/v4", task_id: taskId, intent_snapshot: intent,
  intent_ref: { path: `docs/plans/${taskId}.intent.json`, content_hash: hash }, lifecycle: "active", artifact_state: artifactState,
  baseline: hash, git_base_head: git(root, "rev-parse", "HEAD"), attestations: [], findings: [], history: [],
 } });
 return { root, taskId };
}
const pending = (s: Awaited<ReturnType<typeof projectTaskStatus>>) => s.warnings?.find(w => w.code === "implementation_pending");

test("unchanged enrollment guides implementation without changing authority or writing state", async () => {
 const f = fixture();
 const before = readTaskRecordRaw(f.root, f.taskId);
 const status = await projectTaskStatus(f.root, f.taskId);
 expect(status.error).toBeNull();
 expect(status.projection.next_obligation).toBe("submit_assurance");
 expect(pending(status)?.message).toContain("implement the enrolled acceptance, run focused checks, stage task-owned changes, then call advance_assurance");
 expect(readTaskRecordRaw(f.root, f.taskId)).toEqual(before);
});

for (const change of ["unstaged", "staged", "committed", "untracked"] as const) {
 test(`${change} scope changes suppress implementation_pending`, async () => {
  const f = fixture();
  writeFileSync(join(f.root, change === "untracked" ? "new.ts" : "work.ts"), "changed\n");
  if (change === "staged" || change === "committed") git(f.root, "add", "work.ts");
  if (change === "committed") git(f.root, "commit", "-qm", "implementation");
  const status = await projectTaskStatus(f.root, f.taskId);
  expect(status.error).toBeNull();
  expect(status.projection.next_obligation).toBe("submit_assurance");
  expect(pending(status)).toBeUndefined();
 });
}

test("another obligation has no implementation warning", async () => {
 const f = fixture("frozen");
 const status = await projectTaskStatus(f.root, f.taskId);
 expect(status.error).toBeNull();
 expect(status.projection.next_obligation).toBe("run_qa");
 expect(pending(status)).toBeUndefined();
});

test("Loop and Executor contracts tell fresh enrollments to implement first and accept Lane skew", () => {
 for (const path of ["plugins/immune-brain/dist/imm-run.md", "plugins/immune-brain/runtime/prompts/executor.md"]) {
  const text = readFileSync(path, "utf8");
  expect(text).toContain("`submit_assurance` means implement first");
  expect(text).toContain("non-blocking in a Lane");
  expect(text).toContain("without a reload");
 }
});
