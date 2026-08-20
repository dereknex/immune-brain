// Guard for 2026-08-20-009-forbid-risk-downgrade-on-revision.
// Proves approve_breaking_intent_revision rejects risk downgrade symmetric
// with goal/owner guard, while holding or raising risk remains accepted,
// and that a material record cannot reach completion with zero reviews via revision.

import { describe, expect, test } from "bun:test";
import {
	reduceTaskV2,
	canonicalRecordHashV2,
} from "../plugins/immune-brain/runtime/kernel/reducer_v2";
import { canonicalIntentHash } from "../plugins/immune-brain/runtime/kernel/intent";
import { completionDecisionV2 } from "../plugins/immune-brain/runtime/kernel/completion";
import type { TaskRecordV2, TaskIntentV1, TaskActionV2 } from "../plugins/immune-brain/runtime/kernel/types";

const BASE_INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: "task-risk-guard",
	goal: "Guard risk downgrade",
	acceptance: [
		{ id: "A1", assertion: "acceptance one", verification: "verify one" },
	],
	scope_hint: ["docs/specs/archive"],
	risk: "material",
	revision: 1,
	owner: "user",
} as unknown as TaskIntentV1;

const BASE_HASH = canonicalIntentHash(BASE_INTENT);

function recordFixture(overrides: Partial<TaskRecordV2> = {}): TaskRecordV2 {
	const record: TaskRecordV2 = {
		contract: "assurance_kernel/task_record/v2",
		task_id: "task-risk-guard",
		intent_revision: 1,
		intent_snapshot: BASE_INTENT,
		intent_ref: {
			path: "docs/plans/task-risk-guard.intent.json",
			revision: 1,
			content_hash: BASE_HASH,
		},
		phase: "working",
		baseline: "sha256:" + "0".repeat(64),
		evidence: [],
		findings: [],
		approvals: [],
		history: [],
	};
	return { ...record, ...overrides };
}

const DIFF = "sha256:" + "a".repeat(64);
const WS = "sha256:" + "b".repeat(64);

function reduce(
	record: TaskRecordV2,
	action: TaskActionV2,
	audit: Parameters<typeof reduceTaskV2>[2] = null,
) {
	const withHashes = {
		...action,
		expected_record_hash: canonicalRecordHashV2(record),
	} as TaskActionV2;
	return reduceTaskV2(record, withHashes, audit);
}

const userAudit = {
	authority_kind: "user" as const,
	actor_id: "user-1",
	confirmation_ref: "conf-1",
	issued_at: "2026-08-12T00:00:00.000Z",
	expires_at: "2099-01-01T00:00:00.000Z",
};

function breakingIntent(overrides: Partial<TaskIntentV1>): TaskIntentV1 {
	// Make every revision breaking via assertion rewrite (mirrors 006 path)
	const intent = {
		...BASE_INTENT,
		revision: 2,
		acceptance: [{ ...BASE_INTENT.acceptance[0], assertion: "changed assertion" }],
		...overrides,
	} as unknown as TaskIntentV1;
	return intent;
}

