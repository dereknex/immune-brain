// Lane sessions S5 (Spec unified-lane-sessions S5, HLS-A1..A4).
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { createBatchAuthorityRegistry, computeBatchPlanDigest } from "../plugins/immune-brain/runtime/kernel/batch_authority";
import { herdrSubject } from "./helpers/fake-herdr";
import { canonicalIntentHash, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { readAnyBatchRunState, writeBatchLaneRunState, type BatchLaneRunStateRecord } from "../plugins/immune-brain/runtime/unattended/batch_state";
import type { BatchRunnerKernelPort } from "../plugins/immune-brain/runtime/unattended/batch_kernel_port";
import type { StartBatchInput } from "../plugins/immune-brain/runtime/unattended/batch_lanes";
import type { BatchPlanChild } from "../plugins/immune-brain/runtime/unattended/types";
import type { BatchAgreement } from "../plugins/immune-brain/runtime/unattended/batch_agreement";
import { startLanes, advanceLanes, observeLanes } from "../plugins/immune-brain/runtime/lane_sessions/index";
import { reconcileChildSession } from "../plugins/immune-brain/runtime/unattended/child_session_reconciler";
import { SessionPortAdapter } from "../plugins/immune-brain/runtime/lane_sessions/session_port_adapter";
import type { SupervisedSessionPort } from "../plugins/immune-brain/runtime/session/supervised_session_port";
import { runCli } from "../plugins/immune-brain/runtime/v4_runtime";

const SLUG = "hls-slug";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const CONFIRMED_AT = "2026-01-01T00:00:00.000Z";

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", ["-C", cwd, "-c", "user.name=T", "-c", "user.email=t@t", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function intentJson(taskId: string): string {
	const verification = JSON.stringify({
		contract: "assurance_kernel/verification_descriptor/v2",
		command: { executable: "bun", argv: ["-e", "process.exit(0)"], cwd: ".", timeout_ms: 60000, max_output_bytes: 4096 },
		environment: { prepare: null, writable_paths: [] },
	});
	return `${JSON.stringify({ contract: "assurance_kernel/task_intent/v1", task_id: taskId, goal: `Deliver ${taskId}`, acceptance: [{ id: "A1", assertion: `${taskId} holds`, verification }], scope_hint: ["a.txt"], risk: "material", revision: 1, owner: "user" })}\n`;
}

function child(taskId: string, blockedBy: string[] = []): BatchPlanChild {
	return { task_id: taskId, slice_id: `S-${taskId}`, blocked_by: blockedBy, status: "enrollable", reason: null, intent_path: `docs/plans/${taskId}.intent.json`, intent_revision: 1, intent_content_hash: "0".repeat(64) };
}

function mkRepo(taskIds: string[]): { dir: string; repo: string; base: string; cleanup(): void } {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "imm-hls-")));
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
	return { run_id: "run-1", record_revision: "r1", workspace_revision: "w", intent_revision: 1, intent_content_hash: "sha256:intent", diff_hash: "sha256:diff", lifecycle: "active", artifact_state: "active", risk: "material", next_obligation: "submit_assurance", fresh_acceptance_ids: [], missing_acceptance_ids: [], stale_attestation_ids: [], fresh_approval_kinds: [], missing_approval_kinds: [], blocking_finding_ids: [], unresolved_user_decision_ids: [], replan_required_ids: [], independence_violations: [], open_user_decision_count: 0, completion_ready: false, authorization: { state: "none", blocked: null }, ...overrides };
}

