// The Initiative carrier gate is declared fail-closed by the Planner but is
// performed by the Loop. When the rule lived only in `draw-up.md`, a denied
// `publish-initiative` batch was reported correctly and then a later `drive`
// entry enrolled anyway — a hard contract gate that was fail-open in practice.
//
// The Kernel cannot enforce this: the contract forbids storing Issue identity in
// TaskIntent or TaskRecord, so `enroll` has no Initiative association to check.
// The gate is therefore a document obligation, and both documents must carry it.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveGithubTerminalProjectionInput } from "../plugins/immune-brain/runtime/assurance/coordinator";

const REPO_ROOT = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(REPO_ROOT, path), "utf-8");

const PLANNER = read("plugins/immune-brain/dist/draw-up.md");
const LOOP = read("plugins/immune-brain/dist/drive.md");

describe("Initiative carrier Enrollment gate", () => {
	it("resolves carrier in request, layered configuration, user directive, ask order", () => {
		const section = PLANNER.slice(PLANNER.indexOf("### Initiative Carrier Preference"), PLANNER.indexOf("Once decomposition is complete"));
		const request = section.indexOf("1. a literal user instruction");
		const config = section.indexOf("2. `imm-kernel config --json`");
		const user = section.indexOf("3. the deprecated");
		const ask = section.indexOf("4. ask the user");
		expect(request).toBeGreaterThanOrEqual(0);
		expect(config).toBeGreaterThan(request);
		expect(user).toBeGreaterThan(config);
		expect(ask).toBeGreaterThan(user);
		expect(section).toContain("`initiative_carrier.value`");
		expect(section).toContain("`source`");
		expect(section).toContain("Host's user-level agent instruction file");
		expect(section).toContain("Report an invalid `initiative_carrier` configuration value and ask");
		expect(section).not.toContain("in the repository root agent instruction file");
		// Issue #370: a legacy repository directive is used with its deprecation warning, not skipped.
		expect(section.slice(config, user)).toContain("`legacy:<path>`");
		expect(section.slice(config, user)).toContain("`deprecated_config_source` warning");
		expect(section.replace(/\s+/g, " ")).not.toContain("ignore a `legacy:AGENTS.md`");
		const invalid = section.indexOf("Report an invalid `initiative_carrier` configuration value");
		const sourceLine = section.indexOf("display one non-blocking line");
		expect(sourceLine).toBeGreaterThan(ask);
		expect(invalid).toBeGreaterThan(sourceLine);
		const rule = section.slice(ask, invalid).replace(/\s+/g, " ");
		expect(rule).toContain("Once steps 1–3 select a carrier, display one non-blocking line with the selected carrier and its source as visible reply text before any question about decomposition, the Initiative, or the carrier destination");
		expect(rule).toContain("For a `legacy:<path>` source, the same output must show the `deprecated_config_source` warning naming the replacement layer, key, and file");
		expect(rule).toContain("A carrier named only in reasoning or inside a question does not satisfy this rule");
		expect(section.match(/non-blocking line/g)).toHaveLength(1);
	});
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
		expect(LOOP).toContain("a later `drive` entry does not\nclear it");
	});

	it("the pre-Enrollment gate stays distinct from post-settlement projection", () => {
		// `drive.md` also states a tracker failure is never a Loop blocker; that
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
		// Since Spec drive-always-lanes S7 the Lane Enrollment is the only Enrollment;
		// its Kernel port is the whole enrollment extension.
		const path = "plugins/immune-brain/runtime/unattended/batch_kernel_port.ts";
		const body = readFileSync(resolve(path), "utf8");
		expect({ path, projectsAtEnroll: /projectTerminalTrackerState|mark-terminal/.test(body) }).toEqual({
			path,
			projectsAtEnroll: false,
		});
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
