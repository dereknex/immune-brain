import { expect, test } from "bun:test";
import {
	matchesReservedAgentArgs,
	parseForegroundAgentResult,
	promptDigest,
	reservedAgentParams,
	semanticNeighborhoodReviewPrompt,
} from "../plugins/immune-brain/.pi-extension/pi-canary-native-review.ts";

const params = reservedAgentParams({
	taskId: "task-12345678",
	operationId: "op-12345678",
	prompt: "review the immutable bundle",
});

test("reserved native review parameters are foreground-only and deterministic", () => {
	expect(params).toMatchObject({
		subagent_type: "general-purpose",
		inherit_context: false,
		isolated: true,
		isolation: "worktree",
		run_in_background: false,
		max_turns: 16,
		model: "",
		resume: "",
		schedule: "",
		thinking: "",
	});
	expect(params.prompt).toContain("immutable bundle");
	expect(params.description).toContain("12345678");
	expect(promptDigest(params.prompt)).toMatch(/^sha256:[0-9a-f]{64}$/);
});

test("exact Agent args are required", () => {
	expect(matchesReservedAgentArgs(params, params)).toBe(true);
	expect(matchesReservedAgentArgs({ ...params, run_in_background: true }, params)).toBe(false);
	expect(matchesReservedAgentArgs({ ...params, max_turns: 12 }, params)).toBe(false);
	expect(matchesReservedAgentArgs({ ...params, prompt: `${params.prompt}!` }, params)).toBe(false);
	expect(matchesReservedAgentArgs({ ...params, model: "other" }, params)).toBe(false);
	expect(matchesReservedAgentArgs({ ...params, resume: "agent-1" }, params)).toBe(false);
	expect(matchesReservedAgentArgs({ ...params, schedule: "+1m" }, params)).toBe(false);
	expect(matchesReservedAgentArgs({ ...params, thinking: "high" }, params)).toBe(false);
	expect(matchesReservedAgentArgs({ ...params, extra: true }, params)).toBe(false);
	expect(matchesReservedAgentArgs({ subagent_type: params.subagent_type }, params)).toBe(false);
	const modeled = { ...params, model: "review-model" };
	expect(matchesReservedAgentArgs(modeled, modeled)).toBe(true);
	expect(matchesReservedAgentArgs({ ...modeled, model: "other" }, modeled)).toBe(false);
});

test("foreground tool_result is the only result parser input", () => {
	const parsed = parseForegroundAgentResult({
		toolName: "Agent",
		toolCallId: "call-1",
		isError: false,
		details: { status: "completed", agentId: "agent-1" },
		content: [{ type: "text", text: '{"contract":"assurance_kernel/assurance_verdict/v2"}' }],
	}, "call-1");
	expect(parsed).toEqual({
		agentId: "agent-1",
		result: '{"contract":"assurance_kernel/assurance_verdict/v2"}',
		status: "completed",
	});
});

test("cancelled, malformed, and provider-error results fail closed", () => {
	expect(() => parseForegroundAgentResult({ toolName: "Agent", isError: true }, "call-1")).toThrow();
	expect(() => parseForegroundAgentResult({ toolName: "Agent", details: { status: "cancelled" }, content: [{ type: "text", text: "cancelled" }] }, "call-1")).toThrow(/cancelled/i);
	expect(() => parseForegroundAgentResult({ toolName: "Agent", details: { status: "completed" }, content: [] }, "call-1")).toThrow(/no review result/i);
});

test("review prompt embeds provenance and strict JSON instructions", () => {
	const prompt = semanticNeighborhoodReviewPrompt("base");
	expect(prompt).toContain("base");
	expect(prompt).toContain("immutable bundle");
	expect(prompt).not.toContain("get_subagent_result");
});
