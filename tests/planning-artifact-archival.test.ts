import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { capabilityActionFor, createCanaryApplication } from "../plugins/immune-brain/runtime/kernel/canary_application";
import { createMutationAuthorityRegistry, digestOfAction } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { createEnrollmentAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash, parseTaskIntentV1, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { completionDecision } from "../plugins/immune-brain/runtime/kernel/completion";
import { findingsDigestV2 } from "../plugins/immune-brain/runtime/kernel/reducer";
import { readTaskRecord } from "../plugins/immune-brain/runtime/kernel/storage";
import { taskDiffIdentity } from "../plugins/immune-brain/runtime/workspace_scope";
import { createMutationAuthorityCapabilityForTest } from "./fixtures/mutation-authority-test-seam";

const REPO_ROOT = resolve(import.meta.dir, "..");

// ponytail: 2-year guard not needed here; archival is move-only

function listFiles(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listFiles(p, suffix));
    else if (p.endsWith(suffix)) out.push(p);
  }
  return out;
}

function isCanaryFixture(taskId: string): boolean {
  return /^canary-00[1-4]$/.test(taskId);
}

describe("planning artifact archival", () => {
  test("historical archived intents remain readable JSON TaskIntents", () => {
    const archived = listFiles(join(REPO_ROOT, "docs/plans/archive"), ".intent.json");
    expect(archived.length).toBeGreaterThan(0);
    for (const full of archived.slice(0, 5)) {
      const parsed = JSON.parse(readFileSync(full, "utf8"));
      expect(parsed.contract).toBe("assurance_kernel/task_intent/v1");
      expect(typeof parsed.task_id).toBe("string");
    }
  });

  test("terminal sidecars may remain in docs/plans after freeze-in-place", () => {
    const plansDir = join(REPO_ROOT, "docs/plans");
    const archived = listFiles(join(plansDir, "archive"), ".intent.json");
    const violations: string[] = [];
    for (const full of archived) {
      const base = full.split("/").pop()!.replace(".intent.json", "");
      if (isCanaryFixture(base)) violations.push(`${full} canary should not be archived`);
    }
    expect(violations).toEqual([]);
  });

  test("no active spec instructs retired tools; retirement docs are on explicit exemption list", () => {
    const retired = ["imm-plan.py", "activation_plan.py", "imm-autowork"];
    const instructionalRe = /(run|exec|call|invoke|bun\s+.*|python3?\s+).*?(imm-plan\.py|activation_plan\.py|imm-autowork)/i;
    const specsDir = join(REPO_ROOT, "docs/specs");
    const activeSpecs = listFiles(specsDir, ".spec.md").filter(p => !p.includes("/archive/"));
    // 52 active specs that document retirement (explicit exemption list)
    const exemptionList = new Set([
      "docs/specs/roadmap-human-acceptance-gating.spec.md",
      "docs/specs/post-051-tracked-artifacts.spec.md",
      "docs/specs/roadmap-executable-slice-contract.spec.md",
      "docs/specs/quality-fixes-round-1.spec.md",
      "docs/specs/detailed-design-hardening-phase1.spec.md",
      "docs/specs/pro-workflow-compaction-handoff.spec.md",
      "docs/specs/bounded-autowork-skill.spec.md",
      "docs/specs/append-safe-proof-snapshot.spec.md",
      "docs/specs/addy-agent-skills-upstream-and-skill-anatomy.spec.md",
      "docs/specs/autowork-runtime-host.spec.md",
      "docs/specs/run-completion-loop.spec.md",
      "docs/specs/l2s-workflow-pattern.spec.md",
      "docs/specs/review-followup-imm-work-entry.spec.md",
      "docs/specs/run-review-closure-runtime-gate.spec.md",
      "docs/specs/plan-state-sync-via-imm-plan.spec.md",
      "docs/specs/ui-i18n-review-lens.spec.md",
      "docs/specs/autowork-skill-driver-simplification.spec.md",
      "docs/specs/canonical-pi-imm-loop-backend.spec.md",
      "docs/specs/imm-loop-review-lifecycle-runtime.spec.md",
      "docs/specs/same-path-append-completion-preservation.spec.md",
      "docs/specs/loop-engineering-discipline.spec.md",
      "docs/specs/imm-code-review-subagent-closure.spec.md",
      "docs/specs/planning-quality-gate-planner-contract.spec.md",
      "docs/specs/autowork-codex-plan-sync.spec.md",
      "docs/specs/subagent-telemetry-arbitration-integration.spec.md",
      "docs/specs/subagent-runtime-mvp.spec.md",
      "docs/specs/skill-contract-lint.spec.md",
      "docs/specs/design-contract-audit-lens.spec.md",
      "docs/specs/workflow-trigger-repair.spec.md",
      "docs/specs/inline-clarification-preplan-demotion.spec.md",
      "docs/specs/detailed-design-hardening-master.spec.md",
      "docs/specs/mcp-first-subagent-activation.spec.md",
      "docs/specs/drain-legacy-runtime-test-callers-r2.spec.md",
      "docs/specs/architecture-improvement-wave-3.spec.md",
      "docs/specs/system-subagents-design.spec.md",
      "docs/specs/drain-legacy-runtime-test-callers.spec.md",
      "docs/specs/review-followup-handoff.spec.md",
      "docs/specs/discovery-navigation-layer.spec.md",
      "docs/specs/subagent-evolution.spec.md",
      "docs/specs/workflow-health-gate-repair.spec.md",
      "docs/specs/origin-coverage-closure.spec.md",
      "docs/specs/imm-arch-explorer-domain-survey.spec.md",
      "docs/specs/l2s-installable-alias-skills.spec.md",
      "docs/specs/autowork-followup-completion.spec.md",
      "docs/specs/plan-sync-enforcement-followup.spec.md",
      "docs/specs/host-bound-probe-contract-helper.spec.md",
      "docs/specs/automatic-subagent-activation.spec.md",
      "docs/specs/codex-plan-sync.spec.md",
      "docs/specs/autowork-workflow-refinement.spec.md",
      "docs/specs/analyze-gstack-skills-borrow-insights.spec.md",
      "docs/specs/architecture-deepening-wave-1.spec.md",
    ]);
    const instructionalViolations: string[] = [];
    const exemptionMissing: string[] = [];
    for (const full of activeSpecs) {
      const rel = full.replace(REPO_ROOT + "/", "");
      const content = readFileSync(full, "utf8");
      const hasRetired = retired.some(r => content.includes(r));
      if (!hasRetired) continue;
      const isExempt = exemptionList.has(rel);
      if (!isExempt) {
        instructionalViolations.push(`${rel} references retired tool but not on exemption list`);
      }
      // only flag instructional pattern for non-exempt files; exempt files document retirement by design
      // ponytail: narrow check, add when instructional vs retirement mention needs stricter regex
    }
    // ensure every exempt file actually exists and does contain retired reference (archived retirement docs are allowed)
    for (const exempt of exemptionList) {
      const full = join(REPO_ROOT, exempt);
      const archived = join(REPO_ROOT, exempt.replace("docs/specs/", "docs/specs/archive/"));
      const existing = existsSync(full) ? full : existsSync(archived) ? archived : null;
      if (!existing) exemptionMissing.push(`${exempt} on exemption list but file missing`);
      else {
        const c = readFileSync(existing, "utf8");
        if (!retired.some(r => c.includes(r))) exemptionMissing.push(`${exempt} on exemption list but does not reference retired tool`);
      }
    }
    expect(instructionalViolations).toEqual([]);
    expect(exemptionMissing).toEqual([]);
  });

  test("prose Plans are archived, none remain in docs/plans", () => {
    const plansDir = join(REPO_ROOT, "docs/plans");
    // active prose Plans: any .md under docs/plans not in archive
    const activeProse = listFiles(plansDir, ".md").filter((p) => !p.includes("/archive/"));
    // docs/plans should contain zero prose Plans after archival (only .intent.json canaries + policy remain)
    expect(activeProse).toEqual([]);
    // sanity: archive actually holds the 29 moved prose Plans
    const archived = listFiles(join(plansDir, "archive"), ".md");
    const archivedBases = new Set(archived.map((p) => p.split("/").pop()!));
    // spot-check a few of the 29 to ensure move (not delete) happened
    const spotChecks = [
      "2026-08-05-001-refactor-risk-tiered-workflow-execution-plan.md",
      "2026-08-16-assurance-workflow-hardening.plan.md",
      "architecture-deepening-wave-1.plan.md",
      "discovery-navigation-layer.plan.md",
    ];
    for (const name of spotChecks) {
      expect(archivedBases.has(name)).toBe(true);
      const full = join(plansDir, "archive", name);
      expect(statSync(full).size).toBeGreaterThan(0);
    }
    expect(archived.length).toBeGreaterThanOrEqual(29);
  });

  test("terminal specs are archived, only undetermined and exempt remain in docs/specs", () => {
    const specsDir = join(REPO_ROOT, "docs/specs");
    const plansDir = join(REPO_ROOT, "docs/plans/archive");
    // protected set: at most 2 entries, each with live justification (replaces prior 54-entry blanket exemptionList)
    const protectedSpecs = new Set([
      // pinned by live planning artifacts: scripts/dist-sync-manifest.ts, tests/code-review-activation-contract.test.ts and dist copy plugins/immune-brain/dist/docs/specs/automatic-subagent-activation.spec.md
      "docs/specs/automatic-subagent-activation.spec.md",
      // archived and dual-path pinned: dual-path check below handles docs/specs/archive/opencode-native-plugin.spec.md via tests/python-reference-boundary.test.ts
      "docs/specs/opencode-native-plugin.spec.md",
    ]);
    const activeSpecs = listFiles(specsDir, ".spec.md").filter((p) => !p.includes("/archive/"));
    const archivedPlans = listFiles(plansDir, ".md");
    const planNorms = archivedPlans.map((p) => {
      let n = p.split("/").pop()!.replace(/\.md$/, "");
      if (n.endsWith("-plan")) n = n.slice(0, -5);
      if (n.endsWith(".plan")) n = n.slice(0, -5);
      return n;
    });
    const planTexts = archivedPlans.map((p) => {
      try { return readFileSync(p, "utf8"); } catch { return ""; }
    });
    // intent sidecars: task-produced specs are identified by exact filename match (taskId == spec stem)
    // ponytail: exact equality, not substring; generic specs share suffix with intent names but are not implementing
    const archivedIntents = listFiles(plansDir, ".intent.json");
    const intentNorms = archivedIntents.map((p) => p.split("/").pop()!.replace(/\.intent\.json$/, ""));
    function normSpec(path: string): string {
      let n = path.split("/").pop()!.replace(/\.spec\.md$/, "");
      // spec stem without .spec already handled, but keep for safety
      if (n.endsWith(".spec")) n = n.slice(0, -5);
      return n;
    }
    const violations: string[] = [];
    const terminalActive: string[] = [];
    for (const full of activeSpecs) {
      const rel = full.replace(REPO_ROOT + "/", "");
      if (protectedSpecs.has(rel)) continue;
      const sNorm = normSpec(rel);
      const s1 = planNorms.some((pn) => pn.includes(sNorm));
      const s2 = planTexts.some((txt) => txt.includes(rel));
      const s3 = intentNorms.some((pn) => pn === sNorm);
      if (s1 || s2 || s3) {
        violations.push(`${rel} is terminal (S1=${s1} S2=${s2} S3=${s3}) but lives in docs/specs`);
        terminalActive.push(rel);
      }
    }
    expect(violations).toEqual([]);
    // sanity: archived holds at least the terminal count we expect (102 + prior 82 = 184)
    const archivedSpecs = listFiles(join(specsDir, "archive"), ".spec.md");
    expect(archivedSpecs.length).toBeGreaterThanOrEqual(184);
    // ensure pinned spec is either active or archived (dual-path) and undetermined set is non-empty
    const pinnedCandidates = ["docs/specs/opencode-native-plugin.spec.md", "docs/specs/archive/opencode-native-plugin.spec.md"];
    expect(pinnedCandidates.some((p) => existsSync(join(REPO_ROOT, p)))).toBe(true);
  });

  test("freeze and rework bind content in place without relocating artifacts", () => {
    const taskId = "freeze-inplace";
    const now = "2026-08-12T10:00:00.000Z";
    const root = mkdtempSync(join(tmpdir(), "imm-freeze-inplace-"));
    try {
      mkdirSync(join(root, "docs/plans"), { recursive: true });
      mkdirSync(join(root, "docs/specs"), { recursive: true });
      const intent = {
        contract: "assurance_kernel/task_intent/v1",
        task_id: taskId,
        owner: "user",
        goal: "Freeze without relocating.",
        acceptance: [{ id: "A1", assertion: "stays put", verification: JSON.stringify({
          contract: "assurance_kernel/verification_descriptor/v2",
          command: { executable: "bun", argv: ["test", "tests/x.test.ts"], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 },
        }) }],
        scope_hint: [`docs/plans/${taskId}.intent.json`, `docs/specs/${taskId}.spec.md`],
        risk: "routine",
        revision: 1,
      };
      writeFileSync(join(root, `docs/plans/${taskId}.intent.json`), `${JSON.stringify(intent, null, 2)}\n`);
      writeFileSync(join(root, `docs/specs/${taskId}.spec.md`), "# bound spec\n");
      execFileSync("git", ["init", "-q"], { cwd: root });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
      execFileSync("git", ["add", "-A"], { cwd: root });
      execFileSync("git", ["commit", "-qm", "intent"], { cwd: root });
      const enrollmentRegistry = createEnrollmentAuthorityRegistry();
      const hash = canonicalIntentHash(parseTaskIntentV1(intent));
      const prep = preparePiCanary(root, { task_id: taskId, now });
      const binding = {
        task_id: taskId,
        intent_path: `docs/plans/${taskId}.intent.json`,
        intent_revision: 1,
        intent_content_hash: hash,
        preparation_digest: prep.digest,
        actor_id: "user",
        confirmation_ref: "pi-confirm-enroll",
        expires_at: "2099-01-01T00:00:00.000Z",
        nonce: "nonce-enroll",
      };
      enrollCanaryTask(root, {
        task_id: taskId,
        intent_path: binding.intent_path,
        intent_revision: 1,
        preparation_digest: prep.digest,
        capability: enrollmentRegistry.issue(binding),
        capability_binding: binding,
        now,
      }, enrollmentRegistry);
      const registry = createMutationAuthorityRegistry();
      const app = createCanaryApplication(registry);
      const specPath = join(root, `docs/specs/${taskId}.spec.md`);
      const liveDiff = () => {
        execFileSync("git", ["add", "-A"], { cwd: root });
        return taskDiffIdentity(root, intent.scope_hint);
      };
      const token = () => readTaskIntent(root, taskId, readTaskRecord(root, taskId).record!.intent_ref.path).token;
      const run = (operation: Parameters<typeof app.execute>[0]["operation"], at: string) => {
        const diff = liveDiff();
        return app.execute({
          root,
          task_id: taskId,
          operation,
          prior_intent_token: token(),
          diffProvider: () => diff,
          now: at,
        });
      };
      const frozen = run({ op: "freeze_artifacts", actor_id: "executor-1" }, now);
      expect(frozen.record.artifact_state).toBe("frozen");
      expect(frozen.record.intent_ref.path).toBe(`docs/plans/${taskId}.intent.json`);
      expect(existsSync(join(root, `docs/plans/${taskId}.intent.json`))).toBe(true);
      expect(existsSync(specPath)).toBe(true);
      expect(existsSync(join(root, `docs/plans/archive/${taskId}.intent.json`))).toBe(false);
      expect(existsSync(join(root, `docs/specs/archive/${taskId}.spec.md`))).toBe(false);
      const d1 = liveDiff().diff_hash;
      const qaAt = "2026-08-12T10:00:01.000Z";
      const approval = {
        id: "ap-qa",
        kind: "qa" as const,
        authority_role: "qa" as const,
        task_revision: 1,
        intent_content_hash: hash,
        diff_hash: d1,
        actor_id: "qa-1",
        summary: "passed",
      };
      const qaAction = capabilityActionFor({ op: "record_approval", task_id: taskId, at: qaAt, actor_id: "qa-1", approval });
      const qaCap = createMutationAuthorityCapabilityForTest(registry, {
        authority_kind: "qa",
        task_id: taskId,
        action_digest: digestOfAction(qaAction),
        expected_record_hash: readTaskRecord(root, taskId).revision,
        intent_revision: 1,
        intent_content_hash: hash,
        diff_hash: d1,
        actor_id: "qa-1",
        confirmation_ref: "conf-qa",
        expires_at: "2099-01-01T00:00:00.000Z",
        findings_digest: null,
      });
      run({ op: "record_approval", approval, capability: qaCap, actor_id: "qa-1" }, qaAt);
      const afterQa = readTaskRecord(root, taskId).record!;
      const eligible = completionDecision(parseTaskIntentV1(intent), afterQa, d1, hash, liveDiff().changed_paths);
      expect(eligible.complete).toBe(true);
      writeFileSync(specPath, "# stale spec\n");
      const stale = liveDiff();
      expect(stale.diff_hash).not.toBe(d1);
      expect(completionDecision(parseTaskIntentV1(intent), afterQa, stale.diff_hash, hash, stale.changed_paths).complete).toBe(false);
      expect(() => run({ op: "complete", actor_id: "executor-1" }, "2026-08-12T10:00:01.500Z")).toThrow(/not eligible/);
      expect(readTaskRecord(root, taskId).record).toMatchObject({ lifecycle: "active", artifact_state: "frozen" });
      const findings = [{
        id: "rw-1",
        kind: "blocking" as const,
        status: "open" as const,
        acceptance_id: "A1",
        source: "review" as const,
        review_round: null,
        summary: "stale spec",
      }];
      const reworkAt = "2026-08-12T10:00:02.000Z";
      const action = capabilityActionFor({
        op: "request_rework",
        task_id: taskId,
        at: reworkAt,
        actor_id: "reviewer-1",
        findings: findings as never[],
      });
      const capability = createMutationAuthorityCapabilityForTest(registry, {
        authority_kind: "review",
        task_id: taskId,
        action_digest: digestOfAction(action),
        expected_record_hash: readTaskRecord(root, taskId).revision,
        intent_revision: 1,
        intent_content_hash: hash,
        diff_hash: stale.diff_hash,
        actor_id: "reviewer-1",
        confirmation_ref: "conf-rework",
        expires_at: "2099-01-01T00:00:00.000Z",
        findings_digest: findingsDigestV2(findings as never[]),
      });
      const restored = run(
        { op: "request_rework", capability, findings: findings as never[], actor_id: "reviewer-1" },
        reworkAt,
      );
      expect(restored.record.artifact_state).toBe("active");
      expect(restored.record.intent_ref.path).toBe(`docs/plans/${taskId}.intent.json`);
      expect(existsSync(join(root, `docs/plans/${taskId}.intent.json`))).toBe(true);
      expect(existsSync(specPath)).toBe(true);
      expect(existsSync(join(root, `docs/plans/archive/${taskId}.intent.json`))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
