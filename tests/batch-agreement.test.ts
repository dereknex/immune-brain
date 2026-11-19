import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorizeBatch } from "../plugins/immune-brain/runtime/unattended/batch_agreement";
import { computeBatchPlanDigest, createBatchAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/batch_authority";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { LOOP_DAEMON_ACTOR_ID } from "../plugins/immune-brain/runtime/kernel/actor_identity";
import {
	effectiveReturnPolicy,
	isRetiredLaneRecord,
	prepareBatchLaneRunState,
	readAnyBatchRunState,
	rebindBatchChildIdentity,
	writeBatchLaneRunState,
	parseBatchRunState,
	type BatchLaneRunStateRecord,
} from "../plugins/immune-brain/runtime/unattended/batch_state";
import { hasContiguousLaneRebind } from "../plugins/immune-brain/runtime/assurance/run_continuation";
import { observeParentCompletion } from "../plugins/immune-brain/runtime/unattended/batch_git";
import { deliverSingleTask } from "../plugins/immune-brain/runtime/unattended/checkout_delivery";
import { runLaneBatch } from "../plugins/immune-brain/runtime/unattended/batch_lanes";
import type { BatchPlanChild } from "../plugins/immune-brain/runtime/unattended/types";

const NOW = "2026-01-01T00:00:00.000Z";
const BASE_HEAD = "a".repeat(40);

function git(root: string, ...args: string[]): string {
	return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "batch-agreement-"));
	git(root, "init", "-q", "-b", "main");
	git(root, "config", "user.name", "T");
	git(root, "config", "user.email", "t@t");
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/\n");
	writeFileSync(join(root, "base.txt"), "base\n");
	git(root, "add", ".");
	git(root, "commit", "-qm", "base");
	return root;
}

function intent(taskId: string, revision: number) {
	return parseTaskIntentV1({
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		owner: "user",
		goal: `Goal ${taskId} r${revision}`,
		acceptance: [{ id: "A1", assertion: "done", verification: "bun test x" }],
		scope_hint: [`docs/plans/${taskId}.intent.json`],
		risk: "material",
		revision,
	});
}

function children2(): BatchPlanChild[] {
	const a = intent("task-a", 1);
	const b = intent("task-b", 1);
	return [
		{ task_id: "task-a", slice_id: "A", blocked_by: [], intent_path: "docs/plans/task-a.intent.json", intent_revision: 1, intent_content_hash: canonicalIntentHash(a) },
		{ task_id: "task-b", slice_id: "B", blocked_by: [], intent_path: "docs/plans/task-b.intent.json", intent_revision: 1, intent_content_hash: canonicalIntentHash(b) },
	];
}

function writeIntents(root: string, kids: BatchPlanChild[]) {
	for (const child of kids) {
		const parsed = parseTaskIntentV1({
			contract: "assurance_kernel/task_intent/v1",
			task_id: child.task_id,
			owner: "user",
			goal: `Goal ${child.task_id}`,
			acceptance: [{ id: "A1", assertion: "done", verification: "bun test x" }],
			scope_hint: [`docs/plans/${child.task_id}.intent.json`],
			risk: "material",
			revision: child.intent_revision,
		});
		writeFileSync(join(root, child.intent_path!), JSON.stringify(parsed, null, 2) + "\n");
	}
}

