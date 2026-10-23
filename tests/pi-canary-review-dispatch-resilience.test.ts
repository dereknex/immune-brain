import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import {
	reservedAgentParams,
	reservedAgentDescription,
} from "../plugins/immune-brain/.pi-extension/pi-canary-native-review.ts";
import { assertReviewArtifact, writeNativeReviewEvidence } from "../plugins/immune-brain/.pi-extension/pi-canary-review-bundle.ts";

import { TASK, ctx, makeAssuranceHarness, passVerdict, snapshot } from "./helpers/pi-canary-assurance-harness.ts";

describe("foreground Review dispatch resilience", () => {
	test.each(["drift", "unreserved", "missing-prompt", "missing-description"])("blocks %s without consuming the reservation", async (variant) => {
		const h = makeAssuranceHarness();
		const ready = await h.progression.advance(TASK, ctx);
		if (ready.state !== "review_ready") throw new Error("expected Review reservation");
		const params = ready.agent_params;
		const input = { ...params,
			...(variant === "drift" ? { prompt: `${params.prompt}!` } : {}),
			...(variant === "unreserved" ? { description: "unreserved" } : {}),
			...(variant === "missing-prompt" ? { prompt: undefined } : {}),
			...(variant === "missing-description" ? { description: undefined } : {}),
		};
		const blocked = h.progression.piReviewHost.observeReviewDispatch(input, "blocked-call");
		expect(blocked).toMatchObject({ block: true });
		expect(blocked?.reason).toContain(params.description);
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
		expect(h.progression.piReviewHost.observeReviewDispatch({ ...ready.agent_params, subagent_type: "Explore" }, "explore")).toBeUndefined();
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
		expect(await h.progression.submitMediated(TASK, ctx, undefined)).toMatchObject({ state: "blocked", reason: expect.stringContaining("more than once") });
	});
	test("Review params never request background execution", () => {
		const params = reservedAgentParams({
			taskId: "foreground-review-task",
			operationId: "operation-1",
			prompt: "review the immutable bundle",
			max_turns: 24,
		});
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
