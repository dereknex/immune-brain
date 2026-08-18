import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { buildReport } from "../runtime/bootstrap"

const PLUGIN_ROOT = resolve(import.meta.dir, "..")
const SCRIPT = resolve(PLUGIN_ROOT, "runtime/bootstrap.ts")

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "imm-init-"))
}

describe("imm-init bootstrap", () => {
  it("creates minimum project files", () => {
    const root = tempRoot()
    const report = buildReport(root)
    expect(report.created_files).toContain("IMMUNE.md")
    expect(report.created_files).toContain("CONTEXT.md")
    expect(report.created_files).toContain("AGENTS.md")
    expect(report.created_files).not.toContain("CLAUDE.md")
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(false)
    expect(report.created_directories).toContain(".imm/memory")
    expect(report.ready_for).toEqual(["imm-brainstorm", "imm-planner", "imm-loop"])
    expect(report.bootstrap).toBe("initialized")
  })

  it("fails closed instead of patching partial bootstrap state", () => {
    const root = tempRoot()
    writeFileSync(join(root, "AGENTS.md"), "project rules\n", "utf8")
    expect(() => buildReport(root)).toThrow(/partial|incompatible/i)
    expect(existsSync(join(root, "IMMUNE.md"))).toBe(false)
  })

  it("prints JSON and text reports from the CLI", () => {
    const jsonRoot = tempRoot()
    const json = spawnSync("bun", [SCRIPT, "--root", jsonRoot, "--json"], { encoding: "utf8" })
    expect(json.status).toBe(0)
    expect(json.stdout).toContain('"ready_for": [')
    expect(json.stdout).toContain('"imm-brainstorm"')
    expect(json.stdout).toContain('"imm-planner"')
    expect(json.stdout).toContain('"imm-loop"')
    expect(json.stderr).toBe("")

    const textRoot = tempRoot()
    const text = spawnSync("bun", [SCRIPT, "--root", textRoot], { encoding: "utf8" })
    expect(text.status).toBe(0)
    expect(text.stdout).toContain("Target root:")
    expect(text.stdout).toContain("created_directories:")
    expect(text.stdout).toContain("Ready for: imm-brainstorm, imm-planner, imm-loop")
    expect(text.stderr).toBe("")
  })
})
