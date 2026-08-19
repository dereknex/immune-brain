// Deterministic risk-tier floor: an intent declaring `routine` whose
// scope_hint touches kernel or authority runtime paths is forced to at least
// `material`, derived solely from scope_hint (never from prose fields);
// scopes touching only documentation or ordinary test paths keep the declared
// tier. Covers acc-floor-enforced and acc-non-kernel-unaffected.

import { describe, expect, it } from "bun:test";
import {
	parseTaskIntentV1,
	RISK_FLOOR_SCOPE_PREFIXES,
} from "../plugins/immune-brain/runtime/kernel/intent";

const BASE = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: "risk-floor-task",
	owner: "user",
	goal: "One outcome",
	acceptance: [
		{ id: "A1", assertion: "a1", verification: "v1" },
	],
	risk: "routine",
	revision: 1,
} as const;

describe("deterministic risk-tier floor", () => {
	it("promotes routine to material when scope_hint touches the kernel runtime", () => {
		for (const scope_hint of [
			["plugins/immune-brain/runtime/kernel"],
			["plugins/immune-brain/runtime/kernel/intent.ts"],
			["plugins/immune-brain/runtime/kernel/"],
			["plugins/immune-brain/runtime/kernel", "docs/**"],
			["plugins/immune-brain/runtime/kernel/*"],
		]) {
			const parsed = parseTaskIntentV1({ ...BASE, scope_hint });
			expect(parsed.risk).toBe("material");
		}
	});

	it("promotes routine to material when scope_hint touches authority paths", () => {
		for (const scope_hint of [
			["plugins/immune-brain/runtime/authority_commit_receipts.ts"],
			["plugins/immune-brain/runtime/authority_commit_receipts.ts"],
		]) {
			const parsed = parseTaskIntentV1({ ...BASE, scope_hint });
			expect(parsed.risk).toBe("material");
		}
	});

	it("promotes routine to material when scope_hint covers the whole plugin (kernel subtree included)", () => {
		const parsed = parseTaskIntentV1({ ...BASE, scope_hint: ["plugins/immune-brain"] });
		expect(parsed.risk).toBe("material");
	});

	it("promotes routine even with wildcard-leading or glob patterns touching kernel paths", () => {
		for (const scope_hint of [
			["**/kernel/**"],
			["plugins/imm*/runtime/kernel"],
			["plugins/immune-brain/runtime/*/kernel"],
		]) {
			const parsed = parseTaskIntentV1({ ...BASE, scope_hint });
			expect(parsed.risk).toBe("material");
		}
	});

	it("keeps the declared tier for documentation-only scope", () => {
		for (const scope_hint of [
			["docs/plans/risk-floor-task.intent.json"],
			["docs/**"],
			["docs", "tests/ordinary.test.ts"],
			["tests/risk-tier-floor.test.ts"],
		]) {
			const parsed = parseTaskIntentV1({ ...BASE, scope_hint });
			expect(parsed.risk).toBe("routine");
		}
	});

	it("keeps material and critical tiers untouched over kernel scope", () => {
		expect(
			parseTaskIntentV1({
				...BASE,
				scope_hint: ["plugins/immune-brain/runtime/kernel"],
				risk: "material",
			}).risk,
		).toBe("material");
		expect(
			parseTaskIntentV1({
				...BASE,
				scope_hint: ["plugins/immune-brain/runtime/kernel"],
				risk: "critical",
			}).risk,
		).toBe("critical");
	});

	it("exposes the floor prefixes for downstream consumers", () => {
		expect(RISK_FLOOR_SCOPE_PREFIXES).toContain(
			"plugins/immune-brain/runtime/kernel",
		);
		expect(RISK_FLOOR_SCOPE_PREFIXES).toContain(
			"plugins/immune-brain/runtime/authority_commit_receipts.ts",
		);
	});
});