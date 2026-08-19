import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readImmuneBrainConfig } from "../plugins/immune-brain/runtime/agent_config"

const temps: string[] = []

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "imm-advisory-config-"))
  temps.push(dir)
  return dir
}

function write(path: string, content: string): void {
  mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true })
  writeFileSync(path, content)
}

afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true })
})

describe("agent config coverage retained from advisory dispatch", () => {
  it("loads agent-local model configuration for surviving consumers", () => {
    const home = tempHome()
    const path = join(home, ".pi/agent/immune-brain/config.toml")
    write(path, "[workflow]\nmodel_preset = \"balanced\"\n\n[subagent_models]\nfast = \"file-fast\"\n")

    const loaded = readImmuneBrainConfig({ home_dir: home })

    expect(loaded.config.workflow?.model_preset).toBe("balanced")
    expect(loaded.config.subagent_models?.fast).toBe("file-fast")
    expect(loaded.config_paths).toEqual([path])
  })
})
