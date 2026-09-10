import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AssuranceCoordinator,
	snapshotDigest,
	type AssuranceCoordinatorPorts,
	type AssuranceVerdict,
	type SnapshotDescriptor,
} from "../plugins/immune-brain/runtime/assurance/coordinator";
import { AssuranceProgression } from "../plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts";
import { revisionForContent } from "../plugins/immune-brain/runtime/kernel/storage";
import { PassThrough } from "node:stream";
import { ClaudeReviewHost, REVIEWER_AGENT, AGENT_TOOL } from "../plugins/immune-brain/runtime/claude/review_host";
import { submitClaudeReview } from "../plugins/immune-brain/runtime/claude/kernel_ports";
import { probeHost } from "../plugins/immune-brain/runtime/claude/capability";
import { createMcpRuntime, serveStdio } from "../plugins/immune-brain/runtime/claude/mcp_server";
import type { ReviewBundle } from "../plugins/immune-brain/runtime/assurance/review_evidence";
import { executePiUnattendedBatch } from "../plugins/immune-brain/.pi-extension/imm-unattended-batch";
import type { GithubInitiativeObservation } from "../plugins/immune-brain/runtime/github_issue_tracker";

const TASK = "dual-host-task";
const ROOT = "/tmp/dual-host-assurance";
const ctx = { cwd: ROOT };

type Risk = "routine" | "material" | "critical";
type Obligation = "submit_assurance" | "run_qa" | "run_review" | "complete" | "none";

function projection(
	state: {
		lifecycle: "active" | "done" | "stopped";
		artifactState: "active" | "frozen";
		nextObligation: Obligation;
		risk: Risk;
		recordRevision?: string;
		contract?: string;
	},
) {
	return {
		error: state.contract?.startsWith("assurance_kernel/task_record/v99") ? "unsupported TaskRecord contract" : null,
		claim: state.lifecycle === "active" ? { task_id: TASK, lifecycle_status: "active" } : { task_id: TASK, lifecycle_status: "terminal" },
		projection: {
			lifecycle: state.lifecycle,
			artifact_state: state.artifactState,
			risk: state.risk,
			next_obligation: state.nextObligation,
			record_revision: state.recordRevision ?? "record-1",
			workspace_revision: "workspace-1",
			intent_revision: 1,
			intent_content_hash: "sha256:intent",
			diff_hash: "sha256:diff",
			fresh_acceptance_ids: ["A1"],
			missing_acceptance_ids: [],
			stale_attestation_ids: [],
			blocking_finding_ids: [],
			unresolved_user_decision_ids: [],
			replan_required_ids: [],
			completion_ready: state.lifecycle !== "active",
			authorization: { state: "blocked" },
		},
	} as never;
}

function snapshot(role: "qa" | "review", risk: Risk = "material"): SnapshotDescriptor {
	return {
		contract: "assurance_kernel/assurance_snapshot/v2",
		task_id: TASK,
		role,
		record_revision: "record-1",
		workspace_revision: "workspace-1",
		intent_revision: 1,
		intent_content_hash: "sha256:intent",
		diff_hash: "sha256:diff",
		lifecycle: "active",
		artifact_state: "frozen",
		risk,
		fresh_acceptance_ids: ["A1"],
		missing_acceptance_ids: [],
		stale_attestation_ids: [],
		acceptance: [{ id: "A1", assertion: "the contract holds", verification: "{}" }],
		dirty_files: ["src/change.ts"],
		review_bundle_digest: role === "review" ? "sha256:bundle" : null,
		root: ROOT,
	};
}

function reviewBundle(): ReviewBundle {
	return {
		contract: "assurance_kernel/review_bundle/v4",
		root: ROOT,
		head: "a".repeat(40),
		scope: ["src/change.ts"],
		diff_hash: "sha256:diff",
		dirty_files: {},
		outcomes: { A1: { status: "passed", summary: "fresh" } },
		bundle_digest: "sha256:bundle",
	} as unknown as ReviewBundle;
}

function passVerdict(s: SnapshotDescriptor): AssuranceVerdict {
	return {
		contract: "assurance_kernel/assurance_verdict/v2",
		role: s.role,
		task_id: TASK,
		snapshot_digest: snapshotDigest(s),
		decision: "pass",
		approval: { kind: s.role === "qa" ? "qa" : "review", authority_role: s.role === "qa" ? "qa" : "reviewer", summary: "passed" },
	};
}

function completeClaudeReview(host: ClaudeReviewHost, operationId: string, risk: Risk) {
	const agentId = `claude-agent-${operationId}`;
	host.observe({ type: "SubagentStart", sessionId: "claude", agent: REVIEWER_AGENT, agentId, taskId: TASK, operationId });
	host.observe({
		type: "PostToolUse",
		sessionId: "claude",
		agentId,
		toolName: AGENT_TOOL,
		result: JSON.stringify(passVerdict(snapshot("review", risk))),
		taskId: TASK,
		operationId,
	});
	host.observe({ type: "SubagentStop", sessionId: "claude", agent: REVIEWER_AGENT, agentId, taskId: TASK, operationId });
}

async function submitObservedReview(
	h: { coordinator: AssuranceCoordinator; host: ClaudeReviewHost },
	taskId = TASK,
) {
	const observed = h.host.inspectReviewForTask(taskId);
	if (!observed.ok) {
		if (observed.release) return h.coordinator.abandonReview(taskId, observed.reason);
		return { state: "blocked" as const, reason: observed.reason };
	}
	return submitClaudeReview(h.host, h.coordinator, ctx, taskId, observed.receipt.result);
}

function sharedKernel(
	risk: Risk,
	start: Obligation = "run_qa",
	hooks: {
		onQaStart?: () => void;
		holdQa?: (signal?: AbortSignal) => Promise<void>;
		failQaCommit?: boolean;
	} = {},
) {
	let lifecycle: "active" | "done" | "stopped" = "active";
	let artifactState: "active" | "frozen" = start === "submit_assurance" ? "active" : "frozen";
	let nextObligation: Obligation = start;
	let recordRevision = "record-1";
	let contract: string | undefined;
	let locked = false;
	let holder: object | null = null;
	const applyCounts = { value: 0 };
	const executionCounts = { qa: 0, completion: 0 };
	const portsFor = (host: AssuranceCoordinatorPorts["host"]): AssuranceCoordinatorPorts => {
	const token = {};
	return {
		host,
		projectTask: async () => {
			if (holder && holder !== token) {
				return { error: "concurrent continuation rejected", claim: null, projection: projection({ lifecycle, artifactState, nextObligation, risk, recordRevision, contract }).projection };
			}
			holder = token;
			return projection({ lifecycle, artifactState, nextObligation, risk, recordRevision, contract });
		},
		readTaskRecord: async () => ({ record: { ...(contract ? { contract } : {}), findings: [] } }),
		readTaskIntent: async () => ({ token: "intent-token" }),
		frozenRunner: async () => ({ runner_id: "bun", path: "/bun", dev: 1, ino: 1, content_hash: "sha256:x", version: "1.3.14" }),
		buildAssurance: async (_root, _task, role) => ({
			snapshot: snapshot(role, risk),
			descriptors: new Map([[
				"A1",
				{ contract: "assurance_kernel/verification_descriptor/v1", runner_id: "bun", runner_version: "1.3.14", argv: ["test"], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 },
			]] as never),
			reviewBundle: role === "review" ? reviewBundle() : null,
		}),
		runQa: async (s, _descriptors, _runner, options) => {
			executionCounts.qa += 1;
			hooks.onQaStart?.();
			if (hooks.holdQa) await hooks.holdQa(options?.signal);
			return passVerdict(s);
		},
		writeReviewEvidence: () => ({ path: `${ROOT}/review.json`, remove: () => undefined }),
		applyVerdict: async (_ctx, input) => {
			if (locked) throw new Error("concurrent continuation rejected");
			locked = true;
			applyCounts.value += 1;
			await input.hooks?.beforeCommit?.();
			input.hooks?.onCommit?.();
			if (input.snapshot.role === "qa") nextObligation = risk === "routine" ? "complete" : "run_review";
			else nextObligation = "complete";
			if (input.snapshot.role === "qa" && hooks.failQaCommit) {
				locked = false;
				throw new Error("host reply lost after authority commit");
			}
			await input.hooks?.afterCommit?.();
			locked = false;
		},
		applyOrdinaryOperation: async (_ctx, input) => {
			if (locked) throw new Error("concurrent continuation rejected");
			if (input.operation.op === "freeze_artifacts") {
				artifactState = "frozen";
				nextObligation = "run_qa";
			}
			if (input.operation.op === "complete") {
				executionCounts.completion += 1;
				lifecycle = "done";
				nextObligation = "none";
			}
		},
	};
	};
	return {
		applyCounts,
		executionCounts,
		releaseClaim() { holder = null; },
		claude() {
			const host = new ClaudeReviewHost();
			return { host, coordinator: new AssuranceCoordinator(portsFor(host)) };
		},
		pi() {
			const ports = portsFor({ host: "pi", prepareReview: () => ({ id: "x", dispatch: {} }), releaseReview: () => undefined });
			const { host: _ignored, ...rest } = ports;
			return new AssuranceProgression(rest);
		},
		stale() { recordRevision = "stale"; },
		future() { contract = "assurance_kernel/task_record/v99"; },
		v3() { contract = "assurance_kernel/task_record/v3"; },
		done() {
			lifecycle = "done";
			artifactState = "frozen";
			nextObligation = "none";
		},
	};
}

