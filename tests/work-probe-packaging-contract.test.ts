import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const LOOP = resolve(REPO_ROOT, "plugins/immune-brain/dist/imm-loop.md")
const EXECUTOR = resolve(REPO_ROOT, "plugins/immune-brain/dist/role-prompts/executor.md")

function read(path: string): string {
  return readFileSync(path, "utf-8")
}

describe("work-probe packaging contract", () => {
  it("keeps the Loop and executor contracts internal", () => {
    const loop = read(LOOP)
    const executor = read(EXECUTOR)
    expect(loop).toContain("internal")
    expect(executor).toContain("Internal role")
    expect(existsSync(resolve(REPO_ROOT, "plugins/immune-brain/dist/imm-work.md"))).toBe(false)
    expect(existsSync(resolve(REPO_ROOT, "plugins/immune-brain/dist/imm-executor.md"))).toBe(false)
  })
})
