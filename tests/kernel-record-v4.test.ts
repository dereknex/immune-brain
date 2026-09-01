import { describe, expect, test } from "bun:test";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { parseTaskRecordV3, parseTaskRecordV4 } from "../plugins/immune-brain/runtime/kernel/validation";

const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: "v4-schema-task",
	goal: "One outcome statement",
	acceptance: [{ id: "A1", assertion: "One observable condition", verification: "verify one" }],
	scope_hint: ["path/or/domain"],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;

const intent = parseTaskIntentV1(INTENT);
const INTENT_HASH = canonicalIntentHash(intent);

function attestation(kind: "qa" | "review" | "user", overrides: Record<string, unknown> = {}) {
	return {
		id: `ap-${kind}`,
		kind,
		authority_role: kind === "review" ? "reviewer" : kind,
		task_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: `sha256:${"2".repeat(64)}`,
		actor_id: `${kind}-1`,
		summary: `${kind} approved`,
		acceptance_results: kind === "qa" ? [{ acceptance_id: "A1", status: "passed", summary: "verified" }] : [],
		...overrides,
	};
}

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		contract: "assurance_kernel/task_record/v4",
		task_id: INTENT.task_id,
		intent_snapshot: INTENT,
		intent_ref: { path: "docs/plans/archive/v4-schema-task.intent.json", content_hash: INTENT_HASH },
		lifecycle: "active",
		artifact_state: "frozen",
		baseline: `sha256:${"3".repeat(64)}`,
		git_base_head: "a".repeat(40),
		attestations: [],
		findings: [],
		history: [],
		...overrides,
	};
}

function reviewRevision(): Record<string, unknown> {
	return {
		contract: "assurance_kernel/review_revision_identity/v1",
		base_head: "a".repeat(40),
		review_commit: "b".repeat(40),
		review_tree: "c".repeat(40),
		manifest_digest: `sha256:${"d".repeat(64)}`,
	};
}

describe("TaskRecord v4 schema", () => {
	test("requires immutable Enrollment base and persists Review identity only", () => {
		const parsed = parseTaskRecordV4(record({ attestations: [attestation("review", { review_revision: reviewRevision() })] }));
		expect(parsed.contract).toBe("assurance_kernel/task_record/v4");
		expect(parsed.git_base_head).toBe("a".repeat(40));
		expect(parsed.attestations[0]).toHaveProperty("review_revision");
	});

	test("rejects missing or malformed base and cross-version identity fields", () => {
		expect(() => parseTaskRecordV4(record({ git_base_head: undefined }))).toThrow();
		expect(() => parseTaskRecordV4(record({ git_base_head: "A".repeat(40) }))).toThrow();
		expect(() => parseTaskRecordV4(record({ attestations: [attestation("review")] }))).toThrow(/review_revision/);
		expect(() => parseTaskRecordV4(record({ attestations: [attestation("qa", { review_revision: reviewRevision() })] }))).toThrow(/only valid/);
		expect(() => parseTaskRecordV4(record({ attestations: [attestation("user", { review_revision: reviewRevision() })] }))).toThrow(/only valid/);
		expect(() => parseTaskRecordV4(record({ attestations: [attestation("review", { review_revision: { ...reviewRevision(), base_head: "e".repeat(40) } })] }))).toThrow(/base_head/);
		expect(() => parseTaskRecordV3({ ...record(), contract: "assurance_kernel/task_record/v3" })).toThrow();
	});
});
