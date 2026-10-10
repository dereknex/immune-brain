import { afterAll, describe, expect, it, mock, spyOn } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
	createMcpRuntime as createMcpRuntimeOnce,
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
import { readTaskRecordRaw } from "../plugins/immune-brain/runtime/kernel/storage";
// Delivery QA has no node_modules; use host seams only when the real package is absent.
try { await import("typebox"); } catch {
	const optional = Symbol("optional");
	// Reuse the schema constructors from pi-canary-work-extension's delivery seam:
	// the foreground Review regression also loads imm-canary-work's schemas.
	mock.module("typebox", () => ({ Type: {
		Array: (items: object) => ({ type: "array", items }),
		Boolean: () => ({ type: "boolean" }),
		Literal: (value: unknown) => ({ const: value }),
		Null: () => ({ type: "null" }),
		Number: (options: object = {}) => ({ type: "number", ...options }),
		Object: (properties: Record<string, any>, options: object = {}) => ({
			type: "object", properties,
			required: Object.entries(properties).filter(([, value]) => !value[optional]).map(([key]) => key),
			...options,
		}),
		Optional: (schema: Record<string, unknown>) => ({ ...schema, [optional]: true }),
		Record: (_key: object, value: object) => ({ type: "object", additionalProperties: value }),
		String: (options: object = {}) => ({ type: "string", ...options }),
		Union: (anyOf: object[]) => ({ anyOf }),
		Unknown: () => ({}),
	} }));
}
try { await import("@earendil-works/pi-coding-agent"); } catch {
	class DynamicBorder {
		constructor(private style: (text: string) => string) {}
		render(width: number) { return [this.style("─".repeat(Math.max(0, width)))]; }
	}
	mock.module("@earendil-works/pi-coding-agent", () => ({ DynamicBorder }));
}
try { await import("@earendil-works/pi-tui"); } catch {
	class Text {
		constructor(private text: string) {}
		setText(text: string) { this.text = text; }
		render() { return this.text.split("\n"); }
		invalidate() {}
	}
	class Container {
		private children: Array<{ render(width: number): string[] }> = [];
		addChild(child: { render(width: number): string[] }) { this.children.push(child); }
		render(width: number) { return this.children.flatMap((child) => child.render(width)); }
		invalidate() {}
	}
	class SelectList {
		onSelect?: (item: any) => void;
		onCancel?: () => void;
		private selected = 0;
		constructor(private items: any[]) {}
		render() { return this.items.map((item, index) => `${index === this.selected ? "> " : "  "}${item.label}`); }
		handleInput(input: string) {
			if (input === "\u001b[B") this.selected = Math.min(this.items.length - 1, this.selected + 1);
			else if (input === "\u001b[A") this.selected = Math.max(0, this.selected - 1);
			else if (input === "\r") this.onSelect?.(this.items[this.selected]);
			else if (input === "\u001b") this.onCancel?.();
		}
	}
	mock.module("@earendil-works/pi-tui", () => ({
		Container, SelectList, Text,
		sliceByColumn: (text: string, start: number, width?: number) => text.slice(start, width === undefined ? undefined : start + width),
		truncateToWidth: (text: string, width: number, marker = "") => text.length <= width ? text : `${text.slice(0, Math.max(0, width - marker.length))}${marker}`,
		visibleWidth: (text: string) => text.length,
	}));
}
afterAll(() => mock.restore());

const { executePiUnattendedBatch: executePiBatchOnce } = await import("../plugins/immune-brain/.pi-extension/imm-unattended-batch");
import { projectAssurance } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import { diffSnapshotOf } from "../plugins/immune-brain/runtime/claude/kernel_ports";

// Scripted authority fixtures have an explicit Parent-ready phase; the real
// two-child regression below does not use these scripted Assurance wrappers.
function parentReadyProject(kernel: Partial<BatchRunnerKernelPort>, ready: Set<string>) {
	const project = kernel.projectTask ?? ((root: string, task: string) => projectAssurance(root, task, diffSnapshotOf));
	return async (root: string, task: string) => {
		const fresh = await project(root, task);
		return ready.has(task) && fresh.claim?.task_id === task
			? { ...fresh, projection: { ...fresh.projection, artifact_state: "frozen" } } : fresh;
	};
}
function createMcpRuntime(options: Parameters<typeof createMcpRuntimeOnce>[0]) {
	if (!options.batchKernel?.advanceTask || options.batchKernel.enrollTask) return createMcpRuntimeOnce(options);
	const ready = new Set<string>();
	const client = createMcpRuntimeOnce({ ...options, batchKernel: { ...options.batchKernel, projectTask: parentReadyProject(options.batchKernel, ready) } });
	const call = client.callTool.bind(client);
	client.callTool = async (...args: Parameters<typeof call>) => {
		let result = await call(...args);
		while (args[0] === "start_unattended_batch" && result.state === "started" && result.report.handoff) {
			expect(result.report.batch_state).toBe("running");
			ready.add(result.report.handoff.task_id);
			result = await call(...args);
		}
		return result;
	};
	return client;
}
async function executePiUnattendedBatch(options: Parameters<typeof executePiBatchOnce>[0]) {
	if (!options.batchKernel?.advanceTask || options.batchKernel.enrollTask) return executePiBatchOnce(options);
	const ready = new Set<string>();
	const staged = { ...options, batchKernel: { ...options.batchKernel, projectTask: parentReadyProject(options.batchKernel, ready) } };
	let result = await executePiBatchOnce(staged);
	while (result.state === "started" && result.report.handoff) {
		ready.add(result.report.handoff.task_id);
		result = await executePiBatchOnce(staged);
	}
	return result;
}

import type { BatchRunnerKernelPort } from "../plugins/immune-brain/runtime/unattended/batch_runner";
import { createDefaultBatchGitPort, runBatchGitPreflight } from "../plugins/immune-brain/runtime/unattended/batch_git";
import { readTaskTombstone } from "../plugins/immune-brain/runtime/kernel/backend_claim";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";
import { withKernelTransaction } from "../plugins/immune-brain/runtime/kernel/sqlite_store";

/** Claim the workspace for a fixture task through the store. */
function claimWorkspaceForTest(root: string, taskId: string): void {
	const intent = {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		goal: "drift fixture",
		acceptance: [{ id: "A1", assertion: "a1", verification: "bun test tests/x.test.ts" }],
		scope_hint: ["docs/plans"],
		risk: "routine" as const,
		revision: 1,
		owner: "user",
	};
	seedKernelRunForTest(root, {
		task_id: taskId,
		record: {
			contract: "assurance_kernel/task_record/v4",
			task_id: taskId,
			intent_snapshot: intent,
			intent_ref: {
				path: `docs/plans/${taskId}.intent.json`,
				content_hash: canonicalIntentHash(parseTaskIntentV1(intent)),
			},
			lifecycle: "active",
			artifact_state: "active",
			baseline: `sha256:${"a".repeat(64)}`,
			git_base_head: "a".repeat(40),
			attestations: [],
			findings: [],
			history: [],
		},
	});
}

/** Release the workspace: the owner settles and no active run remains. */
function releaseWorkspaceForTest(root: string): void {
	withKernelTransaction(root, (db) => {
		db.prepare("UPDATE workspace SET current_run_id = NULL WHERE id = 1").run();
		db.prepare("DELETE FROM runs WHERE state = 'active'").run();
	});
}

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
		scope_hint: [`docs/plans/${slug}-c1.intent.json`, `docs/specs/${slug}-c1.spec.md`, `docs/specs/archive/${slug}-c1.spec.md`],
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
		scope_hint: [`docs/plans/${slug}-c2.intent.json`, `docs/specs/${slug}-c2.spec.md`, `docs/specs/archive/${slug}-c2.spec.md`],
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
		scope_hint: [`docs/plans/${slug}-c3.intent.json`, `docs/specs/${slug}-c3.spec.md`, `docs/specs/archive/${slug}-c3.spec.md`],
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

type RenewalGate = (facts: { summary: string; signal?: AbortSignal }) => Promise<"accept" | "decline" | "cancel">;

