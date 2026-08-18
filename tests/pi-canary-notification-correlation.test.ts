import { describe, expect, test } from "bun:test";

import { AssurancePresenter } from "../plugins/immune-brain/.pi-extension/pi-canary-assurance";

describe("foreground assurance presentation", () => {
	test("presenter exposes only passive lifecycle cleanup", () => {
		const presenter = new AssurancePresenter();
		expect(() => presenter.publish()).not.toThrow();
		expect(() => presenter.clear()).not.toThrow();
		expect(() => presenter.reset()).not.toThrow();
	});

	test("foreground assurance has no follow-up delivery surface", () => {
		const source = require("node:fs").readFileSync(
			"plugins/immune-brain/.pi-extension/pi-canary-assurance.ts",
			"utf8",
		) as string;
		expect(source).not.toContain("deliverFollowUp");
		expect(source).not.toContain("sendMessage");
		expect(source).not.toContain("followUp");
	});
});
