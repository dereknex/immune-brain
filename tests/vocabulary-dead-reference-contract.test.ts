import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

function read(rel: string): string {
	return readFileSync(join(ROOT, rel), "utf8");
}

const LIVE_TERMS = [
	"**Roadmap**:",
	"**Phase**:",
	"**acceptance_criteria**:",
	"**Fast-Track**:",
	"**Domain Mapper**:",
	"**Plan boundary**:",
	"**Scope pressure**:",
] as const;

const BASELINE_COPIES = [
	"plugins/immune-brain/BASELINE.md",
	"plugins/immune-brain/dist/BASELINE.md",
	"plugins/immune-brain/skills/BASELINE.md",
] as const;

function vocabularyHeadings(text: string): string[] {
	const language = text.split("## Language")[1]?.split("## Relationships")[0] ?? "";
	return [...language.matchAll(/\*\*([^*]+)\*\*:/g)].map((match) => match[1]);
}

describe("vocabulary dead-reference contract", () => {
	test("CONTEXT.md drops dead vocabulary entries and Python paths", () => {
		const context = read("CONTEXT.md");
		const headings = vocabularyHeadings(context);
		expect(headings).not.toContain("State Ledger");
		expect(headings).not.toContain("promotion_criteria");
		expect(headings).not.toContain("Activation Plan");
		expect(context).not.toContain("imm-plan.py");
		expect(context).not.toContain("activation_plan.py");
		for (const term of LIVE_TERMS) {
			expect(context).toContain(term);
		}
	});

	test("every BASELINE copy shares the same canonical-term list without State Ledger", () => {
		const lists = BASELINE_COPIES.map((rel) => {
			const text = read(rel);
			const match = text.match(
				/Preserve `CONTEXT\.md` canonical terms such as[^\n]+(?:\n[^\n]+)*?;/,
			);
			expect(match, rel).toBeTruthy();
			return match![0];
		});
		expect(new Set(lists).size).toBe(1);
		expect(lists[0]).not.toContain("`State Ledger`");
		expect(lists[0]).toContain("`Step`");
		expect(lists[0]).toContain("`Plan`");
		expect(lists[0]).toContain("`Spec`");
	});
});
