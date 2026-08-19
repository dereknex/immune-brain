import { describe, expect, test } from "bun:test";
import {
	canonicalIntentHash,
	parseTaskIntentV1,
} from "../plugins/immune-brain/runtime/kernel/intent";
import {
	completionDecisionV2,
	projectTaskV2,
} from "../plugins/immune-brain/runtime/kernel/completion";
import { parseTaskRecordV2, assertKernelInvariantsV2 } from "../plugins/immune-brain/runtime/kernel/validation";
import type { TaskIntentV1, TaskRecordV2 } from "../plugins/immune-brain/runtime/kernel/types";

const INTENT: Record<string, unknown> = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: "123-short-goal",
	goal: "One outcome statement",
	acceptance: [
		{
			id: "A1",
			assertion: "One observable acceptance condition",
			verification: "One deterministic verification description",
		},
		{
			id: "A2",
			assertion: "Second condition",
			verification: "Second verification",
		},
	],
	scope_hint: ["path/or/domain"],
	risk: "routine",
	revision: 1,
	owner: "user",
};

const intent = parseTaskIntentV1(INTENT);
const intentHash = canonicalIntentHash(intent);

function v2Record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	const base: Record<string, unknown> = {
		contract: "assurance_kernel/task_record/v2",
		task_id: "123-short-goal",
		intent_revision: 1,
		intent_snapshot: INTENT,
		intent_ref: {
			path: "docs/plans/123-short-goal.intent.json",
			revision: 1,
			content_hash: intentHash,
		},
		phase: "working",
		baseline: `sha256:${"a".repeat(64)}`,
		evidence: [],
		findings: [],
		approvals: [],
		history: [],
	};
	return { ...base, ...overrides };
}

function v2Evidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "e1",
		acceptance_id: "A1",
		task_revision: 1,
		intent_content_hash: intentHash,
		diff_hash: `sha256:${"b".repeat(64)}`,
		status: "passed",
		actor_id: "executor",
		summary: "verified",
		...overrides,
	};
}

function v2Approval(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "ap1",
		kind: "review",
		authority_role: "reviewer",
		task_revision: 1,
		intent_content_hash: intentHash,
		diff_hash: `sha256:${"b".repeat(64)}`,
		actor_id: "reviewer-1",
		summary: "approved",
		...overrides,
	};
}

const CURRENT_DIFF = `sha256:${"b".repeat(64)}`;

describe("parseTaskRecordV2", () => {
	test("accepts the exact canonical wire", () => {
		const parsed = parseTaskRecordV2(v2Record());
		expect(parsed.contract).toBe("assurance_kernel/task_record/v2");
		expect(parsed.intent_ref.content_hash).toBe(intentHash);
	});

	test("rejects unknown top-level fields, wrong contract, bad phase, bad hashes", () => {
		expect(() => parseTaskRecordV2(v2Record({ extra: 1 }))).toThrow();
		expect(() =>
			parseTaskRecordV2(v2Record({ contract: "assurance_kernel/task_record/v1" })),
		).toThrow();
		expect(() => parseTaskRecordV2(v2Record({ phase: "nope" }))).toThrow();
		expect(() =>
			parseTaskRecordV2(v2Record({ baseline: "sha256:xyz" })),
		).toThrow();
		expect(() =>
			parseTaskRecordV2(
				v2Record({
					intent_ref: { path: "docs/plans/123-short-goal.intent.json", revision: 1, content_hash: "abc" },
				}),
			),
		).toThrow();
	});

	test("rejects snapshot/ref mismatches: task_id, revision, path, content hash", () => {
		expect(() =>
			parseTaskRecordV2(v2Record({ task_id: "other-task" })),
		).toThrow();
		expect(() =>
			parseTaskRecordV2(v2Record({ intent_revision: 2 })),
		).toThrow();
		expect(() =>
			parseTaskRecordV2(
				v2Record({
					intent_ref: {
						path: "docs/plans/other.intent.json",
						revision: 1,
						content_hash: intentHash,
					},
				}),
			),
		).toThrow();
		expect(() =>
			parseTaskRecordV2(
				v2Record({
					intent_ref: {
						path: "docs/plans/123-short-goal.intent.json",
						revision: 1,
						content_hash: `sha256:${"c".repeat(64)}`,
					},
				}),
			),
		).toThrow();
	});

	test("rejects unknown acceptance IDs, mixed v1/v2 item shapes, duplicate IDs", () => {
		expect(() =>
			parseTaskRecordV2(
				v2Record({ evidence: [v2Evidence({ acceptance_id: "NOPE" })] }),
			),
		).toThrow();
		expect(() =>
			parseTaskRecordV2(
				v2Record({
					evidence: [
						{
							id: "e1",
							acceptance_id: "A1",
							task_revision: 1,
							diff_hash: `sha256:${"b".repeat(64)}`,
							status: "passed",
							actor_id: "x",
							summary: "v1-shaped (missing intent_content_hash)",
						},
					],
				}),
			),
		).toThrow();
		expect(() =>
			parseTaskRecordV2(
				v2Record({ evidence: [v2Evidence(), v2Evidence({ id: "e1" })] }),
			),
		).toThrow();
	});

	test("assertKernelInvariantsV2 passes for a valid record", () => {
		const record = parseTaskRecordV2(v2Record());
		expect(() => assertKernelInvariantsV2(intent, record)).not.toThrow();
	});
});

