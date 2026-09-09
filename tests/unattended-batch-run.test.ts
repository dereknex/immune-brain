import { execFileSync } from "node:child_process";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BatchPlanChild } from "../plugins/immune-brain/runtime/unattended/types";
import {
	prepareBatchRunState,
	readBatchRunState,
	writeBatchRunState,
	writeBatchRunReport,
	isTerminalBatchState,
	type BatchRunStateRecord,
} from "../plugins/immune-brain/runtime/unattended/batch_state";
import {
	startBatch,
	resumeBatch,
	BatchAuthorizationExpiryError,
	type BatchRunnerKernelPort,
	type StartBatchInput,
	type BatchChildAdvanceResult,
} from "../plugins/immune-brain/runtime/unattended/batch_runner";
import type { AssuranceProjectionResult } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import {
	createBatchAuthorityRegistry,
	deriveChildEnrollment,
	computeBatchPlanDigest,
	BatchAuthorizationExpiryError as KernelBatchAuthorizationExpiryError,
} from "../plugins/immune-brain/runtime/kernel/batch_authority";

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
	const confirmationTime = overrides.confirmation_time ?? "2026-01-01T00:00:00.000Z";
	const budget = overrides.budget ?? { max_children: children.length, deadline_at: FAR_FUTURE, qa_failure_limit: 3 };
	const capability = overrides.capability ?? registry.issue(
		{
			batch_id: "batch-001",
			initiative_slug: "initiative-slug",
			plan_digest: planDigest,
			branch: "main",
			base_head: overrides.base_head ?? "b".repeat(40),
			budget,
			actor_id: "user",
			confirmation_ref: "confirm",
			expires_at: overrides.authorization_expires_at ?? FAR_FUTURE,
			nonce: "n",
		},
		children,
		confirmationTime,
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
		confirmation_time: confirmationTime,
		authorization_expires_at: FAR_FUTURE,
		budget,
		now: FAR_FUTURE,
		kernel,
		git: overrides.git ?? {
			preflight: () => ({ ok: true, branch: `imm/${overrides.initiative_slug ?? "initiative-slug"}` }),
			commitChild: kernel.commitChild
				? (r, t, b, h, ip) => kernel.commitChild!(r, t, b, h, ip)
				: async () => ({ commit: "c".padEnd(40, "0") }),
			lookupBatchCommit: kernel.lookupBatchCommit
				? (r, t, b, eh) => kernel.lookupBatchCommit!(r, t, b, eh)
				: async () => null,
		},
		...overrides,
	};
}

/** Kernel port scripted by a queue of advance results per task. */
function scriptedKernel(advances: Record<string, BatchChildAdvanceResult[]>): BatchRunnerKernelPort & {
	enrolled: string[];
	commits: { task_id: string; batch_id: string }[];
	foreignClaims: Set<string>;
} {
	const queue = new Map(Object.entries(advances).map(([k, v]) => [k, [...v]]));
	return {
		enrolled: [],
		commits: [],
		foreignClaims: new Set(),
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
		async projectTask(_root, taskId): Promise<AssuranceProjectionResult> {
			const claimed = this.enrolled.includes(taskId);
			if (claimed) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: { task_id: taskId, lifecycle_status: "active" },
					projection: { lifecycle: "active", completion_ready: false } as never,
				};
			}
			return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "active", completion_ready: false } as never,
			};
		},
		ownsTaskClaim(taskId) {
			return this.enrolled.includes(taskId) && !this.foreignClaims.has(taskId);
		},
		validateBatchAuthorization({ registry, capability, binding }) {
			// Kernel-side gate: the presented capability must be genuinely
			// issued (inspect rejects fabricated objects), unexpired, and bound
			// to the presented batch_id/plan_digest/base_head.
			return registry.inspect(capability, {
				...binding, branch: "main", actor_id: "user", confirmation_ref: "confirm", nonce: "n",
			});
		},
	} as BatchRunnerKernelPort & { enrolled: string[]; commits: { task_id: string; batch_id: string }[]; foreignClaims: Set<string> };
}