describe("risk downgrade guard", () => {
	test("acc-downgrade-rejected: approve_breaking rejects risk decrease, accepts hold/raise", () => {
		const record = recordFixture();

		// material -> routine must be rejected (same shape as goal/owner guard)
		const downgradeToRoutine = breakingIntent({ risk: "routine" });
		const downgradeAction = {
			type: "approve_breaking_intent_revision",
			event_id: "ev-downgrade-routine",
			at: "2026-08-12T00:00:00.000Z",
			actor_id: "user-1",
			expected_record_hash: canonicalRecordHashV2(record),
			expected_workspace_hash: WS,
			diff_hash: DIFF,
			next_intent: downgradeToRoutine,
			next_intent_ref: {
				path: "docs/plans/task-risk-guard.intent.json",
				revision: 2,
				content_hash: canonicalIntentHash(downgradeToRoutine),
			},
		} as TaskActionV2;
		expect(() => reduce(record, downgradeAction, userAudit)).toThrow(/cannot reduce risk/);

		// critical -> material also rejected
		const criticalIntent = {
			...BASE_INTENT,
			risk: "critical",
			revision: 1,
		} as unknown as TaskIntentV1;
		const criticalHash = canonicalIntentHash(criticalIntent);
		const criticalRecord = recordFixture({
			intent_snapshot: criticalIntent,
			intent_ref: {
				path: "docs/plans/task-risk-guard.intent.json",
				revision: 1,
				content_hash: criticalHash,
			},
		});
		const downgradeToMaterial = breakingIntent({ risk: "material" });
		// need to base downgradeToMaterial on critical snapshot's goal/owner but risk lower
		const downgradeCM = {
			...criticalIntent,
			revision: 2,
			acceptance: [{ ...criticalIntent.acceptance[0], assertion: "changed assertion" }],
			risk: "material" as const,
		} as unknown as TaskIntentV1;
		const downgradeCMAction = {
			type: "approve_breaking_intent_revision",
			event_id: "ev-downgrade-critical-material",
			at: "2026-08-12T00:00:00.000Z",
			actor_id: "user-1",
			expected_record_hash: canonicalRecordHashV2(criticalRecord),
			expected_workspace_hash: WS,
			diff_hash: DIFF,
			next_intent: downgradeCM,
			next_intent_ref: {
				path: "docs/plans/task-risk-guard.intent.json",
				revision: 2,
				content_hash: canonicalIntentHash(downgradeCM),
			},
		} as TaskActionV2;
		expect(() => reduce(criticalRecord, downgradeCMAction, userAudit)).toThrow(/cannot reduce risk/);

		// holding risk (material -> material) with breaking change must be accepted
		const hold = breakingIntent({ risk: "material" });
		const holdAction = {
			type: "approve_breaking_intent_revision",
			event_id: "ev-hold",
			at: "2026-08-12T00:00:00.000Z",
			actor_id: "user-1",
			expected_record_hash: canonicalRecordHashV2(record),
			expected_workspace_hash: WS,
			diff_hash: DIFF,
			next_intent: hold,
			next_intent_ref: {
				path: "docs/plans/task-risk-guard.intent.json",
				revision: 2,
				content_hash: canonicalIntentHash(hold),
			},
		} as TaskActionV2;
		const holdMutation = reduce(record, holdAction, userAudit);
		expect(holdMutation.record.intent_revision).toBe(2);
		expect(holdMutation.record.intent_snapshot.risk).toBe("material");

		// raising risk (material -> critical) must be accepted
		const raise = breakingIntent({ risk: "critical" });
		const raiseAction = {
			type: "approve_breaking_intent_revision",
			event_id: "ev-raise",
			at: "2026-08-12T00:00:00.000Z",
			actor_id: "user-1",
			expected_record_hash: canonicalRecordHashV2(record),
			expected_workspace_hash: WS,
			diff_hash: DIFF,
			next_intent: raise,
			next_intent_ref: {
				path: "docs/plans/task-risk-guard.intent.json",
				revision: 2,
				content_hash: canonicalIntentHash(raise),
			},
		} as TaskActionV2;
		const raiseMutation = reduce(record, raiseAction, userAudit);
		expect(raiseMutation.record.intent_snapshot.risk).toBe("critical");

		// revise_intent downgrade also rejected (symmetric guard)
		const downgradeViaRevise = breakingIntent({ risk: "routine" });
		// For revise_intent to be tested, we need a compatible-looking downgrade, but
		// downgrade is breaking by definition, so revise_intent will reject via
		// classification first. To exercise the risk guard via revise_intent, use a
		// scenario where risk downgrade is the only breaking aspect (raise via compatible).
		// Here we test that a compatible raise is allowed but downgrade via approve is blocked.
		// The symmetric guard is already proven via approve_breaking; we additionally
		// ensure revise_intent cannot be used to bypass via a non-breaking downgrade
		// attempt (if classification were to change, guard still blocks).
		// So we assert the same error shape holds for any downgrade path.
		const reviseDowngradeAction = {
			type: "revise_intent",
			event_id: "ev-revise-downgrade",
			at: "2026-08-12T00:00:00.000Z",
			actor_id: "user-1",
			expected_record_hash: canonicalRecordHashV2(record),
			expected_workspace_hash: WS,
			diff_hash: DIFF,
			next_intent: downgradeToRoutine,
			next_intent_ref: {
				path: "docs/plans/task-risk-guard.intent.json",
				revision: 2,
				content_hash: canonicalIntentHash(downgradeToRoutine),
			},
		} as TaskActionV2;
		// This will throw either "requires a compatible revision" or "cannot reduce risk"
		// Both indicate downgrade is not allowed via revise_intent.
		expect(() => reduce(record, reviseDowngradeAction as TaskActionV2)).toThrow();
		try {
			reduce(record, reviseDowngradeAction as TaskActionV2);
		} catch (e) {
			const msg = (e as Error).message;
			expect(msg).toMatch(/cannot reduce risk|requires a compatible revision/);
		}
	});

	test("acc-completion-tier-preserved: material record cannot complete with zero reviews via revision", () => {
		// Enrolled at material, phase review, with evidence satisfying acceptance
		const intent = BASE_INTENT;
		const intentHash = BASE_HASH;
		const record = recordFixture({
			phase: "review",
			evidence: [
				{
					id: "ev-1",
					acceptance_id: "A1",
					task_revision: 1,
					intent_content_hash: intentHash,
					diff_hash: DIFF,
					status: "passed",
					actor_id: "executor-1",
					summary: "done",
				},
			],
			approvals: [],
			findings: [],
		});

		// With material risk, completion requires a review approval -> not complete
		const decisionMaterial = completionDecisionV2(intent, record, DIFF, intentHash);
		expect(decisionMaterial.complete).toBe(false);
		expect(decisionMaterial.missing_approval_kinds).toContain("review");

		// Attempt to downgrade to routine via approved breaking revision must be rejected
		const downgradedIntent = breakingIntent({ risk: "routine" });
		const downgradeAction = {
			type: "approve_breaking_intent_revision",
			event_id: "ev-complete-downgrade",
			at: "2026-08-12T00:00:00.000Z",
			actor_id: "user-1",
			expected_record_hash: canonicalRecordHashV2(record),
			expected_workspace_hash: WS,
			diff_hash: DIFF,
			next_intent: downgradedIntent,
			next_intent_ref: {
				path: "docs/plans/task-risk-guard.intent.json",
				revision: 2,
				content_hash: canonicalIntentHash(downgradedIntent),
			},
		} as TaskActionV2;
		expect(() => reduce(record, downgradeAction, userAudit)).toThrow(/cannot reduce risk/);

		// After failed downgrade, same material record still cannot complete with zero approvals
		const stillMaterialDecision = completionDecisionV2(intent, record, DIFF, intentHash);
		expect(stillMaterialDecision.complete).toBe(false);
		expect(stillMaterialDecision.missing_approval_kinds).toContain("review");

		// Even if we had a prior review approval bound to rev1, a successful
		// revision would stale it (requires fresh approval). Downgrade being
		// blocked prevents the bypass where routine requires no approval.
		const withApproval = recordFixture({
			phase: "review",
			evidence: [
				{
					id: "ev-1",
					acceptance_id: "A1",
					task_revision: 1,
					intent_content_hash: intentHash,
					diff_hash: DIFF,
					status: "passed",
					actor_id: "executor-1",
					summary: "done",
				},
			],
			approvals: [
				{
					id: "ap-1",
					kind: "review",
					authority_role: "reviewer",
					task_revision: 1,
					intent_content_hash: intentHash,
					diff_hash: DIFF,
					actor_id: "reviewer-1",
					summary: "reviewed",
				},
			],
		});
		const decisionWithApproval = completionDecisionV2(intent, withApproval, DIFF, intentHash);
		expect(decisionWithApproval.complete).toBe(true);
		expect(decisionWithApproval.missing_approval_kinds).toHaveLength(0);

		// Simulate what would happen if downgrade were allowed: new routine intent
		// requires no approvals, and prior approval is stale, but completion would
		// still be true with zero approvals. We verify routine indeed needs none.
		const routineIntent = { ...intent, risk: "routine", revision: 2 } as unknown as TaskIntentV1;
		const routineHash = canonicalIntentHash(routineIntent);
		const routineRecord = {
			...withApproval,
			intent_snapshot: routineIntent,
			intent_ref: {
				path: "docs/plans/task-risk-guard.intent.json",
				revision: 2,
				content_hash: routineHash,
			},
			intent_revision: 2,
			// evidence/approvals still bound to old hash/revision -> stale
		} as TaskRecordV2;
		// With routine, missing approvals is empty even with zero fresh approvals,
		// but fresh evidence is also stale -> missing acceptance would block.
		// To isolate approval bypass, give fresh evidence for routine.
		const routineRecordFreshEvidence = {
			...routineRecord,
			evidence: [
				{
					id: "ev-2",
					acceptance_id: "A1",
					task_revision: 2,
					intent_content_hash: routineHash,
					diff_hash: DIFF,
					status: "passed" as const,
					actor_id: "executor-1",
					summary: "done routine",
				},
			],
			approvals: [],
		} as TaskRecordV2;
		const routineDecision = completionDecisionV2(
			routineIntent,
			routineRecordFreshEvidence,
			DIFF,
			routineHash,
		);
		// Routine with fresh evidence and zero approvals is complete -> this is the bypass
		expect(routineDecision.complete).toBe(true);
		expect(routineDecision.missing_approval_kinds).toHaveLength(0);
		// The guard ensures material record cannot reach that routine decision via revision.
	});
});
