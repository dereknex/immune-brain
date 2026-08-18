import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const PLUGIN_ROOT = resolve(import.meta.dir, "..")

const CANONICAL_PHRASE =
  "This session authorizes Immune-Brain to auto-use bounded read-only subagents/parallel probes when the mode is auto and boundaries are clear."
const AUTHORITY = "dist/docs/reference/subagent-dispatch-protocol.md"
const AUTHORITY_LINK = "subagent-dispatch-protocol.md#authorization-authority"

const DISPATCH_HOSTS = [
  "dist/imm-loop.md",
]

describe("dispatch authorization source of truth", () => {
  it("keeps the canonical grant only in the shared protocol", () => {
    expect(readFileSync(resolve(PLUGIN_ROOT, AUTHORITY), "utf-8")).toContain(CANONICAL_PHRASE)
    for (const rel of DISPATCH_HOSTS) {
      expect(readFileSync(resolve(PLUGIN_ROOT, rel), "utf-8")).not.toContain(CANONICAL_PHRASE)
    }
  })

  it("requires every dispatch host to link to the authority", () => {
    const offenders = DISPATCH_HOSTS.filter((rel) =>
      !readFileSync(resolve(PLUGIN_ROOT, rel), "utf-8").includes(AUTHORITY_LINK))
    expect(offenders).toEqual([])
  })

  it("does not reintroduce the retired hardcoded Chinese phrase", () => {
    const offenders = [AUTHORITY, ...DISPATCH_HOSTS].filter((rel) =>
      readFileSync(resolve(PLUGIN_ROOT, rel), "utf-8").includes("本会话允许"))
    expect(offenders).toEqual([])
  })
})
