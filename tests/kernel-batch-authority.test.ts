import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	computeBatchPlanDigest,
	createBatchAuthorityRegistry,
	deriveChildEnrollment,
	type BatchAuthorityRegistry,
	type BatchAuthorizationBinding,
	type BatchPlanChild,
} from "../plugins/immune-brain/runtime/kernel/batch_authority";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { createEnrollmentAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { preparePiCanary, readGitHead } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { readBackendClaim } from "../plugins/immune-brain/runtime/kernel/backend_claim";
import { readTaskRecord } from "../plugins/immune-brain/runtime/kernel/storage";

const NOW = "2026-09-05T00:00:00.000Z";
const GIT_ENV = {
	...process.env,
	GIT_AUTHOR_NAME: "t",
	GIT_AUTHOR_EMAIL: "t@t",
	GIT_COMMITTER_NAME: "t",
	GIT_COMMITTER_EMAIL: "t@t",
};

function intentFor(taskId: string, revision = 1, goal = `goal for ${taskId}`) {
	return {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		owner: "user",
		goal,
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

/** A committed fixture repository holding one intent sidecar per task id. */
function makeRoot(taskIds: string[]): string {
	const root = mkdtempSync(join(tmpdir(), "batch-authority-"));
	mkdirSync(join(root, ".imm/state"), { recursive: true });
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	for (const taskId of taskIds) writeIntent(root, taskId);
	execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
	commitAll(root, "fixture");
	return root;
}

function writeIntent(root: string, taskId: string, intent = intentFor(taskId)): string {
	const path = join(root, "docs", "plans", `${taskId}.intent.json`);
	writeFileSync(path, `${JSON.stringify(intent, null, 2)}\n`);
	return path;
}

function commitAll(root: string, message: string): string {
	execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
	execFileSync("git", ["commit", "-q", "-m", message], { cwd: root, stdio: "ignore", env: GIT_ENV });
	return readGitHead(root);
}

/**
 * Wraps a registry so a rollback assertion cannot pass vacuously: consumed
 * slots are empty both when the slot was consumed and released and when the
 * failure landed before it was ever consumed, so the call counts are what
 * distinguish the two.
 */
function countingBatchRegistry(inner: BatchAuthorityRegistry): {
	registry: BatchAuthorityRegistry;
	calls: { consumeChild: number; releaseChild: number };
} {
	const calls = { consumeChild: 0, releaseChild: 0 };
	const registry: BatchAuthorityRegistry = {
		...inner,
		consumeChild(capability, expected, taskId, now) {
			calls.consumeChild += 1;
			return inner.consumeChild(capability, expected, taskId, now);
		},
		releaseChild(capability, taskId) {
			calls.releaseChild += 1;
			inner.releaseChild(capability, taskId);
		},
	};
	return { registry, calls };
}

function childFor(root: string, taskId: string): BatchPlanChild {
	const prep = preparePiCanary(root, { task_id: taskId, now: NOW });
	if (!prep.intent) throw new Error(`fixture intent missing for ${taskId}`);
	return {
		task_id: taskId,
		intent_path: prep.intent.path,
		intent_revision: prep.intent.revision,
		intent_content_hash: prep.intent.content_hash,
		blocked_by: [],
	};
}

function bindingFor(root: string, children: BatchPlanChild[]): BatchAuthorizationBinding {
	return {
		batch_id: "batch-001",
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
		confirmation_ref: "claude-confirm-001",
		expires_at: "2099-01-01T00:00:00.000Z",
		nonce: "batch-nonce-001",
	};
}

const AT_ISSUE = Date.parse(NOW);

describe("batch plan digest", () => {
	test("is stable across key order and changes when the order changes", () => {
		const a: BatchPlanChild = {
			task_id: "t1",
			intent_path: "docs/plans/t1.intent.json",
			intent_revision: 1,
			intent_content_hash: "sha256:a",
			blocked_by: [],
		};
		const b: BatchPlanChild = {
			task_id: "t2",
			intent_path: "docs/plans/t2.intent.json",
			intent_revision: 3,
			intent_content_hash: "sha256:b",
			blocked_by: ["t1"],
		};
		const reordered = {
			blocked_by: [...a.blocked_by],
			intent_content_hash: a.intent_content_hash,
			task_id: a.task_id,
			intent_revision: a.intent_revision,
			intent_path: a.intent_path,
		} as BatchPlanChild;
		expect(computeBatchPlanDigest([a, b])).toBe(computeBatchPlanDigest([reordered, b]));
		expect(computeBatchPlanDigest([a, b])).not.toBe(computeBatchPlanDigest([b, a]));
		expect(computeBatchPlanDigest([a, b])).not.toBe(
			computeBatchPlanDigest([a, { ...b, intent_revision: 4 }]),
		);
	});
});

describe("batch authorization issue", () => {
	const registry = createBatchAuthorityRegistry();

	function issueWith(
		root: string,
		children: BatchPlanChild[],
		patch: Partial<BatchAuthorizationBinding> = {},
	): object {
		return registry.issue({ ...bindingFor(root, children), ...patch }, children, NOW);
	}

	test("issues from a complete literal-user binding bound to the exact plan", () => {
		const root = makeRoot(["t1", "t2"]);
		const children = [childFor(root, "t1"), childFor(root, "t2")];
		const capability = issueWith(root, children);
		expect(registry.children(capability)).toEqual(children);
		expect(registry.consumedChildren(capability)).toEqual([]);
		expect(registry.isExhausted(capability)).toBe(false);
		expect(registry.inspect(capability, bindingFor(root, children), AT_ISSUE)).toMatchObject({
			batch_id: "batch-001",
			actor_id: "user",
			confirmation_ref: "claude-confirm-001",
		});
	});

	test("rejects a non literal-user actor", () => {
		const root = makeRoot(["t1"]);
		const children = [childFor(root, "t1")];
		expect(() => issueWith(root, children, { actor_id: "agent" })).toThrow(/literal-user/i);
	});

	test("rejects every empty binding field", () => {
		const root = makeRoot(["t1"]);
		const children = [childFor(root, "t1")];
		for (const key of [
			"batch_id",
			"initiative_slug",
			"plan_digest",
			"branch",
			"base_head",
			"confirmation_ref",
			"expires_at",
			"nonce",
		] as const) {
			expect(() => issueWith(root, children, { [key]: "" } as Partial<BatchAuthorizationBinding>)).toThrow(
				/incomplete/i,
			);
		}
	});

	test("rejects a base_head that is not a committed commit id", () => {
		const root = makeRoot(["t1"]);
		const children = [childFor(root, "t1")];
		expect(() => issueWith(root, children, { base_head: "HEAD" })).toThrow(/40-hex/i);
		expect(() => issueWith(root, children, { base_head: "abc123" })).toThrow(/40-hex/i);
	});

	test("rejects a non-future expiry and a non-future deadline", () => {
		const root = makeRoot(["t1"]);
		const children = [childFor(root, "t1")];
		expect(() => issueWith(root, children, { expires_at: NOW })).toThrow(/future expiry/i);
		expect(() =>
			issueWith(root, children, {
				budget: { max_children: 1, deadline_at: NOW, qa_failure_limit: 2 },
			}),
		).toThrow(/future deadline_at/i);
	});

	test("rejects a non-positive budget", () => {
		const root = makeRoot(["t1"]);
		const children = [childFor(root, "t1")];
		expect(() =>
			issueWith(root, children, {
				budget: { max_children: 0, deadline_at: "2026-09-05T08:00:00.000Z", qa_failure_limit: 2 },
			}),
		).toThrow(/max_children/i);
		expect(() =>
			issueWith(root, children, {
				budget: { max_children: 1, deadline_at: "2099-01-01T00:00:00.000Z", qa_failure_limit: 0 },
			}),
		).toThrow(/qa_failure_limit/i);
	});

	test("rejects a plan_digest that does not match the confirmed children, including a reordering", () => {
		const root = makeRoot(["t1", "t2"]);
		const children = [childFor(root, "t1"), childFor(root, "t2")];
		const binding = bindingFor(root, children);
		expect(() => registry.issue(binding, [children[1]!, children[0]!], NOW)).toThrow(/plan digest/i);
		expect(() =>
			registry.issue(binding, [children[0]!, { ...children[1]!, intent_revision: 9 }], NOW),
		).toThrow(/plan digest/i);
	});

	test("rejects an empty plan, a duplicated child, and a blocker outside the plan", () => {
		const root = makeRoot(["t1", "t2"]);
		const children = [childFor(root, "t1"), childFor(root, "t2")];
		expect(() => registry.issue(bindingFor(root, []), [], NOW)).toThrow(/non-empty child plan/i);
		const duplicated = [children[0]!, children[0]!];
		expect(() => registry.issue(bindingFor(root, duplicated), duplicated, NOW)).toThrow(
			/more than once/i,
		);
		const dangling = [{ ...children[0]!, blocked_by: ["t-absent"] }, children[1]!];
		expect(() => registry.issue(bindingFor(root, dangling), dangling, NOW)).toThrow(
			/not in the confirmed plan/i,
		);
	});
});

describe("batch authorization per-child consumption", () => {
	const registry = createBatchAuthorityRegistry();

	test("consumes exactly one slot and stays valid for the remaining children", () => {
		const root = makeRoot(["t1", "t2", "t3"]);
		const children = [childFor(root, "t1"), childFor(root, "t2"), childFor(root, "t3")];
		const binding = bindingFor(root, children);
		const capability = registry.issue(binding, children, NOW);

		registry.consumeChild(capability, binding, "t1", AT_ISSUE);
		expect(registry.consumedChildren(capability)).toEqual(["t1"]);
		expect(registry.isChildConsumed(capability, "t1")).toBe(true);
		expect(registry.isChildConsumed(capability, "t2")).toBe(false);
		expect(registry.isExhausted(capability)).toBe(false);
		// The authorization itself is still usable for the rest of the plan.
		expect(registry.inspect(capability, binding, AT_ISSUE).batch_id).toBe("batch-001");

		registry.consumeChild(capability, binding, "t2", AT_ISSUE);
		registry.consumeChild(capability, binding, "t3", AT_ISSUE);
		expect(registry.isExhausted(capability)).toBe(true);
	});

	test("rejects a child outside the plan and consumes nothing", () => {
		const root = makeRoot(["t1"]);
		const children = [childFor(root, "t1")];
		const binding = bindingFor(root, children);
		const capability = registry.issue(binding, children, NOW);
		expect(() => registry.consumeChild(capability, binding, "t-absent", AT_ISSUE)).toThrow(
			/batch_child_not_in_plan/,
		);
		expect(registry.consumedChildren(capability)).toEqual([]);
	});

	test("rejects reusing a consumed slot and consumes nothing further", () => {
		const root = makeRoot(["t1", "t2"]);
		const children = [childFor(root, "t1"), childFor(root, "t2")];
		const binding = bindingFor(root, children);
		const capability = registry.issue(binding, children, NOW);
		registry.consumeChild(capability, binding, "t1", AT_ISSUE);
		expect(() => registry.consumeChild(capability, binding, "t1", AT_ISSUE)).toThrow(
			/batch_child_slot_consumed/,
		);
		expect(registry.consumedChildren(capability)).toEqual(["t1"]);
	});

	test("rejects any child after expiry and consumes nothing", () => {
		const root = makeRoot(["t1", "t2"]);
		const children = [childFor(root, "t1"), childFor(root, "t2")];
		const binding = bindingFor(root, children);
		const capability = registry.issue(binding, children, NOW);
		const afterExpiry = Date.parse(binding.expires_at) + 1;
		expect(() => registry.consumeChild(capability, binding, "t1", afterExpiry)).toThrow(/expired/i);
		expect(registry.consumedChildren(capability)).toEqual([]);
	});

	test("rejects an unparseable clock rather than failing open past expiry", () => {
		const root = makeRoot(["t1"]);
		const children = [childFor(root, "t1")];
		const binding = bindingFor(root, children);
		const capability = registry.issue(binding, children, NOW);
		// Date.parse of a malformed timestamp yields NaN, and every `<=` compare
		// against NaN is false, which would otherwise wave an expired
		// authorization through.
		expect(() =>
			registry.consumeChild(capability, binding, "t1", Date.parse("not-a-timestamp")),
		).toThrow(/valid clock/i);
		expect(() => registry.inspect(capability, binding, Number.NaN)).toThrow(/valid clock/i);
		expect(registry.consumedChildren(capability)).toEqual([]);
	});

	test("rejects a mismatched expected binding field by field and consumes nothing", () => {
		const root = makeRoot(["t1"]);
		const children = [childFor(root, "t1")];
		const binding = bindingFor(root, children);
		const capability = registry.issue(binding, children, NOW);
		for (const patch of [
			{ batch_id: "batch-other" },
			{ initiative_slug: "other" },
			{ branch: "imm/other" },
			{ confirmation_ref: "forged" },
			{ nonce: "other-nonce" },
			{ plan_digest: computeBatchPlanDigest([{ ...children[0]!, intent_revision: 7 }]) },
		]) {
			expect(() =>
				registry.consumeChild(capability, { ...binding, ...patch }, "t1", AT_ISSUE),
			).toThrow(/mismatch/i);
		}
		expect(() =>
			registry.consumeChild(
				capability,
				{ ...binding, budget: { ...binding.budget, qa_failure_limit: 9 } },
				"t1",
				AT_ISSUE,
			),
		).toThrow(/budget mismatch/i);
		expect(registry.consumedChildren(capability)).toEqual([]);
	});

	test("does not recognize a capability issued by another registry", () => {
		const root = makeRoot(["t1"]);
		const children = [childFor(root, "t1")];
		const binding = bindingFor(root, children);
		const foreign = createBatchAuthorityRegistry().issue(binding, children, NOW);
		expect(() => registry.inspect(foreign, binding, AT_ISSUE)).toThrow(/not recognized/i);
		expect(() => registry.children(foreign)).toThrow(/not recognized/i);
	});
});

describe("batch child enrollment derivation", () => {
	const registry = createBatchAuthorityRegistry();

	test("recomputes the preparation digest at derivation and carries the batch confirmation", () => {
		const root = makeRoot(["t1", "t2"]);
		const children = [childFor(root, "t1"), childFor(root, "t2")];
		const binding = bindingFor(root, children);
		const capability = registry.issue(binding, children, NOW);
		const head = readGitHead(root);

		const derived = deriveChildEnrollment(root, registry, {
			capability,
			binding,
			task_id: "t1",
			expected_head: head,
			now: NOW,
		});
		const fresh = preparePiCanary(root, { task_id: "t1", now: NOW });
		expect(derived.binding.preparation_digest).toBe(fresh.digest);
		expect(derived.binding).toMatchObject({
			task_id: "t1",
			intent_revision: 1,
			actor_id: "user",
			confirmation_ref: binding.confirmation_ref,
			expires_at: binding.expires_at,
		});
		// Each child gets its own nonce so two children never share one binding.
		const second = deriveChildEnrollment(root, registry, {
			capability,
			binding,
			task_id: "t2",
			expected_head: head,
			now: NOW,
		});
		expect(derived.binding.nonce).not.toBe(second.binding.nonce);
		// Derivation alone consumes nothing.
		expect(registry.consumedChildren(capability)).toEqual([]);
	});

	test("rejects a broken HEAD lineage with zero consumption", () => {
		const root = makeRoot(["t1"]);
		const children = [childFor(root, "t1")];
		const binding = bindingFor(root, children);
		const capability = registry.issue(binding, children, NOW);
		expect(() =>
			deriveChildEnrollment(root, registry, {
				capability,
				binding,
				task_id: "t1",
				expected_head: "0".repeat(40),
				now: NOW,
			}),
		).toThrow(/batch_head_lineage_broken/);
		expect(() =>
			deriveChildEnrollment(root, registry, {
				capability,
				binding,
				task_id: "t1",
				expected_head: "HEAD",
				now: NOW,
			}),
		).toThrow(/batch_head_lineage_broken/);
		expect(registry.consumedChildren(capability)).toEqual([]);
	});

	test("rejects a child whose intent changed after the confirmation", () => {
		const root = makeRoot(["t1"]);
		const children = [childFor(root, "t1")];
		const binding = bindingFor(root, children);
		const capability = registry.issue(binding, children, NOW);
		writeIntent(root, "t1", intentFor("t1", 1, "changed after the batch confirmation"));
		const head = commitAll(root, "drift");
		expect(() =>
			deriveChildEnrollment(root, registry, {
				capability,
				binding,
				task_id: "t1",
				expected_head: head,
				now: NOW,
			}),
		).toThrow(/batch_child_intent_changed/);
		expect(registry.consumedChildren(capability)).toEqual([]);
	});

	test("rejects a task outside the plan and a slot already consumed", () => {
		const root = makeRoot(["t1"]);
		const children = [childFor(root, "t1")];
		const binding = bindingFor(root, children);
		const capability = registry.issue(binding, children, NOW);
		expect(() =>
			deriveChildEnrollment(root, registry, {
				capability,
				binding,
				task_id: "t-absent",
				expected_head: readGitHead(root),
				now: NOW,
			}),
		).toThrow(/batch_child_not_in_plan/);
		registry.consumeChild(capability, binding, "t1", AT_ISSUE);
		expect(() =>
			deriveChildEnrollment(root, registry, {
				capability,
				binding,
				task_id: "t1",
				expected_head: readGitHead(root),
				now: NOW,
			}),
		).toThrow(/batch_child_slot_consumed/);
	});

	test("rejects derivation after the authorization expired", () => {
		const root = makeRoot(["t1"]);
		const children = [childFor(root, "t1")];
		const binding = bindingFor(root, children);
		const capability = registry.issue(binding, children, NOW);
		expect(() =>
			deriveChildEnrollment(root, registry, {
				capability,
				binding,
				task_id: "t1",
				expected_head: readGitHead(root),
				now: "2099-06-01T00:00:00.000Z",
			}),
		).toThrow(/expired/i);
		expect(registry.consumedChildren(capability)).toEqual([]);
	});
});

describe("batch-derived enrollment", () => {
	test("consumes the child slot and writes the TaskRecord together", () => {
		const root = makeRoot(["t1", "t2"]);
		const children = [childFor(root, "t1"), childFor(root, "t2")];
		const binding = bindingFor(root, children);
		const batchRegistry = createBatchAuthorityRegistry();
		const capability = batchRegistry.issue(binding, children, NOW);
		const enrollmentRegistry = createEnrollmentAuthorityRegistry();
		const head = readGitHead(root);

		const derived = deriveChildEnrollment(root, batchRegistry, {
			capability,
			binding,
			task_id: "t1",
			expected_head: head,
			now: NOW,
		});
		const childCapability = enrollmentRegistry.issue(derived.binding, NOW);
		const result = enrollCanaryTask(
			root,
			{
				task_id: "t1",
				intent_path: derived.binding.intent_path,
				intent_revision: derived.binding.intent_revision,
				preparation_digest: derived.binding.preparation_digest,
				capability: childCapability,
				capability_binding: derived.binding,
				batch: { registry: batchRegistry, capability, binding, expected_head: head },
				now: NOW,
			},
			enrollmentRegistry,
		);

		expect(result.record).toMatchObject({
			contract: "assurance_kernel/task_record/v4",
			task_id: "t1",
			lifecycle: "active",
		});
		expect(result.record.git_base_head).toBe(head);
		expect(batchRegistry.consumedChildren(capability)).toEqual(["t1"]);
		expect(batchRegistry.isChildConsumed(capability, "t2")).toBe(false);
		expect(readTaskRecord(root, "t1").record).not.toBeNull();
		expect(readBackendClaim(root)?.task_id).toBe("t1");
	});

	test("rejects an enrollment whose lineage does not match the batch expected head", () => {
		const root = makeRoot(["t1"]);
		const children = [childFor(root, "t1")];
		const binding = bindingFor(root, children);
		const batchRegistry = createBatchAuthorityRegistry();
		const capability = batchRegistry.issue(binding, children, NOW);
		const enrollmentRegistry = createEnrollmentAuthorityRegistry();
		const head = readGitHead(root);
		const derived = deriveChildEnrollment(root, batchRegistry, {
			capability,
			binding,
			task_id: "t1",
			expected_head: head,
			now: NOW,
		});
		const childCapability = enrollmentRegistry.issue(derived.binding, NOW);

		expect(() =>
			enrollCanaryTask(
				root,
				{
					task_id: "t1",
					intent_path: derived.binding.intent_path,
					intent_revision: derived.binding.intent_revision,
					preparation_digest: derived.binding.preparation_digest,
					capability: childCapability,
					capability_binding: derived.binding,
					batch: {
						registry: batchRegistry,
						capability,
						binding,
						expected_head: "0".repeat(40),
					},
					now: NOW,
				},
				enrollmentRegistry,
			),
		).toThrow(/batch_head_lineage_broken/);
		expect(batchRegistry.consumedChildren(capability)).toEqual([]);
		expect(readTaskRecord(root, "t1").record).toBeNull();
		expect(readBackendClaim(root)).toBeNull();
	});

	test("rejects a first child whose expected_head is not the confirmed base_head", () => {
		const root = makeRoot(["t1"]);
		const children = [childFor(root, "t1")];
		const binding = bindingFor(root, children);
		const batchRegistry = createBatchAuthorityRegistry();
		const capability = batchRegistry.issue(binding, children, NOW);
		const enrollmentRegistry = createEnrollmentAuthorityRegistry();

		// HEAD advances by a commit this batch did not create. No slot is
		// consumed, so the batch has produced nothing and its lineage still
		// stands at base_head.
		writeFileSync(join(root, "unrelated.txt"), "outside the batch\n");
		const movedHead = commitAll(root, "outside the batch");
		expect(movedHead).not.toBe(binding.base_head);

		// The derivation authority rejects the forged lineage outright.
		expect(() =>
			deriveChildEnrollment(root, batchRegistry, {
				capability,
				binding,
				task_id: "t1",
				expected_head: movedHead,
				now: NOW,
			}),
		).toThrow(/batch_head_lineage_broken/);

		// A caller that skips derivation and hands enrollment a self-asserted
		// expected_head matching live HEAD must be rejected there too.
		const preparation = preparePiCanary(root, { task_id: "t1", now: NOW });
		if (!preparation.intent) throw new Error("fixture intent missing for t1");
		const forged = {
			task_id: "t1",
			intent_path: preparation.intent.path,
			intent_revision: preparation.intent.revision,
			intent_content_hash: preparation.intent.content_hash,
			preparation_digest: preparation.digest,
			actor_id: binding.actor_id,
			confirmation_ref: binding.confirmation_ref,
			expires_at: binding.expires_at,
			nonce: `${binding.nonce}:t1`,
		};
		const childCapability = enrollmentRegistry.issue(forged, NOW);
		expect(() =>
			enrollCanaryTask(
				root,
				{
					task_id: "t1",
					intent_path: forged.intent_path,
					intent_revision: forged.intent_revision,
					preparation_digest: forged.preparation_digest,
					capability: childCapability,
					capability_binding: forged,
					batch: { registry: batchRegistry, capability, binding, expected_head: movedHead },
					now: NOW,
				},
				enrollmentRegistry,
			),
		).toThrow(/batch_head_lineage_broken/);

		expect(batchRegistry.consumedChildren(capability)).toEqual([]);
		expect(readTaskRecord(root, "t1").record).toBeNull();
		expect(readBackendClaim(root)).toBeNull();
	});

	test("leaves no consumed slot when the bound record write cannot commit", () => {
		if (process.getuid?.() === 0) return;
		const root = makeRoot(["t1"]);
		const children = [childFor(root, "t1")];
		const binding = bindingFor(root, children);
		const inner = createBatchAuthorityRegistry();
		const { registry: batchRegistry, calls } = countingBatchRegistry(inner);
		const capability = batchRegistry.issue(binding, children, NOW);
		const enrollmentRegistry = createEnrollmentAuthorityRegistry();
		const head = readGitHead(root);
		const derived = deriveChildEnrollment(root, batchRegistry, {
			capability,
			binding,
			task_id: "t1",
			expected_head: head,
			now: NOW,
		});
		const childCapability = enrollmentRegistry.issue(derived.binding, NOW);

		// The store lock is taken before the slot is consumed, and acquiring it
		// creates `.imm/state/locks`. Create it up front so the read-only parent
		// below fails the record write instead of the lock, which is the only
		// ordering that reaches the rollback.
		mkdirSync(join(root, ".imm/state/locks"), { recursive: true });
		chmodSync(join(root, ".imm/state"), 0o500);
		let thrown: unknown;
		try {
			try {
				enrollCanaryTask(
					root,
					{
						task_id: "t1",
						intent_path: derived.binding.intent_path,
						intent_revision: derived.binding.intent_revision,
						preparation_digest: derived.binding.preparation_digest,
						capability: childCapability,
						capability_binding: derived.binding,
						batch: { registry: batchRegistry, capability, binding, expected_head: head },
						now: NOW,
					},
					enrollmentRegistry,
				);
			} catch (error) {
				thrown = error;
			}
		} finally {
			chmodSync(join(root, ".imm/state"), 0o700);
		}

		expect(thrown).toBeInstanceOf(Error);
		// The slot was really taken and really given back; without both counts an
		// empty consumed list would also describe a failure before consumption.
		expect(calls.consumeChild).toBe(1);
		expect(calls.releaseChild).toBe(1);
		expect(batchRegistry.consumedChildren(capability)).toEqual([]);
		expect(batchRegistry.isChildConsumed(capability, "t1")).toBe(false);
		expect(readTaskRecord(root, "t1").record).toBeNull();
		expect(readBackendClaim(root)).toBeNull();
	});

	test("consumes the child slot only when the record write commits", () => {
		const root = makeRoot(["t1"]);
		const children = [childFor(root, "t1")];
		const binding = bindingFor(root, children);
		const inner = createBatchAuthorityRegistry();
		const { registry: batchRegistry, calls } = countingBatchRegistry(inner);
		const capability = batchRegistry.issue(binding, children, NOW);
		const enrollmentRegistry = createEnrollmentAuthorityRegistry();
		const head = readGitHead(root);
		const derived = deriveChildEnrollment(root, batchRegistry, {
			capability,
			binding,
			task_id: "t1",
			expected_head: head,
			now: NOW,
		});
		const childCapability = enrollmentRegistry.issue(derived.binding, NOW);

		enrollCanaryTask(
			root,
			{
				task_id: "t1",
				intent_path: derived.binding.intent_path,
				intent_revision: derived.binding.intent_revision,
				preparation_digest: derived.binding.preparation_digest,
				capability: childCapability,
				capability_binding: derived.binding,
				batch: { registry: batchRegistry, capability, binding, expected_head: head },
				now: NOW,
			},
			enrollmentRegistry,
		);

		expect(calls.consumeChild).toBe(1);
		expect(calls.releaseChild).toBe(0);
		expect(batchRegistry.consumedChildren(capability)).toEqual(["t1"]);
		expect(readTaskRecord(root, "t1").record).not.toBeNull();
	});
});
