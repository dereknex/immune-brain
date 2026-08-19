// 2026-08-13-018 acc-user-approval-authority-bound.
// The user-kind approval payload and capability are bound to the fresh
// projection; userOperationFor returns the record_user_approval op; the
// reducer path enforces kind user, user authority, phase review, matching
// revision/hash/diff, and no duplicate ids; the ordinary tool schema stays
// closed to record_user_approval.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { userOperationFor } from "../plugins/immune-brain/.pi-extension/imm-canary-work.ts";
import { capabilityActionFor, createCanaryApplication } from "../plugins/immune-brain/runtime/kernel/canary_application";
import { createMutationAuthorityRegistry, digestOfAction } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { createMutationAuthorityCapabilityForTest } from "./fixtures/mutation-authority-test-seam";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { createEnrollmentAuthorityRegistry, type EnrollmentCapabilityBinding } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash, parseTaskIntentV1, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { readTaskRecordV2 } from "../plugins/immune-brain/runtime/kernel/storage";

const TASK = "canary-user-authority-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "user authority binding",
	acceptance: [{ id: "A1", assertion: "a1", verification: "true" }],
	scope_hint: ["plugins/immune-brain/.pi-extension"],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;
const INTENT_HASH = canonicalIntentHash(parseTaskIntentV1(INTENT));
const DIFF = "sha256:" + "b".repeat(64);

function makeReviewRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "uaw-auth-"));
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(
		join(root, "docs", "plans", `${TASK}.intent.json`),
		JSON.stringify(INTENT, null, 2) + "\n",
	);
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "intent"], { cwd: root });
	writeFileSync(
		join(root, ".imm", "workspace.json"),
		JSON.stringify(
			{ contract: "assurance_kernel/workspace/v1", current_working: null },
			null,
			2,
		) + "\n",
	);
	const registry = createEnrollmentAuthorityRegistry();
	const prep = preparePiCanary(root, { task_id: TASK, now: "2026-08-12T10:00:00.000Z" });
	const binding: EnrollmentCapabilityBinding = {
		task_id: TASK,
		intent_path: `docs/plans/${TASK}.intent.json`,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		preparation_digest: prep.digest,
		readiness_digest: "sha256:none",
		evidence_digest: "sha256:none",
		waiver_gate: "observation_window_days",
		actor_id: "user",
		confirmation_ref: "c",
		expires_at: "2099-01-01T00:00:00.000Z",
		nonce: "n",
	};
	enrollCanaryTask(
		root,
		{
			task_id: TASK,
			intent_path: `docs/plans/${TASK}.intent.json`,
			intent_revision: 1,
			preparation_digest: binding.preparation_digest,
			capability: registry.issue(binding),
			capability_binding: binding,
			now: "2026-08-12T10:00:00.000Z",
		},
		registry,
	);
	const mutationRegistry = createMutationAuthorityRegistry();
	const app = createCanaryApplication(mutationRegistry);
	const token = () => readTaskIntent(root, TASK).token;
	app.execute({
		root,
		task_id: TASK,
		operation: { op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "ok", actor_id: "executor-1" },
		prior_intent_token: token(),
		diffProvider: () => DIFF,
		now: "2026-08-12T10:00:01.000Z",
	});
	app.execute({
		root,
		task_id: TASK,
		operation: { op: "submit_review", actor_id: "executor-1" },
		prior_intent_token: token(),
		diffProvider: () => DIFF,
		now: "2026-08-12T10:00:02.000Z",
	});
	return root;
}

function approvalFixture(overrides: Record<string, unknown> = {}) {
	return {
		id: "approval-user-test",
		kind: "user",
		authority_role: "user",
		task_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: DIFF,
		actor_id: "literal-user",
		summary: "literal user approval",
		...overrides,
	};
}

