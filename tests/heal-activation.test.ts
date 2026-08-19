import { describe, expect, it } from "bun:test"
import { validateActivationMode, resolveActivationMode, buildSoloPlan } from "../plugins/immune-brain/runtime/activation"

describe("heal and activation parity", () => {
  it("validates activation modes", () => {
    expect(validateActivationMode("auto")).toBe("auto")
    expect(validateActivationMode("explicit_only")).toBe("explicit_only")
    expect(validateActivationMode("disabled")).toBe("disabled")
    expect(() => validateActivationMode("bogus")).toThrow()
  })

  it("resolves activation mode with explicit solo overriding config", () => {
    expect(resolveActivationMode(true, false, "auto")).toEqual({ mode: "explicit_only", reason: "explicit_solo" })
    expect(resolveActivationMode(false, true, "explicit_only")).toEqual({ mode: "auto", reason: "explicit_subagents" })
    expect(resolveActivationMode(false, false, "disabled")).toEqual({ mode: "disabled", reason: "config_default" })
  })

  it("builds a solo plan with no children", () => {
    const plan = buildSoloPlan("imm-code-review", "no triggers matched")
    expect(plan.solo).toBe(true)
    expect(plan.children).toEqual([])
    expect(plan.host).toBe("imm-code-review")
    expect(plan.reason).toBe("no triggers matched")
  })
})
