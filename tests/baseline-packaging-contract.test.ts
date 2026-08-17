import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const BASELINE_ROOT = resolve(REPO_ROOT, "plugins/immune-brain/BASELINE.md")
const BASELINE_SKILLS = resolve(REPO_ROOT, "plugins/immune-brain/skills/BASELINE.md")
const BASELINE_DIST = resolve(REPO_ROOT, "plugins/immune-brain/dist/BASELINE.md")
const DIST_DIR = resolve(REPO_ROOT, "plugins/immune-brain/dist")
const PLANNER = resolve(DIST_DIR, "imm-planner.md")
const WORK = resolve(DIST_DIR, "imm-work.md")
const PROFILE_ROLE_PAIRS = [
  ["plugins/immune-brain/skills/imm-loop/SKILL.md", "plugins/immune-brain/dist/imm-loop.md"],
  ["plugins/immune-brain/skills/imm-work/SKILL.md", "plugins/immune-brain/dist/imm-work.md"],
  ["plugins/immune-brain/skills/imm-executor/SKILL.md", "plugins/immune-brain/dist/imm-executor.md"],
  ["plugins/immune-brain/skills/imm-qa/SKILL.md", "plugins/immune-brain/dist/imm-qa.md"],
] as const

function read(abs: string): string {
  return readFileSync(abs, "utf-8")
}

describe("immune-brain BASELINE packaging contract", () => {
  it("ships BASELINE.md in the dist package", () => {
    expect(existsSync(BASELINE_DIST)).toBe(true)
  })

  it("keeps dist/BASELINE.md in sync with the source copies", () => {
    const rootText = read(BASELINE_ROOT)
    const skillsText = read(BASELINE_SKILLS)
    const distText = read(BASELINE_DIST)
    expect(distText).toBe(rootText)
    expect(skillsText).toBe(rootText)
  })

  it("defines one observable Direct-first contract without routine-breadth conflicts", () => {
    const baseline = read(BASELINE_ROOT)
    expect(baseline).toContain("## Workflow Activation")
    expect(baseline).toContain("Direct Path is the default when no Managed trigger applies.")
    expect(baseline).toContain("Apply this ordered route before selecting an Immune-Brain Skill")
    expect(baseline).toContain("Do not create or mutate workflow state while selecting the route")
    expect(baseline).toContain("It creates no Spec, Plan, TaskIntent, TaskRecord, State Ledger")
    expect(baseline).not.toContain("Use the Direct Path only when all of these are true")
    expect(baseline).not.toContain("one direct, non-destructive verification")
    expect(read(PLANNER)).not.toContain("do not skip spec/plan just because the fix is small")
    expect(read(WORK)).not.toContain("do not bypass preplan/planner or QA")
  })

  it("keeps risk-tier routing aligned across loaders and packaged roles", () => {
    for (const [sourcePath, distPath] of PROFILE_ROLE_PAIRS) {
      for (const content of [
        read(resolve(REPO_ROOT, sourcePath)),
        read(resolve(REPO_ROOT, distPath)),
      ]) {
        expect(content).toContain("Standard")
        expect(content).toContain("Strict")
      }
    }
    for (const role of ["imm-code-review", "imm-compounder"]) {
      const source = read(resolve(REPO_ROOT, `plugins/immune-brain/skills/${role}/SKILL.md`))
      const packaged = read(resolve(DIST_DIR, `${role}.md`))
      expect(source).toContain("Standard")
      expect(packaged).toContain("Standard")
    }
    expect(read(resolve(DIST_DIR, "imm-code-review.md"))).toContain(
      "review_budget_state.budget_stop",
    )
    expect(read(resolve(DIST_DIR, "imm-compounder.md"))).toContain(
      "compounder_requirement.required",
    )
  })

  it("keeps packaged skill links pointing to the dist-local BASELINE.md", () => {
    const mdFiles = readdirSync(DIST_DIR, { recursive: true })
      .map((p) => (typeof p === "string" ? resolve(DIST_DIR, p) : ""))
      .filter((p) => p.endsWith(".md"))

    const offenders: string[] = []
    for (const file of mdFiles) {
      const content = read(file)
      if (content.includes("[BASELINE.md](../BASELINE.md)")) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })
})
