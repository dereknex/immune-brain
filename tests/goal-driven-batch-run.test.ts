import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advanceNativeParent, observeParentCompletion, type NativeParentGate } from "../plugins/immune-brain/runtime/unattended/batch_git";
import { deliveryHash, settledDeliveryFixture } from "./fixtures/settled-delivery";
import { withCompletionDelivery } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";
import { prepareBatchLaneRunState, writeBatchLaneRunState } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { assertIsolatedTaskPrerequisites, type GhTransport } from "../plugins/immune-brain/runtime/github_issue_tracker";
import { observeNativeParent } from "../plugins/immune-brain/runtime/unattended/batch_git";
import { readBatchLaneRunState, writeNativeParentFinalReport } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { observeParentRun } from "../plugins/immune-brain/runtime/assurance/run_continuation";
import { registerPiRunContinuation } from "../plugins/immune-brain/.pi-extension/pi-run-continuation";
import { recognizePhaseEntry, NO_LOCAL_NAMES } from "../plugins/immune-brain/runtime/assurance/phase_entry";
import { recordPhaseEntryPrompt } from "../plugins/immune-brain/runtime/claude/lane_guard";
import { runContinuationHookOutput } from "../plugins/immune-brain/runtime/claude/run_continuation";
import { runFinalVerification, parseFinalVerificationReport } from "../plugins/immune-brain/runtime/unattended/batch_final_verification";
import { completedParentReport } from "../plugins/immune-brain/runtime/unattended/batch_runner";
import type { BatchLaneRunReport } from "../plugins/immune-brain/runtime/unattended/batch_state";

function repository() {
 const root = mkdtempSync(join(tmpdir(), "gdr-parent-"));
 execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
 writeFileSync(join(root, "base.txt"), "base\n");
 execFileSync("git", ["add", "base.txt"], { cwd: root });
 execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "base"], { cwd: root });
 return root;
}

function parentFixture(nativeRoot: boolean) {
 const root = repository();
 mkdirSync(join(root, "docs/plans"), { recursive: true }); mkdirSync(join(root, "docs/initiatives"), { recursive: true });
 writeFileSync(join(root, ".gitignore"), ".imm/\nimmune-brain-claude/\n");
 const make = (id: string, risk: "critical" | "material", path: string) => parseTaskIntentV1({
  contract: "assurance_kernel/task_intent/v1", task_id: id, goal: `Deliver ${id}`,
  acceptance: [{ id: "A1", assertion: "Delivery verified", verification: "bun --version" }],
  scope_hint: [path, `docs/plans/${id}.intent.json`], risk, revision: 1, owner: "user",
 });
 const owner = make("root-task", nativeRoot ? "critical" : "material", "base.txt");
 const other = make("other-task", nativeRoot ? "material" : "critical", "other.txt");
 for (const intent of [owner, other]) writeFileSync(join(root, `docs/plans/${intent.task_id}.intent.json`), JSON.stringify(intent, null, 2) + "\n");
 writeFileSync(join(root, "docs/initiatives/parent.md"), "# Parent\n## S1: root\nTasks:\n- root-task\n## S2: other\nTasks:\n- other-task\n");
 execFileSync("git", ["add", "."], { cwd: root });
 execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "plan"], { cwd: root });
 const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
 seedKernelRunForTest(root, { task_id: owner.task_id, run_id: "run-root", record: {
  contract: "assurance_kernel/task_record/v4", task_id: owner.task_id, intent_snapshot: owner,
  intent_ref: { path: "docs/plans/root-task.intent.json", content_hash: canonicalIntentHash(owner) },
  lifecycle: "active", artifact_state: "active", baseline: `sha256:${"a".repeat(64)}`, git_base_head: head,
  attestations: [], findings: [], history: [],
 } });
 // The main-workspace task is native; batch children now always run in Lanes.
 const child = other;
 const now = new Date().toISOString();
 const args = { batch_id: "parent-batch", initiative_slug: "parent", plan_digest: `sha256:${"b".repeat(64)}`, base_head: head,
  branch: execFileSync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  confirmation_time: now, now, budget: { max_children: 1, qa_failure_limit: 2 },
  children: [{ task_id: child.task_id, slice_id: "S1", blocked_by: [], status: "enrollable" as const,
   risk: child.risk, intent_path: `docs/plans/${child.task_id}.intent.json`, intent_revision: 1,
   intent_content_hash: canonicalIntentHash(child), scope_hint: child.scope_hint, reason: null, exclusion: null }],
 };
 const state = prepareBatchLaneRunState({ ...args, max_parallel: nativeRoot ? 4 : 1 });
 state.batch_state = "running"; writeBatchLaneRunState(root, state);
 return { root, binding: { kind: "parent" as const, workspace: root, session_id: "parent-session", initiative_slug: "parent",
  batch_id: args.batch_id, plan_digest: args.plan_digest } };
}

