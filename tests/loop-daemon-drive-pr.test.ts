/**
 * Loop Daemon drives via the session port (S8, unified-lane-sessions LDP-A1/A2).
 *
 * - LDP-A1: with HERDR_ENV=1, HERDR_WORKSPACE_ID=ws1 and an injected herdr
 *   adapter, daemon drive builds its agreement via authorizeBatch
 *   (LOOP_DAEMON_ACTOR_ID, policy_auto, retain_branch, parent_relayed) and
 *   calls startLanes (LANE_EXECUTOR_ENV=headless), calls advanceLanes on
 *   subsequent ticks (rotating a stalled g1 to g2 without Kernel settlement,
 *   surfacing entry_submitted=false as hold_for_dialog), removes the Lane
 *   worktree and imm-lane/ upon settlement while retaining
 *   refs/heads/imm/<task_id>, and reports the v3 Batch Record commit and
 *   .imm/audit/<task_id>/ verification digest.
 * - LDP-A2: without Herdr the drive refuses lane_session_unavailable and
 *   creates zero Lane worktrees, sessions, or child processes; delivery
 *   evidence fails closed with no record, no integrated commit, or no audit.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	computeBatchPlanDigest,
	createBatchAuthorityRegistry,
} from "../plugins/immune-brain/runtime/kernel/batch_authority";
import { LOOP_DAEMON_ACTOR_ID } from "../plugins/immune-brain/runtime/kernel/actor_identity";
import { canonicalIntentHash, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { readSettledRunEvidence } from "../plugins/immune-brain/runtime/kernel/storage";
import {
	dispatchLoopDrive,
	LOOP_DAEMON_BATCH_ACTOR,
	LOOP_DAEMON_COMPOSITION_ROOT,
	type LoopDriveInput,
	type LoopInitiativeDriveInput,
} from "../plugins/immune-brain/runtime/loop_daemon/drive_dispatcher";
import { laneDeliveryEvidence } from "../plugins/immune-brain/runtime/unattended/batch_preflight";
import type { BatchRunnerKernelPort } from "../plugins/immune-brain/runtime/unattended/batch_kernel_port";
import { createDefaultBatchGitPort } from "../plugins/immune-brain/runtime/unattended/batch_git";
import {
	isLaneBatchRecord,
	prepareBatchLaneRunState,
	readAnyBatchRunState,
	writeBatchLaneRunState,
} from "../plugins/immune-brain/runtime/unattended/batch_state";
import { LANE_EXECUTOR_ENV } from "../plugins/immune-brain/runtime/unattended/batch_session_port";
import type { SupervisedSessionPort } from "../plugins/immune-brain/runtime/session/supervised_session_port";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";

const TS = "2026-01-01T00:00:00.000Z";
const TASK = "loop-daemon-drive-task";

const roots: string[] = [];
// Every HERDR_* variable is scrubbed before each test and restored after it, so a
// run inside a Herdr pane (which inherits HERDR_ENV, HERDR_SOCKET_PATH, ...) sees
// the same "no Herdr" baseline as CI. Restore, not delete: other files in the same
// bun process set these once at import.
let priorHerdrEnv: Array<[string, string]> = [];
const herdrKeys = (): string[] => Object.keys(process.env).filter((key) => key.startsWith("HERDR_"));
beforeEach(() => {
	priorHerdrEnv = herdrKeys().map((key) => [key, process.env[key]!]);
	for (const key of herdrKeys()) delete process.env[key];
});
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	for (const key of herdrKeys()) delete process.env[key];
	for (const [key, value] of priorHerdrEnv) process.env[key] = value;
});

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", ["-C", cwd, "-c", "user.name=T", "-c", "user.email=t@t", ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

const VERIFICATION = JSON.stringify({
	contract: "assurance_kernel/verification_descriptor/v2",
	command: { executable: "bun", argv: ["-e", "process.exit(0)"], cwd: ".", timeout_ms: 60000, max_output_bytes: 4096 },
	environment: { prepare: null, writable_paths: [] },
});

function intentJson(): string {
	return `${JSON.stringify({
		contract: "assurance_kernel/task_intent/v1",
		task_id: TASK,
		owner: "user",
		goal: "Drive the task through its Lane",
		acceptance: [{ id: "A1", assertion: "A1 holds", verification: VERIFICATION }],
		scope_hint: ["delivery.txt"],
		risk: "routine",
		revision: 1,
	})}\n`;
}

function fixture(): { repo: string; base: string } {
	const repo = realpathSync(mkdtempSync(join(tmpdir(), "imm-loop-drive-")));
	roots.push(repo);
	writeFileSync(join(repo, ".gitignore"), ".imm/state/\n");
	writeFileSync(join(repo, "base.txt"), "base\n");
	mkdirSync(join(repo, "docs/plans"), { recursive: true });
	writeFileSync(join(repo, `docs/plans/${TASK}.intent.json`), intentJson());
	git(repo, "init", "-q", "-b", "main");
	git(repo, "add", "-A");
	git(repo, "commit", "-qm", "base");
	return { repo, base: git(repo, "rev-parse", "HEAD") };
}

/** Herdr-shaped supervised port double: records opens, answers observations, proves closes. */
class FakeHerdr implements SupervisedSessionPort {
	readonly provider = "herdr" as const;
	readonly protocolVersion = 1;
	opens: Array<{ key?: string; env?: Record<string, string>; entry: string }> = [];
	handles = new Map<string, string>();
	states = new Map<string, string>();
	closes: Array<{ handle: string; key: string }> = [];
	entrySubmitted = true;
	counter = 0;
	async probe() {
		return { ok: true as const };
	}
	async createSession(input: { cwd: string; label: string; host: unknown; hostArgs: string[]; entry: string; session_key?: string; resume?: string; env?: Record<string, string> }) {
		if (input.resume) return { ok: true as const, handle: input.resume, entry_submitted: true as const, state: "idle" as const, provenance: "detected" as const };
		this.counter += 1;
		const key = input.session_key ?? `k${this.counter}`;
		const handle = `herdr:ws1/tab${this.counter}/pane${this.counter}/${key}`;
		this.opens.push({ key, env: input.env, entry: input.entry });
		this.handles.set(key, handle);
		if (!this.states.has(handle)) this.states.set(handle, "idle");
		return { ok: true as const, handle, entry_submitted: this.entrySubmitted as boolean, state: "idle" as const, provenance: "detected" as const };
	}
	async sendInstruction(handle: string, text: string) {
		void text;
		return { ok: true as const, state: (this.states.get(handle) ?? "idle") as "idle", provenance: "detected" as const };
	}
	async awaitTransition(handle: string) {
		return { ok: true as const, transition: "changed" as const, state: (this.states.get(handle) ?? "idle") as "idle", provenance: "detected" as const };
	}
	async readOutput(handle: string) {
		void handle;
		return { ok: true as const, text: "", source: "visible" as const };
	}
	async observeState(handle: string) {
		return { ok: true as const, state: (this.states.get(handle) ?? "idle") as "idle", provenance: "detected" as const };
	}
	async stopSession(handle: string) {
		void handle;
		return { ok: true as const };
	}
	async closeSession(handle: string) {
		void handle;
		return { ok: true as const };
	}
	async reconcile(owned: string[]) {
		return { ok: true as const, sessions: owned.map((handle) => ({ handle, state: "idle" as const, provenance: "detected" as const })) };
	}
	async findSession(key: string) {
		const handle = this.handles.get(key);
		if (handle) return { ok: true as const, handle };
		return { ok: true as const, not_found: true as const };
	}
	async closeWithProof(handle: string, session_key: string) {
		this.closes.push({ handle, key: session_key });
		return { ok: true as const, exited: true as const, handle, session_key };
	}
}

