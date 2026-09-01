import { expect, test } from "bun:test";
import { reservedAgentParams } from "../plugins/immune-brain/.pi-extension/pi-canary-native-review.ts";
import {
	TASK,
	ctx,
	makeAssuranceHarness,
	passVerdict,
	projection,
	snapshot,
} from "./helpers/pi-canary-assurance-harness.ts";

test("QA continuation hands one foreground Review envelope to the Parent turn", () => {
	const params = reservedAgentParams({ taskId: "continuation-task", operationId: "operation-1", prompt: "review immutable bundle" });
	expect(params.run_in_background).toBe(false);
	expect(params.isolated).toBe(true);
	expect(params.isolation).toBe("worktree");
});

test("Parent submits a structured reviewer verdict without host event receipts", async () => {
	const h = makeAssuranceHarness();
	expect((await h.progression.advance(TASK, ctx)).state).toBe("review_ready");
	expect(await h.progression.submitReview(TASK, ctx, passVerdict(snapshot("review")))).toEqual({ state: "completed" });
	expect(h.counts().applyCount).toBe(2);
});

test("Parent-submitted rework verdict restores execution", async () => {
	const h = makeAssuranceHarness();
	expect((await h.progression.advance(TASK, ctx)).state).toBe("review_ready");
	const reviewSnapshot = snapshot("review");
	const verdict = {
		...passVerdict(reviewSnapshot),
		decision: "rework" as const,
		approval: undefined,
		findings: [{ id: "review-1", kind: "blocking" as const, acceptance_id: "A1", summary: "repair the regression" }],
	};
	expect(await h.progression.submitReview(TASK, ctx, verdict)).toMatchObject({ state: "rework", summary: "repair the regression" });
	expect(h.counts().applyCount).toBe(2);
});

test("malformed verdict can be corrected without rebuilding Review evidence", async () => {
	const h = makeAssuranceHarness();
	expect((await h.progression.advance(TASK, ctx)).state).toBe("review_ready");
	expect(await h.progression.submitReview(TASK, ctx, { decision: "pass" })).toMatchObject({ state: "blocked" });
	expect(h.progression.active(TASK)?.state).toBe("review_ready");
	expect(await h.progression.submitReview(TASK, ctx, passVerdict(snapshot("review")))).toEqual({ state: "completed" });
});

test("snapshot drift discards the verdict without Review authority writes", async () => {
	let stale = false;
	let projectionReads = 0;
	const h = makeAssuranceHarness({ project: async () => {
		projectionReads += 1;
		const current = projection("active", projectionReads === 1 ? "run_qa" : "run_review");
		return stale ? { ...current, projection: { ...current.projection, record_revision: "record-new" } } as never : current;
	} });
	expect((await h.progression.advance(TASK, ctx)).state).toBe("review_ready");
	stale = true;
	expect(await h.progression.submitReview(TASK, ctx, passVerdict(snapshot("review")))).toMatchObject({ state: "blocked", reason: "assurance snapshot changed before Review submission" });
	expect(h.counts()).toMatchObject({ applyCount: 1, removeCount: 1 });
});
