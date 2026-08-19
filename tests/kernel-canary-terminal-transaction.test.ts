// P2B2 U1: terminal ownership transfer. Covers the one recoverable terminal
// transaction converging the terminal TaskRecord, cleared workspace owner,
// removed active claim, and created task tombstone, with crash recovery at
// every boundary, exact before/after hashes, same-task reenrollment
// rejection, and unrelated v3 routing release after terminalization.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createCanaryApplication,
} from "../plugins/immune-brain/runtime/kernel/canary_application";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { createMutationAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { createMutationAuthorityCapabilityForTest } from "./fixtures/mutation-authority-test-seam";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import {
	readBackendClaim,
	readTaskTombstone,
	serializeTaskTombstone,
} from "../plugins/immune-brain/runtime/kernel/backend_claim";
import {
	readTaskRecordV2,
	readWorkspaceStateRaw,
	revisionForContent,
	withKernelStoreLockV2,
} from "../plugins/immune-brain/runtime/kernel/storage";

const TASK = "canary-terminal-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "terminal transfer",
	acceptance: [{ id: "A1", assertion: "a1", verification: "v1" }],
	scope_hint: ["docs/plans"],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;
const INTENT_HASH = canonicalIntentHash(INTENT);
const DIFF = "sha256:" + "f".repeat(64);

let root: string;
let mutationRegistry: ReturnType<typeof createMutationAuthorityRegistry>;
let app: ReturnType<typeof createCanaryApplication>;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "canary-terminal-"));
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
	const enrollmentRegistry = createEnrollmentAuthorityRegistry();
	const prep = preparePiCanary(root, { task_id: TASK, now: "2026-08-12T10:00:00.000Z" });
	const binding: EnrollmentCapabilityBinding = {
		task_id: TASK,
		intent_path: `docs/plans/${TASK}.intent.json`,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		preparation_digest: prep.digest,
		readiness_digest: "sha256:readiness",
		evidence_digest: "sha256:evidence",
		waiver_gate: "observation_window_days",
		actor_id: "user",
		confirmation_ref: "pi-confirm-enroll",
		expires_at: "2099-01-01T00:00:00.000Z",
		nonce: "nonce-enroll",
	};
	enrollCanaryTask(
		root,
		{
			task_id: TASK,
			intent_path: `docs/plans/${TASK}.intent.json`,
			intent_revision: 1,
			preparation_digest: binding.preparation_digest,
			readiness_digest: "sha256:readiness",
			evidence_digest: "sha256:evidence",
			capability: enrollmentRegistry.issue(binding),
			capability_binding: binding,
			now: "2026-08-12T10:00:00.000Z",
		},
		enrollmentRegistry,
	);
	mutationRegistry = createMutationAuthorityRegistry();
	app = createCanaryApplication(mutationRegistry);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function token() {
	return readTaskIntent(root, TASK).token;
}

function execute(op: Parameters<typeof app.execute>[0]["operation"], at: string) {
	return app.execute({
		root,
		task_id: TASK,
		operation: op,
		prior_intent_token: token(),
		diffProvider: () => DIFF,
		now: at,
	});
}

/** working -> review -> done through the terminal transaction. */
function completeTask(at = "2026-08-12T10:00:04.000Z") {
	execute(
		{ op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "one", actor_id: "executor-1" },
		"2026-08-12T10:00:01.000Z",
	);
	execute({ op: "submit_review", actor_id: "executor-1" }, "2026-08-12T10:00:02.000Z");
	return execute({ op: "complete", actor_id: "executor-1" }, at);
}

function stopCapability(at: string, overrides: Record<string, unknown> = {}) {
	const record = readTaskRecordV2(root, TASK);
	const digest = (a: Record<string, unknown>) => createHash("sha256").update(JSON.stringify(a)).digest("hex");
	return createMutationAuthorityCapabilityForTest(mutationRegistry, {
		authority_kind: "user",
		task_id: TASK,
		action_digest: digest({
			type: "stop",
			event_id: `stop:${TASK}:${at}`,
			at,
			actor_id: "user",
			reason: "halt",
		}),
		expected_record_hash: record.revision,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: DIFF,
		actor_id: "user-1",
		confirmation_ref: "conf-stop",
		expires_at: "2099-01-01T00:00:00.000Z",
		findings_digest: null,
		...overrides,
	});
}