function userCapability(
	mutationRegistry: ReturnType<typeof createMutationAuthorityRegistry>,
	root: string,
	action: Record<string, unknown>,
	overrides: Record<string, unknown> = {},
) {
	const record = readTaskRecordV2(root, TASK);
	return createMutationAuthorityCapabilityForTest(mutationRegistry, {
		authority_kind: "user",
		task_id: TASK,
		action_digest: digestOfAction(action as never),
		expected_record_hash: record.revision,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: DIFF,
		actor_id: "literal-user",
		confirmation_ref: "conf-user",
		expires_at: "2099-01-01T00:00:00.000Z",
		findings_digest: null,
		...overrides,
	});
}

describe("user approval authority binding", () => {
	test("userOperationFor returns the record_user_approval op with the payload", () => {
		const approval = approvalFixture();
		expect(userOperationFor("record-user-approval", approval)).toEqual({
			op: "record_user_approval",
			approval,
		});
		expect(() => userOperationFor("record-user-approval")).toThrow(/approval payload/);
	});

	test("capabilityActionFor builds the canonical record_user_approval action carrying the approval", () => {
		const approval = approvalFixture();
		const action = capabilityActionFor({
			op: "record_user_approval",
			task_id: TASK,
			at: "2026-08-12T10:00:03.000Z",
			actor_id: "literal-user",
			approval,
		}) as unknown as Record<string, unknown>;
		expect(action.type).toBe("record_user_approval");
		expect(action.approval).toEqual(approval);
		// Deterministic digest over the same payload.
		expect(digestOfAction(action as never)).toBe(
			digestOfAction(
				capabilityActionFor({
					op: "record_user_approval",
					task_id: TASK,
					at: "2026-08-12T10:00:03.000Z",
					actor_id: "literal-user",
					approval,
				}) as never,
			),
		);
	});

	test("user-kind capability applies record_user_approval on a review-phase record", () => {
		const root = makeReviewRoot();
		try {
			const mutationRegistry = createMutationAuthorityRegistry();
			const app = createCanaryApplication(mutationRegistry);
			const approval = approvalFixture();
			const action = capabilityActionFor({
				op: "record_user_approval",
				task_id: TASK,
				at: "2026-08-12T10:00:03.000Z",
				actor_id: "literal-user",
				approval,
			});
			const capability = userCapability(mutationRegistry, root, action as never);
			const result = app.execute({
				root,
				task_id: TASK,
				operation: { op: "record_user_approval", capability, approval, actor_id: "literal-user" },
				prior_intent_token: readTaskIntent(root, TASK).token,
				diffProvider: () => DIFF,
				now: "2026-08-12T10:00:03.000Z",
			});
			expect(result.record.approvals.filter((a) => a.kind === "user")).toHaveLength(1);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("non-user kind and non-user authority are rejected with zero writes", () => {
		const root = makeReviewRoot();
		try {
			const mutationRegistry = createMutationAuthorityRegistry();
			const app = createCanaryApplication(mutationRegistry);
			const approval = approvalFixture({ kind: "qa" as const });
			const action = capabilityActionFor({
				op: "record_user_approval",
				task_id: TASK,
				at: "2026-08-12T10:00:03.000Z",
				actor_id: "literal-user",
				approval,
			});
			const capability = userCapability(mutationRegistry, root, action as never);
			expect(() =>
				app.execute({
					root,
					task_id: TASK,
					operation: { op: "record_user_approval", capability, approval, actor_id: "literal-user" },
					prior_intent_token: readTaskIntent(root, TASK).token,
					diffProvider: () => DIFF,
					now: "2026-08-12T10:00:03.000Z",
				}),
			).toThrow(/kind user/);
			expect(readTaskRecordV2(root, TASK).record?.approvals).toHaveLength(0);

			// Correct kind but a review-authority capability is rejected.
			const good = approvalFixture();
			const action2 = capabilityActionFor({
				op: "record_user_approval",
				task_id: TASK,
				at: "2026-08-12T10:00:04.000Z",
				actor_id: "reviewer-1",
				approval: good,
			});
			const wrongAuthority = createMutationAuthorityCapabilityForTest(mutationRegistry, {
				authority_kind: "review",
				task_id: TASK,
				action_digest: digestOfAction(action2 as never),
				expected_record_hash: readTaskRecordV2(root, TASK).revision,
				intent_revision: 1,
				intent_content_hash: INTENT_HASH,
				diff_hash: DIFF,
				actor_id: "reviewer-1",
				confirmation_ref: "conf-review",
				expires_at: "2099-01-01T00:00:00.000Z",
				findings_digest: null,
			});
			expect(() =>
				app.execute({
					root,
					task_id: TASK,
					operation: { op: "record_user_approval", capability: wrongAuthority, approval: good, actor_id: "reviewer-1" },
					prior_intent_token: readTaskIntent(root, TASK).token,
					diffProvider: () => DIFF,
					now: "2026-08-12T10:00:04.000Z",
				}),
			).toThrow(/user authority/);
			expect(readTaskRecordV2(root, TASK).record?.approvals).toHaveLength(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("hash mismatch is rejected; duplicate id is rejected", () => {
		const root = makeReviewRoot();
		try {
			const mutationRegistry = createMutationAuthorityRegistry();
			const app = createCanaryApplication(mutationRegistry);
			const approval = approvalFixture({ intent_content_hash: `sha256:${"c".repeat(64)}` });
			const action = capabilityActionFor({
				op: "record_user_approval",
				task_id: TASK,
				at: "2026-08-12T10:00:03.000Z",
				actor_id: "literal-user",
				approval,
			});
			const capability = userCapability(mutationRegistry, root, action as never);
			expect(() =>
				app.execute({
					root,
					task_id: TASK,
					operation: { op: "record_user_approval", capability, approval, actor_id: "literal-user" },
					prior_intent_token: readTaskIntent(root, TASK).token,
					diffProvider: () => DIFF,
					now: "2026-08-12T10:00:03.000Z",
				}),
			).toThrow(/intent_content_hash/);
			expect(readTaskRecordV2(root, TASK).record?.approvals).toHaveLength(0);

			// Duplicate id on a second apply is rejected after the first commits.
			const good = approvalFixture();
			const action2 = capabilityActionFor({
				op: "record_user_approval",
				task_id: TASK,
				at: "2026-08-12T10:00:04.000Z",
				actor_id: "literal-user",
				approval: good,
			});
			const cap1 = userCapability(mutationRegistry, root, action2 as never);
			app.execute({
				root,
				task_id: TASK,
				operation: { op: "record_user_approval", capability: cap1, approval: good, actor_id: "literal-user" },
				prior_intent_token: readTaskIntent(root, TASK).token,
				diffProvider: () => DIFF,
				now: "2026-08-12T10:00:04.000Z",
			});
			// Same approval id but a distinct event: the reducer rejects the
			// duplicate approval id (not a replay).
			const action3 = capabilityActionFor({
				op: "record_user_approval",
				task_id: TASK,
				at: "2026-08-12T10:00:05.000Z",
				actor_id: "literal-user",
				approval: good,
			});
			const cap2 = createMutationAuthorityCapabilityForTest(mutationRegistry, {
				authority_kind: "user",
				task_id: TASK,
				action_digest: digestOfAction(action3 as never),
				expected_record_hash: readTaskRecordV2(root, TASK).revision,
				intent_revision: 1,
				intent_content_hash: INTENT_HASH,
				diff_hash: DIFF,
				actor_id: "literal-user",
				confirmation_ref: "conf-user-2",
				expires_at: "2099-01-01T00:00:00.000Z",
				findings_digest: null,
			});
			expect(() =>
				app.execute({
					root,
					task_id: TASK,
					operation: { op: "record_user_approval", capability: cap2, approval: good, actor_id: "literal-user" },
					prior_intent_token: readTaskIntent(root, TASK).token,
					diffProvider: () => DIFF,
					now: "2026-08-12T10:00:05.000Z",
				}),
			).toThrow(/duplicate/);
			expect(readTaskRecordV2(root, TASK).record?.approvals.filter((a) => a.kind === "user")).toHaveLength(1);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
