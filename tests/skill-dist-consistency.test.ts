import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import {
	DIST_DOC_ENTRIES,
	PACKAGED_CONTRACT_ENTRIES,
	SKILL_OWNED_ENTRIES,
	renderDistDoc,
} from "../scripts/dist-sync-manifest.ts";

const ROOT = resolve(import.meta.dir, "..");
const SKILLS_DIR = join(ROOT, "plugins/immune-brain/skills");
const DIST_DIR = join(ROOT, "plugins/immune-brain/dist");

function read(abs: string): string {
	return readFileSync(abs, "utf8");
}

function listFiles(dir: string): string[] {
	return readdirSync(dir, { recursive: true })
		.map((p) => resolve(dir, typeof p === "string" ? p : p.toString()))
		.filter((p) => statSync(p).isFile());
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

	test("every packaged contract document is declared with a source-of-truth", () => {
		const onDisk = listFiles(DIST_DIR)
			.map((p) => relative(DIST_DIR, p).split(sep).join("/"))
			.sort();
		const declared = PACKAGED_CONTRACT_ENTRIES.map((e) => e.packaged).sort();
		expect(onDisk).toEqual(declared);

		// No duplicate declarations
		expect(new Set(declared).size).toBe(declared.length);

		// Every declaration carries an explicit relationship claim
		for (const entry of PACKAGED_CONTRACT_ENTRIES) {
			expect(entry.packaged.trim()).toBeTruthy();
			expect(["mirror", "adapted", "owned"]).toContain(entry.kind);
			if (entry.kind === "owned") {
				expect(entry.source).toBeNull();
				expect(entry.reason?.trim()).toBeTruthy();
				expect(entry.skill?.trim()).toBeTruthy();
			} else {
				expect(entry.source?.trim()).toBeTruthy();
				// mirror and adapted must have a source file on disk
				expect(existsSync(resolve(ROOT, entry.source!))).toBe(true);
				expect(existsSync(join(DIST_DIR, entry.packaged))).toBe(true);
				if (entry.kind === "adapted") {
					expect(entry.reason?.trim()).toBeTruthy();
				}
			}
		}

		// Every owned skill contract is tracked
		expect(SKILL_OWNED_ENTRIES.map((e) => e.packaged).sort()).toEqual(
			["imm-brainstorm.md", "imm-loop.md", "imm-planner.md"].sort(),
		);
	});

	test("skill loader correctly references its owned packaged contract", () => {
		for (const entry of SKILL_OWNED_ENTRIES) {
			const skillPath = join(SKILLS_DIR, entry.skill!, "SKILL.md");
			const distPath = join(DIST_DIR, entry.packaged);
			expect(existsSync(skillPath)).toBe(true);
			expect(existsSync(distPath)).toBe(true);

			const skillText = read(skillPath);
			const distText = read(distPath);

			// Loader must reference the packaged file (relative load)
			expect(skillText).toContain(`dist/${entry.packaged}`);

			// Legitimate size difference: skill is the entry point, dist is full contract
			// (skill ≈5KB vs dist ≈30KB — byte identity is the wrong invariant)
			expect(distText.length).toBeGreaterThan(skillText.length);
			// Dist should be substantially larger than the loader (at least 2x)
			expect(distText.length).toBeGreaterThan(skillText.length * 2);

			// Packaged contract is self-contained agent instruction
			expect(distText).toContain("Immune-Brain");
			expect(distText.length).toBeGreaterThan(1000);

			// Owned entries must declare why they are self-sourced
			expect(entry.reason?.trim()).toBeTruthy();
		}
	});

	test("every declared packaged contract has a check enforcing its source relationship", () => {
		for (const entry of PACKAGED_CONTRACT_ENTRIES) {
			const packagedAbs = join(DIST_DIR, entry.packaged);
			expect(existsSync(packagedAbs)).toBe(true);

			if (entry.kind === "mirror") {
				const sourceAbs = resolve(ROOT, entry.source!);
				expect(existsSync(sourceAbs)).toBe(true);
				const sourceText = read(sourceAbs);
				const packagedText = read(packagedAbs);
				expect(packagedText).toBe(sourceText);
			} else if (entry.kind === "adapted") {
				const sourceAbs = resolve(ROOT, entry.source!);
				expect(existsSync(sourceAbs)).toBe(true);
				expect(entry.reason?.trim()).toBeTruthy();
				const original = DIST_DOC_ENTRIES.find(
					(e) => `docs/${e.rel}` === entry.packaged,
				);
				// Generated adapted entries have deterministic replacements
				if (original?.replacements?.length) {
					const sourceText = read(sourceAbs);
					const packagedText = read(packagedAbs);
					expect(renderDistDoc(original, sourceText)).toBe(packagedText);
				} else {
					// Manual adapted: intentionally divergent, but must exist and have a reason
					// (e.g., deliberately narrower runtime copy). We enforce reason and existence
					// here; byte identity is not expected.
					expect(read(packagedAbs).length).toBeGreaterThan(0);
				}
				// Adapted copies must not ship raw upstreams/ submodule paths
				if (entry.packaged.startsWith("docs/reference/")) {
					expect(read(packagedAbs).includes("upstreams/")).toBe(false);
				}
			} else if (entry.kind === "owned") {
				// Owned: self-sourced, loader reference already verified above.
				// Enforce that packaged file is non-empty and significantly larger than its loader.
				const skillPath = join(SKILLS_DIR, entry.skill!, "SKILL.md");
				const packagedText = read(packagedAbs);
				const skillText = read(skillPath);
				expect(packagedText.length).toBeGreaterThan(skillText.length * 2);
				expect(packagedText).toContain("Immune-Brain");
			}
		}
	});
});
