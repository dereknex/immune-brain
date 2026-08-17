import { afterEach, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const temps: string[] = []
const bin = join(process.cwd(), "plugins/immune-brain/bin/imm-activation-plan")

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "imm-activation-"))
  temps.push(dir)
  return dir
}

function write(path: string, content: string): void {
  mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true })
  writeFileSync(path, content)
}

function activation(args: string[], home: string, env: Record<string, string> = {}) {
  return JSON.parse(execFileSync(bin, args, {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home, ...env },
    encoding: "utf8",
  }))
}

afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true })
})

describe("activation plan file-backed config", () => {
  it("imm-activation-plan is retired after v4 storage retirement", () => {
    const home = tempHome()
    let threw = false
    try {
      activation([], home)
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
})
