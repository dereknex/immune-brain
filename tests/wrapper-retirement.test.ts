import { describe, expect, it } from "bun:test"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const TS_RUNTIME = resolve(REPO_ROOT, "plugins/immune-brain/runtime/v4_runtime.ts")

describe("wrapper retirement and heal warnings", () => {
  it("packaged runtime omits the retired legacy dispatcher", () => {
    const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
      encoding: "utf-8",
      cwd: REPO_ROOT,
    })
    expect(result.status).toBe(0)
    const files = (JSON.parse(result.stdout) as Array<{ files?: Array<{ path: string }> }>)[0]?.files ?? []
    expect(files.some(({ path }) => path.endsWith("runtime/immune_brain_runtime.ts"))).toBe(false)
    expect(files.some(({ path }) => path.endsWith("runtime/v4_runtime.ts"))).toBe(true)
  })

  it("Plugin-local imm-plan --help returns invalid_plan_command", () => {
    const ts = spawnSync("bun", [TS_RUNTIME, "cli", "imm-plan", "--help"], {
      encoding: "utf-8",
      cwd: REPO_ROOT,
    })
    // --help is not a valid read-only form; v4 rejects it with usage.
    expect(ts.status).toBe(2)
    expect(ts.stderr).toContain("invalid_plan_command")
  })
})
