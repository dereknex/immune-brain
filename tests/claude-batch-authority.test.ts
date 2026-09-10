import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
	createMcpRuntime,
	elicitationParams,
	listMcpTools,
	serveStdio,
} from "../plugins/immune-brain/runtime/claude/mcp_server";
import {
	NativeAuthorityError,
	PRIVILEGED_OPERATIONS,
} from "../plugins/immune-brain/runtime/claude/interaction";
import type { GithubInitiativeObservation } from "../plugins/immune-brain/runtime/github_issue_tracker";
import { ClaudeRuntime, type ToolMeta } from "../plugins/immune-brain/runtime/claude/kernel_ports";

const ENV = { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" };

function initGitRepo(root: string): string {
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
	execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
	mkdirSync(join(root, ".imm", "state"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: root });
	return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

function createBatchFixture(slug = "demo-init"): {
	root: string;
	head: string;
	observation: GithubInitiativeObservation;
} {
	const root = mkdtempSync(join(tmpdir(), "claude-batch-test-"));
	const head = initGitRepo(root);
	mkdirSync(join(root, "docs", "plans"), { recursive: true });

	// Child 1: routine
	const intent1 = {
		contract: "assurance_kernel/task_intent/v1",
		task_id: `${slug}-c1`,
		owner: "user",
		goal: "child 1",
		acceptance: [{ id: "acc-1", assertion: "c1 assertion", verification: "bun test" }],
		scope_hint: [`docs/plans/${slug}-c1.intent.json`],
		risk: "routine",
		revision: 1,
	};
	writeFileSync(join(root, "docs", "plans", `${slug}-c1.intent.json`), `${JSON.stringify(intent1, null, 2)}\n`);

	// Child 2: material, blocked by c1
	const intent2 = {
		contract: "assurance_kernel/task_intent/v1",
		task_id: `${slug}-c2`,
		owner: "user",
		goal: "child 2",
		acceptance: [{ id: "acc-2", assertion: "c2 assertion", verification: "bun test" }],
		scope_hint: [`docs/plans/${slug}-c2.intent.json`],
		risk: "material",
		revision: 1,
	};
	writeFileSync(join(root, "docs", "plans", `${slug}-c2.intent.json`), `${JSON.stringify(intent2, null, 2)}\n`);

	// Child 3: critical (must be excluded from batch)
	const intent3 = {
		contract: "assurance_kernel/task_intent/v1",
		task_id: `${slug}-c3`,
		owner: "user",
		goal: "child 3 critical",
		acceptance: [{ id: "acc-3", assertion: "c3 assertion", verification: "bun test" }],
		scope_hint: [`docs/plans/${slug}-c3.intent.json`],
		risk: "critical",
		revision: 1,
	};
	writeFileSync(join(root, "docs", "plans", `${slug}-c3.intent.json`), `${JSON.stringify(intent3, null, 2)}\n`);

	execFileSync("git", ["add", "docs/plans/"], { cwd: root });
	execFileSync("git", ["commit", "-q", "-m", "add child intents"], { cwd: root });
	const updatedHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

	const observation: GithubInitiativeObservation = {
		contract: "immune_brain/github_initiative_observation/v1",
		initiative_id: slug,
		issue_number: 100,
		tasks: [
			{ task_id: `${slug}-c1`, slice_id: "S1", issue_number: 101, blocked_by: [] },
			{ task_id: `${slug}-c2`, slice_id: "S2", issue_number: 102, blocked_by: [`${slug}-c1`] },
			{ task_id: `${slug}-c3`, slice_id: "S3", issue_number: 103, blocked_by: [] },
		],
	};

	return { root, head: updatedHead, observation };
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

describe("acc-claude-batch-gate", () => {
	it("start_unattended_batch joins PRIVILEGED_OPERATIONS and has destructiveHint annotation", () => {
		expect(PRIVILEGED_OPERATIONS).toContain("start_unattended_batch");
		const tools = listMcpTools();
		const batchTool = tools.find((t) => t.name === "start_unattended_batch");
		expect(batchTool).toBeDefined();
		expect(batchTool?.annotations).toEqual({ destructiveHint: true });
		expect(batchTool?.inputSchema.required).toEqual(["initiative_slug"]);
		expect(Object.keys(batchTool?.inputSchema.properties ?? {})).toEqual(["initiative_slug"]);
	});

	it("rejects on non-interactive Claude Code session with unsupported_host error code", async () => {
		const fixture = createBatchFixture("non-interactive");
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: false,
			readInitiative: async () => fixture.observation,
		});
		// Non-interactive handshake
		runtime.bindClientHandshake({
			version: "2.1.236",
			interactive: false,
			protocolVersion: "2025-06-18",
		});
		expect(runtime.sessionInteractive()).toBe(false);

		await expect(
			runtime.callTool("start_unattended_batch", { initiative_slug: "non-interactive" }),
		).rejects.toThrow("unsupported_host");
	});

	it("derives confirmation content from projectBatchPlan and Kernel facts, not model-supplied text", async () => {
		const fixture = createBatchFixture("content-derive");
		let capturedConfirmationInput: unknown = null;
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			readInitiative: async () => fixture.observation,
			requestConfirmation: async (input) => {
				capturedConfirmationInput = input;
				return { decision: "decline", requestId: "req-1" };
			},
		});
		runtime.bindClientHandshake({
			version: "2.1.236",
			interactive: true,
			protocolVersion: "2025-06-18",
		});

		const result = await runtime.callTool(
			"start_unattended_batch",
			{
				initiative_slug: "content-derive",
				model_fake_param: "attacker_attempt",
			},
			{ toolCallId: "toolu-batch-1" },
		);

		expect(result.state).toBe("rejected");
		expect(capturedConfirmationInput).not.toBeNull();
		const confInput = capturedConfirmationInput as Record<string, unknown>;
		expect(confInput.operation).toBe("start_unattended_batch");
		expect(confInput.initiativeSlug).toBe("content-derive");
		expect(typeof confInput.planDigest).toBe("string");
		expect(confInput.planDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

		// Verify batch details rendered through elicitationParams
		const params = elicitationParams(confInput as never);
		expect(params.message).toContain("Initiative: content-derive");
		expect(params.message).toContain("Batch branch: imm/content-derive");
		expect(params.message).toContain("Plan digest: sha256:");
		expect(params.message).toContain("Ordered children (2):");
		expect(params.message).toContain("content-derive-c1");
		expect(params.message).toContain("content-derive-c2");
		expect(params.message).toContain("Excluded children (1):");
		expect(params.message).toContain("content-derive-c3 (S3): critical");
		expect(params.message).toContain("Budget: max_children=");
		expect(params.message).toContain("Expires at:");
	});

	it("binds elicitation to plan_digest and rejects if plan changes before acceptance", async () => {
		const fixture = createBatchFixture("drift-reject");
		let confirmCount = 0;
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			readInitiative: async () => fixture.observation,
			requestConfirmation: async () => {
				confirmCount++;
				// Mutate intent on disk so that plan_digest drifts before accept settlement
				const c1Path = join(fixture.root, "docs", "plans", "drift-reject-c1.intent.json");
				const c1 = JSON.parse(readFileSync(c1Path, "utf8"));
				writeFileSync(c1Path, `${JSON.stringify({ ...c1, revision: 2 }, null, 2)}\n`);
				return { decision: "accept", requestId: "req-drift" };
			},
		});
		runtime.bindClientHandshake({
			version: "2.1.236",
			interactive: true,
			protocolVersion: "2025-06-18",
		});

		const result = await runtime.callTool(
			"start_unattended_batch",
			{ initiative_slug: "drift-reject" },
			{ toolCallId: "toolu-drift" },
		);

		expect(confirmCount).toBe(1);
		expect(result.state).toBe("rejected");
		expect(result.reason).toContain("batch plan changed after native confirmation");
		expect(result.recovery_action).toContain("retry through a fresh native gate");
	});

	it("on accept, issues exactly one Batch Authorization and calls startBatch", async () => {
		const fixture = createBatchFixture("accept-exec");
		let startBatchCalled = false;
		let lastCommit: string | null = null;
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			readInitiative: async () => fixture.observation,
			batchKernel: {
				enrollTask: async () => ({ record_revision: "rev-1" }),
				advanceTask: async () => ({ state: "completed" }),
				commitChild: async () => {
					writeFileSync(join(fixture.root, "dummy.txt"), `${Date.now()}`);
					execFileSync("git", ["add", "dummy.txt"], { cwd: fixture.root });
					execFileSync("git", ["commit", "-q", "-m", "child commit"], { cwd: fixture.root });
					const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
					lastCommit = commit;
					return { commit };
				},
				lookupBatchCommit: async () => (lastCommit ? { commit: lastCommit } : null),
			},
			requestConfirmation: async () => ({ decision: "accept", requestId: "req-accept" }),
		});
		runtime.bindClientHandshake({
			version: "2.1.236",
			interactive: true,
			protocolVersion: "2025-06-18",
		});

		const result = await runtime.callTool(
			"start_unattended_batch",
			{ initiative_slug: "accept-exec" },
			{ toolCallId: "toolu-accept" },
		);

		expect(result.state).toBe("started");
		expect(result.batch_id).toMatch(/^batch-accept-exec-\d+$/);
		expect(result.report).toBeDefined();
		expect(result.report.initiative_slug).toBe("accept-exec");
		expect(result.report.batch_state).toBe("completed");
	});
});

