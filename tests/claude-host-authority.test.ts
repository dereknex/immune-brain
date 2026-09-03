import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
import { createMcpRuntime, handleJsonRpc, listMcpTools } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { ClaudeRuntime, diffHashOf, type ToolMeta } from "../plugins/immune-brain/runtime/claude/kernel_ports";
import { createCanaryApplication } from "../plugins/immune-brain/runtime/kernel/canary_application";
import { createMutationAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/authority_port";
import { readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { confirmationRef, evaluateNativeGate } from "../plugins/immune-brain/runtime/claude/interaction";
import { probeHost } from "../plugins/immune-brain/runtime/claude/capability";

const TASK = "phase3-task";
const ROOT = "/tmp/claude-host-authority";
const ctx = { cwd: ROOT };
const ENV = { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" };

function projection(
	lifecycle: "active" | "done" | "stopped" = "active",
	nextObligation: "run_qa" | "run_review" | "complete" | "authorize_user" | "none" = "run_qa",
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

function authorityFixtureRoot(taskId: string): { root: string; intent: Record<string, unknown> } {
	const root = mkdtempSync(join(tmpdir(), "claude-breaking-approval-"));
	const intent = {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		owner: "user",
		goal: "exercise breaking approval",
		acceptance: [{ id: "acc-1", assertion: "initial assertion", verification: "bun test" }],
		scope_hint: [`docs/plans/${taskId}.intent.json`],
		risk: "routine",
		revision: 1,
	};
	mkdirSync(join(root, ".imm", "state"), { recursive: true });
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	writeFileSync(join(root, "docs", "plans", `${taskId}.intent.json`), `${JSON.stringify(intent, null, 2)}\n`);
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "fixture"], { cwd: root });
	return { root, intent };
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
	let nextObligation: "run_qa" | "run_review" | "complete" | "authorize_user" | "none" = "run_qa";
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
				nextObligation = risk === "critical" ? "authorize_user" : "complete";
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

describe("claude host authority", () => {
	test("privileged MCP tools declare mandatory interaction", () => {
		const tools = listMcpTools();
		for (const name of ["enroll", "request_authorization", "approve_breaking_intent_revision", "stop", "repair_authority_state"]) {
			expect(tools.find((tool) => tool.name === name)?.annotations).toMatchObject({
				"anthropic/requiresUserInteraction": true,
			});
		}
		expect(tools.find((tool) => tool.name === "status")?.annotations).not.toHaveProperty("anthropic/requiresUserInteraction");
	});

	test("dontAsk, missing annotation, deny, cancel, and non-interactive mint zero capability", () => {
		const base = { operation: "enroll", requiresUserInteraction: true, interactive: true, decision: "accept" as const, permissionMode: "manual" };
		expect(evaluateNativeGate({ ...base, permissionMode: "dontAsk" }).ok).toBe(false);
		expect(evaluateNativeGate({ ...base, requiresUserInteraction: false }).ok).toBe(false);
		expect(evaluateNativeGate({ ...base, decision: "deny" }).ok).toBe(false);
		expect(evaluateNativeGate({ ...base, decision: "cancel" }).ok).toBe(false);
		expect(evaluateNativeGate({ ...base, interactive: false }).ok).toBe(false);
		expect(evaluateNativeGate({ ...base, permissionMode: "bypassPermissions" }).ok).toBe(true);
		expect(probeHost({ CLAUDE_CODE_VERSION: "2.1.100" }).ok).toBe(false);
	});

	test("unknown permission mode fails closed before Kernel mutation", async () => {
		const h = makeCoordinator();
		const mcp = createMcpRuntime({
			cwd: ROOT,
			env: { ...ENV, CLAUDE_CODE_PERMISSION_MODE: "future-mode" },
			ports: h.ports,
			interactive: true,
			host: new ClaudeReviewHost(),
		});
		await handleJsonRpc({
			jsonrpc: "2.0",
			id: 0,
			method: "initialize",
			params: { clientInfo: { name: "claude-code", version: "2.1.236" }, capabilities: { elicitation: {} } },
		}, mcp);
		await expect(mcp.callTool("enroll", { task_id: TASK }, {
			requiresUserInteraction: true,
			interactive: true,
			sessionId: "s",
			toolCallId: "c1",
			taskId: TASK,
		})).rejects.toThrow("unsupported permission mode future-mode");
		expect(h.counts().applyCount).toBe(0);
	});

	test("ElicitationResult requires native tool_use_id", () => {
		expect(parseHookStdin(JSON.stringify({
			hook_event_name: "ElicitationResult",
			session_id: "s",
			request_id: "rpc-id",
			decision: "accept",
		}))).toBeNull();
		expect(parseHookStdin(JSON.stringify({
			hook_event_name: "ElicitationResult",
			session_id: "s",
			tool_use_id: "toolu-1",
			decision: "accept",
		}))).toEqual({ type: "ElicitationResult", sessionId: "s", toolCallId: "toolu-1", decision: "accept" });
		// Only the exact decision strings are native evidence; booleans and
		// yes/no aliases are malformed and fail closed with zero mutation.
		for (const malformed of [true, false, "yes", "no", "Accept", 1, {}]) {
			expect(parseHookStdin(JSON.stringify({
				hook_event_name: "ElicitationResult",
				session_id: "s",
				tool_use_id: "toolu-1",
				decision: malformed,
			}))).toBeNull();
		}
		// The Host's own session_id is the only session identity for this
		// event: the sessionId alias and CLAUDE_SESSION_ID environment fallback
		// are never accepted for native authority evidence.
		expect(parseHookStdin(JSON.stringify({
			hook_event_name: "ElicitationResult",
			sessionId: "s",
				tool_use_id: "toolu-1",
				decision: "accept",
			}))).toBeNull();
		process.env.CLAUDE_SESSION_ID = "env-session";
		try {
			expect(parseHookStdin(JSON.stringify({
				hook_event_name: "ElicitationResult",
				tool_use_id: "toolu-1",
				decision: "accept",
			}))).toBeNull();
		} finally {
			delete process.env.CLAUDE_SESSION_ID;
		}
	});

	test("confirmation refs bind the exact intent and operation digest", () => {
		const base = { sessionId: "s", toolCallId: "t", operation: "approve_breaking_intent_revision", taskId: TASK };
		expect(confirmationRef({ ...base, intentRevision: 2, intentContentHash: "sha256:next", bindingDigest: "sha256:diff" }))
			.not.toBe(confirmationRef({ ...base, intentRevision: 3, intentContentHash: "sha256:other", bindingDigest: "sha256:diff" }));
	});

	test("breaking approval uses the staged next-state digest and commits successfully", async () => {
		const taskId = "breaking-approval";
		const fixture = authorityFixtureRoot(taskId);
		const runtime = new ClaudeRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			permissionMode: "manual",
			decisions: new Map([["enroll", "accept"], ["approve_breaking_intent_revision", "accept"]]),
		});
		const meta = (toolCallId: string): ToolMeta => ({ taskId, sessionId: "s", toolCallId, requiresUserInteraction: true, interactive: true, permissionMode: "manual" });
		await runtime.enroll(taskId, meta("enroll"));
		const nextIntent = { ...fixture.intent, acceptance: [{ id: "acc-1", assertion: "revised assertion", verification: "bun test" }], revision: 2 };
		const result = await runtime.authorize(taskId, "approve_breaking_intent_revision", meta("approve"), { next_intent: nextIntent });
		expect(result.record.intent_snapshot.revision).toBe(2);
		expect(result.record.intent_ref.path).toBe(`docs/plans/${taskId}.intent.json`);
	});

	test("breaking revision consumes native acceptance only after staging and digest binding", async () => {
		const taskId = "binding-order";
		const fixture = authorityFixtureRoot(taskId);
		const host = new ClaudeReviewHost(new FileHookEventLog(mkdtempSync(join(tmpdir(), "claude-binding-order-"))));
		const sidecar = join(fixture.root, "docs", "plans", `${taskId}.intent.json`);
		const stagedAtConfirmation: Array<number | null> = [];
		const baseTake = host.takeConfirmation.bind(host);
		host.takeConfirmation = (sessionId: string, toolCallId: string) => {
			// Observed at elicitation-consumption time: the candidate intent must
			// already be staged (digest binding computed) BEFORE confirmation.
			stagedAtConfirmation.push(JSON.parse(readFileSync(sidecar, "utf8")).revision ?? null);
			return baseTake(sessionId, toolCallId);
		};
		host.observe({ type: "ElicitationResult", sessionId: "s", toolCallId: "enroll", decision: "accept" });
		host.observe({ type: "ElicitationResult", sessionId: "s", toolCallId: "approve", decision: "accept" });
		const runtime = new ClaudeRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			permissionMode: "manual",
			host,
		});
		const meta = (toolCallId: string): ToolMeta => ({ taskId, sessionId: "s", toolCallId, requiresUserInteraction: true, interactive: true, permissionMode: "manual" });
		await runtime.enroll(taskId, meta("enroll"));
		const nextIntent = { ...fixture.intent, acceptance: [{ id: "acc-1", assertion: "revised assertion", verification: "bun test" }], revision: 2 };
		const result = await runtime.authorize(taskId, "approve_breaking_intent_revision", meta("approve"), { next_intent: nextIntent });
		expect(result.record.intent_snapshot.revision).toBe(2);
		// Exactly one live elicitation per operation, and the approve
		// elicitation saw the already-staged revision-2 candidate.
		expect(stagedAtConfirmation).toEqual([1, 2]);
	});

	test("MCP privileged call without native accept performs zero Kernel mutation", async () => {
		const h = makeCoordinator();
		// Preparation now runs before the native accept gate, so the runtime
		// needs a readable fixture root for the digest computation to succeed.
		const root = authorityFixtureRoot(TASK).root;
		const mcp = createMcpRuntime({
			cwd: root,
			env: ENV,
			ports: h.ports,
			interactive: true,
			host: new ClaudeReviewHost(new FileHookEventLog(mkdtempSync(join(tmpdir(), "claude-mcp-elicitation-")))),
		});
		// Authority-mutating tools require a version bound by the trusted
		// initialize handshake even when CLAUDE_CODE_VERSION is set: the
		// environment fallback is disabled on MCP connections.
		await expect(mcp.callTool("advance_assurance", { task_id: TASK })).rejects.toThrow("Claude Code version is unavailable");
		await handleJsonRpc({
			jsonrpc: "2.0",
			id: 0,
			method: "initialize",
			params: { clientInfo: { name: "claude-code", version: "2.1.236" }, capabilities: { elicitation: {} } },
		}, mcp);
		await expect(mcp.callTool("enroll", { task_id: TASK }, {
			requiresUserInteraction: true,
			interactive: true,
			decision: "deny",
			sessionId: "s",
			toolCallId: "c1",
			taskId: TASK,
		})).rejects.toThrow(/denied/);
		await expect(mcp.callTool("enroll", { task_id: TASK }, {
			requiresUserInteraction: true,
			interactive: true,
			sessionId: "s",
			toolCallId: "c2",
			taskId: TASK,
		})).rejects.toThrow(/native interaction missing/);
		await expect(mcp.callTool("enroll", { task_id: TASK, native_decision: "accept" }, {
			requiresUserInteraction: true,
			interactive: true,
		})).rejects.toThrow(/cannot be supplied in tool arguments/);
		const missingMeta = await handleJsonRpc({
			jsonrpc: "2.0",
			id: "hook-tool",
			method: "tools/call",
			params: { name: "enroll", arguments: { task_id: TASK } },
		}, mcp);
		expect(JSON.stringify(missingMeta)).toContain("host correlation metadata missing");
		// Privileged calls require trusted handshake evidence: an initialize
		// without elicitation capability stays non-interactive and fails closed.
		const nonInteractive = createMcpRuntime({
			cwd: ROOT,
			env: ENV,
			ports: h.ports,
			host: new ClaudeReviewHost(),
		});
		await handleJsonRpc({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "claude-code", version: "2.1.236" } },
		}, nonInteractive);
		const denied = await handleJsonRpc({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "enroll", arguments: { task_id: TASK }, _meta: { session_id: "s", tool_use_id: "t" } },
		}, nonInteractive);
		expect(JSON.stringify(denied)).toContain("non-interactive host session cannot mint authority");
		expect(h.counts().applyCount).toBe(0);
		// Non-interactive sessions cannot run ANY authority-mutating tool, not
		// just the five native-confirmation operations: QA/review/completion
		// must not mutate Kernel state without elicitation capability.
		for (const tool of ["advance_assurance", "submit_review"]) {
			const advanceDenied = await handleJsonRpc({
				jsonrpc: "2.0",
				id: 9,
				method: "tools/call",
				params: { name: tool, arguments: { task_id: TASK }, _meta: { session_id: "s", tool_use_id: "t" } },
			}, nonInteractive);
			expect(JSON.stringify(advanceDenied)).toContain("non-interactive host session cannot execute authority tools");
		}
		expect(h.counts().applyCount).toBe(0);
		// Only a valid elicitation capability OBJECT counts as interactivity:
		// false, strings, and arrays are malformed and stay non-interactive.
		for (const malformed of [false, "yes", 1, []]) {
			const badCapability = createMcpRuntime({
				cwd: ROOT,
				env: ENV,
				ports: h.ports,
				host: new ClaudeReviewHost(),
			});
			await handleJsonRpc({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: { clientInfo: { name: "claude-code", version: "2.1.236" }, capabilities: { elicitation: malformed } },
			}, badCapability);
			const rejected = await handleJsonRpc({
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: { name: "enroll", arguments: { task_id: TASK }, _meta: { session_id: "s", tool_use_id: "t" } },
			}, badCapability);
			expect(JSON.stringify(rejected)).toContain("non-interactive host session cannot mint authority");
		}
		expect(h.counts().applyCount).toBe(0);
		// The handshake clientInfo.version is the trusted version source: an
		// unversioned client fails closed for authority calls, while read-only
		// status stays usable without trusted Host evidence.
		const versionless = createMcpRuntime({
			cwd: ROOT,
			env: { CLAUDE_CODE_PERMISSION_MODE: "manual" },
			ports: h.ports,
			host: new ClaudeReviewHost(),
		});
		await expect(versionless.callTool("status", {})).rejects.toThrow("task_id is required");
		await handleJsonRpc({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "claude-code", version: "2.1.236" }, capabilities: { elicitation: {} } },
		}, versionless);
		await expect(versionless.callTool("status", {})).rejects.toThrow("task_id is required");
		await expect(versionless.callTool("status", { task_id: TASK })).resolves.toBeDefined();
		const staleVersion = createMcpRuntime({
			cwd: ROOT,
			env: { CLAUDE_CODE_PERMISSION_MODE: "manual" },
			ports: h.ports,
			host: new ClaudeReviewHost(),
		});
		await handleJsonRpc({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "claude-code", version: "0" }, capabilities: { elicitation: {} } },
		}, staleVersion);
		await expect(staleVersion.callTool("advance_assurance", { task_id: TASK })).rejects.toThrow("Claude Code version is invalid: 0");
		await expect(staleVersion.callTool("status", { task_id: TASK })).resolves.toBeDefined();
		await handleJsonRpc({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "claude-code", version: "2.1.236" }, capabilities: { elicitation: {} } },
		}, mcp);
		expect(JSON.stringify(missingMeta)).toContain("host correlation metadata missing");
		mcp.observe({ type: "ElicitationResult", sessionId: "hook-session", toolCallId: "hook-tool", decision: "accept" });
		const accepted = await handleJsonRpc({
			jsonrpc: "2.0",
			id: "rpc-distinct",
			method: "tools/call",
			params: {
				name: "enroll",
				arguments: { task_id: TASK },
				_meta: { "claudecode/toolUseId": "hook-tool" },
			},
		}, mcp);
		expect(JSON.stringify(accepted)).not.toContain("native interaction missing");
		expect(JSON.stringify(accepted)).not.toContain("host correlation metadata missing");
		expect(JSON.stringify(accepted)).not.toContain("cannot be supplied in tool arguments");
		expect(h.counts().applyCount).toBe(0);
	});

	test("real Claude Code wire correlation bridges session identity through the ElicitationResult record", async () => {
		const h = makeCoordinator();
		const wire = createMcpRuntime({
			cwd: ROOT,
			env: ENV,
			ports: h.ports,
			host: new ClaudeReviewHost(),
		});
		await handleJsonRpc({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "claude-code", version: "2.1.236" }, capabilities: { elicitation: {} } },
		}, wire);
		// Real Claude Code 2.1.236 sends only a namespaced tool-use id in
		// tools/call _meta; without a matching ElicitationResult record there is
		// no host correlation and the privileged call fails closed.
		const noRecord = await handleJsonRpc({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "enroll", arguments: { task_id: TASK }, _meta: { "claudecode/toolUseId": "toolu_real" } },
		}, wire);
		expect(JSON.stringify(noRecord)).toContain("host correlation metadata missing");
		// The Host session binding comes from the hook-observed ElicitationResult
		// for that exact tool call, not from the wire.
		wire.observe({ type: "ElicitationResult", sessionId: "real-session", toolCallId: "toolu_real", decision: "accept" });
		const bridged = await handleJsonRpc({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "enroll", arguments: { task_id: TASK }, _meta: { "claudecode/toolUseId": "toolu_real" } },
		}, wire);
		expect(JSON.stringify(bridged)).not.toContain("host correlation metadata missing");
		expect(JSON.stringify(bridged)).not.toContain("native interaction missing");
		expect(h.counts().applyCount).toBe(0);
		// A supplied wire session_id is never trusted: without a matching
		// unconsumed ElicitationResult record the call still fails closed.
		const untrustedSession = await handleJsonRpc({
			jsonrpc: "2.0",
			id: 4,
			method: "tools/call",
			params: { name: "enroll", arguments: { task_id: TASK }, _meta: { session_id: "s", tool_use_id: "wire-trusted-never" } },
		}, wire);
		expect(JSON.stringify(untrustedSession)).toContain("host correlation metadata missing");
		// Non-namespaced correlation keys (tool_use_id, toolUseId, toolCallId)
	// never mint authority even when a matching ElicitationResult record
	// exists: only the canonical claudecode/toolUseId wire key correlates.
		wire.observe({ type: "ElicitationResult", sessionId: "real-session", toolCallId: "toolu_alias", decision: "accept" });
		for (const aliasMeta of [
			{ tool_use_id: "toolu_alias" },
			{ toolUseId: "toolu_alias" },
			{ toolCallId: "toolu_alias" },
		]) {
			const aliasDenied = await handleJsonRpc({
				jsonrpc: "2.0",
				id: 5,
				method: "tools/call",
				params: { name: "enroll", arguments: { task_id: TASK }, _meta: aliasMeta },
			}, wire);
			expect(JSON.stringify(aliasDenied)).toContain("host correlation metadata missing");
		}
		expect(h.counts().applyCount).toBe(0);
	});

	test("ambiguous wire correlation across sessions fails closed", async () => {
		const h = makeCoordinator();
		const wire = createMcpRuntime({
			cwd: ROOT,
			env: ENV,
			ports: h.ports,
			host: new ClaudeReviewHost(),
		});
		await handleJsonRpc({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "claude-code", version: "2.1.236" }, capabilities: { elicitation: {} } },
		}, wire);
		wire.observe({ type: "ElicitationResult", sessionId: "session-a", toolCallId: "toolu_shared", decision: "accept" });
		wire.observe({ type: "ElicitationResult", sessionId: "session-b", toolCallId: "toolu_shared", decision: "accept" });
		const ambiguous = await handleJsonRpc({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "enroll", arguments: { task_id: TASK }, _meta: { "claudecode/toolUseId": "toolu_shared" } },
		}, wire);
		expect(JSON.stringify(ambiguous)).toContain("host correlation metadata missing");
		expect(h.counts().applyCount).toBe(0);
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
			params: { clientInfo: { name: "other-client", version: "9.9.9" }, capabilities: { elicitation: {} } },
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
		expect(JSON.stringify(denied)).toContain("non-interactive host session cannot mint authority");
		// Read-only status remains usable without trusted Host evidence.
		await expect(foreign.callTool("status", { task_id: TASK })).resolves.toBeDefined();
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
		expect(await h.coordinator.submitReview(TASK, ctx)).toEqual({ state: "completed" });
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
		expect(await missing.coordinator.submitReview(TASK, ctx)).toMatchObject({ reason: "reserved foreground Agent was not observed" });
		expect(missing.counts().applyCount).toBe(1);

		const reordered = new ClaudeReviewHost();
		const hReordered = makeCoordinator({ host: reordered });
		const readyReorder = await hReordered.coordinator.advance(TASK, ctx);
		const op = (readyReorder as { operation_id: string }).operation_id;
		reordered.observe({ type: "SubagentStop", sessionId: "s", agent: REVIEWER_AGENT, agentId: "a", taskId: TASK, operationId: op });
		reordered.observe({ type: "PostToolUse", sessionId: "s", agentId: "a", toolName: AGENT_TOOL, result: JSON.stringify(passVerdict(snapshot("review"))), taskId: TASK, operationId: op });
		expect(await hReordered.coordinator.submitReview(TASK, ctx)).toMatchObject({
			reason: "reserved foreground Agent was not observed",
		});
		expect(hReordered.counts().applyCount).toBe(1);

		const wrong = new ClaudeReviewHost();
		const hWrong = makeCoordinator({ host: wrong });
		const readyWrong = await hWrong.coordinator.advance(TASK, ctx);
		const wrongOp = (readyWrong as { operation_id: string }).operation_id;
		completeReview(wrong, "other-op", JSON.stringify(passVerdict(snapshot("review"))));
		expect(await hWrong.coordinator.submitReview(TASK, ctx)).toMatchObject({ reason: "reserved foreground Agent was not observed" });
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
		expect(await stale.coordinator.submitReview(TASK, ctx)).toMatchObject({
			reason: "assurance snapshot changed before Review submission",
		});
		expect(stale.counts().applyCount).toBe(1);

		const malformed = new ClaudeReviewHost();
		const hMal = makeCoordinator({ host: malformed });
		const readyMal = await hMal.coordinator.advance(TASK, ctx);
		const malOp = (readyMal as { operation_id: string }).operation_id;
		completeReview(malformed, malOp, JSON.stringify({ contract: "nope" }));
		expect(await hMal.coordinator.submitReview(TASK, ctx)).toMatchObject({ state: "blocked" });
		completeReview(malformed, malOp, JSON.stringify(passVerdict(snapshot("review"))));
		expect(await hMal.coordinator.submitReview(TASK, ctx)).toMatchObject({ state: "blocked" });
		expect(hMal.counts().applyCount).toBe(1);
	});

	test("ElicitationResult is removed from the persistent log after consume", () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-elicitation-"));
		const log = new FileHookEventLog(dir);
		const host = new ClaudeReviewHost(log);
		host.observe({ type: "ElicitationResult", sessionId: "s", toolCallId: "t1", decision: "accept" });
		expect(host.takeConfirmation("s", "t1")).toBe("accept");
		expect(host.takeConfirmation("s", "t1")).toBeUndefined();
		host.observe({ type: "ElicitationResult", sessionId: "s", toolCallId: "t2", decision: "deny" });
		expect(host.takeConfirmation("s", "t2")).toBe("deny");
		const restarted = new ClaudeReviewHost(new FileHookEventLog(dir));
		expect(restarted.takeConfirmation("s", "t1")).toBeUndefined();
		expect(restarted.takeConfirmation("s", "t2")).toBeUndefined();
	});

	test("SessionEnd discards unconsumed cached confirmations", () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-session-end-confirmations-"));
		const host = new ClaudeReviewHost(new FileHookEventLog(dir));
		host.observe({ type: "ElicitationResult", sessionId: "s", toolCallId: "t1", decision: "accept" });
		expect(host.peekConfirmation("s", "t1")).toBe(true);
		host.observe({ type: "SessionEnd", sessionId: "s" });
		expect(host.peekConfirmation("s", "t1")).toBe(false);
		expect(host.takeConfirmation("s", "t1")).toBeUndefined();
	});

	test("request_authorization resolves the single bound user decision", async () => {
		const taskId = "user-decision";
		const fixture = authorityFixtureRoot(taskId);
		const runtime = new ClaudeRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			permissionMode: "manual",
			decisions: new Map([["enroll", "accept"], ["request_authorization", "accept"]]),
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

	test("JSON-RPC privileged calls do not synthesize native acceptance", async () => {
		const source = readFileSync(resolve("plugins/immune-brain/runtime/claude/kernel_ports.ts"), "utf8");
		expect(source).not.toContain("requiresUserInteraction ? \"accept\"");
		expect(source).toContain("repairKernelAuthority");
		expect(source).toContain("canonicalIntentHash");
		expect(source).toContain("approval-user-");
		expect(source).toContain("next_intent_ref");
		const mcpSource = readFileSync(resolve("plugins/immune-brain/runtime/claude/mcp_server.ts"), "utf8");
		expect(mcpSource).not.toContain("takeConfirmation");
		expect(mcpSource).toContain("notifications/cancelled");
		expect(mcpSource).toContain('parsed.method === "tools/call"');
		const hostSource = readFileSync(resolve("plugins/immune-brain/runtime/claude/review_host.ts"), "utf8");
		expect(hostSource).toContain("consumeElicitation");
		expect(mcpSource).toContain("cannot be supplied in tool arguments");
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
		expect(await h.coordinator.submitReview(TASK, ctx)).toEqual({ state: "completed" });
	});

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
		expect(await h.coordinator.submitReview(TASK, ctx)).toEqual({ state: "completed" });
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
		expect(await h.coordinator.submitReview(TASK, ctx)).toEqual({ state: "completed" });
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
		expect(await h.coordinator.submitReview(TASK, ctx)).toMatchObject({ reason: "reserved foreground Agent was not observed" });
		completeReview(host, op, JSON.stringify(passVerdict(snapshot("review"))), "bound");
		expect(await h.coordinator.submitReview(TASK, ctx)).toEqual({ state: "completed" });
	});

	test("a Hook append after the drain snapshot is processed on the next drain", () => {
		let sessionLists = 0;
		class RaceLog extends MemoryHookEventLog {
			override list(sessionId?: string) {
				const events = super.list(sessionId);
				if (sessionId && sessionLists++ === 0) {
					super.append({ type: "ElicitationResult", sessionId, toolCallId: "t2", decision: "accept" });
				}
				return events;
			}
		}
		const host = new ClaudeReviewHost(new RaceLog());
		host.observe({ type: "ElicitationResult", sessionId: "s", toolCallId: "t1", decision: "deny" });
		expect(host.takeConfirmation("s", "t1")).toBe("deny");
		expect(host.takeConfirmation("s", "t2")).toBe("accept");
	});

	test("SessionEnd cursor does not skip later ElicitationResult", () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-session-end-"));
		const host = new ClaudeReviewHost(new FileHookEventLog(dir));
		host.observe({ type: "ElicitationResult", sessionId: "s", toolCallId: "a", decision: "accept" });
		expect(host.takeConfirmation("s", "a")).toBe("accept");
		host.observe({ type: "SessionEnd", sessionId: "s" });
		host.observe({ type: "ElicitationResult", sessionId: "s", toolCallId: "b", decision: "deny" });
		expect(host.takeConfirmation("s", "b")).toBeUndefined();
		host.observe({ type: "ElicitationResult", sessionId: "s", toolCallId: "c", decision: "deny" });
		expect(host.takeConfirmation("s", "c")).toBe("deny");
	});

	test("SessionEnd refuses to delete an evidence file with the wrong mode", () => {
 const dir = mkdtempSync(join(tmpdir(), "claude-session-end-mode-"));
 const log = new FileHookEventLog(dir);
 log.append({ type: "ElicitationResult", sessionId: "s", toolCallId: "t1", decision: "accept" });
 const path = hookEventPath("s", dir);
 chmodSync(path, 0o644);
 new ClaudeReviewHost(log).observe({ type: "SessionEnd", sessionId: "s" });
 expect(existsSync(path)).toBe(true);
 });

	test("consumeElicitation commits the durable consumed record before session evidence", () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-durable-order-"));
		const log = new FileHookEventLog(dir);
		// A directory at the consumed.jsonl path makes every durable append
		// fail while session appends keep working: the session file must NOT
		// gain an ElicitationConsumed record before the durable commit lands.
		mkdirSync(join(dir, "immune-brain-claude"), { mode: 0o700 });
		mkdirSync(join(dir, "immune-brain-claude", "consumed.jsonl"));
		log.append({ type: "ElicitationResult", sessionId: "s", toolCallId: "t1", decision: "accept" });
		expect(log.consumeElicitation("s", "t1")).toBe(false);
		expect(readFileSync(hookEventPath("s", dir), "utf8"))
			.not.toContain("ElicitationConsumed");
		// Once the durable record is writable, consumption succeeds and both
		// records exist.
		rmSync(join(dir, "immune-brain-claude", "consumed.jsonl"), { recursive: true, force: true });
		expect(log.consumeElicitation("s", "t1")).toBe(true);
		expect(readFileSync(hookEventPath("s", dir), "utf8"))
			.toContain("ElicitationConsumed");
		expect(log.consumedKeys()).toContain("s\0t1");
	});

	test("concurrent FileHookEventLog instances cannot consume the same ElicitationResult twice", () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-concurrent-consume-"));
		const log1 = new FileHookEventLog(dir);
		const log2 = new FileHookEventLog(dir);
		log1.append({ type: "ElicitationResult", sessionId: "race-s", toolCallId: "race-t", decision: "accept" });
		const first = log1.consumeElicitation("race-s", "race-t");
		const second = log2.consumeElicitation("race-s", "race-t");
		expect([first, second].filter(Boolean).length).toBe(1);
		expect(log1.consumedKeys()).toContain("race-s\0race-t");
	});

	test("SessionEnd drops process-local reservations without Kernel mutation", async () => {
		const host = new ClaudeReviewHost();
		const h = makeCoordinator({ host });
		const ready = await h.coordinator.advance(TASK, ctx);
		const op = (ready as { operation_id: string }).operation_id;
		completeReview(host, op, JSON.stringify(passVerdict(snapshot("review"))));
		host.observe({ type: "SessionEnd", sessionId: "s1" });
		expect(await h.coordinator.submitReview(TASK, ctx)).toMatchObject({ state: "blocked" });
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

	test("consuming ElicitationResult does not drop a concurrent Hook append", () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-elicitation-race-"));
		const log = new FileHookEventLog(dir);
		const host = new ClaudeReviewHost(log);
		host.observe({ type: "ElicitationResult", sessionId: "s", toolCallId: "t1", decision: "accept" });
		const consume = log.consumeElicitation.bind(log);
		log.consumeElicitation = (sessionId, toolCallId) => {
			new FileHookEventLog(dir).append({ type: "ElicitationResult", sessionId: "s", toolCallId: "t2", decision: "deny" });
			return consume(sessionId, toolCallId);
		};
		expect(host.takeConfirmation("s", "t1")).toBe("accept");
		expect(host.takeConfirmation("s", "t2")).toBe("deny");
	});

	test("replayed ElicitationResult after consume cannot authorize again", () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-elicitation-replay-"));
		const host = new ClaudeReviewHost(new FileHookEventLog(dir));
		host.observe({ type: "ElicitationResult", sessionId: "s", toolCallId: "t1", decision: "accept" });
		expect(host.takeConfirmation("s", "t1")).toBe("accept");
		host.observe({ type: "ElicitationResult", sessionId: "s", toolCallId: "t1", decision: "accept" });
		expect(host.takeConfirmation("s", "t1")).toBeUndefined();
		const restarted = new ClaudeReviewHost(new FileHookEventLog(dir));
		expect(restarted.takeConfirmation("s", "t1")).toBeUndefined();
	});

	test("SessionEnd stops the captured batch so later events cannot authorize", () => {
		const host = new ClaudeReviewHost(new FileHookEventLog(mkdtempSync(join(tmpdir(), "claude-sessionend-batch-"))));
		host.observe({ type: "ElicitationResult", sessionId: "s", toolCallId: "t1", decision: "accept" });
		host.observe({ type: "SessionEnd", sessionId: "s" });
		host.observe({ type: "ElicitationResult", sessionId: "s", toolCallId: "t2", decision: "accept" });
		expect(host.takeConfirmation("s", "t1")).toBeUndefined();
		expect(host.takeConfirmation("s", "t2")).toBeUndefined();
		expect(host.peekConfirmation("s", "t2")).toBe(false);
	});

	test("elicitation consumption fails closed when the consumed record cannot persist", () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-elicitation-persist-"));
		const log = new FileHookEventLog(dir);
		const cache = join(dir, "immune-brain-claude");
		mkdirSync(cache, { recursive: true });
		chmodSync(cache, 0o700);
		writeFileSync(join(cache, "consumed.jsonl"), "");
		chmodSync(join(cache, "consumed.jsonl"), 0o644);
		const host = new ClaudeReviewHost(log);
		host.observe({ type: "ElicitationResult", sessionId: "s", toolCallId: "t1", decision: "accept" });
		expect(host.takeConfirmation("s", "t1")).toBeUndefined();
		chmodSync(join(cache, "consumed.jsonl"), 0o600);
		host.observe({ type: "ElicitationResult", sessionId: "s", toolCallId: "t2", decision: "accept" });
		expect(host.takeConfirmation("s", "t2")).toBe("accept");
	});

	test("Hook cache rejects a pre-existing cache symlink without chmod side effects", () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-session-symlink-"));
		const outside = mkdtempSync(join(tmpdir(), "claude-session-outside-"));
		symlinkSync(outside, join(dir, "immune-brain-claude"));
		new ClaudeReviewHost(new FileHookEventLog(dir)).observe({ type: "ElicitationResult", sessionId: "s", toolCallId: "t1", decision: "accept" });
		expect(readdirSync(outside)).toEqual([]);
		expect(statSync(outside).mode & 0o777).toBe(0o700);
	});

	test("Hook cache rejects an owned evidence file with a non-private mode", () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-session-file-mode-"));
		const log = new FileHookEventLog(dir);
		log.append({ type: "ElicitationResult", sessionId: "s", toolCallId: "t1", decision: "accept" });
		const file = join(dir, "immune-brain-claude", readdirSync(join(dir, "immune-brain-claude"))[0]);
		chmodSync(file, 0o644);
		expect(log.list("s")).toEqual([]);
	});

	test("Hook cache directory and files are owner-only", () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-session-mode-"));
		const host = new ClaudeReviewHost(new FileHookEventLog(dir));
		host.observe({ type: "ElicitationResult", sessionId: "s", toolCallId: "t1", decision: "accept" });
		const cache = join(dir, "immune-brain-claude");
		expect(statSync(cache).mode & 0o777).toBe(0o700);
		const files = readdirSync(cache);
		expect(statSync(join(cache, files[0])).mode & 0o777).toBe(0o600);
	});

	test("crafted session IDs cannot write Hook evidence outside the cache directory", () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-session-escape-"));
		const host = new ClaudeReviewHost(new FileHookEventLog(dir));
		host.observe({ type: "ElicitationResult", sessionId: "../evil", toolCallId: "t1", decision: "accept" });
		expect(existsSync(join(dir, "evil.jsonl"))).toBe(false);
		expect(readdirSync(dir)).toEqual(["immune-brain-claude"]);
		const files = readdirSync(join(dir, "immune-brain-claude"));
		expect(files.every((name) => /^[a-f0-9]{64}\.jsonl$/.test(name))).toBe(true);
		expect(host.takeConfirmation("../evil", "t1")).toBe("accept");
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

	test("ElicitationResult rejects non-string tool_use_id values", () => {
		for (const malformed of [123, true, {}, [], null, ""]) {
			expect(parseHookStdin(JSON.stringify({
				hook_event_name: "ElicitationResult",
				session_id: "s",
				tool_use_id: malformed,
				decision: "accept",
			}))).toBeNull();
		}
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

	test("consumed Elicitation identities survive SessionEnd and process restart", () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-consumed-persist-"));
		const log = new FileHookEventLog(dir);
		const host = new ClaudeReviewHost(log);
		host.observe({ type: "ElicitationResult", sessionId: "s", toolCallId: "t1", decision: "accept" });
		expect(host.takeConfirmation("s", "t1")).toBe("accept");
		host.observe({ type: "SessionEnd", sessionId: "s" });
		const restarted = new ClaudeReviewHost(new FileHookEventLog(dir));
		restarted.observe({ type: "ElicitationResult", sessionId: "s", toolCallId: "t1", decision: "accept" });
		expect(restarted.takeConfirmation("s", "t1")).toBeUndefined();
	});

	test("a second session file does not skip another session's later events", () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-session-cursor-"));
		const host = new ClaudeReviewHost(new FileHookEventLog(dir));
		host.observe({ type: "ElicitationResult", sessionId: "keep", toolCallId: "a", decision: "accept" });
		host.observe({ type: "ElicitationResult", sessionId: "drop", toolCallId: "b", decision: "deny" });
		host.observe({ type: "SessionEnd", sessionId: "drop" });
		host.observe({ type: "ElicitationResult", sessionId: "keep", toolCallId: "c", decision: "accept" });
		expect(host.takeConfirmation("keep", "a")).toBe("accept");
		expect(host.takeConfirmation("keep", "c")).toBe("accept");
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
