/**
 * Loop Daemon: Clarify and Plan Tests (S7)
 *
 * Verifies S7-AC1 to S7-AC3 under docs/specs/loop-agent-scheduling.spec.md
 * (BR-SCN-1, BR-GAP-A2 – A4, D8), against fake GitHub and session ports:
 * - Positive control: a `clarify` result with questions posts exactly one
 *   `clarify_question` through the Interaction protocol, the work item waits in
 *   `awaiting_input`, and an allowlisted reply re-runs `clarify` with the answer
 *   and then plans; a15 maps `clear_single_task` and
 *   `needs_initiative_decomposition` to `plan` and `needs_clarification` to
 *   `clarify`; the plan prompt carries the framing; every intent of an approved
 *   plan is enrolled and driven as one batch.
 * - Negative control: a non-allowlisted reply resumes nothing, and an approval
 *   naming another digest enrolls nothing.
 * - Boundary control: a tick that observes no answer posts nothing new.
 */

import { parseInteractionMarker } from "../plugins/immune-brain/runtime/loop_daemon/interaction/github_channel.ts";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { LoopConfig } from "../plugins/immune-brain/runtime/config/layered_config.ts";
import type { GhExecution, GhTransport } from "../plugins/immune-brain/runtime/github_issue_tracker.ts";
import {
	createAgentHandlerPort,
	readPlanPublication,
	type AgentDriveRequest,
	type AgentDriveResult,
	type AgentEnrollRequest,
	type AgentHandlerDeps,
	type AgentTaskIntent,
} from "../plugins/immune-brain/runtime/loop_daemon/agent_handlers.ts";
import type { AgentSessionKind, AgentSessionProvider } from "../plugins/immune-brain/runtime/loop_daemon/agent_runner.ts";
import { runLoopDaemonCli } from "../plugins/immune-brain/runtime/loop_daemon/cli.ts";
import type { LoopDecisionRecord } from "../plugins/immune-brain/runtime/loop_daemon/decision_record.ts";
import { dispatchDecisions } from "../plugins/immune-brain/runtime/loop_daemon/dispatch.ts";
import { createFakeLoopGitHubPort } from "../plugins/immune-brain/runtime/loop_daemon/github_port.ts";
import { eventTarget } from "../plugins/immune-brain/runtime/loop_daemon/guards.ts";
import { setCachedDaemonGithubLogin } from "../plugins/immune-brain/runtime/loop_daemon/identity.ts";
import { judgeEvent } from "../plugins/immune-brain/runtime/loop_daemon/judgement.ts";
import { initLoopState } from "../plugins/immune-brain/runtime/loop_daemon/state.ts";
import {
	LOOP_DAEMON_EVENT_CONTRACT,
	type NormalizedLoopEvent,
	type ObservationInput,
	type RawComment,
	type RawIssue,
} from "../plugins/immune-brain/runtime/loop_daemon/types.ts";
import { readWorkItem } from "../plugins/immune-brain/runtime/loop_daemon/work_items.ts";
import {
	readLocalRequest,
	readLocalRequests,
	writeLocalAnswer,
} from "../plugins/immune-brain/runtime/loop_daemon/interaction/local_channel.ts";

const TS = "2026-11-12T10:00:00.000Z";
const ONE_TASK = "s7-single-task";
const TWO_TASKS = ["s7-batch-one", "s7-batch-two"];

