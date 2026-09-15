// P2B2 U1: active -> draining claim transaction. Covers user-capability
// binding, exact committed replay, stale/conflicting zero-write, crash
// recovery at the marker boundary, TaskRecord/workspace byte preservation,
// no reactivation, draining rejects enrollment and v3 mutation, and
// draining permits same-task continuation.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createCanaryApplication,
	beginDrainCapabilityAction,
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
	serializeBackendClaim,
} from "../plugins/immune-brain/runtime/kernel/backend_claim";
import {
	commitDrainLocked,
	readTaskRecord,
	readWorkspaceStateRaw,
	withKernelStoreLock,
} from "../plugins/immune-brain/runtime/kernel/storage";
import {
	KernelStoreConflictError,
	readRunRowByTask,
	withKernelRead,
} from "../plugins/immune-brain/runtime/kernel/sqlite_store";

const TASK = "canary-drain-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "drain transaction",
	acceptance: [{ id: "A1", assertion: "a1", verification: "v1" }],
	scope_hint: ["docs/plans", `docs/specs/archive/${TASK}.spec.md`, `docs/specs/${TASK}.spec.md`],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;
const INTENT_HASH = canonicalIntentHash(INTENT);
const DIFF = "sha256:" + "e".repeat(64);
const ZERO_DIFF = "sha256:" + "0".repeat(64);

let root: string;
let mutationRegistry: ReturnType<typeof createMutationAuthorityRegistry>;
let app: ReturnType<typeof createCanaryApplication>;
let now: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "canary-drain-"));
	now = "2026-08-12T10:00:00.000Z";
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, ".imm/state"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(
		join(root, "docs", "plans", `${TASK}.intent.json`),
		JSON.stringify(INTENT, null, 2) + "\n",
	);
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
			now,
		},
		enrollmentRegistry,
	);
	mutationRegistry = createMutationAuthorityRegistry();
	app = createCanaryApplication(mutationRegistry);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function drainCapability(overrides: Record<string, unknown> = {}) {
	const record = readTaskRecord(root, TASK);
	const digest = (a: Record<string, unknown>) => createHash("sha256").update(JSON.stringify(a)).digest("hex");
	const { expected_record_hash: _r, expected_workspace_hash: _w, diff_hash: _d, ...rest } =
		beginDrainCapabilityAction(TASK, now) as unknown as Record<string, unknown>;
	return createMutationAuthorityCapabilityForTest(mutationRegistry, {
		authority_kind: "user",
		task_id: TASK,
		action_digest: digest(rest),
		expected_record_hash: record.revision,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: ZERO_DIFF,
		actor_id: "user-1",
		confirmation_ref: "conf-drain",
		expires_at: "2099-01-01T00:00:00.000Z",
		findings_digest: null,
		...overrides,
	});
}