for (const host of ["Pi", "Claude"] as const) {
	describe(`BER-S0 ${host} parked renewal`, () => {
		/** `legacyExpiry` writes the retired expiry fields, already in the past, into the parked record. */
		async function parked(suffix: string, legacyExpiry = true) {
			const slug = `ber-${host.toLowerCase()}-${suffix}`;
			const fixture = createBatchFixture(slug);
			let gate: RenewalGate = async () => "accept";
			let advances = 0;
			const commitsByTask = new Map<string, string>();
			const batchKernel = {
				advanceTask: async () => {
					if (++advances === 1) {
						releaseWorkspaceForTest(fixture.root);
						return { state: "completed" as const };
					}
					return { state: "review_ready" as const, operation_id: "op-renew", agent_params: { prompt: "review" } as never };
				},
			};
			const batchGit = {
				...createDefaultBatchGitPort(),
				commitChild: async (_root: string, taskId: string) => {
					const path = `docs/specs/${slug}-c1.spec.md`;
					mkdirSync(join(fixture.root, "docs", "specs"), { recursive: true });
					writeFileSync(join(fixture.root, path), "# Completed fixture\n");
					execFileSync("git", ["add", path], { cwd: fixture.root });
					execFileSync("git", ["commit", "-q", "-m", "child progress"], { cwd: fixture.root });
					const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
					commitsByTask.set(taskId, commit);
					return { commit };
				},
				lookupBatchCommit: async (_root: string, taskId: string) => (commitsByTask.has(taskId) ? { commit: commitsByTask.get(taskId)! } : null),
			};
			const runtime = createMcpRuntime({
				cwd: fixture.root, env: ENV, interactive: true,
				readInitiative: async () => fixture.observation, batchKernel, batchGit,
				requestConfirmation: async (request) => ({
					decision: await gate({ summary: JSON.stringify(request.batchDetails!.budget), signal: request.signal }),
					requestId: "req-renew",
				}),
			});
			runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			const run = async (confirm: RenewalGate = async () => "accept") => {
				gate = confirm;
				if (host === "Claude") return runtime.callTool("start_unattended_batch", { initiative_slug: slug }, { toolCallId: "renew" });
				return executePiUnattendedBatch({
					root: fixture.root, initiativeSlug: slug,
					readInitiative: async () => fixture.observation, batchKernel, batchGit,
					confirmBatch: async (details) => gate({ summary: details.summary, signal: details.signal }),
				});
			};
			try {
				const first = await run();
				expect(first.state).toBe("started");
				const path = join(fixture.root, ".imm", "state", "batches", `${first.batch_id}.json`);
				const state = JSON.parse(readFileSync(path, "utf8"));
				expect(state.children[0].state).toBe("committed");
				expect(state.commits).toHaveLength(1);
				state.batch_state = "needs_human";
				state.children[1].state = "needs_human";
				state.children[1].reason = "foreground review parked";
				state.consecutive_qa_failures = 1;
				expect(state).not.toHaveProperty("authorization_expires_at");
				expect(state.budget).not.toHaveProperty("deadline_at");
				if (legacyExpiry) {
					const past = new Date(Date.parse(state.confirmation_time) + 1).toISOString();
					expect(Date.parse(past)).toBeLessThan(Date.now());
					state.budget.deadline_at = past;
					state.authorization_expires_at = past;
				}
				writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
				return { ...fixture, slug, path, state, run, advances: () => advances };
			} catch (error) {
				rmSync(fixture.root, { recursive: true, force: true });
				throw error;
			}
		}

		it.each([true, false])("confirms and resumes the same lineage without erasing progress or counters (retired expiry fields: %p)", async (legacyExpiry) => {
			const fixture = await parked(legacyExpiry ? "renew" : "renew-clean", legacyExpiry);
			try {
				let confirmedAt = "";
				let shown = "";
				const result = await fixture.run(async (facts) => {
					shown = facts.summary;
					confirmedAt = new Date().toISOString();
					return "accept";
				});
				expect(result.state).toBe("started");
				expect(result.batch_id).toBe(fixture.state.batch_id);
				// The gate shows only the bounds that still exist.
				expect(shown).toContain("max_children");
				expect(shown).not.toMatch(/deadline|expires/i);
				const state = JSON.parse(readFileSync(fixture.path, "utf8"));
				expect(state.confirmation_time >= confirmedAt).toBe(true);
				expect(state).not.toHaveProperty("authorization_expires_at");
				expect(state.budget).toEqual({
					max_children: fixture.state.budget.max_children,
					qa_failure_limit: fixture.state.budget.qa_failure_limit,
				});
				for (const key of ["batch_id", "branch", "plan_digest", "base_head", "commits", "consecutive_qa_failures"])
					expect(state[key]).toEqual(fixture.state[key]);
				expect(state.children[0]).toEqual(fixture.state.children[0]);
				expect(state.children[1].state).toBe("enrolled");
				expect(fixture.advances()).toBe(3);
			} finally { rmSync(fixture.root, { recursive: true, force: true }); }
		});

		it.each(["decline", "cancel", "head-drift", "branch-drift", "plan-drift", "claim-drift", "budget-drift"])("%s rejects renewal without writing batch state", async (failure) => {
			const fixture = await parked(failure);
			const before = readFileSync(fixture.path, "utf8");
			const recordRevision = readTaskRecordRaw(fixture.root, `${fixture.slug}-c2`).revision;
			try {
				const result = await fixture.run(async () => {
					if (failure === "decline" || failure === "cancel") return failure;
					if (failure === "head-drift") execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "external drift"], { cwd: fixture.root });
					if (failure === "branch-drift") execFileSync("git", ["checkout", "-q", "-b", "foreign"], { cwd: fixture.root });
					if (failure === "plan-drift") {
						const path = join(fixture.root, "docs", "plans", `${fixture.slug}-c1.intent.json`);
						const intent = JSON.parse(readFileSync(path, "utf8"));
						intent.revision++;
						writeFileSync(path, `${JSON.stringify(intent, null, 2)}\n`);
					}
					if (failure === "claim-drift") claimWorkspaceForTest(fixture.root, "foreign-claim");
					if (failure === "budget-drift") {
						const state = JSON.parse(before);
						state.budget.qa_failure_limit++;
						writeFileSync(fixture.path, `${JSON.stringify(state, null, 2)}\n`);
					}
					return "accept";
				});
				expect(["rejected", "cancelled", "blocked"]).toContain(result.state);
				const expected = failure === "budget-drift" ? { ...JSON.parse(before), budget: { ...fixture.state.budget, qa_failure_limit: fixture.state.budget.qa_failure_limit + 1 } } : JSON.parse(before);
				expect(JSON.parse(readFileSync(fixture.path, "utf8"))).toEqual(expected);
				expect(readTaskRecordRaw(fixture.root, `${fixture.slug}-c2`).revision).toBe(recordRevision);
				expect(existsSync(fixture.path.replace(/\.json$/, ".report.json"))).toBe(false);
				expect(fixture.advances()).toBe(2);
			} finally {
				rmSync(fixture.root, { recursive: true, force: true });
			}
		});

		it.each(["deadline", "expiry"])("an unparseable retired %s field is ignored like an absent one", async (field) => {
			const fixture = await parked(`invalid-${field}`);
			try {
				const state = fixture.state;
				if (field === "deadline") state.budget.deadline_at = "not-a-time";
				else state.authorization_expires_at = "not-a-time";
				writeFileSync(fixture.path, `${JSON.stringify(state, null, 2)}\n`);
				const before = readFileSync(fixture.path, "utf8");
				let gates = 0;
				const result = await fixture.run(async () => { gates++; return "decline"; });
				// The parked record still loads and still asks the user; nothing reads the field.
				expect(gates).toBe(1);
				expect(result.state).toBe("rejected");
				expect(readFileSync(fixture.path, "utf8")).toBe(before);
			} finally { rmSync(fixture.root, { recursive: true, force: true }); }
		});
	});
}

