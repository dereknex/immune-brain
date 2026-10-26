import { writeTestReviewPacket } from "../helpers/review-packet-fixture";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssuranceCoordinator, snapshotDigest, type AssuranceCoordinatorPorts, type SnapshotDescriptor } from "../../plugins/immune-brain/runtime/assurance/coordinator";
import { type AssuranceHostPort, type ReviewRequest } from "../../plugins/immune-brain/runtime/assurance/host_port";
import { createCanaryApplication, type CanaryOperation } from "../../plugins/immune-brain/runtime/kernel/canary_application";
import { createMutationAuthorityRegistry } from "../../plugins/immune-brain/runtime/kernel/authority_port";
import { canonicalIntentHash, parseTaskIntentV1, readTaskIntent } from "../../plugins/immune-brain/runtime/kernel/intent";
import { projectAssurance } from "../../plugins/immune-brain/runtime/kernel/assurance_projection";
import { readTaskRecordRaw } from "../../plugins/immune-brain/runtime/kernel/storage";
import { seedKernelRunForTest } from "./mutation-authority-test-seam";

/** Real Kernel/CAS/history and Review evidence; only deterministic QA execution is stubbed. */
export function reviewIncompleteFixture(pathCount = 1) {
 const root = mkdtempSync(join(tmpdir(), "review-incomplete-"));
 const taskId = "review-incomplete-fixture", ctx = { cwd: root };
 const paths = Array.from({ length: pathCount }, (_, i) => `src/work-${i}.ts`);
 const intentPath = `docs/plans/${taskId}.intent.json`;
 const intent = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: taskId,
  owner: "user", goal: "review the immutable change", risk: "material", revision: 1,
  scope_hint: [...paths, intentPath], acceptance: [{ id: "A1", assertion: "work passes", verification: JSON.stringify({
   contract: "assurance_kernel/verification_descriptor/v2", command: { executable: "bun", argv: ["--version"], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 }, environment: { prepare: null, writable_paths: [] } }) }] });
 mkdirSync(join(root, "src"), { recursive: true }); mkdirSync(join(root, "docs/plans"), { recursive: true });
 writeFileSync(join(root, intentPath), JSON.stringify(intent, null, 2) + "\n");
 for (const path of paths) writeFileSync(join(root, path), "export const value = 1;\n");
 const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "f@f", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "f@f" } }).trim();
 git("init", "-q"); git("add", "-A"); git("commit", "-qm", "base"); const base = git("rev-parse", "HEAD");
 for (const path of paths) writeFileSync(join(root, path), "export const value = 2;\n");
 git("add", "src");
 const hash = canonicalIntentHash(intent);
 seedKernelRunForTest(root, { task_id: taskId, created_at: "2026-08-12T10:00:00.000Z", updated_at: "2026-08-12T10:00:00.000Z", record: {
  contract: "assurance_kernel/task_record/v4", task_id: taskId, intent_snapshot: intent,
  intent_ref: { path: intentPath, content_hash: hash }, lifecycle: "active", artifact_state: "frozen",
  baseline: hash, git_base_head: base, attestations: [], findings: [], history: [],
 } });
 const app = createCanaryApplication(createMutationAuthorityRegistry());
 let qaRuns = 0, released = 0;
 const requests: ReviewRequest[] = [];
 const host: AssuranceHostPort = { host: "fake", prepareReview(request) { requests.push(request); return { id: request.operationId, dispatch: request }; }, releaseReview() { released++; } };
 const ports: AssuranceCoordinatorPorts = {
  host, confirmationReference: ({ actorId }) => `fixture:${actorId}`,
  projectTask: (r, t) => projectAssurance(r, t), readTaskRecord: async (r, t) => readTaskRecordRaw(r, t),
  readTaskIntent: async () => readTaskIntent(root, taskId, intentPath, intent),
  runQa: async s => { qaRuns++; return { contract: "assurance_kernel/assurance_verdict/v2", role: "qa", task_id: taskId, snapshot_digest: snapshotDigest(s), decision: "pass", approval: { kind: "qa", authority_role: "qa", summary: "passed" } }; },
  writeReviewEvidence: () => ({ writePacket: writeTestReviewPacket, path: join(root, "review.json"), remove() {} }),
  applyOrdinaryOperation: async (_ctx, input) => {
   const current = readTaskRecordRaw(root, taskId).record!;
   return app.execute({ root, task_id: taskId, operation: input.operation as CanaryOperation,
    prior_intent_token: readTaskIntent(root, taskId, current.intent_ref.path, current.intent_snapshot).token });
  },
 };
 const create = () => new AssuranceCoordinator(ports);
 const incomplete = (snapshot: SnapshotDescriptor, overrides: Record<string, unknown> = {}) => ({
  contract: "assurance_kernel/assurance_verdict/v2", role: "review", task_id: taskId, snapshot_digest: snapshotDigest(snapshot),
  decision: "incomplete", inspected_paths: [], reason: "Turn budget exhausted before coverage completed", ...overrides,
 });
 return { root, ctx, taskId, paths, git, ports, host, requests, create, incomplete,
  record: () => readTaskRecordRaw(root, taskId), counts: () => ({ qaRuns, released }),
  async snapshot(coordinator: AssuranceCoordinator) { return (await coordinator.authority.buildAssurance(root, taskId, "review", await projectAssurance(root, taskId))).snapshot; },
  cleanup() { rmSync(root, { recursive: true, force: true }); },
 };
}
