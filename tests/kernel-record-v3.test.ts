import { describe, expect, test } from "bun:test";
import { completionDecision, projectTask } from "../plugins/immune-brain/runtime/kernel/completion";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { assertKernelInvariantsV3, parseTaskRecordV3 } from "../plugins/immune-brain/runtime/kernel/validation";

const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: "123-short-goal",
	goal: "One outcome statement",
	acceptance: [
		{ id: "A1", assertion: "One observable acceptance condition", verification: "verify one" },
		{ id: "A2", assertion: "Second condition", verification: "verify two" },
	],
	scope_hint: ["path/or/domain"],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;

const intent = parseTaskIntentV1(INTENT);
const intentHash = canonicalIntentHash(intent);
const CURRENT_DIFF = `sha256:${"b".repeat(64)}`;

function attestation(kind: "qa" | "review" | "user", overrides: Record<string, unknown> = {}) {
	return {
		id: `ap-${kind}`,
		kind,
		authority_role: kind === "review" ? "reviewer" : kind,
		task_revision: 1,
		intent_content_hash: intentHash,
		diff_hash: CURRENT_DIFF,
		actor_id: `${kind}-1`,
		summary: `${kind} approved`,
		acceptance_results: kind === "qa" ? [
			{ acceptance_id: "A1", status: "passed", summary: "verified A1" },
			{ acceptance_id: "A2", status: "passed", summary: "verified A2" },
		] : [],
		...overrides,
	};
}

function v3Record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		contract: "assurance_kernel/task_record/v3",
		task_id: intent.task_id,
		intent_snapshot: INTENT,
		intent_ref: {
			path: "docs/plans/archive/123-short-goal.intent.json",
			content_hash: intentHash,
		},
		lifecycle: "active",
		artifact_state: "frozen",
		baseline: `sha256:${"a".repeat(64)}`,
		attestations: [],
		findings: [],
		history: [],
		...overrides,
	};
}

function recordWith(attestations: unknown[], overrides: Record<string, unknown> = {}) {
	return parseTaskRecordV3(v3Record({ attestations, ...overrides }));
}

describe("TaskRecord v3 schema", () => {
	test("accepts the canonical wire without mirrored revision or state fields", () => {
		const parsed = parseTaskRecordV3(v3Record());
		expect(parsed.contract).toBe("assurance_kernel/task_record/v3");
		expect(parsed.intent_snapshot.revision).toBe(1);
		expect(parsed).not.toHaveProperty("intent_revision");
		expect(parsed.intent_ref).not.toHaveProperty("revision");
		expect(() => assertKernelInvariantsV3(intent, parsed)).not.toThrow();
	});

	test("rejects unknown fields, invalid state axes, hashes, and intent identity drift", () => {
		expect(() => parseTaskRecordV3(v3Record({ extra: 1 }))).toThrow();
		expect(() => parseTaskRecordV3(v3Record({ contract: "assurance_kernel/task_record/v2" }))).toThrow();
		expect(() => parseTaskRecordV3(v3Record({ lifecycle: "review" }))).toThrow();
		expect(() => parseTaskRecordV3(v3Record({ artifact_state: "nope" }))).toThrow();
		expect(() => parseTaskRecordV3(v3Record({ baseline: "sha256:xyz" }))).toThrow();
		expect(() => parseTaskRecordV3(v3Record({ task_id: "other-task" }))).toThrow();
		expect(() => parseTaskRecordV3(v3Record({
			intent_ref: { path: "docs/plans/archive/other.intent.json", content_hash: intentHash },
		}))).toThrow();
		expect(() => parseTaskRecordV3(v3Record({
			intent_ref: { path: "docs/plans/archive/123-short-goal.intent.json", content_hash: "abc" },
		}))).toThrow();
	});

	test("QA attestation must cover every current acceptance exactly once", () => {
		expect(() => recordWith([attestation("qa", {
			acceptance_results: [{ acceptance_id: "A1", status: "passed", summary: "only A1" }],
		})])).toThrow();
		expect(() => recordWith([attestation("qa"), attestation("qa")])).toThrow();
	});
});

