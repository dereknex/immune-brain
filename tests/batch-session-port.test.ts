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
	laneSessionLabel,
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
	host: string | undefined;
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
	refuseOpen: string | null = null;
	store = new Map<string, string>();
	counter = 0;
	constructor(provider = "mem-port") {
		this.provider = provider;
	}
	async open(input: BatchSessionOpenInput) {
		this.opens.push(input);
		this.worktreeExistsAtOpen.push(existsSync(input.cwd));
		if (this.refuseOpen) return { ok: false as const, code: "invalid_input", reason: this.refuseOpen };
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
	/** The supervised-port capability the adapter delegates `find` to. */
	async findSession(key: string) {
		return this.find(key);
	}
	/** The supervised-port capability the adapter delegates `closeWithProof` to. */
	async closeSession(handle: string, _record: unknown) {
		void _record;
		return { ok: true as const };
	}
	async closeWithProof(handle: string, key: string) {
		return this.closeWithProofBatch(handle, key);
	}
	// Supervised-port vocabulary the adapter expects from a real provider.
	readonly protocolVersion = 1;
	async probe() { return { ok: true as const }; }
	async createSession(input: { cwd: string; label: string; host: unknown; hostArgs: string[]; entry: string; session_key?: string; env?: Record<string, string> }) {
		const opened = await this.open({ key: input.session_key ?? "k", cwd: input.cwd, label: input.label, entry: input.entry, env: input.env });
		if (!opened.ok) return opened;
		return { ok: true as const, handle: opened.handle, entry_submitted: true as const, state: "idle" as const, provenance: "detected" as const };
	}
	async sendInstruction(handle: string, text: string) { return this.send(handle, text).then(r => r.ok ? { ok: true as const, state: r.state, provenance: "detected" as const } : r); }
	async awaitTransition(handle: string) { return { ok: true as const, transition: "changed" as const, state: "idle" as const, provenance: "detected" as const }; }
	async readOutput(handle: string) { void handle; return { ok: true as const, text: "", source: "visible" as const }; }
	async observeState(handle: string) { const r = await this.observe(handle); return r.ok ? { ok: true as const, state: r.state, provenance: "detected" as const } : r; }
	async stopSession(handle: string) { return this.stop(handle); }
	async reconcile(owned: string[]) { void owned; return { ok: true as const, sessions: [] as never[] }; }
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
	async closeWithProofBatch(handle: string, key: string) {
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

describe("BSP-A5: bounded label and a surfaced open rejection", () => {
	test("bounds an over-long task id to the port's label contract and keeps a short one", () => {
		const long = "uls-final-repair-64e79ff5-unattended-lane-child";
		const label = laneSessionLabel(long);
		expect(label.length).toBeLessThanOrEqual(32);
		expect(label).not.toBe(laneSessionLabel(`${long}-2`));
		expect(laneSessionLabel("task-a")).toBe("task-a");
		expect(laneSessionLabel(long)).toBe(laneSessionLabel(long));
	});

	test("a first open refusal keeps the child enrolled and names the provider's reason; the second parks it", async () => {
		const port = new MemPort("mem-open-refused");
		port.refuseOpen = "label must be 1 to 32 characters";
		const refused = await reconcileChildSession({
			port, batchId: "b", taskId: "task-a", session: null,
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive task-a", laneCwd: tmpdir(),
		});
		expect(port.opens.map(input => input.label)).toEqual(["task-a"]);
		expect(refused.session.handle).toBeNull();
		expect(refused.action).toBe("open_refused");
		expect(refused.parkedReason).toContain("label must be 1 to 32 characters");

		// Through the batch the first refusal keeps the child enrolled; the second parks it.
		const fx = mkRepo(["task-a"]);
		try {
			const kernel = fakeKernel(new Map([["task-a", "r1"]]));
			const input = laneInput(fx.repo, fx.base, "batch-a5", [child("task-a")], kernel, port);
			const first = (await advanceBatch(input, null)) as unknown as { batch_state: string; children: Array<{ state: string; reason: string | null }> };
			expect(first.batch_state).toBe("running");
			expect(first.children[0]!.state).toBe("enrolled");
			const second = (await advanceBatch(input, readAnyBatchRunState(fx.repo, "batch-a5"))) as unknown as { batch_state: string; children: Array<{ state: string; reason: string | null }> };
			expect(second.batch_state).toBe("needs_human");
			expect(second.children[0]!.state).toBe("needs_human");
			expect(second.children[0]!.reason).toContain("lane_session_open_rejected: label must be 1 to 32 characters");
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

describe("S3b: an error stop recovers in a fresh generation, bounded per Kernel revision", () => {
	const kernelAt = (recordRevision: string, extra: Partial<{ settled: boolean; hasOpenDecision: boolean; hasReplan: boolean }> = {}) =>
		({ recordRevision, settled: false, hasOpenDecision: false, hasReplan: false, ...extra });
	const errored = (port: MemPort, handle: string) => port.states.set(handle, "error");

	test("rotates twice at one revision, parks on the third error, and counts again after Kernel progress", async () => {
		const port = new MemPort("mem-error");
		errored(port, "h1");
		const start = { key: laneSessionKey("b", "t", 1), generation: 1, baseline: "r1", handle: "h1", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null };
		const writes: unknown[] = [];
		const first = await reconcileChildSession({ port, batchId: "b", taskId: "t", session: start, kernel: kernelAt("r1"), interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(), onWriteAhead: s => writes.push(s) });
		expect(first.action).toBe("recovered_error");
		expect(first.session.generation).toBe(2);
		expect(first.session.error_recoveries).toEqual({ baseline: "r1", count: 1 });
		expect(first.session.attention).toBeNull();
		expect(port.closes).toEqual([{ handle: "h1", key: start.key }]);
		expect(port.opens.map(o => o.entry)).toEqual(["drive t"]);
		expect(writes.length).toBe(1);

		errored(port, first.session.handle!);
		const second = await reconcileChildSession({ port, batchId: "b", taskId: "t", session: first.session, kernel: kernelAt("r1"), interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir() });
		expect(second.action).toBe("recovered_error");
		expect(second.session.error_recoveries).toEqual({ baseline: "r1", count: 2 });

		errored(port, second.session.handle!);
		const third = await reconcileChildSession({ port, batchId: "b", taskId: "t", session: second.session, kernel: kernelAt("r1"), interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir() });
		expect(third.action).toBe("parked_error");
		expect(third.parkedReason).toBe("lane_executor_error");
		expect(third.session.attention).toBe("error");
		expect(port.opens.length).toBe(2);
		expect(port.closes.length).toBe(2);

		const progressed = await reconcileChildSession({ port, batchId: "b", taskId: "t", session: second.session, kernel: kernelAt("r2"), interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir() });
		expect(progressed.action).toBe("recovered_error");
		expect(progressed.session.error_recoveries).toEqual({ baseline: "r2", count: 1 });
		expect(progressed.session.baseline).toBe("r2");
	});

	test("a generation opened for a correction recovers with the correction text", async () => {
		const port = new MemPort("mem-error-correction");
		errored(port, "h1");
		const corrected = await reconcileChildSession({ port, batchId: "b", taskId: "t",
			session: { key: laneSessionKey("b", "t", 1), generation: 1, baseline: "r1", handle: "h0", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
			kernel: kernelAt("r1"), interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(), pendingCorrection: "design correction" });
		port.states.set("h0", "idle");
		const rotated = corrected.session.handle ? corrected : await reconcileChildSession({ port, batchId: "b", taskId: "t", session: corrected.session,
			kernel: kernelAt("r1"), interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(), pendingCorrection: "design correction" });
		errored(port, rotated.session.handle!);
		const recovered = await reconcileChildSession({ port, batchId: "b", taskId: "t", session: rotated.session,
			kernel: kernelAt("r1"), interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(), pendingCorrection: "design correction" });
		expect(recovered.action).toBe("recovered_error");
		expect(port.opens.at(-1)!.entry).toBe("design correction");
	});

	test.each([["settled", { settled: true }], ["an open decision", { hasOpenDecision: true }], ["a replan", { hasReplan: true }]] as const)(
		"holds a child with %s on error, flags attention, and never recovers it",
		async (_label, extra) => {
			const port = new MemPort("mem-error-hold");
			errored(port, "h1");
			const result = await reconcileChildSession({
				port, batchId: "b", taskId: "t",
				session: { key: laneSessionKey("b", "t", 1), generation: 1, baseline: "r1", handle: "h1", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
				kernel: kernelAt("r1", extra), interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
			});
			expect(result.action).toBe("held");
			expect(result.session.attention).toBe("error");
			expect(port.closes.length).toBe(0);
			expect(port.opens.length).toBe(0);
			expect(port.sends.length).toBe(0);
		},
	);

	test("through the batch the recovery count persists and the third error at one revision parks the child", async () => {
		const port = new MemPort("mem-error-batch");
		const fx = mkRepo(["task-a"]);
		try {
			const kernel = fakeKernel(new Map([["task-a", "r1"]]));
			const input = laneInput(fx.repo, fx.base, "batch-s3b", [child("task-a")], kernel, port);
			await advanceBatch(input, null);
			for (const count of [1, 2]) {
				errored(port, port.openHandles.at(-1)!);
				await advanceBatch(input, readAnyBatchRunState(fx.repo, "batch-s3b"));
				const stored = readAnyBatchRunState(fx.repo, "batch-s3b") as BatchLaneRunStateRecord;
				expect(stored.children[0]!.session?.error_recoveries).toEqual({ baseline: "r1", count });
			}
			errored(port, port.openHandles.at(-1)!);
			const parked = (await advanceBatch(input, readAnyBatchRunState(fx.repo, "batch-s3b"))) as unknown as { batch_state: string; children: Array<{ state: string; reason: string | null }> };
			expect(parked.batch_state).toBe("needs_human");
			expect(parked.children[0]!.state).toBe("needs_human");
			expect(parked.children[0]!.reason).toContain("lane_executor_error");
			expect(port.opens.length).toBe(3);
		} finally {
			fx.cleanup();
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

describe("review rework: adoption, attention, refusals and exited corrections", () => {
	test("adopting a crashed open restores only the handle and resumes the unsubmitted entry", async () => {
		const port = new MemPort("mem-adopt-resume");
		const key = laneSessionKey("b", "t", 1);
		port.store.set(key, "h-crashed");
		port.states.set("h-crashed", "idle");
		const adopted = await reconcileChildSession({
			port, batchId: "b", taskId: "t",
			session: { key, generation: 1, baseline: "r1", handle: null, entry_submitted: false, attention: null, no_progress: 0, exit_proof: null },
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
		});
		expect(adopted.action).toBe("resumed");
		expect(adopted.session.handle).toBe("h-crashed");
		expect(adopted.session.entry_submitted).toBe(true);
		expect(port.opens.length).toBe(0);
		expect(port.resumes).toEqual([{ handle: "h-crashed", entry: "drive t" }]);
	});

	test("an observed mid-run blocked writes attention, and the next non-blocked observation clears it", async () => {
		const port = new MemPort("mem-attention");
		port.states.set("h1", "blocked");
		const base = { key: laneSessionKey("b", "t", 1), generation: 1, baseline: "r1", handle: "h1", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null };
		const held = await reconcileChildSession({
			port, batchId: "b", taskId: "t", session: { ...base },
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
		});
		expect(held.action).toBe("held");
		expect(held.session.attention).toBe("blocked");
		port.states.set("h1", "working");
		const cleared = await reconcileChildSession({
			port, batchId: "b", taskId: "t", session: held.session,
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
		});
		expect(cleared.action).toBe("held");
		expect(cleared.session.attention).toBeNull();
		// A successful resume clears it too.
		port.states.set("h1", "blocked");
		const again = await reconcileChildSession({
			port, batchId: "b", taskId: "t", session: cleared.session,
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
		});
		expect(again.session.attention).toBe("blocked");
		port.states.set("h1", "idle");
		const resumed = await reconcileChildSession({
			port, batchId: "b", taskId: "t", session: again.session,
			kernel: { recordRevision: "r2", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
		});
		expect(resumed.action).toBe("resumed");
		expect(resumed.session.attention).toBeNull();
	});

	test("an exited child with an unprocessed correction rotates to a generation whose entry is the correction", async () => {
		const port = new MemPort("mem-exited-correction");
		port.states.set("h1", "exited");
		const pending = { text: "design correction", digest: "sha256:corr-exit" };
		const rotated = await reconcileChildSession({
			port, batchId: "b", taskId: "t",
			session: { key: laneSessionKey("b", "t", 1), generation: 1, baseline: "r1", handle: "h1", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
			pendingCorrection: pending,
		});
		expect(rotated.action).toBe("rotated");
		expect(rotated.session.generation).toBe(2);
		expect(rotated.session.no_progress).toBe(0);
		expect(rotated.session.handled_interventions).toEqual([pending.digest]);
		expect(port.opens.map((o) => o.entry)).toEqual(["design correction"]);
	});

	test("a first open refusal keeps the child enrolled and retries; the second parks it", async () => {
		const port = new MemPort("mem-two-refusals");
		port.refuseOpen = "provider is busy";
		const kernel = { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false };
		const first = await reconcileChildSession({
			port, batchId: "b", taskId: "t", session: null, kernel,
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
		});
		expect(first.action).toBe("open_refused");
		expect(first.session.handle).toBeNull();
		expect(first.session.open_refusals).toBe(1);
		expect(first.parkedReason).toContain("provider is busy");
		const second = await reconcileChildSession({
			port, batchId: "b", taskId: "t", session: first.session, kernel,
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
		});
		expect(second.action).toBe("parked_open_rejected");
		expect(second.session.open_refusals).toBe(2);
		expect(port.opens.length).toBe(2);
		expect(port.finds.length).toBe(2);
		// A later successful open resets the counter.
		port.refuseOpen = null;
		const third = await reconcileChildSession({
			port, batchId: "b", taskId: "t", session: { ...first.session }, kernel,
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
		});
		expect(third.action).toBe("opened");
		expect(third.session.open_refusals).toBe(0);
	});

	test("a refused correction open retries with the correction text, not the default entry", async () => {
		const port = new MemPort("mem-correction-retry");
		port.states.set("h1", "idle");
		port.refuseOpen = "provider is busy";
		const pending = { text: "design correction", digest: "sha256:corr-retry" };
		const kernel = { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false };
		const first = await reconcileChildSession({
			port, batchId: "b", taskId: "t",
			session: { key: laneSessionKey("b", "t", 1), generation: 1, baseline: "r1", handle: "h1", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
			kernel, interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
			pendingCorrection: pending,
		});
		expect(first.action).toBe("open_refused");
		expect(first.session.handle).toBeNull();
		expect(first.session.handled_interventions).toEqual([pending.digest]);
		port.refuseOpen = null;
		const retried = await reconcileChildSession({
			port, batchId: "b", taskId: "t", session: first.session, kernel,
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
			pendingCorrection: pending,
		});
		expect(retried.action).toBe("opened");
		expect(retried.session.generation).toBe(2);
		expect(port.opens.map((opened) => opened.entry)).toEqual(["design correction", "design correction"]);
	});

	test("a newer confirmation_time does not clear an open refusal; a literal-user re-entry does", async () => {
		const fx = mkRepo(["task-a"]);
		try {
			const port = new MemPort("mem-resume-refusal");
			port.refuseOpen = "provider is busy";
			const kernel = fakeKernel(new Map([["task-a", "r1"]]));
			const input = laneInput(fx.repo, fx.base, "batch-resume-refusal", [child("task-a")], kernel, port, {
				confirmation: { source: "tracker_approval", ref: "tracker_approval:plan" },
			});
			await advanceBatch(input, null);
			const parked = (await advanceBatch(input, readAnyBatchRunState(fx.repo, "batch-resume-refusal"))) as unknown as { batch_state: string; children: Array<{ state: string }> };
			expect(parked.batch_state).toBe("needs_human");
			const daemonAgain = (await advanceBatch({ ...input, confirmation_time: FAR_FUTURE }, readAnyBatchRunState(fx.repo, "batch-resume-refusal"))) as unknown as { children: Array<{ state: string; reason: string | null }> };
			expect(daemonAgain.children[0]!.state).toBe("needs_human");
			expect(daemonAgain.children[0]!.reason).toContain("lane_session_open_rejected");
			port.refuseOpen = null;
			// A literal-user re-entry re-issues the capability at its own confirmation time.
			const userRegistry = createBatchAuthorityRegistry();
			const userCapability = userRegistry.issue(
				{ batch_id: "batch-resume-refusal", initiative_slug: SLUG, plan_digest: input.plan_digest, branch: "main", base_head: input.base_head, budget: input.budget, actor_id: "user", confirmation_ref: "confirm", nonce: "n" },
				input.children,
				FAR_FUTURE,
			);
			const user = (await advanceBatch({ ...input, registry: userRegistry, capability: userCapability, confirmation_time: FAR_FUTURE, literal_user_confirmation: true }, readAnyBatchRunState(fx.repo, "batch-resume-refusal"))) as unknown as { batch_state: string; children: Array<{ state: string; reason?: string | null }> };
			expect(user.batch_state).toBe("running");
			expect(user.children[0]!.state).toBe("enrolled");
		} finally {
			fx.cleanup();
		}
	});
});

describe("LEL-AC2: the claude-code Executor entry is the slash command", () => {
	async function openThenReenter(host: string | undefined, batchId: string) {
		const fx = mkRepo(["task-a"]);
		try {
			const port = new MemPort(`mem-${batchId}`);
			port.host = host;
			const kernel = fakeKernel(new Map([["task-a", "r1"]]));
			const input = laneInput(fx.repo, fx.base, batchId, [child("task-a")], kernel, port);
			await advanceBatch(input, null);
			const stored = readAnyBatchRunState(fx.repo, batchId) as BatchLaneRunStateRecord;
			// The entry did not land: the next tick re-enters it through the resume path.
			const { writeBatchLaneRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
			writeBatchLaneRunState(fx.repo, { ...stored, children: stored.children.map((c) => ({ ...c, session: { ...c.session!, entry_submitted: false } })) } as BatchLaneRunStateRecord);
			await advanceBatch(input, readAnyBatchRunState(fx.repo, batchId));
			return { opened: port.opens.map((o) => o.entry), resumed: port.resumes.map((r) => r.entry) };
		} finally {
			fx.cleanup();
		}
	}
	test("claude-code create and resume both submit /immune-brain:drive <task_id>", async () => {
		expect(await openThenReenter("claude-code", "batch-lel-cc")).toEqual({ opened: ["/immune-brain:drive task-a"], resumed: ["/immune-brain:drive task-a"] });
	});
	test("a pi Executor and a port that names no host keep the plain drive entry", async () => {
		expect(await openThenReenter("pi", "batch-lel-pi")).toEqual({ opened: ["drive task-a"], resumed: ["drive task-a"] });
		expect(await openThenReenter(undefined, "batch-lel-none")).toEqual({ opened: ["drive task-a"], resumed: ["drive task-a"] });
	});
});
