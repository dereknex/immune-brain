import { describe, expect, it, afterAll, beforeAll } from "bun:test"
import { fileURLToPath } from "node:url"
import { dirname, resolve, join } from "node:path"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const TS_RUNTIME = resolve(REPO_ROOT, "plugins/immune-brain/runtime/v4_runtime.ts")

describe("wrapper retirement and heal warnings", () => {
  let tempDir: string

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "imm-test-wrapper-"))
  })

  afterAll(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it("imm-retire-stale-wrapper is retired after v4 storage retirement", () => {
    const wrapperPath = join(tempDir, "imm-plan-eligible")
    writeFileSync(
      wrapperPath,
      "#!/bin/sh\n# imm-install-mode: copy\n# imm-install-family: agent-skills\n# imm-install-runtime-root: foo\n"
    )

    const ts = spawnSync("bun", [TS_RUNTIME, "cli", "imm-retire-stale-wrapper", "--path", wrapperPath, "--json"], {
      encoding: "utf-8",
      cwd: REPO_ROOT,
    })

    expect(ts.status).toBe(1)
    expect(ts.stderr).toMatch(/v3_storage_retired|drain_required/)
    expect(existsSync(wrapperPath)).toBe(true)
  })

  it("Heal warning names the retirement path", () => {
    const fakeGlobalPath = join(tempDir, "imm-plan")
    writeFileSync(
      fakeGlobalPath,
      "#!/bin/sh\n# imm-install-mode: copy\n# imm-install-family: agent-skills\n# imm-install-runtime-root: foo\n"
    )

    const ts = spawnSync("bun", [TS_RUNTIME, "cli", "imm-heal"], {
      encoding: "utf-8",
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PATH: `${tempDir}:${process.env.PATH}`,
      },
    })

    expect(ts.status).toBe(1)
    expect(ts.stderr).toMatch(/v3_storage_retired|drain_required/)
  })

  it("packaged runtime omits the retired legacy dispatcher", () => {
    const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
      encoding: "utf-8",
      cwd: REPO_ROOT,
    })
    expect(result.status).toBe(0)
    const files = (JSON.parse(result.stdout) as Array<{ files?: Array<{ path: string }> }>)[0]?.files ?? []
    expect(files.some(({ path }) => path.endsWith("runtime/immune_brain_runtime.ts"))).toBe(false)
    expect(files.some(({ path }) => path.endsWith("runtime/project_migration.ts"))).toBe(false)
    expect(files.some(({ path }) => path.endsWith("runtime/state_ledger.ts"))).toBe(false)
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
