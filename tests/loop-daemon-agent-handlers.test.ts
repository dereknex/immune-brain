/**
 * Loop Daemon: Agent-Backed Handler Tests (S9)
 *
 * Verifies S9-AC1 and S9-AC2 under docs/plans/loop-daemon-s9-agent-handlers.intent.json
 * and S9 / D11 in docs/specs/loop-daemon.spec.md (SCN-6).
 *
 * - Positive control (SCN-6): successive ticks of the standing run process carry a
 *   new Issue through clarify, draft_plan via `imm-kernel intent author`,
 *   plan summary publication, a REST-read `/approve <digest>` comment turned into a
 *   `tracker_approval_proof`, enrollment, `dispatchLoopDrive()` to settlement with the
 *   Executor exit recorded, and open_pr on `imm/<slug>` — all against a fake session
 *   provider and GitHub fixtures.
 * - Negative control: a stale digest, an edited comment and a daemon-authored comment
 *   do not enroll; a one-shot tick records `requires_standing_daemon` instead of driving.
 * - Boundary control: a session that exits without its expected output file, its
 *   schema or a moved Git head is failed regardless of its prose; repair keeps the S7
 *   two-attempt cap; a review comment outside the TaskIntent `scope_hint` escalates.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { LoopConfig } from "../plugins/immune-brain/runtime/config/layered_config.ts";
import type { GhExecution, GhTransport } from "../plugins/immune-brain/runtime/github_issue_tracker.ts";
import {
	createAgentHandlerPort,
	createDefaultAgentHandlerDeps,
	type AgentDriveInitiativeRequest,
	readPlanPublication,
	type AgentDriveRequest,
	type AgentDriveResult,
	type AgentEnrollRequest,
	type AgentHandlerDeps,
	type AgentTaskIntent,
} from "../plugins/immune-brain/runtime/loop_daemon/agent_handlers.ts";
import {
	isReadOnlyRole,
	sessionRole,
	type AgentSessionKind,
	type AgentSessionProvider,
	type AgentSessionRequest,
} from "../plugins/immune-brain/runtime/loop_daemon/agent_runner.ts";
import { runLoopDaemonCli } from "../plugins/immune-brain/runtime/loop_daemon/cli.ts";
import { type LoopDecisionRecord } from "../plugins/immune-brain/runtime/loop_daemon/decision_record.ts";
import { dispatchDecisions } from "../plugins/immune-brain/runtime/loop_daemon/dispatch.ts";
import { laneDeliveryEvidence } from "../plugins/immune-brain/runtime/unattended/batch_preflight.ts";
import {
	prepareBatchLaneRunState,
	writeBatchLaneRunState,
} from "../plugins/immune-brain/runtime/unattended/batch_state.ts";
import { createFakeLoopGitHubPort } from "../plugins/immune-brain/runtime/loop_daemon/github_port.ts";
import { escalationKey, escalationKeyMarker } from "../plugins/immune-brain/runtime/loop_daemon/escalation.ts";
import { eventTarget } from "../plugins/immune-brain/runtime/loop_daemon/guards.ts";
import { setCachedDaemonGithubLogin } from "../plugins/immune-brain/runtime/loop_daemon/identity.ts";
import { loopJobEvents, readLoopJob } from "../plugins/immune-brain/runtime/loop_daemon/jobs.ts";
import { readWorkItem, writeWorkItem } from "../plugins/immune-brain/runtime/loop_daemon/work_items.ts";
import { LOOP_PR_MARKER, repairKey, saveRepairRetries } from "../plugins/immune-brain/runtime/loop_daemon/repair_agent.ts";
import { initLoopState, loadLoopDispatches } from "../plugins/immune-brain/runtime/loop_daemon/state.ts";
import {
	LOOP_DAEMON_EVENT_CONTRACT,
	type NormalizedLoopEvent,
	type ObservationInput,
	type RawComment,
	type RawIssue,
	type RawPR,
} from "../plugins/immune-brain/runtime/loop_daemon/types.ts";

const TS = "2026-11-12T10:00:00.000Z";
const PLAN_TASK_ID = "s9-fixture-task";

/* ------------------------------------------------------------------ */
/* Workspace fixtures                                                  */
/* ------------------------------------------------------------------ */

