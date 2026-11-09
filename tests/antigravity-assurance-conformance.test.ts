import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	AntigravityReviewHost,
	MemoryHookEventLog,
	VERIFIER_AGENT,
	SUBAGENT_TOOL,
} from "../plugins/immune-brain/runtime/antigravity/review_host";
import {
	antigravityPreInvocationHook,
	antigravityPreToolUseHook,
	readPhaseEntryState,
} from "../plugins/immune-brain/runtime/antigravity/lane_guard";
import { isPrivilegedOperation } from "../plugins/immune-brain/runtime/antigravity/interaction";
import { antigravityRunContinuationHook } from "../plugins/immune-brain/runtime/antigravity/run_continuation";
import { AntigravityRuntime } from "../plugins/immune-brain/runtime/antigravity/kernel_ports";
import { ClaudeRuntime } from "../plugins/immune-brain/runtime/claude/kernel_ports";
import { createAntigravityMcpRuntime } from "../plugins/immune-brain/runtime/antigravity/mcp_server";
import { createMcpRuntime, handleJsonRpc } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { NativeAuthorityError } from "../plugins/immune-brain/runtime/antigravity/interaction";
import { probeHost } from "../plugins/immune-brain/runtime/antigravity/capability";
import type { ReviewRequest, VerificationRequest } from "../plugins/immune-brain/runtime/assurance/host_port";
import { writeTestReviewPacket } from "./helpers/review-packet-fixture";

