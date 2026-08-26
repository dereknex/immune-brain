import { expect, test } from "bun:test";
import { matchesReservedAgentArgs, reservedAgentParams, parseForegroundAgentResult } from "../plugins/immune-brain/.pi-extension/pi-canary-native-review.ts";
import {
	TASK,
	ctx,
	makeAssuranceHarness,
	projection,
	resultText,
	snapshot,
} from "./helpers/pi-canary-assurance-harness.ts";

test("QA continuation hands one exact foreground Agent envelope to the Parent turn", () => {
	const params = reservedAgentParams({ taskId: "continuation-task", operationId: "operation-1", prompt: "review immutable bundle" });
	expect(params.run_in_background).toBe(false);
	expect(params.isolated).toBe(true);
	expect(params.isolation).toBe("worktree");
	expect(matchesReservedAgentArgs({ ...params, run_in_background: true }, params)).toBe(false);
});

test("native result parser accepts only Agent tool results", () => {
	const event = { toolName: "Agent", toolCallId: "call-1", details: { status: "completed", agentId: "reviewer" }, content: [{ type: "text", text: "{\"decision\":\"pass\"}" }] };
	expect(parseForegroundAgentResult(event, "call-1").result).toContain("decision");
	expect(() => parseForegroundAgentResult({ ...event, toolName: "Other" }, "call-1")).toThrow(/foreground Agent result/i);
});

test("AssuranceProgression binds one exact call id and ordered receipt", async () => {
	const h = makeAssuranceHarness();
	const ready = await h.progression.advance(TASK, ctx);
	const params = (ready as Extract<typeof ready, { state: "review_ready" }>).agent_params;

	expect(h.progression.observeToolCall({ toolName: "Agent", toolCallId: "call-1", input: params })).toBeUndefined();
	expect(h.progression.observeToolCall({ toolName: "Agent", toolCallId: "call-2", input: params })).toMatchObject({ block: true });
	h.progression.observeToolResult({ toolName: "Agent", toolCallId: "foreign", input: params, details: { status: "completed" }, content: [{ type: "text", text: resultText(snapshot("review")) }] });
	h.progression.observeToolEnd({ toolName: "Agent", toolCallId: "foreign", args: params });
	expect(await h.progression.submitReview(TASK, ctx)).toMatchObject({ state: "blocked", reason: "foreground Agent terminal event order is incomplete" });

	h.progression.observeToolResult({ toolName: "Agent", toolCallId: "call-1", input: params, details: { status: "completed", agentId: "reviewer" }, content: [{ type: "text", text: resultText(snapshot("review")) }] });
	h.progression.observeToolEnd({ toolName: "Agent", toolCallId: "call-1", args: params });
	expect(await h.progression.submitReview(TASK, ctx)).toEqual({ state: "completed" });
	expect(h.counts().applyCount).toBe(2);
});

test("inverted or repeated terminal events fail closed without Review authority writes", async () => {
	const h = makeAssuranceHarness();
	const ready = await h.progression.advance(TASK, ctx);
	const params = (ready as Extract<typeof ready, { state: "review_ready" }>).agent_params;

	h.progression.observeToolCall({ toolName: "Agent", toolCallId: "call-1", input: params });
	h.progression.observeToolEnd({ toolName: "Agent", toolCallId: "call-1", args: params });
	h.progression.observeToolResult({ toolName: "Agent", toolCallId: "call-1", input: params, details: { status: "completed" }, content: [{ type: "text", text: resultText(snapshot("review")) }] });
	expect(await h.progression.submitReview(TASK, ctx)).toMatchObject({ state: "blocked", reason: "foreground Agent terminal event arrived before its result" });
	expect(await h.progression.submitReview(TASK, ctx)).toMatchObject({ state: "blocked", reason: "foreground Agent terminal event arrived before its result" });
	expect(h.counts().applyCount).toBe(1);
});

test("snapshot drift discards the receipt without Review authority writes", async () => {
	let stale = false;
	let projectionReads = 0;
	const h = makeAssuranceHarness({ project: async () => {
		projectionReads += 1;
		const current = projection("active", projectionReads === 1 ? "run_qa" : "run_review");
		return stale ? { ...current, projection: { ...current.projection, record_revision: "record-new" } } as never : current;
	} });
	const ready = await h.progression.advance(TASK, ctx);
	const params = (ready as Extract<typeof ready, { state: "review_ready" }>).agent_params;
	h.progression.observeToolCall({ toolName: "Agent", toolCallId: "call-1", input: params });
	h.progression.observeToolResult({ toolName: "Agent", toolCallId: "call-1", input: params, details: { status: "completed" }, content: [{ type: "text", text: resultText(snapshot("review")) }] });
	h.progression.observeToolEnd({ toolName: "Agent", toolCallId: "call-1", args: params });

	stale = true;
	expect(await h.progression.submitReview(TASK, ctx)).toMatchObject({ state: "blocked", reason: "assurance snapshot changed before Review submission" });
	expect(h.counts()).toMatchObject({ applyCount: 1, removeCount: 1 });
});
