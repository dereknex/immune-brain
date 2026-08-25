import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const REPO_ROOT = resolve(import.meta.dir, "..")
const read = (path: string) => readFileSync(resolve(REPO_ROOT, path), "utf-8")

const PLANNER = read("plugins/immune-brain/dist/imm-planner.md")
const SKILL = read("plugins/immune-brain/skills/imm-planner/SKILL.md")
const QA = read("plugins/immune-brain/dist/role-prompts/qa.md")
const QUALITY_GATE = read("docs/reference/planning-quality-gate.md")

function expectAll(text: string, required: string[], forbidden: string[] = []) {
  for (const fragment of required) expect(text).toContain(fragment)
  for (const fragment of forbidden) expect(text).not.toContain(fragment)
}

describe("risk-tiered Technical Design conformance contract", () => {
  it("keeps Spec as the single conditional Technical Design baseline", () => {
    expectAll(PLANNER, [
      "Design-Depth Classification",
      "Low risk",
      "Medium risk",
      "High risk",
      "Technical Design in the Spec",
      "Spec is the single Technical Design baseline",
      "TaskIntent acceptance and scope reference the applicable design decisions or invariants without copying Technical Design prose",
      "contract, ownership, security, persistence, compatibility, or multi-component",
    ])
  })

  it("requires Mermaid only when it clarifies a diagrammable complex relationship", () => {
    expectAll(PLANNER, [
      "Mermaid is required only when",
      "structure, sequence, data flow, or state transition",
      "Mermaid is not a universal gate",
    ], [
      "Mermaid is required for every change",
    ])
  })

  it("makes final QA Design Conformance evidence-based and keeps design authority with Planner", () => {
    expectAll(QA, [
      "Design Conformance",
      "latest referenced Spec",
      "implementation evidence",
      "local implementation mismatch",
      "return `rework`",
      "return `replan`",
      "QA must not approve a changed design",
      "silently accept a deviation",
    ])
  })

  it("makes elevated-risk quality guidance cover design depth, diagram intent, and conformance routing", () => {
    expectAll(QUALITY_GATE, [
      "design-depth classification",
      "Technical Design baseline",
      "Mermaid only when it clarifies",
      "Design Conformance",
      "Spec-to-implementation evidence",
      "local implementation mismatch",
      "structural or intended design change",
    ])
  })

  it("requires materially relevant technical-design views on both Planner surfaces", () => {
    for (const text of [SKILL, PLANNER]) {
      expectAll(text, [
        "materially relevant",
        "architecture layers",
        "service/component interfaces",
        "data flow",
        "state transitions",
        "temporal sequence",
        "Design views",
        "The Spec is the single Technical Design baseline",
        "Low risk remains concise",
      ])
    }
  })

  it("uses Technical Design as a TaskIntent retain/split dimension without count-based splitting or prose Plan revival", () => {
    for (const text of [SKILL, PLANNER]) {
      expectAll(text, [
        "TaskIntent decomposition",
        "Split a successor TaskIntent",
        "coherent executable slice",
        "risk treatment",
        "Do not split merely because the design names several layers, files, or services",
        "revive prose Plan",
      ])
    }
  })

  it("requires view-specific decision content in the packaged Planner contract", () => {
    expectAll(PLANNER, [
      "required decision content",
      "layer responsibilities",
      "dependency direction",
      "ownership, and prohibited coupling",
      "inputs, outputs, errors",
      "compatibility/versioning",
      "caller/callee ownership",
      "source",
      "transformations, validation",
      "destination",
      "failure handling",
      "legal transitions",
      "trigger",
      "invariant",
      "terminal ownership",
      "recovery",
      "ordered interactions",
      "authority at each point",
      "interruption behavior",
      "idempotency",
    ])
  })

  it("makes elevated-risk quality guidance cover design-view selection and TaskIntent decomposition", () => {
    expectAll(QUALITY_GATE, [
      "design-view selection",
      "materially relevant",
      "architecture layers",
      "TaskIntent decomposition",
      "Do not split merely because the design names several layers, files, or services",
    ])
  })
})