describe("batch foreground Executor integration", () => {
	for (const host of ["claude", "pi"] as const) it(`${host}: implements two children, runs real QA and Review, then commits each once`, async () => {
		const slug = `foreground-${host}`;
		const fixture = createBatchFixture(slug);
		const outputCanary = "s2-verifier-raw-content-canary";
		writeFileSync(join(fixture.root, "verify.ts"), `import { strict as assert } from "node:assert"; const actual = await Bun.file(process.argv[2]).text(); if (actual !== "implemented") console.error(${JSON.stringify(outputCanary)}); assert.equal(actual, "implemented");\n`);
		writeFileSync(join(fixture.root, "prepare.ts"), `if (await Bun.file(process.argv[2]).text() === "environment-down") { console.error(${JSON.stringify(outputCanary)}); process.exit(1); }\n`);
		for (const n of [1, 2]) {
			const path = join(fixture.root, `docs/plans/${slug}-c${n}.intent.json`);
			const intent = JSON.parse(readFileSync(path, "utf8"));
			intent.risk = "material";
			intent.scope_hint = [`docs/plans/${slug}-c${n}.intent.json`, "verify.ts", "prepare.ts", `impl-${n}.txt`];
			intent.acceptance[0].verification = JSON.stringify({
				contract: "assurance_kernel/verification_descriptor/v2",
				command: { executable: "bun", argv: ["verify.ts", `impl-${n}.txt`], cwd: ".", timeout_ms: 10000, max_output_bytes: 8192 },
				environment: { prepare: { executable: "bun", argv: ["prepare.ts", `impl-${n}.txt`], cwd: ".", timeout_ms: 10000, max_output_bytes: 8192 }, writable_paths: [] },
			});
			writeFileSync(path, `${JSON.stringify(intent, null, 2)}\n`);
		}
		execFileSync("git", ["add", "-A"], { cwd: fixture.root });
		execFileSync("git", ["commit", "-qm", "material two-child fixture"], { cwd: fixture.root });
		let confirmations = 0;
		const client = createMcpRuntimeOnce({ cwd: fixture.root, env: ENV, interactive: true,
			readInitiative: async () => fixture.observation,
			requestConfirmation: async () => ({ decision: "accept", requestId: `real-${++confirmations}` }),
		});
		client.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
		const start = async (): Promise<any> => host === "claude"
			? client.callTool("start_unattended_batch", { initiative_slug: slug })
			: executePiBatchOnce({ root: fixture.root, initiativeSlug: slug, readInitiative: async () => fixture.observation,
				confirmBatch: async () => { confirmations++; return "accept"; } });
		const { getSharedPiProgression } = await import("../plugins/immune-brain/.pi-extension/imm-canary-work");
		const { createPiAssuranceProgressionPorts } = await import("../plugins/immune-brain/.pi-extension/imm-canary-work");
		const { REVIEWER_AGENT, AGENT_TOOL } = await import("../plugins/immune-brain/runtime/claude/review_host");
		const progression = host === "pi" ? await getSharedPiProgression() : client.runtime.coordinator;
		try {
			let result = await start();
			const batchId = result.batch_id;
			for (const n of [1, 2]) {
				const task = `${slug}-c${n}`;
				expect(result.state).toBe("started");
				expect(result.report.batch_state).toBe("running");
				expect(result.report.handoff).toMatchObject({ role: "executor", task_id: task });
				expect(readTaskRecordRaw(fixture.root, task).record?.attestations).toEqual([]);
				expect(existsSync(join(fixture.root, `impl-${n}.txt`))).toBe(false);
				const statePath = join(fixture.root, `.imm/state/batches/${batchId}.json`);
				const bytes = readFileSync(statePath, "utf8");
				result = await start(); // Simulate returning after Enrollment without implementation.
				expect(result.report.handoff.task_id).toBe(task);
				expect(readFileSync(statePath, "utf8")).toBe(bytes);
				expect(readTaskRecordRaw(fixture.root, task).record?.attestations).toEqual([]);
				expect(confirmations).toBe(1);
				if (n === 1) {
					writeFileSync(join(fixture.root, "impl-1.txt"), "environment-down");
					execFileSync("git", ["add", "impl-1.txt"], { cwd: fixture.root });
					const failedEnvironment: any = host === "claude" ? await client.callTool("advance_assurance", { task_id: task })
						: await progression.advance(task, { cwd: fixture.root });
					expect(failedEnvironment).toMatchObject({ state: "failed", recovery: { category: "environment", task_id: task, acceptance_ids: ["acc-1"], finding_ids: [], next_obligation: "run_qa" },
						diagnostics: [{ stage: "prepare", outcome: "nonzero_exit", descriptor_ref: "acceptance/0/verification/environment/prepare" }] });
					expect(JSON.stringify(failedEnvironment)).not.toContain(outputCanary);
					const environmentRevision = readTaskRecordRaw(fixture.root, task).revision;
					for (let retry = 0; retry < 2; retry++) {
						const pending = await start();
						expect(pending.report.handoff.next_obligation).toBe("run_qa");
						expect(pending.report.batch_state).toBe("running");
						expect(readTaskRecordRaw(fixture.root, task).revision).toBe(environmentRevision);
						expect(readTaskRecordRaw(fixture.root, task).record!.findings).toEqual([]);
						expect(readTaskRecordRaw(fixture.root, task).record!.attestations).toEqual([]);
						expect(JSON.parse(readFileSync(statePath, "utf8")).consecutive_qa_failures).toBe(0);
						expect(confirmations).toBe(1);
					}
					writeFileSync(join(fixture.root, "impl-1.txt"), "incorrect");
					execFileSync("git", ["add", "impl-1.txt"], { cwd: fixture.root });
					expect((await progression.advance(task, { cwd: fixture.root })).state).toBe("rework");
					const repair = await start();
					expect(repair.report.handoff).toMatchObject({ role: "executor", task_id: task, next_obligation: "resolve_findings" });
					expect(repair.report.batch_state).toBe("running");
					expect(JSON.parse(readFileSync(statePath, "utf8")).consecutive_qa_failures).toBe(1);
					const parkedBytes = readFileSync(statePath, "utf8");
					expect((await start()).report.handoff.task_id).toBe(task);
					expect(readFileSync(statePath, "utf8")).toBe(parkedBytes);
					writeFileSync(join(fixture.root, "impl-1.txt"), "implemented");
					execFileSync("git", ["add", "impl-1.txt"], { cwd: fixture.root });
					const finding = readTaskRecordRaw(fixture.root, task).record!.findings.find((f) => f.kind === "blocking" && f.status === "open")!;
					expect(repair.report.recovery).toMatchObject({ category: "repair", acceptance_ids: ["acc-1"], finding_ids: [finding.id], next_obligation: "resolve_findings" });
					expect(JSON.stringify({ repair, record: readTaskRecordRaw(fixture.root, task).record })).not.toContain(outputCanary);
					const beforeLocalGreen = readTaskRecordRaw(fixture.root, task).revision;
					execFileSync(process.execPath, ["verify.ts", "impl-1.txt"], { cwd: fixture.root }); // Deliberately non-attesting.
					expect(await progression.advance(task, { cwd: fixture.root })).toMatchObject({ state: "blocked", recovery: { category: "repair", finding_ids: [finding.id] } });
					expect(readTaskRecordRaw(fixture.root, task).revision).toBe(beforeLocalGreen);
					if (host === "claude") await client.runtime.resolveFinding(task, finding.id);
					else await createPiAssuranceProgressionPorts().applyOrdinaryOperation({ cwd: fixture.root },
						{ taskId: task, operation: { op: "resolve_finding", finding_id: finding.id, actor_id: "executor" } });
				}
				writeFileSync(join(fixture.root, `impl-${n}.txt`), "implemented");
				execFileSync("git", ["add", `impl-${n}.txt`], { cwd: fixture.root });
				if (n === 1) {
					const reviewPorts = (progression as any).ports;
					const writeEvidence = reviewPorts.writeReviewEvidence;
					try {
						reviewPorts.writeReviewEvidence = () => { throw new Error("fixture Review evidence directory unavailable"); };
						expect(await progression.advance(task, { cwd: fixture.root })).toMatchObject({ state: "review_preparation_failed",
							recovery: { category: "environment", task_id: task, next_obligation: "run_review", acceptance_ids: ["acc-1"], finding_ids: [] } });
						const afterQa = readTaskRecordRaw(fixture.root, task);
						for (let retry = 0; retry < 2; retry++) {
							const pending = await start();
							expect(pending.report).toMatchObject({ batch_state: "running", handoff: { role: "executor", task_id: task, next_obligation: "run_review" },
								recovery: { category: "environment", record_revision: afterQa.revision, acceptance_ids: ["acc-1"], finding_ids: [], next_action: expect.stringContaining("retain fresh QA") } });
							expect(pending.report.children.find((c: any) => c.task_id === task).state).toBe("enrolled");
							expect(readTaskRecordRaw(fixture.root, task).revision).toBe(afterQa.revision);
							expect(confirmations).toBe(1); expect(progression.active(task)).toBeNull();
						}
					} finally { reviewPorts.writeReviewEvidence = writeEvidence; }
				}
				const qaIdsBeforeReview = readTaskRecordRaw(fixture.root, task).record!.attestations.filter(a => a.kind === "qa").map(a => a.id);
				const ready = await progression.advance(task, { cwd: fixture.root });
				if (n === 1) expect(readTaskRecordRaw(fixture.root, task).record!.attestations.filter(a => a.kind === "qa").map(a => a.id)).toEqual(qaIdsBeforeReview);
				expect(ready.state).toBe("review_ready");
				expect(readTaskRecordRaw(fixture.root, task).record?.attestations.some((a) => a.kind === "qa" && a.acceptance_results.every((r) => r.status === "passed"))).toBe(true);
				result = await start();
				expect(result.report.batch_state).toBe("running");
				expect(result.report.reason).toContain("open Review reservation");
				expect(progression.active(task)?.operation_id).toBe(ready.operation_id);
				const verdict = { contract: "assurance_kernel/assurance_verdict/v2", role: "review", task_id: task,
					snapshot_digest: ready.snapshot_digest, decision: "pass",
					approval: { kind: "review", authority_role: "reviewer", summary: "fixture implementation verified", inspected_paths: [`impl-${n}.txt`] } };
				if (host === "claude") {
					const agentId = `agent-${n}`, sessionId = `review-${slug}`;
					client.host.observe({ type: "SubagentStart", sessionId, agentId, agent: REVIEWER_AGENT, taskId: task, operationId: ready.operation_id });
					client.host.observe({ type: "PostToolUse", sessionId, agentId, toolName: AGENT_TOOL, result: JSON.stringify(verdict), taskId: task, operationId: ready.operation_id });
					client.host.observe({ type: "SubagentStop", sessionId, agentId, agent: REVIEWER_AGENT, taskId: task, operationId: ready.operation_id });
					expect(await client.runtime.submitReview(task, verdict)).toMatchObject({ state: "completed" });
				} else {
					expect(ready.agent_params.run_in_background).toBe(false);
					expect(await progression.submitReview(task, { cwd: fixture.root }, verdict)).toMatchObject({ state: "completed" });
				}
				expect(readTaskTombstone(fixture.root, task)?.terminal_lifecycle).toBe("done");
				const auditDir = join(fixture.root, `.imm/audit/${task}`);
				const audit = JSON.parse(readFileSync(join(auditDir, readdirSync(auditDir).find((name) => name.startsWith("run-"))!, "task-record.json"), "utf8"));
				expect(audit.attestations.some((a: any) => a.kind === "review" && a.review_revision)).toBe(true);
				expect(JSON.stringify({ audit, result, ready })).not.toContain(outputCanary);
				execFileSync("git", ["add", `.imm/audit/${task}`], { cwd: fixture.root });
				result = await start();
				expect(result).toMatchObject({ state: "started" });
				expect(result.report.children.find((c: any) => c.task_id === task)).toMatchObject({ state: "committed" });
				expect(result.report.commits).toHaveLength(n);
			}
			expect(result.report.batch_state).toBe("completed");
			expect(result.report.commits).toHaveLength(2);
			expect(new Set(result.report.commits).size).toBe(2);
			expect(confirmations).toBe(1);
			const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" });
			const replay = await start();
			expect(replay).toMatchObject({ state: "rejected" }); // No remaining eligible children, no second commit.
			expect(confirmations).toBe(1);
			expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" })).toBe(head);
		} finally { await progression.onSessionShutdown(); }
	}, 60000);
});

