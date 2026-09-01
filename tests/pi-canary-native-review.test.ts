import { expect, test } from "bun:test";
import {
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
		subagent_type: "Review",
		inherit_context: false,
		isolated: true,
		isolation: "worktree",
		run_in_background: false,
		max_turns: 16,
		resume: "",
		schedule: "",
	});
	expect(params).toMatchObject({ name: "", model: "", thinking: "" });
	expect(params.prompt).toContain("immutable bundle");
	expect(params.description).toContain("12345678");
	expect(promptDigest(params.prompt)).toMatch(/^sha256:[0-9a-f]{64}$/);
});

test("review prompt embeds provenance and strict JSON instructions", () => {
	const prompt = semanticNeighborhoodReviewPrompt("base");
	expect(prompt).toContain("base");
	expect(prompt).toContain("immutable bundle");
	expect(prompt).not.toContain("get_subagent_result");
});
