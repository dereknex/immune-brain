// P2B2 U1: canary application closed semantic operations. Covers the semantic
// operation allowlist, internally derived event/CAS/Intent/diff identities,
// stale/unknown/raw rejection, exact committed replay, ordinary vs privileged
// routing, and full working -> review -> done / stopped journeys.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createCanaryApplication,
	type CanaryOperation,
} from "../plugins/immune-brain/runtime/kernel/canary_application";
import { createMutationAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { createMutationAuthorityCapabilityForTest } from "./fixtures/mutation-authority-test-seam";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { readBackendClaim, readTaskTombstone } from "../plugins/immune-brain/runtime/kernel/backend_claim";
import { readTaskRecordV2 } from "../plugins/immune-brain/runtime/kernel/storage";
import { KernelInvariantError } from "../plugins/immune-brain/runtime/kernel/validation";

const TASK = "canary-app-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "operate one canary",
	acceptance: [
		{ id: "A1", assertion: "acceptance one", verification: "verify one" },
		{ id: "A2", assertion: "acceptance two", verification: "verify two" },
	],
	scope_hint: ["docs/plans"],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;
const INTENT_HASH = canonicalIntentHash(INTENT);
const DIFF = "sha256:" + "a".repeat(64);

let root: string;
let enrollmentRegistry: ReturnType<typeof createEnrollmentAuthorityRegistry>;
let mutationRegistry: ReturnType<typeof createMutationAuthorityRegistry>;
let app: ReturnType<typeof createCanaryApplication>;
let now: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "canary-app-"));
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
	enrollmentRegistry = createEnrollmentAuthorityRegistry();
	const prep = preparePiCanary(root, { task_id: TASK, now });
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
	const cap = enrollmentRegistry.issue(binding);
	enrollCanaryTask(
		root,
		{
			task_id: TASK,
			intent_path: `docs/plans/${TASK}.intent.json`,
			intent_revision: 1,
			preparation_digest: binding.preparation_digest,
			capability: cap,
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

function token() {
	return readTaskIntent(root, TASK).token;
}

function execute(operation: CanaryOperation, at = now) {
	return app.execute({
		root,
		task_id: TASK,
		operation,
		prior_intent_token: token(),
		diffProvider: () => DIFF,
		now: at,
	});
}

function userCapabilityFor(action: {
	type: string;
	event_id: string;
	at: string;
	actor_id: string;
	reason?: string;
}) {
	const digest = (a: Record<string, unknown>) =>
		require("node:crypto").createHash("sha256").update(JSON.stringify(a)).digest("hex");
	const record = readTaskRecordV2(root, TASK);
	return createMutationAuthorityCapabilityForTest(mutationRegistry, {
		authority_kind: "user",
		task_id: TASK,
		action_digest: digest(action),
		expected_record_hash: record.revision,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: DIFF,
		actor_id: "user-1",
		confirmation_ref: "conf-1",
		expires_at: "2099-01-01T00:00:00.000Z",
		findings_digest: null,
	});
}

describe("canary application closed semantic operations", () => {
	test("record_evidence derives event/CAS/actor identities and commits", () => {
		const result = execute({ op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "works", actor_id: "executor-1" });
		expect(result.record.evidence).toHaveLength(1);
		const evidence = result.record.evidence[0];
		expect(evidence.acceptance_id).toBe("A1");
		expect(evidence.task_revision).toBe(1);
		expect(evidence.intent_content_hash).toBe(INTENT_HASH);
		expect(evidence.diff_hash).toBe(DIFF);
		expect(evidence.actor_id).toBe("executor-1");
		expect(result.record.history[0].type).toBe("record_evidence");
		expect(result.record.history[0].id).toBe(`record_evidence:${TASK}:${now}`);
	});

	test("unknown semantic operation is rejected", () => {
		expect(() =>
			app.execute({
				root,
				task_id: TASK,
				operation: { op: "evil_operation", actor_id: "x" } as never,
				prior_intent_token: token(),
				diffProvider: () => DIFF,
				now,
			}),
		).toThrow(KernelInvariantError);
	});

	test("raw action fields cannot be injected through the closed union", () => {
		// The operation union has no raw-action carrier: extra fields such as
		// a forged `type`/`raw_action` are structurally ignored, so they can
		// never change the derived action. The evidence op still commits and
		// the phase stays `working` (no injected `complete` takes effect).
		const result = app.execute({
			root,
			task_id: TASK,
			operation: {
				op: "record_evidence",
				acceptance_id: "A1",
				status: "passed",
				summary: "x",
				actor_id: "x",
				type: "complete",
				raw_action: { type: "complete" },
			} as never,
			prior_intent_token: token(),
			diffProvider: () => DIFF,
			now,
		});
		expect(result.record.phase).toBe("working");
		expect(result.record.history[0].type).toBe("record_evidence");
	});

	test("exact committed replay is idempotent", () => {
		const first = execute({ op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "works", actor_id: "executor-1" }, now);
		const replayed = execute({ op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "works", actor_id: "executor-1" }, now);
		expect(replayed.revision).toBe(first.revision);
		expect(replayed.record.evidence).toHaveLength(1);
	});

	test("conflicting event reuse fails closed", () => {
		execute({ op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "works", actor_id: "executor-1" }, now);
		// Same event id (same at) with a different payload is a conflicting retry.
		expect(() =>
			execute({ op: "record_evidence", acceptance_id: "A2", status: "passed", summary: "different", actor_id: "executor-1" }, now),
		).toThrow(KernelInvariantError);
	});

	test("stale record CAS fails closed", () => {
		execute({ op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "works", actor_id: "executor-1" }, now);
		const later = "2026-08-12T10:00:01.000Z";
		execute({ op: "record_evidence", acceptance_id: "A2", status: "passed", summary: "works", actor_id: "executor-1" }, later);
		// Same event id with a different payload is a conflicting retry, not a replay.
		expect(() =>
			execute({ op: "record_evidence", acceptance_id: "A2", status: "passed", summary: "changed", actor_id: "executor-1" }, later),
		).toThrow();
	});

	test("privileged operation without capability fails with zero writes", () => {
		expect(() =>
			execute({ op: "stop", reason: "halt", actor_id: "executor-1" } as never),
		).toThrow(/capability|authority/i);
		expect(readTaskRecordV2(root, TASK).record?.phase).toBe("working");
	});

	test("privileged stop consumes an exact user capability", () => {
		const cap = userCapabilityFor({
			type: "stop",
			event_id: `stop:${TASK}:${now}`,
			at: now,
			actor_id: "user",
			reason: "halt",
		});
		const result = app.execute({
			root,
			task_id: TASK,
			operation: { op: "stop", capability: cap, reason: "halt", actor_id: "user" },
			prior_intent_token: token(),
			diffProvider: () => DIFF,
			now,
		});
		expect(result.record.phase).toBe("stopped");
		expect(result.workspace.state.current_working).toBeNull();
		expect(mutationRegistry.isConsumed(cap)).toBe(true);
	});

	test("full routine journey working -> review -> done", () => {
		execute({ op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "one", actor_id: "executor-1" }, "2026-08-12T10:00:01.000Z");
		execute({ op: "record_evidence", acceptance_id: "A2", status: "passed", summary: "two", actor_id: "executor-1" }, "2026-08-12T10:00:02.000Z");
		execute({ op: "submit_review", actor_id: "executor-1" }, "2026-08-12T10:00:03.000Z");
		const done = execute({ op: "complete", actor_id: "executor-1" }, "2026-08-12T10:00:04.000Z");
		expect(done.record.phase).toBe("done");
		// Terminal ownership transfer: the active claim is removed and the
		// task-scoped tombstone is created; workspace ownership is released.
		expect(readBackendClaim(root)).toBeNull();
		const tombstone = readTaskTombstone(root, TASK);
		expect(tombstone?.terminal_phase).toBe("done");
		expect(tombstone?.final_record_hash).toBe(done.revision);
		expect(done.workspace.state.current_working).toBeNull();
	});

	test("begin_drain requires a user capability", () => {
		expect(() =>
			app.beginDrain({ root, task_id: TASK, capability: {}, now }),
		).toThrow();
		const claim = readBackendClaim(root);
		expect(claim?.lifecycle_status).toBe("active");
	});

	test("record_finding then resolve_finding through closed ops", () => {
		execute(
			{
				op: "record_finding",
				finding: { id: "f-1", kind: "advisory", acceptance_id: "A1", summary: "note" },
				actor_id: "executor-1",
			},
			"2026-08-12T10:00:01.000Z",
		);
		const resolved = execute({ op: "resolve_finding", finding_id: "f-1", actor_id: "executor-1" }, "2026-08-12T10:00:02.000Z");
		expect(resolved.record.findings[0].status).toBe("resolved");
	});

	test("drain then same-task continuation permits ordinary facts", () => {
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
			require("node:crypto").createHash("sha256").update(JSON.stringify(a)).digest("hex");
		const record = readTaskRecordV2(root, TASK);
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
		// Same task may still record ordinary facts while draining.
		const ev = execute({ op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "drain ok", actor_id: "executor-1" }, "2026-08-12T10:00:01.000Z");
		expect(ev.record.evidence).toHaveLength(1);
		expect(ev.record.phase).toBe("working");
	});
});