function fakeKernel(revisions: Map<string, string>, opts: { settled?: Set<string>; decisions?: Set<string> } = {}): BatchRunnerKernelPort {
	const enrolled = new Map<string, string>();
	return {
		enrolled,
		async enrollTask({ root, task_id }: { root: string; task_id: string }) {
			enrolled.set(task_id, root);
			return { record_revision: revisions.get(task_id) ?? "r1" };
		},
		async advanceTask() {
			return { state: "completed" as const };
		},
		async projectTask(root: string, taskId: string) {
			const settled = opts.settled?.has(taskId) ?? false;
			return {
				contract: "assurance_kernel/assurance_projection/v1",
				task_id: taskId,
				error: null,
				claim: enrolled.has(taskId) ? { task_id: taskId, lifecycle_status: "active" } : null,
				projection: projectionBody({ record_revision: revisions.get(taskId) ?? "r1", lifecycle: settled ? "done" : "active", completion_ready: settled, ...(opts.decisions?.has(taskId) ? { open_user_decision_count: 1 } : {}) }),
			} as unknown as Awaited<ReturnType<BatchRunnerKernelPort["projectTask"]>>;
		},
		ownsTaskClaim: (taskId: string) => enrolled.has(taskId),
		validateBatchAuthorization: ({ registry, capability, binding }: Parameters<BatchRunnerKernelPort["validateBatchAuthorization"]>[0]) =>
			(registry as unknown as { inspect: (c: unknown, b: unknown) => unknown }).inspect(capability, { ...binding, branch: "main", actor_id: "user", confirmation_ref: "confirm", nonce: "n" } as never),
	} as unknown as BatchRunnerKernelPort;
}

// Fake supervised provider (Herdr-shaped) for adapter + lane tests.
class FakeSupervised implements SupervisedSessionPort {
	readonly provider = "herdr" as const;
	readonly protocolVersion = 1;
	creates: Array<{ cwd: string; label: string; entry: string; key?: string }> = [];
	opens: Array<{ host: unknown; hostArgs: string[] }> = [];
	handles = new Map<string, string>(); // key -> handle
	states = new Map<string, string>();
	readonly failObserve = new Map<string, { code: string; reason: string }>();
	readonly failSend = new Map<string, { code: string; reason: string }>();
	counter = 0;
	constructor(public workspace = "ws1") {}
	async probe() {
		return { ok: true as const };
	}
	async createSession(input: { cwd: string; label: string; host: unknown; hostArgs: string[]; entry: string; session_key?: string; resume?: string; env?: Record<string, string> }) {
		if (input.resume) {
			return { ok: true as const, handle: input.resume, entry_submitted: true as const, state: "idle" as const, provenance: "detected" as const };
		}
		this.counter += 1;
		const key = input.session_key ?? `k${this.counter}`;
		const handle = `herdr:${this.workspace}/tab${this.counter}/pane${this.counter}/${key}`;
		this.creates.push({ cwd: input.cwd, label: input.label, entry: input.entry, key });
		this.opens.push({ host: input.host, hostArgs: [...input.hostArgs] });
		this.handles.set(key, handle);
		if (!this.states.has(handle)) this.states.set(handle, "working");
		return { ok: true as const, handle, entry_submitted: true as const, state: "working" as const, provenance: "detected" as const };
	}
	async sendInstruction(handle: string, text: string) {
		void text;
		const fail = this.failSend.get(handle);
		if (fail) return { ok: false as const, code: fail.code as "provider_error", reason: fail.reason, handle };
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
		const fail = this.failObserve.get(handle);
		if (fail) return { ok: false as const, code: "provider_error" as const, reason: fail.reason, handle };
		return { ok: true as const, state: (this.states.get(handle) ?? "working") as "working", provenance: "detected" as const };
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
		return { ok: true as const, sessions: owned.map((handle) => ({ handle, state: "working" as const, provenance: "detected" as const })) };
	}
	async findSession(key: string) {
		const handle = this.handles.get(key);
		if (handle) return { ok: true as const, handle };
		return { ok: true as const, not_found: true as const };
	}
	async closeWithProof(handle: string, session_key: string) {
		void session_key;
		return { ok: true as const, exited: true as const, handle, session_key };
	}
}

function agreementFor(repo: string, base: string, batchId: string, slug: string, taskIds: string[], policies: { return_policy: "checkout_delivery" | "retain_branch"; interaction_mode: "interactive_host" | "parent_relayed" }): BatchAgreement {
	const kids = taskIds.map((t) => {
		const read = readTaskIntent(repo, t);
		return { ...child(t), intent_content_hash: canonicalIntentHash(read.intent) };
	});
	const planDigest = computeBatchPlanDigest(kids);
	return {
		batch_id: batchId,
		initiative_slug: slug,
		children: kids,
		plan_digest: planDigest,
		base_head: base,
		budget: { max_children: kids.length, qa_failure_limit: 2 },
		confirmation: { source: "native_gate", ref: `native_gate:${batchId}` },
		final_verification: { required: false, commands: [] },
		return_policy: policies.return_policy,
		interaction_mode: policies.interaction_mode,
	};
}