describe("batch foreground closeout", () => {
	// A child that reaches `done` in the foreground re-enters the batch in the same
	// tool call, reusing the stored authorization: no gate, one commit, and the
	// next child's handoff arrives beside the unchanged Kernel result.
	it("claude: submit_review of the last in-flight child commits and continues without a gate", async () => {
		const slug = "closeout-claude";
		const fixture = createBatchFixture(slug);
		writeFileSync(join(fixture.root, "verify.ts"), `import { strict as assert } from "node:assert"; assert.equal(await Bun.file(process.argv[2]).text(), "implemented");\n`);
		for (const n of [1, 2]) {
			const path = join(fixture.root, `docs/plans/${slug}-c${n}.intent.json`);
			const intent = JSON.parse(readFileSync(path, "utf8"));
			intent.risk = "material";
			intent.scope_hint = [`docs/plans/${slug}-c${n}.intent.json`, "verify.ts", `impl-${n}.txt`];
			intent.acceptance[0].verification = JSON.stringify({
				contract: "assurance_kernel/verification_descriptor/v2",
				command: { executable: "bun", argv: ["verify.ts", `impl-${n}.txt`], cwd: ".", timeout_ms: 10000, max_output_bytes: 8192 },
				environment: { writable_paths: [] },
			});
			writeFileSync(path, `${JSON.stringify(intent, null, 2)}\n`);
		}
		execFileSync("git", ["add", "-A"], { cwd: fixture.root });
		execFileSync("git", ["commit", "-qm", "closeout fixture"], { cwd: fixture.root });
		let confirmations = 0;
		const client = createMcpRuntimeOnce({ cwd: fixture.root, env: ENV, interactive: true,
			readInitiative: async () => fixture.observation,
			requestConfirmation: async () => ({ decision: "accept", requestId: `closeout-${++confirmations}` }),
		});
		client.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
		const { REVIEWER_AGENT, AGENT_TOOL } = await import("../plugins/immune-brain/runtime/claude/review_host");
		try {
			let started: any = await client.callTool("start_unattended_batch", { initiative_slug: slug });
			for (const n of [1, 2]) {
				const task = `${slug}-c${n}`;
				expect(started.report.handoff).toMatchObject({ role: "executor", task_id: task });
				writeFileSync(join(fixture.root, `impl-${n}.txt`), "implemented");
				execFileSync("git", ["add", `impl-${n}.txt`], { cwd: fixture.root });
				const ready = await client.runtime.advance(task);
				expect(ready.state).toBe("review_ready");
				const verdict = { contract: "assurance_kernel/assurance_verdict/v2", role: "review", task_id: task,
					snapshot_digest: ready.snapshot_digest, decision: "pass",
					approval: { kind: "review", authority_role: "reviewer", summary: "fixture implementation verified", inspected_paths: [`impl-${n}.txt`] } };
				const agentId = `agent-${n}`, sessionId = `review-${slug}`;
				client.host.observe({ type: "SubagentStart", sessionId, agentId, agent: REVIEWER_AGENT, taskId: task, operationId: ready.operation_id });
				client.host.observe({ type: "PostToolUse", sessionId, agentId, toolName: AGENT_TOOL, result: JSON.stringify(verdict), taskId: task, operationId: ready.operation_id });
				client.host.observe({ type: "SubagentStop", sessionId, agentId, agent: REVIEWER_AGENT, taskId: task, operationId: ready.operation_id });
				const settled: any = await client.callTool("submit_review", { task_id: task, verdict });
				expect(settled).toMatchObject({ state: "completed" });
				// The same call that settled the child already continued the batch.
				expect(settled.batch).toMatchObject({ state: "started" });
				expect(settled.batch.report.children.find((c: any) => c.task_id === task)).toMatchObject({ state: "committed" });
				expect(settled.batch.report.commits).toHaveLength(n);
				if (n === 1) expect(settled.batch.report.handoff).toMatchObject({ role: "executor", task_id: `${slug}-c2` });
				else expect(settled.batch.report.batch_state).toBe("completed");
				started = settled.batch;
				expect(confirmations).toBe(1);
			}
			const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" });
			expect(await client.callTool("start_unattended_batch", { initiative_slug: slug })).toMatchObject({ state: "rejected" });
			expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" })).toBe(head);
			expect(confirmations).toBe(1);
		} finally { await client.runtime.coordinator.onSessionShutdown?.(); }
	}, 60000);
});