describe("completionDecision v3", () => {
	test("failed QA results leave acceptance missing", () => {
		const qa = attestation("qa", {
			acceptance_results: [
				{ acceptance_id: "A1", status: "passed", summary: "verified" },
				{ acceptance_id: "A2", status: "failed", summary: "failed" },
			],
		});
		const decision = completionDecision(intent, recordWith([qa]), CURRENT_DIFF, intentHash);
		expect(decision.complete).toBe(false);
		expect(decision.fresh_acceptance_ids).toEqual(["A1"]);
		expect(decision.missing_acceptance_ids).toEqual(["A2"]);
	});

	test("routine completes with one fresh QA attestation", () => {
		const decision = completionDecision(intent, recordWith([attestation("qa")]), CURRENT_DIFF, intentHash);
		expect(decision.complete).toBe(true);
		expect(decision.missing_approval_kinds).toEqual([]);
	});

	test("intent and diff drift stale the whole attestation", () => {
		const record = recordWith([attestation("qa")]);
		const hashDrift = completionDecision(intent, record, CURRENT_DIFF, `sha256:${"d".repeat(64)}`);
		expect(hashDrift.complete).toBe(false);
		expect(hashDrift.stale_attestation_ids).toEqual(["ap-qa"]);
		const diffDrift = completionDecision(intent, record, `sha256:${"e".repeat(64)}`, intentHash);
		expect(diffDrift.complete).toBe(false);
		expect(diffDrift.stale_attestation_ids).toEqual(["ap-qa"]);
	});

	test("critical requires QA, Review, and User attestations", () => {
		const criticalIntent = parseTaskIntentV1({ ...INTENT, risk: "critical" });
		const criticalHash = canonicalIntentHash(criticalIntent);
		const bound = (value: Record<string, unknown>) => ({ ...value, intent_content_hash: criticalHash });
		const criticalRecord = (items: unknown[]) => parseTaskRecordV3(v3Record({
			intent_snapshot: criticalIntent,
			intent_ref: { path: "docs/plans/archive/123-short-goal.intent.json", content_hash: criticalHash },
			attestations: items,
		}));
		const qaAndUser = criticalRecord([bound(attestation("qa")), bound(attestation("user"))]);
		expect(completionDecision(criticalIntent, qaAndUser, CURRENT_DIFF, criticalHash).missing_approval_kinds).toEqual(["review"]);
		const ready = criticalRecord([bound(attestation("qa")), bound(attestation("review")), bound(attestation("user"))]);
		expect(completionDecision(criticalIntent, ready, CURRENT_DIFF, criticalHash).complete).toBe(true);
	});

	test("open blocking and replan findings prevent completion", () => {
		const record = recordWith([attestation("qa")], {
			findings: [
				{ id: "f1", kind: "blocking", status: "open", acceptance_id: "A1", source: "review", review_round: 2, summary: "blocked" },
				{ id: "f2", kind: "replan_required", status: "open", acceptance_id: "A1", source: "kernel", review_round: 2, summary: "replan" },
			],
		});
		const decision = completionDecision(intent, record, CURRENT_DIFF, intentHash);
		expect(decision.complete).toBe(false);
		expect(decision.blocking_finding_ids).toEqual(["f1"]);
		expect(decision.replan_required_ids).toEqual(["f2"]);
		expect(projectTask(intent, record, CURRENT_DIFF, intentHash).next_obligation).toBe("revise_intent");
	});
});

describe("projectTask v3", () => {
	test("projects one obligation from the two state axes", () => {
		const active = parseTaskRecordV3(v3Record({
			artifact_state: "active",
			intent_ref: { path: "docs/plans/123-short-goal.intent.json", content_hash: intentHash },
		}));
		expect(projectTask(intent, active, CURRENT_DIFF, intentHash).next_obligation).toBe("submit_assurance");
		expect(projectTask(intent, recordWith([]), CURRENT_DIFF, intentHash).next_obligation).toBe("run_qa");
		expect(projectTask(intent, recordWith([attestation("qa")]), CURRENT_DIFF, intentHash).next_obligation).toBe("complete");
	});
});
