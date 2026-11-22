/**
 * Loop Daemon: Background Jobs and Drive Re-entry (S6)
 *
 * Verifies S6-AC1, S6-AC2 and S6-AC3 under
 * docs/plans/loop-sched-s6-async-drive.intent.json and D6 in
 * docs/specs/loop-agent-scheduling.spec.md.
 *
 * - Positive Control (BR-SCN-6): an approved task's drive outlives the tick, a
 *   later tick observes E13 `lane_settled` from the job store, and `open_pr`
 *   opens the pull request with no second approval; re-entry of an enrolled,
 *   nonterminal task resumes instead of enrolling again.
 * - Negative Control: a settlement with no commit digest opens no PR and records
 *   `failed`; no enrollment is attempted for a task whose TaskRecord exists; the
 *   next agent candidate is held while `max_concurrent` jobs run.
 * - Bound: a job whose pid is dead with no outcome is `lost`, restarted once and
 *   escalated the second time; the lease is released only when the job record is
 *   terminal.
 *
 * The fake Lane settles only when the test says so, which is what makes "after
 * more than one tick" observable instead of instant.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_LOOP_CONFIG, type LoopConfig } from "../plugins/immune-brain/runtime/config/layered_config.ts";
import type { GhExecution, GhTransport } from "../plugins/immune-brain/runtime/github_issue_tracker.ts";
import {
	LOOP_PLAN_PUBLICATION_CONTRACT,
	createAgentHandlerPort,
	writePlanPublication,
	type AgentDriveRequest,
	type AgentDriveResult,
	type AgentEnrollRequest,
	type AgentHandlerDeps,
	type AgentHandlerPort,
} from "../plugins/immune-brain/runtime/loop_daemon/agent_handlers.ts";
import { runLoopDaemonCli } from "../plugins/immune-brain/runtime/loop_daemon/cli.ts";
import { dispatchDecisions } from "../plugins/immune-brain/runtime/loop_daemon/dispatch.ts";
import { eventTarget } from "../plugins/immune-brain/runtime/loop_daemon/guards.ts";
import { laneDeliveryEvidence } from "../plugins/immune-brain/runtime/unattended/batch_preflight.ts";
import {
	prepareBatchLaneRunState,
	writeBatchLaneRunState,
} from "../plugins/immune-brain/runtime/unattended/batch_state.ts";
import type { LoopGitHubPort } from "../plugins/immune-brain/runtime/loop_daemon/github_port.ts";
import {
	LOOP_JOB_MAX_ATTEMPTS,
	loopJobEvents,
	readLoopJob,
	reconcileLoopJobs,
	recordSettledLane,
	startLoopJob,
	type LoopJobExit,
} from "../plugins/immune-brain/runtime/loop_daemon/jobs.ts";
import { judgeEvents, type ClassifyFn } from "../plugins/immune-brain/runtime/loop_daemon/judgement.ts";
import { scheduleLoopWork } from "../plugins/immune-brain/runtime/loop_daemon/scheduler.ts";
import { initLoopState, listLeases, loadLoopDispatches } from "../plugins/immune-brain/runtime/loop_daemon/state.ts";
import {
	LOOP_DAEMON_EVENT_CONTRACT,
	type NormalizedLoopEvent,
	type ObservationInput,
} from "../plugins/immune-brain/runtime/loop_daemon/types.ts";
import { enrollTaskForTest } from "./helpers/kernel-enroll.ts";

const TS = "2026-01-01T00:00:00.000Z";
const COMMIT_SHA = "a".repeat(40);
const TASK_ID = "widget-task";

const cleanups: Array<() => void> = [];
afterEach(() => {
	while (cleanups.length > 0) cleanups.pop()!();
});

function makeWorkspace(loop: Record<string, unknown> = {}): { root: string; stateDir: string } {
	const root = mkdtempSync(join(tmpdir(), "loop-s6-async-drive-"));
	cleanups.push(() => rmSync(root, { recursive: true, force: true }));
	execFileSync("git", ["init", "-q", root]);
	execFileSync("git", ["config", "user.name", "Immune Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "test@immune-brain.internal"], { cwd: root });

	mkdirSync(join(root, ".imm/state/loop"), { recursive: true });
	mkdirSync(join(root, "docs/agents"), { recursive: true });
	mkdirSync(join(root, "src"), { recursive: true });
	writeFileSync(join(root, "src/widget.ts"), "export const widget = 1;\n");
	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	writeFileSync(
		join(root, ".imm/config.json"),
		`${JSON.stringify({
			contract: "immune_brain/project_config/v2",
			loop: { mode: "assist", allowed_actors: ["owner"], allowed_associations: ["OWNER"], ...loop },
		})}\n`,
	);
	execFileSync("git", ["add", ".gitignore", ".imm/config.json", "src/widget.ts"], {
		cwd: root,
	});
	execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });

	return { root, stateDir: join(root, ".imm/state/loop") };
}

function mockGh(): GhTransport {
	return {
		async run(_args): Promise<GhExecution> {
			return { status: 0, stdout: "", stderr: "" };
		},
	};
}

function makeFakeGitHubPort(): LoopGitHubPort & { upserts: Array<{ head: string; body: string }> } {
	const upserts: Array<{ head: string; body: string }> = [];
	return {
		upserts,
		async postComment() {
			return { id: 9001 };
		},
		async editComment() {},
		async createIssue() {
			return { number: 999 };
		},
		async editIssue() {},
		async upsert(input: { head: string; body: string }) {
			upserts.push({ head: input.head, body: input.body });
			return { number: 200, url: "https://example.test/pr/200", created: true };
		},
		async markPrReady() {},
	};
}

/** Tier-2 classification is not this slice's subject: every point stays unavailable. */
const offlineClassifier: ClassifyFn = async () => ({
	status: "unavailable",
	reason: "no_local_config",
	detail: "s6 async-drive test",
});

