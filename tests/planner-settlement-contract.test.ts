import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DIST_PLANNER = resolve(REPO_ROOT, "plugins/immune-brain/dist/imm-planner.md")
const SKILL_PLANNER = resolve(REPO_ROOT, "plugins/immune-brain/skills/imm-planner/SKILL.md")
const CONTRACTS_HUB = resolve(REPO_ROOT, "docs/solutions/contracts.md")

// Settlement-class intent surface: the requirement keywords the packaged
// planner contract must carry so settlement/race/authority-lifecycle work is
// enumerated before enrollment instead of being discovered serially by Review.
const REQUIRED_SURFACE = [
  "Settlement-Design Contract",
  "Trigger sources",
  "State inventory",
  "Terminal ownership",
  "Same-state-machine coverage",
  "single authority",
  "non-authoritative",
  "not execution-ready",
]

const REQUIRED_SKILL_REFERENCE = [
  "Settlement-Design Contract",
  "terminal settlement, cancellation, timeout, race, or authority-lifecycle semantics",
]

describe("planner settlement-design contract", () => {
  it("packaged planner contract mandates the settlement enumeration", () => {
    const dist = readFileSync(DIST_PLANNER, "utf-8").replace(/\s+/g, " ")
    for (const phrase of REQUIRED_SURFACE) {
      expect(dist, `dist/imm-planner.md must contain ${JSON.stringify(phrase)}`).toContain(phrase)
    }
  })

  it("source skill entry point references the settlement contract", () => {
    const skill = readFileSync(SKILL_PLANNER, "utf-8").replace(/\s+/g, " ")
    for (const phrase of REQUIRED_SKILL_REFERENCE) {
      expect(skill, `imm-planner/SKILL.md must reference ${JSON.stringify(phrase)}`).toContain(phrase)
    }
  })

  it("source skill entry point still loads the packaged contract", () => {
    const skill = readFileSync(SKILL_PLANNER, "utf-8")
    expect(skill).toContain("dist/imm-planner.md")
    expect(skill).toContain("Settlement-Design Contract")
  })

  it("contracts hub records the settlement-enumeration pattern with retro evidence", () => {
    const hub = readFileSync(CONTRACTS_HUB, "utf-8")
    expect(hub).toContain("## Pattern: Settlement Enumeration for Settlement-Class Intents")
    // Origin evidence: five sequential repair tasks for one feature.
    expect(hub).toContain("five sequential repair tasks")
    expect(hub).toContain("01a0088c")
    expect(hub).toContain("2026-08-16-001")
    // No stale conflict markers in the hub.
    expect(hub).not.toContain("<<<<<<<")
    expect(hub).not.toContain(">>>>>>>")
  })
})
