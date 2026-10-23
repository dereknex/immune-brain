import { execFileSync } from "node:child_process";
import { readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BatchPlanChild } from "../plugins/immune-brain/runtime/unattended/types";
import {
	prepareBatchRunState,
	prepareBatchLaneRunState,
	writeBatchLaneRunState,
	readBatchRunState,
	writeBatchRunState,
	writeBatchRunReport,
	isTerminalBatchState,
	type BatchRunStateRecord,
} from "../plugins/immune-brain/runtime/unattended/batch_state";
import { createBatchKernelPort } from "../plugins/immune-brain/runtime/unattended/batch_kernel_port";
import type { AssuranceProjectionResult } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import type { EnrollmentAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import {
	projectBatchPreflight,
	prepareBatchPreflight,
	projectBatchDrift,
	findExistingActiveBatch,
	findSettledBatchRecord,
	findResumableBatchSlugForTask,
} from "../plugins/immune-brain/runtime/unattended/batch_preflight";
import { BATCH_REASONS, batchReason } from "../plugins/immune-brain/runtime/unattended/batch_reasons";
import { createBatchAuthorityRegistry,
	computeBatchPlanDigest,
} from "../plugins/immune-brain/runtime/kernel/batch_authority";
import { createEnrollmentAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";

const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
function projectionFacts(): AssuranceProjectionResult["projection"] {
	return {
		run_id: null, record_revision: "r", workspace_revision: "w", intent_revision: 1, intent_content_hash: "sha256:intent", diff_hash: "sha256:diff",
		lifecycle: "active", artifact_state: "active", risk: "material", next_obligation: "submit_assurance",
		fresh_acceptance_ids: [], missing_acceptance_ids: [], stale_attestation_ids: [], fresh_approval_kinds: [], missing_approval_kinds: [],
		blocking_finding_ids: [], unresolved_user_decision_ids: [], replan_required_ids: [], independence_violations: [],
		open_user_decision_count: 0, completion_ready: false, authorization: { state: "none", blocked: null },
	};
}

function child(taskId: string, sliceId: string, blockedBy: string[] = []): BatchPlanChild {
	return {
		task_id: taskId,
		slice_id: sliceId,
		blocked_by: blockedBy,
		status: "enrollable",
		reason: null,
		intent_path: `docs/plans/${taskId}.intent.json`,
		intent_revision: 1,
		intent_content_hash: "0".repeat(64),
	};
}

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "imm-batch-run-"));
}

