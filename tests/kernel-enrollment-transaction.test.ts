import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import {
	readBackendClaim,
	parseBackendClaim,
	type BackendClaim,
} from "../plugins/immune-brain/runtime/kernel/backend_claim";
import {
	KernelStoreConflictError,
	KernelStoreSecurityError,
	backupKernelStore,
	openKernelStore,
	restoreKernelStore,
	withKernelRead,
	readRunRowByTask,
	readWorkspaceRow,
	withKernelTransaction,
} from "../plugins/immune-brain/runtime/kernel/sqlite_store";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { enrollCanaryTask, runEnrollmentRehearsal } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { preparePiCanary, readGitHead } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { readTaskRecord } from "../plugins/immune-brain/runtime/kernel/storage";
import {
	computeBatchPlanDigest,
	createBatchAuthorityRegistry,
	deriveChildEnrollment,
} from "../plugins/immune-brain/runtime/kernel/batch_authority";

function makeRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "p2b0-enroll-"));
	mkdirSync(join(root, ".imm/state"), { recursive: true });
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	return root;
}

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
		scope_hint: [
			"docs/plans",
			`docs/specs/${taskId}.spec.md`,
			`docs/specs/archive/${taskId}.spec.md`,
		],
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

	test("the derived claim round-trips through the canonical parser", () => {
		const root = makeRoot();
		const taskId = "task-001";
		seedEnrolledRun(root, taskId);
		const read = readBackendClaim(root);
		expect(read).not.toBeNull();
		expect(read?.task_id).toBe(taskId);
		expect(read?.lifecycle_status).toBe("active");
		// The claim is a projection of the committed run row, so its canonical
		// bytes re-parse to exactly the same claim.
		expect(parseBackendClaim(read as unknown as Record<string, unknown>)).toEqual(read);
	});

	test("malformed claims fail closed in the parser", () => {
		expect(() =>
			parseBackendClaim({ contract: "assurance_kernel/backend_claim/v2", backend: "v3" }),
		).toThrow();
	});

	test("module exports no direct claim writer or remover", () => {
		const module = Object.keys(require("../plugins/immune-brain/runtime/kernel/backend_claim"));
		expect(module).not.toContain("writeBackendClaim");
		expect(module).not.toContain("removeBackendClaim");
	});
});

