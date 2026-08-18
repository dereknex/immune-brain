import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import {
	matchesReservedAgentArgs,
	parseForegroundAgentResult,
	reservedAgentParams,
	reservedAgentDescription,
} from "../plugins/immune-brain/.pi-extension/pi-canary-native-review.ts";
import { assertReviewArtifact, writeNativeReviewEvidence } from "../plugins/immune-brain/.pi-extension/pi-canary-review-bundle.ts";

describe("foreground Review dispatch resilience", () => {
	test("reserved params never request background execution and remain exact", () => {
		const params = reservedAgentParams({
			taskId: "foreground-review-task",
			operationId: "operation-1",
			prompt: "review the immutable bundle",
			max_turns: 24,
		});
		expect(params.run_in_background).toBe(false);
		expect(params.max_turns).toBe(24);
		expect(params.description).toBe(reservedAgentDescription("foreground-review-task", "operation-1"));
		expect(matchesReservedAgentArgs(params, params)).toBe(true);
		expect(matchesReservedAgentArgs({ ...params, run_in_background: true }, params)).toBe(false);
	});

	test("only a matching foreground tool result can supply review content", () => {
		const result = parseForegroundAgentResult({
			toolName: "Agent",
			toolCallId: "call-1",
			isError: false,
			details: { status: "completed", agentId: "agent-1" },
			content: [{ type: "text", text: '{"decision":"pass"}' }],
		}, "call-1");
		expect(result.result).toContain('"decision":"pass"');
		expect(() => parseForegroundAgentResult({ toolName: "get_subagent_result" }, "call-1")).toThrow();
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
