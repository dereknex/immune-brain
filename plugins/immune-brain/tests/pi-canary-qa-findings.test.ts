import { describe, expect, it } from "bun:test"
import {
	describeQaFailure,
	qaEvidenceFreshnessId,
	qaFindingId,
} from "../.pi-extension/pi-canary-qa-findings"

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

describe("qaEvidenceFreshnessId", () => {
	it("is digest-scoped and unique per attempt", () => {
		const id = qaEvidenceFreshnessId(DIGEST)
		expect(id).toMatch(/^qa-evidence-freshness-[0-9a-f]{16}-[0-9a-f]{8}-[0-9a-f]{6}$/)
		const again = qaEvidenceFreshnessId(DIGEST)
		expect(again).not.toBe(id)
	})
})

describe("describeQaFailure", () => {
	it("preserves the original verdict findings when apply fails", () => {
		const message = describeQaFailure("findings contains duplicate id qa-AC-TEST-x", [
			{ id: "qa-AC-TEST-x", summary: "verification failed (exit 1) stdout=0B stderr=6B: boom" },
		])
		expect(message).toContain("qa-AC-TEST-x")
		expect(message).toContain("boom")
	})

	it("returns the plain error when no verdict findings exist", () => {
		expect(describeQaFailure("boom", undefined)).toBe("boom")
	})

	it("caps the composed message to the notification budget", () => {
		const longSummary = "x".repeat(2000)
		const message = describeQaFailure("y".repeat(300), [
			{ id: "qa-AC-TEST-x", summary: longSummary },
		])
		expect(message.length).toBeLessThanOrEqual(300)
	})
})
