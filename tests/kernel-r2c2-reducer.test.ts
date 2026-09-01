import { describe, expect, test } from "bun:test";
import {
	canonicalRecordHash,
	isReducedMutation,
	reduceTask,
} from "../plugins/immune-brain/runtime/kernel/reducer";
import { canonicalIntentHash } from "../plugins/immune-brain/runtime/kernel/intent";
import type {
	AuthorityAuditDescriptor,
	TaskAction,
	TaskRecordV3,
} from "../plugins/immune-brain/runtime/kernel/types";
import { KernelInvariantError, parseTaskRecordV3 } from "../plugins/immune-brain/runtime/kernel/validation";

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
const DIFF = `sha256:${"a".repeat(64)}`;
const WS = `sha256:${"b".repeat(64)}`;

function recordFixture(overrides: Partial<TaskRecordV3> = {}): TaskRecordV3 {
	const record: TaskRecordV3 = {
		contract: "assurance_kernel/task_record/v3",
		task_id: "task-r2c2",
		intent_snapshot: INTENT,
		intent_ref: {
			path: "docs/plans/task-r2c2.intent.json",
			content_hash: INTENT_HASH,
		},
		lifecycle: "active",
		artifact_state: "active",
		baseline: `sha256:${"0".repeat(64)}`,
		attestations: [],
		findings: [],
		history: [],
	};
	return parseTaskRecordV3({ ...record, ...overrides } as unknown as Record<string, unknown>);
}

function frozenFixture(overrides: Partial<TaskRecordV3> = {}): TaskRecordV3 {
	return recordFixture({
		artifact_state: "frozen",
		intent_ref: {
			path: "docs/plans/archive/task-r2c2.intent.json",
			content_hash: INTENT_HASH,
		},
		...overrides,
	});
}

function baseAction(type: TaskAction["type"]): TaskAction {
	return {
		type,
		event_id: `ev-${type}-${Math.random().toString(36).slice(2, 10)}`,
		at: "2026-08-12T00:00:00.000Z",
		actor_id: "executor-1",
		expected_record_hash: canonicalRecordHash(recordFixture()),
		expected_workspace_hash: WS,
		diff_hash: DIFF,
	} as TaskAction;
}

function audit(authority_kind: "qa" | "review" | "user", actor_id = `${authority_kind}-1`): AuthorityAuditDescriptor {
	return {
		authority_kind,
		actor_id,
		confirmation_ref: `conf-${authority_kind}`,
		issued_at: "2026-08-12T00:00:00.000Z",
		expires_at: "2099-01-01T00:00:00.000Z",
	};
}

function reduce(record: TaskRecordV3, action: TaskAction, authority: AuthorityAuditDescriptor | null = null) {
	return reduceTask(record, {
		...action,
		expected_record_hash: canonicalRecordHash(record),
	} as TaskAction, authority, action.type === "complete" ? [] : undefined);
}

function approval(kind: "qa" | "review" | "user", id = `ap-${kind}`) {
	return {
		id,
		kind,
		authority_role: kind === "review" ? "reviewer" : kind,
		task_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: DIFF,
		actor_id: `${kind}-1`,
		summary: `${kind} approved`,
	};
}

function approve(record: TaskRecordV3, kind: "qa" | "review" | "user"): TaskRecordV3 {
	return reduce(record, {
		...baseAction("record_approval"),
		approval: approval(kind),
	} as TaskAction, audit(kind)).record;
}

