import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import {
	readBackendClaim,
	serializeBackendClaim,
	type BackendClaim,
} from "../plugins/immune-brain/runtime/kernel/backend_claim";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { readTaskRecord } from "../plugins/immune-brain/runtime/kernel/storage";

function makeRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "p2b0-enroll-"));
	mkdirSync(join(root, ".imm/state"), { recursive: true });
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	return root;
}

const CLAIM_PATH = ".imm/state/active-claim.json";

function baseIntent(taskId: string, revision = 1) {
	return {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		owner: "user",
		goal: `goal for ${taskId}`,
		acceptance: [
			{
				id: "acc-1",
				assertion: `assertion for ${taskId}`,
				verification: `bun test tests/${taskId}.test.ts`,
			},
		],
		scope_hint: ["docs/plans"],
		risk: "routine",
		revision,
	};
}

function writeIntent(root: string, taskId: string, intent = baseIntent(taskId)) {
	const path = join(root, "docs", "plans", `${taskId}.intent.json`);
	writeFileSync(path, `${JSON.stringify(intent, null, 2)}\n`);
	gitInitAndCommit(root);
	return path;
}

function gitInitAndCommit(root: string): void {
	const { execFileSync } = require("node:child_process");
	try {
		execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
		execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
		execFileSync("git", ["commit", "-q", "-m", "fixture"], {
			cwd: root,
			stdio: "ignore",
			env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
		});
	} catch {
		// git may be unavailable in sandbox; tests requiring tracking will fail otherwise
	}
}

function bindingFor(root: string, taskId: string): EnrollmentCapabilityBinding {
	const prep = preparePiCanary(root, { task_id: taskId, now: "2026-08-12T00:00:00.000Z" });
	return {
		task_id: taskId,
		intent_path: `docs/plans/${taskId}.intent.json`,
		intent_revision: 1,
		intent_content_hash: prep.intent?.content_hash ?? "sha256:any",
		preparation_digest: prep.digest,
		actor_id: "user",
		confirmation_ref: "pi-confirm-001",
		expires_at: "2099-01-01T00:00:00.000Z",
		nonce: "nonce-001",
	};
}

describe("backend claim", () => {
	test("read returns null when absent", () => {
		const root = makeRoot();
		expect(readBackendClaim(root)).toBeNull();
	});

	test("serialize then read round-trips through the canonical bytes", () => {
		const root = makeRoot();
		const claim: BackendClaim = {
			contract: "assurance_kernel/backend_claim/v2",
			backend: "kernel",
			task_id: "task-001",
			intent_revision: 1,
			intent_content_hash: "sha256:intent",
			enrollment_event_id: "evt-1",
			lifecycle_status: "active",
			created_at: "2026-08-12T00:00:00.000Z",
			updated_at: "2026-08-12T00:00:00.000Z",
		};
		writeFileSync(join(root, CLAIM_PATH), serializeBackendClaim(claim));
		const read = readBackendClaim(root);
		expect(read).toEqual(claim);
	});

	test("malformed claim fails closed", () => {
		const root = makeRoot();
		writeFileSync(join(root, CLAIM_PATH), `{"contract":"assurance_kernel/backend_claim/v2","backend":"v3"}\n`);
		expect(() => readBackendClaim(root)).toThrow();
	});

	test("module exports no direct claim writer or remover", () => {
		const module = Object.keys(require("../plugins/immune-brain/runtime/kernel/backend_claim"));
		expect(module).not.toContain("writeBackendClaim");
		expect(module).not.toContain("removeBackendClaim");
	});
});

