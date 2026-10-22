// Pins ADR 0028 in the authoring sources consumed by Loop, Planner and Executor.
// Behavioral classification remains covered by kernel-intent-v2; generated
// mirrors are checked by dist-docs-sync-contract after the Parent regenerates.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = "plugins/immune-brain";
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8").replace(/\s+/g, " ");

describe("scope is an estimate in workflow source contracts (ADR 0028)", () => {
	it.each([
		`${PLUGIN}/dist/imm-run.md`,
		`${PLUGIN}/dist/imm-planner.md`,
		`${PLUGIN}/runtime/prompts/executor.md`,
	])("%s discloses delivery beyond the estimate and preserves frozen acceptance", (path) => {
		const source = read(path);
		expect(source).toContain("`scope_hint` is an estimate");
		expect(source).toContain("`beyond_estimate`");
		expect(source).toMatch(/scope-only revision.*keeps the bound Spec path.*compatible/);
		expect(source).toMatch(/[Ff]rozen acceptance/);
		expect(source).not.toContain("self-served (ADR 0021)");
		expect(source).not.toContain("same-directory addition: submit `revise_intent`");
	});

	it("batch revisions retain user authority without delegated approval or reseal", () => {
		const batch = read(`${PLUGIN}/dist/imm-run-batch.md`);
		expect(batch).toContain("acceptance changes pauses for the literal user's native gate");
		expect(batch).toContain("cannot approve revisions or reseal `plan_digest`");
		expect(batch).toContain("remain readable and retireable as historical evidence");
		expect(batch).not.toContain("confirmation offers one opt-in choice");
	});

	it("ADR 0028 is accepted and the superseded ADRs retain their historical decisions", () => {
		const adr = read("docs/adr/0028-scope-as-estimate.md");
		expect(adr).toContain("status: accepted");
		expect(adr).toContain("`beyond_estimate`");
		expect(adr).toContain("keeps the bound Spec path");
		for (const path of [
			"docs/adr/0018-delegated-in-lane-intent-revision.md",
			"docs/adr/0021-same-directory-scope-extension.md",
		]) {
			const historical = read(path);
			expect(historical).toContain("status: superseded by ADR-0028");
			expect(historical).toContain("0028-scope-as-estimate.md");
			expect(historical).toContain("## Decision");
			expect(historical).toContain("Accepted on");
		}
	});
});
