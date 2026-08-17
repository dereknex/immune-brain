import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTaskActionV2 } from "../plugins/immune-brain/runtime/kernel/application_v2";
import { createMutationAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { createMutationAuthorityCapabilityForTest } from "./fixtures/mutation-authority-test-seam";
import {
	canonicalIntentHash,
	readTaskIntent,
} from "../plugins/immune-brain/runtime/kernel/intent";
import { canonicalRecordHashV2 } from "../plugins/immune-brain/runtime/kernel/reducer_v2";
import { revisionForContent, readTaskRecordV2 } from "../plugins/immune-brain/runtime/kernel/storage";
import type {
	TaskActionV2,
	TaskRecordV2,
} from "../plugins/immune-brain/runtime/kernel/types";
import { KernelInvariantError } from "../plugins/immune-brain/runtime/kernel/validation";

const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: "task-r2c2-app",
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
		task_id: "task-r2c2-app",
		intent_revision: 1,
		intent_snapshot: INTENT,
		intent_ref: {
			path: "docs/plans/task-r2c2-app.intent.json",
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

let root: string;
let taskId = "task-r2c2-app";
let mutationRegistry: ReturnType<typeof createMutationAuthorityRegistry>;

beforeEach(() => {
	mutationRegistry = createMutationAuthorityRegistry();
	root = mkdtempSync(join(tmpdir(), "r2c2-app-"));
	taskId = "task-r2c2-app";
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
	// Git-tracked intent sidecar (tracking is required, clean status is not).
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(
		join(root, "docs", "plans", `${taskId}.intent.json`),
		JSON.stringify(INTENT, null, 2) + "\n",
	);
	execFileSync("git", ["add", "docs/plans"], { cwd: root });
	// Workspace state.
	writeFileSync(
		join(root, ".imm", "workspace.json"),
		JSON.stringify(
			{ contract: "assurance_kernel/workspace/v1", current_working: null },
			null,
			2,
		) + "\n",
	);
	// TaskRecord v2 fixture.
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

function currentRecordHash(): string {
	const { revision } = readTaskRecordV2(root, taskId);
	return revision;
}

function priorToken() {
	return readTaskIntent(root, taskId).token;
}

function evidenceAction(overrides: Partial<TaskActionV2> = {}): TaskActionV2 {
	return {
		type: "record_evidence",
		event_id: "ev-app-1",
		at: "2026-08-12T00:00:00.000Z",
		actor_id: "executor-1",
		expected_record_hash: currentRecordHash(),
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
		...overrides,
	} as TaskActionV2;
}

describe("R2C2 application v2 port", () => {
	test("commits an ordinary action with token consumption and workspace CAS", () => {
		const token = priorToken();
		let providerIntent: unknown;
		const result = applyTaskActionV2({
			root,
			task_id: taskId,
			action: evidenceAction(),
			prior_intent_token: token,
			registry: mutationRegistry,
			diffProvider: (_root, intent) => {
				providerIntent = intent;
				return DIFF;
			},
		});
		expect(providerIntent).toEqual(INTENT);
		expect(result.record.evidence).toHaveLength(1);
		expect(result.record.history).toHaveLength(1);
		expect(result.workspace.state.current_working).toBe(taskId);
		// Token is consumed: reusing it fails.
		expect(() =>
			applyTaskActionV2({
				root,
				task_id: taskId,
				action: evidenceAction({ event_id: "ev-app-2" }),
				prior_intent_token: token,
				registry: mutationRegistry,
				diffProvider: () => DIFF,
			}),
		).toThrow();
	});

	test("exact committed replay returns the snapshot without consuming a fresh token", () => {
		const token = priorToken();
		const action = evidenceAction();
		const first = applyTaskActionV2({
			root,
			task_id: taskId,
			action,
			prior_intent_token: token,
			registry: mutationRegistry,
			diffProvider: () => DIFF,
		});
		expect(first.record.evidence).toHaveLength(1);
		// Replay with a fresh token for the unchanged sidecar.
		const freshToken = priorToken();
		const replayed = applyTaskActionV2({
			root,
			task_id: taskId,
			action,
			prior_intent_token: freshToken,
			registry: mutationRegistry,
			diffProvider: () => DIFF,
		});
		expect(replayed.record.evidence).toHaveLength(1);
		expect(replayed.revision).toBe(first.revision);
	});

	test("stale record CAS fails closed without consuming the token", () => {
		const token = priorToken();
		const staleAction = evidenceAction({
			expected_record_hash: "sha256:" + "1".repeat(64),
		});
		expect(() =>
			applyTaskActionV2({
				root,
				task_id: taskId,
				action: staleAction,
				prior_intent_token: token,
				registry: mutationRegistry,
				diffProvider: () => DIFF,
			}),
		).toThrow(KernelInvariantError);
		// The token was not consumed by the failed attempt.
		const ok = applyTaskActionV2({
			root,
			task_id: taskId,
			action: evidenceAction(),
			prior_intent_token: token,
			registry: mutationRegistry,
			diffProvider: () => DIFF,
		});
		expect(ok.record.evidence).toHaveLength(1);
	});

	test("stale workspace CAS fails closed without consuming the token", () => {
		const token = priorToken();
		const staleAction = evidenceAction({
			expected_workspace_hash: "sha256:" + "2".repeat(64),
		});
		expect(() =>
			applyTaskActionV2({
				root,
				task_id: taskId,
				action: staleAction,
				prior_intent_token: token,
				registry: mutationRegistry,
				diffProvider: () => DIFF,
			}),
		).toThrow(KernelInvariantError);
		// Token not consumed: a corrected retry succeeds.
		const ok = applyTaskActionV2({
			root,
			task_id: taskId,
			action: evidenceAction(),
			prior_intent_token: token,
			registry: mutationRegistry,
			diffProvider: () => DIFF,
		});
		expect(ok.record.evidence).toHaveLength(1);
	});

	test("trusted diff provider is the only diff authority", () => {
		const token = priorToken();
		expect(() =>
			applyTaskActionV2({
				root,
				task_id: taskId,
				action: evidenceAction(),
				prior_intent_token: token,
				registry: mutationRegistry,
				diffProvider: () => "sha256:" + "b".repeat(64),
			}),
		).toThrow(KernelInvariantError);
	});

	test("A→B→A sidecar swap fails even when final bytes match", () => {
		const token = priorToken();
		// Replace the sidecar via unlink+rewrite so the inode changes, then
		// restore identical bytes.
		const sidecar = join(root, "docs", "plans", `${taskId}.intent.json`);
		rmSync(sidecar);
		writeFileSync(
			sidecar,
			JSON.stringify({ ...INTENT, revision: 2 }, null, 2) + "\n",
		);
		rmSync(sidecar);
		writeFileSync(sidecar, JSON.stringify(INTENT, null, 2) + "\n");
		expect(() =>
			applyTaskActionV2({
				root,
				task_id: taskId,
				action: evidenceAction(),
				prior_intent_token: token,
				registry: mutationRegistry,
				diffProvider: () => DIFF,
			}),
		).toThrow(KernelInvariantError);
	});

	test("privileged stop consumes an exact user capability", () => {
		const token = priorToken();
		const action = {
			type: "stop",
			event_id: "ev-stop-1",
			at: "2026-08-12T00:00:00.000Z",
			actor_id: "executor-1",
			expected_record_hash: currentRecordHash(),
			expected_workspace_hash: workspaceHash(),
			diff_hash: DIFF,
			reason: "complete enough",
		} as TaskActionV2;
		const capability = createMutationAuthorityCapabilityForTest(
			mutationRegistry,
			{
				authority_kind: "user",
				task_id: taskId,
				action_digest: require("node:crypto")
					.createHash("sha256")
					.update(
						JSON.stringify({
							...action,
							expected_record_hash: undefined,
							expected_workspace_hash: undefined,
							diff_hash: undefined,
						}),
					)
					.digest("hex"),
				expected_record_hash: currentRecordHash(),
				intent_revision: 1,
				intent_content_hash: INTENT_HASH,
				diff_hash: DIFF,
				actor_id: "user-1",
				confirmation_ref: "conf-stop",
				expires_at: "2099-01-01T00:00:00.000Z",
				findings_digest: null,
			},
		);
		const result = applyTaskActionV2({
			root,
			task_id: taskId,
			action,
			prior_intent_token: token,
			registry: mutationRegistry,
			capability,
			diffProvider: () => DIFF,
		});
		expect(result.record.phase).toBe("stopped");
		expect(result.record.history[0].authority).toBeDefined();
		expect(result.workspace.state.current_working).toBeNull();
	});

	test("privileged action without capability fails with zero writes", () => {
		const token = priorToken();
		const action = {
			type: "stop",
			event_id: "ev-stop-2",
			at: "2026-08-12T00:00:00.000Z",
			actor_id: "executor-1",
			expected_record_hash: currentRecordHash(),
			expected_workspace_hash: workspaceHash(),
			diff_hash: DIFF,
			reason: "stop",
		} as TaskActionV2;
		expect(() =>
			applyTaskActionV2({
				root,
				task_id: taskId,
				action,
				prior_intent_token: token,
				registry: mutationRegistry,
				diffProvider: () => DIFF,
			}),
		).toThrow();
		expect(existsSync(join(root, ".imm", "tasks", ".workspace-transaction-v2.json"))).toBe(false);
	});

	test("revise_intent applies a compatible revision through the port", () => {
		const token = priorToken();
		const nextIntent = {
			...INTENT,
			revision: 2,
			acceptance: [
				...INTENT.acceptance,
				{ id: "A2", assertion: "acceptance two", verification: "verify two" },
			],
		};
		const nextHash = canonicalIntentHash(nextIntent);
		// The sidecar on disk now carries revision 2.
		writeFileSync(
			join(root, "docs", "plans", `${taskId}.intent.json`),
			JSON.stringify(nextIntent, null, 2) + "\n",
		);
		const action = {
			type: "revise_intent",
			event_id: "ev-rev-1",
			at: "2026-08-12T00:00:00.000Z",
			actor_id: "executor-1",
			expected_record_hash: currentRecordHash(),
			expected_workspace_hash: workspaceHash(),
			diff_hash: DIFF,
			next_intent: nextIntent,
			next_intent_ref: {
				path: `docs/plans/${taskId}.intent.json`,
				revision: 2,
				content_hash: nextHash,
			},
		} as TaskActionV2;
		const result = applyTaskActionV2({
			root,
			task_id: taskId,
			action,
			prior_intent_token: token,
			registry: mutationRegistry,
			diffProvider: () => DIFF,
		});
		expect(result.record.intent_revision).toBe(2);
		expect(result.record.intent_ref.content_hash).toBe(nextHash);
	});
});
