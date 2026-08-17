import { describe, expect, it } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"

const REPO_ROOT = resolve(import.meta.dir, "..")
const SCRIPT = resolve(REPO_ROOT, "scripts/detect-stale-refs.ts")

function runRuntimeTruth(...targets: string[]) {
  return spawnSync("bun", [SCRIPT, "--runtime-truth", ...targets], { cwd: REPO_ROOT, encoding: "utf8" })
}

describe("active runtime docs guard", () => {
  it("fails with file and line evidence for retired runtime-current refs", () => {
    const root = mkdtempSync(join(tmpdir(), "runtime-docs-"))
    try {
      const file = join(root, "current.md")
      writeFileSync(file, "# Current runtime\nUse plugins/immune-brain/.mcp.json and list-tools now.\n")

      const result = runRuntimeTruth(file)

      expect(result.status).toBe(1)
      expect(result.stdout).toContain("current.md:2 [retired_runtime_current_ref]")
      expect(result.stdout).toContain(".mcp.json")
      expect(result.stdout).toContain("list-tools")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("passes for the current Bun TypeScript CLI runtime truth", () => {
    const root = mkdtempSync(join(tmpdir(), "runtime-docs-"))
    try {
      const file = join(root, "current.md")
      writeFileSync(file, "# Current runtime\nUse plugins/immune-brain/runtime/immune_brain_runtime.ts and plugins/immune-brain/bin/imm-work.\n")

      const result = runRuntimeTruth(file)

      expect(result.status).toBe(0)
      expect(result.stdout).toContain("No stale references found.")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  // The two cases above prove the detector works but only ever aim it at
  // fixtures, so nothing pointed it at the repo and 644 findings accumulated
  // unnoticed. Only the docs an agent reads as current are gated: plans, specs,
  // solutions, and archives are records of what was true when written, where
  // naming a retired runtime is correct rather than stale.
  it("keeps the docs agents read as current free of retired runtime refs", () => {
    const result = runRuntimeTruth(
      "README.md",
      "docs/user_manual.md",
      "docs/reference",
      "plugins/immune-brain/USER_GUIDE.md",
      "plugins/immune-brain/dist",
    )

    expect(result.stdout).toContain("No stale references found.")
    expect(result.status).toBe(0)
  })
})
