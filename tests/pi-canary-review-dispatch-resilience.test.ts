import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import {
	reservedAgentParams,
	reservedAgentDescription,
} from "../plugins/immune-brain/.pi-extension/pi-canary-native-review.ts";
import { assertReviewArtifact, writeNativeReviewEvidence } from "../plugins/immune-brain/.pi-extension/pi-canary-review-bundle.ts";

describe("foreground Review dispatch resilience", () => {
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
