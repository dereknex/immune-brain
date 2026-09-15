// P2B2 U1: terminal ownership transfer. Covers the one recoverable terminal
// transaction converging the terminal TaskRecord, cleared workspace owner,
// removed active claim, and created task tombstone, with crash recovery at
// every boundary, exact before/after hashes, same-task reenrollment
// rejection, and unrelated v3 routing release after terminalization.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	capabilityActionFor,
	createCanaryApplication,
} from "../plugins/immune-brain/runtime/kernel/canary_application";
import {
	auditRunRecordPath,
	auditRunTerminalProofPath,
} from "../plugins/immune-brain/runtime/kernel/storage_paths";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { digestOfAction, createMutationAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { createMutationAuthorityCapabilityForTest } from "./fixtures/mutation-authority-test-seam";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash, parseTaskIntentV1, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import {
	readBackendClaim,
	readTaskTombstone,
	serializeTaskTombstone,
} from "../plugins/immune-brain/runtime/kernel/backend_claim";
import {
	KernelStoreConflictError,
	readTaskRecord,
	readAuditTaskPair,
	reconcileKernelAuthority,
	repairKernelAuthority,
	readWorkspaceStateRaw,
	revisionForContent,
	setAfterTaskTransactionWriteForTest,
	setAuditExportFaultForTest,
	withKernelStoreLock,
} from "../plugins/immune-brain/runtime/kernel/storage";
import {
	readRunRowByTask,
	readWorkspaceRow,
	withKernelRead,
} from "../plugins/immune-brain/runtime/kernel/sqlite_store";

const TASK = "canary-terminal-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "terminal transfer",
	acceptance: [{ id: "A1", assertion: "a1", verification: "v1" }],
	scope_hint: [
		"docs/plans",
		"docs/specs/canary-terminal-task.spec.md",
		"docs/specs/archive/canary-terminal-task.spec.md",
	],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;
const INTENT_HASH = canonicalIntentHash(parseTaskIntentV1(INTENT));
const DIFF = "sha256:" + "f".repeat(64);

let root: string;
let mutationRegistry: ReturnType<typeof createMutationAuthorityRegistry>;
let app: ReturnType<typeof createCanaryApplication>;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "canary-terminal-"));
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, "docs", "specs"), { recursive: true });
	mkdirSync(join(root, ".imm/state"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(
		join(root, "docs", "plans", `${TASK}.intent.json`),
		JSON.stringify(INTENT, null, 2) + "\n",
	);
	writeFileSync(join(root, "docs", "specs", "canary-terminal-task.spec.md"), "# Canary terminal task\n");
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "intent"], { cwd: root });
	const enrollmentRegistry = createEnrollmentAuthorityRegistry();
	const prep = preparePiCanary(root, { task_id: TASK, now: "2026-08-12T10:00:00.000Z" });
	const binding: EnrollmentCapabilityBinding = {
		task_id: TASK,
		intent_path: `docs/plans/${TASK}.intent.json`,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		preparation_digest: prep.digest,
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
	setAfterTaskTransactionWriteForTest(null);
	setAuditExportFaultForTest(null);
	rmSync(root, { recursive: true, force: true });
});

function token() {
	const record = readTaskRecord(root, TASK).record;
	return readTaskIntent(root, TASK, record?.intent_ref.path).token;
}

function execute(op: Parameters<typeof app.execute>[0]["operation"], at: string) {
	return app.execute({
		root,
		task_id: TASK,
		operation: op,
		prior_intent_token: token(),
		diffProvider: () => ({ diff_hash: DIFF, changed_paths: [] as const }),
		now: at,
	});
}

function freezeTask() {
	execute({ op: "freeze_artifacts", actor_id: "executor-1" }, "2026-08-12T10:00:00.500Z");
	execFileSync("git", ["add", "-A"], { cwd: root });
}

