import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	executePiUnattendedBatch,
	default as registerBatchExtension,
} from "../plugins/immune-brain/.pi-extension/imm-unattended-batch";
import type { GithubInitiativeObservation } from "../plugins/immune-brain/runtime/github_issue_tracker";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { revisionForContent } from "../plugins/immune-brain/runtime/kernel/storage";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";
import { readRunRowByTask, withKernelRead, withKernelTransaction } from "../plugins/immune-brain/runtime/kernel/sqlite_store";
import { commitTerminalLocked, readWorkspaceStateRaw, retryStoreFollowUps, serializeWorkspace } from "../plugins/immune-brain/runtime/kernel/storage";

/** Claim the workspace for a fixture task through the store. */
/** Make the live owner run look foreign to an approved batch lineage. */
function makeOwnerForeignForTest(root: string, taskId: string): void {
	const run = withKernelRead(root, (db) => readRunRowByTask(db, taskId));
	if (!run) throw new Error(`fixture run ${taskId} is missing`);
	const record = JSON.parse(run.record_json) as Record<string, unknown>;
	record.git_base_head = "b".repeat(40);
	withKernelTransaction(root, (db) => {
		db.prepare("UPDATE runs SET record_json = ?, enrollment_event_id = ? WHERE run_id = ?").run(
			`${JSON.stringify(record, null, 2)}\n`,
			`foreign-${taskId}`,
			run.run_id,
		);
	});
}

/**
 * Replace the live owner with an unproven claim: the run mirrors the Kernel's
 * event-id derivation and task identity, but its enrollment event was created
 * after the batch's last durable write, so the batch cannot adopt it.
 */
function forgeUnprovenClaimForTest(
	root: string,
	taskId: string,
	enrollmentEventId: string,
	createdAt: string,
): void {
	const run = withKernelRead(root, (db) => readRunRowByTask(db, taskId));
	if (!run) throw new Error(`fixture run ${taskId} is missing`);
	withKernelTransaction(root, (db) => {
		db.prepare("UPDATE runs SET enrollment_event_id = ?, updated_at = ? WHERE run_id = ?").run(
			enrollmentEventId,
			createdAt,
			run.run_id,
		);
	});
}

/** Settle the live owner into its terminal audit pair through the store. */
function settleOwnerForTest(root: string, taskId: string): void {
	const run = withKernelRead(root, (db) => readRunRowByTask(db, taskId));
	if (!run) throw new Error(`fixture run ${taskId} is missing`);
	const record = JSON.parse(run.record_json) as Record<string, unknown>;
	record.lifecycle = "done";
	record.artifact_state = "frozen";
	record.intent_ref = {
		...((record.intent_ref as Record<string, unknown>) ?? {}),
		path: `docs/plans/archive/${taskId}.intent.json`,
	};
	const terminalBytes = `${JSON.stringify(record, null, 2)}\n`;
	const tombstone = {
		contract: "assurance_kernel/task_tombstone/v2",
		task_id: taskId,
		lifecycle_status: "terminal",
		terminal_lifecycle: "done",
		terminal_event_id: `complete:${taskId}:2026-08-12T10:00:04.000Z`,
		final_record_hash: revisionForContent(terminalBytes),
		terminalized_at: "2026-08-12T10:00:04.000Z",
	};
	const workspace = readWorkspaceStateRaw(root);
	commitTerminalLocked(
		root,
		taskId,
		{
			contract: "assurance_kernel/workspace_transaction/v2",
			task_id: taskId,
			expected_record_hash: revisionForContent(run.record_json),
			next_record_content: terminalBytes,
			expected_workspace_hash: workspace.revision,
			next_workspace_content: serializeWorkspace({
				contract: "assurance_kernel/workspace/v1",
				current_working: null,
			}),
		},
		tombstone as never,
	);
	retryStoreFollowUps(root);
}

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

