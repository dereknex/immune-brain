import { describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const BASELINE_ROOT = resolve(REPO_ROOT, "plugins/immune-brain/BASELINE.md")
const BASELINE_SKILLS_REL = "plugins/immune-brain/skills/BASELINE.md"
const BASELINE_SKILLS = resolve(REPO_ROOT, BASELINE_SKILLS_REL)
const BASELINE_DIST = resolve(REPO_ROOT, "plugins/immune-brain/dist/BASELINE.md")
const DIST_DIR = resolve(REPO_ROOT, "plugins/immune-brain/dist")
const PLANNER = resolve(DIST_DIR, "imm-planner.md")
const PROFILE_ROLE_PAIRS = [
  ["plugins/immune-brain/skills/imm-loop/SKILL.md", "plugins/immune-brain/dist/imm-loop.md"],
] as const

function read(abs: string): string {
  return readFileSync(abs, "utf-8")
}

describe("immune-brain BASELINE packaging contract", () => {
  it("ships BASELINE.md in the dist package", () => {
    expect(existsSync(BASELINE_DIST)).toBe(true)
  })

  it("tracks the skills BASELINE as package source", () => {
    const tracked = spawnSync("git", ["ls-files", "--error-unmatch", BASELINE_SKILLS_REL], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
    const ignored = spawnSync("git", ["check-ignore", "--quiet", BASELINE_SKILLS_REL], {
      cwd: REPO_ROOT,
    })

    expect(tracked.status).toBe(0)
    expect(ignored.status).toBe(1)
  })

  it("keeps dist/BASELINE.md in sync with the source copies", () => {
    const rootText = read(BASELINE_ROOT)
    const skillsText = read(BASELINE_SKILLS)
    const distText = read(BASELINE_DIST)
    expect(distText).toBe(rootText)
    expect(skillsText).toBe(rootText)
  })

  it("defines one observable Managed-by-default contract without routine-breadth conflicts", () => {
    const baseline = read(BASELINE_ROOT)
    expect(baseline).toContain("## Workflow Activation")
    expect(baseline).toContain("Repository-mutating requests use Managed Path by default.")
    expect(baseline).toContain("The canonical host applies the Managed Path routing contract for this decision.")
    expect(baseline).toContain("read-only, explanation")
    expect(baseline).toContain("This path creates no Spec, Plan, TaskIntent, TaskRecord, State Ledger")
    expect(baseline).toContain("Planner output is a candidate for later literal-user")
    expect(baseline).toContain("Do not create or mutate workflow state while")
    expect(baseline).not.toContain("Direct Path is the default when no Managed trigger applies.")
    expect(baseline).not.toContain("Use the Direct Path only when all of these are true")
    expect(baseline).not.toContain("one direct, non-destructive verification")
    expect(read(PLANNER)).not.toContain("do not skip spec/plan just because the fix is small")
    for (const [sourcePath, distPath] of [
      ["plugins/immune-brain/runtime/prompts/code-review.md", "plugins/immune-brain/dist/role-prompts/code-review.md"],
      ["plugins/immune-brain/runtime/prompts/compounder.md", "plugins/immune-brain/dist/role-prompts/compounder.md"],
    ]) {
      expect(read(resolve(REPO_ROOT, sourcePath))).toContain("# Internal role:")
      expect(read(resolve(REPO_ROOT, distPath))).toContain("# Internal role:")
    }
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
    expect(read(resolve(DIST_DIR, "imm-loop.md"))).toContain(
      "review_budget_state.budget_stop",
    )
    expect(read(resolve(DIST_DIR, "role-prompts/compounder.md"))).toContain(
      "# Internal role: compounder",
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
