// A critical-risk task with host-attested QA, Review, and user approval is
// eligible for terminal completion with a tombstone and released ownership.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCanaryApplication, capabilityActionFor } from "../plugins/immune-brain/runtime/kernel/canary_application";
import { createMutationAuthorityRegistry, digestOfAction } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { createMutationAuthorityCapabilityForTest } from "./fixtures/mutation-authority-test-seam";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { createEnrollmentAuthorityRegistry, type EnrollmentCapabilityBinding } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash, parseTaskIntentV1, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { readTaskRecord } from "../plugins/immune-brain/runtime/kernel/storage";
import { readBackendClaim, readTaskTombstone } from "../plugins/immune-brain/runtime/kernel/backend_claim";
import { completionDecision } from "../plugins/immune-brain/runtime/kernel/completion";
import type { TaskApprovalV2 } from "../plugins/immune-brain/runtime/kernel/types";

const TASK = "canary-critical-completion-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "critical completion",
	acceptance: [
		{ id: "A1", assertion: "a1", verification: "true" },
		{ id: "A2", assertion: "a2", verification: "true" },
	],
	scope_hint: [
		"plugins/immune-brain/.pi-extension",
		"docs/specs/canary-critical-completion-task.spec.md",
		"docs/specs/archive/canary-critical-completion-task.spec.md",
	],
	risk: "critical",
	revision: 1,
	owner: "user",
} as const;
const INTENT_HASH = canonicalIntentHash(parseTaskIntentV1(INTENT));
const DIFF = "sha256:" + "d".repeat(64);

