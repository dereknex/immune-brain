import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	reduceTaskV2,
	canonicalRecordHashV2,
	isReducedMutationV2,
} from "../plugins/immune-brain/runtime/kernel/reducer_v2";
import type {
	TaskActionV2,
	TaskRecordV2,
} from "../plugins/immune-brain/runtime/kernel/types";
import { parseTaskRecordV2 } from "../plugins/immune-brain/runtime/kernel/validation";
import { canonicalIntentHash } from "../plugins/immune-brain/runtime/kernel/intent";
import { KernelInvariantError } from "../plugins/immune-brain/runtime/kernel/validation";

const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: "task-r2c2",
	goal: "One outcome",
	acceptance: [
		{ id: "A1", assertion: "acceptance one", verification: "verify one" },
	],
	scope_hint: ["plugins/immune-brain"],
	risk: "material",
	revision: 1,
	owner: "user",
} as const;

const INTENT_HASH = canonicalIntentHash(INTENT);

function recordFixture(overrides: Partial<TaskRecordV2> = {}): TaskRecordV2 {
	const record: TaskRecordV2 = {
		contract: "assurance_kernel/task_record/v2",
		task_id: "task-r2c2",
		intent_revision: 1,
		intent_snapshot: INTENT,
		intent_ref: {
			path: "docs/plans/task-r2c2.intent.json",
			revision: 1,
			content_hash: INTENT_HASH,
		},
		phase: "working",
		baseline: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
		evidence: [],
		findings: [],
		approvals: [],
		history: [],
	};
	return { ...record, ...overrides };
}

const DIFF = "sha256:" + "a".repeat(64);
const WS = "sha256:" + "b".repeat(64);

function baseAction(type: TaskActionV2["type"]): Omit<TaskActionV2, "type"> extends never
	? never
	: TaskActionV2 {
	return {
		type,
		event_id: `ev-${type}-${Math.random().toString(36).slice(2, 10)}`,
		at: "2026-08-12T00:00:00.000Z",
		actor_id: "executor-1",
		expected_record_hash: canonicalRecordHashV2(recordFixture()),
		expected_workspace_hash: WS,
		diff_hash: DIFF,
	} as TaskActionV2;
}

function reduce(
	record: TaskRecordV2,
	action: TaskActionV2,
	audit: Parameters<typeof reduceTaskV2>[2] = null,
) {
	// Keep expected hashes aligned with the actual record under test.
	const withHashes = {
		...action,
		expected_record_hash: canonicalRecordHashV2(record),
	} as TaskActionV2;
	return reduceTaskV2(record, withHashes, audit);
}

function recordHashOf(record: TaskRecordV2): string {
	return canonicalRecordHashV2(record);
}