/** Seed one active run: ownership is derived, so the claim is real state. */
function seedInFlightOwner(root: string, taskId: string): void {
	const intent = {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		goal: "in-flight fixture",
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

function assertZeroWrites(root: string, expectedHead?: string, slug?: string): void {
	expect(existsSync(join(root, ".imm", "state", "batch"))).toBe(false);
	expect(existsSync(join(root, ".imm", "state", "batches"))).toBe(false);
	expect(existsSync(join(root, ".imm", "state", "tasks"))).toBe(false);
	if (expectedHead) {
		const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
		expect(head).toBe(expectedHead);
	}
	if (slug) {
		const branchCheck = execFileSync("git", ["branch", "--list", `imm/${slug}`], { cwd: root, encoding: "utf8" }).trim();
		expect(branchCheck).toBe("");
	}
}

function createBatchFixture(slug = "pi-batch"): {
	root: string;
	head: string;
	observation: GithubInitiativeObservation;
} {
	const root = mkdtempSync(join(tmpdir(), "pi-batch-test-"));
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

type BatchToolDouble = {
	name: string;
	execute: (
		toolCallId: string,
		params: { initiative_slug: string },
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: unknown,
	) => Promise<{ content: Array<{ type: string; text: string }>; details: unknown }>;
};

/**
 * Register the real extension with injectable seams and hand back the batch Tool
 * so tests can drive its `execute`, which is the path that shapes the
 * model-visible content.
 */
function registerBatchTool(dependencies: {
	readInitiative: () => Promise<GithubInitiativeObservation>;
	batchKernel?: Record<string, unknown>;
}): BatchToolDouble {
	const tools: BatchToolDouble[] = [];
	registerBatchExtension(
		{ registerTool: (tool: BatchToolDouble) => tools.push(tool), events: { emit: () => {} } } as unknown as ExtensionAPI,
		dependencies as never,
	);
	const tool = tools.find((t) => t.name === "start_unattended_batch");
	if (!tool) throw new Error("start_unattended_batch was not registered");
	return tool;
}

function textOf(response: { content: Array<{ type: string; text: string }> }): string {
	return response.content.map((entry) => entry.text).join("\n");
}

/** Minimal TUI context: the native confirm surface resolves to one selection. */
function fakeTuiContext(root: string, selection: "confirm" | "decline" | "cancel"): unknown {
	return {
		cwd: root,
		mode: "tui",
		ui: { custom: async (factory: unknown) => {
			const done = (value: unknown) => value;
			void factory;
			return done(selection);
		} },
	};
}

describe("acc-pi-batch-gate", () => {
	it("registers start_unattended_batch tool in Pi extension factory", () => {
		const tools: Array<{ name: string; parameters?: unknown }> = [];
		registerBatchExtension({
			registerTool: (tool: { name: string; parameters?: unknown }) => tools.push(tool),
		} as unknown as ExtensionAPI);

		const batchTool = tools.find((t) => t.name === "start_unattended_batch");
		expect(batchTool).toBeDefined();
	});

	it("rejects non-interactive invocation with unsupported_host reason", async () => {
		const fixture = createBatchFixture("non-inter");
		const result = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "non-inter",
			interactive: false,
			readInitiative: async () => fixture.observation,
		});

		expect(result).toEqual({
			state: "rejected",
			reason: "interactive TUI elicitation is unavailable in non-interactive mode",
			recovery_action: "invoke through an interactive Pi TUI session in the current Host",
		});
	});

	it("renders confirmation details derived from projectBatchPlan and Kernel state", async () => {
		const fixture = createBatchFixture("content-derive");
		let capturedConfirmation: { title: string; summary: string; details: string; planDigest: string } | null = null;

		const result = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "content-derive",
			readInitiative: async () => fixture.observation,
			confirmBatch: async (details) => {
				capturedConfirmation = details;
				return "decline";
			},
		});

		expect(result.state).toBe("rejected");
		expect(result.reason).toBe("native interaction declined");
		expect(capturedConfirmation).not.toBeNull();
		const conf = capturedConfirmation!;
		expect(conf.title).toContain("Authorize Unattended Batch: content-derive");
		expect(conf.summary).toContain("Initiative: content-derive");
		expect(conf.summary).toContain("Batch branch: imm/content-derive");
		expect(conf.summary).toContain("Plan digest: sha256:");
		expect(conf.details).toContain("Ordered children (2):");
		expect(conf.details).toContain("content-derive-c1 (S1) [risk: routine]");
		expect(conf.details).toContain("content-derive-c2 (S2) [risk: material]");
		expect(conf.details).toContain("Excluded children:");
		expect(conf.details).toContain("content-derive-c3 (S3): critical");
	});

	it("rejects fail-closed with zero writes when confirmation port is missing or invalid", async () => {
		const fixture = createBatchFixture("missing-port");

		// 1. Missing confirmBatch port entirely
		const missingPort = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "missing-port",
			readInitiative: async () => fixture.observation,
		});

		expect(missingPort).toEqual({
			state: "rejected",
			reason: "native confirmation port is unavailable",
			recovery_action: "retry through a fresh native gate in the current Host",
		});
		assertZeroWrites(fixture.root, fixture.head, "missing-port");

		// 2. confirmBatch returns invalid / unexpected value
		const invalidDecision = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "missing-port",
			readInitiative: async () => fixture.observation,
			confirmBatch: async () => "unexpected" as never,
		});

		expect(invalidDecision.state).toBe("rejected");
		expect(invalidDecision.reason).toBe("native interaction returned no decision");
		assertZeroWrites(fixture.root, fixture.head, "missing-port");
	});

	it("decline produces zero Kernel writes, zero batch state, and no new Git ref", async () => {
		const fixture = createBatchFixture("decline-zero");
		const priorHead = fixture.head;

		const result = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "decline-zero",
			readInitiative: async () => fixture.observation,
			confirmBatch: async () => "decline",
		});

		expect(result).toEqual({
			state: "rejected",
			reason: "native interaction declined",
			recovery_action: "wait for a fresh literal-user request",
		});

		assertZeroWrites(fixture.root, priorHead, "decline-zero");
	});

	it("cancel produces zero writes and cancelled state", async () => {
		const fixture = createBatchFixture("cancel-zero");
		const priorHead = fixture.head;

		const result = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "cancel-zero",
			readInitiative: async () => fixture.observation,
			confirmBatch: async () => "cancel",
		});

		expect(result).toEqual({
			state: "cancelled",
			reason: "native interaction cancelled",
			recovery_action: "wait for a fresh literal-user request",
		});

		assertZeroWrites(fixture.root, priorHead, "cancel-zero");
	});

	it("active workspace claim blocks execution with state: blocked and zero writes", async () => {
		const fixture = createBatchFixture("active-claim");
		seedInFlightOwner(fixture.root, "in-flight-task");
		let dialogOpened = false;

		const result = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "active-claim",
			readInitiative: async () => fixture.observation,
			confirmBatch: async () => {
				dialogOpened = true;
				return "accept";
			},
		});

		expect(dialogOpened).toBe(false);
		expect(result.state).toBe("blocked");
		expect(result.reason).toContain("in-flight-task");
		expect(result.recovery_action).toContain("resolve or stop the active task");
		expect(existsSync(join(fixture.root, ".imm", "state", "batches"))).toBe(false);
	});

	it("failing branch preflight rejects with state: rejected and zero writes", async () => {
		const fixture = createBatchFixture("branch-preflight");
		execFileSync("git", ["branch", "imm/branch-preflight"], { cwd: fixture.root });
		let dialogOpened = false;

		const result = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "branch-preflight",
			readInitiative: async () => fixture.observation,
			confirmBatch: async () => {
				dialogOpened = true;
				return "accept";
			},
		});

		expect(dialogOpened).toBe(false);
		expect(result.state).toBe("rejected");
		expect(result.reason).toContain("branch refs/heads/imm/branch-preflight already exists");
		expect(result.recovery_action).toContain("delete or rename the conflicting branch");
		assertZeroWrites(fixture.root, fixture.head);
	});

	it("empty enrollable child set rejects with state: rejected and zero writes", async () => {
		const fixture = createBatchFixture("empty-enrollable");
		const observation: GithubInitiativeObservation = {
			contract: "immune_brain/github_initiative_observation/v1",
			initiative_id: "empty-enrollable",
			issue_number: 101,
			tasks: [
				{ task_id: "empty-enrollable-c3", slice_id: "S3", issue_number: 103, blocked_by: [] },
			],
		};
		let dialogOpened = false;

		const result = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "empty-enrollable",
			readInitiative: async () => observation,
			confirmBatch: async () => {
				dialogOpened = true;
				return "accept";
			},
		});

		expect(dialogOpened).toBe(false);
		expect(result.state).toBe("rejected");
		expect(result.reason).toContain("empty enrollable child set");
		expect(result.recovery_action).toContain("ensure the initiative has uncompleted, non-critical child tasks");
		assertZeroWrites(fixture.root, fixture.head, "empty-enrollable");
	});

	it("plan digest drift after confirmation rejects execution", async () => {
		const fixture = createBatchFixture("drift-plan");
		let confirmed = false;

		const result = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "drift-plan",
			readInitiative: async () => {
				if (confirmed) {
					// Mutate plan on disk before accept continues
					const c1Path = join(fixture.root, "docs", "plans", "drift-plan-c1.intent.json");
					const c1 = JSON.parse(readFileSync(c1Path, "utf8"));
					writeFileSync(c1Path, `${JSON.stringify({ ...c1, revision: 2 }, null, 2)}\n`);
				}
				return fixture.observation;
			},
			confirmBatch: async () => {
				confirmed = true;
				return "accept";
			},
		});

		expect(result.state).toBe("rejected");
		expect(result.reason).toContain("batch plan changed after native confirmation");
		expect(result.recovery_action).toContain("retry through a fresh native gate");
	});

	it("on accept, issues exactly one Batch Authorization and runs startBatch to completion", async () => {
		const fixture = createBatchFixture("accept-run");
		let lastCommit: string | null = null;

		const result = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "accept-run",
			readInitiative: async () => fixture.observation,
			batchKernel: {
				advanceTask: async () => {
					// Clear task claim as each child completes
					releaseWorkspaceForTest(fixture.root);
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
			confirmBatch: async () => "accept",
		});

		expect(result.state).toBe("started");
		expect(result.batch_id).toMatch(/^batch-accept-run-[0-9a-f-]{36}$/);
		expect(result.report).toBeDefined();
		expect(result.report.batch_state).toBe("completed");
		expect(result.report.commits.length).toBe(2);
	});

	it("TTL-1: authorization expiry is the confirmed budget deadline, not a fixed ten-minute window", async () => {
		const fixture = createBatchFixture("pi-ttl");
		let lastCommit: string | null = null;
		const confirmed: Array<{ summary: string }> = [];

		const result = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "pi-ttl",
			readInitiative: async () => fixture.observation,
			batchKernel: {
				advanceTask: async () => {
					// Clear task claim as each child completes
					releaseWorkspaceForTest(fixture.root);
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
			confirmBatch: async (details) => {
				confirmed.push(details);
				return "accept";
			},
		});
		expect(result.state).toBe("started");

		const state = JSON.parse(
			readFileSync(join(fixture.root, ".imm", "state", "batches", `${result.batch_id}.json`), "utf8"),
		);
		// The literal user confirmed exactly one deadline; the authorization expires with it.
		expect(state.authorization_expires_at).toBe(state.budget.deadline_at);
		// Regression guard: the authorization outlives a fixed ten-minute window.
		expect(Date.parse(state.authorization_expires_at) - Date.now()).toBeGreaterThan(10 * 60 * 1000);
		expect(confirmed[0]!.summary).toContain(`Expires at: ${state.authorization_expires_at}`);
	});

	it("review-2: cancellation right before batch execution produces cancelled state with zero writes", async () => {
		const fixture = createBatchFixture("cancel-pre-issue");
		const controller = new AbortController();

		const result = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "cancel-pre-issue",
			signal: controller.signal,
			readInitiative: async () => fixture.observation,
			confirmBatch: async () => {
				// Abort right before the issuance boundary
				controller.abort();
				return "accept";
			},
		});

		expect(result.state).toBe("cancelled");
		expect(result.reason).toContain("cancelled");
		expect(existsSync(join(fixture.root, ".imm", "state", "batch"))).toBe(false);
		const branchCheck = execFileSync("git", ["branch", "--list", "imm/cancel-pre-issue"], { cwd: fixture.root, encoding: "utf8" }).trim();
		expect(branchCheck).toBe("");
	});

	it("review-pi-batch-projection-scope: projectAssuranceForTask successfully projects existing enrolled records", async () => {
		const fixture = createBatchFixture("proj-scope");
		const { projectAssuranceForTask } = await import("../plugins/immune-brain/.pi-extension/runtime-stub");

		// The enrolled record lives in the store; the workspace itself stays free.
		const { readTaskIntent } = await import("../plugins/immune-brain/.pi-extension/runtime-stub");
		const read = await readTaskIntent(fixture.root, "proj-scope-c1", "docs/plans/proj-scope-c1.intent.json");
		seedKernelRunForTest(fixture.root, {
			task_id: "proj-scope-c1",
			record: {
				contract: "assurance_kernel/task_record/v4",
				task_id: "proj-scope-c1",
				git_base_head: fixture.head,
				baseline: `sha256:${"0".repeat(64)}`,
				intent_snapshot: read.intent,
				intent_ref: { path: "docs/plans/proj-scope-c1.intent.json", content_hash: read.content_hash },
				lifecycle: "active",
				artifact_state: "active",
				attestations: [],
				findings: [],
				history: [],
			},
		});

		const proj = await projectAssuranceForTask(fixture.root, "proj-scope-c1");
		expect(proj.error).toBeNull();
		expect(proj.projection.lifecycle).toBe("active");
	});

	it("review-pi-batch-review-handoff: batch pausing for review resumes under same batch identity", async () => {
		const fixture = createBatchFixture("review-resume");
		let lastCommit: string | null = null;
		let step = 0;

		const result1 = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "review-resume",
			readInitiative: async () => fixture.observation,
			batchKernel: {
				advanceTask: async () => {
					step++;
					if (step === 1) {
						// Pauses for review
						return { state: "review_ready", operation_id: "op-1", agent_params: { prompt: "review" } as never };
					}
					return { state: "completed" };
				},
				commitChild: async () => {
					// Simulate artifact freeze transition during review
					const activePath = join(fixture.root, "docs", "plans", "review-resume-c1.intent.json");
					const archiveDir = join(fixture.root, "docs", "plans", "archive");
					mkdirSync(archiveDir, { recursive: true });
					const archivePath = join(archiveDir, "review-resume-c1.intent.json");
					if (existsSync(activePath)) {
						renameSync(activePath, archivePath);
						const recPath = join(fixture.root, ".imm", "state", "tasks", "review-resume-c1.json");
						if (existsSync(recPath)) {
							const rec = JSON.parse(readFileSync(recPath, "utf8"));
							rec.intent_ref.path = "docs/plans/archive/review-resume-c1.intent.json";
							rec.artifact_state = "frozen";
							writeFileSync(recPath, JSON.stringify(rec, null, 2) + "\n");
						}
					}
					writeFileSync(join(fixture.root, "dummy.txt"), `${Date.now()}`);
					execFileSync("git", ["add", "-A"], { cwd: fixture.root });
					execFileSync("git", ["commit", "-q", "-m", "child commit with frozen artifacts"], { cwd: fixture.root });
					const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
					lastCommit = commit;
					return { commit };
				},
				lookupBatchCommit: async () => (lastCommit ? { commit: lastCommit } : null),
			},
			confirmBatch: async () => "accept",
		});

		expect(result1.state).toBe("started");
		expect(result1.report.batch_state).toBe("running");
		expect(result1.report.next_action).toContain("Submit the reserved foreground Review verdict");
		expect(result1.review_dispatch).toBeDefined();
		expect(result1.review_dispatch?.operation_id).toBe("op-1");
		expect(result1.review_dispatch?.agent_params).toBeDefined();
		const batchId = result1.batch_id;

		// Simulate in-flight staged changes strictly within authorized child scope (spec artifact)
		const inScopeSpecPath = join(fixture.root, "docs", "specs", "unattended-initiative-batch-run.spec.md");
		mkdirSync(join(fixture.root, "docs", "specs"), { recursive: true });
		writeFileSync(inScopeSpecPath, "# Staged in-flight spec modification\n");
		execFileSync("git", ["add", "docs/specs/unattended-initiative-batch-run.spec.md"], { cwd: fixture.root });

		// Resuming the same batch with frozen/archived child sidecar and in-flight authorized uncommitted changes must succeed!
		const result2 = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "review-resume",
			readInitiative: async () => fixture.observation,
			batchKernel: {
				advanceTask: async () => {
					releaseWorkspaceForTest(fixture.root);
					return { state: "completed" };
				},
				commitChild: async () => {
					writeFileSync(join(fixture.root, "dummy.txt"), `${Date.now()}`);
					execFileSync("git", ["add", "dummy.txt"], { cwd: fixture.root });
					execFileSync("git", ["commit", "-q", "-m", "child commit 2"], { cwd: fixture.root });
					const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
					lastCommit = commit;
					return { commit };
				},
				lookupBatchCommit: async () => (lastCommit ? { commit: lastCommit } : null),
			},
			confirmBatch: async () => "accept",
		});

		expect(result2.state).toBe("started");
		expect(result2.batch_id).toBe(batchId);
		expect(result2.report.batch_state).toBe("completed");
	});

	it("review-3: batch resumption succeeds with fresh future expiry even after prior expiry has elapsed", async () => {
		const fixture = createBatchFixture("expiry-resume");
		let lastCommit: string | null = null;
		let step = 0;

		const result1 = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "expiry-resume",
			readInitiative: async () => fixture.observation,
			batchKernel: {
				advanceTask: async () => {
					step++;
					if (step === 1) {
						return { state: "review_ready", operation_id: "op-exp", agent_params: { prompt: "review" } as never };
					}
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
			confirmBatch: async () => "accept",
		});

		expect(result1.state).toBe("started");
		const batchId = result1.batch_id;

		// Mutate the persisted batch state to have an expired authorization_expires_at (in the past)
		const batchStatePath = join(fixture.root, ".imm", "state", "batches", `${batchId}.json`);
		const batchState = JSON.parse(readFileSync(batchStatePath, "utf8"));
		batchState.authorization_expires_at = "2020-01-01T00:00:00.000Z";
		batchState.batch_state = "needs_human";
		const priorBytes = JSON.stringify(batchState, null, 2) + "\n";
		writeFileSync(batchStatePath, priorBytes);

		// If user declines, the persisted batch record must remain byte-for-byte unchanged!
		const declineResult = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "expiry-resume",
			readInitiative: async () => fixture.observation,
			confirmBatch: async () => "decline",
		});
		expect(declineResult.state).toBe("rejected");
		expect(readFileSync(batchStatePath, "utf8")).toBe(priorBytes);

		// Resuming the batch with new user confirmation must issue a fresh future expiry and complete!
		const result2 = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "expiry-resume",
			readInitiative: async () => fixture.observation,
			batchKernel: {
				advanceTask: async () => {
					releaseWorkspaceForTest(fixture.root);
					return { state: "completed" };
				},
				commitChild: async () => {
					writeFileSync(join(fixture.root, "dummy.txt"), `${Date.now()}`);
					execFileSync("git", ["add", "dummy.txt"], { cwd: fixture.root });
					execFileSync("git", ["commit", "-q", "-m", "child commit 2"], { cwd: fixture.root });
					const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
					lastCommit = commit;
					return { commit };
				},
				lookupBatchCommit: async () => (lastCommit ? { commit: lastCommit } : null),
			},
			confirmBatch: async () => "accept",
		});

		expect(result2.state).toBe("started");
		expect(result2.batch_id).toBe(batchId);
		expect(result2.report.batch_state).toBe("completed");
	});

	it("review-3: foreign claim on child task blocks resumption with zero writes", async () => {
		const fixture = createBatchFixture("foreign-claim");
		let lastCommit: string | null = null;
		let step = 0;

		const result1 = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "foreign-claim",
			readInitiative: async () => fixture.observation,
			batchKernel: {
				advanceTask: async () => {
					step++;
					if (step === 1) {
						return { state: "review_ready", operation_id: "op-fc", agent_params: { prompt: "review" } as never };
					}
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
			confirmBatch: async () => "accept",
		});

		expect(result1.state).toBe("started");

		// 1. Foreign claim case A: Same branch (imm/foreign-claim), same HEAD, empty history: [], but pending in batch state
		const batchStatePath = join(fixture.root, ".imm", "state", "batches", `${result1.batch_id}.json`);
		const batchState = JSON.parse(readFileSync(batchStatePath, "utf8"));
		batchState.children = batchState.children.map((c: any) => c.task_id === "foreign-claim-c1" ? { ...c, state: "pending" } : c);
		writeFileSync(batchStatePath, JSON.stringify(batchState, null, 2) + "\n");

		const child1RecordPath = join(fixture.root, ".imm", "state", "tasks", "foreign-claim-c1.json");
		if (existsSync(child1RecordPath)) {
			const record = JSON.parse(readFileSync(child1RecordPath, "utf8"));
			record.history = [];
			writeFileSync(child1RecordPath, JSON.stringify(record, null, 2) + "\n");
		}

		// Make the live owner foreign to this batch: its recorded lineage is not
		// any head the approved batch produced.
		makeOwnerForeignForTest(fixture.root, "foreign-claim-c1");

		const batchStateBefore = readFileSync(batchStatePath, "utf8");
		const headBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();

		// Resuming on same branch at same HEAD with foreign claim must fail closed with state: blocked!
		const result2 = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "foreign-claim",
			readInitiative: async () => fixture.observation,
			confirmBatch: async () => "accept",
		});

		expect(result2.state).toBe("blocked");
		expect(result2.reason).toContain("foreign-claim-c1");
		expect(readFileSync(batchStatePath, "utf8")).toBe(batchStateBefore);
		expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim()).toBe(headBefore);
	});

	it("review-3b: unproven enrolled/needs_human claim keeps resumption blocked with zero writes", async () => {
		const fixture = createBatchFixture("unproven-claim");
		let lastCommit: string | null = null;
		let step = 0;

		const result1 = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "unproven-claim",
			readInitiative: async () => fixture.observation,
			batchKernel: {
				advanceTask: async () => {
					step++;
					if (step === 1) {
						return { state: "review_ready", operation_id: "op-uc", agent_params: { prompt: "review" } as never };
					}
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
			confirmBatch: async () => "accept",
		});

		expect(result1.state).toBe("started");

		const batchStatePath = join(fixture.root, ".imm", "state", "batches", `${result1.batch_id}.json`);

		// Forge an independent claim that mirrors the Kernel's event-id derivation and
		// the task identity, but was created after the batch's last durable write.
		const batchUpdatedAt = JSON.parse(readFileSync(batchStatePath, "utf8")).updated_at;
		const foreignCreatedAt = new Date(Date.parse(batchUpdatedAt) + 1000).toISOString();
		forgeUnprovenClaimForTest(
			fixture.root,
			"unproven-claim-c1",
			`enroll-unproven-claim-c1-${foreignCreatedAt}`,
			foreignCreatedAt,
		);

		const headBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();

		for (const childState of ["enrolled", "needs_human"]) {
			const batchState = JSON.parse(readFileSync(batchStatePath, "utf8"));
			batchState.children = batchState.children.map((c: { task_id: string }) =>
				c.task_id === "unproven-claim-c1"
					? { ...c, state: childState, reason: childState === "needs_human" ? "parked for test" : null }
					: c,
			);
			const mutatedBytes = JSON.stringify(batchState, null, 2) + "\n";
			writeFileSync(batchStatePath, mutatedBytes);

			const result2 = await executePiUnattendedBatch({
				root: fixture.root,
				initiativeSlug: "unproven-claim",
				readInitiative: async () => fixture.observation,
				confirmBatch: async () => "accept",
			});

			expect(result2.state).toBe("blocked");
			expect(result2.reason).toContain("unproven-claim-c1");
			expect(readFileSync(batchStatePath, "utf8")).toBe(mutatedBytes);
			expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim()).toBe(headBefore);
		}
	});

	it("corrupt batch state fails closed with zero writes", async () => {
		const fixture = createBatchFixture("corrupt-batch");
		const headBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
		const batchesDir = join(fixture.root, ".imm", "state", "batches");
		mkdirSync(batchesDir, { recursive: true });
		writeFileSync(join(batchesDir, "batch-corrupt-batch-123.json"), "{ not valid json");

		const result = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "corrupt-batch",
			readInitiative: async () => fixture.observation,
			confirmBatch: async () => "accept",
		});

		expect(result.state).toBe("blocked");
		expect(result.reason).toContain("unreadable or invalid");
		expect(result.recovery_action).toContain("resolve or remove");
		expect(existsSync(join(fixture.root, ".imm", "state", "tasks"))).toBe(false);
		expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim()).toBe(headBefore);
	});

	it("review-1: shared progression retains review reservation for foreground submit_review", async () => {
		const { getSharedPiProgression } = await import("../plugins/immune-brain/.pi-extension/runtime-stub");
		const progression1 = await getSharedPiProgression();
		const progression2 = await getSharedPiProgression();
		expect(progression1).toBe(progression2);
	});

	it("native-decline-unreachable: dialog exposes decline; mapping covers cancel and Escape with zero writes", async () => {
		const { mapDialogSelection } = await import("../plugins/immune-brain/.pi-extension/imm-unattended-batch");
		const fixture = createBatchFixture("native-decline");
		const headBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();

		// The registered dialog exposes three actions; the mapping is the testable
		// unit because the dialog sits behind plan projection. Escape is cancel.
		expect(mapDialogSelection("confirm")).toBe("accept");
		expect(mapDialogSelection("decline")).toBe("decline");
		expect(mapDialogSelection("cancel")).toBe("cancel");
		expect(mapDialogSelection(undefined)).toBe("cancel");

		// The tool registers the start_unattended_batch entry.
		const tools: Array<{ name: string }> = [];
		registerBatchExtension({ registerTool: (tool: { name: string }) => tools.push(tool) } as unknown as ExtensionAPI);
		expect(tools.some((t) => t.name === "start_unattended_batch")).toBe(true);

		// The mapped decisions flow into the gate the same suite exercises directly;
		// here we assert those outcomes plus zero writes end to end.
		const declineResult = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "native-decline",
			readInitiative: async () => fixture.observation,
			confirmBatch: async () => mapDialogSelection("decline"),
		});
		expect(declineResult.state).toBe("rejected");
		expect(declineResult.reason).toContain("native interaction declined");

		const escapeResult = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "native-decline",
			readInitiative: async () => fixture.observation,
			confirmBatch: async () => mapDialogSelection(undefined),
		});
		expect(escapeResult.state).toBe("cancelled");
		expect(escapeResult.reason).toContain("native interaction cancelled");

		expect(existsSync(join(fixture.root, ".imm", "state", "batches"))).toBe(false);
		expect(existsSync(join(fixture.root, ".imm", "state", "tasks"))).toBe(false);
		expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim()).toBe(headBefore);
	});

	it("frozen-child-risk-fallback: archived routine sidecar keeps routine risk in resume confirmation", async () => {
		const fixture = createBatchFixture("frozen-risk");
		let lastCommit: string | null = null;
		let step = 0;

		const result1 = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "frozen-risk",
			readInitiative: async () => fixture.observation,
			batchKernel: {
				advanceTask: async () => {
					step++;
					if (step === 1) return { state: "review_ready", operation_id: "op-fr", agent_params: { prompt: "review" } as never };
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
			confirmBatch: async () => "accept",
		});

		expect(result1.state).toBe("started");

		// Simulate a real freeze before the first resume: the child sidecar is moved
		// to archive and the relocation is staged (Kernel-owned artifact transition).
		const activePath = join(fixture.root, "docs", "plans", "frozen-risk-c1.intent.json");
		const archiveDir = join(fixture.root, "docs", "plans", "archive");
		mkdirSync(archiveDir, { recursive: true });
		renameSync(activePath, join(archiveDir, "frozen-risk-c1.intent.json"));
		execFileSync("git", ["add", "-A"], { cwd: fixture.root });

		// An intact, still-binding authorization is reused without a second gate, so
		// expire the persisted one to keep this resume re-confirming.
		const batchStatePath = join(fixture.root, ".imm", "state", "batches", `${result1.batch_id}.json`);
		const batchState = JSON.parse(readFileSync(batchStatePath, "utf8"));
		batchState.authorization_expires_at = "2020-01-01T00:00:00.000Z";
		writeFileSync(batchStatePath, `${JSON.stringify(batchState, null, 2)}\n`);

		let capturedConfirmation: { details: string } | null = null;
		const result2 = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "frozen-risk",
			readInitiative: async () => fixture.observation,
			confirmBatch: async (details) => {
				capturedConfirmation = details;
				return "decline";
			},
		});

		expect(result2.state).toBe("rejected");
		expect(capturedConfirmation).not.toBeNull();
		// The routine child must keep its real risk; a stale reconstructed path must
		// never fabricate "material".
		expect(capturedConfirmation!.details).toContain("frozen-risk-c1 (S1) [risk: routine]");
		expect(capturedConfirmation!.details).not.toContain("frozen-risk-c1 (S1) [risk: material]");
	});

	it("review-pi-batch-package-runtime: package.json files whitelist includes runtime/unattended", async () => {
		const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
		expect(pkg.files).toContain("plugins/immune-brain/runtime/unattended");
		const mod = await import("../plugins/immune-brain/runtime/unattended/batch_plan");
		expect(mod.projectBatchPlan).toBeDefined();

		const piExtPkg = JSON.parse(
			readFileSync(join(process.cwd(), "plugins/immune-brain/.pi-extension/package.json"), "utf8"),
		);
		expect(piExtPkg.pi?.extensions).toContain("./imm-unattended-batch.ts");
	});

	// review-f72ae870f4f0-2: the Parent consumes the model-visible content, so the
	// full structured result must reach it through the registered Tool, not only
	// through Tool details. These tests drive the registered Tool `execute`.
	it("review-tool-content-review-dispatch: registered Tool content carries report and review_dispatch", async () => {
		const fixture = createBatchFixture("tool-content-review");
		let lastCommit: string | null = null;
		let step = 0;

		const tool = registerBatchTool({
			readInitiative: async () => fixture.observation,
			batchKernel: {
				advanceTask: async () => {
					step++;
					if (step === 1) return { state: "review_ready", operation_id: "op-content", agent_params: { prompt: "review" } as never };
					return { state: "completed" };
				},
				commitChild: async () => {
					writeFileSync(join(fixture.root, "dummy.txt"), `${Date.now()}`);
					execFileSync("git", ["add", "dummy.txt"], { cwd: fixture.root });
					execFileSync("git", ["commit", "-q", "-m", "tool content commit"], { cwd: fixture.root });
					lastCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
					return { commit: lastCommit };
				},
				lookupBatchCommit: async () => (lastCommit ? { commit: lastCommit } : null),
			},
		});

		const response = await tool.execute("tool-call-content", { initiative_slug: "tool-content-review" }, undefined, undefined, fakeTuiContext(fixture.root, "confirm"));
		const content = JSON.parse(textOf(response));

		expect(content.state).toBe("started");
		expect(content.report.batch_state).toBe("running");
		expect(content.review_dispatch.operation_id).toBe("op-content");
		expect(content.review_dispatch.agent_params.prompt).toBe("review");
		expect(content.report.next_action).toContain("Review");
	});

	it("review-tool-content-needs-human: registered Tool content exposes the parked reason", async () => {
		const fixture = createBatchFixture("tool-content-parked");

		const tool = registerBatchTool({
			readInitiative: async () => fixture.observation,
			batchKernel: {
				advanceTask: async () => ({ state: "failed", reason: "projection unavailable" }),
			},
		});

		const response = await tool.execute("tool-call-parked", { initiative_slug: "tool-content-parked" }, undefined, undefined, fakeTuiContext(fixture.root, "confirm"));
		const content = JSON.parse(textOf(response));

		expect(content.state).toBe("started");
		expect(content.report.batch_state).toBe("needs_human");
		expect(content.report.children.some((child: { reason: string | null }) => (child.reason ?? "").includes("projection unavailable"))).toBe(true);
		expect(content.report.next_action.length).toBeGreaterThan(0);
	});
});