function makeRoot(): { root: string; mutationRegistry: ReturnType<typeof createMutationAuthorityRegistry>; app: ReturnType<typeof createCanaryApplication> } {
	const root = mkdtempSync(join(tmpdir(), "uaw-complete-"));
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, "docs", "specs"), { recursive: true });
	mkdirSync(join(root, ".imm/state"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(
		join(root, "docs", "plans", `${TASK}.intent.json`),
		JSON.stringify(INTENT, null, 2) + "\n",
	);
	writeFileSync(join(root, "docs", "specs", `${TASK}.spec.md`), "# Critical completion\n");
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
	return { root, mutationRegistry, app };
}

function approvalFixture(kind: "qa" | "review" | "user", id: string, actorId: string, role: string): TaskApprovalV2 {
	return {
		id,
		kind,
		authority_role: role,
		task_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: DIFF,
		actor_id: actorId,
		summary: `${kind} approval`,
	};
}

function bindReviewApproval(root: string, approval: TaskApprovalV2): TaskApprovalV2 {
	const record = readTaskRecord(root, TASK).record;
	if (!record || record.contract !== "assurance_kernel/task_record/v4")
		throw new Error("review fixture requires TaskRecord v4");
	const tree = execFileSync("git", ["rev-parse", `${record.git_base_head}^{tree}`], { cwd: root, encoding: "utf8" }).trim();
	return {
		...approval,
		review_revision: {
			contract: "assurance_kernel/review_revision_identity/v1",
			base_head: record.git_base_head,
			review_commit: record.git_base_head,
			review_tree: tree,
			manifest_digest: `sha256:${"e".repeat(64)}`,
		},
	};
}

function capabilityFor(
	mutationRegistry: ReturnType<typeof createMutationAuthorityRegistry>,
	root: string,
	authorityKind: "qa" | "review" | "user",
	actionKind: "record_approval" | "record_user_approval",
	approval: TaskApprovalV2,
	at: string,
) {
	const action = capabilityActionFor({
		op: actionKind,
		task_id: TASK,
		at,
		actor_id: approval.actor_id,
		approval,
	});
	return createMutationAuthorityCapabilityForTest(mutationRegistry, {
		authority_kind: authorityKind,
		task_id: TASK,
		action_digest: digestOfAction(action as never),
		expected_record_hash: readTaskRecord(root, TASK).revision,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: DIFF,
		actor_id: approval.actor_id,
		confirmation_ref: `conf-${approval.id}`,
		expires_at: "2099-01-01T00:00:00.000Z",
		findings_digest: null,
	});
}

describe("critical completion is reachable with qa+review+user approvals", () => {
	test("full journey working -> review -> done with tombstone and released ownership", () => {
		const { root, mutationRegistry, app } = makeRoot();
		try {
			const token = () => readTaskIntent(root, TASK, readTaskRecord(root, TASK).record!.intent_ref.path).token;
			app.execute({
				root,
				task_id: TASK,
				operation: { op: "freeze_artifacts", actor_id: "executor-1" },
				prior_intent_token: token(),
				diffProvider: () => ({ diff_hash: DIFF, changed_paths: [] as const }),
				now: "2026-08-12T10:00:03.000Z",
			});
			execFileSync("git", ["add", "-A"], { cwd: root });

			// Without the user approval the task is not eligible.
			const qaApproval = approvalFixture("qa", "approval-qa", "qa-child-1", "qa");
			const reviewApproval = bindReviewApproval(root, approvalFixture("review", "approval-review", "review-child-1", "reviewer"));
			const qaCap = capabilityFor(mutationRegistry, root, "qa", "record_approval", qaApproval, "2026-08-12T10:00:04.000Z");
			app.execute({
				root,
				task_id: TASK,
				operation: { op: "record_approval", capability: qaCap, approval: qaApproval, actor_id: qaApproval.actor_id },
				prior_intent_token: token(),
				diffProvider: () => ({ diff_hash: DIFF, changed_paths: [] as const }),
				now: "2026-08-12T10:00:04.000Z",
			});
			const reviewCap = capabilityFor(mutationRegistry, root, "review", "record_approval", reviewApproval, "2026-08-12T10:00:05.000Z");
			app.execute({
				root,
				task_id: TASK,
				operation: { op: "record_approval", capability: reviewCap, approval: reviewApproval, actor_id: reviewApproval.actor_id },
				prior_intent_token: token(),
				diffProvider: () => ({ diff_hash: DIFF, changed_paths: [] as const }),
				now: "2026-08-12T10:00:05.000Z",
			});

			const intentRead = { intent: INTENT };
			const before = completionDecision(intentRead.intent, readTaskRecord(root, TASK).record!, DIFF, INTENT_HASH);
			expect(before.missing_approval_kinds).toEqual(["user"]);
			expect(before.complete).toBe(false);
			expect(() =>
				app.execute({
					root,
					task_id: TASK,
					operation: { op: "complete", actor_id: "executor-1" },
					prior_intent_token: token(),
					diffProvider: () => ({ diff_hash: DIFF, changed_paths: [] as const }),
					now: "2026-08-12T10:00:06.000Z",
				}),
			).toThrow(/not eligible/);

			// Record the user approval through the wired surface.
			const userApproval = approvalFixture("user", "approval-user", "literal-user", "user");
			const userCap = capabilityFor(mutationRegistry, root, "user", "record_user_approval", userApproval, "2026-08-12T10:00:07.000Z");
			app.execute({
				root,
				task_id: TASK,
				operation: { op: "record_user_approval", capability: userCap, approval: userApproval, actor_id: userApproval.actor_id },
				prior_intent_token: token(),
				diffProvider: () => ({ diff_hash: DIFF, changed_paths: [] as const }),
				now: "2026-08-12T10:00:07.000Z",
			});

			const after = completionDecision(INTENT, readTaskRecord(root, TASK).record!, DIFF, INTENT_HASH);
			expect(after.complete).toBe(true);
			expect(after.missing_approval_kinds).toEqual([]);

			const done = app.execute({
				root,
				task_id: TASK,
				operation: { op: "complete", actor_id: "executor-1" },
				prior_intent_token: token(),
				diffProvider: () => ({ diff_hash: DIFF, changed_paths: [] as const }),
				now: "2026-08-12T10:00:08.000Z",
			});
			expect(done.record.lifecycle).toBe("done");
			// Terminal ownership transfer: claim removed, tombstone created,
			// workspace pointer released.
			expect(readBackendClaim(root)).toBeNull();
			const tombstone = readTaskTombstone(root, TASK);
			expect(tombstone?.terminal_lifecycle).toBe("done");
			expect(tombstone?.final_record_hash).toBe(done.revision);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
