import { describe, expect, it } from "bun:test"
import { qaFindingId } from "../.pi-extension/pi-canary-qa-findings"

const DIGEST =
	"sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

describe("qaFindingId", () => {
	it("scopes the id to the acceptance and snapshot digest", () => {
		const id = qaFindingId("AC-6-repo-cutover", DIGEST)
		expect(id).toMatch(/^qa-AC-6-repo-cutover-[0-9a-f]{8}-[0-9a-f]{6}$/)
	})

	it("never collides across repeated attempts on the same snapshot", () => {
		const seen = new Set<string>()
		for (let i = 0; i < 50; i++) {
			const id = qaFindingId("AC-TEST", DIGEST)
			expect(seen.has(id)).toBe(false)
			seen.add(id)
		}
	})

	it("differs across snapshots even with identical attempt timing", () => {
		const digestA = "sha256:" + "a".repeat(64)
		const digestB = "sha256:" + "b".repeat(64)
		expect(qaFindingId("AC-TEST", digestA)).not.toBe(qaFindingId("AC-TEST", digestB))
	})
})

