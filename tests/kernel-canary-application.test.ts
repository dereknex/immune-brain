import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestOfAction } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { createMutationAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/authority_port";
import {
	capabilityActionFor,
	createCanaryApplication,
	type CanaryOperation,
} from "../plugins/immune-brain/runtime/kernel/canary_application";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash, parseTaskIntentV1, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { readBackendClaim, readTaskTombstone } from "../plugins/immune-brain/runtime/kernel/backend_claim";
import { readTaskRecord } from "../plugins/immune-brain/runtime/kernel/storage";
import { createMutationAuthorityCapabilityForTest } from "./fixtures/mutation-authority-test-seam";
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
	scope_hint: [
		"docs/plans",
		"docs/specs/canary-app-task.spec.md",
		"docs/specs/archive/canary-app-task.spec.md",
	],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;
const INTENT_HASH = canonicalIntentHash(parseTaskIntentV1(INTENT));
const DIFF = `sha256:${"a".repeat(64)}`;

let root: string;
let registry: ReturnType<typeof createMutationAuthorityRegistry>;
let app: ReturnType<typeof createCanaryApplication>;
const now = "2026-08-12T10:00:00.000Z";

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "canary-app-"));
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, "docs", "specs"), { recursive: true });
	mkdirSync(join(root, ".imm/state"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(join(root, "docs", "plans", `${TASK}.intent.json`), `${JSON.stringify(INTENT, null, 2)}\n`);
	writeFileSync(join(root, "docs", "specs", `${TASK}.spec.md`), "# Canary app task\n");
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "intent"], { cwd: root });
	writeFileSync(join(root, ".imm", "workspace.json"), `${JSON.stringify({
		contract: "assurance_kernel/workspace/v1",
		current_working: null,
	}, null, 2)}\n`);
	const enrollmentRegistry = createEnrollmentAuthorityRegistry();
	const preparation = preparePiCanary(root, { task_id: TASK, now });
	const binding: EnrollmentCapabilityBinding = {
		task_id: TASK,
		intent_path: `docs/plans/${TASK}.intent.json`,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		preparation_digest: preparation.digest,
		actor_id: "user",
		confirmation_ref: "pi-confirm-enroll",
		expires_at: "2099-01-01T00:00:00.000Z",
		nonce: "nonce-enroll",
	};
	enrollCanaryTask(root, {
		task_id: TASK,
		intent_path: binding.intent_path,
		intent_revision: 1,
		preparation_digest: preparation.digest,
		capability: enrollmentRegistry.issue(binding),
		capability_binding: binding,
		now,
	}, enrollmentRegistry);
	registry = createMutationAuthorityRegistry();
	app = createCanaryApplication(registry);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function token() {
	const record = readTaskRecord(root, TASK).record;
	return readTaskIntent(root, TASK, record?.intent_ref.path).token;
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

function capabilityFor(
	authority_kind: "qa" | "review" | "user",
	op: "record_approval" | "stop",
	at: string,
	payload: { approval?: Record<string, unknown>; reason?: string },
) {
	const actor_id = authority_kind === "user" ? "user" : `${authority_kind}-1`;
	const action = capabilityActionFor({ op, task_id: TASK, at, actor_id, ...payload });
	return createMutationAuthorityCapabilityForTest(registry, {
		authority_kind,
		task_id: TASK,
		action_digest: digestOfAction(action),
		expected_record_hash: readTaskRecord(root, TASK).revision,
		intent_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: DIFF,
		actor_id,
		confirmation_ref: `conf-${authority_kind}`,
		expires_at: "2099-01-01T00:00:00.000Z",
		findings_digest: null,
	});
}

function freeze(at = "2026-08-12T10:00:00.500Z") {
	const result = execute({ op: "freeze_artifacts", actor_id: "executor-1" }, at);
	execFileSync("git", ["add", "-A"], { cwd: root });
	return result;
}

function qaApproval(at = "2026-08-12T10:00:01.000Z") {
	const approval = {
		id: "ap-qa",
		kind: "qa",
		authority_role: "qa",
		task_revision: 1,
		intent_content_hash: INTENT_HASH,
		diff_hash: DIFF,
		actor_id: "qa-1",
		summary: "all descriptors passed",
	};
	const capability = capabilityFor("qa", "record_approval", at, { approval });
	return execute({ op: "record_approval", approval, capability, actor_id: "qa-1" }, at);
}

describe("canary application v3 semantic operations", () => {
	test("ordinary finding derives event, CAS, and actor identity", () => {
		const result = execute({
			op: "record_finding",
			finding: { id: "f-1", kind: "advisory", acceptance_id: "A1", summary: "note" },
			actor_id: "executor-1",
		});
		expect(result.record.findings[0]).toMatchObject({ id: "f-1", source: "execution", status: "open" });
		expect(result.record.history[0].id).toBe(`record_finding:${TASK}:${now}`);
	});

	test("unknown operations and raw action injection fail closed", () => {
		expect(() => execute({ op: "evil_operation", actor_id: "x" } as never)).toThrow(KernelInvariantError);
		expect(() => execute({ op: "complete", type: "stop", actor_id: "x" } as never)).toThrow(/not eligible|artifact/i);
		expect(readTaskRecord(root, TASK).record?.lifecycle).toBe("active");
	});

	test("exact ordinary replay is idempotent and conflicting reuse fails", () => {
		const operation: CanaryOperation = {
			op: "record_finding",
			finding: { id: "f-1", kind: "advisory", acceptance_id: "A1", summary: "note" },
			actor_id: "executor-1",
		};
		const first = execute(operation);
		const replay = execute(operation);
		expect(replay.revision).toBe(first.revision);
		expect(() => execute({
			...operation,
			finding: { ...operation.finding, summary: "changed" },
		})).toThrow(KernelInvariantError);
	});

	test("freeze relocates bound artifacts and preserves active ownership", () => {
		const result = freeze();
		expect(result.record).toMatchObject({ lifecycle: "active", artifact_state: "frozen" });
		expect(result.record.intent_ref.path).toBe(`docs/plans/archive/${TASK}.intent.json`);
		expect(result.workspace.state.current_working).toBe(TASK);
	});

	test("privileged mutation without capability performs zero writes", () => {
		expect(() => execute({ op: "stop", reason: "halt", actor_id: "user" } as never)).toThrow(/capability|authority/i);
		expect(readTaskRecord(root, TASK).record).toMatchObject({ lifecycle: "active", artifact_state: "active" });
	});

	test("privileged stop consumes exact user authority and terminalizes", () => {
		const capability = capabilityFor("user", "stop", now, { reason: "halt" });
		const result = execute({ op: "stop", capability, reason: "halt", actor_id: "user" });
		expect(result.record).toMatchObject({ lifecycle: "stopped", artifact_state: "frozen" });
		expect(result.workspace.state.current_working).toBeNull();
		expect(registry.isConsumed(capability)).toBe(true);
		expect(readTaskTombstone(root, TASK)?.terminal_lifecycle).toBe("stopped");
	});

	test("routine journey freezes, atomically records QA, and completes", () => {
		freeze();
		const approved = qaApproval();
		expect(approved.record.attestations[0]).toMatchObject({
			kind: "qa",
			acceptance_results: [
				{ acceptance_id: "A1", status: "passed" },
				{ acceptance_id: "A2", status: "passed" },
			],
		});
		const done = execute({ op: "complete", actor_id: "executor-1" }, "2026-08-12T10:00:02.000Z");
		expect(done.record.lifecycle).toBe("done");
		expect(readBackendClaim(root)).toBeNull();
		expect(readTaskTombstone(root, TASK)).toMatchObject({
			contract: "assurance_kernel/task_tombstone/v2",
			terminal_lifecycle: "done",
			final_record_hash: done.revision,
		});
	});

	test("record and resolve finding through the closed union", () => {
		execute({
			op: "record_finding",
			finding: { id: "f-1", kind: "advisory", acceptance_id: "A1", summary: "note" },
			actor_id: "executor-1",
		}, "2026-08-12T10:00:01.000Z");
		const resolved = execute({ op: "resolve_finding", finding_id: "f-1", actor_id: "executor-1" }, "2026-08-12T10:00:02.000Z");
		expect(resolved.record.findings[0].status).toBe("resolved");
	});

	test("draining retains same-task ordinary mutation authority", () => {
		const action = { type: "stop", event_id: `begin_drain:${TASK}:${now}`, at: now, actor_id: "user", reason: "begin_drain" };
		const capability = createMutationAuthorityCapabilityForTest(registry, {
			authority_kind: "user",
			task_id: TASK,
			action_digest: digestOfAction(action as never),
			expected_record_hash: readTaskRecord(root, TASK).revision,
			intent_revision: 1,
			intent_content_hash: INTENT_HASH,
			diff_hash: `sha256:${"0".repeat(64)}`,
			actor_id: "user",
			confirmation_ref: "conf-drain",
			expires_at: "2099-01-01T00:00:00.000Z",
			findings_digest: null,
		});
		app.beginDrain({ root, task_id: TASK, capability, now });
		expect(readBackendClaim(root)?.lifecycle_status).toBe("draining");
		const result = execute({
			op: "record_finding",
			finding: { id: "f-1", kind: "advisory", acceptance_id: "A1", summary: "still owned" },
			actor_id: "executor-1",
		}, "2026-08-12T10:00:01.000Z");
		expect(result.record.lifecycle).toBe("active");
	});
});
