import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { join, resolve } from "node:path";
import {
	AssuranceCoordinator,
	snapshotDigest,
	type AssuranceCoordinatorPorts,
	type AssuranceVerdict,
	type SnapshotDescriptor,
} from "../plugins/immune-brain/runtime/assurance/coordinator";
import type { ReviewBundle } from "../plugins/immune-brain/runtime/assurance/review_evidence";
import { tmpdir } from "node:os";
import { ClaudeReviewHost, FileHookEventLog, MemoryHookEventLog, hookEventPath, parseHookStdin, REVIEWER_AGENT, AGENT_TOOL } from "../plugins/immune-brain/runtime/claude/review_host";
import { createMcpRuntime, handleJsonRpc, listMcpTools, serveStdio } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { ClaudeRuntime, diffHashOf, diffSnapshotOf, submitClaudeReview, type ToolMeta } from "../plugins/immune-brain/runtime/claude/kernel_ports";
import { createCanaryApplication, capabilityActionFor } from "../plugins/immune-brain/runtime/kernel/canary_application";
import { createMutationAuthorityRegistry, digestOfAction } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { createMutationAuthorityCapabilityForTest } from "./fixtures/mutation-authority-test-seam";
import { findingsDigestV2 } from "../plugins/immune-brain/runtime/kernel/reducer";
import { readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { confirmationRef, evaluateNativeGate, PRIVILEGED_OPERATIONS } from "../plugins/immune-brain/runtime/claude/interaction";
import { readTaskRecord } from "../plugins/immune-brain/runtime/kernel/storage";
import { projectAssurance } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { probeHost } from "../plugins/immune-brain/runtime/claude/capability";
import { PLUGIN_VERSION } from "../plugins/immune-brain/runtime/plugin_version";

const TASK = "phase3-task";
const ROOT = "/tmp/claude-host-authority";
const ctx = { cwd: ROOT };
const ENV = { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" };

function projection(
	lifecycle: "active" | "done" | "stopped" = "active",
	nextObligation: "run_qa" | "run_review" | "complete" | "none" = "run_qa",
	risk: "routine" | "material" | "critical" = "material",
	artifactState: "active" | "frozen" = "frozen",
) {
	return {
		error: null,
		claim: { task_id: TASK, lifecycle_status: lifecycle === "active" ? "active" : "terminal" },
		projection: {
			lifecycle,
			artifact_state: artifactState,
			risk,
			next_obligation: nextObligation,
			record_revision: "record-1",
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
			completion_ready: false,
			authorization: { state: "blocked" },
		},
	} as never;
}

function snapshot(role: "qa" | "review"): SnapshotDescriptor {
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
		risk: "material",
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

function completeReview(host: ClaudeReviewHost, operationId: string, result: string, sessionId = "s1") {
	const agentId = `agent-${operationId}`;
	host.observe({ type: "SubagentStart", sessionId, agent: REVIEWER_AGENT, agentId, taskId: TASK, operationId });
	host.observe({ type: "PostToolUse", sessionId, agentId, toolName: AGENT_TOOL, result, taskId: TASK, operationId });
	host.observe({ type: "SubagentStop", sessionId, agent: REVIEWER_AGENT, agentId, taskId: TASK, operationId });
}

function reviewRequest(operationId: string, prompt = `prompt-${operationId}`) {
	return { taskId: TASK, operationId, prompt, evidencePath: "/tmp/review.json", maxTurns: 1 };
}

function authorityFixtureRoot(taskId: string, withSpec = false): { root: string; intent: Record<string, unknown> } {
	const root = mkdtempSync(join(tmpdir(), "claude-breaking-approval-"));
	const intent = {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		owner: "user",
		goal: "exercise breaking approval",
		acceptance: [{ id: "acc-1", assertion: "initial assertion", verification: "bun test" }],
		scope_hint: [
			`docs/plans/${taskId}.intent.json`,
			...(withSpec ? [`docs/specs/${taskId}.spec.md`, `docs/specs/archive/${taskId}.spec.md`] : []),
		],
		risk: "routine",
		revision: 1,
	};
	mkdirSync(join(root, ".imm", "state"), { recursive: true });
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	writeFileSync(join(root, "docs", "plans", `${taskId}.intent.json`), `${JSON.stringify(intent, null, 2)}\n`);
	if (withSpec) {
		mkdirSync(join(root, "docs", "specs", "archive"), { recursive: true });
		writeFileSync(join(root, "docs", "specs", `${taskId}.spec.md`), `# ${taskId}\n`);
	}
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "fixture"], { cwd: root });
	return { root, intent };
}

function jsonLineReader(output: PassThrough): () => Promise<Record<string, unknown>> {
	let buffer = "";
	const queue: Record<string, unknown>[] = [];
	const waiters: Array<(value: Record<string, unknown>) => void> = [];
	output.on("data", (chunk) => {
		buffer += chunk.toString();
		while (buffer.includes("\n")) {
			const newline = buffer.indexOf("\n");
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			if (!line) continue;
			const value = JSON.parse(line) as Record<string, unknown>;
			const waiter = waiters.shift();
			if (waiter) waiter(value); else queue.push(value);
		}
	});
	return () => queue.length ? Promise.resolve(queue.shift()!) : new Promise((resolve) => waiters.push(resolve));
}

async function runWireEnrollment(response: Record<string, unknown>, options: { cancelOuter?: boolean; replay?: boolean; unknownFirst?: boolean } = {}) {
	const taskId = `wire-${Math.random().toString(16).slice(2)}`;
	const fixture = authorityFixtureRoot(taskId);
	const input = new PassThrough();
	const output = new PassThrough();
	const next = jsonLineReader(output);
	const server = serveStdio({
		input,
		output,
		runtime: createMcpRuntime({ cwd: fixture.root, env: ENV }),
		exit: () => undefined,
	});
	const send = (message: unknown) => input.write(`${JSON.stringify(message)}\n`);
	send({
		jsonrpc: "2.0",
		id: "init",
		method: "initialize",
		params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1.236" }, capabilities: { elicitation: {} } },
	});
	await next();
	send({
		jsonrpc: "2.0",
		id: "outer",
		method: "tools/call",
		params: { name: "enroll", arguments: { task_id: taskId }, _meta: { "claudecode/toolUseId": "toolu-wire" } },
	});
	const elicitation = await next();
	if (options.cancelOuter) {
		send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "outer" } });
	} else {
		if (options.unknownFirst) send({ jsonrpc: "2.0", id: "unknown-elicitation", ...response });
		send({ jsonrpc: "2.0", id: elicitation.id, ...response });
		if (options.replay) send({ jsonrpc: "2.0", id: elicitation.id, ...response });
	}
	const result = await next();
	input.end();
	await server;
	return { taskId, root: fixture.root, elicitation, result };
}

function reviewLifecycle(host: ClaudeReviewHost, input: { sessionId?: string; agentId: string; operationId?: string; taskId?: string; prompt?: string; result: string }) {
	const sessionId = input.sessionId ?? "s";
	host.observe({ type: "SubagentStart", sessionId, agent: REVIEWER_AGENT, agentId: input.agentId, taskId: input.taskId, operationId: input.operationId, prompt: input.prompt });
	host.observe({ type: "PostToolUse", sessionId, agentId: input.agentId, toolName: AGENT_TOOL, result: input.result, taskId: input.taskId, operationId: input.operationId });
	host.observe({ type: "SubagentStop", sessionId, agent: REVIEWER_AGENT, agentId: input.agentId, taskId: input.taskId, operationId: input.operationId });
}