describe("Antigravity Harness Conformance", () => {
	it("probes host capability and enforces fail-closed version checking", () => {
		// Fails closed when no version is declared
		const unversioned = probeHost({}, "darwin");
		expect(unversioned.ok).toBe(false);
		if (!unversioned.ok) {
			expect(unversioned.reason).toContain("Antigravity version is unavailable");
		}

		// Succeeds when explicit hostVersion is supplied
		const explicit = probeHost({}, "darwin", "1.0.0");
		expect(explicit.ok).toBe(true);
		if (explicit.ok) {
			expect(explicit.host).toBe("antigravity");
			expect(explicit.version).toBe("1.0.0");
		}

		// Succeeds when environment variable is supplied
		const fromEnv = probeHost({ ANTIGRAVITY_VERSION: "0.2.0" }, "linux");
		expect(fromEnv.ok).toBe(true);
		if (fromEnv.ok) {
			expect(fromEnv.host).toBe("antigravity");
			expect(fromEnv.version).toBe("0.2.0");
		}
	});

	describe("AntigravityReviewHost", () => {
		it("prepares a verification reservation with requested verifier model", () => {
			const eventLog = new MemoryHookEventLog();
			const host = new AntigravityReviewHost(eventLog);

			const request: VerificationRequest = {
				taskId: "task-test-02",
				operationId: "op-verify-01",
				prompt: "Verification prompt",
				model: "pro",
				writePacket: writeTestReviewPacket,
			};

			const reservation = host.prepareVerification(request);
			expect(reservation.id).toBe("op-verify-01");

			const dispatch = reservation.dispatch as {
				TypeName: string;
				Role: string;
				Prompt: string;
				Model: string;
			};
			expect(dispatch.TypeName).toBe(VERIFIER_AGENT);
			expect(dispatch.Role).toBe("Review Verifier");
			expect(dispatch.Model).toBe("pro");
		});

		it("observes PostToolUse and inspects review and verification receipts", () => {
			const eventLog = new MemoryHookEventLog();
			const host = new AntigravityReviewHost(eventLog);

			const request: VerificationRequest = {
				taskId: "task-test-03",
				operationId: "op-verify-02",
				prompt: "Verification check",
				model: "pro",
				writePacket: writeTestReviewPacket,
			};

			const reservation = host.prepareVerification(request);
			const dispatchPrompt = (reservation.dispatch as { Prompt: string }).Prompt;

			// Before event observation, inspect returns incomplete
			const beforeResult = host.inspectVerification(reservation);
			expect(beforeResult.ok).toBe(false);

			// Append 3-event subagent lifecycle
			eventLog.append({
				type: "SubagentStart",
				sessionId: "conv-123",
				agent: VERIFIER_AGENT,
				agentId: "agent-step-456",
				prompt: dispatchPrompt,
			});
			eventLog.append({
				type: "PostToolUse",
				sessionId: "conv-123",
				agentId: "agent-step-456",
				toolName: SUBAGENT_TOOL,
				result: JSON.stringify({ verdict: "approved", findings: [] }),
				prompt: dispatchPrompt,
			});
			eventLog.append({
				type: "SubagentStop",
				sessionId: "conv-123",
				agent: VERIFIER_AGENT,
				agentId: "agent-step-456",
			});

			const receiptResult = host.inspectVerification(reservation);
			expect(receiptResult.ok).toBe(true);
			if (receiptResult.ok) {
				expect(receiptResult.receipt.actorId).toBe("antigravity:agent-step-456");
				expect(receiptResult.receipt.model).toBe("pro");
			}

			// Clean up reservation
			host.releaseReview(reservation);
			const afterRelease = host.inspectVerification(reservation);
			expect(afterRelease.ok).toBe(false);
		});
	});

	describe("Lane Guard & Native Gate", () => {
		it("recognizes privileged operations", () => {
			expect(isPrivilegedOperation("enroll")).toBe(false);
			expect(isPrivilegedOperation("start_unattended_batch")).toBe(true);
			expect(isPrivilegedOperation("retire_stale_batch")).toBe(true);
			expect(isPrivilegedOperation("advance_assurance")).toBe(false);
			expect(isPrivilegedOperation("status")).toBe(false);
		});

		it("intercepts privileged MCP tool calls with force_ask when not admitted", () => {
			const result = antigravityPreToolUseHook({
				conversationId: "conv-gate-1",
				toolCall: {
					name: "mcp__immune-brain__start_unattended_batch",
					args: { taskId: "task-123" },
				},
			});

			expect(result.decision).toBe("force_ask");
			expect(result.reason).toContain("run_entry_required");
		});

		it("allows non-privileged MCP tool calls", () => {
			const result = antigravityPreToolUseHook({
				conversationId: "conv-gate-2",
				toolCall: {
					name: "mcp__immune-brain__status",
					args: { taskId: "task-123" },
				},
			});

			expect(result.decision).toBe("allow");
		});

		it("records /drive in PreInvocation hook and gates admission on stepIdx", () => {
			const res = antigravityPreInvocationHook({
				conversationId: "conv-drive-1",
				lastUserInput: "/drive task-999",
			});

			expect(res.injectSteps).toBeDefined();

			const state = readPhaseEntryState("conv-drive-1");
			expect(state?.run_live).toBe(true);

			// PreToolUse with stepIdx succeeds and records admission
			const admitted = antigravityPreToolUseHook({
				conversationId: "conv-drive-1",
				stepIdx: 42,
				toolCall: {
					name: "mcp__immune-brain__start_unattended_batch",
					args: { taskId: "task-999" },
				},
			});
			expect(admitted.decision).toBe("allow");

			// PreToolUse missing stepIdx fails closed
			const missingStep = antigravityPreToolUseHook({
				conversationId: "conv-drive-1",
				toolCall: {
					name: "mcp__immune-brain__start_unattended_batch",
					args: { taskId: "task-999" },
				},
			});
			expect(missingStep.decision).toBe("deny");
			expect(missingStep.reason).toContain("Tool invocation identity (stepIdx) is missing");
		});

		it("enforces lane boundary on file edits", () => {
			const tempDir = mkdtempSync(join(tmpdir(), "lane-guard-"));
			const laneDir = join(tempDir, "lane-1");
			mkdirSync(laneDir, { recursive: true });

			// Initialize git on imm-lane branch
			execFileSync("git", ["init", "-q", "-b", "imm-lane/b-1/t-1"], { cwd: laneDir });
			execFileSync("git", ["config", "user.name", "Test"], { cwd: laneDir });
			execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: laneDir });
			writeFileSync(join(laneDir, "foo.ts"), "export const foo = 1;");
			execFileSync("git", ["add", "."], { cwd: laneDir });
			execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: laneDir });

			try {
				// Edit inside lane is allowed
				const insideResult = antigravityPreToolUseHook({
					conversationId: "conv-lane-1",
					workspacePaths: [laneDir],
					toolCall: {
						name: "edit_file",
						args: { Path: join(laneDir, "foo.ts") },
					},
				});
				expect(insideResult.decision).toBe("allow");

				// Edit outside lane is denied
				const outsideResult = antigravityPreToolUseHook({
					conversationId: "conv-lane-1",
					workspacePaths: [laneDir],
					toolCall: {
						name: "edit_file",
						args: { Path: join(tempDir, "outside.ts") },
					},
				});
				expect(outsideResult.decision).toBe("deny");
				expect(outsideResult.reason).toContain("Lane write refused");
			} finally {
				rmSync(tempDir, { recursive: true, force: true });
			}
		});
	});

	describe("Run Continuation Hook", () => {
		it("allows stop when workspace has no active task", async () => {
			const emptyDir = mkdtempSync(join(tmpdir(), "imm-empty-ws-"));
			try {
				const result = await antigravityRunContinuationHook({
					conversationId: "conv-stop-1",
					workspacePaths: [emptyDir],
				});
				expect(result.decision).toBeUndefined();
			} finally {
				rmSync(emptyDir, { recursive: true, force: true });
			}
		});
	});

	describe("AntigravityRuntime", () => {
		it("initializes with antigravity parentHost and host port", () => {
			const tempDir = mkdtempSync(join(tmpdir(), "imm-runtime-"));
			try {
				const runtime = new AntigravityRuntime({
					cwd: tempDir,
					interactive: true,
				});
				expect(runtime.host.host).toBe("antigravity");
			} finally {
				rmSync(tempDir, { recursive: true, force: true });
			}
		});

		it("throws NativeAuthorityError needs_human when interactive confirmation is refused or absent", async () => {
			const tempDir = mkdtempSync(join(tmpdir(), "imm-runtime-"));
			execFileSync("git", ["init", "-q", "-b", "main"], { cwd: tempDir });
			execFileSync("git", ["config", "user.name", "Test"], { cwd: tempDir });
			execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
			mkdirSync(join(tempDir, "docs", "plans"), { recursive: true });
			writeFileSync(
				join(tempDir, "docs", "plans", "task-01.intent.json"),
				JSON.stringify({
					contract: "assurance_kernel/task_intent/v1",
					task_id: "task-01",
					owner: "user",
					goal: "goal",
					acceptance: [{ id: "acc-1", assertion: "assert", verification: "bun test" }],
					scope_hint: ["docs/plans/task-01.intent.json"],
					risk: "routine",
					revision: 1,
				}),
			);
			execFileSync("git", ["add", "."], { cwd: tempDir });
			execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: tempDir });

			try {
				const runtime = new AntigravityRuntime({
					cwd: tempDir,
					interactive: true,
					requestConfirmation: async () => ({ decision: "deny", reason: "User cancelled" }),
				});

				// Privileged operation startUnattendedBatch without entry token requires confirmation
				await expect(
					runtime.startUnattendedBatch(
						"task-01",
						{
							sessionId: "s1",
							toolCallId: "tc1",
							taskId: "task-01",
							interactive: true,
						},
						{ plan_source: "single_task" },
					),
				).rejects.toThrow(NativeAuthorityError);
			} finally {
				rmSync(tempDir, { recursive: true, force: true });
			}
		});
	});

	/** Runs `body` against one value built in a throwaway directory. */
	async function withTemp<T>(create: (cwd: string) => T, body: (value: T) => Promise<void>): Promise<void> {
		const cwd = mkdtempSync(join(tmpdir(), "imm-host-probe-"));
		try {
			await body(create(cwd));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	}

	/** The reason code of a refusal, so a case can prove the probe is not what refused. */
	async function refusalCode(promise: Promise<unknown>): Promise<string> {
		try {
			await promise;
			return "resolved";
		} catch (error) {
			return error instanceof NativeAuthorityError ? error.reasonCode : String((error as Error | undefined)?.message ?? error);
		}
	}

	/** No confirmation port and no entry token: a passing probe surfaces the interaction gate. */
	function retireProbe(runtime: ClaudeRuntime) {
		return runtime.retireStaleBatch("probe-initiative", {
			sessionId: "probe-session",
			toolCallId: "probe-call",
			taskId: "probe-initiative",
			initiativeSlug: "probe-initiative",
		});
	}

	describe("runtime host probe", () => {
		it("judges an Antigravity runtime with the Antigravity probe", async () => {
			await withTemp(
				(cwd) => new AntigravityRuntime({ cwd, env: { ANTIGRAVITY_VERSION: "0.2.0" }, interactive: true }),
				async (runtime) => {
					await expect(retireProbe(runtime)).rejects.toThrow("interaction_not_opened");
				},
			);
		});

		it("judges a Claude runtime with the Claude probe", async () => {
			await withTemp(
				(cwd) => new ClaudeRuntime({ cwd, env: { CLAUDE_CODE_VERSION: "2.1.236" }, interactive: true }),
				async (runtime) => {
					await expect(retireProbe(runtime)).rejects.toThrow("interaction_not_opened");
				},
			);
		});

		it("refuses an Antigravity runtime below the Antigravity minimum", async () => {
			await withTemp(
				(cwd) => new AntigravityRuntime({ cwd, env: { ANTIGRAVITY_VERSION: "0.0.9" }, interactive: true }),
				async (runtime) => {
					await expect(retireProbe(runtime)).rejects.toThrow("unsupported_host: Antigravity version 0.0.9 is older than minimum supported 0.1.0");
				},
			);
		});

		it("refuses an Antigravity runtime that announces only a Claude Code version", async () => {
			await withTemp(
				(cwd) => new AntigravityRuntime({ cwd, env: { CLAUDE_CODE_VERSION: "2.1.236" }, interactive: true }),
				async (runtime) => {
					await expect(retireProbe(runtime)).rejects.toThrow("unsupported_host: Antigravity version is unavailable");
				},
			);
		});

		it("does not pick a probe from parentHost alone", async () => {
			await withTemp(
				(cwd) => new ClaudeRuntime({ cwd, parentHost: "antigravity", env: { ANTIGRAVITY_VERSION: "0.2.0" }, interactive: true }),
				async (runtime) => {
					await expect(retireProbe(runtime)).rejects.toThrow("unsupported_host: Claude Code version is unavailable");
				},
			);
		});
	});

	describe("MCP host probe gates", () => {
		const handshake = (version: string, interactive = true) => ({ version, interactive, protocolVersion: "2025-06-18" });

		it("admits an Antigravity session at the Antigravity minimum", async () => {
			await withTemp(
				(cwd) => {
					const mcp = createAntigravityMcpRuntime({ cwd, env: {}, interactive: true, consumePhaseAdmission: () => false });
					mcp.bindClientHandshake(handshake("1.0.0"));
					return mcp;
				},
				async (mcp) => {
					await expect(mcp.callTool("start_unattended_batch", { initiative_slug: "probe-initiative" })).rejects.toThrow("run_entry_required");
					await expect(mcp.callTool("retire_stale_batch", { initiative_slug: "probe-initiative" })).rejects.toThrow("run_entry_required");
					expect(await refusalCode(mcp.callTool("advance_assurance", { task_id: "probe-task" }))).not.toBe("unsupported_host");
				},
			);
		});

		it("refuses every authority gate below the Antigravity minimum", async () => {
			await withTemp(
				(cwd) => {
					const mcp = createAntigravityMcpRuntime({ cwd, env: {}, interactive: true, consumePhaseAdmission: () => false });
					mcp.bindClientHandshake(handshake("0.0.9"));
					return mcp;
				},
				async (mcp) => {
					await expect(mcp.callTool("start_unattended_batch", { initiative_slug: "probe-initiative" })).rejects.toThrow("unsupported_host: Antigravity version 0.0.9 is older than minimum supported 0.1.0");
					await expect(mcp.callTool("retire_stale_batch", { initiative_slug: "probe-initiative" })).rejects.toThrow("unsupported_host: Antigravity version 0.0.9 is older than minimum supported 0.1.0");
					await expect(mcp.callTool("advance_assurance", { task_id: "probe-task" })).rejects.toThrow("unsupported_host: Antigravity version 0.0.9 is older than minimum supported 0.1.0");
				},
			);
		});

		it("names Antigravity for a client whose initialize binds no trusted version", async () => {
			await withTemp(
				(cwd) => createAntigravityMcpRuntime({ cwd, env: { ANTIGRAVITY_VERSION: "1.0.0" }, interactive: true, consumePhaseAdmission: () => false }),
				async (mcp) => {
					await handleJsonRpc({
						jsonrpc: "2.0",
						id: "probe-initialize",
						method: "initialize",
						params: { protocolVersion: "2025-06-18", clientInfo: { name: "antigravity", version: "1.0.0" }, capabilities: { elicitation: {} } },
					}, mcp);
					await expect(mcp.callTool("start_unattended_batch", { initiative_slug: "probe-initiative" })).rejects.toThrow("unsupported_host: Antigravity version is unavailable");
				},
			);
		});

		it("keeps the Claude minimum for a Claude session", async () => {
			await withTemp(
				(cwd) => {
					const mcp = createMcpRuntime({ cwd, env: {}, interactive: true, consumePhaseAdmission: () => false });
					mcp.bindClientHandshake(handshake("2.1.100"));
					return mcp;
				},
				async (mcp) => {
					await expect(mcp.callTool("start_unattended_batch", { initiative_slug: "probe-initiative" })).rejects.toThrow("unsupported_host: Claude Code 2.1.100 is below the minimum supported 2.1.236");
				},
			);
		});

		it("never falls back to the environment version for an unversioned Claude session", async () => {
			await withTemp(
				(cwd) => {
					const mcp = createMcpRuntime({ cwd, env: { CLAUDE_CODE_VERSION: "2.1.236" }, interactive: true, consumePhaseAdmission: () => false });
					mcp.bindClientHandshake({ version: "", interactive: true, protocolVersion: "2025-06-18" });
					return mcp;
				},
				async (mcp) => {
					await expect(mcp.callTool("start_unattended_batch", { initiative_slug: "probe-initiative" })).rejects.toThrow("unsupported_host: Claude Code version is unavailable");
				},
			);
		});
	});
});