describe("completionDecisionV2", () => {
	function recordWith(evidence: unknown[], approvals: unknown[] = [], overrides: Record<string, unknown> = {}) {
		return parseTaskRecordV2(
			v2Record({ evidence, approvals, phase: "review", ...overrides }),
		);
	}

	test("requires fresh accepted evidence for every current acceptance ID", () => {
		const onlyA1 = recordWith([v2Evidence()]);
		const decision = completionDecisionV2(intent, onlyA1, CURRENT_DIFF, intentHash);
		expect(decision.complete).toBe(false);
		expect(decision.missing_acceptance_ids).toEqual(["A2"]);
		expect(decision.fresh_acceptance_ids).toEqual(["A1"]);
	});

	test("complete when every acceptance is fresh and no approvals/findings required", () => {
		const full = recordWith([v2Evidence(), v2Evidence({ id: "e2", acceptance_id: "A2" })]);
		const decision = completionDecisionV2(intent, full, CURRENT_DIFF, intentHash);
		expect(decision.complete).toBe(true);
		expect(decision.missing_acceptance_ids).toEqual([]);
		expect(decision.stale_evidence_ids).toEqual([]);
	});

	test("intent hash, revision, and diff drift stale evidence by projection", () => {
		const base = [v2Evidence(), v2Evidence({ id: "e2", acceptance_id: "A2" })];
		const driftedHash = recordWith(base);
		const decision = completionDecisionV2(
			intent,
			driftedHash,
			CURRENT_DIFF,
			`sha256:${"d".repeat(64)}`,
		);
		expect(decision.complete).toBe(false);
		expect(decision.stale_evidence_ids.sort()).toEqual(["e1", "e2"]);
		expect(decision.missing_acceptance_ids.sort()).toEqual(["A1", "A2"]);

		const driftedDiff = completionDecisionV2(
			intent,
			recordWith(base),
			`sha256:${"e".repeat(64)}`,
			intentHash,
		);
		expect(driftedDiff.complete).toBe(false);
		expect(driftedDiff.stale_evidence_ids.sort()).toEqual(["e1", "e2"]);
	});

	test("approvals must match revision, intent hash, and diff hash", () => {
		const criticalIntent = parseTaskIntentV1({ ...INTENT, risk: "critical", revision: 1 });
		const criticalHash = canonicalIntentHash(criticalIntent);
		const record = parseTaskRecordV2(
			v2Record({
				intent_snapshot: { ...INTENT, risk: "critical" },
				intent_ref: { path: "docs/plans/123-short-goal.intent.json", revision: 1, content_hash: criticalHash },
				phase: "review",
				evidence: [
					v2Evidence({ intent_content_hash: criticalHash }),
					v2Evidence({ id: "e2", acceptance_id: "A2", intent_content_hash: criticalHash }),
				],
				approvals: [
					v2Approval({ kind: "qa", authority_role: "qa", actor_id: "qa-1" }),
					v2Approval({ id: "ap2", kind: "user", authority_role: "user", actor_id: "user-1" }),
				],
			}),
		);
		const missingReview = completionDecisionV2(criticalIntent, record, CURRENT_DIFF, criticalHash);
		expect(missingReview.missing_approval_kinds).toContain("review");
		expect(missingReview.complete).toBe(false);

		const withReview = parseTaskRecordV2(
			v2Record({
				intent_snapshot: { ...INTENT, risk: "critical" },
				intent_ref: { path: "docs/plans/123-short-goal.intent.json", revision: 1, content_hash: criticalHash },
				phase: "review",
				evidence: [
					v2Evidence({ intent_content_hash: criticalHash }),
					v2Evidence({ id: "e2", acceptance_id: "A2", intent_content_hash: criticalHash }),
				],
				approvals: [
					v2Approval({ kind: "qa", authority_role: "qa", actor_id: "qa-1", intent_content_hash: criticalHash }),
					v2Approval({ id: "ap2", kind: "user", authority_role: "user", actor_id: "user-1", intent_content_hash: criticalHash }),
					v2Approval({ id: "ap3", kind: "review", actor_id: "reviewer-2", intent_content_hash: criticalHash }),
				],
			}),
		);
		const complete = completionDecisionV2(criticalIntent, withReview, CURRENT_DIFF, criticalHash);
		expect(complete.complete).toBe(true);

		// Approval with stale intent hash is not fresh.
		const staleApproval = parseTaskRecordV2(
			v2Record({
				intent_snapshot: { ...INTENT, risk: "critical" },
				intent_ref: { path: "docs/plans/123-short-goal.intent.json", revision: 1, content_hash: criticalHash },
				phase: "review",
				evidence: [
					v2Evidence({ intent_content_hash: criticalHash }),
					v2Evidence({ id: "e2", acceptance_id: "A2", intent_content_hash: criticalHash }),
				],
				approvals: [
					v2Approval({ kind: "qa", authority_role: "qa", actor_id: "qa-1", intent_content_hash: `sha256:${"f".repeat(64)}` }),
					v2Approval({ id: "ap2", kind: "user", authority_role: "user", actor_id: "user-1", intent_content_hash: criticalHash }),
					v2Approval({ id: "ap3", kind: "review", actor_id: "reviewer-2", intent_content_hash: criticalHash }),
				],
			}),
		);
		expect(
			completionDecisionV2(criticalIntent, staleApproval, CURRENT_DIFF, criticalHash).complete,
		).toBe(false);
	});

	test("blocking findings and unresolved user decisions block completion", () => {
		const full = parseTaskRecordV2(
			v2Record({
				phase: "review",
				evidence: [v2Evidence(), v2Evidence({ id: "e2", acceptance_id: "A2" })],
				findings: [
					{ id: "f1", kind: "blocking", status: "open", acceptance_id: null, source: "review", review_round: 1, summary: "blocked" },
				],
			}),
		);
		const decision = completionDecisionV2(intent, full, CURRENT_DIFF, intentHash);
		expect(decision.blocking_finding_ids).toEqual(["f1"]);
		expect(decision.complete).toBe(false);
	});

	test("open replan_required findings block completion and project revise_intent", () => {
		const parked = parseTaskRecordV2(
			v2Record({
				phase: "review",
				evidence: [v2Evidence(), v2Evidence({ id: "e2", acceptance_id: "A2" })],
				findings: [
					{ id: "f1", kind: "blocking", status: "open", acceptance_id: "A1", source: "review", review_round: 2, summary: "still blocked" },
					{ id: "H3:replan-required", kind: "replan_required", status: "open", acceptance_id: "A1", source: "kernel", review_round: 2, summary: "durable replan" },
				],
			}),
		);
		const decision = completionDecisionV2(intent, parked, CURRENT_DIFF, intentHash);
		expect(decision.complete).toBe(false);
		expect(decision.replan_required_ids).toEqual(["H3:replan-required"]);
		const projection = projectTaskV2(intent, parked, CURRENT_DIFF, intentHash);
		expect(projection.blocked).toBe(true);
		expect(projection.next_action).toBe("revise_intent");
	});
});

describe("projectTaskV2", () => {
	test("derives read-only projection with next action", () => {
		const record = parseTaskRecordV2(
			v2Record({
				phase: "review",
				evidence: [v2Evidence()],
			}),
		);
		const projection = projectTaskV2(intent, record, CURRENT_DIFF, intentHash);
		expect(projection.contract).toBe("assurance_kernel/projection/v2");
		expect(projection.next_action).toBe("record_evidence");
		expect(projection.missing_acceptance_ids).toEqual(["A2"]);
	});

	test("complete projection", () => {
		const record = parseTaskRecordV2(
			v2Record({
				phase: "review",
				evidence: [v2Evidence(), v2Evidence({ id: "e2", acceptance_id: "A2" })],
			}),
		);
		const projection = projectTaskV2(intent, record, CURRENT_DIFF, intentHash);
		expect(projection.complete).toBe(true);
		expect(projection.next_action).toBe("complete");
	});
});