describe("batch foreground closeout boundaries", () => {
	function closeoutFixture(slug: string) {
		const fixture = createBatchFixture(slug);
		writeFileSync(join(fixture.root, "verify.ts"), `import { strict as assert } from "node:assert"; assert.equal(await Bun.file(process.argv[2]).text(), "implemented");\n`);
		for (const n of [1, 2]) {
			const path = join(fixture.root, `docs/plans/${slug}-c${n}.intent.json`);
			const intent = JSON.parse(readFileSync(path, "utf8"));
			intent.risk = "material";
			intent.scope_hint = [`docs/plans/${slug}-c${n}.intent.json`, "verify.ts", `impl-${n}.txt`];
			intent.acceptance[0].verification = JSON.stringify({
				contract: "assurance_kernel/verification_descriptor/v2",
				command: { executable: "bun", argv: ["verify.ts", `impl-${n}.txt`], cwd: ".", timeout_ms: 10000, max_output_bytes: 8192 },
				environment: { writable_paths: [] },
			});
			writeFileSync(path, `${JSON.stringify(intent, null, 2)}\n`);
		}
		execFileSync("git", ["add", "-A"], { cwd: fixture.root });
		execFileSync("git", ["commit", "-qm", "closeout fixture"], { cwd: fixture.root });
		let confirmations = 0;
		const client = createMcpRuntimeOnce({ cwd: fixture.root, env: ENV, interactive: true,
			readInitiative: async () => fixture.observation,
			requestConfirmation: async () => ({ decision: "accept", requestId: `boundary-${++confirmations}` }),
		});
		client.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
		return { fixture, client, confirmations: () => confirmations };
	}
	async function reviewPass(client: any, root: string, slug: string, task: string) {
		const { REVIEWER_AGENT, AGENT_TOOL } = await import("../plugins/immune-brain/runtime/claude/review_host");
		const impl = `impl-${task.endsWith("c1") ? 1 : 2}.txt`;
		writeFileSync(join(root, impl), "implemented");
		execFileSync("git", ["add", impl], { cwd: root });
		const advanced: any = await client.callTool("advance_assurance", { task_id: task });
		const verdict = { contract: "assurance_kernel/assurance_verdict/v2", role: "review", task_id: task,
			snapshot_digest: advanced.snapshot_digest, decision: "pass",
			approval: { kind: "review", authority_role: "reviewer", summary: "fixture implementation verified", inspected_paths: [impl] } };
		const sessionId = `review-${slug}`, agentId = `agent-${task}`;
		client.host.observe({ type: "SubagentStart", sessionId, agentId, agent: REVIEWER_AGENT, taskId: task, operationId: advanced.operation_id });
		client.host.observe({ type: "PostToolUse", sessionId, agentId, toolName: AGENT_TOOL, result: JSON.stringify(verdict), taskId: task, operationId: advanced.operation_id });
		client.host.observe({ type: "SubagentStop", sessionId, agentId, agent: REVIEWER_AGENT, taskId: task, operationId: advanced.operation_id });
		return { advanced, verdict };
	}

	it("a child that is not done is not closed out: advance_assurance to review_ready carries no batch continuation", async () => {
		const slug = "boundary-notdone";
		const { fixture, client, confirmations } = closeoutFixture(slug);
		try {
			await client.callTool("start_unattended_batch", { initiative_slug: slug });
			writeFileSync(join(fixture.root, "impl-1.txt"), "implemented");
			execFileSync("git", ["add", "impl-1.txt"], { cwd: fixture.root });
			const advanced: any = await client.callTool("advance_assurance", { task_id: `${slug}-c1` });
			expect(advanced.state).toBe("review_ready");
			expect(advanced).not.toHaveProperty("batch");
			expect(execFileSync("git", ["log", "--format=%s", "-3"], { cwd: fixture.root, encoding: "utf8" })).not.toContain(`${slug}-c1`);
			expect(confirmations()).toBe(1);
		} finally { await client.runtime.coordinator.onSessionShutdown?.(); }
	}, 60000);

	it("a continuation the batch refuses (plan drift) reports a recovery action beside the unchanged result and opens no gate", async () => {
		const slug = "boundary-drift";
		const { fixture, client, confirmations } = closeoutFixture(slug);
		try {
			await client.callTool("start_unattended_batch", { initiative_slug: slug });
			const { verdict } = await reviewPass(client, fixture.root, slug, `${slug}-c1`);
			// Plan drift makes the stored authorization unusable.
			const c2 = join(fixture.root, `docs/plans/${slug}-c2.intent.json`);
			const intent = JSON.parse(readFileSync(c2, "utf8"));
			intent.goal = "child 2, revised out of band";
			writeFileSync(c2, `${JSON.stringify(intent, null, 2)}\n`);
			execFileSync("git", ["commit", "-qm", "revise c2 intent", "--only", "--", `docs/plans/${slug}-c2.intent.json`], { cwd: fixture.root });
			const settled: any = await client.callTool("submit_review", { task_id: `${slug}-c1`, verdict });
			expect(settled).toMatchObject({ state: "completed" });
			expect(settled.batch.state).not.toBe("started");
			expect(settled.batch.recovery_action).toEqual(expect.any(String));
			expect(settled.batch.recovery_action.length).toBeGreaterThan(0);
			expect(confirmations()).toBe(1);
			expect(execFileSync("git", ["log", "--format=%s", "-3"], { cwd: fixture.root, encoding: "utf8" })).not.toContain(`${slug}-c1`);
		} finally { await client.runtime.coordinator.onSessionShutdown?.(); }
	}, 60000);
});

