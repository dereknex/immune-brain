import { describe, expect, it } from "bun:test"
import { determineRequiredReviewGates } from "../runtime/state_ledger"

describe("determineRequiredReviewGates", () => {
  it("returns no gates for an empty changeset", () => {
    expect(determineRequiredReviewGates([])).toEqual([])
    expect(determineRequiredReviewGates(["", "  "])).toEqual([])
  })

  it("requires only code review for plain logic files", () => {
    expect(determineRequiredReviewGates(["src/foo.ts"])).toEqual(["imm-code-review"])
    expect(determineRequiredReviewGates(["package.json"])).toEqual(["imm-code-review"])
    expect(determineRequiredReviewGates(["README.md"])).toEqual(["imm-code-review"])
  })

  it("requires only UI review for style, markup, and design docs", () => {
    expect(determineRequiredReviewGates(["styles/main.css"])).toEqual(["imm-ui-review"])
    expect(determineRequiredReviewGates(["page.html"])).toEqual(["imm-ui-review"])
    expect(determineRequiredReviewGates(["design.md"])).toEqual(["imm-ui-review"])
    expect(determineRequiredReviewGates(["ui/design.md"])).toEqual(["imm-ui-review"])
  })

  it("treats JSX under a UI-shaped directory as UI-only", () => {
    expect(determineRequiredReviewGates(["src/components/Button.tsx"])).toEqual(["imm-ui-review"])
    // A code-capable file under a UI path (theme/) is covered by UI review alone.
    expect(determineRequiredReviewGates(["src/theme/colors.ts"])).toEqual(["imm-ui-review"])
  })

  it("requires both gates for JSX outside a UI-shaped directory", () => {
    expect(determineRequiredReviewGates(["App.tsx"])).toEqual([
      "imm-code-review",
      "imm-ui-review",
    ])
    expect(determineRequiredReviewGates(["src/app.jsx"])).toEqual([
      "imm-code-review",
      "imm-ui-review",
    ])
  })

  it("requires both gates for mixed code and style changesets", () => {
    expect(determineRequiredReviewGates(["src/foo.ts", "styles/x.css"])).toEqual([
      "imm-code-review",
      "imm-ui-review",
    ])
  })

  it("is order- and duplicate-independent", () => {
    expect(determineRequiredReviewGates(["styles/x.css", "src/foo.ts", "src/foo.ts"])).toEqual([
      "imm-code-review",
      "imm-ui-review",
    ])
  })
})
