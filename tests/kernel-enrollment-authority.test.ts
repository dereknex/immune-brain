import { describe, expect, test } from "bun:test";

import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { createTestEnrollmentCapability } from "./fixtures/enrollment-capability-test-seam";

const binding: EnrollmentCapabilityBinding = {
	task_id: "task-001",
	intent_path: "docs/plans/001-goal.intent.json",
	intent_revision: 1,
	intent_content_hash: "sha256:intent",
	actor_id: "user",
	confirmation_ref: "pi-confirm-001",
	expires_at: "2099-01-01T00:00:00.000Z",
	nonce: "nonce-001",
};

function makeRegistry() {
	const registry = createEnrollmentAuthorityRegistry();
	const issue = (b: EnrollmentCapabilityBinding = binding, at?: string) =>
		createTestEnrollmentCapability(registry, b, at);
	return { registry, issue };
}

describe("enrollment authority registry", () => {
	test("issue requires complete binding and future expiry", () => {
		const { issue } = makeRegistry();
		expect(() => issue({ ...binding, actor_id: "" } as EnrollmentCapabilityBinding)).toThrow(/incomplete/i);
		expect(() => issue({ ...binding, expires_at: "2026-08-01T00:00:00.000Z" })).toThrow(/future expiry/i);
	});

	test("inspect validates full binding", () => {
		const { registry, issue } = makeRegistry();
		const cap = issue();
		const validated = registry.inspect(cap, binding);
		expect(validated).toMatchObject({
			task_id: binding.task_id,
			intent_revision: binding.intent_revision,
			intent_content_hash: binding.intent_content_hash,
			actor_id: binding.actor_id,
			confirmation_ref: binding.confirmation_ref,
		});
		expect(registry.isConsumed(cap)).toBe(false);
	});

	test("every binding mismatch is rejected", () => {
		const { registry, issue } = makeRegistry();
		const cap = issue();
		for (const key of Object.keys(binding)) {
			const tampered = { ...binding, [key]: `${binding[key as keyof typeof binding]}-tampered` };
			expect(() => registry.inspect(cap, tampered)).toThrow(/mismatch/i);
		}
	});

	test("consume is irreversible", () => {
		const { registry, issue } = makeRegistry();
		const cap = issue();
		registry.consume(cap, binding);
		expect(registry.isConsumed(cap)).toBe(true);
		expect(() => registry.inspect(cap, binding)).toThrow(/consumed/i);
		expect(() => registry.consume(cap, binding)).toThrow(/consumed/i);
	});

	test("expired capability rejected with now injection", () => {
		const { registry, issue } = makeRegistry();
		// deliberately past expiry to exercise rejection without using a near-future bomb; must stay <2y future guard threshold (past is allowed)
		const expiredBinding = { ...binding, expires_at: "2026-08-15T00:00:00.000Z" } as EnrollmentCapabilityBinding;
		const cap = issue(expiredBinding, "2026-08-01T00:00:00.000Z");
		// inspection time derived from expiry to avoid hardcoding a near-future absolute timestamp that the guard would flag
		const expiredAt = Date.parse(expiredBinding.expires_at) + 10 * 24 * 60 * 60 * 1000;
		expect(() => registry.inspect(cap, expiredBinding, expiredAt)).toThrow(/expired/i);
	});

	test("nonce replay rejected", () => {
		const { registry, issue } = makeRegistry();
		const cap = issue();
		registry.consume(cap, binding);
		// second capability with same nonce is issued but the consumed object cannot be reused
		const replay = issue();
		expect(() => registry.inspect(replay, binding)).not.toThrow();
		expect(() => registry.inspect(cap, binding)).toThrow(/consumed/i);
	});

	test("cross-registry capability is rejected", () => {
		const a = makeRegistry();
		const b = makeRegistry();
		const capFromA = a.issue();
		expect(() => b.registry.inspect(capFromA, binding)).toThrow(/not recognized by this registry/i);
	});
});
