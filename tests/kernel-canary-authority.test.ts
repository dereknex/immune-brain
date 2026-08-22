// P2B2 U1: canary application authority pairing. Covers registry/application
// pairing, cross-registry rejection through the application, capability
// expiry/replay, capability consumption on success, and zero consumption on
// failure and exact replay.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

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
import { readBackendClaim } from "../plugins/immune-brain/runtime/kernel/backend_claim";
import { readTaskRecordV2, withKernelStoreLockV2 } from "../plugins/immune-brain/runtime/kernel/storage";

const TASK = "canary-auth-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "authority pairing",
	acceptance: [{ id: "A1", assertion: "a1", verification: "v1" }],
	scope_hint: ["docs/plans"],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;
const INTENT_HASH = canonicalIntentHash(INTENT);
const DIFF = "sha256:" + "b".repeat(64);
const ZERO_DIFF = "sha256:" + "0".repeat(64);

let root: string;
let mutationRegistryA: ReturnType<typeof createMutationAuthorityRegistry>;
let mutationRegistryB: ReturnType<typeof createMutationAuthorityRegistry>;
let appA: ReturnType<typeof createCanaryApplication>;
let appB: ReturnType<typeof createCanaryApplication>;
let now: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "canary-auth-"));
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
	mutationRegistryA = createMutationAuthorityRegistry();
	mutationRegistryB = createMutationAuthorityRegistry();
	appA = createCanaryApplication(mutationRegistryA);
	appB = createCanaryApplication(mutationRegistryB);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function token() {
	const record = readTaskRecordV2(root, TASK).record;
	if (!record) throw new Error("missing TaskRecord");
	return readTaskIntent(root, TASK, record.intent_ref.path).token;
}

