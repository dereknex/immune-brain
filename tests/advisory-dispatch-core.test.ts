import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  buildAdvisoryDelegationPrompt,
  buildAdvisoryDispatchEnvelope,
  resolveAdvisoryModel,
  resolveWorkflowStageModels,
} from "../plugins/immune-brain/runtime/advisory_dispatch"
import { readImmuneBrainConfig } from "../plugins/immune-brain/runtime/agent_config"

const modelConfig = {
  subagent_models: {
    fast: "model-fast",
    mid: "model-mid",
    strong: "model-strong",
    local: "inherit",
    lens_overrides: {
      security: "model-security",
    },
  },
}

const temps: string[] = []

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "imm-advisory-"))
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

describe("advisory dispatch core", () => {
  it("resolves lens overrides before tier mapping and omits inherited models", () => {
    const override = resolveAdvisoryModel({
      lens: "security",
      candidate: "imm-advisory-reviewer",
      lens_model_tiers: { security: "mid" },
      model_tiers: { "imm-advisory-reviewer": "fast" },
      config: modelConfig,
    })

    expect(override.model).toBe("model-security")
    expect(override.source).toBe("lens_override")

    const inherited = resolveAdvisoryModel({
      lens: "reliability",
      candidate: "imm-advisory-reviewer",
      lens_model_tiers: { reliability: "mid" },
      config: { subagent_models: { mid: "inherit" } },
    })

    expect(inherited.model).toBeUndefined()
    expect(inherited.source).toBe("inherit")
  })

  it("expands workflow presets and lets one stage override without replacing the preset", () => {
    const config = {
      ...modelConfig,
      workflow: { model_preset: "balanced" },
      workflow_models: { qa: ["strong"] },
    }

    expect(resolveWorkflowStageModels("qa", config).entries).toEqual(["strong"])
    expect(resolveWorkflowStageModels("qa", config).models.map((m) => m.model)).toEqual(["model-strong"])

    const ensemble = resolveWorkflowStageModels("planner_ensemble", config)
    expect(ensemble.entries).toEqual(["fast", "mid", "strong"])
    expect(ensemble.models.map((m) => m.model)).toEqual(["model-fast", "model-mid", "model-strong"])
    expect(ensemble.dispatch_mode).toBe("multi_model")

    const brainstorm = resolveWorkflowStageModels("brainstorm_ensemble", config)
    expect(brainstorm.entries).toEqual(["fast", "mid", "strong"])
    expect(brainstorm.models.map((m) => m.model)).toEqual(["model-fast", "model-mid", "model-strong"])
    expect(brainstorm.dispatch_mode).toBe("multi_model")
  })

  it("collapses duplicate resolved models into a single-model fallback", () => {
    const resolved = resolveWorkflowStageModels("brainstorm_ensemble", {
      workflow_models: { brainstorm_ensemble: ["fast", "mid", "strong"] },
      subagent_models: { fast: "same-model", mid: "same-model", strong: "same-model" },
    })

    expect(resolved.models.map((m) => m.model)).toEqual(["same-model"])
    expect(resolved.dispatch_mode).toBe("single_model_fallback")
  })

  it("uses agent-local file config for advisory model routing", () => {
    const home = tempHome()
    write(join(home, ".pi/agent/immune-brain/config.toml"), "[workflow]\nmodel_preset = \"balanced\"\n\n[subagent_models]\nfast = \"file-fast\"\nmid = \"file-mid\"\nstrong = \"file-strong\"\n")

    const loaded = readImmuneBrainConfig({ home_dir: home })
    const ensemble = resolveWorkflowStageModels("planner_ensemble", loaded.config)

    expect(ensemble.entries).toEqual(["fast", "mid", "strong"])
    expect(ensemble.models.map((m) => m.model)).toEqual(["file-fast", "file-mid", "file-strong"])

    const brainstorm = resolveWorkflowStageModels("brainstorm_ensemble", loaded.config)
    expect(brainstorm.entries).toEqual(["fast", "mid", "strong"])
    expect(brainstorm.models.map((m) => m.model)).toEqual(["file-fast", "file-mid", "file-strong"])
  })

  it("builds a Pi Agent envelope without authority fields", () => {
    const prompt = buildAdvisoryDelegationPrompt({
      shared_context_summary: {
        goal: "Review the dispatch substrate.",
        changed_surface: "runtime helpers and focused tests",
        project_constraints: "advisory-only",
      },
      focus_delta: {
        role: "imm-advisory-reviewer",
        lens: "security",
        specific_changes: ["plugins/immune-brain/runtime/advisory_dispatch.ts"],
        audit_question: "Can this child mutate workflow state?",
      },
    })

    expect(prompt).toContain("internal role: advisory-reviewer")
    expect(prompt).toContain("do not discover or load Pi Skills")
    expect(prompt).not.toContain("skills/")
    expect(prompt).toContain("tool_policy: no tools")
    expect(prompt).toContain("no plan writes")
    expect(prompt).toContain("no QA closure")
    expect(() => buildAdvisoryDelegationPrompt({
      shared_context_summary: {
        goal: "Review the dispatch substrate.",
        changed_surface: "runtime helpers and focused tests",
        project_constraints: "advisory-only",
      },
      focus_delta: {
        role: "imm-advisory-reviewer",
        lens: " ",
        specific_changes: [],
        audit_question: "",
      },
    })).toThrow("explicit lens")

    const pi = buildAdvisoryDispatchEnvelope({
      candidate: "imm-advisory-reviewer",
      lens: "security",
      prompt,
      model: "model-security",
    })

    expect(pi.primitive).toBe("Agent")
    expect(pi.call).toMatchObject({
      subagent_type: "general-purpose",
      prompt,
      model: "model-security",
      inherit_context: false,
      run_in_background: false,
    })

    expect(() => buildAdvisoryDispatchEnvelope({
      candidate: "imm-advisory-reviewer",
      lens: " ",
      prompt,
    })).toThrow("explicit lens")

    const attemptedOverride = buildAdvisoryDispatchEnvelope({
      candidate: "imm-advisory-reviewer",
      lens: "security",
      prompt,
      run_in_background: true,
    } as Parameters<typeof buildAdvisoryDispatchEnvelope>[0] & {
      run_in_background: boolean
    })
    expect(attemptedOverride.call.run_in_background).toBe(false)

    expect(Object.keys(pi.call)).not.toContain("plan_write")
    expect(Object.keys(pi.call)).not.toContain("qa_closure")
    expect(Object.keys(pi.call)).not.toContain("state_mutation")
  })
})
