import { afterAll, describe, expect, it, spyOn } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import {
	ANTIGRAVITY_CACHE_DIR,
	AntigravityReviewHost,
	antigravityHookEventLog,
	MAX_ASYNC_VERIFIER_FILE_BYTES,
	VERIFIER_AGENT,
	type AntigravityHookEvent,
} from "../plugins/immune-brain/runtime/antigravity/review_host";
import { MemoryHookEventLog } from "../plugins/immune-brain/runtime/host-core/hook_event_log";
import {
	antigravityPostToolUseHook,
	antigravityPreInvocationHook,
	antigravityPreToolUseHook,
	antigravityPreToolUseHookAsync,
	consumeNativeConfirmation,
	consumePhaseAdmission,
	readPhaseEntryState,
	type AntigravityStopPayload,
	type GatedTool,
} from "../plugins/immune-brain/runtime/antigravity/lane_guard";
import { appendPrivate, cacheDir, ensurePrivateDir, sessionHash } from "../plugins/immune-brain/runtime/host-core/private_file";
import { isPrivilegedOperation } from "../plugins/immune-brain/runtime/host-core/interaction";
import * as runContinuationModule from "../plugins/immune-brain/runtime/assurance/run_continuation";
import {
	antigravityContinuationHost,
	antigravityRunContinuationHook,
	antigravityRunContinuationPostToolUse,
	antigravityRunContinuationPreToolUse,
	isSessionPaused,
	parseImmuneBrainTool,
	readRunToolSession,
	selectedAntigravityParent,
	stopBoundary,
} from "../plugins/immune-brain/runtime/antigravity/run_continuation";
import { applyRunContinuationEvent } from "../plugins/immune-brain/runtime/host-core/run_continuation_session";
import { AntigravityRuntime } from "../plugins/immune-brain/runtime/antigravity/kernel_ports";
import { ClaudeRuntime } from "../plugins/immune-brain/runtime/claude/kernel_ports";
import { createAntigravityMcpRuntime, serveStdio as serveAntigravityStdio } from "../plugins/immune-brain/runtime/antigravity/mcp_server";
import { createMcpRuntime, handleJsonRpc } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { NativeAuthorityError, entryTokenRequestId, hostConfirmationRef } from "../plugins/immune-brain/runtime/host-core/interaction";
import { createCanaryApplication } from "../plugins/immune-brain/runtime/kernel/canary_application";
import { canonicalIntentHash, parseTaskIntentV1, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import { readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage";
import { createTestMutationRegistry, seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";
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

		it("denies privileged MCP tool calls outright when not admitted", () => {
			const result = antigravityPreToolUseHook({
				conversationId: "conv-gate-1",
				toolCall: {
					name: "mcp__immune-brain__start_unattended_batch",
					args: { taskId: "task-123" },
				},
			});

			expect(result.decision).toBe("deny");
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
			// A private store: the real OS temp directory is the Host's own state.
			const root = mkdtempSync(join(tmpdir(), "drive-entry-store-"));
			try {
				const res = antigravityPreInvocationHook({
					conversationId: "conv-drive-1",
					lastUserInput: "/drive task-999",
				}, { root, home: root });

				expect(res.injectSteps).toBeDefined();

				const state = readPhaseEntryState("conv-drive-1", root);
				expect(state?.run_live).toBe(true);

				// PreToolUse with stepIdx succeeds and records admission
				const admitted = antigravityPreToolUseHook({
					conversationId: "conv-drive-1",
					stepIdx: 42,
					toolCall: {
						name: "mcp__immune-brain__start_unattended_batch",
						args: { taskId: "task-999" },
					},
				}, { root });
				expect(admitted.decision).toBe("allow");

				// PreToolUse missing stepIdx fails closed
				const missingStep = antigravityPreToolUseHook({
					conversationId: "conv-drive-1",
					toolCall: {
						name: "mcp__immune-brain__start_unattended_batch",
						args: { taskId: "task-999" },
					},
				}, { root });
				expect(missingStep.decision).toBe("deny");
				expect(missingStep.reason).toContain("Tool invocation identity (stepIdx) is missing");
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
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
		function antigravityContinuationFixture(storeDir?: string) {
			const root = realpathSync(mkdtempSync(join(tmpdir(), "imm-agy-cont-")));
			const store = storeDir ?? realpathSync(mkdtempSync(join(tmpdir(), "imm-agy-store-")));
			const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
			git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.test");
			mkdirSync(join(root, "docs/plans"), { recursive: true });
			writeFileSync(join(root, ".gitignore"), ".imm/\n");
			writeFileSync(join(root, "value.txt"), "before\n");
			const intent = parseTaskIntentV1({
				contract: "assurance_kernel/task_intent/v1",
				task_id: "slice-a",
				goal: "Change value",
				acceptance: [{ id: "A1", assertion: "Value changes", verification: "bun test tests/value.test.ts" }],
				scope_hint: ["value.txt", "docs/plans/slice-a.intent.json"],
				risk: "material",
				revision: 1,
				owner: "user",
			});
			writeFileSync(join(root, "docs/plans/slice-a.intent.json"), JSON.stringify(intent, null, 2) + "\n");
			git("add", "."); git("commit", "-qm", "fixture");
			seedKernelRunForTest(root, {
				task_id: "slice-a",
				run_id: "run-a",
				record: {
					contract: "assurance_kernel/task_record/v4",
					task_id: "slice-a",
					intent_snapshot: intent,
					intent_ref: { path: "docs/plans/slice-a.intent.json", content_hash: canonicalIntentHash(intent) },
					lifecycle: "active",
					artifact_state: "active",
					baseline: `sha256:${"a".repeat(64)}`,
					git_base_head: git("rev-parse", "HEAD"),
					attestations: [],
					findings: [],
					history: [],
				},
			});
			let step = 0;
			let execNum = 0;
			const conversationId = "conv-agy-cont";
			const prompt = (text = "/drive slice-a") => {
				return antigravityPreInvocationHook(
					{ conversationId, lastUserInput: text, workspacePaths: [root] },
					{ root: store, home: store },
				);
			};
			const preTool = (
				name = "call_mcp_tool",
				args: Record<string, unknown> = { ServerName: "immune-brain", ToolName: "status", Arguments: { task_id: "slice-a" } },
				stepIdx = ++step,
			) => {
				return antigravityPreToolUseHookAsync(
					{ conversationId, stepIdx, toolCall: { name, args }, workspacePaths: [root] },
					{ root: store, home: store },
				);
			};
			const postTool = (
				name = "call_mcp_tool",
				args: Record<string, unknown> = { ServerName: "immune-brain", ToolName: "status", Arguments: { task_id: "slice-a" } },
				resultOrError: { result?: string; error?: string } = { result: "{}" },
				stepIdx = step,
			) => {
				return antigravityPostToolUseHook(
					{ conversationId, stepIdx, toolCall: { name, args }, workspacePaths: [root], ...resultOrError },
					{ root: store, home: store },
				);
			};
			const enter = async () => {
				prompt("/drive slice-a");
				await preTool();
				await postTool();
			};
			const stop = (overrides: Partial<AntigravityStopPayload> = {}) => {
				execNum++;
				return antigravityRunContinuationHook(
					{ conversationId, executionNum: execNum, workspacePaths: [root], ...overrides },
					store,
				);
			};
			return {
				root,
				store,
				conversationId,
				prompt,
				preTool,
				postTool,
				enter,
				stop,
				dispose: () => {
					rmSync(root, { recursive: true, force: true });
					if (!storeDir) rmSync(store, { recursive: true, force: true });
				},
			};
		}

		it("allows stop when workspace has no active task", async () => {
			const emptyDir = mkdtempSync(join(tmpdir(), "imm-empty-ws-"));
			try {
				const result = await antigravityRunContinuationHook({
					conversationId: "conv-stop-1",
					workspacePaths: [emptyDir],
				});
				expect(result.decision).toBeUndefined();
				expect(result).toEqual({});
			} finally {
				rmSync(emptyDir, { recursive: true, force: true });
			}
		});

		it("negative: missing usable boundary identity does not auto-continue", async () => {
			const h = antigravityContinuationFixture();
			try {
				await h.enter();
				const result = await antigravityRunContinuationHook(
					{ conversationId: h.conversationId, workspacePaths: [h.root] },
					h.store,
				);
				expect(result.decision).toBeUndefined();
				expect(result).toEqual({});
			} finally {
				h.dispose();
			}
		});

		it("AC1 (D7; BR-REQ-3): real PreToolUse/PostToolUse/Stop payload mapping binds active tasks and renders shared continue/pause outcomes", async () => {
			const h = antigravityContinuationFixture();
			try {
				await h.enter();
				const result = await h.stop();
				expect(result.decision).toBe("continue");
				expect(result.reason).toContain("Explicit drive is bound to slice-a");
			} finally {
				h.dispose();
			}
		});

		it("positive (BR-SCN-2): pauses on the seventh consecutive Stop and tells user to resume explicitly in the same Host", async () => {
			const h = antigravityContinuationFixture();
			try {
				await h.enter();
				for (let attempt = 1; attempt <= 6; attempt++) {
					writeFileSync(join(h.root, "value.txt"), `progress ${attempt}\n`);
					const res = await h.stop();
					expect(res.decision).toBe("continue");
				}
				writeFileSync(join(h.root, "value.txt"), "progress 7\n");
				const seventh = await h.stop();
				expect(seventh.decision).toBeUndefined();
				expect(seventh.reason).toBe("Antigravity consecutive Stop boundary reached; resume explicitly in the same Host");
				expect(seventh.systemMessage).toContain("Antigravity consecutive Stop boundary reached; resume explicitly in the same Host");
				expect(readPhaseEntryState(h.conversationId, h.store)?.run_live).toBe(false);
			} finally {
				h.dispose();
			}
		});

		it("AC1 (D7; BR-REQ-3): seventh Stop preserves Kernel pause reason over 7-stop boundary reason", async () => {
			const h = antigravityContinuationFixture();
			const projection = spyOn(coordinator, "projectTaskStatus");
			try {
				await h.enter();
				for (let attempt = 1; attempt <= 6; attempt++) {
					writeFileSync(join(h.root, "value.txt"), `progress ${attempt}\n`);
					const res = await h.stop();
					expect(res.decision).toBe("continue");
				}
				// On 7th stop, mock a Kernel pause decision (e.g. resolve_user_decision)
				const live = await coordinator.projectTaskStatus(h.root, "slice-a");
				projection.mockResolvedValue({
					...live,
					projection: { ...live.projection, next_obligation: "resolve_user_decision" },
				});
				writeFileSync(join(h.root, "value.txt"), "progress 7\n");
				const seventh = await h.stop();
				expect(seventh.decision).toBeUndefined();
				expect(seventh.reason).toContain("Kernel requires a concrete user decision or authorization");
				expect(seventh.reason).not.toContain("consecutive Stop boundary reached");
				expect(seventh.systemMessage).toContain("Kernel requires a concrete user decision or authorization");
				expect(readPhaseEntryState(h.conversationId, h.store)?.run_live).toBe(false);
			} finally {
				projection.mockRestore();
				h.dispose();
			}
		});

		it("negative: user waits and terminal state do not auto-continue", async () => {
			const projection = spyOn(coordinator, "projectTaskStatus");
			const h = antigravityContinuationFixture();
			try {
				await h.enter();
				const live = await coordinator.projectTaskStatus(h.root, "slice-a");

				// User wait obligation stops auto-continuation
				projection.mockResolvedValue({
					...live,
					projection: { ...live.projection, next_obligation: "resolve_user_decision" },
				});
				const userWait = await h.stop();
				expect(userWait.decision).toBeUndefined();
				expect(userWait.reason).toContain("Kernel requires a concrete user decision or authorization");

				// Open user decision stops auto-continuation
				const h2 = antigravityContinuationFixture();
				try {
					await h2.enter();
					projection.mockResolvedValue({
						...live,
						projection: { ...live.projection, open_user_decision_count: 1 },
					});
					const openDecision = await h2.stop();
					expect(openDecision.decision).toBeUndefined();
				} finally {
					h2.dispose();
				}

				// Terminal state settles and stops auto-continuation
				const h3 = antigravityContinuationFixture();
				try {
					await h3.enter();
					projection.mockResolvedValue({
						...live,
						claim: null,
						projection: { ...live.projection, lifecycle: "done", completion_ready: true },
					});
					const terminal = await h3.stop();
					expect(terminal.decision).toBeUndefined();
					expect(terminal).toEqual({});
				} finally {
					h3.dispose();
				}
			} finally {
				projection.mockRestore();
				h.dispose();
			}
		});

		it("AC2 (D7; BR-REQ-3): shares native-failure pause and paused native gate refusal with Claude", async () => {
			const h = antigravityContinuationFixture();
			try {
				await h.enter();
				const fail = async () => {
					await h.preTool("call_mcp_tool", { ServerName: "immune-brain", ToolName: "request_authorization", Arguments: { task_id: "slice-a" } });
					await h.postTool("call_mcp_tool", { ServerName: "immune-brain", ToolName: "request_authorization", Arguments: { task_id: "slice-a" } }, { error: "rejected" });
				};

				// Two failures leave run live for retry
				for (let attempt = 1; attempt <= 2; attempt++) {
					await fail();
					const res = await h.stop();
					expect(res.decision).toBe("continue");
					writeFileSync(join(h.root, "value.txt"), `retry ${attempt}\n`);
				}

				// Third failure pauses
				await fail();
				const pausedRes = await h.stop();
				expect(pausedRes.decision).toBeUndefined();
				expect(pausedRes.reason).toContain("request_authorization failed 3 times under this entry");
				expect(pausedRes.systemMessage).toContain("failed 3 times under this entry");

				// Paused native gate refuses outright
				const denial = await h.preTool("call_mcp_tool", { ServerName: "immune-brain", ToolName: "request_authorization", Arguments: { task_id: "slice-a" } });
				expect(denial.decision).toBe("deny");
				expect(denial.reason).toContain("Run paused");

				// Entry token is revoked
				expect(readPhaseEntryState(h.conversationId, h.store)?.run_live).toBe(false);
			} finally {
				h.dispose();
			}
		});

		it("AC2 (D7; BR-REQ-3): keeps conversationId and conversationId:stepIdx correlation; replayed and foreign correlation refuse", async () => {
			const h = antigravityContinuationFixture();
			try {
				h.prompt("/drive slice-a");
				await h.preTool("call_mcp_tool", { ServerName: "immune-brain", ToolName: "status", Arguments: { task_id: "slice-a" } }, 10);

				// Positive correlation lookup
				expect(readRunToolSession(`${h.conversationId}:10`, "status", h.root, h.store)).toBe(h.conversationId);

				// Foreign workspace refuses
				const foreignDir = realpathSync(mkdtempSync(join(tmpdir(), "imm-foreign-")));
				try {
					expect(readRunToolSession(`${h.conversationId}:10`, "status", foreignDir, h.store)).toBeNull();
				} finally {
					rmSync(foreignDir, { recursive: true, force: true });
				}

				// Wrong operation refuses
				expect(readRunToolSession(`${h.conversationId}:10`, "other_op", h.root, h.store)).toBeNull();

				// Consumed correlation refuses replay
				await h.postTool("call_mcp_tool", { ServerName: "immune-brain", ToolName: "status", Arguments: { task_id: "slice-a" } }, { result: "{}" }, 10);
				expect(readRunToolSession(`${h.conversationId}:10`, "status", h.root, h.store)).toBeNull();
			} finally {
				h.dispose();
			}
		});

		it("AC2 (D7; BR-REQ-3): binds parent from start_unattended_batch and automated continuation matches shared machine", async () => {
			const h = antigravityContinuationFixture();
			const parentSpy = spyOn(runContinuationModule, "observeParentRun");
			try {
				h.prompt("/drive batch-init");
				const batchId = "batch-test-parent";
				const planDigest = `sha256:${"b".repeat(64)}`;
				mkdirSync(join(h.root, ".imm/state/batches"), { recursive: true });
				writeFileSync(
					join(h.root, ".imm/state/batches", `${batchId}.json`),
					JSON.stringify({
						contract: "assurance_kernel/batch_run_state/v1",
						batch_id: batchId,
						initiative_slug: "batch-init",
						base_head: "0123456789abcdef",
						branch: "imm/batch-init",
						plan_digest: planDigest,
						confirmation_time: "2026-01-01T00:00:00.000Z",
						batch_state: "running",
						children: [
							{
								task_id: "child-1",
								slice_id: "S1",
								state: "enrolled",
								risk: "low",
								intent_path: "docs/plans/child-1.intent.json",
								intent_revision: 1,
								intent_content_hash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
								scope_hint: ["child-1.txt"],
								blocked_by: [],
								reason: null,
								commit: null,
							},
						],
						commits: [],
						consecutive_qa_failures: 0,
						budget: { max_children: 1, qa_failure_limit: 2 },
						created_at: "2026-01-01T00:00:00.000Z",
						updated_at: "2026-01-01T00:00:00.000Z",
					}),
				);

				await h.preTool("call_mcp_tool", {
					ServerName: "immune-brain",
					ToolName: "start_unattended_batch",
					Arguments: { initiative_slug: "batch-init" },
				}, 1);
				await h.postTool(
					"call_mcp_tool",
					{ ServerName: "immune-brain", ToolName: "start_unattended_batch", Arguments: { initiative_slug: "batch-init" } },
					{ result: JSON.stringify({ state: "started", batch_id: batchId, plan_digest: planDigest, initiative_slug: "batch-init" }) },
					1,
				);

				parentSpy.mockResolvedValue({
					kind: "parent",
					workspace: h.root,
					session_id: h.conversationId,
					boundary_id: "boundary-1",
					initiative_slug: "batch-init",
					batch_id: batchId,
					plan_digest: planDigest,
					progress_digest: "progress-1",
					all_required_integrated: false,
					final_passed: false,
					pending_repair: false,
					runnable: true,
					executors_running: false,
					next_action: "Call start_unattended_batch for batch-init",
				});

				// Bound parent continues
				const res = await h.stop();
				expect(res.decision).toBe("continue");
				expect(res.reason).toContain("Explicit drive is bound to batch-init");

				// selectedAntigravityParent verifies correlation on child assurance call
				await h.preTool(
					"call_mcp_tool",
					{ ServerName: "immune-brain", ToolName: "advance_assurance", Arguments: { task_id: "child-1" } },
					2,
				);
				expect(selectedAntigravityParent(`${h.conversationId}:2`, h.root, "batch-init", h.store)).toBe(true);
				expect(selectedAntigravityParent(`${h.conversationId}:2`, h.root, "other-init", h.store)).toBe(false);
			} finally {
				parentSpy.mockRestore();
				h.dispose();
			}
		});

		it("AC2 (D7; BR-REQ-3): stall yields the turn without pausing or spending stall budget", async () => {
			const h = antigravityContinuationFixture();
			try {
				await h.enter();
				// First stop continues (first boundary, initial progress)
				const first = await h.stop();
				expect(first.decision).toBe("continue");

				// Second stop with distinct boundary but unchanged workspace yields without revoking run_live
				const stalled = await h.stop();
				expect(stalled.decision).toBeUndefined();
				expect(stalled).toEqual({});
				expect(readPhaseEntryState(h.conversationId, h.store)?.run_live).toBe(true);

				// Subsequent unchanged stops continue to yield without spending the entry token
				const stalledAgain = await h.stop();
				expect(stalledAgain.decision).toBeUndefined();
				expect(stalledAgain).toEqual({});
				expect(readPhaseEntryState(h.conversationId, h.store)?.run_live).toBe(true);

				// Workspace progress resumes continuation
				writeFileSync(join(h.root, "value.txt"), "progress\n");
				const resumed = await h.stop();
				expect(resumed.decision).toBe("continue");
			} finally {
				h.dispose();
			}
		});

		it("AC2 (D7; BR-REQ-3): review flow binds reviewer and directs submit_review", async () => {
			const h = antigravityContinuationFixture();
			const projection = spyOn(coordinator, "projectTaskStatus");
			try {
				await h.enter();
				const live = await coordinator.projectTaskStatus(h.root, "slice-a");
				projection.mockResolvedValue({
					...live,
					projection: { ...live.projection, next_obligation: "run_review" },
				});

				// Advance assurance reports review_ready with reviewer prompt
				await h.preTool(
					"call_mcp_tool",
					{ ServerName: "immune-brain", ToolName: "advance_assurance", Arguments: { task_id: "slice-a" } },
					2,
				);
				await h.postTool(
					"call_mcp_tool",
					{ ServerName: "immune-brain", ToolName: "advance_assurance", Arguments: { task_id: "slice-a" } },
					{ result: JSON.stringify({ state: "review_ready", agent_params: { prompt: "Please perform review" } }) },
					2,
				);

				// Subagent dispatch sets review running
				await h.preTool("invoke_subagent", { Model: "pro", Prompt: "Please perform review" }, 3);
				// Subagent return sets review returned
				await h.postTool("invoke_subagent", { Model: "pro", Prompt: "Please perform review" }, { result: "verdict passed" }, 3);

				// Next stop directs submit_review
				const res = await h.stop();
				expect(res.decision).toBe("continue");
				expect(res.reason).toContain("Call submit_review immediately with the observed verdict before editing");
			} finally {
				projection.mockRestore();
				h.dispose();
			}
		});

		it("releases binding on prompt cancellation or new run entry", async () => {
			const h = antigravityContinuationFixture();
			try {
				await h.enter();
				const contFile = join(cacheDir(h.store, ANTIGRAVITY_CACHE_DIR), `${sessionHash(h.conversationId)}.continuation`);
				expect(existsSync(contFile)).toBe(true);

				// Cancelling releases continuation
				h.prompt("取消任务");
				expect(existsSync(contFile)).toBe(false);
			} finally {
				h.dispose();
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
			const source = readFileSync(join(import.meta.dir, "../plugins/immune-brain/runtime/host-core/mcp_runtime.ts"), "utf8");
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
				confirmation_ref: hostConfirmationRef("antigravity", {
					connectionId: retireConversation,
					toolCallId: `${retireConversation}:2`,
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

		// The production server injects no admission port: the Hook and the server
		// meet only in the default private store under the OS temp directory, and
		// Antigravity records no `.continuation-call` correlation.
		it("admits a Hook-recorded batch call through the default admission store", async () => {
			const root = workspace(false);
			const tmp = temp("tmpdir");
			const home = temp("home");
			const conversationId = "conv-default-store";
			const previous = process.env.TMPDIR;
			process.env.TMPDIR = tmp;
			try {
				const gates: string[] = [];
				const mcp = createAntigravityMcpRuntime({
					cwd: root,
					env: {},
					interactive: true,
					requestConfirmation: async (input) => {
						gates.push(input.operation);
						return { decision: "decline", requestId: `gate-${gates.length}` };
					},
				});
				mcp.bindClientHandshake({ version: "1.0.0", interactive: true, protocolVersion: "2025-06-18" });
				const meta = (step: number) => ({
					"antigravity.google/conversation_id": conversationId,
					"antigravity.google/workspace_paths": [root],
					progressToken: `antigravity-hook:${step}`,
				});
				const call = (id: string, step: number) =>
					handleJsonRpc({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "start_unattended_batch", arguments: { task_id: TASK }, _meta: meta(step) } }, mcp);

				antigravityPreInvocationHook({ conversationId, lastUserInput: `/drive ${TASK}`, workspacePaths: [root] }, { home });
				expect(antigravityPreToolUseHook({ conversationId, stepIdx: 3, workspacePaths: [root],
					toolCall: { name: "call_mcp_tool", args: { ServerName: "immune-brain", ToolName: "start_unattended_batch", Arguments: {} } } }))
					.toEqual({ decision: "allow" });
				expect(existsSync(join(tmp, "immune-brain-antigravity"))).toBe(true);

				expect(resultOf(await call("rpc-default-1", 3))).toMatchObject({ state: "rejected", reason: "native interaction declined" });
				expect(gates).toEqual(["start_unattended_batch"]);
				expect(reasonCode(await call("rpc-default-2", 3))).toBe("run_entry_required");
			} finally {
				if (previous === undefined) delete process.env.TMPDIR;
				else process.env.TMPDIR = previous;
			}
		}, 60_000);
	});

	// Spec antigravity-tool-hook-and-mcp-correlation AC3 (D6) + ADR 0004: privileged
	// operations open Antigravity's native `PreToolUse` `force_ask` confirmation gate
	// rather than MCP `elicitation/create`, consume a step-correlated single-use grant,
	// fail closed on replay or post-confirmation drift, and never manufacture batch admission.
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
		const intentPath = (root: string, taskId = TASK) => join(root, "docs/plans", `${taskId}.intent.json`);
		function writeIntent(root: string, goal: string, revision: number, taskId = TASK): void {
			mkdirSync(join(root, "docs/plans"), { recursive: true });
			writeFileSync(intentPath(root, taskId), `${JSON.stringify({
				contract: "assurance_kernel/task_intent/v1",
				task_id: taskId,
				owner: "user",
				goal,
				acceptance: [{ id: "AC1", assertion: "the native gate is reached", verification: verification() }],
				scope_hint: ["docs/plans", "base.txt"],
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
		function recordUserDecision(root: string, id = "user-decision-1"): void {
			const record = readTaskRecordRaw(root, TASK).record;
			if (!record) throw new Error("the fixture task is not enrolled");
			createCanaryApplication(createTestMutationRegistry()).execute({
				root,
				task_id: TASK,
				prior_intent_token: readTaskIntent(root, TASK, record.intent_ref.path, record.intent_snapshot).token,
				operation: { op: "record_finding", actor_id: "literal-user",
					finding: { id, kind: "unresolved_user_decision", acceptance_id: null, summary: "the user must choose" } },
			});
		}

		/** One Antigravity stdio connection backed by an isolated confirmation store. */
		function wire(root: string, store: string, extraOptions: Parameters<typeof serveAntigravityStdio>[0] = {}) {
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
			void serveAntigravityStdio({
				input,
				output,
				cwd: root,
				env: {},
				interactive: true,
				confirmationStoreRoot: store,
				exit: () => undefined,
				...extraOptions,
			});
			return { input, send, next };
		}

		const conversationId = "conv-gate-1";
		const meta = (root: string, step?: number) => ({
			"antigravity.google/conversation_id": conversationId,
			"antigravity.google/workspace_paths": [root],
			...(step === undefined ? {} : { progressToken: `antigravity-hook:${step}` }),
		});
		async function initialize(server: ReturnType<typeof wire>, capabilities: Record<string, unknown> = { elicitation: {} }): Promise<void> {
			server.send({ jsonrpc: "2.0", id: "init", method: "initialize",
				params: { protocolVersion: "2025-06-18", clientInfo: { name: "antigravity-client", version: "v1.5.5" }, capabilities } });
			expect((await server.next()).result.serverInfo).toMatchObject({ name: "antigravity" });
		}

		it("request_authorization opens PreToolUse force_ask without MCP elicitation, refuses unconfirmed/replayed calls, and resolves once", async () => {
			const root = await enrolledRoot();
			const store = temp("store");
			const server = wire(root, store);
			await initialize(server);
			recordUserDecision(root);
			const before = readTaskRecordRaw(root, TASK).revision;

			// Without PreToolUse confirmation, tools/call never sends elicitation/create and fails closed.
			server.send({ jsonrpc: "2.0", id: "auth-unconfirmed", method: "tools/call",
				params: { name: "request_authorization", arguments: { task_id: TASK }, _meta: meta(root, 4) } });
			const unconfirmed = await server.next();
			expect(unconfirmed.method).toBeUndefined();
			expect(unconfirmed).toMatchObject({ id: "auth-unconfirmed", error: { data: { reason_code: "interaction_not_opened" } } });
			expect(readTaskRecordRaw(root, TASK).revision).toBe(before);

			// PreToolUse returns force_ask with prepared task and digest details.
			const hookRes = await antigravityPreToolUseHookAsync({
				conversationId,
				stepIdx: 5,
				workspacePaths: [root],
				toolCall: {
					name: "call_mcp_tool",
					args: { ServerName: "immune-brain", ToolName: "request_authorization", Arguments: { task_id: TASK } },
				},
			}, { root: store });
			expect(hookRes.decision).toBe("force_ask");
			expect(hookRes.reason).toContain(`Task: ${TASK}`);
			expect(hookRes.reason).toContain("Binding digest:");

			// Approving force_ask executes that exact step once and resolves the finding.
			server.send({ jsonrpc: "2.0", id: "auth-1", method: "tools/call",
				params: { name: "request_authorization", arguments: { task_id: TASK }, _meta: meta(root, 5) } });
			const accepted = await server.next();
			expect(accepted.error).toBeUndefined();
			const finding = readTaskRecordRaw(root, TASK).record?.findings.find((item) => item.id === "user-decision-1");
			expect(finding?.status).toBe("resolved");

			// Replaying the same step fails closed because the confirmation grant is single-use.
			recordUserDecision(root, "user-decision-2");
			const afterFirst = readTaskRecordRaw(root, TASK).revision;
			server.send({ jsonrpc: "2.0", id: "auth-replay", method: "tools/call",
				params: { name: "request_authorization", arguments: { task_id: TASK }, _meta: meta(root, 5) } });
			expect(await server.next()).toMatchObject({ id: "auth-replay", error: { data: { reason_code: "interaction_not_opened" } } });
			expect(readTaskRecordRaw(root, TASK).revision).toBe(afterFirst);
			server.input.end();
		}, 30_000);

		it("approve_breaking_intent_revision keeps staged sidecar intact during PreToolUse, refuses post-confirmation drift, and commits once confirmed", async () => {
			const root = await enrolledRoot();
			const store = temp("store");
			const server = wire(root, store);
			await initialize(server);
			const before = readTaskRecordRaw(root, TASK).revision;
			const originalBytes = readFileSync(intentPath(root), "utf8");
			const originalStage = git(root, "ls-files", "--stage", "--", `docs/plans/${TASK}.intent.json`);
			const next = { contract: "assurance_kernel/task_intent/v1", task_id: TASK, owner: "user", goal: "reach the native gate",
				acceptance: [{ id: "AC1", assertion: "a revised breaking acceptance assertion", verification: verification() }],
				scope_hint: ["docs/plans", "base.txt"], risk: "routine", revision: 2 };

			// PreToolUse prepares the breaking revision digest and restores both file bytes and index entry.
			const hookRes = await antigravityPreToolUseHookAsync({
				conversationId,
				stepIdx: 7,
				workspacePaths: [root],
				toolCall: {
					name: "call_mcp_tool",
					args: { ServerName: "immune-brain_immune-brain", ToolName: "approve_breaking_intent_revision", Arguments: { task_id: TASK, next_intent: next } },
				},
			}, { root: store });
			expect(hookRes.decision).toBe("force_ask");
			expect(hookRes.reason).toContain("Operation: approve_breaking_intent_revision");
			expect(hookRes.reason).toContain("Intent revision: 2");
			expect(readFileSync(intentPath(root), "utf8")).toBe(originalBytes);
			expect(git(root, "ls-files", "--stage", "--", `docs/plans/${TASK}.intent.json`)).toBe(originalStage);
			expect(readTaskRecordRaw(root, TASK).revision).toBe(before);

			// Modifying an in-scope file after PreToolUse invalidates the confirmed binding digest.
			writeFileSync(join(root, "base.txt"), "drifted after force_ask\n");
			git(root, "add", "--", "base.txt");
			server.send({ jsonrpc: "2.0", id: "breaking-drift", method: "tools/call",
				params: { name: "approve_breaking_intent_revision", arguments: { task_id: TASK, next_intent: next }, _meta: meta(root, 7) } });
			expect(await server.next()).toMatchObject({ id: "breaking-drift", error: { data: { reason_code: "workspace_changed" } } });
			expect(readTaskRecordRaw(root, TASK).revision).toBe(before);
			expect(readFileSync(intentPath(root), "utf8")).toBe(originalBytes);

			// Restore clean state, confirm a fresh step, and commit the breaking revision.
			writeFileSync(join(root, "base.txt"), "base\n");
			git(root, "add", "--", "base.txt");
			const freshHook = await antigravityPreToolUseHookAsync({
				conversationId,
				stepIdx: 8,
				workspacePaths: [root],
				toolCall: {
					name: "call_mcp_tool",
					args: { ServerName: "immune-brain", ToolName: "approve_breaking_intent_revision", Arguments: { task_id: TASK, next_intent: next } },
				},
			}, { root: store });
			expect(freshHook.decision).toBe("force_ask");
			server.send({ jsonrpc: "2.0", id: "breaking-ok", method: "tools/call",
				params: { name: "approve_breaking_intent_revision", arguments: { task_id: TASK, next_intent: next }, _meta: meta(root, 8) } });
			expect((await server.next()).error).toBeUndefined();
			expect(readTaskRecordRaw(root, TASK).record?.intent_snapshot.acceptance[0]?.assertion).toBe("a revised breaking acceptance assertion");
			server.input.end();
		}, 30_000);

		it("stop opens force_ask without elicitation capability, refuses uncorrelated calls, and never manufactures batch admission", async () => {
			const root = await enrolledRoot();
			const store = temp("store");
			const server = wire(root, store);
			// Even when a client omits capabilities.elicitation, Antigravity's Hook gate remains authoritative.
			await initialize(server, {});
			// No Host conversation: refused before any gate opens.
			server.send({ jsonrpc: "2.0", id: "uncorrelated", method: "tools/call",
				params: { name: "stop", arguments: { task_id: TASK }, _meta: { "antigravity.google/workspace_paths": [root] } } });
			expect(await server.next()).toMatchObject({ error: { data: { reason_code: "correlation_missing" } } });

			// Neither empty nor confirmed non-batch privileged hooks manufacture a batch admission.
			expect(antigravityPreToolUseHook({ conversationId, stepIdx: 3, workspacePaths: [root],
				toolCall: { name: "call_mcp_tool", args: { ServerName: "immune-brain", ToolName: "request_authorization", Arguments: {} } } }, { root: store }))
				.toEqual({ decision: "allow" });
			const stopHook = await antigravityPreToolUseHookAsync({
				conversationId,
				stepIdx: 4,
				workspacePaths: [root],
				toolCall: { name: "call_mcp_tool", args: { ServerName: "immune-brain", ToolName: "stop", Arguments: { task_id: TASK } } },
			}, { root: store });
			expect(stopHook.decision).toBe("force_ask");
			expect(stopHook.reason).toContain("Operation: stop");

			server.send({ jsonrpc: "2.0", id: "batch-1", method: "tools/call",
				params: { name: "start_unattended_batch", arguments: { task_id: TASK }, _meta: meta(root, 4) } });
			expect(await server.next()).toMatchObject({ error: { data: { reason_code: "run_entry_required" } } });

			// Step 4's stop grant was untouched by the rejected batch call and stops the task once.
			server.send({ jsonrpc: "2.0", id: "stop-1", method: "tools/call",
				params: { name: "stop", arguments: { task_id: TASK }, _meta: meta(root, 4) } });
			expect(JSON.stringify(await server.next())).not.toContain("error");
			expect(readTaskRecordRaw(root, TASK).record).toBeNull();
			server.input.end();
		}, 30_000);

		it("start_unattended_batch opens PreToolUse force_ask for a new batch and skips re-prompting when resuming an intact batch", async () => {
			const root = temp("batch-gate");
			const store = temp("batch-store");
			const SLUG = "loop-initiative";
			const CHILD = "loop-s0";
			writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
			writeIntent(root, "deliver child slice", 1, CHILD);
			git(root, "init", "-q", "-b", "main");
			git(root, "add", "-A");
			git(root, "commit", "-qm", "fixture");

			const readInitiative = async () => ({
				contract: "immune_brain/github_initiative_observation/v1" as const,
				initiative_id: SLUG,
				issue_number: 100,
				tasks: [{ task_id: CHILD, slice_id: "S0", issue_number: 101, blocked_by: [] }],
			});

			antigravityPreInvocationHook({ conversationId, lastUserInput: `/drive ${SLUG}`, workspacePaths: [root] }, { root: store, home: store });
			const batchArgs = { initiative_slug: SLUG, max_parallel: 1, final_verification: ["true"] };
			const hookRes = await antigravityPreToolUseHookAsync({
				conversationId,
				stepIdx: 10,
				workspacePaths: [root],
				toolCall: {
					name: "call_mcp_tool",
					args: { ServerName: "immune-brain", ToolName: "start_unattended_batch", Arguments: batchArgs },
				},
			}, { root: store, readInitiative });
			expect(hookRes.decision).toBe("force_ask");
			expect(hookRes.reason).toContain(`Authorize this unattended batch run for ${SLUG}?`);
			expect(hookRes.reason).toContain(`${CHILD} (S0)`);
			expect(hookRes.reason).toContain("Plan digest: sha256:");

			const server = wire(root, store, {
				readInitiative,
				batchKernel: {
					advanceTask: async () => ({ state: "blocked", reason: "parked for inspection" }),
				},
			});
			await initialize(server);
			server.send({ jsonrpc: "2.0", id: "batch-start-1", method: "tools/call",
				params: { name: "start_unattended_batch", arguments: batchArgs, _meta: meta(root, 10) } });
			const startedReply = await server.next();
			expect(startedReply.method).toBeUndefined();
			expect(startedReply.error).toBeUndefined();
			const started = JSON.parse(startedReply.result.content[0].text);
			expect(started.state).toBe("started");

			// While the batch remains running with unchanged plan/branch/HEAD, PreToolUse allows resumption without re-prompting.
			const batchRecordPath = join(root, ".imm/state/batches", `${started.batch_id}.json`);
			const persisted = JSON.parse(readFileSync(batchRecordPath, "utf8"));
			writeFileSync(batchRecordPath, `${JSON.stringify({ ...persisted, batch_state: "running" }, null, 2)}\n`);
			const beforeResumePreview = readFileSync(batchRecordPath, "utf8");
			const resumeHook = await antigravityPreToolUseHookAsync({
				conversationId,
				stepIdx: 11,
				workspacePaths: [root],
				toolCall: {
					name: "call_mcp_tool",
					args: { ServerName: "immune-brain", ToolName: "start_unattended_batch", Arguments: { initiative_slug: SLUG } },
				},
			}, { root: store, readInitiative });
			expect(resumeHook).toEqual({ decision: "allow" });
			expect(readFileSync(batchRecordPath, "utf8")).toBe(beforeResumePreview);
			server.input.end();
		}, 60_000);

		// The single-task preparation digest is bound by the PreToolUse hook process
		// and recomputed later by the MCP call process; the grant must still match.
		it("start_unattended_batch single-task grant from PreToolUse is consumed by a later MCP call", async () => {
			const root = temp("single-gate");
			const store = temp("single-store");
			const SINGLE = "single-task-gate";
			writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
			writeFileSync(join(root, "base.txt"), "base\n");
			writeIntent(root, "deliver one task", 1, SINGLE);
			git(root, "init", "-q", "-b", "main");
			git(root, "add", "-A");
			git(root, "commit", "-qm", "fixture");

			antigravityPreInvocationHook({ conversationId, lastUserInput: `/drive ${SINGLE}`, workspacePaths: [root] }, { root: store, home: store });
			const args = { task_id: SINGLE };
			const hookRes = await antigravityPreToolUseHookAsync({
				conversationId,
				stepIdx: 20,
				workspacePaths: [root],
				toolCall: {
					name: "call_mcp_tool",
					args: { ServerName: "immune-brain", ToolName: "start_unattended_batch", Arguments: args },
				},
			}, { root: store });
			expect(hookRes.decision).toBe("force_ask");
			expect(hookRes.reason).toContain("Preparation digest: sha256:");

			// The MCP call observes the workspace at a strictly later instant.
			await new Promise((resolve) => setTimeout(resolve, 5));
			const server = wire(root, store, {
				batchKernel: { advanceTask: async () => ({ state: "blocked", reason: "parked for inspection" }) },
			});
			await initialize(server);
			server.send({ jsonrpc: "2.0", id: "single-start-1", method: "tools/call",
				params: { name: "start_unattended_batch", arguments: args, _meta: meta(root, 20) } });
			const reply = await server.next();
			expect(reply.error).toBeUndefined();
			const text = reply.result.content[0].text as string;
			expect(text).not.toContain("workspace_changed");
			expect(JSON.parse(text).state).toBe("started");
			server.input.end();
		}, 60_000);

		it("AC2 (D3; BR-REQ-2): real seams preserve live drive entry, one admitted call and one consumed native grant; replay, truncated grant and tampered files refuse", async () => {
			const root = temp("ac2-gate");
			const store = temp("store-ac2");
			const TASK_AC2 = "ac2-single-task";
			writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
			writeFileSync(join(root, "base.txt"), "base\n");
			writeIntent(root, "deliver one task", 1, TASK_AC2);
			git(root, "init", "-q", "-b", "main");
			git(root, "add", "-A");
			git(root, "commit", "-qm", "fixture");

			const conversationId = "conv-ac2-1";
			const stepIdx = 50;
			const admissionId = `${conversationId}:${stepIdx}:start_unattended_batch`;
			const cache = join(store, "immune-brain-antigravity");
			const entryFile = join(cache, `${sessionHash(conversationId)}.entry`);
			const admitFile = join(cache, `${sessionHash(admissionId)}.admit`);
			const confirmFile = join(cache, `${sessionHash(conversationId)}.${sessionHash(admissionId)}.confirm`);

			// 1. Bound: missing step identity denies PreToolUse
			antigravityPreInvocationHook({ conversationId, lastUserInput: `/drive ${TASK_AC2}`, workspacePaths: [root] }, { root: store, home: store });
			const missingStep = antigravityPreToolUseHook({
				conversationId,
				workspacePaths: [root],
				toolCall: {
					name: "call_mcp_tool",
					args: { ServerName: "immune-brain", ToolName: "start_unattended_batch", Arguments: { task_id: TASK_AC2 } },
				},
			}, { root: store });
			expect(missingStep.decision).toBe("deny");
			expect(missingStep.reason).toContain("stepIdx");

			// 2. Tampered entry log (wrong mode) refuses PreToolUse
			expect(existsSync(entryFile)).toBe(true);
			chmodSync(entryFile, 0o644);
			const deniedWrongModeEntry = antigravityPreToolUseHook({
				conversationId,
				stepIdx,
				workspacePaths: [root],
				toolCall: {
					name: "call_mcp_tool",
					args: { ServerName: "immune-brain", ToolName: "start_unattended_batch", Arguments: { task_id: TASK_AC2 } },
				},
			}, { root: store });
			expect(deniedWrongModeEntry.decision).toBe("deny");
			expect(deniedWrongModeEntry.reason).toContain("run_entry_required");

			// 3. Planted symlink entry log refuses PreToolUse
			const outsideEntry = join(store, "outside-entry.txt");
			writeFileSync(outsideEntry, readFileSync(entryFile, "utf8"), { mode: 0o600 });
			rmSync(entryFile, { force: true });
			symlinkSync(outsideEntry, entryFile);
			const deniedSymlinkEntry = antigravityPreToolUseHook({
				conversationId,
				stepIdx,
				workspacePaths: [root],
				toolCall: {
					name: "call_mcp_tool",
					args: { ServerName: "immune-brain", ToolName: "start_unattended_batch", Arguments: { task_id: TASK_AC2 } },
				},
			}, { root: store });
			expect(deniedSymlinkEntry.decision).toBe("deny");
			expect(deniedSymlinkEntry.reason).toContain("run_entry_required");

			// 4. Restore valid drive entry; PreToolUse Hook records admission with 0600 mode
			rmSync(entryFile, { force: true });
			antigravityPreInvocationHook({ conversationId, lastUserInput: `/drive ${TASK_AC2}`, workspacePaths: [root] }, { root: store, home: store });
			expect(readPhaseEntryState(conversationId, store)?.run_live).toBe(true);

			const admitted = antigravityPreToolUseHook({
				conversationId,
				stepIdx,
				workspacePaths: [root],
				toolCall: {
					name: "call_mcp_tool",
					args: { ServerName: "immune-brain", ToolName: "start_unattended_batch", Arguments: { task_id: TASK_AC2 } },
				},
			}, { root: store });
			expect(admitted.decision).toBe("allow");
			expect(existsSync(admitFile)).toBe(true);
			expect((lstatSync(admitFile).mode & 0o777)).toBe(0o600);

			// 5. Tampered admission file (wrong mode 0644) refuses MCP consumption
			chmodSync(admitFile, 0o644);
			expect(consumePhaseAdmission(admissionId, "start_unattended_batch", store)).toBeNull();

			// 6. Truncated admission file refuses MCP consumption
			chmodSync(admitFile, 0o600);
			writeFileSync(admitFile, "{ \"broken_json\": ", { mode: 0o600 });
			expect(consumePhaseAdmission(admissionId, "start_unattended_batch", store)).toBeNull();

			// 7. Planted symlink admission file refuses MCP consumption
			rmSync(admitFile, { force: true });
			const outsideAdmit = join(store, "outside-admit.txt");
			writeFileSync(outsideAdmit, JSON.stringify({ operation: "start_unattended_batch", conversation: conversationId }), { mode: 0o600 });
			symlinkSync(outsideAdmit, admitFile);
			expect(consumePhaseAdmission(admissionId, "start_unattended_batch", store)).toBeNull();
			rmSync(admitFile, { force: true });

			// 8. Re-record admission and prepare native confirmation grant via PreToolUseHookAsync
			antigravityPreToolUseHook({
				conversationId,
				stepIdx,
				workspacePaths: [root],
				toolCall: {
					name: "call_mcp_tool",
					args: { ServerName: "immune-brain", ToolName: "start_unattended_batch", Arguments: { task_id: TASK_AC2 } },
				},
			}, { root: store });

			const hookRes = await antigravityPreToolUseHookAsync({
				conversationId,
				stepIdx,
				workspacePaths: [root],
				toolCall: {
					name: "call_mcp_tool",
					args: { ServerName: "immune-brain", ToolName: "start_unattended_batch", Arguments: { task_id: TASK_AC2 } },
				},
			}, { root: store });
			expect(hookRes.decision).toBe("force_ask");
			expect(existsSync(confirmFile)).toBe(true);
			expect((lstatSync(confirmFile).mode & 0o777)).toBe(0o600);

			// 9. Tampered confirmation grant (wrong mode 0644) refuses
			const validConfirmBytes = readFileSync(confirmFile, "utf8");
			chmodSync(confirmFile, 0o644);
			await expect(consumeNativeConfirmation({
				operation: "start_unattended_batch",
				admissionId,
				workspace: root,
				taskId: TASK_AC2,
			}, store)).rejects.toThrow("Antigravity PreToolUse native confirmation grant is missing or already consumed");

			// 10. Truncated confirmation grant refuses
			writeFileSync(confirmFile, "{\"incomplete\":", { mode: 0o600 });
			await expect(consumeNativeConfirmation({
				operation: "start_unattended_batch",
				admissionId,
				workspace: root,
				taskId: TASK_AC2,
			}, store)).rejects.toThrow("Antigravity PreToolUse native confirmation grant is missing or already consumed");

			// 11. Planted symlink confirmation grant refuses
			rmSync(confirmFile, { force: true });
			const outsideConfirm = join(store, "outside-confirm.txt");
			writeFileSync(outsideConfirm, validConfirmBytes, { mode: 0o600 });
			symlinkSync(outsideConfirm, confirmFile);
			await expect(consumeNativeConfirmation({
				operation: "start_unattended_batch",
				admissionId,
				workspace: root,
				taskId: TASK_AC2,
			}, store)).rejects.toThrow("Antigravity PreToolUse native confirmation grant is missing or already consumed");
			rmSync(confirmFile, { force: true });

			// 12. Foreign-owned confirmation grant refuses
			writeFileSync(confirmFile, validConfirmBytes, { mode: 0o600 });
			const spy = spyOn(process, "getuid").mockReturnValue((process.getuid?.() ?? 0) + 9999);
			try {
				await expect(consumeNativeConfirmation({
					operation: "start_unattended_batch",
					admissionId,
					workspace: root,
					taskId: TASK_AC2,
				}, store)).rejects.toThrow("Antigravity PreToolUse native confirmation grant is missing or already consumed");
			} finally {
				spy.mockRestore();
			}

			// 13. Positive: valid confirmation resolves once through the real MCP server
			antigravityPreToolUseHook({
				conversationId,
				stepIdx,
				workspacePaths: [root],
				toolCall: {
					name: "call_mcp_tool",
					args: { ServerName: "immune-brain", ToolName: "start_unattended_batch", Arguments: { task_id: TASK_AC2 } },
				},
			}, { root: store });
			await antigravityPreToolUseHookAsync({
				conversationId,
				stepIdx,
				workspacePaths: [root],
				toolCall: {
					name: "call_mcp_tool",
					args: { ServerName: "immune-brain", ToolName: "start_unattended_batch", Arguments: { task_id: TASK_AC2 } },
				},
			}, { root: store });

			const server = wire(root, store, {
				batchKernel: { advanceTask: async () => ({ state: "blocked", reason: "parked for inspection" }) },
			});
			await initialize(server);
			server.send({ jsonrpc: "2.0", id: "ac2-positive-1", method: "tools/call",
				params: { name: "start_unattended_batch", arguments: { task_id: TASK_AC2 }, _meta: {
					"antigravity.google/conversation_id": conversationId,
					"antigravity.google/workspace_paths": [root],
					progressToken: `antigravity-hook:${stepIdx}`,
				} } });
			const reply = await server.next();
			expect(reply.error).toBeUndefined();
			const text = reply.result.content[0].text as string;
			expect(JSON.parse(text).state).toBe("started");

			// 14. Negative: replay of the same step refuses because grants are single-use
			server.send({ jsonrpc: "2.0", id: "ac2-replay-2", method: "tools/call",
				params: { name: "start_unattended_batch", arguments: { task_id: TASK_AC2 }, _meta: {
					"antigravity.google/conversation_id": conversationId,
					"antigravity.google/workspace_paths": [root],
					progressToken: `antigravity-hook:${stepIdx}`,
				} } });
			const replayReply = await server.next();
			expect(replayReply.error).toBeDefined();
			expect(replayReply.error.data?.reason_code).toBe("run_entry_required");
			server.input.end();
		}, 60_000);
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

	it("AAVR-A2: PostToolUse with no result field or empty result never appends a result event", () => {
		const root = mkdtempSync(join(tmpdir(), "antigravity-hook-empty-result-"));
		try {
			dispatch(root, preToolUse({ name: "invoke_subagent", args: SUBAGENT_ARGS }));
			dispatch(root, { ...preToolUse({ name: "invoke_subagent", args: SUBAGENT_ARGS }), error: "" });
			dispatch(root, { ...preToolUse({ name: "invoke_subagent", args: SUBAGENT_ARGS }), error: "", result: "" });
			dispatch(root, { ...preToolUse({ name: "Subagent", args: SUBAGENT_ARGS }), error: "", result: "   " });
			expect(antigravityHookEventLog(root).list("c").map((event) => event.type)).toEqual(["start"]);
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

	function asyncBrainDir(conversation = CONVERSATION): string {
		const brain = scratchDir("brain");
		const artifactDir = join(brain, conversation);
		mkdirSync(join(artifactDir, ".system_generated", "subagents"), { recursive: true });
		mkdirSync(join(artifactDir, ".system_generated", "messages", "undelivered"), { recursive: true });
		return artifactDir;
	}

	function writeSpawnRecord(
		artifactDir: string,
		childId: string,
		overrides: { spawnStepIndex?: number; typeName?: string; conversationId?: string } = {},
	): void {
		writeFileSync(
			join(artifactDir, ".system_generated", "subagents", `${childId}.json`),
			JSON.stringify({
				conversationId: overrides.conversationId ?? childId,
				subagentDescriptor: { typeName: overrides.typeName ?? VERIFIER_AGENT, role: "Review Verifier" },
				state: "SUBAGENT_STATE_ALIVE",
				spawnStepIndex: overrides.spawnStepIndex ?? STEP_IDX,
			}),
		);
	}

	function writeChildMessage(
		artifactDir: string,
		messageId: string,
		message: { sender: string; recipient: string; content: string },
	): void {
		writeFileSync(
			join(artifactDir, ".system_generated", "messages", `${messageId}.json`),
			JSON.stringify({ id: messageId, ...message }),
		);
	}

	function asyncPreAndPost(
		cache: string,
		dispatch: { TypeName: string; Prompt: string; Model: string },
		artifactDir: string,
	): void {
		expect(hook(cache, { ...dispatchEvent(dispatch), artifactDirectoryPath: artifactDir })).toBe('{"decision":"allow"}');
		expect(hook(cache, { ...dispatchEvent(dispatch), error: "", artifactDirectoryPath: artifactDir })).toBe("{}");
	}

	it("AAVR-A1: resolves asynchronous verifier result from spawn record and child message across hooks without duplicate refusal", async () => {
		const current = await setup();
		const artifactDir = asyncBrainDir();
		const childId = "child-verifier-1";
		const verdict = verifierResult(current);

		asyncPreAndPost(current.cache, current.dispatch, artifactDir);
		expect(antigravityHookEventLog(current.cache).list(CONVERSATION).map((e) => e.type)).toEqual(["start"]);

		const pending = await current.runtime.submitVerification(TASK, undefined);
		expect(pending).toMatchObject({ state: "blocked", reason: "verification result pending" });

		// Live agy 1.5.7 layout also contains read.json and background self-sent noise.
		writeFileSync(join(artifactDir, ".system_generated", "messages", "read.json"), JSON.stringify({ "msg-1": true }));
		writeSpawnRecord(artifactDir, childId);
		writeChildMessage(artifactDir, "msg-1", { sender: childId, recipient: CONVERSATION, content: verdict });

		// Further hook payloads run (e.g. PreInvocation / PreToolUse before submit_verification).
		hook(current.cache, { conversationId: CONVERSATION, invocationNum: 2, lastUserInput: "", artifactDirectoryPath: artifactDir });
		// Bound: additional hook payloads after resolution append no second result event.
		hook(current.cache, { conversationId: CONVERSATION, executionNum: 2, fullyIdle: true, artifactDirectoryPath: artifactDir });
		hook(current.cache, {
			toolCall: { name: "call_mcp_tool", args: { ServerName: "immune-brain", ToolName: "submit_verification", Arguments: { task_id: TASK } } },
			stepIdx: STEP_IDX + 1,
			conversationId: CONVERSATION,
			artifactDirectoryPath: artifactDir,
		});

		const logged = antigravityHookEventLog(current.cache).list(CONVERSATION);
		const resultEvents = logged.filter((e) => e.type === "result");
		expect(resultEvents).toHaveLength(1);
		expect(resultEvents[0]?.result).toBe(verdict);

		const settled = await current.runtime.submitVerification(TASK, undefined);
		expect(settled).toMatchObject({ state: "rework", summary: CLAIM });
		expect(current.applied.at(-1)).toMatchObject({
			role: "review",
			decision: "rework",
			kept: [expect.stringContaining("review-1")],
			actor: `antigravity:${STEP_IDX}`,
		});
		expect(current.applied.at(-1)?.failure).toBeUndefined();
	});

	it("AAVR-A2: fails closed and stays pending when async correlation or safety checks fail", async () => {
		const cases: Array<{ name: string; prepare: (caseDir: string, verdict: string) => string }> = [
			{
				name: "only self-sent message exists",
				prepare: (dir, verdict) => {
					writeSpawnRecord(dir, "child-1");
					writeChildMessage(dir, "self-1", { sender: CONVERSATION, recipient: CONVERSATION, content: verdict });
					return dir;
				},
			},
			{
				name: "message recipient differs from conversationId",
				prepare: (dir, verdict) => {
					writeSpawnRecord(dir, "child-1");
					writeChildMessage(dir, "msg-1", { sender: "child-1", recipient: "other-conversation", content: verdict });
					return dir;
				},
			},
			{
				name: "spawnStepIndex differs from dispatch stepIdx",
				prepare: (dir, verdict) => {
					writeSpawnRecord(dir, "child-1", { spawnStepIndex: STEP_IDX + 1 });
					writeChildMessage(dir, "msg-1", { sender: "child-1", recipient: CONVERSATION, content: verdict });
					return dir;
				},
			},
			{
				name: "spawn typeName is not immune-brain-review-verifier",
				prepare: (dir, verdict) => {
					writeSpawnRecord(dir, "child-1", { typeName: "immune-brain-reviewer" });
					writeChildMessage(dir, "msg-1", { sender: "child-1", recipient: CONVERSATION, content: verdict });
					return dir;
				},
			},
			{
				name: "artifactDirectoryPath basename differs from conversationId",
				prepare: (_dir, verdict) => {
					const wrongDir = asyncBrainDir("different-conversation");
					writeSpawnRecord(wrongDir, "child-1");
					writeChildMessage(wrongDir, "msg-1", { sender: "child-1", recipient: CONVERSATION, content: verdict });
					return wrongDir;
				},
			},
			{
				name: "artifactDirectoryPath itself is a symlink",
				prepare: (dir, verdict) => {
					writeSpawnRecord(dir, "child-1");
					writeChildMessage(dir, "msg-1", { sender: "child-1", recipient: CONVERSATION, content: verdict });
					const symlinkParent = scratchDir("sym-brain");
					const symlinkPath = join(symlinkParent, CONVERSATION);
					symlinkSync(dir, symlinkPath);
					return symlinkPath;
				},
			},
			{
				name: ".system_generated component is a symlink",
				prepare: (dir, verdict) => {
					const target = scratchDir("sym-sys");
					mkdirSync(join(target, "subagents"), { recursive: true });
					mkdirSync(join(target, "messages"), { recursive: true });
					writeFileSync(join(target, "subagents", "child-1.json"), JSON.stringify({
						conversationId: "child-1",
						subagentDescriptor: { typeName: VERIFIER_AGENT },
						spawnStepIndex: STEP_IDX,
					}));
					writeFileSync(join(target, "messages", "msg-1.json"), JSON.stringify({
						id: "msg-1", sender: "child-1", recipient: CONVERSATION, content: verdict,
					}));
					rmSync(join(dir, ".system_generated"), { recursive: true, force: true });
					symlinkSync(target, join(dir, ".system_generated"));
					return dir;
				},
			},
			{
				name: "spawn file is unparsable JSON",
				prepare: (dir, verdict) => {
					writeFileSync(join(dir, ".system_generated", "subagents", "child-1.json"), "{not valid json");
					writeChildMessage(dir, "msg-1", { sender: "child-1", recipient: CONVERSATION, content: verdict });
					return dir;
				},
			},
			{
				name: "message file is unparsable JSON",
				prepare: (dir) => {
					writeSpawnRecord(dir, "child-1");
					writeFileSync(join(dir, ".system_generated", "messages", "msg-1.json"), "{not valid json");
					return dir;
				},
			},
			{
				name: "spawn file exceeds adapter byte bound",
				prepare: (dir, verdict) => {
					writeSpawnRecord(dir, "child-1");
					writeFileSync(
						join(dir, ".system_generated", "subagents", "child-1.json"),
						" ".repeat(MAX_ASYNC_VERIFIER_FILE_BYTES + 1),
					);
					writeChildMessage(dir, "msg-1", { sender: "child-1", recipient: CONVERSATION, content: verdict });
					return dir;
				},
			},
			{
				name: "message file exceeds adapter byte bound",
				prepare: (dir, verdict) => {
					writeSpawnRecord(dir, "child-1");
					writeChildMessage(dir, "msg-1", {
						sender: "child-1",
						recipient: CONVERSATION,
						content: verdict + " ".repeat(MAX_ASYNC_VERIFIER_FILE_BYTES + 1),
					});
					return dir;
				},
			},
		];

		for (const testCase of cases) {
			const current = await setup();
			const baseDir = asyncBrainDir();
			const verdict = verifierResult(current);
			const artifactDir = testCase.prepare(baseDir, verdict);

			asyncPreAndPost(current.cache, current.dispatch, artifactDir);
			hook(current.cache, { conversationId: CONVERSATION, invocationNum: 2, lastUserInput: "", artifactDirectoryPath: artifactDir });

			const events = antigravityHookEventLog(current.cache).list(CONVERSATION);
			expect(events.filter((e) => e.type === "result"), testCase.name).toHaveLength(0);

			const pending = await current.runtime.submitVerification(TASK, undefined);
			expect(pending, testCase.name).toMatchObject({ state: "blocked", reason: "verification result pending" });
			expect(current.applied, testCase.name).toHaveLength(1);
		}
	}, 30_000);

	it("AAVR-A2: refuses submission when the spawned verifier sent two messages to the conversation", async () => {
		const current = await setup();
		const artifactDir = asyncBrainDir();
		const childId = "child-verifier-two";
		const verdict = verifierResult(current);

		asyncPreAndPost(current.cache, current.dispatch, artifactDir);
		writeSpawnRecord(artifactDir, childId);
		writeChildMessage(artifactDir, "msg-1", { sender: childId, recipient: CONVERSATION, content: verdict });
		writeChildMessage(artifactDir, "msg-2", { sender: childId, recipient: CONVERSATION, content: verdict });

		hook(current.cache, { conversationId: CONVERSATION, invocationNum: 2, lastUserInput: "", artifactDirectoryPath: artifactDir });

		const res = await current.runtime.submitVerification(TASK, undefined);
		expect(res).toMatchObject({ state: "rework" });
		expect(current.applied.at(-1)).toMatchObject({ actor: null, failure: "dispatch_failed" });
		expect(current.host.reasons).toContain("multiple verifier messages observed for spawned verifier");
		// Reservation was released so neither message can settle on a retry.
		const retry = await current.runtime.submitVerification(TASK, undefined);
		expect(retry).toMatchObject({ state: "blocked", reason: "no active verification operation" });
	});

	it("AAVR-A2: refuses submission when a second verifier message arrives before submitVerification", async () => {
		const current = await setup();
		const artifactDir = asyncBrainDir();
		const childId = "child-verifier-seq";
		const verdict = verifierResult(current);

		asyncPreAndPost(current.cache, current.dispatch, artifactDir);
		writeSpawnRecord(artifactDir, childId);
		writeChildMessage(artifactDir, "msg-1", { sender: childId, recipient: CONVERSATION, content: verdict });
		hook(current.cache, { conversationId: CONVERSATION, invocationNum: 2, lastUserInput: "", artifactDirectoryPath: artifactDir });

		writeChildMessage(artifactDir, "msg-2", { sender: childId, recipient: CONVERSATION, content: verdict });
		hook(current.cache, { conversationId: CONVERSATION, invocationNum: 3, lastUserInput: "", artifactDirectoryPath: artifactDir });

		await current.runtime.submitVerification(TASK, undefined);
		expect(current.applied.at(-1)).toMatchObject({ actor: null, failure: "dispatch_failed" });
	});

	describe("stopBoundary", () => {
		it("extracts step_index from transcriptPath", () => {
			const dir = realpathSync(mkdtempSync(join(tmpdir(), "imm-stop-boundary-")));
			try {
				const transcript = join(dir, "transcript.jsonl");
				writeFileSync(transcript, JSON.stringify({ role: "user", content: "hi" }) + "\n" + JSON.stringify({ step_index: 42 }) + "\n");
				const boundary = stopBoundary({ transcriptPath: transcript });
				expect(boundary).toBe(digestOfReviewerBytes(`${transcript}\n42`));
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});

		it("extracts uuid from transcriptPath when step_index is absent", () => {
			const dir = realpathSync(mkdtempSync(join(tmpdir(), "imm-stop-boundary-")));
			try {
				const transcript = join(dir, "transcript.jsonl");
				writeFileSync(transcript, JSON.stringify({ uuid: "turn-uuid-xyz" }) + "\n");
				const boundary = stopBoundary({ transcriptPath: transcript });
				expect(boundary).toBe(digestOfReviewerBytes(`${transcript}\nturn-uuid-xyz`));
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});

		it("fails closed to null on empty, missing, or malformed transcript when executionNum is absent", () => {
			const dir = realpathSync(mkdtempSync(join(tmpdir(), "imm-stop-boundary-")));
			try {
				const empty = join(dir, "empty.jsonl");
				writeFileSync(empty, "");
				expect(stopBoundary({ transcriptPath: empty })).toBeNull();

				expect(stopBoundary({ transcriptPath: join(dir, "nonexistent.jsonl") })).toBeNull();

				const malformed = join(dir, "malformed.jsonl");
				writeFileSync(malformed, "not-valid-json\nalso-not-valid\n");
				expect(stopBoundary({ transcriptPath: malformed })).toBeNull();
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});

		it("derives boundary from executionNum as fallback", () => {
			expect(stopBoundary({ conversationId: "conv-1", executionNum: 10 })).toBe(
				digestOfReviewerBytes("conv-1\nexecutionNum:10"),
			);
			expect(stopBoundary({})).toBeNull();
		});

		it("runHook recognizes fullyIdle Stop payload", () => {
			const proc = execFileSync(
				"bun",
				["-e", 'import { runHook } from "./plugins/immune-brain/runtime/antigravity/mcp_server.ts"; runHook();'],
				{
					input: JSON.stringify({ conversationId: "conv-idle", fullyIdle: true, executionNum: 1 }),
					encoding: "utf8",
				},
			);
			expect(() => JSON.parse(proc.trim())).not.toThrow();
		});
	});

	describe("PreToolUse ServerName and correlation bounds", () => {
		it("rejects non-Immune-Brain server names and creates no correlation file", async () => {
			expect(parseImmuneBrainTool("call_mcp_tool", { ServerName: "third-party", ToolName: "status" })).toBeNull();
			const store = realpathSync(mkdtempSync(join(tmpdir(), "imm-server-test-")));
			try {
				const res = await antigravityPreToolUseHookAsync({
					conversationId: "conv-third-party",
					stepIdx: 1,
					toolCall: {
						name: "call_mcp_tool",
						args: { ServerName: "third-party-server", ToolName: "advance_assurance", Arguments: { task_id: "t1" } },
					},
					workspacePaths: [store],
				}, { root: store });
				expect(res.decision).toBe("allow");
				const cache = cacheDir(store, ANTIGRAVITY_CACHE_DIR);
				expect(existsSync(join(cache, `${sessionHash("conv-third-party:1")}.continuation-call`))).toBe(false);
			} finally {
				rmSync(store, { recursive: true, force: true });
			}
		});

		it("creates no correlation file when PreToolUse is denied", async () => {
			const store = realpathSync(mkdtempSync(join(tmpdir(), "imm-deny-test-")));
			try {
				const res = await antigravityPreToolUseHookAsync({
					conversationId: "conv-no-drive",
					stepIdx: 2,
					toolCall: {
						name: "call_mcp_tool",
						args: { ServerName: "immune-brain", ToolName: "start_unattended_batch", Arguments: { task_id: "t1" } },
					},
					workspacePaths: [store],
				}, { root: store });
				expect(res.decision).toBe("deny");
				const cache = cacheDir(store, ANTIGRAVITY_CACHE_DIR);
				expect(existsSync(join(cache, `${sessionHash("conv-no-drive:2")}.continuation-call`))).toBe(false);
			} finally {
				rmSync(store, { recursive: true, force: true });
			}
		});
	});

	describe("createAntigravityMcpRuntime tools/call correlation", () => {
		const TASK = "mcp-corr-task";
		function temp(label: string): string {
			return realpathSync(mkdtempSync(join(tmpdir(), `imm-mcp-corr-${label}-`)));
		}
		function git(dir: string, ...args: string[]): string {
			return execFileSync("git", ["-C", dir, "-c", "user.name=T", "-c", "user.email=t@t", ...args], { encoding: "utf8" }).trim();
		}
		const verification = () => JSON.stringify({
			contract: "assurance_kernel/verification_descriptor/v2",
			command: { executable: "sh", argv: ["-c", "exit 0"], cwd: ".", timeout_ms: 60_000, max_output_bytes: 4_096 },
			environment: { prepare: null, writable_paths: [] },
		});
		async function setupWorkspace(): Promise<{ root: string; store: string }> {
			const root = temp("ws");
			const store = temp("store");
			mkdirSync(join(root, "docs/plans"), { recursive: true });
			writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
			writeFileSync(join(root, "base.txt"), "base\n");
			writeFileSync(join(root, "docs/plans", `${TASK}.intent.json`), JSON.stringify({
				contract: "assurance_kernel/task_intent/v1",
				task_id: TASK,
				owner: "user",
				goal: "correlated tool call",
				acceptance: [{ id: "AC1", assertion: "the tool call is correlated", verification: verification() }],
				scope_hint: ["docs/plans"],
				risk: "routine",
				revision: 1,
			}) + "\n");
			git(root, "init", "-q", "-b", "main");
			git(root, "add", "-A");
			git(root, "commit", "-qm", "init");
			await enrollTaskForTest(root, TASK);
			return { root, store };
		}

		it("status call correlates Hook session via PreToolUse and progressToken", async () => {
			const { root, store } = await setupWorkspace();
			const conversationId = "conv-mcp-status";
			try {
				const mcp = createAntigravityMcpRuntime({
					cwd: root,
					env: {},
					interactive: true,
					confirmationStoreRoot: store,
				});
				mcp.bindClientHandshake({ version: "1.0.0", interactive: true, protocolVersion: "2025-06-18" });

				antigravityPreInvocationHook({ conversationId, lastUserInput: `/drive ${TASK}`, workspacePaths: [root] }, { root: store, home: store });

				await antigravityPreToolUseHookAsync({
					conversationId,
					stepIdx: 1,
					toolCall: { name: "call_mcp_tool", args: { ServerName: "immune-brain", ToolName: "status", Arguments: { task_id: TASK } } },
					workspacePaths: [root],
				}, { root: store });

				const reply = await handleJsonRpc({
					jsonrpc: "2.0",
					id: "rpc-status-1",
					method: "tools/call",
					params: {
						name: "status",
						arguments: { task_id: TASK },
						_meta: {
							"antigravity.google/conversation_id": conversationId,
							"antigravity.google/workspace_paths": [root],
							progressToken: "antigravity-hook:1",
						},
					},
				}, mcp);

				expect(reply?.error).toBeUndefined();
				const content = JSON.parse((reply?.result as any).content[0].text);
				expect(content.task_id).toBe(TASK);
				expect(content.projection.lifecycle).toBe("active");
			} finally {
				rmSync(root, { recursive: true, force: true });
				rmSync(store, { recursive: true, force: true });
			}
		});

		it("request_authorization consumes force_ask grant and executes with step correlation", async () => {
			const { root, store } = await setupWorkspace();
			const conversationId = "conv-mcp-auth";
			try {
				const mcp = createAntigravityMcpRuntime({
					cwd: root,
					env: {},
					interactive: true,
					confirmationStoreRoot: store,
				});
				mcp.bindClientHandshake({ version: "1.0.0", interactive: true, protocolVersion: "2025-06-18" });

				antigravityPreInvocationHook({ conversationId, lastUserInput: `/drive ${TASK}`, workspacePaths: [root] }, { root: store, home: store });

				const record = readTaskRecordRaw(root, TASK).record!;
				createCanaryApplication(createTestMutationRegistry()).execute({
					root,
					task_id: TASK,
					prior_intent_token: readTaskIntent(root, TASK, record.intent_ref.path, record.intent_snapshot).token,
					operation: { op: "record_finding", actor_id: "literal-user", finding: { id: "user-decision-1", kind: "unresolved_user_decision", acceptance_id: null, summary: "User must authorize" } },
				});

				const hookRes = await antigravityPreToolUseHookAsync({
					conversationId,
					stepIdx: 2,
					toolCall: { name: "call_mcp_tool", args: { ServerName: "immune-brain", ToolName: "request_authorization", Arguments: { task_id: TASK } } },
					workspacePaths: [root],
				}, { root: store });
				expect(hookRes.decision).toBe("force_ask");

				const reply = await handleJsonRpc({
					jsonrpc: "2.0",
					id: "rpc-auth-1",
					method: "tools/call",
					params: {
						name: "request_authorization",
						arguments: { task_id: TASK },
						_meta: {
							"antigravity.google/conversation_id": conversationId,
							"antigravity.google/workspace_paths": [root],
							progressToken: "antigravity-hook:2",
						},
					},
				}, mcp);

				expect(reply?.error).toBeUndefined();
				const finding = readTaskRecordRaw(root, TASK).record?.findings.find((f) => f.id === "user-decision-1");
				expect(finding?.status).toBe("resolved");
			} finally {
				rmSync(root, { recursive: true, force: true });
				rmSync(store, { recursive: true, force: true });
			}
		});

		it("batch parent advance_assurance correlates child settlement", async () => {
			const { root, store } = await setupWorkspace();
			const conversationId = "conv-mcp-batch-parent";
			try {
				const mcp = createAntigravityMcpRuntime({
					cwd: root,
					env: {},
					interactive: true,
					confirmationStoreRoot: store,
				});
				mcp.bindClientHandshake({ version: "1.0.0", interactive: true, protocolVersion: "2025-06-18" });

				// 1. Enter drive as parent
				antigravityPreInvocationHook({ conversationId, lastUserInput: `/drive --batch ${TASK}`, workspacePaths: [root] }, { root: store, home: store });

				// 2. PreToolUse + PostToolUse for start_unattended_batch to bind the parent
				await antigravityPreToolUseHookAsync({
					conversationId,
					stepIdx: 1,
					toolCall: { name: "call_mcp_tool", args: { ServerName: "immune-brain", ToolName: "start_unattended_batch", Arguments: { initiative_slug: TASK } } },
					workspacePaths: [root],
				}, { root: store });
				await antigravityPostToolUseHook({
					conversationId,
					stepIdx: 1,
					toolCall: { name: "call_mcp_tool", args: { ServerName: "immune-brain", ToolName: "start_unattended_batch", Arguments: { initiative_slug: TASK } } },
					workspacePaths: [root],
					result: JSON.stringify({ state: "native_parent", initiative_slug: TASK, plan_digest: `sha256:${"a".repeat(64)}` }),
				}, { root: store });

				// 3. PreToolUse for child advance_assurance at step 2
				await antigravityPreToolUseHookAsync({
					conversationId,
					stepIdx: 2,
					toolCall: { name: "call_mcp_tool", args: { ServerName: "immune-brain", ToolName: "advance_assurance", Arguments: { task_id: TASK } } },
					workspacePaths: [root],
				}, { root: store });

				expect(selectedAntigravityParent(`${conversationId}:2`, root, TASK, store)).toBe(true);

				// Pin that profile.selectedParent uses the configured confirmationStoreRoot:
				// direct call without store parameter passes because profile bound confirmationStoreRoot.
				expect((mcp as any).runtime.profile.selectedParent(`${conversationId}:2`, root, TASK)).toBe(true);

				// Seed a resumable batch run state record so findResumableBatchSlugForTask finds TASK
				mkdirSync(join(root, ".imm", "state", "batches"), { recursive: true });
				writeFileSync(
					join(root, ".imm", "state", "batches", "batch-1.json"),
					JSON.stringify({
						contract: "assurance_kernel/batch_run_state/v1",
						batch_id: "batch-1",
						batch_state: "running",
						initiative_slug: TASK,
						base_head: "0".repeat(40),
						children: [{ task_id: TASK, state: "enrolled" }],
					}),
				);

				// Mock settlement to completed/done so closeOutBatchChild executes
				const advanceSpy = spyOn((mcp as any).runtime.coordinator, "advance").mockResolvedValue({
					state: "completed",
					record: { lifecycle: "done" },
				} as any);

				// 4. tools/call for advance_assurance with progressToken step 2
				const reply = await handleJsonRpc({
					jsonrpc: "2.0",
					id: "rpc-advance-1",
					method: "tools/call",
					params: {
						name: "advance_assurance",
						arguments: { task_id: TASK },
						_meta: {
							"antigravity.google/conversation_id": conversationId,
							"antigravity.google/workspace_paths": [root],
							progressToken: "antigravity-hook:2",
						},
					},
				}, mcp);

				expect(reply?.error).toBeUndefined();
				const content = JSON.parse((reply?.result as any).content[0].text);
				expect(content.state).toBe("completed");
				expect(content.batch).toBeDefined();
				advanceSpy.mockRestore();
			} finally {
				rmSync(root, { recursive: true, force: true });
				rmSync(store, { recursive: true, force: true });
			}
		});

		it("AC2 (D7): retire_stale_batch correlates toolCallId and confirmation_ref with conversationId:stepIdx", async () => {
			const { root, store } = await setupWorkspace();
			const conversationId = "conv-retire-corr";
			try {
				const mcp = createAntigravityMcpRuntime({
					cwd: root,
					env: {},
					interactive: true,
					confirmationStoreRoot: store,
				});
				mcp.bindClientHandshake({ version: "1.0.0", interactive: true, protocolVersion: "2025-06-18" });

				antigravityPreInvocationHook({ conversationId, lastUserInput: `/drive ${TASK}`, workspacePaths: [root] }, { root: store, home: store });

				// Write an old batch record that can be retired
				const batchDir = join(root, ".imm/state/batches");
				mkdirSync(batchDir, { recursive: true });
				const planDigest = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
				writeFileSync(
					join(batchDir, "batch-stale-1.json"),
					JSON.stringify({
						contract: "assurance_kernel/batch_run_state/v1",
						batch_id: "batch-stale-1",
						initiative_slug: TASK,
						base_head: git(root, "rev-parse", "HEAD"),
						branch: `imm/${TASK}`,
						plan_digest: planDigest,
						confirmation_time: "2026-01-01T00:00:00.000Z",
						batch_state: "running",
						children: [{ task_id: TASK, slice_id: TASK, state: "pending", commit: null, blocked_by: [], reason: null }],
						commits: [],
						consecutive_qa_failures: 0,
						budget: { max_children: 1, qa_failure_limit: 2 },
						created_at: "2026-01-01T00:00:00.000Z",
						updated_at: "2026-01-01T00:00:00.000Z",
					}),
				);

				// PreToolUse for retire_stale_batch at stepIdx 2
				const preRes = await antigravityPreToolUseHookAsync({
					conversationId,
					stepIdx: 2,
					toolCall: { name: "call_mcp_tool", args: { ServerName: "immune-brain", ToolName: "retire_stale_batch", Arguments: { initiative_slug: TASK } } },
					workspacePaths: [root],
				}, { root: store });
				expect(preRes.decision).toBe("allow");

				// PreToolUse wrote continuation-call under `${conversationId}:2`
				expect(readRunToolSession(`${conversationId}:2`, "retire_stale_batch", root, store)).toBe(conversationId);

				// MCP tools/call for retire_stale_batch with JSON-RPC id "rpc-retire-99" and progressToken step 2
				const reply = await handleJsonRpc({
					jsonrpc: "2.0",
					id: "rpc-retire-99",
					method: "tools/call",
					params: {
						name: "retire_stale_batch",
						arguments: { initiative_slug: TASK },
						_meta: {
							"antigravity.google/conversation_id": conversationId,
							"antigravity.google/workspace_paths": [root],
							progressToken: "antigravity-hook:2",
						},
					},
				}, mcp);

				expect(reply?.error).toBeUndefined();
				const content = JSON.parse(reply?.result?.content?.[0]?.text ?? "{}");
				expect(content.state).toBe("retired");
				expect(content.report?.retirement?.confirmation_ref).toBe(hostConfirmationRef("antigravity", {
					connectionId: conversationId,
					toolCallId: `${conversationId}:2`,
					requestId: entryTokenRequestId(readPhaseEntryState(conversationId, store)!.token!),
					operation: "retire_stale_batch",
					initiativeSlug: TASK,
					planDigest,
				}));
			} finally {
				rmSync(root, { recursive: true, force: true });
				rmSync(store, { recursive: true, force: true });
			}
		});
	});

	describe("AC2 (D7): paused-run enforcement and cache tamper failure", () => {
		it("applyRunContinuationEvent denies paused native gates even when run_live is revoked", async () => {
			const store = realpathSync(mkdtempSync(join(tmpdir(), "imm-paused-run-")));
			const root = realpathSync(mkdtempSync(join(tmpdir(), "imm-paused-ws-")));
			const conversationId = "conv-paused-gates";
			try {
				const host = antigravityContinuationHost(store);
				// Simulate paused session in metadata
				const metaPath = join(cacheDir(store, ANTIGRAVITY_CACHE_DIR), `${sessionHash(conversationId)}.continuation`);
				ensurePrivateDir(cacheDir(store, ANTIGRAVITY_CACHE_DIR));
				appendPrivate(metaPath, cacheDir(store, ANTIGRAVITY_CACHE_DIR), JSON.stringify({
					sequence: 1,
					stop_blocks: 0,
					native_failures: 3,
					review: "unobserved",
					reviewer_prompt: null,
					reviewer_call_id: null,
					reviewer_agent_id: null,
					recovery_action: null,
					paused: "request_authorization failed 3 times under this entry; no further automatic retry",
					state: null,
				}) + "\n");

				// Native gates must be denied by shared state machine
				for (const op of ["request_authorization", "approve_breaking_intent_revision", "stop"] as const) {
					const outcome = await applyRunContinuationEvent(host, store, { session_id: conversationId, workspace: root }, {
						kind: "tool_call",
						operation: op,
						tool_id: `${conversationId}:5`,
						task_id: "t1",
					});
					expect(outcome).toEqual({
						kind: "deny",
						reason: "request_authorization failed 3 times under this entry; no further automatic retry",
					});

					const hookOutcome = await antigravityRunContinuationPreToolUse({
						conversationId,
						stepIdx: 5,
						toolCall: { name: "call_mcp_tool", args: { ServerName: "immune-brain", ToolName: op, Arguments: { task_id: "t1" } } },
						workspacePaths: [root],
					}, store);
					expect(hookOutcome).toEqual({
						decision: "deny",
						reason: "Run paused: request_authorization failed 3 times under this entry; no further automatic retry; enter drive explicitly before another native gate",
					});
				}
			} finally {
				rmSync(root, { recursive: true, force: true });
				rmSync(store, { recursive: true, force: true });
			}
		});

		it("fails closed on tampered continuation files in sync and async hooks", async () => {
			const store = realpathSync(mkdtempSync(join(tmpdir(), "imm-tamper-store-")));
			const root = realpathSync(mkdtempSync(join(tmpdir(), "imm-tamper-ws-")));
			const conversationId = "conv-tamper";
			const cache = cacheDir(store, ANTIGRAVITY_CACHE_DIR);
			ensurePrivateDir(cache);
			const metaPath = join(cache, `${sessionHash(conversationId)}.continuation`);

			try {
				// 1. Symlink
				const target = join(store, "dummy.txt");
				writeFileSync(target, "dummy\n");
				symlinkSync(target, metaPath);

				const syncSymlink = antigravityPreToolUseHook({
					conversationId,
					stepIdx: 1,
					toolCall: { name: "call_mcp_tool", args: { ServerName: "immune-brain", ToolName: "request_authorization", Arguments: { task_id: "t1" } } },
					workspacePaths: [root],
				}, { root: store });
				expect(syncSymlink.decision).toBe("deny");
				expect(syncSymlink.reason).toContain("continuation facts could not be verified");

				const asyncSymlink = await antigravityPreToolUseHookAsync({
					conversationId,
					stepIdx: 1,
					toolCall: { name: "call_mcp_tool", args: { ServerName: "immune-brain", ToolName: "request_authorization", Arguments: { task_id: "t1" } } },
					workspacePaths: [root],
				}, { root: store });
				expect(asyncSymlink.decision).toBe("deny");
				expect(asyncSymlink.reason).toContain("continuation facts could not be verified");

				// Post tool use does not throw unhandled rejection
				await expect(antigravityPostToolUseHook({
					conversationId,
					stepIdx: 1,
					toolCall: { name: "call_mcp_tool", args: { ServerName: "immune-brain", ToolName: "request_authorization", Arguments: { task_id: "t1" } } },
					workspacePaths: [root],
					result: "ok",
				}, { root: store })).resolves.toBeUndefined();

				unlinkSync(metaPath);

				// 2. Corrupt JSON
				appendPrivate(metaPath, cache, "not-valid-json{{{");
				const syncCorrupt = antigravityPreToolUseHook({
					conversationId,
					stepIdx: 1,
					toolCall: { name: "call_mcp_tool", args: { ServerName: "immune-brain", ToolName: "request_authorization", Arguments: { task_id: "t1" } } },
					workspacePaths: [root],
				}, { root: store });
				expect(syncCorrupt.decision).toBe("deny");
				expect(syncCorrupt.reason).toContain("continuation facts could not be verified");

				const asyncCorrupt = await antigravityPreToolUseHookAsync({
					conversationId,
					stepIdx: 1,
					toolCall: { name: "call_mcp_tool", args: { ServerName: "immune-brain", ToolName: "request_authorization", Arguments: { task_id: "t1" } } },
					workspacePaths: [root],
				}, { root: store });
				expect(asyncCorrupt.decision).toBe("deny");
				expect(asyncCorrupt.reason).toContain("continuation facts could not be verified");

				unlinkSync(metaPath);

				// 3. 0644 mode file
				writeFileSync(metaPath, JSON.stringify({ paused: null }) + "\n", { mode: 0o644 });
				chmodSync(metaPath, 0o644);
				const syncMode = antigravityPreToolUseHook({
					conversationId,
					stepIdx: 1,
					toolCall: { name: "call_mcp_tool", args: { ServerName: "immune-brain", ToolName: "request_authorization", Arguments: { task_id: "t1" } } },
					workspacePaths: [root],
				}, { root: store });
				expect(syncMode.decision).toBe("deny");
				expect(syncMode.reason).toContain("continuation facts could not be verified");
			} finally {
				rmSync(root, { recursive: true, force: true });
				rmSync(store, { recursive: true, force: true });
			}
		});
	});
});