function git(root: string, argv: string[]): string {
	return execFileSync("git", ["-C", root, ...argv], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

interface Workspace {
	root: string;
	stateDir: string;
	loopConfig: LoopConfig;
}

function makeWorkspace(options: { channel?: "github" | "local" } = {}): Workspace {
	const root = mkdtempSync(join(tmpdir(), "imm-clarify-plan-"));
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
	};

	mkdirSync(join(root, "docs/agents"), { recursive: true });
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	writeFileSync(join(root, "docs/plans/.gitkeep"), "");
	mkdirSync(join(root, "src"), { recursive: true });
	writeFileSync(join(root, "src/seed.ts"), "export const seed = 1;\n");
	writeFileSync(
		join(root, "docs/agents/no-touch.json"),
		JSON.stringify({ contract: "immune_brain/no_touch/v1", paths: [] }, null, 2),
	);
	mkdirSync(join(root, ".imm"), { recursive: true });
	writeFileSync(
		join(root, ".imm/config.json"),
		JSON.stringify(
			{
				contract: "immune_brain/project_config/v1",
				loop: {
					mode: loopConfig.mode,
					interval_seconds: loopConfig.interval_seconds,
					max_concurrent: loopConfig.max_concurrent,
					max_ready_buffer: loopConfig.max_ready_buffer,
					max_pr_buffer: loopConfig.max_pr_buffer,
					auto_enroll_max_risk: loopConfig.auto_enroll_max_risk,
					allowed_actors: loopConfig.allowed_actors,
					allowed_associations: loopConfig.allowed_associations,
					...(options.channel ? { interaction: { channel: options.channel } } : {}),
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
	return { root, stateDir, loopConfig };
}

function mockGh(userLogin = "daemon-bot"): GhTransport {
	return {
		run: async (args: string[]): Promise<GhExecution> => {
			if (args[0] === "api" && args[1] === "user") {
				return {
					exit_code: 0,
					stdout: JSON.stringify({ login: userLogin }),
					stderr: "",
					timed_out: false,
					output_exceeded: false,
				};
			}
			return { exit_code: 0, stdout: "[]", stderr: "", timed_out: false, output_exceeded: false };
		},
	};
}

/* ------------------------------------------------------------------ */
/* Fake session provider: the clarify framing and the plan candidate   */
/* ------------------------------------------------------------------ */

interface FakeSessions {
	provider: AgentSessionProvider;
	requests: Array<{ kind: AgentSessionKind; prompt: string }>;
}

function createFakeSessions(planTaskIds: string[], options: { askQuestion?: boolean } = {}): FakeSessions {
	const requests: Array<{ kind: AgentSessionKind; prompt: string }> = [];
	const provider: AgentSessionProvider = {
		async run(request) {
			requests.push({ kind: request.kind, prompt: request.prompt });
			if (request.kind === "clarify") {
				const answered = request.prompt.includes("The owner answered the clarification question:");
				if (options.askQuestion && !answered) {
					return {
						exit_code: 0,
						exit_signal: null,
						timed_out: false,
						stdout: JSON.stringify({ questions: ["Which existing seam should the plan extend?"] }),
					};
				}
				return {
					exit_code: 0,
					exit_signal: null,
					timed_out: false,
					stdout: JSON.stringify({
						scopes: ["src/seed.ts"],
						seams: ["src/seed.ts#seed"],
						risks: ["the plan could extend a seam that does not exist"],
						acceptance: ["the plan names the seam it extends"],
					}),
				};
			}
			return {
				exit_code: 0,
				exit_signal: null,
				timed_out: false,
				stdout: JSON.stringify({
					intents: planTaskIds.map((taskId) => ({
						path: `docs/plans/${taskId}.intent.json`,
						intent: {
							contract: "assurance_kernel/task_intent/v1",
							task_id: taskId,
							owner: "user",
							goal: `Deliver ${taskId}`,
							acceptance: [{ id: "AC1", assertion: "the task delivers", verification: "{\"contract\":\"x\"}" }],
							scope_hint: [taskId === TWO_TASKS[1] ? "src/other/" : "src/"],
							risk: "routine",
							revision: 1,
						},
					})),
					spec: null,
				}),
			};
		},
	};
	return { provider, requests };
}

function createFakeKernel(): AgentHandlerDeps["runKernel"] {
	return (input) => {
		if (input.argv[0] === "intent" && input.argv[1] === "author") {
			const path = input.argv[2]!;
			writeFileSync(join(input.cwd, path), input.stdin ?? "{}\n");
			const parsed = JSON.parse(input.stdin ?? "{}") as { task_id?: string; risk?: string };
			return {
				exit_code: 0,
				json: {
					valid: true,
					enrollment_ready: true,
					task_id: parsed.task_id ?? ONE_TASK,
					risk: parsed.risk ?? "routine",
					content_hash: `sha256:${"a".repeat(64)}`,
				},
			};
		}
		if (input.argv[0] === "intent" && input.argv[1] === "overlap") {
			return { exit_code: 0, json: { contract: "assurance_kernel/intent_scope_overlap/v1", overlaps: [] } };
		}
		return { exit_code: 1, json: { reason: `unsupported kernel call: ${input.argv.join(" ")}` } };
	};
}

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

interface Harness {
	workspace: Workspace;
	sessions: FakeSessions;
	gitHubPort: ReturnType<typeof createFakeLoopGitHubPort>;
	enrollments: AgentEnrollRequest[];
	drives: AgentDriveRequest[];
	comments: Map<
		number,
		{ body: string; author: string; author_association: string; created_at: string; updated_at: string }
	>;
	deps: AgentHandlerDeps;
	port: ReturnType<typeof createAgentHandlerPort>;
}

function makeHarness(
	workspace: Workspace,
	planTaskIds: string[] = [ONE_TASK],
	options: { askQuestion?: boolean } = {},
): Harness {
	const sessions = createFakeSessions(planTaskIds, options);
	const comments = new Map<
		number,
		{ body: string; author: string; author_association: string; created_at: string; updated_at: string }
	>();
	const gitHubPort = createFakeLoopGitHubPort();
	const enrollments: AgentEnrollRequest[] = [];
	const drives: AgentDriveRequest[] = [];

	const intents = new Map<string, AgentTaskIntent>(
		planTaskIds.map((taskId) => [
			taskId,
			{
				task_id: taskId,
				path: `docs/plans/${taskId}.intent.json`,
				revision: 1,
				content_hash: `sha256:${"a".repeat(64)}`,
				risk: "routine",
				scope_hint: [taskId === TWO_TASKS[1] ? "src/other/" : "src/"],
			},
		]),
	);

	// Mirrors the daemon's own seam: a detached probe tree is reused at HEAD.
	const createWorktree: AgentHandlerDeps["createWorktree"] = ({ root, branch, name }) => {
		const path = join(root, ".imm-worktrees", name);
		mkdirSync(dirname(path), { recursive: true });
		if (existsSync(path)) {
			if (branch !== null) return path;
			git(path, ["checkout", "--detach", git(root, ["rev-parse", "HEAD"]).trim()]);
			return path;
		}
		git(
			root,
			branch === null ? ["worktree", "add", "--detach", path, "HEAD"] : ["worktree", "add", "-b", branch, path, "HEAD"],
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
			git(root, ["worktree", "add", "-b", branch, path, "HEAD"]);
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
		runKernel: createFakeKernel(),
		readIntent: (taskId) => intents.get(taskId) ?? null,
		readComment: async ({ comment_id }) => {
			const found = comments.get(comment_id);
			return found ? { ...found } : null;
		},
		enroll: async (input) => {
			enrollments.push(input);
			return { record_revision: `sha256:${"b".repeat(64)}` };
		},
		drive: async (input): Promise<AgentDriveResult> => {
			drives.push(input);
			return {
				settled: true,
				exit: {
					state: "exited",
					exit_code: 0,
					generation: 1,
					final_commit_sha: "d".repeat(40),
					verification_evidence_digest: `sha256:${"c".repeat(64)}`,
				},
				reason: "settled",
			};
		},
		runVerification: async () => ({ exit_code: 0, stdout: "", stderr: "" }),
		gitCommitAndPush: async () => ({ commit_sha: "e".repeat(40) }),
		rebaseOrMerge: async () => ({ success: true }),
		now: () => TS,
	};

	return {
		workspace,
		sessions,
		gitHubPort,
		enrollments,
		drives,
		comments,
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

function snapshotOf(issues: RawIssue[]): ObservationInput {
	return { issues, pull_requests: [], lane_decisions: [], observed_at: TS };
}

function classifierFor(choice: string) {
	return async (point: string) => {
		if (point === "a18_event_prefilter") return { status: "decided" as const, choice: "actionable", confidence: 0.95 };
		if (point === "a15_task_granularity") return { status: "decided" as const, choice, confidence: 0.9 };
		return { status: "unavailable" as const, reason: "no_binding" as const, detail: "unused in the S7 fixture" };
	};
}

function clarifyComments(harness: Harness, issueNumber: number) {
	return [...harness.gitHubPort.comments.values()].filter(
		(comment) => comment.issueNumber === issueNumber && comment.body.includes("immune-brain:interaction="),
	);
}

function comment(id: number, body: string, input: { author: string; association: string; created_at: string }): RawComment {
	return {
		id,
		body,
		user: { login: input.author },
		author_association: input.association,
		created_at: input.created_at,
		updated_at: input.created_at,
	};
}

async function tick(
	harness: Harness,
	input: { issues: RawIssue[]; choice?: string },
): ReturnType<typeof runLoopDaemonCli> {
	return runLoopDaemonCli(["tick", "--json"], harness.workspace.root, {
		gh: mockGh(),
		gitHubPort: harness.gitHubPort,
		snapshotOverride: snapshotOf(input.issues),
		guardFacts: { daemon_identity: "daemon-bot" },
		classify: classifierFor(input.choice ?? "clear_single_task"),
		agentPort: harness.port,
		standingDaemon: true,
	});
}

function jsonPayload(stdout: string): any {
	return JSON.parse(stdout);
}

/* ------------------------------------------------------------------ */
/* Tests                                                              */
/* ------------------------------------------------------------------ */

describe("S7 clarify and plan", () => {
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

	function workspaceWithCleanup(options: { channel?: "github" | "local" } = {}): Workspace {
		const workspace = makeWorkspace(options);
		cleanups.push(() => rmSync(workspace.root, { recursive: true, force: true }));
		return workspace;
	}

	it("posts exactly one clarify_question, waits in awaiting_input, and resumes with the answer (S7-AC1)", async () => {
		const workspace = workspaceWithCleanup();
		const harness = makeHarness(workspace, [ONE_TASK], { askQuestion: true });

		// Tick 1: a15 says the Issue needs clarification, so clarify asks.
		const first = await tick(harness, { issues: [issue(10, "Add the S7 fixture behaviour")], choice: "needs_clarification" });
		expect(first.returncode).toBe(0);
		const firstPayload = jsonPayload(first.stdout);
		expect(firstPayload.dispatches).toHaveLength(1);
		expect(firstPayload.dispatches[0]).toMatchObject({ handler: "clarify_issue", outcome: "executed" });
		expect(firstPayload.dispatches[0].detail).toContain("await");

		// One interaction comment carries the question; nothing was planned.
		const asked = clarifyComments(harness, 10);
		expect(asked).toHaveLength(1);
		expect(asked[0]!.body).toContain("kind=clarify_question");
		expect(asked[0]!.body).toContain("Which existing seam should the plan extend?");
		expect(harness.sessions.requests.map((request) => request.kind)).toEqual(["clarify"]);
		expect(readPlanPublication(workspace.stateDir, 10)).toBeNull();

		// The work item waits on that one interaction.
		const waiting = readWorkItem(workspace.stateDir, "issue-10");
		expect(waiting?.state).toBe("awaiting_input");
		expect(waiting?.pending_interactions).toHaveLength(1);

		// Boundary: a tick that observes no answer posts nothing new.
		const second = await tick(harness, { issues: [issue(10, "Add the S7 fixture behaviour")], choice: "needs_clarification" });
		expect(second.returncode).toBe(0);
		expect(clarifyComments(harness, 10)).toHaveLength(1);
		expect(harness.sessions.requests.map((request) => request.kind)).toEqual(["clarify"]);

		// The allowlisted owner answers; the tick re-runs clarify with that answer and plans.
		const answeredAt = new Date(Date.now() + 120_000).toISOString();
		const askedAt = new Date(Date.now() - 60_000).toISOString();
		const answer = comment(9001, "Extend src/seed.ts, it is the only seam.", {
			author: "human-owner",
			association: "OWNER",
			created_at: answeredAt,
		});
		const question: RawComment = comment(asked[0]!.id, asked[0]!.body, {
			author: "daemon-bot",
			association: "COLLABORATOR",
			created_at: askedAt,
		});
		const third = await tick(harness, { issues: [issue(10, "Add the S7 fixture behaviour", [question, answer])] });
		expect(third.returncode).toBe(0);
		const thirdPayload = jsonPayload(third.stdout);
		expect(thirdPayload.dispatches).toHaveLength(1);
		expect(thirdPayload.dispatches[0]).toMatchObject({ handler: "apply_clarify_reply", outcome: "executed" });
		expect(thirdPayload.dispatches[0].detail).toContain("human-owner");

		// Clarify ran again with the answer appended, and the plan followed.
		expect(harness.sessions.requests.map((request) => request.kind)).toEqual(["clarify", "clarify", "planning"]);
		expect(harness.sessions.requests[1]!.prompt).toContain("The owner answered the clarification question:");
		expect(harness.sessions.requests[1]!.prompt).toContain("Extend src/seed.ts");
		const plan = readPlanPublication(workspace.stateDir, 10);
		expect(plan).not.toBeNull();
		expect(plan!.task_id).toBe(ONE_TASK);
		expect(plan!.published_at).not.toBeNull();
		expect(readWorkItem(workspace.stateDir, "issue-10")?.state).toBe("plan_published");
	});

	it("asks through the local channel and resumes only on a locally confirmed answer (S7-AC1, D4)", async () => {
		const workspace = workspaceWithCleanup({ channel: "local" });
		const harness = makeHarness(workspace, [ONE_TASK], { askQuestion: true });
		const body = "Add the S7 fixture behaviour";

		const first = await tick(harness, { issues: [issue(10, body)], choice: "needs_clarification" });
		expect(jsonPayload(first.stdout).dispatches[0]).toMatchObject({ handler: "clarify_issue", outcome: "executed" });
		// The question is a local request file, not a GitHub comment.
		expect(clarifyComments(harness, 10)).toHaveLength(0);
		const [request] = readLocalRequests(workspace.stateDir);
		expect(request?.kind).toBe("clarify_question");
		expect(readWorkItem(workspace.stateDir, "issue-10")?.pending_interactions).toEqual([request!.interaction_id]);

		// No answer yet: nothing resumes.
		const waiting = await tick(harness, { issues: [issue(10, body)] });
		expect(jsonPayload(waiting.stdout).dispatches).toHaveLength(0);
		expect(harness.sessions.requests.map((r) => r.kind)).toEqual(["clarify"]);

		writeLocalAnswer(workspace.stateDir, {
			interaction_id: request!.interaction_id,
			kind: request!.kind,
			subject: request!.subject,
			binding: request!.binding,
			value: "Extend src/seed.ts, it is the only seam.",
			confirmation: { tool: "answer_loop_interaction", confirmed_at: TS, confirmation_ref: "fixture" },
		});
		const answered = await tick(harness, { issues: [issue(10, body)] });
		const payload = jsonPayload(answered.stdout);
		expect(payload.dispatches).toHaveLength(1);
		expect(payload.dispatches[0]).toMatchObject({ handler: "apply_clarify_reply", outcome: "executed" });
		expect(harness.sessions.requests.map((r) => r.kind)).toEqual(["clarify", "clarify", "planning"]);
		expect(harness.sessions.requests[1]!.prompt).toContain("Extend src/seed.ts");
		expect(readWorkItem(workspace.stateDir, "issue-10")?.state).toBe("plan_published");
		// The answer is consumed once.
		expect(readLocalRequest(workspace.stateDir, request!.interaction_id)).toBeNull();
	});

	it("parks a draft_plan question in awaiting_input and resumes it (S7-AC1)", async () => {
		const workspace = workspaceWithCleanup();
		const harness = makeHarness(workspace, [ONE_TASK], { askQuestion: true });

		// a15 sends a clear task straight to planning; clarify still has to ask.
		const first = await tick(harness, { issues: [issue(17, "A clear task with one missing fact")] });
		expect(first.returncode).toBe(0);
		const firstPayload = jsonPayload(first.stdout);
		expect(firstPayload.dispatches[0]).toMatchObject({ handler: "draft_plan", outcome: "executed" });
		expect(clarifyComments(harness, 17)).toHaveLength(1);

		// The planning item falls back to clarifying, so its question has a park.
		const waiting = readWorkItem(workspace.stateDir, "issue-17");
		expect(waiting?.state).toBe("awaiting_input");
		expect(waiting?.pending_interactions).toHaveLength(1);
		expect(readPlanPublication(workspace.stateDir, 17)).toBeNull();

		const asked = clarifyComments(harness, 17);
		const question: RawComment = comment(asked[0]!.id, asked[0]!.body, {
			author: "daemon-bot",
			association: "COLLABORATOR",
			created_at: new Date(Date.now() - 60_000).toISOString(),
		});
		const answer = comment(9010, "Extend src/seed.ts.", {
			author: "human-owner",
			association: "OWNER",
			created_at: new Date(Date.now() + 120_000).toISOString(),
		});

		const resumed = await tick(harness, { issues: [issue(17, "A clear task with one missing fact", [question, answer])] });
		expect(resumed.returncode).toBe(0);
		expect(jsonPayload(resumed.stdout).dispatches[0]).toMatchObject({
			handler: "apply_clarify_reply",
			outcome: "executed",
		});
		expect(harness.sessions.requests.map((request) => request.kind)).toEqual(["clarify", "clarify", "planning"]);
		expect(harness.sessions.requests[1]!.prompt).toContain("Extend src/seed.ts.");
		expect(readPlanPublication(workspace.stateDir, 17)).not.toBeNull();
		expect(readWorkItem(workspace.stateDir, "issue-17")?.state).toBe("plan_published");
	});

	it("does not resume on a reply the allowlist does not name (S7-AC1 negative)", async () => {
		const workspace = workspaceWithCleanup();
		const harness = makeHarness(workspace, [ONE_TASK], { askQuestion: true });

		await tick(harness, { issues: [issue(11, "Add the S7 fixture behaviour")], choice: "needs_clarification" });
		const asked = clarifyComments(harness, 11);
		expect(asked).toHaveLength(1);

		const askedAt = new Date(Date.now() - 60_000).toISOString();
		const question: RawComment = comment(asked[0]!.id, asked[0]!.body, {
			author: "daemon-bot",
			association: "COLLABORATOR",
			created_at: askedAt,
		});
		const stranger = comment(9002, "Just do it.", {
			author: "random-user",
			association: "NONE",
			created_at: new Date(Date.now() + 120_000).toISOString(),
		});

		const resumed = await tick(harness, { issues: [issue(11, "Add the S7 fixture behaviour", [question, stranger])] });
		expect(resumed.returncode).toBe(0);
		const payload = jsonPayload(resumed.stdout);
		// G7 holds an unverified actor before the reply can reach the handler at all.
		expect(payload.dispatches.map((dispatch: { handler: string }) => dispatch.handler)).not.toContain(
			"apply_clarify_reply",
		);

		// Nothing resumed: no second clarify, no plan, and the item still waits.
		expect(harness.sessions.requests.map((request) => request.kind)).toEqual(["clarify"]);
		expect(readPlanPublication(workspace.stateDir, 11)).toBeNull();
		expect(readWorkItem(workspace.stateDir, "issue-11")?.state).toBe("awaiting_input");
	});

	it("maps the three a15 outcomes to plan, plan and clarify (S7-AC2)", async () => {
		const event: NormalizedLoopEvent = {
			contract: LOOP_DAEMON_EVENT_CONTRACT,
			event_id: "evt-s7-a15",
			kind: "E1_NEW_ISSUE",
			timestamp: TS,
			issue_number: 12,
			title: "Granularity",
			body: "Decide what this Issue needs",
			author: "human-owner",
			labels: [],
			created_at: TS,
			updated_at: TS,
		};
		const expectations: Array<[string, string]> = [
			["clear_single_task", "draft_plan"],
			["needs_initiative_decomposition", "draft_plan"],
			["needs_clarification", "clarify_issue"],
		];
		for (const [choice, handler] of expectations) {
			const judgement = await judgeEvent(event, { classify: classifierFor(choice) });
			expect(judgement.handler).toBe(handler as never);
			expect(judgement.classification).toMatchObject({ point: "a15_task_granularity", choice });
		}
	});

	it("gives the plan the clarify framing and a decomposition instruction (S7-AC2)", async () => {
		const workspace = workspaceWithCleanup();
		const harness = makeHarness(workspace, [ONE_TASK]);

		const planned = await tick(harness, { issues: [issue(13, "Plan with the framing")] });
		expect(planned.returncode).toBe(0);
		const plannedPayload = jsonPayload(planned.stdout);
		expect(plannedPayload.dispatches[0]).toMatchObject({ handler: "draft_plan", outcome: "executed" });
		const planning = harness.sessions.requests.find((request) => request.kind === "planning")!;
		expect(planning.prompt).toContain("Clarify framing:");
		expect(planning.prompt).toContain("scopes: src/seed.ts");
		expect(planning.prompt).toContain("seams: src/seed.ts#seed");
		expect(planning.prompt).toContain("risks: the plan could extend a seam that does not exist");
		expect(planning.prompt).toContain("acceptance: the plan names the seam it extends");
		// D3: the published plan summary is the plan_approval request, bound to its digest.
		const planComment = [...harness.gitHubPort.comments.values()].find((c) => c.issueNumber === 13)!;
		const planMarker = parseInteractionMarker(planComment.body);
		expect(planMarker).toMatchObject({ kind: "plan_approval", authority: "literal_user" });
		expect(planMarker?.binding.plan_digest).toMatch(/^[0-9a-f]{64}$|^sha256:/);

		// The decomposition instruction reaches the same prompt on a15's word.
		const decomposed = workspaceWithCleanup();
		const decompositionHarness = makeHarness(decomposed, [ONE_TASK]);
		const event: NormalizedLoopEvent = {
			contract: LOOP_DAEMON_EVENT_CONTRACT,
			event_id: "evt-s7-decompose",
			kind: "E1_NEW_ISSUE",
			timestamp: TS,
			issue_number: 14,
			title: "Decompose this",
			body: "Split the Initiative",
			author: "human-owner",
			labels: [],
			created_at: TS,
			updated_at: TS,
		};
		const decision: LoopDecisionRecord = {
			contract: "assurance_kernel/loop_decision_record/v1",
			decision_id: "dec-s7-decompose",
			event_id: event.event_id,
			event_kind: event.kind,
			target: eventTarget(event),
			handler: "draft_plan",
			tier: 2,
			reason: "a15 asked for a decomposition",
			guard: null,
			classification: { point: "a15_task_granularity", choice: "needs_initiative_decomposition", confidence: 0.9 },
			dry_run: false,
			mutations: [],
			recorded_at: TS,
		};
		await dispatchDecisions({
			root: decomposed.root,
			stateDir: decomposed.stateDir,
			loopConfig: decomposed.loopConfig,
			events: [event],
			decisions: [decision],
			snapshot: snapshotOf([issue(14, "Split the Initiative")]),
			state: initLoopState(),
			gitHubPort: decompositionHarness.gitHubPort,
			guardFacts: { daemon_identity: "daemon-bot" },
			dryRun: false,
			now: TS,
			agentPort: decompositionHarness.port,
		});
		const decompositionPrompt = decompositionHarness.sessions.requests.find((request) => request.kind === "planning")!.prompt;
		expect(decompositionPrompt).toContain("Decompose the Issue into an Initiative");
	});

	it("enrolls and drives every intent of an approved plan as one batch (S7-AC3)", async () => {
		const workspace = workspaceWithCleanup();
		const harness = makeHarness(workspace, TWO_TASKS);

		const planned = await tick(harness, { issues: [issue(15, "Two intents")] });
		expect(planned.returncode).toBe(0);
		const plan = readPlanPublication(workspace.stateDir, 15)!;
		expect(plan.intents.map((intent) => intent.task_id)).toEqual(TWO_TASKS);

		const approvedAt = new Date(Date.now() + 120_000).toISOString();
		harness.comments.set(9100, {
			body: `/approve ${plan.digest}`,
			author: "human-owner",
			author_association: "OWNER",
			created_at: approvedAt,
			updated_at: approvedAt,
		});
		const approval = comment(9100, `/approve ${plan.digest}`, {
			author: "human-owner",
			association: "OWNER",
			created_at: approvedAt,
		});

		const approved = await tick(harness, { issues: [issue(15, "Two intents", [approval])] });
		expect(approved.returncode).toBe(0);
		const payload = jsonPayload(approved.stdout);
		expect(payload.dispatches[0]).toMatchObject({ handler: "enroll_and_drive", outcome: "executed" });
		expect(payload.dispatches[0].detail).toContain(TWO_TASKS.join(", "));
		expect(payload.dispatches).toHaveLength(1);

		// Both intents were enrolled and one batch job drives both, in plan order.
		expect(harness.enrollments.map((enrollment) => enrollment.task_id)).toEqual(TWO_TASKS);
		expect(harness.enrollments.every((enrollment) => enrollment.plan_digest === plan.digest)).toBe(true);
		expect(harness.drives.map((drive) => drive.task_id)).toEqual(TWO_TASKS);
		expect(harness.drives.every((drive) => drive.plan_digest === plan.digest)).toBe(true);
	});

	it("enrolls nothing when the approval names another digest (S7-AC3 negative)", async () => {
		const workspace = workspaceWithCleanup();
		const harness = makeHarness(workspace, TWO_TASKS);

		await tick(harness, { issues: [issue(16, "Two intents")] });
		const plan = readPlanPublication(workspace.stateDir, 16)!;
		const otherDigest = plan.digest === "f".repeat(64) ? "e".repeat(64) : "f".repeat(64);
		const approvedAt = new Date(Date.now() + 120_000).toISOString();
		harness.comments.set(9200, {
			body: `/approve ${otherDigest}`,
			author: "human-owner",
			author_association: "OWNER",
			created_at: approvedAt,
			updated_at: approvedAt,
		});
		const approval = comment(9200, `/approve ${otherDigest}`, {
			author: "human-owner",
			association: "OWNER",
			created_at: approvedAt,
		});

		const refused = await tick(harness, { issues: [issue(16, "Two intents", [approval])] });
		expect(refused.returncode).toBe(0);
		// G8 refuses the mismatched digest before any handler can enroll anything.
		expect(jsonPayload(refused.stdout).dispatches).toHaveLength(0);
		expect(harness.enrollments).toHaveLength(0);
		expect(harness.drives).toHaveLength(0);
	});
});
