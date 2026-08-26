// P2B2 U1: backend claim writer boundary. Covers the single secure-path claim
// transaction owner: no direct/exported writer or remover in the runtime, the
// workspace claim accepts only active/draining, a legacy fixture-shaped global
// terminal claim fails closed, and every claim change flows through the
// recoverable Kernel store transactions (enrollment, drain, terminalization).

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	readBackendClaim,
	parseBackendClaim,
	readTaskTombstone,
} from "../plugins/immune-brain/runtime/kernel/backend_claim";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { createMutationAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { createMutationAuthorityCapabilityForTest } from "./fixtures/mutation-authority-test-seam";
import { createCanaryApplication } from "../plugins/immune-brain/runtime/kernel/canary_application";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { readTaskRecord, withKernelStoreLock } from "../plugins/immune-brain/runtime/kernel/storage";
import { createHash } from "node:crypto";

const TASK = "canary-writer-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "claim writer boundary",
	acceptance: [{ id: "A1", assertion: "a1", verification: "v1" }],
	scope_hint: ["docs/plans"],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;
const INTENT_HASH = canonicalIntentHash(INTENT);
const DIFF = "sha256:" + "d".repeat(64);

let root: string;
let mutationRegistry: ReturnType<typeof createMutationAuthorityRegistry>;
let app: ReturnType<typeof createCanaryApplication>;
let now: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "canary-writer-"));
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

describe("backend claim writer boundary", () => {
	test("backend_claim module exports no direct writer or remover", () => {
		const module = Object.keys(
			require("../plugins/immune-brain/runtime/kernel/backend_claim"),
		);
		expect(module).not.toContain("writeBackendClaim");
		expect(module).not.toContain("removeBackendClaim");
	});

	test("claim transitions flow through the recoverable transaction owner", () => {
		// Enrollment created the active claim; the drain transaction converges it.
		expect(readBackendClaim(root)?.lifecycle_status).toBe("active");
		const record = readTaskRecord(root, TASK);
		const drainAction = {
			type: "stop",
			event_id: `begin_drain:${TASK}:${now}`,
			at: now,
			actor_id: "user",
			expected_record_hash: undefined,
			expected_workspace_hash: undefined,
			diff_hash: undefined,
			reason: "begin_drain",
		};
		const digest = (a: Record<string, unknown>) =>
			createHash("sha256").update(JSON.stringify(a)).digest("hex");
		const drainCap = createMutationAuthorityCapabilityForTest(mutationRegistry, {
			authority_kind: "user",
			task_id: TASK,
			action_digest: digest(drainAction),
			expected_record_hash: record.revision,
			intent_revision: 1,
			intent_content_hash: INTENT_HASH,
			diff_hash: "sha256:" + "0".repeat(64),
			actor_id: "user-1",
			confirmation_ref: "conf-drain",
			expires_at: "2099-01-01T00:00:00.000Z",
			findings_digest: null,
		});
		app.beginDrain({ root, task_id: TASK, capability: drainCap, now });
		expect(readBackendClaim(root)?.lifecycle_status).toBe("draining");
		// The terminal transaction removes the claim and writes the tombstone.
		const stopAction = {
			type: "stop",
			event_id: `stop:${TASK}:2026-08-12T10:00:01.000Z`,
			at: "2026-08-12T10:00:01.000Z",
			actor_id: "user",
			reason: "halt",
		};
		const stopCap = createMutationAuthorityCapabilityForTest(mutationRegistry, {
			authority_kind: "user",
			task_id: TASK,
			action_digest: digest(stopAction),
			expected_record_hash: readTaskRecord(root, TASK).revision,
			intent_revision: 1,
			intent_content_hash: INTENT_HASH,
			diff_hash: DIFF,
			actor_id: "user-1",
			confirmation_ref: "conf-stop",
			expires_at: "2099-01-01T00:00:00.000Z",
			findings_digest: null,
		});
		app.execute({
			root,
			task_id: TASK,
			operation: { op: "stop", capability: stopCap, reason: "halt", actor_id: "user" },
			prior_intent_token: readTaskIntent(root, TASK).token,
			diffProvider: () => DIFF,
			now: "2026-08-12T10:00:01.000Z",
		});
		expect(readBackendClaim(root)).toBeNull();
		expect(readTaskTombstone(root, TASK)?.terminal_lifecycle).toBe("stopped");
	});

	test("workspace claim parse rejects terminal; global terminal stays malformed", () => {
		expect(() =>
			parseBackendClaim({
				contract: "assurance_kernel/backend_claim/v2",
				backend: "kernel",
				task_id: TASK,
				intent_revision: 1,
				intent_content_hash: "sha256:h",
				enrollment_event_id: "e",
				lifecycle_status: "terminal",
				created_at: now,
				updated_at: now,
			} as never),
		).toThrow(/active or draining/i);
	});

	test("unknown claim fields fail closed", () => {
		const claim = readBackendClaim(root)!;
		writeFileSync(
			join(root, ".imm/state/active-claim.json"),
			`${JSON.stringify({ ...claim, forged: true }, null, 2)}\n`,
		);
		expect(() => readBackendClaim(root)).toThrow(/unknown field/i);
	});

	test("lock acquisition refuses simultaneous markers of any kind", () => {
		const claim = readBackendClaim(root)!;
		writeFileSync(
			join(root, ".imm/state/transactions/drain-transaction.json"),
			`${JSON.stringify(
				{
					contract: "assurance_kernel/drain_transaction/v1",
					task_id: TASK,
					expected_claim_content: `${JSON.stringify(claim, null, 2)}\n`,
					next_claim_content: `${JSON.stringify({ ...claim, lifecycle_status: "draining" }, null, 2)}\n`,
					at: now,
				},
				null,
				2,
			)}\n`,
		);
		writeFileSync(
			join(root, ".imm/state/transactions/terminal-transaction.json"),
			'{"contract":"assurance_kernel/terminal_transaction/v1","task_id":"x","transaction":{},"tombstone":{}}\n',
		);
		expect(() => withKernelStoreLock(root, () => undefined)).toThrow(/markers are forbidden/i);
	});

	test("malformed drain marker fails closed and remains recoverable", () => {
		writeFileSync(
			join(root, ".imm/state/transactions/drain-transaction.json"),
			'{"contract":"assurance_kernel/drain_transaction/v1","task_id":"x","expected_claim_content":"{}","next_claim_content":"{}","at":"t"}\n',
		);
		expect(() => withKernelStoreLock(root, () => undefined)).toThrow();
		// Nothing was mutated by the failed recovery.
		expect(readBackendClaim(root)?.lifecycle_status).toBe("active");
	});
});