function git(root: string, argv: string[]): string {
	return execFileSync("git", ["-C", root, ...argv], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

interface Workspace {
	root: string;
	stateDir: string;
	loopConfig: LoopConfig;
	cleanup: () => void;
}

function makeWorkspace(options?: { loopConfig?: Partial<LoopConfig> }): Workspace {
	const root = mkdtempSync(join(tmpdir(), "imm-agent-handlers-"));
	git(root, ["init", "-q"]);
	git(root, ["config", "user.name", "Immune Test"]);
	git(root, ["config", "user.email", "test@immune-brain.internal"]);

	const loopConfig: LoopConfig = {
		mode: "assist",
		interval_seconds: 30,
		max_concurrent: 2,
		max_ready_buffer: 5,
		max_pr_buffer: 5,
		auto_enroll_max_risk: "none",
		allowed_actors: ["human-owner"],
		allowed_associations: ["OWNER", "MEMBER", "COLLABORATOR"],
		budget: { max_ticks_per_day: null, max_dispatches_per_day: null },
		...options?.loopConfig,
	};

	mkdirSync(join(root, "docs/agents"), { recursive: true });
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	mkdirSync(join(root, "src"), { recursive: true });
	writeFileSync(join(root, "src/seed.ts"), "export const seed = 1;\n");
	writeFileSync(join(root, "docs/plans/.gitkeep"), "");
	writeFileSync(
		join(root, "docs/agents/no-touch.json"),
		JSON.stringify({ contract: "immune_brain/no_touch/v1", paths: [] }, null, 2),
	);
	mkdirSync(join(root, ".imm"), { recursive: true });
	writeFileSync(
		join(root, ".imm/config.json"),
		JSON.stringify(
			{
				contract: "immune_brain/project_config/v2",
				loop: {
					mode: loopConfig.mode,
					interval_seconds: loopConfig.interval_seconds,
					max_concurrent: loopConfig.max_concurrent,
					max_ready_buffer: loopConfig.max_ready_buffer,
					max_pr_buffer: loopConfig.max_pr_buffer,
					auto_enroll_max_risk: loopConfig.auto_enroll_max_risk,
					allowed_actors: loopConfig.allowed_actors,
					allowed_associations: loopConfig.allowed_associations,
				},
			},
			null,
			2,
		),
	);
	git(root, ["add", "-A"]);
	git(root, ["commit", "-q", "-m", "fixture: initial tree"]);

	const stateDir = join(root, ".imm/state/loop");
	mkdirSync(stateDir, { recursive: true });
	return {
		root,
		stateDir,
		loopConfig,
		cleanup: () => {
			try {
				rmSync(root, { recursive: true, force: true });
			} catch {}
		},
	};
}

function mockGh(userLogin = "daemon-bot"): GhTransport {
	return {
		run: async (args: string[]): Promise<GhExecution> => {
			if (args[0] === "api" && args[1] === "user") {
				return { exit_code: 0, stdout: JSON.stringify({ login: userLogin }), stderr: "", timed_out: false, output_exceeded: false };
			}
			return { exit_code: 0, stdout: "[]", stderr: "", timed_out: false, output_exceeded: false };
		},
	};
}

/* ------------------------------------------------------------------ */
/* Fake session provider, Kernel, and GitHub fixtures                  */
/* ------------------------------------------------------------------ */

type SessionBehavior = "ok" | "missing_output" | "invalid_output" | "exit_nonzero";

interface FakeSessions {
	provider: AgentSessionProvider;
	requests: AgentSessionRequest[];
}

function payloadFor(kind: AgentSessionKind): string {
	if (kind === "clarify")
		return JSON.stringify({
			scopes: ["src/"],
			seams: ["src/seed.ts"],
			risks: ["the seed fixture may drift"],
			acceptance: ["the fixture task delivers"],
		});
	if (kind === "planning")
		return JSON.stringify({
			intents: [
				{
					path: `docs/plans/${PLAN_TASK_ID}.intent.json`,
					intent: {
						contract: "assurance_kernel/task_intent/v1",
						task_id: PLAN_TASK_ID,
						owner: "user",
						goal: "Deliver the S9 fixture task",
						acceptance: [{ id: "AC1", assertion: "the fixture task delivers", verification: "{\"contract\":\"x\"}" }],
						scope_hint: ["src/"],
						risk: "routine",
						revision: 1,
					},
				},
			],
			spec: null,
		});
	return JSON.stringify({ success: true, modified_paths: ["src/seed.ts"] });
}

function createFakeSessions(behavior: Partial<Record<AgentSessionKind, SessionBehavior>> = {}): FakeSessions {
	const requests: AgentSessionRequest[] = [];
	const provider: AgentSessionProvider = {
		async run(request) {
			requests.push(request);
			const mode = behavior[request.kind] ?? "ok";
			if (mode === "exit_nonzero") return { exit_code: 1, exit_signal: null, timed_out: false };
			if (mode === "missing_output") return { exit_code: 0, exit_signal: null, timed_out: false };

			const payload = mode === "invalid_output" ? "not the expected schema" : payloadFor(request.kind);
			// A read-only session prints its result; a writable one writes the file it was given.
			if (isReadOnlyRole(sessionRole(request.kind))) {
				return { exit_code: 0, exit_signal: null, timed_out: false, stdout: payload };
			}
			if (request.output_path === undefined) throw new Error(`writable session without an output path: ${request.kind}`);
			const target = join(request.worktree_path, request.output_path);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, payload);
			return { exit_code: 0, exit_signal: null, timed_out: false };
		},
	};
	return { provider, requests };
}

interface FakeKernel {
	runKernel: AgentHandlerDeps["runKernel"];
	calls: Array<{ argv: string[]; cwd: string; stdin?: string }>;
}

function createFakeKernel(options: { enrollmentReady?: boolean } = {}): FakeKernel {
	const calls: Array<{ argv: string[]; cwd: string; stdin?: string }> = [];
	return {
		calls,
		runKernel: (input) => {
			calls.push(input);
			if (input.argv[0] === "intent" && input.argv[1] === "author") {
				const path = input.argv[2]!;
				writeFileSync(join(input.cwd, path), input.stdin ?? "{}\n");
				const parsed = JSON.parse(input.stdin ?? "{}") as { task_id?: string; risk?: string };
				return {
					exit_code: 0,
					json: {
						valid: true,
						enrollment_ready: options.enrollmentReady !== false,
						task_id: parsed.task_id ?? PLAN_TASK_ID,
						risk: parsed.risk ?? "routine",
						content_hash: `sha256:${"a".repeat(64)}`,
					},
				};
			}
			if (input.argv[0] === "intent" && input.argv[1] === "overlap") {
				return { exit_code: 0, json: { contract: "assurance_kernel/intent_scope_overlap/v1", overlaps: [] } };
			}
			return { exit_code: 1, json: { reason: `unsupported kernel call: ${input.argv.join(" ")}` } };
		},
	};
}

/** The REST comment read-back the approval proof is built from. */
interface ApprovalComments {
	byId: Map<number, { body: string; author: string; author_association: string; created_at: string; updated_at: string }>;
	read: AgentHandlerDeps["readComment"];
}

function createApprovalComments(): ApprovalComments {
	const byId = new Map<number, { body: string; author: string; author_association: string; created_at: string; updated_at: string }>();
	return {
		byId,
		read: async ({ comment_id }) => {
			const found = byId.get(comment_id);
			return found ? { ...found } : null;
		},
	};
}

/* ------------------------------------------------------------------ */
/* Handler deps                                                        */
/* ------------------------------------------------------------------ */

interface Harness {
	workspace: Workspace;
	sessions: FakeSessions;
	kernel: FakeKernel;
	comments: ApprovalComments;
	gitHubPort: ReturnType<typeof createFakeLoopGitHubPort>;
	enrollments: AgentEnrollRequest[];
	drives: AgentDriveRequest[];
	intents: Map<string, AgentTaskIntent>;
	deps: AgentHandlerDeps;
	port: ReturnType<typeof createAgentHandlerPort>;
}

function makeHarness(
	workspace: Workspace,
	options: {
		behavior?: Partial<Record<AgentSessionKind, SessionBehavior>>;
		scopeHint?: string[];
		/** How many leading drive calls report a blocked startup dialog before the drive settles. */
		dialogHolds?: number;
		/** How many leading drive calls report a Lane that is still running before the drive settles. */
		runningTicks?: number;
		/** The drive reports the child parked `needs_human` and never settles. */
		parked?: boolean;
		/** The drive refuses permanently (no Lane is running) and never settles. */
		refused?: boolean;
	} = {},
): Harness {
	const sessions = createFakeSessions(options.behavior);
	const kernel = createFakeKernel();
	const comments = createApprovalComments();
	const gitHubPort = createFakeLoopGitHubPort();
	const enrollments: AgentEnrollRequest[] = [];
	const drives: AgentDriveRequest[] = [];

	const intents = new Map<string, AgentTaskIntent>([
		[
			PLAN_TASK_ID,
			{
				task_id: PLAN_TASK_ID,
				path: `docs/plans/${PLAN_TASK_ID}.intent.json`,
				revision: 1,
				content_hash: `sha256:${"a".repeat(64)}`,
				risk: "routine",
				scope_hint: options.scopeHint ?? ["src/"],
			},
		],
	]);

	const createWorktree: AgentHandlerDeps["createWorktree"] = ({ root, branch, name }) => {
		const path = join(root, ".imm-worktrees", name);
		mkdirSync(dirname(path), { recursive: true });
		git(
			root,
			branch === null
				? ["worktree", "add", "--detach", path, "HEAD"]
				: ["worktree", "add", "-b", branch, path, "HEAD"],
		);
		return path;
	};

	const deps: AgentHandlerDeps = {
		sessionProvider: sessions.provider,
		session_credential: "ghs_daemon_credential",
		createWorktree,
		changedPaths: () => [],
		prWorktree: ({ root, branch, pr_number }) => {
			const path = join(root, ".imm-worktrees", `pr-${pr_number}`);
			mkdirSync(dirname(path), { recursive: true });
			if (!existsSync(path)) {
				// The fixture PR branch starts at HEAD; the daemon only needs the PR's worktree.
				git(root, ["worktree", "add", "-b", branch, path, "HEAD"]);
			}
			return path;
		},
		head: ({ root, cwd, branch }) => {
			try {
				const sha = git(cwd ?? root, ["rev-parse", "--verify", "--quiet", branch ? `refs/heads/${branch}` : "HEAD"]).trim();
				return /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
			} catch {
				return null;
			}
		},
		baseBranch: () => "main",
		runKernel: kernel.runKernel,
		readIntent: (taskId) => intents.get(taskId) ?? null,
		readComment: comments.read,
		enroll: async (input) => {
			enrollments.push(input);
			return { record_revision: `sha256:${"b".repeat(64)}` };
		},
		drive: async (input): Promise<AgentDriveResult> => {
			drives.push(input);
			// A queued startup dialog holds the drive before it settles, as an
			// Executor session reporting entry_submitted: false would.
			if (options.parked) {
				return { settled: false, exit: null, reason: "lane parked", parked: { task_id: input.task_id, reason: "lane_session_open_rejected: provider is busy (refused)" } };
			}
			if (options.refused) {
				return { settled: false, exit: null, reason: "lane_session_unavailable: not running inside Herdr" };
			}
			if (options.dialogHolds && drives.length <= options.dialogHolds) {
				return {
					settled: false,
					exit: null,
					reason: "lane held on a startup dialog",
					hold_for_dialog: {
						task_id: input.task_id,
						batch_id: `batch-${input.task_id}`,
						detail: "lane_entry_not_submitted: the Executor session waits on a startup dialog",
					},
				};
			}
			if (options.runningTicks && drives.length <= options.runningTicks) {
				return { settled: false, exit: null, reason: "lane running" };
			}
			// S8: the daemon reads settlement from the v3 Batch Record plus `.imm/audit/`.
			const { laneDeliveryEvidence } = await import(
				"../plugins/immune-brain/runtime/unattended/batch_preflight.ts"
			);
			const delivery = laneDeliveryEvidence(input.root, input.task_id);
			if (!delivery.ok) return { settled: false, exit: null, reason: delivery.reason };
			return {
				settled: true,
				exit: {
					state: "exited" as const,
					exit_code: 0 as const,
					generation: 1,
					final_commit_sha: delivery.commit,
					verification_evidence_digest: delivery.digest,
				},
				reason: "lane integrated with verification digest",
			};
		},
		runVerification: async () => ({ exit_code: 0, stdout: "", stderr: "" }),
		gitCommitAndPush: async () => ({ commit_sha: "e".repeat(40) }),
		gitForcePushWithLease: async () => ({ commit_sha: "f".repeat(40) }),
		rebaseOrMerge: async () => ({ success: true }),
		now: () => TS,
	};

	return {
		workspace,
		sessions,
		kernel,
		comments,
		gitHubPort,
		enrollments,
		drives,
		intents,
		deps,
		port: createAgentHandlerPort(deps),
	};
}

function issue(number: number, body: string, comments: RawComment[] = []): RawIssue {
	return {
		id: number,
		number,
		title: `Issue ${number}`,
		body,
		state: "open",
		created_at: TS,
		updated_at: TS,
		author: { login: "human-owner" },
		labels: [],
		comments,
	};
}

function snapshotOf(issues: RawIssue[], pullRequests: RawPR[] = []): ObservationInput {
	return { issues, pull_requests: pullRequests, lane_decisions: [], observed_at: TS };
}

function jsonPayload(stdout: string): any {
	return JSON.parse(stdout);
}

/** Wait for the background job to write its terminal outcome (D6). */
async function settleJob(stateDir: string, targetId: string): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		const job = readLoopJob(stateDir, targetId);
		if (job && job.outcome !== null) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`job ${targetId} never reached a terminal outcome`);
}

