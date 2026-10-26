import { writeTestReviewPacket } from "./helpers/review-packet-fixture";
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import {
	reservedAgentParams,
	reservedAgentDescription,
} from "../plugins/immune-brain/.pi-extension/pi-canary-native-review.ts";
import { assertReviewArtifact, writeNativeReviewEvidence } from "../plugins/immune-brain/.pi-extension/pi-canary-review-bundle.ts";

import { TASK, ctx, makeAssuranceHarness, passVerdict, snapshot } from "./helpers/pi-canary-assurance-harness.ts";

describe("foreground Review dispatch resilience", () => {
	test.each([
		["subagent_type", "general-purpose"], ["prompt", "drift"],
		["run_in_background", undefined], ["run_in_background", true],
		["isolated", undefined], ["isolated", false],
		["max_turns", 999], ["inherit_context", true],
	] as const)("blocks differing %s=%s without consuming the reservation", async (field, value) => {
		const h = makeAssuranceHarness();
		const ready = await h.progression.advance(TASK, ctx);
		if (ready.state !== "review_ready") throw new Error("expected Review reservation");
		const params = ready.agent_params;
		const input = { ...params, [field]: field === "prompt" ? `${params.prompt}!` : value };
		const blocked = h.progression.piReviewHost.observeReviewDispatch(input, "blocked-call");
		expect(blocked).toMatchObject({ block: true });
		expect(blocked?.reason).toContain(field);
		expect(blocked?.reason).toContain("reserved prompt verbatim");
		h.progression.piReviewHost.observeReviewResult("blocked-call", JSON.stringify(passVerdict(snapshot("review"))));
		expect(h.progression.piReviewHost.inspectReview(TASK)).toMatchObject({ ok: false, reason: expect.stringContaining("not observed") });
		expect(h.progression.piReviewHost.observeReviewDispatch(params, "valid-call")).toBeUndefined();
		h.progression.piReviewHost.observeReviewResult("valid-call", JSON.stringify(passVerdict(snapshot("review"))));
		expect(await h.progression.submitMediated(TASK, ctx, undefined)).toEqual({ state: "completed" });
	});

	test("does not block non-Review calls or Review calls without a reservation", async () => {
		const h = makeAssuranceHarness();
		expect(h.progression.piReviewHost.observeReviewDispatch({ subagent_type: "Review" }, "no-reservation")).toBeUndefined();
		const ready = await h.progression.advance(TASK, ctx);
		if (ready.state !== "review_ready") throw new Error("expected Review reservation");
		expect(h.progression.piReviewHost.observeReviewDispatch({ subagent_type: "general-purpose", prompt: "unrelated" }, "explore")).toBeUndefined();
		expect(h.progression.piReviewHost.observeReviewDispatch({ subagent_type: "Review", prompt: "no marker" }, "missing-marker")).toMatchObject({ block: true });
		expect(h.progression.piReviewHost.inspectReview(TASK)).toMatchObject({ ok: false, reason: expect.stringContaining("not observed") });
		expect(h.progression.piReviewHost.observeReviewDispatch(ready.agent_params, "valid")).toBeUndefined();
	});

	test("blocks a second dispatch after binding", async () => {
		const h = makeAssuranceHarness();
		const ready = await h.progression.advance(TASK, ctx);
		if (ready.state !== "review_ready") throw new Error("expected Review reservation");
		expect(h.progression.piReviewHost.observeReviewDispatch(ready.agent_params, "first")).toBeUndefined();
		expect(h.progression.piReviewHost.observeReviewDispatch(ready.agent_params, "second")).toEqual({ block: true, reason: "the reserved reviewer was dispatched more than once" });
		h.progression.piReviewHost.observeReviewResult("second", JSON.stringify(passVerdict(snapshot("review"))));
		expect(h.progression.piReviewHost.inspectReview(TASK)).toMatchObject({ ok: false, release: false });
		h.progression.piReviewHost.observeReviewResult("first", JSON.stringify(passVerdict(snapshot("review"))));
		expect(await h.progression.submitMediated(TASK, ctx, undefined)).toEqual({ state: "completed" });
	});
	test("description is not binding, inherit_context may be absent, and every differing field is named", async () => {
		const h = makeAssuranceHarness();
		const ready = await h.progression.advance(TASK, ctx);
		if (ready.state !== "review_ready") throw new Error("expected Review reservation");
		const blocked = h.progression.piReviewHost.observeReviewDispatch({ ...ready.agent_params, subagent_type: "general-purpose", isolated: false, max_turns: 999 }, "blocked");
		for (const field of ["subagent_type", "isolated", "max_turns"]) expect(blocked?.reason).toContain(field);
		expect(h.progression.piReviewHost.observeReviewDispatch({ ...ready.agent_params, description: "different", inherit_context: undefined }, "valid")).toBeUndefined();
	});

	test("unknown and released operation markers require fresh assurance", async () => {
		const h = makeAssuranceHarness();
		const unknown = reservedAgentParams({ taskId: TASK, operationId: "unknown", writePacket: writeTestReviewPacket, prompt: "review" });
		expect(h.progression.piReviewHost.observeReviewDispatch(unknown, "unknown")).toMatchObject({ block: true, reason: expect.stringContaining("advance_assurance") });
		const ready = await h.progression.advance(TASK, ctx);
		if (ready.state !== "review_ready") throw new Error("expected Review reservation");
		h.progression.piReviewHost.observeReviewDispatch({ ...ready.agent_params, isolated: false }, "blocked");
		const result = await h.progression.submitMediated(TASK, ctx, undefined);
		expect(result).toMatchObject({ state: "blocked", recovery_action: expect.stringContaining("Call advance_assurance") });
		expect(h.progression.piReviewHost.observeReviewDispatch(ready.agent_params, "released")).toMatchObject({ block: true, reason: expect.stringContaining("advance_assurance") });
		const next = await h.progression.advance(TASK, ctx);
		if (next.state !== "review_ready") throw new Error("expected fresh Review reservation");
		expect(next.operation_id).not.toBe(ready.operation_id);
		expect(next.agent_params.max_turns).toBe(ready.agent_params.max_turns);
	});

	test("Review params never request background execution", () => {
		const params = reservedAgentParams({
			writePacket: writeTestReviewPacket,
			taskId: "foreground-review-task",
			operationId: "operation-1",
			prompt: "review the immutable bundle",
			max_turns: 24,
		});
		expect(params.prompt.startsWith("<!-- immune-brain:operation_id=operation-1 task_id=foreground-review-task -->\n")).toBe(true);
		expect(params.run_in_background).toBe(false);
		expect(params.max_turns).toBe(24);
		expect(params.description).toBe(reservedAgentDescription("foreground-review-task", "operation-1"));
	});

	test("review evidence remains owned until explicit cleanup", () => {
		const evidence = writeNativeReviewEvidence({ hello: "world", n: 42 });
		try {
			expect(existsSync(evidence.path)).toBe(true);
			expect(() => assertReviewArtifact(evidence.path)).not.toThrow();
			expect(JSON.parse(readFileSync(evidence.path, "utf8")).hello).toBe("world");
		} finally {
			evidence.remove();
		}
		expect(existsSync(evidence.path)).toBe(false);
		expect(() => assertReviewArtifact(evidence.path)).toThrow();
	});
});
