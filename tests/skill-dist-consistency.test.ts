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
		["imm-review-retro", "review-retro with Immune-Brain", "review this function", "cross-model review load"],
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

	test("all public explicit-entry loaders have valid frontmatter and section targets", () => {
		for (const item of publicSkills()) {
			const loader = read(item.skill);
			const metadata = Bun.YAML.parse(loader.match(/^---\n([\s\S]*?)\n---/)![1]) as {
				name: string; description: string;
			};
			expect(metadata.name).toBe(item.name);
			expect(metadata.description).toContain("Immune-Brain");
			expect(metadata.description).not.toMatch(/;|manifest|never |owns |authority|framing only/i);
			const packagedMetadata = Bun.YAML.parse(read(item.dist).match(/^---\n([\s\S]*?)\n---/)![1]) as { description: string };
			expect(metadata.description).toBe(packagedMetadata.description);
			expect(loader).toContain("not a whole-document read");
			expect(loader).not.toMatch(/^Load \[/m);
			const routes = loader.split("\n").filter((line) => line.startsWith("- "));
			expect(routes.length).toBeGreaterThan(1);
			for (const route of routes) {
				expect(route).not.toContain(" through ");
				linkedSections(item.skill, route);
			}
			const common = linkedSections(item.skill, routeLine(loader, "common:"));
			if (["imm-brainstorm", "imm-planner", "imm-loop"].includes(item.name)) {
				expect(common).toContain("Stage only explicit task-owned paths");
				expect(common).toContain("Never use `git add .` or `git add -A` in a dirty worktree");
				expect(common).toContain("Do not create, switch, or delete Git worktrees");
				expect(common).toContain("operate only in the Host launch directory");
			}
			expect(common).not.toMatch(/(?:load|read) (?:all|every) (?:reference|mode)/i);
		}
	});

	test("ordinary planning excludes page design, carrier publication, and recovery branches", () => {
		const path = join(SKILLS_DIR, "imm-planner/SKILL.md");
		const loader = read(path);
		const initial = linkedSections(path, routeLine(loader, "common:")) +
			linkedSections(path, routeLine(loader, "assess request:"));
		const preparation = linkedSections(path, routeLine(loader, "prepare candidates"));
		const validation = linkedSections(path, routeLine(loader, "validate candidates:"));
		const handoff = linkedSections(path, routeLine(loader, "handoff after validation:"));
		const ordinary = initial + preparation + validation + handoff;
		expect(initial).not.toContain("imm-kernel intent author");
		expect(initial).not.toContain("**Design-view selection**");
		expect(preparation).toContain("**Design-view selection**");
		expect(preparation).toContain("imm-kernel intent author");
		expect(validation).toContain("Deterministic QA owns descriptor execution");
		expect(handoff).toContain("Plan-only requests stop here");
		expect(initial + preparation + validation).not.toContain("current Host's native Enrollment Tool");
		expect(handoff).toContain("current Host's native Enrollment Tool");
		expect(loader.replace(/\s+/g, " ")).toContain("later stages retain earlier constraints");
		for (const unrelated of ["visible_actions", "State inventory", "imm-tracker publish-initiative"]) {
			expect(ordinary).not.toContain(unrelated);
		}
		expect(ordinary).toContain("imm-kernel intent author");
		expect(ordinary).not.toContain("read the named files and root orientation files first");
		expect(ordinary).toContain("Read the named files first");
		expect(ordinary).toContain("when a concrete missing fact requires them");
		const page = linkedSections(path, routeLine(loader, "`mode: page_design`"));
		expect(page).toContain("DESIGN.md");
		expect(page).toContain("Do not edit UI files, tests, Specs, Plans, or workflow state");
		expect(page).not.toContain("imm-kernel intent author");
		const revisionRoute = routeLine(loader, "revision of an enrolled intent");
		expect(revisionRoute).toContain("instead of standard planning:");
		const revision = linkedSections(path, routeLine(loader, "common:")) + linkedSections(path, revisionRoute);
		expect(revision).toContain("Planner prepares the complete proposed revision");
		expect(revision).toContain("Return the proposal to the current Loop owner");
		expect(revision).toContain("Preserve the prior on-disk sidecars");
		expect(revision).toContain("approve_breaking_intent_revision");
		expect(revision).toContain("the native Host gate is the single user decision");
		expect(revision).not.toContain("imm-kernel intent author");
		expect(revision).not.toContain("current Host's native Enrollment Tool");
	});

	test("clear framing skips opt-in interrogation and Loop recovery exposes native guards", () => {
		const brainPath = join(SKILLS_DIR, "imm-brainstorm/SKILL.md");
		const brain = read(brainPath);
		const normal = linkedSections(brainPath, routeLine(brain, "common:"));
		expect(normal).toContain("zero-question fast path");
		expect(normal).not.toContain("Seed the fixed framing roots");
		expect(normal).not.toContain("buildBrainstormEnsembleRequest");
		expect(linkedSections(brainPath, routeLine(brain, "explicit thorough interrogation:")))
			.toContain("Seed the fixed framing roots");
		const loopPath = join(SKILLS_DIR, "imm-loop/SKILL.md");
		const loop = read(loopPath);
		const steady = linkedSections(loopPath, routeLine(loop, "steady execution:"));
		expect(steady).not.toContain("For `settlement_unknown`");
		expect(steady).toContain("An unresolved decision pauses only dependent execution");
		expect(steady).toContain("invoke `request_authorization` directly before ending the turn");
		expect(steady).not.toContain("Stop on terminal `done` or `stopped`, unresolved user decisions");
		const recoveryRules = linkedSections(loopPath, routeLine(loop, "steady execution:"));
		expect(recoveryRules).toContain("local evidence never replaces Kernel-owned deterministic QA");
		expect(recoveryRules).toContain("Never reduce required checks merely because they fail");
		const repairPath = join(SKILLS_DIR, "imm-pr-fix/SKILL.md");
		const repairRules = linkedSections(repairPath, routeLine(read(repairPath), "confirmed blocker before editing:"));
		expect(repairRules).toContain("Never overwrite user data or stop an unrelated process");
		expect(repairRules).toContain("For each removal, identify the retired behavior or the remaining coverage");
		expect(normal).not.toContain("Temporary tests name their exit condition");
		const recovery = linkedSections(loopPath, routeLine(loop, "rework,"));
		expect(recovery).toContain("For `settlement_unknown`");
		expect(recovery).toContain("request_authorization");
		expect(recovery).toContain("fail-closed");
		expect(recovery).toContain("never replay the uncertain write");
	});

	test.each(["default", "roundtable", "adversarial", "exhaustive"])("%s framing inherits clarification, manifest, and handoff guards", (mode) => {
		const path = join(SKILLS_DIR, "imm-brainstorm/SKILL.md");
		const loader = read(path);
		const framing = linkedSections(path, routeLine(loader, "common:")) +
			(mode === "exhaustive" ? linkedSections(path, routeLine(loader, "explicit thorough interrogation:")) :
				mode === "default" ? "" : linkedSections(path, routeLine(loader, "optional research,")));
		expect(framing).toContain("zero-question fast path");
		expect(framing).toContain("Do not ask the user to reconfirm decisions reflected without change");
		expect(framing).toContain("Handoff Manifest");
		expect(framing).toContain("`BR-REQ-*`");
		expect(framing).toContain("If a decision delta is still unconfirmed");
		expect(framing).toContain("omit the handoff manifest");
		expect(framing).toContain("If gates pass: suggest `imm-planner`");
		if (mode !== "exhaustive") expect(framing).not.toContain("Seed the fixed framing roots");
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
			"imm-review-retro",
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
			["imm-agent-doc-maintain.md", "imm-brainstorm.md", "imm-doc-prune.md", "imm-loop.md", "imm-planner.md", "imm-pr-fix.md", "imm-review-retro.md"].sort(),
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
