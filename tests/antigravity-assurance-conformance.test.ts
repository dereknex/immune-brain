import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	AntigravityReviewHost,
	MemoryHookEventLog,
	REVIEWER_AGENT,
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
import { NativeAuthorityError } from "../plugins/immune-brain/runtime/antigravity/interaction";
import { probeHost } from "../plugins/immune-brain/runtime/antigravity/capability";
import type { ReviewRequest, VerificationRequest } from "../plugins/immune-brain/runtime/assurance/host_port";
import { writeTestReviewPacket } from "./helpers/review-packet-fixture";

describe("Antigravity Harness Conformance", () => {
	it("probes host capability and returns antigravity host ID", async () => {
		const host = await probeHost();
		expect(host.ok).toBe(true);
		if (host.ok) {
			expect(host.host).toBe("antigravity");
			expect(host.version).toBeDefined();
		}
	});

	describe("AntigravityReviewHost", () => {
		it("prepares a review reservation with native subagent dispatch parameters", () => {
			const eventLog = new MemoryHookEventLog();
			const host = new AntigravityReviewHost(eventLog);

			const request: ReviewRequest = {
				taskId: "task-test-01",
				operationId: "op-test-01",
				prompt: "Full review prompt",
				snapshotPrompt: "Snapshot facts",
				evidencePath: "/tmp/review.json",
				writePacket: writeTestReviewPacket,
				maxTurns: 5,
			};

			const reservation = host.prepareReview(request);
			expect(reservation.id).toBe("op-test-01");

			const dispatch = reservation.dispatch as {
				TypeName: string;
				Role: string;
				Prompt: string;
				Model: string;
			};
			expect(dispatch.TypeName).toBe(REVIEWER_AGENT);
			expect(dispatch.Role).toBe("Code Reviewer");
			expect(dispatch.Model).toBe("inherit");
			expect(dispatch.Prompt).toContain("operation_id=op-test-01");
		});

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
			expect(isPrivilegedOperation("enroll")).toBe(true);
			expect(isPrivilegedOperation("start_unattended_batch")).toBe(true);
			expect(isPrivilegedOperation("retire_stale_batch")).toBe(true);
			expect(isPrivilegedOperation("advance_assurance")).toBe(false);
			expect(isPrivilegedOperation("status")).toBe(false);
		});

		it("intercepts privileged MCP tool calls with force_ask when not admitted", () => {
			const result = antigravityPreToolUseHook({
				conversationId: "conv-gate-1",
				toolCall: {
					name: "mcp__immune-brain__enroll",
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

		it("records /drive in PreInvocation hook", () => {
			const res = antigravityPreInvocationHook({
				conversationId: "conv-drive-1",
				lastUserInput: "/drive task-999",
			});

			expect(res.injectSteps).toBeDefined();

			const state = readPhaseEntryState("conv-drive-1");
			expect(state?.run_live).toBe(true);
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

				// Privileged operation enroll without entry token requires confirmation
				await expect(
					runtime.enroll("task-01", {
						sessionId: "s1",
						toolCallId: "tc1",
						taskId: "task-01",
						interactive: true,
					}),
				).rejects.toThrow(NativeAuthorityError);
			} finally {
				rmSync(tempDir, { recursive: true, force: true });
			}
		});
	});
});
