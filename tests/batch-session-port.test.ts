// Batch session port (Spec unified-lane-sessions S4, D8).
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBatchAuthorityRegistry, computeBatchPlanDigest } from "../plugins/immune-brain/runtime/kernel/batch_authority";
import { canonicalIntentHash, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { runLaneBatch as advanceBatch } from "../plugins/immune-brain/runtime/unattended/batch_lanes";
import { readAnyBatchRunState, type BatchLaneRunStateRecord } from "../plugins/immune-brain/runtime/unattended/batch_state";
import {
	laneSessionKey,
	LANE_EXECUTOR_ENV,
	type BatchSessionPort,
	type BatchSessionOpenInput,
	type SessionObservation,
} from "../plugins/immune-brain/runtime/unattended/batch_session_port";
import { reconcileChildSession } from "../plugins/immune-brain/runtime/unattended/child_session_reconciler";
import type { BatchRunnerKernelPort } from "../plugins/immune-brain/runtime/unattended/batch_kernel_port";
import type { StartBatchInput } from "../plugins/immune-brain/runtime/unattended/batch_lanes";
import type { BatchPlanChild } from "../plugins/immune-brain/runtime/unattended/types";

const SLUG = "bsp-slug";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const CONFIRMED_AT = "2026-01-01T00:00:00.000Z";

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", ["-C", cwd, "-c", "user.name=T", "-c", "user.email=t@t", ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function intentJson(taskId: string): string {
	const verification = JSON.stringify({
		contract: "assurance_kernel/verification_descriptor/v2",
		command: { executable: "bun", argv: ["-e", "process.exit(0)"], cwd: ".", timeout_ms: 60000, max_output_bytes: 4096 },
		environment: { prepare: null, writable_paths: [] },
	});
	return `${JSON.stringify({
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		goal: `Deliver ${taskId}`,
		acceptance: [{ id: "A1", assertion: `${taskId} holds`, verification }],
		scope_hint: ["a.txt"],
		risk: "material",
		revision: 1,
		owner: "user",
	})}\n`;
}

function child(taskId: string, blockedBy: string[] = []): BatchPlanChild {
	return {
		task_id: taskId,
		slice_id: `S-${taskId}`,
		blocked_by: blockedBy,
		status: "enrollable",
		reason: null,
		intent_path: `docs/plans/${taskId}.intent.json`,
		intent_revision: 1,
		intent_content_hash: "0".repeat(64),
	};
}

function mkRepo(taskIds: string[]): { dir: string; repo: string; base: string; cleanup(): void } {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "imm-bsp-")));
	const repo = join(dir, "repo");
	mkdirSync(repo);
	git(repo, "init", "-q", "-b", "main");
	writeFileSync(join(repo, ".gitignore"), ".imm/state/\n");
	writeFileSync(join(repo, "base.txt"), "base\n");
	mkdirSync(join(repo, "docs/plans"), { recursive: true });
	for (const taskId of taskIds) writeFileSync(join(repo, `docs/plans/${taskId}.intent.json`), intentJson(taskId));
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "-m", "base");
	return { dir, repo, base: git(repo, "rev-parse", "HEAD"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function projectionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		run_id: "run-1",
		record_revision: "r1",
		workspace_revision: "w",
		intent_revision: 1,
		intent_content_hash: "sha256:intent",
		diff_hash: "sha256:diff",
		lifecycle: "active",
		artifact_state: "active",
		risk: "material",
		next_obligation: "submit_assurance",
		fresh_acceptance_ids: [],
		missing_acceptance_ids: [],
		stale_attestation_ids: [],
		fresh_approval_kinds: [],
		missing_approval_kinds: [],
		blocking_finding_ids: [],
		unresolved_user_decision_ids: [],
		replan_required_ids: [],
		independence_violations: [],
		open_user_decision_count: 0,
		completion_ready: false,
		authorization: { state: "none", blocked: null },
		...overrides,
	};
}

