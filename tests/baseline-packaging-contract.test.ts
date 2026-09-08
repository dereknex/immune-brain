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

  it("defines one observable Skill-explicit Managed contract without routine-breadth conflicts", () => {
    const baseline = read(BASELINE_ROOT)
    expect(baseline).toContain("## Workflow Activation")
    expect(baseline).toContain("Ordinary host input stays host-native")
    expect(baseline).toContain("new Managed workflow starts only from explicit")
    expect(baseline).toContain("This path creates no Spec, Plan, TaskIntent, TaskRecord, State Ledger")
    expect(baseline).toContain("Planner output is a candidate for later literal-user")
    expect(baseline).toContain("Do not create or mutate workflow state while")
    expect(baseline).not.toContain("Repository-mutating requests use Managed Path by default.")
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

  it("executor and pr-fix prompts report diagnostic evidence without minting authority", () => {
    const executor = read(resolve(REPO_ROOT, "plugins/immune-brain/runtime/prompts/executor.md"))
    const executorDist = read(resolve(REPO_ROOT, "plugins/immune-brain/dist/role-prompts/executor.md"))
    for (const content of [executor, executorDist]) {
      expect(content).toContain("run the permitted diagnostic checks")
      expect(content).toContain("does not store\nevidence or change task state")
      expect(content).toContain("Autonomously diagnose,\nrepair, and rerun failing ordinary local checks")
      expect(content).toContain("never present failed\nverification as completion")
      expect(content).not.toContain("record structured execution evidence through the Loop runtime\naction")
    }
    const prFix = read(resolve(REPO_ROOT, "plugins/immune-brain/runtime/prompts/pr-fix.md"))
    const prFixDist = read(resolve(REPO_ROOT, "plugins/immune-brain/dist/role-prompts/pr-fix.md"))
    for (const content of [prFix, prFixDist]) {
      expect(content).toContain("the current TaskIntent\nacceptance and `scope_hint` when operating under one")
      expect(content).toContain("otherwise the legacy\nsupplied Plan")
    }
  })

  it("direct completion requires passing verification instead of disclosure", () => {
    const baseline = read(BASELINE_ROOT).replace(/\s+/g, " ")
    expect(baseline).toContain(
      "Direct work closes only when the requested result is delivered and the required verification passes",
    )
    expect(baseline).toContain(
      "a failed or unavailable required check is reported as incomplete work with its concrete blocker, never as completion",
    )
    expect(baseline).toContain(
      "Check breadth follows the request and established project requirements, not a universal full-repository rule",
    )
    expect(baseline).not.toContain("Direct completion contract above")
  })

  // Instruction-contract scenarios, not claims that a live model executed them.
  it.each([
    {
      scenario: "shared-contract work expands by evidence, not a directory-reading mandate",
      required: ["Use bounded evidence to cover affected callers and state owners", "the category alone never requires full-directory reads", "Stop expanding once the relevant behavior and verification are understood"],
    },
    {
      scenario: "unchanged local checks may be reused but never replace independent Kernel assurance",
      required: ["Select required checks from the requested outcome, affected behavior, and project requirements", "Never reduce required checks merely because they fail", "code, test inputs, command, dependencies, and environment remain unchanged", "Changed or uncertain inputs require rerunning affected checks", "local evidence never replaces Kernel-owned deterministic QA or fresh snapshot-bound Review"],
    },
    {
      scenario: "routine environment repair preserves user data and protected effects",
      required: ["Never overwrite user data or stop an unrelated process", "inspect the existing project command, lifecycle scripts, network use, and credential effects", "without dependency or lockfile changes", "Retry a failed ordinary operation only after new evidence or a relevant condition changes", "does not authorize retrying a failed native authority gate or an uncertain remote write"],
    },
    {
      scenario: "an existing specific approval is reused without relaxing native gates",
      required: ["same operation, target, and impact is sufficient", "ask again only for a material delta", "not blanket authorization", "Mandatory native gates and hash-bound manifest approvals still apply"],
    },
    {
      scenario: "test retirement needs a retired behavior or surviving coverage, never a failure-based deletion",
      required: ["within the affected scope", "For each removal, identify the retired behavior or the remaining coverage", "run the surviving related checks", "Never delete by age, count, slowness, or flakiness alone", "Temporary tests name their exit condition"],
    },
    {
      scenario: "a test script deploys or writes production data: inspect and gate the effect before running",
      required: ["Inspect unknown test scripts before execution", "deploys, writes production data, or uses credentials is a protected effect", "apply Host Confirmation Boundary before it runs"],
    },
    {
      scenario: "an unanswered product question blocks only its dependent commitment, not an independent draft",
      required: ["Unanswered questions block only dependent commitments or execution", "Continue independent read-only investigation and local alternative drafts", "label drafts unapproved and never treat silence as consent"],
    },
    {
      scenario: "an unrelated baseline failure is disclosed without expanding scope or claiming a required check passed",
      required: ["Disclose unrelated pre-existing failures without repairing them or widening scope", "If they prevent a required check from passing", "incomplete verification rather than claiming completion"],
    },
    {
      scenario: "missing in-scope evidence is collected locally while a demonstrated acceptance mismatch still escalates",
      required: ["Collect missing in-scope evidence and continue under the current owner", "Missing evidence alone does not require replanning", "scope/acceptance mismatch or protected decision", "never silently expand execution or QA scope"],
    },
    {
      scenario: "a recoverable local test failure is repaired and rerun without weakening the check",
      required: ["Autonomously diagnose, repair, and rerun failing conventional local checks within the authorized scope", "never delete, skip, or weaken a valid check to manufacture a pass"],
    },
  ])("$scenario", ({ required }) => {
    for (const path of [BASELINE_ROOT, BASELINE_SKILLS, BASELINE_DIST]) {
      const contract = read(path).replace(/\s+/g, " ")
      for (const phrase of required) expect(contract).toContain(phrase)
    }
  })

  it("keeps Kernel risk obligations in the canonical Loop contract", () => {
    const loop = read(resolve(DIST_DIR, "imm-loop.md"))
    expect(loop).toContain("Fresh QA suffices for routine work")
    expect(loop).toContain("material and critical work additionally require fresh independent Review")
    expect(loop).toContain("submit_review")
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
