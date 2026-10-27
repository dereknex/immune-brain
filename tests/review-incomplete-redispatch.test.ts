import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseAssuranceVerdict, parseChildVerdict, reviewTurnBudget, snapshotDigest } from "../plugins/immune-brain/runtime/assurance/coordinator";
import { canonicalRecordHash, reviewIncompleteHistory, reduceTask } from "../plugins/immune-brain/runtime/kernel/reducer";
import { reviewIncompleteFixture } from "./fixtures/review-incomplete-fixture";

describe("Review incomplete is a durable non-verdict outcome", () => {
 test("strict parsing rejects malformed incomplete and never lets QA accept it", async () => {
  const f = reviewIncompleteFixture();
  try {
   const c = f.create(); await c.advance(f.taskId, f.ctx); const s = await f.snapshot(c);
   const valid = f.incomplete(s, { inspected_paths: [f.paths[0]] });
   expect(parseChildVerdict(valid, s)).toEqual(valid);
   expect(() => parseAssuranceVerdict(valid, s)).toThrow();
   const qa = { ...s, role: "qa" as const };
   expect(() => parseChildVerdict(f.incomplete(qa, { role: "qa", snapshot_digest: snapshotDigest(qa) }), qa)).toThrow(/Review/);
   for (const override of [ { approval: null }, { approval: {} }, { findings: [] }, { findings: null },
    { inspected_paths: [f.paths[0], f.paths[0]] }, { inspected_paths: ["foreign.ts"] }, { inspected_paths: null },
    { inspected_paths: [""] }, { reason: "" }, { reason: "  " }, { reason: "a\nb" }, { reason: "a\rb" },
    { reason: null }, { task_id: "wrong" }, { snapshot_digest: "wrong" } ]) {
    expect(() => parseChildVerdict(f.incomplete(s, override), s)).toThrow();
    expect(await c.submitReview(f.taskId, f.ctx, f.incomplete(s, override))).toMatchObject({ state: "blocked", code: "verdict_invalid" });
   }
   expect(f.record().record!.history.filter(e => e.type === "record_review_incomplete")).toHaveLength(0);
   expect(f.record().record!.findings).toEqual([]);
  } finally { f.cleanup(); }
 }, 60_000);

 for (const pathCount of [1, 36]) test(`retry doubles budget and survives restart (${pathCount} paths), then pauses exactly once`, async () => {
  const f = reviewIncompleteFixture(pathCount);
  try {
   let c = f.create(); expect((await c.advance(f.taskId, f.ctx)).state).toBe("review_ready");
   const s = await f.snapshot(c), before = f.record().record!;
   const initial = f.requests[0]!.maxTurns;
   expect(await c.submitReview(f.taskId, f.ctx, f.incomplete(s))).toEqual({ state: "blocked", reason: "review_incomplete_retry", recovery_action: "advance_assurance" });
   expect(c.active(f.taskId)).toBeNull(); expect(f.counts()).toEqual({ qaRuns: 1, released: 1 });
   const after = f.record().record!;
   expect(after.findings).toEqual(before.findings); expect(after.attestations).toEqual(before.attestations);
   expect(after.lifecycle).toBe("active"); expect(after.artifact_state).toBe("frozen");
   expect(reviewIncompleteHistory(after.history, s)).toMatchObject({ count: 1, previous_budget: initial, round_limit: 2, retry_authorized: false });
   await c.onSessionShutdown(); c = f.create();
   expect((await c.advance(f.taskId, f.ctx)).state).toBe("review_ready");
   expect(f.requests[1]!.maxTurns).toBe(Math.min(96, initial * 2));
   const second = await f.snapshot(c); expect(second.record_revision).not.toBe(s.record_revision);
   expect(second.diff_hash).toBe(s.diff_hash);
   const result = await c.submitReview(f.taskId, f.ctx, f.incomplete(second));
   expect(result).toMatchObject({ state: "review_incomplete", recovery_action: expect.any(String) });
   expect(Object.keys(result).sort()).toEqual(["reason", "recovery_action", "state"]);
   expect(f.record().record!.lifecycle).toBe("active"); expect(f.record().record!.findings).toEqual([]);
   await c.onSessionShutdown(); c = f.create();
   for (let i = 0; i < 2; i++) expect((await c.advance(f.taskId, f.ctx)).state).toBe("review_incomplete");
   expect(f.requests).toHaveLength(2); expect(f.counts().qaRuns).toBe(1);
  } finally { f.cleanup(); }
 }, 60_000);

 test("a changed content snapshot resets the incomplete rounds and requires fresh QA", async () => {
  const f = reviewIncompleteFixture();
  try {
   let c = f.create(); await c.advance(f.taskId, f.ctx);
   const s = await f.snapshot(c); await c.submitReview(f.taskId, f.ctx, f.incomplete(s));
   writeFileSync(join(f.root, f.paths[0]!), "export const value = 3;\n"); f.git("add", "src");
   await c.onSessionShutdown(); c = f.create(); await c.advance(f.taskId, f.ctx);
   const changed = await f.snapshot(c); expect(changed.diff_hash).not.toBe(s.diff_hash);
   expect(f.requests[1]!.maxTurns).toBe(f.requests[0]!.maxTurns);
   expect(f.counts().qaRuns).toBe(2);
   expect(await c.submitReview(f.taskId, f.ctx, f.incomplete(changed))).toMatchObject({ state: "blocked", reason: "review_incomplete_retry" });
   expect(reviewIncompleteHistory(f.record().record!.history, changed).count).toBe(1);
  } finally { f.cleanup(); }
 }, 60_000);

 test("unknown mutation response is reconciled from Kernel history, not replayed or reported as success", async () => {
  const f = reviewIncompleteFixture();
  try {
   const c = f.create(); await c.advance(f.taskId, f.ctx); const s = await f.snapshot(c);
   const apply = f.ports.applyOrdinaryOperation;
   f.ports.applyOrdinaryOperation = async (...args) => { await apply(...args); throw new Error("response lost after commit"); };
   expect(await c.submitReview(f.taskId, f.ctx, f.incomplete(s))).toMatchObject({ state: "settlement_unknown" });
   expect(f.counts().released).toBe(0); expect(c.active(f.taskId)?.state).toBe("settlement_unknown");
   f.ports.applyOrdinaryOperation = apply;
   expect((await c.advance(f.taskId, f.ctx)).state).toBe("review_ready");
   expect(f.requests[1]!.maxTurns).toBe(f.requests[0]!.maxTurns * 2);
   expect(reviewIncompleteHistory(f.record().record!.history, s).count).toBe(1);
   expect(f.counts().released).toBe(1);
  } finally { f.cleanup(); }
 }, 60_000);

 test("ordinary mutation validates current snapshot, paths and fresh QA without granting authority", async () => {
  const f = reviewIncompleteFixture();
  try {
   const c = f.create(); await c.advance(f.taskId, f.ctx); const s = await f.snapshot(c);
   const operation = { op: "record_review_incomplete", actor_id: "executor", snapshot: s, turn_budget: f.requests[0]!.maxTurns, inspected_paths: [], reason: "coverage unfinished" };
   const revision = f.record().revision;
   for (const field of ["record_revision", "workspace_revision", "intent_content_hash", "diff_hash"]) {
    await expect(f.ports.applyOrdinaryOperation(f.ctx, { taskId: f.taskId, operation: { ...operation, snapshot: { ...s, [field]: "sha256:" + "f".repeat(64) } } })).rejects.toThrow();
   }
   for (const paths of [["foreign.ts"], [f.paths[0]!, f.paths[0]!]]) await expect(f.ports.applyOrdinaryOperation(f.ctx, { taskId: f.taskId, operation: { ...operation, inspected_paths: paths } })).rejects.toThrow();
   expect(f.record().revision).toBe(revision);
   const record = f.record().record!;
   const action = { type: "record_review_incomplete" as const, actor_id: "executor", event_id: "test", at: "test", expected_record_hash: revision, expected_workspace_hash: s.workspace_revision,
    intent_content_hash: s.intent_content_hash, diff_hash: s.diff_hash, turn_budget: 16, inspected_paths: [], reason: "unfinished" };
   for (const changedRecord of [{ ...record, attestations: [] }, { ...record, artifact_state: "active" as const }]) {
    expect(() => reduceTask(changedRecord, { ...action, expected_record_hash: canonicalRecordHash(changedRecord) }, null, f.paths)).toThrow();
   }
   expect(() => reduceTask(record, action, { authority_kind: "review", actor_id: "test", confirmation_ref: "test", issued_at: "test" }, f.paths)).toThrow(/does not accept/);
   await c.submitReview(f.taskId, f.ctx, f.incomplete(s));
   const history = f.record().record!.history;
   expect(() => reviewIncompleteHistory([...history, { ...history.at(-1)!, reason: "invalid" }], s)).toThrow();
   expect(reviewIncompleteHistory(history, { ...s, intent_content_hash: "sha256:" + "f".repeat(64) }).count).toBe(0);
  } finally { f.cleanup(); }
 }, 60_000);

 test("a full Review pass after incomplete still settles normally with fresh QA", async () => {
  const f = reviewIncompleteFixture();
  try {
   const c = f.create(); await c.advance(f.taskId, f.ctx);
   await c.submitReview(f.taskId, f.ctx, f.incomplete(await f.snapshot(c)));
   await c.advance(f.taskId, f.ctx); const s = await f.snapshot(c);
   const pass = { contract: "assurance_kernel/assurance_verdict/v2", role: "review", task_id: f.taskId, snapshot_digest: snapshotDigest(s), decision: "pass",
    approval: { kind: "review", authority_role: "reviewer", summary: "complete coverage passed", inspected_paths: s.dirty_files } };
   expect(await c.submitReview(f.taskId, f.ctx, pass)).toEqual({ state: "completed" });
   expect(f.counts().qaRuns).toBe(1);
  } finally { f.cleanup(); }
 }, 60_000);

 test("budget doubling is bounded at 96", () => {
  expect(reviewTurnBudget("standard", 0, 16)).toBe(32);
  expect(reviewTurnBudget("heavy", 36, 48)).toBe(96);
  expect(reviewTurnBudget("heavy", 36, 96)).toBe(96);
 });
});