function makeCoordinator(overrides: {
	risk?: "routine" | "material" | "critical";
	host?: ClaudeReviewHost;
	project?: AssuranceCoordinatorPorts["projectTask"];
} = {}) {
	let applyCount = 0;
	const risk = overrides.risk ?? "material";
	let currentLifecycle: "active" | "done" | "stopped" = "active";
	let artifactState: "active" | "frozen" = "frozen";
	let nextObligation: "run_qa" | "run_review" | "complete" | "none" = "run_qa";
	const host = overrides.host ?? new ClaudeReviewHost();
	const ports: AssuranceCoordinatorPorts = {
		host,
		projectTask: overrides.project ?? (async () => projection(currentLifecycle, nextObligation, risk, artifactState)),
		readTaskRecord: async () => ({ record: { findings: [] } }),
		readTaskIntent: async () => ({ token: "intent-token" }),
		frozenRunner: async () => ({ runner_id: "bun", path: "/bun", dev: 1, ino: 1, content_hash: "sha256:x", version: "1.3.14" }),
		buildAssurance: async (_root, _task, role) => ({
			snapshot: snapshot(role),
			descriptors: new Map([[
				"A1",
				{ contract: "assurance_kernel/verification_descriptor/v1", runner_id: "bun", runner_version: "1.3.14", argv: ["test"], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 },
			]] as never),
			reviewBundle: role === "review" ? reviewBundle() : null,
		}),
		runQa: async (s) => passVerdict(s),
		writeReviewEvidence: () => ({ path: `${ROOT}/review.json`, remove: () => undefined }),
		applyVerdict: async (_ctx, input) => {
			applyCount += 1;
			await input.hooks?.beforeCommit?.();
			input.hooks?.onCommit?.();
			if (input.verdict.decision === "rework") {
				artifactState = "active";
				nextObligation = "run_qa";
			} else if (input.snapshot.role === "qa") {
				nextObligation = risk === "routine" ? "complete" : "run_review";
			} else {
				nextObligation = "complete";
			}
			await input.hooks?.afterCommit?.();
		},
		applyOrdinaryOperation: async (_ctx, input) => {
			if (input.operation.op === "complete") {
				currentLifecycle = "done";
				nextObligation = "none";
			}
		},
	};
	return { coordinator: new AssuranceCoordinator(ports), host, ports, counts: () => ({ applyCount }) };
}

async function submitObservedReview(
	h: { coordinator: AssuranceCoordinator; host: ClaudeReviewHost },
	taskId = TASK,
	verdict?: unknown,
) {
	const observed = h.host.inspectReviewForTask(taskId);
	if (!observed.ok) {
		if (observed.release) return h.coordinator.abandonReview(taskId, observed.reason);
		return { state: "blocked" as const, reason: observed.reason };
	}
	return submitClaudeReview(h.host, h.coordinator, ctx, taskId, verdict ?? observed.receipt.result);
}

