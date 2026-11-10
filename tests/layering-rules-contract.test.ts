import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DIST_DOC_ENTRIES } from "../scripts/dist-sync-manifest.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REFERENCE = "docs/reference/layering-rules.md";
const ANTIGRAVITY = "plugins/immune-brain-antigravity";
const PLUGIN = "plugins/immune-brain";

function read(path: string): string {
	return readFileSync(resolve(ROOT, path), "utf8");
}

/** Text from `start` up to the next occurrence of `end` after it. */
function between(text: string, start: string, end: string): string {
	const from = text.indexOf(start);
	expect(from).toBeGreaterThanOrEqual(0);
	const to = text.indexOf(end, from + start.length);
	return to === -1 ? text.slice(from) : text.slice(from, to);
}

/**
 * Relative markdown links in `text` whose target file does not exist under
 * `baseDir`. http(s) URLs and same-file `#anchor` links are not resolved.
 */
function brokenRelativeLinks(text: string, baseDir: string): string[] {
	const broken: string[] = [];
	for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
		const target = match[1] ?? "";
		if (/^https?:\/\//.test(target) || target.startsWith("#")) continue;
		const file = target.split("#")[0] ?? "";
		if (file && !existsSync(resolve(baseDir, file))) broken.push(target);
	}
	return broken;
}

describe("layering reference", () => {
	const reference = read(REFERENCE);

	it("states the four norms, execution order and enforcement", () => {
		for (const heading of ["Dependency Rule", "Port Slicing", "Mapping Convergence", "Module Documentation", "Execution Order", "Enforcement"]) {
			expect(reference).toContain(`## ${heading}`);
		}
		expect(between(reference, "## Module Documentation", "\n## ")).toContain("without a Verification command is incomplete");
		expect(between(reference, "## Enforcement", "\n## ")).toContain("tests/runtime-layering-boundary.test.ts");
	});

	it("names the #414 ratchet baseline without pinning an edge count", () => {
		const enforcement = between(reference, "## Enforcement", "\n## ");
		expect(enforcement).toContain("tests/runtime-layering-boundary.test.ts");
		expect(enforcement).toContain("#414");
		// The observed baseline has three edges; a count in the prose drifts from it.
		expect(reference).not.toMatch(/\b(?:one|two|three|four|five|six)-edge\b/);
		expect(reference).not.toContain("kernel_ports.ts:115");
		expect(reference).not.toContain("#413");
	});

	it("names the host-neutral adapter core and records it in an ADR", () => {
		// The packaged copy cannot resolve a relative ADR link, so the reference
		// points at the ADR the way the other shipped documents do: its repository path.
		const rule = between(reference, "## Dependency Rule", "\n## ");
		expect(rule).toContain("plugins/immune-brain/runtime/host-core/");
		expect(rule).toContain("docs/adr/0038-host-neutral-adapter-core.md");
		expect(brokenRelativeLinks(rule, resolve(ROOT, "docs/reference"))).toEqual([]);
		const adr = read("docs/adr/0038-host-neutral-adapter-core.md");
		expect(adr).toContain("runtime/host-core");
		expect(adr).toMatch(/^Status: accepted/m);
		expect(brokenRelativeLinks(adr, resolve(ROOT, "docs/adr"))).toEqual([]);
	});

	it("keeps the packaged copies byte-equal and in the mirror manifest", () => {
		expect(read(`${PLUGIN}/dist/docs/reference/layering-rules.md`)).toBe(reference);
		expect(read(`${ANTIGRAVITY}/dist/docs/reference/layering-rules.md`)).toBe(reference);
		expect(DIST_DOC_ENTRIES).toContainEqual({ rel: "reference/layering-rules.md", mode: "mirror" });
	});

	it("resolves relative links and reports a missing target", () => {
		const base = resolve(ROOT, "docs/adr");
		const text = "[ok](0004-dual-host-assurance-adapters.md) [gone](no-such-file.md) [url](https://example.com/x.md) [anchor](#here)";
		expect(brokenRelativeLinks(text, base)).toEqual(["no-such-file.md"]);
	});
});

