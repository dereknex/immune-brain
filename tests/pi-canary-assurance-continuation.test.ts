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

test("initial transient read retries once and reports the retry without repeating QA", async () => {
	const h = makeAssuranceHarness();
	const original = h.ports.projectTask;
	let reads = 0;
	h.ports.projectTask = async (...args) => {
		if (++reads === 1) throw Object.assign(new Error("interrupted"), { code: "EINTR" });
		return original(...args);
	};
	const updates: Record<string, unknown>[] = [];
	expect((await h.progression.advance(TASK, ctx, undefined, (update) => updates.push(update.details))).state).toBe("review_ready");
	expect(updates.filter((update) => update.stage === "retrying_projection")).toHaveLength(1);
	expect(h.counts().applyCount).toBe(1);
});

for (const [code, attempts] of [["EAGAIN", 2], ["EACCES", 1]] as const) {
	test(`initial ${code} read failure stops after ${attempts} attempts`, async () => {
		let reads = 0;
		const h = makeAssuranceHarness({ project: async () => {
			reads++;
			throw Object.assign(new Error("read failed"), { code });
		} });
		expect((await h.progression.advance(TASK, ctx)).state).toBe("failed");
		expect(reads).toBe(attempts);
		expect(h.counts().applyCount).toBe(0);
	});
}

test("host cancellation prevents the retry read", async () => {
	const controller = new AbortController();
	let reads = 0;
	const h = makeAssuranceHarness({ project: async () => {
		reads++;
		controller.abort();
		throw Object.assign(new Error("interrupted"), { code: "EINTR" });
	} });
	expect((await h.progression.advance(TASK, ctx, controller.signal)).state).toBe("cancelled");
	expect(reads).toBe(1);
	expect(h.counts().applyCount).toBe(0);
});

test("terminal settlement ambiguity reconciles without a second completion write", async () => {
	const h = makeAssuranceHarness({ risk: "routine" });
	const apply = h.ports.applyOrdinaryOperation;
	let completions = 0;
	h.ports.applyOrdinaryOperation = async (...args) => {
		await apply(...args);
		if (args[1].operation.op === "complete") {
			completions++;
			throw new Error("completion response lost");
		}
	};
	expect((await h.progression.advance(TASK, ctx)).state).toBe("settlement_unknown");
	expect(await h.progression.advance(TASK, ctx)).toEqual({ state: "completed" });
	expect(completions).toBe(1);
	expect(h.counts().applyCount).toBe(1);
});

test("semantic projection errors are not retried", async () => {
	let reads = 0;
	const h = makeAssuranceHarness({ project: async () => {
		reads++;
		return { ...projection(), error: "authority conflict" };
	} });
	expect(await h.progression.advance(TASK, ctx)).toMatchObject({ state: "blocked", reason: "authority conflict" });
	expect(reads).toBe(1);
	expect(h.counts().applyCount).toBe(0);
});

test("QA continuation hands one foreground Review envelope to the Parent turn", () => {
	const params = reservedAgentParams({ taskId: "continuation-task", operationId: "operation-1", prompt: "review immutable bundle" });
	expect(params.run_in_background).toBe(false);
	expect(params.isolated).toBe(true);
	expect(params.isolation).toBe("off");
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
