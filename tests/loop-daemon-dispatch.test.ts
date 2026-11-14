/**
 * Loop Daemon: Tick Dispatch Core Tests (S8)
 *
 * Verifies S8-AC1 and S8-AC2 under docs/plans/loop-daemon-s8-dispatch-core.intent.json
 * and S8 / D10 in docs/specs/loop-daemon.spec.md (SCN-5):
 *
 * - Positive Control (SCN-5):
 *   Under loop.mode: "assist", a live tick:
 *   - fills GuardFacts (allowed_actors, allowed_associations, daemon_identity, budget_exhausted,
 *     retry_counts, unresolved_blockers, shutdown_requested) from config, authenticated GitHub login, and local state
 *   - admits judged handlers only through scheduleLoopWork() and an acquired lease
 *   - executes escalate (create comment, or edit in place by key on repeat tick)
 *   - executes relay_lane_decision_question (posts structured question comment with run_id, record_revision, options)
 *   - executes apply_lane_decision_reply under acquired lease and cleanly releases lease
 *   - executes open_pr via the GitHub write port
 *   - executes mark_pr_ready via the GitHub write port
 *   - executes close_out on merged PR
 *   - executes owner commands pause, resume, retry, ignore
 *   - maintains status Issue in place (creates if absent, edits in place if existing)
 *   - appends assurance_kernel/loop_dispatch_record/v1 rows to .imm/state/loop/dispatches.jsonl with mode 0600
 *
 * - Negative Control (D10 items 1-2):
 *   - live tick or run exits non-zero (1) with zero GitHub writes under loop.mode: "off"
 *   - live tick or run exits non-zero (1) with zero GitHub writes when authenticated daemon login is in loop.allowed_actors
 *   - live tick or run exits non-zero (1) with zero GitHub writes when daemon login cannot be read
 *   - live tick under loop.mode: "observe" records decisions and skipped_mode dispatches with zero GitHub writes
 *   - imm-loop tick --dry-run and imm-loop status work under every mode including "off"
 *   - run uses loop.interval_seconds unless --interval overrides it
 *
 * - Boundary / Fault Control:
 *   - a candidate overlapping an active lease is held by scheduleLoopWork and recorded "held" with scheduler reason
 *   - agent-backed handlers are recorded agent_port_unavailable with no side effect and zero GitHub writes
 *   - configured allowlisted owner comment passes G7 while unallowlisted actor is blocked
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../plugins/immune-brain");

import type { LoopConfig } from "../plugins/immune-brain/runtime/config/layered_config.ts";
import type { GhExecution, GhTransport } from "../plugins/immune-brain/runtime/github_issue_tracker.ts";
import { runLoopDaemonCli } from "../plugins/immune-brain/runtime/loop_daemon/cli.ts";
import {
	type LoopDecisionRecord,
} from "../plugins/immune-brain/runtime/loop_daemon/decision_record.ts";
import {
	AGENT_BACKED_HANDLERS,
	createDefaultRelayInputFactory,
	dispatchDecisions,
	LOOP_DISPATCH_RECORD_CONTRACT,
	type LaneRuntimeFactory,
} from "../plugins/immune-brain/runtime/loop_daemon/dispatch.ts";

/** A Host adapter's Lane-root runtime stand-in; the relays under test stub `relayDecision`. */
const stubLaneRuntime: LaneRuntimeFactory = () => ({ authorize: async () => ({}), shutdown: async () => {} });
import { LaneSupervisor } from "../plugins/immune-brain/runtime/unattended/lane_supervisor.ts";
import {
	createFakeLoopGitHubPort,
} from "../plugins/immune-brain/runtime/loop_daemon/github_port.ts";
import {
	evaluateGuards,
	type GuardFacts,
} from "../plugins/immune-brain/runtime/loop_daemon/guards.ts";
import {
	setCachedDaemonGithubLogin,
} from "../plugins/immune-brain/runtime/loop_daemon/identity.ts";
import {
	acquireLoopLease,
} from "../plugins/immune-brain/runtime/loop_daemon/leases.ts";
import {
	initLoopState,
	listLeases,
	loadLoopDispatches,
	loadLoopState,
	saveLoopState,
} from "../plugins/immune-brain/runtime/loop_daemon/state.ts";
import {
	LOOP_DAEMON_EVENT_CONTRACT,
	type E3OwnerCommentEvent,
	type E6LaneDecisionNeededEvent,
	type E7LaneDecisionRepliedEvent,
	type NormalizedLoopEvent,
	type ObservationInput,
	type RawIssue,
	type RawPR,
} from "../plugins/immune-brain/runtime/loop_daemon/types.ts";
import { escalationKey, escalationKeyMarker } from "../plugins/immune-brain/runtime/loop_daemon/escalation.ts";
import { LOOP_STATUS_MARKER } from "../plugins/immune-brain/runtime/loop_daemon/status_issue.ts";
import { LOOP_PR_MARKER } from "../plugins/immune-brain/runtime/loop_daemon/repair_agent.ts";
import { recordExecutorExit } from "../plugins/immune-brain/runtime/loop_daemon/exit_recorder.ts";

const TS = "2026-11-12T10:00:00.000Z";

