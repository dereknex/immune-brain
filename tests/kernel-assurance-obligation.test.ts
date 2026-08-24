import { describe, expect, test } from "bun:test";

import { projectTask } from "../plugins/immune-brain/runtime/kernel/completion";
import { canonicalIntentHash } from "../plugins/immune-brain/runtime/kernel/intent";
import type { TaskIntentV1, TaskRecordV3 } from "../plugins/immune-brain/runtime/kernel/types";

const DIFF = "sha256:" + "d".repeat(64);

function fixture(
	risk: TaskIntentV1["risk"],
	approvals: Array<"qa" | "review" | "user">,
): [TaskIntentV1, TaskRecordV3] {
	const intent: TaskIntentV1 = {
		contract: "assurance_kernel/task_intent/v1",
		task_id: `obligation-${risk}`,
		goal: "derive one Kernel-owned obligation",
		acceptance: [{ id: "A1", assertion: "verified", verification: "{}" }],
		scope_hint: ["src"],
		risk,
		revision: 1,
		owner: "user",
	};
	const hash = canonicalIntentHash(intent);
	return [intent, {
		contract: "assurance_kernel/task_record/v3",
		task_id: intent.task_id,
		intent_snapshot: intent,
		intent_ref: { path: `docs/plans/archive/${intent.task_id}.intent.json`, content_hash: hash },
		lifecycle: "active",
		artifact_state: "frozen",
		baseline: hash,
		findings: [],
		attestations: approvals.map((kind) => ({
			id: `a-${kind}`,
			kind,
			authority_role: kind === "review" ? "reviewer" : kind,
			task_revision: 1,
			intent_content_hash: hash,
			diff_hash: DIFF,
			actor_id: `${kind}-actor`,
			summary: "passed",
			acceptance_results: kind === "qa"
				? [{ acceptance_id: "A1", status: "passed", summary: "passed" }]
				: [],
		})),
		history: [],
	}];
}

describe("Kernel assurance obligations", () => {
	test.each([
		["routine", ["qa"], "complete"],
		["material", ["qa"], "run_review"],
		["critical", ["qa", "review"], "authorize_user"],
	] as const)("%s risk derives %s", (risk, approvals, expected) => {
		const [intent, record] = fixture(risk, [...approvals]);
		expect(projectTask(intent, record, DIFF, record.intent_ref.content_hash).next_obligation).toBe(expected);
	});

	test("all risk tiers require deterministic QA", () => {
		for (const risk of ["routine", "material", "critical"] as const) {
			const [intent, record] = fixture(risk, []);
			expect(projectTask(intent, record, DIFF, record.intent_ref.content_hash).next_obligation).toBe("run_qa");
		}
	});
});
