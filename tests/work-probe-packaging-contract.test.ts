import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DIST_DIR = resolve(REPO_ROOT, "plugins/immune-brain/dist")
const WORK = resolve(DIST_DIR, "imm-work.md")
const EXECUTOR = resolve(DIST_DIR, "imm-executor.md")

function read(path: string): string {
  return readFileSync(path, "utf-8")
}

describe("work-probe packaging contract", () => {
  it("ships the TypeScript lifecycle without retired Python APIs", () => {
    const work = read(WORK)
    const executor = read(EXECUTOR)
    expect(work).toContain("plugins/immune-brain/runtime/work_probes.ts")
    expect(work).toContain("imm-work record-probes")
    expect(work).toContain("expected_ledger_revision")
    expect(work).not.toContain("imm_core.work_probes.build_work_probe_dispatch_plan")
    expect(executor).toContain("State Ledger `child_evidence`")
    expect(executor).toContain("advisory")
    expect(executor).toContain("imm-work record-probes")
  })
})
