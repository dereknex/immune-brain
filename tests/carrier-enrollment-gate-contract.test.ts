// The Initiative carrier gate is declared fail-closed by the Planner but is
// performed by the Loop. When the rule lived only in `imm-planner.md`, a denied
// `publish-initiative` batch was reported correctly and then a later `imm-loop`
// entry enrolled anyway — a hard contract gate that was fail-open in practice.
//
// The Kernel cannot enforce this: the contract forbids storing Issue identity in
// TaskIntent or TaskRecord, so `enroll` has no Initiative association to check.
// The gate is therefore a document obligation, and both documents must carry it.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(REPO_ROOT, path), "utf-8");

const PLANNER = read("plugins/immune-brain/dist/imm-planner.md");
const LOOP = read("plugins/immune-brain/dist/imm-loop.md");

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

	it("a later Loop entry does not clear a failed carrier batch", () => {
		expect(LOOP).toContain("a later `imm-loop` entry does not\nclear it");
	});

	it("the pre-Enrollment gate stays distinct from post-settlement projection", () => {
		// `imm-loop.md` also states a tracker failure is never a Loop blocker; that
		// clause is about the opted-in GitHub projection after settlement. Without
		// this separation the two rules read as contradictory.
		expect(LOOP).toContain("distinct from the post-settlement tracker");
		expect(LOOP).toContain("never use it as evidence, a Loop blocker");
	});
});
