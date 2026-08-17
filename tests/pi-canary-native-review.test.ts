import { describe, expect, test } from "bun:test";
import {
	matchesReservedAgentArgs,
	parseAgentResultPayload,
	parseAgentSpawnReceipt,
	reservedAgentParams,
	reviewDispatchFollowUp,
} from "../plugins/immune-brain/.pi-extension/pi-canary-native-review.ts";

const params = reservedAgentParams({
	taskId: "2026-08-14-009-standard-agent-review-dispatch",
	operationId: "op-12345678",
	prompt: "review locked evidence",
	model: "provider/model",
});

describe("standard Agent review observation", () => {
	test("reserves isolated background Agent parameters", () => {
		expect(params).toMatchObject({
			subagent_type: "general-purpose",
			inherit_context: false,
			isolated: true,
			isolation: "worktree",
			run_in_background: true,
			max_turns: 12,
			model: "provider/model",
		});
		expect(params.description).toContain("12345678");
		const followUp = reviewDispatchFollowUp({
			taskId: "task-1",
			operationId: "op-12345678",
			params,
		});
		expect(followUp).toContain("standard Agent tool");
		expect(followUp).toContain("isolated: true");
		expect(followUp).toContain("get_subagent_result");
		expect(followUp).toContain("Do not import a subagent package");
		expect(followUp).toContain("review locked evidence");
	});

	test("treats a background Agent tool_execution_end as a spawn receipt only", () => {
		expect(
			parseAgentSpawnReceipt({
				toolName: "Agent",
				toolCallId: "call-1",
				isError: false,
				result: { details: { agentId: "agent-1", status: "background" } },
			}),
		).toBe("agent-1");
		expect(
			parseAgentSpawnReceipt({
				toolName: "Agent",
				isError: false,
				result: {
					content: [{ type: "text", text: "Agent started in background.\nAgent ID: agent-1" }],
					details: { status: "completed", agentId: "agent-1" },
				},
			}),
		).toBeNull();
		expect(
			parseAgentResultPayload(
				{
					toolName: "Agent",
					isError: false,
					result: { details: { agentId: "agent-1", status: "background" } },
				},
				"agent-1",
			),
		).toBeNull();
	});

	test("creates an advisory payload only from a reserved get_subagent_result", () => {
		const native = parseAgentResultPayload(
			{
				toolName: "get_subagent_result",
				isError: false,
				result: {
					content: [{
						type: "text",
						text: "Agent: agent-1\nType: general-purpose | Status: completed | Duration: 1200ms\n\n{\"decision\":\"pass\"}",
					}],
				},
			},
			"agent-1",
		);
		expect(native).toMatchObject({
			agentId: "agent-1",
			status: "completed",
			result: "{\"decision\":\"pass\"}",
			durationMs: 1200,
		});
		expect(
			parseAgentResultPayload(
				{
					toolName: "get_subagent_result",
					isError: false,
					result: {
						content: [{
							type: "text",
							text: "Agent: agent-1\nType: general-purpose | Status: completed | Tool uses: 3 | 1.4k token | Duration: 1.2s\nDescription: Review dispatch\n\n{\"decision\":\"pass\"}",
						}],
					},
				},
				"agent-1",
			),
		).toMatchObject({
			agentId: "agent-1",
			status: "completed",
			result: "{\"decision\":\"pass\"}",
			durationMs: 1200,
		});
		expect(
			parseAgentResultPayload(
				{
					toolName: "get_subagent_result",
					isError: false,
					result: { content: [{ type: "text", text: "Agent: agent-9\nStatus: completed\n\n{}" }] },
				},
				"agent-1",
			),
		).toBeNull();
	});

	test("rejects forged bus-shaped objects and unmatched Agent args", () => {
		expect(parseAgentSpawnReceipt({ toolName: "subagents:completed", result: { id: "agent-1" } })).toBeNull();
		expect(matchesReservedAgentArgs({ ...params, isolated: false }, params)).toBe(false);
		expect(matchesReservedAgentArgs({ ...params, inherit_context: true }, params)).toBe(false);
		expect(matchesReservedAgentArgs(params, params)).toBe(true);
	});
});