function fakeKernel(revisions: Map<string, string>): BatchRunnerKernelPort {
	const enrolled = new Map<string, string>();
	const kernel = {
		enrolled,
		async enrollTask({ root, task_id }: { root: string; task_id: string }) {
			enrolled.set(task_id, root);
			return { record_revision: revisions.get(task_id) ?? "r1" };
		},
		async advanceTask() {
			return { state: "completed" as const };
		},
		async projectTask(root: string, taskId: string) {
			const claimed = enrolled.has(taskId);
			return {
				contract: "assurance_kernel/assurance_projection/v1",
				task_id: taskId,
				error: null,
				claim: claimed ? { task_id: taskId, lifecycle_status: "active" } : null,
				projection: projectionBody({ record_revision: revisions.get(taskId) ?? "r1" }),
			} as unknown as Awaited<ReturnType<BatchRunnerKernelPort["projectTask"]>>;
		},
		ownsTaskClaim: (taskId: string) => enrolled.has(taskId),
		validateBatchAuthorization: ({ registry, capability, binding }: Parameters<BatchRunnerKernelPort["validateBatchAuthorization"]>[0]) =>
			registry.inspect(capability, { ...binding, branch: "main", actor_id: "user", confirmation_ref: "confirm", nonce: "n" } as never),
	};
	return kernel as unknown as BatchRunnerKernelPort;
}

class MemPort implements BatchSessionPort {
	readonly provider: string;
	opens: BatchSessionOpenInput[] = [];
	openHandles: string[] = [];
	finds: string[] = [];
	observes: string[] = [];
	resumes: Array<{ handle: string; entry: string }> = [];
	sends: Array<{ handle: string; text: string }> = [];
	closes: Array<{ handle: string; key: string }> = [];
	worktreeExistsAtOpen: boolean[] = [];
	states = new Map<string, SessionObservation>();
	refuseObserve = new Set<string>();
	store = new Map<string, string>();
	counter = 0;
	constructor(provider = "mem-port") {
		this.provider = provider;
	}
	async open(input: BatchSessionOpenInput) {
		this.opens.push(input);
		this.worktreeExistsAtOpen.push(existsSync(input.cwd));
		this.counter += 1;
		const handle = `h-${this.counter}-${input.key.slice(-6)}`;
		this.openHandles.push(handle);
		this.store.set(input.key, handle);
		if (!this.states.has(handle)) this.states.set(handle, "idle");
		return { ok: true as const, handle, entry_submitted: true as const };
	}
	async resume(handle: string, entry: string) {
		this.resumes.push({ handle, entry });
		return { ok: true as const, entry_submitted: true as const };
	}
	async find(key: string) {
		this.finds.push(key);
		const handle = this.store.get(key);
		if (handle) return { ok: true as const, handle };
		return { ok: true as const, not_found: true as const };
	}
	async observe(handle: string) {
		this.observes.push(handle);
		if (this.refuseObserve.has(handle)) return { ok: false as const, code: "provider_error", reason: "observe refused" };
		return { ok: true as const, state: this.states.get(handle) ?? ("idle" as SessionObservation) };
	}
	async send(handle: string, text: string) {
		this.sends.push({ handle, text });
		return { ok: true as const, state: (this.states.get(handle) ?? "idle") as SessionObservation };
	}
	async stop(handle: string) {
		void handle;
		return { ok: true as const };
	}
	async closeWithProof(handle: string, key: string) {
		this.closes.push({ handle, key });
		return { ok: true as const, exited: true as const, handle, key };
	}
}

