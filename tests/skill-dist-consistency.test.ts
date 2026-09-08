import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve, relative, sep } from "node:path";
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

// Load precisely the heading body promised by the loaders, excluding nested branches.
function linkedSections(loaderPath: string, route: string): string {
	const links = [...route.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)];
	expect(links.length, route).toBeGreaterThan(0);
	return links.map(([, target]) => {
		const [path, anchor] = target.split("#");
		expect(anchor, target).toBeTruthy();
		const text = read(resolve(dirname(loaderPath), path));
		const headings = [...text.matchAll(/^#{1,6} (.+)$/gm)];
		const matches = headings.filter((heading) =>
			heading[1].toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s/g, "-") === anchor,
		);
		expect(matches.length, target).toBe(1);
		const heading = matches[0];
		const next = headings[headings.indexOf(heading) + 1];
		return text.slice(heading.index! + heading[0].length, next?.index);
	}).join("\n").replace(/\s+/g, " ");
}

function routeLine(loader: string, prefix: string): string {
	const line = loader.split("\n").find((line) => line.startsWith(`- ${prefix}`));
	expect(line, prefix).toBeDefined();
	return line!;
}

describe("skill dist consistency", () => {
	// These pair explicit entry with weak lexical matches; they assert metadata,
	// not a simulated classifier or a live model's selection rate.
	test.each([
		["imm-brainstorm", "clarify requirements with Immune-Brain", "explain this function", "requirement clarification"],
		["imm-planner", "plan a Spec with Immune-Brain", "fix this bug", "Spec and TaskIntent planning"],
		["imm-loop", "resume my Immune-Brain task", "continue explaining", "execution or resumption"],
		["imm-pr-fix", "repair PR feedback with Immune-Brain", "review this function", "GitHub PR review feedback"],
		["imm-doc-prune", "prune stale docs with Immune-Brain", "explain this document", "stale current documentation"],
		["imm-agent-doc-maintain", "minimize AGENTS.md with Immune-Brain", "what does this instruction mean", "tracked AGENTS.md"],
	])("%s: explicit '%s', not ordinary '%s'", (name, _explicit, _ordinary, scope) => {
		const loader = read(join(SKILLS_DIR, name, "SKILL.md"));
		const metadata = Bun.YAML.parse(loader.match(/^---\n([\s\S]*?)\n---/)![1]) as { description: string };
		expect(metadata.description).toStartWith("Use when the user explicitly requests");
		expect(metadata.description).toContain(scope);
		const activation = linkedSections(join(SKILLS_DIR, name, "SKILL.md"),
			"[Activation](../../dist/BASELINE.md#workflow-activation)");
		expect(activation).toContain("Ordinary host input stays host-native");
		expect(activation).toContain("new Managed workflow starts only from explicit");
	});

	test("all six explicit-entry loaders have valid frontmatter and section targets", () => {
		for (const item of publicSkills()) {
			const loader = read(item.skill);
			const metadata = Bun.YAML.parse(loader.match(/^---\n([\s\S]*?)\n---/)![1]) as {
				name: string; description: string;
			};
			expect(metadata.name).toBe(item.name);
			expect(metadata.description).toStartWith("Use when the user explicitly requests");
			expect(metadata.description).toContain("Immune-Brain");
			expect(loader).toContain("not a whole-document read");
			expect(loader).not.toMatch(/^Load \[/m);
			const routes = loader.split("\n").filter((line) => line.startsWith("- "));
			expect(routes.length).toBeGreaterThan(1);
			for (const route of routes) {
				expect(route).not.toContain(" through ");
				linkedSections(item.skill, route);
			}
			const common = linkedSections(item.skill, routeLine(loader, "common:"));
			expect(common).not.toMatch(/(?:load|read) (?:all|every) (?:reference|mode)/i);
		}
	});

	test("ordinary planning excludes page design, carrier publication, and recovery branches", () => {
		const path = join(SKILLS_DIR, "imm-planner/SKILL.md");
		const loader = read(path);
		const ordinary = linkedSections(path, routeLine(loader, "common:")) +
			linkedSections(path, routeLine(loader, "standard planning:"));
		for (const unrelated of ["visible_actions", "State inventory", "imm-tracker publish-initiative"]) {
			expect(ordinary).not.toContain(unrelated);
		}
		expect(ordinary).toContain("imm-kernel intent author");
		const page = linkedSections(path, routeLine(loader, "`mode: page_design`"));
		expect(page).toContain("DESIGN.md");
		expect(page).toContain("Do not edit UI files, tests, Specs, Plans, or workflow state");
		expect(page).not.toContain("imm-kernel intent author");
		const revision = linkedSections(path, routeLine(loader, "revision of an enrolled intent"));
		expect(revision).toContain("Preserve the prior on-disk sidecars");
		expect(revision).toContain("approve_breaking_intent_revision");
		expect(revision).toContain("the native Host gate is the single user decision");
	});

	test("clear framing skips opt-in interrogation and Loop recovery exposes native guards", () => {
		const brainPath = join(SKILLS_DIR, "imm-brainstorm/SKILL.md");
		const brain = read(brainPath);
		const normal = linkedSections(brainPath, routeLine(brain, "common:")) +
			linkedSections(brainPath, routeLine(brain, "default:"));
		expect(normal).toContain("zero-question fast path");
		expect(normal).not.toContain("Seed the fixed framing roots");
		expect(normal).not.toContain("buildBrainstormEnsembleRequest");
		expect(linkedSections(brainPath, routeLine(brain, "explicit thorough interrogation:")))
			.toContain("Seed the fixed framing roots");
		const loopPath = join(SKILLS_DIR, "imm-loop/SKILL.md");
		const loop = read(loopPath);
		expect(linkedSections(loopPath, routeLine(loop, "steady execution:")))
			.not.toContain("For `settlement_unknown`");
		const recovery = linkedSections(loopPath, routeLine(loop, "rework,"));
		expect(recovery).toContain("For `settlement_unknown`");
		expect(recovery).toContain("request_authorization");
		expect(recovery).toContain("fail-closed");
		expect(recovery).toContain("never replay the uncertain write");
	});

	test("maintenance audits stop at manifests and mutation routes expose all guards", () => {
		for (const name of ["imm-doc-prune", "imm-agent-doc-maintain"]) {
			const path = join(SKILLS_DIR, name, "SKILL.md");
			const loader = read(path);
			const audit = linkedSections(path, routeLine(loader, "common:")) +
				linkedSections(path, routeLine(loader, "audit or manifest preparation:"));
			expect(audit).toContain("literal user approves exact manifest");
			expect(audit).toContain("BLOCKED_ACTIVE_SCOPE");
			expect(audit).not.toContain("**Revalidate and mutate minimally.**");
			const mutation = linkedSections(path, routeLine(loader, "approved mutation"));
			expect(mutation).toContain("Drift blocks that item");
			expect(mutation).toContain("Managed authority mutation");
		}
	});

	test("every public skill has a packaged counterpart", () => {
		const skills = publicSkills();
		expect(skills.map((item) => item.name).sort()).toEqual([
			"imm-agent-doc-maintain",
			"imm-brainstorm",
			"imm-doc-prune",
			"imm-loop",
			"imm-planner",
			"imm-pr-fix",
		]);
		for (const item of skills) {
			expect(read(item.skill).length).toBeGreaterThan(0);
			expect(read(item.dist).length).toBeGreaterThan(0);
		}
	});

	test("standalone PR repair keeps remote diagnosis and Managed authority isolated", () => {
		const contract = read(join(DIST_DIR, "imm-pr-fix.md"));
		expect(contract).toContain("imm-pr-diag <PR>");
		expect(contract).toContain("untrusted data");
		expect(contract).toContain("Stop on detached HEAD, zero matches, multiple matches");
		expect(contract).toContain("without creating or mutating\nTaskIntent, TaskRecord, Kernel, Spec, or Plan authority");
		expect(contract).toContain("An already active\nManaged task remains owned by `imm-loop`");
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
			["imm-agent-doc-maintain.md", "imm-brainstorm.md", "imm-doc-prune.md", "imm-loop.md", "imm-planner.md", "imm-pr-fix.md"].sort(),
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

	test("Planner and Loop entry points remain section-free loaders", () => {
		for (const skill of ["imm-planner", "imm-loop"]) {
			const text = read(join(SKILLS_DIR, skill, "SKILL.md"));
			expect(text).toContain(`../../dist/${skill}.md`);
			expect(text).toContain("canonical contract");
			expect(text).not.toMatch(/^## /m);
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