describe("claude host authority", () => {
	test("privileged tools use the standard MCP destructive hint without vendor permission metadata", () => {
		const tools = listMcpTools();
		for (const name of ["enroll", "request_authorization", "approve_breaking_intent_revision", "stop"]) {
			expect(tools.find((tool) => tool.name === name)?.annotations).toEqual({ destructiveHint: true });
		}
		const submitReview = tools.find((tool) => tool.name === "submit_review");
		expect(submitReview?.inputSchema.required).toEqual(["task_id", "verdict"]);
		expect(submitReview?.inputSchema.properties).toHaveProperty("verdict");
	});

	test("production runtime exposes no direct-decision authority seam", () => {
		const source = [
			readFileSync(join(process.cwd(), "plugins/immune-brain/runtime/claude/kernel_ports.ts"), "utf8"),
			readFileSync(join(process.cwd(), "plugins/immune-brain/runtime/claude/mcp_server.ts"), "utf8"),
		].join("\n");
		expect(source).not.toContain("configured-test-decision");
		expect(source).not.toContain("meta.decision");
		expect(source).not.toMatch(/decisions\??:\s*Map/);
	});

	test("only an exact native action can authorize", () => {
		const base = { operation: "enroll", interactive: true } as const;
		expect(evaluateNativeGate({ ...base, decision: "accept" }).ok).toBe(true);
		expect(evaluateNativeGate({ ...base, decision: "decline" }).ok).toBe(false);
		expect(evaluateNativeGate({ ...base, decision: "cancel" }).ok).toBe(false);
		expect(evaluateNativeGate({ ...base, interactive: false, decision: "accept" }).ok).toBe(false);
		expect(evaluateNativeGate(base).ok).toBe(false);
		expect(probeHost({ CLAUDE_CODE_VERSION: "2.1.100" }).ok).toBe(false);
	});

	test("permission modes are non-authoritative and cannot replace native elicitation", async () => {
		const h = makeCoordinator();
		const root = authorityFixtureRoot(TASK).root;
		const mcp = createMcpRuntime({
			cwd: root,
			env: { ...ENV, CLAUDE_CODE_PERMISSION_MODE: "future-mode" },
			ports: h.ports,
			interactive: true,
			host: new ClaudeReviewHost(),
		});
		await handleJsonRpc({
			jsonrpc: "2.0",
			id: 0,
			method: "initialize",
			params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1.236" }, capabilities: { elicitation: {} } },
		}, mcp);
		await expect(mcp.callTool("enroll", { task_id: TASK }, {
			interactive: true,
			sessionId: "s",
			toolCallId: "c1",
			taskId: TASK,
		})).rejects.toThrow("interaction_not_opened");
		expect(h.counts().applyCount).toBe(0);
	});


	test("confirmation refs bind the exact intent, connection, and nested request", () => {
		const base = { connectionId: "s", toolCallId: "t", requestId: "nested", operation: "approve_breaking_intent_revision", taskId: TASK };
		expect(confirmationRef({ ...base, intentRevision: 2, intentContentHash: "sha256:next", bindingDigest: "sha256:diff" }))
			.not.toBe(confirmationRef({ ...base, requestId: "other", intentRevision: 2, intentContentHash: "sha256:next", bindingDigest: "sha256:diff" }));
		expect(confirmationRef({ ...base, intentRevision: 2, intentContentHash: "sha256:next", bindingDigest: "sha256:diff" }))
			.not.toBe(confirmationRef({ ...base, intentRevision: 3, intentContentHash: "sha256:other", bindingDigest: "sha256:diff" }));
	});

	test("stdio MCP elicitation accepts once and binds the prepared task identity", async () => {
		const { root, taskId, elicitation, result } = await runWireEnrollment(
			{ result: { action: "accept", content: {} } },
			{ replay: true, unknownFirst: true },
		);
		expect(elicitation).toMatchObject({ jsonrpc: "2.0", method: "elicitation/create" });
		const message = ((elicitation.params as { message?: string }).message ?? "");
		expect(message).toContain(`Task: ${taskId}`);
		expect(message).toContain("Risk: routine");
		expect(message).toContain("Intent revision: 1");
		expect(message).toContain("Intent hash: sha256:");
		expect(message).toContain("Binding digest:");
		expect(JSON.stringify(result)).not.toContain("error");
		expect(JSON.parse(readFileSync(join(root, ".imm", "state", "workspace.json"), "utf8")).current_working).toBe(taskId);
	});

	test("decline, cancel, malformed response, unsupported elicitation, and outer cancellation mint zero authority", async () => {
		const cases = [
			{ response: { result: { action: "decline" } }, code: "user_denied" },
			{ response: { result: { action: "cancel" } }, code: "user_cancelled" },
			{ response: { result: { action: "yes" } }, code: "correlation_missing" },
			{ response: { result: { action: "accept" } }, code: "correlation_missing" },
			{ response: { result: { action: "accept", content: "yes" } }, code: "correlation_missing" },
			{ response: { result: { action: "accept", content: { unexpected: true } } }, code: "correlation_missing" },
			{ response: { jsonrpc: "1.0", result: { action: "accept", content: {} } }, code: "correlation_missing" },
			{ response: { method: "spoofed/request", result: { action: "accept", content: {} } }, code: "correlation_missing" },
			{ response: { error: { code: -32601, message: "method not found" } }, code: "unsupported_host" },
		];
		for (const item of cases) {
			const result = await runWireEnrollment(item.response);
			expect(JSON.stringify(result.result)).toContain(item.code);
			expect(existsSync(join(result.root, ".imm", "state", "workspace.json"))).toBe(false);
		}
		const cancelled = await runWireEnrollment({}, { cancelOuter: true });
		expect(JSON.stringify(cancelled.result)).toContain("user_cancelled");
		expect(existsSync(join(cancelled.root, ".imm", "state", "workspace.json"))).toBe(false);
	});

	test("stdio output stream error terminates serveStdio and rejects pending elicitation", async () => {
		const taskId = "wire-output-disconnect";
		const fixture = authorityFixtureRoot(taskId);
		const input = new PassThrough();
		const output = new PassThrough();
		const next = jsonLineReader(output);
		const exitCodes: number[] = [];
		const priorExitCode = process.exitCode;
		const serverPromise = serveStdio({
			input,
			output,
			runtime: createMcpRuntime({ cwd: fixture.root, env: ENV }),
			exit: (code) => exitCodes.push(code),
		});
		input.write(`${JSON.stringify({
			jsonrpc: "2.0",
			id: "init",
			method: "initialize",
			params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1.236" }, capabilities: { elicitation: {} } },
		})}\n`);
		await next();
		input.write(`${JSON.stringify({
			jsonrpc: "2.0",
			id: "outer",
			method: "tools/call",
			params: { name: "enroll", arguments: { task_id: taskId }, _meta: { "claudecode/toolUseId": "toolu-wire" } },
		})}\n`);
		const elicitation = await next();
		expect(elicitation.method).toBe("elicitation/create");
		output.destroy(new Error("stdout broken"));
		await serverPromise;
		expect(exitCodes[0]).toBe(1);
		// serveStdio also sets process.exitCode so the real server still fails
		// even if its injected exit never terminates. Assert that, then restore
		// it: this process is the test runner, and a leaked 1 makes the whole
		// file exit non-zero with every test green, which no QA descriptor can
		// verify.
		expect(process.exitCode).toBe(1);
		process.exitCode = priorExitCode;
		expect(existsSync(join(fixture.root, ".imm", "state", "workspace.json"))).toBe(false);
	});

	test("outer cancellation after native accept blocks capability issuance and commit", async () => {
		const enrollFixture = authorityFixtureRoot("cancel-after-enroll-accept");
		const enrollAbort = new AbortController();
		const enrollRuntime = new ClaudeRuntime({
			cwd: enrollFixture.root,
			env: ENV,
			requestConfirmation: async () => {
				enrollAbort.abort();
				return { decision: "accept", requestId: "nested-enroll" };
			},
		});
		await expect(enrollRuntime.enroll("cancel-after-enroll-accept", {
			taskId: "cancel-after-enroll-accept",
			sessionId: "s",
			toolCallId: "enroll",
			signal: enrollAbort.signal,
		})).rejects.toThrow("user_cancelled");
		expect(existsSync(join(enrollFixture.root, ".imm", "state", "workspace.json"))).toBe(false);

		const authorizeFixture = authorityFixtureRoot("cancel-after-authorize-accept");
		const authorizeRuntime = new ClaudeRuntime({
			cwd: authorizeFixture.root,
			env: ENV,
			requestConfirmation: async ({ operation }) => ({ decision: "accept", requestId: `nested-${operation}` }),
		});
		const baseMeta = { taskId: "cancel-after-authorize-accept", sessionId: "s", toolCallId: "enroll" };
		await authorizeRuntime.enroll("cancel-after-authorize-accept", baseMeta);
		const authorizeAbort = new AbortController();
		authorizeRuntime.bindNativeConfirmation(async () => {
			authorizeAbort.abort();
			return { decision: "accept", requestId: "nested-stop" };
		});
		await expect(authorizeRuntime.authorize("cancel-after-authorize-accept", "stop", {
			...baseMeta,
			toolCallId: "stop",
			signal: authorizeAbort.signal,
		})).rejects.toThrow("user_cancelled");
		expect((await authorizeRuntime.status("cancel-after-authorize-accept")).projection.lifecycle).toBe("active");
	});

	test("breaking approval uses the staged next-state digest and commits successfully", async () => {
		const taskId = "breaking-approval";
		const fixture = authorityFixtureRoot(taskId);
		const runtime = new ClaudeRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			permissionMode: "manual",
			requestConfirmation: async ({ operation }) => ({ decision: "accept", requestId: `nested-${operation}` }),
		});
		const meta = (toolCallId: string): ToolMeta => ({ taskId, sessionId: "s", toolCallId, requiresUserInteraction: true, interactive: true, permissionMode: "manual" });
		await runtime.enroll(taskId, meta("enroll"));
		const nextIntent = { ...fixture.intent, acceptance: [{ id: "acc-1", assertion: "revised assertion", verification: "bun test" }], revision: 2 };
		const result = await runtime.authorize(taskId, "approve_breaking_intent_revision", meta("approve"), { next_intent: nextIntent });
		expect(result.record.intent_snapshot.revision).toBe(2);
		expect(result.record.intent_ref.path).toBe(`docs/plans/${taskId}.intent.json`);
	});





	test("MCP trust binds to the exact claude-code client name; status stays usable without trusted evidence", async () => {
		const h = makeCoordinator();
		const foreign = createMcpRuntime({
			cwd: ROOT,
			// CLAUDE_CODE_VERSION is deliberately set: the environment fallback
			// must stay disabled even after an untrusted handshake.
			env: { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" },
			ports: h.ports,
			host: new ClaudeReviewHost(),
		});
		await handleJsonRpc({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: "2025-06-18", clientInfo: { name: "other-client", version: "9.9.9" }, capabilities: { elicitation: {} } },
		}, foreign);
		// A non-Claude-Code client gets no trusted version or interactivity
		// evidence regardless of declared capabilities.
		await expect(foreign.callTool("advance_assurance", { task_id: TASK })).rejects.toThrow("Claude Code version is unavailable");
		const denied = await handleJsonRpc({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "enroll", arguments: { task_id: TASK }, _meta: { session_id: "s", tool_use_id: "t" } },
		}, foreign);
		expect(JSON.stringify(denied)).toContain("unsupported_host");
		expect((denied?.error?.data as { recovery_action?: string })?.recovery_action).toBe("upgrade to a supported Claude Code version and retry in the current Host");
		// Read-only status remains usable without trusted Host evidence.
		const status = await foreign.callTool("status", { task_id: TASK });
		expect(status).toMatchObject({ plugin_version: PLUGIN_VERSION });
		expect(h.counts().applyCount).toBe(0);
	});

	test("ordered Claude Review receipts settle material tasks", async () => {
		const host = new ClaudeReviewHost();
		const h = makeCoordinator({ host });
		const ready = await h.coordinator.advance(TASK, ctx);
		expect(ready.state).toBe("review_ready");
		const op = (ready as { operation_id: string }).operation_id;
		const result = JSON.stringify(passVerdict(snapshot("review")));
		host.observe({ type: "SubagentStart", sessionId: "s", agent: REVIEWER_AGENT, agentId: "a", taskId: TASK, operationId: op });
		host.observe({ type: "SubagentStop", sessionId: "s", agent: REVIEWER_AGENT, agentId: "a", taskId: TASK, operationId: op });
		host.observe({ type: "PostToolUse", sessionId: "s", agentId: "a", toolName: AGENT_TOOL, result, taskId: TASK, operationId: op });
		expect(await submitObservedReview(h)).toEqual({ state: "completed" });
		expect(h.counts().applyCount).toBe(2);
	});

	test("all 6 permutations of Start, result, Stop in one session settle Review", () => {
		const events = (op: string) => [
			{ type: "SubagentStart" as const, sessionId: "perm-s", agent: REVIEWER_AGENT, agentId: "p-agent", taskId: TASK, operationId: op },
			{ type: "PostToolUse" as const, sessionId: "perm-s", agentId: "p-agent", toolName: AGENT_TOOL, result: "pass", taskId: TASK, operationId: op },
			{ type: "SubagentStop" as const, sessionId: "perm-s", agent: REVIEWER_AGENT, agentId: "p-agent", taskId: TASK, operationId: op },
		];
		const perms = [
			[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
		];
		for (let i = 0; i < perms.length; i++) {
			const host = new ClaudeReviewHost();
			const op = `perm-op-${i}`;
			const reservation = host.prepareReview(reviewRequest(op));
			const evs = events(op);
			for (const idx of perms[i]) host.observe(evs[idx]);
			const consumed = host.consumeReview(reservation);
			expect(consumed).toMatchObject({ ok: true, receipt: { result: "pass", actorId: "claude:p-agent" } });
		}
	});

	test("missing, reordered, wrong-task, stale, malformed, and replayed Review evidence fail before a second mutation", async () => {
		const missing = makeCoordinator();
		const readyMissing = await missing.coordinator.advance(TASK, ctx);
		expect(readyMissing.state).toBe("review_ready");
		expect(await submitObservedReview(missing)).toMatchObject({ reason: "reserved foreground Agent was not observed" });
		expect(missing.counts().applyCount).toBe(1);

		const reordered = new ClaudeReviewHost();
		const hReordered = makeCoordinator({ host: reordered });
		const readyReorder = await hReordered.coordinator.advance(TASK, ctx);
		const op = (readyReorder as { operation_id: string }).operation_id;
		reordered.observe({ type: "SubagentStop", sessionId: "s", agent: REVIEWER_AGENT, agentId: "a", taskId: TASK, operationId: op });
		reordered.observe({ type: "PostToolUse", sessionId: "s", agentId: "a", toolName: AGENT_TOOL, result: JSON.stringify(passVerdict(snapshot("review"))), taskId: TASK, operationId: op });
		expect(await submitObservedReview(hReordered)).toMatchObject({
			reason: "reserved foreground Agent was not observed",
		});
		expect(hReordered.counts().applyCount).toBe(1);

		const wrong = new ClaudeReviewHost();
		const hWrong = makeCoordinator({ host: wrong });
		const readyWrong = await hWrong.coordinator.advance(TASK, ctx);
		const wrongOp = (readyWrong as { operation_id: string }).operation_id;
		completeReview(wrong, "other-op", JSON.stringify(passVerdict(snapshot("review"))));
		expect(await submitObservedReview(hWrong)).toMatchObject({ reason: "reserved foreground Agent was not observed" });
		expect(wrongOp).toBeTruthy();
		expect(hWrong.counts().applyCount).toBe(1);

		const host = new ClaudeReviewHost();
		let reads = 0;
		const stale = makeCoordinator({
			host,
			project: async () => {
				reads += 1;
				if (reads <= 2) return projection("active", reads === 1 ? "run_qa" : "run_review");
				const current = projection("active", "run_review");
				return { ...current, projection: { ...current.projection, record_revision: "changed" } };
			},
		});
		const readyStale = await stale.coordinator.advance(TASK, ctx);
		completeReview(host, (readyStale as { operation_id: string }).operation_id, JSON.stringify(passVerdict(snapshot("review"))));
		expect(await submitObservedReview(stale)).toMatchObject({
			reason: "assurance snapshot changed before Review submission",
		});
		expect(stale.counts().applyCount).toBe(1);

		const malformed = new ClaudeReviewHost();
		const hMal = makeCoordinator({ host: malformed });
		const readyMal = await hMal.coordinator.advance(TASK, ctx);
		const malOp = (readyMal as { operation_id: string }).operation_id;
		completeReview(malformed, malOp, JSON.stringify({ contract: "nope" }));
		expect(await submitObservedReview(hMal)).toMatchObject({ state: "blocked", code: "verdict_invalid" });
		expect(await hMal.coordinator.advance(TASK, ctx)).toMatchObject({ code: "verdict_invalid" });
		expect(hMal.counts().applyCount).toBe(1);
	});

	test("malformed or invalid Reviewer receipt releases the reservation for a new attempt", async () => {
		const host = new ClaudeReviewHost();
		const h = makeCoordinator({ host });
		const ready = await h.coordinator.advance(TASK, ctx) as { state: string; operation_id: string };
		const verdict = passVerdict(snapshot("review"));
		completeReview(host, ready.operation_id, JSON.stringify(verdict).slice(0, -1));
		expect(await submitClaudeReview(host, h.coordinator, ctx, TASK, verdict)).toMatchObject({
			state: "blocked",
			reason: "reviewer receipt is not a valid verdict",
		});
		const retry = await h.coordinator.advance(TASK, ctx) as { state: string; operation_id: string };
		expect(retry.state).toBe("review_ready");
		expect(retry.operation_id).not.toBe(ready.operation_id);
		expect(h.counts().applyCount).toBe(1);

		for (const receipt of [
			JSON.stringify({ contract: "nope" }),
			JSON.stringify({ ...verdict, snapshot_digest: `sha256:${"f".repeat(64)}` }),
			JSON.stringify({ ...verdict, extra: true }),
		]) {
			const receiptHost = new ClaudeReviewHost();
			const receiptHarness = makeCoordinator({ host: receiptHost });
			const receiptReady = await receiptHarness.coordinator.advance(TASK, ctx) as { operation_id: string };
			completeReview(receiptHost, receiptReady.operation_id, receipt);
			expect(await submitClaudeReview(receiptHost, receiptHarness.coordinator, ctx, TASK, verdict)).toMatchObject({
				state: "blocked",
				reason: "reviewer receipt is not a valid verdict",
			});
			const receiptRetry = await receiptHarness.coordinator.advance(TASK, ctx) as { state: string; operation_id: string };
			expect(receiptRetry.state).toBe("review_ready");
			expect(receiptRetry.operation_id).not.toBe(receiptReady.operation_id);
			expect(receiptHarness.counts().applyCount).toBe(1);
		}

		const invalidHost = new ClaudeReviewHost();
		const invalid = makeCoordinator({ host: invalidHost });
		const invalidReady = await invalid.coordinator.advance(TASK, ctx) as { operation_id: string };
		completeReview(invalidHost, invalidReady.operation_id, JSON.stringify(verdict).slice(0, -1));
		expect(await submitClaudeReview(invalidHost, invalid.coordinator, ctx, TASK, { contract: "nope" })).toMatchObject({
			state: "blocked",
			code: "verdict_invalid",
		});
		expect(await invalid.coordinator.advance(TASK, ctx)).toMatchObject({
			state: "blocked",
			code: "verdict_invalid",
		});
		expect(invalid.counts().applyCount).toBe(1);
	});

	test("malformed Parent verdict keeps the Review reservation for a matching retry", async () => {
		const host = new ClaudeReviewHost();
		const h = makeCoordinator({ host });
		const mcp = createMcpRuntime({ cwd: ROOT, env: ENV, ports: h.ports, host });
		await handleJsonRpc({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1.236" }, capabilities: { elicitation: {} } },
		}, mcp);
		const ready = await mcp.callTool("advance_assurance", { task_id: TASK }) as { state: string; operation_id: string };
		expect(ready.state).toBe("review_ready");
		const verdict = passVerdict(snapshot("review"));
		completeReview(host, ready.operation_id, JSON.stringify(verdict));
		await expect(mcp.callTool("submit_review", { task_id: TASK })).rejects.toThrow("verdict is required");
		expect(await mcp.callTool("submit_review", { task_id: TASK, verdict: { ...verdict, extra: true } })).toMatchObject({
			state: "blocked",
			code: "verdict_invalid",
		});
		expect(h.counts().applyCount).toBe(1);
		expect(await mcp.callTool("advance_assurance", { task_id: TASK })).toMatchObject({ code: "verdict_invalid" });
		expect(await mcp.callTool("submit_review", { task_id: TASK, verdict })).toEqual({ state: "completed" });
		expect(h.counts().applyCount).toBe(2);
		expect(await mcp.callTool("submit_review", { task_id: TASK, verdict })).toMatchObject({ state: "blocked" });
	});



	test("request_authorization resolves the single bound user decision", async () => {
		const taskId = "user-decision";
		const fixture = authorityFixtureRoot(taskId);
		const runtime = new ClaudeRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			permissionMode: "manual",
			requestConfirmation: async ({ operation }) => ({ decision: "accept", requestId: `nested-${operation}` }),
		});
		const meta = (toolCallId: string): ToolMeta => ({ taskId, sessionId: "s", toolCallId, requiresUserInteraction: true, interactive: true, permissionMode: "manual" });
		await runtime.enroll(taskId, meta("enroll"));
		const app = createCanaryApplication(createMutationAuthorityRegistry());
		const prior = await readTaskIntent(fixture.root, taskId);
		await app.execute({
			root: fixture.root,
			task_id: taskId,
			operation: {
				op: "record_finding",
				finding: { id: "user-decision-1", kind: "unresolved_user_decision", acceptance_id: null, summary: "awaiting literal user" },
				actor_id: "literal-user",
			} as never,
			prior_intent_token: prior.token,
			diffProvider: (root, record) => diffHashOf(root, record as never),
			now: new Date().toISOString(),
		});
		const result = await runtime.authorize(taskId, "request_authorization", meta("authorize"));
		const finding = (result.record as { findings: Array<{ id: string; status: string }> }).findings.find((item) => item.id === "user-decision-1");
		expect(finding?.status).toBe("resolved");
	});

	test("request_authorization lets the user continue past a replan boundary", async () => {
		const taskId = "authorize-rework";
		const fixture = authorityFixtureRoot(taskId, true);
		const runtime = new ClaudeRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			permissionMode: "manual",
			requestConfirmation: async ({ operation }) => ({ decision: "accept", requestId: `nested-${operation}` }),
		});
		const meta = (toolCallId: string): ToolMeta => ({ taskId, sessionId: "s", toolCallId, requiresUserInteraction: true, interactive: true, permissionMode: "manual" });
		await runtime.enroll(taskId, meta("enroll"));
		const registry = createMutationAuthorityRegistry();
		const app = createCanaryApplication(registry);
		const apply = async (operation: Record<string, unknown>, at: string) => {
			const prior = await readTaskIntent(fixture.root, taskId, readTaskRecord(fixture.root, taskId).record!.intent_ref.path);
			return app.execute({
				root: fixture.root,
				task_id: taskId,
				operation: { ...operation, actor_id: operation.actor_id ?? "reviewer" } as never,
				prior_intent_token: prior.token,
				diffProvider: (root, record) => diffHashOf(root, record as never),
				now: at,
			});
		};
		const rework = async (id: string, at: string) => {
			await apply({ op: "freeze_artifacts", actor_id: "executor" }, at);
			execFileSync("git", ["add", "-A"], { cwd: fixture.root });
			const record = readTaskRecord(fixture.root, taskId);
			const finding = { id, kind: "blocking", status: "open", acceptance_id: "A1", source: "review", review_round: null, summary: "review needs rework" };
			const action = capabilityActionFor({ op: "request_rework", task_id: taskId, at, actor_id: "reviewer", findings: [finding] });
			const capability = createMutationAuthorityCapabilityForTest(registry, {
				authority_kind: "review",
				task_id: taskId,
				action_digest: digestOfAction(action),
				expected_record_hash: record.revision,
				intent_revision: record.record!.intent_snapshot.revision,
				intent_content_hash: record.record!.intent_ref.content_hash,
				diff_hash: diffHashOf(fixture.root, record.record as never),
				actor_id: "reviewer",
				confirmation_ref: `review-${id}`,
				expires_at: "2099-01-01T00:00:00.000Z",
				findings_digest: findingsDigestV2([finding] as never[]),
			});
			await apply({ op: "request_rework", capability, findings: [finding] }, at);
			execFileSync("git", ["add", "-A"], { cwd: fixture.root });
		};
		await rework("review-1", "2098-09-07T00:00:01.000Z");
		await rework("review-2", "2098-09-07T00:00:03.000Z");
		const result = await runtime.authorize(taskId, "request_authorization", meta("authorize"));
		const finding = (result.record as { findings: Array<{ kind: string; status: string }>; lifecycle: string }).findings.find((item) => item.kind === "replan_required");
		expect(result.record.lifecycle).toBe("active");
		expect(finding?.status).toBe("resolved");
	});


	test("native PostToolUse payload correlates through session with the reserved agentId", async () => {
		const host = new ClaudeReviewHost();
		const h = makeCoordinator({ host });
		const ready = await h.coordinator.advance(TASK, ctx);
		const operationId = (ready as { operation_id: string }).operation_id;
		const start = parseHookStdin(JSON.stringify({
			hook_event_name: "SubagentStart",
			session_id: "claude-session",
			agent_id: "agt_1",
			agent_type: REVIEWER_AGENT,
			operation_id: operationId,
			task_id: TASK,
		}));
		const post = parseHookStdin(JSON.stringify({
			hook_event_name: "PostToolUse",
			session_id: "claude-session",
			agent_id: "agt_1",
			tool_name: AGENT_TOOL,
			tool_use_id: "toolu_1",
			tool_response: JSON.stringify(passVerdict(snapshot("review"))),
			operation_id: operationId,
			task_id: TASK,
		}));
		const stop = parseHookStdin(JSON.stringify({
			hook_event_name: "SubagentStop",
			session_id: "claude-session",
			agent_id: "agt_1",
			agent_type: REVIEWER_AGENT,
			operation_id: operationId,
			task_id: TASK,
		}));
		expect(start).not.toBeNull();
		expect(post).not.toBeNull();
		expect(stop).not.toBeNull();
		host.observe(start!);
		host.observe(post!);
		host.observe(stop!);
		expect(await submitObservedReview(h)).toEqual({ state: "completed" });
	});

	// The payloads below were written from the documented hook shapes, not
	// recorded from a Host: no Claude Code build returns the reviewer's verdict in
	// `tool_response.content`, and `SubagentStop` carries no `last_assistant_message`.
	// They cover the synchronous branch that survives for a Host that would behave
	// this way. Conformance against what Claude Code actually emits lives in
	// tests/claude-review-host-async-agent.test.ts.
	test("native Host hook payload shapes (prompt in tool_input, verdict in tool_response.content) correlate and settle Review", async () => {
		const host = new ClaudeReviewHost();
		const h = makeCoordinator({ host });
		const ready = await h.coordinator.advance(TASK, ctx);
		const operationId = (ready as { operation_id: string }).operation_id;
		const reservedPrompt = `<!-- immune-brain:operation_id=${operationId} task_id=${TASK} -->\nreview instructions`;

		// Native SubagentStart: only carries session_id, agent_id, agent_type
		const start = parseHookStdin(JSON.stringify({
			hook_event_name: "SubagentStart",
			session_id: "native-session-1",
			agent_id: "native_agt_42",
			agent_type: REVIEWER_AGENT,
		}));
		// Native SubagentStop: carries session_id, agent_id, agent_type, last_assistant_message
		const stop = parseHookStdin(JSON.stringify({
			hook_event_name: "SubagentStop",
			session_id: "native-session-1",
			agent_id: "native_agt_42",
			agent_type: REVIEWER_AGENT,
			last_assistant_message: JSON.stringify(passVerdict(snapshot("review"))),
		}));
		// Native PostToolUse: carries prompt inside tool_input, content array inside tool_response
		const post = parseHookStdin(JSON.stringify({
			hook_event_name: "PostToolUse",
			session_id: "native-session-1",
			tool_name: "Agent",
			tool_input: {
				subagent_type: REVIEWER_AGENT,
				prompt: reservedPrompt,
				run_in_background: false,
			},
			tool_response: {
				status: "completed",
				agentId: "native_agt_42",
				agentType: REVIEWER_AGENT,
				content: [{ type: "text", text: JSON.stringify(passVerdict(snapshot("review"))) }],
			},
		}));
		expect(start).not.toBeNull();
		expect(post).not.toBeNull();
		expect(stop).not.toBeNull();
		// Reconcile in any order
		host.observe(start!);
		host.observe(stop!);
		host.observe(post!);
		expect(await submitObservedReview(h)).toEqual({ state: "completed" });
	});

	test("PostToolUse with nested operation_id/task_id in tool_input or tool_response correlates and rejects conflicts", async () => {
		const host = new ClaudeReviewHost();
		const h = makeCoordinator({ host });
		const ready = await h.coordinator.advance(TASK, ctx);
		const op = (ready as { operation_id: string }).operation_id;

		// Nested in tool_response without prompt
		const postNested = parseHookStdin(JSON.stringify({
			hook_event_name: "PostToolUse",
			session_id: "s-nested",
			tool_name: "Agent",
			tool_response: {
				operation_id: op,
				task_id: TASK,
				agentId: "agt-nested",
				content: [{ type: "text", text: JSON.stringify(passVerdict(snapshot("review"))) }],
			},
		}));
		expect(postNested).toMatchObject({ operationId: op, taskId: TASK, agentId: "agt-nested" });

		// Conflicting nested fields vs prompt or top-level fail closed
		const conflicting = parseHookStdin(JSON.stringify({
			hook_event_name: "PostToolUse",
			session_id: "s-nested",
			operation_id: op,
			tool_name: "Agent",
			tool_input: {
				operation_id: "other-op",
			},
		}));
		expect(conflicting).toBeNull();

		// Conflicting top-level agent_id vs tool_response.agentId fails closed
		const conflictingAgent = parseHookStdin(JSON.stringify({
			hook_event_name: "PostToolUse",
			session_id: "s-nested",
			agent_id: "agt-top",
			tool_name: "Agent",
			tool_response: {
				agentId: "agt-other",
				operation_id: op,
				task_id: TASK,
			},
		}));
		expect(conflictingAgent).toBeNull();
	});

	test("SubagentStart with matching operationId but conflicting taskId is rejected", () => {
		const host = new ClaudeReviewHost();
		const reservation = host.prepareReview(reviewRequest("op-task-conflict"));
		// Explicit conflicting taskId must fail closed
		reviewLifecycle(host, { agentId: "agt-conf", operationId: "op-task-conflict", taskId: "other-task", result: "pass" });
		expect(host.consumeReview(reservation)).toMatchObject({ ok: false });
	});

	test("Hook subprocess FileHookEventLog is consumed by the MCP host", async () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-hook-ipc-"));
		const log = new FileHookEventLog(dir);
		const host = new ClaudeReviewHost(log);
		const h = makeCoordinator({ host });
		const ready = await h.coordinator.advance(TASK, ctx);
		const operationId = (ready as { operation_id: string }).operation_id;
		const writer = new FileHookEventLog(dir);
		const agentId = `agent-${operationId}`;
		writer.append({ type: "SubagentStart", sessionId: "hook", agent: REVIEWER_AGENT, agentId, taskId: TASK, operationId });
		writer.append({ type: "PostToolUse", sessionId: "hook", agentId, toolName: AGENT_TOOL, result: JSON.stringify(passVerdict(snapshot("review"))), taskId: TASK, operationId });
		writer.append({ type: "SubagentStop", sessionId: "hook", agent: REVIEWER_AGENT, agentId, taskId: TASK, operationId });
		expect(await submitObservedReview(h)).toEqual({ state: "completed" });
		expect(h.counts().applyCount).toBe(2);
	});

	test("unrelated SubagentStart without reservation ids does not settle Review", async () => {
		const host = new ClaudeReviewHost();
		const h = makeCoordinator({ host });
		const ready = await h.coordinator.advance(TASK, ctx);
		const op = (ready as { operation_id: string }).operation_id;
		host.observe({ type: "SubagentStart", sessionId: "other", agent: REVIEWER_AGENT, agentId: "x" });
		host.observe({ type: "PostToolUse", sessionId: "other", agentId: "x", toolName: AGENT_TOOL, result: JSON.stringify(passVerdict(snapshot("review"))) });
		host.observe({ type: "SubagentStop", sessionId: "other", agent: REVIEWER_AGENT, agentId: "x" });
		expect(await submitObservedReview(h)).toMatchObject({ reason: "reserved foreground Agent was not observed" });
		completeReview(host, op, JSON.stringify(passVerdict(snapshot("review"))), "bound");
		expect(await submitObservedReview(h)).toEqual({ state: "completed" });
	});





	test("SessionEnd drops process-local reservations without Kernel mutation", async () => {
		const host = new ClaudeReviewHost();
		const h = makeCoordinator({ host });
		const ready = await h.coordinator.advance(TASK, ctx);
		const op = (ready as { operation_id: string }).operation_id;
		completeReview(host, op, JSON.stringify(passVerdict(snapshot("review"))));
		host.observe({ type: "SessionEnd", sessionId: "s1" });
		expect(await submitObservedReview(h)).toMatchObject({ state: "blocked" });
		expect(h.counts().applyCount).toBe(1);
	});

	test("taskId-only SubagentStart does not bind a reserved Review", () => {
		const host = new ClaudeReviewHost();
		const reservation = host.prepareReview(reviewRequest("op-new"));
		reviewLifecycle(host, { agentId: "stolen", taskId: TASK, result: "stolen" });
		expect(host.consumeReview(reservation)).toMatchObject({ ok: false });
	});

	test("SubagentStart with matching operationId but conflicting prompt marker is rejected", () => {
		const host = new ClaudeReviewHost();
		const reservation = host.prepareReview(reviewRequest("op-target"));
		// Prompt carries a marker pointing to a different operation or task
		const conflictingPrompt = "<!-- immune-brain:operation_id=op-other task_id=" + TASK + " -->\nbody";
		reviewLifecycle(host, { agentId: "conflicted", operationId: "op-target", taskId: TASK, prompt: conflictingPrompt, result: "bad" });
		expect(host.consumeReview(reservation)).toMatchObject({ ok: false });
		// parseHookStdin also rejects conflicting explicit fields and prompt markers
		expect(parseHookStdin(JSON.stringify({
			hook_event_name: "SubagentStart",
			session_id: "s",
			agent: REVIEWER_AGENT,
			operation_id: "op-target",
			task_id: TASK,
			prompt: conflictingPrompt,
		}))).toBeNull();
	});

	test("delayed same-task events for a different operation do not settle the new reservation", () => {
		const host = new ClaudeReviewHost();
		const reservation = host.prepareReview(reviewRequest("op-new", "reserved-prompt"));
		reviewLifecycle(host, { agentId: "old", taskId: TASK, operationId: "op-old", result: "old" });
		expect(host.consumeReview(reservation)).toMatchObject({ ok: false });
		reviewLifecycle(host, { agentId: "prompt-only", operationId: "op-new", prompt: "reserved-prompt", result: "ok" });
		expect(host.consumeReview(reservation)).toMatchObject({ ok: true, receipt: { result: "ok" } });
	});

	test("a later reservation does not skip earlier unconsumed Review events", () => {
		const host = new ClaudeReviewHost();
		const first = host.prepareReview(reviewRequest("op-a"));
		reviewLifecycle(host, { agentId: "a", operationId: "op-a", result: "first" });
		host.prepareReview(reviewRequest("op-b"));
		expect(host.consumeReview(first)).toMatchObject({ ok: true, receipt: { result: "first" } });
	});





	test("Hook cache rejects a pre-existing cache symlink without chmod side effects", () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-session-symlink-"));
		const outside = mkdtempSync(join(tmpdir(), "claude-session-outside-"));
		symlinkSync(outside, join(dir, "immune-brain-claude"));
		new ClaudeReviewHost(new FileHookEventLog(dir)).observe({ type: "SubagentStart", sessionId: "s", agent: REVIEWER_AGENT, agentId: "cache-test" });
		expect(readdirSync(outside)).toEqual([]);
		expect(statSync(outside).mode & 0o777).toBe(0o700);
	});

	test("Hook cache rejects an owned evidence file with a non-private mode", () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-session-file-mode-"));
		const log = new FileHookEventLog(dir);
		log.append({ type: "SubagentStart", sessionId: "s", agent: REVIEWER_AGENT, agentId: "cache-test" });
		const file = join(dir, "immune-brain-claude", readdirSync(join(dir, "immune-brain-claude"))[0]);
		chmodSync(file, 0o644);
		expect(log.list("s")).toEqual([]);
	});

	test("Hook cache directory and files are owner-only", () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-session-mode-"));
		const host = new ClaudeReviewHost(new FileHookEventLog(dir));
		host.observe({ type: "SubagentStart", sessionId: "s", agent: REVIEWER_AGENT, agentId: "cache-test" });
		const cache = join(dir, "immune-brain-claude");
		expect(statSync(cache).mode & 0o777).toBe(0o700);
		const files = readdirSync(cache);
		expect(statSync(join(cache, files[0])).mode & 0o777).toBe(0o600);
	});

	test("crafted session IDs cannot write Hook evidence outside the cache directory", () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-session-escape-"));
		const host = new ClaudeReviewHost(new FileHookEventLog(dir));
		host.observe({ type: "SubagentStart", sessionId: "../evil", agent: REVIEWER_AGENT, agentId: "cache-test" });
		expect(existsSync(join(dir, "evil.jsonl"))).toBe(false);
		expect(readdirSync(dir)).toEqual(["immune-brain-claude"]);
		const files = readdirSync(join(dir, "immune-brain-claude"));
		expect(files.every((name) => /^[a-f0-9]{64}\.jsonl$/.test(name))).toBe(true);
	});

	test("unidentifiable Agent PostToolUse does not settle Review", () => {
		const host = new ClaudeReviewHost();
		const reservation = host.prepareReview(reviewRequest("op-post"));
		host.observe({ type: "SubagentStart", sessionId: "s", agent: REVIEWER_AGENT, agentId: "bound", operationId: "op-post" });
		host.observe({ type: "PostToolUse", sessionId: "s", agentId: "", toolName: AGENT_TOOL, result: "stolen", operationId: "op-post" });
		host.observe({ type: "SubagentStop", sessionId: "s", agent: REVIEWER_AGENT, agentId: "bound", operationId: "op-post" });
		expect(host.consumeReview(reservation)).toMatchObject({ ok: false });
	});

	test("PostToolUse missing operationId does not settle Review", () => {
		const host = new ClaudeReviewHost();
		const reservation = host.prepareReview(reviewRequest("op-post-req"));
		host.observe({ type: "SubagentStart", sessionId: "s", agent: REVIEWER_AGENT, agentId: "bound", operationId: "op-post-req" });
		// Event matches agentId but lacks operationId: must be rejected
		host.observe({ type: "PostToolUse", sessionId: "s", agentId: "bound", toolName: AGENT_TOOL, result: "unbound" });
		host.observe({ type: "SubagentStop", sessionId: "s", agent: REVIEWER_AGENT, agentId: "bound", operationId: "op-post-req" });
		expect(host.consumeReview(reservation)).toMatchObject({ ok: false });
	});


	test("wrong SubagentStop identity does not settle Review", () => {
		const host = new ClaudeReviewHost();
		const reservation = host.prepareReview(reviewRequest("op-stop"));
		host.observe({ type: "SubagentStart", sessionId: "s", agent: REVIEWER_AGENT, agentId: "bound", operationId: "op-stop" });
		host.observe({ type: "PostToolUse", sessionId: "s", agentId: "bound", toolName: AGENT_TOOL, result: "valid" });
		host.observe({ type: "SubagentStop", sessionId: "s", agent: REVIEWER_AGENT, agentId: "other", operationId: "op-stop" });
		expect(host.consumeReview(reservation)).toMatchObject({ ok: false });
	});

	test("same-operation PostToolUse without the reserved agent cannot replace the result", () => {
		const host = new ClaudeReviewHost();
		const reservation = host.prepareReview(reviewRequest("op-result"));
		host.observe({ type: "SubagentStart", sessionId: "s", agent: REVIEWER_AGENT, agentId: "bound", operationId: "op-result" });
		host.observe({ type: "PostToolUse", sessionId: "s", agentId: "bound", toolName: AGENT_TOOL, result: "valid", operationId: "op-result" });
		host.observe({ type: "PostToolUse", sessionId: "s", agentId: "", toolName: AGENT_TOOL, result: "spoofed", operationId: "op-result" });
		host.observe({ type: "SubagentStop", sessionId: "s", agent: REVIEWER_AGENT, agentId: "bound", operationId: "op-result" });
		expect(host.consumeReview(reservation)).toMatchObject({ ok: true, receipt: { result: "valid" } });
	});



	test("Claude adapter imports no Pi SDK and shared assurance imports no Claude adapter", () => {
		const claudeDir = resolve("plugins/immune-brain/runtime/claude");
		const bannedClaude = /@earendil-works\/|\.pi-extension/;
		for (const name of readdirSync(claudeDir)) {
			if (!name.endsWith(".ts")) continue;
			const source = readFileSync(join(claudeDir, name), "utf8");
			expect({ name, match: source.match(bannedClaude)?.[0] }).toEqual({ name, match: undefined });
		}
		const assuranceDir = resolve("plugins/immune-brain/runtime/assurance");
		const bannedAssurance = /runtime\/claude|claude-plugin/;
		for (const name of readdirSync(assuranceDir)) {
			if (!name.endsWith(".ts")) continue;
			const source = readFileSync(join(assuranceDir, name), "utf8");
			expect({ name, match: source.match(bannedAssurance)?.[0] }).toEqual({ name, match: undefined });
		}
	});
});

