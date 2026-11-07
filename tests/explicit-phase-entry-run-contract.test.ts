// Explicit phase entry, Slice S1 (EPE-S1-A2, ADR 0019): a literal drive entry owns
// the native gate. Spec drive-always-lanes S6 moves a new single-task entry to the
// Lane path; the Pi Enrollment tool guidance still agrees for in-place records.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PLUGIN = join(ROOT, "plugins", "immune-brain");
const flat = (path: string): string => readFileSync(path, "utf8").replace(/\s+/g, " ");

describe("explicit phase entry: drive owns Enrollment", () => {
	// Spec drive-always-lanes D10, S6-A1.
	test("drive contract routes every new single-task entry to the Lane path as its first step", () => {
		const run = readFileSync(join(PLUGIN, "dist/drive.md"), "utf8");
		const start = run.indexOf("\n## Kernel Canary Routing and Authority\n");
		const end = run.indexOf("\n## Execution Loop\n");
		expect(start).toBeGreaterThanOrEqual(0);
		expect(end).toBeGreaterThan(start);
		const entry = run.slice(start, end).replace(/\s+/g, " ");
		expect(entry).toContain("Every new single-task `drive` entry goes through the single-task Lane path");
		expect(entry).toContain("including a GitHub Initiative Child entry");
		expect(entry).toContain("Its first step is `start_unattended_batch` with `task_id`");
		expect(entry).toContain("The Parent neither enrolls the task itself nor implements it in its own conversation");
		expect(entry).toContain("The Executor role runs inside the Lane process, never in the Parent conversation");
		expect(entry).toContain("For a Parent Issue, route to");
		expect(entry).toContain("A Child entry verifies prerequisite settlement and integration");
		expect(entry).toContain("Planner and Brainstorm never open that gate");
		expect(entry).toContain("exactly one same-Host recovery action");
		// The retired new-entry instruction must not return.
		expect(entry).not.toContain("Enrollment is the first step of a single-task explicit `drive` entry");
		expect(entry).not.toContain("native Enrollment gate once");
		expect(entry).not.toContain("then enroll again");
	});

	test("drive contract keeps in-place records resumable and the Child entry tracker prerequisite", () => {
		const run = readFileSync(join(PLUGIN, "dist/drive.md"), "utf8");
		const entry = run
			.slice(run.indexOf("\n## Kernel Canary Routing and Authority\n"), run.indexOf("\n## Execution Loop\n"))
			.replace(/\s+/g, " ");
		expect(entry).toContain("A TaskRecord enrolled in place before this change stays resumable until terminal");
		expect(entry).toContain("a new entry never starts one");
		expect(entry).toContain("refused with `workspace_not_clean: <paths>` before the gate opened");
		expect(entry).toContain("The Lane path starts at the user's HEAD and does not require a clean checkout");
		expect(entry).toContain("Before the first Enrollment of a candidate TaskIntent, confirm the Planner returned `tracker_associated`");
		expect(entry).toContain("this check runs before `start_unattended_batch` with `task_id` (Child entry included)");
		expect(entry).toContain("A batch child keeps its Lane's confirmed scope disclosure");
		expect(entry).toContain("`status` is a read, not a freeze");
		expect(entry).toContain("returns them as a `warnings` entry beside the projection");
		expect(entry).toContain("Freezing a snapshot still refuses those paths");
		expect(entry).toContain("skip-worktree or assume-unchanged index flag still refuses both");
	});

	// Spec run-entry-decision-hosting D9, D10; ADR 0025.
	test("drive contract states the run-entry retry rules, the kept gates and the remaining user stops", () => {
		const run = readFileSync(join(PLUGIN, "dist/drive.md"), "utf8");
		const decisions = run.slice(run.indexOf("\n## Decisions and Recovery\n"), run.indexOf("\n## Review and Learning\n")).replace(/\s+/g, " ");
		expect(decisions).toContain("The literal-user `drive` entry needs no chat confirmation; the single-task Lane entry and unattended batch start each keep one native gate");
		expect(decisions).toContain("only a side-effect-free rejection is retried, at most twice, and preflight is rerun before each retry");
		expect(decisions).toContain("`plan_changed`, `head_moved` and a claim conflict are never retried");
		expect(decisions).toContain("apply it, commit the fixed files alone in one commit even under `Git integration: manual`, list that commit in the manifest, then retry");
		expect(decisions).toContain("Push, PR, credentials, breaking intent revision and rework exits still stop for the user");
	});

	test("drive loader selects Parent batch or the single-task Lane", () => {
		const loader = flat(join(PLUGIN, "skills/drive/SKILL.md"));
		expect(loader).toContain("a standalone validated candidate enters the single-task Lane through `start_unattended_batch` with `task_id`");
		expect(loader).not.toContain("opens native Enrollment once");
		expect(loader).not.toContain("opens single-task Enrollment");
		expect(loader).toContain("A Parent Issue selects its whole planned batch");
		expect(loader).toContain("A Child Issue selects only its TaskIntent");
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