function publishPlan(root: string, issueNumber: number, digest: string): void {
	writePlanPublication(join(root, ".imm/state/loop"), {
		contract: LOOP_PLAN_PUBLICATION_CONTRACT,
		issue_number: issueNumber,
		branch: `imm-loop/issue-${issueNumber}`,
		worktree_path: root,
		digest,
		requires_owner_approval: true,
		intents: [
			{
				path: `docs/plans/${TASK_ID}.intent.json`,
				task_id: TASK_ID,
				content_hash: `sha256:${"c".repeat(64)}`,
				risk: "routine",
			},
		],
		task_id: TASK_ID,
		comment_body: "plan",
		drafted_at: TS,
		published_at: TS,
		published_comment_id: 4242,
	});
}

function writeIntent(root: string, taskId = TASK_ID): void {
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	writeFileSync(
		join(root, "docs/plans", `${taskId}.intent.json`),
		`${JSON.stringify({
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Deliver the widget task",
			acceptance: [{ id: "AC1", assertion: "the widget works", verification: "bun test" }],
			scope_hint: [`docs/plans/${taskId}.intent.json`, "src/widget.ts"],
			risk: "routine",
			revision: 1,
		})}\n`,
	);
}

function readyIssue(number: number, overrides: Record<string, unknown> = {}) {
	return {
		id: number,
		number,
		title: `Issue ${number}`,
		body: `<!-- immune-brain:task-id=${TASK_ID} -->`,
		state: "open" as const,
		created_at: TS,
		updated_at: TS,
		author: { login: "owner" },
		labels: [{ name: "ready-for-agent" }],
		...overrides,
	};
}

function snapshot(overrides: Partial<ObservationInput> = {}): ObservationInput {
	return { issues: [], pull_requests: [], observed_at: TS, ...overrides };
}

interface FakeLane {
	port: AgentHandlerPort;
	/** One entry per `enroll_and_drive` the daemon handed this port. */
	handled: Array<{ issue_number: number; task_id: string; job_id: string }>;
	/** The delivery the last settle seeded, when it seeded one. */
	lastDelivery: { commit: string; digest: string } | null;
	/** Settle the Nth started job the way the Batch Record plus `.imm/audit/` prove it. */
	settle(index: number, options?: { skipEvidence?: boolean }): Promise<void>;
}

/** S8: seed a settled delivery — a completed v3 record plus the tracked audit pair. */
function seedAsyncDelivery(root: string, taskId: string): { commit: string; digest: string } {
	const runId = "run-async-seed";
	const auditDir = join(root, ".imm", "audit", taskId, runId);
	mkdirSync(auditDir, { recursive: true });
	const recordJson = `${JSON.stringify({ contract: "assurance_kernel/task_record/v4", task_id: taskId })}\n`;
	const proofJson = `${JSON.stringify({ contract: "assurance_kernel/task_tombstone/v2", task_id: taskId, terminal_lifecycle: "done" })}\n`;
	writeFileSync(join(auditDir, "task-record.json"), recordJson);
	writeFileSync(join(auditDir, "terminal-proof.json"), proofJson);
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "--no-verify", "-qm", `deliver ${taskId}`], { cwd: root });
	const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
	const prepared = prepareBatchLaneRunState({
		batch_id: `batch-${taskId}`,
		initiative_slug: taskId,
		children: [{ task_id: taskId, slice_id: taskId, blocked_by: [], status: "enrollable", reason: null,
			intent_path: `docs/plans/${taskId}.intent.json`, intent_revision: 1, intent_content_hash: "sha256:x" }],
		plan_digest: "sha256:plan",
		base_head: "0".repeat(40),
		confirmation_time: "2026-01-01T00:00:00.000Z",
		budget: { max_children: 1, qa_failure_limit: 1 },
		max_parallel: 1,
		now: "2026-01-01T00:00:00.000Z",
	});
	writeBatchLaneRunState(root, {
		...prepared,
		batch_state: "completed",
		children: [{ task_id: taskId, slice_id: taskId, blocked_by: [], state: "integrated", reason: null, commit,
			lane: { path: join(root, "lane"), branch: `imm-lane/${taskId}/${taskId}`, base_head: commit, lane_commit: commit },
			qa_failures: 0, session: null }],
		commits: [commit],
	});
	return { commit, digest: `sha256:${createHash("sha256").update(`${recordJson}\n${proofJson}`).digest("hex")}` };
}