describe("acc-claude-batch-fail-closed", () => {
	it("decline produces zero Kernel writes, zero batch state, no new Git ref, and stable recovery", async () => {
		const fixture = createBatchFixture("decline-zero");
		const priorHead = fixture.head;
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			readInitiative: async () => fixture.observation,
			requestConfirmation: async () => ({ decision: "decline", requestId: "req-dec" }),
		});
		runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });

		const result = await runtime.callTool(
			"start_unattended_batch",
			{ initiative_slug: "decline-zero" },
			{ toolCallId: "toolu-dec" },
		);

		expect(result).toEqual({
			state: "rejected",
			reason: "native interaction declined",
			recovery_action: "wait for a fresh literal-user request",
		});

		// Zero writes verification
		expect(existsSync(join(fixture.root, ".imm", "state", "tasks"))).toBe(false);
		expect(existsSync(join(fixture.root, ".imm", "state", "batch"))).toBe(false);
		const currentHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
		expect(currentHead).toBe(priorHead);
		const branchCheck = execFileSync("git", ["branch", "--list", "imm/decline-zero"], { cwd: fixture.root, encoding: "utf8" }).trim();
		expect(branchCheck).toBe("");
	});

	it("cancel produces zero writes and cancelled state", async () => {
		const fixture = createBatchFixture("cancel-zero");
		const priorHead = fixture.head;
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			readInitiative: async () => fixture.observation,
			requestConfirmation: async () => ({ decision: "cancel", requestId: "req-can" }),
		});
		runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });

		const result = await runtime.callTool(
			"start_unattended_batch",
			{ initiative_slug: "cancel-zero" },
			{ toolCallId: "toolu-can" },
		);

		expect(result).toEqual({
			state: "cancelled",
			reason: "native interaction cancelled",
			recovery_action: "wait for a fresh literal-user request",
		});
		expect(existsSync(join(fixture.root, ".imm", "state", "tasks"))).toBe(false);
		expect(existsSync(join(fixture.root, ".imm", "state", "batch"))).toBe(false);
		const currentHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
		expect(currentHead).toBe(priorHead);
	});

	it("active workspace claim blocks batch with state: blocked and zero writes", async () => {
		const fixture = createBatchFixture("claim-block");
		// Create an active workspace claim
		writeFileSync(
			join(fixture.root, ".imm", "state", "workspace.json"),
			JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: "some-active-task" }),
		);
		let confirmationOpened = false;
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			readInitiative: async () => fixture.observation,
			requestConfirmation: async () => {
				confirmationOpened = true;
				return { decision: "accept", requestId: "req-claim" };
			},
		});
		runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });

		const result = await runtime.callTool(
			"start_unattended_batch",
			{ initiative_slug: "claim-block" },
			{ toolCallId: "toolu-claim" },
		);

		expect(confirmationOpened).toBe(false);
		expect(result.state).toBe("blocked");
		expect(result.reason).toContain("some-active-task");
		expect(result.recovery_action).toContain("resolve or stop the active task before starting a batch");
		expect(existsSync(join(fixture.root, ".imm", "state", "batch"))).toBe(false);
	});

	it("failing branch preflight rejects with state: rejected and zero writes", async () => {
		const fixture = createBatchFixture("preflight-fail");
		// Create the conflicting branch in advance
		execFileSync("git", ["branch", "imm/preflight-fail"], { cwd: fixture.root });
		let confirmationOpened = false;
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			readInitiative: async () => fixture.observation,
			requestConfirmation: async () => {
				confirmationOpened = true;
				return { decision: "accept", requestId: "req-pf" };
			},
		});
		runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });

		const result = await runtime.callTool(
			"start_unattended_batch",
			{ initiative_slug: "preflight-fail" },
			{ toolCallId: "toolu-pf" },
		);

		expect(confirmationOpened).toBe(false);
		expect(result.state).toBe("rejected");
		expect(result.reason).toContain("branch preflight failed");
		expect(result.recovery_action).toContain("delete or rename the conflicting branch");
		expect(existsSync(join(fixture.root, ".imm", "state", "batch"))).toBe(false);
	});

	it("empty enrollable child set rejects with state: rejected and zero writes", async () => {
		const fixture = createBatchFixture("empty-enrollable");
		// All tasks are critical or non-enrollable
		const observation: GithubInitiativeObservation = {
			contract: "immune_brain/github_initiative_observation/v1",
			initiative_id: "empty-enrollable",
			issue_number: 101,
			tasks: [
				{ task_id: "empty-enrollable-c3", slice_id: "S3", issue_number: 103, blocked_by: [] }, // c3 is critical
			],
		};
		let confirmationOpened = false;
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			readInitiative: async () => observation,
			requestConfirmation: async () => {
				confirmationOpened = true;
				return { decision: "accept", requestId: "req-empty" };
			},
		});
		runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });

		const result = await runtime.callTool(
			"start_unattended_batch",
			{ initiative_slug: "empty-enrollable" },
			{ toolCallId: "toolu-empty" },
		);

		expect(confirmationOpened).toBe(false);
		expect(result.state).toBe("rejected");
		expect(result.reason).toContain("empty enrollable child set");
		expect(result.recovery_action).toContain("ensure the initiative has uncompleted, non-critical child tasks");
		expect(existsSync(join(fixture.root, ".imm", "state", "batch"))).toBe(false);
	});

	it("status operation stays usable in every outcome (started, rejected, cancelled, blocked)", async () => {
		const fixture = createBatchFixture("status-usable");
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			readInitiative: async () => fixture.observation,
			requestConfirmation: async () => ({ decision: "decline", requestId: "req-status" }),
		});
		runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });

		// 1. Rejected outcome
		const rejected = await runtime.callTool(
			"start_unattended_batch",
			{ initiative_slug: "status-usable" },
			{ toolCallId: "toolu-st-1" },
		);
		expect(rejected.state).toBe("rejected");

		// Status tool call on child task succeeds and is unaffected
		const statusResult = await runtime.callTool("status", { task_id: "status-usable-c1" });
		expect(statusResult.plugin_version).toBeDefined();
		expect(statusResult.projection).toBeDefined();
		expect(statusResult.projection.lifecycle).toBe("");
		expect(statusResult.projection.next_obligation).toBe("none");
	});

	it("wire JSON-RPC tools/call enforces toolUseId correlation on start_unattended_batch", async () => {
		const fixture = createBatchFixture("wire-tool");
		const input = new PassThrough();
		const output = new PassThrough();
		const next = jsonLineReader(output);
		const server = serveStdio({
			input,
			output,
			runtime: createMcpRuntime({
				cwd: fixture.root,
				env: ENV,
				readInitiative: async () => fixture.observation,
			}),
			exit: () => undefined,
		});
		const send = (message: unknown) => input.write(`${JSON.stringify(message)}\n`);
		send({
			jsonrpc: "2.0",
			id: "init",
			method: "initialize",
			params: {
				protocolVersion: "2025-06-18",
				clientInfo: { name: "claude-code", version: "2.1.236" },
				capabilities: { elicitation: {} },
			},
		});
		await next();

		// Call without claudecode/toolUseId metadata
		send({
			jsonrpc: "2.0",
			id: "outer",
			method: "tools/call",
			params: { name: "start_unattended_batch", arguments: { initiative_slug: "wire-tool" } },
		});
		const result = await next();
		input.end();
		await server;

		expect(JSON.stringify(result)).toContain("correlation_missing");
	});

	it("review-1: cancellation during revalidation yields cancelled state and zero writes", async () => {
		const fixture = createBatchFixture("cancel-reval");
		const controller = new AbortController();
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			readInitiative: async () => fixture.observation,
			requestConfirmation: async () => {
				// Abort the outer signal during the revalidation window
				controller.abort();
				return { decision: "accept", requestId: "req-cancel-reval" };
			},
		});
		runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });

		const result = await runtime.callTool(
			"start_unattended_batch",
			{ initiative_slug: "cancel-reval" },
			{ toolCallId: "toolu-cancel-reval", signal: controller.signal },
		);

		expect(result).toEqual({
			state: "cancelled",
			reason: "user cancelled before batch execution",
			recovery_action: "wait for a fresh literal-user request",
		});
		expect(existsSync(join(fixture.root, ".imm", "state", "batch"))).toBe(false);
	});

	it("review-2: children with already_settled prerequisites start without digest mismatch", async () => {
		const fixture = createBatchFixture("settled-prereq");
		// Create tombstone for c1 so it is already settled and committed
		mkdirSync(join(fixture.root, ".imm", "audit", "settled-prereq-c1"), { recursive: true });
		writeFileSync(
			join(fixture.root, ".imm", "audit", "settled-prereq-c1", "terminal-proof.json"),
			JSON.stringify({
				contract: "assurance_kernel/task_tombstone/v2",
				task_id: "settled-prereq-c1",
				lifecycle_status: "terminal",
				terminal_lifecycle: "done",
				terminal_event_id: "complete:settled:2099-01-01T00:00:00.000Z",
				final_record_hash: `sha256:${"b".repeat(64)}`,
				terminalized_at: "2099-01-01T00:00:00.000Z",
			}, null, 2) + "\n",
		);
		execFileSync("git", ["add", ".imm/audit/"], { cwd: fixture.root });
		execFileSync("git", ["commit", "-q", "-m", "audit c1"], { cwd: fixture.root });

		let lastCommit: string | null = null;
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			readInitiative: async () => fixture.observation,
			batchKernel: {
				enrollTask: async () => ({ record_revision: "rev-settled" }),
				advanceTask: async () => ({ state: "completed" }),
				commitChild: async () => {
					writeFileSync(join(fixture.root, "dummy.txt"), `${Date.now()}`);
					execFileSync("git", ["add", "dummy.txt"], { cwd: fixture.root });
					execFileSync("git", ["commit", "-q", "-m", "child commit"], { cwd: fixture.root });
					const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
					lastCommit = commit;
					return { commit };
				},
				lookupBatchCommit: async () => (lastCommit ? { commit: lastCommit } : null),
			},
			requestConfirmation: async () => ({ decision: "accept", requestId: "req-settled" }),
		});
		runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });

		const result = await runtime.callTool(
			"start_unattended_batch",
			{ initiative_slug: "settled-prereq" },
			{ toolCallId: "toolu-settled" },
		);

		expect(result.state).toBe("started");
		expect(result.report).toBeDefined();
		expect(result.report.batch_state).not.toBe("rejected");
	});

	it("review-3: startBatch rejection maps to rejected result with same-Host recovery", async () => {
		const fixture = createBatchFixture("report-reject");
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			readInitiative: async () => fixture.observation,
			batchGit: {
				// Failing preflight inside startBatch
				preflight: () => ({ ok: false, reason: "batch_branch_exists", message: "branch refs/heads/imm/report-reject already exists" }),
				commitChild: async () => ({ commit: "c".repeat(40) }),
				lookupBatchCommit: async () => null,
			},
			requestConfirmation: async () => ({ decision: "accept", requestId: "req-reject-map" }),
		});
		runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });

		const result = await runtime.callTool(
			"start_unattended_batch",
			{ initiative_slug: "report-reject" },
			{ toolCallId: "toolu-reject-map" },
		);

		expect(result.state).toBe("rejected");
		expect(result.reason).toContain("batch_branch_exists");
		expect(result.recovery_action).toBe("delete or rename the conflicting branch, or commit working changes and retry in the current Host");
	});

	it("review-4: missing or only replayed elicitation evidence times out with bounded rejection", async () => {
		const fixture = createBatchFixture("timeout-test");
		const input = new PassThrough();
		const output = new PassThrough();
		const next = jsonLineReader(output);
		const server = serveStdio({
			input,
			output,
			runtime: createMcpRuntime({
				cwd: fixture.root,
				env: { ...ENV, IMMUNE_BRAIN_BATCH_TIMEOUT_MS: "50" }, // 50ms bounded timeout
				readInitiative: async () => fixture.observation,
			}),
			exit: () => undefined,
		});
		const send = (message: unknown) => input.write(`${JSON.stringify(message)}\n`);
		send({
			jsonrpc: "2.0",
			id: "init",
			method: "initialize",
			params: {
				protocolVersion: "2025-06-18",
				clientInfo: { name: "claude-code", version: "2.1.236" },
				capabilities: { elicitation: {} },
			},
		});
		await next();

		send({
			jsonrpc: "2.0",
			id: "outer-timeout",
			method: "tools/call",
			params: {
				name: "start_unattended_batch",
				arguments: { initiative_slug: "timeout-test" },
				_meta: { "claudecode/toolUseId": "toolu-timeout" },
			},
		});
		const elicitation = await next();
		// Replay an old/unknown requestId instead of answering the live elicitation
		send({
			jsonrpc: "2.0",
			id: "old-request-id",
			result: { action: "accept" },
		});

		// Wait for timeout resolution
		const result = await next();
		input.end();
		await server;

		expect(JSON.stringify(result)).toContain("native confirmation timed out");
		expect(JSON.stringify(result)).toContain("rejected");
	});

	it("review-batch-active-claim-race: active claim appearing during revalidation blocks execution with zero writes", async () => {
		const fixture = createBatchFixture("claim-race");
		let readCount = 0;
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			readInitiative: async () => {
				readCount++;
				if (readCount === 2) {
					// Another request claimed workspace during this re-read!
					writeFileSync(
						join(fixture.root, ".imm", "state", "workspace.json"),
						JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: "concurrent-task" }),
					);
				}
				return fixture.observation;
			},
			requestConfirmation: async () => ({ decision: "accept", requestId: "req-race" }),
		});
		runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });

		const result = await runtime.callTool(
			"start_unattended_batch",
			{ initiative_slug: "claim-race" },
			{ toolCallId: "toolu-race" },
		);

		expect(result.state).toBe("blocked");
		expect(result.reason).toContain("concurrent-task");
		expect(result.recovery_action).toContain("resolve or stop the active task");
		// Zero writes & no branch created
		expect(existsSync(join(fixture.root, ".imm", "state", "batch"))).toBe(false);
		const branchCheck = execFileSync("git", ["branch", "--list", "imm/claim-race"], { cwd: fixture.root, encoding: "utf8" }).trim();
		expect(branchCheck).toBe("");
	});

	it("review-batch-enrollment-context: real Kernel enrollment derives batch context and consumes child slot", async () => {
		const fixture = createBatchFixture("real-enroll");
		let lastCommit: string | null = null;
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			readInitiative: async () => fixture.observation,
			batchKernel: {
				// DO NOT override enrollTask — exercise the real Kernel enrollment in createBatchKernelPort!
				advanceTask: async () => {
					// Clear the task's active claim upon completion so the next child can enroll cleanly
					writeFileSync(
						join(fixture.root, ".imm", "state", "workspace.json"),
						JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }),
					);
					const claimPath = join(fixture.root, ".imm", "state", "active-claim.json");
					if (existsSync(claimPath)) rmSync(claimPath, { force: true });
					return { state: "completed" };
				},
				commitChild: async () => {
					writeFileSync(join(fixture.root, "dummy.txt"), `${Date.now()}`);
					execFileSync("git", ["add", "dummy.txt"], { cwd: fixture.root });
					execFileSync("git", ["commit", "-q", "-m", "child commit"], { cwd: fixture.root });
					const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
					lastCommit = commit;
					return { commit };
				},
				lookupBatchCommit: async () => (lastCommit ? { commit: lastCommit } : null),
			},
			requestConfirmation: async () => ({ decision: "accept", requestId: "req-real-enroll" }),
		});
		runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });

		const result = await runtime.callTool(
			"start_unattended_batch",
			{ initiative_slug: "real-enroll" },
			{ toolCallId: "toolu-real-enroll" },
		);

		expect(result.state).toBe("started");
		expect(result.report).toBeDefined();
		expect(result.report.batch_state).toBe("completed");
		expect(result.report.commits.length).toBe(2);
		expect(result.report.children.every((c: { state: string }) => c.state === "committed")).toBe(true);
	});

	it("review-batch-head-revalidation-window: HEAD moving during revalidation rejects execution with zero writes", async () => {
		const fixture = createBatchFixture("head-race");
		let readCount = 0;
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			readInitiative: async () => {
				readCount++;
				if (readCount === 2) {
					// An external commit moved HEAD without modifying the intent sidecars!
					writeFileSync(join(fixture.root, "unrelated.txt"), "external commit");
					execFileSync("git", ["add", "unrelated.txt"], { cwd: fixture.root });
					execFileSync("git", ["commit", "-q", "-m", "external commit"], { cwd: fixture.root });
				}
				return fixture.observation;
			},
			requestConfirmation: async () => ({ decision: "accept", requestId: "req-head-race" }),
		});
		runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });

		const result = await runtime.callTool(
			"start_unattended_batch",
			{ initiative_slug: "head-race" },
			{ toolCallId: "toolu-head-race" },
		);

		expect(result.state).toBe("rejected");
		expect(result.reason).toContain("Git HEAD moved after native confirmation");
		expect(result.recovery_action).toBe("review the current workspace and retry through a fresh native gate in the current Host");
		expect(existsSync(join(fixture.root, ".imm", "state", "batch"))).toBe(false);
		const branchCheck = execFileSync("git", ["branch", "--list", "imm/head-race"], { cwd: fixture.root, encoding: "utf8" }).trim();
		expect(branchCheck).toBe("");
	});
});
