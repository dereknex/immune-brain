// P3 U2: imm-planner Kernel TaskIntent contract. The Planner skill must teach
// deterministic routing from the host-neutral routing-status projection and
// must never write the TaskIntent artifact directly.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..");

const SKILL_PATH = join(
	REPO_ROOT,
	"plugins/immune-brain/skills/imm-planner/SKILL.md",
);
const DIST_PATH = join(
	REPO_ROOT,
	"plugins/immune-brain/dist/imm-planner.md",
);

describe("imm-planner kernel intent contract", () => {
	test("Skill teaches routing-status-first deterministic routing", () => {
		const skill = readFileSync(SKILL_PATH, "utf8");
		expect(skill).toContain("imm-plan --routing-status --json");
		expect(skill).toContain("kernel_task_intent");
		expect(skill).toContain("routing_policy_invalid");
		expect(skill).toContain("imm-loop");
		expect(skill).not.toContain("imm-canary-work");
		expect(skill).toContain("no Planner path enrolls a task");
	});

	test("Skill forbids direct artifact writes and names the canonical author command", () => {
		const skill = readFileSync(SKILL_PATH, "utf8");
		expect(skill).toContain("never writes");
		expect(skill).toContain("docs/plans/<task-id>.intent.json");
		expect(skill).toContain("imm-kernel intent author");
		expect(skill).toContain("--stdin --json");
		expect(skill).toContain("imm-kernel intent validate");
		expect(skill).toContain("revise_intent");
	});

	test("Planner enrollment authority stays Pi TUI-only", () => {
		const skill = readFileSync(SKILL_PATH, "utf8");
		expect(skill).toContain("/imm-canary-new");
		expect(skill).toContain("/imm-canary-enroll");
		expect(skill).toContain("literal-user-confirmed");
		expect(skill).toContain("Pi host identity is implicit");
		expect(skill).toContain("production boundary");
		expect(skill).not.toContain("Other hosts");
	});

	test("dist mirror carries the same contract", () => {
		const dist = readFileSync(DIST_PATH, "utf8");
		expect(dist).toContain("imm-plan --routing-status --json");
		expect(dist).toContain("imm-kernel intent author");
		expect(dist).toContain("/imm-canary-enroll");
		expect(dist).toContain("routing_policy_invalid");
	});
});
