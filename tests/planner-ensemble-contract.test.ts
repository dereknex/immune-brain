import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
	return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

describe("planner ensemble contract", () => {
	it("keeps planner ensemble authority in the packaged contract without local model config", () => {
		const content = read("plugins/immune-brain/dist/imm-planner.md");
		expect(content).toContain("planner ensemble");
		expect(content).not.toContain("workflow_models.planner_ensemble");
		expect(content).toContain("advisory-only");
		expect(content).toContain("final Spec and Plan");
		expect(content).toContain("Agreement becomes evidence");
		expect(content).toContain("Disagreement becomes decision criteria");
		expect(content).toContain("strong-model blockers");
	});

	it("keeps Brainstorm ensemble authority in the packaged contract without local model config", () => {
		const source = read("plugins/immune-brain/skills/imm-brainstorm/SKILL.md");
		expect(source).toContain("brainstorm_ensemble");
		expect(source).toContain("does not transfer framing authority");
		expect(source).not.toContain("workflow_models.brainstorm_ensemble");

		const content = read("plugins/immune-brain/dist/imm-brainstorm.md");
		expect(content).toContain("Brainstorm ensemble");
		expect(content).not.toContain("workflow_models.brainstorm_ensemble");
		expect(content).toContain("advisory-only");
		expect(content).toContain(
			"Final Spec and Plan authority stays with `imm-planner`",
		);
		expect(content).toContain(
			"Pi's adapter may consume `brainstorm_ensemble` dispatch JSON",
		);
		expect(content).not.toContain("Pi host adapters");
		expect(content).toContain("does not transfer framing authority");
		expect(content).toContain("mutate state, or own final Spec/Plan authority");
		expect(content).toContain("Agreement becomes framing evidence");
		expect(content).toContain("Disagreement becomes decision criteria");
		expect(content).toContain("strong-model blockers");

		const packaged = content;
		expect(packaged).toContain("one foreground Agent at a time");
		expect(packaged).toContain("direct result");
		expect(packaged).toContain("remaining dispatch budget");
		expect(packaged).not.toContain("Pi itself may launch those subagents");
		expect(packaged).not.toContain("poll background work");
		expect(packaged).toContain(
			"Enrollment validates descriptor structure without executing acceptance descriptors",
		);
		expect(packaged).not.toContain("descriptor rehearsal is reordered");
	});
});