describe("enrollment transaction", () => {
	const registry = createEnrollmentAuthorityRegistry();
	test("enrolls TaskRecord v3 + workspace + backend claim atomically", () => {
		const root = makeRoot();
		const taskId = "task-001";
		const intentPath = writeIntent(root, taskId);
		const binding = bindingFor(root, taskId);
		const cap = registry.issue(binding);
		const result = enrollCanaryTask(root, {
			task_id: taskId,
			intent_path: `docs/plans/${taskId}.intent.json`,
			intent_revision: 1,
			preparation_digest: binding.preparation_digest,
			capability: cap,
			capability_binding: binding,
			now: "2026-08-12T00:00:00.000Z",
		}, registry);
		expect(result.record).toMatchObject({ lifecycle: "active", artifact_state: "active" });
		expect(result.record.task_id).toBe(taskId);
		expect(result.record.intent_snapshot.revision).toBe(1);
		const read = readTaskRecord(root, taskId);
		expect(read.record).toMatchObject({ lifecycle: "active", artifact_state: "active" });
		const claim = readBackendClaim(root);
		expect(claim?.task_id).toBe(taskId);
		expect(claim?.lifecycle_status).toBe("active");
		// capability consumed
		expect(() => enrollCanaryTask(root, {
			task_id: taskId,
			intent_path: `docs/plans/${taskId}.intent.json`,
			intent_revision: 1,
			capability: cap,
			capability_binding: bindingFor(root, taskId),
			now: "2026-08-12T00:00:00.000Z",
		}, registry)).toThrow(/consumed/i);
	});

	test("rejects when capability binding mismatches", () => {
		const root = makeRoot();
		const taskId = "task-002";
		writeIntent(root, taskId);
		const cap = registry.issue({ ...bindingFor(root, taskId), task_id: "task-other" });
		expect(() =>
			enrollCanaryTask(root, {
				task_id: taskId,
				intent_path: `docs/plans/${taskId}.intent.json`,
				intent_revision: 1,
				capability: cap,
				capability_binding: bindingFor(root, taskId),
				now: "2026-08-12T00:00:00.000Z",
			}, registry),
		).toThrow(/mismatch/i);
	});

	test("rejects when intent sidecar is missing", () => {
		const root = makeRoot();
		const taskId = "task-003";
		const cap = registry.issue(bindingFor(root, taskId));
		expect(() =>
			enrollCanaryTask(root, {
				task_id: taskId,
				intent_path: `docs/plans/${taskId}.intent.json`,
				intent_revision: 1,
				capability: cap,
				capability_binding: bindingFor(root, taskId),
				now: "2026-08-12T00:00:00.000Z",
			}, registry),
		).toThrow();
	});

	test("rejects duplicate enrollment for same task", () => {
		const root = makeRoot();
		const taskId = "task-004";
		writeIntent(root, taskId);
		const cap1 = registry.issue(bindingFor(root, taskId));
		enrollCanaryTask(root, {
			task_id: taskId,
			intent_path: `docs/plans/${taskId}.intent.json`,
			intent_revision: 1,
			preparation_digest: bindingFor(root, taskId).preparation_digest,
			capability: cap1,
			capability_binding: bindingFor(root, taskId),
			now: "2026-08-12T00:00:00.000Z",
		}, registry);
		const cap2 = registry.issue(bindingFor(root, taskId));
		const prep2 = preparePiCanary(root, { task_id: taskId, now: "2026-08-12T00:00:00.000Z" });
		expect(() =>
			enrollCanaryTask(root, {
				task_id: taskId,
				intent_path: `docs/plans/${taskId}.intent.json`,
				intent_revision: 1,
				preparation_digest: prep2.digest,
				capability: cap2,
				capability_binding: bindingFor(root, taskId),
				now: "2026-08-12T00:00:00.000Z",
			}, registry),
		).toThrow(/already|exists/i);
	});

	test("rejects enrollment when workspace is already owned", () => {
		const root = makeRoot();
		const taskId = "task-005";
		writeIntent(root, taskId);
		writeFileSync(
			join(root, ".imm/state/workspace.json"),
			`{"contract":"assurance_kernel/workspace/v1","current_working":"other-task"}\n`,
		);
		// Binding after the workspace is owned: preparation digest reflects the
		// owner set, and enrollment must reject with the owned diagnostic.
		const cap = registry.issue(bindingFor(root, taskId));
		const prep = preparePiCanary(root, { task_id: taskId, now: "2026-08-12T00:00:00.000Z" });
		expect(prep.workspace.current_working).toBe("other-task");
		expect(() =>
			enrollCanaryTask(root, {
				task_id: taskId,
				intent_path: `docs/plans/${taskId}.intent.json`,
				intent_revision: 1,
				preparation_digest: prep.digest,
				capability: cap,
				capability_binding: bindingFor(root, taskId),
				now: "2026-08-12T00:00:00.000Z",
			}, registry),
		).toThrow(/owned/i);
	});
});
