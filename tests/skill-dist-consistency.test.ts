import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SKILLS_DIR = join(ROOT, "plugins/immune-brain/skills");
const DIST_DIR = join(ROOT, "plugins/immune-brain/dist");

const RUNTIME_SURFACE = [
	"imm_loop_action",
	"imm_kernel_canary",
	"imm_canary_enrollment",
	"advance_assurance",
	"submit_review",
	"request_authorization",
	"imm-autowork",
	"imm-canary-work",
] as const;

function read(abs: string): string {
	return readFileSync(abs, "utf8");
}

function publicSkills(): Array<{ name: string; skill: string; dist: string }> {
	return readdirSync(SKILLS_DIR, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name.startsWith("imm-"))
		.map((entry) => ({
			name: entry.name,
			skill: join(SKILLS_DIR, entry.name, "SKILL.md"),
			dist: join(DIST_DIR, `${entry.name}.md`),
		}));
}

function presentTokens(text: string): string[] {
	return RUNTIME_SURFACE.filter((token) => text.includes(token));
}

describe("skill dist consistency", () => {
	test("every public skill has a packaged counterpart", () => {
		const skills = publicSkills();
		expect(skills.map((item) => item.name).sort()).toEqual([
			"imm-brainstorm",
			"imm-loop",
			"imm-planner",
		]);
		for (const item of skills) {
			expect(read(item.skill).length).toBeGreaterThan(0);
			expect(read(item.dist).length).toBeGreaterThan(0);
		}
	});

	test("public skills and packaged copies agree on the runtime surface they instruct", () => {
		const disagreements: string[] = [];
		for (const item of publicSkills()) {
			const skillTokens = presentTokens(read(item.skill));
			const distTokens = presentTokens(read(item.dist));
			if (skillTokens.join(",") !== distTokens.join(",")) {
				disagreements.push(
					`${item.name}: skill=[${skillTokens.join(", ")}] dist=[${distTokens.join(", ")}]`,
				);
			}
		}
		expect(disagreements).toEqual([]);
	});
});