/**
 * A fake Lane: it starts a real job record and holds its work until the test
 * settles it, so the tick that started it returns first.
 */
function makeFakeLane(root: string, stateDir: string, options: { issueNumbers?: number[] } = {}): FakeLane {
	const handled: FakeLane["handled"] = [];
	const settleFns: Array<(finalCommitSha: string | null) => void> = [];

	const port: AgentHandlerPort = {
		async handle(handler, context) {
			if (handler !== "enroll_and_drive") return { outcome: "failed", detail: `unexpected handler ${handler}` };
			const event = context.event as { issue_number?: number; task_id?: string } | undefined;
			const issueNumber = event?.issue_number ?? 0;
			if (options.issueNumbers && !options.issueNumbers.includes(issueNumber)) {
				return { outcome: "failed", detail: `issue ${issueNumber} is not this fake Lane's` };
			}
			// The fixture drives one task; E1 carries no `task_id` of its own.
			const taskId = event?.task_id ?? TASK_ID;
			const work = new Promise<{ outcome: "settled"; detail: string; exit: LoopJobExit | null }>((resolve) => {
				settleFns.push(() => {
					const delivery = laneDeliveryEvidence(context.root, taskId);
					if (!delivery.ok) {
						resolve({ outcome: "settled", detail: `lane settled without evidence: ${delivery.reason}`, exit: null });
						return;
					}
					resolve({
						outcome: "settled",
						detail: "lane settled",
						exit: {
							state: "exited",
							exit_code: 0,
							generation: 1,
							final_commit_sha: delivery.commit,
							verification_evidence_digest: delivery.digest,
						},
					});
				});
			});
			const job = startLoopJob(
				context.stateDir,
				{
					kind: "drive",
					target_id: `issue-${issueNumber}`,
					task_id: taskId,
					issue_number: issueNumber,
					expected_output: "executor_exit_record",
					now: context.now,
				},
				() => work,
			);
			handled.push({ issue_number: issueNumber, task_id: taskId, job_id: job.job_id });
			return { outcome: "executed", detail: `started drive job ${job.job_id} for ${taskId} via tracker_approval` };
		},
	};

	return {
		port,
		handled,
		lastDelivery: null as FakeLane["lastDelivery"],
		async settle(index, settleOptions = {}) {
			const settle = settleFns[index];
			if (!settle) throw new Error(`no job ${index} to settle`);
			if (!settleOptions.skipEvidence) {
				this.lastDelivery = seedAsyncDelivery(root, TASK_ID);
			}
			settle(undefined as never);
			await waitForTerminalJob(stateDir, handled[index]!.job_id);
		},
	};
}

async function waitForTerminalJob(stateDir: string, targetId: string): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		const job = readLoopJob(stateDir, targetId);
		if (job && job.outcome !== null) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`job ${targetId} never reached a terminal outcome`);
}

async function tick(root: string, port: AgentHandlerPort, overrides: Partial<ObservationInput> = {}) {
	const result = await runLoopDaemonCli(["tick", "--json"], root, {
		gh: mockGh(),
		gitHubPort: makeFakeGitHubPort(),
		classify: offlineClassifier,
		guardFacts: { daemon_identity: "imm-bot" },
		snapshotOverride: snapshot(overrides),
		agentPort: port,
		standingDaemon: true,
	});
	expect(result.returncode).toBe(0);
	return JSON.parse(result.stdout) as {
		decisions: Array<{ event_id: string; handler: string; reason: string }>;
		dispatches: Array<{ handler: string; outcome: string; detail: string }>;
	};
}

