import { describe, expect, test } from "bun:test";
import { completionDecision, projectTask } from "../plugins/immune-brain/runtime/kernel/completion";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { parseTaskRecordV3 } from "../plugins/immune-brain/runtime/kernel/legacy_task_record";

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
	});

	test("a v3 review attestation keeps advisory findings", () => {
		const advisory = {
			id: "review-1",
			acceptance_id: "A1",
			summary: "duplicated helper",
			anchor: null,
			evidence: null,
		};
		const parsed = parseTaskRecordV3(v3Record({
			attestations: [attestation("review", { acceptance_results: [], advisory_findings: [advisory] })],
		}));
		expect(parsed.attestations[0].advisory_findings).toEqual([advisory]);
		expect(() => parseTaskRecordV3(v3Record({
			attestations: [attestation("qa", { advisory_findings: [advisory] })],
		}))).toThrow(/only valid/);
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

describe("completionDecision v3 / projectTask v3", () => {
	test("a v3-contract record is rejected before completion or projection logic runs", () => {
		const record = recordWith([attestation("qa")]);
		expect(() => completionDecision(intent, record, CURRENT_DIFF, intentHash)).toThrow(
			/contract must equal assurance_kernel\/task_record\/v4/,
		);
		expect(() => projectTask(intent, record, CURRENT_DIFF, intentHash)).toThrow(
			/contract must equal assurance_kernel\/task_record\/v4/,
		);
	});
});