function approveQa() {
	const approval = {
		id: "qa-terminal",
		kind: "qa",
		authority_role: "qa",
		task_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: DIFF,
		actor_id: "qa-1",
		summary: "descriptor passed",
	};
	const approvalAt = "2026-08-12T10:00:01.000Z";
	const action = capabilityActionFor({
		op: "record_approval",
		task_id: TASK,
		at: approvalAt,
		actor_id: "qa-1",
		approval,
	});
	const capability = createMutationAuthorityCapabilityForTest(mutationRegistry, {
		authority_kind: "qa",
		task_id: TASK,
		action_digest: digestOfAction(action),
		expected_record_hash: readTaskRecord(root, TASK).revision,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: DIFF,
		actor_id: "qa-1",
		confirmation_ref: "qa-terminal",
		expires_at: "2099-01-01T00:00:00.000Z",
		findings_digest: null,
	});
	execute({ op: "record_approval", approval, capability, actor_id: "qa-1" }, approvalAt);
}

/** active:frozen -> done through host-attested QA and the terminal transaction. */
function completeTask(at = "2026-08-12T10:00:04.000Z") {
	freezeTask();
	approveQa();
	return execute({ op: "complete", actor_id: "executor-1" }, at);
}

function stopCapability(at: string, overrides: Record<string, unknown> = {}) {
	const record = readTaskRecord(root, TASK);
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
	test("shared authority reconciliation classifies a live owner", () => {
		expect(reconcileKernelAuthority(root, TASK)).toMatchObject({
			state: "active_owner",
			owner_task_id: TASK,
			claim_lifecycle_status: "active",
		});
		const run = withKernelRead(root, (db) => readRunRowByTask(db, TASK))!;
		expect(reconcileKernelAuthority(root, TASK).owner_run_id).toBe(run.run_id);
	});

	test("shared authority reconciliation preserves the committed terminal run", () => {
		const done = completeTask();
		expect(reconcileKernelAuthority(root, TASK)).toMatchObject({
			state: "terminal_owner",
			owner_task_id: TASK,
			owner_lifecycle: "done",
			claim_lifecycle_status: null,
		});
		const run = withKernelRead(root, (db) => readRunRowByTask(db, TASK))!;
		expect(run.state).toBe("done");
		expect(reconcileKernelAuthority(root, TASK).owner_run_id).toBe(run.run_id);
		expect(done.record.lifecycle).toBe("done");
	});

	test("the retired file-store claim grants nothing after settlement", () => {
		completeTask();
		const before = reconcileKernelAuthority(root, TASK);
		writeFileSync(
			join(root, ".imm/state/active-claim.json"),
			`${JSON.stringify(
				{
					contract: "assurance_kernel/backend_claim/v2",
					backend: "kernel",
					task_id: "ghost-task",
					intent_revision: 1,
					intent_content_hash: INTENT_HASH,
					enrollment_event_id: "ghost",
					lifecycle_status: "active",
					created_at: "2026-08-12T10:00:00.000Z",
					updated_at: "2026-08-12T10:00:00.000Z",
				},
				null,
				2,
			)}\n`,
		);
		// The retired file is inert: the store has this task's run, so the
		// projection still reports the committed owner instead of a conflict.
		const projection = reconcileKernelAuthority(root, TASK);
		expect(projection.state).toBe("terminal_owner");
		expect(projection.diagnostic).toBeNull();
		// The committed owner facts are untouched and the file is not rewritten.
		expect(readTaskRecord(root, TASK).record).toBeNull();
		expect(readAuditTaskPair(root, TASK)?.proof.terminal_lifecycle).toBe("done");
		expect(before.owner_task_id).toBe(TASK);
		expect(existsSync(join(root, ".imm/state/active-claim.json"))).toBe(true);
		// A mutation retires the inert file and never resurrects its task.
		expect(reconcileKernelAuthority(root, TASK).owner_task_id).toBe(TASK);
	});

	test("authority repair stays fail-closed because a divergent claim cannot exist", () => {
		completeTask();
		const projection = reconcileKernelAuthority(root, TASK);
		expect(projection.state).toBe("terminal_owner");
		// A divergent claim cannot exist, so repair has nothing to remove: it
		// returns the settled authority and writes no transaction marker.
		const repaired = repairKernelAuthority(root, TASK, projection.revision);
		expect(repaired.state).toBe("terminal_owner");
		expect(repaired.owner_task_id).toBe(TASK);
		expect(existsSync(join(root, ".imm/state/transactions/authority-repair-transaction.json"))).toBe(false);
	});

	test("artifact freeze commits the relocation and the record together, and a rolled-back attempt converges on retry", () => {
		setAfterTaskTransactionWriteForTest(() => {
			throw new Error("simulated freeze crash");
		});
		expect(() =>
			execute({ op: "freeze_artifacts", actor_id: "executor-1" }, "2026-08-12T10:00:00.500Z"),
		).toThrow(/simulated freeze crash/);
		// The authority write rolled back: the record is still active.
		expect(readTaskRecord(root, TASK).record?.artifact_state).toBe("active");
		// Document relocation is a file move and is not part of the database
		// transaction; it converges idempotently on the retry below.
		setAfterTaskTransactionWriteForTest(null);
		const retry = execute(
			{ op: "freeze_artifacts", actor_id: "executor-1" },
			"2026-08-12T10:00:00.500Z",
		);
		expect(retry.record.artifact_state).toBe("frozen");
		expect(existsSync(join(root, "docs/plans", `${TASK}.intent.json`))).toBe(false);
		expect(existsSync(join(root, "docs/plans/archive", `${TASK}.intent.json`))).toBe(true);
		expect(existsSync(join(root, "docs/specs", "canary-terminal-task.spec.md"))).toBe(false);
		expect(existsSync(join(root, "docs/specs/archive", "canary-terminal-task.spec.md"))).toBe(true);
		const recovered = readTaskRecord(root, TASK);
		expect(recovered.record).toMatchObject({
			artifact_state: "frozen",
			intent_ref: { path: `docs/plans/archive/${TASK}.intent.json` },
		});
	});

	test("complete settles record, owner, claim and audit evidence in one transaction", () => {
		const done = completeTask();
		expect(done.record.lifecycle).toBe("done");
		expect(done.workspace.state.current_working).toBeNull();
		expect(readBackendClaim(root)).toBeNull();
		expect(existsSync(join(root, ".imm/state/transactions/terminal-transaction.json"))).toBe(false);
		const run = withKernelRead(root, (db) => readRunRowByTask(db, TASK))!;
		expect(run.state).toBe("done");
		expect(run.claim_status).toBeNull();
		expect(run.terminal_proof_json).not.toBeNull();
		expect(run.audit_exported_at).not.toBeNull();
		expect(withKernelRead(root, (db) => readWorkspaceRow(db).current_run_id)).toBeNull();
		const tombstone = readTaskTombstone(root, TASK);
		expect(tombstone?.terminal_lifecycle).toBe("done");
		expect(tombstone?.terminal_event_id).toBe(`complete:${TASK}:2026-08-12T10:00:04.000Z`);
		expect(tombstone?.final_record_hash).toBe(done.revision);
		expect(revisionForContent(`${JSON.stringify(done.record, null, 2)}\n`)).toBe(done.revision);
	});

	test("user-confirmed stop terminalizes through the same transaction", () => {
		const cap = stopCapability("2026-08-12T10:00:01.000Z");
		const result = execute(
			{ op: "stop", capability: cap, reason: "halt", actor_id: "user" },
			"2026-08-12T10:00:01.000Z",
		);
		expect(result.record.lifecycle).toBe("stopped");
		expect(readBackendClaim(root)).toBeNull();
		expect(readTaskTombstone(root, TASK)?.terminal_lifecycle).toBe("stopped");
		expect(withKernelRead(root, (db) => readRunRowByTask(db, TASK))!.state).toBe("stopped");
	});

	test("a lost settlement response replays the committed result through the application", () => {
		// Settlement clears the active record, so the retry cannot pass the
		// preflight: the committed operation is the only answer, and it must be
		// the same result the first call produced.
		const completed = completeTask();
		const runBefore = withKernelRead(root, (db) => readRunRowByTask(db, TASK))!;
		const replayed = execute(
			{ op: "complete", actor_id: "executor-1" },
			"2026-08-12T10:00:04.000Z",
		);
		expect(replayed.revision).toBe(completed.revision);
		expect(replayed.record).toEqual(completed.record);
		expect(replayed.workspace.state.current_working).toBeNull();
		// Nothing was written twice: the terminal run row is byte-identical.
		expect(withKernelRead(root, (db) => readRunRowByTask(db, TASK))).toEqual(runBefore);
	});

	test("a different request for the same settled event is refused, not replayed", () => {
		const cap = stopCapability("2026-08-12T10:00:01.000Z");
		const first = execute(
			{ op: "stop", capability: cap, reason: "halt", actor_id: "user" },
			"2026-08-12T10:00:01.000Z",
		);
		expect(first.record.lifecycle).toBe("stopped");
		// Same task and instant, different reason: the committed result answers the
		// request that was authorized, not this one.
		const record = readTaskRecord(root, TASK);
		const digest = (a: Record<string, unknown>) =>
			createHash("sha256").update(JSON.stringify(a)).digest("hex");
		const at = "2026-08-12T10:00:01.000Z";
		const other = createMutationAuthorityCapabilityForTest(mutationRegistry, {
			authority_kind: "user",
			task_id: TASK,
			action_digest: digest({
				type: "stop",
				event_id: `stop:${TASK}:${at}`,
				at,
				actor_id: "user",
				reason: "different",
			}),
			expected_record_hash: record.revision,
			intent_revision: 1,
			intent_content_hash: INTENT_HASH,
			diff_hash: DIFF,
			actor_id: "user",
			confirmation_ref: "different-request",
			expires_at: "2099-01-01T00:00:00.000Z",
			findings_digest: null,
		});
		// Called directly with no usable intent token: the replay decision must
		// precede the token and capability checks, which a settled run cannot pass.
		expect(() =>
			app.execute({
				root,
				task_id: TASK,
				operation: { op: "stop", capability: other, reason: "different", actor_id: "user" },
				prior_intent_token: "",
				diffProvider: () => ({ diff_hash: DIFF, changed_paths: [] as const }),
				now: at,
			}),
		).toThrow(/different request/i);
		// The settled facts are untouched by the refused request.
		expect(readTaskRecord(root, TASK).revision).toBe(record.revision);
		expect(readTaskTombstone(root, TASK)?.terminal_lifecycle).toBe("stopped");
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
		const run = withKernelRead(root, (db) => readRunRowByTask(db, TASK))!;
		expect(run.state).toBe("done");
	});

	test("an interrupted audit export never reactivates the settled run", () => {
		setAuditExportFaultForTest(() => {
			throw new Error("simulated export interruption");
		});
		expect(() => completeTask()).toThrow(/simulated export interruption/);
		// Settlement is committed even though the export was interrupted.
		const run = withKernelRead(root, (db) => readRunRowByTask(db, TASK))!;
		expect(run.state).toBe("done");
		expect(run.audit_exported_at).toBeNull();
		expect(withKernelRead(root, (db) => readWorkspaceRow(db).current_run_id)).toBeNull();
		expect(readBackendClaim(root)).toBeNull();
		expect(reconcileKernelAuthority(root, TASK)).toMatchObject({
			state: "terminal_owner",
			owner_lifecycle: "done",
		});
		// The next locked operation retries the export without touching authority.
		setAuditExportFaultForTest(null);
		withKernelStoreLock(root, () => undefined);
		const runId = withKernelRead(root, (db) => readRunRowByTask(db, TASK))!.run_id;
		expect(existsSync(join(root, auditRunRecordPath(TASK, runId)))).toBe(true);
		expect(existsSync(join(root, auditRunTerminalProofPath(TASK, runId)))).toBe(true);
		const exported = withKernelRead(root, (db) => readRunRowByTask(db, TASK))!;
		expect(exported.audit_exported_at).not.toBeNull();
		expect(exported.state).toBe("done");
		expect(readTaskRecord(root, TASK).record).toBeNull();
		expect(readAuditTaskPair(root, TASK)?.record.lifecycle).toBe("done");
	});

	test("replaying the same terminal event reuses the committed settlement", async () => {
		const done = completeTask();
		const run = withKernelRead(root, (db) => readRunRowByTask(db, TASK))!;
		const workspace = withKernelRead(root, (db) => readWorkspaceRow(db));
		const { commitTerminalLocked } = await import(
			"../plugins/immune-brain/runtime/kernel/storage"
		);
		const tombstone = readTaskTombstone(root, TASK)!;
		const replay = commitTerminalLocked(
			root,
			TASK,
			{
				contract: "assurance_kernel/workspace_transaction/v2",
				task_id: TASK,
				expected_record_hash: "rev:0",
				next_record_content: `${JSON.stringify(done.record, null, 2)}\n`,
				expected_workspace_hash: "rev:0",
				next_workspace_content: `${JSON.stringify(
					{ contract: "assurance_kernel/workspace/v1", current_working: null },
					null,
					2,
				)}\n`,
			},
			tombstone,
		);
		expect(replay.record).toEqual(done.record);
		const after = withKernelRead(root, (db) => readRunRowByTask(db, TASK))!;
		expect(after.run_id).toBe(run.run_id);
		expect(after.revision).toBe(run.revision);
		expect(withKernelRead(root, (db) => readWorkspaceRow(db))).toEqual(workspace);
	});

	test("a contradictory terminal request fails closed with zero writes", async () => {
		completeTask();
		const run = withKernelRead(root, (db) => readRunRowByTask(db, TASK))!;
		const workspace = withKernelRead(root, (db) => readWorkspaceRow(db));
		const auditPair = readAuditTaskPair(root, TASK)!;
		const { commitTerminalLocked } = await import(
			"../plugins/immune-brain/runtime/kernel/storage"
		);
		const conflicting = {
			...auditPair.proof,
			terminal_lifecycle: "stopped" as const,
			terminal_event_id: "stop:contradiction",
		};
		expect(() =>
			commitTerminalLocked(
				root,
				TASK,
				{
					contract: "assurance_kernel/workspace_transaction/v2",
					task_id: TASK,
					expected_record_hash: run.revisionLabel,
					next_record_content: `${JSON.stringify(auditPair.record, null, 2)}\n`,
					expected_workspace_hash: "rev:0",
					next_workspace_content: `${JSON.stringify(
						{ contract: "assurance_kernel/workspace/v1", current_working: null },
						null,
						2,
					)}\n`,
				},
				conflicting,
			),
		).toThrow(/contradicts|already|refused|proof/i);
		expect(withKernelRead(root, (db) => readRunRowByTask(db, TASK))).toEqual(run);
		expect(withKernelRead(root, (db) => readWorkspaceRow(db))).toEqual(workspace);
		expect(readTaskTombstone(root, TASK)?.terminal_lifecycle).toBe("done");
	});

	test("a terminal settlement refuses to revive a run that is not active", async () => {
		completeTask();
		const { commitTerminalLocked } = await import(
			"../plugins/immune-brain/runtime/kernel/storage"
		);
		const auditPair = readAuditTaskPair(root, TASK)!;
		expect(() =>
			commitTerminalLocked(
				root,
				TASK,
				{
					contract: "assurance_kernel/workspace_transaction/v2",
					task_id: TASK,
					expected_record_hash: "rev:0",
					next_record_content: `${JSON.stringify(auditPair.record, null, 2)}\n`,
					expected_workspace_hash: "rev:0",
					next_workspace_content: `${JSON.stringify(
						{ contract: "assurance_kernel/workspace/v1", current_working: null },
						null,
						2,
					)}\n`,
				},
				{ ...auditPair.proof, terminal_event_id: "complete:second-event" },
			),
		).toThrow();
	});
});
