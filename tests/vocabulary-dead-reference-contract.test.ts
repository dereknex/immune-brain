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

const HISTORICAL_ROADMAP_TERMS = [
	"Roadmap",
	"Phase",
	"acceptance_criteria",
	"Plan boundary",
	"Scope pressure",
	"Successor candidate",
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

function sectionForTerm(context: string, term: string): string {
	const language = context.split("## Language")[1]?.split("## Relationships")[0] ?? "";
	// Find heading and capture until next heading or section end
	const idx = language.indexOf(`**${term}**:`);
	if (idx === -1) return "";
	const rest = language.slice(idx);
	// Capture up to next **...**: or ##
	const nextHeading = rest.slice(rest.indexOf(`**${term}**:`) + (`**${term}**:`.length)).search(/\n\*\*[^*]+\*\*:/);
	if (nextHeading === -1) return rest;
	return rest.slice(0, rest.indexOf(`**${term}**:`) + (`**${term}**:`.length) + nextHeading);
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

	test("CONTEXT.md keeps Roadmap-family terms for parser compatibility, marked historical read-only", () => {
		const context = read("CONTEXT.md");
		for (const term of HISTORICAL_ROADMAP_TERMS) {
			expect(context, `missing heading for ${term}`).toContain(`**${term}**:`);
			const section = sectionForTerm(context, term);
			expect(section, `historical marker missing for ${term}`).toMatch(/historical/i);
			expect(section, `read-only marker missing for ${term}`).toMatch(/read-only/i);
			expect(section, `plan_core marker missing for ${term}`).toContain("plan_core");
		}
		// Fast-Track and Domain Mapper remain live (not required to be historical, but must still exist)
		expect(context).toContain("**Fast-Track**:");
		expect(context).toContain("**Domain Mapper**:");
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