describe("dual-host assurance conformance", () => {
	test("Claude independently completes routine, material, and critical projections", async () => {
		const routine = sharedKernel("routine");
		const r = routine.claude();
		expect(await r.coordinator.advance(TASK, ctx)).toEqual({ state: "completed" });

		const material = sharedKernel("material");
		const m = material.claude();
		const ready = await m.coordinator.advance(TASK, ctx);
		expect(ready.state).toBe("review_ready");
		completeClaudeReview(m.host, (ready as { operation_id: string }).operation_id, "material");
		expect(await submitObservedReview(m)).toEqual({ state: "completed" });

		const critical = sharedKernel("critical");
		const c = critical.claude();
		const critReady = await c.coordinator.advance(TASK, ctx);
		completeClaudeReview(c.host, (critReady as { operation_id: string }).operation_id, "critical");
		expect(await submitObservedReview(c)).toEqual({ state: "completed" });
	});

	test("Pi resumes a Claude-frozen run_review task without handoff state", async () => {
		const kernel = sharedKernel("material");
		const claude = kernel.claude();
		const ready = await claude.coordinator.advance(TASK, ctx);
		expect(ready.state).toBe("review_ready");
		await claude.coordinator.onSessionShutdown();
		kernel.releaseClaim();
		const pi = kernel.pi();
		const resumed = await pi.advance(TASK, ctx as never);
		expect(resumed.state).toBe("review_ready");
		expect(await pi.submitReview(TASK, ctx, passVerdict(snapshot("review")))).toEqual({ state: "completed" });
		expect(kernel.executionCounts).toEqual({ qa: 1, completion: 1 });
	});

	test("Claude resumes a Pi run_review task without handoff state", async () => {
		const kernel = sharedKernel("material");
		const pi = kernel.pi();
		const ready = await pi.advance(TASK, ctx as never);
		expect(ready.state).toBe("review_ready");
		await pi.onSessionShutdown();
		kernel.releaseClaim();
		const claude = kernel.claude();
		const resumed = await claude.coordinator.advance(TASK, ctx);
		expect(resumed.state).toBe("review_ready");
		completeClaudeReview(claude.host, (resumed as { operation_id: string }).operation_id, "material");
		expect(await submitObservedReview(claude)).toEqual({ state: "completed" });
		expect(kernel.executionCounts).toEqual({ qa: 1, completion: 1 });
	});

	test("Claude resumes a Pi-active submit_assurance task and freezes artifacts cross-host", async () => {
		const kernel = sharedKernel("material", "submit_assurance");
		const pi = kernel.pi();
		await pi.onSessionShutdown(); // Pi disconnects before touching the task
		kernel.releaseClaim();
		const claude = kernel.claude();
		const ready = await claude.coordinator.advance(TASK, ctx); // freezes artifacts, runs QA
		expect(ready.state).toBe("review_ready");
		completeClaudeReview(claude.host, (ready as { operation_id: string }).operation_id, "material");
		expect(await submitObservedReview(claude)).toEqual({ state: "completed" });
		expect(kernel.applyCounts.value).toBe(2);
	});

	test("host cancellation during QA leaves frozen run_qa that the other host resumes", async () => {
		let qaStarted!: () => void;
		const started = new Promise<void>((resolve) => { qaStarted = resolve; });
		const kernel = sharedKernel("material", "run_qa", {
			onQaStart: qaStarted,
			holdQa: (signal) => {
				if (!signal || qaHolds-- <= 0) return Promise.resolve();
				return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
			},
		});
		let qaHolds = 1;
		const claude = kernel.claude();
		const controller = new AbortController();
		const pending = claude.coordinator.advance(TASK, ctx, controller.signal);
		await started;
		controller.abort(new Error("user cancelled"));
		expect(await pending).toMatchObject({ state: "cancelled" });
		expect(kernel.applyCounts.value).toBe(0); // zero QA attestation
		kernel.releaseClaim();
		const pi = kernel.pi();
		const resumed = await pi.advance(TASK, ctx as never);
		expect(resumed.state).toBe("review_ready");
		expect(await pi.submitReview(TASK, ctx, passVerdict(snapshot("review")))).toEqual({ state: "completed" });
	});

	test("session disconnect mid-QA aborts in-flight work and the other host resumes", async () => {
		let qaStarted!: () => void;
		const started = new Promise<void>((resolve) => { qaStarted = resolve; });
		const kernel = sharedKernel("material", "run_qa", {
			onQaStart: qaStarted,
			holdQa: (signal) => {
				if (!signal || qaHolds-- <= 0) return Promise.resolve();
				return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
			},
		});
		let qaHolds = 1;
		const claude = kernel.claude();
		const pending = claude.coordinator.advance(TASK, ctx);
		await started;
		await claude.coordinator.onSessionShutdown(); // disconnect aborts cancellable in-flight work
		expect(await pending).toMatchObject({ state: "cancelled" });
		expect(kernel.applyCounts.value).toBe(0);
		kernel.releaseClaim();
		const pi = kernel.pi();
		const resumed = await pi.advance(TASK, ctx as never);
		expect(resumed.state).toBe("review_ready");
		expect(await pi.submitReview(TASK, ctx, passVerdict(snapshot("review")))).toEqual({ state: "completed" });
	});

	test("critical Review completes on the originating host", async () => {
		const kernel = sharedKernel("critical");
		const claude = kernel.claude();
		const ready = await claude.coordinator.advance(TASK, ctx);
		completeClaudeReview(claude.host, (ready as { operation_id: string }).operation_id, "critical");
		expect(await submitObservedReview(claude)).toEqual({ state: "completed" });
		expect(kernel.applyCounts.value).toBe(2);
	});

	test("terminal projections reconcile idempotently on both hosts", async () => {
		const kernel = sharedKernel("material");
		kernel.done();
		expect(await kernel.pi().advance(TASK, ctx as never)).toEqual({ state: "completed" });
		kernel.releaseClaim();
		expect(await kernel.claude().coordinator.advance(TASK, ctx)).toEqual({ state: "completed" });
		expect(kernel.applyCounts.value).toBe(0); // no re-settlement of a terminal task
		expect(kernel.executionCounts).toEqual({ qa: 0, completion: 0 });
	});

	test("postcommit ambiguity reconciles through the Kernel projection across hosts", async () => {
		const kernel = sharedKernel("material", "run_qa", { failQaCommit: true });
		const claude = kernel.claude();
		expect(await claude.coordinator.advance(TASK, ctx)).toMatchObject({ state: "settlement_unknown" });
		expect(kernel.applyCounts.value).toBe(1); // committed exactly once, reply lost
		kernel.releaseClaim();
		const pi = kernel.pi();
		const resumed = await pi.advance(TASK, ctx as never); // reconciles run_review without re-running QA
		expect(resumed.state).toBe("review_ready");
		expect(kernel.applyCounts.value).toBe(1);
		expect(await pi.submitReview(TASK, ctx, passVerdict(snapshot("review")))).toEqual({ state: "completed" });
		expect(kernel.executionCounts).toEqual({ qa: 1, completion: 1 });
	});

	for (const host of ["pi", "claude"] as const) {
		test(`${host} recovers an unknown QA commit in the same session without replay`, async () => {
			const kernel = sharedKernel("material", "run_qa", { failQaCommit: true });
			const coordinator = host === "pi" ? kernel.pi() : kernel.claude().coordinator;
			expect((await coordinator.advance(TASK, ctx)).state).toBe("settlement_unknown");
			expect((await coordinator.advance(TASK, ctx)).state).toBe("review_ready");
			expect(kernel.executionCounts.qa).toBe(1);
			expect(kernel.applyCounts.value).toBe(1);
			await coordinator.onSessionShutdown();
		});
	}

	test("v3 drain remains readable while vFuture, stale identity, and concurrent continuation fail closed", async () => {
		const v3 = sharedKernel("routine");
		v3.v3();
		expect((await v3.claude().coordinator.advance(TASK, ctx)).state).toBe("completed");
		const v3pi = sharedKernel("material");
		v3pi.v3();
		const v3piHost = v3pi.pi();
		const v3ready = await v3piHost.advance(TASK, ctx as never);
		expect(v3ready.state).toBe("review_ready");
		expect(await v3piHost.submitReview(TASK, ctx, passVerdict(snapshot("review")))).toEqual({ state: "completed" });
		const future = sharedKernel("routine");
		future.future();
		expect(await future.claude().coordinator.advance(TASK, ctx)).toMatchObject({ state: "blocked" });

		const stale = sharedKernel("material");
		const first = stale.claude();
		const ready = await first.coordinator.advance(TASK, ctx);
		stale.stale();
		completeClaudeReview(first.host, (ready as { operation_id: string }).operation_id, "material");
		expect(await submitObservedReview(first)).toMatchObject({ state: "blocked" });

		expect(probeHost({ CLAUDE_CODE_VERSION: "9.0.0" }).ok).toBe(true);
		expect(probeHost({ CLAUDE_CODE_VERSION: "2.0.0" }).ok).toBe(false);
	});

	test("concurrent continuation fails closed", async () => {
		const kernel = sharedKernel("material");
		const a = kernel.claude();
		const b = kernel.claude();
		const results = await Promise.all([a.coordinator.advance(TASK, ctx), b.coordinator.advance(TASK, ctx)]);
		const states = results.map((item) => item.state).sort();
		expect(states).toEqual(["blocked", "review_ready"]);
		expect(kernel.applyCounts.value).toBe(1);
	});

	test("stdin end waits for in-flight tools/call, then shuts down", async () => {
		const input = new PassThrough();
		const output = new PassThrough();
		let shutdowns = 0;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const mcp = createMcpRuntime({ env: { CLAUDE_CODE_VERSION: "2.1.236" }, interactive: true });
		mcp.callTool = async () => {
			await gate;
			return { ok: true };
		};
		const originalShutdown = mcp.shutdown.bind(mcp);
		mcp.shutdown = async () => {
			shutdowns += 1;
			return originalShutdown();
		};
		let exited = false;
		const done = serveStdio({ input, output, runtime: mcp, exit: () => { exited = true; } });
		const body = JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: "status", arguments: { task_id: TASK } },
		});
		input.write(`${body}\n`);
		input.end();
		await Promise.resolve();
		await Promise.resolve();
		expect(shutdowns).toBe(0);
		expect(exited).toBe(false);
		release();
		await done;
		expect(shutdowns).toBe(1);
		expect(exited).toBe(true);
		expect(output.read()?.toString()).toContain("ok");
	});

	test(
		"acc-dual-host-batch-parity: shared batch confirmation conformance across Claude and Pi",
		// Exceeds bun's default 5s per-test timeout under the Kernel QA minimal
		// environment, which is slower than an interactive session.
		async () => {

		function createConformanceFixture(
			slug: string,
			inScopeExtra: string[] = ["src/impl.ts"],
			withSecondChild = false,
		): { root: string; head: string; observation: GithubInitiativeObservation } {
			const root = mkdtempSync(join(tmpdir(), "dual-batch-conformance-"));
			execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
			execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
			execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
			mkdirSync(join(root, ".imm", "state"), { recursive: true });
			writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
			execFileSync("git", ["add", "-A"], { cwd: root });
			execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: root });

			mkdirSync(join(root, "src"), { recursive: true });
			writeFileSync(join(root, "src", "impl.ts"), "export const impl = 1;\n");
			writeFileSync(join(root, "src", "other.ts"), "export const other = 1;\n");
			writeFileSync(join(root, "out.ts"), "export const out = 1;\n");
			execFileSync("git", ["add", "-A"], { cwd: root });
			execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: root });

			mkdirSync(join(root, "docs", "plans"), { recursive: true });
			const intent1 = {
				contract: "assurance_kernel/task_intent/v1",
				task_id: `${slug}-c1`,
				owner: "user",
				goal: "c1",
				acceptance: [{ id: "acc-1", assertion: "c1", verification: "bun test" }],
				scope_hint: [`docs/plans/${slug}-c1.intent.json`, ...inScopeExtra],
				risk: "routine",
				revision: 1,
			};
			writeFileSync(join(root, "docs", "plans", `${slug}-c1.intent.json`), `${JSON.stringify(intent1, null, 2)}\n`);
			if (withSecondChild) {
				const intent2 = {
					contract: "assurance_kernel/task_intent/v1",
					task_id: `${slug}-c2`,
					owner: "user",
					goal: "c2",
					acceptance: [{ id: "acc-2", assertion: "c2", verification: "bun test" }],
					scope_hint: [`docs/plans/${slug}-c2.intent.json`, ...inScopeExtra],
					risk: "routine",
					revision: 1,
				};
				writeFileSync(join(root, "docs", "plans", `${slug}-c2.intent.json`), `${JSON.stringify(intent2, null, 2)}\n`);
			}
			execFileSync("git", ["add", "docs/plans/"], { cwd: root });
			execFileSync("git", ["commit", "-q", "-m", "add children"], { cwd: root });
			const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

			const observation: GithubInitiativeObservation = {
				contract: "immune_brain/github_initiative_observation/v1",
				initiative_id: slug,
				issue_number: 200,
				tasks: [
					{ task_id: `${slug}-c1`, slice_id: "S1", issue_number: 201, blocked_by: [] },
					...(withSecondChild
						? [{ task_id: `${slug}-c2`, slice_id: "S2", issue_number: 202, blocked_by: [`${slug}-c1`] }]
						: []),
				],
			};
			return { root, head, observation };
		}

		const ENV = { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" };

		function assertZeroWrites(cf: { root: string; head: string }, pf: { root: string; head: string }, checkNoBranches = true) {
			for (const f of [cf, pf]) {
				expect(existsSync(join(f.root, ".imm", "state", "batch"))).toBe(false);
				expect(existsSync(join(f.root, ".imm", "state", "batches"))).toBe(false);
				expect(existsSync(join(f.root, ".imm", "state", "tasks"))).toBe(false);
				if (checkNoBranches) {
					const branches = execFileSync("git", ["branch", "--list", "imm/*"], { cwd: f.root, encoding: "utf8" }).trim();
					expect(branches).toBe("");
				}
				const currentHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: f.root, encoding: "utf8" }).trim();
				expect(currentHead).toBe(f.head);
			}
		}

		// 1. Parity scenario: ACCEPT
		{
			const sharedSlug = "conf-accept";
			const claudeFixture = createConformanceFixture(sharedSlug);
			const piFixture = createConformanceFixture(sharedSlug);

			let claudeBinding: any = null;
			const claudeRuntime = createMcpRuntime({
				cwd: claudeFixture.root,
				env: ENV,
				interactive: true,
				readInitiative: async () => claudeFixture.observation,
				batchKernel: {
					enrollTask: async () => ({ record_revision: "r" }),
					advanceTask: async () => ({ state: "completed" }),
					commitChild: async () => {
						writeFileSync(join(claudeFixture.root, "dummy.txt"), "c");
						execFileSync("git", ["add", "dummy.txt"], { cwd: claudeFixture.root });
						execFileSync("git", ["commit", "-q", "-m", "c commit"], { cwd: claudeFixture.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: claudeFixture.root, encoding: "utf8" }).trim();
						return { commit };
					},
					lookupBatchCommit: async () => null,
					validateBatchAuthorization: (input) => {
						const validated = input.registry.inspect(input.capability, input.binding as never);
						claudeBinding = validated;
						return validated;
					},
				},
				requestConfirmation: async () => ({ decision: "accept", requestId: "req-c-acc" }),
			});
			claudeRuntime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });

			const claudeResult = await claudeRuntime.callTool(
				"start_unattended_batch",
				{ initiative_slug: sharedSlug },
				{ toolCallId: "toolu-c-acc" },
			);

			let piBinding: any = null;
			const piResult = await executePiUnattendedBatch({
				root: piFixture.root,
				initiativeSlug: sharedSlug,
				interactive: true,
				readInitiative: async () => piFixture.observation,
				batchKernel: {
					enrollTask: async () => ({ record_revision: "r" }),
					advanceTask: async () => ({ state: "completed" }),
					commitChild: async () => {
						writeFileSync(join(piFixture.root, "dummy.txt"), "p");
						execFileSync("git", ["add", "dummy.txt"], { cwd: piFixture.root });
						execFileSync("git", ["commit", "-q", "-m", "p commit"], { cwd: piFixture.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: piFixture.root, encoding: "utf8" }).trim();
						return { commit };
					},
					lookupBatchCommit: async () => null,
					validateBatchAuthorization: (input) => {
						const validated = input.registry.inspect(input.capability, input.binding as never);
						piBinding = validated;
						return validated;
					},
				},
				confirmBatch: async () => "accept",
			});

			expect(claudeResult.state).toBe("started");
			expect(piResult.state).toBe("started");
			expect(claudeResult.report.batch_state).toBe(piResult.report.batch_state);
			expect(claudeResult.report.children.length).toBe(piResult.report.children.length);

			// Assert identical Batch Authorization bindings across both Hosts
			expect(claudeBinding).not.toBeNull();
			expect(piBinding).not.toBeNull();
			expect(claudeBinding.initiative_slug).toBe(sharedSlug);
			expect(piBinding.initiative_slug).toBe(sharedSlug);
			expect(claudeBinding.branch).toBe(piBinding.branch);
			expect(claudeBinding.plan_digest).toBe(piBinding.plan_digest);
			expect(claudeBinding.budget.max_children).toBe(piBinding.budget.max_children);
			expect(claudeBinding.budget.qa_failure_limit).toBe(piBinding.budget.qa_failure_limit);
			expect(Math.abs(Date.parse(claudeBinding.budget.deadline_at) - Date.parse(piBinding.budget.deadline_at))).toBeLessThan(5000);
			expect(claudeBinding.base_head).toBe(claudeFixture.head);
			expect(piBinding.base_head).toBe(piFixture.head);
			expect(claudeBinding.base_head).toMatch(/^[a-f0-9]{40}$/);
			expect(piBinding.base_head).toMatch(/^[a-f0-9]{40}$/);
			expect(claudeBinding.actor_id).toBe("user");
			expect(piBinding.actor_id).toBe("user");
		}

		// 2. Parity scenario: DECLINE with identical zero writes and stable reasons
		{
			const cf = createConformanceFixture("conf-dec-c");
			const pf = createConformanceFixture("conf-dec-p");

			const cr = createMcpRuntime({
				cwd: cf.root,
				env: ENV,
				interactive: true,
				readInitiative: async () => cf.observation,
				requestConfirmation: async () => ({ decision: "decline", requestId: "req-dec" }),
			});
			cr.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			const cRes = await cr.callTool("start_unattended_batch", { initiative_slug: "conf-dec-c" }, { toolCallId: "toolu-dec" });

			const pRes = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: "conf-dec-p",
				interactive: true,
				readInitiative: async () => pf.observation,
				confirmBatch: async () => "decline",
			});

			expect(cRes.state).toBe("rejected");
			expect(pRes.state).toBe("rejected");
			expect(cRes.reason).toBe(pRes.reason);
			expect(cRes.recovery_action).toBe(pRes.recovery_action);
			assertZeroWrites(cf, pf);
		}

		// 3. Parity scenario: CANCEL with identical zero writes
		{
			const cf = createConformanceFixture("conf-can-c");
			const pf = createConformanceFixture("conf-can-p");

			const cr = createMcpRuntime({
				cwd: cf.root,
				env: ENV,
				interactive: true,
				readInitiative: async () => cf.observation,
				requestConfirmation: async () => ({ decision: "cancel", requestId: "req-can" }),
			});
			cr.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			const cRes = await cr.callTool("start_unattended_batch", { initiative_slug: "conf-can-c" }, { toolCallId: "toolu-can" });

			const pRes = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: "conf-can-p",
				interactive: true,
				readInitiative: async () => pf.observation,
				confirmBatch: async () => "cancel",
			});

			expect(cRes.state).toBe("cancelled");
			expect(pRes.state).toBe("cancelled");
			expect(cRes.reason).toBe(pRes.reason);
			expect(cRes.recovery_action).toBe(pRes.recovery_action);
			assertZeroWrites(cf, pf);
		}

		// 4. Parity scenario: ACTIVE CLAIM BLOCKED
		{
			const cf = createConformanceFixture("conf-claim-c");
			const pf = createConformanceFixture("conf-claim-p");
			for (const root of [cf.root, pf.root]) {
				writeFileSync(
					join(root, ".imm", "state", "workspace.json"),
					JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: "existing-task" }),
				);
			}

			const cr = createMcpRuntime({
				cwd: cf.root,
				env: ENV,
				interactive: true,
				readInitiative: async () => cf.observation,
				requestConfirmation: async () => ({ decision: "accept", requestId: "r" }),
			});
			cr.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			const cRes = await cr.callTool("start_unattended_batch", { initiative_slug: "conf-claim-c" }, { toolCallId: "toolu-cl" });

			const pRes = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: "conf-claim-p",
				interactive: true,
				readInitiative: async () => pf.observation,
				confirmBatch: async () => "accept",
			});

			expect(cRes.state).toBe("blocked");
			expect(pRes.state).toBe("blocked");
			expect(cRes.reason).toContain("existing-task");
			expect(pRes.reason).toContain("existing-task");
			expect(cRes.recovery_action).toBe(pRes.recovery_action);
			assertZeroWrites(cf, pf);
		}

		// 5. Parity scenario: NON-INTERACTIVE REJECTED
		{
			const cf = createConformanceFixture("conf-noninter-c");
			const pf = createConformanceFixture("conf-noninter-p");

			const cr = createMcpRuntime({
				cwd: cf.root,
				env: ENV,
				interactive: false,
				readInitiative: async () => cf.observation,
			});
			cr.bindClientHandshake({ version: "2.1.236", interactive: false, protocolVersion: "2025-06-18" });
			await expect(cr.callTool("start_unattended_batch", { initiative_slug: "conf-noninter-c" })).rejects.toThrow("unsupported_host");

			const pRes = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: "conf-noninter-p",
				interactive: false,
				readInitiative: async () => pf.observation,
			});
			expect(pRes.state).toBe("rejected");
			expect(pRes.reason).toContain("interactive TUI elicitation is unavailable");
			assertZeroWrites(cf, pf);
		}

		// 6. Parity scenario: BRANCH PREFLIGHT FAILED
		{
			const cf = createConformanceFixture("conf-branchfail-c");
			const pf = createConformanceFixture("conf-branchfail-p");
			execFileSync("git", ["branch", "imm/conf-branchfail-c"], { cwd: cf.root });
			execFileSync("git", ["branch", "imm/conf-branchfail-p"], { cwd: pf.root });

			const cr = createMcpRuntime({
				cwd: cf.root,
				env: ENV,
				interactive: true,
				readInitiative: async () => cf.observation,
				requestConfirmation: async () => ({ decision: "accept", requestId: "r" }),
			});
			cr.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			const cRes = await cr.callTool("start_unattended_batch", { initiative_slug: "conf-branchfail-c" }, { toolCallId: "toolu-bf" });

			const pRes = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: "conf-branchfail-p",
				interactive: true,
				readInitiative: async () => pf.observation,
				confirmBatch: async () => "accept",
			});

			expect(cRes.state).toBe("rejected");
			expect(pRes.state).toBe("rejected");
			expect(cRes.reason).toContain("already exists");
			expect(pRes.reason).toContain("already exists");
			expect(cRes.recovery_action).toBe(pRes.recovery_action);
			assertZeroWrites(cf, pf, false);
		}

		// 7. Parity scenario: EMPTY ENROLLABLE CHILD SET
		{
			const cf = createConformanceFixture("conf-empty-c");
			const pf = createConformanceFixture("conf-empty-p");
			const emptyObs: GithubInitiativeObservation = {
				contract: "immune_brain/github_initiative_observation/v1",
				initiative_id: "conf-empty",
				issue_number: 300,
				tasks: [],
			};

			const cr = createMcpRuntime({
				cwd: cf.root,
				env: ENV,
				interactive: true,
				readInitiative: async () => emptyObs,
				requestConfirmation: async () => ({ decision: "accept", requestId: "r" }),
			});
			cr.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			const cRes = await cr.callTool("start_unattended_batch", { initiative_slug: "conf-empty" }, { toolCallId: "toolu-emp" });

			const pRes = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: "conf-empty",
				interactive: true,
				readInitiative: async () => emptyObs,
				confirmBatch: async () => "accept",
			});

			expect(cRes.state).toBe("rejected");
			expect(pRes.state).toBe("rejected");
			expect(cRes.reason).toContain("empty enrollable child set");
			expect(pRes.reason).toContain("empty enrollable child set");
			expect(cRes.recovery_action).toBe(pRes.recovery_action);
			assertZeroWrites(cf, pf);
		}

		// 8. Parity scenario: BATCH RESUMPTION CONFORMANCE
		{
			const sharedResumeSlug = "conf-resume";
			const cf = createConformanceFixture(`${sharedResumeSlug}-c`);
			const pf = createConformanceFixture(`${sharedResumeSlug}-p`);

			// Run round 1 pausing for review on both hosts
			let cStep = 0;
			let cLastCommit: string | null = null;
			const cr = createMcpRuntime({
				cwd: cf.root,
				env: ENV,
				interactive: true,
				readInitiative: async () => cf.observation,
				batchKernel: {
					advanceTask: async () => {
						cStep++;
						if (cStep === 1) return { state: "review_ready", operation_id: "c-op", agent_params: { prompt: "review" } as never };
						writeFileSync(
							join(cf.root, ".imm", "state", "workspace.json"),
							JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }),
						);
						const claimPath = join(cf.root, ".imm", "state", "active-claim.json");
						if (existsSync(claimPath)) rmSync(claimPath, { force: true });
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(cf.root, "dummy.txt"), `${Date.now()}`);
						execFileSync("git", ["add", "dummy.txt"], { cwd: cf.root });
						execFileSync("git", ["commit", "-q", "-m", "c commit"], { cwd: cf.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: cf.root, encoding: "utf8" }).trim();
						cLastCommit = commit;
						return { commit };
					},
					lookupBatchCommit: async () => (cLastCommit ? { commit: cLastCommit } : null),
				},
				requestConfirmation: async () => ({ decision: "accept", requestId: "r-c1" }),
			});
			cr.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			const cRes1 = await cr.callTool("start_unattended_batch", { initiative_slug: `${sharedResumeSlug}-c` }, { toolCallId: "toolu-cr1" });

			let pStep = 0;
			let pLastCommit: string | null = null;
			const pRes1 = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedResumeSlug}-p`,
				interactive: true,
				readInitiative: async () => pf.observation,
				batchKernel: {
					advanceTask: async () => {
						pStep++;
						if (pStep === 1) return { state: "review_ready", operation_id: "p-op", agent_params: { prompt: "review" } as never };
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(pf.root, "dummy.txt"), `${Date.now()}`);
						execFileSync("git", ["add", "dummy.txt"], { cwd: pf.root });
						execFileSync("git", ["commit", "-q", "-m", "p commit"], { cwd: pf.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim();
						pLastCommit = commit;
						return { commit };
					},
					lookupBatchCommit: async () => (pLastCommit ? { commit: pLastCommit } : null),
				},
				confirmBatch: async () => "accept",
			});

			expect(cRes1.state).toBe("started");
			expect(pRes1.state).toBe("started");
			expect(cRes1.report.batch_state).toBe(pRes1.report.batch_state);

			// Staged in-flight change to a tracked, in-scope path. Both hosts must resume:
			// the Kernel projection accepts staged in-scope work.
			writeFileSync(join(cf.root, "src", "impl.ts"), "export const impl = 2; // in-flight\n");
			execFileSync("git", ["add", "src/impl.ts"], { cwd: cf.root });
			writeFileSync(join(pf.root, "src", "impl.ts"), "export const impl = 2; // in-flight\n");
			execFileSync("git", ["add", "src/impl.ts"], { cwd: pf.root });

			// Run round 2 resuming the in-flight batch on both hosts
			const cRes2 = await cr.callTool("start_unattended_batch", { initiative_slug: `${sharedResumeSlug}-c` }, { toolCallId: "toolu-cr2" });
			const pRes2 = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedResumeSlug}-p`,
				interactive: true,
				readInitiative: async () => pf.observation,
				batchKernel: {
					advanceTask: async () => {
						writeFileSync(
							join(pf.root, ".imm", "state", "workspace.json"),
							JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }),
						);
						const claimPath = join(pf.root, ".imm", "state", "active-claim.json");
						if (existsSync(claimPath)) rmSync(claimPath, { force: true });
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(pf.root, "dummy.txt"), `${Date.now()}`);
						execFileSync("git", ["add", "dummy.txt"], { cwd: pf.root });
						execFileSync("git", ["commit", "-q", "-m", "p commit 2"], { cwd: pf.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim();
						pLastCommit = commit;
						return { commit };
					},
					lookupBatchCommit: async () => (pLastCommit ? { commit: pLastCommit } : null),
				},
				confirmBatch: async () => "accept",
			});

			expect(cRes2.state).toBe("started");
			expect(pRes2.state).toBe("started");
			expect(cRes2.batch_id).toBe(cRes1.batch_id);
			expect(pRes2.batch_id).toBe(pRes1.batch_id);
			expect(cRes2.report.batch_state).toBe(pRes2.report.batch_state);
		}

		// 9. Parity scenario: OUT-OF-SCOPE STAGED CHANGE BLOCKS RESUME IDENTICALLY
		{
			const sharedScopeSlug = "conf-scope";
			const cf = createConformanceFixture(`${sharedScopeSlug}-c`);
			const pf = createConformanceFixture(`${sharedScopeSlug}-p`);

			let cStep = 0;
			let cLastCommit: string | null = null;
			const cr = createMcpRuntime({
				cwd: cf.root,
				env: ENV,
				interactive: true,
				readInitiative: async () => cf.observation,
				batchKernel: {
					advanceTask: async () => {
						cStep++;
						if (cStep === 1) return { state: "review_ready", operation_id: "c-op", agent_params: { prompt: "review" } as never };
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(cf.root, "dummy.txt"), `${Date.now()}`);
						execFileSync("git", ["add", "dummy.txt"], { cwd: cf.root });
						execFileSync("git", ["commit", "-q", "-m", "c commit"], { cwd: cf.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: cf.root, encoding: "utf8" }).trim();
						cLastCommit = commit;
						return { commit };
					},
					lookupBatchCommit: async () => (cLastCommit ? { commit: cLastCommit } : null),
				},
				requestConfirmation: async () => ({ decision: "accept", requestId: "r-scope-c1" }),
			});
			cr.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			const cRes1 = await cr.callTool("start_unattended_batch", { initiative_slug: `${sharedScopeSlug}-c` }, { toolCallId: "toolu-cs1" });

			let pStep = 0;
			let pLastCommit: string | null = null;
			const pRes1 = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedScopeSlug}-p`,
				interactive: true,
				readInitiative: async () => pf.observation,
				batchKernel: {
					advanceTask: async () => {
						pStep++;
						if (pStep === 1) return { state: "review_ready", operation_id: "p-op", agent_params: { prompt: "review" } as never };
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(pf.root, "dummy.txt"), `${Date.now()}`);
						execFileSync("git", ["add", "dummy.txt"], { cwd: pf.root });
						execFileSync("git", ["commit", "-q", "-m", "p commit"], { cwd: pf.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim();
						pLastCommit = commit;
						return { commit };
					},
					lookupBatchCommit: async () => (pLastCommit ? { commit: pLastCommit } : null),
				},
				confirmBatch: async () => "accept",
			});

			expect(cRes1.state).toBe("started");
			expect(pRes1.state).toBe("started");

			const cBatchPath = join(cf.root, ".imm", "state", "batches", `${cRes1.batch_id}.json`);
			const pBatchPath = join(pf.root, ".imm", "state", "batches", `${pRes1.batch_id}.json`);
			const cBatchBefore = readFileSync(cBatchPath, "utf8");
			const pBatchBefore = readFileSync(pBatchPath, "utf8");
			const cHeadBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: cf.root, encoding: "utf8" }).trim();
			const pHeadBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim();

			// Staged modification to a tracked path outside the authorized child scope
			writeFileSync(join(cf.root, "src", "other.ts"), "export const other = 2; // out of scope\n");
			execFileSync("git", ["add", "src/other.ts"], { cwd: cf.root });
			writeFileSync(join(pf.root, "src", "other.ts"), "export const other = 2; // out of scope\n");
			execFileSync("git", ["add", "src/other.ts"], { cwd: pf.root });

			const cRes2 = await cr.callTool("start_unattended_batch", { initiative_slug: `${sharedScopeSlug}-c` }, { toolCallId: "toolu-cs2" });
			const pRes2 = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedScopeSlug}-p`,
				interactive: true,
				readInitiative: async () => pf.observation,
				confirmBatch: async () => "accept",
			});

			expect(cRes2.state).toBe("rejected");
			expect(pRes2.state).toBe("rejected");
			expect(cRes2.reason).toBe(pRes2.reason);
			expect(cRes2.reason).toContain("outside the authorized child scope");
			expect(cRes2.recovery_action).toBe(pRes2.recovery_action);
			expect(readFileSync(cBatchPath, "utf8")).toBe(cBatchBefore);
			expect(readFileSync(pBatchPath, "utf8")).toBe(pBatchBefore);
			expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: cf.root, encoding: "utf8" }).trim()).toBe(cHeadBefore);
			expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim()).toBe(pHeadBefore);
		}

		// 10. Parity scenario: UNSTAGED IN-SCOPE CHANGE BLOCKS RESUME IDENTICALLY
		// (regression for porcelain status-column parsing: a trimmed parser reads
		// " M src/impl.ts" as "rc/impl.ts" and misreports it as out of scope).
		{
			const sharedDirtySlug = "conf-dirty";
			const cf = createConformanceFixture(`${sharedDirtySlug}-c`);
			const pf = createConformanceFixture(`${sharedDirtySlug}-p`);

			let cStep = 0;
			let cLastCommit: string | null = null;
			const cr = createMcpRuntime({
				cwd: cf.root,
				env: ENV,
				interactive: true,
				readInitiative: async () => cf.observation,
				batchKernel: {
					advanceTask: async () => {
						cStep++;
						if (cStep === 1) return { state: "review_ready", operation_id: "c-op", agent_params: { prompt: "review" } as never };
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(cf.root, "dummy.txt"), `${Date.now()}`);
						execFileSync("git", ["add", "dummy.txt"], { cwd: cf.root });
						execFileSync("git", ["commit", "-q", "-m", "c commit"], { cwd: cf.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: cf.root, encoding: "utf8" }).trim();
						cLastCommit = commit;
						return { commit };
					},
					lookupBatchCommit: async () => (cLastCommit ? { commit: cLastCommit } : null),
				},
				requestConfirmation: async () => ({ decision: "accept", requestId: "r-dirty-c1" }),
			});
			cr.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			const cRes1 = await cr.callTool("start_unattended_batch", { initiative_slug: `${sharedDirtySlug}-c` }, { toolCallId: "toolu-cd1" });

			let pStep = 0;
			let pLastCommit: string | null = null;
			const pRes1 = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedDirtySlug}-p`,
				interactive: true,
				readInitiative: async () => pf.observation,
				batchKernel: {
					advanceTask: async () => {
						pStep++;
						if (pStep === 1) return { state: "review_ready", operation_id: "p-op", agent_params: { prompt: "review" } as never };
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(pf.root, "dummy.txt"), `${Date.now()}`);
						execFileSync("git", ["add", "dummy.txt"], { cwd: pf.root });
						execFileSync("git", ["commit", "-q", "-m", "p commit"], { cwd: pf.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim();
						pLastCommit = commit;
						return { commit };
					},
					lookupBatchCommit: async () => (pLastCommit ? { commit: pLastCommit } : null),
				},
				confirmBatch: async () => "accept",
			});

			expect(cRes1.state).toBe("started");
			expect(pRes1.state).toBe("started");

			const cBatchPath = join(cf.root, ".imm", "state", "batches", `${cRes1.batch_id}.json`);
			const pBatchPath = join(pf.root, ".imm", "state", "batches", `${pRes1.batch_id}.json`);
			const cBatchBefore = readFileSync(cBatchPath, "utf8");
			const pBatchBefore = readFileSync(pBatchPath, "utf8");

			// Unstaged modification to a tracked in-scope path: the Kernel projection
			// refuses unstaged bytes, so both hosts must refuse identically.
			writeFileSync(join(cf.root, "src", "impl.ts"), "export const impl = 3; // unstaged\n");
			writeFileSync(join(pf.root, "src", "impl.ts"), "export const impl = 3; // unstaged\n");

			const cRes2 = await cr.callTool("start_unattended_batch", { initiative_slug: `${sharedDirtySlug}-c` }, { toolCallId: "toolu-cd2" });
			const pRes2 = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedDirtySlug}-p`,
				interactive: true,
				readInitiative: async () => pf.observation,
				confirmBatch: async () => "accept",
			});

			expect(cRes2.state).toBe("rejected");
			expect(pRes2.state).toBe("rejected");
			expect(cRes2.reason).toBe(pRes2.reason);
			expect(cRes2.reason).toContain("unstaged or untracked changes");
			expect(cRes2.recovery_action).toBe(pRes2.recovery_action);
			expect(readFileSync(cBatchPath, "utf8")).toBe(cBatchBefore);
			expect(readFileSync(pBatchPath, "utf8")).toBe(pBatchBefore);
		}

		// 14. Parity scenario: ARCHIVED CHILD SIDECAR KEEPS STAGED IN-SCOPE RESUME
		// (authorized scope must come from the TaskRecord, not the active sidecar)
		{
			const sharedArchivedSlug = "conf-archived";
			const cf = createConformanceFixture(`${sharedArchivedSlug}-c`);
			const pf = createConformanceFixture(`${sharedArchivedSlug}-p`);

			let cStep = 0;
			let cLastCommit: string | null = null;
			const cr = createMcpRuntime({
				cwd: cf.root,
				env: ENV,
				interactive: true,
				readInitiative: async () => cf.observation,
				batchKernel: {
					advanceTask: async () => {
						cStep++;
						if (cStep === 1) return { state: "review_ready", operation_id: "c-op", agent_params: { prompt: "review" } as never };
						writeFileSync(join(cf.root, ".imm", "state", "workspace.json"), JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }));
						const claimPath = join(cf.root, ".imm", "state", "active-claim.json");
						if (existsSync(claimPath)) rmSync(claimPath, { force: true });
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(cf.root, "dummy.txt"), `${Date.now()}`);
						execFileSync("git", ["add", "dummy.txt"], { cwd: cf.root });
						execFileSync("git", ["commit", "-q", "-m", "c commit"], { cwd: cf.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: cf.root, encoding: "utf8" }).trim();
						cLastCommit = commit;
						return { commit };
					},
					lookupBatchCommit: async () => (cLastCommit ? { commit: cLastCommit } : null),
				},
				requestConfirmation: async () => ({ decision: "accept", requestId: "r-ar-c1" }),
			});
			cr.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			const cRes1 = await cr.callTool("start_unattended_batch", { initiative_slug: `${sharedArchivedSlug}-c` }, { toolCallId: "toolu-ar1" });

			let pStep = 0;
			let pLastCommit: string | null = null;
			const pRes1 = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedArchivedSlug}-p`,
				interactive: true,
				readInitiative: async () => pf.observation,
				batchKernel: {
					advanceTask: async () => {
						pStep++;
						if (pStep === 1) return { state: "review_ready", operation_id: "p-op", agent_params: { prompt: "review" } as never };
						writeFileSync(join(pf.root, ".imm", "state", "workspace.json"), JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }));
						const claimPath = join(pf.root, ".imm", "state", "active-claim.json");
						if (existsSync(claimPath)) rmSync(claimPath, { force: true });
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(pf.root, "dummy.txt"), `${Date.now()}`);
						execFileSync("git", ["add", "dummy.txt"], { cwd: pf.root });
						execFileSync("git", ["commit", "-q", "-m", "p commit"], { cwd: pf.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim();
						pLastCommit = commit;
						return { commit };
					},
					lookupBatchCommit: async () => (pLastCommit ? { commit: pLastCommit } : null),
				},
				confirmBatch: async () => "accept",
			});

			expect(cRes1.state).toBe("started");
			expect(pRes1.state).toBe("started");

			// Freeze the in-flight child's sidecar into archive (Kernel artifact move,
			// staged) on both hosts, then stage an in-scope source change.
			for (const [root, slugPart] of [[cf.root, `${sharedArchivedSlug}-c`], [pf.root, `${sharedArchivedSlug}-p`]] as const) {
				mkdirSync(join(root, "docs", "plans", "archive"), { recursive: true });
				renameSync(
					join(root, "docs", "plans", `${slugPart}-c1.intent.json`),
					join(root, "docs", "plans", "archive", `${slugPart}-c1.intent.json`),
				);
				writeFileSync(join(root, "src", "impl.ts"), "export const impl = 2; // in-flight\n");
				execFileSync("git", ["add", "-A"], { cwd: root });
			}

			const cRes2 = await cr.callTool("start_unattended_batch", { initiative_slug: `${sharedArchivedSlug}-c` }, { toolCallId: "toolu-ar2" });
			const pRes2 = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedArchivedSlug}-p`,
				interactive: true,
				readInitiative: async () => pf.observation,
				batchKernel: {
					advanceTask: async () => {
						writeFileSync(
							join(pf.root, ".imm", "state", "workspace.json"),
							JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }),
						);
						const claimPath = join(pf.root, ".imm", "state", "active-claim.json");
						if (existsSync(claimPath)) rmSync(claimPath, { force: true });
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(pf.root, "dummy.txt"), `${Date.now()}`);
						execFileSync("git", ["add", "dummy.txt"], { cwd: pf.root });
						execFileSync("git", ["commit", "-q", "-m", "p commit 2"], { cwd: pf.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim();
						pLastCommit = commit;
						return { commit };
					},
					lookupBatchCommit: async () => (pLastCommit ? { commit: pLastCommit } : null),
				},
				confirmBatch: async () => "accept",
			});

			expect(cRes2.state).toBe("started");
			expect(pRes2.state).toBe("started");
			expect(cRes2.batch_id).toBe(cRes1.batch_id);
			expect(pRes2.batch_id).toBe(pRes1.batch_id);
		}

		// 11. Parity scenario: DIRECTORY AND GLOB SCOPE ACCEPT STAGED IN-SCOPE RESUME
		for (const scopeExtra of ["src", "src/**"]) {
			const sharedDirSlug = `conf-scope-${scopeExtra === "src" ? "dir" : "glob"}`;
			const cf = createConformanceFixture(`${sharedDirSlug}-c`, [scopeExtra]);
			const pf = createConformanceFixture(`${sharedDirSlug}-p`, [scopeExtra]);

			let cStep = 0;
			let cLastCommit: string | null = null;
			const cr = createMcpRuntime({
				cwd: cf.root,
				env: ENV,
				interactive: true,
				readInitiative: async () => cf.observation,
				batchKernel: {
					advanceTask: async () => {
						cStep++;
						if (cStep === 1) return { state: "review_ready", operation_id: "c-op", agent_params: { prompt: "review" } as never };
						writeFileSync(
							join(cf.root, ".imm", "state", "workspace.json"),
							JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }),
						);
						const claimPath = join(cf.root, ".imm", "state", "active-claim.json");
						if (existsSync(claimPath)) rmSync(claimPath, { force: true });
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(cf.root, "dummy.txt"), `${Date.now()}`);
						execFileSync("git", ["add", "dummy.txt"], { cwd: cf.root });
						execFileSync("git", ["commit", "-q", "-m", "c commit"], { cwd: cf.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: cf.root, encoding: "utf8" }).trim();
						cLastCommit = commit;
						return { commit };
					},
					lookupBatchCommit: async () => (cLastCommit ? { commit: cLastCommit } : null),
				},
				requestConfirmation: async () => ({ decision: "accept", requestId: "r-di1" }),
			});
			cr.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			const cRes1 = await cr.callTool("start_unattended_batch", { initiative_slug: `${sharedDirSlug}-c` }, { toolCallId: "toolu-di1" });

			let pStep = 0;
			let pLastCommit: string | null = null;
			const pRes1 = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedDirSlug}-p`,
				interactive: true,
				readInitiative: async () => pf.observation,
				batchKernel: {
					advanceTask: async () => {
						pStep++;
						if (pStep === 1) return { state: "review_ready", operation_id: "p-op", agent_params: { prompt: "review" } as never };
						writeFileSync(
							join(pf.root, ".imm", "state", "workspace.json"),
							JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }),
						);
						const claimPath = join(pf.root, ".imm", "state", "active-claim.json");
						if (existsSync(claimPath)) rmSync(claimPath, { force: true });
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(pf.root, "dummy.txt"), `${Date.now()}`);
						execFileSync("git", ["add", "dummy.txt"], { cwd: pf.root });
						execFileSync("git", ["commit", "-q", "-m", "p commit"], { cwd: pf.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim();
						pLastCommit = commit;
						return { commit };
					},
					lookupBatchCommit: async () => (pLastCommit ? { commit: pLastCommit } : null),
				},
				confirmBatch: async () => "accept",
			});

			expect(cRes1.state).toBe("started");
			expect(pRes1.state).toBe("started");

			// Staged in-scope file under a directory/glob scope must not be rejected as
			// out-of-scope on either host.
			writeFileSync(join(cf.root, "src", "impl.ts"), "export const impl = 2; // in-flight\n");
			execFileSync("git", ["add", "src/impl.ts"], { cwd: cf.root });
			writeFileSync(join(pf.root, "src", "impl.ts"), "export const impl = 2; // in-flight\n");
			execFileSync("git", ["add", "src/impl.ts"], { cwd: pf.root });

			const cRes2 = await cr.callTool("start_unattended_batch", { initiative_slug: `${sharedDirSlug}-c` }, { toolCallId: "toolu-di2" });
			const pRes2 = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedDirSlug}-p`,
				interactive: true,
				readInitiative: async () => pf.observation,
				batchKernel: {
					advanceTask: async () => {
						writeFileSync(
							join(pf.root, ".imm", "state", "workspace.json"),
							JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }),
						);
						const claimPath = join(pf.root, ".imm", "state", "active-claim.json");
						if (existsSync(claimPath)) rmSync(claimPath, { force: true });
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(pf.root, "dummy.txt"), `${Date.now()}`);
						execFileSync("git", ["add", "dummy.txt"], { cwd: pf.root });
						execFileSync("git", ["commit", "-q", "-m", "p commit 2"], { cwd: pf.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim();
						pLastCommit = commit;
						return { commit };
					},
					lookupBatchCommit: async () => (pLastCommit ? { commit: pLastCommit } : null),
				},
				confirmBatch: async () => "accept",
			});

			expect(cRes2.state).toBe("started");
			expect(pRes2.state).toBe("started");
			expect(cRes2.batch_id).toBe(cRes1.batch_id);
			expect(pRes2.batch_id).toBe(pRes1.batch_id);
		}

		// 12. Parity scenario: CLAIM SWAPPED DURING CONFIRMATION STAYS BLOCKED
		{
			const sharedSwapSlug = "conf-swap";
			const cf = createConformanceFixture(`${sharedSwapSlug}-c`);
			const pf = createConformanceFixture(`${sharedSwapSlug}-p`);

			let cStep = 0;
			let cLastCommit: string | null = null;
			const cr = createMcpRuntime({
				cwd: cf.root,
				env: ENV,
				interactive: true,
				readInitiative: async () => cf.observation,
				batchKernel: {
					advanceTask: async () => {
						cStep++;
						if (cStep === 1) return { state: "review_ready", operation_id: "c-op", agent_params: { prompt: "review" } as never };
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(cf.root, "dummy.txt"), `${Date.now()}`);
						execFileSync("git", ["add", "dummy.txt"], { cwd: cf.root });
						execFileSync("git", ["commit", "-q", "-m", "c commit"], { cwd: cf.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: cf.root, encoding: "utf8" }).trim();
						cLastCommit = commit;
						return { commit };
					},
					lookupBatchCommit: async () => (cLastCommit ? { commit: cLastCommit } : null),
				},
				requestConfirmation: async () => ({ decision: "accept", requestId: "r-sw-c1" }),
			});
			cr.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			const cRes1 = await cr.callTool("start_unattended_batch", { initiative_slug: `${sharedSwapSlug}-c` }, { toolCallId: "toolu-sw1" });

			let pStep = 0;
			let pLastCommit: string | null = null;
			const pRes1 = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedSwapSlug}-p`,
				interactive: true,
				readInitiative: async () => pf.observation,
				batchKernel: {
					advanceTask: async () => {
						pStep++;
						if (pStep === 1) return { state: "review_ready", operation_id: "p-op", agent_params: { prompt: "review" } as never };
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(pf.root, "dummy.txt"), `${Date.now()}`);
						execFileSync("git", ["add", "dummy.txt"], { cwd: pf.root });
						execFileSync("git", ["commit", "-q", "-m", "p commit"], { cwd: pf.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim();
						pLastCommit = commit;
						return { commit };
					},
					lookupBatchCommit: async () => (pLastCommit ? { commit: pLastCommit } : null),
				},
				confirmBatch: async () => "accept",
			});

			expect(cRes1.state).toBe("started");
			expect(pRes1.state).toBe("started");

			const cBatchPath = join(cf.root, ".imm", "state", "batches", `${cRes1.batch_id}.json`);
			const pBatchPath = join(pf.root, ".imm", "state", "batches", `${pRes1.batch_id}.json`);
			const cBatchBefore = readFileSync(cBatchPath, "utf8");
			const pBatchBefore = readFileSync(pBatchPath, "utf8");
			const cHeadBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: cf.root, encoding: "utf8" }).trim();
			const pHeadBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim();

			const forgeForeignClaim = (root: string, taskId: string, batchStatePath: string): void => {
				const updatedAt = JSON.parse(readFileSync(batchStatePath, "utf8")).updated_at;
				const foreignCreatedAt = new Date(Date.parse(updatedAt) + 1000).toISOString();
				// Kernel-looking event-id derivation, but created after the batch's last
				// durable write: an independent enrollment during the pause.
				writeFileSync(
					join(root, ".imm", "state", "active-claim.json"),
					JSON.stringify({
						contract: "assurance_kernel/backend_claim/v2",
						backend: "kernel",
						task_id: taskId,
						intent_revision: 1,
						intent_content_hash: `sha256:${cRes1.batch_id.startsWith("batch-conf-swap-c") ? "c" : "p"}.repeat(64)`.replace(".repeat(64)", ""),
						enrollment_event_id: `enroll-${taskId}-${foreignCreatedAt}`,
						lifecycle_status: "active",
						created_at: foreignCreatedAt,
						updated_at: foreignCreatedAt,
					}),
				);
			};

			// Round 2 confirmation callbacks swap the same child's claim mid-confirmation.
			const cr2 = createMcpRuntime({
				cwd: cf.root,
				env: ENV,
				interactive: true,
				readInitiative: async () => cf.observation,
				requestConfirmation: async () => {
					forgeForeignClaim(cf.root, `${sharedSwapSlug}-c-c1`, cBatchPath);
					return { decision: "accept", requestId: "r-sw2" };
				},
			});
			cr2.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			const cRes2 = await cr2.callTool("start_unattended_batch", { initiative_slug: `${sharedSwapSlug}-c` }, { toolCallId: "toolu-sw2" });

			const pRes2 = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedSwapSlug}-p`,
				interactive: true,
				readInitiative: async () => pf.observation,
				confirmBatch: async () => {
					forgeForeignClaim(pf.root, `${sharedSwapSlug}-p-c1`, pBatchPath);
					return "accept";
				},
			});

			expect(cRes2.state).toBe("blocked");
			expect(pRes2.state).toBe("blocked");
			// The message template is identical across hosts; only the host-local task
			// id differs, so normalize it before comparing parity.
			const normalizeReason = (reason: string): string => reason.replace(/for task: .*$/, "for task: <id>");
			expect(normalizeReason(cRes2.reason)).toBe(normalizeReason(pRes2.reason));
			expect(cRes2.reason).toContain("an active workspace claim appeared during confirmation");
			expect(cRes2.recovery_action).toBe(pRes2.recovery_action);
			expect(readFileSync(cBatchPath, "utf8")).toBe(cBatchBefore);
			expect(readFileSync(pBatchPath, "utf8")).toBe(pBatchBefore);
			expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: cf.root, encoding: "utf8" }).trim()).toBe(cHeadBefore);
			expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim()).toBe(pHeadBefore);
		}

		// 13. Parity scenario: CROSS-SCOPE RENAME BLOCKS RESUME IDENTICALLY
		// (rename detection must not hide the out-of-scope source deletion)
		{
			const sharedRenameSlug = "conf-rename";
			const cf = createConformanceFixture(`${sharedRenameSlug}-c`);
			const pf = createConformanceFixture(`${sharedRenameSlug}-p`);

			let cStep = 0;
			let cLastCommit: string | null = null;
			const cr = createMcpRuntime({
				cwd: cf.root,
				env: ENV,
				interactive: true,
				readInitiative: async () => cf.observation,
				batchKernel: {
					advanceTask: async () => {
						cStep++;
						if (cStep === 1) return { state: "review_ready", operation_id: "c-op", agent_params: { prompt: "review" } as never };
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(cf.root, "dummy.txt"), `${Date.now()}`);
						execFileSync("git", ["add", "dummy.txt"], { cwd: cf.root });
						execFileSync("git", ["commit", "-q", "-m", "c commit"], { cwd: cf.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: cf.root, encoding: "utf8" }).trim();
						cLastCommit = commit;
						return { commit };
					},
					lookupBatchCommit: async () => (cLastCommit ? { commit: cLastCommit } : null),
				},
				requestConfirmation: async () => ({ decision: "accept", requestId: "r-rn-c1" }),
			});
			cr.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			const cRes1 = await cr.callTool("start_unattended_batch", { initiative_slug: `${sharedRenameSlug}-c` }, { toolCallId: "toolu-rn1" });

			let pStep = 0;
			let pLastCommit: string | null = null;
			const pRes1 = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedRenameSlug}-p`,
				interactive: true,
				readInitiative: async () => pf.observation,
				batchKernel: {
					advanceTask: async () => {
						pStep++;
						if (pStep === 1) return { state: "review_ready", operation_id: "p-op", agent_params: { prompt: "review" } as never };
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(pf.root, "dummy.txt"), `${Date.now()}`);
						execFileSync("git", ["add", "dummy.txt"], { cwd: pf.root });
						execFileSync("git", ["commit", "-q", "-m", "p commit"], { cwd: pf.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim();
						pLastCommit = commit;
						return { commit };
					},
					lookupBatchCommit: async () => (pLastCommit ? { commit: pLastCommit } : null),
				},
				confirmBatch: async () => "accept",
			});

			expect(cRes1.state).toBe("started");
			expect(pRes1.state).toBe("started");

			const cBatchPath = join(cf.root, ".imm", "state", "batches", `${cRes1.batch_id}.json`);
			const pBatchPath = join(pf.root, ".imm", "state", "batches", `${pRes1.batch_id}.json`);
			const cBatchBefore = readFileSync(cBatchPath, "utf8");
			const pBatchBefore = readFileSync(pBatchPath, "utf8");
			const cHeadBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: cf.root, encoding: "utf8" }).trim();
			const pHeadBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim();

			// Rename an out-of-scope tracked file into an in-scope path and stage it:
			// without --no-renames the parser only sees the in-scope destination.
			for (const root of [cf.root, pf.root]) {
				writeFileSync(join(root, "src", "impl.ts"), "export const impl = 9; // renamed over\n");
				rmSync(join(root, "src", "other.ts"), { force: true });
				execFileSync("git", ["add", "-A"], { cwd: root });
			}

			const cRes2 = await cr.callTool("start_unattended_batch", { initiative_slug: `${sharedRenameSlug}-c` }, { toolCallId: "toolu-rn2" });
			const pRes2 = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedRenameSlug}-p`,
				interactive: true,
				readInitiative: async () => pf.observation,
				confirmBatch: async () => "accept",
			});

			expect(cRes2.state).toBe("rejected");
			expect(pRes2.state).toBe("rejected");
			expect(cRes2.reason).toBe(pRes2.reason);
			expect(cRes2.reason).toContain("outside the authorized child scope");
			expect(cRes2.recovery_action).toBe(pRes2.recovery_action);
			expect(readFileSync(cBatchPath, "utf8")).toBe(cBatchBefore);
			expect(readFileSync(pBatchPath, "utf8")).toBe(pBatchBefore);
			expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: cf.root, encoding: "utf8" }).trim()).toBe(cHeadBefore);
			expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim()).toBe(pHeadBefore);
		}

		// 15. Parity scenario: COMPLETED BATCH REPLAY CONFORMANCE
		// (Terminal records must not be treated as corrupt; both hosts replay completed batches idempotently)
		{
			const sharedReplaySlug = "conf-replay";
			const cf = createConformanceFixture(`${sharedReplaySlug}-c`);
			const pf = createConformanceFixture(`${sharedReplaySlug}-p`);

			let cLastCommit: string | null = null;
			const cr = createMcpRuntime({
				cwd: cf.root,
				env: ENV,
				interactive: true,
				readInitiative: async () => cf.observation,
				batchKernel: {
					advanceTask: async () => {
						writeFileSync(join(cf.root, ".imm", "state", "workspace.json"), JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }));
						const claimPath = join(cf.root, ".imm", "state", "active-claim.json");
						if (existsSync(claimPath)) rmSync(claimPath, { force: true });
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(cf.root, "dummy.txt"), `${Date.now()}`);
						execFileSync("git", ["add", "dummy.txt"], { cwd: cf.root });
						execFileSync("git", ["commit", "-q", "-m", "c commit"], { cwd: cf.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: cf.root, encoding: "utf8" }).trim();
						cLastCommit = commit;
						return { commit };
					},
					lookupBatchCommit: async () => (cLastCommit ? { commit: cLastCommit } : null),
				},
				requestConfirmation: async () => ({ decision: "accept", requestId: "r-rp1" }),
			});
			cr.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			const cRes1 = await cr.callTool("start_unattended_batch", { initiative_slug: `${sharedReplaySlug}-c` }, { toolCallId: "toolu-rp1" });

			let pLastCommit: string | null = null;
			const pRes1 = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedReplaySlug}-p`,
				interactive: true,
				readInitiative: async () => pf.observation,
				batchKernel: {
					advanceTask: async () => {
						writeFileSync(join(pf.root, ".imm", "state", "workspace.json"), JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }));
						const claimPath = join(pf.root, ".imm", "state", "active-claim.json");
						if (existsSync(claimPath)) rmSync(claimPath, { force: true });
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(pf.root, "dummy.txt"), `${Date.now()}`);
						execFileSync("git", ["add", "dummy.txt"], { cwd: pf.root });
						execFileSync("git", ["commit", "-q", "-m", "p commit"], { cwd: pf.root });
						const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim();
						pLastCommit = commit;
						return { commit };
					},
					lookupBatchCommit: async () => (pLastCommit ? { commit: pLastCommit } : null),
				},
				confirmBatch: async () => "accept",
			});

			expect(cRes1.state).toBe("started");
			expect(pRes1.state).toBe("started");
			expect(cRes1.report.batch_state).toBe("completed");
			expect(pRes1.report.batch_state).toBe("completed");

			const cBatchPath = join(cf.root, ".imm", "state", "batches", `${cRes1.batch_id}.json`);
			const pBatchPath = join(pf.root, ".imm", "state", "batches", `${pRes1.batch_id}.json`);
			const cBatchBefore = readFileSync(cBatchPath, "utf8");
			const pBatchBefore = readFileSync(pBatchPath, "utf8");
			const cHeadBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: cf.root, encoding: "utf8" }).trim();
			const pHeadBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim();

			// Calling again after completion must idempotently replay the terminal state without re-enrollment
			const cRes2 = await cr.callTool("start_unattended_batch", { initiative_slug: `${sharedReplaySlug}-c` }, { toolCallId: "toolu-rp2" });
			const pRes2 = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedReplaySlug}-p`,
				interactive: true,
				readInitiative: async () => pf.observation,
				batchKernel: {
					lookupBatchCommit: async () => (pLastCommit ? { commit: pLastCommit } : null),
				},
				confirmBatch: async () => "accept",
			});

			expect(cRes2.state).toBe("started");
			expect(pRes2.state).toBe("started");
			expect(cRes2.report.batch_state).toBe("completed");
			expect(pRes2.report.batch_state).toBe("completed");
			expect(readFileSync(cBatchPath, "utf8")).toBe(cBatchBefore);
			expect(readFileSync(pBatchPath, "utf8")).toBe(pBatchBefore);
			expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: cf.root, encoding: "utf8" }).trim()).toBe(cHeadBefore);
			expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim()).toBe(pHeadBefore);
		}

		// 16. Parity scenario: FOREIGN CLAIM APPEARING DURING THE POST-CONFIRMATION
		// PLAN REVALIDATION READ
		// (a claim that lands while the second Initiative read is in flight must
		// still block both hosts before any branch or batch state is created)
		{
			const sharedLateSlug = "conf-lateclaim";
			const cf = createConformanceFixture(`${sharedLateSlug}-c`);
			const pf = createConformanceFixture(`${sharedLateSlug}-p`);

			const injectClaim = (root: string, taskId: string): void => {
				const createdAt = new Date().toISOString();
				writeFileSync(
					join(root, ".imm", "state", "active-claim.json"),
					JSON.stringify({
						contract: "assurance_kernel/backend_claim/v2",
						backend: "kernel",
						task_id: taskId,
						intent_revision: 1,
						intent_content_hash: `sha256:${"f".repeat(64)}`,
						enrollment_event_id: `enroll-${taskId}-${createdAt}`,
						lifecycle_status: "active",
						created_at: createdAt,
						updated_at: createdAt,
					}),
				);
			};

			let cReads = 0;
			const cr = createMcpRuntime({
				cwd: cf.root,
				env: ENV,
				interactive: true,
				readInitiative: async () => {
					cReads++;
					if (cReads === 2) injectClaim(cf.root, "some-other-task");
					return cf.observation;
				},
				requestConfirmation: async () => ({ decision: "accept", requestId: "r-late-c" }),
			});
			cr.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			const cRes = await cr.callTool("start_unattended_batch", { initiative_slug: `${sharedLateSlug}-c` }, { toolCallId: "toolu-late" });

			let pReads = 0;
			const pRes = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedLateSlug}-p`,
				interactive: true,
				readInitiative: async () => {
					pReads++;
					if (pReads === 2) injectClaim(pf.root, "some-other-task");
					return pf.observation;
				},
				confirmBatch: async () => "accept",
			});

			expect(cRes.state).toBe("blocked");
			expect(pRes.state).toBe("blocked");
			expect(cRes.reason).toBe(pRes.reason);
			expect(cRes.reason).toContain("an active workspace claim appeared during confirmation");
			expect(cRes.recovery_action).toBe(pRes.recovery_action);
			assertZeroWrites(cf, pf);
			expect(existsSync(join(cf.root, ".imm", "state", "batches"))).toBe(false);
			expect(existsSync(join(pf.root, ".imm", "state", "batches"))).toBe(false);
		}

		// 17. Parity scenario: PENDING KERNEL TRANSACTION STAYS UNTOUCHED
		// (a pre-confirmation refusal must not run Kernel transaction recovery,
		// which the locking TaskRecord read would have done as a side effect)
		{
			const sharedPendingSlug = "conf-pendingtxn";
			const cf = createConformanceFixture(`${sharedPendingSlug}-c`);
			const pf = createConformanceFixture(`${sharedPendingSlug}-p`);

			/** Every byte under .imm/state, so any Kernel write is visible. */
			const snapshotState = (root: string): string => {
				const base = join(root, ".imm", "state");
				const out: string[] = [];
				const walk = (dir: string): void => {
					if (!existsSync(dir)) return;
					for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
						const full = join(dir, entry.name);
						if (entry.isDirectory()) walk(full);
						else out.push(`${full.slice(base.length)}:${readFileSync(full, "utf8")}`);
					}
				};
				walk(base);
				return out.join("\n");
			};

			let cStep = 0;
			let cLastCommit: string | null = null;
			const cr = createMcpRuntime({
				cwd: cf.root,
				env: ENV,
				interactive: true,
				readInitiative: async () => cf.observation,
				batchKernel: {
					advanceTask: async () => {
						cStep++;
						if (cStep === 1) return { state: "review_ready", operation_id: "c-pending", agent_params: { prompt: "review" } as never };
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(cf.root, "src", "impl.ts"), `export const impl = ${cStep}; // pending\n`);
						execFileSync("git", ["add", "-A"], { cwd: cf.root });
						execFileSync("git", ["commit", "-q", "-m", "c pending commit"], { cwd: cf.root });
						cLastCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: cf.root, encoding: "utf8" }).trim();
						return { commit: cLastCommit };
					},
					lookupBatchCommit: async () => (cLastCommit ? { commit: cLastCommit } : null),
				},
				requestConfirmation: async () => ({ decision: "accept", requestId: "r-pending-1" }),
			});
			cr.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			const cFirst = await cr.callTool("start_unattended_batch", { initiative_slug: `${sharedPendingSlug}-c` }, { toolCallId: "toolu-pending1" });

			let pStep = 0;
			let pLastCommit: string | null = null;
			const pBatchKernel = {
				advanceTask: async () => {
					pStep++;
					if (pStep === 1) return { state: "review_ready", operation_id: "p-pending", agent_params: { prompt: "review" } as never };
					return { state: "completed" };
				},
				commitChild: async () => {
					writeFileSync(join(pf.root, "src", "impl.ts"), `export const impl = ${pStep}; // pending\n`);
					execFileSync("git", ["add", "-A"], { cwd: pf.root });
					execFileSync("git", ["commit", "-q", "-m", "p pending commit"], { cwd: pf.root });
					pLastCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim();
					return { commit: pLastCommit };
				},
				lookupBatchCommit: async () => (pLastCommit ? { commit: pLastCommit } : null),
			};
			const pFirst = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedPendingSlug}-p`,
				interactive: true,
				readInitiative: async () => pf.observation,
				batchKernel: pBatchKernel,
				confirmBatch: async () => "accept",
			});

			expect(cFirst.state).toBe("started");
			expect(pFirst.state).toBe("started");

			// A well-formed pending v2 transaction that recovery would complete.
			// Its hashes match the current bytes, so the locking read really writes.
			for (const [root, taskId] of [[cf.root, `${sharedPendingSlug}-c-c1`], [pf.root, `${sharedPendingSlug}-p-c1`]] as const) {
				const recordPath = join(root, ".imm", "state", "tasks", `${taskId}.json`);
				const workspacePath = join(root, ".imm", "state", "workspace.json");
				const recordBytes = readFileSync(recordPath, "utf8");
				const workspaceBytes = readFileSync(workspacePath, "utf8");
				mkdirSync(join(root, ".imm", "state", "transactions"), { recursive: true });
				writeFileSync(
					join(root, ".imm", "state", "transactions", "workspace-transaction-v2.json"),
					`${JSON.stringify({
						contract: "assurance_kernel/workspace_transaction/v2",
						task_id: taskId,
						expected_record_hash: revisionForContent(recordBytes),
						next_record_content: `${recordBytes}\n`,
						expected_workspace_hash: revisionForContent(workspaceBytes),
						next_workspace_content: workspaceBytes,
					}, null, 2)}\n`,
				);
			}
			const cBefore = snapshotState(cf.root);
			const pBefore = snapshotState(pf.root);

			const cr2 = createMcpRuntime({
				cwd: cf.root,
				env: ENV,
				interactive: true,
				readInitiative: async () => cf.observation,
				requestConfirmation: async () => ({ decision: "decline", requestId: "r-pending-2" }),
			});
			cr2.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			const cRes = await cr2.callTool("start_unattended_batch", { initiative_slug: `${sharedPendingSlug}-c` }, { toolCallId: "toolu-pending2" });

			const pRes = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedPendingSlug}-p`,
				interactive: true,
				readInitiative: async () => pf.observation,
				confirmBatch: async () => "decline",
			});

			expect(cRes.state).toBe("rejected");
			expect(pRes.state).toBe("rejected");
			expect(cRes.reason).toBe(pRes.reason);
			expect(cRes.recovery_action).toBe(pRes.recovery_action);
			// Byte-for-byte: the pending transaction is untouched and nothing was written.
			expect(snapshotState(cf.root)).toBe(cBefore);
			expect(snapshotState(pf.root)).toBe(pBefore);
		}

		// 18. Parity scenario: RUNNING BATCH RESUMES AFTER ITS AUTHORIZATION EXPIRED
		// (two children; the batch pauses on child 1's Review past expiry, then the
		// user re-confirms: both hosts must complete both children instead of
		// stopping the second as budget_stopped on a stale stamp)
		{
			const sharedRenewSlug = "conf-renew";
			const cf = createConformanceFixture(`${sharedRenewSlug}-c`, ["src/impl.ts"], true);
			const pf = createConformanceFixture(`${sharedRenewSlug}-p`, ["src/impl.ts"], true);

			let cStep = 0;
			let cLastCommit: string | null = null;
			const cr = createMcpRuntime({
				cwd: cf.root,
				env: ENV,
				interactive: true,
				readInitiative: async () => cf.observation,
				batchKernel: {
					advanceTask: async () => {
						cStep++;
						if (cStep === 1) return { state: "review_ready", operation_id: "c-renew", agent_params: { prompt: "review" } as never };
						writeFileSync(join(cf.root, ".imm", "state", "workspace.json"), JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }));
						const claimPath = join(cf.root, ".imm", "state", "active-claim.json");
						if (existsSync(claimPath)) rmSync(claimPath, { force: true });
						return { state: "completed" };
					},
					commitChild: async () => {
						writeFileSync(join(cf.root, "src", "impl.ts"), `export const impl = ${cStep}; // renew\n`);
						execFileSync("git", ["add", "-A"], { cwd: cf.root });
						execFileSync("git", ["commit", "-q", "-m", "c renew commit"], { cwd: cf.root });
						cLastCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: cf.root, encoding: "utf8" }).trim();
						return { commit: cLastCommit };
					},
					lookupBatchCommit: async () => (cLastCommit ? { commit: cLastCommit } : null),
				},
				requestConfirmation: async () => ({ decision: "accept", requestId: "r-renew-1" }),
			});
			cr.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			const cRes1 = await cr.callTool("start_unattended_batch", { initiative_slug: `${sharedRenewSlug}-c` }, { toolCallId: "toolu-renew1" });

			let pStep = 0;
			let pLastCommit: string | null = null;
			const pBatchKernel = {
				advanceTask: async () => {
					pStep++;
					if (pStep === 1) return { state: "review_ready", operation_id: "p-renew", agent_params: { prompt: "review" } as never };
					writeFileSync(join(pf.root, ".imm", "state", "workspace.json"), JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }));
					const claimPath = join(pf.root, ".imm", "state", "active-claim.json");
					if (existsSync(claimPath)) rmSync(claimPath, { force: true });
					return { state: "completed" };
				},
				commitChild: async () => {
					writeFileSync(join(pf.root, "src", "impl.ts"), `export const impl = ${pStep}; // renew\n`);
					execFileSync("git", ["add", "-A"], { cwd: pf.root });
					execFileSync("git", ["commit", "-q", "-m", "p renew commit"], { cwd: pf.root });
					pLastCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pf.root, encoding: "utf8" }).trim();
					return { commit: pLastCommit };
				},
				lookupBatchCommit: async () => (pLastCommit ? { commit: pLastCommit } : null),
			};
			const pRes1 = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedRenewSlug}-p`,
				interactive: true,
				readInitiative: async () => pf.observation,
				batchKernel: pBatchKernel,
				confirmBatch: async () => "accept",
			});

			expect(cRes1.state).toBe("started");
			expect(pRes1.state).toBe("started");
			expect(cRes1.report.batch_state).toBe("running");
			expect(pRes1.report.batch_state).toBe("running");

			// The authorization elapses while the batch waits on the reserved Review.
			for (const [root, batchId] of [[cf.root, cRes1.batch_id], [pf.root, pRes1.batch_id]] as const) {
				const batchPath = join(root, ".imm", "state", "batches", `${batchId}.json`);
				const record = JSON.parse(readFileSync(batchPath, "utf8"));
				record.authorization_expires_at = "2020-01-01T00:00:00.000Z";
				writeFileSync(batchPath, `${JSON.stringify(record, null, 2)}\n`);
			}

			const cRes2 = await cr.callTool("start_unattended_batch", { initiative_slug: `${sharedRenewSlug}-c` }, { toolCallId: "toolu-renew2" });
			const pRes2 = await executePiUnattendedBatch({
				root: pf.root,
				initiativeSlug: `${sharedRenewSlug}-p`,
				interactive: true,
				readInitiative: async () => pf.observation,
				batchKernel: pBatchKernel,
				confirmBatch: async () => "accept",
			});

			expect(cRes2.state).toBe("started");
			expect(pRes2.state).toBe("started");
			expect(cRes2.report.batch_state).toBe("completed");
			expect(pRes2.report.batch_state).toBe("completed");
			expect(cRes2.report.children.map((child: { state: string }) => child.state)).toEqual(pRes2.report.children.map((child: { state: string }) => child.state));
		}
	},
		120_000,
	);
});