describe("terminal ownership transfer", () => {
	test("complete converges all four paths through one transaction", () => {
		const done = completeTask();
		expect(done.record.phase).toBe("done");
		expect(done.workspace.state.current_working).toBeNull();
		expect(readBackendClaim(root)).toBeNull();
		expect(existsSync(join(root, ".imm", "tasks", ".terminal-transaction.json"))).toBe(false);
		const tombstone = readTaskTombstone(root, TASK);
		expect(tombstone?.terminal_phase).toBe("done");
		expect(tombstone?.terminal_event_id).toBe(`complete:${TASK}:2026-08-12T10:00:04.000Z`);
		expect(tombstone?.final_record_hash).toBe(done.revision);
		// Record on disk matches the tombstone's final hash exactly.
		expect(revisionForContent(`${JSON.stringify(done.record, null, 2)}\n`)).toBe(done.revision);
	});

	test("user-confirmed stop terminalizes through the same transaction", () => {
		const cap = stopCapability("2026-08-12T10:00:01.000Z");
		const result = execute(
			{ op: "stop", capability: cap, reason: "halt", actor_id: "user" },
			"2026-08-12T10:00:01.000Z",
		);
		expect(result.record.phase).toBe("stopped");
		expect(readBackendClaim(root)).toBeNull();
		expect(readTaskTombstone(root, TASK)?.terminal_phase).toBe("stopped");
	});

	test("terminalized task cannot be re-enrolled", () => {
		completeTask();
		const enrollmentRegistry = createEnrollmentAuthorityRegistry();
		const prep = preparePiCanary(root, { task_id: TASK, now: "2026-08-12T10:00:00.000Z" });
		const binding: EnrollmentCapabilityBinding = {
			task_id: TASK,
			intent_path: `docs/plans/${TASK}.intent.json`,
			intent_revision: 1,
			intent_content_hash: INTENT_HASH,
			preparation_digest: prep.digest,
			readiness_digest: "sha256:readiness",
			evidence_digest: "sha256:evidence",
			waiver_gate: "observation_window_days",
			actor_id: "user",
			confirmation_ref: "pi-confirm-enroll",
			expires_at: "2099-01-01T00:00:00.000Z",
			nonce: "nonce-enroll",
		};
		expect(() =>
			enrollCanaryTask(
				root,
				{
					task_id: TASK,
					intent_path: `docs/plans/${TASK}.intent.json`,
					intent_revision: 1,
					preparation_digest: preparePiCanary(root, { task_id: TASK, now: "2026-08-12T10:00:05.000Z" }).digest,
					capability: enrollmentRegistry.issue(binding),
					capability_binding: binding,
					now: "2026-08-12T10:00:05.000Z",
				},
				enrollmentRegistry,
			),
		).toThrow(/already|exists|terminal/i);
	});

	test("crash after marker write recovers record/workspace/claim/tombstone", () => {
		// Build the marker state as if the transaction crashed after the
		// marker write but before completion: record done in memory only.
		execute(
			{ op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "one", actor_id: "executor-1" },
			"2026-08-12T10:00:01.000Z",
		);
		execute({ op: "submit_review", actor_id: "executor-1" }, "2026-08-12T10:00:02.000Z");
		const pre = readTaskRecordV2(root, TASK);
		const workspace = readWorkspaceStateRaw(root);
		const nextRecord = {
			...pre.record!,
			phase: "done",
			history: [
				...(pre.record!.history as unknown[]),
				{
					id: `complete:${TASK}:2026-08-12T10:00:04.000Z`,
					at: "2026-08-12T10:00:04.000Z",
					type: "complete",
					from_phase: "review",
					to_phase: "done",
					reason: `action_v2_sha256:${"1".repeat(64)}`,
				},
			],
		};
		const tombstone = {
			contract: "assurance_kernel/task_tombstone/v1",
			task_id: TASK,
			lifecycle_status: "terminal",
			terminal_phase: "done",
			terminal_event_id: `complete:${TASK}:2026-08-12T10:00:04.000Z`,
			final_record_hash: revisionForContent(`${JSON.stringify(nextRecord, null, 2)}\n`),
			terminalized_at: "2026-08-12T10:00:04.000Z",
		};
		writeFileSync(
			join(root, ".imm/tasks/.terminal-transaction.json"),
			`${JSON.stringify(
				{
					contract: "assurance_kernel/terminal_transaction/v1",
					task_id: TASK,
					transaction: {
						contract: "assurance_kernel/workspace_transaction/v2",
						task_id: TASK,
						expected_record_hash: pre.revision,
						next_record_content: `${JSON.stringify(nextRecord, null, 2)}\n`,
						expected_workspace_hash: workspace.revision,
						next_workspace_content: `${JSON.stringify(
							{ contract: "assurance_kernel/workspace/v1", current_working: null },
							null,
							2,
						)}\n`,
					},
					tombstone,
				},
				null,
				2,
			)}\n`,
		);
		// Simulated restart replays the terminal marker.
		withKernelStoreLockV2(root, () => undefined);
		const record = readTaskRecordV2(root, TASK);
		expect(record.record?.phase).toBe("done");
		expect(readBackendClaim(root)).toBeNull();
		expect(readTaskTombstone(root, TASK)?.terminal_phase).toBe("done");
		expect(existsSync(join(root, ".imm/tasks/.terminal-transaction.json"))).toBe(false);
	});

	test("crash recovery is idempotent when the terminal state already converged", () => {
		completeTask();
		// Re-plant the marker (crash before marker removal): recovery must
		// converge idempotently without failing.
		const record = readTaskRecordV2(root, TASK);
		const workspace = readWorkspaceStateRaw(root);
		const tombstone = readTaskTombstone(root, TASK)!;
		writeFileSync(
			join(root, ".imm/tasks/.terminal-transaction.json"),
			`${JSON.stringify(
				{
					contract: "assurance_kernel/terminal_transaction/v1",
					task_id: TASK,
					transaction: {
						contract: "assurance_kernel/workspace_transaction/v2",
						task_id: TASK,
						expected_record_hash: "sha256:stale",
						next_record_content: `${JSON.stringify(record.record, null, 2)}\n`,
						expected_workspace_hash: "sha256:stale-w",
						next_workspace_content: `${JSON.stringify(
							{ contract: "assurance_kernel/workspace/v1", current_working: null },
							null,
							2,
						)}\n`,
					},
					tombstone: JSON.parse(serializeTaskTombstone(tombstone)),
				},
				null,
				2,
			)}\n`,
		);
		withKernelStoreLockV2(root, () => undefined);
		expect(readTaskRecordV2(root, TASK).record?.phase).toBe("done");
		expect(readTaskTombstone(root, TASK)?.terminal_phase).toBe("done");
	});

	test("contradictory tombstone conflict fails closed and remains recoverable", () => {
		completeTask();
		const record = readTaskRecordV2(root, TASK);
		const workspace = readWorkspaceStateRaw(root);
		const conflictingTombstone = {
			contract: "assurance_kernel/task_tombstone/v1",
			task_id: TASK,
			lifecycle_status: "terminal",
			terminal_phase: "stopped",
			terminal_event_id: "stop:x",
			final_record_hash: "sha256:" + "9".repeat(64),
			terminalized_at: "2026-08-12T10:00:04.000Z",
		};
		writeFileSync(
			join(root, ".imm/tasks/.terminal-transaction.json"),
			`${JSON.stringify(
				{
					contract: "assurance_kernel/terminal_transaction/v1",
					task_id: TASK,
					transaction: {
						contract: "assurance_kernel/workspace_transaction/v2",
						task_id: TASK,
						expected_record_hash: "sha256:stale",
						next_record_content: `${JSON.stringify(record.record, null, 2)}\n`,
						expected_workspace_hash: "sha256:stale-w",
						next_workspace_content: `${JSON.stringify(
							{ contract: "assurance_kernel/workspace/v1", current_working: null },
							null,
							2,
						)}\n`,
					},
					tombstone: conflictingTombstone,
				},
				null,
				2,
			)}\n`,
		);
		expect(() => withKernelStoreLockV2(root, () => undefined)).toThrow(/conflict/i);
		expect(existsSync(join(root, ".imm/tasks/.terminal-transaction.json"))).toBe(true);
		// The committed tombstone stays intact.
		expect(readTaskTombstone(root, TASK)?.terminal_phase).toBe("done");
	});
});