/**
 * The Kernel implements `resolve_finding` and the Pi Host has always been able
 * to issue it, but the Claude Host exposed no operation that could. A task whose
 * blocking finding had been fixed and verified therefore projected
 * `next_obligation: resolve_findings` forever, with no reachable operation and
 * no way out except stopping the task.
 *
 * These tests run against a real repository and a real TaskRecord rather than a
 * port double, because the defect is precisely that no wiring existed: a stubbed
 * `applyOrdinaryOperation` would report success against a tool that reaches
 * nothing.
 */
const RESOLVE_TASK = "resolve-finding-task";
const RESOLVE_NOW = "2025-01-01T00:00:00.000Z";
const RESOLVE_GIT_ENV = {
	...process.env,
	GIT_AUTHOR_NAME: "fixture",
	GIT_AUTHOR_EMAIL: "fixture@example.com",
	GIT_COMMITTER_NAME: "fixture",
	GIT_COMMITTER_EMAIL: "fixture@example.com",
};
const RESOLVE_INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: RESOLVE_TASK,
	goal: "Exercise the ordinary resolve_finding operation from the Claude Host",
	acceptance: [{ id: "A1", assertion: "the finding clears", verification: "bun test src/worked.ts" }],
	scope_hint: ["src/worked.ts"],
	risk: "critical",
	revision: 1,
	owner: "user",
} as const;
const RESOLVE_INTENT_HASH = canonicalIntentHash(parseTaskIntentV1(RESOLVE_INTENT));
const resolveRoots: string[] = [];

