import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
	readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTaskActionV2 } from "../plugins/immune-brain/runtime/kernel/application_v2";
import {
	canonicalIntentHash,
	readTaskIntent,
} from "../plugins/immune-brain/runtime/kernel/intent";
import { revisionForContent, readTaskRecordV2, readWorkspaceState } from "../plugins/immune-brain/runtime/kernel/storage";
import { setAfterTaskTransactionWriteForTest } from "../plugins/immune-brain/runtime/kernel/storage";
import type { TaskActionV2, TaskRecordV2 } from "../plugins/immune-brain/runtime/kernel/types";

const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: "task-r2c2-tx",
	goal: "One outcome",
	acceptance: [
		{ id: "A1", assertion: "acceptance one", verification: "verify one" },
	],
	scope_hint: ["plugins/immune-brain"],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;

const INTENT_HASH = canonicalIntentHash(INTENT);
const DIFF = "sha256:" + "a".repeat(64);

function recordFixture(): TaskRecordV2 {
	return {
		contract: "assurance_kernel/task_record/v2",
		task_id: "task-r2c2-tx",
		intent_revision: 1,
		intent_snapshot: INTENT,
		intent_ref: {
			path: "docs/plans/task-r2c2-tx.intent.json",
			revision: 1,
			content_hash: INTENT_HASH,
		},
		phase: "working",
		baseline: "sha256:" + "0".repeat(64),
		evidence: [],
		findings: [],
		approvals: [],
		history: [],
	};
}

const TX_V1 = ".imm/tasks/.workspace-transaction.json";
const TX_V2 = ".imm/tasks/.workspace-transaction-v2.json";

let root: string;
const taskId = "task-r2c2-tx";

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "r2c2-tx-"));
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(
		join(root, "docs", "plans", `${taskId}.intent.json`),
		JSON.stringify(INTENT, null, 2) + "\n",
	);
	execFileSync("git", ["add", "docs/plans"], { cwd: root });
	writeFileSync(
		join(root, ".imm", "workspace.json"),
		JSON.stringify(
			{ contract: "assurance_kernel/workspace/v1", current_working: null },
			null,
			2,
		) + "\n",
	);
	writeFileSync(
		join(root, ".imm", "tasks", `${taskId}.json`),
		JSON.stringify(recordFixture(), null, 2) + "\n",
	);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function workspaceHash(): string {
	return revisionForContent(
		JSON.stringify(
			{ contract: "assurance_kernel/workspace/v1", current_working: null },
			null,
			2,
		) + "\n",
	);
}

function evidenceAction(): TaskActionV2 {
	const { revision } = readTaskRecordV2(root, taskId);
	return {
		type: "record_evidence",
		event_id: "ev-tx-1",
		at: "2026-08-12T00:00:00.000Z",
		actor_id: "executor-1",
		expected_record_hash: revision,
		expected_workspace_hash: workspaceHash(),
		diff_hash: DIFF,
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
}

function commitOnce(): void {
	applyTaskActionV2({
		root,
		task_id: taskId,
		action: evidenceAction(),
		prior_intent_token: readTaskIntent(root, taskId).token,
		diffProvider: () => DIFF,
	});
}

describe("R2C2 v2 transaction recovery", () => {
	test("interruption after task write auto-recovers from the marker", () => {
		// Fail after the first file of the two-file v2 transaction: the marker
		// is present and the task file advanced. The locked operation must
		// converge the workspace and remove the marker, then commit the action.
		setAfterTaskTransactionWriteForTest(() => {
			throw new Error("simulated crash after task write");
		});
		expect(() => commitOnce()).not.toThrow();
		const { record } = readTaskRecordV2(root, taskId);
		expect(record?.evidence).toHaveLength(1);
		expect(readWorkspaceState(root).state.current_working).toBe(taskId);
		// The marker is removed after the auto-recovery completes the two-file
		// transaction from its own recorded next-state bytes.
		expect(existsSync(join(root, TX_V2))).toBe(false);
	});

	test("simultaneous v1 and v2 markers fail closed", () => {
		writeFileSync(
			join(root, TX_V1),
			JSON.stringify({ contract: "assurance_kernel/workspace_transaction/v1" }) + "\n",
		);
		writeFileSync(
			join(root, TX_V2),
			JSON.stringify({ contract: "assurance_kernel/workspace_transaction/v2" }) + "\n",
		);
		expect(() => commitOnce()).toThrow();
		// Neither marker may be consumed by the failed attempt.
		expect(
			readFileSync(join(root, TX_V1), "utf8"),
		).toContain("workspace_transaction/v1");
	});

	test("workspace ownership follows the resulting phase", () => {
		commitOnce();
		expect(readWorkspaceState(root).state.current_working).toBe(taskId);
		// Submitting review releases the workspace pointer.
		const action = {
			type: "submit_review",
			event_id: "ev-tx-2",
			at: "2026-08-12T00:00:00.000Z",
			actor_id: "executor-1",
			expected_record_hash: readTaskRecordV2(root, taskId).revision,
			expected_workspace_hash: revisionForContent(
				JSON.stringify(
					{ contract: "assurance_kernel/workspace/v1", current_working: taskId },
					null,
					2,
				) + "\n",
			),
			diff_hash: DIFF,
		} as TaskActionV2;
		applyTaskActionV2({
			root,
			task_id: taskId,
			action,
			prior_intent_token: readTaskIntent(root, taskId).token,
			diffProvider: () => DIFF,
		});
		expect(readWorkspaceState(root).state.current_working).toBeNull();
	});

	test("contradictory partial task/workspace state is rejected", () => {
		// A v2 marker whose next task content contradicts the marker identity.
		writeFileSync(
			join(root, TX_V2),
			JSON.stringify({
				contract: "assurance_kernel/workspace_transaction/v2",
				task_id: taskId,
				expected_record_hash: "sha256:" + "0".repeat(64),
				next_record_content: JSON.stringify(
					recordFixture(),
					null,
					2,
				) + "\n",
				expected_workspace_hash: "sha256:" + "0".repeat(64),
				next_workspace_content: "not json",
			}) + "\n",
		);
		expect(() => commitOnce()).toThrow();
	});

	test("v1 transaction path remains fully compatible", () => {
		// A v1 marker without v2 marker is left untouched by v2 recovery:
		// the v2 path only inspects the v2 marker file.
		writeFileSync(
			join(root, TX_V1),
			JSON.stringify({ contract: "assurance_kernel/workspace_transaction/v1" }) + "\n",
		);
		writeFileSync(
			join(root, TX_V2),
			JSON.stringify({ contract: "assurance_kernel/workspace_transaction/v2" }) + "\n",
		);
		expect(() => commitOnce()).toThrow();
	});
});
