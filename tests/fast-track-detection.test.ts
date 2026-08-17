import { describe, expect, it } from "bun:test";
import { planSupportsFastTrack } from "../plugins/immune-brain/runtime/imm_core";

describe("fast-track detection", () => {
	it("refuses fast-track when a step has no automated verification", () => {
		expect(
			planSupportsFastTrack([
				{ number: 1, verification: "`bun test tests/a.test.ts`" },
				{ number: 2, verification: "Manually confirm the layout in Safari" },
			]),
		).toBe(false);
	});

	it("refuses fast-track for a three-step plan even when fully automated", () => {
		expect(
			planSupportsFastTrack([
				{ number: 1, verification: "`bun test tests/a.test.ts`" },
				{ number: 2, verification: "`bun test tests/b.test.ts`" },
				{ number: 3, verification: "`bun test tests/c.test.ts`" },
			]),
		).toBe(false);
	});

	it("refuses fast-track for a plan with no steps", () => {
		expect(planSupportsFastTrack([])).toBe(false);
	});

	it("allows fast-track for a two-step fully automated plan", () => {
		expect(
			planSupportsFastTrack([
				{ number: 1, verification: "`bun test tests/a.test.ts`" },
				{ number: 2, verification: "`bun test tests/b.test.ts`" },
			]),
		).toBe(true);
	});
});
