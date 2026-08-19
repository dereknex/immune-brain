// retire-kernel-v1-store acceptance checks.
// acc-v1-store-absent: reducer.ts is gone, storage.ts retains no v1
// read/write/apply/lock/recovery entry point, validation.ts exports no v1
// parseTaskIntent/parseTaskRecord, and the public index carries none of the
// v1 names.
// acc-v2-path-intact: the kernel index still exports every non-v1 symbol it
// exported before the retirement, and the live v2 store primitives remain
// callable.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as kernel from "../plugins/immune-brain/runtime/kernel/index";
import * as storage from "../plugins/immune-brain/runtime/kernel/storage";
import * as validation from "../plugins/immune-brain/runtime/kernel/validation";

const REPO_ROOT = join(__dirname, "..");

const V1_NAMES = [
	"completionDecision",
	"projectTask",
	"parseTaskIntent",
	"parseTaskRecord",
	"reduceTask",
	"writeTaskRecord",
	"applyTaskAction",
	"readTaskRecord",
	"readWorkspaceState",
	"readPendingTransaction",
	"completeTransactionLocked",
	"commitTaskAndWorkspaceLocked",
	"withKernelStoreLock",
] as const;

describe("acc-v1-store-absent", () => {
	test("kernel/reducer.ts does not exist", () => {
		expect(
			existsSync(join(REPO_ROOT, "plugins/immune-brain/runtime/kernel/reducer.ts")),
		).toBe(false);
	});

	test("storage.ts retains no v1 read, write, apply, lock, or transaction-recovery path", () => {
		const source = readFileSync(
			join(REPO_ROOT, "plugins/immune-brain/runtime/kernel/storage.ts"),
			"utf8",
		);
		for (const name of [
			"readTaskRecordRaw",
			"readPendingTransaction",
			"completeTransactionLocked",
			"recoverPendingTransactionLocked",
			"commitTaskAndWorkspaceLocked",
			"withKernelStoreLock",
			"readTaskRecord",
			"writeTaskRecord",
			"applyTaskAction",
			"readWorkspaceState",
		]) {
			expect(source).not.toMatch(new RegExp(`\\b${name}\\b`));
		}
	});

	test("validation.ts exports no v1 parseTaskIntent or parseTaskRecord", () => {
		const names = Object.keys(validation);
		expect(names).not.toContain("parseTaskIntent");
		expect(names).not.toContain("parseTaskRecord");
	});

	test("the retired v1 marker is the only v1 residue and fails closed", () => {
		const storageKeys = Object.keys(storage);
		expect(storageKeys).not.toContain("readPendingTransaction");
		expect(storageKeys).not.toContain("completeTransactionLocked");
		expect(storageKeys).not.toContain("commitTaskAndWorkspaceLocked");
		// v1 marker detection stays: recovery must reject it, not ignore it.
		expect(typeof storage.withKernelStoreLockV2).toBe("function");
		const source = readFileSync(
			join(REPO_ROOT, "plugins/immune-brain/runtime/kernel/storage.ts"),
			"utf8",
		);
		expect(source).toMatch(/workspace_transaction\/v1 is retired/);
	});
});

describe("acc-v2-path-intact", () => {
	test("the kernel index still exports every non-v1 symbol", () => {
		for (const name of [
			"readTaskIntent",
			"parseTaskIntentV1",
			"canonicalIntentHash",
			"classifyIntentRevision",
			"parseTaskRecordV2",
			"completionDecisionV2",
			"projectTaskV2",
			"assertKernelInvariantsV2",
			"reduceTaskV2",
			"canonicalRecordHashV2",
			"isReducedMutationV2",
			"mapLegacyState",
			"readTaskRecordV2",
			"readWorkspaceStateRaw",
			"withKernelStoreLockV2",
			"revisionForContent",
			"appendJournalEntry",
			"KernelStoreSecurityError",
			"KernelValidationError",
			"KernelInvariantError",
			"setAfterTaskTransactionWriteForTest",
		]) {
			expect(typeof (kernel as Record<string, unknown>)[name]).toBe("function");
		}
	});

	test("the v2 store primitives remain callable on a fresh root", () => {
		const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
		const { execFileSync } = require("node:child_process");
		const { tmpdir } = require("node:os");
		const root = mkdtempSync(join(tmpdir(), "v1-retire-"));
		mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
		mkdirSync(join(root, "docs", "plans"), { recursive: true });
		const taskId = "task-v1-retire-probe";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "probe",
			acceptance: [{ id: "A1", assertion: "a1", verification: "bun test true" }],
			scope_hint: ["plugins/immune-brain"],
			risk: "routine",
			revision: 1,
		};
		writeFileSync(
			join(root, "docs", "plans", `${taskId}.intent.json`),
			`${JSON.stringify(intent, null, 2)}\n`,
		);
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
		const { enrollCanaryTask } = require("../plugins/immune-brain/runtime/kernel/enrollment");
		const { createEnrollmentAuthorityRegistry } = require(
			"../plugins/immune-brain/runtime/kernel/enrollment_authority",
		);
		const { preparePiCanary } = require("../plugins/immune-brain/runtime/kernel/pi_canary_prepare");
		const prep = preparePiCanary(root, { task_id: taskId, now: "2026-08-12T00:00:00.000Z" });
		const registry = createEnrollmentAuthorityRegistry();
		const binding = {
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
		const read = storage.readTaskRecordV2(root, taskId);
		expect(read.record?.task_id).toBe(taskId);
		expect(
			storage.readWorkspaceStateRaw(root).state.current_working,
		).toBe(taskId);
		const fs = require("node:fs");
		fs.rmSync(root, { recursive: true, force: true });
	});
});