/* S8: seed a settled delivery the daemon PR gate reads — a completed v3 record
 * plus the tracked audit pair at the integrated commit. */
function seedWorkspaceDelivery(root: string, taskId: string): { commit: string; digest: string } {
	const runId = "run-s9-seed";
	const auditDir = join(root, ".imm", "audit", taskId, runId);
	mkdirSync(auditDir, { recursive: true });
	const recordJson = `${JSON.stringify({ contract: "assurance_kernel/task_record/v4", task_id: taskId })}\n`;
	const proofJson = `${JSON.stringify({ contract: "assurance_kernel/task_tombstone/v2", task_id: taskId, terminal_lifecycle: "done" })}\n`;
	writeFileSync(join(auditDir, "task-record.json"), recordJson);
	writeFileSync(join(auditDir, "terminal-proof.json"), proofJson);
	git(root, ["add", "-A"]);
	git(root, ["commit", "--no-verify", "-qm", `deliver ${taskId}`]);
	const commit = git(root, ["rev-parse", "HEAD"]).trim();
	const prepared = prepareBatchLaneRunState({
		batch_id: `batch-${taskId}`,
		initiative_slug: taskId,
		children: [{ task_id: taskId, slice_id: taskId, blocked_by: [], status: "enrollable", reason: null,
			intent_path: `docs/plans/${taskId}.intent.json`, intent_revision: 1, intent_content_hash: "sha256:x" }],
		plan_digest: "sha256:plan",
		base_head: "0".repeat(40),
		confirmation_time: TS,
		budget: { max_children: 1, qa_failure_limit: 1 },
		max_parallel: 1,
		now: TS,
	});
	writeBatchLaneRunState(root, {
		...prepared,
		batch_state: "completed",
		children: [{ task_id: taskId, slice_id: taskId, blocked_by: [], state: "integrated", reason: null, commit,
			lane: { path: join(root, "lane"), branch: `imm-lane/${taskId}/${taskId}`, base_head: commit, lane_commit: commit },
			qa_failures: 0, session: null }],
		commits: [commit],
	});
	const digest = `sha256:${createHash("sha256").update(`${recordJson}\n${proofJson}`).digest("hex")}`;
	return { commit, digest };
}

const s9IssueClassifier = async (point: string) => {
	if (point === "a18_event_prefilter") return { status: "decided" as const, choice: "actionable", confidence: 0.95 };
	if (point === "a15_task_granularity") return { status: "decided" as const, choice: "clear_single_task", confidence: 0.9 };
	return { status: "unavailable" as const, reason: "no_binding" as const, detail: "unused in S9 fixture" };
};

/* ------------------------------------------------------------------ */
/* Tests                                                              */
/* ------------------------------------------------------------------ */

