// A Kernel precondition rejection is a deterministic failure, not an unknown
// settlement.
//
// Observed on 2026-09-05: `freeze_artifacts` was refused with "artifact freeze
// requires one scope-bound active Spec" and the coordinator reported
// `settlement_unknown`, because the failure arrived after the mutation was
// in flight. `imm-loop` treats that state as "call advance_assurance once to
// reconcile", so the Loop reissued the same call and got the same refusal. The
// rejection writes nothing, and the record revision proves it.

import { expect, test } from "bun:test";
import {
	TASK,
	ctx,
	makeAssuranceHarness,
} from "./helpers/pi-canary-assurance-harness.ts";

const REJECTION = "artifact freeze requires one scope-bound active Spec";

function freezeRejectingHarness() {
	let freezeAttempts = 0;
	const h = makeAssuranceHarness({
		phase: "working",
		applyOrdinaryOperation: async (_ctx, input) => {
			// The Kernel validates before it writes, so state is untouched.
			if (input.operation.op === "freeze_artifacts") {
				freezeAttempts += 1;
				throw new Error(REJECTION);
			}
		},
	});
	return { h, attempts: () => freezeAttempts };
}

test("a rejected freeze is reported as a deterministic failure, not settlement_unknown", async () => {
	const { h } = freezeRejectingHarness();
	const result = await h.progression.advance(TASK, ctx);
	expect(result.state).toBe("failed");
	expect((result as { reason: string }).reason).toContain(REJECTION);
});

test("the rejection reason survives into the failure the Loop reads", async () => {
	const { h } = freezeRejectingHarness();
	const result = await h.progression.advance(TASK, ctx);
	// The Loop needs the Kernel's own words to pick a next action; a bare
	// "settlement unknown" gives it nothing to act on.
	expect(result).toMatchObject({ state: "failed", operation: "qa" });
	expect((result as { reason: string }).reason).toContain("freezing_artifacts");
});

test("a repeated advance re-attempts the freeze instead of reconciling a phantom write", async () => {
	const { h, attempts } = freezeRejectingHarness();
	expect((await h.progression.advance(TASK, ctx)).state).toBe("failed");
	expect((await h.progression.advance(TASK, ctx)).state).toBe("failed");
	expect(attempts()).toBe(2);
});

test("an unprovable freeze outcome still reports settlement_unknown", async () => {
	// When the proving read itself fails, the conservative classification stands.
	const h = makeAssuranceHarness({
		phase: "working",
		applyOrdinaryOperation: async (_ctx, input) => {
			if (input.operation.op === "freeze_artifacts") throw new Error("freeze response lost");
		},
	});
	const project = h.ports.projectTask;
	let reads = 0;
	h.ports.projectTask = async (...args) => {
		reads += 1;
		if (reads > 1) throw new Error("authority read unavailable");
		return project(...args);
	};
	expect((await h.progression.advance(TASK, ctx)).state).toBe("settlement_unknown");
});

test("a freeze that did commit is never downgraded to a deterministic failure", async () => {
	// The write landed and the reply was lost: the revision moves, so the outcome
	// stays unknown and the Loop reconciles rather than re-freezing.
	let frozen = false;
	const h = makeAssuranceHarness({
		phase: "working",
		applyOrdinaryOperation: async (_ctx, input) => {
			if (input.operation.op === "freeze_artifacts") {
				frozen = true;
				throw new Error("freeze response lost");
			}
		},
	});
	const project = h.ports.projectTask;
	h.ports.projectTask = async (...args) => {
		const result = await project(...args);
		if (!frozen) return result;
		return {
			...result,
			projection: { ...result.projection, record_revision: "record-2" },
		} as typeof result;
	};
	expect((await h.progression.advance(TASK, ctx)).state).toBe("settlement_unknown");
});
