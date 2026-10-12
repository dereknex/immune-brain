// Pins the same-directory scope rule (ADR 0021) in the contract text a Loop
// owner, a Planner and an Executor actually read. Behavior is covered by
// kernel-intent-v2, scope-revision-envelope and the coordinator tests; this
// file only guards that the stated rule and its mirror cannot drift apart.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = "plugins/immune-brain";
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8").replace(/\s+/g, " ");

describe("same-directory scope rule is stated where it is applied (ADR 0021)", () => {
	it("Loop contract lets the owner submit the addition and names the exclusions", () => {
		const run = read(`${PLUGIN}/dist/imm-run.md`);
		expect(run).toContain("a same-directory addition");
		expect(run).toContain("`revise_intent`");
		expect(run).toContain("`docs/specs` or `docs/plans`");
		expect(run).toContain("self-served (ADR 0021)");
		expect(run).toContain("Scope expansion returns to Planner's Enrolled Intent Revision route");
	});

	it("Planner contract defaults to the module directory and declines the addition as a request", () => {
		const planner = read(`${PLUGIN}/dist/imm-planner.md`);
		expect(planner).toContain("smallest coherent module directory");
		expect(planner).toContain("same-directory addition the Loop owner submits itself");
		expect(planner).toContain("A same-directory file addition is not a Planner request");
	});

	it("Executor prompt and its packaged mirror state the same rule", () => {
		const source = read(`${PLUGIN}/runtime/prompts/executor.md`);
		const mirror = read(`${PLUGIN}/dist/role-prompts/executor.md`);
		expect(source).toContain("same-directory addition");
		expect(source).toContain("`revise_intent`");
		expect(mirror).toBe(source);
	});

	it("ADR 0021 records the rule and its relation to ADR 0018", () => {
		const adr = read("docs/adr/0021-same-directory-scope-extension.md");
		expect(adr).toContain("status: accepted");
		expect(adr).toContain("## Relation to ADR 0018");
		expect(adr).toContain("`classifyIntentRevision`");
		expect(adr).toContain("`RISK_FLOOR_SCOPE_PREFIXES`");
	});
});