function fakeKernel(revisions: Map<string, string>, settled: Set<string>): BatchRunnerKernelPort {
	const enrolled = new Map<string, string>();
	return {
		async enrollTask({ root, task_id }: { root: string; task_id: string }) {
			enrolled.set(task_id, root);
			return { record_revision: revisions.get(task_id) ?? "r1" };
		},
		async advanceTask(_root: string, taskId: string) {
			if (settled.has(taskId)) return { state: "completed" as const };
			return { state: "blocked" as const, reason: "working" };
		},
		async projectTask(_root: string, taskId: string) {
			const done = settled.has(taskId);
			return {
				contract: "assurance_kernel/assurance_projection/v1",
				task_id: taskId,
				error: null,
				claim: enrolled.has(taskId) ? { task_id: taskId, lifecycle_status: "active" } : null,
				projection: {
					run_id: "run-1",
					record_revision: revisions.get(taskId) ?? "r1",
					workspace_revision: "w",
					intent_revision: 1,
					intent_content_hash: "sha256:intent",
					diff_hash: "sha256:diff",
					lifecycle: done ? "done" : "active",
					artifact_state: done ? "frozen" : "active",
					risk: "routine",
					next_obligation: done ? "none" : "submit_assurance",
					fresh_acceptance_ids: [],
					missing_acceptance_ids: done ? [] : ["A1"],
					stale_attestation_ids: [],
					fresh_approval_kinds: [],
					missing_approval_kinds: [],
					blocking_finding_ids: [],
					unresolved_user_decision_ids: [],
					replan_required_ids: [],
					independence_violations: [],
					open_user_decision_count: 0,
					completion_ready: done,
					authorization: { state: "none", blocked: null },
				},
			} as unknown as Awaited<ReturnType<BatchRunnerKernelPort["projectTask"]>>;
		},
		ownsTaskClaim: (taskId: string) => enrolled.has(taskId),
		validateBatchAuthorization: ({ registry, capability, binding }: Parameters<BatchRunnerKernelPort["validateBatchAuthorization"]>[0]) =>
			registry.inspect(capability, binding as never),
	} as unknown as BatchRunnerKernelPort;
}