function depsFor(repo: string, kernel: BatchRunnerKernelPort, fake: FakeSupervised, host: "claude-code" | "pi" | "antigravity", env: Record<string, string | undefined>, agreement?: BatchAgreement) {
	const registry = createBatchAuthorityRegistry();
	let capability: unknown;
	if (agreement) {
		capability = registry.issue({ batch_id: agreement.batch_id, initiative_slug: agreement.initiative_slug, plan_digest: agreement.plan_digest, branch: "main", base_head: agreement.base_head, budget: agreement.budget, actor_id: "user", confirmation_ref: "confirm", nonce: "n" }, agreement.children as never, CONFIRMED_AT);
	} else {
		const planKids = [child("x")];
		capability = registry.issue({ batch_id: "cap", initiative_slug: SLUG, plan_digest: computeBatchPlanDigest([{ ...planKids[0]!, intent_path: "docs/plans/x.intent.json", intent_revision: 1, intent_content_hash: "0".repeat(64) }]), branch: "main", base_head: "a".repeat(40), budget: { max_children: 1, qa_failure_limit: 1 }, actor_id: "user", confirmation_ref: "confirm", nonce: "n" }, planKids as never, CONFIRMED_AT);
	}
	return {
		root: repo,
		registry,
		capability,
		kernel,
		providers: ["herdr"],
		host,
		env,
		createPort: () => fake as unknown as SupervisedSessionPort,
		hostArgs: [] as string[],
		now: FAR_FUTURE,
		confirmation_time: CONFIRMED_AT,
	};
}

describe("HLS-A1: Host entries open one Herdr session per child", () => {
	for (const host of ["claude-code", "pi", "antigravity"] as const) {
		test(`single task via ${host} opens one session, records herdr, zero handoffs`, async () => {
			const fx = mkRepo(["task-a"]);
			try {
				const fake = new FakeSupervised("ws1");
				const kernel = fakeKernel(new Map([["task-a", "r1"]]));
				const agreement = agreementFor(fx.repo, fx.base, `batch-hls-a1-${host}`, "task-a", ["task-a"], { return_policy: "checkout_delivery", interaction_mode: "interactive_host" });
				const env = { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "ws1" };
				const report = (await startLanes(agreement, depsFor(fx.repo, kernel, fake, host, env, agreement) as never)) as unknown as { batch_state: string; handoffs?: Array<{ role: string }>; lane_supervision?: unknown };
				expect(report.batch_state).toBe("running");
				expect((report as { reason?: string }).reason ?? "").not.toContain("lane_session_unavailable");
				const record = readAnyBatchRunState(fx.repo, agreement.batch_id) as BatchLaneRunStateRecord;
				expect(record.session_provider).toBe("herdr");
				expect(fake.creates.length).toBe(1);
				expect(record.children[0]!.lane).not.toBeNull();
				expect(existsSync(record.children[0]!.lane!.path)).toBe(true);
				expect((report.handoffs ?? []).filter((h) => h.role === "executor")).toEqual([]);
				expect(report.lane_supervision).toBeUndefined();
				expect(JSON.stringify(report)).not.toContain("--print");
			} finally {
				fx.cleanup();
			}
		});
		test(`two-child Initiative via ${host} opens two sessions, retains branch`, async () => {
			const fx = mkRepo(["task-a", "task-b"]);
			try {
				const fake = new FakeSupervised("ws1");
				const kernel = fakeKernel(new Map([["task-a", "r1"], ["task-b", "r1"]]));
				const agreement = agreementFor(fx.repo, fx.base, `batch-hls-a1-2-${host}`, "init-two", ["task-a", "task-b"], { return_policy: "retain_branch", interaction_mode: "interactive_host" });
				const env = { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "ws1" };
				const report = (await startLanes(agreement, depsFor(fx.repo, kernel, fake, host, env, agreement) as never)) as unknown as { batch_state: string; handoffs?: Array<{ role: string }> };
				expect(report.batch_state).toBe("running");
				const record = readAnyBatchRunState(fx.repo, agreement.batch_id) as BatchLaneRunStateRecord;
				expect(record.session_provider).toBe("herdr");
				expect(fake.creates.length).toBe(2);
				expect((report.handoffs ?? []).filter((h) => h.role === "executor")).toEqual([]);
				expect(JSON.stringify(report)).not.toContain("--print");
			} finally {
				fx.cleanup();
			}
		});
	}
	test("a requested executor profile selects the session host and argv, not the parent", async () => {
		const fx = mkRepo(["task-a"]);
		try {
			const fake = new FakeSupervised("ws1");
			const kernel = fakeKernel(new Map([["task-a", "r1"]]));
			const agreement = agreementFor(fx.repo, fx.base, "batch-hls-executor", "task-a", ["task-a"], { return_policy: "checkout_delivery", interaction_mode: "interactive_host" });
			const env = { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "ws1" };
			// Claude parent with a requested pi executor: the tab must start pi
			// with the profile's model/effort flags, not claude-code with none.
			const requested = await startLanes(agreement, {
				...depsFor(fx.repo, kernel, fake, "claude-code", env, agreement),
				executor: { host: "pi", model: "m", effort: "high" },
			} as never) as unknown as { batch_state: string };
			expect(requested.batch_state).toBe("running");
			expect(fake.opens).toEqual([{ host: "pi", hostArgs: ["--model", "m", "--thinking", "high"] }]);
		} finally {
			fx.cleanup();
		}
	});
});