describe("settled-child resume preflight", () => {
	it("review-settled-child-resume-scope: resumes a settled child with legitimate staged in-scope work", async () => {
		const fixture = createBatchFixture("settled-scope");
		// Give the child an in-scope source path so its staged work is legitimate.
		const c1IntentPath = join(fixture.root, "docs", "plans", "settled-scope-c1.intent.json");
		const c1Intent = JSON.parse(readFileSync(c1IntentPath, "utf8"));
		c1Intent.scope_hint = [...c1Intent.scope_hint, "src/impl.ts"];
		writeFileSync(c1IntentPath, `${JSON.stringify(c1Intent, null, 2)}\n`);
		execFileSync("git", ["add", c1IntentPath], { cwd: fixture.root });
		execFileSync("git", ["commit", "-q", "-m", "widen child scope"], { cwd: fixture.root });

		let step = 0;
		let lastCommit: string | null = null;

		// First run pauses on the reserved Review, so the child stays in-flight.
		const first = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "settled-scope",
			readInitiative: async () => fixture.observation,
			batchKernel: {
				advanceTask: async () => {
					step++;
					if (step === 1) return { state: "review_ready", operation_id: "op-settled", agent_params: { prompt: "review" } as never };
					return { state: "completed" };
				},
				commitChild: async () => {
					writeFileSync(join(fixture.root, "dummy.txt"), `${Date.now()}`);
					execFileSync("git", ["add", "dummy.txt"], { cwd: fixture.root });
					execFileSync("git", ["commit", "-q", "-m", "settled commit"], { cwd: fixture.root });
					lastCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
					return { commit: lastCommit };
				},
				lookupBatchCommit: async () => (lastCommit ? { commit: lastCommit } : null),
			},
			confirmBatch: async () => "accept",
		});
		expect(first.state).toBe("started");

		// The Kernel settles the child before the batch commits it: the terminal run
		// replaces the active owner, and only the immutable audit pair remains as
		// tracked evidence (staged, because terminal evidence is Git-tracked).
		settleOwnerForTest(fixture.root, "settled-scope-c1");
		execFileSync("git", ["add", ".imm/audit"], { cwd: fixture.root });

		const batchPath = join(fixture.root, ".imm", "state", "batches", `${first.batch_id}.json`);
		const batchRecord = JSON.parse(readFileSync(batchPath, "utf8"));
		batchRecord.children = batchRecord.children.map((child: { task_id: string }) => child.task_id === "settled-scope-c1" ? { ...child, state: "settled" } : child);
		writeFileSync(batchPath, `${JSON.stringify(batchRecord, null, 2)}\n`);

		// A legitimate in-scope staged change from the settled child.
		mkdirSync(join(fixture.root, "src"), { recursive: true });
		writeFileSync(join(fixture.root, "src", "impl.ts"), "export const impl = 7; // settled work\n");
		execFileSync("git", ["add", "src/impl.ts"], { cwd: fixture.root });

		const resumed = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: "settled-scope",
			readInitiative: async () => fixture.observation,
			batchKernel: {
				advanceTask: async () => ({ state: "completed" }),
				commitChild: async () => {
					execFileSync("git", ["add", "-A"], { cwd: fixture.root });
					execFileSync("git", ["commit", "-q", "-m", "settled resume commit"], { cwd: fixture.root });
					lastCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
					return { commit: lastCommit };
				},
				lookupBatchCommit: async () => (lastCommit ? { commit: lastCommit } : null),
			},
			confirmBatch: async () => "accept",
		});

		// A settled child's staged in-scope work must not be misread as out-of-scope.
		expect(resumed.state).toBe("started");
	});
});

