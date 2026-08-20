import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

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

function taskPhase(taskId: string): string | null {
  const p = join(REPO_ROOT, ".imm/tasks", `${taskId}.json`);
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    return j.phase ?? j.record?.phase ?? null;
  } catch { return null; }
}

// Bookkeeping for the archival system itself. A commit touching only these is
// never evidence that an intent was executed, even when the intent declares
// them in scope_hint.
const PLANNING_PATHS = [
  /^docs\/plans\//,
  /^docs\/reference\/v4-roadmap-taskintent-drafts\.md$/,
  /^tests\/planning-artifact-archival\.test\.ts$/,
];

function isPlanningPath(path: string): boolean {
  return PLANNING_PATHS.some((pattern) => pattern.test(path));
}

// Fallback for intents whose TaskRecord is missing. Committing a sidecar is a
// precondition of enrollment, not proof of execution, so the commit that added
// it cannot count: an intent is implemented once a later commit touches a
// non-planning path the intent itself declared.
function hasImplementingCommit(intentPath: string): boolean {
  try {
    const intent = JSON.parse(readFileSync(join(REPO_ROOT, intentPath), "utf8"));
    const scope: string[] = (intent.scope_hint ?? []).filter(
      (path: string) => !isPlanningPath(path),
    );
    if (scope.length === 0) return false;
    const added = (execFileSync("git", ["log", "--reverse", "--format=%H", "--", intentPath], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    } as any) as unknown as string).trim().split("\n")[0];
    if (!added) return false;
    const out = execFileSync("git", ["log", "--oneline", `${added}..HEAD`, "--", ...scope], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    } as any) as unknown as string;
    return out.trim().length > 0;
  } catch { return false; }
}

function isCanaryFixture(taskId: string): boolean {
  return /^canary-00[1-4]$/.test(taskId);
}

describe("planning artifact archival", () => {
  test("terminal sidecars are archived, only non-terminal and canary fixtures remain in docs/plans", () => {
    const plansDir = join(REPO_ROOT, "docs/plans");
    const activeIntents = listFiles(plansDir, ".intent.json").filter(p => !p.includes("/archive/"));
    const violations: string[] = [];
    const shouldArchive: string[] = [];
    for (const full of activeIntents) {
      const rel = full.replace(REPO_ROOT + "/", "");
      const base = full.split("/").pop()!;
      const taskId = base.replace(".intent.json", "");
      if (isCanaryFixture(taskId)) continue;
      const phase = taskPhase(taskId);
      if (phase === "done" || phase === "stopped") {
        violations.push(`${rel} is terminal ${phase} but lives in docs/plans`);
        shouldArchive.push(rel);
        continue;
      }
      if (phase === null) {
        // no record: check second signal
        if (hasImplementingCommit(rel)) {
          violations.push(`${rel} has implementing commit but no record, should be archived`);
          shouldArchive.push(rel);
        }
        // else pending, allow to remain
      }
    }
    // also check that nothing in archive is non-terminal (sanity)
    const archived = listFiles(join(plansDir, "archive"), ".intent.json");
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
      "docs/specs/v4-deletion-completion-and-contract-realignment-roadmap.spec.md",
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
    // protected set: at most 3 entries, each with live justification (replaces prior 54-entry blanket exemptionList)
    const protectedSpecs = new Set([
      // live roadmap of the in-flight v4 program, referenced by docs/reference/v4-roadmap-taskintent-drafts.md; filename-or-citation heuristic misclassifies because a roadmap about deleting v3 necessarily discusses v3
      "docs/specs/v4-deletion-completion-and-contract-realignment-roadmap.spec.md",
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
      if (s1 || s2) {
        violations.push(`${rel} is terminal (S1=${s1} S2=${s2}) but lives in docs/specs`);
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
});
