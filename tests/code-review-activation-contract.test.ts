import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SKILL_SOURCE = "plugins/immune-brain/skills/imm-code-review/SKILL.md"
const SKILL_DIST = "plugins/immune-brain/dist/imm-code-review.md"
const PACKAGED_SPEC =
	"plugins/immune-brain/dist/docs/specs/automatic-subagent-activation.spec.md"
const RETIRED_CLI = [
	"imm-activation-plan",
	"immune_brain_runtime.ts",
	"activation_runtime_unavailable",
]

function read(rel: string): string {
	return readFileSync(resolve(REPO_ROOT, rel), "utf-8")
}

function expectRetiredCliAbsent(content: string, rel: string): void {
	for (const token of RETIRED_CLI) {
		expect({ rel, token, present: content.includes(token) }).toEqual({
			rel,
			token,
			present: false,
		})
	}
}

describe("imm-code-review activation fallback contract", () => {
	it("keeps catalog-driven lenses and shared dispatch without a retired CLI ladder", () => {
		for (const rel of [SKILL_SOURCE, SKILL_DIST]) {
			const content = read(rel)
			expectRetiredCliAbsent(content, rel)
			expect(content).toContain("trigger_not_hit")
			expect(content).toContain("explicit_required")
			expect(content).toContain("host_authorization_required")
			expect(content).not.toContain("MCP-first")
			expect(content).not.toContain("imm_activation_plan")
		}
		const dist = read(SKILL_DIST)
		expect(dist).toContain("security")
		expect(dist).toContain("api_contract")
		expect(dist).toContain("data_integrity")
		expect(dist).toContain("reliability")
		expect(dist).toContain("review-host-dispatch-protocol.md")
		expect(dist).toContain("subagent-dispatch-protocol.md")
	})

	it("stops naming a packaged CLI planner entrypoint", () => {
		expectRetiredCliAbsent(read(PACKAGED_SPEC), PACKAGED_SPEC)
		expect(read(PACKAGED_SPEC)).toContain("subagent-trigger-catalog.yaml")
		expect(read(PACKAGED_SPEC)).toContain("automatic-subagent-activation-policy.md")
	})

	it("keeps same-boundary findings on the follow_up execution route", () => {
		for (const rel of [SKILL_SOURCE, SKILL_DIST]) {
			const content = read(rel)
			expect(content).toContain("same-boundary")
			expect(content).toContain("follow_up")
			expect(content).toContain("imm-work")
			expect(content).toContain("not a Plan mutation")
		}
	})
})
