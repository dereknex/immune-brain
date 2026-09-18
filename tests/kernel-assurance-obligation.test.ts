import { describe, expect, test } from "bun:test";

import { projectTask } from "../plugins/immune-brain/runtime/kernel/completion";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { canonicalRecordHash, reduceTask } from "../plugins/immune-brain/runtime/kernel/reducer";
import type { TaskAction, TaskIntentV1, TaskRecordV4 } from "../plugins/immune-brain/runtime/kernel/types";
import { parseTaskRecordV4 } from "../plugins/immune-brain/runtime/kernel/validation";

const DIFF = "sha256:" + "d".repeat(64);
const GIT_BASE_HEAD = "a".repeat(40);

function fixture(
	risk: TaskIntentV1["risk"],
	approvals: Array<"qa" | "review" | "user">,
	scopeHint: string[] = ["src"],
): [TaskIntentV1, TaskRecordV4] {
	const intent = parseTaskIntentV1({
		contract: "assurance_kernel/task_intent/v1",
		task_id: `obligation-${risk}`,
		goal: "derive one Kernel-owned obligation",
		acceptance: [{ id: "A1", assertion: "verified", verification: "{}" }],
		scope_hint: scopeHint,
		risk,
		revision: 1,
		owner: "user",
	});
	const hash = canonicalIntentHash(intent);
	return [intent, {
		contract: "assurance_kernel/task_record/v4",
		task_id: intent.task_id,
		intent_snapshot: intent,
		intent_ref: { path: `docs/plans/archive/${intent.task_id}.intent.json`, content_hash: hash },
		lifecycle: "active",
		artifact_state: "frozen",
		baseline: hash,
		git_base_head: GIT_BASE_HEAD,
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
			...(kind === "review"
				? {
					review_revision: {
						contract: "assurance_kernel/review_revision_identity/v1",
						base_head: GIT_BASE_HEAD,
						review_commit: "b".repeat(40),
						review_tree: "c".repeat(40),
						manifest_digest: `sha256:${"d".repeat(64)}`,
					},
				}
				: {}),
		})),
		history: [],
	}];
}

describe("Kernel assurance obligations", () => {
	test.each([
		["routine", ["qa"], "complete"],
		["material", ["qa"], "run_review"],
		["critical", ["qa", "review"], "complete"],
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

	test("own planning sidecars and ordinary paths skip Review after QA", () => {
		const scope = [
			"docs/plans/obligation-routine.intent.json",
			"docs/plans/archive/obligation-routine.intent.json",
			"docs/specs/task.spec.md",
			"docs/specs/archive/task.spec.md",
			"src/app.ts",
		];
		const [intent, record] = fixture("routine", ["qa"], scope);
		expect(projectTask(intent, record, DIFF, record.intent_ref.content_hash, scope).next_obligation).toBe("complete");
	});

	test("a listed path raises Review even when declared risk is routine", () => {
		const [intent, record] = fixture("routine", ["qa"]);
		expect(
			projectTask(
				intent,
				record,
				DIFF,
				record.intent_ref.content_hash,
				["plugins/immune-brain/runtime/kernel/completion.ts"],
			).next_obligation,
		).toBe("run_review");
	});

	test("declared critical raises Review without requiring final user authorization", () => {
		const [intent, record] = fixture("critical", ["qa", "review"]);
		expect(
			projectTask(intent, record, DIFF, record.intent_ref.content_hash, ["src/app.ts"]).next_obligation,
		).toBe("complete");
	});

	test("declared routine cannot suppress a listed path", () => {
		const [intent, record] = fixture("routine", ["qa"]);
		expect(
			projectTask(
				intent,
				record,
				DIFF,
				record.intent_ref.content_hash,
				["docs/specs/other.spec.md"],
			).next_obligation,
		).toBe("run_review");
	});

	test("another task Spec remains Material while own sidecars stay excluded", () => {
		const scope = [
			"docs/plans/obligation-routine.intent.json",
			"docs/plans/archive/obligation-routine.intent.json",
			"docs/specs/task.spec.md",
			"docs/specs/archive/task.spec.md",
		];
		const [intent, record] = fixture("routine", ["qa"], scope);
		expect(
			projectTask(intent, record, DIFF, record.intent_ref.content_hash, [...scope, "docs/specs/other.spec.md"])
				.next_obligation,
		).toBe("run_review");
	});

	test("adding a listed path after Routine QA projects Review", () => {
		const [intent, record] = fixture("routine", ["qa"]);
		expect(
			projectTask(intent, record, DIFF, record.intent_ref.content_hash, ["src/app.ts"]).next_obligation,
		).toBe("complete");
		expect(
			projectTask(
				intent,
				record,
				DIFF,
				record.intent_ref.content_hash,
				["src/app.ts", "plugins/immune-brain/runtime/kernel/completion.ts"],
			).next_obligation,
		).toBe("run_review");
	});

	test("ambiguous bound Spec pairs fail closed", () => {
		const scope = [
			"docs/specs/one.spec.md",
			"docs/specs/archive/one.spec.md",
			"docs/specs/two.spec.md",
			"docs/specs/archive/two.spec.md",
		];
		const [intent, record] = fixture("routine", ["qa"], scope);
		expect(() => projectTask(intent, record, DIFF, record.intent_ref.content_hash, scope)).toThrow(
			/at most one scope-bound Spec/,
		);
	});

	test("complete rejects routine QA when trusted changed paths floor to material", () => {
		const [, raw] = fixture("routine", ["qa"]);
		const record = parseTaskRecordV4(raw);
		const action = {
			type: "complete",
			event_id: "ev-complete-floor",
			at: "2026-08-12T00:00:00.000Z",
			actor_id: "executor-1",
			expected_record_hash: canonicalRecordHash(record),
			expected_workspace_hash: `sha256:${"b".repeat(64)}`,
			diff_hash: DIFF,
		} as TaskAction;
		expect(() => reduceTask(record, action)).toThrow(/complete requires trusted changed paths/);
		expect(() =>
			reduceTask(record, action, null, ["plugins/immune-brain/runtime/kernel/completion.ts"]),
		).toThrow(/not eligible for completion/);
		expect(reduceTask(record, action, null, ["src/app.ts"]).record.lifecycle).toBe("done");
	});

	test("a v3-contract record is rejected at the live reducer instead of completing", () => {
		const [, v4Raw] = fixture("routine", ["qa"]);
		const { git_base_head: _gitBaseHead, ...v3Shape } = v4Raw as Record<string, unknown> & {
			git_base_head: string;
		};
		const raw = { ...v3Shape, contract: "assurance_kernel/task_record/v3" };
		const action = {
			type: "complete",
			event_id: "ev-complete-v3-rejected",
			at: "2026-08-12T00:00:00.000Z",
			actor_id: "executor-1",
			expected_record_hash: canonicalRecordHash(v4Raw),
			expected_workspace_hash: `sha256:${"b".repeat(64)}`,
			diff_hash: DIFF,
		} as TaskAction;
		expect(() => reduceTask(raw as unknown as TaskRecordV4, action, null, ["src/app.ts"])).toThrow(
			new RegExp(`contract must equal assurance_kernel/task_record/v4`),
		);
	});
});