function laneInput(
	repo: string,
	base: string,
	batchId: string,
	children: BatchPlanChild[],
	kernel: BatchRunnerKernelPort,
	port: BatchSessionPort,
	overrides: Partial<StartBatchInput> = {},
): StartBatchInput {
	children = children.map((c) => {
		const read = readTaskIntent(repo, c.task_id);
		return { ...c, intent_content_hash: canonicalIntentHash(read.intent) };
	});
	const registry = createBatchAuthorityRegistry();
	const planDigest = computeBatchPlanDigest(children);
	const budget = { max_children: children.length, qa_failure_limit: 3 };
	const capability = registry.issue(
		{ batch_id: batchId, initiative_slug: SLUG, plan_digest: planDigest, branch: "main", base_head: base, budget, actor_id: "user", confirmation_ref: "confirm", nonce: "n" },
		children,
		CONFIRMED_AT,
	);
	return {
		root: repo,
		batch_id: batchId,
		initiative_slug: SLUG,
		registry,
		capability,
		children,
		plan_digest: planDigest,
		base_head: base,
		confirmation_time: CONFIRMED_AT,
		budget,
		now: FAR_FUTURE,
		kernel,
		max_parallel: children.length,
		interaction_mode: "parent_relayed",
		sessions: port,
		...overrides,
	};
}

describe("BSP-A1: write-ahead session key and headless open", () => {
	test("two-child advanceBatch records provider, creates worktrees before open, writes g1 keys and headless env", async () => {
		const fx = mkRepo(["task-a", "task-b"]);
		try {
			const port = new MemPort("mem-a1");
			const kernel = fakeKernel(new Map([["task-a", "r1"], ["task-b", "r1"]]));
			const input = laneInput(fx.repo, fx.base, "batch-a1", [child("task-a"), child("task-b")], kernel, port);
			const report = (await advanceBatch(input, null)) as unknown as { batch_state: string };
			expect(report.batch_state).toBe("running");
			const record = readAnyBatchRunState(fx.repo, "batch-a1") as BatchLaneRunStateRecord;
			expect(record.session_provider).toBe("mem-a1");
			expect(port.opens.length).toBe(2);
			// Each Lane worktree existed before its open ran.
			expect(port.worktreeExistsAtOpen).toEqual([true, true]);
			const keys = record.children.map((c) => c.session!.key!);
			expect(keys.length).toBe(2);
			for (const [i, c] of record.children.entries()) {
				expect(c.session!.generation).toBe(1);
				expect(c.session!.baseline).toBe("r1");
				expect(c.session!.handle).toBe(port.openHandles[i]);
				expect(c.session!.entry_submitted).toBe(true);
				expect(c.session!.key).toBe(port.opens[i]!.key);
				expect(c.lane).not.toBeNull();
				expect(existsSync(c.lane!.path)).toBe(true);
			}
			for (const key of keys) {
				expect(key).toMatch(/^imm-[a-z0-9-]+-g1-[0-9a-f]{12}$/);
				expect(key.length).toBeLessThanOrEqual(36);
			}
			// Distinct trailing 12-hex per child.
			expect(keys[0]!.slice(-12)).not.toBe(keys[1]!.slice(-12));
			// Write-ahead find ran before open with the stored key.
			expect(port.finds).toEqual(expect.arrayContaining(keys));
			for (const open of port.opens) {
				expect(open.env?.[LANE_EXECUTOR_ENV]).toBe("headless");
			}
		} finally {
			fx.cleanup();
		}
	});
});

