import { describe, expect, test } from "bun:test";

import { userOperationFor } from "../plugins/immune-brain/.pi-extension/imm-canary-work.ts";
import { capabilityActionFor } from "../plugins/immune-brain/runtime/kernel/canary_application";
import { digestOfAction } from "../plugins/immune-brain/runtime/kernel/authority_port";

const TASK = "canary-user-authority-task";
const approval = {
	id: "approval-user-test",
	kind: "user" as const,
	authority_role: "user" as const,
	task_revision: 1,
	intent_content_hash: `sha256:${"a".repeat(64)}`,
	diff_hash: `sha256:${"b".repeat(64)}`,
	actor_id: "literal-user",
	summary: "literal user approval",
};

describe("user approval authority binding", () => {
	test("userOperationFor returns the record_user_approval payload", () => {
		expect(userOperationFor("record-user-approval", approval)).toEqual({
			op: "record_user_approval",
			approval,
		});
		expect(() => userOperationFor("record-user-approval")).toThrow(/approval payload/);
	});

	test("capabilityActionFor deterministically binds the approval payload", () => {
		const input = {
			op: "record_user_approval",
			task_id: TASK,
			at: "2026-08-12T10:00:03.000Z",
			actor_id: "literal-user",
			approval,
		};
		const action = capabilityActionFor(input) as unknown as Record<string, unknown>;
		expect(action).toMatchObject({ type: "record_user_approval", approval });
		expect(digestOfAction(action as never)).toBe(digestOfAction(capabilityActionFor(input) as never));
	});
});
