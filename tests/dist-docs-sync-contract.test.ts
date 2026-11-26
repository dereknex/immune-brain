import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve, relative, sep } from "node:path"
import {
  DIST_DOC_ENTRIES,
  MIRROR_ENTRIES,
  ADAPTED_ENTRIES,
  GENERATED_ADAPTED_ENTRIES,
  MANUAL_ADAPTED_ENTRIES,
  DOCS_SOURCE_DIR,
  DIST_DOCS_DIR,
  renderDistDoc,
} from "../scripts/dist-sync-manifest.ts"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DIST_DOCS_ABS = resolve(REPO_ROOT, DIST_DOCS_DIR)

function read(abs: string): string {
  return readFileSync(abs, "utf-8")
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map((p) => resolve(dir, typeof p === "string" ? p : p.toString()))
    .filter((p) => statSync(p).isFile())
}

describe("dist/docs packaging sync contract", () => {
  it("every packaged dist/docs file is classified in the manifest", () => {
    const onDisk = listFiles(DIST_DOCS_ABS)
      .map((p) => relative(DIST_DOCS_ABS, p).split(sep).join("/"))
      .sort()
    const declared = DIST_DOC_ENTRIES.map((e) => e.rel).sort()
    expect(onDisk).toEqual(declared)
  })

  it("mirror copies are byte-identical to their docs/ source", () => {
    const offenders: string[] = []
    for (const entry of MIRROR_ENTRIES) {
      const source = resolve(REPO_ROOT, DOCS_SOURCE_DIR, entry.rel)
      const packaged = resolve(DIST_DOCS_ABS, entry.rel)
      expect(existsSync(source)).toBe(true)
      expect(existsSync(packaged)).toBe(true)
      if (read(source) !== read(packaged)) offenders.push(entry.rel)
    }
    expect(offenders).toEqual([])
  })

  it("adapted copies exist, keep a canonical source, and record a reason", () => {
    for (const entry of ADAPTED_ENTRIES) {
      const source = resolve(REPO_ROOT, DOCS_SOURCE_DIR, entry.rel)
      const packaged = resolve(DIST_DOCS_ABS, entry.rel)
      expect(existsSync(source)).toBe(true)
      expect(existsSync(packaged)).toBe(true)
      expect(entry.reason?.trim()).toBeTruthy()
    }
  })

  it("generates every adapted reference deterministically from its canonical source", () => {
    const adaptedReferences = ADAPTED_ENTRIES.filter((entry) => entry.rel.startsWith("reference/"))
    expect(GENERATED_ADAPTED_ENTRIES.filter((entry) => entry.rel.startsWith("reference/"))).toEqual(adaptedReferences)
    expect(MANUAL_ADAPTED_ENTRIES.some((entry) => entry.rel.startsWith("reference/"))).toBe(false)

    for (const entry of adaptedReferences) {
      const source = read(resolve(REPO_ROOT, DOCS_SOURCE_DIR, entry.rel))
      const packaged = read(resolve(DIST_DOCS_ABS, entry.rel))
      expect(renderDistDoc(entry, source)).toBe(packaged)
    }
  })

  it("fails closed when an adapted source fragment is missing or duplicated", () => {
    if (GENERATED_ADAPTED_ENTRIES.length === 0) return // no adapted entries declared (pruned upstream-index docs)
    const entry = GENERATED_ADAPTED_ENTRIES[0]
    const fragment = entry.replacements?.[0]?.from || ""

    expect(() => renderDistDoc(entry, "source fragment is absent")).toThrow("found 0")
    expect(() => renderDistDoc(entry, `${fragment}\n${fragment}`)).toThrow("found 2")
  })

  it("adapted copies do not ship repo-relative upstreams/ paths", () => {
    const offenders: string[] = []
    for (const entry of ADAPTED_ENTRIES) {
      const content = read(resolve(DIST_DOCS_ABS, entry.rel))
      if (content.includes("upstreams/")) offenders.push(entry.rel)
    }
    expect(offenders).toEqual([])
  })

  it("carries the decision-provenance and independently verifiable Slice rules into the packaged quality gate", () => {
    const source = read(resolve(REPO_ROOT, "docs/reference/planning-quality-gate.md"))
    const packaged = read(resolve(REPO_ROOT, "plugins/immune-brain/dist/docs/reference/planning-quality-gate.md"))

    expect(packaged).toBe(source)
    for (const fragment of [
      "names exactly one source",
      "an upstream `BR-*` ID, repository evidence, or a delegated technical choice",
      "a user-owned decision that names no source is a defect",
      "multi-TaskIntent Initiative only",
      "when that Slice alone has landed",
      "horizontal layer slice",
      "integrate-and-verify Slice",
      "`User scenarios` section",
      "keeps its upstream `BR-SCN-<n>` ID",
      "`no user-visible change` requires a recorded reason",
    ]) {
      expect(source).toContain(fragment)
    }
  })

  it("packages the code-review role prompt with its finding evidence contract", () => {
    const runtime = read(resolve(REPO_ROOT, "plugins/immune-brain/runtime/prompts/code-review.md"))
    const packaged = read(resolve(REPO_ROOT, "plugins/immune-brain/dist/role-prompts/code-review.md"))
    expect(packaged).toBe(runtime)
    expect(runtime).toContain("caller_chain")
    expect(runtime).toContain("violated")
    expect(runtime).toContain("sha256")
  })
})

// ADR 0043 Slice 2 (external-approval-seam AC3): the external approval seam is
// orchestrator-neutral, and no Agent-facing instruction lets a session use it.
describe("external approval seam packaged contract", () => {
  const packaged = [
    "plugins/immune-brain/BASELINE.md",
    "plugins/immune-brain/dist/BASELINE.md",
    "plugins/immune-brain/runtime/prompts/executor.md",
    "plugins/immune-brain/dist/role-prompts/executor.md",
  ]

  it("BASELINE and the executor prompt forbid Agent sessions from invoking imm-kernel approve", () => {
    for (const rel of packaged) {
      const text = read(resolve(REPO_ROOT, rel)).replace(/\s+/g, " ")
      expect(text, rel).toMatch(/[Nn]ever (invokes?|run) `imm-kernel approve`/)
    }
  })

  it("ADR 0043, the config reference and its mirror carry no orchestrator-specific gate schema", () => {
    for (const rel of [
      "docs/adr/0043-loop-daemon-freeze-and-extraction.md",
      "docs/reference/immune-brain-config.md",
      "plugins/immune-brain/dist/docs/reference/immune-brain-config.md",
    ]) {
      const text = read(resolve(REPO_ROOT, rel))
      for (const banned of ["takt", "GateRequest", "GateResponse", ".takt/", "Ed25519"])
        expect(text.includes(banned), `${rel} mentions ${banned}`).toBe(false)
      if (rel.startsWith("docs/adr/")) expect(text).toContain("imm-kernel approve")
      else expect(text).toContain("external_approval")
    }
  })
})
