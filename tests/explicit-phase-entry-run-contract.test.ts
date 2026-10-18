// Explicit phase entry, Slice S1 (EPE-S1-A2, ADR 0019): native Enrollment is
// the first step of a single-task imm-run entry, and the Pi Enrollment tool
// guidance agrees.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PLUGIN = join(ROOT, "plugins", "immune-brain");
const flat = (path: string): string => readFileSync(path, "utf8").replace(/\s+/g, " ");

describe("explicit phase entry: imm-run owns Enrollment", () => {
	test("imm-run contract makes Enrollment the single-task first step when no claim is active", () => {
		const run = readFileSync(join(PLUGIN, "dist/imm-run.md"), "utf8");
		const start = run.indexOf("\n## Kernel Canary Routing and Authority\n");
		const end = run.indexOf("\n## Execution Loop\n");
		expect(start).toBeGreaterThanOrEqual(0);
		expect(end).toBeGreaterThan(start);
		const entry = run.slice(start, end).replace(/\s+/g, " ");
		expect(entry).toContain("Enrollment is the first step of a single-task explicit `imm-run` entry and belongs to no other Skill");
		expect(entry).toContain("For a Parent Issue, route to");
		expect(entry).toContain("A Child entry verifies prerequisite settlement and integration");
		expect(entry).toContain("When the entry finds no active claim, resolve the validated candidate");
		expect(entry).toContain("native Enrollment gate once, without chat pre-confirmation");
		expect(entry).toContain("Planner and Brainstorm never open that gate");
		expect(entry).toContain("exactly one same-Host recovery action");
	});

	// Spec host-owned-environment D8, D9, D11.
	test("imm-run contract states that Enrollment claims listed scope changes and status stays readable", () => {
		const run = readFileSync(join(PLUGIN, "dist/imm-run.md"), "utf8");
		const entry = run
			.slice(run.indexOf("\n## Kernel Canary Routing and Authority\n"), run.indexOf("\n## Execution Loop\n"))
			.replace(/\s+/g, " ");
		expect(entry).toContain("The Enrollment gate lists every in-scope path that is already staged, modified or untracked");
		expect(entry).toContain("Confirming the gate claims exactly the listed paths as task work");
		expect(entry).toContain("no clean scope is required");
		expect(entry).toContain("An in-scope path that changed after the gate text was built was not shown, so it refuses the Enrollment");
		expect(entry).toContain("Changes outside the scope stay the user's and are never claimed");
		expect(entry).toContain("`status` is a read, not a freeze");
		expect(entry).toContain("returns them as a `warnings` entry beside the projection");
		expect(entry).toContain("Freezing a snapshot still refuses those paths");
		expect(entry).toContain("skip-worktree or assume-unchanged index flag still refuses both");
	});

	// Spec run-entry-decision-hosting D9, D10; ADR 0025.
	test("imm-run contract states the run-entry retry rules, the kept gates and the remaining user stops", () => {
		const run = readFileSync(join(PLUGIN, "dist/imm-run.md"), "utf8");
		const decisions = run.slice(run.indexOf("\n## Decisions and Recovery\n"), run.indexOf("\n## Review and Learning\n")).replace(/\s+/g, " ");
		expect(decisions).toContain("The literal-user `imm-run` entry needs no chat confirmation; Enrollment and unattended batch start each keep one native gate");
		expect(decisions).toContain("only a side-effect-free rejection is retried, at most twice, and preflight is rerun before each retry");
		expect(decisions).toContain("`plan_changed`, `head_moved` and a claim conflict are never retried");
		expect(decisions).toContain("apply it, commit the fixed files alone in one commit even under `Git integration: manual`, list that commit in the manifest, then retry");
		expect(decisions).toContain("Push, PR, credentials, breaking intent revision and rework exits still stop for the user");
	});

	test("imm-run loader selects Parent batch or isolated single-task Enrollment", () => {
		const loader = flat(join(PLUGIN, "skills/imm-run/SKILL.md"));
		expect(loader).toContain("With no active claim, a standalone validated candidate opens native Enrollment once");
		expect(loader).toContain("A Parent Issue selects its whole planned batch");
		expect(loader).toContain("A Child Issue selects only its TaskIntent");
	});

	test("Pi Enrollment tool guidance binds the call to an imm-run entry", () => {
		const source = readFileSync(join(PLUGIN, ".pi-extension/imm-canary-enroll.ts"), "utf8");
		const guidelines = source.slice(source.indexOf("promptGuidelines: ["));
		expect(guidelines).toContain("only as the first step of an explicit imm-run entry, never from imm-planner or imm-brainstorm");
		expect(source).not.toContain("after natural-language routing selects Enrollment");
		expect(source).not.toContain("natural-language routing selects");
	});

	test("ADR 0019 records the decision", () => {
		const path = join(ROOT, "docs/adr/0019-explicit-run-entry-owns-enrollment.md");
		expect(existsSync(path)).toBe(true);
		const adr = flat(path);
		expect(adr).toContain("status: accepted");
		expect(adr).toContain("Enrollment is the first step of an explicit `imm-run` entry");
		expect(adr).toContain("They never invoke the native Enrollment gate");
	});
});
