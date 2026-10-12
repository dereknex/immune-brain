// Explicit phase entry, Slice S1 (EPE-S1-A1, ADR 0019): the Planner and
// Brainstorm contracts stop after candidate validation in every packaged copy
// and never route to the native Enrollment gate.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN = join(import.meta.dir, "..", "plugins", "immune-brain");
const read = (rel: string): string => readFileSync(join(PLUGIN, rel), "utf8");
const flat = (rel: string): string => read(rel).replace(/\s+/g, " ");

const BASELINE_COPIES = ["BASELINE.md", "skills/BASELINE.md", "dist/BASELINE.md"];
const PLANNER_COPIES = ["dist/imm-planner.md", "skills/imm-planner/SKILL.md"];
const BRAINSTORM_COPIES = ["dist/imm-brainstorm.md", "skills/imm-brainstorm/SKILL.md"];
const ALL_COPIES = [...BASELINE_COPIES, ...PLANNER_COPIES, ...BRAINSTORM_COPIES];

// Wording of the retired route: a Planner or Brainstorm request reaching the
// native Enrollment gate on its own.
const RETIRED_ROUTE = [
	"without a second human stop",
	"execution-bearing requests open the native gate directly",
	"Planner may request the native Enrollment gate",
	"owns planning and the later native Enrollment gate",
	"non-authoritative execution trigger",
	"clear mutation request that already includes execution",
	"Requests that include execution invoke",
	"For a request that includes execution, invoke the native Enrollment gate",
	"invoke the current Host's native Enrollment Tool directly",
];

function section(text: string, heading: string): string {
	const start = text.indexOf(`\n${heading}\n`);
	expect(start).toBeGreaterThanOrEqual(0);
	const rest = text.slice(start + heading.length + 2);
	const end = rest.search(/\n## /);
	return (end < 0 ? rest : rest.slice(0, end)).replace(/\s+/g, " ");
}

describe("explicit phase entry: Planner and Brainstorm never route to Enrollment", () => {
	test("no contract copy keeps the retired direct-Enrollment route", () => {
		for (const rel of ALL_COPIES) {
			const text = flat(rel);
			for (const phrase of RETIRED_ROUTE) {
				expect({ rel, phrase, present: text.includes(phrase) }).toEqual({ rel, phrase, present: false });
			}
		}
	});

	test("Planner Next Action reports the candidate and names imm-run as the only next step", () => {
		const next = section(read("dist/imm-planner.md"), "## Next Action");
		expect(next).toContain("name a literal-user `imm-run` entry as the only next step");
		expect(next).toContain("Do not invoke the current Host's native Enrollment Tool");
		expect(next).toContain("a confirmation of the plan is not that entry");
		expect(next).toContain("Plan-only requests stop here");
	});

	test("Planner routing, Initiative publication and Boundary all stop before Enrollment", () => {
		const planner = read("dist/imm-planner.md");
		const routing = section(planner, "## Managed Request Routing");
		expect(routing).toContain("explicit Planner entry owns planning only");
		expect(routing).toContain("never invokes the native Enrollment gate");
		expect(routing).toContain("including a request that also asks for execution");
		expect(routing).toContain("is not an `imm-run` entry and opens no gate");
		const all = planner.replace(/\s+/g, " ");
		expect(all).toContain("Report that recommendation and stop; the user enrolls the recommended first TaskIntent through a literal-user `imm-run` entry");
		expect(all).toContain("Execution starts only from a literal-user `imm-run` entry, whose first step is native Enrollment");
	});

	test("Planner loader states the same stop", () => {
		const loader = flat("skills/imm-planner/SKILL.md");
		expect(loader).toContain("The Planner never invokes the current Host's native Enrollment gate, even when the request also asks for execution");
		expect(loader).toContain("name a literal-user `imm-run` entry as the only next step");
		expect(loader).toContain("Plan-only requests stop there too");
	});

	test("Brainstorm hands off to a user-launched Planner and never enrolls", () => {
		const dist = flat("dist/imm-brainstorm.md");
		expect(dist).toContain("Neither Brainstorm nor the Planner invokes Enrollment");
		expect(dist).toContain("Brainstorm never enters `imm-planner` or `imm-run` on its own and never invokes Enrollment");
		const loader = flat("skills/imm-brainstorm/SKILL.md");
		expect(loader).toContain("Brainstorm stops after framing; the user launches `imm-planner`");
	});

	test("every BASELINE copy assigns routine Enrollment to imm-run and keeps the Plan-only stop", () => {
		for (const rel of BASELINE_COPIES) {
			const text = flat(rel);
			expect(text).toContain("Routine Managed enrollment is the first step of an explicit `imm-run` entry");
			expect(text).toContain("Planner and Brainstorm stop with candidate artifacts and never invoke Enrollment");
			expect(text).toContain("explicit Plan-only requests stop the same way");
			expect(text).toContain("Once the user has entered `imm-run`");
		}
	});
});