describe("Loop Daemon: Agent-Backed Handlers (S9)", () => {
	let cleanups: Array<() => void> = [];

	beforeEach(() => {
		cleanups = [];
		setCachedDaemonGithubLogin(null);
	});

	afterEach(() => {
		setCachedDaemonGithubLogin(null);
		for (const cleanup of cleanups) cleanup();
		cleanups = [];
	});

	it("carries a new Issue to a PR across successive standing-daemon ticks (SCN-6)", async () => {
		const workspace = makeWorkspace({ loopConfig: { mode: "assist" } });
		cleanups.push(workspace.cleanup);
		const harness = makeHarness(workspace);

		// Tick 1: the Issue arrives; the daemon analyzes, drafts and publishes a plan.
		const first = await runLoopDaemonCli(["tick", "--json"], workspace.root, {
			gh: mockGh(),
			gitHubPort: harness.gitHubPort,
			snapshotOverride: snapshotOf([issue(10, "Add the S9 fixture behaviour")]),
			guardFacts: { daemon_identity: "daemon-bot" },
			classify: s9IssueClassifier,
			agentPort: harness.port,
			standingDaemon: true,
		});
		expect(first.returncode).toBe(0);
		const firstPayload = jsonPayload(first.stdout);
		expect(firstPayload.dispatches).toHaveLength(1);
		expect(firstPayload.dispatches[0]).toMatchObject({ handler: "draft_plan", outcome: "executed" });
		expect(firstPayload.dispatches[0].detail).toContain("framing");

		// The read-only clarify session framed the Issue first, then the plan was drafted.
		expect(harness.sessions.requests.map((request) => request.kind)).toEqual(["clarify", "planning"]);
		for (const request of harness.sessions.requests) {
			// Sessions receive the daemon's GitHub credential and nothing else.
			expect(Object.keys(request.env).sort()).toEqual(["GH_TOKEN", "GITHUB_TOKEN", "PATH"]);
			expect(request.env.GH_TOKEN).toBe("ghs_daemon_credential");
			// Every loop role reads its budget from the one per-role table (S2-AC1).
			expect(request.turn_budget).toBe(40);
			expect(request.timeout_ms).toBe(900_000);
		}
		// Both are read-only plans: they print their result instead of writing a file.
		for (const request of harness.sessions.requests) {
			expect(isReadOnlyRole(sessionRole(request.kind))).toBe(true);
			expect(request.output_path).toBeUndefined();
		}

		// The candidate TaskIntent went through `imm-kernel intent author`.
		const authorCalls = harness.kernel.calls.filter((call) => call.argv[1] === "author");
		expect(authorCalls).toHaveLength(1);
		expect(authorCalls[0]!.argv).toEqual(["intent", "author", `docs/plans/${PLAN_TASK_ID}.intent.json`, "--stdin", "--json"]);

		// The plan summary is published once, carrying its digest.
		const plan = readPlanPublication(workspace.stateDir, 10);
		expect(plan).not.toBeNull();
		expect(plan!.published_at).toBe(TS);
		expect(plan!.task_id).toBe(PLAN_TASK_ID);
		const published = [...harness.gitHubPort.comments.values()].filter(
			(comment) => comment.issueNumber === 10 && comment.body.includes("<!-- immune-brain:plan-digest="),
		);
		expect(published).toHaveLength(1);
		expect(published[0]!.body).toContain(plan!.digest);

		// The settled delivery the drive will report and `open_pr` will gate on.
		const seeded = seedWorkspaceDelivery(workspace.root, PLAN_TASK_ID);

		// Tick 2: the verified owner approves exactly that digest.
		const approvedAt = new Date(Date.parse(TS) + 60_000).toISOString();
		harness.comments.byId.set(9001, {
			body: `/approve ${plan!.digest}`,
			author: "human-owner",
			author_association: "OWNER",
			created_at: approvedAt,
			updated_at: approvedAt,
		});
		const approval: RawComment = {
			id: 9001,
			body: `/approve ${plan!.digest}`,
			user: { login: "human-owner" },
			author_association: "OWNER",
			created_at: approvedAt,
			updated_at: approvedAt,
		};
		const second = await runLoopDaemonCli(["tick", "--json"], workspace.root, {
			gh: mockGh(),
			gitHubPort: harness.gitHubPort,
			snapshotOverride: snapshotOf([issue(10, "Add the S9 fixture behaviour", [approval])]),
			guardFacts: { daemon_identity: "daemon-bot" },
			classify: s9IssueClassifier,
			agentPort: harness.port,
			standingDaemon: true,
		});
		expect(second.returncode).toBe(0);
		const secondPayload = jsonPayload(second.stdout);
		expect(secondPayload.dispatches).toHaveLength(1);
		expect(secondPayload.dispatches[0]).toMatchObject({ handler: "enroll_and_drive", outcome: "executed" });
		expect(secondPayload.dispatches[0].detail).toContain("tracker_approval");

		// The approval became a tracker_approval_proof naming the published digest.
		expect(harness.enrollments).toHaveLength(1);
		const enrollment = harness.enrollments[0]!;
		expect(enrollment.task_id).toBe(PLAN_TASK_ID);
		expect(enrollment.confirmation.source).toBe("tracker_approval");
		expect(enrollment.confirmation.tracker_approval?.proof).toMatchObject({
			issue_number: 10,
			comment_id: 9001,
			actor_login: "human-owner",
			author_association: "OWNER",
			plan_digest: plan!.digest,
			created_at: approvedAt,
			updated_at: approvedAt,
		});
		expect(enrollment.confirmation_ref).toBe("github:issue-10:comment-9001");
		expect(enrollment.intent.task_id).toBe(PLAN_TASK_ID);

		// The Lane was driven to settlement and the Executor exit was recorded.
		expect(harness.drives).toHaveLength(1);
		expect(harness.drives[0]!.plan_digest).toBe(plan!.digest);

		// D6: the drive is a background job, so this tick returned before it settled.
		expect(readLoopJob(workspace.stateDir, "issue-10")?.outcome).toBeNull();
		await settleJob(workspace.stateDir, "issue-10");

		// The published plan's intent is on the repository, where `open_pr` reads it.
		mkdirSync(join(workspace.root, "docs", "plans"), { recursive: true });
		writeFileSync(
			join(workspace.root, "docs", "plans", `${PLAN_TASK_ID}.intent.json`),
			JSON.stringify({
				contract: "assurance_kernel/task_intent/v1",
				task_id: PLAN_TASK_ID,
				owner: "user",
				goal: "Add the S9 fixture behaviour",
				acceptance: [{ id: "AC1", assertion: "the fixture task delivers", verification: "{\"contract\":\"x\"}" }],
				scope_hint: ["src/"],
				risk: "routine",
				revision: 1,
			}),
		);

		// Tick 3: the settled job becomes E13 and opens the PR without a second approval.
		const third = await runLoopDaemonCli(["tick", "--json"], workspace.root, {
			gh: mockGh(),
			gitHubPort: harness.gitHubPort,
			snapshotOverride: snapshotOf([issue(10, "Add the S9 fixture behaviour", [approval])]),
			guardFacts: { daemon_identity: "daemon-bot" },
			classify: s9IssueClassifier,
			agentPort: harness.port,
			standingDaemon: true,
		});
		expect(third.returncode).toBe(0);
		const thirdPayload = jsonPayload(third.stdout);
		expect(thirdPayload.dispatches).toHaveLength(1);
		expect(thirdPayload.dispatches[0]).toMatchObject({ handler: "open_pr", outcome: "executed" });
		expect(thirdPayload.dispatches[0].detail).toContain("opened PR");
		expect(harness.enrollments).toHaveLength(1);

		const delivery = laneDeliveryEvidence(workspace.root, PLAN_TASK_ID);
		expect(delivery.ok).toBe(true);
		if (delivery.ok) {
			expect(delivery.commit).toBe(seeded.commit);
			expect(delivery.digest).toBe(seeded.digest);
			expect(delivery.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
		}
		// No exit-recorder files: completion lives on the Batch Record plus `.imm/audit/`.
		expect(existsSync(join(workspace.stateDir, "executor-exits"))).toBe(false);

		// The PR opened on `imm/<slug>`.
		const opens = harness.gitHubPort.calls.filter((call) => call.method === "upsert");
		expect(opens).toHaveLength(1);
		const opened = opens[0]!.args[0] as { head: string; body: string; draft: boolean };
		expect(opened.head).toBe(`imm/${PLAN_TASK_ID}`);
		expect(opened.body).toContain(LOOP_PR_MARKER);
		expect(opened.body).toContain("Closes #10");
		expect(opened.body).toContain(seeded.commit);
		expect(opened.body).toContain(seeded.digest);

		// Every dispatch is on disk with its outcome.
		const dispatched = loadLoopDispatches(workspace.stateDir).map((entry) => entry.outcome);
		expect(dispatched).toEqual(["executed", "executed", "executed"]);
	});

	// LDP-A1: a blocked startup dialog posts one planEscalation on the Issue, keeps
	// the drive job running, and re-drives it ("retry on a later tick") instead of
	// failing the job into the E12-escalate abandon path.
	it("escalates a blocked startup dialog via planEscalation and retries the drive after the dialog clears", async () => {
		const oldRetry = process.env.IMM_LOOP_DIALOG_RETRY_MS;
		process.env.IMM_LOOP_DIALOG_RETRY_MS = "10";
		try {
		const workspace = makeWorkspace({ loopConfig: { mode: "assist" } });
		cleanups.push(workspace.cleanup);
		const harness = makeHarness(workspace, { dialogHolds: 1 });

		// Tick 1: draft and publish the plan.
		await runLoopDaemonCli(["tick", "--json"], workspace.root, {
			gh: mockGh(),
			gitHubPort: harness.gitHubPort,
			snapshotOverride: snapshotOf([issue(10, "Add the S9 fixture behaviour")]),
			guardFacts: { daemon_identity: "daemon-bot" },
			classify: s9IssueClassifier,
			agentPort: harness.port,
			standingDaemon: true,
		});
		const plan = readPlanPublication(workspace.stateDir, 10)!;
		const seeded = seedWorkspaceDelivery(workspace.root, PLAN_TASK_ID);

		// Tick 2: the verified owner approves; the first drive call reports a blocked
		// startup dialog (entry_submitted: false).
		const approvedAt = new Date(Date.parse(TS) + 60_000).toISOString();
		const approval: RawComment = {
			id: 9001,
			body: `/approve ${plan!.digest}`,
			user: { login: "human-owner" },
			author_association: "OWNER",
			created_at: approvedAt,
			updated_at: approvedAt,
		};
		harness.comments.byId.set(9001, {
			body: approval.body,
			author: "human-owner",
			author_association: "OWNER",
			created_at: approvedAt,
			updated_at: approvedAt,
		});
		const second = await runLoopDaemonCli(["tick", "--json"], workspace.root, {
			gh: mockGh(),
			gitHubPort: harness.gitHubPort,
			snapshotOverride: snapshotOf([issue(10, "Add the S9 fixture behaviour", [approval])]),
			guardFacts: { daemon_identity: "daemon-bot" },
			classify: s9IssueClassifier,
			agentPort: harness.port,
			standingDaemon: true,
		});
		expect(second.returncode).toBe(0);
		expect(JSON.parse(second.stdout).dispatches[0]).toMatchObject({ handler: "enroll_and_drive", outcome: "executed" });

		// The drive runs as a background job: wait (bounded) for it to post the
		// escalation and re-drive before asserting on the retry mechanism.
		const dialogKey = escalationKeyMarker(escalationKey({ kind: "lane_entry_blocked", target: "issue-10", detail: PLAN_TASK_ID }));
		const escalationBodies = (): string[] =>
			[...harness.gitHubPort.comments.values()]
				.filter((comment) => comment.issueNumber === 10)
				.map((comment) => comment.body);
		for (let attempt = 0; attempt < 400 && !escalationBodies().some((body) => body.includes(dialogKey)); attempt++)
			await new Promise((resolve) => setTimeout(resolve, 5));

		// One planEscalation is posted on the Issue: the lane_entry_blocked key
		// marker with the dialog detail and the Herdr recovery, once and never
		// duplicated by the retry.
		const escalations = escalationBodies().filter((body) => body.includes(dialogKey));
		expect(escalations).toHaveLength(1);
		expect(escalations[0]).toContain("waits on a dialog the daemon cannot answer");
		expect(escalations[0]).toContain("answer it in Herdr");
		expect(escalations[0]).toContain("the drive resumes batch");

		// The job held its lease instead of failing: the retry re-drove the Lane and
		// the job reached the settled outcome, not the E12 failed-abandon path.
		for (let attempt = 0; attempt < 400 && harness.drives.length < 2; attempt++)
			await new Promise((resolve) => setTimeout(resolve, 5));
		expect(harness.drives.length).toBe(2);
		await settleJob(workspace.stateDir, "issue-10");
		expect(readLoopJob(workspace.stateDir, "issue-10")?.outcome).toBe("settled");

		// The published plan's intent is on the repository, where `open_pr` reads it.
		writeFileSync(
			join(workspace.root, "docs", "plans", `${PLAN_TASK_ID}.intent.json`),
			JSON.stringify({
				contract: "assurance_kernel/task_intent/v1",
				task_id: PLAN_TASK_ID,
				owner: "user",
				goal: "Add the S9 fixture behaviour",
				acceptance: [{ id: "AC1", assertion: "the fixture task delivers", verification: "{\"contract\":\"x\"}" }],
				scope_hint: ["src/"],
				risk: "routine",
				revision: 1,
			}),
		);

		// The next tick observes E12/E13 and opens the PR as in the settled flow.
		const third = await runLoopDaemonCli(["tick", "--json"], workspace.root, {
			gh: mockGh(),
			gitHubPort: harness.gitHubPort,
			snapshotOverride: snapshotOf([issue(10, "Add the S9 fixture behaviour", [approval])]),
			guardFacts: { daemon_identity: "daemon-bot" },
			classify: s9IssueClassifier,
			agentPort: harness.port,
			standingDaemon: true,
		});
		const thirdPayload = jsonPayload(third.stdout);
		expect(thirdPayload.dispatches[0]).toMatchObject({ handler: "open_pr", outcome: "executed" });
		const opened = harness.gitHubPort.calls.find((call) => call.method === "upsert")!.args[0] as { body: string };
		expect(opened.body).toContain(seeded.digest);
		} finally {
			if (oldRetry === undefined) delete process.env.IMM_LOOP_DIALOG_RETRY_MS;
			else process.env.IMM_LOOP_DIALOG_RETRY_MS = oldRetry;
		}
	});

	it("keeps advancing a running Lane until it settles, without posting a lane-running escalation", async () => {
		const oldRetry = process.env.IMM_LOOP_DIALOG_RETRY_MS;
		process.env.IMM_LOOP_DIALOG_RETRY_MS = "10";
		try {
			const workspace = makeWorkspace({ loopConfig: { mode: "assist" } });
			cleanups.push(workspace.cleanup);
			const harness = makeHarness(workspace, { runningTicks: 2 });
			await runLoopDaemonCli(["tick", "--json"], workspace.root, {
				gh: mockGh(), gitHubPort: harness.gitHubPort,
				snapshotOverride: snapshotOf([issue(10, "Add the S9 fixture behaviour")]),
				guardFacts: { daemon_identity: "daemon-bot" }, classify: s9IssueClassifier,
				agentPort: harness.port, standingDaemon: true,
			});
			const plan = readPlanPublication(workspace.stateDir, 10)!;
			seedWorkspaceDelivery(workspace.root, PLAN_TASK_ID);
			const approvedAt = new Date(Date.parse(TS) + 60_000).toISOString();
			const approval: RawComment = { id: 9002, body: `/approve ${plan.digest}`, user: { login: "human-owner" }, author_association: "OWNER", created_at: approvedAt, updated_at: approvedAt };
			harness.comments.byId.set(9002, { body: approval.body, author: "human-owner", author_association: "OWNER", created_at: approvedAt, updated_at: approvedAt });
			const tick = await runLoopDaemonCli(["tick", "--json"], workspace.root, {
				gh: mockGh(), gitHubPort: harness.gitHubPort,
				snapshotOverride: snapshotOf([issue(10, "Add the S9 fixture behaviour", [approval])]),
				guardFacts: { daemon_identity: "daemon-bot" }, classify: s9IssueClassifier,
				agentPort: harness.port, standingDaemon: true,
			});
			expect(tick.returncode).toBe(0);
			// The Lane reports running twice before it settles: the job re-drives
			// instead of failing, and posts no lane-running escalation.
			for (let attempt = 0; attempt < 400 && harness.drives.length < 3; attempt++)
				await new Promise((resolve) => setTimeout(resolve, 5));
			expect(harness.drives.length).toBe(3);
			await settleJob(workspace.stateDir, "issue-10");
			expect(readLoopJob(workspace.stateDir, "issue-10")?.outcome).toBe("settled");
			const comments = [...harness.gitHubPort.comments.values()].map((comment) => comment.body).join("\n");
			expect(comments).not.toContain("lane running");
		} finally {
			if (oldRetry === undefined) delete process.env.IMM_LOOP_DIALOG_RETRY_MS;
			else process.env.IMM_LOOP_DIALOG_RETRY_MS = oldRetry;
		}
	});

	it("escalates a child parked needs_human once and does not keep re-driving it", async () => {
		const workspace = makeWorkspace({ loopConfig: { mode: "assist" } });
		cleanups.push(workspace.cleanup);
		const harness = makeHarness(workspace, { parked: true });
		await runLoopDaemonCli(["tick", "--json"], workspace.root, {
			gh: mockGh(), gitHubPort: harness.gitHubPort,
			snapshotOverride: snapshotOf([issue(10, "Add the S9 fixture behaviour")]),
			guardFacts: { daemon_identity: "daemon-bot" }, classify: s9IssueClassifier,
			agentPort: harness.port, standingDaemon: true,
		});
		const plan = readPlanPublication(workspace.stateDir, 10)!;
		const approvedAt = new Date(Date.parse(TS) + 60_000).toISOString();
		const approval: RawComment = { id: 9003, body: `/approve ${plan.digest}`, user: { login: "human-owner" }, author_association: "OWNER", created_at: approvedAt, updated_at: approvedAt };
		harness.comments.byId.set(9003, { body: approval.body, author: "human-owner", author_association: "OWNER", created_at: approvedAt, updated_at: approvedAt });
		await runLoopDaemonCli(["tick", "--json"], workspace.root, {
			gh: mockGh(), gitHubPort: harness.gitHubPort,
			snapshotOverride: snapshotOf([issue(10, "Add the S9 fixture behaviour", [approval])]),
			guardFacts: { daemon_identity: "daemon-bot" }, classify: s9IssueClassifier,
			agentPort: harness.port, standingDaemon: true,
		});
		await settleJob(workspace.stateDir, "issue-10");
		const job = readLoopJob(workspace.stateDir, "issue-10");
		expect(job?.outcome).toBe("failed");
		expect(job?.detail).toContain("needs_human");
		// Escalated once, and the parked child was not re-driven.
		expect(harness.drives.length).toBe(1);
		const escalations = [...harness.gitHubPort.comments.values()].map((comment) => comment.body).filter((body) => body.includes("needs_human"));
		expect(escalations).toHaveLength(1);
	});

	it("fails a permanent drive refusal at once instead of retrying it", async () => {
		const workspace = makeWorkspace({ loopConfig: { mode: "assist" } });
		cleanups.push(workspace.cleanup);
		const harness = makeHarness(workspace, { refused: true });
		await runLoopDaemonCli(["tick", "--json"], workspace.root, {
			gh: mockGh(), gitHubPort: harness.gitHubPort,
			snapshotOverride: snapshotOf([issue(10, "Add the S9 fixture behaviour")]),
			guardFacts: { daemon_identity: "daemon-bot" }, classify: s9IssueClassifier,
			agentPort: harness.port, standingDaemon: true,
		});
		const plan = readPlanPublication(workspace.stateDir, 10)!;
		const approvedAt = new Date(Date.parse(TS) + 60_000).toISOString();
		const approval: RawComment = { id: 9004, body: `/approve ${plan.digest}`, user: { login: "human-owner" }, author_association: "OWNER", created_at: approvedAt, updated_at: approvedAt };
		harness.comments.byId.set(9004, { body: approval.body, author: "human-owner", author_association: "OWNER", created_at: approvedAt, updated_at: approvedAt });
		await runLoopDaemonCli(["tick", "--json"], workspace.root, {
			gh: mockGh(), gitHubPort: harness.gitHubPort,
			snapshotOverride: snapshotOf([issue(10, "Add the S9 fixture behaviour", [approval])]),
			guardFacts: { daemon_identity: "daemon-bot" }, classify: s9IssueClassifier,
			agentPort: harness.port, standingDaemon: true,
		});
		await settleJob(workspace.stateDir, "issue-10");
		const job = readLoopJob(workspace.stateDir, "issue-10");
		expect(job?.outcome).toBe("failed");
		expect(job?.detail).toContain("lane_session_unavailable");
		expect(harness.drives.length).toBe(1);
	});

	/** Run the approve tick for an Initiative-shaped issue-10 through a port whose `driveInitiative` the caller supplies. */
	async function approveInitiativeShaped(
		driveInitiative: AgentHandlerDeps["driveInitiative"],
		seed?: (stateDir: string) => void,
	) {
		const workspace = makeWorkspace({ loopConfig: { mode: "assist" } });
		cleanups.push(workspace.cleanup);
		const harness = makeHarness(workspace);
		const port = createAgentHandlerPort({ ...harness.deps, driveInitiative });
		await runLoopDaemonCli(["tick", "--json"], workspace.root, {
			gh: mockGh(), gitHubPort: harness.gitHubPort,
			snapshotOverride: snapshotOf([issue(10, "Add the S9 fixture behaviour")]),
			guardFacts: { daemon_identity: "daemon-bot" }, classify: s9IssueClassifier,
			agentPort: port, standingDaemon: true,
		});
		const plan = readPlanPublication(workspace.stateDir, 10)!;
		// The leader shaped this target as an Initiative before the owner approved.
		const shaped = readWorkItem(workspace.stateDir, "issue-10")!;
		shaped.binding.initiative_slug = "widget-initiative";
		writeWorkItem(workspace.stateDir, shaped);
		seed?.(workspace.stateDir);

		const approvedAt = new Date(Date.parse(TS) + 60_000).toISOString();
		const approval: RawComment = { id: 9005, body: `/approve ${plan.digest}`, user: { login: "human-owner" }, author_association: "OWNER", created_at: approvedAt, updated_at: approvedAt };
		harness.comments.byId.set(9005, { body: approval.body, author: "human-owner", author_association: "OWNER", created_at: approvedAt, updated_at: approvedAt });
		await runLoopDaemonCli(["tick", "--json"], workspace.root, {
			gh: mockGh(), gitHubPort: harness.gitHubPort,
			snapshotOverride: snapshotOf([issue(10, "Add the S9 fixture behaviour", [approval])]),
			guardFacts: { daemon_identity: "daemon-bot" }, classify: s9IssueClassifier,
			agentPort: port, standingDaemon: true,
		});
		await settleJob(workspace.stateDir, "issue-10");
		return { workspace, harness };
	}

	it("drives an Initiative as one batch: writes binding.batch_id, re-enters that batch, and settles once with one E13", async () => {
		const priorRetry = process.env.IMM_LOOP_DIALOG_RETRY_MS;
		process.env.IMM_LOOP_DIALOG_RETRY_MS = "1";
		try {
			const calls: AgentDriveInitiativeRequest[] = [];
			const { workspace, harness } = await approveInitiativeShaped(async (input) => {
				calls.push(input);
				if (calls.length <= 4) return { settled: false, exit: null, reason: "lane running", batch_id: "batch-widget-initiative-1" };
				return {
					settled: true,
					exit: { state: "exited", exit_code: 0, generation: null, final_commit_sha: "c".repeat(40), verification_evidence_digest: `sha256:${"d".repeat(64)}` },
					reason: "batch completed with passing final verification",
					batch_id: "batch-widget-initiative-1",
				};
			});
			const job = readLoopJob(workspace.stateDir, "issue-10");
			expect(job?.outcome).toBe("settled");
			// First entry has no batch; every later pass re-enters the recorded one.
			expect(calls[0]!.batch_id).toBeNull();
			expect(calls.slice(1).every((call) => call.batch_id === "batch-widget-initiative-1")).toBe(true);
			expect(calls.length).toBe(5);
			expect(readWorkItem(workspace.stateDir, "issue-10")!.binding.batch_id).toBe("batch-widget-initiative-1");
			// One settled entry for the batch, not one per slice, so one E13.
			expect(job?.settled_lanes).toHaveLength(1);
			const e13 = loopJobEvents(workspace.stateDir, { now: TS }).filter((event) => event.kind === "E13_LANE_SETTLED");
			expect(e13).toHaveLength(1);
			// No single-task Lane ran for a slice.
			expect(harness.drives).toHaveLength(0);
		} finally {
			if (priorRetry === undefined) delete process.env.IMM_LOOP_DIALOG_RETRY_MS;
			else process.env.IMM_LOOP_DIALOG_RETRY_MS = priorRetry;
		}
	});

	it("fails a refused Initiative drive, clears a binding whose batch is gone, and leaves the WorkItem retryable", async () => {
		const { workspace, harness } = await approveInitiativeShaped(
			async () => ({ settled: false, exit: null, reason: "final_verification_required: configure batch.final_verification", batch_id: null }),
			(stateDir) => {
				const item = readWorkItem(stateDir, "issue-10")!;
				item.binding.batch_id = "batch-gone";
				writeWorkItem(stateDir, item);
			},
		);
		const job = readLoopJob(workspace.stateDir, "issue-10");
		expect(job?.outcome).toBe("failed");
		expect(job?.detail).toContain("final_verification_required");
		expect(job?.detail).not.toContain("lane_initiative_entry_pending");
		expect(job?.settled_lanes ?? []).toEqual([]);
		expect(harness.drives).toHaveLength(0);
		const item = readWorkItem(workspace.stateDir, "issue-10")!;
		expect(item.binding.batch_id).toBeNull();
		expect(["closed", "escalated", "abandoned"]).not.toContain(item.state);
		expect(item.binding.initiative_slug).toBe("widget-initiative");
	});

	it("does not enroll an approval whose digest is not the published one", async () => {
		const workspace = makeWorkspace();
		cleanups.push(workspace.cleanup);
		const harness = makeHarness(workspace);

		await runLoopDaemonCli(["tick"], workspace.root, {
			gh: mockGh(),
			gitHubPort: harness.gitHubPort,
			snapshotOverride: snapshotOf([issue(10, "Add the S9 fixture behaviour")]),
			guardFacts: { daemon_identity: "daemon-bot" },
			classify: s9IssueClassifier,
			agentPort: harness.port,
			standingDaemon: true,
		});
		const plan = readPlanPublication(workspace.stateDir, 10)!;

		const staleDigest = "f".repeat(64);
		expect(staleDigest).not.toBe(plan.digest);
		const approvedAt = new Date(Date.parse(TS) + 60_000).toISOString();
		harness.comments.byId.set(9002, {
			body: `/approve ${staleDigest}`,
			author: "human-owner",
			author_association: "OWNER",
			created_at: approvedAt,
			updated_at: approvedAt,
		});

		const result = await runLoopDaemonCli(["tick", "--json"], workspace.root, {
			gh: mockGh(),
			gitHubPort: harness.gitHubPort,
			snapshotOverride: snapshotOf([
				issue(10, "Add the S9 fixture behaviour", [
					{
						id: 9002,
						body: `/approve ${staleDigest}`,
						user: { login: "human-owner" },
						author_association: "OWNER",
						created_at: approvedAt,
						updated_at: approvedAt,
					},
				]),
			]),
			guardFacts: { daemon_identity: "daemon-bot" },
			classify: s9IssueClassifier,
			agentPort: harness.port,
			standingDaemon: true,
		});

		expect(result.returncode).toBe(0);
		expect(harness.enrollments).toHaveLength(0);
		expect(harness.drives).toHaveLength(0);
		expect(laneDeliveryEvidence(workspace.root, PLAN_TASK_ID).ok).toBe(false);
		expect(jsonPayload(result.stdout).dispatches).toHaveLength(0);
	});

	it("refuses an edited approval comment and escalates it once", async () => {
		const workspace = makeWorkspace();
		cleanups.push(workspace.cleanup);
		const harness = makeHarness(workspace);

		await runLoopDaemonCli(["tick"], workspace.root, {
			gh: mockGh(),
			gitHubPort: harness.gitHubPort,
			snapshotOverride: snapshotOf([issue(10, "Add the S9 fixture behaviour")]),
			guardFacts: { daemon_identity: "daemon-bot" },
			classify: s9IssueClassifier,
			agentPort: harness.port,
			standingDaemon: true,
		});
		const plan = readPlanPublication(workspace.stateDir, 10)!;

		const created = new Date(Date.parse(TS) + 60_000).toISOString();
		const edited = new Date(Date.parse(TS) + 120_000).toISOString();
		harness.comments.byId.set(9003, {
			body: `/approve ${plan.digest}`,
			author: "human-owner",
			author_association: "OWNER",
			created_at: created,
			updated_at: edited,
		});
		const editedComment: RawComment = {
			id: 9003,
			body: `/approve ${plan.digest}`,
			user: { login: "human-owner" },
			author_association: "OWNER",
			created_at: created,
			updated_at: edited,
		};

		const once = await runLoopDaemonCli(["tick", "--json"], workspace.root, {
			gh: mockGh(),
			gitHubPort: harness.gitHubPort,
			snapshotOverride: snapshotOf([issue(10, "Add the S9 fixture behaviour", [editedComment])]),
			guardFacts: { daemon_identity: "daemon-bot" },
			classify: s9IssueClassifier,
			agentPort: harness.port,
			standingDaemon: true,
		});
		expect(once.returncode).toBe(0);
		expect(harness.enrollments).toHaveLength(0);
		expect(jsonPayload(once.stdout).dispatches[0]).toMatchObject({ handler: "enroll_and_drive", outcome: "failed" });
		expect(jsonPayload(once.stdout).dispatches[0].detail).toContain("tracker_approval_comment_edited");

		const escalations = [...harness.gitHubPort.comments.values()].filter((comment) =>
			comment.body.includes("<!-- immune-brain:escalation-key="),
		);
		expect(escalations).toHaveLength(1);

		// A second tick updates the same escalation in place instead of posting another.
		const twice = await runLoopDaemonCli(["tick", "--json"], workspace.root, {
			gh: mockGh(),
			gitHubPort: harness.gitHubPort,
			snapshotOverride: snapshotOf([issue(10, "Add the S9 fixture behaviour", [editedComment])]),
			guardFacts: { daemon_identity: "daemon-bot" },
			classify: s9IssueClassifier,
			agentPort: harness.port,
			standingDaemon: true,
		});
		expect(twice.returncode).toBe(0);
		expect(
			[...harness.gitHubPort.comments.values()].filter((comment) =>
				comment.body.includes("<!-- immune-brain:escalation-key="),
			),
		).toHaveLength(1);
		expect(harness.enrollments).toHaveLength(0);
	});

	it("records requires_standing_daemon instead of driving a Lane from a one-shot tick", async () => {
		const workspace = makeWorkspace();
		cleanups.push(workspace.cleanup);
		const harness = makeHarness(workspace);

		await runLoopDaemonCli(["tick"], workspace.root, {
			gh: mockGh(),
			gitHubPort: harness.gitHubPort,
			snapshotOverride: snapshotOf([issue(10, "Add the S9 fixture behaviour")]),
			guardFacts: { daemon_identity: "daemon-bot" },
			classify: s9IssueClassifier,
			agentPort: harness.port,
			standingDaemon: true,
		});
		const plan = readPlanPublication(workspace.stateDir, 10)!;
		const approvedAt = new Date(Date.parse(TS) + 60_000).toISOString();
		harness.comments.byId.set(9004, {
			body: `/approve ${plan.digest}`,
			author: "human-owner",
			author_association: "OWNER",
			created_at: approvedAt,
			updated_at: approvedAt,
		});

		const result = await runLoopDaemonCli(["tick", "--json"], workspace.root, {
			gh: mockGh(),
			gitHubPort: harness.gitHubPort,
			snapshotOverride: snapshotOf([
				issue(10, "Add the S9 fixture behaviour", [
					{
						id: 9004,
						body: `/approve ${plan.digest}`,
						user: { login: "human-owner" },
						author_association: "OWNER",
						created_at: approvedAt,
						updated_at: approvedAt,
					},
				]),
			]),
			guardFacts: { daemon_identity: "daemon-bot" },
			agentPort: harness.port,
			// No standingDaemon: this is a one-shot tick.
		});

		expect(result.returncode).toBe(0);
		expect(jsonPayload(result.stdout).dispatches[0]).toMatchObject({
			handler: "enroll_and_drive",
			outcome: "requires_standing_daemon",
		});
		expect(harness.enrollments).toHaveLength(0);
		expect(harness.drives).toHaveLength(0);
		expect(loadLoopDispatches(workspace.stateDir).at(-1)?.outcome).toBe("requires_standing_daemon");
	});

	it("fails a session that leaves no expected output, wrong schema, or no moved Git head", async () => {
		const cases: Array<{
			handler: "clarify_issue" | "draft_plan";
			behavior: Partial<Record<AgentSessionKind, SessionBehavior>>;
			expected: string;
		}> = [
			{ handler: "clarify_issue", behavior: { clarify: "missing_output" }, expected: "session_output_missing" },
			{ handler: "clarify_issue", behavior: { clarify: "invalid_output" }, expected: "expected_output_invalid" },
			{ handler: "clarify_issue", behavior: { clarify: "exit_nonzero" }, expected: "session_exit_nonzero" },
			{ handler: "draft_plan", behavior: { planning: "invalid_output" }, expected: "expected_output_invalid" },
		];

		for (const testCase of cases) {
			const workspace = makeWorkspace();
			const harness = makeHarness(workspace, { behavior: testCase.behavior });
			const event: NormalizedLoopEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: `evt-${testCase.handler}-${testCase.expected}`,
				kind: "E1_NEW_ISSUE",
				timestamp: TS,
				issue_number: 30,
				title: "Evidence-only session",
				body: "Execute the agent handler",
				author: "human-owner",
				labels: [],
				created_at: TS,
				updated_at: TS,
			};
			const decision: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: `dec-${testCase.expected}`,
				event_id: event.event_id,
				event_kind: event.kind,
				target: eventTarget(event),
				handler: testCase.handler,
				tier: 2,
				reason: "fixture",
				guard: null,
				classification: null,
				dry_run: false,
				mutations: [],
				recorded_at: TS,
			};

			const result = await dispatchDecisions({
				root: workspace.root,
				stateDir: workspace.stateDir,
				loopConfig: workspace.loopConfig,
				events: [event],
				decisions: [decision],
				snapshot: snapshotOf([issue(30, "Evidence-only session")]),
				state: initLoopState(),
				gitHubPort: harness.gitHubPort,
				guardFacts: { daemon_identity: "daemon-bot" },
				dryRun: false,
				now: TS,
				agentPort: harness.port,
			});

			expect(result.dispatches).toHaveLength(1);
			expect(result.dispatches[0]!.outcome).toBe("failed");
			expect(result.dispatches[0]!.detail).toContain(testCase.expected);
			// A plan the daemon cannot parse writes no plan artifact at all (S2-AC2).
			if (testCase.handler === "draft_plan") {
				expect(readPlanPublication(workspace.stateDir, 30)).toBeNull();
				expect(harness.kernel.calls.filter((call) => call.argv[1] === "author")).toHaveLength(0);
			}
			workspace.cleanup();
		}
	});

	it("refuses a daemon-authored approval comment", async () => {
		const workspace = makeWorkspace();
		cleanups.push(workspace.cleanup);
		const harness = makeHarness(workspace);

		await runLoopDaemonCli(["tick"], workspace.root, {
			gh: mockGh(),
			gitHubPort: harness.gitHubPort,
			snapshotOverride: snapshotOf([issue(10, "Add the S9 fixture behaviour")]),
			guardFacts: { daemon_identity: "daemon-bot" },
			classify: s9IssueClassifier,
			agentPort: harness.port,
			standingDaemon: true,
		});
		const plan = readPlanPublication(workspace.stateDir, 10)!;

		const approvedAt = new Date(Date.parse(TS) + 60_000).toISOString();
		harness.comments.byId.set(9005, {
			body: `/approve ${plan.digest}`,
			author: "daemon-bot",
			author_association: "MEMBER",
			created_at: approvedAt,
			updated_at: approvedAt,
		});
		const event: NormalizedLoopEvent = {
			contract: LOOP_DAEMON_EVENT_CONTRACT,
			event_id: "evt-e4-daemon-authored",
			kind: "E4_PLAN_APPROVED",
			timestamp: TS,
			issue_number: 10,
			comment_id: 9005,
			author: "daemon-bot",
			author_association: "MEMBER",
			plan_digest: plan.digest,
			approved_at: approvedAt,
		};
		const decision: LoopDecisionRecord = {
			contract: "assurance_kernel/loop_decision_record/v1",
			decision_id: "dec-daemon-authored",
			event_id: event.event_id,
			event_kind: event.kind,
			target: eventTarget(event),
			handler: "enroll_and_drive",
			tier: 1,
			reason: "fixture",
			guard: null,
			classification: null,
			dry_run: false,
			mutations: [],
			recorded_at: TS,
		};

		const result = await dispatchDecisions({
			root: workspace.root,
			stateDir: workspace.stateDir,
			loopConfig: workspace.loopConfig,
			events: [event],
			decisions: [decision],
			snapshot: snapshotOf([issue(10, "Add the S9 fixture behaviour")]),
			state: initLoopState(),
			gitHubPort: harness.gitHubPort,
			guardFacts: { daemon_identity: "daemon-bot" },
			dryRun: false,
			now: TS,
			agentPort: harness.port,
			standingDaemon: true,
		});

		expect(result.dispatches[0]!.outcome).toBe("failed");
		expect(result.dispatches[0]!.detail).toContain("tracker_approval_daemon_authored");
		expect(harness.enrollments).toHaveLength(0);
	});

	it("keeps the S7 two-attempt cap and escalates the third failure for the same head and signature", async () => {
		const workspace = makeWorkspace();
		cleanups.push(workspace.cleanup);
		const harness = makeHarness(workspace);

		const headSha = "a".repeat(40);
		const failureSignature = "b".repeat(64);
		saveRepairRetries(workspace.stateDir, { [repairKey(headSha, failureSignature)]: 2 });

		const event: NormalizedLoopEvent = {
			contract: LOOP_DAEMON_EVENT_CONTRACT,
			event_id: "evt-e8-third-failure",
			kind: "E8_PR_CHECK_FAILED",
			timestamp: TS,
			pr_number: 77,
			branch: `imm/${PLAN_TASK_ID}`,
			head_sha: headSha,
			check_name: "typecheck",
			failure_signature: failureSignature,
		};
		const pr: RawPR = {
			number: 77,
			title: "imm(s9): fixture",
			body: `${LOOP_PR_MARKER}\n\nCloses #10`,
			head_ref_name: `imm/${PLAN_TASK_ID}`,
			head_sha: headSha,
			base_ref_name: "main",
			state: "open",
			merged: false,
			mergeable: "MERGEABLE",
			checks: [],
		};
		const decision: LoopDecisionRecord = {
			contract: "assurance_kernel/loop_decision_record/v1",
			decision_id: "dec-e8-third",
			event_id: event.event_id,
			event_kind: event.kind,
			target: eventTarget(event),
			handler: "repair_pr_ci",
			tier: 1,
			reason: "fixture",
			guard: null,
			classification: null,
			dry_run: false,
			mutations: [],
			recorded_at: TS,
		};

		const result = await dispatchDecisions({
			root: workspace.root,
			stateDir: workspace.stateDir,
			loopConfig: workspace.loopConfig,
			events: [event],
			decisions: [decision],
			snapshot: snapshotOf([issue(10, "Add the S9 fixture behaviour")], [pr]),
			state: initLoopState(),
			gitHubPort: harness.gitHubPort,
			guardFacts: { daemon_identity: "daemon-bot", retry_counts: { [repairKey(headSha, failureSignature)]: 2 } },
			dryRun: false,
			now: TS,
			agentPort: harness.port,
			standingDaemon: true,
		});

		expect(result.dispatches[0]!.outcome).toBe("failed");
		expect(result.dispatches[0]!.detail).toContain("repair attempt limit");
		expect(harness.sessions.requests).toHaveLength(0);
	});

	it("escalates a review comment whose path is outside the TaskIntent scope_hint", async () => {
		const workspace = makeWorkspace();
		cleanups.push(workspace.cleanup);
		const harness = makeHarness(workspace, { scopeHint: ["src/"] });

		const event: NormalizedLoopEvent = {
			contract: LOOP_DAEMON_EVENT_CONTRACT,
			event_id: "evt-e10-out-of-scope",
			kind: "E10_PR_REVIEW_COMMENT",
			timestamp: TS,
			pr_number: 78,
			branch: `imm/${PLAN_TASK_ID}`,
			comment_id: 8801,
			author: "lead-reviewer",
			author_association: "MEMBER",
			body: "Please also rewrite the release notes.",
			path: "docs/release-notes.md",
		};
		const pr: RawPR = {
			number: 78,
			title: "imm(s9): fixture",
			body: `${LOOP_PR_MARKER}\n\nCloses #10`,
			head_ref_name: `imm/${PLAN_TASK_ID}`,
			head_sha: "c".repeat(40),
			base_ref_name: "main",
			state: "open",
			merged: false,
			mergeable: "MERGEABLE",
			checks: [],
		};
		const decision: LoopDecisionRecord = {
			contract: "assurance_kernel/loop_decision_record/v1",
			decision_id: "dec-e10-out-of-scope",
			event_id: event.event_id,
			event_kind: event.kind,
			target: eventTarget(event),
			handler: "address_pr_review",
			tier: 2,
			reason: "fixture",
			guard: null,
			classification: null,
			dry_run: false,
			mutations: [],
			recorded_at: TS,
		};

		const result = await dispatchDecisions({
			root: workspace.root,
			stateDir: workspace.stateDir,
			loopConfig: workspace.loopConfig,
			events: [event],
			decisions: [decision],
			snapshot: snapshotOf([issue(10, "Add the S9 fixture behaviour")], [pr]),
			state: initLoopState(),
			gitHubPort: harness.gitHubPort,
			guardFacts: { daemon_identity: "daemon-bot" },
			dryRun: false,
			now: TS,
			agentPort: harness.port,
			standingDaemon: true,
		});

		expect(result.dispatches[0]!.outcome).toBe("failed");
		expect(result.dispatches[0]!.detail).toContain("unauthorized path");
		expect(harness.sessions.requests).toHaveLength(0);
	});

	it("resolves pluginRoot from runtime location so default deps run imm-kernel in external repositories", () => {
		const workspace = makeWorkspace();
		cleanups.push(workspace.cleanup);
		expect(existsSync(join(workspace.root, "plugins", "immune-brain"))).toBe(false);

		const deps = createDefaultAgentHandlerDeps(workspace.root);
		const inspected = deps.runKernel({ argv: ["inspect", "--json"], cwd: workspace.root });

		expect(inspected.exit_code).toBe(0);
		expect((inspected.json as any)?.contract).toBe("assurance_kernel/inspect/v1");
	});
});
