import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");

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

describe("retention policy consistency", () => {
  test("retention doc describes signal-based policy and no longer contradicts archival layout", () => {
    const retentionPath = join(REPO_ROOT, "docs/reference/planning-artifact-retention.md");
    const adrPath = join(REPO_ROOT, "docs/adr/0002-maintenance-surface-ownership.md");
    const retention = readFileSync(retentionPath, "utf8");
    const adr = readFileSync(adrPath, "utf8");

    // governing policy contains signal-based keywords
    expect(retention).toContain("S1");
    expect(retention).toContain("S2");
    expect(retention.toLowerCase()).toContain("union");
    expect(retention.toLowerCase()).toContain("move");
    expect(retention.toLowerCase()).toContain("never a delete");
    expect(retention.toLowerCase()).toContain("rewrite");

    // not the old standalone 5-condition gate as sole requirement
    // the old doc had "Before moving or deleting a Plan or Spec, prove all of the following:"
    // new doc must define terminality via S1/S2 instead of that gate alone
    expect(retention).toContain("terminal");

    // ADR Decision 1 is now a governance pointer, not durability-at-path alone
    expect(adr).toContain("planning-artifact-retention.md");
    // old exact sentence must not be Decision 1 anymore
    expect(adr).not.toContain("Plans and Specs remain durable at their existing paths by default. Future moves or deletions follow");

    // both documents agree - retention is single source, ADR points at it
    expect(adr).toContain("governed by");
    expect(retention).toContain("docs/plans/archive");
    expect(retention).toContain("docs/specs/archive");
  });

  test("governing policy names the standing exemptions", () => {
    const retention = readFileSync(join(REPO_ROOT, "docs/reference/planning-artifact-retention.md"), "utf8");
    // 3 protected specs + 1 frozen plan
    const exemptions = [
      "docs/specs/v4-deletion-completion-and-contract-realignment-roadmap.spec.md",
      "docs/specs/automatic-subagent-activation.spec.md",
      "docs/specs/opencode-native-plugin.spec.md",
      "docs/plans/archive/2026-06-29-001-feat-bun-typescript-runtime-migration-plan.md",
    ];
    for (const ex of exemptions) {
      expect(retention).toContain(ex);
    }
    // ADR should align (points at retention, not re-asserting durability alone)
    const adr = readFileSync(join(REPO_ROOT, "docs/adr/0002-maintenance-surface-ownership.md"), "utf8");
    expect(adr).toContain("named exemptions");
  });

  test("disk layout matches governed archival policy thresholds", () => {
    // docs/plans/*.md empty (prose plans archived)
    const plansDir = join(REPO_ROOT, "docs/plans");
    const prosePlans = listFiles(plansDir, ".md").filter(p => !p.includes("/archive/") && !p.endsWith(".intent.json"));
    // only intent jsons and archive dir should remain; prose .md count 0
    const proseMd = prosePlans.filter(p => p.endsWith(".md") && !p.includes("canary"));
    expect(proseMd).toEqual([]);

    // archive thresholds (bulk archival already performed)
    const archivedPlans = listFiles(join(plansDir, "archive"), ".md");
    expect(archivedPlans.length).toBeGreaterThanOrEqual(29);
    const specsArchive = listFiles(join(REPO_ROOT, "docs/specs/archive"), ".spec.md");
    expect(specsArchive.length).toBeGreaterThanOrEqual(184);

    // migration plan exists at archive path and is exempt from rewrite
    expect(existsSync(join(REPO_ROOT, "docs/plans/archive/2026-06-29-001-feat-bun-typescript-runtime-migration-plan.md"))).toBe(true);

    // pinned spec dual-path still holds
    const pinnedCandidates = ["docs/specs/opencode-native-plugin.spec.md", "docs/specs/archive/opencode-native-plugin.spec.md"];
    expect(pinnedCandidates.some(p => existsSync(join(REPO_ROOT, p)))).toBe(true);

    // signature constant still pins the frozen reference (guard against accidental rewrite)
    const planValidation = readFileSync(join(REPO_ROOT, "tests/plan-validation.test.ts"), "utf8");
    expect(planValidation).toContain("e89bf7809875d215c2ca0275c8f6e86e024dd451934fdc04d8e4a422bbd03a6c");
    expect(planValidation).toContain("2026-06-29-001-feat-bun-typescript-runtime-migration-plan.md");
  });
});