describe("TaskRecord v3 reducer", () => {
	test("QA approval atomically attests every acceptance", () => {
		const record = frozenFixture();
		const mutation = reduce(record, {
			...baseAction("record_approval"),
			approval: approval("qa"),
		} as TaskAction, audit("qa"));

		expect(isReducedMutation(mutation)).toBe(true);
		expect(mutation.record.attestations).toEqual([
			expect.objectContaining({
				kind: "qa",
				acceptance_results: [{ acceptance_id: "A1", status: "passed", summary: "host-attested QA: qa approved" }],
			}),
		]);
		expect(mutation.record.history[0].reason).toContain("action_v2_sha256:");
		expect(mutation.next_workspace_working).toBe("task-r2c2");
	});

	test("approval authority must match attestation kind", () => {
		const action = {
			...baseAction("record_approval"),
			approval: approval("qa"),
		} as TaskAction;
		expect(() => reduce(frozenFixture(), action, audit("review"))).toThrow(KernelInvariantError);
	});

	test("ordinary findings can be recorded and resolved", () => {
		const finding = {
			id: "f-1",
			kind: "blocking",
			status: "open",
			acceptance_id: "A1",
			source: "execution",
			review_round: null,
			summary: "blocked",
		} as const;
		const afterAdd = reduce(recordFixture(), {
			...baseAction("record_finding"),
			finding,
		} as TaskAction).record;
		const afterResolve = reduce(afterAdd, {
			...baseAction("resolve_finding"),
			finding_id: finding.id,
		} as TaskAction).record;
		expect(afterResolve.findings[0].status).toBe("resolved");
	});

	test("user-decision findings cannot be resolved as ordinary findings", () => {
		const record = recordFixture({
			findings: [{
				id: "ud-1",
				kind: "unresolved_user_decision",
				status: "open",
				acceptance_id: "A1",
				source: "kernel",
				review_round: 2,
				summary: "user decision required",
			}],
		});
		expect(() => reduce(record, {
			...baseAction("resolve_finding"),
			finding_id: "ud-1",
		} as TaskAction)).toThrow(KernelInvariantError);
	});

	test("review rework restores active artifacts and parks the second review round", () => {
		const rework = (id: string) => ({
			...baseAction("request_rework"),
			findings: [{
				id,
				kind: "blocking",
				status: "open",
				acceptance_id: "A1",
				source: "review",
				review_round: 1,
				summary: "rework",
			}],
		}) as TaskAction;
		const afterRound1 = reduce(frozenFixture(), rework("f-1"), audit("review")).record;
		expect(afterRound1.artifact_state).toBe("active");
		expect(afterRound1.intent_ref.path).toBe("docs/plans/task-r2c2.intent.json");

		const round2Input = frozenFixture({
			findings: afterRound1.findings,
			history: afterRound1.history,
		});
		const afterRound2 = reduce(round2Input, rework("f-2"), audit("review")).record;
		expect(afterRound2.artifact_state).toBe("frozen");
		expect(afterRound2.findings.some((item) => item.kind === "replan_required" && item.status === "open")).toBe(true);
	});

	test("material completion requires QA and Review attestations", () => {
		const qaOnly = approve(frozenFixture(), "qa");
		expect(() => reduce(qaOnly, { ...baseAction("complete") } as TaskAction)).toThrow(/not eligible for completion/);
		const ready = approve(qaOnly, "review");
		const mutation = reduce(ready, { ...baseAction("complete") } as TaskAction);
		expect(mutation.record.lifecycle).toBe("done");
		expect(mutation.record.artifact_state).toBe("frozen");
		expect(mutation.next_workspace_working).toBeNull();
	});

	test("stop requires user authority and freezes the intent path", () => {
		const record = recordFixture();
		const action = { ...baseAction("stop"), reason: "cancelled" } as TaskAction;
		expect(() => reduce(record, action)).toThrow(KernelInvariantError);
		const mutation = reduce(record, action, audit("user"));
		expect(mutation.record.lifecycle).toBe("stopped");
		expect(mutation.record.artifact_state).toBe("frozen");
		expect(mutation.record.intent_ref.path).toBe("docs/plans/archive/task-r2c2.intent.json");
	});

	test("compatible intent revision updates the snapshot without a mirrored revision field", () => {
		const nextIntent = {
			...INTENT,
			revision: 2,
			acceptance: [...INTENT.acceptance, { id: "A2", assertion: "acceptance two", verification: "verify two" }],
		};
		const mutation = reduce(recordFixture(), {
			...baseAction("revise_intent"),
			next_intent: nextIntent,
			next_intent_ref: {
				path: "docs/plans/task-r2c2.intent.json",
				content_hash: canonicalIntentHash(nextIntent),
			},
		} as TaskAction);
		expect(mutation.record.intent_snapshot.revision).toBe(2);
		expect(mutation.record).not.toHaveProperty("intent_revision");
		expect(mutation.record.intent_ref).not.toHaveProperty("revision");
	});

	test("breaking intent revision requires user authority", () => {
		const nextIntent = {
			...INTENT,
			revision: 2,
			acceptance: [{ ...INTENT.acceptance[0], assertion: "rewritten assertion" }],
		};
		const next_intent_ref = {
			path: "docs/plans/task-r2c2.intent.json",
			content_hash: canonicalIntentHash(nextIntent),
		};
		expect(() => reduce(recordFixture(), {
			...baseAction("revise_intent"),
			next_intent: nextIntent,
			next_intent_ref,
		} as TaskAction)).toThrow(KernelInvariantError);
		const approved = reduce(recordFixture(), {
			...baseAction("approve_breaking_intent_revision"),
			next_intent: nextIntent,
			next_intent_ref,
		} as TaskAction, audit("user")).record;
		expect(approved.intent_snapshot.revision).toBe(2);
	});

	test("exact replay is idempotent and conflicting event reuse fails", () => {
		const record = recordFixture();
		const action = {
			...baseAction("record_finding"),
			event_id: "ev-replay-1",
			expected_record_hash: canonicalRecordHash(record),
			finding: {
				id: "f-1",
				kind: "blocking",
				status: "open",
				acceptance_id: "A1",
				source: "execution",
				review_round: null,
				summary: "blocked",
			},
		} as TaskAction;
		const first = reduceTask(record, action, null).record;
		const replayed = reduceTask(first, action, null).record;
		expect(canonicalRecordHash(replayed)).toBe(canonicalRecordHash(first));
		expect(replayed.history).toHaveLength(1);
		expect(() => reduceTask(first, {
			...action,
			finding: { ...action.finding, summary: "changed" },
		} as TaskAction, null)).toThrow(KernelInvariantError);
	});

	test("unknown actions and stale record hashes fail closed", () => {
		const record = frozenFixture();
		expect(() => reduce(record, { type: "patch", event_id: "x" } as unknown as TaskAction)).toThrow();
		expect(() => reduceTask(record, {
			...baseAction("complete"),
			expected_record_hash: `sha256:${"0".repeat(64)}`,
		} as TaskAction, null)).toThrow(KernelInvariantError);
	});
});