describe("one production batch child Kernel port", () => {
	const root = tempRoot();
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	/** The batch binding the shared port validates against. */
	function sharedBinding(planDigest: string = "0".repeat(64), baseHead = "b".repeat(40)) {
		return {
			batch_id: "batch-001",
			initiative_slug: "initiative-slug",
			plan_digest: planDigest,
			branch: "main",
			base_head: baseHead,
			budget: { max_children: 1, qa_failure_limit: 3 },
			actor_id: "user",
			confirmation_ref: "confirm",
			nonce: "n",
		};
	}

	/** One child plan, its registry and the capability covering it. */
	function sharedPortFixture(deps: Parameters<typeof createBatchKernelPort>[0]["deps"]) {
		const plan = [child("task-a", "S1")];
		const registry = createBatchAuthorityRegistry();
		const planDigest = computeBatchPlanDigest(plan);
		const binding = sharedBinding(planDigest);
		const capability = registry.issue(sharedBinding(planDigest), plan, "2026-01-01T00:00:00.000Z");
		const shared = createBatchKernelPort({
			root,
			enrollmentRegistry: createEnrollmentAuthorityRegistry(),
			registry,
			capability,
			binding,
			deps,
			advanceTask: async () => ({ state: "completed" }),
			resume: { isResuming: false, existingBatch: null, batchBranch: "imm/initiative-slug" },
		});
		return { registry, capability, binding, shared };
	}

	/** The port's own seams, recorded so the test asserts what it routed to. */
	function recordingDeps() {
		const calls: { enroll: unknown[]; projections: string[] } = { enroll: [], projections: [] };
		return {
			calls,
			deps: {
				deriveChildEnrollment: () => ({
					binding: {
						...sharedBinding(),
						task_id: "task-a",
						intent_path: "docs/plans/task-a.intent.json",
						intent_revision: 1,
						intent_content_hash: "sha256:intent",
						preparation_digest: "sha256:preparation",
					} as never,
				}),
				enrollTask: async (
					_root: string,
					_registry: EnrollmentAuthorityRegistry,
					request: { binding: { task_id: string } },
				) => {
					calls.enroll.push(request);
					return { record_revision: "enrolled-revision" };
				},
				projectAssurance: async (_root: string, taskId: string): Promise<AssuranceProjectionResult> => {
					calls.projections.push(taskId);
					return {
						contract: "assurance_kernel/assurance_projection/v1",
						task_id: taskId,
						error: null,
						claim: { task_id: taskId, lifecycle_status: "active" },
						projection: { ...projectionFacts(), lifecycle: "active", record_revision: "port-revision" } as never,
					};
				},
				readTaskRecordRaw: () => ({
					revision: "port-revision",
					record: { history: [], findings: [] } as never,
				}),
			},
		};
	}

	it("AC1: enrolls through the Enrollment entry, projects, and validates the batch binding", async () => {
		const { calls, deps } = recordingDeps();
		const { registry, capability, binding, shared } = sharedPortFixture(deps);
		const batch = { registry, capability, binding: { ...binding, expected_head: "b".repeat(40) } };

		// Positive: enrollment routes through the single Enrollment entry, and
		// the shared port reports the revision of the record it re-readwards.
		const enrolled = await shared.enrollTask!({ root, task_id: "task-a", batch });
		expect(enrolled).toEqual({ record_revision: "port-revision" });
		expect(calls.enroll).toHaveLength(1);
		expect((calls.enroll[0] as { binding: { task_id: string } }).binding.task_id).toBe("task-a");

		// Positive: projection for a claimed child carries the shared QA facts.
		const projected = await shared.projectTask!(root, "task-a");
		expect(calls.projections).toEqual(["task-a"]);
		expect(projected.projection.record_revision).toBe("port-revision");
		expect((projected as { qa_failure_count?: number }).qa_failure_count).toBeDefined();

		// Positive: authorization validation accepts the issued capability bound
		// to exactly this batch_id, plan_digest and base_head.
		expect(shared.validateBatchAuthorization!({
			registry: registry as never,
			capability,
			binding: {
				batch_id: binding.batch_id, plan_digest: binding.plan_digest, base_head: binding.base_head,
				initiative_slug: binding.initiative_slug, budget: binding.budget,
			},
		})).toMatchObject({ batch_id: "batch-001", plan_digest: binding.plan_digest });

		// Negative: a fabricated capability and a drifted binding are both refused.
		expect(() => shared.validateBatchAuthorization!({
			registry: registry as never, capability: {} as never,
			binding: {
				batch_id: binding.batch_id, plan_digest: binding.plan_digest, base_head: binding.base_head,
				initiative_slug: binding.initiative_slug, budget: binding.budget,
			},
		})).toThrow();
		expect(() => shared.validateBatchAuthorization!({
			registry: registry as never, capability,
			binding: {
				batch_id: binding.batch_id, plan_digest: binding.plan_digest, base_head: "c".repeat(40),
				initiative_slug: binding.initiative_slug, budget: binding.budget,
			},
		})).toThrow();

		// Positive/negative: ownership follows registry consumption, not a stub.
		expect(shared.ownsTaskClaim("task-a")).toBe(false);
		registry.consumeChild(capability, binding, "task-a");
		expect(shared.ownsTaskClaim("task-a")).toBe(true);
		expect(shared.ownsTaskClaim("task-foreign")).toBe(false);

		// D5: the shared port owns every Kernel-facing member, nothing git-shaped.
		expect(Object.keys(shared).sort()).toEqual([
			"advanceTask", "canStartTask", "enrollTask", "ownsTaskClaim", "projectTask", "validateBatchAuthorization",
		]);
	});

	it("AC1: a changed recovery projection is refused", async () => {
		const { deps } = recordingDeps();
		// The recovery path re-reads the committed record and compares it with
		// the projection it just took; a revision that moved under it means the
		// projection is stale, so recovery cannot trust it.
		deps.readTaskRecordRaw = () => ({ revision: "drifted-revision", record: null });
		const { shared } = sharedPortFixture(deps);
		await expect(shared.projectTask!(root, "task-a")).rejects.toThrow(
			"Kernel recovery projection changed for task-a",
		);
	});

	it("AC1: resume re-verifies the CURRENT claim of the same Batch", async () => {
		const resumeRoot = tempRoot();
		try {
			const git = (...args: string[]) => execFileSync("git", args, { cwd: resumeRoot, encoding: "utf8", env: {
				...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.test",
				GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.test",
			} }).trim();
			git("init", "-q");
			git("config", "core.hooksPath", "/dev/null");
			mkdirSync(join(resumeRoot, "docs/plans"), { recursive: true });
			writeFileSync(join(resumeRoot, "docs/plans/seed.json"), "{}");
			git("add", "docs/plans"); git("commit", "-qm", "seed");
			const batchBranch = "imm/initiative-slug";
			git("checkout", "-qb", batchBranch);
			const base = git("rev-parse", "HEAD");
			const claimAt = "2026-08-12T00:00:00.000Z";
			const intent = {
				contract: "assurance_kernel/task_intent/v1", task_id: "task-a", goal: "resume fixture",
				acceptance: [{ id: "A1", assertion: "a1", verification: "bun test tests/x.test.ts" }],
				scope_hint: ["docs/plans"], risk: "routine" as const, revision: 1, owner: "user",
			};
			seedKernelRunForTest(resumeRoot, {
				task_id: "task-a",
				enrollment_event_id: `enroll-task-a-${claimAt}`, created_at: claimAt, updated_at: claimAt,
				record: {
					contract: "assurance_kernel/task_record/v4", task_id: "task-a",
					intent_snapshot: intent,
					intent_ref: {
						path: "docs/plans/task-a.intent.json",
						content_hash: canonicalIntentHash(parseTaskIntentV1(intent)),
					},
					lifecycle: "active", artifact_state: "active", baseline: `sha256:${"a".repeat(64)}`,
					git_base_head: base, attestations: [], findings: [], history: [],
				},
			});
			const plan = [child("task-a", "S1")];
			const registry = createBatchAuthorityRegistry();
			const planDigest = computeBatchPlanDigest(plan);
			const binding = sharedBinding(planDigest, base);
			const capability = registry.issue(sharedBinding(planDigest, base), plan, "2026-01-01T00:00:00.000Z");
			const existingBatch = {
				contract: "assurance_kernel/batch_run_state/v1", batch_id: "batch-001",
				initiative_slug: "initiative-slug", plan_digest: planDigest, base_head: base,
				branch: batchBranch, confirmation_time: "2026-01-01T00:00:00.000Z",
				budget: { max_children: 1, qa_failure_limit: 3 }, batch_state: "needs_human",
				children: [{ task_id: "task-a", slice_id: "S1", state: "needs_human" }],
				consecutive_qa_failures: 0, commits: [], created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-09-01T00:00:00.000Z",
			} as unknown as BatchRunStateRecord;
			const { deps } = recordingDeps();
			const resumePort = (isResuming: boolean) => createBatchKernelPort({
				root: resumeRoot,
				enrollmentRegistry: createEnrollmentAuthorityRegistry(),
				registry, capability, binding, deps,
				advanceTask: async () => ({ state: "completed" }),
				resume: { isResuming, existingBatch, batchBranch },
			});
			// Bound: a resume re-verifies the CURRENT claim identity synchronously,
			// so a claim still held by this Batch keeps ownership even though the
			// registry-derived port has not consumed the slot yet.
			expect(registry.consumedChildren(capability)).toEqual([]);
			expect(resumePort(true).ownsTaskClaim("task-a")).toBe(true);
			expect(resumePort(false).ownsTaskClaim("task-a")).toBe(false);
		} finally { rmSync(resumeRoot, { recursive: true, force: true }); }
	});
});

