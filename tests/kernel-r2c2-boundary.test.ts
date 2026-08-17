import { describe, expect, test } from "bun:test";
import * as kernel from "../plugins/immune-brain/runtime/kernel/index";
import * as storage from "../plugins/immune-brain/runtime/kernel/storage";
import * as reducerV1 from "../plugins/immune-brain/runtime/kernel/reducer";
import { parseTaskRecord } from "../plugins/immune-brain/runtime/kernel/validation";
import {
	canonicalIntentHash,
	readTaskIntent,
} from "../plugins/immune-brain/runtime/kernel/intent";
import type { TaskActionV2, TaskRecordV2 } from "../plugins/immune-brain/runtime/kernel/types";
import { applyTaskActionV2 } from "../plugins/immune-brain/runtime/kernel/application_v2";
import * as applicationV2 from "../plugins/immune-brain/runtime/kernel/application_v2";

const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: "task-r2c2-b",
	goal: "One outcome",
	acceptance: [
		{ id: "A1", assertion: "acceptance one", verification: "verify one" },
	],
	scope_hint: ["plugins/immune-brain"],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;

function recordFixture(): TaskRecordV2 {
	return {
		contract: "assurance_kernel/task_record/v2",
		task_id: "task-r2c2-b",
		intent_revision: 1,
		intent_snapshot: INTENT,
		intent_ref: {
			path: "docs/plans/task-r2c2-b.intent.json",
			revision: 1,
			content_hash: canonicalIntentHash(INTENT),
		},
		phase: "working",
		baseline: "sha256:" + "0".repeat(64),
		evidence: [],
		findings: [],
		approvals: [],
		history: [],
	};
}

describe("R2C2 boundary and compatibility", () => {
	test("index exports the pure reducer and application port but no issuer", () => {
		expect(typeof kernel.reduceTaskV2).toBe("function");
		expect(typeof kernel.canonicalRecordHashV2).toBe("function");
		// The mutation port is exported from its own module for future trusted
		// host integration, but the public index stays mutation-surface-free.
		expect(typeof applicationV2.applyTaskActionV2).toBe("function");
		expect((kernel as Record<string, unknown>).applyTaskActionV2).toBeUndefined();
		// No authority issuer, capability constructor, token consumer, or
		// token unwrap may leak through the public index.
		expect((kernel as Record<string, unknown>).createMutationAuthorityCapabilityForTest).toBeUndefined();
		expect((kernel as Record<string, unknown>).consumeAuthorityCapability).toBeUndefined();
		expect((kernel as Record<string, unknown>).inspectAuthorityCapability).toBeUndefined();
		expect((kernel as Record<string, unknown>).consumeIntentToken).toBeUndefined();
		expect((kernel as Record<string, unknown>).inspectIntentTokenPair).toBeUndefined();
		expect((kernel as Record<string, unknown>).mintToken).toBeUndefined();
	});

	test("v1 reducer and storage public signatures remain intact", () => {
		expect(typeof reducerV1.reduceTask).toBe("function");
		expect(typeof reducerV1.createUserAuthorityContextForTest).toBe("function");
		expect(typeof storage.writeTaskRecord).toBe("function");
		expect(typeof storage.applyTaskAction).toBe("function");
		expect(typeof storage.readTaskRecord).toBe("function");
		expect(typeof storage.readWorkspaceState).toBe("function");
		expect(typeof storage.setAfterTaskTransactionWriteForTest).toBe("function");
		expect(typeof parseTaskRecord).toBe("function");
	});

	test("v1 writeTaskRecord rejects a v2 record", () => {
		// v2 records are rejected by the v1 parser before any write.
		expect(() =>
			parseTaskRecord(recordFixture() as unknown as Parameters<typeof parseTaskRecord>[0]),
		).toThrow();
	});

	test("no v2 creation path exists in storage", () => {
		const storageNames = Object.keys(storage).filter((key) =>
			key.toLowerCase().includes("v2"),
		);
		// Only read/commit primitives; no create/write/enroll surface.
		expect(storageNames.some((name) => /create|write|enroll/.test(name))).toBe(false);
	});

	test("applyTaskActionV2 input does not expose authority minting", () => {
		// The port's public surface is the function; capability creation stays
		// module-private. Calling the port with a plain object fails.
		expect(() =>
			applyTaskActionV2({
				root: "/nonexistent",
				task_id: "x",
				action: { type: "stop" },
				prior_intent_token: {} as never,
				diffProvider: () => "sha256:" + "0".repeat(64),
			}),
		).toThrow();
	});

	test("reducer v2 result is branded and non-constructible", () => {
		// A caller-built plain object cannot pass the brand check.
		expect(
			kernel.isReducedMutationV2({ record: recordFixture(), next_workspace_working: null }),
		).toBe(false);
	});
});
