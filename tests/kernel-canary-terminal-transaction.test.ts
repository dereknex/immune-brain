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
	readTaskRecord,
	readAuditTaskPair,
	reconcileKernelAuthority,
	repairKernelAuthority,
	readWorkspaceStateRaw,
	revisionForContent,
	setAfterTaskTransactionWriteForTest,
	setTerminalSettlementStepHookForTest,
	withKernelStoreLock,
} from "../plugins/immune-brain/runtime/kernel/storage";

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
	writeFileSync(
		join(root, ".imm/state/workspace.json"),
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
		diffProvider: () => DIFF,
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
	});

	test("shared authority reconciliation preserves terminal proof", () => {
		completeTask();
		expect(reconcileKernelAuthority(root, TASK)).toMatchObject({
			state: "terminal_owner",
			owner_task_id: TASK,
			owner_lifecycle: "done",
			claim_lifecycle_status: null,
		});
	});

	test("shared authority reconciliation proves only an exact stale terminal claim repairable", () => {
		const claimBytes = readFileSync(join(root, ".imm/state/active-claim.json"), "utf8");
		completeTask();
		writeFileSync(join(root, ".imm/state/active-claim.json"), claimBytes);
		expect(reconcileKernelAuthority(root, TASK)).toMatchObject({
			state: "repairable_stale_claim",
			owner_task_id: TASK,
			owner_lifecycle: "done",
		});
		expect(reconcileKernelAuthority(root, "other-task")).toMatchObject({
			state: "repairable_stale_claim",
			owner_task_id: TASK,
		});
	});

	test("contradictory stale claim identity fails closed with zero writes", () => {
		const claimPath = join(root, ".imm/state/active-claim.json");
		const claim = JSON.parse(readFileSync(claimPath, "utf8"));
		completeTask();
		claim.intent_content_hash = "sha256:contradictory-intent";
		const contradictoryBytes = `${JSON.stringify(claim, null, 2)}\n`;
		writeFileSync(claimPath, contradictoryBytes);
		const projection = reconcileKernelAuthority(root, TASK);
		expect(projection).toMatchObject({
			state: "authority_conflict",
			owner_task_id: TASK,
			diagnostic: expect.stringContaining("contradictory terminal ownership evidence"),
		});
		expect(() => repairKernelAuthority(root, TASK, projection.revision)).toThrow(
			/exact stale terminal proof/,
		);
		expect(readFileSync(claimPath, "utf8")).toBe(contradictoryBytes);
		expect(existsSync(join(root, ".imm/state/transactions/authority-repair-transaction.json"))).toBe(false);
	});

	test("authorized repair removes only the exact proven stale terminal claim", () => {
		const claimPath = join(root, ".imm/state/active-claim.json");
		const claimBytes = readFileSync(claimPath, "utf8");
		completeTask();
		writeFileSync(claimPath, claimBytes);
		const projection = reconcileKernelAuthority(root, TASK);
		expect(projection.state).toBe("repairable_stale_claim");
		expect(repairKernelAuthority(root, TASK, projection.revision)).toMatchObject({
			state: "terminal_owner",
			owner_task_id: TASK,
		});
		expect(existsSync(claimPath)).toBe(false);
		expect(existsSync(join(root, ".imm/state/transactions/authority-repair-transaction.json"))).toBe(false);
	});

	test("repair rejects changed claim bytes with zero repair writes", () => {
		const claimPath = join(root, ".imm/state/active-claim.json");
		const claimBytes = readFileSync(claimPath, "utf8");
		completeTask();
		writeFileSync(claimPath, claimBytes);
		const projection = reconcileKernelAuthority(root, TASK);
		const changed = JSON.parse(claimBytes);
		changed.lifecycle_status = "draining";
		writeFileSync(claimPath, `${JSON.stringify(changed, null, 2)}\n`);
		expect(() => repairKernelAuthority(root, TASK, projection.revision)).toThrow(
			/exact stale terminal proof/,
		);
		expect(readFileSync(claimPath, "utf8")).toBe(`${JSON.stringify(changed, null, 2)}\n`);
		expect(existsSync(join(root, ".imm/state/transactions/authority-repair-transaction.json"))).toBe(false);
	});

	test("artifact freeze recovers relocation and record from the workspace marker", () => {
		setAfterTaskTransactionWriteForTest(() => { throw new Error("simulated freeze crash"); });
		const result = execute(
			{ op: "freeze_artifacts", actor_id: "executor-1" },
			"2026-08-12T10:00:00.500Z",
		);
		expect(result.record.artifact_state).toBe("frozen");
		expect(existsSync(join(root, "docs/plans", `${TASK}.intent.json`))).toBe(false);
		expect(existsSync(join(root, "docs/plans/archive", `${TASK}.intent.json`))).toBe(true);
		expect(existsSync(join(root, "docs/specs", "canary-terminal-task.spec.md"))).toBe(false);
		expect(existsSync(join(root, "docs/specs/archive", "canary-terminal-task.spec.md"))).toBe(true);
		expect(existsSync(join(root, ".imm/tasks/.workspace-transaction.json"))).toBe(false);

		const recovered = readTaskRecord(root, TASK);
		expect(recovered.record).toMatchObject({
			artifact_state: "frozen",
			intent_ref: { path: `docs/plans/archive/${TASK}.intent.json` },
		});
		expect(existsSync(join(root, ".imm/tasks/.workspace-transaction.json"))).toBe(false);
	});

	test("complete converges all four paths through one transaction", () => {
		const done = completeTask();
		expect(done.record.lifecycle).toBe("done");
		expect(done.workspace.state.current_working).toBeNull();
		expect(readBackendClaim(root)).toBeNull();
		expect(existsSync(join(root, ".imm/state/transactions/terminal-transaction.json"))).toBe(false);
		const tombstone = readTaskTombstone(root, TASK);
		expect(tombstone?.terminal_lifecycle).toBe("done");
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
		expect(result.record.lifecycle).toBe("stopped");
		expect(readBackendClaim(root)).toBeNull();
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
	});

	test("crash after marker write recovers record/workspace/claim/tombstone", () => {
		// Build the marker state as if the transaction crashed after the
		// marker write but before completion: record done in memory only.
		const enrolledClaimHash = revisionForContent(readFileSync(join(root, ".imm/state/active-claim.json"), "utf8"));
		freezeTask();
		approveQa();
		const pre = readTaskRecord(root, TASK);
		const workspace = readWorkspaceStateRaw(root);
		const nextRecord = {
			...pre.record!,
			lifecycle: "done",
			history: [
				...(pre.record!.history as unknown[]),
				{
					id: `complete:${TASK}:2026-08-12T10:00:04.000Z`,
					at: "2026-08-12T10:00:04.000Z",
					type: "complete",
					from_state: "active:frozen",
					to_state: "done:frozen",
					reason: `action_v2_sha256:${"1".repeat(64)}`,
				},
			],
		};
		const tombstone = {
			contract: "assurance_kernel/task_tombstone/v2",
			task_id: TASK,
			lifecycle_status: "terminal",
			terminal_lifecycle: "done",
			terminal_event_id: `complete:${TASK}:2026-08-12T10:00:04.000Z`,
			final_record_hash: revisionForContent(`${JSON.stringify(nextRecord, null, 2)}\n`),
			terminalized_at: "2026-08-12T10:00:04.000Z",
		};
		writeFileSync(
			join(root, ".imm/state/transactions/terminal-transaction.json"),
			`${JSON.stringify(
				{
					contract: "assurance_kernel/terminal_transaction/v2",
					task_id: TASK,
					expected_state_record_hash: pre.revision,
					audit_record_content: `${JSON.stringify(nextRecord, null, 2)}\n`,
					proof_content: `${JSON.stringify(tombstone, null, 2)}\n`,
					expected_workspace_hash: workspace.revision,
					next_workspace_content: `${JSON.stringify(
						{ contract: "assurance_kernel/workspace/v1", current_working: null },
						null,
						2,
					)}\n`,
					expected_claim_sha256: enrolledClaimHash,
					at: tombstone.terminalized_at,
				},
				null,
				2,
			)}\n`,
		);
		// Simulated restart replays the terminal marker. The state record is
		// removed; terminal evidence lives only in the immutable audit pair.
		withKernelStoreLock(root, () => undefined);
		expect(readTaskRecord(root, TASK).record).toBeNull();
		const auditPair = readAuditTaskPair(root, TASK);
		expect(auditPair?.record.lifecycle).toBe("done");
		expect(auditPair?.proof.terminal_lifecycle).toBe("done");
		expect(existsSync(join(root, ".imm/audit", TASK, "task-record.json"))).toBe(true);
		expect(existsSync(join(root, ".imm/audit", TASK, "terminal-proof.json"))).toBe(true);
		expect(existsSync(join(root, ".imm/state", "tasks", `${TASK}.json`))).toBe(false);
		expect(readBackendClaim(root)).toBeNull();
		expect(existsSync(join(root, ".imm/state/transactions/terminal-transaction.json"))).toBe(false);
	});

	test("crash recovery is idempotent when the terminal state already converged", () => {
		const enrolledClaim = readFileSync(join(root, ".imm/state/active-claim.json"), "utf8");
		const enrolledClaimHash = revisionForContent(enrolledClaim);
		completeTask();
		// Re-plant the marker (crash before marker removal): recovery must
		// converge idempotently without failing. Terminal evidence lives in
		// the audit pair after settlement, so the marker replays those bytes.
		const auditPair = readAuditTaskPair(root, TASK)!;
		const record = auditPair.record;
		const workspace = readWorkspaceStateRaw(root);
		const tombstone = auditPair.proof;
		writeFileSync(
			join(root, ".imm/state/transactions/terminal-transaction.json"),
			`${JSON.stringify(
				{
					contract: "assurance_kernel/terminal_transaction/v2",
					task_id: TASK,
					expected_state_record_hash: "sha256:stale",
					audit_record_content: `${JSON.stringify(record, null, 2)}\n`,
					proof_content: serializeTaskTombstone(tombstone),
					expected_workspace_hash: "sha256:stale-w",
					next_workspace_content: `${JSON.stringify(
						{ contract: "assurance_kernel/workspace/v1", current_working: null },
						null,
						2,
					)}\n`,
					expected_claim_sha256: enrolledClaimHash,
					at: tombstone.terminalized_at,
				},
				null,
				2,
			)}\n`,
		);
		withKernelStoreLock(root, () => undefined);
		expect(readTaskRecord(root, TASK).record).toBeNull();
		expect(readAuditTaskPair(root, TASK)?.record.lifecycle).toBe("done");
		expect(readAuditTaskPair(root, TASK)?.proof.terminal_lifecycle).toBe("done");
	});

	test("contradictory tombstone conflict fails closed and remains recoverable", () => {
		const enrolledClaim = readFileSync(join(root, ".imm/state/active-claim.json"), "utf8");
		const enrolledClaimHash = revisionForContent(enrolledClaim);
		completeTask();
		const auditPair = readAuditTaskPair(root, TASK)!;
		const record = auditPair.record;
		const workspace = readWorkspaceStateRaw(root);
		const conflictingTombstone = {
			contract: "assurance_kernel/task_tombstone/v2",
			task_id: TASK,
			lifecycle_status: "terminal",
			terminal_lifecycle: "stopped",
			terminal_event_id: "stop:x",
			final_record_hash: "sha256:" + "9".repeat(64),
			terminalized_at: "2026-08-12T10:00:04.000Z",
		};
		writeFileSync(
			join(root, ".imm/state/transactions/terminal-transaction.json"),
			`${JSON.stringify(
				{
					contract: "assurance_kernel/terminal_transaction/v2",
					task_id: TASK,
					expected_state_record_hash: "sha256:stale",
					audit_record_content: `${JSON.stringify(record, null, 2)}\n`,
					proof_content: `${JSON.stringify(conflictingTombstone, null, 2)}\n`,
					expected_workspace_hash: "sha256:stale-w",
					next_workspace_content: `${JSON.stringify(
						{ contract: "assurance_kernel/workspace/v1", current_working: null },
						null,
						2,
					)}\n`,
					expected_claim_sha256: enrolledClaimHash,
					at: conflictingTombstone.terminalized_at,
				},
				null,
				2,
			)}\n`,
		);
		expect(() => withKernelStoreLock(root, () => undefined)).toThrow(/does not match|conflict/i);
		expect(existsSync(join(root, ".imm/state/transactions/terminal-transaction.json"))).toBe(true);
		// The committed tombstone stays intact.
		expect(readTaskTombstone(root, TASK)?.terminal_lifecycle).toBe("done");
	});

	for (let step = 0; step <= 4; step += 1) {
		test(`interruption after terminal settlement step ${step} recovers exactly`, () => {
			setTerminalSettlementStepHookForTest((at) => {
				if (at === step) throw new Error(`injected interruption at step ${step}`);
			});
			try {
				expect(() => completeTask()).toThrow(/remains recoverable/i);
			} finally {
				setTerminalSettlementStepHookForTest(null);
			}
			// The marker survives and the store-lock replay converges the
			// settlement exactly without re-running the hook.
			expect(existsSync(join(root, ".imm/state/transactions/terminal-transaction.json"))).toBe(true);
			withKernelStoreLock(root, () => undefined);
			expect(readTaskRecord(root, TASK).record).toBeNull();
			const auditPair = readAuditTaskPair(root, TASK);
			expect(auditPair?.record.lifecycle).toBe("done");
			expect(auditPair?.proof.terminal_lifecycle).toBe("done");
			expect(readBackendClaim(root)).toBeNull();
			expect(readWorkspaceStateRaw(root).state.current_working).toBeNull();
			expect(existsSync(join(root, ".imm/state/transactions/terminal-transaction.json"))).toBe(false);
		});
	}
});
