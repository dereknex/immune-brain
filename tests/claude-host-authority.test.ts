import type { VerdictAuthority } from "../plugins/immune-brain/runtime/assurance/verdict_authority";
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
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
import { createMutationAuthorityCapabilityForTest, seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";
import { readRunRowByTask, updateRunRecord, withKernelRead, withKernelTransaction } from "../plugins/immune-brain/runtime/kernel/sqlite_store";
import { findingsDigestV2 } from "../plugins/immune-brain/runtime/kernel/reducer";
import { anchorForEvidence } from "../plugins/immune-brain/runtime/kernel/refutation";
import { readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { confirmationRef, evaluateNativeGate, PRIVILEGED_OPERATIONS } from "../plugins/immune-brain/runtime/claude/interaction";
import { readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage";
import { projectAssurance } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { probeHost } from "../plugins/immune-brain/runtime/claude/capability";
import { PLUGIN_VERSION } from "../plugins/immune-brain/runtime/plugin_version";
import { readWorkspaceStateRaw } from "../plugins/immune-brain/runtime/kernel/storage";
import { readBackendClaim } from "../plugins/immune-brain/runtime/kernel/backend_claim";

const TASK = "phase3-task";
const ROOT = "/tmp/claude-host-authority";
const ctx = { cwd: ROOT };
// These tests drive real git repositories and full Kernel flows. The Kernel QA
// runner executes them under a minimal environment where the same flow takes
// noticeably longer than it does interactively, so the file bounds them
// explicitly instead of depending on bun's 5s default.
setDefaultTimeout(60_000);

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
		approval: {
			kind: s.role === "qa" ? "qa" : "review",
			authority_role: s.role === "qa" ? "qa" : "reviewer",
			summary: "passed",
			// A review pass claims the reviewed change set (BR-DEC-3); QA never carries it.
			...(s.role === "review" ? { inspected_paths: [...s.dirty_files] } : {}),
		},
	};
}

function completeReview(host: ClaudeReviewHost, operationId: string, result: string, sessionId = "s1") {
	const agentId = `agent-${operationId}`;
	host.observe({ type: "SubagentStart", sessionId, agent: REVIEWER_AGENT, agentId, taskId: TASK, operationId });
	host.observe({ type: "PostToolUse", sessionId, agentId, toolName: AGENT_TOOL, result, taskId: TASK, operationId });
	host.observe({ type: "SubagentStop", sessionId, agent: REVIEWER_AGENT, agentId, taskId: TASK, operationId });
}

function reviewRequest(operationId: string, prompt = `prompt-${operationId}`) {
	// The Claude reservation binds against `snapshotPrompt`; `prompt` is the
	// complete prompt the Pi Host dispatches.
	return {
		taskId: TASK,
		operationId,
		prompt: `internal role: code-review\n${prompt}`,
		snapshotPrompt: prompt,
		evidencePath: "/tmp/review.json",
		maxTurns: 1,
	};
}

function authorityFixtureRoot(taskId: string): { root: string; intent: Record<string, unknown> } {
	const root = mkdtempSync(join(tmpdir(), "claude-breaking-approval-"));
	const intent = {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		owner: "user",
		goal: "exercise breaking approval",
		acceptance: [{ id: "acc-1", assertion: "initial assertion", verification: "bun test" }],
		scope_hint: [
			`docs/plans/${taskId}.intent.json`,
			`docs/specs/${taskId}.spec.md`,
			`docs/specs/archive/${taskId}.spec.md`,
		],
		risk: "routine",
		revision: 1,
	};
	mkdirSync(join(root, ".imm", "state"), { recursive: true });
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	writeFileSync(join(root, "docs", "plans", `${taskId}.intent.json`), `${JSON.stringify(intent, null, 2)}\n`);
	mkdirSync(join(root, "docs", "specs", "archive"), { recursive: true });
	writeFileSync(join(root, "docs", "specs", `${taskId}.spec.md`), `# ${taskId}\n`);
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
	const ports: AssuranceCoordinatorPorts & Partial<VerdictAuthority> = {
		host,
		confirmationReference: ({ actorId }) => `fixture:${actorId}`,
		projectTask: overrides.project ?? (async () => projection(currentLifecycle, nextObligation, risk, artifactState)),
		readTaskRecord: async () => ({ record: { findings: [] } }),
		readTaskIntent: async () => ({ token: "intent-token" }),
		buildAssurance: async (_root, _task, role) => ({
			snapshot: snapshot(role),
			descriptors: new Map([[
				"A1",
				{ contract: "assurance_kernel/verification_descriptor/v2", command: { executable: "bun", argv: ["test"], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 }, environment: { prepare: null, writable_paths: [] } },
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
	return { coordinator: new AssuranceCoordinator(ports, ports), host, ports, counts: () => ({ applyCount }) };
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
	// The migrated Claude enroll path awaits the single Enrollment entry inside
	// its try/catch, so a rehearsal rejection still carries the empty-initial-
	// commit diagnostic the synchronous predecessor appended.
	test("an enrollment rehearsal rejection keeps the empty initial commit diagnostic", async () => {
		const root = mkdtempSync(join(tmpdir(), "claude-unborn-enroll-"));
		const taskId = "unborn-enroll-diagnostic";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "exercise the unborn-repository enrollment diagnostic",
			acceptance: [{ id: "acc-1", assertion: "the artifact exists", verification: "bun test" }],
			scope_hint: ["src", `docs/plans/${taskId}.intent.json`],
			risk: "routine",
			revision: 1,
		};
		mkdirSync(join(root, ".imm", "state"), { recursive: true });
		mkdirSync(join(root, "src"), { recursive: true });
		mkdirSync(join(root, "docs", "plans"), { recursive: true });
		writeFileSync(join(root, "docs", "plans", `${taskId}.intent.json`), `${JSON.stringify(intent, null, 2)}\n`);
		writeFileSync(join(root, "src", "task.ts"), "export const value = 1;\n");
		// An unborn repository with the in-scope file already staged: the entry's
		// empty initial commit makes that file dirty relative to the base, so
		// the rehearsal refuses.
		execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root, stdio: "ignore" });
		execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
		const runtime = new ClaudeRuntime({
			cwd: root,
			env: ENV,
			interactive: true,
			permissionMode: "manual",
			requestConfirmation: async ({ operation }) => ({ decision: "accept", requestId: `nested-${operation}` }),
		});
		const error = await runtime.enroll(taskId, {
			taskId,
			sessionId: "s",
			toolCallId: "enroll",
			requiresUserInteraction: true,
			interactive: true,
			permissionMode: "manual",
		}).then(() => null, (cause: unknown) => cause as Error);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toMatch(/; empty initial commit [0-9a-f]{7,40} remains/);
		// The refusal leaves no Kernel authority behind.
		expect(existsSync(join(root, ".imm", "state", "workspace.json"))).toBe(false);
	});

	test("privileged tools use the standard MCP destructive hint without vendor permission metadata", () => {
		const tools = listMcpTools();
		for (const name of ["enroll", "request_authorization", "approve_breaking_intent_revision", "stop"]) {
			expect(tools.find((tool) => tool.name === name)?.annotations).toEqual({ destructiveHint: true });
		}
		const submitReview = tools.find((tool) => tool.name === "submit_review");
		expect(submitReview?.inputSchema.required).toEqual(["task_id"]);
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
		expect(readWorkspaceStateRaw(root).state.current_working).toBe(taskId);
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
		const mcp = createMcpRuntime({ cwd: ROOT, env: ENV, ports: h.ports, authorityOverrides: h.ports, host });
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
		// A relayed malformed verdict keeps the reservation for a retry.
		expect(await mcp.callTool("submit_review", { task_id: TASK, verdict: { ...verdict, extra: true } })).toMatchObject({
			state: "blocked",
			code: "verdict_invalid",
		});
		expect(h.counts().applyCount).toBe(1);
		expect(await mcp.callTool("advance_assurance", { task_id: TASK })).toMatchObject({ code: "verdict_invalid" });
		// ADR 0017: the retry may omit the verdict to apply the observed receipt.
		expect(await mcp.callTool("submit_review", { task_id: TASK })).toMatchObject({
			state: "completed",
			tracker: { contract: "immune_brain/github_issue_tracker_result/v1", operation: "mark-terminal" },
		});
		expect(h.counts().applyCount).toBe(2);
		expect(await mcp.callTool("submit_review", { task_id: TASK, verdict })).toMatchObject({ state: "blocked" });
	});

	test("an omitted Claude verdict without an observed receipt fails closed", async () => {
		const host = new ClaudeReviewHost();
		const h = makeCoordinator({ host });
		const mcp = createMcpRuntime({ cwd: ROOT, env: ENV, ports: h.ports, authorityOverrides: h.ports, host });
		await handleJsonRpc({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1.236" }, capabilities: { elicitation: {} } },
		}, mcp);
		const ready = await mcp.callTool("advance_assurance", { task_id: TASK }) as { state: string; operation_id: string };
		expect(ready.state).toBe("review_ready");
		const blocked = await mcp.callTool("submit_review", { task_id: TASK }) as { state: string; reason: string; recovery_action?: string };
		expect(blocked.state).toBe("blocked");
		expect(blocked.reason).toBe("reserved foreground Agent was not observed");
		expect(blocked.recovery_action).toContain("do not dispatch or continue another reviewer");
		expect(h.counts().applyCount).toBe(1);
	});



	test("invalid Spec binding blocks ordinary authorization before native confirmation", async () => {
		const taskId = "invalid-binding-authorization";
		const fixture = authorityFixtureRoot(taskId);
		let confirmations = 0;
		const runtime = new ClaudeRuntime({
			cwd: fixture.root, env: ENV, interactive: true, permissionMode: "manual",
			requestConfirmation: async () => { confirmations++; return { decision: "accept", requestId: "binding-confirmation" }; },
		});
		const meta = (toolCallId: string): ToolMeta => ({ taskId, sessionId: "s", toolCallId, requiresUserInteraction: true, interactive: true, permissionMode: "manual" });
		await runtime.enroll(taskId, meta("enroll"));
		confirmations = 0;
		const run = withKernelRead(fixture.root, (db) => readRunRowByTask(db, taskId))!;
		const record = JSON.parse(run.record_json);
		const invalid = parseTaskIntentV1({ ...record.intent_snapshot, scope_hint: [...record.intent_snapshot.scope_hint, "docs/specs/one.spec.md", "docs/specs/two.spec.md"] });
		record.intent_snapshot = invalid;
		record.intent_ref.content_hash = canonicalIntentHash(invalid);
		const bytes = `${JSON.stringify(record, null, 2)}\n`;
		withKernelTransaction(fixture.root, (db) => updateRunRecord(db, run.run_id, run.revision, bytes, new Date().toISOString()));
		writeFileSync(join(fixture.root, `docs/plans/${taskId}.intent.json`), `${JSON.stringify(invalid, null, 2)}\n`);
		execFileSync("git", ["add", "--", `docs/plans/${taskId}.intent.json`], { cwd: fixture.root });
		expect(() => runtime.authorize(taskId, "request_authorization", meta("authorize"))).toThrow();
		expect(confirmations).toBe(0);
		expect(withKernelRead(fixture.root, (db) => readRunRowByTask(db, taskId))!.record_json).toBe(bytes);
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
		const registry = createMutationAuthorityRegistry();
		const app = createCanaryApplication(registry);
		const apply = async (operation: Record<string, unknown>, at: string) => {
			const prior = await readTaskIntent(fixture.root, taskId, readTaskRecordRaw(fixture.root, taskId).record!.intent_ref.path);
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
			const record = readTaskRecordRaw(fixture.root, taskId);
			// Only a recurring security boundary parks a task for a user decision, so
		// the authorization path is exercised through that supported trigger.
		const evidence = {
			trigger: "the descriptor writes outside the authorized directory",
			caller_chain: ["runtime/kernel/enrollment.ts"],
			violated: { kind: "security_boundary" as const, ref: "boundary:authorization" },
		};
		const finding = {
			id,
			kind: "blocking",
			status: "open",
			acceptance_id: null,
			source: "review",
			review_round: null,
			summary: "review needs rework",
			anchor: anchorForEvidence(evidence),
			evidence,
		};
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
		const ready = await h.coordinator.advance(TASK, ctx) as { operation_id: string; agent_params: { name: string; prompt: string } };
		const operationId = ready.operation_id;
		// The Host's own reserved dispatch prompt, byte for byte: the marker is
		// not an acceptance path, so this must equal what prepareReview returned.
		const reservedPrompt = ready.agent_params.prompt;

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
		const reserved = (reservation.dispatch as { prompt: string }).prompt;
		reviewLifecycle(host, { agentId: "old", taskId: TASK, operationId: "op-old", result: "old" });
		expect(host.consumeReview(reservation)).toMatchObject({ ok: false });
		// Prompt-only binding is no longer marker-based: the dispatched prompt must
		// be the reserved dispatch prompt itself, marker line included.
		reviewLifecycle(host, { agentId: "prompt-only", operationId: "op-new", prompt: reserved, result: "ok" });
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

	test("both Host adapters mint request_rework findings through the shared verdict mapping", () => {
		// Both coordinators now use the same authority module, whose mapping
		// preserves Review provenance and whose capability binds the Kernel digest.
		const source = readFileSync(resolve("plugins/immune-brain/runtime/assurance/verdict_authority.ts"), "utf8");
		expect(source).toMatch(/reviewReworkFindings\(verdict\)/);
		expect(source).toContain("findingsDigestV2(findings)");
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

	seedKernelRunForTest(root, {
		task_id: RESOLVE_TASK,
		created_at: RESOLVE_NOW,
		updated_at: RESOLVE_NOW,
		claim_status: "active",
		record: {
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
		},
	});
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

/** Replace the stored record through a revision-checked store write. */
function writeStoredRecordForTest(root: string, record: Record<string, unknown>): void {
	const run = withKernelRead(root, (db) => readRunRowByTask(db, RESOLVE_TASK));
	if (!run) throw new Error(`fixture run ${RESOLVE_TASK} is missing`);
	withKernelTransaction(root, (db) => {
		updateRunRecord(db, run.run_id, run.revision, `${JSON.stringify(record, null, 2)}\n`, "2026-08-12T10:00:02.000Z");
	});
}

function recordBytes(root: string): string {
	const run = withKernelRead(root, (db) => readRunRowByTask(db, RESOLVE_TASK));
	if (!run) throw new Error(`fixture run ${RESOLVE_TASK} is missing`);
	return run.record_json;
}

function authorityState(root: string) {
	// Authority is the store: fingerprint the durable facts a rejected mutation
	// must leave untouched, plus the retired files that must never come back.
	const run = withKernelRead(root, (db) => readRunRowByTask(db, RESOLVE_TASK));
	const dbPath = join(root, ".imm", "state", "kernel.sqlite");
	const stat = statSync(dbPath);
	// The store's logical content, not its physical bytes: a rejected or rolled
	// back transaction still leaves SQLite with more allocated pages, so the file
	// size (and any inode churn around it) is a storage artifact rather than an
	// authority write. Dumping every table is strictly stronger than comparing a
	// byte count, because it also catches an in-place change of equal length.
	const store = withKernelRead(root, (db) =>
		(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
			.map(({ name }) => `${name}=${JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all())}`)
			.join(";"),
	);
	return {
		run: run ? `${run.state}/${run.claim_status}/${run.revision}/${run.record_json}` : "ENOENT",
		claim: readBackendClaim(root),
		workspace: readWorkspaceStateRaw(root).state.current_working ?? null,
		db: { ino: stat.ino, store },
		retired: [
			join(root, ".imm", "state", "tasks"),
			join(root, ".imm", "state", "workspace.json"),
			join(root, ".imm", "state", "active-claim.json"),
		].map((path) => existsSync(path)),
	};
}

describe("claude host revise_intent", () => {
	test("persists compatible revisions and restores sidecar and index on rejection", async () => {
		const root = makeResolveFindingRoot(false);
		const mcp = await resolveFindingRuntime(root);
		const path = `docs/plans/${RESOLVE_TASK}.intent.json`;
		const next = { ...RESOLVE_INTENT, revision: 2, acceptance: [{ ...RESOLVE_INTENT.acceptance[0], verification: "bun test src/revised.ts" }] };
		const tool = listMcpTools().find((entry) => String(entry.name) === "revise_intent");
		expect(tool?.inputSchema.required).toEqual(["task_id", "next_intent"]);
		expect(tool?.annotations).toEqual({ readOnlyHint: false });
		await mcp.callTool("revise_intent", { task_id: RESOLVE_TASK, next_intent: next });
		expect(readTaskRecordRaw(root, RESOLVE_TASK).record?.intent_snapshot).toEqual(next);
		const bytes = readFileSync(join(root, path), "utf8");
		const staged = () => execFileSync("git", ["show", `:${path}`], { cwd: root, encoding: "utf8" });
		expect(JSON.parse(bytes)).toEqual(next);
		expect(staged()).toBe(bytes);
		const record = recordBytes(root);
		await expect(mcp.callTool("revise_intent", { task_id: RESOLVE_TASK, next_intent: { ...next, revision: 3, goal: "breaking" } })).rejects.toThrow("revise_intent requires a compatible revision");
		expect(recordBytes(root)).toBe(record);
		expect(readFileSync(join(root, path), "utf8")).toBe(bytes);
		expect(staged()).toBe(bytes);
		await expect(mcp.callTool("revise_intent", { task_id: RESOLVE_TASK })).rejects.toThrow("next_intent is required");
		await expect(mcp.callTool("revise_intent", { task_id: RESOLVE_TASK, next_intent: {} })).rejects.toThrow();
		expect(recordBytes(root)).toBe(record);
		expect(staged()).toBe(bytes);
	});

	test.each(["active", "frozen"] as const)("invalidates old QA with %s artifacts", async (artifactState) => {
		const root = makeResolveFindingRoot(false);
		const record = JSON.parse(recordBytes(root));
		record.artifact_state = artifactState;
		record.attestations.push({
			id: "qa-before-revision", kind: "qa", authority_role: "qa", task_revision: 1,
			intent_content_hash: RESOLVE_INTENT_HASH,
			diff_hash: diffHashOf(root, readTaskRecordRaw(root, RESOLVE_TASK).record!),
			actor_id: "qa-host", summary: "descriptor passed",
			acceptance_results: [{ acceptance_id: "A1", status: "passed", summary: "A1 passed" }],
		});
		writeStoredRecordForTest(root, record);
		expect((await projectAssurance(root, RESOLVE_TASK, diffSnapshotOf)).projection.fresh_acceptance_ids).toEqual(["A1"]);
		const mcp = await resolveFindingRuntime(root);
		await mcp.callTool("revise_intent", { task_id: RESOLVE_TASK, next_intent: {
			...RESOLVE_INTENT, revision: 2,
			acceptance: [{ ...RESOLVE_INTENT.acceptance[0], verification: "bun test src/revised.ts" }],
		} });
		const projection = (await projectAssurance(root, RESOLVE_TASK, diffSnapshotOf)).projection;
		expect(projection.fresh_acceptance_ids).toEqual([]);
		expect(projection.stale_attestation_ids).toContain("qa-before-revision");
		expect(projection.completion_ready).toBe(false);
	});

	test("requires trusted interactive host evidence", async () => {
		const root = makeResolveFindingRoot(false);
		const mcp = createMcpRuntime({ cwd: root, env: ENV, host: new ClaudeReviewHost() });
		const args = { task_id: RESOLVE_TASK, next_intent: { ...RESOLVE_INTENT, revision: 2 } };
		await expect(mcp.callTool("revise_intent", args)).rejects.toThrow("Claude Code version is unavailable");
		mcp.bindClientHandshake({ version: "2.1.236", interactive: false });
		await expect(mcp.callTool("revise_intent", args)).rejects.toThrow("interactive MCP elicitation is unavailable");
	});
});

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
		const before = readTaskRecordRaw(root, RESOLVE_TASK).record;
		if (!before) throw new Error("fixture TaskRecord did not parse");
		expect((await projectAssurance(root, RESOLVE_TASK, diffSnapshotOf)).projection.next_obligation).toBe("resolve_findings");

		await mcp.callTool("resolve_finding", { task_id: RESOLVE_TASK, finding_id: "f-blocking" });

		const after = readTaskRecordRaw(root, RESOLVE_TASK).record;
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
		// Non-vacuity: the store digest must actually carry the durable rows,
		// otherwise "byte-identical" would compare two empty strings.
		expect(original.db.store).toContain("runs=");

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

	test("the pre-existing tools and the privileged set include start_unattended_batch", () => {
		// resolve_finding and start_unattended_batch are additive, so no existing client sees a
		// reordered or re-annotated surface for prior tools.
			expect(listMcpTools().map((tool) => tool.name)).toEqual([
				"status",
				"enroll",
				"advance_assurance",
				"submit_review",
				"request_authorization",
				"revise_intent",
				"approve_breaking_intent_revision",
				"stop",
				"start_unattended_batch",
				"retire_stale_batch",
				"repair_authority_state",
				"resolve_finding",
				"refute_finding",
			]);
			expect([...PRIVILEGED_OPERATIONS]).toEqual([
				"enroll",
				"request_authorization",
				"approve_breaking_intent_revision",
				"stop",
				"start_unattended_batch",
				"retire_stale_batch",
			]);
			const submitReview = listMcpTools().find((tool) => tool.name === "submit_review");
			expect(submitReview?.inputSchema.required).toEqual(["task_id"]);
			for (const name of ["enroll", "request_authorization", "approve_breaking_intent_revision", "stop", "start_unattended_batch", "retire_stale_batch"]) {
				expect(listMcpTools().find((tool) => tool.name === name)?.annotations).toEqual({ destructiveHint: true });
			}
	});

	test("publishes an ordinary refute_finding tool that actually refutes the finding", async () => {
		const tools = listMcpTools();
		const tool = tools.find((entry) => entry.name === "refute_finding");
		expect(tool).toBeDefined();
		expect(tool?.inputSchema.properties).toHaveProperty("task_id");
		expect(tool?.inputSchema.properties).toHaveProperty("finding_id");
		expect(tool?.inputSchema.properties).toHaveProperty("attestation_id");
		expect(tool?.inputSchema.required).toEqual(["task_id", "finding_id", "attestation_id"]);
		// Ordinary, not privileged: the actor can only bind QA evidence the
		// Kernel already validated, and the reducer owns every precondition.
		expect(tool?.annotations).toEqual({ readOnlyHint: false });

		const root = makeResolveFindingRoot(false);
		const record = JSON.parse(recordBytes(root));
		record.attestations.push({
			id: "qa-live",
			kind: "qa",
			authority_role: "qa",
			task_revision: 1,
			intent_content_hash: RESOLVE_INTENT_HASH,
			diff_hash: diffHashOf(root, readTaskRecordRaw(root, RESOLVE_TASK).record!),
			actor_id: "qa-host",
			summary: "descriptor passed",
			acceptance_results: [{ acceptance_id: "A1", status: "passed", summary: "A1 passed" }],
		});
		writeStoredRecordForTest(root, record);
		const mcp = await resolveFindingRuntime(root);

		await mcp.callTool("refute_finding", { task_id: RESOLVE_TASK, finding_id: "f-blocking", attestation_id: "qa-live" });

		const after = readTaskRecordRaw(root, RESOLVE_TASK).record;
		if (!after) throw new Error("TaskRecord did not parse after refutation");
		expect(after.findings.find((item) => item.id === "f-blocking")).toMatchObject({
			status: "refuted",
			counterevidence: { attestation_id: "qa-live", acceptance_id: "A1" },
		});
		expect(after.findings.find((item) => item.id === "f-advisory")?.status).toBe("open");
		expect(after.history.at(-1)?.type).toBe("refute_finding");
		// The refuted finding no longer blocks: the projection proves the tool
		// reaches the Kernel rather than a local no-op.
		expect((await projectAssurance(root, RESOLVE_TASK, diffSnapshotOf)).projection.blocking_finding_ids).toEqual([]);
	});

	test("every rejected refutation is fail-closed and leaves the record byte-identical", async () => {
		const root = makeResolveFindingRoot(false);
		const mcp = await resolveFindingRuntime(root);
		const original = authorityState(root);
		// Non-vacuity: the store digest must actually carry the durable rows,
		// otherwise "byte-identical" would compare two empty strings.
		expect(original.db.store).toContain("runs=");

		await expect(mcp.callTool("refute_finding", { task_id: RESOLVE_TASK })).rejects.toThrow("finding_id is required");
		await expect(mcp.callTool("refute_finding", { task_id: RESOLVE_TASK, finding_id: "f-blocking" }))
			.rejects.toThrow("attestation_id is required");
		await expect(mcp.callTool("refute_finding", { task_id: RESOLVE_TASK, finding_id: "f-blocking", attestation_id: 7 }))
			.rejects.toThrow("attestation_id is required");
		// Semantic rejection, owned by the reducer: no fresh passing QA evidence
		// covering the finding's acceptance exists in this fixture.
		await expect(mcp.callTool("refute_finding", { task_id: RESOLVE_TASK, finding_id: "f-blocking", attestation_id: "qa-live" }))
			.rejects.toThrow(/fresh passing QA attestation/);
		expect(recordBytes(root)).toBe(original.run.split("/").slice(3).join("/"));
	});

	test("every blocked Claude review submission names one same-host recovery action", async () => {
		const released = "Call advance_assurance to obtain a new Review reservation, then dispatch one fresh reviewer with the returned envelope unchanged";
		const retained = "Wait for the dispatched reviewer to finish, then call submit_review again with its verdict; do not dispatch or continue another reviewer";
		const mismatch = "Resubmit without a verdict to apply the observed reviewer receipt, or resubmit the reviewer's verdict exactly as the reviewer returned it";
		const forbidden = [/another Host/i, /worktree/i, /repair_authority_state/, /\bcommit\b/i, /unmanaged/i];
		const verdict = () => passVerdict(snapshot("review"));

		async function blocked(host: ClaudeReviewHost, h: ReturnType<typeof makeCoordinator>, input: unknown) {
			const result = await submitClaudeReview(host, h.coordinator, ctx, TASK, input);
			expect(result.state).toBe("blocked");
			if (result.state !== "blocked") throw new Error("expected blocked");
			expect(result.recovery_action?.length ?? 0).toBeGreaterThan(0);
			for (const pattern of forbidden) expect(result.recovery_action).not.toMatch(pattern);
			return result;
		}

		const host = new ClaudeReviewHost();
		const h = makeCoordinator({ host });
		const ready = await h.coordinator.advance(TASK, ctx) as { operation_id: string };
		const missing = await blocked(host, h, verdict());
		expect(missing).toMatchObject({ reason: "reserved foreground Agent was not observed", recovery_action: retained });
		expect((await h.coordinator.advance(TASK, ctx) as { operation_id: string }).operation_id).toBe(ready.operation_id);

		const incompleteHost = new ClaudeReviewHost();
		const incomplete = makeCoordinator({ host: incompleteHost });
		const incompleteReady = await incomplete.coordinator.advance(TASK, ctx) as { operation_id: string };
		incompleteHost.observe({ type: "SubagentStart", sessionId: "s", agent: REVIEWER_AGENT, agentId: "a", taskId: TASK, operationId: incompleteReady.operation_id });
		expect(await blocked(incompleteHost, incomplete, verdict())).toMatchObject({
			reason: "foreground Agent terminal event order is incomplete",
			recovery_action: retained,
		});
		expect((await incomplete.coordinator.advance(TASK, ctx) as { operation_id: string }).operation_id).toBe(incompleteReady.operation_id);

		const mismatchHost = new ClaudeReviewHost();
		const mismatchHarness = makeCoordinator({ host: mismatchHost });
		const mismatchReady = await mismatchHarness.coordinator.advance(TASK, ctx) as { operation_id: string };
		const start = { type: "SubagentStart" as const, sessionId: "s", agent: REVIEWER_AGENT, agentId: "a", taskId: TASK, operationId: mismatchReady.operation_id };
		mismatchHost.observe(start);
		mismatchHost.observe({ type: "PostToolUse", sessionId: "s", agentId: "a", toolName: AGENT_TOOL, result: JSON.stringify(verdict()), taskId: TASK, operationId: mismatchReady.operation_id });
		mismatchHost.observe({ type: "SubagentStop", sessionId: "s", agent: REVIEWER_AGENT, agentId: "a", taskId: TASK, operationId: mismatchReady.operation_id });
		expect(mismatchHost.inspectReviewForTask(TASK).ok).toBe(true);
		start.sessionId = "diverged";
		expect(await blocked(mismatchHost, mismatchHarness, verdict())).toMatchObject({
			reason: "foreground Agent terminal event correlation mismatch",
			recovery_action: released,
		});
		expect((await mismatchHarness.coordinator.advance(TASK, ctx) as { operation_id: string }).operation_id).not.toBe(mismatchReady.operation_id);

		const consumedHost = new ClaudeReviewHost();
		const consumed = makeCoordinator({ host: consumedHost });
		const consumedReady = await consumed.coordinator.advance(TASK, ctx) as { operation_id: string };
		completeReview(consumedHost, consumedReady.operation_id, JSON.stringify(verdict()));
		consumedHost.consumeReview({ id: consumedReady.operation_id, dispatch: { name: REVIEWER_AGENT, prompt: "" } });
		expect(await blocked(consumedHost, consumed, verdict())).toMatchObject({
			reason: "review receipt already consumed",
			recovery_action: released,
		});

		const foreignHost = new ClaudeReviewHost();
		const foreign = makeCoordinator({ host: foreignHost });
		const foreignReady = await foreign.coordinator.advance(TASK, ctx) as { operation_id: string };
		const envelope = JSON.stringify({ isAsync: true, status: "async_launched", agentId: "other", outputFile: "/tmp/imm-review-foreign" });
		foreignHost.observe({ type: "SubagentStart", sessionId: "s", agent: REVIEWER_AGENT, agentId: "a", taskId: TASK, operationId: foreignReady.operation_id });
		foreignHost.observe({ type: "PostToolUse", sessionId: "s", agentId: "a", toolName: AGENT_TOOL, result: envelope, taskId: TASK, operationId: foreignReady.operation_id });
		foreignHost.observe({ type: "SubagentStop", sessionId: "s", agent: REVIEWER_AGENT, agentId: "a", taskId: TASK, operationId: foreignReady.operation_id });
		expect(await blocked(foreignHost, foreign, verdict())).toMatchObject({
			reason: "async Agent launch envelope names a different agent",
			recovery_action: released,
		});

		const root = mkdtempSync(join(tmpdir(), "imm-review-recovery-"));
		try {
			const unreadHost = new ClaudeReviewHost();
			const unread = makeCoordinator({ host: unreadHost });
			const unreadReady = await unread.coordinator.advance(TASK, ctx) as { operation_id: string };
			const missingEnvelope = JSON.stringify({ isAsync: true, status: "async_launched", agentId: "a", outputFile: join(root, "missing.output") });
			unreadHost.observe({ type: "SubagentStart", sessionId: "s", agent: REVIEWER_AGENT, agentId: "a", taskId: TASK, operationId: unreadReady.operation_id });
			unreadHost.observe({ type: "PostToolUse", sessionId: "s", agentId: "a", toolName: AGENT_TOOL, result: missingEnvelope, taskId: TASK, operationId: unreadReady.operation_id });
			unreadHost.observe({ type: "SubagentStop", sessionId: "s", agent: REVIEWER_AGENT, agentId: "a", taskId: TASK, operationId: unreadReady.operation_id });
			expect(await blocked(unreadHost, unread, verdict())).toMatchObject({
				reason: "async Agent transcript is not readable",
				recovery_action: retained,
			});
			expect((await unread.coordinator.advance(TASK, ctx) as { operation_id: string }).operation_id).toBe(unreadReady.operation_id);

			const emptyHost = new ClaudeReviewHost();
			const empty = makeCoordinator({ host: emptyHost });
			const emptyReady = await empty.coordinator.advance(TASK, ctx) as { operation_id: string };
			const real = join(root, "empty.jsonl");
			writeFileSync(real, `${JSON.stringify({ type: "assistant", agentId: "a", message: { content: [{ type: "text", text: "   " }] } })}\n`, { mode: 0o600 });
			chmodSync(real, 0o600);
			const emptyEnvelope = JSON.stringify({ isAsync: true, status: "async_launched", agentId: "a", outputFile: real });
			emptyHost.observe({ type: "SubagentStart", sessionId: "s", agent: REVIEWER_AGENT, agentId: "a", taskId: TASK, operationId: emptyReady.operation_id });
			emptyHost.observe({ type: "PostToolUse", sessionId: "s", agentId: "a", toolName: AGENT_TOOL, result: emptyEnvelope, taskId: TASK, operationId: emptyReady.operation_id });
			emptyHost.observe({ type: "SubagentStop", sessionId: "s", agent: REVIEWER_AGENT, agentId: "a", taskId: TASK, operationId: emptyReady.operation_id });
			expect(await blocked(emptyHost, empty, verdict())).toMatchObject({
				reason: "async Agent transcript carries no reviewer result",
				recovery_action: retained,
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}

		const secondHost = new ClaudeReviewHost();
		const second = makeCoordinator({ host: secondHost });
		const secondReady = await second.coordinator.advance(TASK, ctx) as { operation_id: string };
		secondHost.observe({ type: "SubagentStart", sessionId: "s", agent: REVIEWER_AGENT, agentId: "a", taskId: TASK, operationId: secondReady.operation_id });
		secondHost.observe({ type: "SubagentStart", sessionId: "s", agent: REVIEWER_AGENT, agentId: "a", taskId: TASK, operationId: secondReady.operation_id });
		expect(await blocked(secondHost, second, verdict())).toMatchObject({
			reason: "reserved Review already has a native tool call",
			recovery_action: released,
		});

		const postHost = new ClaudeReviewHost();
		const post = makeCoordinator({ host: postHost });
		const postReady = await post.coordinator.advance(TASK, ctx) as { operation_id: string };
		postHost.observe({ type: "PostToolUse", sessionId: "s", agentId: "a", toolName: AGENT_TOOL, result: JSON.stringify(verdict()), taskId: TASK, operationId: postReady.operation_id });
		postHost.observe({ type: "PostToolUse", sessionId: "s", agentId: "a", toolName: AGENT_TOOL, result: JSON.stringify(verdict()), taskId: TASK, operationId: postReady.operation_id });
		expect(await blocked(postHost, post, verdict())).toMatchObject({
			reason: "duplicate PostToolUse result observed for review reservation",
			recovery_action: released,
		});

		const stopHost = new ClaudeReviewHost();
		const stop = makeCoordinator({ host: stopHost });
		const stopReady = await stop.coordinator.advance(TASK, ctx) as { operation_id: string };
		stopHost.observe({ type: "SubagentStop", sessionId: "s", agent: REVIEWER_AGENT, agentId: "a", taskId: TASK, operationId: stopReady.operation_id });
		stopHost.observe({ type: "SubagentStop", sessionId: "s", agent: REVIEWER_AGENT, agentId: "a", taskId: TASK, operationId: stopReady.operation_id });
		expect(await blocked(stopHost, stop, verdict())).toMatchObject({
			reason: "duplicate SubagentStop observed for review reservation: a reviewer was continued after it finished; a reviewer cannot be continued and a fresh reviewer must be dispatched",
			recovery_action: released,
		});

		const receiptHost = new ClaudeReviewHost();
		const receipt = makeCoordinator({ host: receiptHost });
		const receiptReady = await receipt.coordinator.advance(TASK, ctx) as { operation_id: string };
		completeReview(receiptHost, receiptReady.operation_id, "{");
		expect(await blocked(receiptHost, receipt, verdict())).toMatchObject({
			reason: "reviewer receipt is not a valid verdict",
			recovery_action: released,
		});

		const parentHost = new ClaudeReviewHost();
		const parent = makeCoordinator({ host: parentHost });
		const parentReady = await parent.coordinator.advance(TASK, ctx) as { operation_id: string };
		const receiptVerdict = verdict();
		completeReview(parentHost, parentReady.operation_id, JSON.stringify(receiptVerdict));
		expect(await blocked(parentHost, parent, { ...receiptVerdict, approval: { ...receiptVerdict.approval, summary: "rewritten by parent" } })).toMatchObject({
			reason: "parent verdict does not match reviewer receipt",
			recovery_action: mismatch,
		});
		expect((await parent.coordinator.advance(TASK, ctx) as { operation_id: string }).operation_id).toBe(parentReady.operation_id);

		// Positive control for the Claude call site: a receipt and a parent verdict
		// that both claim the full change set are fingerprint-equal and settle.
		const pathsHost = new ClaudeReviewHost();
		const paths = makeCoordinator({ host: pathsHost });
		const pathsReady = await paths.coordinator.advance(TASK, ctx) as { operation_id: string };
		completeReview(pathsHost, pathsReady.operation_id, JSON.stringify(verdict()));
		expect(await submitClaudeReview(pathsHost, paths.coordinator, ctx, TASK, verdict())).toEqual({ state: "completed" });

		// Missing-path control: a receipt whose pass omits a reviewed changed path is
		// invalid, not a mismatch. isReviewVerdictValid fails for both parent and
		// receipt, so the reservation is kept, the verdict is correctable, and no
		// same-host recovery_action is offered (the verdict itself must be fixed).
		const coverageHost = new ClaudeReviewHost();
		const coverage = makeCoordinator({ host: coverageHost });
		const coverageReady = await coverage.coordinator.advance(TASK, ctx) as { operation_id: string };
		const partial = { ...verdict(), approval: { ...verdict().approval, inspected_paths: [] } };
		completeReview(coverageHost, coverageReady.operation_id, JSON.stringify(partial));
		const coverageResult = await submitClaudeReview(coverageHost, coverage.coordinator, ctx, TASK, partial);
		expect(coverageResult).toMatchObject({ state: "blocked", code: "verdict_invalid" });
		expect("recovery_action" in coverageResult ? coverageResult.recovery_action : undefined).toBeUndefined();

		const invalidHost = new ClaudeReviewHost();
		const invalid = makeCoordinator({ host: invalidHost });
		const invalidReady = await invalid.coordinator.advance(TASK, ctx) as { operation_id: string };
		completeReview(invalidHost, invalidReady.operation_id, JSON.stringify(verdict()));
		const invalidResult = await submitClaudeReview(invalidHost, invalid.coordinator, ctx, TASK, { contract: "nope" });
		expect(invalidResult).toMatchObject({ state: "blocked", code: "verdict_invalid" });
		expect("recovery_action" in invalidResult ? invalidResult.recovery_action : undefined).toBeUndefined();
	});
});
