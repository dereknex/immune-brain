import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  readImmuneBrainConfig,
  resolveImmuneBrainLocalPath,
  resolveWorkflowStageModels,
  resolveImmuneBrainLocalRoot,
} from "../plugins/immune-brain/runtime/imm_core"

const temps: string[] = []

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "imm-config-"))
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

describe("Immune-Brain agent-local config runtime", () => {
  it("resolves agent-native roots and local helper paths", () => {
    const home = tempHome()
    const root = resolveImmuneBrainLocalRoot({ home_dir: home })

    expect(root.root).toBe(join(home, ".pi/agent/immune-brain"))
    expect(root.config_path).toBe(join(home, ".pi/agent/immune-brain/config.toml"))
    expect(resolveImmuneBrainLocalPath({ home_dir: home, relative_path: "insights/workflow-improvement-inbox.md" }))
      .toBe(join(home, ".pi/agent/immune-brain/insights/workflow-improvement-inbox.md"))
  })

  it("loads only the Pi config and ignores retired roots", () => {
    const home = tempHome()
    write(join(home, ".immune-brain/config.toml"), "[workflow]\nmodel_preset = \"quality\"\n")
    write(join(home, ".codex/immune-brain/config.toml"), "[workflow]\nmodel_preset = \"budget\"\n")
    write(join(home, ".pi/agent/immune-brain/config.toml"), "[workflow]\nmodel_preset = \"balanced\"\n\n[subagent_models]\nfast = \"deepseek/fast\"\n")

    const pi = readImmuneBrainConfig({ home_dir: home })

    expect(pi.config.workflow?.model_preset).toBe("balanced")
    expect(pi.config.subagent_models?.fast).toBe("deepseek/fast")
    expect(pi.config_paths).toEqual([join(home, ".pi/agent/immune-brain/config.toml")])
  })

  it("merges explicit config paths with agent override replacing arrays", () => {
    const home = tempHome()
    const base = join(home, "base.toml")
    const agent = join(home, "agent.toml")
    write(base, "[workflow]\nmodel_preset = \"balanced\"\n\n[workflow_models]\nplanner_ensemble = [\"fast\", \"mid\"]\n")
    write(agent, "[workflow_models]\nplanner_ensemble = [\"strong\"]\n\n[subagent_models]\nstrong = \"model-strong\"\n")

    write(join(home, ".pi/agent/immune-brain/config.toml"), "[workflow]\nmodel_preset = \"quality\"\n")
    const loaded = readImmuneBrainConfig({
      home_dir: home,
      env: { IMMUNE_BRAIN_CONFIG: base, IMMUNE_BRAIN_AGENT_CONFIG: agent },
    })

    expect(loaded.config.workflow?.model_preset).toBe("balanced")
    expect(loaded.config.workflow_models?.planner_ensemble).toEqual(["strong"])
    expect(loaded.config.subagent_models?.strong).toBe("model-strong")
    expect(loaded.config_paths).toEqual([
      join(home, ".pi/agent/immune-brain/config.toml"),
      base,
      agent,
    ])
  })

  it("loads and validates per-stage reasoning and verbosity metadata", () => {
    const home = tempHome()
    write(join(home, ".pi/agent/immune-brain/config.toml"), [
      "[workflow_models]",
      "planner = [\"mid\"]",
      "",
      "[workflow_model_options.planner]",
      "reasoning_effort = \"medium\"",
      "verbosity = \"low\"",
      "",
    ].join("\n"))

    const loaded = readImmuneBrainConfig({ home_dir: home })
    expect(resolveWorkflowStageModels("planner", loaded.config).model_options).toEqual({
      reasoning_effort: "medium",
      verbosity: "low",
    })
    expect(() => resolveWorkflowStageModels("planner", {
      workflow_model_options: { planner: { reasoning_effort: "extreme" as any } },
    })).toThrow("Invalid workflow_model_options.planner.reasoning_effort")
  })

  it("does not expose a coding-agent selector", () => {
    const home = tempHome()
    const input: Record<string, unknown> = { host_selector: "retired", home_dir: home }
    expect(resolveImmuneBrainLocalRoot(input as Parameters<typeof resolveImmuneBrainLocalRoot>[0]).root)
      .toBe(join(home, ".pi/agent/immune-brain"))
    expect("agent_id" in resolveImmuneBrainLocalRoot({ home_dir: home })).toBe(false)
  })
})
