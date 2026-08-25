import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SKILL_DIST = "plugins/immune-brain/dist/imm-loop.md"
const INTERNAL_REVIEW = "plugins/immune-brain/dist/role-prompts/code-review.md"
const RETIRED_PACKAGED_ACTIVATION = [
	"plugins/immune-brain/dist/docs/specs/automatic-subagent-activation.spec.md",
	"plugins/immune-brain/dist/docs/reference/automatic-subagent-activation-policy.md",
	"plugins/immune-brain/dist/docs/reference/review-host-dispatch-protocol.md",
	"plugins/immune-brain/dist/docs/reference/subagent-trigger-catalog.yaml",
]
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
		for (const rel of [SKILL_DIST, INTERNAL_REVIEW]) {
			const content = read(rel)
			expectRetiredCliAbsent(content, rel)
			expect(content).not.toContain("MCP-first")
			expect(content).not.toContain("imm_activation_plan")
		}
		const review = read(INTERNAL_REVIEW)
		expect(review).toContain("read-only code review")
		expect(review).toContain("imm-code-review")
		expect(review).toContain("rework")
		const dist = read(SKILL_DIST)
		expect(dist).toContain("imm_loop_action")
		expect(dist).toContain("subagent-dispatch-protocol.md")
	})

	it("does not ship the retired activation planner contracts", () => {
		for (const rel of RETIRED_PACKAGED_ACTIVATION)
			expect({ rel, present: existsSync(resolve(REPO_ROOT, rel)) }).toEqual({
				rel,
				present: false,
			})
	})

	it("keeps same-boundary findings on the follow_up execution route", () => {
		const content = read(SKILL_DIST)
		expect(content).toContain("same-boundary")
		expect(content).toContain("follow_up")
		expect(content).toContain("Loop runtime action")
		expect(content).toContain("not a Plan mutation")
	})
})
