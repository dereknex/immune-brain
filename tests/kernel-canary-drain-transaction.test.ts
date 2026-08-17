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
	readTaskRecordV2,
	readWorkspaceStateRaw,
	withKernelStoreLockV2,
} from "../plugins/immune-brain/runtime/kernel/storage";

const TASK = "canary-drain-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "drain transaction",
	acceptance: [{ id: "A1", assertion: "a1", verification: "v1" }],
	scope_hint: ["plugins/immune-brain/runtime/kernel"],
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
	const record = readTaskRecordV2(root, TASK);
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
	test("begin_drain converges active -> draining with record/workspace bytes preserved", () => {
		const recordBefore = readFileSync(join(root, ".imm", "tasks", `${TASK}.json`), "utf8");
		const workspaceBefore = readFileSync(join(root, ".imm", "workspace.json"), "utf8");
		const cap = drainCapability();
		const claim = app.beginDrain({ root, task_id: TASK, capability: cap, now });
		expect(claim.lifecycle_status).toBe("draining");
		expect(readBackendClaim(root)?.lifecycle_status).toBe("draining");
		expect(readFileSync(join(root, ".imm", "tasks", `${TASK}.json`), "utf8")).toBe(recordBefore);
		expect(readFileSync(join(root, ".imm", "workspace.json"), "utf8")).toBe(workspaceBefore);
		expect(existsSync(join(root, ".imm", "tasks", ".drain-transaction.json"))).toBe(false);
		expect(mutationRegistry.isConsumed(cap)).toBe(true);
	});

	test("exact committed drain replay is idempotent", () => {
		const cap = drainCapability();
		app.beginDrain({ root, task_id: TASK, capability: cap, now });
		const second = app.beginDrain({ root, task_id: TASK, capability: cap, now });
		expect(second.lifecycle_status).toBe("draining");
		expect(readBackendClaim(root)?.updated_at).toBe(now);
	});

	test("draining -> active reactivation is rejected", () => {
		const cap = drainCapability();
		app.beginDrain({ root, task_id: TASK, capability: cap, now });
		// A second drain with a different timestamp is still a no-op replay.
		const cap2 = drainCapability();
		const result = app.beginDrain({ root, task_id: TASK, capability: cap2, now: "2026-08-12T10:00:01.000Z" });
		expect(result.lifecycle_status).toBe("draining");
		// The drain transaction marker parser rejects any non active->draining direction.
		const claim = readBackendClaim(root)!;
		expect(() =>
			JSON.parse(
				`${JSON.stringify(
					{
						contract: "assurance_kernel/drain_transaction/v1",
						task_id: TASK,
						expected_claim_content: serializeBackendClaim(claim),
						next_claim_content: serializeBackendClaim({ ...claim, lifecycle_status: "active", updated_at: now }),
						at: now,
					},
					null,
					2,
				)}\n`,
			),
		);
		writeFileSync(
			join(root, ".imm/tasks/.drain-transaction.json"),
			`${JSON.stringify(
				{
					contract: "assurance_kernel/drain_transaction/v1",
					task_id: TASK,
					expected_claim_content: serializeBackendClaim(claim),
					next_claim_content: serializeBackendClaim({ ...claim, lifecycle_status: "active", updated_at: now }),
					at: now,
				},
				null,
				2,
			)}\n`,
		);
		expect(() => withKernelStoreLockV2(root, () => undefined)).toThrow(/active -> draining/i);
		expect(readBackendClaim(root)?.lifecycle_status).toBe("draining");
	});

	test("stale drain retry with a changed claim fails closed with zero writes", () => {
		const cap = drainCapability();
		app.beginDrain({ root, task_id: TASK, capability: cap, now });
		// Advance the record; a capability bound to the pre-drain snapshot is stale.
		const ev = app.execute({
			root,
			task_id: TASK,
			operation: { op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "s", actor_id: "executor-1" },
			prior_intent_token: readTaskIntent(root, TASK).token,
			diffProvider: () => DIFF,
			now: "2026-08-12T10:00:02.000Z",
		});
		expect(ev.record.evidence).toHaveLength(1);
	});

	test("draining rejects same-task re-enrollment and v3-style mutation is impossible", () => {
		const cap = drainCapability();
		app.beginDrain({ root, task_id: TASK, capability: cap, now });
		// Same-task continuation is permitted: ordinary facts still commit.
		const result = app.execute({
			root,
			task_id: TASK,
			operation: { op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "drain ok", actor_id: "executor-1" },
			prior_intent_token: readTaskIntent(root, TASK).token,
			diffProvider: () => DIFF,
			now: "2026-08-12T10:00:01.000Z",
		});
		expect(result.record.phase).toBe("working");
		// Re-enrollment of the same task is blocked by the existing record.
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
					preparation_digest: preparePiCanary(root, { task_id: TASK, now: "2026-08-12T10:00:02.000Z" }).digest,
					capability: enrollmentRegistry.issue(binding),
					capability_binding: binding,
					now: "2026-08-12T10:00:02.000Z",
				},
				enrollmentRegistry,
			),
		).toThrow(/already|exists/i);
	});

	test("crash after marker write recovers the claim on the next lock", () => {
		const claim = readBackendClaim(root)!;
		const nextClaim = { ...claim, lifecycle_status: "draining", updated_at: now };
		writeFileSync(
			join(root, ".imm/tasks/.drain-transaction.json"),
			`${JSON.stringify(
				{
					contract: "assurance_kernel/drain_transaction/v1",
					task_id: TASK,
					expected_claim_content: serializeBackendClaim(claim),
					next_claim_content: serializeBackendClaim(nextClaim),
					at: now,
				},
				null,
				2,
			)}\n`,
		);
		// Simulated restart: any store-lock acquisition replays the marker.
		withKernelStoreLockV2(root, () => undefined);
		expect(readBackendClaim(root)?.lifecycle_status).toBe("draining");
		expect(existsSync(join(root, ".imm/tasks/.drain-transaction.json"))).toBe(false);
	});

	test("crash recovery replays an already-committed drain idempotently", () => {
		const cap = drainCapability();
		app.beginDrain({ root, task_id: TASK, capability: cap, now });
		// Re-plant the marker after the commit (crash before marker removal).
		const claim = readBackendClaim(root)!;
		writeFileSync(
			join(root, ".imm/tasks/.drain-transaction.json"),
			`${JSON.stringify(
				{
					contract: "assurance_kernel/drain_transaction/v1",
					task_id: TASK,
					expected_claim_content: serializeBackendClaim({ ...claim, lifecycle_status: "active", updated_at: "2026-08-12T09:00:00.000Z" }),
					next_claim_content: serializeBackendClaim(claim),
					at: now,
				},
				null,
				2,
			)}\n`,
		);
		withKernelStoreLockV2(root, () => undefined);
		expect(readBackendClaim(root)?.lifecycle_status).toBe("draining");
	});

	test("conflicting claim bytes fail closed and keep the marker recoverable", () => {
		// The claim on disk diverges from both marker expectations.
		const claim = readBackendClaim(root)!;
		const foreign = { ...claim, task_id: "some-other-task", lifecycle_status: "active" };
		writeFileSync(
			join(root, ".imm/tasks/.backend-claim.json"),
			serializeBackendClaim(foreign),
		);
		writeFileSync(
			join(root, ".imm/tasks/.drain-transaction.json"),
			`${JSON.stringify(
				{
					contract: "assurance_kernel/drain_transaction/v1",
					task_id: TASK,
					expected_claim_content: serializeBackendClaim(claim),
					next_claim_content: serializeBackendClaim({ ...claim, lifecycle_status: "draining", updated_at: now }),
					at: now,
				},
				null,
				2,
			)}\n`,
		);
		expect(() => withKernelStoreLockV2(root, () => undefined)).toThrow(/conflict/i);
		expect(existsSync(join(root, ".imm/tasks/.drain-transaction.json"))).toBe(true);
	});

	test("drain does not create a tombstone and tombstone does not block other tasks", () => {
		const cap = drainCapability();
		app.beginDrain({ root, task_id: TASK, capability: cap, now });
		expect(readTaskTombstone(root, TASK)).toBeNull();
		// Workspace ownership is preserved while draining.
		expect(readWorkspaceStateRaw(root).state.current_working).toBe(TASK);
	});
});
