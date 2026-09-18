import { describe, expect, it } from "bun:test";
import {
	resolveUxLanguage,
	uxText,
} from "../plugins/immune-brain/.pi-extension/ux-language";

describe("host-native UI language", () => {
	it("defaults to English without IMM_UX_LANGUAGE", () => {
		expect(resolveUxLanguage({})).toBe("en");
		expect(resolveUxLanguage({ IMM_UX_LANGUAGE: "" })).toBe("en");
		expect(resolveUxLanguage({ IMM_UX_LANGUAGE: "fr" })).toBe("en");
	});

	it("resolves Chinese aliases", () => {
		for (const value of ["zh", "zh-CN", "ZH-tw", "chinese", "中文"])
			expect(resolveUxLanguage({ IMM_UX_LANGUAGE: value })).toBe("zh");
	});

	it("picks the sentence for the resolved language", () => {
		expect(uxText("en", "Authorize", "批准")).toBe("Authorize");
		expect(uxText("zh", "Authorize", "批准")).toBe("批准");
	});
});