describe("HLS-A2: outside Herdr refuses without side effects", () => {
	for (const env of [{}, { HERDR_ENV: "1" }]) {
		test(`refuses with ${JSON.stringify(env)}`, async () => {
			const fx = mkRepo(["task-a"]);
			try {
				const fake = new FakeSupervised("ws1");
				const kernel = fakeKernel(new Map([["task-a", "r1"]]));
				const agreement = agreementFor(fx.repo, fx.base, "batch-hls-a2", "task-a", ["task-a"], { return_policy: "checkout_delivery", interaction_mode: "interactive_host" });
				const deps = { ...depsFor(fx.repo, kernel, fake, "pi", env, agreement), providers: ["herdr"] };
				const result = (await startLanes(agreement, deps as never)) as unknown as { ok?: boolean; code?: string; reason?: string; recovery?: string; reasons?: Array<{ provider: string; reason: string; recovery: string }> };
				expect(result.ok).toBe(false);
				expect(result.code).toBe("lane_session_unavailable");
				expect(result.reasons!.map((r) => r.provider).sort()).toEqual(["herdr"]);
				for (const r of result.reasons!) {
					expect(r.reason.length).toBeGreaterThan(0);
					expect(r.recovery.length).toBeGreaterThan(0);
				}
				expect(result.reason).not.toContain("lane_executor_requires_tui");
				expect(fake.creates.length).toBe(0);
				expect(existsSync(join(fx.repo, ".imm", "state", "batches"))).toBe(false);
			} finally {
				fx.cleanup();
			}
		});
	}
});