export function makeWorkspace(options?: {
	loopConfig?: Partial<LoopConfig>;
}): {
	root: string;
	stateDir: string;
	loopConfig: LoopConfig;
	cleanup: () => void;
} {
	const root = mkdtempSync(join(tmpdir(), "imm-dispatch-test-"));
	execFileSync("git", ["init", "-q", root]);
	execFileSync("git", ["config", "user.name", "Immune Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "test@immune-brain.internal"], { cwd: root });

	const config: LoopConfig = {
		mode: "assist",
		interval_seconds: 45,
		max_concurrent: 2,
		max_ready_buffer: 5,
		max_pr_buffer: 5,
		auto_enroll_max_risk: "none",
		allowed_actors: ["human-owner", "lead-reviewer"],
		allowed_associations: ["OWNER", "MEMBER", "COLLABORATOR"],
		budget: { max_ticks_per_day: null, max_dispatches_per_day: null },
		...options?.loopConfig,
	};

	// Write no-touch declaration
	mkdirSync(join(root, "docs/agents"), { recursive: true });
	writeFileSync(
		join(root, "docs/agents/no-touch.json"),
		JSON.stringify({ contract: "immune_brain/no_touch/v1", paths: [] }, null, 2),
	);

	// Write tracked project config
	mkdirSync(join(root, ".imm"), { recursive: true });
	const projectLoopConfig: Record<string, unknown> = {
		mode: config.mode,
		interval_seconds: config.interval_seconds,
		max_concurrent: config.max_concurrent,
		max_ready_buffer: config.max_ready_buffer,
		max_pr_buffer: config.max_pr_buffer,
		auto_enroll_max_risk: config.auto_enroll_max_risk,
		allowed_actors: config.allowed_actors,
		allowed_associations: config.allowed_associations,
	};
	if (config.budget?.max_ticks_per_day || config.budget?.max_dispatches_per_day) {
		projectLoopConfig.budget = {};
		if (config.budget.max_ticks_per_day) {
			(projectLoopConfig.budget as Record<string, number>).max_ticks_per_day = config.budget.max_ticks_per_day;
		}
		if (config.budget.max_dispatches_per_day) {
			(projectLoopConfig.budget as Record<string, number>).max_dispatches_per_day = config.budget.max_dispatches_per_day;
		}
	}

	writeFileSync(
		join(root, ".imm/config.json"),
		JSON.stringify(
			{
				contract: "immune_brain/project_config/v1",
				loop: projectLoopConfig,
			},
			null,
			2,
		),
	);
	execFileSync("git", ["add", ".imm/config.json", "docs/agents/no-touch.json"], { cwd: root });

	const stateDir = join(root, ".imm/state/loop");
	mkdirSync(stateDir, { recursive: true });

	const cleanup = (): void => {
		try {
			rmSync(root, { recursive: true, force: true });
		} catch {}
	};

	return { root, stateDir, loopConfig: config, cleanup };
}

export function createMockGh(userLogin: string | null = "daemon-bot"): GhTransport {
	return {
		run: async (args: string[]): Promise<GhExecution> => {
			if (args[0] === "api" && args[1] === "user") {
				if (!userLogin) {
					return {
						exit_code: 1,
						stdout: "",
						stderr: "Not authenticated",
						timed_out: false,
						output_exceeded: false,
					};
				}
				return {
					exit_code: 0,
					stdout: JSON.stringify({ login: userLogin }),
					stderr: "",
					timed_out: false,
					output_exceeded: false,
				};
			}
			return {
				exit_code: 0,
				stdout: JSON.stringify([]),
				stderr: "",
				timed_out: false,
				output_exceeded: false,
			};
		},
	};
}

describe("Loop Daemon: Tick Dispatch Core (S8)", () => {
	let cleanupFns: Array<() => void> = [];

	beforeEach(() => {
		cleanupFns = [];
		setCachedDaemonGithubLogin(null);
	});

	afterEach(() => {
		setCachedDaemonGithubLogin(null);
		for (const fn of cleanupFns) {
			fn();
		}
		cleanupFns = [];
	});

	describe("1. Positive Control: imm-loop tick under loop.mode: 'assist' (SCN-5)", () => {
		it("executes escalate (create on new key, edit in place on repeat key) via GitHub write port", async () => {
			const { root, stateDir, loopConfig, cleanup } = makeWorkspace({
				loopConfig: { mode: "assist" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();

			// Initial tick: an escalation event on issue #42
			const issue42: RawIssue = {
				number: 42,
				title: "Flaky test failure",
				body: "Something broke",
				state: "open",
				labels: [],
				comments: [],
				created_at: TS,
				updated_at: TS,
			};

			const snapshot1: ObservationInput = {
				issues: [issue42],
				pull_requests: [],
				lane_decisions: [],
			};

			const escalationEvent: NormalizedLoopEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-escalate-42",
				kind: "E1_NEW_ISSUE",
				timestamp: TS,
				issue_number: 42,
				title: "Flaky test failure",
				body: "Something broke",
			};

			// Run tick with explicit escalate decision
			const decision1: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-escalate-1",
				event_id: escalationEvent.event_id,
				event_kind: escalationEvent.kind,
				target: { kind: "issue", id: "42" },
				handler: "escalate",
				tier: 1,
				reason: "exceeded repair retry cap for sig-flaky-fail",
				guards_passed: ["G1", "G2"],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const state = initLoopState();
			const guardFacts: GuardFacts = {
				allowed_actors: loopConfig.allowed_actors,
				allowed_associations: loopConfig.allowed_associations,
				daemon_identity: "daemon-bot",
				budget_exhausted: false,
				retry_counts: {},
				unresolved_blockers: {},
				shutdown_requested: false,
			};

			const res1 = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [escalationEvent],
				decisions: [decision1],
				snapshot: snapshot1,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			expect(res1.dispatches.length).toBe(1);
			expect(res1.dispatches[0].handler).toBe("escalate");
			expect(res1.dispatches[0].outcome).toBe("executed");
			expect(res1.dispatches[0].detail).toContain("action=post");

			// Verify comment posted to issue 42 with escalation key
			const postCall = fakePort.calls.find((c) => c.method === "postComment");
			expect(postCall).toBeDefined();
			expect(postCall!.args[0]).toBe(42);
			const postedBody = postCall!.args[1] as string;
			const key = escalationKey({
				kind: "escalate",
				target: "issue-42",
				detail: decision1.reason,
			});
			expect(postedBody).toContain(escalationKeyMarker(key));

			// Repeat tick: issue #42 now carries the posted comment, but reason message changed
			const commentId = 1000;
			const existingComments = [
				{
					id: commentId,
					user: { login: "daemon-bot" },
					author_association: "COLLABORATOR",
					body: `${escalationKeyMarker(key)}\nOld escalation message`,
					created_at: TS,
					updated_at: TS,
				},
			];

			const snapshot2: ObservationInput = {
				issues: [{ ...issue42, comments: existingComments }],
				pull_requests: [],
				lane_decisions: [],
			};

			const decision2: LoopDecisionRecord = {
				...decision1,
				decision_id: "dec-escalate-2",
			};

			const res2 = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [escalationEvent],
				decisions: [decision2],
				snapshot: snapshot2,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			expect(res2.dispatches.length).toBe(1);
			expect(res2.dispatches[0].handler).toBe("escalate");
			expect(res2.dispatches[0].outcome).toBe("executed");
			expect(res2.dispatches[0].detail).toContain("action=update");

			// Verify editComment was called in place with commentId
			const editCall = fakePort.calls.find((c) => c.method === "editComment");
			expect(editCall).toBeDefined();
			expect(editCall!.args[0]).toBe(commentId);
		});

		it("executes relay_lane_decision_question via GitHub write port with run_id and options", async () => {
			const { root, stateDir, loopConfig, cleanup } = makeWorkspace({
				loopConfig: { mode: "assist" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const state = initLoopState();

			const event: E6LaneDecisionNeededEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-e6-lane-dec",
				kind: "E6_LANE_DECISION_NEEDED",
				timestamp: TS,
				task_id: "issue-77",
				run_id: "run-abc-77",
				record_revision: "sha256:rev-77-abc",
				question: "Should we proceed with scope expansion?",
				options: [
					{ id: "opt-1", label: "Approve expansion", description: "Expands scope to include auth" },
					{ id: "opt-2", label: "Reject expansion", description: "Keep strict boundary" },
				],
				issue_number: 77,
			};

			const decision: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-lane-q-1",
				event_id: event.event_id,
				event_kind: event.kind,
				target: { kind: "issue", id: "77" },
				handler: "relay_lane_decision_question",
				tier: 1,
				reason: "user_only gate requires owner input",
				guards_passed: ["G1", "G7"],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const snapshot: ObservationInput = {
				issues: [
					{
						number: 77,
						title: "Task 77",
						body: "Task description",
						state: "open",
						labels: [],
						comments: [],
						created_at: TS,
						updated_at: TS,
					},
				],
				pull_requests: [],
				lane_decisions: [],
			};

			const guardFacts: GuardFacts = {
				allowed_actors: loopConfig.allowed_actors,
				allowed_associations: loopConfig.allowed_associations,
				daemon_identity: "daemon-bot",
				budget_exhausted: false,
				retry_counts: {},
				unresolved_blockers: {},
				shutdown_requested: false,
			};

			const res = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [event],
				decisions: [decision],
				snapshot,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			expect(res.dispatches.length).toBe(1);
			expect(res.dispatches[0].handler).toBe("relay_lane_decision_question");
			expect(res.dispatches[0].outcome).toBe("executed");

			const postCall = fakePort.calls.find((c) => c.method === "postComment" && c.args[0] === 77);
			expect(postCall).toBeDefined();
			const commentBody = postCall!.args[1] as string;
			expect(commentBody).toContain("<!-- immune-brain:kind=lane-decision -->");
			expect(commentBody).toContain("<!-- immune-brain:run-id=run-abc-77 -->");
			expect(commentBody).toContain("<!-- immune-brain:record-revision=sha256:rev-77-abc -->");
			expect(commentBody).toContain("Should we proceed with scope expansion?");
			expect(commentBody).toContain("Approve expansion");
		});

		it("executes apply_lane_decision_reply under acquired lease and releases lease", async () => {
			const { root, stateDir, loopConfig, cleanup } = makeWorkspace({
				loopConfig: { mode: "assist" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const state = initLoopState();

			const event: E7LaneDecisionRepliedEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-e7-lane-reply",
				kind: "E7_LANE_DECISION_REPLIED",
				timestamp: TS,
				issue_number: 88,
				comment_id: 3001,
				author: "human-owner",
				author_association: "OWNER",
				run_id: "run-lane-88",
				record_revision: "sha256:rev-88",
				selected_option: "opt-1",
				reply_body: "1",
				task_id: "issue-88",
			};

			const decision: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-lane-reply-1",
				event_id: event.event_id,
				event_kind: event.kind,
				target: { kind: "issue", id: "88" },
				handler: "apply_lane_decision_reply",
				tier: 1,
				reason: "verified owner decision reply",
				guards_passed: ["G1", "G7", "G8"],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const snapshot: ObservationInput = {
				issues: [
					{
						number: 88,
						title: "Task 88",
						body: "Task description",
						state: "open",
						labels: [],
						comments: [],
						created_at: TS,
						updated_at: TS,
					},
				],
				pull_requests: [],
				lane_decisions: [],
			};

			const guardFacts: GuardFacts = {
				allowed_actors: loopConfig.allowed_actors,
				allowed_associations: loopConfig.allowed_associations,
				daemon_identity: "daemon-bot",
				budget_exhausted: false,
				retry_counts: {},
				unresolved_blockers: {},
				shutdown_requested: false,
			};

			// Leases must be empty before dispatch
			expect(listLeases(stateDir).length).toBe(0);

			let capturedInput: any = null;
			let relayCalled = false;
			const res = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [event],
				decisions: [decision],
				snapshot,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
				laneRuntime: stubLaneRuntime,
				relayDecision: async (input: any) => {
					relayCalled = true;
					capturedInput = input;
					return {
						relayed: true,
						result: { success: true },
						lane_relay: {
							batch_id: "batch-s8",
							operation: input.operation,
							applied: true,
							rebound: false,
							lane_supervision: { state: "running" as const },
						},
					};
				},
			});

			expect(res.dispatches.length).toBe(1);
			expect(res.dispatches[0].handler).toBe("apply_lane_decision_reply");
			expect(res.dispatches[0].outcome).toBe("executed");
			expect(relayCalled).toBe(true);
			expect(capturedInput.supervisor).toBeInstanceOf(LaneSupervisor);
			expect(typeof capturedInput.parentHost).toBe("string");
			expect(capturedInput.pluginDir).toBe(PLUGIN_DIR);
			expect(capturedInput.waitMs).toBe(10_000);
			expect(capturedInput.extra?.chosen_option).toBe("opt-1");
			const projectRes = await capturedInput.project(root, "issue-88");
			expect(projectRes.contract).toBe("assurance_kernel/assurance_projection/v1");
			expect(projectRes.error).not.toBeUndefined();

			// Lease must be cleanly released after completion
			expect(listLeases(stateDir).length).toBe(0);
		});

		it("executes open_pr via GitHub write port", async () => {
			const { root, stateDir, loopConfig, cleanup } = makeWorkspace({
				loopConfig: { mode: "assist" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const state = initLoopState();

			mkdirSync(join(root, "docs", "plans"), { recursive: true });
			writeFileSync(
				join(root, "docs", "plans", "task-99.intent.json"),
				JSON.stringify({
					contract: "assurance_kernel/task_intent/v1",
					task_id: "task-99",
					goal: "Deliver task 99",
					risk: "routine",
					acceptance: [
						{ id: "AC1", assertion: "Feature 99 works" },
					],
				}),
			);

			recordExecutorExit(stateDir, {
				run_id: "run-99",
				task_id: "task-99",
				batch_id: "batch-99",
				lane: { lane_path: "/tmp/lane-99", generation: 1, pid: 1234, code: 0, signal: null },
				state: "exited",
				final_commit_sha: "commit-sha-99",
				verification_evidence: "evidence-bytes-99",
				recorded_at: TS,
			});

			const event: NormalizedLoopEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-e5-open-pr",
				kind: "E5_READY_TASK",
				timestamp: TS,
				issue_number: 99,
				task_id: "task-99",
			};

			const decision: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-open-pr-1",
				event_id: event.event_id,
				event_kind: event.kind,
				target: { kind: "issue", id: "99" },
				handler: "open_pr",
				tier: 1,
				reason: "task lane settled ready to open PR",
				guards_passed: ["G1"],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const snapshot: ObservationInput = {
				issues: [
					{
						number: 99,
						title: "Task 99",
						body: "Task description",
						state: "open",
						labels: [],
						comments: [],
						created_at: TS,
						updated_at: TS,
					},
				],
				pull_requests: [],
				lane_decisions: [],
			};

			const guardFacts: GuardFacts = {
				allowed_actors: loopConfig.allowed_actors,
				allowed_associations: loopConfig.allowed_associations,
				daemon_identity: "daemon-bot",
				budget_exhausted: false,
				retry_counts: {},
				unresolved_blockers: {},
				shutdown_requested: false,
			};

			const res = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [event],
				decisions: [decision],
				snapshot,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			expect(res.dispatches.length).toBe(1);
			expect(res.dispatches[0].handler).toBe("open_pr");
			expect(res.dispatches[0].outcome).toBe("executed");

			const upsertCall = fakePort.calls.find((c) => c.method === "upsert");
			expect(upsertCall).toBeDefined();
		});

		it("executes mark_pr_ready via GitHub write port", async () => {
			const { root, stateDir, loopConfig, cleanup } = makeWorkspace({
				loopConfig: { mode: "assist" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const state = initLoopState();

			const rawPr: RawPR = {
				number: 101,
				title: "imm(task-101): implement feature",
				body: LOOP_PR_MARKER,
				head_ref_name: "imm/task-101",
				head_sha: "head101",
				base_ref_name: "main",
				draft: true,
				state: "open",
				checks: [{ name: "build", status: "completed", conclusion: "success" }],
				reviews: [{ author: "lead-reviewer", state: "APPROVED" }],
				comments: [],
				created_at: TS,
				updated_at: TS,
			};

			const event: NormalizedLoopEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-e11-pr-ready",
				kind: "E11_PR_READY_OR_MERGED",
				timestamp: TS,
				pr_number: 101,
				branch: "imm/task-101",
				head_sha: "head101",
				pr_action: "ready",
			};

			const decision: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-ready-1",
				event_id: event.event_id,
				event_kind: event.kind,
				target: { kind: "pr", id: "101" },
				handler: "mark_pr_ready",
				tier: 1,
				reason: "all checks and reviews passed",
				guards_passed: ["G1", "G9"],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const snapshot: ObservationInput = {
				issues: [],
				pull_requests: [rawPr],
				lane_decisions: [],
			};

			const guardFacts: GuardFacts = {
				allowed_actors: loopConfig.allowed_actors,
				allowed_associations: loopConfig.allowed_associations,
				daemon_identity: "daemon-bot",
				budget_exhausted: false,
				retry_counts: {},
				unresolved_blockers: {},
				shutdown_requested: false,
			};

			const res = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [event],
				decisions: [decision],
				snapshot,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			expect(res.dispatches.length).toBe(1);
			expect(res.dispatches[0].handler).toBe("mark_pr_ready");
			expect(res.dispatches[0].outcome).toBe("executed");

			const readyCall = fakePort.calls.find((c) => c.method === "markPrReady" && c.args[0] === 101);
			expect(readyCall).toBeDefined();
		});

		it("executes close_out on merged PR", async () => {
			const { root, stateDir, loopConfig, cleanup } = makeWorkspace({
				loopConfig: { mode: "assist" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const state = initLoopState();

			// Add an active lease for pr-102
			acquireLoopLease(stateDir, { target_id: "pr-102", kind: "repair" });
			expect(listLeases(stateDir).some((l) => l.target_id === "pr-102")).toBe(true);

			const rawPr: RawPR = {
				number: 102,
				title: "imm(task-102): finished",
				body: LOOP_PR_MARKER,
				head_ref_name: "imm/task-102",
				head_sha: "head102",
				base_ref_name: "main",
				draft: false,
				state: "merged",
				checks: [],
				reviews: [],
				comments: [],
				created_at: TS,
				updated_at: TS,
			};

			const event: NormalizedLoopEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-e11-pr-merged",
				kind: "E11_PR_READY_OR_MERGED",
				timestamp: TS,
				pr_number: 102,
				branch: "imm/task-102",
				head_sha: "head102",
				pr_action: "merged",
			};

			const decision: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-closeout-1",
				event_id: event.event_id,
				event_kind: event.kind,
				target: { kind: "pr", id: "102" },
				handler: "close_out",
				tier: 1,
				reason: "PR merged by human owner",
				guards_passed: ["G1"],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const snapshot: ObservationInput = {
				issues: [],
				pull_requests: [rawPr],
				lane_decisions: [],
			};

			const guardFacts: GuardFacts = {
				allowed_actors: loopConfig.allowed_actors,
				allowed_associations: loopConfig.allowed_associations,
				daemon_identity: "daemon-bot",
				budget_exhausted: false,
				retry_counts: {},
				unresolved_blockers: {},
				shutdown_requested: false,
			};

			const res = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [event],
				decisions: [decision],
				snapshot,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			expect(res.dispatches.length).toBe(1);
			expect(res.dispatches[0].handler).toBe("close_out");
			expect(res.dispatches[0].outcome).toBe("executed");

			// Lease pr-102 must be retired
			expect(listLeases(stateDir).some((l) => l.target_id === "pr-102")).toBe(false);
		});

		it("executes owner commands pause, resume, retry, ignore", async () => {
			const { root, stateDir, loopConfig, cleanup } = makeWorkspace({
				loopConfig: { mode: "assist" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			let state = initLoopState();

			const guardFacts: GuardFacts = {
				allowed_actors: loopConfig.allowed_actors,
				allowed_associations: loopConfig.allowed_associations,
				daemon_identity: "daemon-bot",
				budget_exhausted: false,
				retry_counts: {},
				unresolved_blockers: {},
				shutdown_requested: false,
			};

			const snapshot: ObservationInput = {
				issues: [],
				pull_requests: [],
				lane_decisions: [],
			};

			// 1. @imm-loop pause
			const pauseEvent: E3OwnerCommentEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-e3-pause",
				kind: "E3_OWNER_COMMENT",
				timestamp: TS,
				issue_number: 1,
				comment_id: 501,
				author: "human-owner",
				author_association: "OWNER",
				body: "@imm-loop pause --reason maintenance",
			};
			const pauseDecision: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-cmd-pause",
				event_id: pauseEvent.event_id,
				event_kind: pauseEvent.kind,
				target: { kind: "issue", id: "1" },
				handler: "noop_record",
				tier: 1,
				reason: "owner pause command",
				guards_passed: ["G1", "G7"],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const resPause = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [pauseEvent],
				decisions: [pauseDecision],
				snapshot,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			expect(resPause.dispatches.length).toBe(1);
			expect(resPause.dispatches[0].outcome).toBe("executed");
			state = loadLoopState(stateDir)!;
			expect(state.paused).toBe(true);

			// 2. @imm-loop resume
			const resumeEvent: E3OwnerCommentEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-e3-resume",
				kind: "E3_OWNER_COMMENT",
				timestamp: TS,
				issue_number: 1,
				comment_id: 502,
				author: "human-owner",
				author_association: "OWNER",
				body: "@imm-loop resume",
			};
			const resumeDecision: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-cmd-resume",
				event_id: resumeEvent.event_id,
				event_kind: resumeEvent.kind,
				target: { kind: "issue", id: "1" },
				handler: "noop_record",
				tier: 1,
				reason: "owner resume command",
				guards_passed: ["G1", "G7"],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const resResume = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [resumeEvent],
				decisions: [resumeDecision],
				snapshot,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			expect(resResume.dispatches.length).toBe(1);
			expect(resResume.dispatches[0].outcome).toBe("executed");
			state = loadLoopState(stateDir)!;
			expect(state.paused).toBe(false);

			// 3. @imm-loop retry
			const retryEvent: E3OwnerCommentEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-e3-retry",
				kind: "E3_OWNER_COMMENT",
				timestamp: TS,
				issue_number: 1,
				comment_id: 503,
				author: "human-owner",
				author_association: "OWNER",
				body: "@imm-loop retry",
			};
			const retryDecision: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-cmd-retry",
				event_id: retryEvent.event_id,
				event_kind: retryEvent.kind,
				target: { kind: "issue", id: "1" },
				handler: "noop_record",
				tier: 1,
				reason: "owner retry command",
				guards_passed: ["G1", "G7"],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const resRetry = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [retryEvent],
				decisions: [retryDecision],
				snapshot,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			expect(resRetry.dispatches.length).toBe(1);
			expect(resRetry.dispatches[0].outcome).toBe("executed");

			// 4. @imm-loop ignore
			const ignoreEvent: E3OwnerCommentEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-e3-ignore",
				kind: "E3_OWNER_COMMENT",
				timestamp: TS,
				issue_number: 1,
				comment_id: 504,
				author: "human-owner",
				author_association: "OWNER",
				body: "@imm-loop ignore",
			};
			const ignoreDecision: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-cmd-ignore",
				event_id: ignoreEvent.event_id,
				event_kind: ignoreEvent.kind,
				target: { kind: "issue", id: "1" },
				handler: "noop_record",
				tier: 1,
				reason: "owner ignore command",
				guards_passed: ["G1", "G7"],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const resIgnore = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [ignoreEvent],
				decisions: [ignoreDecision],
				snapshot,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			expect(resIgnore.dispatches.length).toBe(1);
			expect(resIgnore.dispatches[0].outcome).toBe("executed");
		});

		it("rejects unverified or edited owner commands and leaves daemon state unchanged", async () => {
			const { root, stateDir, loopConfig, cleanup } = makeWorkspace({
				loopConfig: {
					mode: "assist",
					allowed_actors: ["human-owner"],
					allowed_associations: ["OWNER"],
				},
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			let state = initLoopState();
			expect(state.paused).toBe(false);

			const guardFacts: GuardFacts = {
				allowed_actors: ["human-owner"],
				allowed_associations: ["OWNER"],
				daemon_identity: "daemon-bot",
				budget_exhausted: false,
				retry_counts: {},
				unresolved_blockers: {},
				shutdown_requested: false,
			};

			const snapshot: ObservationInput = {
				issues: [{ number: 1, title: "1", body: "1", state: "open", labels: [], comments: [], created_at: TS, updated_at: TS }],
				pull_requests: [],
				lane_decisions: [],
			};

			// Case 1: unverified actor posts @imm-loop pause
			const untrustedPauseEvent: E3OwnerCommentEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-untrusted-pause",
				kind: "E3_OWNER_COMMENT",
				timestamp: TS,
				issue_number: 1,
				comment_id: 601,
				author: "untrusted-user",
				author_association: "CONTRIBUTOR",
				body: "@imm-loop pause",
				created_at: TS,
				updated_at: TS,
			};
			const untrustedDecision: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-untrusted-pause",
				event_id: untrustedPauseEvent.event_id,
				event_kind: untrustedPauseEvent.kind,
				target: { kind: "issue", id: "1" },
				handler: "noop_record",
				tier: 1,
				reason: "rejected @imm-loop pause: unverified actor",
				guards_passed: [],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const res1 = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [untrustedPauseEvent],
				decisions: [untrustedDecision],
				snapshot,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			expect(res1.dispatches.length).toBe(0);
			state = loadLoopState(stateDir) ?? state;
			expect(state.paused).toBe(false);

			// Case 2: allowlisted actor posts @imm-loop pause, but comment was edited after posting
			const editedPauseEvent: E3OwnerCommentEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-edited-pause",
				kind: "E3_OWNER_COMMENT",
				timestamp: TS,
				issue_number: 1,
				comment_id: 602,
				author: "human-owner",
				author_association: "OWNER",
				body: "@imm-loop pause",
				created_at: TS,
				updated_at: "2026-11-12T10:05:00.000Z", // edited!
			};
			const editedDecision: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-edited-pause",
				event_id: editedPauseEvent.event_id,
				event_kind: editedPauseEvent.kind,
				target: { kind: "issue", id: "1" },
				handler: "noop_record",
				tier: 1,
				reason: "rejected @imm-loop pause: comment was edited after posting",
				guards_passed: ["G7"],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const res2 = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [editedPauseEvent],
				decisions: [editedDecision],
				snapshot,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			expect(res2.dispatches.length).toBe(0);
			state = loadLoopState(stateDir) ?? state;
			expect(state.paused).toBe(false);

			// Case 3: unverified actor attempts to resume a paused daemon
			state.paused = true;
			state.pause_reason = "legitimate pause";
			saveLoopState(stateDir, state);

			const untrustedResumeEvent: E3OwnerCommentEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-untrusted-resume",
				kind: "E3_OWNER_COMMENT",
				timestamp: TS,
				issue_number: 1,
				comment_id: 603,
				author: "untrusted-user",
				author_association: "CONTRIBUTOR",
				body: "@imm-loop resume",
				created_at: TS,
				updated_at: TS,
			};
			const untrustedResumeDecision: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-untrusted-resume",
				event_id: untrustedResumeEvent.event_id,
				event_kind: untrustedResumeEvent.kind,
				target: { kind: "issue", id: "1" },
				handler: "noop_record",
				tier: 1,
				reason: "rejected @imm-loop resume: unverified actor",
				guards_passed: [],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const res3 = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [untrustedResumeEvent],
				decisions: [untrustedResumeDecision],
				snapshot,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			expect(res3.dispatches.length).toBe(0);
			state = loadLoopState(stateDir)!;
			expect(state.paused).toBe(true);
		});

		it("maintains status Issue in place: creates when missing, edits in place when existing", async () => {
			const { root, stateDir, loopConfig, cleanup } = makeWorkspace({
				loopConfig: { mode: "assist" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const state = initLoopState();

			const guardFacts: GuardFacts = {
				allowed_actors: loopConfig.allowed_actors,
				allowed_associations: loopConfig.allowed_associations,
				daemon_identity: "daemon-bot",
				budget_exhausted: false,
				retry_counts: {},
				unresolved_blockers: {},
				shutdown_requested: false,
			};

			// Pass 1: No status issue in snapshot -> calls createIssue
			const snapshotWithoutStatus: ObservationInput = {
				issues: [],
				pull_requests: [],
				lane_decisions: [],
			};

			await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [],
				decisions: [],
				snapshot: snapshotWithoutStatus,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			const createCall = fakePort.calls.find((c) => c.method === "createIssue");
			expect(createCall).toBeDefined();
			expect(createCall!.args[0]).toBe("Loop daemon status");

			// Pass 2: Status issue already exists with marker -> calls editIssue in place
			const statusIssueNumber = 500;
			const snapshotWithStatus: ObservationInput = {
				issues: [
					{
						number: statusIssueNumber,
						title: "Loop daemon status",
						body: `${LOOP_STATUS_MARKER}\nOld body content`,
						state: "open",
						labels: [],
						comments: [],
						created_at: TS,
						updated_at: TS,
					},
				],
				pull_requests: [],
				lane_decisions: [],
			};

			await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [],
				decisions: [],
				snapshot: snapshotWithStatus,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			const editCall = fakePort.calls.find((c) => c.method === "editIssue");
			expect(editCall).toBeDefined();
			expect(editCall!.args[0]).toBe(statusIssueNumber);
		});

		it("appends assurance_kernel/loop_dispatch_record/v1 rows to .imm/state/loop/dispatches.jsonl with mode 0600", async () => {
			const { root, stateDir, loopConfig, cleanup } = makeWorkspace({
				loopConfig: { mode: "assist" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const state = initLoopState();

			mkdirSync(join(root, "docs", "plans"), { recursive: true });
			writeFileSync(
				join(root, "docs", "plans", "task-123.intent.json"),
				JSON.stringify({
					contract: "assurance_kernel/task_intent/v1",
					task_id: "task-123",
					goal: "Deliver task 123",
					risk: "routine",
					acceptance: [
						{ id: "AC1", assertion: "Feature 123 works" },
					],
				}),
			);

			recordExecutorExit(stateDir, {
				run_id: "run-123",
				task_id: "task-123",
				batch_id: "batch-123",
				lane: { lane_path: "/tmp/lane-123", generation: 1, pid: 1234, code: 0, signal: null },
				state: "exited",
				final_commit_sha: "commit-sha-123",
				verification_evidence: "evidence-bytes-123",
				recorded_at: TS,
			});

			const event: NormalizedLoopEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-e5-dispatch-test",
				kind: "E5_READY_TASK",
				timestamp: TS,
				issue_number: 123,
				task_id: "task-123",
			};

			const decision: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-dispatch-record-test",
				event_id: event.event_id,
				event_kind: event.kind,
				target: { kind: "issue", id: "123" },
				handler: "open_pr",
				tier: 1,
				reason: "ready to open PR",
				guards_passed: ["G1"],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const snapshot: ObservationInput = {
				issues: [
					{
						number: 123,
						title: "Task 123",
						body: "Task description",
						state: "open",
						labels: [],
						comments: [],
						created_at: TS,
						updated_at: TS,
					},
				],
				pull_requests: [],
				lane_decisions: [],
			};

			const guardFacts: GuardFacts = {
				allowed_actors: loopConfig.allowed_actors,
				allowed_associations: loopConfig.allowed_associations,
				daemon_identity: "daemon-bot",
				budget_exhausted: false,
				retry_counts: {},
				unresolved_blockers: {},
				shutdown_requested: false,
			};

			await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [event],
				decisions: [decision],
				snapshot,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			const dispatchesPath = join(stateDir, "dispatches.jsonl");
			expect(existsSync(dispatchesPath)).toBe(true);

			const stat = statSync(dispatchesPath);
			expect(stat.mode & 0o777).toBe(0o600);

			const records = loadLoopDispatches(stateDir);
			expect(records.length).toBeGreaterThanOrEqual(1);
			const rec = records.find((r) => r.decision_id === "dec-dispatch-record-test");
			expect(rec).toBeDefined();
			expect(rec.contract).toBe(LOOP_DISPATCH_RECORD_CONTRACT);
			expect(rec.handler).toBe("open_pr");
			expect(rec.outcome).toBe("executed");
			expect(rec.recorded_at).toBe(TS);
		});

		it("runs live tick end-to-end via CLI and populates GuardFacts properly", async () => {
			const { root, stateDir, cleanup } = makeWorkspace({
				loopConfig: { mode: "assist" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const gh = createMockGh("daemon-bot");

			const snapshot: ObservationInput = {
				issues: [
					{
						number: 10,
						title: "Issue 10 with blockers",
						body: "Description",
						state: "open",
						blocked_by: [11],
						labels: [],
						comments: [],
						created_at: TS,
						updated_at: TS,
					},
					{
						number: 11,
						title: "Blocker issue 11",
						body: "Description",
						state: "open",
						labels: [],
						comments: [],
						created_at: TS,
						updated_at: TS,
					},
				],
				pull_requests: [],
				lane_decisions: [],
			};

			const result = await runLoopDaemonCli(["tick", "--json"], root, {
				gh,
				gitHubPort: fakePort,
				snapshotOverride: snapshot,
				guardFacts: { daemon_identity: "daemon-bot" },
			});

			expect(result.returncode).toBe(0);
			const payload = JSON.parse(result.stdout);
			expect(payload.contract).toBe("assurance_kernel/loop_tick_result/v1");
			expect(payload.dry_run).toBe(false);

			// Dispatches were appended to dispatches.jsonl with mode 0600
			const dispatchesPath = join(stateDir, "dispatches.jsonl");
			expect(existsSync(dispatchesPath)).toBe(true);
			expect(statSync(dispatchesPath).mode & 0o777).toBe(0o600);
		});
	});

	describe("2. Negative Control: mode gates, identity refusal, and zero mutations (D10 items 1-2)", () => {
		it("live tick exits 1 with 'loop.mode is off' and zero GitHub writes under loop.mode: 'off'", async () => {
			const { root, cleanup } = makeWorkspace({
				loopConfig: { mode: "off" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const gh = createMockGh("daemon-bot");

			const res = await runLoopDaemonCli(["tick"], root, {
				gh,
				gitHubPort: fakePort,
			});

			expect(res.returncode).toBe(1);
			expect(res.stderr).toContain("Error: loop.mode is off");
			expect(fakePort.calls.length).toBe(0);
		});

		it("live run exits 1 with 'loop.mode is off' and zero GitHub writes under loop.mode: 'off'", async () => {
			const { root, cleanup } = makeWorkspace({
				loopConfig: { mode: "off" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const gh = createMockGh("daemon-bot");

			const res = await runLoopDaemonCli(["run"], root, {
				gh,
				gitHubPort: fakePort,
				singleIteration: true,
			});

			expect(res.returncode).toBe(1);
			expect(res.stderr).toContain("Error: loop.mode is off");
			expect(fakePort.calls.length).toBe(0);
		});

		it("live tick exits 1 and zero GitHub writes when authenticated daemon login is in loop.allowed_actors", async () => {
			const { root, cleanup } = makeWorkspace({
				loopConfig: {
					mode: "assist",
					allowed_actors: ["daemon-bot", "human-owner"],
				},
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const gh = createMockGh("daemon-bot");

			const res = await runLoopDaemonCli(["tick"], root, {
				gh,
				gitHubPort: fakePort,
				guardFacts: { daemon_identity: "daemon-bot" },
			});

			expect(res.returncode).toBe(1);
			expect(res.stderr).toContain("daemon GitHub identity 'daemon-bot' is in loop.allowed_actors");
			expect(fakePort.calls.length).toBe(0);
		});

		it("live run exits 1 and zero GitHub writes when authenticated daemon login is in loop.allowed_actors", async () => {
			const { root, cleanup } = makeWorkspace({
				loopConfig: {
					mode: "assist",
					allowed_actors: ["daemon-bot", "human-owner"],
				},
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const gh = createMockGh("daemon-bot");

			const res = await runLoopDaemonCli(["run"], root, {
				gh,
				gitHubPort: fakePort,
				singleIteration: true,
				guardFacts: { daemon_identity: "daemon-bot" },
			});

			expect(res.returncode).toBe(1);
			expect(res.stderr).toContain("daemon GitHub identity 'daemon-bot' is in loop.allowed_actors");
			expect(fakePort.calls.length).toBe(0);
		});

		it("live tick exits 1 and zero GitHub writes when daemon login cannot be read", async () => {
			const { root, cleanup } = makeWorkspace({
				loopConfig: { mode: "assist" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const failingGh = createMockGh(null);

			const res = await runLoopDaemonCli(["tick"], root, {
				gh: failingGh,
				gitHubPort: fakePort,
			});

			expect(res.returncode).toBe(1);
			expect(res.stderr).toContain("Error: unreadable daemon GitHub identity");
			expect(fakePort.calls.length).toBe(0);
		});

		it("live tick under loop.mode: 'observe' records decisions and skipped_mode dispatches with zero GitHub writes", async () => {
			const { root, stateDir, cleanup } = makeWorkspace({
				loopConfig: { mode: "observe" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const gh = createMockGh("daemon-bot");

			const snapshot: ObservationInput = {
				issues: [
					{
						number: 30,
						title: "New issue 30",
						body: "Some feature",
						state: "open",
						labels: [],
						comments: [],
						created_at: TS,
						updated_at: TS,
					},
				],
				pull_requests: [],
				lane_decisions: [],
			};

			const res = await runLoopDaemonCli(["tick", "--json"], root, {
				gh,
				gitHubPort: fakePort,
				snapshotOverride: snapshot,
				guardFacts: { daemon_identity: "daemon-bot" },
			});

			expect(res.returncode).toBe(0);
			// Zero GitHub writes in observe mode
			expect(fakePort.calls.length).toBe(0);

			// Check decisions were recorded
			const decisionsPath = join(stateDir, "decisions.jsonl");
			expect(existsSync(decisionsPath)).toBe(true);

			// Check dispatches were recorded as skipped_mode
			const dispatches = loadLoopDispatches(stateDir);
			expect(dispatches.length).toBeGreaterThanOrEqual(1);
			for (const d of dispatches) {
				expect(d.outcome).toBe("skipped_mode");
				expect(d.detail).toBe("loop.mode is observe");
			}
		});

		it("imm-loop tick --dry-run works under every mode including 'off' with zero writes", async () => {
			const { root, cleanup } = makeWorkspace({
				loopConfig: { mode: "off" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const gh = createMockGh("daemon-bot");

			const res = await runLoopDaemonCli(["tick", "--dry-run", "--json"], root, {
				gh,
				gitHubPort: fakePort,
			});

			expect(res.returncode).toBe(0);
			expect(fakePort.calls.length).toBe(0);
			const payload = JSON.parse(res.stdout);
			expect(payload.dry_run).toBe(true);
		});

		it("imm-loop status works under every mode including 'off'", async () => {
			const { root, cleanup } = makeWorkspace({
				loopConfig: { mode: "off" },
			});
			cleanupFns.push(cleanup);

			const res = await runLoopDaemonCli(["status", "--json"], root);
			expect(res.returncode).toBe(0);
			const payload = JSON.parse(res.stdout);
			expect(typeof payload.daemon_running).toBe("boolean");
			expect(payload.watermarks).toBeDefined();
		});

		it("run uses loop.interval_seconds unless --interval overrides it", async () => {
			const { root, cleanup } = makeWorkspace({
				loopConfig: { mode: "observe", interval_seconds: 42 },
			});
			cleanupFns.push(cleanup);

			const gh = createMockGh("daemon-bot");

			// Running without --interval must resolve to loopConfig.interval_seconds (42)
			let capturedDefaultInterval: number | null = null;
			const resDefault = await runLoopDaemonCli(["run", "--dry-run"], root, {
				gh,
				singleIteration: true,
				sleep: (sec) => {
					capturedDefaultInterval = sec;
				},
			});
			expect(resDefault.returncode).toBe(0);
			expect(capturedDefaultInterval).toBe(42);

			// Running with --interval 10 must override loopConfig.interval_seconds to 10
			let capturedOverrideInterval: number | null = null;
			const resOverride = await runLoopDaemonCli(["run", "--dry-run", "--interval", "10"], root, {
				gh,
				singleIteration: true,
				sleep: (sec) => {
					capturedOverrideInterval = sec;
				},
			});
			expect(resOverride.returncode).toBe(0);
			expect(capturedOverrideInterval).toBe(10);
		});
	});

	describe("3. Boundary / Fault Control: lease conflicts, agent port refusal, and G7 guard", () => {
		it("a candidate overlapping an active lease is held by scheduleLoopWork and recorded 'held'", async () => {
			const { root, stateDir, loopConfig, cleanup } = makeWorkspace({
				loopConfig: { mode: "assist" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const state = initLoopState();

			// Pre-existing lease on issue-100 with overlapping scope
			const existingLease = acquireLoopLease(stateDir, {
				target_id: "issue-100",
				kind: "drive",
				scope_hint: ["packages/core/index.ts", "packages/core/util.ts"],
			});
			expect(existingLease.acquired).toBe(true);

			// Candidate on issue-101 attempting to modify the same scope
			const event: NormalizedLoopEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-e5-overlap-candidate",
				kind: "E5_READY_TASK",
				timestamp: TS,
				issue_number: 101,
				task_id: "issue-101",
				scope_hint: ["packages/core/index.ts"],
			};

			const decision: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-overlap-1",
				event_id: event.event_id,
				event_kind: event.kind,
				target: { kind: "issue", id: "101" },
				handler: "enroll_and_drive",
				tier: 1,
				reason: "task ready for enrollment",
				guards_passed: ["G1"],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const snapshot: ObservationInput = {
				issues: [
					{
						number: 101,
						title: "Candidate issue 101",
						body: "Overlapping task",
						state: "open",
						labels: [],
						comments: [],
						created_at: TS,
						updated_at: TS,
					},
				],
				pull_requests: [],
				lane_decisions: [],
			};

			const guardFacts: GuardFacts = {
				allowed_actors: loopConfig.allowed_actors,
				allowed_associations: loopConfig.allowed_associations,
				daemon_identity: "daemon-bot",
				budget_exhausted: false,
				retry_counts: {},
				unresolved_blockers: {},
				shutdown_requested: false,
			};

			const res = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [event],
				decisions: [decision],
				snapshot,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			expect(res.dispatches.length).toBe(1);
			expect(res.dispatches[0].handler).toBe("enroll_and_drive");
			expect(res.dispatches[0].outcome).toBe("held");
			expect(res.dispatches[0].detail).toContain("issue-100");

			// Check recorded into dispatches.jsonl as held
			const dispatches = loadLoopDispatches(stateDir);
			const heldRecord = dispatches.find((d) => d.decision_id === "dec-overlap-1");
			expect(heldRecord).toBeDefined();
			expect(heldRecord.outcome).toBe("held");
		});

		it("agent-backed handlers are recorded agent_port_unavailable with no side effect and zero GitHub writes", async () => {
			const { root, stateDir, loopConfig, cleanup } = makeWorkspace({
				loopConfig: { mode: "assist" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const state = initLoopState();

			const guardFacts: GuardFacts = {
				allowed_actors: loopConfig.allowed_actors,
				allowed_associations: loopConfig.allowed_associations,
				daemon_identity: "daemon-bot",
				budget_exhausted: false,
				retry_counts: {},
				unresolved_blockers: {},
				shutdown_requested: false,
			};

			const snapshot: ObservationInput = {
				issues: [],
				pull_requests: [],
				lane_decisions: [],
			};

			for (const handler of AGENT_BACKED_HANDLERS) {
				const event: NormalizedLoopEvent = {
					contract: LOOP_DAEMON_EVENT_CONTRACT,
					event_id: `evt-agent-${handler}`,
					kind: "E1_NEW_ISSUE",
					timestamp: TS,
					issue_number: 200,
					title: `Task for ${handler}`,
					body: "Body",
				};

				const decision: LoopDecisionRecord = {
					contract: "assurance_kernel/loop_decision_record/v1",
					decision_id: `dec-agent-${handler}`,
					event_id: event.event_id,
					event_kind: event.kind,
					target: { kind: "issue", id: "200" },
					handler,
					tier: 1,
					reason: `requires agent session for ${handler}`,
					guards_passed: ["G1"],
					mutations: [],
					dry_run: false,
					recorded_at: TS,
				};

				const res = await dispatchDecisions({
					root,
					stateDir,
					loopConfig,
					events: [event],
					decisions: [decision],
					snapshot,
					state,
					gitHubPort: fakePort,
					guardFacts,
					dryRun: false,
					now: TS,
				});

				expect(res.dispatches.length).toBe(1);
				expect(res.dispatches[0].handler).toBe(handler);
				expect(res.dispatches[0].outcome).toBe("agent_port_unavailable");
				expect(res.dispatches[0].detail).toContain("agent port unavailable");
			}

			// Verify zero mutations on GitHub write port (except status issue)
			const contentMutations = fakePort.calls.filter(
				(c) => c.method !== "createIssue" && c.method !== "editIssue",
			);
			expect(contentMutations.length).toBe(0);
		});

		it("configured allowlisted owner comment passes G7 while unallowlisted actor is blocked", () => {
			const guardFacts: GuardFacts = {
				allowed_actors: ["human-owner"],
				allowed_associations: ["OWNER", "MEMBER"],
				daemon_identity: "daemon-bot",
			};

			// Allowlisted owner passes G7
			const validOwnerComment: E3OwnerCommentEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-valid-owner",
				kind: "E3_OWNER_COMMENT",
				timestamp: TS,
				issue_number: 10,
				comment_id: 101,
				author: "human-owner",
				author_association: "OWNER",
				body: "@imm-loop retry",
			};
			const verdictsValid = evaluateGuards(validOwnerComment, guardFacts);
			const g7Valid = verdictsValid.find((v) => v.guard === "G7");
			expect(g7Valid).toBeDefined();
			expect(g7Valid!.blocked).toBe(false);

			// Unallowlisted actor is blocked by G7
			const untrustedComment: E3OwnerCommentEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-untrusted",
				kind: "E3_OWNER_COMMENT",
				timestamp: TS,
				issue_number: 10,
				comment_id: 102,
				author: "malicious-user",
				author_association: "CONTRIBUTOR",
				body: "@imm-loop retry",
			};
			const verdictsUntrusted = evaluateGuards(untrustedComment, guardFacts);
			const g7Untrusted = verdictsUntrusted.find((v) => v.guard === "G7");
			expect(g7Untrusted).toBeDefined();
			expect(g7Untrusted!.blocked).toBe(true);
		});

		it("records failed when apply_lane_decision_reply relay is rejected", async () => {
			const { root, stateDir, loopConfig, cleanup } = makeWorkspace({
				loopConfig: { mode: "assist" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const state = initLoopState();

			const event: E7LaneDecisionRepliedEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-e7-fail",
				kind: "E7_LANE_DECISION_REPLIED",
				timestamp: TS,
				issue_number: 89,
				comment_id: 3002,
				author: "human-owner",
				author_association: "OWNER",
				run_id: "run-lane-89",
				record_revision: "sha256:rev-89",
				selected_option: "opt-1",
				reply_body: "1",
				task_id: "issue-89",
			};

			const decision: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-lane-reply-fail",
				event_id: event.event_id,
				event_kind: event.kind,
				target: { kind: "issue", id: "89" },
				handler: "apply_lane_decision_reply",
				tier: 1,
				reason: "verified owner decision reply",
				guards_passed: ["G1", "G7", "G8"],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const snapshot: ObservationInput = {
				issues: [{ number: 89, title: "Task 89", body: "Body", state: "open", labels: [], comments: [], created_at: TS, updated_at: TS }],
				pull_requests: [],
				lane_decisions: [],
			};

			const guardFacts: GuardFacts = {
				allowed_actors: loopConfig.allowed_actors,
				allowed_associations: loopConfig.allowed_associations,
				daemon_identity: "daemon-bot",
				budget_exhausted: false,
				retry_counts: {},
				unresolved_blockers: {},
				shutdown_requested: false,
			};

			const res = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [event],
				decisions: [decision],
				snapshot,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
				laneRuntime: stubLaneRuntime,
				relayDecision: async () => ({ relayed: false }),
			});

			expect(res.dispatches.length).toBe(1);
			expect(res.dispatches[0].handler).toBe("apply_lane_decision_reply");
			expect(res.dispatches[0].outcome).toBe("failed");
		});

		for (const relayCase of [
			{ name: "uses production default relayLaneDecision and factory without throwing", laneRuntime: stubLaneRuntime, detail: "relay reply failed" },
			{ name: "fails closed when no Host adapter injected a Lane runtime", laneRuntime: undefined, detail: "relay_input_factory_required" },
		])
		it(`apply_lane_decision_reply ${relayCase.name}`, async () => {
			const { root, stateDir, loopConfig, cleanup } = makeWorkspace({
				loopConfig: { mode: "assist" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const state = initLoopState();

			const event: E7LaneDecisionRepliedEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-e7-prod-default",
				kind: "E7_LANE_DECISION_REPLIED",
				timestamp: TS,
				issue_number: 95,
				comment_id: 4001,
				author: "human-owner",
				author_association: "OWNER",
				run_id: "run-lane-95",
				record_revision: "sha256:rev-95",
				selected_option: "opt-1",
				reply_body: "1",
				task_id: "issue-95",
			};

			const decision: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-lane-reply-prod-default",
				event_id: event.event_id,
				event_kind: event.kind,
				target: { kind: "issue", id: "95" },
				handler: "apply_lane_decision_reply",
				tier: 1,
				reason: "verified owner decision reply",
				guards_passed: ["G1", "G7", "G8"],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const snapshot: ObservationInput = {
				issues: [{ number: 95, title: "Task 95", body: "Body", state: "open", labels: [], comments: [], created_at: TS, updated_at: TS }],
				pull_requests: [],
				lane_decisions: [],
			};

			const guardFacts: GuardFacts = {
				allowed_actors: loopConfig.allowed_actors,
				allowed_associations: loopConfig.allowed_associations,
				daemon_identity: "daemon-bot",
				budget_exhausted: false,
				retry_counts: {},
				unresolved_blockers: {},
				shutdown_requested: false,
			};

			// Notice: neither relayDecision nor relayInputFactory is passed; at most the adapter's Lane runtime is.
			// relayLaneDecision finds no lane in the temp workspace, returning { relayed: false } cleanly without crashing;
			// with no Lane runtime the reply is refused before any relay instead of authorizing as an unchosen Host.
			const res = await dispatchDecisions({
				...(relayCase.laneRuntime ? { laneRuntime: relayCase.laneRuntime } : {}),
				root,
				stateDir,
				loopConfig,
				events: [event],
				decisions: [decision],
				snapshot,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			expect(res.dispatches.length).toBe(1);
			expect(res.dispatches[0].handler).toBe("apply_lane_decision_reply");
			expect(res.dispatches[0].outcome).toBe("failed");
			expect(res.dispatches[0].detail).toContain(relayCase.detail);
		});

		it("createDefaultRelayInputFactory constructs grounded LaneRelayInput", async () => {
			const { root, cleanup } = makeWorkspace();
			cleanupFns.push(cleanup);

			const runtimeCalls: Array<{ cwd: string; laneRoot?: boolean; authorized: unknown[] }> = [];
			const factory = createDefaultRelayInputFactory(root, "task-100", {
				commentId: 5555,
				laneRuntime: (options) => {
					const call = { cwd: options.cwd, laneRoot: options.laneRoot, authorized: [] as unknown[] };
					runtimeCalls.push(call);
					return {
						authorize: async (...args) => {
							call.authorized.push(args);
							return { state: "authorized" };
						},
						shutdown: async () => {},
					};
				},
			});
			const input = factory("request_authorization", "sha256:rev-100", {
				operation: "request_authorization",
				option_id: "proceed",
				selected_option: "proceed",
				run_id: "run-100",
				record_revision: "sha256:rev-100",
			});

			expect(input.root).toBe(root);
			expect(input.taskId).toBe("task-100");
			expect(input.operation).toBe("request_authorization");
			expect(input.expectedRecordRevision).toBe("sha256:rev-100");
			expect(input.supervisor).toBeInstanceOf(LaneSupervisor);
			expect(typeof input.parentHost).toBe("string");
			expect(input.pluginDir).toBe(PLUGIN_DIR);
			expect(input.waitMs).toBe(10_000);
			expect(typeof input.project).toBe("function");
			expect(typeof input.apply).toBe("function");
			expect(typeof input.applied).toBe("function");

			// project on an empty path returns a real AssuranceProjectionResult without undefined error
			const proj = await input.project(root, "task-100");
			expect(proj.contract).toBe("assurance_kernel/assurance_projection/v1");
			expect(proj.error).not.toBeUndefined();

			// apply authorizes through the injected Lane-root runtime, never a Host the daemon picked itself
			await input.apply({ lane_path: join(root, "lane") } as Parameters<typeof input.apply>[0]);
			expect(runtimeCalls).toHaveLength(1);
			expect(runtimeCalls[0].cwd).toBe(join(root, "lane"));
			expect(runtimeCalls[0].laneRoot).toBe(true);
			expect(runtimeCalls[0].authorized[0]).toEqual([
				"task-100",
				"request_authorization",
				expect.objectContaining({ taskId: "task-100" }),
				{ record_revision: "sha256:rev-100", chosen_option: "proceed" },
			]);
		});

		it("budget_exhausted cross-tick accumulation holds candidates when max_dispatches_per_day is reached", async () => {
			const { root, stateDir, loopConfig, cleanup } = makeWorkspace({
				loopConfig: {
					mode: "assist",
					budget: {
						max_ticks_per_day: null,
						max_dispatches_per_day: 2,
					},
				},
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const state = initLoopState();

			// Tick 1: execute 1st dispatch
			const event1: NormalizedLoopEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-e1-esc-1",
				kind: "E1_NEW_ISSUE",
				timestamp: TS,
				issue_number: 10,
				title: "Issue 10",
				body: "Body",
			};
			const dec1: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-budget-1",
				event_id: event1.event_id,
				event_kind: event1.kind,
				target: { kind: "issue", id: "10" },
				handler: "escalate",
				tier: 1,
				reason: "escalate issue 10",
				guards_passed: ["G1"],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const snapshot1: ObservationInput = {
				issues: [
					{ number: 10, title: "10", body: "Body", state: "open", labels: [], comments: [], created_at: TS, updated_at: TS },
				],
				pull_requests: [],
				lane_decisions: [],
			};

			const guardFacts: GuardFacts = {
				allowed_actors: loopConfig.allowed_actors,
				allowed_associations: loopConfig.allowed_associations,
				daemon_identity: "daemon-bot",
				budget_exhausted: false,
				retry_counts: {},
				unresolved_blockers: {},
				shutdown_requested: false,
			};

			const res1 = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [event1],
				decisions: [dec1],
				snapshot: snapshot1,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			expect(res1.dispatches.length).toBe(1);
			expect(res1.dispatches[0].outcome).toBe("executed");

			// State stats were persisted to state.json
			let savedState = loadLoopState(stateDir)!;
			expect(savedState.stats.dispatches_today).toBe(1);
			expect(savedState.stats.dispatches_total).toBe(1);

			// Tick 2: execute 2nd dispatch
			const event2: NormalizedLoopEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-e1-esc-2",
				kind: "E1_NEW_ISSUE",
				timestamp: TS,
				issue_number: 11,
				title: "Issue 11",
				body: "Body",
			};
			const dec2: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-budget-2",
				event_id: event2.event_id,
				event_kind: event2.kind,
				target: { kind: "issue", id: "11" },
				handler: "escalate",
				tier: 1,
				reason: "escalate issue 11",
				guards_passed: ["G1"],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const res2 = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [event2],
				decisions: [dec2],
				snapshot: {
					issues: [{ number: 11, title: "11", body: "Body", state: "open", labels: [], comments: [], created_at: TS, updated_at: TS }],
					pull_requests: [],
					lane_decisions: [],
				},
				state: savedState,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			expect(res2.dispatches.length).toBe(1);
			expect(res2.dispatches[0].outcome).toBe("executed");

			savedState = loadLoopState(stateDir)!;
			expect(savedState.stats.dispatches_today).toBe(2);
			expect(savedState.stats.dispatches_total).toBe(2);

			// Tick 3: next dispatch is held due to budget_exhausted
			const event3: NormalizedLoopEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-e1-esc-3",
				kind: "E1_NEW_ISSUE",
				timestamp: TS,
				issue_number: 12,
				title: "Issue 12",
				body: "Body",
			};
			const dec3: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-budget-3",
				event_id: event3.event_id,
				event_kind: event3.kind,
				target: { kind: "issue", id: "12" },
				handler: "escalate",
				tier: 1,
				reason: "escalate issue 12",
				guards_passed: ["G1"],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const res3 = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [event3],
				decisions: [dec3],
				snapshot: {
					issues: [{ number: 12, title: "12", body: "Body", state: "open", labels: [], comments: [], created_at: TS, updated_at: TS }],
					pull_requests: [],
					lane_decisions: [],
				},
				state: savedState,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});

			expect(res3.dispatches.length).toBe(1);
			expect(res3.dispatches[0].outcome).toBe("held");
			expect(res3.dispatches[0].detail).toContain("daily dispatch budget exhausted");
		});

		it("scheduleLoopWork holds deterministic candidates when daemon is paused or shutdown is requested", async () => {
			const { root, stateDir, loopConfig, cleanup } = makeWorkspace({
				loopConfig: { mode: "assist" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const state = initLoopState();
			state.paused = true;
			state.pause_reason = "operator pause";

			const event: NormalizedLoopEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-esc-paused",
				kind: "E1_NEW_ISSUE",
				timestamp: TS,
				issue_number: 30,
				title: "Issue 30",
				body: "Body",
			};
			const decision: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-esc-paused",
				event_id: event.event_id,
				event_kind: event.kind,
				target: { kind: "issue", id: "30" },
				handler: "escalate",
				tier: 1,
				reason: "escalate when paused",
				guards_passed: [],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const resPaused = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [event],
				decisions: [decision],
				snapshot: {
					issues: [{ number: 30, title: "30", body: "Body", state: "open", labels: [], comments: [], created_at: TS, updated_at: TS }],
					pull_requests: [],
					lane_decisions: [],
				},
				state,
				gitHubPort: fakePort,
				guardFacts: {
					allowed_actors: loopConfig.allowed_actors,
					allowed_associations: loopConfig.allowed_associations,
					daemon_identity: "daemon-bot",
					shutdown_requested: false,
				},
				dryRun: false,
				now: TS,
			});

			expect(resPaused.dispatches.length).toBe(1);
			expect(resPaused.dispatches[0].outcome).toBe("held");
			expect(resPaused.dispatches[0].detail).toContain("daemon paused");

			// Now test shutdown_requested
			state.paused = false;
			const resShutdown = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [event],
				decisions: [decision],
				snapshot: {
					issues: [{ number: 30, title: "30", body: "Body", state: "open", labels: [], comments: [], created_at: TS, updated_at: TS }],
					pull_requests: [],
					lane_decisions: [],
				},
				state,
				gitHubPort: fakePort,
				guardFacts: {
					allowed_actors: loopConfig.allowed_actors,
					allowed_associations: loopConfig.allowed_associations,
					daemon_identity: "daemon-bot",
					shutdown_requested: true,
				},
				dryRun: false,
				now: TS,
			});

			expect(resShutdown.dispatches.length).toBe(1);
			expect(resShutdown.dispatches[0].outcome).toBe("held");
			expect(resShutdown.dispatches[0].detail).toContain("shutdown requested");
		});

		it("open_pr fails when TaskIntent or ExecutorExitRecord is missing or invalid", async () => {
			const { root, stateDir, loopConfig, cleanup } = makeWorkspace({
				loopConfig: { mode: "assist" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const state = initLoopState();

			const event: NormalizedLoopEvent = {
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id: "evt-open-pr-grounded",
				kind: "E5_READY_TASK",
				timestamp: TS,
				issue_number: 40,
				task_id: "task-40",
			};
			const decision: LoopDecisionRecord = {
				contract: "assurance_kernel/loop_decision_record/v1",
				decision_id: "dec-open-pr-grounded",
				event_id: event.event_id,
				event_kind: event.kind,
				target: { kind: "issue", id: "40" },
				handler: "open_pr",
				tier: 1,
				reason: "task lane settled ready to open PR",
				guards_passed: ["G1"],
				mutations: [],
				dry_run: false,
				recorded_at: TS,
			};

			const snapshot: ObservationInput = {
				issues: [{ number: 40, title: "Task 40", body: "Body", state: "open", labels: [], comments: [], created_at: TS, updated_at: TS }],
				pull_requests: [],
				lane_decisions: [],
			};
			const guardFacts: GuardFacts = {
				allowed_actors: loopConfig.allowed_actors,
				allowed_associations: loopConfig.allowed_associations,
				daemon_identity: "daemon-bot",
				shutdown_requested: false,
			};

			// Case 1: missing intent file
			const resMissingIntent = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [event],
				decisions: [decision],
				snapshot,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});
			expect(resMissingIntent.dispatches[0].outcome).toBe("failed");
			expect(resMissingIntent.dispatches[0].detail).toContain("task intent not found");

			// Write intent file
			mkdirSync(join(root, "docs", "plans"), { recursive: true });
			writeFileSync(
				join(root, "docs", "plans", "task-40.intent.json"),
				JSON.stringify({
					contract: "assurance_kernel/task_intent/v1",
					task_id: "task-40",
					goal: "Deliver task 40",
					risk: "routine",
					acceptance: [{ id: "AC1", assertion: "Feature 40 works" }],
				}),
			);

			// Case 2: missing executor exit
			const resMissingExit = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [event],
				decisions: [decision],
				snapshot,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});
			expect(resMissingExit.dispatches[0].outcome).toBe("failed");
			expect(resMissingExit.dispatches[0].detail).toContain("no executor exit record found");

			// Case 3: executor exit with failure exit code
			recordExecutorExit(stateDir, {
				run_id: "run-40",
				task_id: "task-40",
				batch_id: "batch-40",
				lane: { lane_path: "/tmp/lane-40", generation: 1, pid: 1234, code: 1, signal: null },
				state: "exited",
				final_commit_sha: "sha-40",
				verification_evidence: "evidence",
				recorded_at: TS,
			});

			const resFailedExit = await dispatchDecisions({
				root,
				stateDir,
				loopConfig,
				events: [event],
				decisions: [decision],
				snapshot,
				state,
				gitHubPort: fakePort,
				guardFacts,
				dryRun: false,
				now: TS,
			});
			expect(resFailedExit.dispatches[0].outcome).toBe("failed");
			expect(resFailedExit.dispatches[0].detail).toContain("executor exit not clean");
		});

		it("review-1: shutdown_requested in run/tick suppresses candidate execution and status Issue writes", async () => {
			const { root, cleanup } = makeWorkspace({
				loopConfig: { mode: "assist" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const gh = createMockGh("daemon-bot");

			const snapshot: ObservationInput = {
				issues: [
					{
						number: 201,
						title: "Task 201",
						body: "Body",
						state: "open",
						labels: ["ready-for-agent"],
						comments: [],
						created_at: TS,
						updated_at: TS,
					},
				],
				pull_requests: [],
				lane_decisions: [],
			};

			// Run tick with shutdownRequested: true
			const result = await runLoopDaemonCli(["tick", "--json"], root, {
				gh,
				gitHubPort: fakePort,
				snapshotOverride: snapshot,
				shutdownRequested: true,
				guardFacts: { daemon_identity: "daemon-bot" },
			});

			expect(result.returncode).toBe(0);
			const payload = JSON.parse(result.stdout);
			expect(payload.contract).toBe("assurance_kernel/loop_tick_result/v1");

			// G1 blocks candidates at judgment time due to shutdown_requested
			expect(payload.decisions.length).toBeGreaterThan(0);
			expect(payload.decisions[0].handler).toBe("noop_record");
			expect(payload.decisions[0].reason).toContain("shutdown requested");

			// Zero candidate dispatches executed and status Issue in-place update skipped
			expect(payload.dispatches.length).toBe(0);
			expect(fakePort.calls.length).toBe(0);

			// Also test standing run with isShutdownRequested: () => true exits 0 cleanly
			const runResult = await runLoopDaemonCli(["run", "--dry-run"], root, {
				gh,
				gitHubPort: fakePort,
				isShutdownRequested: () => true,
				guardFacts: { daemon_identity: "daemon-bot" },
			});
			expect(runResult.returncode).toBe(0);
			expect(runResult.stdout).toContain("Loop daemon stopped");
		});

		it("review-2: live tick populates expected_record_revisions for G8 so E7_LANE_DECISION_REPLIED passes and executes", async () => {
			const { root, cleanup } = makeWorkspace({
				loopConfig: { mode: "assist" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const gh = createMockGh("daemon-bot");

			// Snapshot includes lane_decision with record_revision "rev-77" and user comment matching "rev-77"
			const snapshotValid: ObservationInput = {
				issues: [
					{
						number: 77,
						title: "Decision Issue 77",
						body: "Question",
						state: "open",
						labels: [],
						comments: [
							{
								id: 5001,
								user: { login: "human-owner" },
								author_association: "OWNER",
								body: "<!-- immune-brain:run-id=run-77 --> <!-- immune-brain:record-revision=rev-77 -->\noption 1",
								created_at: TS,
								updated_at: TS,
							},
						],
						created_at: TS,
						updated_at: TS,
					},
				],
				pull_requests: [],
				lane_decisions: [
					{
						task_id: "issue-77",
						run_id: "run-77",
						record_revision: "rev-77",
						question: "Confirm plan?",
						options: [{ id: "opt-1", label: "Yes" }, { id: "opt-2", label: "No" }],
					},
				],
			};

			let relayCalled = false;
			const validResult = await runLoopDaemonCli(["tick", "--json"], root, {
				gh,
				gitHubPort: fakePort,
				snapshotOverride: snapshotValid,
				guardFacts: { daemon_identity: "daemon-bot" },
				laneRuntime: stubLaneRuntime,
				relayDecision: async () => {
					relayCalled = true;
					return {
						relayed: true,
						result: { success: true },
						lane_relay: {
							batch_id: "batch-77",
							operation: "request_authorization" as any,
							applied: true,
							rebound: false,
							lane_supervision: { state: "running" as const },
						},
					};
				},
			});

			expect(validResult.returncode).toBe(0);
			const validPayload = JSON.parse(validResult.stdout);
			const e7Event = validPayload.events.find((e: any) => e.kind === "E7_LANE_DECISION_REPLIED");
			expect(e7Event).not.toBeUndefined();
			const e7Decision = validPayload.decisions.find((d: any) => d.event_id === e7Event.event_id);
			expect(e7Decision).not.toBeUndefined();
			expect(e7Decision.handler).toBe("apply_lane_decision_reply");
			expect(e7Decision.guard).toBeNull();

			const e7Dispatch = validPayload.dispatches.find((d: any) => d.decision_id === e7Decision.decision_id);
			expect(e7Dispatch).not.toBeUndefined();
			expect(e7Dispatch.outcome).toBe("executed");
			expect(relayCalled).toBe(true);

			// Stale case: user comment has outdated revision
			const TS2 = new Date(Date.now() + 10000).toISOString();
			const snapshotStale: ObservationInput = {
				issues: [
					{
						number: 78,
						title: "Decision Issue 78",
						body: "Question",
						state: "open",
						labels: [],
						comments: [
							{
								id: 5002,
								user: { login: "human-owner" },
								author_association: "OWNER",
								body: "<!-- immune-brain:run-id=run-78 --> <!-- immune-brain:record-revision=rev-outdated -->\noption 1",
								created_at: TS2,
								updated_at: TS2,
							},
						],
						created_at: TS2,
						updated_at: TS2,
					},
				],
				pull_requests: [],
				lane_decisions: [
					{
						task_id: "issue-78",
						run_id: "run-78",
						record_revision: "rev-current",
						question: "Confirm plan?",
						options: [{ id: "opt-1", label: "Yes" }, { id: "opt-2", label: "No" }],
					},
				],
			};

			const staleResult = await runLoopDaemonCli(["tick", "--json"], root, {
				gh,
				gitHubPort: fakePort,
				snapshotOverride: snapshotStale,
				guardFacts: { daemon_identity: "daemon-bot" },
			});

			expect(staleResult.returncode).toBe(0);
			const stalePayload = JSON.parse(staleResult.stdout);
			const staleE7Event = stalePayload.events.find((e: any) => e.kind === "E7_LANE_DECISION_REPLIED");
			expect(staleE7Event).not.toBeUndefined();
			const staleE7Decision = stalePayload.decisions.find((d: any) => d.event_id === staleE7Event.event_id);
			expect(staleE7Decision).not.toBeUndefined();
			// Stale revision must be blocked by G8 and fall back to noop_record
			expect(staleE7Decision.handler).toBe("noop_record");
			expect(staleE7Decision.guard?.id).toBe("G8");
			expect(staleE7Decision.reason).toContain("G8");
		});

		it("review-round-3: multi-lane-decisions match per-task/per-run revision and do not confuse other runs", async () => {
			const { root, cleanup } = makeWorkspace({
				loopConfig: { mode: "assist" },
			});
			cleanupFns.push(cleanup);

			const fakePort = createFakeLoopGitHubPort();
			const gh = createMockGh("daemon-bot");

			// Multiple lane decisions exist:
			// task 77: rev-77
			// task 78: rev-78
			// User comments on issue 78 with rev-78!
			const snapshot: ObservationInput = {
				issues: [
					{
						number: 78,
						title: "Decision Issue 78",
						body: "Question",
						state: "open",
						labels: [],
						comments: [
							{
								id: 6001,
								user: { login: "human-owner" },
								author_association: "OWNER",
								body: "<!-- immune-brain:run-id=run-78 --> <!-- immune-brain:record-revision=rev-78 -->\noption 1",
								created_at: TS,
								updated_at: TS,
							},
						],
						created_at: TS,
						updated_at: TS,
					},
				],
				pull_requests: [],
				lane_decisions: [
					{
						task_id: "issue-77",
						run_id: "run-77",
						record_revision: "rev-77",
						question: "Confirm plan for 77?",
						options: [{ id: "opt-1", label: "Yes" }],
					},
					{
						task_id: "issue-78",
						run_id: "run-78",
						record_revision: "rev-78",
						question: "Confirm plan for 78?",
						options: [{ id: "opt-1", label: "Yes" }],
					},
				],
			};

			let relayCalled = false;
			const result = await runLoopDaemonCli(["tick", "--json"], root, {
				gh,
				gitHubPort: fakePort,
				snapshotOverride: snapshot,
				guardFacts: { daemon_identity: "daemon-bot" },
				laneRuntime: stubLaneRuntime,
				relayDecision: async () => {
					relayCalled = true;
					return {
						relayed: true,
						result: { success: true },
						lane_relay: {
							batch_id: "batch-78",
							operation: "request_authorization" as any,
							applied: true,
							rebound: false,
							lane_supervision: { state: "running" as const },
						},
					};
				},
			});

			expect(result.returncode).toBe(0);
			const payload = JSON.parse(result.stdout);
			const e7Event = payload.events.find((e: any) => e.kind === "E7_LANE_DECISION_REPLIED");
			expect(e7Event).not.toBeUndefined();
			expect(e7Event.run_id).toBe("run-78");
			expect(e7Event.record_revision).toBe("rev-78");

			const e7Decision = payload.decisions.find((d: any) => d.event_id === e7Event.event_id);
			expect(e7Decision).not.toBeUndefined();
			expect(e7Decision.handler).toBe("apply_lane_decision_reply");
			expect(e7Decision.guard).toBeNull();

			const e7Dispatch = payload.dispatches.find((d: any) => d.decision_id === e7Decision.decision_id);
			expect(e7Dispatch).not.toBeUndefined();
			expect(e7Dispatch.outcome).toBe("executed");
			expect(relayCalled).toBe(true);

			// Conversely: a comment on issue 78 that carries rev-77 (the other task's revision) must be rejected as stale!
			const TS2 = new Date(Date.now() + 10000).toISOString();
			const snapshotCrossContamination: ObservationInput = {
				issues: [
					{
						number: 78,
						title: "Decision Issue 78",
						body: "Question",
						state: "open",
						labels: [],
						comments: [
							{
								id: 6002,
								user: { login: "human-owner" },
								author_association: "OWNER",
								body: "<!-- immune-brain:run-id=run-78 --> <!-- immune-brain:record-revision=rev-77 -->\noption 1",
								created_at: TS2,
								updated_at: TS2,
							},
						],
						created_at: TS2,
						updated_at: TS2,
					},
				],
				pull_requests: [],
				lane_decisions: [
					{
						task_id: "issue-77",
						run_id: "run-77",
						record_revision: "rev-77",
						question: "Confirm plan for 77?",
						options: [{ id: "opt-1", label: "Yes" }],
					},
					{
						task_id: "issue-78",
						run_id: "run-78",
						record_revision: "rev-78",
						question: "Confirm plan for 78?",
						options: [{ id: "opt-1", label: "Yes" }],
					},
				],
			};

			const crossResult = await runLoopDaemonCli(["tick", "--json"], root, {
				gh,
				gitHubPort: fakePort,
				snapshotOverride: snapshotCrossContamination,
				guardFacts: { daemon_identity: "daemon-bot" },
			});

			expect(crossResult.returncode).toBe(0);
			const crossPayload = JSON.parse(crossResult.stdout);
			const crossE7Event = crossPayload.events.find((e: any) => e.kind === "E7_LANE_DECISION_REPLIED");
			expect(crossE7Event).not.toBeUndefined();
			const crossE7Decision = crossPayload.decisions.find((d: any) => d.event_id === crossE7Event.event_id);
			expect(crossE7Decision).not.toBeUndefined();
			expect(crossE7Decision.handler).toBe("noop_record");
			expect(crossE7Decision.guard?.id).toBe("G8");
		});
	});
});