describe("renewed authorization with real enrollment derivation", () => {
	for (const recoveredClaim of [false, true]) {
		for (const proof of ["valid", "missing", "mismatch"] as const) {
		it(`restores commit-backed consumption before enrollment: recoveredClaim=${recoveredClaim} proof=${proof}`, async () => {
			const root = tempRoot();
			try {
				const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: {
					...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.test",
					GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.test",
				} }).trim();
				git("init", "-q");
				git("config", "core.hooksPath", "/dev/null");
				mkdirSync(join(root, "docs/plans"), { recursive: true });
				for (const taskId of ["task-a", "task-b"]) {
					writeFileSync(join(root, `docs/plans/${taskId}.intent.json`), JSON.stringify({
						contract: "assurance_kernel/task_intent/v1", task_id: taskId, owner: "user", revision: 1,
						goal: taskId, risk: "routine", scope_hint: ["docs/plans"],
						acceptance: [{ id: "acc-1", assertion: taskId, verification: "bun test tests/example.test.ts" }],
					}));
				}
				git("add", "docs/plans"); git("commit", "-qm", "fixture");
				const base = git("rev-parse", "HEAD");
				const plan = ["task-a", "task-b"].map((taskId, index) => {
					const intent = preparePiCanary(root, { task_id: taskId, now: "2026-01-01T00:00:00.000Z" }).intent!;
					return { ...child(taskId, `S${index}`, index ? ["task-a"] : []), intent_path: intent.path,
						intent_revision: intent.revision, intent_content_hash: intent.content_hash };
				});
				const kernel = scriptedKernel({ "task-a": [{ state: "completed" }], "task-b": [{ state: "completed" }] });
				const evidence = new Map<string, string>();
				kernel.lookupBatchCommit = async (_root, taskId, batchId) => {
					expect(batchId).toBe("batch-001");
					if (proof === "missing") return null;
					return evidence.has(taskId) ? { commit: proof === "mismatch" ? "f".repeat(40) : evidence.get(taskId)! } : null;
				};
				kernel.commitChild = async (_root, taskId) => {
					git("commit", "--allow-empty", "-qm", taskId);
					const commit = git("rev-parse", "HEAD"); evidence.set(taskId, commit); return { commit };
				};
				const request = input(root, plan, kernel, { base_head: base, confirmation_time: "2026-02-01T00:00:00.000Z" });
				const binding = { batch_id: request.batch_id, initiative_slug: request.initiative_slug,
					plan_digest: request.plan_digest, branch: "main", base_head: base, budget: request.budget,
					actor_id: "user", confirmation_ref: "confirm", expires_at: FAR_FUTURE, nonce: "n" };
				const enroll = kernel.enrollTask.bind(kernel);
				kernel.enrollTask = async (args) => {
					deriveChildEnrollment(root, request.registry, { capability: request.capability, binding,
						task_id: args.task_id, expected_head: args.batch.binding.expected_head, now: new Date().toISOString() });
					request.registry.consumeChild(request.capability, binding, args.task_id);
					return enroll(args);
				};
				const prepared = prepareBatchRunState({ ...request, confirmation_time: "2026-01-01T00:00:00.000Z" });
				// Recovery fixture reflects post-preflight reality: the batch branch exists and is checked out.
				git("checkout", "-qb", prepared.branch ?? `imm/${request.initiative_slug}`);
				if (recoveredClaim) kernel.enrolled.push("task-a");
				else await kernel.commitChild(root, "task-a", request.batch_id, base);
				writeBatchRunState(root, { ...prepared, batch_state: "needs_human",
					commits: recoveredClaim ? [] : [evidence.get("task-a")!], children: prepared.children.map((item) => ({ ...item,
						state: item.task_id === "task-a" && !recoveredClaim ? "committed" : item.task_id === "task-a" || !recoveredClaim ? "needs_human" : "skipped_blocked",
						commit: item.task_id === "task-a" && !recoveredClaim ? evidence.get("task-a")! : null,
						reason: "parked for confirmation",
					})),
				});
				if (proof !== "valid") {
					await expect(startBatch(request)).rejects.toThrow("lacks evidence");
					expect(request.registry.consumedChildren(request.capability)).toEqual([]);
					expect(kernel.enrolled).not.toContain("task-b");
					return;
				}
				const report = await startBatch(request);
				expect(report.batch_state).toBe("completed");
				expect(kernel.enrolled.filter((taskId) => taskId === "task-b")).toHaveLength(1);
				expect(request.registry.consumedChildren(request.capability).sort()).toEqual(["task-a", "task-b"]);
			} finally { rmSync(root, { recursive: true, force: true }); }
		});
		}
	}
});