describe("R2C2 reducer v2: closed action vocabulary", () => {
	test("record_evidence appends a bound evidence item and history", () => {
		const record = recordFixture();
		const action = {
			...baseAction("record_evidence"),
			evidence: {
				id: "ev-1",
				acceptance_id: "A1",
				task_revision: 1,
				intent_content_hash: INTENT_HASH,
				diff_hash: DIFF,
				status: "passed",
				actor_id: "executor-1",
				summary: "evidence one",
			},
		} as TaskActionV2;
		const mutation = reduce(record, action);
		expect(isReducedMutationV2(mutation)).toBe(true);
		expect(mutation.record.evidence).toHaveLength(1);
		expect(mutation.record.history).toHaveLength(1);
		expect(mutation.record.history[0].id).toBe(action.event_id);
		expect(mutation.record.history[0].reason).toContain("action_v2_sha256:");
		expect(mutation.next_workspace_working).toBe("task-r2c2");
	});

	test("record_evidence rejects unknown acceptance id", () => {
		const record = recordFixture();
		const action = {
			...baseAction("record_evidence"),
			evidence: {
				id: "ev-1",
				acceptance_id: "NOPE",
				task_revision: 1,
				intent_content_hash: INTENT_HASH,
				diff_hash: DIFF,
				status: "passed",
				actor_id: "executor-1",
				summary: "bad",
			},
		} as TaskActionV2;
		expect(() => reduce(record, action)).toThrow(KernelInvariantError);
	});

	test("record_finding and resolve_finding for ordinary findings", () => {
		const record = recordFixture();
		const finding = {
			id: "f-1",
			kind: "blocking",
			status: "open",
			acceptance_id: "A1",
			source: "execution",
			review_round: null,
			summary: "blocked",
		};
		const add = {
			...baseAction("record_finding"),
			finding,
		} as TaskActionV2;
		const afterAdd = reduce(record, add).record;
		expect(afterAdd.findings).toHaveLength(1);
		const resolve = {
			...baseAction("resolve_finding"),
			finding_id: "f-1",
		} as TaskActionV2;
		const afterResolve = reduce(afterAdd, resolve).record;
		expect(afterResolve.findings[0].status).toBe("resolved");
	});

	test("resolve_finding cannot resolve a user decision", () => {
		const record = recordFixture({
			phase: "working",
			findings: [
				{
					id: "ud-1",
					kind: "unresolved_user_decision",
					status: "open",
					acceptance_id: "A1",
					source: "kernel",
					review_round: 2,
					summary: "user decision required",
				},
			],
		});
		const action = {
			...baseAction("resolve_finding"),
			finding_id: "ud-1",
		} as TaskActionV2;
		expect(() => reduce(record, action)).toThrow(KernelInvariantError);
	});

	test("submit_review transitions working -> review", () => {
		const record = recordFixture();
		const mutation = reduce(record, { ...baseAction("submit_review") } as TaskActionV2);
		expect(mutation.record.phase).toBe("review");
		expect(mutation.next_workspace_working).toBeNull();
	});

	test("request_rework records a review batch and parks on round 2", () => {
		const record = recordFixture({ phase: "review" });
		const round1 = {
			...baseAction("request_rework"),
			findings: [
				{
					id: "f-1",
					kind: "blocking",
					status: "open",
					acceptance_id: "A1",
					source: "review",
					review_round: 1,
					summary: "rework",
				},
			],
		} as TaskActionV2;
		const reviewAudit = {
			authority_kind: "review",
			actor_id: "reviewer-1",
			confirmation_ref: "conf-rw",
			issued_at: "2026-08-12T00:00:00.000Z",
			expires_at: "2099-01-01T00:00:00.000Z",
		};
		const afterRound1 = reduce(record, round1, reviewAudit).record;
		expect(afterRound1.phase).toBe("working");
		// Back to review before round 2.
		const resubmit = reduce(
			afterRound1,
			{ ...baseAction("submit_review") } as TaskActionV2,
		).record;
		expect(resubmit.phase).toBe("review");
		const round2 = {
			...baseAction("request_rework"),
			findings: [
				{
					id: "f-2",
					kind: "blocking",
					status: "open",
					acceptance_id: "A1",
					source: "review",
					review_round: 2,
					summary: "rework again",
				},
			],
		} as TaskActionV2;
		const afterRound2 = reduce(resubmit, round2, reviewAudit).record;
		expect(afterRound2.phase).toBe("review");
		expect(
			afterRound2.findings.some(
				(item) => item.kind === "replan_required" && item.status === "open",
			),
		).toBe(true);
		expect(
			afterRound2.findings.some(
				(item) => item.kind === "unresolved_user_decision",
			),
		).toBe(false);
		expect(() =>
			reduce(afterRound2, { ...baseAction("complete") } as TaskActionV2),
		).toThrow(/not eligible for completion/);
	});

	test("complete requires eligibility", () => {
		const record = recordFixture({ phase: "review" });
		expect(() =>
			reduce(record, { ...baseAction("complete") } as TaskActionV2),
		).toThrow(KernelInvariantError);
	});

	test("stop requires user authority audit", () => {
		const record = recordFixture();
		expect(() =>
			reduce(record, { ...baseAction("stop"), reason: "done" } as TaskActionV2),
		).toThrow(KernelInvariantError);
		const audit = {
			authority_kind: "user",
			actor_id: "user-1",
			confirmation_ref: "conf-1",
			issued_at: "2026-08-12T00:00:00.000Z",
			expires_at: "2026-08-13T00:00:00.000Z",
		};
		const mutation = reduce(
			record,
			{ ...baseAction("stop"), reason: "done" } as TaskActionV2,
			audit,
		);
		expect(mutation.record.phase).toBe("stopped");
		expect(mutation.record.history[0].authority).toEqual(audit);
	});

	test("revise_intent applies a compatible revision", () => {
		const record = recordFixture();
		const nextIntent = {
			...INTENT,
			revision: 2,
			acceptance: [
				...INTENT.acceptance,
				{ id: "A2", assertion: "acceptance two", verification: "verify two" },
			],
		};
		const nextHash = canonicalIntentHash(nextIntent);
		const action = {
			...baseAction("revise_intent"),
			next_intent: nextIntent,
			next_intent_ref: {
				path: "docs/plans/task-r2c2.intent.json",
				revision: 2,
				content_hash: nextHash,
			},
		} as TaskActionV2;
		const mutation = reduce(record, action);
		expect(mutation.record.intent_revision).toBe(2);
		expect(mutation.record.intent_ref.content_hash).toBe(nextHash);
	});

	test("revise_intent rejects scope expansion and other breaking changes; approve_breaking requires user", () => {
		const record = recordFixture();
		const scopeExpandedIntent = {
			...INTENT,
			revision: 2,
			scope_hint: ["plugins/immune-brain", "tests"],
		};
		const scopeExpandedAction = {
			...baseAction("revise_intent"),
			next_intent: scopeExpandedIntent,
			next_intent_ref: {
				path: "docs/plans/task-r2c2.intent.json",
				revision: 2,
				content_hash: canonicalIntentHash(scopeExpandedIntent),
			},
		} as TaskActionV2;
		expect(() => reduce(record, scopeExpandedAction)).toThrow(KernelInvariantError);

		const breakingIntent = {
			...INTENT,
			revision: 2,
			acceptance: [
				{ ...INTENT.acceptance[0], assertion: "rewritten assertion" },
			],
		};
		const breakingHash = canonicalIntentHash(breakingIntent);
		const breakingAction = {
			...baseAction("revise_intent"),
			next_intent: breakingIntent,
			next_intent_ref: {
				path: "docs/plans/task-r2c2.intent.json",
				revision: 2,
				content_hash: breakingHash,
			},
		} as TaskActionV2;
		expect(() => reduce(record, breakingAction)).toThrow(KernelInvariantError);
		const breakingApproval = {
			...baseAction("approve_breaking_intent_revision"),
			next_intent: breakingIntent,
			next_intent_ref: {
				path: "docs/plans/task-r2c2.intent.json",
				revision: 2,
				content_hash: breakingHash,
			},
		} as TaskActionV2;
		expect(() => reduce(record, breakingApproval)).toThrow(KernelInvariantError);
		const audit = {
			authority_kind: "user",
			actor_id: "user-1",
			confirmation_ref: "conf-1",
			issued_at: "2026-08-12T00:00:00.000Z",
			expires_at: "2026-08-13T00:00:00.000Z",
		};
		const mutation = reduce(record, breakingApproval, audit);
		expect(mutation.record.intent_revision).toBe(2);
	});

	test("record_approval binds authority role and rejects wrong capability kind", () => {
		const record = recordFixture({ phase: "review" });
		const approval = {
			id: "ap-1",
			kind: "qa",
			authority_role: "qa",
			task_revision: 1,
			intent_content_hash: INTENT_HASH,
			diff_hash: DIFF,
			actor_id: "qa-1",
			summary: "qa approved",
		};
		const action = {
			...baseAction("record_approval"),
			approval,
		} as TaskActionV2;
		// review authority cannot record a qa approval
		const reviewAudit = {
			authority_kind: "review",
			actor_id: "reviewer-1",
			confirmation_ref: "conf-2",
			issued_at: "2026-08-12T00:00:00.000Z",
			expires_at: "2026-08-13T00:00:00.000Z",
		};
		expect(() => reduce(record, action, reviewAudit)).toThrow(
			KernelInvariantError,
		);
		const qaAudit = { ...reviewAudit, authority_kind: "qa", actor_id: "qa-1" };
		const mutation = reduce(record, action, qaAudit);
		expect(mutation.record.approvals).toHaveLength(1);
	});

	test("exact replay returns the committed record; conflicting reuse fails", () => {
		const record = recordFixture();
		const action = {
			...baseAction("record_evidence"),
			type: "record_evidence",
			event_id: "ev-replay-1",
			expected_record_hash: canonicalRecordHashV2(record),
			evidence: {
				id: "ev-1",
				acceptance_id: "A1",
				task_revision: 1,
				intent_content_hash: INTENT_HASH,
				diff_hash: DIFF,
				status: "passed",
				actor_id: "executor-1",
				summary: "evidence one",
			},
		} as TaskActionV2;
		const first = reduceTaskV2(record, action, null).record;
		// Replay with the identical action and expected hash: committed snapshot.
		const replayed = reduceTaskV2(first, action, null);
		expect(recordHashOf(replayed.record)).toBe(recordHashOf(first));
		expect(replayed.record.history).toHaveLength(1);
		// Conflicting reuse: same event id, different payload.
		const conflict = {
			...action,
			evidence: { ...action.evidence, summary: "changed" },
		} as TaskActionV2;
		expect(() => reduceTaskV2(first, conflict, null)).toThrow(
			KernelInvariantError,
		);
	});

	test("rejects unknown action types and generic patch", () => {
		const record = recordFixture();
		expect(() =>
			reduce(record, { type: "patch", event_id: "x" } as unknown as TaskActionV2),
		).toThrow();
	});

	test("rejects expected record hash mismatch", () => {
		const record = recordFixture();
		const action = {
			...baseAction("submit_review"),
			expected_record_hash: "sha256:" + "0".repeat(64),
		} as TaskActionV2;
		expect(() => reduceTaskV2(record, action, null)).toThrow(
			KernelInvariantError,
		);
	});
});