describe("batch-agreement", () => {
	test("AGR-A1: Initiative rebind appends one contiguous entry, Child1 byte-identical, stale refused", () => {
		const root = repo();
		try {
			const kids = children2();
			writeIntents(root, kids);
			const planDigest = computeBatchPlanDigest(kids);
			const record = prepareBatchLaneRunState({
				batch_id: "batch-a1",
				initiative_slug: "initiative-a1",
				children: kids,
				plan_digest: planDigest,
				base_head: git(root, "rev-parse", "HEAD"),
				branch: "imm/initiative-a1",
				confirmation_time: NOW,
				budget: { max_children: 2, qa_failure_limit: 2 },
				max_parallel: 2,
				now: NOW,
				confirmation: { source: "native_gate", ref: "native_gate:req-1" },
				return_policy: "retain_branch",
				interaction_mode: "interactive_host",
				final_verification: ["bun test"],
				final_verification_required: true,
			});
			writeBatchLaneRunState(root, record);
			const before = readAnyBatchRunState(root, "batch-a1") as BatchLaneRunStateRecord;
			const child1Before = JSON.stringify(before.children.find(c => c.task_id === "task-a"));
			const revised = intent("task-b", 2);
			const rebound = rebindBatchChildIdentity(root, "batch-a1", {
				task_id: "task-b",
				intent: revised,
				content_hash: canonicalIntentHash(revised),
			});
			expect(rebound.lane_rebinds).toHaveLength(1);
			const entry = rebound.lane_rebinds![0]!;
			expect(entry.task_id).toBe("task-b");
			expect(entry.from_digest).toBe(planDigest);
			expect(entry.to_digest).toBe(rebound.plan_digest);
			expect(rebound.plan_digest).not.toBe(planDigest);
			expect(JSON.stringify(rebound.children.find(c => c.task_id === "task-a"))).toBe(child1Before);
			expect(hasContiguousLaneRebind(rebound, planDigest)).toBe(true);
			const bytesBeforeStale = readFileSync(join(root, ".imm/state/batches/batch-a1.json"), "utf8");
			expect(() =>
				rebindBatchChildIdentity(root, "batch-a1", {
					task_id: "task-b",
					intent: revised,
					content_hash: canonicalIntentHash(revised),
					from_digest: planDigest,
				}),
			).toThrow("lane_decision_stale");
			expect(readFileSync(join(root, ".imm/state/batches/batch-a1.json"), "utf8")).toBe(bytesBeforeStale);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("AGR-A3: authorizeBatch accepts Host and daemon, refuses bad fields with zero writes", () => {
		const root = repo();
		try {
			const kids = children2();
			const baseHead = git(root, "rev-parse", "HEAD");
			const batchDir = join(root, ".imm/state/batches");
			const filesBefore = existsSync(batchDir) ? readdirSync(batchDir).sort() : [];
			const hostSingle = authorizeBatch({
				batch_id: "b-host-single",
				initiative_slug: "task-a",
				children: [kids[0]!],
				base_head: baseHead,
				budget: { max_children: 1, qa_failure_limit: 2 },
				confirmation: { source: "native_gate", ref: "native_gate:req-1" },
				final_verification: { required: false, commands: [] },
				return_policy: "checkout_delivery",
				interaction_mode: "interactive_host",
				actor: "literal-user",
				plan_source: "single_task",
			});
			expect(hostSingle.ok).toBe(true);
			const hostInit = authorizeBatch({
				batch_id: "b-host-init",
				initiative_slug: "init",
				children: kids,
				base_head: baseHead,
				budget: { max_children: 2, qa_failure_limit: 2 },
				confirmation: { source: "native_gate", ref: "native_gate:req-2" },
				final_verification: { required: true, commands: ["bun test"] },
				return_policy: "retain_branch",
				interaction_mode: "interactive_host",
				actor: "literal-user",
			});
			expect(hostInit.ok).toBe(true);
			for (const source of ["tracker_approval", "policy_auto"] as const) {
				const daemon = authorizeBatch({
					batch_id: `b-daemon-${source}`,
					initiative_slug: "init",
					children: kids,
					base_head: baseHead,
					budget: { max_children: 2, qa_failure_limit: 2 },
					confirmation: { source, ref: `${source}:req-1` },
					final_verification: { required: false, commands: [] },
					return_policy: "retain_branch",
					interaction_mode: "parent_relayed",
					actor: LOOP_DAEMON_ACTOR_ID,
				});
				expect(daemon.ok).toBe(true);
			}
			if (hostSingle.ok && hostInit.ok) {
				const registry = createBatchAuthorityRegistry();
				for (const agreement of [hostSingle.agreement, hostInit.agreement]) {
					const binding = {
						batch_id: agreement.batch_id,
						initiative_slug: agreement.initiative_slug,
						plan_digest: agreement.plan_digest,
						branch: `imm/${agreement.initiative_slug}`,
						base_head: baseHead,
						budget: agreement.budget,
						actor_id: "literal-user",
						confirmation_ref: agreement.confirmation.ref,
						nonce: `nonce-${agreement.batch_id}`,
					};
					const capability = registry.issue(binding, agreement.children);
					const validated = registry.inspect(capability, binding);
					expect(validated.batch_id).toBe(agreement.batch_id);
				}
			} else {
				throw new Error("valid agreements did not validate");
			}
			const badSource = authorizeBatch({
				batch_id: "b-bad", initiative_slug: "init", children: kids, base_head: baseHead,
				budget: { max_children: 2, qa_failure_limit: 2 },
				confirmation: { source: "unknown", ref: "x" },
				final_verification: { required: true, commands: ["bun test"] },
				return_policy: "retain_branch", interaction_mode: "interactive_host",
			});
			expect(badSource).toMatchObject({ ok: false, code: "batch_agreement_invalid" });
			const badReturn = authorizeBatch({
				batch_id: "b-bad", initiative_slug: "init", children: kids, base_head: baseHead,
				budget: { max_children: 2, qa_failure_limit: 2 },
				confirmation: { source: "native_gate", ref: "x" },
				final_verification: { required: true, commands: ["bun test"] },
				return_policy: "unknown", interaction_mode: "interactive_host",
			});
			expect(badReturn).toMatchObject({ ok: false, code: "batch_agreement_invalid" });
			const badMode = authorizeBatch({
				batch_id: "b-bad", initiative_slug: "init", children: kids, base_head: baseHead,
				budget: { max_children: 2, qa_failure_limit: 2 },
				confirmation: { source: "native_gate", ref: "x" },
				final_verification: { required: true, commands: ["bun test"] },
				return_policy: "retain_branch", interaction_mode: "unknown",
			});
			expect(badMode).toMatchObject({ ok: false, code: "batch_agreement_invalid" });
			const badCommands = authorizeBatch({
				batch_id: "b-bad", initiative_slug: "init", children: kids, base_head: baseHead,
				budget: { max_children: 2, qa_failure_limit: 2 },
				confirmation: { source: "native_gate", ref: "x" },
				final_verification: { required: true, commands: "bun test" as unknown as string[] },
				return_policy: "retain_branch", interaction_mode: "interactive_host",
			});
			expect(badCommands).toMatchObject({ ok: false, code: "batch_agreement_invalid" });
			const filesAfter = existsSync(batchDir) ? readdirSync(batchDir).sort() : [];
			expect(filesAfter).toEqual(filesBefore);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("AGR-A4: completion follows required and return follows policy for 1- and 2-child", () => {
		const root = repo();
		try {
			const kids = children2();
			const baseHead = git(root, "rev-parse", "HEAD");
			for (const count of [1, 2] as const) {
				const subset = kids.slice(0, count);
				const planDigest = computeBatchPlanDigest(subset);
				const checkout = prepareBatchLaneRunState({
					batch_id: `b-a4-checkout-${count}`,
					initiative_slug: count === 1 ? subset[0]!.task_id : "init-a4",
					children: subset,
					plan_digest: planDigest,
					base_head: baseHead,
					branch: `imm/${count === 1 ? subset[0]!.task_id : "init-a4"}`,
					confirmation_time: NOW,
					budget: { max_children: count, qa_failure_limit: 2 },
					max_parallel: 1,
					now: NOW,
					confirmation: { source: "native_gate", ref: "native_gate:req-1" },
					return_policy: "checkout_delivery",
					interaction_mode: "interactive_host",
					final_verification_required: false,
				});
				expect(checkout.contract).toBe("assurance_kernel/batch_run_state/v3");
				expect(effectiveReturnPolicy(checkout)).toBe("checkout_delivery");
				expect(checkout.session_provider).toBeNull();
				expect(checkout.children.every(c => (c as { session?: unknown }).session === null)).toBe(true);
				const retain = prepareBatchLaneRunState({
					batch_id: `b-a4-retain-${count}`,
					initiative_slug: count === 1 ? subset[0]!.task_id : "init-a4",
					children: subset,
					plan_digest: planDigest,
					base_head: baseHead,
					branch: `imm/${count === 1 ? subset[0]!.task_id : "init-a4"}`,
					confirmation_time: NOW,
					budget: { max_children: count, qa_failure_limit: 2 },
					max_parallel: 1,
					now: NOW,
					confirmation: { source: "native_gate", ref: "native_gate:req-2" },
					return_policy: "retain_branch",
					interaction_mode: "interactive_host",
					final_verification: ["bun test"],
					final_verification_required: true,
				});
				expect(effectiveReturnPolicy(retain)).toBe("retain_branch");
				expect(retain.final_verification_required).toBe(true);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("AGR-A5: new records are v3 with null sessions; v2 refused; v1 reads", async () => {
		const root = repo();
		try {
			const kids = children2();
			writeIntents(root, kids);
			const planDigest = computeBatchPlanDigest(kids);
			const record = prepareBatchLaneRunState({
				batch_id: "batch-a5",
				initiative_slug: "init-a5",
				children: kids,
				plan_digest: planDigest,
				base_head: git(root, "rev-parse", "HEAD"),
				branch: "imm/init-a5",
				confirmation_time: NOW,
				budget: { max_children: 2, qa_failure_limit: 2 },
				max_parallel: 2,
				now: NOW,
				confirmation: { source: "native_gate", ref: "native_gate:req-1" },
				return_policy: "retain_branch",
				interaction_mode: "interactive_host",
				final_verification: ["bun test"],
				final_verification_required: true,
			});
			expect(record.contract).toBe("assurance_kernel/batch_run_state/v3");
			expect(record.session_provider).toBeNull();
			expect(record.children.every(c => (c as { session?: unknown }).session === null)).toBe(true);
			writeBatchLaneRunState(root, record);
			expect((readAnyBatchRunState(root, "batch-a5") as BatchLaneRunStateRecord).contract).toBe(
				"assurance_kernel/batch_run_state/v3",
			);
			const v2 = { ...record, contract: "assurance_kernel/batch_run_state/v2", batch_id: "batch-a5-v2" } as Record<string, unknown>;
			mkdirSync(join(root, ".imm/state/batches"), { recursive: true });
			writeFileSync(join(root, ".imm/state/batches/batch-a5-v2.json"), `${JSON.stringify(v2, null, 2)}\n`);
			const persisted = readAnyBatchRunState(root, "batch-a5-v2");
			expect(persisted).not.toBeNull();
			expect(isRetiredLaneRecord(persisted!)).toBe(true);
			const report = await runLaneBatch(
				{
					root,
					batch_id: "batch-a5-v2",
					initiative_slug: "init-a5",
					registry: createBatchAuthorityRegistry(),
					capability: {},
					children: kids,
					plan_digest: planDigest,
					base_head: git(root, "rev-parse", "HEAD"),
					confirmation_time: NOW,
					budget: { max_children: 2, qa_failure_limit: 2 },
					now: NOW,
					kernel: {
						enrollTask: async () => ({ record_revision: "x" }),
						advanceTask: async () => ({ state: "completed" }) as never,
						projectTask: async () => ({ error: "unreadable", projection: null }) as never,
						ownsTaskClaim: () => false,
						validateBatchAuthorization: (x: never) => x,
					} as never,
				} as never,
				persisted,
			);
			expect(report.reason ?? "").toContain("batch_record_retired");
			const v1raw = JSON.stringify({
				contract: "assurance_kernel/batch_run_state/v1",
				batch_id: "batch-a5-v1",
				initiative_slug: "init-a5",
				plan_digest: planDigest,
				base_head: git(root, "rev-parse", "HEAD"),
				confirmation_time: NOW,
				budget: { max_children: 2, qa_failure_limit: 2 },
				batch_state: "prepared",
				children: kids.map(k => ({ task_id: k.task_id, slice_id: k.slice_id, blocked_by: [], state: "pending", reason: null, commit: null })),
				consecutive_qa_failures: 0,
				commits: [],
				created_at: NOW,
				updated_at: NOW,
			});
			expect(parseBatchRunState(v1raw, "batch-a5-v1").contract).toBe("assurance_kernel/batch_run_state/v1");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("batch-agreement runtime (AGR-A4, AGR-A1 post-rebind)", () => {
	function auditPair(taskId: string, runId: string, scopePath: string) {
		const taskIntent = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: taskId, owner: "user",
			goal: `Goal ${taskId}`, acceptance: [{ id: "A1", assertion: "done", verification: "bun test x" }],
			scope_hint: [scopePath, `docs/plans/${taskId}.intent.json`], risk: "material", revision: 1 });
		const record = { contract: "assurance_kernel/task_record/v4", task_id: taskId, intent_snapshot: taskIntent,
			intent_ref: { path: `docs/plans/${taskId}.intent.json`, content_hash: canonicalIntentHash(taskIntent) },
			lifecycle: "done", artifact_state: "frozen", baseline: `sha256:${"a".repeat(64)}`,
			git_base_head: "b".repeat(40), attestations: [], findings: [],
			history: [{ id: `complete:${taskId}`, at: NOW, type: "complete", from_state: "active:frozen", to_state: "done:frozen", reason: "settled" }] };
		const bytes = `${JSON.stringify(record, null, 2)}\n`;
		const proof = { contract: "assurance_kernel/task_tombstone/v2", task_id: taskId, lifecycle_status: "terminal",
			terminal_lifecycle: "done", terminal_event_id: `complete:${taskId}`,
			final_record_hash: `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`, terminalized_at: NOW };
		return { bytes, proof: `${JSON.stringify(proof, null, 2)}\n`, runId };
	}
	async function parentFixture(count: 1 | 2, policy: { return_policy: "checkout_delivery" | "retain_branch"; required: boolean; passing: boolean }) {
		const root = repo(); writeFileSync(join(root, ".gitignore"), ".imm/state\n.imm/authority\n"); git(root, "add", ".gitignore"); git(root, "commit", "-qm", "allow audit");
		const slug = count === 1 ? "task-a" : "init-rt";
		const taskIds = count === 1 ? ["task-a"] : ["task-a", "task-b"];
		const kids: BatchPlanChild[] = taskIds.map((taskId, i) => {
			const iv = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: taskId, owner: "user",
				goal: `Goal ${taskId}`, acceptance: [{ id: "A1", assertion: "done", verification: "bun test x" }],
				scope_hint: [`src/${taskId}.ts`, `docs/plans/${taskId}.intent.json`], risk: "material", revision: 1 });
			return { task_id: taskId, slice_id: `S${i}`, blocked_by: [], intent_path: `docs/plans/${taskId}.intent.json`,
				intent_revision: 1, intent_content_hash: canonicalIntentHash(iv) };
		});
		for (const k of kids) {
			const iv = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: k.task_id, owner: "user",
				goal: `Goal ${k.task_id}`, acceptance: [{ id: "A1", assertion: "done", verification: "bun test x" }],
				scope_hint: [`src/${k.task_id}.ts`, `docs/plans/${k.task_id}.intent.json`], risk: "material", revision: 1 });
			writeFileSync(join(root, k.intent_path!), JSON.stringify(iv, null, 2) + "\n");
		}
		const planDigest = computeBatchPlanDigest(kids);
		const branch = `refs/heads/imm/${slug}`;
		git(root, "checkout", "-q", "-b", branch.replace("refs/heads/", ""));
		const commits: string[] = [];
		for (const taskId of taskIds) {
			mkdirSync(join(root, "src"), { recursive: true });
			writeFileSync(join(root, `src/${taskId}.ts`), `export const v = ${JSON.stringify(taskId)};\n`);
			const runId = `run-${taskId}-1111-1111-4111-811111111111`;
			const pair = auditPair(taskId, runId, `src/${taskId}.ts`);
			const audit = join(root, ".imm/audit", taskId, runId);
			mkdirSync(audit, { recursive: true });
			writeFileSync(join(audit, "task-record.json"), pair.bytes);
			writeFileSync(join(audit, "terminal-proof.json"), pair.proof);
			git(root, "add", "-A");
			git(root, "commit", "-qm", `deliver ${taskId}`);
			commits.push(git(root, "rev-parse", "HEAD"));
		}
		const head = commits[commits.length - 1]!;
		const finalCommands = policy.required ? ["git --version"] : [];
		const finalResult = policy.required ? {
			passed: policy.passing, head,
			results: [{ command: "git --version", exit_code: policy.passing ? 0 : 1, signal: null, passed: policy.passing, duration_ms: 1 }],
		} : undefined;
		const prepared = prepareBatchLaneRunState({
			batch_id: `rt-${count}-${policy.return_policy}-${policy.required ? "req" : "noreq"}`,
			initiative_slug: slug, children: kids, plan_digest: planDigest, base_head: git(root, "rev-parse", "main"),
			branch, confirmation_time: NOW, budget: { max_children: count, qa_failure_limit: 2 }, max_parallel: count,
			now: NOW, confirmation: { source: "native_gate", ref: "native_gate:req-1" },
			return_policy: policy.return_policy, interaction_mode: "interactive_host",
			...(finalCommands.length ? { final_verification: finalCommands } : {}),
			final_verification_required: policy.required,
		});
		const completed = {
			...prepared,
			batch_state: "completed" as const,
			children: prepared.children.map(c => ({ ...c, state: "integrated" as const, commit: head, lane: { path: root, branch: `imm-lane/${slug}/${c.task_id}`, base_head: git(root, "rev-parse", "main"), lane_commit: head } })),
			commits: taskIds.map(() => head),
			final_report: { contract: "assurance_kernel/batch_final_report/v1" as const, head,
				return_to_coordinator: { mode: "manual" as const, status: "staged" as const, reason: null } },
			...(finalResult ? { final_verification_result: finalResult } : {}),
		};
		writeBatchLaneRunState(root, completed as BatchLaneRunStateRecord);
		return { root, slug, taskIds, head, record: completed as BatchLaneRunStateRecord, planDigest, kids, cleanup: () => rmSync(root, { recursive: true, force: true }) };
	}
	for (const count of [1, 2] as const) {
		test(`AGR-A4 runtime: ${count}-child checkout + required false completes on delivery`, async () => {
			const f = await parentFixture(count, { return_policy: "checkout_delivery", required: false, passing: true });
			try {
				const proof = await observeParentCompletion(f.root, f.slug, f.taskIds);
				expect(proof.complete).toBe(true);
				expect(proof.final_passed).toBe(true);
				const delivery = deliverSingleTask(f.root, git(f.root, "rev-parse", "main"), f.head);
				expect(["staged", "fast_forwarded"]).toContain(delivery.status);
			} finally { f.cleanup(); }
		});
		test(`AGR-A4 runtime: ${count}-child retain + required true passing completes, failing does not`, async () => {
			const passing = await parentFixture(count, { return_policy: "retain_branch", required: true, passing: true });
			try {
				expect((await observeParentCompletion(passing.root, passing.slug, passing.taskIds)).complete).toBe(true);
			} finally { passing.cleanup(); }
			const failing = await parentFixture(count, { return_policy: "retain_branch", required: true, passing: false });
			try {
				const proof = await observeParentCompletion(failing.root, failing.slug, failing.taskIds);
				expect(proof.complete).toBe(false);
				expect(proof.final_passed).toBe(false);
			} finally { failing.cleanup(); }
		});
	}
	test("AGR-A1 post-rebind: Parent final verification passes under pre-rebind identity", async () => {
		const f = await parentFixture(2, { return_policy: "retain_branch", required: true, passing: true });
		try {
			expect((await observeParentCompletion(f.root, f.slug, f.taskIds)).complete).toBe(true);
			const revised = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: "task-b", owner: "user",
				goal: "Goal task-b r2", acceptance: [{ id: "A1", assertion: "done", verification: "bun test x" }],
				scope_hint: ["src/task-b.ts", "docs/plans/task-b.intent.json"], risk: "material", revision: 2 });
			const rebound = rebindBatchChildIdentity(f.root, f.record.batch_id, { task_id: "task-b", intent: revised, content_hash: canonicalIntentHash(revised) });
			expect(rebound.plan_digest).not.toBe(f.planDigest);
			expect(hasContiguousLaneRebind(rebound, f.planDigest)).toBe(true);
			expect((await observeParentCompletion(f.root, f.slug, f.taskIds)).complete).toBe(true);
		} finally { f.cleanup(); }
	});
});

describe("AGR-A4 return routing via runLaneBatch (generalized)", () => {
	async function integratedFixture(count: 1 | 2, policy: { return_policy: "checkout_delivery" | "retain_branch"; required: boolean }) {
		const root = repo(); writeFileSync(join(root, ".gitignore"), ".imm/state\n.imm/authority\n"); git(root, "add", ".gitignore"); git(root, "commit", "-qm", "allow audit");
		const slug = count === 1 ? "task-a" : "init-route";
		const taskIds = count === 1 ? ["task-a"] : ["task-a", "task-b"];
		const kids = taskIds.map((taskId, i) => {
			const iv = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: taskId, owner: "user",
				goal: `Goal ${taskId}`, acceptance: [{ id: "A1", assertion: "done", verification: "bun test x" }],
				scope_hint: [`src/${taskId}.ts`, `docs/plans/${taskId}.intent.json`], risk: "material", revision: 1 });
			return { task_id: taskId, slice_id: `S${i}`, blocked_by: [], intent_path: `docs/plans/${taskId}.intent.json`,
				intent_revision: 1, intent_content_hash: canonicalIntentHash(iv) };
		});
		for (const k of kids) {
			const iv = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: k.task_id, owner: "user",
				goal: `Goal ${k.task_id}`, acceptance: [{ id: "A1", assertion: "done", verification: "bun test x" }],
				scope_hint: [`src/${k.task_id}.ts`, `docs/plans/${k.task_id}.intent.json`], risk: "material", revision: 1 });
			writeFileSync(join(root, k.intent_path!), JSON.stringify(iv, null, 2) + "\n");
		}
		const planDigest = computeBatchPlanDigest(kids);
		const branch = `refs/heads/imm/${slug}`;
		git(root, "checkout", "-q", "-b", branch.replace("refs/heads/", ""));
		const baseHead = git(root, "rev-parse", "main");
		for (const taskId of taskIds) {
			mkdirSync(join(root, "src"), { recursive: true });
			writeFileSync(join(root, `src/${taskId}.ts`), `export const v = ${JSON.stringify(taskId)};\n`);
			const runId = `run-${taskId}-2222-2222-4222-822222222222`;
			const iv = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: taskId, owner: "user",
				goal: `Goal ${taskId}`, acceptance: [{ id: "A1", assertion: "done", verification: "bun test x" }],
				scope_hint: [`src/${taskId}.ts`, `docs/plans/${taskId}.intent.json`], risk: "material", revision: 1 });
			const recordBytes = JSON.stringify({ contract: "assurance_kernel/task_record/v4", task_id: taskId, intent_snapshot: iv,
				intent_ref: { path: `docs/plans/${taskId}.intent.json`, content_hash: canonicalIntentHash(iv) },
				lifecycle: "done", artifact_state: "frozen", baseline: `sha256:${"a".repeat(64)}`, git_base_head: baseHead,
				attestations: [], findings: [], history: [{ id: `complete:${taskId}`, at: NOW, type: "complete", from_state: "active:frozen", to_state: "done:frozen", reason: "settled" }] }, null, 2) + "\n";
			const proof = JSON.stringify({ contract: "assurance_kernel/task_tombstone/v2", task_id: taskId, lifecycle_status: "terminal",
				terminal_lifecycle: "done", terminal_event_id: `complete:${taskId}`,
				final_record_hash: `sha256:${new Bun.CryptoHasher("sha256").update(recordBytes).digest("hex")}`, terminalized_at: NOW }, null, 2) + "\n";
			const audit = join(root, ".imm/audit", taskId, runId); mkdirSync(audit, { recursive: true });
			writeFileSync(join(audit, "task-record.json"), recordBytes); writeFileSync(join(audit, "terminal-proof.json"), proof);
			git(root, "add", "-A"); git(root, "commit", "-qm", `deliver ${taskId}`);
		}
		const head = git(root, "rev-parse", "HEAD");
		const registry = { children: () => kids, restoreChild: () => {}, releaseChild: () => {},
			consumeChild: () => { throw new Error("unexpected consume"); }, isChildConsumed: () => true,
			isExhausted: () => true, redoGrants: () => 0 } as unknown as import("../plugins/immune-brain/runtime/kernel/batch_authority").BatchAuthorityRegistry;
		const capability = {};
		const binding = { batch_id: `rt-route-${count}-${policy.return_policy}`, initiative_slug: slug, plan_digest: planDigest,
			branch, base_head: baseHead, budget: { max_children: count, qa_failure_limit: 2 } };
		const prepared = prepareBatchLaneRunState({ batch_id: binding.batch_id, initiative_slug: slug, children: kids,
			plan_digest: planDigest, base_head: baseHead, branch, confirmation_time: NOW,
			budget: { max_children: count, qa_failure_limit: 2 }, max_parallel: count, now: NOW,
			confirmation: { source: "native_gate", ref: "native_gate:req-1" }, return_policy: policy.return_policy,
			interaction_mode: "interactive_host", final_verification_required: policy.required,
			...(policy.required ? { final_verification: ["git --version"] } : {}) });
		const common = execFileSync("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
		const lanePathFor = (taskId: string) => join(common, "imm", "worktrees", slug, taskId);
		const integrated = { ...prepared, batch_state: "running" as const,
			children: prepared.children.map(c => ({ ...c, state: "integrated" as const, commit: head,
				lane: { path: lanePathFor(c.task_id), branch: `imm-lane/${slug}/${c.task_id}`, base_head: baseHead, lane_commit: head } })) ,
			commits: taskIds.map(() => head) };
		writeBatchLaneRunState(root, integrated as BatchLaneRunStateRecord);
		const persisted = readAnyBatchRunState(root, binding.batch_id)!;
		return { root, slug, taskIds, head, baseHead, kids, registry, capability, binding, persisted, cleanup: () => rmSync(root, { recursive: true, force: true }) };
	}
	test("2-child checkout_delivery stages via runLaneBatch and keeps branch (no multi cleanup yet)", async () => {
		const f = await integratedFixture(2, { return_policy: "checkout_delivery", required: false });
		try {
			const report = await runLaneBatch({ root: f.root, batch_id: f.binding.batch_id, initiative_slug: f.slug,
				registry: f.registry, capability: f.capability, children: f.kids, plan_digest: computeBatchPlanDigest(f.kids),
				base_head: f.baseHead, confirmation_time: NOW, budget: { max_children: 2, qa_failure_limit: 2 }, now: NOW,
				kernel: { enrollTask: async () => ({ record_revision: "x" }), advanceTask: async () => ({ state: "completed" }) as never,
					projectTask: async () => ({ error: "unreadable", projection: null }) as never, ownsTaskClaim: () => false,
					validateBatchAuthorization: (x: never) => x } as never }, f.persisted);
			expect(report.batch_state).toBe("completed");
			expect(report.final_report?.return_to_coordinator.status).toBe("staged");
			expect(git(f.root, "rev-parse", "--verify", "--quiet", `refs/heads/imm/${f.slug}`)).not.toBe("");
		} finally { f.cleanup(); }
	});
	test("2-child retain_branch keeps branch via runLaneBatch", async () => {
		const f = await integratedFixture(2, { return_policy: "retain_branch", required: true });
		try {
			const report = await runLaneBatch({ root: f.root, batch_id: f.binding.batch_id, initiative_slug: f.slug,
				registry: f.registry, capability: f.capability, children: f.kids, plan_digest: computeBatchPlanDigest(f.kids),
				base_head: f.baseHead, confirmation_time: NOW, budget: { max_children: 2, qa_failure_limit: 2 }, now: NOW,
				kernel: { enrollTask: async () => ({ record_revision: "x" }), advanceTask: async () => ({ state: "completed" }) as never,
					projectTask: async () => ({ error: "unreadable", projection: null }) as never, ownsTaskClaim: () => false,
					validateBatchAuthorization: (x: never) => x } as never }, f.persisted);
			expect(report.batch_state).toBe("completed");
			expect(["manual", "fast_forwarded"]).toContain(report.final_report?.return_to_coordinator.status);
			expect(git(f.root, "rev-parse", "--verify", "--quiet", `refs/heads/imm/${f.slug}`)).not.toBe("");
		} finally { f.cleanup(); }
	});
	test("1-child retain_branch keeps branch via runLaneBatch", async () => {
		const f = await integratedFixture(1, { return_policy: "retain_branch", required: true });
		try {
			const report = await runLaneBatch({ root: f.root, batch_id: f.binding.batch_id, initiative_slug: f.slug,
				registry: f.registry, capability: f.capability, children: f.kids, plan_digest: computeBatchPlanDigest(f.kids),
				base_head: f.baseHead, confirmation_time: NOW, budget: { max_children: 1, qa_failure_limit: 2 }, now: NOW,
				kernel: { enrollTask: async () => ({ record_revision: "x" }), advanceTask: async () => ({ state: "completed" }) as never,
					projectTask: async () => ({ error: "unreadable", projection: null }) as never, ownsTaskClaim: () => false,
					validateBatchAuthorization: (x: never) => x } as never }, f.persisted);
			expect(report.batch_state).toBe("completed");
			expect(git(f.root, "rev-parse", "--verify", "--quiet", `refs/heads/imm/${f.slug}`)).not.toBe("");
		} finally { f.cleanup(); }
	});
});