function githubPlan(line: string, edge: boolean): GhTransport {
 const markers = (kind: string) => `<!-- immune-brain-tracker:v1 -->\n<!-- immune-brain:kind=${kind} -->\n<!-- immune-brain:repo-id=1 -->\n<!-- immune-brain:initiative-id=parent -->`;
 const issue = (id: number, number: number, body: string) => ({ id, number, body, title: "Issue", state: "open", state_reason: null, html_url: `https://github.com/example/project/issues/${number}` });
 return { async run(args) {
  const endpoint = args.at(-1) ?? "";
  let value: unknown;
  if (endpoint === "repos/{owner}/{repo}") value = { id: 1, full_name: "example/project" };
  else if (endpoint.includes("issues?state=all")) value = [
   issue(100, 1, `${markers("initiative")}\n## Slices\n${line}`),
   issue(200, 2, `${markers("task")}\n<!-- immune-brain:slice-id=S5 -->\n<!-- immune-brain:task-id=T-a -->`),
   issue(300, 3, `${markers("task")}\n<!-- immune-brain:slice-id=S6 -->\n<!-- immune-brain:task-id=s6 -->`),
  ];
  else if (endpoint.endsWith("/issues/1/sub_issues?per_page=100")) value = [[{ number: 2 }, { number: 3 }]];
  else if (endpoint.endsWith("/issues/2/dependencies/blocked_by?per_page=100")) value = [[]];
  else if (endpoint.endsWith("/issues/3/dependencies/blocked_by?per_page=100")) value = [edge ? [{ issue_id: 200 }] : []];
  else throw new Error(`unexpected gh call: ${args.join(" ")}`);
  return { exit_code: 0, stdout: JSON.stringify(value), stderr: "", timed_out: false, output_exceeded: false };
 } };
}

const sliceLine = "- [ ] <!-- immune-brain:slice-id=S6 --> **S6**: deliver";