/** Seed one committed active run (the workspace owner) through the store. */
function seedEnrolledRun(root: string, taskId: string, gitHead = "a".repeat(40)) {
	const intent = baseIntent(taskId);
	const record = {
		contract: "assurance_kernel/task_record/v4",
		task_id: taskId,
		intent_snapshot: intent,
		intent_ref: {
			path: `docs/plans/${taskId}.intent.json`,
			content_hash: canonicalIntentHash(parseTaskIntentV1(intent)),
		},
		lifecycle: "active",
		artifact_state: "active",
		baseline: `sha256:${"a".repeat(64)}`,
		git_base_head: gitHead,
		attestations: [],
		findings: [],
		history: [],
	};
	const intentPath = join(root, "docs", "plans", `${taskId}.intent.json`);
	mkdirSync(dirname(intentPath), { recursive: true });
	writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`);
	return seedKernelRunForTest(root, { task_id: taskId, record });
}

describe("enrollment transaction", () => {
	const registry = createEnrollmentAuthorityRegistry();
	test("enrolls TaskRecord v4 with immutable Git base + workspace + backend claim atomically", () => {
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
		expect(result.record).toMatchObject({ contract: "assurance_kernel/task_record/v4", lifecycle: "active", artifact_state: "active" });
		expect(result.record).toHaveProperty("git_base_head");
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
		seedEnrolledRun(root, "other-task");
		// The owner's sidecar must be Git-tracked like any enrolled intent.
		gitInitAndCommit(root);
		// Ownership is derived from the single active run, so a second task can
		// neither prepare nor enroll against the owned worktree.
		expect(() =>
			preparePiCanary(root, { task_id: taskId, now: "2026-08-12T00:00:00.000Z" }),
		).toThrow(/belongs to task other-task/);
		const owner = preparePiCanary(root, { task_id: "other-task", now: "2026-08-12T00:00:00.000Z" });
		expect(owner.workspace.current_working).toBe("other-task");
		expect(owner.backend_claim).toMatchObject({ present: true, task_id: "other-task" });
		expect(withKernelRead(root, (db) => readRunRowByTask(db, taskId))).toBeNull();
	});

	test("rejects same-revision intent content drift without authority writes", () => {
		const root = makeRoot();
		const taskId = "task-006";
		const intentPath = writeIntent(root, taskId);
		const binding = bindingFor(root, taskId);
		const capability = registry.issue(binding);
		const changedIntent = { ...baseIntent(taskId), goal: "changed after confirmation" };
		writeFileSync(intentPath, `${JSON.stringify(changedIntent, null, 2)}\n`);
		const changedPreparation = preparePiCanary(root, { task_id: taskId, now: "2026-08-12T00:00:00.000Z" });

		expect(() => enrollCanaryTask(root, {
			task_id: taskId,
			intent_path: `docs/plans/${taskId}.intent.json`,
			intent_revision: 1,
			preparation_digest: changedPreparation.digest,
			capability,
			capability_binding: binding,
			now: "2026-08-12T00:00:00.000Z",
		}, registry)).toThrow(/content hash/i);
		expect(readTaskRecord(root, taskId).record).toBeNull();
		expect(readBackendClaim(root)).toBeNull();
		expect(registry.isConsumed(capability)).toBe(false);
	});
});

describe("enrollment Spec binding precondition", () => {
	const registry = createEnrollmentAuthorityRegistry();
	const NOW = "2026-08-12T00:00:00.000Z";

	function attempt(root: string, taskId: string) {
		const binding = bindingFor(root, taskId);
		const capability = registry.issue(binding);
		const input = {
			task_id: taskId,
			intent_path: `docs/plans/${taskId}.intent.json`,
			intent_revision: 1,
			preparation_digest: binding.preparation_digest,
			capability,
			capability_binding: binding,
			now: NOW,
		};
		return { binding, capability, input };
	}

	test("refuses an intent that binds no Spec and names the required pair", () => {
		const root = makeRoot();
		const taskId = "task-spec-less";
		writeIntent(root, taskId, { ...baseIntent(taskId), scope_hint: ["docs/plans"] });
		const { capability, input } = attempt(root, taskId);

		expect(() => enrollCanaryTask(root, input, registry)).toThrow(
			/enrollment requires one scope-bound active Spec and its archive path in scope_hint: add docs\/specs\/<name>\.spec\.md and docs\/specs\/archive\/<name>\.spec\.md/,
		);
		// Zero authority: no record, no claim, and the capability stays unconsumed.
		expect(readTaskRecord(root, taskId).record).toBeNull();
		expect(readBackendClaim(root)).toBeNull();
		expect(registry.isConsumed(capability)).toBe(false);
		// Zero authority: no run row, an idle workspace and no derived claim.
		expect(withKernelRead(root, (db) => readRunRowByTask(db, taskId))).toBeNull();
		expect(withKernelRead(root, (db) => readWorkspaceRow(db).current_run_id)).toBeNull();
	});

	test("names the missing archive path when only the active Spec is in scope", () => {
		const root = makeRoot();
		const taskId = "task-active-only";
		writeIntent(root, taskId, {
			...baseIntent(taskId),
			scope_hint: ["docs/plans", `docs/specs/${taskId}.spec.md`],
		});
		const { capability, input } = attempt(root, taskId);

		expect(() => enrollCanaryTask(root, input, registry)).toThrow(
			`enrollment requires the bound Spec pair in scope_hint; add docs/specs/archive/${taskId}.spec.md`,
		);
		expect(registry.isConsumed(capability)).toBe(false);
	});

	test("names the missing active path when only the archive Spec is in scope", () => {
		const root = makeRoot();
		const taskId = "task-archive-only";
		writeIntent(root, taskId, {
			...baseIntent(taskId),
			scope_hint: ["docs/plans", `docs/specs/archive/${taskId}.spec.md`],
		});
		const { capability, input } = attempt(root, taskId);

		expect(() => enrollCanaryTask(root, input, registry)).toThrow(
			`enrollment requires the bound Spec pair in scope_hint; add docs/specs/${taskId}.spec.md`,
		);
		expect(registry.isConsumed(capability)).toBe(false);
	});

	test("the rehearsal reports the same refusal with zero writes and is idempotent", () => {
		const root = makeRoot();
		const taskId = "task-rehearsal-spec-less";
		writeIntent(root, taskId, { ...baseIntent(taskId), scope_hint: ["docs/plans"] });
		const { capability, input } = attempt(root, taskId);

		const first = runEnrollmentRehearsal(root, input, capability, registry);
		const second = runEnrollmentRehearsal(root, input, capability, registry);
		expect(first.writes_performed).toBe(false);
		expect(first.evidence.outcome).toBe("not_ready");
		expect(first.evidence.blockers).toEqual([
			"enrollment requires one scope-bound active Spec and its archive path in scope_hint: add docs/specs/<name>.spec.md and docs/specs/archive/<name>.spec.md",
		]);
		// Unchanged inputs project the same evidence, and the capability is untouched.
		expect(second.evidence).toEqual(first.evidence);
		expect(registry.isConsumed(capability)).toBe(false);
		expect(readTaskRecord(root, taskId).record).toBeNull();
	});
});

describe("batch-derived enrollment atomicity", () => {
	function batchChild(root: string, taskId: string) {
		const prep = preparePiCanary(root, { task_id: taskId, now: "2026-08-12T00:00:00.000Z" });
		if (!prep.intent) throw new Error("fixture intent missing");
		return {
			task_id: taskId,
			intent_path: prep.intent.path,
			intent_revision: prep.intent.revision,
			intent_content_hash: prep.intent.content_hash,
			blocked_by: [] as string[],
		};
	}

	function batchBinding(root: string, children: ReturnType<typeof batchChild>[]) {
		return {
			batch_id: "batch-tx-001",
			initiative_slug: "unattended-initiative-batch-run",
			plan_digest: computeBatchPlanDigest(children),
			branch: "imm/unattended-initiative-batch-run",
			base_head: readGitHead(root),
			budget: {
				max_children: children.length,
				deadline_at: "2099-01-01T00:00:00.000Z",
				qa_failure_limit: 2,
			},
			actor_id: "user",
			confirmation_ref: "batch-confirm-001",
			expires_at: "2099-01-01T00:00:00.000Z",
			nonce: "batch-tx-nonce",
		};
	}

	test("the child slot and the TaskRecord are committed together", () => {
		const root = makeRoot();
		writeIntent(root, "task-b01");
		const children = [batchChild(root, "task-b01")];
		const binding = batchBinding(root, children);
		const batchRegistry = createBatchAuthorityRegistry();
		const capability = batchRegistry.issue(binding, children, "2026-08-12T00:00:00.000Z");
		const enrollmentRegistry = createEnrollmentAuthorityRegistry();
		const head = readGitHead(root);
		const derived = deriveChildEnrollment(root, batchRegistry, {
			capability,
			binding,
			task_id: "task-b01",
			expected_head: head,
			now: "2026-08-12T00:00:00.000Z",
		});
		const childCapability = enrollmentRegistry.issue(derived.binding, "2026-08-12T00:00:00.000Z");

		const result = enrollCanaryTask(
			root,
			{
				task_id: "task-b01",
				intent_path: derived.binding.intent_path,
				intent_revision: derived.binding.intent_revision,
				preparation_digest: derived.binding.preparation_digest,
				capability: childCapability,
				capability_binding: derived.binding,
				batch: { registry: batchRegistry, capability, binding, expected_head: head },
				now: "2026-08-12T00:00:00.000Z",
			},
			enrollmentRegistry,
		);
		expect(result.record.task_id).toBe("task-b01");
		expect(batchRegistry.consumedChildren(capability)).toEqual(["task-b01"]);
		expect(readTaskRecord(root, "task-b01").record).not.toBeNull();
	});

	test("a blocked batch enrollment consumes no slot and writes no record", () => {
		const root = makeRoot();
		writeIntent(root, "task-b02");
		const children = [batchChild(root, "task-b02")];
		const binding = batchBinding(root, children);
		const batchRegistry = createBatchAuthorityRegistry();
		const capability = batchRegistry.issue(binding, children, "2026-08-12T00:00:00.000Z");
		const enrollmentRegistry = createEnrollmentAuthorityRegistry();
		const head = readGitHead(root);
		const derived = deriveChildEnrollment(root, batchRegistry, {
			capability,
			binding,
			task_id: "task-b02",
			expected_head: head,
			now: "2026-08-12T00:00:00.000Z",
		});
		const childCapability = enrollmentRegistry.issue(derived.binding, "2026-08-12T00:00:00.000Z");
		// A worktree that already owns another task blocks the enrollment under
		// the same lock that would have consumed the slot.
		seedEnrolledRun(root, "other-task");

		expect(() =>
			enrollCanaryTask(
				root,
				{
					task_id: "task-b02",
					intent_path: derived.binding.intent_path,
					intent_revision: derived.binding.intent_revision,
					preparation_digest: preparePiCanary(root, {
						task_id: "task-b02",
						now: "2026-08-12T00:00:00.000Z",
					}).digest,
					capability: childCapability,
					capability_binding: derived.binding,
					batch: { registry: batchRegistry, capability, binding, expected_head: head },
					now: "2026-08-12T00:00:00.000Z",
				},
				enrollmentRegistry,
			),
		).toThrow(/belongs to task other-task/);
		expect(batchRegistry.consumedChildren(capability)).toEqual([]);
		expect(readTaskRecord(root, "task-b02").record).toBeNull();
		// The pre-existing owner still holds the workspace claim unchanged.
		expect(readBackendClaim(root)).toMatchObject({ task_id: "other-task", lifecycle_status: "active" });
		expect(withKernelRead(root, (db) => readRunRowByTask(db, "task-b02"))).toBeNull();
	});
});


describe("SQLite enrollment authority (A2)", () => {
	const registry = createEnrollmentAuthorityRegistry();

	function transactionFor(root: string, taskId: string, expectedWorkspace: string) {
		const intent = baseIntent(taskId);
		const record = {
			contract: "assurance_kernel/task_record/v4",
			task_id: taskId,
			intent_snapshot: intent,
			intent_ref: {
				path: `docs/plans/${taskId}.intent.json`,
				content_hash: canonicalIntentHash(parseTaskIntentV1(intent)),
			},
			lifecycle: "active",
			artifact_state: "active",
			baseline: `sha256:${"a".repeat(64)}`,
			git_base_head: "a".repeat(40),
			attestations: [],
			findings: [],
			history: [],
		};
		const claim: BackendClaim = {
			contract: "assurance_kernel/backend_claim/v2",
			backend: "kernel",
			task_id: taskId,
			intent_revision: 1,
			intent_content_hash: canonicalIntentHash(parseTaskIntentV1(intent)),
			enrollment_event_id: `enroll-${taskId}`,
			lifecycle_status: "active",
			created_at: "2026-08-12T00:00:00.000Z",
			updated_at: "2026-08-12T00:00:00.000Z",
		};
		return {
			task_id: taskId,
			transaction: {
				contract: "assurance_kernel/workspace_transaction/v2" as const,
				task_id: taskId,
				expected_record_hash: "missing",
				next_record_content: `${JSON.stringify(record, null, 2)}\n`,
				expected_workspace_hash: expectedWorkspace,
				next_workspace_content: `${JSON.stringify(
					{ contract: "assurance_kernel/workspace/v1", current_working: taskId },
					null,
					2,
				)}\n`,
			},
			claim,
		};
	}

	test("a stale workspace revision refuses enrollment with zero authority writes", async () => {
		const root = makeRoot();
		writeIntent(root, "task-stale");
		const { commitEnrollmentLocked } = await import(
			"../plugins/immune-brain/runtime/kernel/storage"
		);
		const { transaction, claim } = transactionFor(root, "task-stale", "rev:7");
		expect(() =>
			commitEnrollmentLocked(
				root,
				"task-stale",
				transaction,
				claim as unknown as Record<string, unknown>,
			),
		).toThrow(KernelStoreConflictError);
		expect(withKernelRead(root, (db) => readRunRowByTask(db, "task-stale"))).toBeNull();
		expect(withKernelRead(root, (db) => readWorkspaceRow(db).current_run_id)).toBeNull();
	});

	test("replaying the same enrollment event returns the committed result once", async () => {
		const root = makeRoot();
		writeIntent(root, "task-replay");
		const { commitEnrollmentLocked } = await import(
			"../plugins/immune-brain/runtime/kernel/storage"
		);
		const fresh = withKernelRead(root, (db) => readWorkspaceRow(db));
		const workspaceHash = fresh ? `rev:${fresh.revision}` : "missing";
		const { transaction, claim } = transactionFor(root, "task-replay", workspaceHash);
		const first = commitEnrollmentLocked(
			root,
			"task-replay",
			transaction,
			claim as unknown as Record<string, unknown>,
		);
		const firstRun = withKernelRead(root, (db) => readRunRowByTask(db, "task-replay"))!;
		// A lost response replays the same operation identity: the committed
		// result is reused and no second run or owner write appears.
		const replay = commitEnrollmentLocked(
			root,
			"task-replay",
			transaction,
			claim as unknown as Record<string, unknown>,
		);
		expect(replay.record).toEqual(first.record);
		const afterRun = withKernelRead(root, (db) => readRunRowByTask(db, "task-replay"))!;
		expect(afterRun.run_id).toBe(firstRun.run_id);
		expect(afterRun.revision).toBe(firstRun.revision);
	});

	test("a divergent enrollment request for the same event fails without writes", async () => {
		const root = makeRoot();
		writeIntent(root, "task-divergent");
		const { commitEnrollmentLocked } = await import(
			"../plugins/immune-brain/runtime/kernel/storage"
		);
		const fresh = withKernelRead(root, (db) => readWorkspaceRow(db));
		const { transaction, claim } = transactionFor(root, "task-divergent", fresh ? `rev:${fresh.revision}` : "missing");
		commitEnrollmentLocked(root, "task-divergent", transaction, claim as unknown as Record<string, unknown>);
		// Same event identity, different intent content: refused, and the
		// committed run is untouched.
		const divergent = transactionFor(root, "task-divergent", "missing");
		expect(() =>
			commitEnrollmentLocked(
				root,
				"task-divergent",
				{
					...divergent.transaction,
					next_record_content: divergent.transaction.next_record_content.replace(
						"goal for task-divergent",
						"divergent goal",
					),
				},
				{ ...divergent.claim, intent_content_hash: `sha256:${"c".repeat(64)}` } as unknown as Record<
					string,
					unknown
				>,
			),
		).toThrow();
		const run = withKernelRead(root, (db) => readRunRowByTask(db, "task-divergent"))!;
		expect(JSON.parse(run.record_json).intent_snapshot.goal).toBe("goal for task-divergent");
	});

	test("a database copied from another worktree grants no enrollment authority", async () => {
		const rootA = makeRoot();
		const rootB = makeRoot();
		writeIntent(rootA, "task-copy-a");
		seedEnrolledRun(rootA, "task-copy-a");
		const backupPath = join(rootA, "copy.sqlite");
		backupKernelStore(rootA, backupPath);
		// Bypass the restore guard to prove the store itself refuses the copy.
		mkdirSync(join(rootB, ".imm", "state"), { recursive: true });
		writeFileSync(join(rootB, ".imm/state/kernel.sqlite"), readFileSync(backupPath));
		const { commitEnrollmentLocked } = await import(
			"../plugins/immune-brain/runtime/kernel/storage"
		);
		writeIntent(rootB, "task-copy-b");
		// Every store access, including read-only projections, fails closed.
		expect(() => openKernelStore(rootB, { create: false })).toThrow(KernelStoreSecurityError);
		expect(() => withKernelRead(rootB, (db) => readWorkspaceRow(db))).toThrow(
			KernelStoreSecurityError,
		);
		const { transaction, claim } = transactionFor(rootB, "task-copy-b", "missing");
		expect(() =>
			commitEnrollmentLocked(
				rootB,
				"task-copy-b",
				transaction,
				claim as unknown as Record<string, unknown>,
			),
		).toThrow(KernelStoreSecurityError);
		expect(() => readBackendClaim(rootB)).toThrow(KernelStoreSecurityError);
	});
});
