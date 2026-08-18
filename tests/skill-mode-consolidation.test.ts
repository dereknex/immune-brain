import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const registry = readFileSync(
	resolve(ROOT, "plugins/immune-brain/skills/registry.yaml"),
	"utf8",
);

const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const RETIRED_ALIASES = [
	"debug-investigator",
	"imm-page-design",
	"imm-party",
	"imm-preplan-review",
];

function registryBlock(name: string): string {
	const start = registry.indexOf(`  - name: ${name}`);
	expect(start).toBeGreaterThanOrEqual(0);
	const next = registry.indexOf("\n  - name:", start + 1);
	return registry.slice(start, next < 0 ? registry.length : next);
}

describe("canonical Skill mode consolidation", () => {
	it("declares the canonical framing modes", () => {
		const block = registryBlock("imm-brainstorm");
		expect(block).toContain("canonical: true");
		expect(block).toContain("modes: [default, roundtable, adversarial]");
		expect(block).toContain("next_actions: [imm-planner]");
		expect(read("plugins/immune-brain/dist/imm-brainstorm.md")).toContain(
			"`roundtable`",
		);
		expect(read("plugins/immune-brain/dist/imm-brainstorm.md")).toContain(
			"`adversarial`",
		);
	});

	it("retires the compatibility aliases from registry and dist", () => {
		for (const alias of RETIRED_ALIASES) {
			expect(registry).not.toContain(`  - name: ${alias}`);
			expect(
				existsCheck(resolve(ROOT, `plugins/immune-brain/skills/${alias}/SKILL.md`)),
			).toBe(false);
			expect(
				existsCheck(resolve(ROOT, `plugins/immune-brain/dist/${alias}.md`)),
			).toBe(false);
			expect(
				read("plugins/immune-brain/dist/registry.yaml"),
			).not.toContain(`  - name: ${alias}`);
		}
	});

	it("keeps canonical docs authoritative without alias entry references", () => {
		for (const doc of [
			"plugins/immune-brain/dist/imm-brainstorm.md",
			"plugins/immune-brain/dist/role-prompts/advisory-reviewer.md",
			"plugins/immune-brain/dist/imm-planner.md",
			"plugins/immune-brain/skills/imm-brainstorm/SKILL.md",
		]) {
			const content = read(doc);
			for (const alias of RETIRED_ALIASES) {
				expect({ doc, alias, present: content.includes(alias) }).toEqual({
					doc,
					alias,
					present: false,
				});
			}
		}
	});

	it("exposes the consolidated debug lens and page design mode", () => {
		expect(
			read("plugins/immune-brain/dist/role-prompts/advisory-reviewer.md"),
		).toContain("`debug_hypothesis`");
		expect(read("plugins/immune-brain/dist/imm-planner.md")).toContain(
			"mode: page_design",
		);
	});
});

function existsCheck(path: string): boolean {
	const { existsSync } = require("node:fs") as typeof import("node:fs");
	return existsSync(path);
}