describe("GitHub isolated Slice prerequisites", () => {
 it.each([
  [false, `${sliceLine} (blocked by: T-a)`], [true, `${sliceLine} (blocked by: T-a)`],
  [true, `${sliceLine}\nwrapped\n\n- result list (blocked by: T-a)\n\n---\n\nfooter`],
 ])("uses the published prerequisite with native edge=%p: %s", async (edge, line) => {
  const f = settledDeliveryFixture("critical", "T-a");
  try {
   rmSync(join(f.root, "docs/initiatives/parent.md"));
   const gh = githubPlan(line, edge);
   await expect(assertIsolatedTaskPrerequisites(f.root, "s6", gh)).rejects.toThrow("Isolated Slice prerequisites are not integrated: T-a");
   f.settle("s5"); f.git("add", "src"); f.git("commit", "-qm", "deliver prerequisite");
   await expect(assertIsolatedTaskPrerequisites(f.root, "s6", gh)).resolves.toBeUndefined();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
 });
 it("ignores an edge absent from the published plan", async () => {
  const f = settledDeliveryFixture("critical", "T-a");
  try {
   rmSync(join(f.root, "docs/initiatives/parent.md"));
   await expect(assertIsolatedTaskPrerequisites(f.root, "s6", githubPlan(sliceLine, true))).resolves.toBeUndefined();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
 });
 it.each([
  "no Slice here", `${sliceLine}\n${sliceLine}`, `${sliceLine} (blocked by: )`,
  `${sliceLine} (blocked by: outside)`, `${sliceLine} (blocked by: s6)`,
  `${sliceLine} (blocked by: T-a, T-a)`, `${sliceLine} (blocked by: bad/id)`,
  `${sliceLine} (blocked by: T-a`, `${sliceLine}\nwrapped (blocked by: T-a) trailing`,
  `${sliceLine} (blocked by: T-a)\nwrapped (blocked by: T-a)`,
 ])("rejects an unreadable published plan: %s", async line => {
  const f = settledDeliveryFixture("critical", "T-a");
  try {
   rmSync(join(f.root, "docs/initiatives/parent.md"));
   await expect(assertIsolatedTaskPrerequisites(f.root, "s6", githubPlan(line, false))).rejects.toThrow("Slice S6");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
 });
});

describe("native task transitions inside a Parent", () => {
 it.each([false, true])("Parent progress ignores timing/revision noise (native=%s)", async native => {
  // A native Parent is one whose remaining work is already delivered (run-entry
  // decision hosting D5): a critical Task alone no longer routes there.
  const delivered = native ? settledDeliveryFixture() : null;
  if (delivered) { delivered.settle("s5"); delivered.settle("s6"); delivered.git("add", "src"); delivered.git("commit", "-qm", "delivered"); }
  const h = delivered
   ? { root: delivered.root, binding: { kind: "parent" as const, workspace: delivered.root, session_id: "parent-session",
    initiative_slug: "parent", batch_id: null as string | null, plan_digest: "" } }
   : parentFixture(false);
  try {
   let binding: Parameters<typeof observeParentRun>[0] = h.binding;
   if (delivered) {
    const facts = await observeNativeParent(h.root, "parent", delivered.reader);
    if (!facts) throw new Error("native Parent fixture missing");
    binding = { ...h.binding, batch_id: null, plan_digest: facts.plan_digest };
   }
   const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: h.root, encoding: "utf8" }).trim();
   const final = (duration_ms: number) => ({ passed: false, head, results: [{ command: "bun --version", exit_code: 1, signal: null, passed: false, duration_ms }] });
   const write = (duration: number) => {
    if (native) writeNativeParentFinalReport(h.root, { contract: "assurance_kernel/parent_final_report/v1", initiative_slug: "parent", task_ids: ["s5", "s6"], final_verification: final(duration) });
    else { const record = readBatchLaneRunState(h.root, h.binding.batch_id)!; record.children[0]!.reason = `unchanged outcome observed in ${duration}ms`; writeBatchLaneRunState(h.root, record); }
   };
   write(10); const first = await observeParentRun(binding, "one");
   write(200); const second = await observeParentRun(binding, "two");
   expect(second.progress_digest).toBe(first.progress_digest);
  } finally { rmSync(h.root, { recursive: true, force: true }); }
 });

 it("Local carrier dependencies are enforced before either Host can enroll a Child without remotes", async () => {
  const h = parentFixture(false);
  try {
   writeFileSync(join(h.root, "docs/initiatives/parent.md"), "# Parent\n## S1: root\nTasks:\n- root-task\n## S2: child\nTasks:\n- other-task\nBlocked by: root-task\n");
   await expect(assertIsolatedTaskPrerequisites(h.root, "other-task")).rejects.toThrow("Isolated Slice prerequisites are not integrated: root-task");
   await expect(assertIsolatedTaskPrerequisites(h.root, "root-task")).resolves.toBeUndefined();
  } finally { rmSync(h.root, { recursive: true, force: true }); }
 });

 it("an unrelated or malformed Initiative file never blocks Enrollment, but a malformed file naming the Task does", async () => {
  const h = parentFixture(false);
  try {
   writeFileSync(join(h.root, "docs/initiatives/parent.md"), "# Parent\n## S1: root\nTasks:\n- root-task\n## S2: child\nTasks:\n- other-task\nBlocked by: root-task\n");
   writeFileSync(join(h.root, "docs/initiatives/README.md"), "# Notes\nNo Slice is declared here.\n");
   writeFileSync(join(h.root, "docs/initiatives/draft.md"), "# Draft\n## S1: split\nTasks:\n- one\n- two\n");
   await expect(assertIsolatedTaskPrerequisites(h.root, "other-task")).rejects.toThrow("Isolated Slice prerequisites are not integrated: root-task");
   await expect(assertIsolatedTaskPrerequisites(h.root, "root-task")).resolves.toBeUndefined();
   await expect(assertIsolatedTaskPrerequisites(h.root, "unrelated-task")).resolves.toBeUndefined();
   await expect(assertIsolatedTaskPrerequisites(h.root, "one")).rejects.toThrow("must name exactly one Task");
  } finally { rmSync(h.root, { recursive: true, force: true }); }
 });

 it("Claude releases a Parent before reading stale workspace artifacts", async () => {
  const h = parentFixture(false);
  try {
   const base = { cwd: h.root, session_id: h.binding.session_id };
   const hook = (event: Record<string, unknown>) => runContinuationHookOutput({ ...base, ...event }, h.root);
   const entry = { ...base, hook_event_name: "UserPromptSubmit", prompt: "/drive parent" };
   recordPhaseEntryPrompt(entry, { root: h.root }); await hook(entry);
   const batch = { tool_name: "mcp__plugin_immune-brain_immune-brain__start_unattended_batch", tool_use_id: "batch", tool_input: { initiative_slug: "parent" } };
   await hook({ ...batch, hook_event_name: "PreToolUse" });
   await hook({ ...batch, hook_event_name: "PostToolUse", tool_response: { state: "started", batch_id: h.binding.batch_id } });
   rmSync(join(h.root, "docs/initiatives/parent.md"));
   expect(JSON.parse((await hook({ hook_event_name: "Stop", cwd: tmpdir() }))!).systemMessage).toContain("workspace changed");
   expect(await hook({ hook_event_name: "Stop" })).toBeNull();
  } finally { rmSync(h.root, { recursive: true, force: true }); }
 });

 it("a Lane Parent drives its main-workspace native critical Task", async () => {
  const h = parentFixture(true);
  try {
   const facts = await observeParentRun(h.binding, "boundary");
   expect(facts.runnable).toBe(true); expect(facts.next_action).toContain("advance_assurance");
   expect(facts.next_action).not.toContain("start_unattended_batch"); expect(facts.final_passed).toBe(false);
  } finally { rmSync(h.root, { recursive: true, force: true }); }
 });
 it.each([true, false])("Pi parks a critical gate rejected three times and continues its ordinary Task (error=%p)", async isError => {
  const h = parentFixture(false);
  try {
   const handlers = new Map<string, Function>();
   registerPiRunContinuation({ on: (name: string, callback: Function) => handlers.set(name, callback) } as any,
    { entry: text => recognizePhaseEntry(text, NO_LOCAL_NAMES, "pi") });
   const ctx = { cwd: h.root, sessionManager: { getSessionId: () => h.binding.session_id, getLeafId: () => "boundary" } };
   const emit = (name: string, event: unknown) => handlers.get(name)?.(event, ctx);
   await emit("input", { text: "/drive parent", source: "interactive" });
   await emit("tool_call", { toolName: "start_unattended_batch", toolCallId: "batch", input: { initiative_slug: "parent" } });
   await emit("tool_result", { toolName: "start_unattended_batch", toolCallId: "batch", isError: false, details: { state: "started", batch_id: h.binding.batch_id } });
   const gate = { toolName: "imm_canary_enrollment", toolCallId: "gate", input: { task_id: "other-task" } };
   for (const attempt of [1, 2, 3]) {
    const call = { ...gate, toolCallId: `gate-${attempt}` };
    expect(await emit("tool_call", call)).toBeUndefined();
    await emit("tool_result", { ...call, isError, details: { state: "cancelled", reason: "cancelled" } });
   }
   expect(await emit("tool_call", { ...gate, toolCallId: "retry" })).toMatchObject({ block: true });
   const decision = await emit("agent_before_settle", { outcome: "completed", continue: false, context: { canContinue: true, pendingMessages: [] } });
   expect(decision).toMatchObject({ continue: true });
   expect(decision.entries[0].content).toContain("advance_assurance");
  } finally { rmSync(h.root, { recursive: true, force: true }); }
 });
 it.each(["PostToolUse", "PostToolUseFailure"])("Claude parks only the critical gate after three %s failures", async failureEvent => {
  const h = parentFixture(false);
  try {
   const base = { cwd: h.root, session_id: h.binding.session_id };
   const hook = (event: Record<string, unknown>) => runContinuationHookOutput({ ...base, ...event }, h.root);
   const entry = { ...base, hook_event_name: "UserPromptSubmit", prompt: "/drive parent" };
   recordPhaseEntryPrompt(entry, { root: h.root }); await hook(entry);
   const batch = { tool_name: "mcp__plugin_immune-brain_immune-brain__start_unattended_batch", tool_use_id: "batch", tool_input: { initiative_slug: "parent" } };
   await hook({ ...batch, hook_event_name: "PreToolUse" });
   await hook({ ...batch, hook_event_name: "PostToolUse", tool_response: { state: "started", batch_id: h.binding.batch_id } });
   const gate = { tool_name: "mcp__plugin_immune-brain_immune-brain__enroll", tool_use_id: "gate", tool_input: { task_id: "other-task" } };
   for (const attempt of [1, 2, 3]) {
    const call = { ...gate, tool_use_id: `gate-${attempt}` };
    expect(await hook({ ...call, hook_event_name: "PreToolUse" })).toBeNull();
    await hook({ ...call, hook_event_name: failureEvent, tool_response: { state: "cancelled" }, error: "cancelled" });
   }
   expect(JSON.parse((await hook({ ...gate, tool_use_id: "retry", hook_event_name: "PreToolUse" }))!)).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
   expect(await hook({ ...batch, tool_use_id: "resume", hook_event_name: "PreToolUse" })).toBeNull();
   const transcript = join(h.root, ".imm", "transcript.jsonl");
   writeFileSync(transcript, JSON.stringify({ type: "assistant", uuid: "parent-boundary" }) + "\n");
   const stop = JSON.parse((await hook({ hook_event_name: "Stop", transcript_path: transcript }))!);
   expect(stop).toMatchObject({ decision: "block", reason: expect.stringContaining("advance_assurance") });
  } finally { rmSync(h.root, { recursive: true, force: true }); }
 });
});

describe("Parent completion and final verification", () => {
 it("keeps a Parent incomplete without integrated authoritative deliveries", async () => {
  const root = repository();
  try {
   const proof = await observeParentCompletion(root, "parent", ["critical-slice", "normal-slice"]);
   expect(proof.complete).toBe(false);
   expect(proof.missing_task_ids).toEqual(["critical-slice", "normal-slice"]);
   expect(proof.final_passed).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
 });
 it("binds a passed final verifier to the integrated Git HEAD", async () => {
  const root = repository();
  try {
   const report = await runFinalVerification(root, ["bun --version"]);
   expect(report.passed).toBe(true);
   expect(report.head).toBe(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim());
   expect(parseFinalVerificationReport(report, ["bun --version"])).toEqual(report);
   expect(() => parseFinalVerificationReport(report, ["git --version"])).toThrow("commands changed");
  } finally { rmSync(root, { recursive: true, force: true }); }
 });
 it("does not certify uncommitted tracked source even when commands pass", async () => {
  const root = repository();
  try {
   writeFileSync(join(root, "base.txt"), "unintegrated\n");
   const report = await runFinalVerification(root, ["bun --version"]);
   expect(report.results[0]!.passed).toBe(true);
   expect(report.passed).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
 });
 it("does not certify untracked source consumed by verification", async () => {
  const root = repository();
  try {
   writeFileSync(join(root, "untracked-source.ts"), "export const uncommitted = true;\n");
   const report = await runFinalVerification(root, ["bun --version"]);
   expect(report.results[0]!.passed).toBe(true); expect(report.passed).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
 });
 it("records a command failure without deleting integrated files", async () => {
  const root = repository();
  try {
   const report = await runFinalVerification(root, ["git not-a-command"]);
   expect(report.passed).toBe(false);
   expect(report.results[0]!.exit_code).not.toBe(0);
   expect(await Bun.file(join(root, "base.txt")).text()).toBe("base\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
 });
});

// Spec batch-resource-safety-s2 D4, SCN-6: a reopened completed Parent report is
// rebuilt from durable facts, so it keeps every retained-Lane notice.
describe("retained Lanes in a completed Parent report", () => {
 it("identifies a present Lane on every reopen, re-enrolls nothing, and only observes an absent Lane", async () => {
  const f = settledDeliveryFixture();
  try {
   f.settle("s5"); f.settle("s6"); f.git("add", "-A"); f.git("commit", "-qm", "deliver");
   const head = f.git("rev-parse", "HEAD");
   const branch = "refs/heads/imm/parent";
   f.git("update-ref", branch, head);
   const kept = join(f.root, ".imm/state/lanes/s5"), absent = join(f.root, ".imm/state/lanes/s6");
   f.git("worktree", "add", "-q", "-b", "imm-lane/parent/s5", kept, head);
   writeFileSync(join(kept, "scratch.local"), "user bytes\n");
   const now = new Date().toISOString();
   const state = prepareBatchLaneRunState({ batch_id: "retained-batch", initiative_slug: "parent", plan_digest: `sha256:${"d".repeat(64)}`,
    base_head: f.baseHead, branch, confirmation_time: now, now, budget: { max_children: 2, qa_failure_limit: 2 }, max_parallel: 2,
    children: (["s5", "s6"] as const).map(id => ({ task_id: id, slice_id: id.toUpperCase(), blocked_by: id === "s6" ? ["s5"] : [],
     status: "enrollable" as const, risk: f.intents[id].risk, intent_path: `docs/plans/${id}.intent.json`, intent_revision: 1,
     intent_content_hash: canonicalIntentHash(f.intents[id]), scope_hint: f.intents[id].scope_hint, reason: null, exclusion: null })) });
   state.batch_state = "completed"; state.commits = [head];
   for (const child of state.children) Object.assign(child, { state: "integrated", commit: head,
    lane: { path: child.task_id === "s5" ? kept : absent, branch: `imm-lane/parent/${child.task_id}`, base_head: f.baseHead, lane_commit: head } });
   state.final_verification_result = await runFinalVerification(f.root, ["bun --version"], { parent_head: head });
   writeBatchLaneRunState(f.root, state);
   const durable = readBatchLaneRunState(f.root, state.batch_id);
   const reports = [await completedParentReport(f.root, "parent", f.reader), await completedParentReport(f.root, "parent", f.reader)]
    .map(report => report as unknown as BatchLaneRunReport);
   for (const report of reports) {
    expect(report).toMatchObject({ batch_state: "completed", commits: [head], children: durable!.children,
     final_verification: state.final_verification_result, handoffs: [] });
    expect(report.lane_refusals).toEqual([{ task_id: "s5", path: kept, reason: expect.stringContaining("batch_lane_retained: ") }]);
    expect(report.next_action).toStartWith("Parent delivery and final verification passed. Cleanup was not performed: 1 runtime-created Lane(s) are kept");
    expect(JSON.stringify(report.lane_refusals)).not.toContain("released");
   }
   expect(readBatchLaneRunState(f.root, state.batch_id)).toEqual(durable);
   expect(f.git("worktree", "list", "--porcelain")).toContain(`worktree ${realpathSync(kept)}\n`);
   expect(readFileSync(join(kept, "scratch.local"), "utf8")).toBe("user bytes\n");
   expect(existsSync(absent)).toBe(false);
   expect(f.git("rev-parse", branch)).toBe(head);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
 });
});

// Spec content-delivery-authority S1, SCN-1, D1, D2, D5: settled `done` with an
// unchanged TaskIntent is delivered wherever its bytes live; Git is the user's.
describe("settled is delivered", () => {
 const commitCount = (f: ReturnType<typeof settledDeliveryFixture>) => Number(f.git("rev-list", "--count", "HEAD"));
 const noGate: NativeParentGate = async () => { throw new Error("no native gate may open for settled delivery"); };

 it("a critical delivery in a user-made commit unblocks its dependent with no integrate action, gate or runtime commit", async () => {
  const f = settledDeliveryFixture();
  try {
   f.settle("s5"); f.git("add", f.source.s5); f.git("commit", "-qm", "my own message, no trailer");
   const commits = commitCount(f); const head = f.git("rev-parse", "HEAD");
   expect(await observeParentCompletion(f.root, "parent", ["s5"])).toMatchObject({ integrated_task_ids: ["s5"], missing_task_ids: [] });
   await expect(assertIsolatedTaskPrerequisites(f.root, "s6")).resolves.toBeUndefined();
   // The unsettled critical s6 is batch work now, not a native Parent step (D5).
   expect(await observeNativeParent(f.root, "parent", f.reader)).toBeNull();
   expect(await advanceNativeParent(f.root, "parent", undefined, f.reader, undefined, noGate)).toBeNull();
   expect(commitCount(f)).toBe(commits); expect(f.git("rev-parse", "HEAD")).toBe(head);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
 });

 it("a delivery left staged beside an out-of-scope staged path is delivered", async () => {
  const f = settledDeliveryFixture();
  try {
   f.settle("s5"); f.git("add", f.source.s5); f.git("commit", "-qm", "s5");
   f.settle("s6"); writeFileSync(join(f.root, "docs/plans/elsewhere.intent.json"), "{}\n");
   f.git("add", f.source.s6, "docs/plans/elsewhere.intent.json");
   const commits = commitCount(f);
   expect(await observeParentCompletion(f.root, "parent", ["s5", "s6"])).toMatchObject({ integrated_task_ids: ["s5", "s6"], missing_task_ids: [] });
   expect(commitCount(f)).toBe(commits);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
 });

 // D7: the completion names the settled scoped content hash and leaves Git to the user.
 it("a completion report states the settled content hash and that the user may commit however they prefer", () => {
  const f = settledDeliveryFixture();
  try {
   f.settle("s5");
   expect(withCompletionDelivery("s5", { state: "completed" }, f.root)).toEqual({ state: "completed", delivery: {
    content_hash: deliveryHash("s5"),
    note: `Changes are in the working tree with scoped content hash ${deliveryHash("s5")}; commit however you prefer.` } });
   expect(withCompletionDelivery("s5", { state: "rework" }, f.root)).toEqual({ state: "rework" });
  } finally { rmSync(f.root, { recursive: true, force: true }); }
 });

 it.each([
  ["stopped", (f: ReturnType<typeof settledDeliveryFixture>) => { f.settle("s5", "stopped"); }],
  ["unsettled", (f: ReturnType<typeof settledDeliveryFixture>) => { f.settle("s5", "active"); }],
  ["revised TaskIntent", (f: ReturnType<typeof settledDeliveryFixture>) => {
   f.settle("s5");
   writeFileSync(join(f.root, "docs/plans/s5.intent.json"), JSON.stringify({ ...f.intents.s5, goal: "Deliver s5 differently", revision: 2 }, null, 2) + "\n");
  }],
 ] as const)("a %s Task is not delivered and keeps its dependent blocked", async (_label, arrange) => {
  const f = settledDeliveryFixture();
  try {
   arrange(f);
   expect(await observeParentCompletion(f.root, "parent", ["s5"])).toMatchObject({ integrated_task_ids: [], missing_task_ids: ["s5"] });
   await expect(assertIsolatedTaskPrerequisites(f.root, "s6")).rejects.toThrow("prerequisites are not integrated: s5");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
 });
});
