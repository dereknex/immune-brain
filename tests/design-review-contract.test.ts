import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildRoleDelegationPacket, INTERNAL_ROLE_PROMPTS } from "../plugins/immune-brain/runtime/role_prompt_bridge.ts";

const ROOT = resolve(import.meta.dir, "..");
const PLUGIN = "plugins/immune-brain";

const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");
/** Whitespace-folded text, so a rule wrapped across lines still matches. */
const flat = (path: string): string => read(path).replace(/\s+/g, " ");

const CONTRACT = `${PLUGIN}/dist/design-review.md`;
const UX = "docs/reference/ux-heuristic-checklist.md";
const REVIEW_CHECKLIST = "docs/reference/design-contract-review-checklist.md";
const AUDIT_RUBRIC = "docs/reference/design-contract-audit-rubric.md";
const UI_PROMPT = `${PLUGIN}/runtime/prompts/ui-review.md`;
/** The single-read ceiling a project DESIGN.md must stay under. */
const READ_BUDGET_BYTES = 46_080;

/** The body under one heading, up to the next heading of the same or higher level. */
function section(path: string, heading: string): string {
	const lines = read(path).split("\n");
	const start = lines.findIndex((line) => /^#{1,6} /.test(line) && line.replace(/^#+ /, "") === heading);
	expect(start, `${path}: ${heading}`).toBeGreaterThanOrEqual(0);
	const level = lines[start]!.match(/^#+/)![0].length;
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) => new RegExp(`^#{1,${level}} `).test(line));
	return rest.slice(0, end === -1 ? undefined : end).join(" ").replace(/\s+/g, " ");
}

function expectAll(text: string, fragments: string[]): void {
	for (const fragment of fragments) expect(text).toContain(fragment);
}

describe("design-review L1: contract, budget and hygiene", () => {
	test("the review checklist ranks DESIGN.md first and covers implementation hygiene", () => {
		expectAll(section(REVIEW_CHECKLIST, "1. Contract Resolution"), [
			"highest-priority visual and interaction contract",
		]);
		expectAll(section(REVIEW_CHECKLIST, "4. Implementation Hygiene and Token Convergence"), [
			"40 KB",
			"46,080 B",
			"duplicated Tailwind class strings and constants",
			"adjacent pages",
			"semantic tokens",
			"raw hex",
			"OKLCH",
			"legacy classes",
			"dead i18n keys",
			"stale frontend package names",
			"AGENTS.md",
		]);
	});

	test("the audit rubric adds the context budget and visual purity dimension", () => {
		expectAll(section(AUDIT_RUBRIC, "12. Context Budget and Visual Purity"), [
			"40 KB",
			"46,080 B",
			"observer",
			"cursor-merge",
			"sessionStorage",
		]);
		expect(section(AUDIT_RUBRIC, "Severity")).toContain("Budget/purity drift");
	});

	test("every packaged design reference stays inside the single-read budget it enforces", () => {
		for (const path of [UX, REVIEW_CHECKLIST, AUDIT_RUBRIC, CONTRACT]) {
			expect(Buffer.byteLength(read(path)), path).toBeLessThan(READ_BUDGET_BYTES);
		}
	});
});

describe("design-review L2: CRAP, Gestalt and page composition", () => {
	test("pairs CRAP with all eight Gestalt principles", () => {
		expectAll(section(UX, "2. CRAP and Gestalt Principles"), [
			"Contrast",
			"Repetition",
			"Alignment",
			"Proximity",
			"Similarity",
			"Continuation",
			"Closure",
			"Figure/Ground",
			"Symmetry",
			"Common Region",
			"Common Fate",
		]);
	});

	test("states the four whole-page and empty-state composition rules with the optical exemption", () => {
		expectAll(section(REVIEW_CHECKLIST, "3. Whole-Page Composition and State Co-location"), [
			"unified visual axis",
			"single `1px` border grammar",
			"`2px`",
			"border-dashed",
			"parent `gap-*`",
			"`mt-*`",
			"`mb-*`",
			"`<= 6px`",
			"co-locate",
			"conversion",
			"accent fills",
		]);
	});
});

describe("design-review L3: Laws of UX", () => {
	test("gives each of the six laws a measurable check", () => {
		const laws = section(UX, "3. Laws of UX");
		expectAll(laws, [
			"Fitts",
			"`>= 44x44px`",
			"`>= 24x24px`",
			"destructive",
			"Hick",
			"at most `1` secondary",
			"progressive disclosure",
			"Miller",
			"`<= 4`",
			"`<= 7`",
			"Jakob",
			"`Enter`",
			"`Escape`",
			"Tesler",
			"auto-trim",
			"smart defaults",
			"Peak-End",
			"completion feedback",
		]);
	});
});

