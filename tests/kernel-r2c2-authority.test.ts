import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
	createMutationAuthorityRegistry,
	type MutationAuthorityRegistry,
} from "../plugins/immune-brain/runtime/kernel/authority_port";
import {
	createMutationAuthorityCapabilityForTest,
} from "./fixtures/mutation-authority-test-seam";
import type { TaskActionV2 } from "../plugins/immune-brain/runtime/kernel/types";

const INTENT_HASH = "sha256:" + "1".repeat(64);
const RECORD_HASH = "sha256:" + "2".repeat(64);
const DIFF = "sha256:" + "3".repeat(64);
const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";

function action(type: TaskActionV2["type"], eventId = "ev-a-1"): TaskActionV2 {
	return {
		type,
		event_id: eventId,
		at: "2026-08-12T00:00:00.000Z",
		actor_id: "executor-1",
		expected_record_hash: RECORD_HASH,
		expected_workspace_hash: "sha256:" + "4".repeat(64),
		diff_hash: DIFF,
	} as TaskActionV2;
}

function digestOf(a: TaskActionV2): string {
	const { expected_record_hash: _r, expected_workspace_hash: _w, diff_hash: _d, ...rest } = a;
	return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

function binding(
	registry: MutationAuthorityRegistry,
	overrides: Partial<Parameters<typeof createMutationAuthorityCapabilityForTest>[1]> = {},
) {
	return {
		authority_kind: "user" as const,
		task_id: "task-x",
		action_digest: digestOf(action("stop")),
		expected_record_hash: RECORD_HASH,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: DIFF,
		actor_id: "user-1",
		confirmation_ref: "conf-1",
		expires_at: FUTURE,
		findings_digest: null,
		...overrides,
	};
}

function expected(cap: object) {
	return {
		task_id: "task-x",
		action: action("stop"),
		expected_record_hash: RECORD_HASH,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: DIFF,
	};
}

describe("R2C2 authority port", () => {
	test("inspect validates a matching capability without consuming", () => {
		const registry = createMutationAuthorityRegistry();
		const cap = createMutationAuthorityCapabilityForTest(registry, binding(registry));
		const validated = registry.inspect(cap, expected(cap));
		expect(validated.audit.authority_kind).toBe("user");
		expect(registry.isConsumed(cap)).toBe(false);
	});

	test("consume is irreversible and single-use", () => {
		const registry = createMutationAuthorityRegistry();
		const cap = createMutationAuthorityCapabilityForTest(registry, binding(registry));
		registry.consume(cap, expected(cap));
		expect(registry.isConsumed(cap)).toBe(true);
		expect(() => registry.consume(cap, expected(cap))).toThrow();
		expect(() => registry.inspect(cap, expected(cap))).toThrow();
	});

	test("missing capability fails", () => {
		const registry = createMutationAuthorityRegistry();
		expect(() => registry.inspect(undefined, expected(undefined as never))).toThrow();
	});

	test("fabricated object is not a capability", () => {
		const registry = createMutationAuthorityRegistry();
		const fake = { authority_kind: "user" };
		expect(() =>
			registry.inspect(fake as never, expected(fake as never)),
		).toThrow();
	});

	test("serialized capability cannot be reconstructed", () => {
		const registry = createMutationAuthorityRegistry();
		const cap = createMutationAuthorityCapabilityForTest(registry, binding(registry));
		const serialized = JSON.parse(JSON.stringify(cap));
		expect(serialized).toEqual({});
		expect(() =>
			registry.inspect(serialized as never, expected(serialized as never)),
		).toThrow();
	});

	test("expired capability fails", () => {
		const registry = createMutationAuthorityRegistry();
		const cap = createMutationAuthorityCapabilityForTest(registry, binding(registry));
		expect(() =>
			registry.inspect(
				cap,
				expected(cap),
				Date.parse("2100-01-01T00:00:00.000Z"),
			),
		).toThrow();
	});

	test("mismatched task, record hash, intent hash, or diff fails", () => {
		const registry = createMutationAuthorityRegistry();
		const cap = createMutationAuthorityCapabilityForTest(registry, binding(registry));
		expect(() =>
			registry.inspect(cap, { ...expected(cap), task_id: "task-y" }),
		).toThrow();
		expect(() =>
			registry.inspect(cap, {
				...expected(cap),
				expected_record_hash: "sha256:" + "9".repeat(64),
			}),
		).toThrow();
		expect(() =>
			registry.inspect(cap, {
				...expected(cap),
				intent_content_hash: "sha256:" + "8".repeat(64),
			}),
		).toThrow();
		expect(() =>
			registry.inspect(cap, {
				...expected(cap),
				diff_hash: "sha256:" + "7".repeat(64),
			}),
		).toThrow();
	});

	test("action digest mismatch fails", () => {
		const registry = createMutationAuthorityRegistry();
		const cap = createMutationAuthorityCapabilityForTest(registry, binding(registry));
		expect(() =>
			registry.inspect(cap, {
				...expected(cap),
				action: action("complete", "ev-a-2"),
			}),
		).toThrow();
	});

	test("capability is bound to the exact action digest", () => {
		const registry = createMutationAuthorityRegistry();
		const cap = createMutationAuthorityCapabilityForTest(
			registry,
			binding(registry, { authority_kind: "review" }),
		);
		const validated = registry.inspect(cap, expected(cap));
		expect(validated.audit.authority_kind).toBe("review");
		expect(() =>
			registry.inspect(cap, {
				...expected(cap),
				action: action("record_approval", "ev-a-9"),
			}),
		).toThrow();
	});

	test("cross-registry capability is rejected", () => {
		const registryA = createMutationAuthorityRegistry();
		const registryB = createMutationAuthorityRegistry();
		const cap = createMutationAuthorityCapabilityForTest(registryA, binding(registryA));
		expect(() => registryB.inspect(cap, expected(cap))).toThrow(
			/opaque authority capability/i,
		);
	});

	test("findings digest binding is enforced for rework capabilities", () => {
		const registry = createMutationAuthorityRegistry();
		const reworkAction = {
			...action("request_rework", "ev-rw-1"),
			findings: [
				{
					id: "f-1",
					kind: "blocking",
					status: "open",
					acceptance_id: "A1",
					source: "review",
					review_round: 1,
					summary: "broken",
				},
			],
		} as TaskActionV2;
		const digest = `sha256:${createHash("sha256")
			.update(
				JSON.stringify([
					{ id: "f-1", kind: "blocking", acceptance_id: "A1", summary: "broken" },
				]),
			)
			.digest("hex")}`;
		const cap = createMutationAuthorityCapabilityForTest(registry, {
			authority_kind: "qa",
			task_id: "task-x",
			action_digest: digestOf(reworkAction),
			expected_record_hash: RECORD_HASH,
			intent_revision: 1,
			intent_content_hash: INTENT_HASH,
			diff_hash: DIFF,
			actor_id: "qa-1",
			confirmation_ref: "conf-qa",
			expires_at: FUTURE,
			findings_digest: digest,
		});
		// Matching findings pass.
		const validated = registry.inspect(cap, {
			...expected(cap),
			action: reworkAction,
			findings_digest: digest,
		});
		expect(validated.audit.authority_kind).toBe("qa");
		// Wrong findings digest fails.
		expect(() =>
			registry.inspect(cap, {
				...expected(cap),
				action: reworkAction,
				findings_digest: `sha256:${"f".repeat(64)}`,
			}),
		).toThrow(/findings digest mismatch/i);
		// A capability without findings binding fails a rework expectation.
		const plain = createMutationAuthorityCapabilityForTest(registry, {
			...binding(registry),
			action_digest: digestOf(reworkAction),
			findings_digest: null,
		});
		expect(() =>
			registry.inspect(plain, {
				...expected(plain),
				action: reworkAction,
				findings_digest: digest,
			}),
		).toThrow(/not bound to findings/i);
	});

	test("binding with future expiry only is accepted; PAST constant stays defined", () => {
		expect(PAST).toBe("2020-01-01T00:00:00.000Z");
		const registry = createMutationAuthorityRegistry();
		expect(() =>
			createMutationAuthorityCapabilityForTest(
				registry,
				binding(registry, { expires_at: "2020-01-01T00:00:00.000Z" }),
			),
		).toThrow(/future expiry/i);
	});
});
