// The Initiative carrier gate is declared fail-closed by the Planner but is
// performed by the Loop. When the rule lived only in `imm-planner.md`, a denied
// `publish-initiative` batch was reported correctly and then a later `imm-run`
// entry enrolled anyway — a hard contract gate that was fail-open in practice.
//
// The Kernel cannot enforce this: the contract forbids storing Issue identity in
// TaskIntent or TaskRecord, so `enroll` has no Initiative association to check.
// The gate is therefore a document obligation, and both documents must carry it.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveGithubTerminalProjectionInput } from "../plugins/immune-brain/runtime/assurance/coordinator";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(REPO_ROOT, path), "utf-8");

const PLANNER = read("plugins/immune-brain/dist/imm-planner.md");
const LOOP = read("plugins/immune-brain/dist/imm-run.md");

describe("Initiative carrier Enrollment gate", () => {
	it("the Planner still declares the gate", () => {
		expect(PLANNER).toContain("tracker_associated");
		expect(PLANNER).toContain("tracker_projection_failed");
		expect(PLANNER).toContain("awaiting_user_initiative_confirmation");
	});

	it("the Loop carries the gate it actually performs", () => {
		// Enrollment happens in the Loop, so the Loop must name every blocking
		// carrier outcome by its exact contract token.
		for (const token of [
			"tracker_associated",
			"tracker_projection_failed",
			"awaiting_user_initiative_confirmation",
		]) {
			expect({ token, present: LOOP.includes(token) }).toEqual({ token, present: true });
		}
	});

	it("the Loop binds the gate to the first Enrollment of a candidate", () => {
		expect(LOOP).toContain("Before the first Enrollment of a candidate TaskIntent");
	});

	it("the Planner states the direct flow and drops the retired readback claims", () => {
		// The Planner contract is the canonical description of what the tracker
		// does, so it must carry the direct write flow and must not still promise a
		// complete-topology reread or a whole-publication deadline.
		expect(PLANNER).toContain("takes\nevery Issue number from its own create response");
		expect(PLANNER).toContain("Deduplication is start-only");
		expect(PLANNER).toContain("No repository listing, attachment,\ndependency or ownership confirmation follows a write");
		expect(PLANNER).not.toContain("rereads\nthe complete topology");
		expect(PLANNER).not.toContain("whole-operation deadline");
	});

	it("a later Loop entry does not clear a failed carrier batch", () => {
		expect(LOOP).toContain("a later `imm-run` entry does not\nclear it");
	});

	it("the pre-Enrollment gate stays distinct from post-settlement projection", () => {
		// `imm-run.md` also states a tracker failure is never a Loop blocker; that
		// clause is about the opted-in GitHub projection after settlement. Without
		// this separation the two rules read as contradictory.
		expect(LOOP).toContain("distinct from the post-settlement tracker");
		expect(LOOP).toContain("never use it as evidence, a Loop blocker");
	});

	it("standalone and Local candidates enroll without a tracker prerequisite", () => {
		expect(LOOP).toContain(
			"Standalone TaskIntents and Local\nInitiatives carry no tracker prerequisite",
		);
		expect(LOOP).toContain(
			"their Enrollment needs only the\nvalidated candidate",
		);
	});

	it("uncertain Initiative membership is resolved, not assumed", () => {
		expect(LOOP).toContain(
			"resolve it against the\nPlanner's carrier decision before treating the candidate as exempt",
		);
		expect(LOOP).toContain("do not\nassume either way");
	});

	it("a failed GitHub-carried batch still blocks Enrollment", () => {
		expect(LOOP).toContain(
			"For a GitHub-carried Initiative, `tracker_projection_failed` or\n`awaiting_user_initiative_confirmation` blocks that Enrollment until the same\ncomplete carrier batch succeeds",
		);
	});

	it("describes optional per-Task scenarios as public projection that never widens authority", () => {
		const section = PLANNER.slice(PLANNER.indexOf("### Initiative Carrier Preference"));
		expect(section).toContain("optional\n`scenarios` array");
		expect(section).toContain("`BR-SCN-<n>` or `SCN-<n>`");
		expect(section).toContain("`automated` maps to one or more");
		expect(section).toContain("`manual` requires `manual_reason`");
		expect(section).toContain("renders no\n`## User scenarios` section");
		expect(section).toContain("Scenarios never widen TaskIntent\nscope or authority");
		const tracker = read("docs/agents/issue-tracker.md");
		expect(tracker).toContain("optional `scenarios`");
		expect(tracker).toContain("never widen\nTaskIntent scope or authority");
		expect(tracker).toContain("Omitting it renders no section");
	});

	it("performs no GitHub projection at Enrollment and only projects a settled task", () => {
		// Enrollment is authority; the tracker is transport. The projection step is
		// reachable only from a settlement path, never from enrollment.
		const enrollmentSources = [
			"plugins/immune-brain/.pi-extension/imm-canary-enroll.ts",
			"plugins/immune-brain/runtime/claude/kernel_ports.ts",
		];
		for (const path of enrollmentSources) {
			const source = readFileSync(resolve(path), "utf8");
			// The whole enrollment extension for the Pi Host; for the Claude Host the
			// enroll method up to the next method, so a settlement path later in the
			// file is not read as part of enrollment.
			const start = source.indexOf("async enroll(");
			const body = start === -1 ? source : source.slice(start, source.indexOf("\n\tasync ", start + 1));
			expect({ path, projectsAtEnroll: /projectTerminalTrackerState|mark-terminal/.test(body) }).toEqual({
				path,
				projectsAtEnroll: false,
			});
		}
		// The shared step derives nothing without a tracker association: a repository
		// with no tracker answer simply reports not_tracked, which is what keeps the
		// projection opt-in rather than a required Enrollment prerequisite.
		expect(
			deriveGithubTerminalProjectionInput(
				"carrier-task",
				{ claim: null, projection: { lifecycle: "done" } } as never,
				{
					task_id: "carrier-task",
					lifecycle_status: "terminal",
					terminal_lifecycle: "done",
					terminal_event_id: "evt-carrier",
				} as never,
			)?.phase,
		).toBe("done");
	});

});
