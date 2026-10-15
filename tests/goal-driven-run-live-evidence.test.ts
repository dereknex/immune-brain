import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseTaskRecord } from "../plugins/immune-brain/runtime/kernel/validation";

const sha256 = (bytes: string | Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
// A release version bump rewrites the plugin version constant only, so source identity masks it.
const releaseNeutralSource = (path: string) => readFileSync(path, "utf8").replace(/PLUGIN_VERSION = "\d+\.\d+\.\d+"/g, 'PLUGIN_VERSION = "<release>"');
const scenarios = ["parent_dependencies_and_independent_branch", "ordinary_failure_and_review", "successor_handoff", "integration_and_final", "serial_fallback", "isolated_child_prerequisite", "status_preserves_binding", "explicit_cancellation", "critical_and_descendant", "final_failure_and_repair"];

test("both actual Hosts preserve matching unattended scenario and Kernel delivery evidence", () => {
 const report = JSON.parse(readFileSync("docs/evidence/goal-driven-run-host-smoke.json", "utf8"));
 expect(report.contract).toBe("immune_brain/goal_driven_run_live_evidence/v1");
 expect(report.capture.actor).toBe("actual-host-model");
 expect(report.capture.carrier).toBe("local-api-fixture");
 expect(report.capture.native_inputs).toBe("scripted-fixture-test-user");
 const intent = JSON.parse(readFileSync("docs/plans/goal-driven-run.intent.json", "utf8"));
 const sourcePaths = intent.scope_hint.filter((path: string) => path.startsWith("plugins/immune-brain/") && /\.(ts|mjs|md|json)$/.test(path));
 for (const path of sourcePaths) expect(report.source_sha256[path]).toBe(sha256(releaseNeutralSource(path)));
 expect(report.hosts.map((host: any) => host.host).sort()).toEqual(["claude-code", "pi"]);
 for (const host of report.hosts) {
  expect(host.version).toMatch(/^\d+\.\d+\.\d+/);
  expect(host.models.length).toBeGreaterThan(0);
  expect(host.models.every((model: unknown) => typeof model === "string" && model.length > 0)).toBe(true);
  const gaps: any[] = host.declared_gaps ?? [];
  if (host.host === "claude-code") expect(gaps).toEqual([]);
  expect(new Set(gaps.map((gap) => gap.scenario)).size).toBe(gaps.length);
  for (const gap of gaps) {
   expect(scenarios).toContain(gap.scenario);
   expect(host.cases.some((capture: any) => capture.scenarios.includes(gap.scenario))).toBe(false);
   expect(gap.reason).toMatch(/\S/);
   expect(gap.accepted_by).toBe("user-approved-intent-revision-5");
   expect(gap.attempts.length).toBeGreaterThan(0);
   for (const attempt of gap.attempts) expect(attempt.outcome).not.toBe("passed");
  }
  for (const scenario of scenarios) {
   const captures = host.cases.filter((capture: any) => capture.scenarios.includes(scenario));
   if (captures.length === 0) {
    expect(gaps.map((gap) => gap.scenario)).toContain(scenario);
    continue;
   }
   for (const capture of captures) {
    expect(capture.outcome).toBe("passed");
    expect(["passed", "host_result"]).toContain(capture.controller_outcome);
    for (const path of sourcePaths) expect(capture.source_sha256[path]).toBe(report.source_sha256[path]);
    expect(capture.manual_continuations).toBe(0);
    expect(capture.response_boundaries).toBeGreaterThan(0);
    expect(capture.initial_input_sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    if (["parent_dependencies_and_independent_branch", "successor_handoff", "integration_and_final", "serial_fallback", "critical_and_descendant", "final_failure_and_repair"].includes(scenario)) {
     expect(capture.tasks.length).toBeGreaterThan(0);
     expect(capture.final_verification.passed).toBe(true);
     expect(capture.final_verification.head).toBe(capture.integrated_head);
    }
    if (scenario === "ordinary_failure_and_review") {
     expect(capture.observations.qa_failure_observed).toBe(true);
     expect(capture.observations.review_observed).toBe(true);
    }
    if (scenario === "isolated_child_prerequisite") {
     expect(capture.observations).toMatchObject({ no_claim: true, no_run: true, no_native_gate: true, no_sibling_delivery: true, tracked_source_pristine: true });
    }
    if (scenario === "status_preserves_binding") expect(capture.observations.status_query.text).toBe("当前进度？");
    if (scenario === "explicit_cancellation") {
     expect(capture.observations.cancel_input.text).toBe("停止本次运行");
     expect(capture.observations.claim_preserved).toBe(true);
     expect(capture.observations.kernel_completion_ready).toBe(false);
    }
    for (const task of capture.tasks) {
     const record = parseTaskRecord(JSON.parse(task.record_bytes));
     const proof = JSON.parse(task.terminal_proof_bytes);
     expect(proof.task_id).toBe(record.task_id);
     expect(proof.final_record_hash).toBe(sha256(task.record_bytes));
     expect(proof.terminal_lifecycle).toBe(record.lifecycle);
     expect(task.run_id).toMatch(/^run-[a-f0-9-]+$/);
     expect(["done", "stopped"]).toContain(record.lifecycle);
     if (record.lifecycle === "done") {
      expect(task.integrated_commit).toMatch(/^[a-f0-9]{40}$/);
      expect(task.commit_is_ancestor).toBe(true);
      expect(task.scope_validated).toBe(true);
     }
    }
   }
  }
 }
});