describe("design-review L4: heuristics, states, copy, motion and accessibility", () => {
	test("groups all ten Nielsen heuristics and calibrates them by surface mode", () => {
		expectAll(section(UX, "1. Nielsen Heuristics by Intent"), [
			"Perception and Feedback",
			"Control and Error Prevention",
			"Cognitive Load Reduction",
			"Efficiency and Fallbacks",
			"Visibility of System Status",
			"Match Between System and the Real World",
			"User Control and Freedom",
			"Consistency and Standards",
			"Error Prevention",
			"Recognition Rather than Recall",
			"Flexibility and Efficiency of Use",
			"Aesthetic and Minimalist Design",
			"Help Users Recognize, Diagnose, and Recover from Errors",
			"Help and Documentation",
		]);
		expectAll(section(UX, "Surface-Mode Calibration"), ["Operate", "Read", "Persuade", "Experience", "n/a", "denominator"]);
	});

	test("requires the eight-state matrix, three-part error copy, restorable truncation and honest content", () => {
		const states = section(UX, "4. Interactive State Matrix and Content");
		expectAll(states, [
			"`default`",
			"`hover`",
			"`:focus-visible`",
			"`:active`",
			"`disabled`",
			"`loading`",
			"`aria-busy`",
			"`error`",
			"`success`",
			"what happened",
			"why",
			"recovery action",
			"ellipsis",
			"line-clamp",
			"invented metrics",
			"testimonials",
			"browser",
			"phone chrome",
			"RTL",
		]);
		expect(read(UX)).toContain("i18n-review-checklist.md");
	});

	test("bounds motion and states WCAG 2.1 AA obligations", () => {
		expectAll(section(UX, "5. Motion"), [
			"high-frequency",
			"keyboard",
			"`<= 300ms`",
			"`ease-out`",
			"`transform`",
			"`opacity`",
			"prefers-reduced-motion",
			"(hover: hover) and (pointer: fine)",
		]);
		expectAll(section(UX, "6. Accessibility"), ["WCAG 2.1 AA", "4.5:1", "user-scalable=no", "200%", "320px"]);
	});
});