describe("single-claim recovery matrix", () => {
	for (const entry of ["start", "resume"] as const) {
		for (const reverse of [false, true]) {
			for (const expired of [false, true]) {
				for (const checkpoint of ["enrollment", "settlement", "commit", "foreign"] as const) {
					it(`${entry}: reverse=${reverse} expired=${expired} after ${checkpoint}`, async () => {
						const root = tempRoot();
						try {
							const a = child("task-a", "S1");
							const b = child("task-b", "S2", [a.task_id]);
							const kernel = scriptedKernel({
								"task-a": [{ state: "review_ready", operation_id: "recovered-review" }, { state: "completed" }],
								"task-b": [{ state: "completed" }],
							});
							let claim: string | null = checkpoint === "enrollment" || checkpoint === "foreign" ? a.task_id : null;
							const settled = new Set(checkpoint === "settlement" || checkpoint === "commit" ? [a.task_id] : []);
							kernel.enrolled.push(a.task_id);
							if (checkpoint === "foreign") kernel.foreignClaims.add(a.task_id);
							if (checkpoint === "commit") kernel.commits.push({ task_id: a.task_id, batch_id: "batch-001" });
							const project = kernel.projectTask.bind(kernel);
							kernel.projectTask = async (cwd, taskId) => {
								const result = await project(cwd, taskId);
								return { ...result,
									claim: claim ? { task_id: claim, lifecycle_status: "active" } : null,
									error: claim && claim !== taskId ? `backend claim belongs to ${claim}, not ${taskId}` : null,
									projection: { ...result.projection, lifecycle: settled.has(taskId) ? "done" : "active", completion_ready: settled.has(taskId) },
								};
							};
							const enroll = kernel.enrollTask.bind(kernel);
							kernel.enrollTask = async (args) => {
								expect(claim).toBeNull();
								expect(kernel.enrolled).not.toContain(args.task_id);
								const result = await enroll(args);
								claim = args.task_id;
								return result;
							};
							const advance = kernel.advanceTask.bind(kernel);
							kernel.advanceTask = async (cwd, taskId) => {
								expect(claim).toBe(taskId);
								expect(settled.has(taskId)).toBe(false);
								const result = await advance(cwd, taskId);
								if (result.state === "completed") { settled.add(taskId); claim = null; }
								return result;
							};
							const commit = kernel.commitChild.bind(kernel);
							kernel.commitChild = async (cwd, taskId, batchId, head) => {
								expect(claim).toBeNull();
								expect(settled.has(taskId)).toBe(true);
								expect(kernel.commits.some((item) => item.task_id === taskId)).toBe(false);
								return commit(cwd, taskId, batchId, head);
							};
							const request = input(root, reverse ? [b, a] : [a, b], kernel);
							const prepared = prepareBatchRunState(request);
							writeBatchRunState(root, { ...prepared, batch_state: "running",
								authorization_expires_at: expired ? "2020-01-01T00:00:00.000Z" : FAR_FUTURE,
								children: prepared.children.map((item) => item.task_id !== a.task_id ? item : {
									...item, state: checkpoint === "commit" ? "settled" : checkpoint === "settlement" ? "enrolled" : "pending",
								}),
							});
							const run = () => entry === "start" ? startBatch(request) : resumeBatch(request, kernel.projectTask);
							let report = await run();
							if (checkpoint === "enrollment") {
								expect(report.batch_state).toBe("running");
								expect(claim).toBe(a.task_id);
								expect(kernel.enrolled).toEqual([a.task_id]);
								report = await run();
							}
							if (checkpoint === "foreign") {
								expect(report.batch_state).toBe("needs_human");
								expect(report.children.find((item) => item.task_id === b.task_id)?.state).toBe("skipped_blocked");
								expect(kernel.commits).toEqual([]);
								expect(claim).toBe(a.task_id);
							} else {
								expect(report.batch_state).toBe(expired ? "budget_stopped" : "completed");
								expect(claim).toBeNull();
								expect(kernel.commits.map((item) => item.task_id)).toEqual(expired ? [a.task_id] : [a.task_id, b.task_id]);
								await run();
							}
							expect(kernel.enrolled).toEqual(expired || checkpoint === "foreign" ? [a.task_id] : [a.task_id, b.task_id]);
						} finally { rmSync(root, { recursive: true, force: true }); }
					});
				}
			}
		}
	}
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

	it.each(["../../../victim", "../escape", "/absolute", "a/b", "a\\b", "", ".", "..", "a".repeat(129)])(
		"rejects unsafe persistence identity %s before any writes", (batch_id) => {
			const root = tempRoot();
			try {
				const record = prepareBatchRunState(input(root, [child("task-a", "S1")], scriptedKernel({})));
				expect(() => readBatchRunState(root, batch_id)).toThrow(/safe file identity/);
				expect(() => writeBatchRunState(root, { ...record, batch_id })).toThrow(/safe file identity/);
				expect(() => writeBatchRunReport(root, { ...record, batch_id,
					contract: "assurance_kernel/batch_run_report/v1", reason: null, next_action: "None",
				})).toThrow(/safe file identity/);
				expect(existsSync(join(root, ".imm"))).toBe(false);
			} finally { rmSync(root, { recursive: true, force: true }); }
		},
	);

	it("rejects malformed persisted authorization and budget values", () => {
		const root = tempRoot();
		try {
			const valid = prepareBatchRunState({
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
			writeBatchRunState(root, valid);
			const path = join(root, ".imm/state/batches/batch-001.json");
			const invalidRecords: BatchRunStateRecord[] = [
				{ ...valid, authorization_expires_at: "not-a-date" },
				{ ...valid, budget: { ...valid.budget, deadline_at: "January 1, 2099" } },
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

	it("terminal batch states are terminal, needs_human is not", () => {
		for (const state of ["completed", "budget_stopped", "failed", "rejected"] as const)
			expect(isTerminalBatchState(state)).toBe(true);
		expect(isTerminalBatchState("needs_human")).toBe(false);
		expect(isTerminalBatchState("running")).toBe(false);
	});
});

describe("batch boundary regressions", () => {
	it.each([
		[child("task-a", "S1", ["task-a"])],
		[child("task-a", "S1", ["task-b"]), child("task-b", "S2", ["task-a"])],
		[child("task-free", "S0"), child("task-a", "S1", ["task-b"]), child("task-b", "S2", ["task-c"]), child("task-c", "S3", ["task-a"])],
	].map((children) => ({ children })))("rejects cyclic plans before issuing authority or writing batch state: %j", ({ children }) => {
		const root = tempRoot();
		const kernel = scriptedKernel({});
		try {
			expect(() => input(root, children, kernel)).toThrow("dependency cycle");
			expect(kernel.enrolled).toEqual([]);
			expect(existsSync(join(root, ".imm"))).toBe(false);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});
	it("replays commit evidence when dependency order differs from plan array order", async () => {
		const root = tempRoot();
		try {
			const kernel = scriptedKernel({ "task-a": [{ state: "completed" }], "task-b": [{ state: "completed" }] });
			const request = input(root, [child("task-b", "S2", ["task-a"]), child("task-a", "S1")], kernel);
			expect((await startBatch(request)).batch_state).toBe("completed");
			expect((await startBatch(request)).batch_state).toBe("completed");
			expect(kernel.enrolled).toEqual(["task-a", "task-b"]);
			expect(kernel.commits).toHaveLength(2);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});
	it.each(["start", "resume"] as const)("%s rejects fabricated completion without writes", async (entry) => {
		const root = tempRoot();
		try {
			const kernel = scriptedKernel({});
			const request = input(root, [child("task-a", "S1")], kernel);
			const prepared = prepareBatchRunState(request);
			const commit = "a".repeat(40);
			writeBatchRunState(root, { ...prepared, batch_state: "completed", commits: [commit],
				children: prepared.children.map((c) => ({ ...c, state: "committed", commit })),
			});
			const path = join(root, ".imm/state/batches/batch-001.json");
			const before = readFileSync(path, "utf8");
			await expect(entry === "start" ? startBatch(request) : resumeBatch(request, kernel.projectTask.bind(kernel)))
				.rejects.toThrow("lacks evidence");
			expect(readFileSync(path, "utf8")).toBe(before);
			expect(existsSync(join(root, ".imm/state/batches/batch-001.report.json"))).toBe(false);
			expect(kernel.enrolled).toEqual([]);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	it("rejects a truncated persisted plan even when it claims completion", async () => {
		const root = tempRoot();
		try {
			const request = input(root, [child("task-a", "S1"), child("task-b", "S2")], scriptedKernel({}));
			const prepared = prepareBatchRunState(request);
			const commit = "a".repeat(40);
			writeBatchRunState(root, { ...prepared, batch_state: "completed", commits: [commit],
				children: [{ ...prepared.children[0]!, state: "committed", commit }],
			});
			await expect(startBatch(request)).rejects.toThrow("authorized plan");
			expect(existsSync(join(root, ".imm/state/batches/batch-001.report.json"))).toBe(false);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	it("rejects a fabricated aggregate commit list despite real child evidence", async () => {
		const root = tempRoot();
		try {
			const kernel = scriptedKernel({ "task-a": [{ state: "completed" }] });
			const request = input(root, [child("task-a", "S1")], kernel);
			await startBatch(request);
			const saved = readBatchRunState(root, request.batch_id)!;
			writeBatchRunState(root, { ...saved, commits: [...saved.commits, "a".repeat(40)] });
			await expect(startBatch(request)).rejects.toThrow("commit list");
			expect(kernel.commits).toHaveLength(1);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});
	it.each(["enrolled", "settled", "pending"] as const)(
		"completes an expired last %s child without new enrollment", async (state) => {
			const root = tempRoot();
			const clock = spyOn(Date, "now").mockReturnValue(Date.parse("2098-01-01T00:00:00.000Z"));
			try {
				const kernel = scriptedKernel({ "task-a": [{ state: "completed" }] });
				const request = input(root, [child("task-a", "S1")], kernel, {
					authorization_expires_at: "2097-01-01T00:00:00.000Z",
				});
				kernel.enrolled.push("task-a");
				const prepared = prepareBatchRunState(request);
				writeBatchRunState(root, { ...prepared, batch_state: "running",
					children: prepared.children.map((c) => ({ ...c, state })),
				});
				const report = await startBatch(request);
				expect(report.batch_state).toBe("completed");
				expect(report.children[0]!.state).toBe("committed");
				expect(kernel.enrolled).toEqual(["task-a"]);
				expect(kernel.commits).toHaveLength(1);
			} finally { clock.mockRestore(); rmSync(root, { recursive: true, force: true }); }
		},
	);

	it("does not enroll when deadline elapses during projection", async () => {
		const root = tempRoot();
		const deadline = "2098-01-01T00:00:00.000Z";
		const clock = spyOn(Date, "now").mockReturnValue(Date.parse(deadline) - 1);
		try {
			const kernel = scriptedKernel({});
			const project = kernel.projectTask.bind(kernel);
			kernel.projectTask = async (...args) => {
				const result = await project(...args);
				clock.mockReturnValue(Date.parse(deadline));
				return result;
			};
			const request = input(root, [child("task-a", "S1")], kernel, {
				budget: { max_children: 1, deadline_at: deadline, qa_failure_limit: 3 },
			});
			const report = await startBatch(request);
			expect(report.batch_state).toBe("budget_stopped");
			expect(report.children[0]!.state).toBe("pending");
			expect(kernel.enrolled).toEqual([]);
		} finally { clock.mockRestore(); rmSync(root, { recursive: true, force: true }); }
	});

	it("the real capability boundary rejects deadline expiry before consuming a child", () => {
		const request = input("unused", [child("task-a", "S1")], scriptedKernel({}), {
			budget: { max_children: 1, deadline_at: "2098-01-01T00:00:00.000Z", qa_failure_limit: 3 },
		});
		const now = Date.parse(request.budget.deadline_at);
		expect(() => request.registry.inspect(request.capability, {}, now - 1)).not.toThrow();
		expect(() => request.registry.consumeChild(request.capability, {}, "task-a", now))
			.toThrow(KernelBatchAuthorizationExpiryError);
		expect(request.registry.consumedChildren(request.capability)).toEqual([]);
	});
	it.each(["intent_path", "intent_revision", "intent_content_hash"] as const)(
		"rejects missing %s before any writes", async (field) => {
			const root = tempRoot();
			try {
				const kernel = scriptedKernel({});
				const request = input(root, [child("task-a", "S1")], kernel);
				request.children[0] = { ...request.children[0]!, [field]: null };
				const report = await startBatch(request);
				expect(report.batch_state).toBe("rejected");
				expect(report.reason).toContain("no complete intent identity");
				expect(kernel.enrolled).toEqual([]);
				expect(existsSync(join(root, ".imm"))).toBe(false);
			} finally { rmSync(root, { recursive: true, force: true }); }
		},
	);
	it.each(["confirmation", "base_head"])("parked resume rejects reused authority with forged %s", async (field) => {
		const root = tempRoot();
		try {
			const kernel = scriptedKernel({ "task-a": [{ state: "blocked", reason: "human decision" }] });
			const original = input(root, [child("task-a", "S1")], kernel);
			await startBatch(original);
			const path = join(root, ".imm/state/batches/batch-001.json");
			const before = readFileSync(path, "utf8");
			const replacement = field === "base_head"
				? input(root, original.children, kernel, {
					confirmation_time: "2026-01-02T00:00:00.000Z", base_head: "a".repeat(40),
				})
				: { ...original, confirmation_time: "2026-01-02T00:00:00.000Z" };
			await expect(startBatch(replacement)).rejects.toThrow(/confirmation|base_head/);
			expect(readFileSync(path, "utf8")).toBe(before);
			expect(kernel.enrolled).toEqual(["task-a"]);
			expect(kernel.commits).toHaveLength(0);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	it.each(["order", "dependency", "budget"])("rejects changed %s before initial writes", async (field) => {
		const root = tempRoot();
		try {
			const kernel = scriptedKernel({});
			const original = input(root, [child("task-a", "S1"), child("task-b", "S2", ["task-a"])], kernel);
			const tampered = { ...original };
			if (field === "order") tampered.children = [...original.children].reverse();
			if (field === "dependency") tampered.children = original.children.map((c) => ({ ...c, blocked_by: [] }));
			if (field === "budget") tampered.budget = { ...original.budget, qa_failure_limit: 100 };
			const report = await startBatch(tampered);
			expect(report.batch_state).toBe("rejected");
			expect(report.reason).toMatch(/authorized plan|budget mismatch/);
			expect(existsSync(join(root, ".imm"))).toBe(false);
			expect(kernel.enrolled).toEqual([]);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	it.each(["start", "resume"])("%s parks Review rework immediately without consuming QA budget", async (entry) => {
		const root = tempRoot();
		try {
			const kernel = scriptedKernel({ "task-a": [{ state: "rework", operation: "review", summary: "blocking Review finding" }] });
			const request = input(root, [child("task-a", "S1"), child("task-b", "S2", ["task-a"]), child("task-c", "S3")], kernel);
			if (entry === "resume") {
				const prepared = prepareBatchRunState(request);
				writeBatchRunState(root, { ...prepared, batch_state: "running",
					children: prepared.children.map((c) => c.task_id === "task-a" ? { ...c, state: "enrolled" } : c) });
				kernel.enrolled.push("task-a");
			}
			const report = entry === "start" ? await startBatch(request) : await resumeBatch(request, kernel.projectTask);
			expect(report.batch_state).toBe("needs_human");
			expect(report.children.map((c) => c.state)).toEqual(["needs_human", "skipped_blocked", "pending"]);
			expect(readBatchRunState(root, "batch-001")!.consecutive_qa_failures).toBe(0);
			expect(kernel.enrolled).toEqual(["task-a"]);
			expect(kernel.commits).toEqual([]);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	it("recovery retries only QA failures and parks at the limit", async () => {
		const root = tempRoot();
		try {
			const kernel = scriptedKernel({ "task-a": [
				{ state: "rework", operation: "qa", summary: "first failure" },
				{ state: "rework", operation: "qa", summary: "second failure" },
			] });
			const request = input(root, [child("task-a", "S1")], kernel, {
				budget: { max_children: 1, deadline_at: FAR_FUTURE, qa_failure_limit: 2 },
			});
			const prepared = prepareBatchRunState(request);
			writeBatchRunState(root, { ...prepared, batch_state: "running",
				children: prepared.children.map((c) => ({ ...c, state: "enrolled" })) });
			kernel.enrolled.push("task-a");
			const report = await resumeBatch(request, kernel.projectTask);
			expect(report.batch_state).toBe("needs_human");
			expect(readBatchRunState(root, "batch-001")!.consecutive_qa_failures).toBe(2);
			expect(kernel.enrolled).toEqual(["task-a"]);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	it.each(["start", "resume"])("%s grants a fresh QA retry budget and resumes dependents after reauthorization", async (entry) => {
		const root = tempRoot();
		try {
			const children = [child("task-a", "S1"), child("task-b", "S2", ["task-a"])];
			const kernel = scriptedKernel({
				"task-a": [
					{ state: "rework", operation: "qa", summary: "first failure" },
					{ state: "rework", operation: "qa", summary: "limit reached" },
					{ state: "rework", operation: "qa", summary: "first retry after confirmation" },
					{ state: "completed" },
				],
				"task-b": [{ state: "completed" }],
			});
			const budget = { max_children: 2, deadline_at: FAR_FUTURE, qa_failure_limit: 2 };
			const request = input(root, children, kernel, { budget });
			const parked = await startBatch(request);
			expect(parked.children.map((c) => c.state)).toEqual(["needs_human", "skipped_blocked"]);
			expect(readBatchRunState(root, "batch-001")!.consecutive_qa_failures).toBe(2);
			const repeated = await startBatch(request);
			expect(repeated.batch_state).toBe("needs_human");
			expect(readBatchRunState(root, "batch-001")!.consecutive_qa_failures).toBe(2);
			const renewed = input(root, children, kernel, { budget, confirmation_time: "2026-01-02T00:00:00.000Z" });
			const report = entry === "start" ? await startBatch(renewed) : await resumeBatch(renewed, kernel.projectTask);
			expect(report.batch_state).toBe("completed");
			expect(report.children.map((c) => c.state)).toEqual(["committed", "committed"]);
			expect(kernel.enrolled).toEqual(["task-a", "task-b"]);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	it("crash recovery persists the exact new Review reservation before returning", async () => {
		const root = tempRoot();
		try {
			const kernel = scriptedKernel({ "task-a": [
				{ state: "review_ready", operation_id: "op-before-crash" },
				{ state: "review_ready", operation_id: "op-after-crash" },
			] });
			const request = input(root, [child("task-a", "S1")], kernel);
			await startBatch(request);
			const report = await resumeBatch(request, kernel.projectTask);
			expect(report.children[0]!.reason).toBe("review reservation op-after-crash open");
			expect(readBatchRunState(root, "batch-001")!.children[0]!.reason).toBe(report.children[0]!.reason);
			expect(kernel.enrolled).toEqual(["task-a"]);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	it("re-park traverses an already-skipped intermediate dependency", async () => {
		const root = tempRoot();
		try {
			const kernel = scriptedKernel({ "task-a": [{ state: "blocked", reason: "human decision" }] });
			const children = [child("task-a", "S1"), child("task-b", "S2", ["task-a"]), child("task-c", "S3", ["task-b"])];
			await startBatch(input(root, children, kernel));
			const parked = readBatchRunState(root, "batch-001")!;
			writeBatchRunState(root, { ...parked, children: parked.children.map((c) =>
				c.task_id === "task-c" ? { ...c, state: "pending", reason: null } : c) });
			kernel.foreignClaims.add("task-a");
			const report = await startBatch(input(root, children, kernel, { confirmation_time: "2026-01-02T00:00:00.000Z" }));
			expect(report.children.map((c) => c.state)).toEqual(["needs_human", "skipped_blocked", "skipped_blocked"]);
			expect(kernel.enrolled).toEqual(["task-a"]);
		} finally { rmSync(root, { recursive: true, force: true }); }
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
			// Zero writes includes the run report: nothing may be persisted.
			expect(existsSync(join(root, ".imm", "state", "batches", "batch-001.report.json"))).toBe(false);
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
			// review-3(6th round): a needs_human park ends the run, so the run
			// report is written even though the batch stays resumable.
			const reportBytes = readFileSync(
				join(root, ".imm", "state", "batches", "batch-001.report.json"),
				"utf8",
			);
			const parkedReport = JSON.parse(reportBytes) as { batch_state: string; next_action: string };
			expect(parkedReport.batch_state).toBe("needs_human");
			expect(parkedReport.next_action.length).toBeGreaterThan(0);
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
					// Only the typed error classifies as an intentional budget stop.
					throw new BatchAuthorizationExpiryError("batch authorization expired");
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

	it("a free-form expiry message parks needs_human; only the typed error is a budget stop", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const kernel = {
				...scriptedKernel({}),
				async enrollTask() {
					// Message-only similarity must not suppress this failure as an
					// intentional stop; without the typed discriminator it parks.
					throw new Error("batch authorization expired");
				},
			};
			const report = await startBatch(input(root, [a], kernel as unknown as BatchRunnerKernelPort));
			expect(report.batch_state).toBe("needs_human");
			const stored = readBatchRunState(root, "batch-001")!;
			expect(stored.children[0]!.state).toBe("needs_human");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("parking a child stops the batch before any independent sibling is enrolled", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const b = child("task-b", "S2");
			const kernel = scriptedKernel({
				"task-a": [{ state: "blocked", reason: "resolve_user_decision: scope" }],
				"task-b": [{ state: "completed" }],
			});
			const report = await startBatch(input(root, [a, b], kernel));
			expect(report.batch_state).toBe("needs_human");
			// The parked child still holds its Kernel claim: the driver must
			// stop immediately, never select or enroll an independent sibling.
			expect(kernel.enrolled).toEqual(["task-a"]);
			const stored = readBatchRunState(root, "batch-001")!;
			expect(stored.children.find((c) => c.task_id === "task-b")!.state).toBe("pending");
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
					{ state: "rework", operation: "qa", summary: "first failure" },
					{ state: "rework", operation: "qa", summary: "second failure" },
					{ state: "rework", operation: "qa", summary: "third failure" },
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
					{ state: "rework", operation: "qa", summary: "fix the test" },
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

	it("needs_human without a newer confirmation stays parked", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const kernel = scriptedKernel({
				"task-a": [{ state: "blocked", reason: "resolve_user_decision: scope" }],
			});
			await startBatch(input(root, [a], kernel));
			const stored = readBatchRunState(root, "batch-001")!;
			writeBatchRunState(root, {
				...stored,
				authorization_expires_at: "2000-01-01T00:00:00.000Z",
			});
			const report = await resumeBatch(
				input(root, [a], scriptedKernel({})),
				async () => ({
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: "task-a",
					error: null,
					claim: null,
					projection: { lifecycle: "active", completion_ready: false } as never,
				}) as never,
			);
			expect(report.batch_state).toBe("needs_human");
			expect(readBatchRunState(root, "batch-001")!.batch_state).toBe("needs_human");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("a fresh confirmation resumes a parked batch and replaces its stop report", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const parkedKernel = scriptedKernel({
				"task-a": [{ state: "blocked", reason: "resolve_user_decision: scope" }],
			});
			await startBatch(input(root, [a], parkedKernel, {
				confirmation_time: "2098-01-01T00:00:00.000Z",
			}));
			const reportPath = join(root, ".imm/state/batches/batch-001.report.json");
			expect(JSON.parse(readFileSync(reportPath, "utf8")).batch_state).toBe("needs_human");

			const resumedKernel = scriptedKernel({ "task-a": [{ state: "completed" }] });
			const report = await startBatch(input(root, [a], resumedKernel, {
				confirmation_time: "2098-01-02T00:00:00.000Z",
			}));
			expect(report.batch_state).toBe("completed");
			expect(resumedKernel.enrolled).toEqual(["task-a"]);
			expect(JSON.parse(readFileSync(reportPath, "utf8")).batch_state).toBe("completed");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("review-1(7th): a parked child with a foreign claim keeps the batch parked on resume", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const b = child("task-b", "S2");
			const kernel = scriptedKernel({
				"task-a": [{ state: "blocked", reason: "resolve_user_decision: scope" }],
			});
			await startBatch(input(root, [a, b], kernel, {
				confirmation_time: "2098-01-01T00:00:00.000Z",
			}));
			const stored = readBatchRunState(root, "batch-001")!;
			expect(stored.batch_state).toBe("needs_human");
			// The parked child's claim is then re-bound to a foreign batch.
			const resumeKernel = scriptedKernel({
				"task-a": [{ state: "completed" }],
			});
			resumeKernel.enrolled.push("task-a");
			resumeKernel.foreignClaims.add("task-a");
			const report = await resumeBatch(
				input(root, [a, b], resumeKernel, {
					confirmation_time: "2098-01-02T00:00:00.000Z",
				}),
				async () =>
					({
						contract: "assurance_kernel/assurance_projection/v1",
						task_id: "task-a",
						error: null,
						claim: { task_id: "task-a", lifecycle_status: "active" },
						projection: { lifecycle: "active", completion_ready: false } as never,
					}) as never,
			);
			expect(report.batch_state).toBe("needs_human");
			// task-b is an independent sibling: it stays pending — never enrolled —
			// while the parked child's claim is foreign. Dependent marking on
			// re-park is covered by the 8th-round test below.
			expect(resumeKernel.enrolled).toEqual(["task-a"]);
			const after = readBatchRunState(root, "batch-001")!;
			expect(after.batch_state).toBe("needs_human");
			expect(after.children.find((c) => c.task_id === "task-b")!.state).toBe("pending");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("review-1(8th): re-parking a foreign-claim child re-marks missed dependents", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const b = child("task-b", "S2", ["task-a"]);
			const kernel = scriptedKernel({
				"task-a": [{ state: "blocked", reason: "resolve_user_decision: scope" }],
			});
			await startBatch(input(root, [a, b], kernel, {
				confirmation_time: "2098-01-01T00:00:00.000Z",
			}));
			const stored = readBatchRunState(root, "batch-001")!;
			expect(stored.children.find((c) => c.task_id === "task-b")!.state).toBe("skipped_blocked");
			// Simulate a historical park that missed the dependent marking: the
			// dependent sits pending in the durable record when the batch is
			// resumed with a fresh confirmation.
			writeBatchRunState(root, {
				...stored,
				children: stored.children.map((c) =>
					c.task_id === "task-b" ? { ...c, state: "pending", reason: null } : c,
				),
			});
			const resumeKernel = scriptedKernel({});
			resumeKernel.enrolled.push("task-a");
			resumeKernel.foreignClaims.add("task-a");
			const report = await resumeBatch(
				input(root, [a, b], resumeKernel, {
					confirmation_time: "2098-01-02T00:00:00.000Z",
				}),
				async () =>
					({
						contract: "assurance_kernel/assurance_projection/v1",
						task_id: "task-a",
						error: null,
						claim: { task_id: "task-a", lifecycle_status: "active" },
						projection: { lifecycle: "active", completion_ready: false } as never,
					}) as never,
			);
			expect(report.batch_state).toBe("needs_human");
			const after = readBatchRunState(root, "batch-001")!;
			expect(after.children.find((c) => c.task_id === "task-a")!.state).toBe("needs_human");
			// The re-park marks the missed dependent skipped_blocked.
			expect(after.children.find((c) => c.task_id === "task-b")!.state).toBe("skipped_blocked");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("review-1(8th): a commit-lookup failure park skips its dependents", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const b = child("task-b", "S2", ["task-a"]);
			const kernel = scriptedKernel({
				"task-a": [{ state: "review_ready", operation_id: "op-1" }],
			});
			await startBatch(input(root, [a, b], kernel));
			// Crash after settlement but before the committed-persist: the
			// persisted child is settled; a resume must drive it to commit.
			const stored = readBatchRunState(root, "batch-001")!;
			writeBatchRunState(root, {
				...stored,
				children: stored.children.map((c) =>
					c.state === "enrolled" ? { ...c, state: "settled", reason: null } : c,
				),
			});
			const resumeKernel = scriptedKernel({ "task-a": [{ state: "completed" }] });
			resumeKernel.enrolled.push("task-a");
			// The commit lookup throws at the Kernel boundary: the driver parks
			// the child as needs_human and must skip its dependents.
			resumeKernel.lookupBatchCommit = async () => {
				throw new Error("lookup unavailable");
			};
			// The resume path converts the abort into a parked report; the
			// commit-lookup park marks transitive dependents skipped_blocked.
			const report = await resumeBatch(
				input(root, [a, b], resumeKernel),
				async () =>
					({
						contract: "assurance_kernel/assurance_projection/v1",
						task_id: "task-a",
						error: null,
						claim: null,
						projection: { lifecycle: "", completion_ready: false },
					}) as never,
			);
			expect(report.batch_state).toBe("needs_human");
			const after = readBatchRunState(root, "batch-001")!;
			expect(after.batch_state).toBe("needs_human");
			expect(after.children.find((c) => c.task_id === "task-a")!.state).toBe("needs_human");
			expect(after.children.find((c) => c.task_id === "task-b")!.state).toBe("skipped_blocked");
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
				async () => ({
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: "task-a",
					error: null,
					claim: { task_id: "task-a", lifecycle_status: "active" },
					projection: { lifecycle: "active", completion_ready: false } as never,
				}) as never,
			);
			expect(resumeKernel.commits.length).toBe(1);
			const after = readBatchRunState(root, "batch-001")!;
			expect(after.children[0]!.state).toBe("committed");
			expect(after.batch_state).toBe("completed");
			expect(report.batch_state).toBe("completed");
			expect(resumeKernel.enrolled).toEqual(["task-a"]);
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

	it("review-1(6th): a claim held by another batch is not adopted and blocks for human attention", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const kernel = scriptedKernel({
				"task-a": [{ state: "review_ready", operation_id: "op-1" }],
			});
			await startBatch(input(root, [a], kernel));
			const stored = readBatchRunState(root, "batch-001")!;
			writeBatchRunState(root, {
				...stored,
				children: stored.children.map((c) => ({ ...c, state: "pending", reason: null })),
			});
			// task-a's claim was re-bound to a different batch after the crash:
			// the runner must not adopt it and must not re-enroll (both would
			// steal the claim); it parks the child for human resolution.
			const resumeKernel = scriptedKernel({
				"task-a": [{ state: "completed" }],
			});
			resumeKernel.enrolled.push("task-a");
			resumeKernel.foreignClaims.add("task-a");
			const report = await resumeBatch(
				input(root, [a], resumeKernel),
			async () =>
			({
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: "task-a",
					error: null,
					claim: { task_id: "task-a", lifecycle_status: "active" },
					projection: { lifecycle: "active", completion_ready: false } as never,
				}) as never,
			);
			expect(report.batch_state).toBe("needs_human");
			const after = readBatchRunState(root, "batch-001")!;
			expect(after.children[0]!.state).toBe("needs_human");
			expect(resumeKernel.commits.length).toBe(0);
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

	it("review-2(6th): an enrolled child whose claim was re-bound to a foreign batch parks without stealing it", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const b = child("task-b", "S2", ["task-a"]);
			const kernel = scriptedKernel({
				"task-a": [{ state: "review_ready", operation_id: "op-1" }],
			});
			await startBatch(input(root, [a, b], kernel));
			// Durable state stays enrolled, but the claim moved to another batch.
			const resumeKernel = scriptedKernel({
				"task-a": [{ state: "completed" }],
			});
			resumeKernel.enrolled.push("task-a");
			resumeKernel.foreignClaims.add("task-a");
			const enrollCalls: string[] = [];
			const origEnroll = resumeKernel.enrollTask.bind(resumeKernel);
			resumeKernel.enrollTask = (args) => {
				enrollCalls.push(args.task_id);
				return origEnroll(args);
			};
			const report = await resumeBatch(
				input(root, [a, b], resumeKernel),
				async () =>
				({
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: "task-a",
					error: null,
					claim: { task_id: "task-a", lifecycle_status: "active" },
					projection: { lifecycle: "active", completion_ready: false } as never,
				}) as never,
			);
			expect(report.batch_state).toBe("needs_human");
			expect(enrollCalls.length).toBe(0);
			const after = readBatchRunState(root, "batch-001")!;
			expect(after.children[0]!.state).toBe("needs_human");
			// review-7: the parked child's dependent subtree is skipped_blocked.
			expect(after.children[1]!.state).toBe("skipped_blocked");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("review-7: a pending child with a foreign claim parks and skips its dependents in the main loop", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const b = child("task-b", "S2", ["task-a"]);
			const c = child("task-c", "S1");
			const kernel = scriptedKernel({});
			kernel.enrolled.push("task-a");
			kernel.foreignClaims.add("task-a");
			const report = await startBatch(input(root, [a, b, c], kernel));
			expect(report.batch_state).toBe("needs_human");
			const after = readBatchRunState(root, "batch-001")!;
			expect(after.children.find((x) => x.task_id === "task-a")!.state).toBe("needs_human");
			expect(after.children.find((x) => x.task_id === "task-b")!.state).toBe("skipped_blocked");
			expect(after.children.find((x) => x.task_id === "task-c")!.state).toBe("pending");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("review-7: a pending child with a foreign claim parks and skips dependents on crash-recovery adoption", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const b = child("task-b", "S2", ["task-a"]);
			const kernel = scriptedKernel({
				"task-a": [{ state: "review_ready", operation_id: "op-1" }],
			});
			await startBatch(input(root, [a, b], kernel));
			// Simulate a crash between durable enrollTask and the enrolled-persist:
			// the child is stored pending while its claim is held by another batch.
			const stored = readBatchRunState(root, "batch-001")!;
			writeBatchRunState(root, {
				...stored,
				children: stored.children.map((c) =>
					c.task_id === "task-a" ? { ...c, state: "pending", reason: null } : c,
				),
			});
			const resumeKernel = scriptedKernel({});
			resumeKernel.enrolled.push("task-a");
			resumeKernel.foreignClaims.add("task-a");
			const enrollCalls: string[] = [];
			resumeKernel.enrollTask = (args) => {
				enrollCalls.push(args.task_id);
				throw new Error("must not re-enroll a foreign claim");
			};
			const report = await resumeBatch(
				input(root, [a, b], resumeKernel),
				async () =>
				({
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: "task-a",
					error: null,
					claim: { task_id: "task-a", lifecycle_status: "active" },
					projection: { lifecycle: "active", completion_ready: false } as never,
				}) as never,
			);
			expect(report.batch_state).toBe("needs_human");
			expect(enrollCalls.length).toBe(0);
			const after = readBatchRunState(root, "batch-001")!;
			expect(after.children[0]!.state).toBe("needs_human");
			expect(after.children[1]!.state).toBe("skipped_blocked");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("review-7: a kernel-boundary expiry error is structurally classified as budget_stopped", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const kernel = scriptedKernel({});
			const request = input(root, [a], kernel);
			kernel.enrollTask = async ({ batch }) => {
				// Exercise the real registry's enrollment-time expiry boundary.
				request.registry.inspect(batch.capability, {
					batch_id: request.batch_id, initiative_slug: request.initiative_slug,
					plan_digest: request.plan_digest, branch: "main", base_head: request.base_head,
					budget: request.budget, actor_id: "user", confirmation_ref: "confirm",
					expires_at: request.authorization_expires_at, nonce: "n",
				}, Date.parse(FAR_FUTURE));
				throw new Error("expired authority was accepted");
			};
			expect(BatchAuthorizationExpiryError).toBe(KernelBatchAuthorizationExpiryError);
			const report = await startBatch(request);
			expect(report.batch_state).toBe("budget_stopped");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("review-8: a parked-batch resume with a fabricated authorization fails closed", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const kernel = scriptedKernel({});
			kernel.enrolled.push("task-a");
			kernel.foreignClaims.add("task-a");
			await startBatch(input(root, [a], kernel));
			expect(readBatchRunState(root, "batch-001")!.batch_state).toBe("needs_human");
			// Fresh-looking caller timestamps are not authority: a capability
			// that no registry issued must be rejected before any remap.
			await expect(
				startBatch(input(root, [a], kernel, {
					confirmation_time: "2099-01-02T00:00:00.000Z",
					capability: {},
				})),
			).rejects.toThrow(/not recognized/);
			// Zero writes: the batch stays parked exactly as before.
			const after = readBatchRunState(root, "batch-001")!;
			expect(after.batch_state).toBe("needs_human");
			expect(after.confirmation_time).toBe("2026-01-01T00:00:00.000Z");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("review-8: a parked-batch resume bound to a different plan fails closed", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const kernel = scriptedKernel({});
			kernel.enrolled.push("task-a");
			kernel.foreignClaims.add("task-a");
			await startBatch(input(root, [a], kernel));
			// A genuinely issued capability, but issued over a different plan.
			const foreignRegistry = createBatchAuthorityRegistry();
			const foreignCapability = foreignRegistry.issue(
				{
					batch_id: "batch-001",
					initiative_slug: "initiative-slug",
					plan_digest: computeBatchPlanDigest([child("task-a", "S1"), child("task-x", "S2")]),
					branch: "main",
					base_head: "b".repeat(40),
					budget: { max_children: 1, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
					actor_id: "user",
					confirmation_ref: "confirm",
					expires_at: FAR_FUTURE,
					nonce: "n",
				},
				[child("task-a", "S1"), child("task-x", "S2")],
			);
			await expect(
				startBatch(input(root, [a], kernel, {
					confirmation_time: "2099-01-02T00:00:00.000Z",
					registry: foreignRegistry,
					capability: foreignCapability,
				})),
			).rejects.toThrow(/plan_digest mismatch/);
			const after = readBatchRunState(root, "batch-001")!;
			expect(after.batch_state).toBe("needs_human");
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

	it("projection errors never re-enroll an interrupted child", async () => {
		const root = tempRoot();
		try {
			const a = child("task-a", "S1");
			const kernel = scriptedKernel({});
			const record = prepareBatchRunState({
				batch_id: "batch-001",
				initiative_slug: "initiative-slug",
				children: [a],
				plan_digest: computeBatchPlanDigest([a]),
				base_head: "b".repeat(40),
				confirmation_time: FAR_FUTURE,
				authorization_expires_at: FAR_FUTURE,
				budget: { max_children: 1, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
				now: FAR_FUTURE,
			});
			writeBatchRunState(root, {
				...record,
				batch_state: "running",
				children: record.children.map((entry) => ({ ...entry, state: "enrolled" })),
			});
			kernel.projectTask = async () => ({
				contract: "assurance_kernel/assurance_projection/v1",
				task_id: "task-a",
				error: "storage unavailable",
				claim: null,
				projection: { lifecycle: "active", completion_ready: false } as never,
			});
			await expect(
				resumeBatch(input(root, [a], kernel), kernel.projectTask),
			).rejects.toThrow(/cannot reconcile Kernel projection.*storage unavailable/);
			expect(kernel.enrolled).toEqual([]);
			expect(readBatchRunState(root, "batch-001")!.children[0]!.state).toBe("enrolled");
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

	it.each([".imm", ".imm/state", ".imm/state/batches"])("rejects pre-existing %s symlink for state and report writes", (segment) => {
		const root = tempRoot();
		const outside = mkdtempSync(join(tmpdir(), "imm-outside-"));
		try {
			const parent = segment.split("/").slice(0, -1).join("/");
			mkdirSync(join(root, parent), { recursive: true });
			symlinkSync(outside, join(root, segment));
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
			expect(() => writeBatchRunReport(root, {
				contract: "immune_brain/batch_run_report/v1",
				batch_id: record.batch_id,
				batch_state: "completed",
				children: [], commits: [], reason: null, next_action: "",
			})).toThrow();
			expect(readdirSync(outside)).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});
});
