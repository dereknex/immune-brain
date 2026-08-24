import { describe, expect, test } from "bun:test";

import { completionDecision } from "../plugins/immune-brain/runtime/kernel/completion";
import { canonicalIntentHash } from "../plugins/immune-brain/runtime/kernel/intent";
import { canonicalRecordHash, reduceTask } from "../plugins/immune-brain/runtime/kernel/reducer";
import type { TaskAction, TaskIntentV1, TaskRecordV3 } from "../plugins/immune-brain/runtime/kernel/types";

const DIFF = `sha256:${"a".repeat(64)}`;
const WS = `sha256:${"b".repeat(64)}`;
const INTENT: TaskIntentV1 = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: "task-risk-guard",
	goal: "Guard risk downgrade",
	acceptance: [{ id: "A1", assertion: "acceptance one", verification: "verify one" }],
	scope_hint: ["docs/specs/archive"],
	risk: "material",
	revision: 1,
	owner: "user",
};

function record(intent: TaskIntentV1 = INTENT): TaskRecordV3 {
	return {
		contract: "assurance_kernel/task_record/v3",
		task_id: intent.task_id,
		intent_snapshot: intent,
		intent_ref: { path: `docs/plans/${intent.task_id}.intent.json`, content_hash: canonicalIntentHash(intent) },
		lifecycle: "active",
		artifact_state: "active",
		baseline: `sha256:${"0".repeat(64)}`,
		attestations: [],
		findings: [],
		history: [],
	};
}

function revise(current: TaskRecordV3, next: TaskIntentV1) {
	const action = {
		type: "approve_breaking_intent_revision",
		event_id: `revise-${next.risk}`,
		at: "2026-08-12T00:00:00.000Z",
		actor_id: "user-1",
		expected_record_hash: canonicalRecordHash(current),
		expected_workspace_hash: WS,
		diff_hash: DIFF,
		next_intent: next,
		next_intent_ref: { path: current.intent_ref.path, content_hash: canonicalIntentHash(next) },
	} as TaskAction;
	return reduceTask(current, action, {
		authority_kind: "user",
		actor_id: "user-1",
		confirmation_ref: "conf-1",
		issued_at: "2026-08-12T00:00:00.000Z",
		expires_at: "2099-01-01T00:00:00.000Z",
	});
}

describe("risk downgrade guard", () => {
	test("approve_breaking rejects decreases and accepts hold or raise", () => {
		const current = record();
		const next = (risk: TaskIntentV1["risk"]): TaskIntentV1 => ({
			...INTENT,
			revision: 2,
			risk,
			acceptance: [{ ...INTENT.acceptance[0], assertion: "changed assertion" }],
		});
		expect(() => revise(current, next("routine"))).toThrow(/cannot reduce risk/);
		expect(revise(current, next("material")).record.intent_snapshot).toMatchObject({ revision: 2, risk: "material" });
		expect(revise(current, next("critical")).record.intent_snapshot).toMatchObject({ revision: 2, risk: "critical" });

		const critical = { ...INTENT, risk: "critical" as const };
		expect(() => revise(record(critical), { ...next("material"), goal: critical.goal })).toThrow(/cannot reduce risk/);
	});

	test("material completion remains blocked without Review attestation", () => {
		const current = record();
		current.intent_ref.path = "docs/plans/archive/task-risk-guard.intent.json";
		current.artifact_state = "frozen";
		current.attestations = [{
			id: "qa-1",
			kind: "qa",
			authority_role: "qa",
			task_revision: 1,
			intent_content_hash: current.intent_ref.content_hash,
			diff_hash: DIFF,
			actor_id: "qa-1",
			summary: "passed",
			acceptance_results: [{ acceptance_id: "A1", status: "passed", summary: "passed" }],
		}];
		expect(completionDecision(INTENT, current, DIFF, current.intent_ref.content_hash)).toMatchObject({ complete: false });
	});
});
