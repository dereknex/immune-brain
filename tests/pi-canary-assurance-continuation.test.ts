import { expect, test } from "bun:test";
import { matchesReservedAgentArgs, reservedAgentParams, parseForegroundAgentResult } from "../plugins/immune-brain/.pi-extension/pi-canary-native-review.ts";

test("QA continuation hands one exact foreground Agent envelope to the Parent turn", () => {
	const params = reservedAgentParams({ taskId: "continuation-task", operationId: "operation-1", prompt: "review immutable bundle" });
	expect(params.run_in_background).toBe(false);
	expect(params.isolated).toBe(true);
	expect(params.isolation).toBe("worktree");
	expect(matchesReservedAgentArgs({ ...params, run_in_background: true }, params)).toBe(false);
});

test("native terminal event is independent from result parsing and requires matching call id", () => {
	const event = { toolName: "Agent", toolCallId: "call-1", details: { status: "completed", agentId: "reviewer" }, content: [{ type: "text", text: "{\"decision\":\"pass\"}" }] };
	expect(parseForegroundAgentResult(event, "call-1").result).toContain("decision");
	const mismatched = { ...event, toolName: "Other" };
	expect(() => parseForegroundAgentResult(mismatched, "call-1")).toThrow(/foreground Agent result/i);
});