describe("HLS-A3: re-entry never switches providers; adapter maps failures", () => {
	test("advance with HERDR_ENV unset refuses naming herdr without switching", async () => {
		const fx = mkRepo(["task-a"]);
		try {
			const fake = new FakeSupervised("ws1");
			const kernel = fakeKernel(new Map([["task-a", "r1"]]));
			const agreement = agreementFor(fx.repo, fx.base, "batch-hls-a3", "task-a", ["task-a"], { return_policy: "checkout_delivery", interaction_mode: "interactive_host" });
			await startLanes(agreement, depsFor(fx.repo, kernel, fake, "pi", { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "ws1" }, agreement) as never);
			expect(fake.creates.length).toBe(1);
			fake.creates.length = 0;
			// Injected registry where herdr-core would admit pi, but the recorded provider must win.
			const { SESSION_PROVIDER_REGISTRY } = await import("../plugins/immune-brain/runtime/session/provider_registry");
			const permissive = SESSION_PROVIDER_REGISTRY.map((d) => (d.name === "herdr-core" ? { ...d, roles: { ...d.roles, executor: { hosts: ["pi" as const], workspace: "local_path" as const, find_by_key: true, exit_proof: false } } } : d));
			const deps = { ...depsFor(fx.repo, kernel, fake, "pi", {}, agreement), providerRegistry: permissive };
			const result = (await advanceLanes(fx.repo, "batch-hls-a3", deps as never)) as unknown as { ok?: boolean; code?: string; reason?: string };
			expect(result.ok).toBe(false);
			expect(result.code).toBe("lane_session_unavailable");
			expect(result.reason).toContain("herdr");
			expect(fake.creates.length).toBe(0);
		} finally {
			fx.cleanup();
		}
	});
	test("advance with Herdr reconciles without duplicate tabs", async () => {
		const fx = mkRepo(["task-a"]);
		try {
			const fake = new FakeSupervised("ws1");
			const kernel = fakeKernel(new Map([["task-a", "r1"]]));
			const agreement = agreementFor(fx.repo, fx.base, "batch-hls-a3b", "task-a", ["task-a"], { return_policy: "checkout_delivery", interaction_mode: "interactive_host" });
			const env = { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "ws1" };
			await startLanes(agreement, depsFor(fx.repo, kernel, fake, "pi", env, agreement) as never);
			expect(fake.creates.length).toBe(1);
			fake.creates.length = 0;
			const second = (await advanceLanes(fx.repo, "batch-hls-a3b", depsFor(fx.repo, kernel, fake, "pi", env, agreement) as never)) as unknown as { batch_state: string };
			expect(second.batch_state).toBe("running");
			expect(fake.creates.length).toBe(0);
		} finally {
			fx.cleanup();
		}
	});
	test("adapter maps pane_not_found to exited and other failures to unknown", async () => {
		const failing = new FakeSupervised("ws1");
		const adapter = new SessionPortAdapter(failing as unknown as SupervisedSessionPort, "pi", []);
		const opened = await adapter.open({ key: "imm-t-g1-abc123def456", cwd: tmpdir(), label: "t", entry: "drive t" });
		expect(opened.ok).toBe(true);
		const handle = (opened as { handle: string }).handle;
		failing.failObserve.set(handle, { code: "provider_error", reason: "herdr pane get failed: pane_not_found" });
		const exited = await adapter.observe(handle);
		expect(exited).toMatchObject({ ok: true, state: "exited" });
		failing.failObserve.set(handle, { code: "provider_error", reason: "herdr agent wait failed: boom" });
		const unknown = await adapter.observe(handle);
		expect(unknown).toMatchObject({ ok: true, state: "unknown" });
	});
	test("adapter reports a gone pane as exited through the real provider (fake herdr CLI)", async () => {
		// End-to-end pane_not_found mapping: the real Herdr adapter against the
		// fake CLI, so a regression in observeState's gone-pane path fails here
		// instead of hiding behind the synthetic FakeSupervised refusal above.
		const subject = herdrSubject();
		try {
			const adapter = new SessionPortAdapter(subject.port, "pi", []);
			const opened = await adapter.open({ key: "adapter-cli-key-1", cwd: tmpdir(), label: "t", entry: "drive t" });
			expect(opened.ok).toBe(true);
		if (!opened.ok) throw new Error("fake CLI would not open a session");
			expect((await adapter.observe(opened.handle)).state).not.toBe("exited");
			// Close the pane out from under the session; the tab keeps its token.
			expect(await subject.port.stopSession(opened.handle)).toEqual({ ok: true });
			expect(await adapter.observe(opened.handle)).toMatchObject({ ok: true, state: "exited" });
		} finally {
			subject.cleanup();
		}
	});
	test("resume opens regenerated sessions with the frozen executor profile", async () => {
		// The request is frozen into the v3 record at start; a later entry from
		// a different Parent Host without a request must still regenerate
		// missing sessions on the frozen host and argv.
		const fx = mkRepo(["task-a"]);
		try {
			const fake = new FakeSupervised("ws1");
			const kernel = fakeKernel(new Map([["task-a", "r1"]]));
			const agreement = agreementFor(fx.repo, fx.base, "batch-hls-exec-freeze", "task-a", ["task-a"], { return_policy: "checkout_delivery", interaction_mode: "interactive_host" });
			const env = { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "ws1" };
			const request = { host: "pi", model: "m", effort: "high" };
			const started = (await startLanes(agreement, {
				...depsFor(fx.repo, kernel, fake, "claude-code", env, agreement),
				executor: request,
			} as never)) as unknown as { batch_state: string };
			expect(started.batch_state).toBe("running");
			const record = readAnyBatchRunState(fx.repo, "batch-hls-exec-freeze") as BatchLaneRunStateRecord;
			expect(record.executor_preferences).toMatchObject(request);
			// Drop the child's session, then re-enter from another Parent Host
			// with no request: the regenerated session keeps the frozen profile.
			writeBatchLaneRunState(fx.repo, { ...record, children: record.children.map((c) => ({ ...c, session: null })) });
			fake.handles.clear();
			fake.states.clear();
			fake.creates.length = 0;
			fake.opens.length = 0;
			const resumed = (await advanceLanes(fx.repo, "batch-hls-exec-freeze", {
				...depsFor(fx.repo, kernel, fake, "antigravity", env, agreement),
			} as never)) as unknown as { batch_state: string };
			expect(resumed.batch_state).toBe("running");
			expect(fake.opens).toEqual([{ host: "pi", hostArgs: ["--model", "m", "--thinking", "high"] }]);
		} finally {
			fx.cleanup();
		}
	});
});

