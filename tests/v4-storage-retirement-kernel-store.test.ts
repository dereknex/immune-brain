// v4 storage retirement — acc-v2-store-only.
// All production Kernel task and workspace mutations use TaskRecord v2 plus
// workspace_transaction/v2 under the existing locks and content-hash CAS.
// TaskRecord v1 and workspace_transaction/v1 entry points are absent from the
// production export and call graph, and unresolved v1 transaction markers fail
// closed.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as kernel from "../plugins/immune-brain/runtime/kernel/index";
import * as storage from "../plugins/immune-brain/runtime/kernel/storage";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";

function makeRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "v4-store-"));
	mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	return root;
}

function gitInit(root: string): void {
	const { execFileSync } = require("node:child_process");
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
	execFileSync("git", ["commit", "-qm", "fixture"], {
		cwd: root,
		stdio: "ignore",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "t",
			GIT_AUTHOR_EMAIL: "t@t",
			GIT_COMMITTER_NAME: "t",
			GIT_COMMITTER_EMAIL: "t@t",
		},
	});
}

function writeIntent(root: string, taskId: string): void {
	const intent = {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		owner: "user",
		goal: "store contract",
		acceptance: [{ id: "A1", assertion: "a1", verification: "bun test true" }],
		scope_hint: ["plugins/immune-brain"],
		risk: "routine",
		revision: 1,
	};
	writeFileSync(
		join(root, "docs", "plans", `${taskId}.intent.json`),
		`${JSON.stringify(intent, null, 2)}\n`,
	);
	gitInit(root);
}

describe("v4 store only", () => {
	test("v1 storage entry points are absent from the kernel index", () => {
		// v1 transaction/parser helpers are no longer exported from the
		// kernel public index; only v2 read/commit primitives remain.
		const keys = Object.keys(kernel);
		for (const v1 of [
			"writeTaskRecord",
			"applyTaskAction",
			"readTaskRecord",
			"readWorkspaceState",
			"readPendingTransaction",
			"completeTransactionLocked",
			"commitTaskAndWorkspaceLocked",
		]) {
			expect(keys).not.toContain(v1);
		}
	});

	test("production store lock recovery fails closed on an unresolved v1 marker", () => {
		const root = makeRoot();
		const taskId = "task-v1-marker";
		writeIntent(root, taskId);
		writeFileSync(
			join(root, ".imm/tasks/.workspace-transaction.json"),
			JSON.stringify({
				contract: "assurance_kernel/workspace_transaction/v1",
				task_id: taskId,
				expected_task_revision: "missing",
				next_task_content: "{}",
				expected_workspace_revision: "missing",
				next_workspace_content: "{}",
			}),
		);
		const registry = createEnrollmentAuthorityRegistry();
		const prep = preparePiCanary(root, {
			task_id: taskId,
			now: "2026-08-12T00:00:00.000Z",
		});
		const binding: EnrollmentCapabilityBinding = {
			task_id: taskId,
			intent_path: `docs/plans/${taskId}.intent.json`,
			intent_revision: 1,
			intent_content_hash: prep.intent?.content_hash ?? "",
			preparation_digest: prep.digest,
			readiness_digest: "sha256:none",
			evidence_digest: "sha256:none",
			waiver_gate: "observation_window_days",
			actor_id: "user",
			confirmation_ref: "c",
			expires_at: "2099-01-01T00:00:00.000Z",
			nonce: "n",
		};
		expect(() =>
			enrollCanaryTask(
				root,
				{
					task_id: taskId,
					intent_path: `docs/plans/${taskId}.intent.json`,
					intent_revision: 1,
					preparation_digest: prep.digest,
					capability: registry.issue(binding),
					capability_binding: binding,
					now: "2026-08-12T00:00:00.000Z",
				},
				registry,
			),
		).toThrow(/retired|workspace_transaction\/v1/);
	});

	test("v2-only enrollment works without any v1 marker", () => {
		const root = makeRoot();
		const taskId = "task-v2-only";
		writeIntent(root, taskId);
		const registry = createEnrollmentAuthorityRegistry();
		const prep = preparePiCanary(root, {
			task_id: taskId,
			now: "2026-08-12T00:00:00.000Z",
		});
		const binding: EnrollmentCapabilityBinding = {
			task_id: taskId,
			intent_path: `docs/plans/${taskId}.intent.json`,
			intent_revision: 1,
			intent_content_hash: prep.intent?.content_hash ?? "",
			preparation_digest: prep.digest,
			readiness_digest: "sha256:none",
			evidence_digest: "sha256:none",
			waiver_gate: "observation_window_days",
			actor_id: "user",
			confirmation_ref: "c",
			expires_at: "2099-01-01T00:00:00.000Z",
			nonce: "n",
		};
		const result = enrollCanaryTask(
			root,
			{
				task_id: taskId,
				intent_path: `docs/plans/${taskId}.intent.json`,
				intent_revision: 1,
				preparation_digest: prep.digest,
				capability: registry.issue(binding),
				capability_binding: binding,
				now: "2026-08-12T00:00:00.000Z",
			},
			registry,
		);
		expect(result.record.contract).toBe("assurance_kernel/task_record/v2");
		expect(result.backend_claim.lifecycle_status).toBe("active");
		// No v1 marker was created.
		const { existsSync } = require("node:fs");
		expect(existsSync(join(root, ".imm/tasks/.workspace-transaction.json"))).toBe(false);
	});
});
