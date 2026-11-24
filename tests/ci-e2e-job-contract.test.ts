// CI runs the L1 Host journeys as their own job beside `verify` and enforces the e2e escape
// rule on pull requests (Spec e2e-release-gate D8, D9, S8-AC1).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
type Step = { name?: string; run?: string; uses?: string };
type Job = { "timeout-minutes"?: number; needs?: string | string[]; if?: string; steps: Step[] };
const workflow = Bun.YAML.parse(readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
	on: { pull_request?: { types?: string[] } };
	jobs: Record<string, Job>;
};
const runs = (job: Job): string[] => job.steps.flatMap((step) => (step.run ? [step.run] : []));

describe("ci.yml e2e job", () => {
	test("e2e runs bun run e2e within 10 minutes beside verify", () => {
		const { e2e, verify } = workflow.jobs;
		expect(verify).toBeDefined();
		expect(e2e).toBeDefined();
		expect(e2e["timeout-minutes"]).toBe(10);
		expect(runs(e2e).map((run) => run.trim())).toContain("bun run e2e");
		// Parallel with verify: neither job waits on the other.
		expect(e2e.needs).toBeUndefined();
		expect(verify.needs).toBeUndefined();
	});

	test("e2e installs both Hosts at the versions pinned in tests/e2e/hosts.json before the journeys", () => {
		const steps = workflow.jobs.e2e.steps;
		const install = steps.findIndex((step) => step.run?.includes("tests/e2e/hosts.json") && step.run.includes("npm install"));
		const journeys = steps.findIndex((step) => step.run?.trim() === "bun run e2e");
		expect(install).toBeGreaterThanOrEqual(0);
		expect(install).toBeLessThan(journeys);
		const installRun = steps[install].run as string;
		expect(installRun).toContain("@anthropic-ai/claude-code@");
		expect(installRun).toContain("@earendil-works/pi-coding-agent@");
		expect(installRun).toContain(".claude.pinned");
		expect(installRun).toContain(".claude.minimum");
		expect(installRun).toContain("E2E_CLAUDE_MIN_BIN");
		expect(installRun).toContain(".pi.pinned");
	});

	test("verify keeps excluding the journeys: the default suite never collects tests/e2e", () => {
		expect(runs(workflow.jobs.verify).some((run) => run.includes("bun test"))).toBe(true);
		expect(readFileSync(resolve(ROOT, "bunfig.toml"), "utf8")).toContain('pathIgnorePatterns = ["tests/e2e/**"]');
	});
});

describe("ci.yml escape rule job", () => {
	test("pull requests run the escape rule script with the full history it diffs", () => {
		const job = workflow.jobs["e2e-escape-rule"];
		expect(job).toBeDefined();
		expect(job.if).toBe("github.event_name == 'pull_request'");
		expect(runs(job).map((run) => run.trim())).toContain("bun scripts/check-e2e-escape-rule.ts");
		const checkout = job.steps.find((step) => step.uses?.startsWith("actions/checkout@")) as { with?: { "fetch-depth"?: number } } | undefined;
		expect(checkout?.with?.["fetch-depth"]).toBe(0);
	});

	test("editing a pull request title or body re-runs CI so an added e2e-exempt line takes effect", () => {
		expect(workflow.on.pull_request?.types).toContain("edited");
	});
});
