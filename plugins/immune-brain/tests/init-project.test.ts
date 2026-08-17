import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { buildReport } from "../skills/imm-init/scripts/init_project"

const PLUGIN_ROOT = resolve(import.meta.dir, "..")
const SCRIPT = resolve(PLUGIN_ROOT, "skills/imm-init/scripts/init_project.ts")

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
    expect(report.ready_for).toEqual(["direct", "imm-brainstorm", "imm-planner"])
  })

  it("updates entry pointer without overwriting existing text", () => {
    const root = tempRoot()
    const agents = join(root, "AGENTS.md")
    writeFileSync(agents, "project rules\n", "utf8")
    const report = buildReport(root)
    expect(report.updated_files).toContain("AGENTS.md")
    const content = readFileSync(agents, "utf8")
    expect(content).toContain("project rules")
    expect(content).toContain("IMMUNE-BRAIN:START")
    expect(content).toContain("Direct Path is the default")
    expect(content).toContain("Use `imm-planner` only when a Managed trigger applies")
    expect(content).not.toContain("Use `imm-planner` before implementation work.")
    const second = buildReport(root)
    expect(second.skipped_files).toContain("AGENTS.md")
  })

  it("prints JSON and text reports from the CLI", () => {
    const jsonRoot = tempRoot()
    const json = spawnSync("bun", [SCRIPT, "--root", jsonRoot, "--json"], { encoding: "utf8" })
    expect(json.status).toBe(0)
    expect(json.stdout).toContain('"ready_for": [')
    expect(json.stdout).toContain('"direct"')
    expect(json.stdout).toContain('"imm-brainstorm"')
    expect(json.stderr).toBe("")

    const textRoot = tempRoot()
    const text = spawnSync("bun", [SCRIPT, "--root", textRoot], { encoding: "utf8" })
    expect(text.status).toBe(0)
    expect(text.stdout).toContain("Target root:")
    expect(text.stdout).toContain("created_directories:")
    expect(text.stdout).toContain("Ready for: direct, imm-brainstorm, imm-planner")
    expect(text.stderr).toBe("")
  })
})
