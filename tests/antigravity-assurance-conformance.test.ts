import { afterAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import {
	AntigravityReviewHost,
	MemoryHookEventLog,
	VERIFIER_AGENT,
	SUBAGENT_TOOL,
} from "../plugins/immune-brain/runtime/antigravity/review_host";
import {
	antigravityPreInvocationHook,
	antigravityPreToolUseHook,
	consumePhaseAdmission,
	readPhaseEntryState,
	type GatedTool,
} from "../plugins/immune-brain/runtime/antigravity/lane_guard";
import { isPrivilegedOperation } from "../plugins/immune-brain/runtime/antigravity/interaction";
import { antigravityRunContinuationHook } from "../plugins/immune-brain/runtime/antigravity/run_continuation";
import { AntigravityRuntime } from "../plugins/immune-brain/runtime/antigravity/kernel_ports";
import { ClaudeRuntime } from "../plugins/immune-brain/runtime/claude/kernel_ports";
import { createAntigravityMcpRuntime, serveStdio as serveAntigravityStdio } from "../plugins/immune-brain/runtime/antigravity/mcp_server";
import { createMcpRuntime, handleJsonRpc } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { confirmationRef, entryTokenRequestId } from "../plugins/immune-brain/runtime/claude/interaction";
import { createCanaryApplication } from "../plugins/immune-brain/runtime/kernel/canary_application";
import { readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage";
import { createTestMutationRegistry } from "./fixtures/mutation-authority-test-seam";
import { NativeAuthorityError } from "../plugins/immune-brain/runtime/antigravity/interaction";
import { parseSemver, probeHost } from "../plugins/immune-brain/runtime/antigravity/capability";
import { enrollTaskForTest } from "./helpers/kernel-enroll";
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
						params: { protocolVersion: "2025-06-18", clientInfo: { name: "antigravity", version: "" }, capabilities: { elicitation: {} } },
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

		it("normalizes one optional v in Antigravity semver", () => {
			expect(parseSemver("v1.0.0")).toEqual([1, 0, 0]);
			expect(parseSemver("vv1.0.0")).toBeNull();
			expect(parseSemver("v1.0")).toBeNull();
			expect(parseSemver("1.0.0-beta")).toBeNull();
			expect(probeHost({}, "darwin", "v1.0.0").ok).toBe(true);
		});

		it("admits the Antigravity client identity with a v-prefixed version", async () => {
			for (const clientInfo of [{ name: "antigravity-client", version: "v1.0.0" }, { name: "antigravity", version: "1.0.0" }]) {
				await withTemp(
					(cwd) => createAntigravityMcpRuntime({ cwd, env: {}, interactive: true, consumePhaseAdmission: () => false }),
					async (mcp) => {
						const reply = await handleJsonRpc({
							jsonrpc: "2.0",
							id: "probe-initialize",
							method: "initialize",
							params: { protocolVersion: "2025-06-18", clientInfo, capabilities: { elicitation: {} } },
						}, mcp);
						expect((reply?.result as { serverInfo: unknown }).serverInfo).toMatchObject({ name: "antigravity", minimumHostVersion: "0.1.0" });
						expect(await refusalCode(mcp.callTool("advance_assurance", { task_id: "probe-task" }))).not.toBe("unsupported_host");
						await expect(mcp.callTool("start_unattended_batch", { initiative_slug: "probe-initiative" })).rejects.toThrow("run_entry_required");
						await expect(mcp.callTool("retire_stale_batch", { initiative_slug: "probe-initiative" })).rejects.toThrow("run_entry_required");
					},
				);
			}
		});

		it("refuses an untrusted Antigravity client name and an empty version", async () => {
			for (const clientInfo of [{ name: "untrusted-client", version: "v1.0.0" }, { name: "antigravity-client", version: "" }]) {
				await withTemp(
					(cwd) => createAntigravityMcpRuntime({ cwd, env: { ANTIGRAVITY_VERSION: "1.0.0" }, interactive: true, consumePhaseAdmission: () => false }),
					async (mcp) => {
						await handleJsonRpc({
							jsonrpc: "2.0",
							id: "probe-initialize",
							method: "initialize",
							params: { protocolVersion: "2025-06-18", clientInfo, capabilities: { elicitation: {} } },
						}, mcp);
						await expect(mcp.callTool("start_unattended_batch", { initiative_slug: "probe-initiative" })).rejects.toThrow("unsupported_host: Antigravity version is unavailable");
						await expect(mcp.callTool("advance_assurance", { task_id: "probe-task" })).rejects.toThrow("unsupported_host: Antigravity version is unavailable");
					},
				);
			}
		});

		it("refuses a v-prefixed Antigravity version below the minimum", async () => {
			await withTemp(
				(cwd) => createAntigravityMcpRuntime({ cwd, env: {}, interactive: true, consumePhaseAdmission: () => false }),
				async (mcp) => {
					await handleJsonRpc({
						jsonrpc: "2.0",
						id: "probe-initialize",
						method: "initialize",
						params: { protocolVersion: "2025-06-18", clientInfo: { name: "antigravity-client", version: "v0.0.9" }, capabilities: { elicitation: {} } },
					}, mcp);
					const below = "unsupported_host: Antigravity version v0.0.9 is older than minimum supported 0.1.0";
					await expect(mcp.callTool("start_unattended_batch", { initiative_slug: "probe-initiative" })).rejects.toThrow(below);
					await expect(mcp.callTool("retire_stale_batch", { initiative_slug: "probe-initiative" })).rejects.toThrow(below);
					await expect(mcp.callTool("advance_assurance", { task_id: "probe-task" })).rejects.toThrow(below);
				},
			);
		});

		it("keeps the Claude identity for the default runtime", async () => {
			await withTemp(
				(cwd) => createMcpRuntime({ cwd, env: {}, interactive: true, consumePhaseAdmission: () => false }),
				async (mcp) => {
					await handleJsonRpc({
						jsonrpc: "2.0",
						id: "probe-initialize",
						method: "initialize",
						params: { protocolVersion: "2025-06-18", clientInfo: { name: "antigravity-client", version: "v1.0.0" }, capabilities: { elicitation: {} } },
					}, mcp);
					await expect(mcp.callTool("start_unattended_batch", { initiative_slug: "probe-initiative" })).rejects.toThrow("unsupported_host: Claude Code version is unavailable");
				},
			);
		});
	});

	// Spec antigravity-mcp-workspace-resolution AC1: the packaged server starts in
	// the plugin root, so the workspace of a call — never its own `cwd` — decides
	// which Kernel record it reads and mutates.
	describe("MCP workspace resolution", () => {
		const TASK = "workspace-resolution";
		const scratch: string[] = [];
		afterAll(() => {
			for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
		});

		function workspace(label: string): string {
			const dir = mkdtempSync(join(tmpdir(), `imm-agy-${label}-`));
			scratch.push(dir);
			return dir;
		}

		/** One Lane worktree with an enrolled task; `pluginDir` stays unowned. */
		async function enrolledLane(): Promise<string> {
			const laneDir = workspace("lane");
			mkdirSync(join(laneDir, ".imm", "state"), { recursive: true });
			mkdirSync(join(laneDir, "docs", "plans"), { recursive: true });
			mkdirSync(join(laneDir, "src"), { recursive: true });
			writeFileSync(join(laneDir, ".gitignore"), ".imm/state/\n");
			writeFileSync(join(laneDir, "src", "worked.ts"), "export const value = 0;\n");
			const intent = {
				contract: "assurance_kernel/task_intent/v1",
				task_id: TASK,
				owner: "user",
				goal: "resolve the active session workspace per MCP tool call",
				acceptance: [{
					id: "AC1",
					assertion: "the workspace binds per call",
					verification: JSON.stringify({
						contract: "assurance_kernel/verification_descriptor/v2",
						command: { executable: "sh", argv: ["-c", "exit 0"], cwd: ".", timeout_ms: 60_000, max_output_bytes: 4_096 },
						environment: { prepare: null, writable_paths: [] },
					}),
				}],
				scope_hint: [`docs/plans/${TASK}.intent.json`, "src/worked.ts"],
				risk: "routine",
				revision: 1,
			};
			writeFileSync(join(laneDir, "docs", "plans", `${TASK}.intent.json`), `${JSON.stringify(intent, null, 2)}\n`);
			execFileSync("git", ["init", "-q"], { cwd: laneDir });
			execFileSync("git", ["add", "-A"], { cwd: laneDir });
			execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "fixture"], { cwd: laneDir });
			await enrollTaskForTest(laneDir, TASK);
			return laneDir;
		}

		type Reply = { result?: unknown; error?: { message: string } } | null;
		const resultOf = (reply: Reply): Record<string, any> => {
			if (!reply) throw new Error("MCP call returned no reply");
			if (reply.error) throw new Error(reply.error.message);
			const content = (reply.result as { content: Array<{ text: string }> }).content;
			return JSON.parse(content[0].text);
		};
		const toolCall = (
			mcp: ReturnType<typeof createAntigravityMcpRuntime>,
			name: string,
			args: Record<string, unknown>,
			workspacePaths?: readonly string[],
			id = `${name}-${Math.random().toString(16).slice(2)}`,
		): Promise<Reply> => handleJsonRpc({
			jsonrpc: "2.0",
			id,
			method: "tools/call",
			params: { name, arguments: args, ...(workspacePaths ? { _meta: { "antigravity.google/workspace_paths": workspacePaths } } : {}) },
		}, mcp);

		it("projects and advances the workspace named in tools/call _meta", async () => {
			const pluginDir = workspace("plugin");
			const laneDir = await enrolledLane();
			const mcp = createAntigravityMcpRuntime({ cwd: pluginDir, env: {}, interactive: true, consumePhaseAdmission: () => false });

			const status = resultOf(await toolCall(mcp, "status", { task_id: TASK }, [laneDir]));
			expect(status.claim).toMatchObject({ task_id: TASK, lifecycle_status: "active" });
			expect(status.projection.run_id).toMatch(/^run-/);
			expect(status.config.project_key).toBeTruthy();
			// The plugin root owns no claim: projecting it is the observable difference.
			const outside = resultOf(await toolCall(mcp, "status", { task_id: TASK }));
			expect(outside.claim).toBeNull();
			expect(outside.config.project_key).not.toBe(status.config.project_key);

			await handleJsonRpc({
				jsonrpc: "2.0",
				id: "init",
				method: "initialize",
				params: { protocolVersion: "2025-06-18", clientInfo: { name: "antigravity-client", version: "v1.0.0" }, capabilities: { elicitation: {} } },
			}, mcp);
			writeFileSync(join(laneDir, "src", "worked.ts"), "export const value = 1;\n");
			execFileSync("git", ["add", "--", "src/worked.ts"], { cwd: laneDir });
			const advanced = resultOf(await toolCall(mcp, "advance_assurance", { task_id: TASK }, [laneDir]));
			// The advance settled the Lane record: its QA descriptor ran there and passed.
			expect(advanced.state).toBe("completed");
			expect(advanced.diagnostics[0]).toMatchObject({ acceptance_id: "AC1", stage: "check", outcome: "passed" });
			// Delivery is read from the settled record in the bound workspace, not the plugin root.
			expect(advanced.delivery.content_hash).toMatch(/^sha256:/);
		}, 60_000);

		it("reads no startup workspace inside the tool dispatch path", () => {
			// The shared guard for AC1: every workspace-scoped read in `callTool`
			// after the reported call sites uses the workspace resolved for that
			// call, never the server's startup directory.
			const source = readFileSync(join(import.meta.dir, "../plugins/immune-brain/runtime/claude/mcp_server.ts"), "utf8");
			const from = source.indexOf("\t\tasync callTool(");
			const body = source.slice(from, source.indexOf("\n\t\tobserve:", from));
			expect(body.length).toBeGreaterThan(0);
			expect(body).not.toContain("options.cwd");
			expect(body).not.toContain("process.cwd()");
		});

		it("rejects an empty, relative or non-file workspace and falls back to its own", async () => {
			const pluginDir = workspace("plugin");
			await enrolledLane();
			const mcp = createAntigravityMcpRuntime({ cwd: pluginDir, env: {}, interactive: true });
			for (const paths of [[], [""], ["relative/path"]])
				expect(resultOf(await toolCall(mcp, "status", { task_id: TASK }, paths)).claim).toBeNull();

			const withRoots = createAntigravityMcpRuntime({ cwd: pluginDir, env: {}, interactive: true, rootsProvider: async () => [{ uri: "https://example.com/repo" }] });
			expect(resultOf(await toolCall(withRoots, "status", { task_id: TASK })).claim).toBeNull();
		});

		it("prefers the _meta workspace over a roots/list answer and never reuses it", async () => {
			const pluginDir = workspace("plugin");
			const otherDir = workspace("other");
			const laneDir = await enrolledLane();
			const mcp = createAntigravityMcpRuntime({ cwd: pluginDir, env: {}, interactive: true, rootsProvider: async () => [{ uri: pathToFileURL(otherDir).href }] });

			expect(resultOf(await toolCall(mcp, "status", { task_id: TASK }, [laneDir])).claim).toMatchObject({ task_id: TASK });
			// The roots answer alone binds the other directory, which owns no claim.
			expect(resultOf(await toolCall(mcp, "status", { task_id: TASK })).claim).toBeNull();

			const unrooted = createAntigravityMcpRuntime({ cwd: pluginDir, env: {}, interactive: true });
			expect(resultOf(await toolCall(unrooted, "status", { task_id: TASK }, [laneDir])).claim).toMatchObject({ task_id: TASK });
			expect(resultOf(await toolCall(unrooted, "status", { task_id: TASK })).claim).toBeNull();
		});

		/** One Antigravity stdio connection started in `pluginDir`, with a line reader. */
		function stdioServer(pluginDir: string) {
			const input = new PassThrough();
			const output = new PassThrough();
			const replies: Record<string, any>[] = [];
			const waiters: Array<(value: Record<string, any>) => void> = [];
			let buffer = "";
			output.on("data", (chunk: Buffer) => {
				buffer += chunk.toString();
				for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
					const line = buffer.slice(0, index);
					buffer = buffer.slice(index + 1);
					if (!line.trim()) continue;
					const value = JSON.parse(line) as Record<string, any>;
					const waiter = waiters.shift();
					if (waiter) waiter(value);
					else replies.push(value);
				}
			});
			const next = () => replies.length ? Promise.resolve(replies.shift()!) : new Promise<Record<string, any>>((resolve) => waiters.push(resolve));
			const send = (message: unknown) => input.write(`${JSON.stringify(message)}\n`);
			void serveAntigravityStdio({ input, output, cwd: pluginDir, env: {}, interactive: true, consumePhaseAdmission: () => false, exit: () => undefined });
			return { input, send, next };
		}

		it("binds the roots/list workspace over stdio and re-queries after roots/list_changed", async () => {
			const pluginDir = workspace("plugin");
			const otherDir = workspace("other");
			const laneDir = await enrolledLane();
			const { input, send, next } = stdioServer(pluginDir);

			send({ jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "antigravity-client", version: "v1.0.0" }, capabilities: { elicitation: {}, roots: { listChanged: true } } } });
			expect((await next()).result.serverInfo).toMatchObject({ name: "antigravity", minimumHostVersion: "0.1.0" });

			send({ jsonrpc: "2.0", id: "status-1", method: "tools/call", params: { name: "status", arguments: { task_id: TASK } } });
			const rootsRequest = await next();
			expect(rootsRequest).toMatchObject({ method: "roots/list" });
			send({ jsonrpc: "2.0", id: rootsRequest.id, result: { roots: [{ uri: pathToFileURL(laneDir).href }] } });
			expect(resultOf((await next()) as Reply).claim).toMatchObject({ task_id: TASK });

			send({ jsonrpc: "2.0", method: "notifications/roots/list_changed" });
			send({ jsonrpc: "2.0", id: "status-2", method: "tools/call", params: { name: "status", arguments: { task_id: TASK } } });
			const second = await next();
			expect(second).toMatchObject({ method: "roots/list" });
			send({ jsonrpc: "2.0", id: second.id, result: { roots: [{ uri: pathToFileURL(otherDir).href }] } });
			// The cache was invalidated: the answer that moved projects the other directory.
			expect(resultOf((await next()) as Reply).claim).toBeNull();
			input.end();
		}, 30_000);

		it("runs one tools/call at a time so a bound workspace cannot move mid-call", async () => {
			const pluginDir = workspace("plugin");
			const laneDir = await enrolledLane();
			const { input, send, next } = stdioServer(pluginDir);
			send({ jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "antigravity-client", version: "v1.0.0" }, capabilities: { elicitation: {} } } });
			await next();

			writeFileSync(join(laneDir, "src", "worked.ts"), "export const value = 1;\n");
			execFileSync("git", ["add", "--", "src/worked.ts"], { cwd: laneDir });
			send({ jsonrpc: "2.0", id: "advance", method: "tools/call", params: { name: "advance_assurance", arguments: { task_id: TASK }, _meta: { "antigravity.google/workspace_paths": [laneDir] } } });
			send({ jsonrpc: "2.0", id: "status", method: "tools/call", params: { name: "status", arguments: { task_id: TASK } } });
			// The slower first call owns the shared binding until it settles.
			expect(resultOf((await next()) as Reply)).toMatchObject({ state: "completed" });
			expect(resultOf((await next()) as Reply).claim).toBeNull();
			input.end();
		}, 60_000);

		it("falls back to its own workspace when roots/list answers with an error", async () => {
			const pluginDir = workspace("plugin");
			await enrolledLane();
			const { input, send, next } = stdioServer(pluginDir);
			send({ jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "antigravity-client", version: "v1.0.0" }, capabilities: { elicitation: {}, roots: {} } } });
			await next();
			send({ jsonrpc: "2.0", id: "status", method: "tools/call", params: { name: "status", arguments: { task_id: TASK } } });
			const rootsRequest = await next();
			expect(rootsRequest).toMatchObject({ method: "roots/list" });
			send({ jsonrpc: "2.0", id: rootsRequest.id, error: { code: -32601, message: "Method not found" } });
			expect(resultOf((await next()) as Reply).claim).toBeNull();
			input.end();
		}, 30_000);
	});

	// Spec antigravity-tool-hook-and-mcp-correlation AC2 (D3, D5): one admitted
	// Antigravity batch call reaches its existing authority path through the Host
	// conversation and the progressToken step, never through Claude metadata.
	describe("Antigravity privileged MCP correlation", () => {
		const TASK = "correlation-task";
		const BATCH_ID = `batch-${TASK}`;
		const PLAN_DIGEST = `sha256:${"a".repeat(64)}`;
		const CREATED_AT = "2026-01-01T00:00:00.000Z";
		const scratch: string[] = [];
		afterAll(() => {
			for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
		});

		function temp(label: string): string {
			const dir = realpathSync(mkdtempSync(join(tmpdir(), `imm-agy-${label}-`)));
			scratch.push(dir);
			return dir;
		}
		function git(dir: string, ...args: string[]): string {
			return execFileSync("git", ["-C", dir, "-c", "user.name=T", "-c", "user.email=t@t", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
		}
		const verification = () => JSON.stringify({
			contract: "assurance_kernel/verification_descriptor/v2",
			command: { executable: "sh", argv: ["-c", "exit 0"], cwd: ".", timeout_ms: 60_000, max_output_bytes: 4_096 },
			environment: { prepare: null, writable_paths: [] },
		});

		/** One workspace: a committed single-task intent, plus an active batch record when asked. */
		function workspace(withBatch = true): string {
			const root = temp("corr");
			mkdirSync(join(root, "docs/plans"), { recursive: true });
			writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
			writeFileSync(join(root, "base.txt"), "base\n");
			writeFileSync(join(root, "docs/plans", `${TASK}.intent.json`), `${JSON.stringify({
				contract: "assurance_kernel/task_intent/v1",
				task_id: TASK,
				owner: "user",
				goal: "one correlated batch call",
				acceptance: [{ id: "AC1", assertion: "the batch call is correlated", verification: verification() }],
				scope_hint: ["docs/plans"],
				risk: "routine",
				revision: 1,
			})}\n`);
			git(root, "init", "-q", "-b", "main");
			git(root, "add", "-A");
			git(root, "commit", "-qm", "fixture");
			if (!withBatch) return root;
			mkdirSync(join(root, ".imm/state/batches"), { recursive: true });
			writeFileSync(join(root, ".imm/state/batches", `${BATCH_ID}.json`), `${JSON.stringify({
				contract: "assurance_kernel/batch_run_state/v1",
				batch_id: BATCH_ID,
				initiative_slug: TASK,
				base_head: git(root, "rev-parse", "HEAD"),
				branch: `imm/${TASK}`,
				plan_digest: PLAN_DIGEST,
				confirmation_time: CREATED_AT,
				batch_state: "running",
				children: [{ task_id: TASK, slice_id: TASK, state: "pending", commit: null, blocked_by: [], reason: null }],
				commits: [],
				consecutive_qa_failures: 0,
				budget: { max_children: 1, qa_failure_limit: 2 },
				created_at: CREATED_AT,
				updated_at: CREATED_AT,
			}, null, 2)}\n`);
			return root;
		}

		/** A literal-user drive entry in `store`, the private root both the Hook and the server use. */
		function enter(store: string, conversationId: string, root: string): void {
			expect(antigravityPreInvocationHook({ conversationId, lastUserInput: `/drive ${TASK}`, workspacePaths: [root] }, { root: store, home: store }).injectSteps).toEqual([]);
		}
		/** The Hook's admission for one lazy gated operation at `stepIdx`. */
		function admit(store: string, conversationId: string, stepIdx: number, toolName: GatedTool, root: string): void {
			expect(antigravityPreToolUseHook({ conversationId, stepIdx, workspacePaths: [root],
				toolCall: { name: "call_mcp_tool", args: { ServerName: "immune-brain", ToolName: toolName, Arguments: {} } } }, { root: store }))
				.toEqual({ decision: "allow" });
		}

		type Reply = { result?: unknown; error?: { data?: { reason_code?: string }; message: string } } | null;
		function resultOf(reply: Reply): Record<string, any> {
			if (!reply?.result) throw new Error(`the call did not resolve: ${reply?.error?.message ?? "no reply"}`);
			return JSON.parse((reply.result as { content: Array<{ text: string }> }).content[0].text);
		}
		function reasonCode(reply: Reply): string {
			if (!reply?.error) throw new Error("the call resolved instead of refusing");
			return reply.error.data?.reason_code ?? reply.error.message;
		}

		it("admits one batch call per Hook step and refuses every uncorrelated or replayed call", async () => {
			const retireRoot = workspace();
			const root = workspace(false);
			const store = temp("store");
			const other = temp("elsewhere");
			const conversationId = "conv-batch-1";
			const retireConversation = "conv-retire";
			const gates: string[] = [];
			const mcp = createAntigravityMcpRuntime({
				cwd: root,
				env: {},
				interactive: true,
				consumePhaseAdmission: (toolCallId: string, operation: GatedTool) => consumePhaseAdmission(toolCallId, operation, store),
				requestConfirmation: async (input) => {
					gates.push(input.operation);
					return { decision: "decline", requestId: `gate-${gates.length}` };
				},
			});
			mcp.bindClientHandshake({ version: "1.0.0", interactive: true, protocolVersion: "2025-06-18" });
			const call = (id: string, name: string, args: Record<string, unknown>, meta?: Record<string, unknown>) =>
				handleJsonRpc({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args, ...(meta ? { _meta: meta } : {}) } }, mcp);
			const meta = (conversation: string, step: number | null, workspacePaths: readonly string[] = [root]) => ({
				"antigravity.google/conversation_id": conversation,
				"antigravity.google/workspace_paths": workspacePaths,
				...(step === null ? {} : { progressToken: `antigravity-hook:${step}` }),
			});

			enter(store, retireConversation, retireRoot);
			// One admitted retirement: the entry token stands in for its native gate, and the
			// admitted conversation — not the transport connection — is its Hook session.
			admit(store, retireConversation, 2, "retire_stale_batch", retireRoot);
			const retired = await call("rpc-77", "retire_stale_batch", { initiative_slug: TASK }, meta(retireConversation, 2, [retireRoot]));
			expect(resultOf(retired).state).toBe("retired");
			expect((resultOf(retired).report as { retirement?: { confirmation_ref?: string; plan_digest?: string } }).retirement).toEqual({
				confirmation_ref: confirmationRef({
					connectionId: retireConversation,
					toolCallId: "rpc-77",
					requestId: entryTokenRequestId(readPhaseEntryState(retireConversation, store)!.token!),
					operation: "retire_stale_batch",
					initiativeSlug: TASK,
					planDigest: PLAN_DIGEST,
				}),
				plan_digest: PLAN_DIGEST,
			});
			// The admission is single-use: the replay consumes nothing.
			expect(reasonCode(await call("rpc-78", "retire_stale_batch", { initiative_slug: TASK }, meta(retireConversation, 2, [retireRoot])))).toBe("run_entry_required");

			// Sequential steps receive distinct admissions, and each reaches the native gate.
			enter(store, conversationId, root);
			admit(store, conversationId, 4, "start_unattended_batch", root);
			expect(resultOf(await call("rpc-81", "start_unattended_batch", { task_id: TASK }, meta(conversationId, 4))))
				.toMatchObject({ state: "rejected", reason: "native interaction declined" });
			admit(store, conversationId, 6, "start_unattended_batch", root);
			expect(resultOf(await call("rpc-85", "start_unattended_batch", { task_id: TASK }, meta(conversationId, 6))))
				.toMatchObject({ state: "rejected", reason: "native interaction declined" });
			expect(gates).toEqual(["start_unattended_batch", "start_unattended_batch"]);

			// Missing and empty Host conversation metadata refuse before any admission.
			admit(store, conversationId, 8, "start_unattended_batch", root);
			expect(reasonCode(await call("rpc-88", "start_unattended_batch", { task_id: TASK },
				{ "antigravity.google/workspace_paths": [root], progressToken: "antigravity-hook:8" }))).toBe("correlation_missing");
			expect(reasonCode(await call("rpc-89", "start_unattended_batch", { task_id: TASK }, meta("", 8)))).toBe("correlation_missing");
			// A different conversation cannot consume this conversation's admission.
			enter(store, "conv-batch-2", root);
			expect(reasonCode(await call("rpc-90", "start_unattended_batch", { task_id: TASK }, meta("conv-batch-2", 8)))).toBe("run_entry_required");
			// The step comes from the progressToken: absent, malformed and wrong steps refuse.
			expect(reasonCode(await call("rpc-91", "start_unattended_batch", { task_id: TASK }, meta(conversationId, null)))).toBe("run_entry_required");
			expect(reasonCode(await call("rpc-92", "start_unattended_batch", { task_id: TASK },
				{ ...meta(conversationId, null), progressToken: "antigravity-hook" }))).toBe("run_entry_required");
			expect(reasonCode(await call("rpc-93", "start_unattended_batch", { task_id: TASK }, meta(conversationId, 9)))).toBe("run_entry_required");
			// A call in another workspace is not this admission's workspace.
			admit(store, conversationId, 10, "start_unattended_batch", root);
			expect(reasonCode(await call("rpc-94", "start_unattended_batch", { task_id: TASK }, meta(conversationId, 10, [other])))).toBe("run_entry_required");
			// An unrelated lazy server receives the ordinary allow and admits nothing.
			expect(antigravityPreToolUseHook({ conversationId, stepIdx: 12, workspacePaths: [root],
				toolCall: { name: "call_mcp_tool", args: { ServerName: "someone-else", ToolName: "start_unattended_batch", Arguments: {} } } }, { root: store }))
				.toEqual({ decision: "allow" });
			expect(reasonCode(await call("rpc-95", "start_unattended_batch", { task_id: TASK }, meta(conversationId, 12)))).toBe("run_entry_required");
			// A refusal consumes no admission: step 8 still admits exactly once afterwards.
			expect(resultOf(await call("rpc-96", "start_unattended_batch", { task_id: TASK }, meta(conversationId, 8))))
				.toMatchObject({ state: "rejected", reason: "native interaction declined" });
			expect(reasonCode(await call("rpc-97", "start_unattended_batch", { task_id: TASK }, meta(conversationId, 8)))).toBe("run_entry_required");
		}, 60_000);
	});

	// Spec antigravity-tool-hook-and-mcp-correlation AC3 (D6): the other privileged
	// operations reach their existing native gate from Antigravity conversation
	// metadata, and neither create nor consume batch admission.
	describe("Antigravity privileged native gates", () => {
		const TASK = "native-gate-task";
		const scratch: string[] = [];
		afterAll(() => {
			for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
		});

		function temp(label: string): string {
			const dir = realpathSync(mkdtempSync(join(tmpdir(), `imm-agy-${label}-`)));
			scratch.push(dir);
			return dir;
		}
		function git(dir: string, ...args: string[]): string {
			return execFileSync("git", ["-C", dir, "-c", "user.name=T", "-c", "user.email=t@t", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
		}
		const verification = () => JSON.stringify({
			contract: "assurance_kernel/verification_descriptor/v2",
			command: { executable: "sh", argv: ["-c", "exit 0"], cwd: ".", timeout_ms: 60_000, max_output_bytes: 4_096 },
			environment: { prepare: null, writable_paths: [] },
		});
		const intentPath = (root: string) => join(root, "docs/plans", `${TASK}.intent.json`);
		function writeIntent(root: string, goal: string, revision: number): void {
			mkdirSync(join(root, "docs/plans"), { recursive: true });
			writeFileSync(intentPath(root), `${JSON.stringify({
				contract: "assurance_kernel/task_intent/v1",
				task_id: TASK,
				owner: "user",
				goal,
				acceptance: [{ id: "AC1", assertion: "the native gate is reached", verification: verification() }],
				scope_hint: ["docs/plans"],
				risk: "routine",
				revision,
			})}\n`);
		}

		/** One enrolled task: each privileged operation projects its Kernel record. */
		async function enrolledRoot(): Promise<string> {
			const root = temp("gates");
			writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
			writeFileSync(join(root, "base.txt"), "base\n");
			writeIntent(root, "reach the native gate", 1);
			git(root, "init", "-q", "-b", "main");
			git(root, "add", "-A");
			git(root, "commit", "-qm", "fixture");
			await enrollTaskForTest(root, TASK);
			return root;
		}

		/** One open user decision, so `request_authorization` has a derived operation. */
		function recordUserDecision(root: string): void {
			const record = readTaskRecordRaw(root, TASK).record;
			if (!record) throw new Error("the fixture task is not enrolled");
			createCanaryApplication(createTestMutationRegistry()).execute({
				root,
				task_id: TASK,
				prior_intent_token: readTaskIntent(root, TASK, record.intent_ref.path, record.intent_snapshot).token,
				operation: { op: "record_finding", actor_id: "literal-user",
					finding: { id: "user-decision-1", kind: "unresolved_user_decision", acceptance_id: null, summary: "the user must choose" } },
			});
		}

		/** One Antigravity stdio connection, with a line reader for replies and elicitations. */
		function wire(root: string) {
			const input = new PassThrough();
			const output = new PassThrough();
			const replies: Record<string, any>[] = [];
			const waiters: Array<(value: Record<string, any>) => void> = [];
			let buffer = "";
			output.on("data", (chunk: Buffer) => {
				buffer += chunk.toString();
				for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
					const line = buffer.slice(0, index);
					buffer = buffer.slice(index + 1);
					if (!line.trim()) continue;
					const value = JSON.parse(line) as Record<string, any>;
					const waiter = waiters.shift();
					if (waiter) waiter(value);
					else replies.push(value);
				}
			});
			const next = () => replies.length ? Promise.resolve(replies.shift()!) : new Promise<Record<string, any>>((resolve) => waiters.push(resolve));
			const send = (message: unknown) => input.write(`${JSON.stringify(message)}\n`);
			void serveAntigravityStdio({ input, output, cwd: root, env: {}, interactive: true, exit: () => undefined });
			return { input, send, next };
		}

		const conversationId = "conv-gate-1";
		const meta = (root: string) => ({ "antigravity.google/conversation_id": conversationId, "antigravity.google/workspace_paths": [root] });
		async function initialize(server: ReturnType<typeof wire>): Promise<void> {
			server.send({ jsonrpc: "2.0", id: "init", method: "initialize",
				params: { protocolVersion: "2025-06-18", clientInfo: { name: "antigravity-client", version: "v1.0.0" }, capabilities: { elicitation: {} } } });
			expect((await server.next()).result.serverInfo).toMatchObject({ name: "antigravity" });
		}
		/** Send one privileged call and return the native gate it opened. */
		async function holdGate(server: ReturnType<typeof wire>, id: string, name: string, args: Record<string, unknown>, root: string) {
			server.send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args, _meta: meta(root) } });
			const elicitation = await server.next();
			expect(elicitation).toMatchObject({ jsonrpc: "2.0", method: "elicitation/create" });
			return elicitation.id as string;
		}

		it("request_authorization reaches its gate without Claude metadata and a decline writes nothing", async () => {
			const root = await enrolledRoot();
			const server = wire(root);
			await initialize(server);
			recordUserDecision(root);
			const before = readTaskRecordRaw(root, TASK).revision;
			const gate = await holdGate(server, "auth-1", "request_authorization", { task_id: TASK }, root);
			server.send({ jsonrpc: "2.0", id: gate, result: { action: "decline" } });
			expect(JSON.stringify(await server.next())).toContain("user_denied");
			expect(readTaskRecordRaw(root, TASK).revision).toBe(before);
			server.input.end();
		}, 30_000);

		it("approve_breaking_intent_revision reaches its gate and a decline restores the staged intent", async () => {
			const root = await enrolledRoot();
			const server = wire(root);
			await initialize(server);
			const before = readTaskRecordRaw(root, TASK).revision;
			const original = readFileSync(intentPath(root), "utf8");
			const next = { contract: "assurance_kernel/task_intent/v1", task_id: TASK, owner: "user", goal: "a different goal",
				acceptance: [{ id: "AC1", assertion: "the native gate is reached", verification: verification() }],
				scope_hint: ["docs/plans"], risk: "routine", revision: 2 };
			const gate = await holdGate(server, "breaking-1", "approve_breaking_intent_revision", { task_id: TASK, next_intent: next }, root);
			server.send({ jsonrpc: "2.0", id: gate, result: { action: "decline" } });
			expect(JSON.stringify(await server.next())).toContain("user_denied");
			expect(readTaskRecordRaw(root, TASK).revision).toBe(before);
			expect(readFileSync(intentPath(root), "utf8")).toBe(original);
			server.input.end();
		}, 30_000);

		it("stop reaches its gate, refuses an uncorrelated call, and never manufactures batch admission", async () => {
			const root = await enrolledRoot();
			const server = wire(root);
			await initialize(server);
			// No Host conversation: refused before any gate opens.
			server.send({ jsonrpc: "2.0", id: "uncorrelated", method: "tools/call",
				params: { name: "stop", arguments: { task_id: TASK }, _meta: { "antigravity.google/workspace_paths": [root] } } });
			expect(await server.next()).toMatchObject({ error: { data: { reason_code: "correlation_missing" } } });
			// A lazy native-gate operation is not a gated batch operation: it admits nothing.
			expect(antigravityPreToolUseHook({ conversationId, stepIdx: 3, workspacePaths: [root],
				toolCall: { name: "call_mcp_tool", args: { ServerName: "immune-brain", ToolName: "request_authorization", Arguments: {} } } }))
				.toEqual({ decision: "allow" });
			server.send({ jsonrpc: "2.0", id: "batch-1", method: "tools/call",
				params: { name: "start_unattended_batch", arguments: { task_id: TASK },
					_meta: { ...meta(root), progressToken: "antigravity-hook:3" } } });
			expect(await server.next()).toMatchObject({ error: { data: { reason_code: "run_entry_required" } } });
			// One accept stops the task exactly once.
			const gate = await holdGate(server, "stop-1", "stop", { task_id: TASK }, root);
			server.send({ jsonrpc: "2.0", id: gate, result: { action: "accept", content: {} } });
			expect(JSON.stringify(await server.next())).not.toContain("error");
			expect(readTaskRecordRaw(root, TASK).record).toBeNull();
			server.input.end();
		}, 30_000);
	});
});
