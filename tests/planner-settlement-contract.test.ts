import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DIST_PLANNER = resolve(REPO_ROOT, "plugins/immune-brain/dist/imm-planner.md")
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

describe("planner settlement-design contract", () => {
  it("packaged planner contract mandates the settlement enumeration", () => {
    const dist = readFileSync(DIST_PLANNER, "utf-8").replace(/\s+/g, " ")
    for (const phrase of REQUIRED_SURFACE) {
      expect(dist, `dist/imm-planner.md must contain ${JSON.stringify(phrase)}`).toContain(phrase)
    }
  })

  it("source skill entry point loads the canonical packaged contract", () => {
    const skill = readFileSync(
      resolve(REPO_ROOT, "plugins/immune-brain/skills/imm-planner/SKILL.md"),
      "utf-8",
    )
    expect(skill).toContain("dist/imm-planner.md")
    expect(skill).toContain("canonical contract")
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