describe("layering planner contract", () => {
	const planner = read(`${PLUGIN}/dist/draw-up.md`);

	it("tells the Planner to slice, state direction, record an ADR and converge mapping", () => {
		const rules = between(planner, "## Planning Rules", "\n## ");
		const bullet = between(rules, "- **Layering rules**", "\n- **");
		for (const term of [REFERENCE, "Port method group", "dependency direction", "ADR", "projection", "seams before state machines before packaging"]) {
			expect(bullet).toContain(term);
		}
	});

	it("requires a done-looks-like beside the seam without defecting older candidates", () => {
		const paragraph = between(planner, "Agreed seam recording", "\n- **");
		const after = paragraph.slice(paragraph.indexOf("follows Enrolled Intent Revision."));
		expect(after).toContain("done-looks-like");
		expect(after).toContain("`Then` must be observable at");
		expect(after).toContain("writing that mapping is");
		expect(after).toContain("mandatory");
		expect(after).toContain("carry no defect");
	});

	it("names the layering red flags and keeps descriptor discipline unchanged", () => {
		const flags = between(planner, "## Red Flags", "\n## ");
		for (const flag of ["cross-adapter import", "forked or inherited adapter machinery", "new layer without an ADR", "Mapping in more than one place"]) {
			expect(flags).toContain(flag);
		}
		expect(between(planner, "### Verification Descriptor Discipline", "\n## ")).not.toContain("done-looks-like");
		expect(read(`${ANTIGRAVITY}/dist/draw-up.md`)).toBe(planner);
	});
});

describe("layering executor contract", () => {
	const prompt = read(`${PLUGIN}/runtime/prompts/executor.md`);

	it("carries a Layering Rules section directly after the Code Quality Guard", () => {
		expect(prompt).toContain("## Code Quality Guard");
		const headings = [...prompt.matchAll(/^## .+$/gm)].map(m => m[0]);
		const guard = headings.indexOf("## Code Quality Guard");
		expect(headings[guard + 1]).toBe("## Layering Rules");
		const section = prompt.slice(prompt.indexOf("## Layering Rules")).replace(/\s+/g, " ");
		for (const term of [
			"seam first, state machine second, packaging last",
			"composition and neutral modules, never inheritance",
			"Adapters neither import nor extend each other",
			REFERENCE,
		]) {
			expect(section).toContain(term);
		}
	});

	it("points the drive Execution Loop at the reference without restating it", () => {
		const drive = read(`${PLUGIN}/dist/drive.md`);
		expect(between(drive, "## Execution Loop", "\n## ")).toContain(REFERENCE);
		expect(drive).not.toContain("never inheritance");
		for (const role of ["qa", "ui-review"]) {
			expect(read(`${PLUGIN}/runtime/prompts/${role}.md`)).not.toContain("Layering Rules");
		}
	});

	it("keeps every packaged copy byte-equal to its source", () => {
		const copies: Array<[string, string]> = [
			[`${PLUGIN}/dist/role-prompts/executor.md`, `${PLUGIN}/runtime/prompts/executor.md`],
			[`${ANTIGRAVITY}/dist/role-prompts/executor.md`, `${PLUGIN}/runtime/prompts/executor.md`],
			[`${ANTIGRAVITY}/runtime/prompts/executor.md`, `${PLUGIN}/runtime/prompts/executor.md`],
			[`${ANTIGRAVITY}/dist/drive.md`, `${PLUGIN}/dist/drive.md`],
		];
		for (const [copy, source] of copies) expect(read(copy)).toBe(read(source));
	});
});

describe("layering doctrine", () => {
	const adr = read("docs/adr/0035-layering-doctrine.md");
	const adr0004 = read("docs/adr/0004-dual-host-assurance-adapters.md");
	const amendment = between(adr0004, "## Amendment: Layering doctrine", "\n## ");

	it("records the norms in an accepted ADR linked to the reference and ADR 0004", () => {
		expect(adr).toMatch(/^Status: accepted/m);
		for (const norm of ["Dependency Rule", "Port slicing", "mapping convergence", "module documentation"]) {
			expect(adr.toLowerCase()).toContain(norm.toLowerCase());
		}
		expect(adr).toContain("](../reference/layering-rules.md)");
		expect(adr).toContain("](0004-dual-host-assurance-adapters.md)");
		expect(amendment).toContain("](0035-layering-doctrine.md)");
	});

	it("resolves every relative link in ADR 0035 and the ADR 0004 amendment", () => {
		const base = resolve(ROOT, "docs/adr");
		expect(brokenRelativeLinks(adr, base)).toEqual([]);
		expect(brokenRelativeLinks(amendment, base)).toEqual([]);
	});

	it("navigates from CONTEXT.md and the skills guide instead of restating the rule", () => {
		const context = read("CONTEXT.md");
		expect(context).toContain("docs/reference/layering-rules.md");
		expect(context).not.toContain("without a Verification command is incomplete");
		expect(read("docs/reference/immune-brain-skills-guide.md")).toContain("docs/reference/layering-rules.md");
	});

	it("names no neutral-core path before it is planned", () => {
		for (const text of [adr, read(REFERENCE)]) {
			expect(text).not.toContain("runtime/core");
			expect(text).not.toContain("runtime/neutral");
		}
	});
});