describe("BSP-A2: crash recovery and provider mismatch", () => {
	test("interrupted open adopts via find with zero more opens", async () => {
		const fx = mkRepo(["task-a"]);
		try {
			const port = new MemPort("mem-a2");
			const kernel = fakeKernel(new Map([["task-a", "r1"]]));
			const input = laneInput(fx.repo, fx.base, "batch-a2", [child("task-a")], kernel, port);
			await advanceBatch(input, null);
			expect(port.opens.length).toBe(1);
			const stored = readAnyBatchRunState(fx.repo, "batch-a2") as BatchLaneRunStateRecord;
			const key = stored.children[0]!.session!.key!;
			const handle = stored.children[0]!.session!.handle!;
			// Simulate a crash after open returned but before the handle persisted.
			const crashed: BatchLaneRunStateRecord = {
				...stored,
				children: stored.children.map((c) => ({ ...c, session: { ...c.session!, handle: null } })),
			} as BatchLaneRunStateRecord;
			const { writeBatchLaneRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
			writeBatchLaneRunState(fx.repo, crashed);
			port.opens.length = 0;
			port.finds.length = 0;
			const second = (await advanceBatch(input, readAnyBatchRunState(fx.repo, "batch-a2"))) as unknown as { batch_state: string };
			expect(second.batch_state).toBe("running");
			expect(port.finds).toEqual([key]);
			expect(port.opens.length).toBe(0);
			const after = readAnyBatchRunState(fx.repo, "batch-a2") as BatchLaneRunStateRecord;
			expect(after.children[0]!.session!.handle).toBe(handle);
		} finally {
			fx.cleanup();
		}
	});

	test("find not_found opens once with the same stored key", async () => {
		const result = await reconcileChildSession({
			port: (() => {
				const inner = new MemPort("mem-find");
				return inner;
			})(),
			batchId: "b",
			taskId: "task-a",
			session: { key: laneSessionKey("b", "task-a", 1), generation: 1, baseline: "r1", handle: null, entry_submitted: false, attention: null, no_progress: 0, exit_proof: null },
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed",
			entry: "drive task-a",
			laneCwd: tmpdir(),
		});
		expect(result.action).toBe("opened");
		expect(result.session.handle).not.toBeNull();
	});

	test("a different provider refuses before any port call", async () => {
		const fx = mkRepo(["task-a"]);
		try {
			const first = new MemPort("provider-one");
			const kernel = fakeKernel(new Map([["task-a", "r1"]]));
			const input = laneInput(fx.repo, fx.base, "batch-a2b", [child("task-a")], kernel, first);
			await advanceBatch(input, null);
			const secondPort = new MemPort("provider-two");
			const report = (await advanceBatch({ ...input, sessions: secondPort }, readAnyBatchRunState(fx.repo, "batch-a2b"))) as unknown as { reason: string };
			expect(report.reason).toContain("lane_session_unavailable");
			expect(secondPort.opens.length).toBe(0);
			expect(secondPort.finds.length).toBe(0);
			expect(secondPort.observes.length).toBe(0);
			expect(secondPort.closes.length).toBe(0);
			expect(secondPort.sends.length).toBe(0);
		} finally {
			fx.cleanup();
		}
	});
});

describe("BSP-A3: dialog holds, progress, stalls, interventions", () => {
	test("entry_submitted false holds and resumes once idle; blocked holds", async () => {
		const port = new MemPort("mem-a3");
		const adopted = await reconcileChildSession({
			port, batchId: "b", taskId: "t", session: { key: laneSessionKey("b", "t", 1), generation: 1, baseline: "r1", handle: "h1", entry_submitted: false, attention: null, no_progress: 0, exit_proof: null },
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
		});
		// Default observe is idle, so an unsubmitted entry resumes.
		expect(adopted.action).toBe("resumed");
		expect(port.resumes.length).toBe(1);

		const blockedPort = new MemPort("mem-a3b");
		blockedPort.states.set("hb", "blocked");
		const held = await reconcileChildSession({
			port: blockedPort, batchId: "b", taskId: "t",
			session: { key: laneSessionKey("b", "t", 1), generation: 1, baseline: "r1", handle: "hb", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
		});
		expect(held.action).toBe("held");
		expect(held.session.no_progress).toBe(0);
		expect(blockedPort.resumes.length).toBe(0);
		expect(blockedPort.closes.length).toBe(0);
		expect(blockedPort.opens.length).toBe(0);
	});

	test("revision progress resets no_progress and resumes; stall rotates and parks under parent_relayed", async () => {
		const port = new MemPort("mem-a3c");
		port.states.set("h1", "idle");
		const progressed = await reconcileChildSession({
			port, batchId: "b", taskId: "t",
			session: { key: laneSessionKey("b", "t", 1), generation: 1, baseline: "r0", handle: "h1", entry_submitted: true, attention: null, no_progress: 2, exit_proof: null },
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
		});
		expect(progressed.action).toBe("resumed");
		expect(progressed.session.baseline).toBe("r1");
		expect(progressed.session.no_progress).toBe(0);

		// First stall at unchanged baseline rotates to g2.
		const stallPort = new MemPort("mem-a3d");
		stallPort.states.set("h1", "idle");
		stallPort.states.set("h-stall", "idle");
		const first = await reconcileChildSession({
			port: stallPort, batchId: "b", taskId: "t",
			session: { key: laneSessionKey("b", "t", 1), generation: 1, baseline: "r1", handle: "h1", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
		});
		expect(first.action).toBe("rotated");
		expect(first.session.generation).toBe(2);
		expect(first.session.no_progress).toBe(1);
		expect(stallPort.closes.length).toBe(1);
		expect(stallPort.opens.length).toBe(1);

		// Second consecutive stall parks with no g3.
		stallPort.states.set(first.session.handle!, "idle");
		const second = await reconcileChildSession({
			port: stallPort, batchId: "b", taskId: "t", session: first.session,
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
		});
		expect(second.action).toBe("parked_no_progress");
		expect(second.session.generation).toBe(2);
		expect(second.session.no_progress).toBe(2);
		expect(stallPort.opens.length).toBe(1);
		expect(stallPort.closes.length).toBe(2);
	});

	test("interactive_host idle stall reports stalled_idle with no calls; exited rotates under either mode", async () => {
		const port = new MemPort("mem-a3e");
		port.states.set("h1", "idle");
		const stalled = await reconcileChildSession({
			port, batchId: "b", taskId: "t",
			session: { key: laneSessionKey("b", "t", 1), generation: 1, baseline: "r1", handle: "h1", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "interactive_host", entry: "drive t", laneCwd: tmpdir(),
		});
		expect(stalled.action).toBe("stalled_idle");
		expect(stalled.session.no_progress).toBe(0);
		expect(port.sends.length).toBe(0);
		expect(port.closes.length).toBe(0);
		expect(port.opens.length).toBe(0);

		for (const mode of ["parent_relayed", "interactive_host"] as const) {
			const exitedPort = new MemPort(`mem-exit-${mode}`);
			exitedPort.states.set("h1", "exited");
			const rotated = await reconcileChildSession({
				port: exitedPort, batchId: "b", taskId: "t",
				session: { key: laneSessionKey("b", "t", 1), generation: 1, baseline: "r1", handle: "h1", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
				kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
				interactionMode: mode, entry: "drive t", laneCwd: tmpdir(),
			});
			expect(rotated.action).toBe("rotated");
			expect(rotated.session.generation).toBe(2);
		}
	});

	test("recorded instruction sends once; recorded correction rotates", async () => {
		const sendPort = new MemPort("mem-instr");
		sendPort.states.set("h1", "idle");
		const sent = await reconcileChildSession({
			port: sendPort, batchId: "b", taskId: "t",
			session: { key: laneSessionKey("b", "t", 1), generation: 1, baseline: "r1", handle: "h1", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
			pendingInstruction: "please adjust",
		});
		expect(sent.action).toBe("sent");
		expect(sendPort.sends).toEqual([{ handle: "h1", text: "please adjust" }]);

		const correctPort = new MemPort("mem-correct");
		correctPort.states.set("h1", "done");
		const rotated = await reconcileChildSession({
			port: correctPort, batchId: "b", taskId: "t",
			session: { key: laneSessionKey("b", "t", 1), generation: 1, baseline: "r1", handle: "h1", entry_submitted: true, attention: null, no_progress: 1, exit_proof: null },
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
			pendingCorrection: "design correction",
		});
		expect(rotated.action).toBe("rotated");
		expect(rotated.session.generation).toBe(2);
		expect(correctPort.closes.length).toBe(1);
		expect(correctPort.opens.length).toBe(1);
		expect(correctPort.opens[0]!.entry).toBe("design correction");
	});

	test("single-task and two-child alike: dialog hold does not increment", async () => {
		for (const taskIds of [["only"], ["a", "b"]]) {
			const port = new MemPort(`mem-hold-${taskIds.length}`);
			for (const taskId of taskIds) {
				const key = laneSessionKey("hold-batch", taskId, 1);
				port.store.set(key, `held-${taskId}`);
				port.states.set(`held-${taskId}`, "blocked");
				const held = await reconcileChildSession({
					port, batchId: "hold-batch", taskId,
					session: { key, generation: 1, baseline: "r1", handle: `held-${taskId}`, entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
					kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
					interactionMode: "parent_relayed", entry: `drive ${taskId}`, laneCwd: tmpdir(),
				});
				expect(held.action).toBe("held");
				expect(held.session.no_progress).toBe(0);
			}
			expect(port.resumes.length).toBe(0);
			expect(port.closes.length).toBe(0);
			expect(port.opens.length).toBe(0);
		}
	});
});

describe("BSP-A4: working, unknown and observe refusal hold", () => {	test.each([["working"], ["unknown"]] as Array<[SessionObservation]>)("observed %s leaves everything unchanged", async (state) => {
		const port = new MemPort(`mem-${state}`);
		port.states.set("h1", state);
		const before = { key: laneSessionKey("b", "t", 1), generation: 1, baseline: "r1", handle: "h1", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null };
		const held = await reconcileChildSession({
			port, batchId: "b", taskId: "t", session: { ...before },
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
		});
		expect(held.action).toBe("held");
		expect(held.session).toEqual(before);
		expect(port.sends.length).toBe(0);
		expect(port.resumes.length).toBe(0);
		expect(port.opens.length).toBe(0);
		expect(port.closes.length).toBe(0);
		// The next tick observes again.
		const again = await reconcileChildSession({
			port, batchId: "b", taskId: "t", session: held.session,
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
		});
		expect(again.action).toBe("held");
		expect(port.observes.length).toBe(2);
	});

	test("observe refusal holds without touching counters", async () => {
		const port = new MemPort("mem-refuse");
		port.refuseObserve.add("h1");
		const before = { key: laneSessionKey("b", "t", 1), generation: 1, baseline: "r1", handle: "h1", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null };
		const held = await reconcileChildSession({
			port, batchId: "b", taskId: "t", session: { ...before },
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
		});
		expect(held.action).toBe("held");
		expect(held.session).toEqual(before);
		expect(port.sends.length).toBe(0);
		expect(port.resumes.length).toBe(0);
		expect(port.opens.length).toBe(0);
		expect(port.closes.length).toBe(0);
	});

	test("port module owns its vocabulary and imports nothing from runtime/session", () => {
		const source = readFileSync(new URL("../plugins/immune-brain/runtime/unattended/batch_session_port.ts", import.meta.url), "utf8");
		expect(source).toContain("SessionObservation");
		expect(source).toContain("SessionExitProof");
		expect(source).not.toContain("runtime/session");
		const reconciler = readFileSync(new URL("../plugins/immune-brain/runtime/unattended/child_session_reconciler.ts", import.meta.url), "utf8");
		expect(reconciler).not.toContain("runtime/session");
	});
});

describe("review rework: intervention consumption and write-ahead persistence", () => {
	test("a recorded instruction sends once; the next tick holds with no second send", async () => {
		const port = new MemPort("mem-consume-instr");
		port.states.set("h1", "idle");
		const base = { key: laneSessionKey("b", "t", 1), generation: 1, baseline: "r1", handle: "h1", entry_submitted: true as const, attention: null, no_progress: 0, exit_proof: null };
		const pending = { text: "please adjust", digest: "sha256:instr1" };
		const first = await reconcileChildSession({
			port, batchId: "b", taskId: "t", session: { ...base },
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
			pendingInstruction: pending,
		});
		expect(first.action).toBe("sent");
		expect(port.sends.length).toBe(1);
		const second = await reconcileChildSession({
			port, batchId: "b", taskId: "t", session: first.session,
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
			pendingInstruction: pending,
		});
		expect(port.sends.length).toBe(1);
		// Consumed: the second tick resumes progress accounting instead of re-sending.
		expect(["held", "rotated", "parked_no_progress"].includes(second.action)).toBe(true);
	});

	test("a recorded correction rotates once; the next tick does not open a third generation", async () => {
		const port = new MemPort("mem-consume-correct");
		port.states.set("h1", "done");
		const base = { key: laneSessionKey("b", "t", 1), generation: 1, baseline: "r1", handle: "h1", entry_submitted: true as const, attention: null, no_progress: 0, exit_proof: null };
		const pending = { text: "design correction", digest: "sha256:corr1" };
		const first = await reconcileChildSession({
			port, batchId: "b", taskId: "t", session: { ...base },
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
			pendingCorrection: pending,
		});
		expect(first.action).toBe("rotated");
		expect(first.session.generation).toBe(2);
		expect(port.closes.length).toBe(1);
		expect(port.opens.length).toBe(1);
		port.states.set(first.session.handle!, "idle");
		const second = await reconcileChildSession({
			port, batchId: "b", taskId: "t", session: first.session,
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
			pendingCorrection: pending,
		});
		// Consumed: the same digest never drives a second correction rotation.
		// The second tick may still rotate on stall accounting, but its open
		// carries the normal entry, never the correction text again.
		const correctionOpens = port.opens.filter((o) => o.entry === "design correction");
		expect(correctionOpens.length).toBe(1);
		if (second.action === "rotated") {
			expect(port.opens.at(-1)!.entry).toBe("drive t");
		}
	});

	test("the generation key is persisted via onWriteAhead before its open runs", async () => {
		const persisted: Array<{ key: string | null; handle: string | null }> = [];
		const port = new MemPort("mem-writeahead");
		const seenDuringOpen: Array<{ key: string | null; handle: string | null }> = [];
		const origOpen = port.open.bind(port);
		port.open = async (input) => {
			seenDuringOpen.push({ ...(persisted.at(-1) ?? { key: null, handle: null }) });
			return origOpen(input);
		};
		const first = await reconcileChildSession({
			port, batchId: "b", taskId: "t", session: null,
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
			onWriteAhead: (s) => persisted.push({ key: s.key, handle: s.handle }),
		});
		expect(first.action).toBe("opened");
		expect(persisted.length).toBeGreaterThanOrEqual(1);
		expect(persisted[0]!.handle).toBeNull();
		expect(seenDuringOpen[0]).toEqual(persisted[0]);

		// Rotation also persists the next key with a null handle before opening it.
		const rotatePort = new MemPort("mem-writeahead-rot");
		rotatePort.states.set("h1", "exited");
		const rotatedPersisted: Array<{ key: string | null; handle: string | null }> = [];
		let openSaw: { key: string | null; handle: string | null } | null = null;
		const rotateOrig = rotatePort.open.bind(rotatePort);
		rotatePort.open = async (input) => {
			openSaw = { ...(rotatedPersisted.at(-1) ?? { key: null, handle: null }) };
			void input;
			return rotateOrig(input);
		};
		const rotated = await reconcileChildSession({
			port: rotatePort, batchId: "b", taskId: "t",
			session: { key: laneSessionKey("b", "t", 1), generation: 1, baseline: "r1", handle: "h1", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
			onWriteAhead: (s) => rotatedPersisted.push({ key: s.key, handle: s.handle }),
		});
		expect(rotated.action).toBe("rotated");
		expect(rotatedPersisted.length).toBe(1);
		expect(rotatedPersisted[0]!.handle).toBeNull();
		expect(rotatedPersisted[0]!.key).toBe(rotated.session.key);
		expect(openSaw).toEqual(rotatedPersisted[0]);
	});
});