function driveArgs(
	repo: string,
	base: string,
	batchId: string,
	kernel: BatchRunnerKernelPort,
	fake: FakeHerdr,
	overrides: Partial<LoopDriveInput> = {},
	slug: string = TASK,
): LoopDriveInput {
	const intent = readTaskIntent(repo, TASK);
	const children = [{
		task_id: TASK,
		slice_id: TASK,
		blocked_by: [],
		status: "enrollable" as const,
		reason: null,
		intent_path: intent.intent_ref.path,
		intent_revision: intent.intent_ref.revision,
		intent_content_hash: canonicalIntentHash(intent.intent),
	}];
	const planDigest = computeBatchPlanDigest(children);
	const registry = createBatchAuthorityRegistry();
	const now = new Date().toISOString();
	const budget = { max_children: 1, qa_failure_limit: 2 };
	const binding = {
		batch_id: batchId,
		initiative_slug: slug,
		plan_digest: planDigest,
		branch: `imm/${TASK}`,
		base_head: base,
		budget,
		actor_id: LOOP_DAEMON_ACTOR_ID,
		confirmation_ref: "policy_auto:plan",
		nonce: `nonce-${batchId}`,
	};
	const capability = registry.issue(binding, children, now);
	return {
		root: repo,
		task_id: TASK,
		batch_id: batchId,
		registry,
		capability,
		children,
		plan_digest: planDigest,
		base_head: base,
		budget,
		confirmation: { source: "policy_auto", ref: "policy_auto:plan" },
		confirmation_time: now,
		now,
		kernel,
		git: createDefaultBatchGitPort(),
		max_parallel: 1,
		supervision: { parent_host: "pi" },
		...overrides,
		createPort: (() => fake) as unknown as LoopDriveInput["createPort"],
	};
}

function herdrEnv() {
	process.env.HERDR_ENV = "1";
	process.env.HERDR_WORKSPACE_ID = "ws1";
}

/** Settle the Lane's own Kernel run and stage the delivery plus its audit pair, as an Executor would leave them. */
function settleLane(repo: string, lane: string) {
	const read = readTaskIntent(lane, TASK);
	seedKernelRunForTest(lane, {
		task_id: TASK,
		run_id: "run-1",
		terminal: { lifecycle: "done" },
		record: {
			contract: "assurance_kernel/task_record/v4",
			task_id: TASK,
			intent_snapshot: read.intent,
			intent_ref: { path: read.intent_ref.path, content_hash: read.content_hash },
			lifecycle: "done",
			artifact_state: "frozen",
			baseline: read.content_hash,
			git_base_head: git(lane, "rev-parse", "HEAD"),
			attestations: [],
			findings: [],
			history: [],
		},
	});
	const evidence = readSettledRunEvidence(lane, TASK)!;
	const relative = `.imm/audit/${TASK}/${evidence.run_id}`;
	mkdirSync(join(lane, relative), { recursive: true });
	writeFileSync(join(lane, relative, "task-record.json"), evidence.record_json);
	writeFileSync(join(lane, relative, "terminal-proof.json"), evidence.proof_json);
	writeFileSync(join(lane, "delivery.txt"), "delivered\n");
	// The engine advances only a Lane whose delivery is staged, like an Executor would leave it.
	git(lane, "add", "-A");
}