function drainCapability(registry = mutationRegistryA, overrides: Record<string, unknown> = {}) {
	const record = readTaskRecordV2(root, TASK);
	const digest = (a: Record<string, unknown>) => createHash("sha256").update(JSON.stringify(a)).digest("hex");
	const { expected_record_hash: _r, expected_workspace_hash: _w, diff_hash: _d, ...rest } =
		beginDrainCapabilityAction(TASK, now) as unknown as Record<string, unknown>;
	return createMutationAuthorityCapabilityForTest(registry, {
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

function stopActionCapability(registry = mutationRegistryA, overrides: Record<string, unknown> = {}) {
	const record = readTaskRecordV2(root, TASK);
	const digest = (a: Record<string, unknown>) => createHash("sha256").update(JSON.stringify(a)).digest("hex");
	return createMutationAuthorityCapabilityForTest(registry, {
		authority_kind: "user",
		task_id: TASK,
		action_digest: digest({
			type: "stop",
			event_id: `stop:${TASK}:${now}`,
			at: now,
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

describe("canary application authority pairing", () => {
	test("capability from the wrong registry is rejected with zero writes", () => {
		const foreign = stopActionCapability(mutationRegistryB);
		expect(() =>
			appA.execute({
				root,
				task_id: TASK,
				operation: { op: "stop", capability: foreign, reason: "halt", actor_id: "user" },
				prior_intent_token: token(),
				diffProvider: () => DIFF,
				now,
			}),
		).toThrow(/capability|authority/i);
		expect(readTaskRecordV2(root, TASK).record?.phase).toBe("working");
		expect(mutationRegistryB.isConsumed(foreign)).toBe(false);
	});

	test("expired capability is rejected with zero writes", () => {
		// Issue a capability valid for one hour, then consume it after expiry.
		const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
		const cap = stopActionCapability(mutationRegistryA, { expires_at: expiresAt });
		const afterExpiry = new Date(Date.now() + 7_200_000).toISOString();
		expect(() =>
			appA.execute({
				root,
				task_id: TASK,
				operation: { op: "stop", capability: cap, reason: "halt", actor_id: "user" },
				prior_intent_token: token(),
				diffProvider: () => DIFF,
				now: afterExpiry,
			}),
		).toThrow(/expired/i);
		expect(readTaskRecordV2(root, TASK).record?.phase).toBe("working");
	});

	test("stale snapshot capability (record advanced) is rejected", () => {
		// Capability bound to the ORIGINAL record revision before any advance.
		const stale = stopActionCapability(mutationRegistryA);
		// Advance the record.
		appA.execute(
			{
				root,
				task_id: TASK,
				operation: { op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "s", actor_id: "executor-1" },
				prior_intent_token: token(),
				diffProvider: () => DIFF,
				now: "2026-08-12T10:00:01.000Z",
			},
		);
		expect(() =>
			appA.execute({
				root,
				task_id: TASK,
				operation: { op: "stop", capability: stale, reason: "halt", actor_id: "user" },
				prior_intent_token: token(),
				diffProvider: () => DIFF,
				now,
			}),
		).toThrow(/record hash mismatch|revision/i);
	});

	test("successful stop consumes exactly once; a consumed capability retry fails closed", () => {
		const cap = stopActionCapability();
		const first = appA.execute({
			root,
			task_id: TASK,
			operation: { op: "stop", capability: cap, reason: "halt", actor_id: "user" },
			prior_intent_token: token(),
			diffProvider: () => DIFF,
			now,
		});
		expect(first.record.phase).toBe("stopped");
		expect(mutationRegistryA.isConsumed(cap)).toBe(true);
		execFileSync("git", ["add", "--", `docs/plans/archive/${TASK}.intent.json`], { cwd: root });
		// A retry with the same single-use capability must fail closed.
		expect(() =>
			appA.execute({
				root,
				task_id: TASK,
				operation: { op: "stop", capability: cap, reason: "halt", actor_id: "user" },
				prior_intent_token: token(),
				diffProvider: () => DIFF,
				now,
			}),
		).toThrow(/consumed/i);
	});

	test("failed operation consumes nothing", () => {
		const cap = stopActionCapability(mutationRegistryA, { action_digest: "wrong-digest" });
		expect(() =>
			appA.execute({
				root,
				task_id: TASK,
				operation: { op: "stop", capability: cap, reason: "halt", actor_id: "user" },
				prior_intent_token: token(),
				diffProvider: () => DIFF,
				now,
			}),
		).toThrow(/digest/i);
		expect(mutationRegistryA.isConsumed(cap)).toBe(false);
	});

	test("begin_drain consumes the user capability and converges the claim", () => {
		const cap = drainCapability();
		const claim = appA.beginDrain({ root, task_id: TASK, capability: cap, now });
		expect(claim.lifecycle_status).toBe("draining");
		expect(mutationRegistryA.isConsumed(cap)).toBe(true);
		expect(readBackendClaim(root)?.lifecycle_status).toBe("draining");
	});

	test("begin_drain exact committed replay is idempotent without re-consuming", () => {
		const cap = drainCapability();
		appA.beginDrain({ root, task_id: TASK, capability: cap, now });
		const second = appA.beginDrain({ root, task_id: TASK, capability: cap, now });
		expect(second.lifecycle_status).toBe("draining");
		expect(mutationRegistryA.isConsumed(cap)).toBe(true);
	});

	test("begin_drain with wrong-registry capability fails closed", () => {
		const foreign = drainCapability(mutationRegistryB);
		expect(() => appA.beginDrain({ root, task_id: TASK, capability: foreign, now })).toThrow();
		expect(readBackendClaim(root)?.lifecycle_status).toBe("active");
	});

	test("begin_drain after terminalization fails closed", () => {
		const cap = stopActionCapability();
		appA.execute({
			root,
			task_id: TASK,
			operation: { op: "stop", capability: cap, reason: "halt", actor_id: "user" },
			prior_intent_token: token(),
			diffProvider: () => DIFF,
			now,
		});
		const drain = drainCapability();
		expect(() => appA.beginDrain({ root, task_id: TASK, capability: drain, now })).toThrow(
			/no active backend claim|terminal/i,
		);
	});

	test("simultaneous markers fail closed under one lock", () => {
		// Manually plant a second marker alongside the drain marker scenario;
		// any lock acquisition must refuse ambiguous recovery state.
		const { writeFileSync: write, existsSync } = require("node:fs") as typeof import("node:fs");
		const expectedClaim = readBackendClaim(root)!;
		const nextClaim = { ...expectedClaim, lifecycle_status: "draining", updated_at: now };
		write(
			join(root, ".imm/tasks/.drain-transaction.json"),
			`${JSON.stringify({
				contract: "assurance_kernel/drain_transaction/v1",
				task_id: TASK,
				expected_claim_content: `${JSON.stringify(expectedClaim, null, 2)}\n`,
				next_claim_content: `${JSON.stringify(nextClaim, null, 2)}\n`,
				at: now,
			}, null, 2)}\n`,
		);
		write(
			join(root, ".imm/tasks/.workspace-transaction-v2.json"),
			'{"contract":"assurance_kernel/workspace_transaction/v2","task_id":"x","expected_record_hash":"h","next_record_content":"{}","expected_workspace_hash":"w","next_workspace_content":"{}"}\n',
		);
		expect(() => withKernelStoreLockV2(root, () => undefined)).toThrow(/markers are forbidden/i);
		expect(existsSync(join(root, ".imm/tasks/.drain-transaction.json"))).toBe(true);
	});
});

describe("capability action digest single-source", () => {
	test("capabilityActionFor digest matches the parsed action the application inspects", async () => {
		const { capabilityActionFor } = await import(
			"../plugins/immune-brain/runtime/kernel/canary_application"
		);
		const { digestOfAction } = await import(
			"../plugins/immune-brain/runtime/kernel/authority_port"
		);
		const { parseTaskActionV2 } = await import(
			"../plugins/immune-brain/runtime/kernel/validation"
		);
		const at = "2026-08-12T10:00:00.000Z";
		const approval = {
			id: "approval-qa-abc12345",
			kind: "qa",
			authority_role: "qa",
			task_revision: 1,
			intent_content_hash: "sha256:" + "1".repeat(64),
			diff_hash: "sha256:" + "2".repeat(64),
			actor_id: "qa-child-00000000",
			summary: "verified",
		};
		// The minted digest (placeholder hashes, excluded from the digest) must
		// equal the digest of the parsed action with real hashes.
		const minted = capabilityActionFor({
			op: "record_approval",
			task_id: "task-x",
			at,
			actor_id: "qa-child-00000000",
			approval,
		});
		const parsed = parseTaskActionV2({
			...minted,
			expected_record_hash: "sha256:" + "3".repeat(64),
			expected_workspace_hash: "sha256:" + "4".repeat(64),
			diff_hash: "sha256:" + "2".repeat(64),
		});
		expect(digestOfAction(minted)).toBe(digestOfAction(parsed));
	});

	test("capabilityActionFor stop/rework shapes are digest-stable across parse", async () => {
		const { capabilityActionFor } = await import(
			"../plugins/immune-brain/runtime/kernel/canary_application"
		);
		const { digestOfAction } = await import(
			"../plugins/immune-brain/runtime/kernel/authority_port"
		);
		const { parseTaskActionV2 } = await import(
			"../plugins/immune-brain/runtime/kernel/validation"
		);
		const at = "2026-08-12T10:00:00.000Z";
		const real = (n: string) => "sha256:" + n.repeat(64);
		for (const op of ["stop", "request_rework", "record_user_approval", "resolve_user_decision"] as const) {
			const minted = capabilityActionFor({
				op,
				task_id: "task-x",
				at,
				actor_id: "user",
				...(op === "stop" ? { reason: "literal user stop" } : {}),
				...(op === "request_rework"
					? { findings: [{ id: "f-1", kind: "blocking", status: "open", acceptance_id: "A1", source: "review", review_round: null, summary: "s" }] }
					: {}),
				...(op === "record_user_approval"
					? { approval: { id: "a1", kind: "user", authority_role: "user", task_revision: 1, intent_content_hash: real("1"), diff_hash: real("2"), actor_id: "user", summary: "s" } }
					: {}),
				...(op === "resolve_user_decision"
					? { finding_id: "f-1", resolution: "accepted" }
					: {}),
			});
			const parsed = parseTaskActionV2({
				...minted,
				expected_record_hash: real("3"),
				expected_workspace_hash: real("4"),
				diff_hash: real("2"),
			});
			expect(digestOfAction(minted)).toBe(digestOfAction(parsed));
		}
	});

	test("begin-drain digest matches the canonical drain action", async () => {
		const { capabilityActionFor, beginDrainCapabilityAction } = await import(
			"../plugins/immune-brain/runtime/kernel/canary_application"
		);
		const { digestOfAction } = await import(
			"../plugins/immune-brain/runtime/kernel/authority_port"
		);
		const at = "2026-08-12T10:00:00.000Z";
		const minted = capabilityActionFor({ op: "begin-drain", task_id: "task-x", at, actor_id: "user" });
		const canonical = beginDrainCapabilityAction("task-x", at);
		expect(digestOfAction(minted as never)).toBe(digestOfAction(canonical));
	});
});
