import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeRuntime } from "../plugins/immune-brain/runtime/claude/kernel_ports";
import { ClaudeReviewHost, MemoryHookEventLog, REVIEWER_AGENT, AGENT_TOOL } from "../plugins/immune-brain/runtime/claude/review_host";
import { advanceNativeParent, recordParentRepair } from "../plugins/immune-brain/runtime/unattended/batch_git";
import { readNativeParentFinalReport } from "../plugins/immune-brain/runtime/unattended/batch_state";
import { readAuditTaskPair, readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage";
import { prepareFinalRepairCandidate, type FinalVerificationReport } from "../plugins/immune-brain/runtime/unattended/batch_final_verification";

function failure(): FinalVerificationReport {
 return { passed: false, head: "a".repeat(40), results: [
  { command: "bun run verify:integration", exit_code: 1, signal: null, passed: false, duration_ms: 10 },
  { command: "bun run typecheck", exit_code: 0, signal: null, passed: true, duration_ms: 5 },
 ] };
}
function input() {
 return { initiative_slug: "parent", original_goal: "Deliver the confirmed Parent goal", scope_hint: ["src/integration.ts"], failure: failure(), prior_repairs: 0 };
}

describe("native repair recovery round trip", () => {
 it("requires a fresh gate, preserves original delivery, settles and integrates the repair before Parent success", async () => {
  const root = mkdtempSync(join(tmpdir(), "gdr-repair-roundtrip-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  const host = new ClaudeReviewHost(new MemoryHookEventLog());
  let decision: "accept" | "decline" = "accept", gates = 0;
  const inputs: Array<Record<string, any>> = [];
  const runtime = new ClaudeRuntime({ cwd: root, host, interactive: true,
   env: { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "default" },
   requestConfirmation: async input => { inputs.push(input); return { decision, requestId: `repair-gate-${++gates}` }; } });
  runtime.bindHostVersion("2.1.236");
  const meta = (taskId: string) => ({ taskId, sessionId: "repair-test", toolCallId: `call-${gates}`, interactive: true });
  try {
   mkdirSync(join(root, "docs/plans"), { recursive: true }); mkdirSync(join(root, "docs/initiatives"));
   writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
   writeFileSync(join(root, "integration.txt"), "broken\n");
   writeFileSync(join(root, "delivered.txt"), "pending\n");
   writeFileSync(join(root, "verify.ts"), "if ((await Bun.file('integration.txt').text()) !== 'fixed\\n') process.exit(1);\n");
   writeFileSync(join(root, "verify-original.ts"), "if ((await Bun.file('delivered.txt').text()) !== 'done\\n') process.exit(1);\n");
   const original = { contract: "assurance_kernel/task_intent/v1", task_id: "original", goal: "Deliver the Parent", owner: "user", risk: "routine", revision: 1,
    scope_hint: ["docs/plans/original.intent.json", "delivered.txt"], acceptance: [{ id: "original", assertion: "Original delivery is complete", verification: JSON.stringify({
     contract: "assurance_kernel/verification_descriptor/v2", command: { executable: "bun", argv: ["verify-original.ts"], cwd: ".", timeout_ms: 10000, max_output_bytes: 8192 }, environment: { writable_paths: [] } }) }] };
   writeFileSync(join(root, "docs/plans/original.intent.json"), JSON.stringify(original, null, 2) + "\n");
   writeFileSync(join(root, "docs/initiatives/repair-parent.md"), "# Parent\n## S1: Original\nTasks:\n- original\n");
   git("init", "-q", "-b", "main"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.com"); git("add", "."); git("commit", "-qm", "fixture");
   await runtime.enroll("original", meta("original"));
   writeFileSync(join(root, "delivered.txt"), "done\n"); git("add", "delivered.txt");
   expect((await runtime.advance("original") as any).state).toBe("completed");
   // The first run of caller-supplied final commands needs the user's native confirmation of exactly those commands.
   expect(await advanceNativeParent(root, "repair-parent", ["bun verify.ts"])).toMatchObject({ state: "rejected" });
   decision = "decline";
   const finalCall = () => runtime.startUnattendedBatch("repair-parent", meta("repair-parent"), { final_verification: ["bun verify.ts"] }) as Promise<any>;
   expect(await finalCall()).toMatchObject({ state: "rejected" });
   expect(readNativeParentFinalReport(root, "repair-parent")).toBeNull();
   decision = "accept";
   const failed = await finalCall();
   expect(inputs.at(-1)).toMatchObject({ operation: "start_unattended_batch", initiativeSlug: "repair-parent",
    batchDetails: { final_verification: ["bun verify.ts"], parent_final_verification: { integrate_task_ids: ["original"] } } });
   expect(failed).toMatchObject({ action: "repair", proof: { complete: false } });
   const originalBytes = JSON.stringify(readAuditTaskPair(root, "original"));
   const prepared = prepareFinalRepairCandidate({ initiative_slug: "repair-parent", original_goal: original.goal,
    scope_hint: ["integration.txt"], failure: failed!.final_verification!, prior_repairs: 0 });
   const task = prepared.candidate.task_id;
   writeFileSync(join(root, `docs/plans/${task}.intent.json`), JSON.stringify(prepared.candidate, null, 2) + "\n");
   git("add", "docs/plans"); git("commit", "-qm", "repair candidate");
   const head = git("rev-parse", "HEAD"), report = readNativeParentFinalReport(root, "repair-parent");
   decision = "decline";
   await expect(runtime.enroll(task, meta(task))).rejects.toThrow();
   expect(readTaskRecordRaw(root, task).record).toBeNull();
   expect(git("rev-parse", "HEAD")).toBe(head);
   expect(readFileSync(join(root, "integration.txt"), "utf8")).toBe("broken\n");
   expect(readNativeParentFinalReport(root, "repair-parent")).toEqual(report);
   expect(JSON.stringify(readAuditTaskPair(root, "original"))).toBe(originalBytes);
   decision = "accept";
   await runtime.enroll(task, meta(task));
   await recordParentRepair(root, null, task, "repair-parent");
   expect(readNativeParentFinalReport(root, "repair-parent")?.repair_tasks?.[0]?.task_id).toBe(task);
   expect((await advanceNativeParent(root, "repair-parent"))?.proof.complete).toBe(false);
   writeFileSync(join(root, "integration.txt"), "fixed\n"); git("add", "integration.txt");
   const ready: any = await runtime.advance(task);
   expect(ready.state).toBe("review_ready");
   const verdict = { contract: "assurance_kernel/assurance_verdict/v2", role: "review", task_id: task, snapshot_digest: ready.snapshot_digest,
    decision: "pass", approval: { kind: "review", authority_role: "reviewer", summary: "repair fixture verified", inspected_paths: ["integration.txt"] } };
   const context = { sessionId: "repair-review", agentId: "repair-reviewer", taskId: task, operationId: ready.operation_id };
   host.observe({ ...context, type: "SubagentStart", agent: REVIEWER_AGENT });
   host.observe({ ...context, type: "PostToolUse", toolName: AGENT_TOOL, result: JSON.stringify(verdict) });
   host.observe({ ...context, type: "SubagentStop", agent: REVIEWER_AGENT });
   expect((await runtime.submitReview(task, verdict) as any).state).toBe("completed");
   // Integrating the newly settled repair is a new delivery effect: an ungated direct call is refused without side effects.
   const settledHead = git("rev-parse", "HEAD"), gatesBefore = gates;
   expect(await advanceNativeParent(root, "repair-parent")).toMatchObject({ state: "rejected" });
   expect(gates).toBe(gatesBefore);
   expect(git("rev-parse", "HEAD")).toBe(settledHead);
   const complete = await finalCall();
   expect(inputs.at(-1)).toMatchObject({ operation: "start_unattended_batch", initiativeSlug: "repair-parent",
    batchDetails: { parent_final_verification: { integrate_task_ids: expect.arrayContaining([task]) } } });
   expect(complete).toMatchObject({ action: "complete", proof: { complete: true } });
   expect(complete?.final_verification?.head).toBe(git("rev-parse", "HEAD"));
   expect(complete?.final_verification?.passed).toBe(true);
   expect(JSON.stringify(readAuditTaskPair(root, "original"))).toBe(originalBytes);
   expect(readFileSync(join(root, "delivered.txt"), "utf8")).toBe("done\n");
   expect(gates).toBe(6); // original enroll, final decline/accept, repair enroll decline/accept, repair integration
  } finally { await runtime.shutdown(); rmSync(root, { recursive: true, force: true }); }
 }, 60000);
});

describe("final repair preparation", () => {
 it("preserves the original goal, diagnosed scope and every final command without granting authority", () => {
  const prepared = prepareFinalRepairCandidate(input());
  expect(prepared.candidate.goal).toBe(input().original_goal);
  expect(prepared.candidate.risk).toBe("material");
  expect(prepared.candidate.scope_hint).toEqual([`docs/plans/${prepared.candidate.task_id}.intent.json`, "src/integration.ts"]);
  expect(prepared.candidate.acceptance.map(acceptance => JSON.parse(acceptance.verification).command)).toMatchObject([
   { executable: "bun", argv: ["run", "verify:integration"] }, { executable: "bun", argv: ["run", "typecheck"] },
  ]);
  expect(prepared.delivery_head).toBe(failure().head!);
  expect(prepared).not.toHaveProperty("authorization");
 });
 it("does not mint another task for equal failure observations or verifier timing", () => {
  const first = prepareFinalRepairCandidate(input());
  const repeated = input(); repeated.failure.results[0]!.duration_ms = 900;
  expect(prepareFinalRepairCandidate(repeated).candidate.task_id).toBe(first.candidate.task_id);
  repeated.failure.head = "b".repeat(40);
  expect(prepareFinalRepairCandidate(repeated).candidate.task_id).not.toBe(first.candidate.task_id);
 });
 it("retains the existing coordinator correction bound", () => {
  expect(prepareFinalRepairCandidate({ ...input(), prior_repairs: 1 }).candidate.task_id).toBeDefined();
  expect(() => prepareFinalRepairCandidate({ ...input(), prior_repairs: 2 })).toThrow("budget exhausted");
 });
 it("reconciles environment/head drift instead of generating a code task", () => {
  const drift = input(); drift.failure.results[0] = { ...drift.failure.results[0]!, exit_code: 0, passed: true };
  expect(() => prepareFinalRepairCandidate(drift)).toThrow("environment or delivery HEAD");
  expect(() => prepareFinalRepairCandidate({ ...input(), failure: { ...failure(), passed: true } })).toThrow();
 });
});