describe("batch plan authority boundaries", () => {
	it.each([
		[child("task-a", "S1", ["task-a"])],
		[child("task-a", "S1", ["task-b"]), child("task-b", "S2", ["task-a"])],
		[child("task-free", "S0"), child("task-a", "S1", ["task-b"]), child("task-b", "S2", ["task-c"]), child("task-c", "S3", ["task-a"])],
	].map(children => ({ children })))("rejects cyclic plans before issuing authority or writing batch state: %j", ({ children }) => {
		const root = tempRoot();
		try {
			const registry = createBatchAuthorityRegistry();
			expect(() => registry.issue({ batch_id: "batch-001", initiative_slug: "initiative-slug",
				plan_digest: computeBatchPlanDigest(children), branch: "main", base_head: "b".repeat(40),
				budget: { max_children: children.length, qa_failure_limit: 3 }, actor_id: "user", confirmation_ref: "confirm", nonce: "n",
			}, children, FAR_FUTURE)).toThrow("dependency cycle");
			expect(existsSync(join(root, ".imm"))).toBe(false);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});
});

describe("batch run state persistence", () => {
	it("prepare → write → read round-trips canonical bytes", () => {
		const root = tempRoot();
		try {
			const record = prepareBatchRunState({
				batch_id: "batch-001",
				initiative_slug: "initiative-slug",
				children: [child("task-a", "S1")],
				plan_digest: "d".repeat(64),
				base_head: "b".repeat(40),
				confirmation_time: FAR_FUTURE,
				budget: { max_children: 1, qa_failure_limit: 3 },
				now: FAR_FUTURE,
			});
			const stored = writeBatchRunState(root, record);
			expect(stored.batch_state).toBe("prepared");
			const read = readBatchRunState(root, "batch-001");
			expect(read).not.toBeNull();
			expect(read!.children[0]!.task_id).toBe("task-a");
			// Idempotent write: same canonical bytes, no error.
			expect(() => writeBatchRunState(root, read!)).not.toThrow();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("readBatchRunState returns null for missing state and rejects foreign batch_id", () => {
		const root = tempRoot();
		try {
			expect(readBatchRunState(root, "missing")).toBeNull();
			const record = prepareBatchRunState({
				batch_id: "batch-001",
				initiative_slug: "initiative-slug",
				children: [child("task-a", "S1")],
				plan_digest: "d".repeat(64),
				base_head: "b".repeat(40),
				confirmation_time: FAR_FUTURE,
				budget: { max_children: 1, qa_failure_limit: 3 },
				now: FAR_FUTURE,
			});
			writeBatchRunState(root, record);
			expect(() => readBatchRunState(root, "batch-001")).not.toThrow();
			writeFileSync(join(root, ".imm/state/batches/batch-001.json"), JSON.stringify({ ...record, batch_id: "foreign" }));
			expect(() => readBatchRunState(root, "batch-001")).toThrow(/carries batch_id foreign/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects unsafe batch ids at prepare time", () => {
		expect(() =>
			prepareBatchRunState({
				batch_id: "../escape",
				initiative_slug: "slug",
				children: [child("a", "S1")],
				plan_digest: "d".repeat(64),
				base_head: "b".repeat(40),
				confirmation_time: FAR_FUTURE,
				budget: { max_children: 1, qa_failure_limit: 3 },
				now: FAR_FUTURE,
			}),
		).toThrow(/safe file identity/);
	});

	it.each(["../../../victim", "../escape", "/absolute", "a/b", "a\\b", "", ".", "..", "a".repeat(129)])(
		"rejects unsafe persistence identity %s before any writes", (batch_id) => {
			const root = tempRoot();
			try {
				const record = prepareBatchRunState({
					batch_id: "batch-001", initiative_slug: "initiative-slug", children: [child("task-a", "S1")],
					plan_digest: "d".repeat(64), base_head: "b".repeat(40), confirmation_time: FAR_FUTURE,
					budget: { max_children: 1, qa_failure_limit: 3 }, now: FAR_FUTURE,
				});
				expect(() => readBatchRunState(root, batch_id)).toThrow(/safe file identity/);
				expect(() => writeBatchRunState(root, { ...record, batch_id })).toThrow(/safe file identity/);
				expect(() => writeBatchRunReport(root, { ...record, batch_id,
					contract: "assurance_kernel/batch_run_report/v1", reason: null, next_action: "None",
				})).toThrow(/safe file identity/);
				expect(existsSync(join(root, ".imm"))).toBe(false);
			} finally { rmSync(root, { recursive: true, force: true }); }
		},
	);

	it("rejects malformed persisted budget and state values", () => {
		const root = tempRoot();
		try {
			const valid = prepareBatchRunState({
				batch_id: "batch-001",
				initiative_slug: "initiative-slug",
				children: [child("task-a", "S1")],
				plan_digest: "d".repeat(64),
				base_head: "b".repeat(40),
				confirmation_time: FAR_FUTURE,
				budget: { max_children: 1, qa_failure_limit: 3 },
				now: FAR_FUTURE,
			});
			writeBatchRunState(root, valid);
			const path = join(root, ".imm/state/batches/batch-001.json");
			const invalidRecords: BatchRunStateRecord[] = [
				{ ...valid, budget: { ...valid.budget, max_children: 0 } },
				{ ...valid, budget: { ...valid.budget, qa_failure_limit: 1.5 } },
				{ ...valid, batch_state: "completed" },
				{
					...valid,
					batch_state: "budget_stopped",
					children: valid.children.map((entry) => ({ ...entry, state: "enrolled" })),
				},
			];
			for (const invalid of invalidRecords) {
				writeFileSync(path, `${JSON.stringify(invalid, null, 2)}\n`);
				expect(() => readBatchRunState(root, "batch-001")).toThrow(/invalid|not committed|mid-flight/);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("reads a record carrying retired clock fields and drops them", () => {
		const root = tempRoot();
		try {
			const valid = prepareBatchRunState({
				batch_id: "batch-001",
				initiative_slug: "initiative-slug",
				children: [child("task-a", "S1")],
				plan_digest: "d".repeat(64),
				base_head: "b".repeat(40),
				confirmation_time: FAR_FUTURE,
				budget: { max_children: 1, qa_failure_limit: 3 },
				now: FAR_FUTURE,
			});
			mkdirSync(join(root, ".imm/state/batches"), { recursive: true });
			const path = join(root, ".imm/state/batches/batch-001.json");
			for (const [expiry, deadline] of [["2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z"], ["not-a-date", "January 1, 2099"]]) {
				writeFileSync(path, `${JSON.stringify({
					...valid, authorization_expires_at: expiry, budget: { ...valid.budget, deadline_at: deadline },
				}, null, 2)}\n`);
				const read = readBatchRunState(root, "batch-001")!;
				expect(read).not.toHaveProperty("authorization_expires_at");
				expect(read.budget).toEqual({ max_children: 1, qa_failure_limit: 3 });
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("terminal batch states are terminal, needs_human is not", () => {
		for (const state of ["completed", "budget_stopped", "failed", "rejected", "superseded"] as const)
			expect(isTerminalBatchState(state)).toBe(true);
		expect(isTerminalBatchState("needs_human")).toBe(false);
		expect(isTerminalBatchState("running")).toBe(false);
	});
});

describe("shared batch preflight projection", () => {
	const SLUG = "preflight-initiative";
	const NOW = "2026-01-01T00:00:00.000Z";
	const readNextInitiative = async () => ({
		contract: "immune_brain/github_initiative_observation/v1" as const,
		initiative_id: SLUG, issue_number: 1,
		tasks: [{ task_id: "child-b", slice_id: "S2", issue_number: 2, blocked_by: [] }],
	});

	function headOf(root: string): string {
		return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
	}

	function fixture(): string {
		const root = mkdtempSync(join(tmpdir(), "imm-preflight-"));
		execFileSync("git", ["init", "-q"], { cwd: root });
		execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
		execFileSync("git", ["config", "user.name", "T"], { cwd: root });
		mkdirSync(join(root, "docs/plans"), { recursive: true });
		mkdirSync(join(root, ".imm/state/batches"), { recursive: true });
		// Mirrors the repository's storage-layout cutover: worktree-local state is
		// Git-ignored, so a projection sees only real work as a tree change.
		writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
		for (const taskId of ["child-a", "child-b"]) {
			writeFileSync(
				join(root, `docs/plans/${taskId}.intent.json`),
				`${JSON.stringify({
					contract: "assurance_kernel/task_intent/v1",
					task_id: taskId,
					goal: `Deliver ${taskId}`,
					acceptance: [{ id: `acc-${taskId}`, assertion: "a", verification: "{}" }],
					scope_hint: ["src/**", `docs/specs/${taskId}.spec.md`, `docs/specs/archive/${taskId}.spec.md`],
					risk: "material",
					revision: 1,
					owner: "user",
				}, null, 2)}\n`,
			);
		}
		execFileSync("git", ["add", "-A"], { cwd: root });
		execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
		return root;
	}

	function conflictingParent(root: string): string {
		const head = headOf(root);
		const tree = execFileSync("git", ["rev-parse", `${head}^{tree}`], { cwd: root, encoding: "utf8" }).trim();
		const other = execFileSync("git", ["commit-tree", tree, "-p", head, "-m", "foreign Parent tip"], { cwd: root, encoding: "utf8" }).trim();
		execFileSync("git", ["update-ref", `refs/heads/imm/${SLUG}`, other], { cwd: root });
		return other;
	}

	function writeBatch(
		root: string,
		batchState: string,
		overrides: { budget?: { max_children: number; deadline_at?: string; qa_failure_limit: number } } = {},
	): void {
		writeFileSync(
			join(root, ".imm/state/batches/batch-1.json"),
			`${JSON.stringify({
				contract: "assurance_kernel/batch_run_state/v1",
				batch_id: "batch-1",
				initiative_slug: SLUG,
				plan_digest: computeBatchPlanDigest([child("child-a", "S1"), child("child-b", "S2", ["child-a"])].map(c => {
					const identity = readTaskIntent(root, c.task_id, `docs/plans/${c.task_id}.intent.json`);
					return { ...c, intent_revision: identity.intent.revision, intent_content_hash: identity.content_hash };
				})),
				batch_state: batchState,
				branch: `imm/${SLUG}`,
				base_head: headOf(root),
				commits: [headOf(root)],
				confirmation_time: NOW,
				created_at: NOW,
				consecutive_qa_failures: 0,
				budget: overrides.budget ?? { max_children: 2, qa_failure_limit: 2 },
				updated_at: NOW,
				children: [
					{ task_id: "child-a", slice_id: "S1", state: "committed", blocked_by: [], commit: headOf(root), reason: null },
					...(batchState === "completed" ? [] : [{ task_id: "child-b", slice_id: "S2", state: "pending", blocked_by: ["child-a"], commit: null, reason: null }]),
				],
			}, null, 2)}\n`,
		);
	}

	function writeLaneBatch(root: string): void {
		const children = [child("child-a", "S1"), child("child-b", "S2", ["child-a"])].map(c => {
			const identity = readTaskIntent(root, c.task_id, c.intent_path!);
			return { ...c, intent_revision: identity.intent.revision, intent_content_hash: identity.content_hash };
		});
		const record = prepareBatchLaneRunState({ batch_id: "batch-1", initiative_slug: SLUG,
			branch: "refs/imm/batches/batch-1", base_head: headOf(root), plan_digest: computeBatchPlanDigest(children),
			confirmation_time: NOW, now: NOW, max_parallel: 1, budget: { max_children: 2, qa_failure_limit: 2 }, children });
		record.batch_state = "running";
		record.children[0]!.state = "integrated";
		record.children[0]!.commit = headOf(root);
		record.children[0]!.lane = { path: join(root, "../delivered-lane"), branch: "imm/lane/child-a", base_head: headOf(root), lane_commit: headOf(root), run_id: "run-a" };
		record.commits = [headOf(root)];
		execFileSync("git", ["update-ref", record.branch, headOf(root)], { cwd: root });
		writeBatchLaneRunState(root, record);
	}

	function snapshot(root: string): Record<string, string> {
		const files: Record<string, string> = {};
		const visit = (directory: string) => {
			for (const name of readdirSync(directory).sort()) {
				if (name === ".git") continue;
				const path = join(directory, name);
				if (statSync(path).isDirectory()) visit(path);
				else files[path.slice(root.length)] = readFileSync(path).toString("base64");
			}
		};
		visit(root);
		return files;
	}

	it("S2-AC1: a rejected preflight names only in-scope dirt and leaves HEAD, branch, index and log unchanged", async () => {
		const root = fixture();
		const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
		try {
			writeFileSync(join(root, "outside.txt"), "base");
			git("add", "outside.txt"); git("commit", "-qm", "outside baseline");
			mkdirSync(join(root, "src")); mkdirSync(join(root, "docs/specs"), { recursive: true });
			mkdirSync(join(root, ".imm/audit"), { recursive: true });
			writeFileSync(join(root, "src/task.ts"), "export const task = true;\n");
			writeFileSync(join(root, ".imm/audit/precondition.txt"), "evidence");
			writeFileSync(join(root, "docs/specs/draft.md"), "draft");
			writeFileSync(join(root, "docs/plans/draft.md"), "plan");
			writeFileSync(join(root, "outside.txt"), "staged"); git("add", "outside.txt");
			writeFileSync(join(root, "outside.txt"), "worktree");
			// Legacy Lane records still guard pending-child dirt; new Parent batches
			// deliberately leave coordinator dirt alone and copy planning input only.
			writeLaneBatch(root);
			const before = snapshot(root);
			const head = headOf(root); const branch = git("branch", "--show-current"); const log = git("log", "--format=%H");
			const index = git("ls-files", "--stage"); const status = git("status", "--porcelain");
			const staged = git("show", ":outside.txt"); const worktree = readFileSync(join(root, "outside.txt"));
			const outcome = await prepareBatchPreflight({ root, initiative_slug: SLUG, now: NOW, readInitiative: readNextInitiative });
			expect(outcome.ok).toBe(false);
			if (outcome.ok) throw new Error("dirt inside an unsettled child's scope must reject a fresh batch");
			expect(outcome.reason).toBe("branch preflight failed: working tree is dirty: src/task.ts");
			expect(outcome).not.toHaveProperty("precondition_commit");
			expect(headOf(root)).toBe(head);
			expect(git("branch", "--show-current")).toBe(branch);
			expect(git("log", "--format=%H")).toBe(log);
			expect(git("ls-files", "--stage")).toBe(index);
			expect(git("status", "--porcelain")).toBe(status);
			expect(git("show", ":outside.txt")).toBe(staged);
			expect(readFileSync(join(root, "outside.txt"))).toEqual(worktree);
			expect(snapshot(root)).toEqual(before);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	it("S2-AC1: dirt outside every unsettled child's scope does not block and is never committed", async () => {
		const root = fixture();
		const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
		try {
			mkdirSync(join(root, "docs/specs"), { recursive: true }); mkdirSync(join(root, ".imm/audit"), { recursive: true });
			writeFileSync(join(root, "outside.txt"), "untracked");
			writeFileSync(join(root, "docs/specs/draft.md"), "draft");
			writeFileSync(join(root, "docs/plans/draft.md"), "plan");
			writeFileSync(join(root, ".imm/audit/precondition.txt"), "evidence");
			const head = headOf(root); const branch = git("branch", "--show-current"); const status = git("status", "--porcelain");
			const outcome = await prepareBatchPreflight({ root, initiative_slug: SLUG, now: NOW, readInitiative: readNextInitiative });
			if (!outcome.ok) throw new Error(`out-of-scope dirt must not block: ${outcome.reason}`);
			expect(outcome).not.toHaveProperty("precondition_commit");
			expect(headOf(root)).toBe(head);
			expect(git("branch", "--show-current")).toBe(branch);
			expect(git("status", "--porcelain")).toBe(status);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	it.each([
		[".imm/\n", false],
		[".imm/audit/\n", false],
		[".imm/*\n!.imm/audit/\n", true],
	])("rejects before the gate when .gitignore %j would drop a child's terminal audit pair", async (rules, passes) => {
		const root = fixture();
		try {
			writeFileSync(join(root, ".gitignore"), rules);
			execFileSync("git", ["commit", "-qam", "ignore rules"], { cwd: root });
			const before = snapshot(root);
			const outcome = await projectBatchPreflight({ root, initiative_slug: SLUG, now: NOW, readInitiative: readNextInitiative });
			if (passes) {
				if (!outcome.ok) throw new Error(`a tracked .imm/audit/ must not block: ${outcome.reason}`);
			} else {
				expect(outcome).toMatchObject(batchReason("audit_evidence_ignored", ".imm/audit/child-b"));
			}
			expect(snapshot(root)).toEqual(before);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	it("projects a resume from the record and writes nothing", async () => {
		const root = fixture();
		try {
			writeLaneBatch(root);
			const before = snapshot(root);
			const outcome = await projectBatchPreflight({ root, initiative_slug: SLUG, now: NOW,
				readInitiative: async () => ({ contract: "immune_brain/github_initiative_observation/v1", initiative_id: SLUG, issue_number: 1,
					tasks: [{ task_id: "child-a", slice_id: "S1", issue_number: 2, blocked_by: [] },
						{ task_id: "child-b", slice_id: "S2", issue_number: 3, blocked_by: ["child-a"] }] }),
			});

			if (!outcome.ok) throw new Error(`preflight rejected: ${outcome.reason}`);
			expect(outcome.ok).toBe(true);
			expect(outcome.projection.is_resuming).toBe(true);
			expect(outcome.projection.batch_branch).toBe("refs/imm/batches/batch-1");
			expect(outcome.projection.base_head).toBe(headOf(root));
			expect(outcome.projection.recovery_children.map((c) => [c.task_id, c.status])).toEqual([
				["child-a", "already_settled"],
				["child-b", "enrollable"],
			]);
			expect(outcome.projection.plan_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
			expect(outcome.projection.risk_by_task).toEqual({ "child-a": "material", "child-b": "material" });
			// Zero writes: the projection is a pure read, including for a rejection.
			expect(snapshot(root)).toEqual(before);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("uses a settled record only as branch provenance for the current plan", async () => {
		const root = fixture();
		try {
			writeBatch(root, "completed");

			expect(findExistingActiveBatch(root, SLUG)).toBeNull();
			expect(findSettledBatchRecord(root, SLUG)?.batch_id).toBe("batch-1");

			const outcome = await projectBatchPreflight({ root, initiative_slug: SLUG, now: NOW, readInitiative: readNextInitiative });
			if (!outcome.ok) throw new Error(`preflight rejected: ${outcome.reason}`);
			expect(outcome.projection.is_resuming).toBe(false);
			// The previous record supplies branch provenance without supplying children.
			expect(outcome.projection.existing_batch?.batch_id).toBe("batch-1");
			expect(outcome.projection.existing_batch?.batch_state).toBe("completed");
			expect(outcome.projection.base_head).toBe(headOf(root));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("issues a fresh clockless budget for a settled batch that still carries a legacy deadline", async () => {
		const root = fixture();
		try {
			const expired = "2020-01-01T00:00:00.000Z";
			writeBatch(root, "completed", {
				budget: { max_children: 2, deadline_at: expired, qa_failure_limit: 2 },
			});

			const outcome = await projectBatchPreflight({ root, initiative_slug: SLUG, now: new Date().toISOString(), readInitiative: readNextInitiative });
			if (!outcome.ok) throw new Error(`preflight rejected: ${outcome.reason}`);

			expect(outcome.projection.is_resuming).toBe(false);
			// A settled record's budget must never be inherited into a fresh run,
			// and its retired deadline must not resurface in the projection.
			expect(outcome.projection.budget.max_children).toBe(1); // Fresh plan contains one child.
			expect(outcome.projection.budget.qa_failure_limit).toBe(2);
			expect(outcome.projection.budget).not.toHaveProperty("deadline_at");
			// Only the newly projected plan participates in the fresh run.
			expect(outcome.projection.recovery_children.map((c) => [c.task_id, c.status])).toEqual([
				["child-b", "enrollable"],
			]);
			const drift = await projectBatchDrift({ root, initiative_slug: SLUG, readInitiative: readNextInitiative });
			expect(drift.plan_digest).toBe(outcome.projection.plan_digest);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects a batch branch no record of this initiative created", async () => {
		const root = fixture();
		try {
			const tip = conflictingParent(root);
			const before = snapshot(root);
			const outcome = await projectBatchPreflight({ root, initiative_slug: SLUG, now: NOW, readInitiative: readNextInitiative });
			expect(outcome).toMatchObject({ ok: false, ...batchReason("batch_parent_branch_exists", `refs/heads/imm/${SLUG}`) });
			expect(execFileSync("git", ["rev-parse", `refs/heads/imm/${SLUG}`], { cwd: root, encoding: "utf8" }).trim()).toBe(tip);
			expect(snapshot(root)).toEqual(before);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("stays Host-neutral: no Host SDK import and no Host-identity branch", () => {
		const source = readFileSync(
			resolve("plugins/immune-brain/runtime/unattended/batch_preflight.ts"),
			"utf8",
		);
		const imports = [...source.matchAll(/^import[\s\S]*?from "([^"]+)";/gm)].map((match) => match[1]);
		expect(imports.length).toBeGreaterThan(0);
		expect(imports.every((specifier) => specifier.startsWith(".") || specifier.startsWith("node:"))).toBe(true);
		for (const forbidden of ["process.platform", "hostVersion", "probeHost", "requestConfirmation", "elicitation"]) {
			expect({ forbidden, present: source.includes(forbidden) }).toEqual({ forbidden, present: false });
		}
	});

	it("renders its rejections from the frozen shared reason table", async () => {
		const root = fixture();
		try {
			// A condition the table owns: a Parent branch with a different tip.
			conflictingParent(root);
			const outcome = await projectBatchPreflight({ root, initiative_slug: SLUG, now: NOW, readInitiative: readNextInitiative });
			expect(outcome).toMatchObject(batchReason("batch_parent_branch_exists", `refs/heads/imm/${SLUG}`));

			// The table is frozen: no caller can reword a Host's operator-visible text.
			expect(Object.isFrozen(BATCH_REASONS)).toBe(true);
			expect(() => {
				(BATCH_REASONS as Record<string, unknown>).plan_changed = { state: "rejected", reason: "x", recovery_action: "y" };
			}).toThrow();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps every migrated reason key with its exact existing text and recovery action", () => {
		// The vocabulary the two adapters and the preflight emitted before the table
		// existed. A key that disappears, or a text that is silently reworded, fails
		// here rather than reaching an operator as changed prose.
		const expected: Record<string, [string, string]> = {
			batch_runtime_too_old: ["batch_runtime_too_old: <detail>", "reconnect the immune-brain MCP server or upgrade the plugin so the loaded runtime supports this batch record, then retry in the current Host"],
			invalid_slug: ["invalid initiative slug: <detail>", "specify a valid initiative slug and retry in the current Host"],
			batch_state_unreadable: ["batch run state is unreadable or invalid: <detail>", "resolve or remove the invalid batch state file, then retry in the current Host"],
			claim_already_active: ["an active workspace claim already exists for task: <detail>", "resolve or stop the active task before starting a batch in the current Host"],
			kernel_authority_conflict: ["Kernel authority conflict: <detail>", "resolve the Kernel storage conflict before resuming in the current Host"],
			git_head_unreadable: ["<detail>", "commit working changes and ensure a committed Git HEAD exists in the current Host"],
			branch_already_exists: ["branch preflight failed: branch refs/heads/<detail> already exists", "delete or rename the conflicting branch, or commit working changes in the current Host"],
			batch_parent_branch_exists: ["batch_parent_branch_exists: <detail> does not point at base_head", "inspect the existing Parent branch and retry with a reconciled base in the current Host"],
			batch_record_shape_retired: ["batch_record_shape_retired: v1 serial batch records are read-and-retire only", "Inspect the recorded batch, then use retire_stale_batch for this Initiative in the current Host."],
			git_status_unreadable: ["branch preflight failed: git status is unreadable", "check the repository integrity and retry in the current Host"],
			working_tree_dirty: ["branch preflight failed: working tree is dirty: <detail>", "resolve the listed remaining paths outside the batch committable set, then retry in the current Host"],
			authorized_scope_underivable: ["branch preflight failed: cannot derive the in-flight child's authorized scope", "resolve the child's intent record, then retry in the current Host"],
			working_tree_unstaged: ["branch preflight failed: working tree has unstaged or untracked changes (not restored: <detail>)", "establish where each unstaged or untracked change came from before staging anything; move changes that are not the active child's verified work out of the working tree, then retry in the current Host"],
			working_tree_out_of_scope: ["branch preflight failed: working tree has changes outside the authorized child scope", "commit or unstage changes outside the active task scope, then retry in the current Host"],
			audit_evidence_ignored: ["batch preflight failed: .gitignore ignores terminal audit evidence, so a child commit would silently drop it: <detail>", "keep .imm/audit/ tracked (ignore .imm/state/ instead of .imm/, or write .imm/* followed by !.imm/audit/), commit the .gitignore change, then retry in the current Host"],
			empty_enrollable_set: ["empty enrollable child set: no enrollable child tasks found in the initiative plan", "ensure the initiative has uncompleted, non-critical child tasks in the current Host"],
			plan_projection_failed: ["failed to project batch plan: <detail>", "review initiative issues and planning sidecars in the current Host"],
			confirmation_port_unavailable: ["native confirmation port is unavailable", "retry through a fresh native gate in the current Host"],
			confirmation_cancelled: ["native interaction cancelled", "wait for a fresh literal-user request"],
			confirmation_declined: ["native interaction declined", "wait for a fresh literal-user request"],
			confirmation_no_decision: ["native interaction returned no decision", "retry through a fresh native gate in the current Host"],
			confirmation_failed: ["<detail>", "retry through a fresh native gate in the current Host"],
			claim_appeared_during_confirmation: ["an active workspace claim appeared during confirmation for task: <detail>", "resolve or stop the active task before starting a batch in the current Host"],
			plan_became_unreadable: ["batch plan became unreadable after native confirmation", "review the current workspace and retry through a fresh native gate in the current Host"],
			plan_changed: ["batch plan changed after native confirmation", "review the current workspace and retry through a fresh native gate in the current Host"],
			repository_became_unreadable: ["Git repository became unreadable after native confirmation", "review the current workspace and retry through a fresh native gate in the current Host"],
			head_moved: ["Git HEAD moved after native confirmation", "review the current workspace and retry through a fresh native gate in the current Host"],
			cancelled_before_execution: ["user cancelled before batch execution", "wait for a fresh literal-user request"],
			precondition_commit_failed: ["batch precondition commit failed: <detail>", "repair the reported Git precondition failure and retry the batch in the current Host"],
			batch_run_rejected: ["<detail>", "delete or rename the conflicting branch, or commit working changes and retry in the current Host"],
			stale_batch_absent: ["no retirable batch record to dispose: <detail>", "start a batch for this Initiative, or inspect the batch records under .imm/state/batches in the current Host"],
			stale_batch_in_flight: ["a batch child is still mid-flight, so the record cannot be disposed: <detail>", "settle or stop the in-flight child through its own task, then dispose the batch in the current Host; a child whose Kernel run already ended no longer blocks the disposition"],
		};
		expect(Object.keys(BATCH_REASONS).sort()).toEqual(Object.keys(expected).sort());
		for (const [key, [reason, recoveryAction]] of Object.entries(expected)) {
			expect(batchReason(key as keyof typeof BATCH_REASONS, "<detail>")).toEqual({
				state: expect.any(String),
				reason,
				recovery_action: recoveryAction,
			});
		}
	});
});

describe("foreground closeout trigger", () => {
	function root(records: Array<Record<string, unknown>>): string {
		const dir = mkdtempSync(join(tmpdir(), "closeout-trigger-"));
		mkdirSync(join(dir, ".imm", "state", "batches"), { recursive: true });
		records.forEach((record, i) => writeFileSync(join(dir, ".imm", "state", "batches", `b${i}.json`), JSON.stringify({ contract: "assurance_kernel/batch_run_state/v1", ...record })));
		return dir;
	}
	const running = (state: string, batch_state = "running") => ({ initiative_slug: "init", batch_state, children: [{ task_id: "t1", state }] });

	it("selects only a task that is an in-flight child of a resumable batch", () => {
		for (const state of ["enrolled", "settled"]) {
			const dir = root([running(state)]);
			try { expect(findResumableBatchSlugForTask(dir, "t1")).toBe("init"); } finally { rmSync(dir, { recursive: true, force: true }); }
		}
	});

	it("selects nothing for a task outside any batch, a committed, pending or parked child, or a settled batch", () => {
		const cases: Array<[string, Array<Record<string, unknown>>, string]> = [
			["no batch directory", [], "t1"],
			["a task that is not a child", [running("enrolled")], "other"],
			["a committed child", [running("committed")], "t1"],
			["a pending child", [running("pending")], "t1"],
			["a parked child", [running("parked")], "t1"],
			["a stopped child", [running("stopped")], "t1"],
			["a completed batch", [running("settled", "completed")], "t1"],
			["a failed batch", [running("enrolled", "failed")], "t1"],
		];
		for (const [label, records, task] of cases) {
			const dir = root(records);
			try { expect({ label, slug: findResumableBatchSlugForTask(dir, task) }).toEqual({ label, slug: null }); } finally { rmSync(dir, { recursive: true, force: true }); }
		}
	});

	it("ignores unreadable or foreign files instead of throwing", () => {
		const dir = root([running("enrolled")]);
		try {
			writeFileSync(join(dir, ".imm", "state", "batches", "junk.json"), "{not json");
			writeFileSync(join(dir, ".imm", "state", "batches", "foreign.json"), JSON.stringify({ contract: "other/v1" }));
			expect(findResumableBatchSlugForTask(dir, "t1")).toBe("init");
		} finally { rmSync(dir, { recursive: true, force: true }); }
	});
});
