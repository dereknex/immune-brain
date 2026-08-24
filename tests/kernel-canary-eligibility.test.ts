import { describe, expect, test } from "bun:test";

import { evaluateCanaryEligibility, type CanaryEligibilityInput } from "../plugins/immune-brain/runtime/kernel/canary_eligibility";
import { createEnrollmentAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { createMutationAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { createMutationAuthorityCapabilityForTest } from "./fixtures/mutation-authority-test-seam";

function baseReport(overrides: Record<string, unknown> = {}) {
	return {
		contract: "assurance_kernel/readiness_report/v1",
		status: "collecting",
		observer_version: "v2",
		epoch_started_at: "2026-08-01T00:00:00.000Z",
		window_started_at: "2026-08-01T00:00:00.000Z",
		window_days: 3,
		receipts_v2_count: 70,
		observations_v2_count: 35,
		reconciled_terminal_count: 35,
		lifecycle_count: 5,
		families_covered: ["activation", "execution", "review", "termination"],
		families_missing: [],
		gaps: [{ code: "window_too_short", reference: null, detail: "qualifying window has 3 UTC days" }],
		legacy_counts: { receipts_v1: 4, observations_v1: 4 },
		migration_digest: { presented: "sha256:abc", current: "sha256:abc", match: true },
		rollback_rehearsal: { present: true, result: "passed", at: "2026-08-10T00:00:00.000Z" },
		generated_at: "2026-08-11T00:00:00.000Z",
		...overrides,
	};
}

function baseInput(overrides: Record<string, unknown> = {}): CanaryEligibilityInput {
	return {
		readiness: baseReport() as never,
		evidence: {
			status: "valid",
			bundle: {
				contract: "assurance_kernel/readiness_evidence/v1",
				migration_dry_run: { digest: "sha256:abc", writes_performed: false },
				rollback_rehearsal: { result: "passed", at: "2026-08-10T00:00:00.000Z" },
			},
		},
		task: {
			id: "task-001",
			intent_path: "docs/plans/001-goal.intent.json",
			intent_revision: 1,
			intent_content_hash: "sha256:intent",
		},
		waiver: {
			gate: "observation_window_days",
			task_id: "task-001",
			reason: "user risk acceptance for bounded Pi canary",
			actor: "user",
			confirmation_ref: "pi-confirm-001",
			expires_at: "2099-01-01T00:00:00.000Z",
			nonce: "nonce-001",
		},
		now: "2026-08-11T12:00:00.000Z",
		...overrides,
	};
}

describe("canary eligibility", () => {
	test("collecting report with waiver is rejected after v4 retirement", () => {
		// v4 storage retirement: the waiver route is retired; a readiness
		// report is never eligibility authority and a waiver is rejected.
		const result = evaluateCanaryEligibility(baseInput());
		expect(result.eligible).toBe(false);
		expect(result.rejections).toContain("waiver route retired");
	});

	test("ordinary candidate readiness without waiver is eligible", () => {
		const input = baseInput({
			readiness: baseReport({ status: "candidate", gaps: [] }),
			waiver: undefined,
		});
		const result = evaluateCanaryEligibility(input);
		expect(result.eligible).toBe(true);
		expect(result.waived_gates).toEqual([]);
	});

	test("blocked readiness is rejected (v4: readiness not authority)", () => {
		const input = baseInput({
			readiness: baseReport({
				status: "blocked",
				gaps: [{ code: "missing_observation", reference: "r1", detail: "gap" }],
			}),
		});
		const result = evaluateCanaryEligibility(input);
		expect(result.eligible).toBe(false);
	});

	test("reconciliation gap is not waivable (v4: readiness ignored)", () => {
		const input = baseInput({
			readiness: baseReport({
				gaps: [
					{ code: "binding_mismatch", reference: "r1", detail: "mismatch" },
					{ code: "window_too_short", reference: null, detail: "short" },
				],
			}),
		});
		const result = evaluateCanaryEligibility(input);
		expect(result.eligible).toBe(false);
		expect(result.rejections).toContain("waiver route retired");
	});

	test("evidence bundle missing is not waivable (v4: evidence ignored)", () => {
		const input = baseInput({ evidence: { status: "missing" } });
		const result = evaluateCanaryEligibility(input);
		expect(result.eligible).toBe(false);
		expect(result.rejections).toContain("waiver route retired");
	});

	test("rollback rehearsal invalid is not waivable (v4: evidence ignored)", () => {
		const input = baseInput({ evidence: { status: "invalid", reason: "rollback rehearsal did not pass" } });
		const result = evaluateCanaryEligibility(input);
		expect(result.eligible).toBe(false);
		expect(result.rejections).toContain("waiver route retired");
	});

	test("lifecycle/family coverage gaps are not waivable (v4: readiness ignored)", () => {
		const input = baseInput({
			readiness: baseReport({
				gaps: [
					{ code: "lifecycle_coverage", reference: null, detail: "only 2" },
					{ code: "family_coverage", reference: null, detail: "missing review" },
				],
			}),
		});
		const result = evaluateCanaryEligibility(input);
		expect(result.eligible).toBe(false);
	});

	test("non-time waiver gate is rejected", () => {
		const input = baseInput({ waiver: { ...baseInput().waiver!, gate: "binding_mismatch" } });
		const result = evaluateCanaryEligibility(input);
		expect(result.eligible).toBe(false);
		expect(result.rejections).toContain("waiver route retired");
	});

	test("waiver expiry is enforced (v4: waiver route retired)", () => {
		const input = baseInput({ waiver: { ...baseInput().waiver!, expires_at: "2026-08-01T00:00:00.000Z" } });
		const result = evaluateCanaryEligibility(input);
		expect(result.eligible).toBe(false);
		expect(result.rejections).toContain("waiver route retired");
	});

	test("waiver task mismatch is rejected", () => {
		const input = baseInput({ waiver: { ...baseInput().waiver!, task_id: "task-other" } });
		const result = evaluateCanaryEligibility(input);
		expect(result.eligible).toBe(false);
	});

	test("blocked readiness with waiver still rejected", () => {
		const input = baseInput({
			readiness: baseReport({ status: "blocked", gaps: [{ code: "version_discontinuity", reference: "r", detail: "v" }] }),
		});
		const result = evaluateCanaryEligibility(input);
		expect(result.eligible).toBe(false);
	});


});

describe("enrollment capability", () => {
	const registry = createEnrollmentAuthorityRegistry();
	const binding = {
		task_id: "task-001",
		intent_path: "docs/plans/001-goal.intent.json",
		intent_revision: 1,
		intent_content_hash: "sha256:intent",
		actor_id: "user",
		confirmation_ref: "pi-confirm-001",
		expires_at: "2099-01-01T00:00:00.000Z",
		nonce: "nonce-001",
	} as const;

	test("inspect validates and does not consume", () => {
		const cap = registry.issue(binding);
		const validated = registry.inspect(cap, binding);
		expect(validated.task_id).toBe("task-001");
		expect(registry.isConsumed(cap)).toBe(false);
	});

	test("consume marks consumed and second use fails", () => {
		const cap = registry.issue(binding);
		registry.consume(cap, binding);
		expect(registry.isConsumed(cap)).toBe(true);
		expect(() => registry.inspect(cap, binding)).toThrow(/consumed|reuse/);
	});

	test("expired capability rejected", () => {
		// deliberately past expiry to exercise rejection; far-future binding would not expire at 2026-08-25
		const expiredBinding = { ...binding, expires_at: "2026-08-15T00:00:00.000Z" } as const;
		const cap = registry.issue(expiredBinding, "2026-08-01T00:00:00.000Z");
		const expiredAt = Date.parse(expiredBinding.expires_at) + 10 * 24 * 60 * 60 * 1000;
		expect(() => registry.inspect(cap, expiredBinding, expiredAt)).toThrow(/expired/);
	});

	test("mismatched binding rejected", () => {
		const cap = registry.issue(binding);
		expect(() => registry.inspect(cap, { ...binding, task_id: "task-other" })).toThrow(/mismatch/);
	});

	test("R2C2 mutation capability is rejected by enrollment inspect", () => {
		const mutationRegistry = createMutationAuthorityRegistry();
		const mutationCap = createMutationAuthorityCapabilityForTest(
			mutationRegistry,
			{
				authority_kind: "user",
				task_id: "task-001",
				action_digest: "abc",
				expected_record_hash: "h",
				intent_revision: 1,
				intent_content_hash: "sha256:intent",
				diff_hash: "d",
				actor_id: "user",
				confirmation_ref: "ref",
				expires_at: "2099-01-01T00:00:00.000Z",
				findings_digest: null,
			},
		);
		expect(() => registry.inspect(mutationCap as never, binding)).toThrow(/enrollment capability/i);
	});

	test("capability is not JSON/spread serializable", () => {
		const cap = registry.issue(binding);
		expect(JSON.parse(JSON.stringify(cap))).toEqual({});
		expect({ ...cap }).toEqual({});
	});
});