function laneOf(repo: string, batchId: string): string {
	const record = readAnyBatchRunState(repo, batchId);
	if (!record || !isLaneBatchRecord(record)) throw new Error("no lane batch record");
	return record.children[0]!.lane!.path;
}

describe("LDP-A1: daemon drive through the session port", () => {
	it("registers the daemon as the unattended composition root", () => {
		expect(LOOP_DAEMON_COMPOSITION_ROOT).toBe("loop_daemon");
		expect(LOOP_DAEMON_BATCH_ACTOR).toBe(LOOP_DAEMON_ACTOR_ID);
	});

	it("authorizes the batch and starts Lanes with a headless Executor session", async () => {
		herdrEnv();
		const { repo, base } = fixture();
		const fake = new FakeHerdr();
		const kernel = fakeKernel(new Map([[TASK, "r1"]]), new Set());
		const batchId = `batch-${TASK}-start`;
		const first = await dispatchLoopDrive(driveArgs(repo, base, batchId, kernel, fake));
		expect(first.settled).toBe(false);
		expect(first.batch_id).toBe(batchId);
		expect(first.exit).toBeNull();
		expect(first.hold_for_dialog).toBeNull();
		const record = readAnyBatchRunState(repo, batchId);
		if (!record || !isLaneBatchRecord(record)) throw new Error("expected a v3 lane batch record");
		expect(record.confirmation).toMatchObject({ source: "policy_auto", ref: "policy_auto:plan" });
		expect(record.return_policy).toBe("retain_branch");
		expect(record.interaction_mode).toBe("parent_relayed");
		expect(record.session_provider).toBe("herdr");
		// One headless Executor session opened before any Kernel settlement.
		expect(fake.opens).toHaveLength(1);
		expect(fake.opens[0]!.env?.[LANE_EXECUTOR_ENV]).toBe("headless");
		expect(record.children[0]!.session?.entry_submitted).toBe(true);
	});

	it("advances the same batch on later ticks and settles from record plus audit", async () => {
		herdrEnv();
		const { repo, base } = fixture();
		const fake = new FakeHerdr();
		const revisions = new Map([[TASK, "r1"]]);
		const settled = new Set<string>();
		const kernel = fakeKernel(revisions, settled);
		const batchId = `batch-${TASK}-settle`;
		const first = await dispatchLoopDrive(driveArgs(repo, base, batchId, kernel, fake));
		expect(first.settled).toBe(false);
		// The Executor delivers and settles its Lane run; the Kernel revision advances.
		const lane = laneOf(repo, batchId);
		settleLane(repo, lane);
		revisions.set(TASK, "r2");
		settled.add(TASK);
		const second = await dispatchLoopDrive(driveArgs(repo, base, batchId, kernel, fake));
		const rec2 = readAnyBatchRunState(repo, batchId);
		expect(second.settled).toBe(true);
		expect(second.batch_id).toBe(batchId);
		if (!second.exit) throw new Error("expected delivery facts on the settled drive");
		expect(second.exit.state).toBe("exited");
		expect(second.exit.exit_code).toBe(0);
		expect(second.exit.final_commit_sha).toMatch(/^[0-9a-f]{40}$/);
		expect(second.exit.verification_evidence_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
		// The digest cites the tracked audit pair at the reported commit.
		const delivery = laneDeliveryEvidence(repo, TASK);
		if (!delivery.ok) throw new Error(`expected delivery evidence: ${delivery.reason}`);
		expect(delivery.commit).toBe(second.exit.final_commit_sha);
		expect(delivery.digest).toBe(second.exit.verification_evidence_digest);
		expect(second.exit.generation).toBe(1);
		// Cleanup removes the worktree and imm-lane/ while retaining imm/<task_id>.
		for (let tick = 0; tick < 3; tick++) await dispatchLoopDrive(driveArgs(repo, base, batchId, kernel, fake));
		const tip = git(repo, "rev-parse", `refs/heads/imm/${TASK}`);
		expect(tip).toBe(second.exit.final_commit_sha);
		expect(existsSync(lane)).toBe(false);
		expect(git(repo, "branch", "--list", `imm-lane/${TASK}/*`)).toBe("");
	});

	it("rotates a stalled g1 to g2 without waiting for Kernel settlement", async () => {
		herdrEnv();
		const { repo, base } = fixture();
		const fake = new FakeHerdr();
		const kernel = fakeKernel(new Map([[TASK, "r1"]]), new Set());
		const batchId = `batch-${TASK}-stall`;
		await dispatchLoopDrive(driveArgs(repo, base, batchId, kernel, fake));
		const before = readAnyBatchRunState(repo, batchId);
		if (!before || !isLaneBatchRecord(before)) throw new Error("expected a v3 lane batch record");
		expect(before.children[0]!.session?.generation).toBe(1);
		const rotated = await dispatchLoopDrive(driveArgs(repo, base, batchId, kernel, fake));
		expect(rotated.settled).toBe(false);
		const after = readAnyBatchRunState(repo, batchId);
		if (!after || !isLaneBatchRecord(after)) throw new Error("expected a v3 lane batch record");
		expect(after.children[0]!.session?.generation).toBe(2);
		expect(fake.closes).toHaveLength(1);
		expect(fake.opens).toHaveLength(2);
	});

	it("surfaces entry_submitted=false as hold_for_dialog for escalation", async () => {
		herdrEnv();
		const { repo, base } = fixture();
		const fake = new FakeHerdr();
		fake.entrySubmitted = false;
		const kernel = fakeKernel(new Map([[TASK, "r1"]]), new Set());
		const batchId = `batch-${TASK}-hold`;
		const first = await dispatchLoopDrive(driveArgs(repo, base, batchId, kernel, fake));
		expect(first.settled).toBe(false);
		expect(first.hold_for_dialog).toMatchObject({ task_id: TASK, batch_id: batchId });
		expect(first.hold_for_dialog!.detail).toContain("lane_entry_not_submitted");
	});
});

describe("review rework: a running Lane keeps advancing and a blocked one holds", () => {
	it("reports a running child as not settled and not held, then settles once it delivers", async () => {
		herdrEnv();
		const { repo, base } = fixture();
		const fake = new FakeHerdr();
		const revisions = new Map([[TASK, "r1"]]);
		const settled = new Set<string>();
		const kernel = fakeKernel(revisions, settled);
		const batchId = `batch-${TASK}-running`;
		await dispatchLoopDrive(driveArgs(repo, base, batchId, kernel, fake));
		const record = readAnyBatchRunState(repo, batchId);
		if (!record || !isLaneBatchRecord(record)) throw new Error("expected a v3 lane batch record");
		const handle = record.children[0]!.session!.handle!;
		// The Executor is still working: the tick must neither settle nor hold.
		fake.states.set(handle, "working");
		const running = await dispatchLoopDrive(driveArgs(repo, base, batchId, kernel, fake));
		expect(running.settled).toBe(false);
		expect(running.hold_for_dialog).toBeNull();
		expect(running.parked).toBeNull();
		expect(running.reason).toContain("lane running");
		// Once it delivers, the same batch settles.
		const lane = laneOf(repo, batchId);
		settleLane(repo, lane);
		revisions.set(TASK, "r2");
		settled.add(TASK);
		const done = await dispatchLoopDrive(driveArgs(repo, base, batchId, kernel, fake));
		expect(done.settled).toBe(true);
	});

	it("surfaces a mid-run blocked child as hold_for_dialog with its attention", async () => {
		herdrEnv();
		const { repo, base } = fixture();
		const fake = new FakeHerdr();
		const kernel = fakeKernel(new Map([[TASK, "r1"]]), new Set());
		const batchId = `batch-${TASK}-blocked`;
		await dispatchLoopDrive(driveArgs(repo, base, batchId, kernel, fake));
		const record = readAnyBatchRunState(repo, batchId);
		if (!record || !isLaneBatchRecord(record)) throw new Error("expected a v3 lane batch record");
		fake.states.set(record.children[0]!.session!.handle!, "blocked");
		const held = await dispatchLoopDrive(driveArgs(repo, base, batchId, kernel, fake));
		expect(held.settled).toBe(false);
		expect(held.hold_for_dialog).toMatchObject({ task_id: TASK, batch_id: batchId });
		expect(held.hold_for_dialog!.detail).toContain("blocked");
		const after = readAnyBatchRunState(repo, batchId);
		if (!after || !isLaneBatchRecord(after)) throw new Error("expected a v3 lane batch record");
		expect(after.children[0]!.session?.attention).toBe("blocked");
	});
});

describe("LDP-A2: no sessions outside Herdr, fail-closed evidence", () => {
	it("refuses lane_session_unavailable and creates nothing", async () => {
		const { repo, base } = fixture();
		const fake = new FakeHerdr();
		const kernel = fakeKernel(new Map([[TASK, "r1"]]), new Set());
		const batchId = `batch-${TASK}-refused`;
		const refused = await dispatchLoopDrive(driveArgs(repo, base, batchId, kernel, fake));
		expect(refused.settled).toBe(false);
		expect(refused.exit).toBeNull();
		expect(refused.reason).toContain("lane_session_unavailable");
		expect(readAnyBatchRunState(repo, batchId)).toBeNull();
		expect(fake.opens).toHaveLength(0);
	});

	it("fails closed with no record, no integrated commit, or no audit", async () => {
		expect(laneDeliveryEvidence(fixture().repo, TASK)).toMatchObject({ ok: false, reason: expect.stringContaining("no settled batch record") });
		// A record whose child never integrated names the missing delivery.
		const { repo } = fixture();
		const prepared = prepareBatchLaneRunState({
			batch_id: "batch-no-commit",
			initiative_slug: TASK,
			children: [{ task_id: TASK, slice_id: TASK, blocked_by: [], status: "enrollable", reason: null, intent_path: `docs/plans/${TASK}.intent.json`, intent_revision: 1, intent_content_hash: "sha256:x" }],
			plan_digest: "sha256:plan",
			base_head: "0".repeat(40),
			confirmation_time: TS,
			budget: { max_children: 1, qa_failure_limit: 1 },
			max_parallel: 1,
			now: TS,
		});
		writeBatchLaneRunState(repo, { ...prepared, batch_state: "running" });
		expect(laneDeliveryEvidence(repo, TASK)).toMatchObject({ ok: false, reason: expect.stringContaining("no integrated delivery") });
		// An integrated commit without the tracked audit pair names the missing evidence.
		const auditRepo = fixture().repo;
		const auditPrepared = prepareBatchLaneRunState({
			batch_id: "batch-no-audit",
			initiative_slug: TASK,
			children: [{ task_id: TASK, slice_id: TASK, blocked_by: [], status: "enrollable", reason: null, intent_path: `docs/plans/${TASK}.intent.json`, intent_revision: 1, intent_content_hash: "sha256:x" }],
			plan_digest: "sha256:plan",
			base_head: "0".repeat(40),
			confirmation_time: TS,
			budget: { max_children: 1, qa_failure_limit: 1 },
			max_parallel: 1,
			now: TS,
		});
		const base = git(auditRepo, "rev-parse", "HEAD");
		writeBatchLaneRunState(auditRepo, {
			...auditPrepared,
			batch_id: "batch-no-audit",
			batch_state: "completed",
			children: [{ task_id: TASK, slice_id: TASK, blocked_by: [], state: "integrated", reason: null, commit: base,
				lane: { path: join(auditRepo, "lane"), branch: `imm-lane/${TASK}/${TASK}`, base_head: base, lane_commit: base },
				qa_failures: 0, session: null }],
			commits: [base],
		});
		expect(laneDeliveryEvidence(auditRepo, TASK)).toMatchObject({ ok: false, reason: expect.stringContaining("no audit evidence") });
	});
});

describe("ULS S2-AC1: the Initiative entry through the session port", () => {
	const SLUG = "widget-initiative";
	const COMMANDS = ["bun run typecheck", "bun test"];

	/** The single-task args re-shaped as an Initiative drive over the same slice. */
	function initiativeArgs(
		repo: string,
		base: string,
		batchId: string,
		kernel: BatchRunnerKernelPort,
		fake: FakeHerdr,
		overrides: Partial<LoopInitiativeDriveInput> = {},
	): LoopInitiativeDriveInput {
		const { task_id: _task, ...shared } = driveArgs(repo, base, batchId, kernel, fake, {}, SLUG) as Extract<LoopDriveInput, { task_id: string }>;
		void _task;
		return { ...shared, kind: "initiative", slug: SLUG, final_verification: COMMANDS, ...overrides };
	}

	it("writes one v3 record with entry kind initiative, retain_branch, parent_relayed and required final verification", async () => {
		herdrEnv();
		const { repo, base } = fixture();
		const fake = new FakeHerdr();
		const kernel = fakeKernel(new Map([[TASK, "r1"]]), new Set());
		const batchId = `batch-${SLUG}-start`;
		const first = await dispatchLoopDrive(initiativeArgs(repo, base, batchId, kernel, fake));
		expect(first.reason).toBe("lane running");
		expect(first.settled).toBe(false);
		expect(first.batch_id).toBe(batchId);
		const record = readAnyBatchRunState(repo, batchId);
		if (!record || !isLaneBatchRecord(record)) throw new Error("expected a v3 lane batch record");
		// The Initiative entry kind carries no plan_source, like a Host Initiative record.
		expect(record.plan_source).toBeUndefined();
		expect(record.initiative_slug).toBe(SLUG);
		expect(record.return_policy).toBe("retain_branch");
		expect(record.interaction_mode).toBe("parent_relayed");
		expect(record.final_verification_required).toBe(true);
		expect(record.final_verification).toEqual(COMMANDS);
		expect(record.confirmation).toMatchObject({ source: "policy_auto", ref: "policy_auto:plan" });
		expect(fake.opens).toHaveLength(1);
	});

	it("refuses final_verification_required before writing anything when no commands are configured", async () => {
		herdrEnv();
		const { repo, base } = fixture();
		const fake = new FakeHerdr();
		const kernel = fakeKernel(new Map([[TASK, "r1"]]), new Set());
		const batchId = `batch-${SLUG}-nocommands`;
		const refused = await dispatchLoopDrive(initiativeArgs(repo, base, batchId, kernel, fake, { final_verification: [] }));
		expect(refused.settled).toBe(false);
		expect(refused.reason).toContain("final_verification_required");
		expect(refused.batch_id).toBeNull();
		expect(readAnyBatchRunState(repo, batchId)).toBeNull();
		expect(fake.opens).toHaveLength(0);
	});

	it("refuses lane_session_unavailable without a usable provider and leaves no record", async () => {
		const { repo, base } = fixture();
		const fake = new FakeHerdr();
		const kernel = fakeKernel(new Map([[TASK, "r1"]]), new Set());
		const batchId = `batch-${SLUG}-refused`;
		const refused = await dispatchLoopDrive(initiativeArgs(repo, base, batchId, kernel, fake));
		expect(refused.settled).toBe(false);
		expect(refused.reason).toContain("lane_session_unavailable");
		expect(refused.batch_id).toBeNull();
		expect(readAnyBatchRunState(repo, batchId)).toBeNull();
		expect(fake.opens).toHaveLength(0);
	});

	it("refuses with the rejection reason when the batch authorization does not match the capability", async () => {
		herdrEnv();
		const { repo, base } = fixture();
		const fake = new FakeHerdr();
		const kernel = fakeKernel(new Map([[TASK, "r1"]]), new Set());
		const batchId = `batch-${SLUG}-mismatch`;
		const args = initiativeArgs(repo, base, batchId, kernel, fake, { slug: "other-initiative" });
		const refused = await dispatchLoopDrive(args);
		expect(refused.settled).toBe(false);
		expect(refused.reason).toContain("initiative_slug mismatch");
		expect(refused.batch_id).toBeNull();
		expect(readAnyBatchRunState(repo, batchId)).toBeNull();
	});

	it("keeps single-task drives at final_verification.required false", async () => {
		herdrEnv();
		const { repo, base } = fixture();
		const fake = new FakeHerdr();
		const kernel = fakeKernel(new Map([[TASK, "r1"]]), new Set());
		const batchId = `batch-${TASK}-single`;
		await dispatchLoopDrive(driveArgs(repo, base, batchId, kernel, fake));
		const record = readAnyBatchRunState(repo, batchId);
		if (!record || !isLaneBatchRecord(record)) throw new Error("expected a v3 lane batch record");
		expect(record.plan_source).toBe("single_task");
		expect(record.final_verification_required).toBe(false);
	});
});