afterAll(() => {
	for (const root of resolveRoots) rmSync(root, { recursive: true, force: true });
});

/**
 * A repository parked exactly where the Loop stalled: artifacts active with an
 * open blocking finding. `authorityBound` adds the two kinds this operation must
 * refuse; it is off for the resolution test because the Kernel projects
 * `resolve_user_decision` ahead of `resolve_findings`, which would mask the
 * obligation actually under test.
 */
function makeResolveFindingRoot(
	authorityBound = true,
	lifecycle: "active" | "done" | "stopped" = "active",
): string {
	const root = mkdtempSync(join(tmpdir(), "resolve-finding-"));
	resolveRoots.push(root);
	mkdirSync(join(root, "src"), { recursive: true });
	mkdirSync(join(root, ".imm", "state", "tasks"), { recursive: true });
	mkdirSync(join(root, "docs", "plans", ...(lifecycle === "active" ? [] : ["archive"])), { recursive: true });
	const intentPath = lifecycle === "active"
		? `docs/plans/${RESOLVE_TASK}.intent.json`
		: `docs/plans/archive/${RESOLVE_TASK}.intent.json`;
	writeFileSync(join(root, intentPath), `${JSON.stringify(RESOLVE_INTENT, null, 2)}\n`);
	writeFileSync(join(root, "src", "worked.ts"), "export const value = 1;\n");
	execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
	execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
	execFileSync("git", ["commit", "-qm", "base"], { cwd: root, stdio: "ignore", env: RESOLVE_GIT_ENV });
	const baseHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

	writeFileSync(join(root, ".imm", "state", "tasks", `${RESOLVE_TASK}.json`), `${JSON.stringify({
		contract: "assurance_kernel/task_record/v4",
		task_id: RESOLVE_TASK,
		intent_snapshot: RESOLVE_INTENT,
		intent_ref: { path: intentPath, content_hash: RESOLVE_INTENT_HASH },
		lifecycle,
		artifact_state: lifecycle === "active" ? "active" : "frozen",
		baseline: RESOLVE_INTENT_HASH,
		git_base_head: baseHead,
		attestations: [],
		findings: [
			{ id: "f-blocking", kind: "blocking", status: "open", acceptance_id: "A1", source: "review", review_round: 1, summary: "blocking finding whose cause is fixed" },
			{ id: "f-advisory", kind: "advisory", status: "open", acceptance_id: "A1", source: "review", review_round: 1, summary: "advisory finding" },
			...(authorityBound ? [
				{ id: "user-decision-1", kind: "unresolved_user_decision", status: "open", acceptance_id: null, source: "kernel", review_round: null, summary: "a decision only the user may settle" },
				{ id: "f-replan", kind: "replan_required", status: "open", acceptance_id: null, source: "review", review_round: 1, summary: "a replan boundary" },
			] : []),
		],
		history: [],
	}, null, 2)}\n`);
	writeFileSync(join(root, ".imm", "state", "workspace.json"), `${JSON.stringify({
		contract: "assurance_kernel/workspace/v1",
		current_working: RESOLVE_TASK,
	}, null, 2)}\n`);
	writeFileSync(join(root, ".imm", "state", "active-claim.json"), `${JSON.stringify({
		contract: "assurance_kernel/backend_claim/v2",
		backend: "kernel",
		task_id: RESOLVE_TASK,
		intent_revision: 1,
		intent_content_hash: RESOLVE_INTENT_HASH,
		enrollment_event_id: `enroll-${RESOLVE_TASK}-${RESOLVE_NOW}`,
		lifecycle_status: "active",
		created_at: RESOLVE_NOW,
		updated_at: RESOLVE_NOW,
	}, null, 2)}\n`);
	return root;
}

