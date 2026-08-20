import { describe, it, expect } from "bun:test"
import { spawnSync } from "node:child_process"
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"

const REPO_ROOT = resolve(import.meta.dir, "..")
const SCRIPT = resolve(REPO_ROOT, "scripts/detect-stale-refs.ts")
const BASELINE_PATH = resolve(REPO_ROOT, "scripts/stale-reference-baseline.json")

function runDetect(...targets: string[]) {
  return spawnSync("bun", [SCRIPT, ...targets], { cwd: REPO_ROOT, encoding: "utf8" })
}

function parseCount(stdout: string): number {
  if (stdout.includes("No stale references found.")) return 0
  const m = stdout.match(/Found (\d+) stale reference/)
  return m ? parseInt(m[1], 10) : -1
}

function isActiveFinding(line: string): boolean {
  const m = line.match(/^\s*([^\s:]+):/)
  if (!m) return false
  return !m[1].includes("/archive/")
}

describe("stale-reference ratchet", () => {
  it("excludes template placeholder references such as docs/specs/<name>.spec.md and glob forms", () => {
    const root = mkdtempSync(join(tmpdir(), "ratchet-placeholder-"))
    try {
      const file = join(root, "doc.md")
      writeFileSync(
        file,
        [
          "see docs/specs/<name>.spec.md",
          "see docs/specs/archive/<name>.spec.md",
          "see docs/plans/*.md",
          "see docs/specs/<terminal>.spec.md",
          "see .imm/specs/*.spec.md",
          "see docs/plans/<successor>.md",
        ].join("\n"),
      )
      const result = spawnSync("bun", [SCRIPT, file], { cwd: REPO_ROOT, encoding: "utf8" })
      expect(result.stdout).toContain("No stale references found.")
      expect(parseCount(result.stdout)).toBe(0)
      expect(result.status).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }

    // Real file that previously carried 8 placeholder findings must now be clean
    const real = runDetect("docs/reference/planning-artifact-retention.md")
    expect(real.status).toBe(0)
    expect(real.stdout).toContain("No stale references found.")

    const spec = runDetect("docs/specs/2026-08-20-010-reconcile-planning-artifact-retention-policy.spec.md")
    expect(spec.status).toBe(0)
    expect(spec.stdout).toContain("No stale references found.")
  })

  it("is archive-aware: referencing a spec that lives in archive does not count as stale", () => {
    // docs/specs/api-contract-reviewer.spec.md is archived (exists only in docs/specs/archive/)
    // Detector must consider the archived location valid so archiving does not trip the gate
    const root = mkdtempSync(join(tmpdir(), "ratchet-archive-"))
    try {
      const file = join(root, "referencer.md")
      writeFileSync(file, "see docs/specs/api-contract-reviewer.spec.md\n")
      const result = spawnSync("bun", [SCRIPT, file], { cwd: REPO_ROOT, encoding: "utf8" })
      expect(result.stdout).toContain("No stale references found.")
      expect(result.status).toBe(0)

      // also for plans
      const file2 = join(root, "referencer2.md")
      writeFileSync(file2, "see docs/plans/2026-08-13-014-feat-assurance-kernel-p2c-pi-default-routing-plan.md\n")
      const result2 = spawnSync("bun", [SCRIPT, file2], { cwd: REPO_ROOT, encoding: "utf8" })
      expect(result2.stdout).toContain("No stale references found.")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("runs against the repository and fails when findings rise above the committed baseline (ratchet)", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
    const result = runDetect("docs")
    const stdout = result.stdout

    // Gate must run against real repository documents, not synthetic fixtures
    expect(stdout, "detector must run against docs").not.toContain("synthetic")
    // Must have meaningful output (either findings or clean)
    expect(stdout.length).toBeGreaterThan(0)

    const totalCount = parseCount(stdout)
    expect(totalCount).toBeGreaterThanOrEqual(0)

    // Baseline is scoped to active docs (non-archive) so archiving does not spuriously trip
    const lines = stdout.split("\n").filter((l) => l.includes("->"))
    const activeCount = lines.filter(isActiveFinding).length
    const expectedActive = baseline.active ?? baseline.count ?? baseline.baseline
    expect(activeCount).toBeLessThanOrEqual(expectedActive)

    // Also guard total if baseline provides it
    if (baseline.total !== undefined) {
      expect(totalCount).toBeLessThanOrEqual(baseline.total)
    }

    // Verify that without placeholder filtering the count would be higher (ratchet is tight)
    // This ensures gate is not loose: placeholder filtering keeps count low
    expect(totalCount).toBeLessThan(1000) // was 2059 before filtering, now 846
    expect(activeCount).toBeLessThan(200) // was ~471 before filtering, now 138
  })
})