describe("acc-claude-batch-gate", () => {
	it("start_unattended_batch joins PRIVILEGED_OPERATIONS and has destructiveHint annotation", () => {
		expect(PRIVILEGED_OPERATIONS).toContain("start_unattended_batch");
		const tools = listMcpTools();
		const batchTool = tools.find((t) => t.name === "start_unattended_batch");
		expect(batchTool).toBeDefined();
		expect(batchTool?.annotations).toEqual({ destructiveHint: true });
		expect(batchTool?.inputSchema.required).toEqual(["initiative_slug"]);
		expect(Object.keys(batchTool?.inputSchema.properties ?? {})).toEqual(["initiative_slug", "max_parallel", "lane_offers", "final_verification"]);
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
		// Only the bounds that still exist are shown.
		expect(params.message).not.toMatch(/expires|deadline/i);
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
		const commitsByTask = new Map<string, string>();
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			readInitiative: async () => fixture.observation,
			batchKernel: {
				advanceTask: async () => { releaseWorkspaceForTest(fixture.root); return { state: "completed" }; },
			},
			batchGit: {
				...createDefaultBatchGitPort(),
				commitChild: async (_root: string, taskId: string) => {
					writeFileSync(join(fixture.root, "dummy.txt"), `${Date.now()}`);
					execFileSync("git", ["add", "dummy.txt"], { cwd: fixture.root });
					execFileSync("git", ["commit", "-q", "-m", "child commit"], { cwd: fixture.root });
					const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
					commitsByTask.set(taskId, commit);
					return { commit };
				},
				lookupBatchCommit: async (_root: string, taskId: string) => (commitsByTask.has(taskId) ? { commit: commitsByTask.get(taskId)! } : null),
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
		expect(result.batch_id).toMatch(/^batch-accept-exec-[0-9a-f-]{36}$/);
		expect(result.report).toBeDefined();
		expect(result.report.initiative_slug).toBe("accept-exec");
		expect(result.report.batch_state).toBe("completed");
	});

	it("an answer given after any delay is accepted and the authorization it issues carries no expiry", async () => {
		const fixture = createBatchFixture("claude-ttl");
		let clock: ReturnType<typeof spyOn> | undefined;
		const batchDetails: Record<string, unknown>[] = [];
		const commitsByTask = new Map<string, string>();
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			readInitiative: async () => fixture.observation,
			batchKernel: {
				enrollTask: async () => ({ record_revision: "rev-1" }),
				advanceTask: async () => ({ state: "completed" }),
			},
			batchGit: {
				...createDefaultBatchGitPort(),
				commitChild: async (_root: string, taskId: string) => {
					writeFileSync(join(fixture.root, "dummy.txt"), `${Date.now()}`);
					execFileSync("git", ["add", "dummy.txt"], { cwd: fixture.root });
					execFileSync("git", ["commit", "-q", "-m", "child commit"], { cwd: fixture.root });
					const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
					commitsByTask.set(taskId, commit);
					return { commit };
				},
				lookupBatchCommit: async (_root: string, taskId: string) => (commitsByTask.has(taskId) ? { commit: commitsByTask.get(taskId)! } : null),
			},
			requestConfirmation: async (request) => {
				batchDetails.push(request.batchDetails as Record<string, unknown>);
				// The user answers a year later by the wall clock.
				clock = spyOn(Date, "now").mockReturnValue(Date.now() + 365 * 24 * 60 * 60 * 1000);
				return { decision: "accept", requestId: "req-ttl" };
			},
		});
		runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });

		const result = await runtime
			.callTool("start_unattended_batch", { initiative_slug: "claude-ttl" }, { toolCallId: "toolu-ttl" })
			.finally(() => clock?.mockRestore());
		expect(result.state).toBe("started");

		// The literal user confirmed the remaining bounds and nothing time-based.
		expect(batchDetails[0]).not.toHaveProperty("expires_at");
		expect(Object.keys(batchDetails[0]!.budget as object).sort()).toEqual(["max_children", "qa_failure_limit"]);

		const state = JSON.parse(
			readFileSync(join(fixture.root, ".imm", "state", "batches", `${result.batch_id}.json`), "utf8"),
		);
		expect(state).not.toHaveProperty("authorization_expires_at");
		expect(state.budget).toEqual(batchDetails[0]!.budget);
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
		claimWorkspaceForTest(fixture.root, "some-active-task");
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

		const commitsByTask = new Map<string, string>();
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			readInitiative: async () => fixture.observation,
			batchKernel: {
				enrollTask: async () => ({ record_revision: "rev-settled" }),
				advanceTask: async () => ({ state: "completed" }),
			},
			batchGit: {
				...createDefaultBatchGitPort(),
				commitChild: async (_root: string, taskId: string) => {
					writeFileSync(join(fixture.root, "dummy.txt"), `${Date.now()}`);
					execFileSync("git", ["add", "dummy.txt"], { cwd: fixture.root });
					execFileSync("git", ["commit", "-q", "-m", "child commit"], { cwd: fixture.root });
					const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
					commitsByTask.set(taskId, commit);
					return { commit };
				},
				lookupBatchCommit: async (_root: string, taskId: string) => (commitsByTask.has(taskId) ? { commit: commitsByTask.get(taskId)! } : null),
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

	for (const host of ["claude", "pi"] as const) it(`${host}: starts new children after a completed batch without replaying its identity`, async () => {
		const slug = "next-round";
		const fixture = createBatchFixture(slug);
		const enrolled: string[] = [];
		const commits = new Map<string, string>();
		let observation = { ...fixture.observation, tasks: fixture.observation.tasks.slice(0, 1) };
		let confirmations = 0;
		const batchKernel: Partial<BatchRunnerKernelPort> = {
			advanceTask: async (_root, taskId) => {
				enrolled.push(taskId);
				releaseWorkspaceForTest(fixture.root);
				return { state: "completed" };
			},
		};
		const batchGit = {
			...createDefaultBatchGitPort(),
			commitChild: async (_root, taskId) => {
				execFileSync("git", ["commit", "--allow-empty", "-qm", `complete ${taskId}`], { cwd: fixture.root });
				const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
				commits.set(taskId, commit);
				return { commit };
			},
			lookupBatchCommit: async (_root, taskId) => commits.has(taskId) ? { commit: commits.get(taskId)! } : null,
		};
		const runtime = createMcpRuntime({
			cwd: fixture.root, env: ENV, interactive: true,
			readInitiative: async () => observation,
			requestConfirmation: async () => ({ decision: "accept", requestId: `round-${++confirmations}` }),
			batchKernel, batchGit,
		});
		runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
		try {
			const start = async (): Promise<any> => host === "claude"
				? runtime.callTool("start_unattended_batch", { initiative_slug: slug }, { toolCallId: "round" })
				: executePiUnattendedBatch({ root: fixture.root, initiativeSlug: slug, readInitiative: async () => observation,
					batchKernel, batchGit, confirmBatch: async () => { confirmations++; return "accept"; } });
			const first = await start();
			expect(first.report?.batch_state).toBe("completed");
			const oldPath = join(fixture.root, ".imm/state/batches", `${first.batch_id}.json`);
			const oldBytes = readFileSync(oldPath, "utf8");
			observation = { ...fixture.observation, tasks: [{ ...fixture.observation.tasks[1]!, blocked_by: [] }] };
			execFileSync("git", ["commit", "--allow-empty", "-qm", "publish next child"], { cwd: fixture.root });
			const nextHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
			const second = await start();
			expect(second.report?.batch_state).toBe("completed");
			expect(second.batch_id).not.toBe(first.batch_id);
			expect(enrolled).toEqual([`${slug}-c1`, `${slug}-c2`]);
			expect(confirmations).toBe(2);
			expect(readFileSync(oldPath, "utf8")).toBe(oldBytes);
			const next = JSON.parse(readFileSync(join(fixture.root, ".imm/state/batches", `${second.batch_id}.json`), "utf8"));
			expect(next.base_head).toBe(nextHead);
			expect(next.children.map((child: { task_id: string }) => child.task_id)).toEqual([`${slug}-c2`]);
			// A completed record cannot authorize moving an existing branch from
			// another checkout or adopting a branch whose settled history was lost.
			execFileSync("git", ["checkout", "-q", "main"], { cwd: fixture.root });
			expect(runBatchGitPreflight({ root: fixture.root, initiative_slug: slug, base_head: fixture.head }).ok).toBe(false);
			execFileSync("git", ["checkout", "-q", `imm/${slug}`], { cwd: fixture.root });
			execFileSync("git", ["reset", "--hard", fixture.head], { cwd: fixture.root });
			expect(runBatchGitPreflight({ root: fixture.root, initiative_slug: slug, base_head: fixture.head }).ok).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
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

	it("review-4: replayed elicitation evidence never settles the gate; only the live answer does", async () => {
		const fixture = createBatchFixture("timeout-test");
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
		const elicitation = (await next()) as { id: string | number };
		// Replay an old/unknown requestId instead of answering the live elicitation
		send({
			jsonrpc: "2.0",
			id: "old-request-id",
			result: { action: "accept" },
		});

		// The replay is not an answer, and the gate has no window of its own.
		const settled = next();
		const early = await Promise.race([
			settled,
			new Promise((resolve) => setTimeout(() => resolve("still waiting"), 200)),
		]);
		expect(early).toBe("still waiting");

		send({ jsonrpc: "2.0", id: elicitation.id, result: { action: "decline" } });
		const result = await settled;
		input.end();
		await server;

		expect(JSON.stringify(result)).toContain("native interaction declined");
		expect(JSON.stringify(result)).toContain("rejected");
		expect(existsSync(join(fixture.root, ".imm", "state", "batches"))).toBe(false);
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
					claimWorkspaceForTest(fixture.root, "concurrent-task");
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
		const commitsByTask = new Map<string, string>();
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			readInitiative: async () => fixture.observation,
			batchKernel: {
				// DO NOT override enrollTask — exercise the real Kernel enrollment in the shared batch Kernel port!
				advanceTask: async () => {
					// Clear the task's active claim upon completion so the next child can enroll cleanly
					releaseWorkspaceForTest(fixture.root);
					return { state: "completed" };
				},
			},
			batchGit: {
				...createDefaultBatchGitPort(),
				commitChild: async (_root: string, taskId: string) => {
					writeFileSync(join(fixture.root, "dummy.txt"), `${Date.now()}`);
					execFileSync("git", ["add", "dummy.txt"], { cwd: fixture.root });
					execFileSync("git", ["commit", "-q", "-m", "child commit"], { cwd: fixture.root });
					const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
					commitsByTask.set(taskId, commit);
					return { commit };
				},
				lookupBatchCommit: async (_root: string, taskId: string) => (commitsByTask.has(taskId) ? { commit: commitsByTask.get(taskId)! } : null),
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

	it.each([false, true])("reuses an intact, still-binding authorization with zero additional elicitations (retired expiry fields in the record: %p)", async (legacyExpiry) => {
		const slug = legacyExpiry ? "claude-reuse-legacy" : "claude-reuse";
		const fixture = createBatchFixture(slug);
		let elicitations = 0;
		const commitsByTask = new Map<string, string>();
		let step = 0;
		const runtime = createMcpRuntime({
			cwd: fixture.root,
			env: ENV,
			interactive: true,
			readInitiative: async () => fixture.observation,
			batchKernel: {
				advanceTask: async () => {
					step++;
					if (step === 1) return { state: "review_ready", operation_id: "op-cr", agent_params: { prompt: "review" } as never };
					// Settlement clears the live claim and the workspace owner; the resume
					// seam mirrors that so the next child can be projected.
					releaseWorkspaceForTest(fixture.root);
					return { state: "completed" };
				},
			},
			batchGit: {
				...createDefaultBatchGitPort(),
				commitChild: async (_root: string, taskId: string) => {
					writeFileSync(join(fixture.root, "dummy.txt"), `${Date.now()}`);
					execFileSync("git", ["add", "dummy.txt"], { cwd: fixture.root });
					execFileSync("git", ["commit", "-q", "-m", "child commit"], { cwd: fixture.root });
					const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
					commitsByTask.set(taskId, commit);
					return { commit };
				},
				lookupBatchCommit: async (_root: string, taskId: string) => (commitsByTask.has(taskId) ? { commit: commitsByTask.get(taskId)! } : null),
			},
			requestConfirmation: async () => {
				elicitations++;
				return { decision: "accept", requestId: `req-reuse-${elicitations}` };
			},
		});
		runtime.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });

		const first = await runtime.callTool(
			"start_unattended_batch",
			{ initiative_slug: slug },
			{ toolCallId: "toolu-cr1" },
		);
		expect(first.state).toBe("started");
		expect(elicitations).toBe(1);

		const statePath = join(fixture.root, ".imm", "state", "batches", `${first.batch_id}.json`);
		if (legacyExpiry) {
			const state = JSON.parse(readFileSync(statePath, "utf8"));
			state.authorization_expires_at = "2020-01-01T00:00:00.000Z";
			state.budget.deadline_at = "2020-01-01T00:00:00.000Z";
			writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
		}

		const second = await runtime.callTool(
			"start_unattended_batch",
			{ initiative_slug: slug },
			{ toolCallId: "toolu-cr2" },
		);
		expect(elicitations).toBe(1);
		expect(second.state).toBe("started");
		expect(second.batch_id).toBe(first.batch_id);
		expect(second.report.batch_state).toBe("completed");
		const rewritten = JSON.parse(readFileSync(statePath, "utf8"));
		expect(rewritten).not.toHaveProperty("authorization_expires_at");
		expect(rewritten.budget).not.toHaveProperty("deadline_at");
	});


	// RB3-1 / F3: the post-settlement tracker projection runs after the Kernel
	// mutation committed, so a failure inside it must not roll the staged intent
	// back or turn the committed revision into an exception a caller could retry.
	it("keeps a committed mutation when the post-settlement tracker projection throws", async () => {
		const taskId = "tracker-throw-after-commit";
		const root = mkdtempSync(join(tmpdir(), "claude-tracker-throw-"));
		try {
			const intent = {
				contract: "assurance_kernel/task_intent/v1",
				task_id: taskId,
				owner: "user",
				goal: "exercise a post-settlement tracker failure",
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
			mkdirSync(join(root, "docs", "specs", "archive"), { recursive: true });
			writeFileSync(join(root, "docs", "plans", `${taskId}.intent.json`), `${JSON.stringify(intent, null, 2)}\n`);
			writeFileSync(join(root, "docs", "specs", `${taskId}.spec.md`), `# ${taskId}\n`);
			execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
			execFileSync("git", ["add", "-A"], { cwd: root });
			execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "fixture"], { cwd: root });

			const runtime = new ClaudeRuntime({
				cwd: root,
				env: ENV,
				interactive: true,
				permissionMode: "manual",
				requestConfirmation: async ({ operation }) => ({ decision: "accept", requestId: `nested-${operation}` }),
			});
			const meta = (toolCallId: string): ToolMeta => ({
				taskId,
				sessionId: "s",
				toolCallId,
				requiresUserInteraction: true,
				interactive: true,
				permissionMode: "manual",
			});
			await runtime.enroll(taskId, meta("enroll"));

			// Force the failure exactly where the acceptance forces it: the
			// observation that only runs after the mutation has committed. A stop
			// settles the task, so it is the read that follows that commit which fails.
			const realStatus = runtime.status.bind(runtime);
			let forced = 0;
			runtime.status = (async (id: string) => {
				if (readTaskTombstone(root, id) !== null) {
					forced += 1;
					throw new Error("terminal-tracker projection failed");
				}
				return realStatus(id);
			}) as ClaudeRuntime["status"];

			const result = await runtime.authorize(taskId, "stop", meta("stop"));

			expect(forced).toBe(1);
			// The committed mutation is still the authoritative result, with the
			// tracker failure reported beside it rather than thrown.
			expect(result.record.lifecycle).toBe("stopped");
			expect((result as { tracker?: unknown }).tracker).toMatchObject({
				operation: "mark-terminal",
				status: "retryable_failure",
			});
			// And the settlement the throw could not undo is still the committed state:
			// the terminal tombstone the projection needed is there, and the live record
			// has already moved into the audit directory.
			expect(readTaskTombstone(root, taskId)?.terminal_lifecycle).toBe("stopped");
			expect(readTaskRecordRaw(root, taskId).record).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("lane mode parameters (parallel-batch-lanes)", () => {
	function laneRuntime(fixture: ReturnType<typeof createBatchFixture>, gates: { count: number; details: Array<Record<string, unknown>> }) {
		const client = createMcpRuntimeOnce({
			cwd: fixture.root, env: ENV, interactive: true,
			readInitiative: async () => fixture.observation,
			requestConfirmation: async (request) => {
				gates.count++;
				gates.details.push(request.batchDetails as unknown as Record<string, unknown>);
				return { decision: "decline", requestId: `lane-${gates.count}` };
			},
		});
		client.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
		return client;
	}

	it("refuses an invalid max_parallel or a malformed lane offer before any gate opens, with zero writes", async () => {
		const fixture = createBatchFixture("lane-invalid");
		const gates = { count: 0, details: [] as Array<Record<string, unknown>> };
		const client = laneRuntime(fixture, gates);
		try {
			const invalid: Array<Record<string, unknown>> = [
				{ max_parallel: 0 },
				{ max_parallel: -1 },
				{ max_parallel: 1.5 },
				{ max_parallel: "1" },
				{ lane_offers: [{ task_id: "lane-invalid-c1", path: "/tmp/x" }] },
				{ max_parallel: 1, lane_offers: [{ task_id: "lane-invalid-c1", path: "relative" }] },
				{ max_parallel: 1, lane_offers: [{ task_id: "../escape", path: "/tmp/x" }] },
				{ max_parallel: 1, lane_offers: [{ task_id: "lane-invalid-c1", path: "/tmp/x", extra: 1 }] },
			];
			for (const extra of invalid) {
				await expect(client.callTool("start_unattended_batch", { initiative_slug: "lane-invalid", ...extra })).rejects.toThrow();
				expect(gates.count).toBe(0);
				expect(existsSync(join(fixture.root, ".imm", "state", "batches"))).toBe(false);
			}
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("accepts max_parallel above 1 through the same single gate", async () => {
		const fixture = createBatchFixture("lane-wide");
		const gates = { count: 0, details: [] as Array<Record<string, unknown>> };
		const client = laneRuntime(fixture, gates);
		try {
			const result: any = await client.callTool("start_unattended_batch", { initiative_slug: "lane-wide", max_parallel: 2 });
			expect(gates.count).toBe(1);
			expect(String(result.reason ?? "")).not.toMatch(/batch_parallel_unsupported/);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("shows max_parallel and the parallel groups in the confirmation only in lane mode", async () => {
		const serial = createBatchFixture("lane-confirm-serial");
		const lane = createBatchFixture("lane-confirm-lane");
		const serialGates = { count: 0, details: [] as Array<Record<string, unknown>> };
		const laneGates = { count: 0, details: [] as Array<Record<string, unknown>> };
		try {
			await laneRuntime(serial, serialGates).callTool("start_unattended_batch", { initiative_slug: "lane-confirm-serial" });
			await laneRuntime(lane, laneGates).callTool("start_unattended_batch", { initiative_slug: "lane-confirm-lane", max_parallel: 1 });
			expect(serialGates.details[0]).not.toHaveProperty("lane_mode");
			expect(laneGates.details[0]?.lane_mode).toMatchObject({ max_parallel: 1 });
			expect(Array.isArray((laneGates.details[0]?.lane_mode as { parallel_groups: unknown }).parallel_groups)).toBe(true);
		} finally {
			rmSync(serial.root, { recursive: true, force: true });
			rmSync(lane.root, { recursive: true, force: true });
		}
	});

	for (const maxParallel of [1, 2]) it(`gives Claude Code and Pi the same lane-mode report for the same fixture at max_parallel ${maxParallel}`, async () => {
		const slug = maxParallel === 1 ? "lane-parity-one" : "lane-parity-many";
		const claudeFixture = createBatchFixture(slug);
		const piFixture = createBatchFixture(slug);
		try {
			const client = createMcpRuntimeOnce({
				cwd: claudeFixture.root, env: ENV, interactive: true,
				readInitiative: async () => claudeFixture.observation,
				requestConfirmation: async () => ({ decision: "accept", requestId: "parity" }),
			});
			client.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
			const claude: any = await client.callTool("start_unattended_batch", { initiative_slug: slug, max_parallel: maxParallel });
			const pi: any = await executePiUnattendedBatch({
				root: piFixture.root, initiativeSlug: slug, max_parallel: maxParallel,
				readInitiative: async () => piFixture.observation,
				confirmBatch: async () => "accept",
			});
			expect(claude.state).toBe("started");
			expect(pi.state).toBe("started");
			const normalize = (value: unknown, fixture: { head: string }) =>
				JSON.parse(
					JSON.stringify(value)
						.split(fixture.head).join("<head>")
						.replace(/batch-[A-Za-z0-9._-]+?-[0-9a-f-]{36}/g, "<batch>")
						.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, "<time>"),
				);
			expect(claude.report.max_parallel).toBe(maxParallel);
			expect(claude.report.handoffs?.[0]).toMatchObject({ role: "lane-steward", action: "provision" });
			expect(claude.report).not.toHaveProperty("handoff");
			expect(normalize(claude.report.handoffs, claudeFixture)).toEqual(normalize(pi.report.handoffs, piFixture));
			expect(normalize(claude.report, claudeFixture)).toEqual(normalize(pi.report, piFixture));
		} finally {
			rmSync(claudeFixture.root, { recursive: true, force: true });
			rmSync(piFixture.root, { recursive: true, force: true });
		}
	});

	it("reads no workspace-tool environment variable in either Host adapter or the lane runtime", () => {
		for (const file of [
			"plugins/immune-brain/.pi-extension/imm-unattended-batch.ts",
			"plugins/immune-brain/runtime/claude/mcp_server.ts",
			"plugins/immune-brain/runtime/unattended/batch_lanes.ts",
			"plugins/immune-brain/runtime/unattended/batch_integration.ts",
		]) {
			const source = readFileSync(join(import.meta.dir, "..", file), "utf8");
			expect({ file, herdr: /HERDR/i.test(source) }).toEqual({ file, herdr: false });
		}
	});
});

describe("lane resume without max_parallel (lane-followups)", () => {
	const normalize = (value: unknown, fixture: { head: string }) =>
		JSON.parse(
			JSON.stringify(value)
				.split(fixture.head).join("<head>")
				.replace(/batch-[A-Za-z0-9._-]+?-[0-9a-f-]{36}/g, "<batch>")
				.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, "<time>"),
		);

	function claudeClient(fixture: ReturnType<typeof createBatchFixture>, gates: { count: number }) {
		const client = createMcpRuntimeOnce({
			cwd: fixture.root, env: ENV, interactive: true,
			readInitiative: async () => fixture.observation,
			requestConfirmation: async () => { gates.count++; return { decision: "accept", requestId: `resume-${gates.count}` }; },
		});
		client.bindClientHandshake({ version: "2.1.236", interactive: true, protocolVersion: "2025-06-18" });
		return client;
	}

	it("resumes the recorded lane batch with lane_offers alone and gives both Hosts equal reports", async () => {
		const slug = "lane-resume-parity";
		const claudeFixture = createBatchFixture(slug);
		const piFixture = createBatchFixture(slug);
		const gates = { count: 0 };
		try {
			const client = claudeClient(claudeFixture, gates);
			await client.callTool("start_unattended_batch", { initiative_slug: slug, max_parallel: 2 });
			await executePiUnattendedBatch({
				root: piFixture.root, initiativeSlug: slug, max_parallel: 2,
				readInitiative: async () => piFixture.observation,
				confirmBatch: async () => "accept",
			});
			const claude: any = await client.callTool("start_unattended_batch", { initiative_slug: slug, lane_offers: [] });
			const pi: any = await executePiUnattendedBatch({
				root: piFixture.root, initiativeSlug: slug, lane_offers: [],
				readInitiative: async () => piFixture.observation,
				confirmBatch: async () => "accept",
			});
			expect(claude.state).toBe("started");
			expect(pi.state).toBe("started");
			expect(claude.report.max_parallel).toBe(2);
			expect(pi.report.max_parallel).toBe(2);
			expect(normalize(claude.report, claudeFixture)).toEqual(normalize(pi.report, piFixture));
		} finally {
			rmSync(claudeFixture.root, { recursive: true, force: true });
			rmSync(piFixture.root, { recursive: true, force: true });
		}
	});

	it("still refuses a resume that names a different max_parallel with batch_parallel_mismatch", async () => {
		const slug = "lane-resume-mismatch";
		const fixture = createBatchFixture(slug);
		const gates = { count: 0 };
		try {
			const client = claudeClient(fixture, gates);
			await client.callTool("start_unattended_batch", { initiative_slug: slug, max_parallel: 2 });
			const result: any = await client.callTool("start_unattended_batch", { initiative_slug: slug, max_parallel: 1, lane_offers: [] });
			expect(JSON.stringify(result)).toContain("batch_parallel_mismatch");
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("refuses lane_offers on a fresh start and on a serial batch before any gate opens", async () => {
		const gates = { count: 0 };
		const fresh = createBatchFixture("lane-resume-fresh");
		const serial = createBatchFixture("lane-resume-serial");
		try {
			await expect(claudeClient(fresh, gates).callTool("start_unattended_batch", { initiative_slug: "lane-resume-fresh", lane_offers: [] })).rejects.toThrow();
			expect(gates.count).toBe(0);
			expect(existsSync(join(fresh.root, ".imm", "state", "batches"))).toBe(false);
			const client = claudeClient(serial, gates);
			await client.callTool("start_unattended_batch", { initiative_slug: "lane-resume-serial" });
			const opened = gates.count;
			await expect(client.callTool("start_unattended_batch", { initiative_slug: "lane-resume-serial", lane_offers: [] })).rejects.toThrow();
			expect(gates.count).toBe(opened);
		} finally {
			rmSync(fresh.root, { recursive: true, force: true });
			rmSync(serial.root, { recursive: true, force: true });
		}
	});
});