async function resolveFindingRuntime(root: string) {
	const mcp = createMcpRuntime({ cwd: root, env: ENV, interactive: true, host: new ClaudeReviewHost() });
	await handleJsonRpc({
		jsonrpc: "2.0",
		id: 0,
		method: "initialize",
		params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1.236" }, capabilities: { elicitation: {} } },
	}, mcp);
	return mcp;
}

function recordBytes(root: string): string {
	return readFileSync(join(root, ".imm", "state", "tasks", `${RESOLVE_TASK}.json`), "utf8");
}

function authorityState(root: string) {
	return [
		join(root, ".imm", "state", "tasks", `${RESOLVE_TASK}.json`),
		join(root, ".imm", "state", "workspace.json"),
		join(root, ".imm", "state", "active-claim.json"),
	].map((path) => {
		const stat = statSync(path);
		return { bytes: readFileSync(path, "utf8"), ino: stat.ino, mtimeMs: stat.mtimeMs };
	});
}

describe("claude host resolve_finding", () => {
	test("publishes an ordinary resolve_finding tool that actually clears the finding", async () => {
		const tools = listMcpTools();
		const tool = tools.find((entry) => entry.name === "resolve_finding");
		expect(tool).toBeDefined();
		expect(tool?.inputSchema.properties).toHaveProperty("task_id");
		expect(tool?.inputSchema.properties).toHaveProperty("finding_id");
		expect(tool?.inputSchema.required).toEqual(["task_id", "finding_id"]);
		// Ordinary, not privileged: the Kernel builds this action without a
		// capability and the Pi Host lists it among its ordinary operations.
		expect(tool?.annotations).toEqual({ readOnlyHint: false });

		const root = makeResolveFindingRoot(false);
		const mcp = await resolveFindingRuntime(root);
		const before = readTaskRecord(root, RESOLVE_TASK).record;
		if (!before) throw new Error("fixture TaskRecord did not parse");
		expect((await projectAssurance(root, RESOLVE_TASK, diffSnapshotOf)).projection.next_obligation).toBe("resolve_findings");

		await mcp.callTool("resolve_finding", { task_id: RESOLVE_TASK, finding_id: "f-blocking" });

		const after = readTaskRecord(root, RESOLVE_TASK).record;
		if (!after) throw new Error("TaskRecord did not parse after resolution");
		// Exactly the named finding moved, and nothing else did.
		expect(after.findings.map((item) => [item.id, item.status])).toEqual([
			["f-blocking", "resolved"],
			["f-advisory", "open"],
		]);
		expect(after.history.length).toBe(before.history.length + 1);
		expect(after.history.at(-1)?.type).toBe("resolve_finding");
		// The whole point: the Kernel reprojects off the obligation that had no
		// reachable operation. A tool registered without working dispatch, or one
		// wired to the wrong Kernel operation, leaves this unchanged.
		expect((await projectAssurance(root, RESOLVE_TASK, diffSnapshotOf)).projection.next_obligation).not.toBe("resolve_findings");
	});

	test("every rejected resolution is fail-closed and leaves the record byte-identical", async () => {
		const root = makeResolveFindingRoot();
		const mcp = await resolveFindingRuntime(root);
		const original = authorityState(root);

		// Structural rejection, before the Kernel is reached.
		await expect(mcp.callTool("resolve_finding", { task_id: RESOLVE_TASK })).rejects.toThrow("finding_id is required");
		await expect(mcp.callTool("resolve_finding", { task_id: RESOLVE_TASK, finding_id: "" })).rejects.toThrow("finding_id is required");
		await expect(mcp.callTool("resolve_finding", { task_id: RESOLVE_TASK, finding_id: 7 })).rejects.toThrow("finding_id is required");

		// Semantic rejections, all owned by the reducer. The adapter reads no
		// findings and tests no kind, so these prove the Kernel is really reached
		// rather than a second authority reimplemented in the Host.
		await expect(mcp.callTool("resolve_finding", { task_id: RESOLVE_TASK, finding_id: "no-such-finding" }))
			.rejects.toThrow(/finding no-such-finding does not exist/);
		await expect(mcp.callTool("resolve_finding", { task_id: RESOLVE_TASK, finding_id: "user-decision-1" }))
			.rejects.toThrow(/cannot resolve a user decision or replan boundary/);
		await expect(mcp.callTool("resolve_finding", { task_id: RESOLVE_TASK, finding_id: "f-replan" }))
			.rejects.toThrow(/cannot resolve a user decision or replan boundary/);
		expect(authorityState(root)).toEqual(original);

		// A terminal TaskRecord reaches the Kernel but cannot be changed.
		const terminalRoot = makeResolveFindingRoot(true, "done");
		const terminalMcp = await resolveFindingRuntime(terminalRoot);
		const terminalOriginal = authorityState(terminalRoot);
		await expect(terminalMcp.callTool("resolve_finding", { task_id: RESOLVE_TASK, finding_id: "f-blocking" }))
			.rejects.toThrow("cannot resolve findings while lifecycle is done");
		expect(authorityState(terminalRoot)).toEqual(terminalOriginal);

		// Already resolved is rejected too, so a replayed call cannot append a
		// second history entry for the same transition.
		await mcp.callTool("resolve_finding", { task_id: RESOLVE_TASK, finding_id: "f-advisory" });
		const settled = recordBytes(root);
		await expect(mcp.callTool("resolve_finding", { task_id: RESOLVE_TASK, finding_id: "f-advisory" }))
			.rejects.toThrow(/already resolved/);
		expect(recordBytes(root)).toBe(settled);
	});

	test("the tool needs the same trusted host evidence as every other mutation", async () => {
		const root = makeResolveFindingRoot();
		const original = recordBytes(root);
		// No initialize handshake: no bound version, so no authority-mutating tool
		// may run, exactly as for advance_assurance.
		const unversioned = createMcpRuntime({ cwd: root, env: ENV, interactive: true, host: new ClaudeReviewHost() });
		await expect(unversioned.callTool("resolve_finding", { task_id: RESOLVE_TASK, finding_id: "f-blocking" }))
			.rejects.toThrow("Claude Code version is unavailable");

		const nonInteractive = createMcpRuntime({ cwd: root, env: ENV, interactive: false, host: new ClaudeReviewHost() });
		await handleJsonRpc({
			jsonrpc: "2.0",
			id: 0,
			method: "initialize",
			params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1.236" }, capabilities: {} },
		}, nonInteractive);
		await expect(nonInteractive.callTool("resolve_finding", { task_id: RESOLVE_TASK, finding_id: "f-blocking" }))
			.rejects.toThrow("interactive MCP elicitation is unavailable");
		expect(recordBytes(root)).toBe(original);
	});

	test("the eight pre-existing tools and the privileged set are untouched", () => {
		// resolve_finding is additive: it is appended, so no existing client sees a
		// reordered or re-annotated surface.
		expect(listMcpTools().map((tool) => tool.name)).toEqual([
			"status",
			"enroll",
			"advance_assurance",
			"submit_review",
			"request_authorization",
			"approve_breaking_intent_revision",
			"stop",
			"repair_authority_state",
			"resolve_finding",
		]);
		expect([...PRIVILEGED_OPERATIONS]).toEqual([
			"enroll",
			"request_authorization",
			"approve_breaking_intent_revision",
			"stop",
		]);
		const submitReview = listMcpTools().find((tool) => tool.name === "submit_review");
		expect(submitReview?.inputSchema.required).toEqual(["task_id", "verdict"]);
		for (const name of ["enroll", "request_authorization", "approve_breaking_intent_revision", "stop"]) {
			expect(listMcpTools().find((tool) => tool.name === name)?.annotations).toEqual({ destructiveHint: true });
		}
	});
});