describe("review rework: a refused send retries, and a working sibling keeps a stalled child visible", () => {
	test("a gone-pane send is a refusal, so the reconciler keeps that instruction digest unprocessed", async () => {
		const fake = new FakeSupervised("ws1");
		const adapter = new SessionPortAdapter(fake as unknown as SupervisedSessionPort, "pi", []);
		const opened = await adapter.open({ key: "imm-t-g1-abc123def456", cwd: tmpdir(), label: "t", entry: "drive t" });
		expect(opened.ok).toBe(true);
		if (!opened.ok) throw new Error("the fake port would not open a session");
		fake.states.set(opened.handle, "idle");
		fake.failSend.set(opened.handle, { code: "provider_error", reason: "herdr send failed: pane_not_found" });
		const sent = await adapter.send(opened.handle, "please adjust");
		expect(sent.ok).toBe(false);
		if (sent.ok) throw new Error("a gone pane must not read as sent");
		expect(sent.reason).toContain("pane_not_found");
		// Observe still maps the same provider failure to exited.
		fake.failObserve.set(opened.handle, { code: "provider_error", reason: "herdr pane get failed: pane_not_found" });
		expect(await adapter.observe(opened.handle)).toMatchObject({ ok: true, state: "exited" });
		fake.failObserve.delete(opened.handle);
		const reconciled = await reconcileChildSession({
			port: adapter, batchId: "b", taskId: "t",
			session: { key: "imm-t-g1-abc123def456", generation: 1, baseline: "r1", handle: opened.handle, entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
			kernel: { recordRevision: "r1", settled: false, hasOpenDecision: false, hasReplan: false },
			interactionMode: "parent_relayed", entry: "drive t", laneCwd: tmpdir(),
			pendingInstruction: { text: "please adjust", digest: "sha256:instr-gone" },
		});
		expect(reconciled.action).toBe("held");
		expect(reconciled.session.handled_interventions).toBeUndefined();
	});

	test("a stalled interactive child asks the user while a sibling still works and advances once it exits", async () => {
		const fx = mkRepo(["task-a", "task-b"]);
		try {
			const fake = new FakeSupervised("ws1");
			const kernel = fakeKernel(new Map([["task-a", "r1"], ["task-b", "r1"]]));
			const env = { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "ws1" };
			const agreement = agreementFor(fx.repo, fx.base, "batch-hls-sibling", SLUG, ["task-a", "task-b"], { return_policy: "retain_branch", interaction_mode: "interactive_host" });
			await startLanes(agreement, depsFor(fx.repo, kernel, fake, "pi", env, agreement) as never);
			const record = readAnyBatchRunState(fx.repo, "batch-hls-sibling") as BatchLaneRunStateRecord;
			const handles = record.children.map((c) => c.session!.handle!);
			const deps = { kernel, env, host: "pi" as const, createPort: () => fake as unknown as SupervisedSessionPort };
			// task-a stalls at its baseline while task-b still works: the user is needed.
			fake.states.set(handles[0]!, "idle");
			fake.states.set(handles[1]!, "working");
			let obs = await observeLanes(fx.repo, "batch-hls-sibling", deps as never, { wait: false });
			expect(obs.ok && obs.next_action).toBe("ask_user");
			// The same stall advances once the sibling exits.
			fake.states.set(handles[1]!, "exited");
			obs = await observeLanes(fx.repo, "batch-hls-sibling", deps as never, { wait: false });
			expect(obs.ok && obs.next_action).toBe("advance");
			// A sibling waiting on a decision also advances, even while it works.
			fake.states.set(handles[1]!, "working");
			const deciding = fakeKernel(new Map([["task-a", "r1"], ["task-b", "r1"]]), { decisions: new Set(["task-b"]) });
			obs = await observeLanes(fx.repo, "batch-hls-sibling", { ...deps, kernel: deciding } as never, { wait: false });
			expect(obs.ok && obs.next_action).toBe("advance");
		} finally {
			fx.cleanup();
		}
	});
});

describe("HLS-A4: await --batch wake set and next_action", () => {
	test("settlement advances; blocked relays; stalled asks; timeout waits; terminal completes", async () => {
		const fx = mkRepo(["task-a"]);
		try {
			const fake = new FakeSupervised("ws1");
			const kernel = fakeKernel(new Map([["task-a", "r1"]]));
			const agreement = agreementFor(fx.repo, fx.base, "batch-hls-a4", "task-a", ["task-a"], { return_policy: "checkout_delivery", interaction_mode: "interactive_host" });
			const env = { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "ws1" };
			await startLanes(agreement, depsFor(fx.repo, kernel, fake, "pi", env, agreement) as never);
			const record = readAnyBatchRunState(fx.repo, "batch-hls-a4") as BatchLaneRunStateRecord;
			const handle = record.children[0]!.session!.handle!;
			const baseDeps = { kernel, env, host: "pi" as const, createPort: () => fake as unknown as SupervisedSessionPort };
			// Blocked -> relay_dialog
			fake.states.set(handle, "blocked");
			let obs = await observeLanes(fx.repo, "batch-hls-a4", baseDeps as never, { wait: false });
			expect(obs.ok).toBe(true);
			if (obs.ok) expect(obs.next_action).toBe("relay_dialog");
			// Idle at unchanged baseline under interactive_host -> ask_user
			fake.states.set(handle, "idle");
			obs = await observeLanes(fx.repo, "batch-hls-a4", baseDeps as never, { wait: false });
			expect(obs.ok && obs.next_action).toBe("ask_user");
			// Settled kernel -> advance
			const settledKernel = fakeKernel(new Map([["task-a", "r2"]]), { settled: new Set(["task-a"]) });
			obs = await observeLanes(fx.repo, "batch-hls-a4", { ...baseDeps, kernel: settledKernel } as never, { wait: false });
			expect(obs.ok && obs.next_action).toBe("advance");
			// Timeout with nothing pending -> wait (use parent_relayed working to avoid stall/advance)
			const fx2 = mkRepo(["task-b"]);
			try {
				const fake2 = new FakeSupervised("ws1");
				const kernel2 = fakeKernel(new Map([["task-b", "r1"]]));
				const agreement2 = agreementFor(fx2.repo, fx2.base, "batch-hls-a4-wait", "task-b", ["task-b"], { return_policy: "retain_branch", interaction_mode: "parent_relayed" });
				await startLanes(agreement2, { ...depsFor(fx2.repo, kernel2, fake2, "pi", env, agreement2), kernel: kernel2 } as never);
				const rec2 = readAnyBatchRunState(fx2.repo, "batch-hls-a4-wait") as BatchLaneRunStateRecord;
				fake2.states.set(rec2.children[0]!.session!.handle!, "working");
				const waitObs = await observeLanes(fx2.repo, "batch-hls-a4-wait", { kernel: kernel2, env, host: "pi", createPort: () => fake2 as unknown as SupervisedSessionPort } as never, { wait: true, timeoutMs: 50 });
				expect(waitObs.ok && waitObs.next_action).toBe("wait");
			} finally {
				fx2.cleanup();
			}
		} finally {
			fx.cleanup();
		}
	});
	test("send|stop --batch fail with usage 2; unknown batch refuses with 1", async () => {
		const fx = mkRepo(["task-a"]);
		try {
			const send = await runCli("imm-session", ["send", "--batch", "batch-nope", "--text", "hi"], fx.repo);
			expect(send.returncode).toBe(2);
			const stop = await runCli("imm-session", ["stop", "--batch", "batch-nope"], fx.repo);
			expect(stop.returncode).toBe(2);
			const unknown = await runCli("imm-session", ["await", "--batch", "batch-does-not-exist", "--timeout-ms", "10"], fx.repo);
			expect(unknown.returncode).toBe(1);
			expect(unknown.stdout).toContain("lane_session_unavailable");
		} finally {
			fx.cleanup();
		}
	});
});

describe("Herdr leak guard: injected port never touches the `herdr` binary", () => {
	test("startLanes with a fake port and a recording sentinel first on PATH opens zero real tabs", async () => {
		const fx = mkRepo(["task-a"]);
		const sentinelDir = realpathSync(mkdtempSync(join(tmpdir(), "imm-herdr-sentinel-")));
		const sentinelLog = join(sentinelDir, "calls.log");
		// Recording sentinel: any invocation appends argv and fails, so a real
		// provider path would both record and refuse instead of opening a tab.
		writeFileSync(join(sentinelDir, "herdr"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(sentinelLog)}\nexit 1\n`);
		chmodSync(join(sentinelDir, "herdr"), 0o755);
		const priorPath = process.env.PATH ?? "";
		process.env.PATH = `${sentinelDir}${delimiter}${priorPath}`;
		try {
			const fake = new FakeSupervised("ws1");
			const kernel = fakeKernel(new Map([["task-a", "r1"]]));
			const agreement = agreementFor(fx.repo, fx.base, "batch-hls-sentinel", "task-a", ["task-a"], { return_policy: "checkout_delivery", interaction_mode: "interactive_host" });
			const env = { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "ws1" };
			const report = (await startLanes(agreement, depsFor(fx.repo, kernel, fake, "pi", env, agreement) as never)) as unknown as { batch_state: string };
			expect(report.batch_state).toBe("running");
			expect(fake.creates.length).toBe(1);
			// shortcut: no `herdr` process may spawn when the port is injected.
			expect(existsSync(sentinelLog)).toBe(false);
		} finally {
			process.env.PATH = priorPath;
			rmSync(sentinelDir, { recursive: true, force: true });
			fx.cleanup();
		}
	});
	test("advanceLanes reconciles a recorded herdr batch without touching `herdr`", async () => {
		const fx = mkRepo(["task-a"]);
		const sentinelDir = realpathSync(mkdtempSync(join(tmpdir(), "imm-herdr-sentinel-")));
		const sentinelLog = join(sentinelDir, "calls.log");
		writeFileSync(join(sentinelDir, "herdr"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(sentinelLog)}\nexit 1\n`);
		chmodSync(join(sentinelDir, "herdr"), 0o755);
		const priorPath = process.env.PATH ?? "";
		process.env.PATH = `${sentinelDir}${delimiter}${priorPath}`;
		try {
			const fake = new FakeSupervised("ws1");
			const kernel = fakeKernel(new Map([["task-a", "r1"]]));
			const agreement = agreementFor(fx.repo, fx.base, "batch-hls-sentinel-resume", "task-a", ["task-a"], { return_policy: "checkout_delivery", interaction_mode: "interactive_host" });
			const env = { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "ws1" };
			const started = (await startLanes(agreement, depsFor(fx.repo, kernel, fake, "pi", env, agreement) as never)) as unknown as { batch_state: string };
			expect(started.batch_state).toBe("running");
			expect(fake.creates.length).toBe(1);
			fake.creates.length = 0;
			// Resume path: the record carries session_provider herdr and the
			// injected port reconciles existing handles with zero new tabs.
			const resumed = (await advanceLanes(fx.repo, "batch-hls-sentinel-resume", depsFor(fx.repo, kernel, fake, "pi", env, agreement) as never)) as unknown as { batch_state: string };
			expect(resumed.batch_state).toBe("running");
			expect(fake.creates.length).toBe(0);
			expect(existsSync(sentinelLog)).toBe(false);
		} finally {
			process.env.PATH = priorPath;
			rmSync(sentinelDir, { recursive: true, force: true });
			fx.cleanup();
		}
	});
});