describe("S6-AC1: a drive outlives the tick and E13 opens the PR", () => {
	it("settles after more than one tick, then opens the PR with no second approval", async () => {
		const ws = makeWorkspace();
		publishPlan(ws.root, 10, "sha256:published-plan");
		writeIntent(ws.root);
		const lane = makeFakeLane(ws.root, ws.stateDir);

		// Tick 1: the ready label is the approval signal; the drive starts as a job.
		const first = await tick(ws.root, lane.port, { issues: [readyIssue(10)] });
		const started = first.dispatches.filter((dispatch) => dispatch.outcome === "executed");
		expect(started).toHaveLength(1);
		expect(started[0]).toMatchObject({ handler: "enroll_and_drive" });
		expect(lane.handled).toHaveLength(1);

		// The tick returned while the job runs: nonterminal record, lease still held.
		expect(readLoopJob(ws.stateDir, "issue-10")?.outcome).toBeNull();
		expect(listLeases(ws.stateDir).map((lease) => lease.target_id)).toEqual(["issue-10"]);
		expect(laneDeliveryEvidence(ws.root, TASK_ID).ok).toBe(false);

		// A later tick before the Lane settles: still nothing to open.
		const second = await tick(ws.root, lane.port, { issues: [readyIssue(10)] });
		expect(second.dispatches).toHaveLength(0);
		expect(lane.handled).toHaveLength(1);

		// The Lane settles with the commit and verification the projection reports.
		await lane.settle(0);

		// The next tick observes E12/E13 and opens the PR with no second approval.
		const third = await tick(ws.root, lane.port, { issues: [readyIssue(10)] });
		expect(third.decisions.map((decision) => decision.handler)).toContain("open_pr");
		expect(third.dispatches).toHaveLength(1);
		expect(third.dispatches[0]).toMatchObject({ handler: "open_pr", outcome: "executed" });
		expect(third.dispatches[0]!.detail).toContain(`commit: ${lane.lastDelivery!.commit}`);
		expect(lane.handled).toHaveLength(1);

		const delivery = laneDeliveryEvidence(ws.root, TASK_ID);
		expect(delivery).toMatchObject({ ok: true });
		if (delivery.ok) {
			expect(delivery.commit).toBe(lane.lastDelivery!.commit);
			expect(delivery.digest).toBe(lane.lastDelivery!.digest);
			expect(delivery.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
		}

		// The lease is released only once the job record is terminal.
		expect(listLeases(ws.stateDir)).toHaveLength(0);
	});

	it("opens no PR and records failed when the settlement carries no commit digest", async () => {
		const ws = makeWorkspace();
		publishPlan(ws.root, 11, "sha256:published-plan-11");
		writeIntent(ws.root);
		const lane = makeFakeLane(ws.root, ws.stateDir);
		const gitHubPort = makeFakeGitHubPort();

		const run = () =>
			runLoopDaemonCli(["tick", "--json"], ws.root, {
				gh: mockGh(),
				gitHubPort,
				classify: offlineClassifier,
				guardFacts: { daemon_identity: "imm-bot" },
				snapshotOverride: snapshot({ issues: [readyIssue(11)] }),
				agentPort: lane.port,
				standingDaemon: true,
			});

		expect((await run()).returncode).toBe(0);
		await lane.settle(0, { skipEvidence: true });

		const next = JSON.parse((await run()).stdout) as {
			dispatches: Array<{ handler: string; outcome: string; detail: string }>;
		};
		expect(next.dispatches).toHaveLength(1);
		expect(next.dispatches[0]).toMatchObject({ handler: "open_pr", outcome: "failed" });
		expect(next.dispatches[0]!.detail).toContain("no delivery evidence");
		expect(gitHubPort.upserts).toHaveLength(0);
	});
});

describe("S6-AC3: the tick returns while a job runs", () => {
	it("handles an owner command on the next tick while the job still holds its lease", async () => {
		const ws = makeWorkspace({ max_concurrent: 1 });
		publishPlan(ws.root, 20, "sha256:published-plan-20");
		writeIntent(ws.root);
		const lane = makeFakeLane(ws.root, ws.stateDir);

		await tick(ws.root, lane.port, { issues: [readyIssue(20)] });
		expect(readLoopJob(ws.stateDir, "issue-20")?.outcome).toBeNull();

		// An owner command arrives while the job runs; this tick handles it.
		const withCommand = await tick(ws.root, lane.port, {
			issues: [
				readyIssue(20),
				readyIssue(21, {
					body: "unrelated",
					labels: [],
					comments: [
						{
							id: 8101,
							body: "@imm-loop ignore",
							user: { login: "owner" },
							author_association: "OWNER",
							created_at: TS,
							updated_at: TS,
						},
					],
				}),
			],
		});
		expect(withCommand.dispatches.map((dispatch) => dispatch.detail)).toContain("ignored by owner command");
		// The running job still holds its lease through that tick.
		expect(listLeases(ws.stateDir).map((lease) => lease.target_id)).toEqual(["issue-20"]);
	});

	it("holds the next agent candidate while max_concurrent jobs run", async () => {
		const ws = makeWorkspace({ max_concurrent: 1 });
		publishPlan(ws.root, 30, "sha256:published-plan-30");
		publishPlan(ws.root, 31, "sha256:published-plan-31");
		writeIntent(ws.root);
		const lane = makeFakeLane(ws.root, ws.stateDir);

		const result = await tick(ws.root, lane.port, { issues: [readyIssue(30), readyIssue(31)] });

		const started = result.dispatches.filter((dispatch) => dispatch.outcome === "executed");
		expect(started).toHaveLength(1);
		expect(lane.handled).toHaveLength(1);
		const held = result.dispatches.filter((dispatch) => dispatch.outcome === "held");
		expect(held).toHaveLength(result.dispatches.length - 1);

		// The running job's lease is what occupies the only worker slot: a disjoint
		// candidate is held on `max_concurrent`, not on the scope reservation.
		const schedule = scheduleLoopWork({
			candidates: [{ target_id: "issue-31", handler: "enroll_and_drive", scope_hint: ["src/other.ts"] }],
			// The running job's lease, with the scope its candidate reserved.
			active_leases: listLeases(ws.stateDir).map((lease) => ({ ...lease, scope_hint: ["src/widget.ts"] })),
			ready_buffer: 0,
			open_daemon_prs: 0,
			limits: { max_concurrent: 1, max_ready_buffer: 5, max_pr_buffer: 5 },
			budget: { ticks_today: 0, dispatches_today: 0, max_ticks_per_day: null, max_dispatches_per_day: null },
			allHandlers: true,
		});
		expect(schedule.entries[0]).toMatchObject({ action: "hold" });
		expect(schedule.entries[0]!.reason).toContain("max_concurrent: 1/1");
	});
});

describe("S6-AC2: re-entry resumes an enrolled task", () => {
	function depsFor(
		ws: { root: string; stateDir: string },
		overrides: Partial<AgentHandlerDeps> = {},
	): {
		deps: AgentHandlerDeps;
		enrollments: AgentEnrollRequest[];
		drives: AgentDriveRequest[];
	} {
		const enrollments: AgentEnrollRequest[] = [];
		const drives: AgentDriveRequest[] = [];
		const { drive: driveOverride, ...rest } = overrides;
		const deps: AgentHandlerDeps = {
			sessionProvider: {
				async run() {
					return { exit_code: 0, exit_signal: null, timed_out: false };
				},
			},
			session_credential: "ghs_test",
			createWorktree: () => join(ws.root, ".imm-worktrees", "lane"),
			changedPaths: () => [],
			prWorktree: () => join(ws.root, ".imm-worktrees", "pr"),
			head: () => "b".repeat(40),
			baseBranch: () => "main",
			runKernel: () => ({ exit_code: 1, json: null }),
			readIntent: (taskId) => ({
				task_id: taskId,
				path: `docs/plans/${taskId}.intent.json`,
				revision: 1,
				content_hash: `sha256:${"c".repeat(64)}`,
				risk: "routine" as const,
				scope_hint: [`docs/plans/${taskId}.intent.json`, "src/widget.ts"],
			}),
			readComment: async () => null,
			enroll: async (input) => {
				enrollments.push(input);
				return { record_revision: `sha256:${"d".repeat(64)}` };
			},
			drive: async (input) => {
				drives.push(input);
				if (driveOverride) return driveOverride(input);
				return { settled: true, exit: null, reason: "not settled in this fixture" } as AgentDriveResult;
			},
			runVerification: async () => ({ exit_code: 0, stdout: "", stderr: "" }),
			gitCommitAndPush: async () => ({ commit_sha: "e".repeat(40) }),
			rebaseOrMerge: async () => ({ success: true }),
			now: () => TS,
			...rest,
		};
		return { deps, enrollments, drives };
	}

	// No approval comment in these fixtures, so the confirmation is `policy_auto`.
	const LOOP_CONFIG: LoopConfig = {
		...DEFAULT_LOOP_CONFIG,
		mode: "autonomous",
		auto_enroll_max_risk: "routine",
		allowed_actors: ["owner"],
	};

	function decisionFor(issueNumber: number) {
		const event: NormalizedLoopEvent = {
			contract: LOOP_DAEMON_EVENT_CONTRACT,
			event_id: `evt-e5-${issueNumber}-resume`,
			kind: "E5_READY_TASK",
			timestamp: TS,
			issue_number: issueNumber,
			task_id: TASK_ID,
		};
		return {
			event,
			decision: {
				contract: "assurance_kernel/loop_decision_record/v1" as const,
				decision_id: `dec-resume-${issueNumber}`,
				event_id: event.event_id,
				event_kind: event.kind,
				target: eventTarget(event),
				handler: "enroll_and_drive" as const,
				tier: 1 as const,
				reason: "ready-for-agent with a published plan is the approval signal",
				guard: null,
				classification: null,
				guards_passed: ["G1"],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			},
		};
	}

	async function runHandler(
		ws: { root: string; stateDir: string },
		issueNumber: number,
		options: {
			deps?: Partial<AgentHandlerDeps>;
			event?: NormalizedLoopEvent;
			gitHubPort?: LoopGitHubPort;
			standingDaemon?: boolean;
		} = {},
	) {
		const { deps, enrollments, drives } = depsFor(ws, options.deps);
		const built = decisionFor(issueNumber);
		const event = options.event ?? built.event;
		const decision = { ...built.decision, event_id: event.event_id, event_kind: event.kind };
		const result = await dispatchDecisions({
			root: ws.root,
			stateDir: ws.stateDir,
			loopConfig: LOOP_CONFIG,
			events: [event],
			decisions: [decision],
			snapshot: snapshot({ issues: [readyIssue(issueNumber)] }),
			state: initLoopState(),
			gitHubPort: options.gitHubPort ?? makeFakeGitHubPort(),
			guardFacts: {
				daemon_identity: "imm-bot",
				identity_posture: "isolated",
				allowed_actors: ["owner"],
				allowed_associations: ["OWNER"],
			},
			dryRun: false,
			now: TS,
			agentPort: createAgentHandlerPort(deps),
			standingDaemon: options.standingDaemon ?? true,
		});
		return { result, enrollments, drives };
	}

	it("resumes through drive_dispatcher and attempts no second enrollment", async () => {
		const ws = makeWorkspace();
		publishPlan(ws.root, 40, "sha256:published-plan-40");
		writeIntent(ws.root);
		execFileSync("git", ["add", "docs/plans", "src/widget.ts"], { cwd: ws.root });
		execFileSync("git", ["commit", "-qm", "intent"], { cwd: ws.root, stdio: ["ignore", "pipe", "pipe"] });
		await enrollTaskForTest(ws.root, TASK_ID);

		const { result, enrollments, drives } = await runHandler(ws, 40);

		expect(result.dispatches[0]).toMatchObject({ handler: "enroll_and_drive", outcome: "executed" });
		expect(enrollments).toHaveLength(0);
		expect(drives).toHaveLength(1);
		expect(result.dispatches[0]!.detail).toContain("resume");
	});

	it("enrolls exactly once when no TaskRecord exists", async () => {
		const ws = makeWorkspace();
		publishPlan(ws.root, 41, "sha256:published-plan-41");
		writeIntent(ws.root);

		const { result, enrollments, drives } = await runHandler(ws, 41);

		expect(result.dispatches[0]).toMatchObject({ handler: "enroll_and_drive", outcome: "executed" });
		expect(enrollments).toHaveLength(1);
		expect(drives).toHaveLength(1);
	});

	/** A settled Lane exit, as the Kernel projection reports it. */
	function settledExit(taskId: string) {
		return {
			settled: true,
			reason: "settled",
			exit: {
				state: "exited" as const,
				exit_code: 0,
				generation: 1,
				final_commit_sha: COMMIT_SHA,
				verification_evidence_digest: `sha256:${taskId.length.toString(16).padStart(64, "0")}`,
			},
		} as AgentDriveResult;
	}

	function publishTwoIntentPlan(root: string, issueNumber: number, digest: string): void {
		const intent = (taskId: string) => ({
			path: `docs/plans/${taskId}.intent.json`,
			task_id: taskId,
			content_hash: `sha256:${"c".repeat(64)}`,
			risk: "routine" as const,
		});
		writePlanPublication(join(root, ".imm/state/loop"), {
			contract: LOOP_PLAN_PUBLICATION_CONTRACT,
			issue_number: issueNumber,
			branch: `imm-loop/issue-${issueNumber}`,
			worktree_path: root,
			digest,
			requires_owner_approval: true,
			intents: [intent("alpha-task"), intent("beta-task")],
			task_id: "alpha-task",
			comment_body: "plan",
			drafted_at: TS,
			published_at: TS,
			published_comment_id: 4242,
		});
	}

	function e12Lost(issueNumber: number, attempts: number): NormalizedLoopEvent {
		return {
			contract: LOOP_DAEMON_EVENT_CONTRACT,
			event_id: `evt-e12-issue-${issueNumber}-${attempts}`,
			kind: "E12_JOB_FINISHED",
			timestamp: TS,
			issue_number: issueNumber,
			task_id: "alpha-task",
			job_id: `issue-${issueNumber}`,
			outcome: "lost",
			attempts,
			detail: "job process is gone with no outcome",
		};
	}

	it("D8: a settled plan batch emits one E13 per intent, each bound to the driven plan", async () => {
		const ws = makeWorkspace();
		publishTwoIntentPlan(ws.root, 43, "sha256:published-plan-43");
		const { result, drives } = await runHandler(ws, 43, {
			deps: { drive: async (input) => settledExit(input.task_id) },
			event: { ...decisionFor(43).event, task_id: undefined } as unknown as NormalizedLoopEvent,
		});
		expect(result.dispatches[0]).toMatchObject({ handler: "enroll_and_drive", outcome: "executed" });
		await waitForTerminalJob(ws.stateDir, "issue-43");

		expect(drives.map((drive) => drive.task_id)).toEqual(["alpha-task", "beta-task"]);
		const job = readLoopJob(ws.stateDir, "issue-43")!;
		expect(job.outcome).toBe("settled");
		expect(job.settled_lanes?.map((lane) => lane.task_id)).toEqual(["alpha-task", "beta-task"]);

		const settledEvents = loopJobEvents(ws.stateDir, { now: TS }).filter((event) => event.kind === "E13_LANE_SETTLED");
		expect(settledEvents.map((event) => (event as { task_id: string }).task_id)).toEqual(["alpha-task", "beta-task"]);
		expect(new Set(settledEvents.map((event) => event.event_id)).size).toBe(2);
		for (const event of settledEvents) expect(event).toMatchObject({ plan_digest: "sha256:published-plan-43" });
	});

	it("D6: a retry of a lost batch skips the Lanes the lost attempt already settled", async () => {
		const ws = makeWorkspace();
		publishTwoIntentPlan(ws.root, 44, "sha256:published-plan-44");
		startLoopJob(
			ws.stateDir,
			{
				kind: "drive",
				target_id: "issue-44",
				task_id: "alpha-task",
				issue_number: 44,
				plan_digest: "sha256:published-plan-44",
				task_ids: ["alpha-task", "beta-task"],
				expected_output: "executor_exit_record",
				now: TS,
				pid: 999_999,
			},
			() => new Promise(() => {}),
		);
		recordSettledLane(ws.stateDir, "issue-44", { task_id: "alpha-task", exit: settledExit("alpha-task").exit! });
		reconcileLoopJobs(ws.stateDir, { now: TS, is_alive: () => false });
		expect(readLoopJob(ws.stateDir, "issue-44")?.outcome).toBe("lost");

		const { result, drives } = await runHandler(ws, 44, {
			deps: { drive: async (input) => settledExit(input.task_id) },
			event: e12Lost(44, 1),
		});
		expect(result.dispatches[0]).toMatchObject({ handler: "enroll_and_drive", outcome: "executed" });
		await waitForTerminalJob(ws.stateDir, "issue-44");

		expect(drives.map((drive) => drive.task_id)).toEqual(["beta-task"]);
		expect(readLoopJob(ws.stateDir, "issue-44")?.settled_lanes?.map((lane) => lane.task_id)).toEqual([
			"alpha-task",
			"beta-task",
		]);
	});

	it("D6: a lost job's retry that cannot start escalates instead of ending silently", async () => {
		const ws = makeWorkspace();
		publishPlan(ws.root, 45, "sha256:published-plan-45");
		const posted: string[] = [];
		const gitHubPort = {
			...makeFakeGitHubPort(),
			async postComment(_issue: number, body: string) {
				posted.push(body);
				return { id: 9002 };
			},
		};
		const { result } = await runHandler(ws, 45, {
			event: { ...e12Lost(45, 1), task_id: TASK_ID },
			deps: {
				enroll: async () => {
					throw new Error("kernel refused");
				},
			},
			gitHubPort,
		});
		expect(result.dispatches[0]).toMatchObject({ handler: "enroll_and_drive", outcome: "failed" });
		expect(result.dispatches[0]!.detail).toContain("escalated");
		expect(posted.some((body) => body.includes("could not restart lost job issue-45"))).toBe(true);
	});

	it("D6: open_pr refuses a settlement whose plan is no longer the published one", async () => {
		const ws = makeWorkspace();
		publishPlan(ws.root, 46, "sha256:republished-plan-46");
		writeIntent(ws.root);
		const event: NormalizedLoopEvent = {
			contract: LOOP_DAEMON_EVENT_CONTRACT,
			event_id: "evt-e13-issue-46-1",
			kind: "E13_LANE_SETTLED",
			timestamp: TS,
			issue_number: 46,
			task_id: TASK_ID,
			job_id: "issue-46",
			plan_digest: "sha256:driven-plan-46",
			final_commit_sha: COMMIT_SHA,
			verification_evidence_digest: `sha256:${"f".repeat(64)}`,
		};
		const gitHubPort = makeFakeGitHubPort();
		const dispatched = await dispatchDecisions({
			root: ws.root,
			stateDir: ws.stateDir,
			loopConfig: LOOP_CONFIG,
			events: [event],
			decisions: [
				{
					...decisionFor(46).decision,
					event_id: event.event_id,
					event_kind: event.kind,
					target: eventTarget(event),
					handler: "open_pr",
				},
			],
			snapshot: snapshot({ issues: [readyIssue(46)] }),
			state: initLoopState(),
			gitHubPort,
			guardFacts: { daemon_identity: "imm-bot" },
			dryRun: false,
			now: TS,
		});
		expect(dispatched.dispatches[0]).toMatchObject({ handler: "open_pr", outcome: "failed" });
		expect(dispatched.dispatches[0]!.detail).toContain("plan_digest_stale");
		expect(gitHubPort.upserts).toHaveLength(0);
	});

	it("marks a dead-pid job lost, restarts it once, and escalates the second loss", async () => {
		const ws = makeWorkspace();
		publishPlan(ws.root, 42, "sha256:published-plan-42");
		writeIntent(ws.root);
		const lane = makeFakeLane(ws.root, ws.stateDir);

		// A job whose process is gone and whose outcome never landed.
		startLoopJob(
			ws.stateDir,
			{
				kind: "drive",
				target_id: "issue-42",
				task_id: TASK_ID,
				issue_number: 42,
				expected_output: "executor_exit_record",
				now: TS,
				pid: 999_999,
			},
			() => new Promise(() => {}),
		);

		const retry = await tick(ws.root, lane.port, { issues: [readyIssue(42)] });
		expect(retry.decisions.map((decision) => decision.handler)).toContain("enroll_and_drive");
		expect(lane.handled).toHaveLength(1);
		expect(readLoopJob(ws.stateDir, "issue-42")?.attempts).toBe(LOOP_JOB_MAX_ATTEMPTS);

		// The second loss is owner-visible instead of another restart.
		const judgements = await judgeEvents(
			[
				{
					contract: LOOP_DAEMON_EVENT_CONTRACT,
					event_id: "evt-e12-second-loss",
					kind: "E12_JOB_FINISHED",
					timestamp: TS,
					issue_number: 42,
					task_id: TASK_ID,
					job_id: "issue-42",
					outcome: "lost",
					attempts: LOOP_JOB_MAX_ATTEMPTS,
					detail: "job process is gone with no outcome",
				},
			],
			{ facts: {} },
		);
		expect(judgements[0]!.handler).toBe("escalate");
		expect(loadLoopDispatches(ws.stateDir).length).toBeGreaterThan(0);
	});
});

describe("S6: a job's process is checked by identity and runtime", () => {
	function runningJob(stateDir: string, startedAt = TS) {
		return startLoopJob(
			stateDir,
			{
				kind: "drive",
				target_id: "issue-50",
				task_id: TASK_ID,
				issue_number: 50,
				expected_output: "executor_exit_record",
				now: startedAt,
				pid: 4242,
				process_started_at: () => "Mon 16 Nov 09:00:00 2026",
			},
			() => new Promise(() => {}),
		);
	}

	it("marks the job lost when its pid now belongs to another process", () => {
		const ws = makeWorkspace();
		runningJob(ws.stateDir);
		const result = reconcileLoopJobs(ws.stateDir, {
			now: TS,
			is_alive: () => true,
			process_started_at: () => "Mon 16 Nov 11:30:00 2026",
		});
		expect(result.lost.map((job) => job.job_id)).toEqual(["issue-50"]);
		expect(readLoopJob(ws.stateDir, "issue-50")?.detail).toContain("replaced by another process");
	});

	it("keeps a live job with its own process running", () => {
		const ws = makeWorkspace();
		runningJob(ws.stateDir);
		const result = reconcileLoopJobs(ws.stateDir, {
			now: TS,
			is_alive: () => true,
			process_started_at: () => "Mon 16 Nov 09:00:00 2026",
		});
		expect(result.terminal).toHaveLength(0);
		expect(readLoopJob(ws.stateDir, "issue-50")?.outcome).toBeNull();
	});

	it("fails a job still running past the runtime limit, without restarting it", () => {
		const ws = makeWorkspace();
		runningJob(ws.stateDir);
		const later = new Date(Date.parse(TS) + 2 * 60 * 60 * 1000).toISOString();
		const result = reconcileLoopJobs(ws.stateDir, {
			now: later,
			is_alive: () => true,
			process_started_at: () => "Mon 16 Nov 09:00:00 2026",
			max_runtime_ms: 60 * 60 * 1000,
		});
		expect(result.lost).toHaveLength(0);
		const job = readLoopJob(ws.stateDir, "issue-50");
		expect(job?.outcome).toBe("failed");
		expect(job?.detail).toContain("job_timed_out");
	});
});
