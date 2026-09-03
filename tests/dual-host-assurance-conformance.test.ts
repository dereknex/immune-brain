import { describe, expect, test } from "bun:test";
import {
	AssuranceCoordinator,
	snapshotDigest,
	type AssuranceCoordinatorPorts,
	type AssuranceVerdict,
	type SnapshotDescriptor,
} from "../plugins/immune-brain/runtime/assurance/coordinator";
import { AssuranceProgression } from "../plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts";
import { PassThrough } from "node:stream";
import { ClaudeReviewHost, REVIEWER_AGENT, AGENT_TOOL } from "../plugins/immune-brain/runtime/claude/review_host";
import { submitClaudeReview } from "../plugins/immune-brain/runtime/claude/kernel_ports";
import { probeHost } from "../plugins/immune-brain/runtime/claude/capability";
import { createMcpRuntime, serveStdio } from "../plugins/immune-brain/runtime/claude/mcp_server";
import type { ReviewBundle } from "../plugins/immune-brain/runtime/assurance/review_evidence";

const TASK = "dual-host-task";
const ROOT = "/tmp/dual-host-assurance";
const ctx = { cwd: ROOT };

type Risk = "routine" | "material" | "critical";
type Obligation = "submit_assurance" | "run_qa" | "run_review" | "complete" | "authorize_user" | "none";

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
			else nextObligation = risk === "critical" ? "authorize_user" : "complete";
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
				lifecycle = "done";
				nextObligation = "none";
			}
		},
	};
	};
	return {
		applyCounts,
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
		expect(await submitObservedReview(c)).toMatchObject({ state: "awaiting_user" });
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

	test("authorize_user projection resumes on the other host without re-running authority", async () => {
		const kernel = sharedKernel("critical");
		const claude = kernel.claude();
		const ready = await claude.coordinator.advance(TASK, ctx);
		completeClaudeReview(claude.host, (ready as { operation_id: string }).operation_id, "critical");
		expect(await submitObservedReview(claude)).toMatchObject({ state: "awaiting_user" });
		await claude.coordinator.onSessionShutdown();
		kernel.releaseClaim();
		const pi = kernel.pi();
		expect(await pi.advance(TASK, ctx as never)).toMatchObject({ state: "awaiting_user" });
		expect(kernel.applyCounts.value).toBe(2); // qa + review only
	});

	test("terminal projections reconcile idempotently on both hosts", async () => {
		const kernel = sharedKernel("material");
		kernel.done();
		expect(await kernel.pi().advance(TASK, ctx as never)).toEqual({ state: "completed" });
		kernel.releaseClaim();
		expect(await kernel.claude().coordinator.advance(TASK, ctx)).toEqual({ state: "completed" });
		expect(kernel.applyCounts.value).toBe(0); // no re-settlement of a terminal task
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
	});

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
});