describe("design-review orchestration contract", () => {
	test("is read-only and treats reviewed material as untrusted data", () => {
		const boundary = section(CONTRACT, "Boundary");
		expectAll(boundary, [
			"read-only",
			"untrusted",
			"Never create or mutate TaskIntent, TaskRecord, `.imm/state/kernel.sqlite`",
			"Never generate a fallback `DESIGN.md`",
			"Never impose a default SaaS style",
			"Never send telemetry",
			"greenfield",
		]);
	});

	test("accepts four input modalities and reports unrendered checks honestly", () => {
		const invocation = section(CONTRACT, "Invocation and Input Modalities");
		expectAll(invocation, ["code or diff", "screenshot or mock", "live URL or DevTools", "`DESIGN.md`", "`--solo`", "`--deep`"]);
		expect(invocation).toContain("Unverified (no rendered surface)");
		expect(section(CONTRACT, "Report Format")).toContain("Unverified (no rendered surface)");
	});

	test("gates on scale and records a Method header", () => {
		const recon = section(CONTRACT, "Parent Recon and Scale Gate");
		expectAll(recon, [
			"Operate",
			"Persuade",
			"40 KB",
			"46,080 B",
			"`<= 2` UI files",
			"whole-page",
			"`>= 3`",
			"multimodal",
			"`--deep`",
			"`--solo`",
			"Contract Audit Mode",
			"Method: solo (cost_scope_mismatch)",
			"Method: solo (user_solo)",
		]);
	});

	test("dispatches at most two orthogonal read-only lenses with their own checklist slices", () => {
		const lenses = section(CONTRACT, "Adaptive Orthogonal Subagent Lenses");
		expectAll(lenses, [
			"composition-and-ux",
			"contract-and-hygiene",
			"at most 2",
			"read-only",
			"Method: dual-lens",
			"Method: solo (<reason>)",
			"inherit_context: false",
			"sequential",
			"subagent-dispatch-protocol.md",
		]);
		expectAll(section(CONTRACT, "Composition and UX Lens"), ["CRAP", "Gestalt", "Laws of UX", "design-contract-review-checklist.md", "ux-heuristic-checklist.md"]);
		expectAll(section(CONTRACT, "Contract and Hygiene Lens"), ["DESIGN.md", "dead i18n", "i18n-review-checklist.md", "design-contract-review-checklist.md"]);
		expect(section(CONTRACT, "Contract Audit Mode")).toContain("design-contract-audit-rubric.md");
	});

	test("synthesizes by root cause with hard escalation triggers and the minimal-fix ladder", () => {
		const synthesis = section(CONTRACT, "Escalation Triggers and Minimal-Fix Ladder");
		expectAll(synthesis, [
			"root cause",
			"accessible name",
			"focus ring",
			"keyboard",
			"`320px`",
			"`200%`",
			"contrast",
			"color-only",
			"motion-only",
			"destructive",
			"truncation",
			"raw error",
			"prefers-reduced-motion",
		]);
		expect(synthesis).toMatch(/1\. Delete.*2\. Use the platform.*3\. Reuse a project token.*4\. Correct the value.*5\. Add/);
		expectAll(section(CONTRACT, "Report Format"), ["Method:", "file:line", "principle ID", "Before -> After"]);
	});

	test("names no outbound report or telemetry endpoint and no write step", () => {
		for (const path of [CONTRACT, `${PLUGIN}/skills/design-review/SKILL.md`]) {
			expect(read(path), path).not.toMatch(/https?:\/\//);
			expect(read(path), path).not.toMatch(/imm-kernel|imm_kernel|submit_review|submit_assurance/);
		}
	});

	test("relative reference links in the contract and its loaders resolve to a file and heading inside dist", () => {
		const slug = (heading: string): string =>
			heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");
		const anchors = (file: string): Set<string> =>
			new Set(readFileSync(file, "utf8").split("\n").filter((line) => /^#{1,6} /.test(line)).map((line) => slug(line.replace(/^#+ /, ""))));
		for (const host of [PLUGIN, "plugins/immune-brain-antigravity"]) {
			const dist = resolve(ROOT, host, "dist");
			for (const source of [`${host}/dist/design-review.md`, `${host}/skills/design-review/SKILL.md`]) {
				const base = resolve(ROOT, source, "..");
				const links = [...read(source).matchAll(/\]\(([^)\s#]+)(?:#([^)\s]*))?\)/g)];
				expect(links.length, source).toBeGreaterThan(0);
				for (const [, target, anchor] of links) {
					const file = resolve(base, target!);
					expect(file.startsWith(dist), `${source} -> ${target}`).toBe(true);
					expect(existsSync(file), `${source} -> ${target}`).toBe(true);
					if (anchor) expect(anchors(file).has(anchor), `${source} -> ${target}#${anchor}`).toBe(true);
				}
			}
		}
	});
});

describe("internal ui-review alignment", () => {
	test("routes to the same shared references while keeping the gate schema", () => {
		const prompt = flat(UI_PROMPT);
		expectAll(prompt, [
			"dist/docs/reference/design-contract-review-checklist.md",
			"dist/docs/reference/ux-heuristic-checklist.md",
			"dist/docs/reference/design-contract-audit-rubric.md",
			"dist/docs/reference/i18n-review-checklist.md",
			"on demand",
			"imm-ui-review",
			"`decision`",
			"`evidence_ref`",
			"`findings`",
			"`review_gate`",
			"`changed_files_signature`",
			"Do not generate a fallback `DESIGN.md`",
		]);
		expect(prompt).not.toMatch(/Layering Rules|Code Quality Guard/);
		expect(read(`${PLUGIN}/dist/role-prompts/ui-review.md`)).toBe(read(UI_PROMPT));
	});

	test("the published tool-policy table matches the runtime role spec", () => {
		const policy = INTERNAL_ROLE_PROMPTS["ui-review"].tool_policy;
		expect(policy).toBe("read-only tools");
		expect(buildRoleDelegationPacket({ role: "ui-review", context: { review_gate: "imm-ui-review" } }).prompt)
			.toContain(`tool_policy: ${policy}`);
		const referenceLine = buildRoleDelegationPacket({ role: "ui-review", context: { task_id: "t" } }).prompt
			.split("\n").find((line) => line.startsWith("shared reference directory: "));
		expect(referenceLine).toBeDefined();
		expect(existsSync(resolve(referenceLine!.slice("shared reference directory: ".length), "ux-heuristic-checklist.md"))).toBe(true);
		expect(read("docs/reference/workflow-and-subagents.md"))
			.toContain(`| \`ui-review\` | \`imm-ui-review\` | advisory | ${policy} |`);
	});
});
