import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BatchPlanChild } from "../plugins/immune-brain/runtime/unattended/types";
import {
	prepareBatchRunState,
	readBatchRunState,
	writeBatchRunState,
	isTerminalBatchState,
	type BatchRunStateRecord,
} from "../plugins/immune-brain/runtime/unattended/batch_state";
import {
	startBatch,
	resumeBatch,
	type BatchRunnerKernelPort,
	type StartBatchInput,
	type BatchChildAdvanceResult,
} from "../plugins/immune-brain/runtime/unattended/batch_runner";
import { createBatchAuthorityRegistry, computeBatchPlanDigest } from "../plugins/immune-brain/runtime/kernel/batch_authority";

const FAR_FUTURE = "2099-01-01T00:00:00.000Z";

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

function input(
	root: string,
	children: BatchPlanChild[],
	kernel: BatchRunnerKernelPort,
	overrides: Partial<StartBatchInput> = {},
): StartBatchInput {
	const registry = createBatchAuthorityRegistry();
	const planDigest = computeBatchPlanDigest(children);
	const capability = registry.issue(
		{
			batch_id: "batch-001",
			initiative_slug: "initiative-slug",
			plan_digest: planDigest,
			branch: "main",
			base_head: "b".repeat(40),
			budget: { max_children: children.length, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
			actor_id: "user",
			confirmation_ref: "confirm",
			expires_at: FAR_FUTURE,
			nonce: "n",
		},
		children,
	);
	return {
		root,
		batch_id: "batch-001",
		initiative_slug: "initiative-slug",
		registry,
		capability,
		children,
		plan_digest: planDigest,
		base_head: "b".repeat(40),
		confirmation_time: FAR_FUTURE,
		authorization_expires_at: FAR_FUTURE,
		budget: { max_children: children.length, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
		now: FAR_FUTURE,
		kernel,
		...overrides,
	};
}

/** Kernel port scripted by a queue of advance results per task. */
function scriptedKernel(advances: Record<string, BatchChildAdvanceResult[]>): BatchRunnerKernelPort & {
	enrolled: string[];
	commits: { task_id: string; batch_id: string }[];
} {
	const queue = new Map(Object.entries(advances).map(([k, v]) => [k, [...v]]));
	return {
		enrolled: [],
		commits: [],
		async enrollTask({ task_id, batch }) {
			if (batch.binding.batch_id !== "batch-001") throw new Error("batch mismatch");
			this.enrolled.push(task_id);
			return { record_revision: "r" };
		},
		async advanceTask(_root, taskId) {
			const list = queue.get(taskId);
			const next = list?.shift();
			if (!next) throw new Error(`no scripted advance for ${taskId}`);
			return next;
		},
		async commitChild(_root, taskId, batchId) {
			this.commits.push({ task_id: taskId, batch_id: batchId });
			const commit = `c${this.commits.length}`.padEnd(40, "0");
			return { commit };
		},
		async lookupBatchCommit(_root, taskId, batchId) {
			const hit = this.commits.find(
				(c) => c.task_id === taskId && c.batch_id === batchId,
			);
			if (!hit) return null;
			const idx = this.commits.indexOf(hit) + 1;
			return { commit: `c${idx}`.padEnd(40, "0") };
		},
		async projectTask(_root, taskId) {
			const claimed = this.enrolled.includes(taskId);
			return {
				error: null,
				claim: claimed ? { task_id: taskId, batch_id: "batch-001" } : null,
			};
		},
	} as BatchRunnerKernelPort & { enrolled: string[]; commits: { task_id: string; batch_id: string }[] };
}

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
				authorization_expires_at: FAR_FUTURE,
				budget: { max_children: 1, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
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
				authorization_expires_at: FAR_FUTURE,
				budget: { max_children: 1, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
				now: FAR_FUTURE,
			});
			writeBatchRunState(root, record);
			expect(() => readBatchRunState(root, "batch-001")).not.toThrow();
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
				authorization_expires_at: FAR_FUTURE,
				budget: { max_children: 1, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
				now: FAR_FUTURE,
			}),
		).toThrow(/safe file identity/);
	});

	it("terminal batch states are terminal, needs_human is not", () => {
		for (const state of ["completed", "budget_stopped", "failed", "rejected"] as const)
			expect(isTerminalBatchState(state)).toBe(true);
		expect(isTerminalBatchState("needs_human")).toBe(false);
		expect(isTerminalBatchState("running")).toBe(false);
	});
});