describe("drain transaction", () => {
	function runRow() {
		return withKernelRead(root, (db) => readRunRowByTask(db, TASK))!;
	}

	test("begin_drain converges active -> draining with the record and workspace preserved", () => {
		const recordBefore = readTaskRecord(root, TASK);
		const workspaceBefore = readWorkspaceStateRaw(root);
		const runBefore = runRow();
		const cap = drainCapability();
		const claim = app.beginDrain({ root, task_id: TASK, capability: cap, now });
		expect(claim.lifecycle_status).toBe("draining");
		expect(readBackendClaim(root)?.lifecycle_status).toBe("draining");
		// The drain changes only the claim: record bytes and workspace identity
		// are untouched, and no marker file is involved.
		expect(readTaskRecord(root, TASK)).toEqual(recordBefore);
		expect(readWorkspaceStateRaw(root)).toEqual(workspaceBefore);
		const runAfter = runRow();
		expect(runAfter.record_json).toBe(runBefore.record_json);
		expect(runAfter.claim_status).toBe("draining");
		expect(runAfter.revision).toBe(runBefore.revision);
		expect(existsSync(join(root, ".imm/state/transactions/drain-transaction.json"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/active-claim.json"))).toBe(false);
		expect(mutationRegistry.isConsumed(cap)).toBe(true);
	});

	test("exact committed drain replay is idempotent", () => {
		const cap = drainCapability();
		app.beginDrain({ root, task_id: TASK, capability: cap, now });
		const first = readBackendClaim(root)!;
		const second = app.beginDrain({ root, task_id: TASK, capability: cap, now });
		expect(second.lifecycle_status).toBe("draining");
		expect(readBackendClaim(root)).toEqual(first);
		expect(readBackendClaim(root)?.updated_at).toBe(now);
	});

	test("a store-level drain replay returns the committed claim without a second write", () => {
		const cap = drainCapability();
		app.beginDrain({ root, task_id: TASK, capability: cap, now });
		const committed = readBackendClaim(root)!;
		const before = runRow();
		const replay = commitDrainLocked(
			root,
			TASK,
			`${JSON.stringify({ ...committed, lifecycle_status: "active", updated_at: now }, null, 2)}\n`,
			`${JSON.stringify(committed, null, 2)}\n`,
			now,
		);
		expect(replay).toEqual(committed);
		expect(runRow()).toEqual(before);
	});

	test("draining -> active reactivation is rejected with zero writes", () => {
		const cap = drainCapability();
		app.beginDrain({ root, task_id: TASK, capability: cap, now });
		const claim = readBackendClaim(root)!;
		const next = { ...claim, lifecycle_status: "draining" as const, updated_at: "2026-08-12T10:00:09.000Z" };
		expect(() =>
			commitDrainLocked(
				root,
				TASK,
				`${JSON.stringify({ ...claim, lifecycle_status: "active", updated_at: now }, null, 2)}\n`,
				`${JSON.stringify({ ...next, lifecycle_status: "active" }, null, 2)}\n`,
				next.updated_at,
			),
		).toThrow(/active -> draining/i);
		expect(readBackendClaim(root)?.lifecycle_status).toBe("draining");
	});

	test("a stale drain capability is refused with zero writes after the record advanced", () => {
		// Bind the capability to the current snapshot, then advance the record so
		// the same capability can only be stale when it is finally used.
		const cap = drainCapability();
		const ev = app.execute({
			root,
			task_id: TASK,
			operation: { op: "record_finding", finding: { id: "advanced", kind: "advisory", acceptance_id: "A1", summary: "advance snapshot" }, actor_id: "executor-1" },
			prior_intent_token: readTaskIntent(root, TASK).token,
			diffProvider: () => DIFF,
			now: "2026-08-12T10:00:02.000Z",
		});
		expect(ev.record.findings).toHaveLength(1);
		const before = runRow();
		const claimBefore = readBackendClaim(root);
		expect(() => app.beginDrain({ root, task_id: TASK, capability: cap, now })).toThrow();
		expect(runRow()).toEqual(before);
		expect(readBackendClaim(root)).toEqual(claimBefore);
		expect(readBackendClaim(root)?.lifecycle_status).toBe("active");
		expect(mutationRegistry.isConsumed(cap)).toBe(false);
	});

	test("draining rejects same-task re-enrollment and permits same-task continuation", () => {
		const cap = drainCapability();
		app.beginDrain({ root, task_id: TASK, capability: cap, now });
		// Same-task continuation is permitted: ordinary facts still commit.
		const result = app.execute({
			root,
			task_id: TASK,
			operation: { op: "record_finding", finding: { id: "during-drain", kind: "advisory", acceptance_id: "A1", summary: "drain ok" }, actor_id: "executor-1" },
			prior_intent_token: readTaskIntent(root, TASK).token,
			diffProvider: () => DIFF,
			now: "2026-08-12T10:00:01.000Z",
		});
		expect(result.record).toMatchObject({ lifecycle: "active", artifact_state: "active" });
		expect(readBackendClaim(root)?.lifecycle_status).toBe("draining");
		// Re-enrollment of the same task is blocked by the existing run.
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
					preparation_digest: preparePiCanary(root, { task_id: TASK, now: "2026-08-12T10:00:02.000Z" }).digest,
					capability: enrollmentRegistry.issue(binding),
					capability_binding: binding,
					now: "2026-08-12T10:00:02.000Z",
				},
				enrollmentRegistry,
			),
		).toThrow(/already|exists/i);
	});

	test("a committed drain survives a restart without any marker replay", () => {
		const cap = drainCapability();
		app.beginDrain({ root, task_id: TASK, capability: cap, now });
		const committed = readBackendClaim(root)!;
		// Simulated restart: any locked operation observes the committed claim.
		withKernelStoreLock(root, () => undefined);
		expect(readBackendClaim(root)).toEqual(committed);
		expect(existsSync(join(root, ".imm/state/transactions/drain-transaction.json"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/active-claim.json"))).toBe(false);
		expect(runRow().claim_status).toBe("draining");
	});

	test("divergent drain claim bytes fail closed with zero writes", () => {
		// The expected claim bytes must match the committed claim exactly.
		const claim = readBackendClaim(root)!;
		const before = runRow();
		const divergent = { ...claim, intent_content_hash: `sha256:${"7".repeat(64)}` };
		expect(() =>
			commitDrainLocked(
				root,
				TASK,
				`${JSON.stringify(divergent, null, 2)}\n`,
				`${JSON.stringify({ ...divergent, lifecycle_status: "draining" }, null, 2)}\n`,
				now,
			),
		).toThrow(KernelStoreConflictError);
		expect(runRow()).toEqual(before);
		expect(readBackendClaim(root)?.lifecycle_status).toBe("active");
	});

	test("drain does not create a tombstone and keeps workspace ownership", () => {
		const cap = drainCapability();
		app.beginDrain({ root, task_id: TASK, capability: cap, now });
		expect(readTaskTombstone(root, TASK)).toBeNull();
		expect(readWorkspaceStateRaw(root).state.current_working).toBe(TASK);
		expect(withKernelRead(root, (db) => readRunRowByTask(db, TASK))!.state).toBe("active");
	});

	test("an operation identity replay refuses a conflicting request", () => {
		// Same task and timestamp, different content: one committed operation
		// identity can only ever have one result.
		const cap = drainCapability();
		app.beginDrain({ root, task_id: TASK, capability: cap, now });
		const committed = readBackendClaim(root)!;
		const before = runRow();
		const conflicting = {
			...committed,
			intent_content_hash: `sha256:${"7".repeat(64)}`,
		};
		expect(() =>
			commitDrainLocked(
				root,
				TASK,
				`${JSON.stringify({ ...committed, lifecycle_status: "active", updated_at: now }, null, 2)}\n`,
				`${JSON.stringify(conflicting, null, 2)}\n`,
				now,
			),
		).toThrow(/different facts/);
		// The refusal wrote nothing and the committed claim still replays.
		expect(runRow()).toEqual(before);
		expect(
			commitDrainLocked(
				root,
				TASK,
				`${JSON.stringify({ ...committed, lifecycle_status: "active", updated_at: now }, null, 2)}\n`,
				`${JSON.stringify(committed, null, 2)}\n`,
				now,
			),
		).toEqual(committed);
	});
});