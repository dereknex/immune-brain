import { describe, expect, test } from "bun:test";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { parseTaskRecordV4 } from "../plugins/immune-brain/runtime/kernel/validation";
import { parseTaskRecordV3 } from "../plugins/immune-brain/runtime/kernel/legacy_task_record";
import { canonicalRecordHash } from "../plugins/immune-brain/runtime/kernel/reducer";
import {
	LITERAL_USER_ACTOR_ID,
	canonicalActorId,
	isLiteralUserActor,
} from "../plugins/immune-brain/runtime/kernel/actor_identity";

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

	test("records Review advisories inside the attestation and round-trips them", () => {
		const advisory = {
			id: "review-1",
			acceptance_id: "A1",
			summary: "duplicated helper",
			anchor: `sha256:${"c".repeat(64)}`,
			evidence: {
				trigger: "duplicated helper",
				caller_chain: ["runtime/a.ts"],
				violated: { kind: "acceptance", ref: "A1" },
			},
		};
		const parsed = parseTaskRecordV4(record({
			attestations: [attestation("review", { review_revision: reviewRevision(), advisory_findings: [advisory] })],
		}));
		expect(parsed.attestations[0].advisory_findings).toEqual([advisory]);
		expect(canonicalRecordHash(parsed)).toBe(canonicalRecordHash(parseTaskRecordV4(JSON.parse(JSON.stringify(parsed)))));
		expect(() => parseTaskRecordV4(record({ attestations: [attestation("qa", { advisory_findings: [advisory] })] }))).toThrow(/only valid/);
		expect(() => parseTaskRecordV4(record({
			attestations: [attestation("review", { review_revision: reviewRevision(), advisory_findings: [{ ...advisory, summary: 7 }] })],
		}))).toThrow(/summary/);
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

describe("recorded actor identity", () => {
	// The recorded actor survey before the convergence: `literal-user` in 220
	// places across 54 settled records, `user` in 4 places across three
	// Claude-Host-era records. The converged spelling is `literal-user`; a
	// historical `user` is still read as the literal user.
	test("reads a historical user audit as the literal user", () => {
		expect(isLiteralUserActor("user")).toBe(true);
		expect(isLiteralUserActor("literal-user")).toBe(true);
		expect(isLiteralUserActor("executor")).toBe(false);
		expect(isLiteralUserActor("")).toBe(false);
	});

	test("records the converged spelling for both historical and current input", () => {
		expect(canonicalActorId("user")).toBe(LITERAL_USER_ACTOR_ID);
		expect(canonicalActorId(LITERAL_USER_ACTOR_ID)).toBe(LITERAL_USER_ACTOR_ID);
		// Every other actor keeps its own identity: only the literal user has a
		// second historical spelling.
		expect(canonicalActorId("executor")).toBe("executor");
		expect(canonicalActorId("deterministic-qa")).toBe("deterministic-qa");
	});

	test("leaves an already-settled record carrying the historical spelling byte-identical", () => {
		const historical = record({
			lifecycle: "done",
			// The shape a settled Claude-Host-era record carries: a lifecycle
			// transition whose authority block names the literal user with the
			// historical spelling.
			history: [
				{
					id: "h-1",
					type: "authorize",
					at: "2026-09-06T00:00:00.000Z",
					from_state: "active:active",
					to_state: "active:active",
					reason: "approve_breaking_intent_revision",
					authority: {
						authority_kind: "user",
						actor_id: "user",
						confirmation_ref: "claude-confirm-1",
						issued_at: "2026-09-06T00:00:00.000Z",
						expires_at: "2026-09-06T01:00:00.000Z",
					},
				},
			],
		});
		const parsed = parseTaskRecordV4(historical);
		// The reader accepts it and the bytes are untouched: nothing migrates a
		// settled record in place.
		expect((parsed.history?.[0] as { authority: { actor_id: string } }).authority.actor_id).toBe("user");
		// The reader hands the historical authority block back verbatim: no
		// migration, no rewriting, no normalized copy written over settled bytes.
		expect((parsed.history?.[0] as { authority: unknown }).authority).toEqual({
			authority_kind: "user",
			actor_id: "user",
			confirmation_ref: "claude-confirm-1",
			issued_at: "2026-09-06T00:00:00.000Z",
			expires_at: "2026-09-06T01:00:00.000Z",
		});
	});
});