describe("batch authorization reuse (ADR-0005 Decision 1)", () => {
	/** Round 1 leaves a running batch whose child paused for foreground Review. */
	async function startRunningBatch(slug: string) {
		const fixture = createBatchFixture(slug);
		let lastCommit: string | null = null;
		let step = 0;
		const result = await executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: slug,
			readInitiative: async () => fixture.observation,
			batchKernel: {
				advanceTask: async () => {
					step++;
					if (step === 1) return { state: "review_ready", operation_id: "op-reuse", agent_params: { prompt: "review" } as never };
					return { state: "completed" };
				},
				commitChild: async () => {
					writeFileSync(join(fixture.root, "dummy.txt"), `${Date.now()}`);
					execFileSync("git", ["add", "dummy.txt"], { cwd: fixture.root });
					execFileSync("git", ["commit", "-q", "-m", "child commit"], { cwd: fixture.root });
					lastCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
					return { commit: lastCommit };
				},
				lookupBatchCommit: async () => (lastCommit ? { commit: lastCommit } : null),
			},
			confirmBatch: async () => "accept",
		});
		if (result.state !== "started") throw new Error(`batch did not start: ${JSON.stringify(result)}`);
		return { fixture, batchId: result.batch_id };
	}

	/** Round 2: resume, completing the batch unless the confirmation declines. */
	async function resumeBatch(
		fixture: { root: string; observation: GithubInitiativeObservation },
		slug: string,
		confirmBatch: (details: { details: string }) => Promise<"accept" | "decline" | "cancel">,
	) {
		let lastCommit: string | null = null;
		return executePiUnattendedBatch({
			root: fixture.root,
			initiativeSlug: slug,
			readInitiative: async () => fixture.observation,
			batchKernel: {
				advanceTask: async () => {
					releaseWorkspaceForTest(fixture.root);
					return { state: "completed" };
				},
				commitChild: async () => {
					writeFileSync(join(fixture.root, "dummy.txt"), `${Date.now()}`);
					execFileSync("git", ["add", "dummy.txt"], { cwd: fixture.root });
					execFileSync("git", ["commit", "-q", "-m", "child commit 2"], { cwd: fixture.root });
					lastCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
					return { commit: lastCommit };
				},
				lookupBatchCommit: async () => (lastCommit ? { commit: lastCommit } : null),
			},
			confirmBatch,
		});
	}

	function rewriteBatchState(root: string, batchId: string, mutate: (state: Record<string, any>) => void): void {
		const path = join(root, ".imm", "state", "batches", `${batchId}.json`);
		const state = JSON.parse(readFileSync(path, "utf8"));
		mutate(state);
		writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
	}

	it("reuses an intact, still-binding authorization with zero additional native gates", async () => {
		const { fixture, batchId } = await startRunningBatch("reuse-intact");
		const gates: string[] = [];
		const resumed = await resumeBatch(fixture, "reuse-intact", async (details) => {
			gates.push(details.details);
			return "accept";
		});

		if (resumed.state !== "started") console.log("BLOCKED2:", JSON.stringify(resumed).slice(0, 400));
		expect(gates).toEqual([]);
		expect(resumed.state).toBe("started");
		expect(resumed.batch_id).toBe(batchId);
		expect(resumed.report.batch_state).toBe("completed");
	});

	it("demands a fresh gate when the authorization expired, naming the reason", async () => {
		const { fixture, batchId } = await startRunningBatch("reuse-expired");
		rewriteBatchState(fixture.root, batchId, (state) => {
			state.authorization_expires_at = "2020-01-01T00:00:00.000Z";
		});

		const gates: string[] = [];
		const declined = await resumeBatch(fixture, "reuse-expired", async (details) => {
			gates.push(details.details);
			return "decline";
		});

		expect(gates).toHaveLength(1);
		expect(gates[0]).toContain("batch_authorization_expired");
		expect(gates[0]).toContain("Recovery: confirm to issue a fresh authorization");
		expect(declined.state).toBe("rejected");
		expect(declined.reason).toBe("native interaction declined");
		expect(declined.recovery_action).toBe("wait for a fresh literal-user request");
	});

	it("demands a fresh gate when the HEAD lineage moved, then fails closed on the drift", async () => {
		const { fixture } = await startRunningBatch("reuse-head");
		writeFileSync(join(fixture.root, "outside.txt"), "external commit\n");
		execFileSync("git", ["add", "outside.txt"], { cwd: fixture.root });
		execFileSync("git", ["commit", "-q", "-m", "external commit"], { cwd: fixture.root });

		const gates: string[] = [];
		const resumed = await resumeBatch(fixture, "reuse-head", async (details) => {
			gates.push(details.details);
			return "accept";
		});

		expect(gates).toHaveLength(1);
		expect(gates[0]).toContain("batch_head_lineage_moved");
		expect(resumed.state).toBe("started");
		expect(resumed.report.batch_state).toBe("failed");
		expect(String(resumed.report.reason)).toContain("lineage");
	});

	it("demands a fresh gate when the persisted plan digest no longer binds", async () => {
		const { fixture, batchId } = await startRunningBatch("reuse-digest");
		rewriteBatchState(fixture.root, batchId, (state) => {
			state.plan_digest = `sha256:${"0".repeat(64)}`;
		});

		const gates: string[] = [];
		let failure: string | null = null;
		try {
			const resumed = await resumeBatch(fixture, "reuse-digest", async (details) => {
				gates.push(details.details);
				return "accept";
			});
			failure = resumed.state === "rejected" ? resumed.reason : "a drifted plan resumed instead of failing closed";
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		}

		expect(gates).toHaveLength(1);
		expect(gates[0]).toContain("batch_plan_digest_changed");
		expect(String(failure)).toContain("plan_digest mismatch");
	});

	it("demands a fresh gate for a parked batch, which then resumes on the newer confirmation", async () => {
		const { fixture, batchId } = await startRunningBatch("reuse-parked");
		rewriteBatchState(fixture.root, batchId, (state) => {
			state.batch_state = "needs_human";
		});

		const gates: string[] = [];
		const resumed = await resumeBatch(fixture, "reuse-parked", async (details) => {
			gates.push(details.details);
			return "accept";
		});

		expect(gates).toHaveLength(1);
		expect(gates[0]).toContain("batch_not_running");
		expect(resumed.state).toBe("started");
		expect(resumed.report.batch_state).toBe("completed");
	});
});
