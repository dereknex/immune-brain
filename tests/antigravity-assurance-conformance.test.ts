import { afterAll, describe, expect, it, spyOn } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import {
	AntigravityReviewHost,
	antigravityHookEventLog,
	VERIFIER_AGENT,
	type AntigravityHookEvent,
} from "../plugins/immune-brain/runtime/antigravity/review_host";
import { MemoryHookEventLog } from "../plugins/immune-brain/runtime/host-core/hook_event_log";
import {
	antigravityPreInvocationHook,
	antigravityPreToolUseHook,
	readPhaseEntryState,
} from "../plugins/immune-brain/runtime/antigravity/lane_guard";
import { isPrivilegedOperation } from "../plugins/immune-brain/runtime/antigravity/interaction";
import { antigravityRunContinuationHook } from "../plugins/immune-brain/runtime/antigravity/run_continuation";
import { AntigravityRuntime } from "../plugins/immune-brain/runtime/antigravity/kernel_ports";
import { ClaudeRuntime } from "../plugins/immune-brain/runtime/claude/kernel_ports";
import { createAntigravityMcpRuntime, serveStdio as serveAntigravityStdio } from "../plugins/immune-brain/runtime/antigravity/mcp_server";
import { createMcpRuntime, handleJsonRpc } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { NativeAuthorityError } from "../plugins/immune-brain/runtime/antigravity/interaction";
import { parseSemver, probeHost } from "../plugins/immune-brain/runtime/antigravity/capability";
import { enrollTaskForTest } from "./helpers/kernel-enroll";
import type { AssuranceHostPort, HostReviewReservation, VerificationRequest } from "../plugins/immune-brain/runtime/assurance/host_port";
import { digestOfReviewerBytes } from "../plugins/immune-brain/runtime/assurance/review_mediation";
import { writeTestReviewPacket } from "./helpers/review-packet-fixture";
import * as batchPreflight from "../plugins/immune-brain/runtime/unattended/batch_preflight";
import * as coordinator from "../plugins/immune-brain/runtime/assurance/coordinator";
import type { StatusProjectionResult } from "../plugins/immune-brain/runtime/assurance/coordinator";
import type { AssuranceObligation } from "../plugins/immune-brain/runtime/kernel/types";
import type { AssuranceProjection } from "../plugins/immune-brain/runtime/kernel/assurance_projection";

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
			const eventLog = new MemoryHookEventLog<AntigravityHookEvent>();
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

		it("settles a verification receipt from the start and the PostToolUse result alone", () => {
			const eventLog = new MemoryHookEventLog<AntigravityHookEvent>();
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

			// Before event observation, no start event has been observed.
			expect(host.inspectVerification(reservation)).toMatchObject({ ok: false, release: true });

			eventLog.append({
				type: "start",
				sessionId: "conv-123",
				agent: VERIFIER_AGENT,
				agentId: "agent-step-456",
				prompt: dispatchPrompt,
			});
			// BR-SCN-1: `PostToolUse` is this Host's terminal event, so the receipt is
			// complete without any `SubagentStop`.
			expect(host.inspectVerification(reservation)).toMatchObject({
				ok: false,
				reason: "foreground Agent terminal event order is incomplete",
				release: false,
			});
			eventLog.append({
				type: "result",
				sessionId: "conv-123",
				agentId: "agent-step-456",
				result: JSON.stringify({ verdict: "approved", findings: [] }),
				prompt: dispatchPrompt,
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
		function projectionStatus(next_obligation: AssuranceObligation,
				overrides: Partial<AssuranceProjection> = {}): StatusProjectionResult {
			return { contract: "assurance_kernel/assurance_projection/v1", task_id: "task-a", error: null,
				claim: { task_id: "task-a", lifecycle_status: "active" },
				projection: { run_id: "run-a", record_revision: "record-a", workspace_revision: "workspace-a", intent_revision: 1,
					intent_content_hash: "intent-a", diff_hash: "diff-a", lifecycle: "active", artifact_state: "active", risk: "material",
					next_obligation, fresh_acceptance_ids: [], missing_acceptance_ids: [], stale_attestation_ids: [],
					fresh_approval_kinds: [], missing_approval_kinds: [], blocking_finding_ids: [],
					unresolved_user_decision_ids: [], replan_required_ids: [], independence_violations: [],
					open_user_decision_count: 0, completion_ready: false,
					authorization: { state: "none", blocked: null }, ...overrides } };
		}

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

		it("continues an automated obligation and stops on a user wait, a non-active lifecycle or any other obligation (D11)", async () => {
			const stopWorkspace = mkdtempSync(join(tmpdir(), "imm-stop-projection-"));
			const claim = spyOn(batchPreflight, "readActiveClaimTaskId").mockReturnValue("task-a");
			const projection = spyOn(coordinator, "projectTaskStatus");
			try {
				projection.mockResolvedValue(projectionStatus("run_qa"));
				expect(await antigravityRunContinuationHook({ conversationId: "conv-stop-2", workspacePaths: [stopWorkspace] }))
					.toEqual({ decision: "continue", reason: "Task task-a is active with next obligation: run_qa. Please proceed." });

				for (const stopped of [
					projectionStatus("resolve_user_decision"),
					projectionStatus("revise_intent"),
					projectionStatus("run_qa", { open_user_decision_count: 1 }),
					projectionStatus("run_qa", { unresolved_user_decision_ids: ["decision-1"] }),
					projectionStatus("run_qa", { lifecycle: "stopped" }),
					projectionStatus("none"),
					projectionStatus("complete"),
				]) {
					projection.mockResolvedValue(stopped);
					expect(await antigravityRunContinuationHook({ conversationId: "conv-stop-2", workspacePaths: [stopWorkspace] })).toEqual({});
				}
			} finally {
				claim.mockRestore(); projection.mockRestore();
				rmSync(stopWorkspace, { recursive: true, force: true });
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

describe("hook dispatch writes subagent events", () => {
	const HOOK = join(process.cwd(), "plugins/immune-brain/runtime/antigravity/mcp_server.ts");
	const SUBAGENT_ARGS = { TypeName: "immune-brain-review-verifier", Role: "Review Verifier", Prompt: "p", Model: "m" };

	/** Run the real `--hook` entry over an isolated cache root and read its file log. */
	function dispatch(root: string, payload: unknown) {
		const stdout = execFileSync("bun", [HOOK, "--hook"], {
			env: { ...process.env, TMPDIR: root },
			input: JSON.stringify(payload),
			encoding: "utf8",
		});
		return { stdout: stdout.trim(), events: antigravityHookEventLog(root).list("c") };
	}

	function preToolUse(toolCall: { name: string; args: Record<string, unknown> }, extra: Record<string, unknown> = {}) {
		return { toolCall, stepIdx: 7, conversationId: "c", ...extra };
	}

	it("records an allowed invoke_subagent start and its terminal result in order", () => {
		const root = mkdtempSync(join(tmpdir(), "antigravity-hook-events-"));
		try {
			const pre = dispatch(root, preToolUse({ name: "invoke_subagent", args: SUBAGENT_ARGS }));
			expect(pre.stdout).toBe('{"decision":"allow"}');
			const post = dispatch(root, { ...preToolUse({ name: "invoke_subagent", args: SUBAGENT_ARGS }), result: "r" });
			expect(post.stdout).toBe("{}");
			expect(post.events.map((event) => event.type)).toEqual(["start", "result"]);
			expect(post.events[0]).toMatchObject({ sessionId: "c", agent: "immune-brain-review-verifier", agentId: "7", prompt: "p" });
			expect(post.events[1]).toMatchObject({ sessionId: "c", agentId: "7", result: "r" });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("maps the Subagent tool name the same way", () => {
		const root = mkdtempSync(join(tmpdir(), "antigravity-hook-subagent-"));
		try {
			const pre = dispatch(root, preToolUse({ name: "Subagent", args: SUBAGENT_ARGS }));
			expect(pre.stdout).toBe('{"decision":"allow"}');
			const post = dispatch(root, { ...preToolUse({ name: "Subagent", args: SUBAGENT_ARGS }), result: "r" });
			expect(post.events.map((event) => event.type)).toEqual(["start", "result"]);
			expect(post.events[1]).toMatchObject({ agentId: "7", result: "r" });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("appends nothing for another tool or for a subagent call without stepIdx", () => {
		const root = mkdtempSync(join(tmpdir(), "antigravity-hook-no-events-"));
		try {
			expect(dispatch(root, preToolUse({ name: "edit_file", args: { Path: "x" } })).events).toEqual([]);
			const withoutStep = { toolCall: { name: "invoke_subagent", args: SUBAGENT_ARGS }, conversationId: "c" };
			expect(dispatch(root, withoutStep).events).toEqual([]);
			expect(antigravityHookEventLog(root).sessions()).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps a PostToolUse result that has no earlier start event", () => {
		const root = mkdtempSync(join(tmpdir(), "antigravity-hook-orphan-"));
		try {
			const post = dispatch(root, { ...preToolUse({ name: "invoke_subagent", args: SUBAGENT_ARGS }), result: "r" });
			expect(post.events.map((event) => event.type)).toEqual(["result"]);
			expect(post.events[0]).toMatchObject({ agentId: "7", result: "r" });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
});

// Spec docs/specs/host-neutral-adapter-core.spec.md S2 AC3 (BR-SCN-1, BR-REQ-8,
// BR-DEC-3; D4, D5). BR-SCN-1: an Antigravity developer's `submit_verification`
// accepts the receipt its own `--hook` entry wrote, because `PostToolUse` is
// this Host's terminal event.
describe("verifier via real hook dispatch", () => {
	const HOOK_ENTRY = join(process.cwd(), "plugins/immune-brain/runtime/antigravity/mcp_server.ts");
	const SCRATCH: string[] = [];
	const TMPDIR_BEFORE = process.env.TMPDIR;
	const PATH_BEFORE = process.env.PATH;
	const TASK = "antigravity-verifier-task";
	const STEP_IDX = 7;
	const CONVERSATION = "conversation-1";
	const CLAIM = "the delivery violates its acceptance";

	afterAll(() => {
		if (TMPDIR_BEFORE === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = TMPDIR_BEFORE;
		process.env.PATH = PATH_BEFORE;
		for (const dir of SCRATCH) rmSync(dir, { recursive: true, force: true });
	});

	function scratchDir(label: string): string {
		const dir = mkdtempSync(join(tmpdir(), `imm-antigravity-verifier-${label}-`));
		SCRATCH.push(dir);
		return dir;
	}

	/** One real Git repository: the CLI reviewer's tree guard needs HEAD and tracked bytes. */
	function repo(): string {
		const root = scratchDir("repo");
		execFileSync("git", ["init", "-q"], { cwd: root });
		execFileSync("git", ["config", "user.name", "test"], { cwd: root });
		execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
		mkdirSync(join(root, ".imm"), { recursive: true });
		writeFileSync(join(root, ".imm/config.json"), `${JSON.stringify({
			contract: "immune_brain/project_config/v1", lanes: { review_host: "pi" }, review_verifier: "on",
		})}\n`);
		writeFileSync(join(root, "src.ts"), "export const value = 1;\n");
		execFileSync("git", ["add", "-A"], { cwd: root });
		execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
		return root;
	}

	/** A reviewer stand-in under the Host binary name, first on PATH (no model call). */
	function fakeReviewer(bytes: string): void {
		const dir = scratchDir("bin");
		const file = join(dir, "pi");
		writeFileSync(file, `#!/bin/sh\ncat <<'IMM_VERDICT'\n${bytes}IMM_VERDICT\n`, { mode: 0o755 });
		execFileSync("chmod", ["755", file]);
		process.env.PATH = [dir, PATH_BEFORE].filter(Boolean).join(":");
	}

	function snapshotOf(root: string, role: "qa" | "review"): coordinator.SnapshotDescriptor {
		return {
			contract: "assurance_kernel/assurance_snapshot/v2", task_id: TASK, run_id: null, role,
			record_revision: "record-1", workspace_revision: "workspace-1", intent_revision: 1,
			intent_content_hash: "sha256:intent", diff_hash: "sha256:diff", lifecycle: "active", artifact_state: "frozen",
			risk: "material", fresh_acceptance_ids: ["A1"], missing_acceptance_ids: [], stale_attestation_ids: [],
			acceptance: [{ id: "A1", assertion: "the change satisfies the acceptance", verification: "{}" }],
			dirty_files: ["src.ts"], review_bundle_digest: role === "review" ? "sha256:bundle" : null,
			review_revision: { contract: "assurance_kernel/review_revision_identity/v1", base_head: "a".repeat(40),
				review_commit: "b".repeat(40), review_tree: "c".repeat(40), manifest_digest: `sha256:${"d".repeat(64)}` },
			root,
		} as coordinator.SnapshotDescriptor;
	}

	function reviewBundle(root: string): coordinator.ReviewBundle {
		return {
			contract: "assurance_kernel/review_bundle/v4", root, head: "a".repeat(40), scope: ["src.ts"],
			diff_hash: "sha256:diff", dirty_files: {}, outcomes: { A1: { status: "passed", summary: "fresh" } },
			bundle_digest: "sha256:bundle",
		} as unknown as coordinator.ReviewBundle;
	}

	function reworkVerdict(snapshot: coordinator.SnapshotDescriptor): coordinator.AssuranceVerdict {
		return {
			contract: "assurance_kernel/assurance_verdict/v2", role: "review", task_id: TASK,
			snapshot_digest: coordinator.snapshotDigest(snapshot), decision: "rework",
			findings: [{ id: "review-1", kind: "blocking", acceptance_id: "A1", summary: CLAIM,
				evidence: { trigger: "src.ts returns a stale value → the acceptance assertion fails", caller_chain: ["src.ts"],
					violated: { kind: "acceptance", ref: "A1" } } }],
		} as coordinator.AssuranceVerdict;
	}

	interface Applied {
		role: string;
		decision: string;
		kept?: string[];
		actor?: string | null;
		failure?: string;
	}

	/** Fixture ports: the Review dispatch is real, everything behind it is not. */
	function fixturePorts(root: string, applied: Applied[]): {
		ports: Partial<coordinator.AssuranceCoordinatorPorts>;
		authority: Partial<coordinator.VerdictAuthority>;
	} {
		let obligation: "run_qa" | "run_review" | "complete" = "run_qa";
		const ports = {
			confirmationReference: ({ actorId }) => `fixture:${actorId}`,
			projectTask: async () => ({
				error: null,
				claim: { task_id: TASK, lifecycle_status: "active" },
				projection: { lifecycle: "active", artifact_state: "frozen", risk: "material", next_obligation: obligation,
					record_revision: "record-1", workspace_revision: "workspace-1", intent_revision: 1,
					intent_content_hash: "sha256:intent", diff_hash: "sha256:diff", fresh_acceptance_ids: ["A1"],
					missing_acceptance_ids: [], stale_attestation_ids: [], blocking_finding_ids: [], unresolved_user_decision_ids: [],
					replan_required_ids: [], completion_ready: false, authorization: { state: "none" } },
			}) as never,
			readTaskRecord: async () => ({ revision: "record-1", record: { findings: [], history: [] } }),
			readTaskIntent: async () => ({ token: "intent-token" }),
			buildAssurance: async (_root: string, _task: string, role: "qa" | "review") => ({
				snapshot: snapshotOf(root, role),
				descriptors: new Map([["A1", {
					contract: "assurance_kernel/verification_descriptor/v2",
					command: { executable: "bun", argv: ["test"], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 },
					environment: { prepare: null, writable_paths: [] },
				}]] as never),
				reviewBundle: role === "review" ? reviewBundle(root) : null,
			}),
			runQa: async (s: coordinator.SnapshotDescriptor) => ({
				contract: "assurance_kernel/assurance_verdict/v2", role: s.role, task_id: TASK,
				snapshot_digest: coordinator.snapshotDigest(s), decision: "pass",
				approval: { kind: "qa", authority_role: "qa", summary: "passed" },
			} as coordinator.AssuranceVerdict),
			writeReviewEvidence: () => {
				const dir = scratchDir("evidence");
				const path = join(dir, "evidence.json");
				writeFileSync(path, "{}");
				return { path, writePacket: writeTestReviewPacket, remove: () => rmSync(dir, { recursive: true, force: true }) };
			},
			applyOrdinaryOperation: async () => undefined,
		} as unknown as Partial<coordinator.AssuranceCoordinatorPorts>;
		const authority = {
			buildAssurance: ports.buildAssurance,
			applyVerdict: async (_ctx, input) => {
				applied.push({ role: input.snapshot.role, decision: input.verdict.decision,
					...(input.verification ? { kept: input.verification.kept_finding_ids,
						actor: input.verification.facts.verifier_actor, ...(input.verification.facts.failure ? { failure: input.verification.facts.failure } : {}) } : {}) });
				obligation = input.snapshot.role === "qa" ? "run_review" : input.verdict.decision === "rework" ? "run_qa" : "complete";
			},
			ensureReviewRevision: async () => snapshotOf(root, "review").review_revision!,
		} as unknown as Partial<coordinator.VerdictAuthority>;
		return { ports, authority };
	}

	/** The runtime's own Host, wrapped so a refused inspection reason stays observable. */
	function recordingHost(): { host: AssuranceHostPort & { observe(event: AntigravityHookEvent): void }; reasons: string[] } {
		const inner = new AntigravityReviewHost(antigravityHookEventLog());
		const reasons: string[] = [];
		return {
			reasons,
			host: {
				host: "antigravity",
				prepareVerification: (request: VerificationRequest) => inner.prepareVerification(request),
				inspectVerification: (reservation: HostReviewReservation) => {
					const result = inner.inspectVerification(reservation);
					if (!result.ok) reasons.push(result.reason);
					return result;
				},
				observe: (event: AntigravityHookEvent) => inner.observe(event),
				releaseReview: (reservation: HostReviewReservation) => inner.releaseReview(reservation),
			},
		};
	}

	/** Dispatch the real `--hook` entry against this case's isolated cache root. */
	function hook(cache: string, payload: unknown): string {
		return execFileSync("bun", [HOOK_ENTRY, "--hook"], {
			env: { ...process.env, TMPDIR: cache }, input: JSON.stringify(payload), encoding: "utf8",
		}).trim();
	}

	function dispatchEvent(dispatch: { TypeName: string; Prompt: string; Model: string }, result?: string) {
		return {
			toolCall: { name: "invoke_subagent", args: dispatch },
			stepIdx: STEP_IDX, conversationId: CONVERSATION,
			...(result === undefined ? {} : { result }),
		};
	}

	interface Setup {
		root: string;
		cache: string;
		host: { host: AssuranceHostPort & { observe(event: AntigravityHookEvent): void }; reasons: string[] };
		runtime: AntigravityRuntime;
		applied: Applied[];
		bytes: string;
	}

	/** A repository with the verifier mode on, its own cache root, and a real dispatch. */
	async function setup(): Promise<Setup & { dispatch: { TypeName: string; Prompt: string; Model: string } }> {
		const root = repo();
		const cache = scratchDir("cache");
		process.env.TMPDIR = cache;
		const host = recordingHost();
		const applied: Applied[] = [];
		const reviewerVerdict = reworkVerdict(snapshotOf(root, "review"));
		const bytes = `${JSON.stringify(reviewerVerdict)}\n`;
		fakeReviewer(bytes);
		const fixture = fixturePorts(root, applied);
		const runtime = new AntigravityRuntime({ cwd: root, interactive: false, host: host.host, ports: fixture.ports,
			authorityOverrides: fixture.authority });
		const ready = await runtime.coordinator.advance(TASK, { cwd: root });
		if (ready.state !== "review_ready" || !ready.review_command) throw new Error(`expected review_ready, got ${JSON.stringify(ready)}`);
		execFileSync("sh", [ready.review_command.slice(3)]);
		const verification = await runtime.submitReview(TASK, undefined);
		if (verification.state !== "verification_ready") throw new Error(`expected verification_ready, got ${JSON.stringify(verification)}`);
		return { root, cache, host, runtime, applied, bytes, dispatch: verification.agent_params as { TypeName: string; Prompt: string; Model: string } };
	}

	function verifierResult(caseSetup: Setup): string {
		const snapshot = snapshotOf(caseSetup.root, "review");
		const parsed = coordinator.parseAssuranceVerdict(reworkVerdict(snapshot), snapshot);
		const packet = coordinator.buildReviewVerificationPacket(snapshot, parsed, digestOfReviewerBytes(caseSetup.bytes));
		const finding = packet.findings[0]!;
		return JSON.stringify({ contract: "assurance_kernel/review_verification/v1", task_id: TASK,
			snapshot_digest: packet.snapshot_digest, verdict_sha256: packet.verdict_sha256,
			results: [{ finding_id: finding.id, anchor: finding.anchor, verdict: "kept" }] });
	}

	it("accepts the receipt the real hook entry wrote for the handed-out dispatch", async () => {
		const current = await setup();
		expect(current.dispatch.TypeName).toBe(VERIFIER_AGENT);
		expect(current.dispatch.Prompt).toContain("immune-brain-verifier:operation_id=");

		expect(hook(current.cache, dispatchEvent(current.dispatch))).toBe('{"decision":"allow"}');
		hook(current.cache, dispatchEvent(current.dispatch, verifierResult(current)));

		const settled = await current.runtime.submitVerification(TASK, undefined);
		expect(settled).toMatchObject({ state: "rework", summary: CLAIM });
		expect(current.applied.at(-1)).toMatchObject({ role: "review", decision: "rework",
			kept: [expect.stringContaining("review-1")], actor: `antigravity:${STEP_IDX}` });
		expect(current.applied.at(-1)?.failure).toBeUndefined();
	});

	it("refuses a receipt whose start event never arrived", async () => {
		const current = await setup();
		hook(current.cache, dispatchEvent(current.dispatch, verifierResult(current)));

		await current.runtime.submitVerification(TASK, undefined);
		expect(current.host.reasons).toContain("reserved foreground Agent was not observed");
		expect(current.applied.at(-1)).toMatchObject({ actor: null, failure: "dispatch_failed" });
	});

	it("refuses a start event that names another agent", async () => {
		const current = await setup();
		const foreign = { ...current.dispatch, TypeName: "immune-brain-reviewer" };
		expect(hook(current.cache, dispatchEvent(foreign))).toBe('{"decision":"allow"}');
		hook(current.cache, dispatchEvent(foreign, verifierResult(current)));

		await current.runtime.submitVerification(TASK, undefined);
		expect(current.host.reasons).toContain("reserved foreground Agent was not observed");
	});

	it("keeps the reservation after the start event and accepts the result that follows", async () => {
		const current = await setup();
		hook(current.cache, dispatchEvent(current.dispatch));

		const pendingSubmit = await current.runtime.submitVerification(TASK, undefined);
		expect(pendingSubmit).toMatchObject({ state: "blocked", reason: "verification result pending" });
		expect(current.host.reasons).toContain("foreground Agent terminal event order is incomplete");

		hook(current.cache, dispatchEvent(current.dispatch, verifierResult(current)));
		const accepted = await current.runtime.submitVerification(TASK, undefined);
		expect(accepted).toMatchObject({ state: "rework" });
		expect(current.applied.at(-1)).toMatchObject({ actor: `antigravity:${STEP_IDX}` });
	});
});
