import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const REPO_ROOT = resolve(import.meta.dir, "..")
const read = (path: string) => readFileSync(resolve(REPO_ROOT, path), "utf-8")

const PLANNER = read("plugins/immune-brain/dist/imm-planner.md")
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
      "Plan references the applicable design decisions or invariants without copying Technical Design prose",
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
})