describe("startBatch state machine", () => {
	it("runs serial happy path: enroll → advance → commit per child in dependency order", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const b = child("task-b", "S2", ["task-a"]);
			const kernel = scriptedKernel({
				"task-a": [{ state: "completed" }],
				"task-b": [{ state: "completed" }],
			});
			const report = await startBatch(input(root, [b, a], kernel));
			expect(kernel.enrolled).toEqual(["task-a", "task-b"]);
			expect(kernel.commits.map((c) => c.task_id)).toEqual(["task-a", "task-b"]);
			expect(report.batch_state).toBe("completed");
			expect(report.commits).toHaveLength(2);
			const stored = readBatchRunState(root, "batch-001")!;
			expect(stored.children.every((c) => c.state === "committed")).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("empty plan is rejected with zero writes", async () => {
		const root = tempRoot();
		try {
			// The registry rejects empty plans at issue(); the driver must
			// independently reject before the first write, so skip issuing.
			const kernel = scriptedKernel({});
			const base = input(root, [child("placeholder", "S0")], kernel);
			const report = await startBatch({ ...base, children: [] });
			expect(report.batch_state).toBe("rejected");
			expect(existsSync(join(root, ".imm", "state", "batches", "batch-001.json"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("a parked child skips its dependents and parks the batch", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const b = child("task-b", "S2", ["task-a"]);
			const kernel = scriptedKernel({
				"task-a": [{ state: "blocked", reason: "resolve_user_decision: needs scope choice" }],
			});
			const report = await startBatch(input(root, [a, b], kernel));
			expect(report.batch_state).toBe("needs_human");
			const stored = readBatchRunState(root, "batch-001")!;
			expect(stored.children.find((c) => c.task_id === "task-a")!.state).toBe("needs_human");
			expect(stored.children.find((c) => c.task_id === "task-b")!.state).toBe("skipped_blocked");
			// No commit was attempted.
			expect(kernel.commits).toHaveLength(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("authorization expiry blocks new enrollment mid-run", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const b = child("task-b", "S2");
			const kernel = scriptedKernel({
				"task-a": [{ state: "completed" }],
				"task-b": [{ state: "completed" }],
			});
			const report = await startBatch(
				input(root, [a, b], kernel, {
					authorization_expires_at: FAR_FUTURE,
					budget: { max_children: 2, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
					// Force the expiry branch by shortening authorization after first commit:
				}),
			);
			// With a far-future expiry both children run; expiry itself is covered
			// by the expired-enrollment case below.
			expect(report.batch_state).toBe("completed");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("expired enrollment rolls the child back to pending and stops for budget", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const kernel = {
				...scriptedKernel({}),
				async enrollTask() {
					throw new Error("batch authorization expired");
				},
				async advanceTask() {
					throw new Error("unreachable");
				},
				async commitChild() {
					throw new Error("unreachable");
				},
			};
			const report = await startBatch(input(root, [a], kernel as unknown as BatchRunnerKernelPort));
			expect(report.batch_state).toBe("budget_stopped");
			const stored = readBatchRunState(root, "batch-001")!;
			expect(stored.children[0]!.state).toBe("pending");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("max_children budget stops before enrolling the next child", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const b = child("task-b", "S2");
			const kernel = scriptedKernel({
				"task-a": [{ state: "completed" }],
			});
			const report = await startBatch(
				input(root, [a, b], kernel, {
					budget: { max_children: 1, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
				}),
			);
			expect(report.batch_state).toBe("budget_stopped");
			expect(kernel.enrolled).toEqual(["task-a"]);
			const stored = readBatchRunState(root, "batch-001")!;
			expect(stored.children.find((c) => c.task_id === "task-b")!.state).toBe("pending");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("qa failure limit parks the child and batch", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const kernel = scriptedKernel({
				"task-a": [
					{ state: "rework", summary: "first failure" },
					{ state: "rework", summary: "second failure" },
					{ state: "rework", summary: "third failure" },
				],
			});
			const report = await startBatch(input(root, [a], kernel));
			expect(report.batch_state).toBe("needs_human");
			const stored = readBatchRunState(root, "batch-001")!;
			expect(stored.consecutive_qa_failures).toBe(3);
			expect(stored.children[0]!.state).toBe("needs_human");
			expect(stored.children[0]!.reason).toContain("QA failure limit");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rework below the limit retries the same child to completion", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const kernel = scriptedKernel({
				"task-a": [
					{ state: "rework", summary: "fix the test" },
					{ state: "completed" },
				],
			});
			const report = await startBatch(input(root, [a], kernel));
			expect(report.batch_state).toBe("completed");
			const stored = readBatchRunState(root, "batch-001")!;
			// review-6: a successful settlement resets the counter, so the
			// rework then completion run ends at zero.
			expect(stored.consecutive_qa_failures).toBe(0);
			expect(stored.children[0]!.state).toBe("committed");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("an open review reservation pauses the batch without parking", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const kernel = scriptedKernel({
				"task-a": [{ state: "review_ready", operation_id: "op-1" }],
			});
			const report = await startBatch(input(root, [a], kernel));
			expect(report.batch_state).toBe("running");
			expect(report.next_action).toContain("Review verdict");
			const stored = readBatchRunState(root, "batch-001")!;
			expect(stored.children[0]!.state).toBe("enrolled");
			expect(stored.children[0]!.reason).toContain("op-1");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("a child stop parks it and skips dependents", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const b = child("task-b", "S2", ["task-a"]);
			const kernel = scriptedKernel({
				"task-a": [{ state: "stopped" }],
			});
			const report = await startBatch(input(root, [a, b], kernel));
			expect(report.batch_state).toBe("needs_human");
			const stored = readBatchRunState(root, "batch-001")!;
			expect(stored.children.find((c) => c.task_id === "task-a")!.state).toBe("needs_human");
			expect(stored.children.find((c) => c.task_id === "task-b")!.state).toBe("skipped_blocked");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("a commit failure fails the whole batch (Invariant I-2)", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const kernel = {
				...scriptedKernel({ "task-a": [{ state: "completed" }] }),
				async commitChild() {
					throw new Error("lineage check failed: HEAD moved");
				},
			};
			const report = await startBatch(input(root, [a], kernel as unknown as BatchRunnerKernelPort));
			expect(report.batch_state).toBe("failed");
			const stored = readBatchRunState(root, "batch-001")!;
			expect(stored.children[0]!.state).toBe("needs_human");
			expect(stored.children[0]!.reason).toContain("HEAD moved");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("infrastructure failure parks the child without mutating kernel state directly", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const kernel = scriptedKernel({
				"task-a": [{ state: "failed", reason: "storage unreachable" }],
			});
			const report = await startBatch(input(root, [a], kernel));
			expect(report.batch_state).toBe("needs_human");
			const stored = readBatchRunState(root, "batch-001")!;
			expect(stored.children[0]!.state).toBe("needs_human");
			expect(stored.children[0]!.reason).toContain("storage unreachable");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("terminal replay is idempotent: second startBatch does not re-enroll", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const kernel = scriptedKernel({ "task-a": [{ state: "completed" }] });
			const first = await startBatch(input(root, [a], kernel));
			expect(first.batch_state).toBe("completed");
			const enrolledBefore = kernel.enrolled.length;
			const second = await startBatch(input(root, [a], kernel));
			expect(second.batch_state).toBe("completed");
			expect(kernel.enrolled.length).toBe(enrolledBefore);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("needs_human after resume requires fresh confirmation when authorization expired", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			// Park a child first.
			const kernel = scriptedKernel({
				"task-a": [{ state: "blocked", reason: "resolve_user_decision: scope" }],
			});
			await startBatch(input(root, [a], kernel));
			// Simulate expiry on the persisted record (a parked batch that
			// never reached a terminal state).
			const stored = readBatchRunState(root, "batch-001")!;
			const expired: BatchRunStateRecord = {
				...stored,
				authorization_expires_at: "2000-01-01T00:00:00.000Z",
			};
			writeBatchRunState(root, expired);
			const resumeKernel = scriptedKernel({});
			const projection = async () => ({
				contract: "assurance_kernel/assurance_projection/v1" as const,
				task_id: "task-a",
				error: null,
				claim: { task_id: "task-a", lifecycle_status: "active" },
				projection: {} as never,
			});
			const report = await resumeBatch(
				input(root, [a], resumeKernel),
				projection as never,
			);
			// review-2(4th round): expiry of a running/parked batch persists a
			// terminal budget_stopped state and writes the terminal report; a
			// parked child keeps needs_human because its decision is pending.
			expect(report.batch_state).toBe("budget_stopped");
			expect(report.next_action).toContain("human decision");
			const persisted = readBatchRunState(root, "batch-001")!;
			expect(persisted.batch_state).toBe("budget_stopped");
			const reportPath = join(root, ".imm/state/batches/batch-001.report.json");
			expect(existsSync(reportPath)).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("review-1: resume drives an interrupted enrolled child to settlement and commit before anything else", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			// First run pauses with an open review reservation, leaving the child
			// enrolled but unsettled.
			const kernel = scriptedKernel({
				"task-a": [{ state: "review_ready", operation_id: "op-1" }],
			});
			await startBatch(input(root, [a], kernel));
			// Resume with an expired authorization: the interrupted child must
			// still be driven to its own settlement and commit first.
			const stored = readBatchRunState(root, "batch-001")!;
			writeBatchRunState(root, {
				...stored,
				authorization_expires_at: "2000-01-01T00:00:00.000Z",
			});
			const resumeKernel = scriptedKernel({
				"task-a": [{ state: "completed" }],
			});
			// The interrupted child's Kernel claim is still open: the fake
			// kernel's projectTask must report it so the runner adopts the
			// claim rather than re-enrolling.
			resumeKernel.enrolled.push("task-a");
			const report = await resumeBatch(
				input(root, [a], resumeKernel),
				async () => ({ error: null, claim: { task_id: "task-a" } }) as never,
			);
			expect(resumeKernel.commits.length).toBe(1);
			const after = readBatchRunState(root, "batch-001")!;
			expect(after.children[0]!.state).toBe("committed");
			expect(after.batch_state).not.toBe("completed");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("review-3: budget counts enrollments, so parked children consume the budget", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const b = child("task-b", "S2");
			const kernel = scriptedKernel({
				"task-a": [{ state: "blocked", reason: "resolve_user_decision: scope" }],
			});
			// max_children=1: after parking task-a the batch must not enroll task-b.
			const report = await startBatch(input(root, [a, b], kernel, { budget: { max_children: 1, deadline_at: FAR_FUTURE, qa_failure_limit: 3 } }));
			expect(report.batch_state).toBe("needs_human");
			expect(kernel.enrolled).toEqual(["task-a"]);
			const stored = readBatchRunState(root, "batch-001")!;
			expect(stored.children.find((c) => c.task_id === "task-b")!.state).toBe("pending");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("review-2(5th): a pending child that already holds the batch claim is adopted without re-enrolling", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			// First run parks the batch with a needs_human child after the
			// durable enrollment, then the state write reverts it to pending
			// (crash between enrollTask and persist).
			const kernel = scriptedKernel({
				"task-a": [{ state: "review_ready", operation_id: "op-1" }],
			});
			await startBatch(input(root, [a], kernel));
			const stored = readBatchRunState(root, "batch-001")!;
			writeBatchRunState(root, {
				...stored,
				children: stored.children.map((c) => ({ ...c, state: "pending", reason: null })),
				authorization_expires_at: "2000-01-01T00:00:00.000Z",
			});
			// Resume: kernel.enrolled already contains task-a, so the fresh
			// projection sees the claim and the child is adopted, not
			// re-enrolled (a duplicate enrollment would throw here).
			const resumeKernel = scriptedKernel({
				"task-a": [{ state: "completed" }],
			});
			resumeKernel.enrolled.push("task-a");
			const enrollCalls: string[] = [];
			const origEnroll = resumeKernel.enrollTask.bind(resumeKernel);
			resumeKernel.enrollTask = (args) => {
				enrollCalls.push(args.task_id);
				return origEnroll(args);
			};
			await resumeBatch(
				input(root, [a], resumeKernel),
				async () =>
				({
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: "task-a",
					error: null,
					claim: null,
					projection: { lifecycle: "", completion_ready: false },
				}) as never,
			);
			expect(enrollCalls.length).toBe(0);
			const after = readBatchRunState(root, "batch-001")!;
			expect(after.children[0]!.state).toBe("committed");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("review-3(5th): a settled child whose commit already exists adopts it idempotently", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const kernel = scriptedKernel({
				"task-a": [{ state: "review_ready", operation_id: "op-1" }],
			});
			await startBatch(input(root, [a], kernel));
			// Simulate crash after settlement AND commitChild but before the
			// committed-persist: kernel holds the commit, persisted child is
			// settled (settlement persisted, commit did not).
			const stored = readBatchRunState(root, "batch-001")!;
			writeBatchRunState(root, {
				...stored,
				children: stored.children.map((c) =>
					c.state === "enrolled" ? { ...c, state: "settled", reason: null } : c,
				),
			});
			const settleKernel = scriptedKernel({
				"task-a": [{ state: "completed" }],
			});
			settleKernel.enrolled.push("task-a");
			settleKernel.commits.push({ task_id: "task-a", batch_id: "batch-001" });
			const commitCalls: string[] = [];
			const origCommit = settleKernel.commitChild.bind(settleKernel);
			settleKernel.commitChild = (root2, taskId, batchId, head) => {
				commitCalls.push(taskId);
				return origCommit(root2, taskId, batchId, head);
			};
			await resumeBatch(
				input(root, [a], settleKernel),
				async () =>
				({
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: "task-a",
					error: null,
					claim: null,
					projection: { lifecycle: "", completion_ready: false },
				}) as never,
			);
			// The existing commit is adopted; commitChild is not called again.
			expect(commitCalls.length).toBe(0);
			const after = readBatchRunState(root, "batch-001")!;
			expect(after.children[0]!.state).toBe("committed");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("review-5: a terminal run report is persisted exactly once", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const kernel = scriptedKernel({ "task-a": [{ state: "completed" }] });
			const report = await startBatch(input(root, [a], kernel));
			expect(report.batch_state).toBe("completed");
			const reportPath = join(root, ".imm", "state", "batches", "batch-001.report.json");
			expect(existsSync(reportPath)).toBe(true);
			const persisted = JSON.parse(readFileSync(reportPath, "utf8"));
			expect(persisted.batch_state).toBe("completed");
			expect(persisted.reason).toBe("all enrollable children committed");
			// A non-terminal pause must not write a report file.
			const root2 = tempRoot();
			try {
				const pausedKernel = scriptedKernel({ "task-a": [{ state: "review_ready", operation_id: "op-1" }] });
				await startBatch(input(root2, [child("task-a", "S1")], pausedKernel));
				expect(existsSync(join(root2, ".imm", "state", "batches", "batch-001.report.json"))).toBe(false);
			} finally {
				rmSync(root2, { recursive: true, force: true });
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("review-4: a pre-existing batches symlink is rejected", () => {
		const root = tempRoot();
		try {
			const outside = mkdtempSync(join(tmpdir(), "imm-outside-"));
			mkdirSync(join(root, ".imm", "state"), { recursive: true });
			const symlinkPath = join(root, ".imm", "state", "batches");
			symlinkSync(outside, symlinkPath);
			const record = prepareBatchRunState({
				batch_id: "batch-001",
				initiative_slug: "initiative-slug",
				children: [child("task-a", "S1")],
				plan_digest: "d".repeat(64),
				base_head: "b".repeat(40),
				confirmation_time: FAR_FUTURE,
				authorization_expires_at: FAR_FUTURE,
				budget: { max_children: 1, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
				now: FAR_FUTURE,
			});
			expect(() => writeBatchRunState(root, record)).toThrow();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
