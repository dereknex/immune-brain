/**
 * Loop Daemon: Tick Dispatch Core (S8)
 *
 * Implements S8 and D10 items 3-6 of docs/specs/loop-daemon.spec.md (SCN-5).
 * Connects imm-loop tick and run to their handlers:
 *   - Admits judged handlers only through scheduleLoopWork() and an acquired lease
 *   - Executes deterministic handlers through one GitHub write port:
 *     - escalate (planEscalation() -> create or edit by key)
 *     - relay_lane_decision_question and apply_lane_decision_reply (decision_relay.ts)
 *     - open_pr (openLoopPullRequest())
 *     - mark_pr_ready and close_out (repair_agent.ts)
 *     - owner pause/resume/retry/ignore (state mutation)
 *     - per-tick status Issue in-place update (planStatusIssue())
 *   - Marks agent-backed handlers `agent_port_unavailable` when the caller wires
 *     no S9 agent port, and dispatches them through `agent_handlers.ts` when it does
 *     (that port records `requires_standing_daemon` for a one-shot tick, D11 item 3)
 *   - Appends assurance_kernel/loop_dispatch_record/v1 rows to .imm/state/loop/dispatches.jsonl (0600)
 */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ClaudeRuntime } from "../claude/kernel_ports.ts";
import { resolveConfig, type LoopConfig } from "../config/layered_config.ts";
import { diffSnapshotOf, type ToolMeta } from "../host-core/runtime.ts";
import { projectAssurance } from "../kernel/assurance_projection.ts";
import { relayLaneDecision, type LaneRelayTarget } from "../unattended/lane_decision.ts";
import { LaneSupervisor, type ExecutorHost } from "../unattended/lane_supervisor.ts";
import { type LoopDecisionRecord } from "./decision_record.ts";
import type { AgentHandlerPort } from "./agent_handlers.ts";
import {
	findLatestLaneDecisionQuestion,
	handleLaneDecisionReply,
	matchOfferedOption,
	parseDecisionReplyText,
	publishLaneDecisionQuestion,
	type DecisionOption,
	type DecisionQuestionInput,
	type RelayInputFactory,
} from "./decision_relay.ts";
export type { RelayInputFactory };
import {
	escalationKey,
	planEscalation,
} from "./escalation.ts";
import { readExecutorExit } from "./exit_recorder.ts";
import { type GuardFacts, eventTarget } from "./guards.ts";
import type { LoopHandler } from "./handlers.ts";
import type { JudgingAgentFn } from "./judging_agent.ts";
import { appendLoopLabel, loadLoopLabels } from "./labels.ts";
import { acquireLoopLease, releaseLoopLease } from "./leases.ts";
import { resolveOwnerCommand } from "./owner_commands.ts";
import {
	openLoopPullRequest,
	type LoopPullRequestRequest,
} from "./pr_opener.ts";
import {
	closeOut,
	isDaemonManagedPr,
	markPrReady,
	type DaemonPrInput,
} from "./repair_agent.ts";
import {
	candidatePriority,
	scheduleLoopWork,
	type ScheduleCandidate,
	type ScheduleLimits,
} from "./scheduler.ts";
import {
	appendLoopDispatch,
	listLeases,
	loadLease,
	loadLoopDecisions,
	saveLoopState,
} from "./state.ts";
import {
	planStatusIssue,
	type LoopStatusSnapshot,
} from "./status_issue.ts";
import type {
	LoopDaemonState,
	LoopLease,
	NormalizedLoopEvent,
	ObservationInput,
} from "./types.ts";
import type { LoopGitHubPort } from "./github_port.ts";

export const LOOP_DISPATCH_RECORD_CONTRACT = "assurance_kernel/loop_dispatch_record/v1" as const;

export type LoopDispatchOutcome =
	| "executed"
	| "skipped_mode"
	| "held"
	| "agent_port_unavailable"
	| "requires_standing_daemon"
	| "failed";

export interface LoopDispatchRecord {
	contract: typeof LOOP_DISPATCH_RECORD_CONTRACT;
	decision_id: string;
	handler: LoopHandler;
	outcome: LoopDispatchOutcome;
	detail: string;
	recorded_at: string;
}

export const AGENT_BACKED_HANDLERS: readonly LoopHandler[] = [
	"triage_issue",
	"analyze_codebase",
	"draft_plan",
	"publish_plan_for_approval",
	"enroll_and_drive",
	"repair_pr_ci",
	"repair_pr_conflict",
	"address_pr_review",
];

export function isAgentBackedHandler(handler: LoopHandler): boolean {
	return (AGENT_BACKED_HANDLERS as readonly string[]).includes(handler);
}

/** Detect the default base branch for PRs (e.g. main or master). */
export function detectBaseBranch(root: string): string {
	try {
		const res = spawnSync("git", ["-C", root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		if (res.status === 0 && res.stdout.trim()) {
			const ref = res.stdout.trim();
			return ref.replace(/^origin\//, "");
		}
	} catch {}

	try {
		const showMain = spawnSync("git", ["-C", root, "show-ref", "--verify", "--quiet", "refs/heads/main"], {
			stdio: ["pipe", "pipe", "pipe"],
		});
		if (showMain.status === 0) return "main";
		const showMaster = spawnSync("git", ["-C", root, "show-ref", "--verify", "--quiet", "refs/heads/master"], {
			stdio: ["pipe", "pipe", "pipe"],
		});
		if (showMaster.status === 0) return "master";
	} catch {}

	return "main";
}

/**
 * Create a grounded default RelayInputFactory for single-task Lane decision relays.
 */
export function createDefaultRelayInputFactory(
	root: string,
	taskId: string,
	options: {
		commentId?: number;
		meta?: ToolMeta;
	} = {},
): RelayInputFactory<unknown> {
	const config = resolveConfig(root);
	const activeProfile = config.lanes.active.value ? config.lanes.profiles.value[config.lanes.active.value] : undefined;
	const parentHost: ExecutorHost = (activeProfile?.executor_host ?? (config.lanes.executor_host.value as ExecutorHost | undefined) ?? "claude-code");
	const pluginDir = join(root, "plugins", "immune-brain");
	const supervisor = new LaneSupervisor();

	return (op, rev, choice) => ({
		root,
		taskId,
		operation: op,
		expectedRecordRevision: rev,
		project: (lanePath: string, id: string) => projectAssurance(lanePath, id, diffSnapshotOf),
		apply: async (target: LaneRelayTarget) => {
			const laneRuntime = new ClaudeRuntime({
				cwd: target.lane_path,
				laneRoot: true,
				parentHost,
				requestConfirmation: async () => ({
					decision: "accept",
					requestId: `github-comment-${options.commentId ?? "unknown"}`,
					reworkChoice: choice.option_id === "accept_residual_risk"
						? { exit: "accept_residual_risk" as const, reason: "accepted via github reply" }
						: choice.option_id === "replan"
						? { exit: "replan" as const }
						: { exit: "grant_rounds" as const, rounds: 1 },
				}),
			});
			try {
				const extra = {
					record_revision: rev,
					chosen_option: choice.option_id,
				};
				const meta: ToolMeta = options.meta ?? {
					sessionId: "loop-daemon",
					toolCallId: "loop-daemon-reply",
					taskId,
				};
				return await laneRuntime.authorize(taskId, op, meta, extra);
			} finally {
				await laneRuntime.shutdown();
			}
		},
		applied: (result: unknown) => !(result && typeof result === "object" && "state" in result && (result as any).state === "replan_selected"),
		supervisor,
		parentHost,
		pluginDir,
		waitMs: 10_000,
		extra: { chosen_option: choice.option_id },
	});
}

export interface DispatchDecisionsOptions {
	root: string;
	stateDir: string;
	loopConfig: LoopConfig;
	events: readonly NormalizedLoopEvent[];
	decisions: readonly LoopDecisionRecord[];
	snapshot: ObservationInput;
	state: LoopDaemonState;
	gitHubPort: LoopGitHubPort;
	guardFacts: GuardFacts;
	dryRun: boolean;
	now?: string;
	/** The S9 agent port; absent keeps agent-backed handlers at `agent_port_unavailable`. */
	agentPort?: AgentHandlerPort;
	/** True only inside the standing `imm-loop run` process, which owns the Lane supervisor. */
	standingDaemon?: boolean;
	judgingAgent?: JudgingAgentFn;
	relayDecision?: typeof relayLaneDecision;
	relayInputFactory?: RelayInputFactory<unknown>;
}

function recordOwnerReversalLabel(
	stateDir: string,
	ownerDecision: LoopDecisionRecord,
	command: "retry" | "ignore",
	allDecisions: readonly LoopDecisionRecord[],
	now: string,
): void {
	const labelId = `owner:${ownerDecision.decision_id}`;
	if (loadLoopLabels(stateDir).some((row) => row.id === labelId)) {
		return;
	}

	const prior = [...allDecisions]
		.reverse()
		.find(
			(d) =>
				d.decision_id !== ownerDecision.decision_id &&
				d.target.kind === ownerDecision.target.kind &&
				d.target.id === ownerDecision.target.id &&
				d.classification !== null,
		);
	if (!prior?.classification) return;

	const { point, choice } = prior.classification;
	let mapping: { point: string; gold: string; model_choice: string } | null = null;

	if (command === "ignore") {
		if (point === "a18_event_prefilter" && choice === "actionable") {
			mapping = { point: "a18_event_prefilter", gold: "ignore", model_choice: "actionable" };
		} else if (point === "a15_task_granularity" && choice !== "needs_clarification") {
			mapping = { point: "a18_event_prefilter", gold: "ignore", model_choice: "actionable" };
		} else if (point === "a19_owner_comment_intent" && choice !== "discussion") {
			mapping = { point: "a19_owner_comment_intent", gold: "discussion", model_choice: choice };
		} else if (point === "a14_pr_comment_triage" && (choice === "blocking" || choice === "nit")) {
			mapping = { point: "a14_pr_comment_triage", gold: "duplicate", model_choice: choice };
		}
	} else if (command === "retry") {
		if (point === "a18_event_prefilter" && choice === "ignore") {
			mapping = { point: "a18_event_prefilter", gold: "actionable", model_choice: "ignore" };
		} else if (point === "a19_owner_comment_intent" && choice === "discussion") {
			mapping = {
				point: "a19_owner_comment_intent",
				gold: "request_plan_revision",
				model_choice: "discussion",
			};
		} else if (point === "a14_pr_comment_triage" && (choice === "duplicate" || choice === "out_of_scope")) {
			mapping = { point: "a14_pr_comment_triage", gold: "blocking", model_choice: choice };
		} else if (point === "a20_issue_duplicate_pair" && choice === "duplicate") {
			mapping = { point: "a20_issue_duplicate_pair", gold: "unrelated", model_choice: "duplicate" };
		} else if (point === "a15_task_granularity" && choice === "needs_clarification") {
			mapping = {
				point: "a15_task_granularity",
				gold: "clear_single_task",
				model_choice: "needs_clarification",
			};
		}
	}

	if (!mapping) return;
	appendLoopLabel(stateDir, {
		id: labelId,
		point: mapping.point,
		gold: mapping.gold,
		model_choice: mapping.model_choice,
		source: "owner",
		recorded_at: now,
		decision_id: prior.decision_id,
		event_id: ownerDecision.event_id,
		target_id: `${ownerDecision.target.kind}-${ownerDecision.target.id}`,
		reason: `verified owner @imm-loop ${command} reversed ${mapping.point} choice ${mapping.model_choice}`,
	});
}

export interface DispatchDecisionsResult {
	dispatches: LoopDispatchRecord[];
}

export async function dispatchDecisions(
	options: DispatchDecisionsOptions,
): Promise<DispatchDecisionsResult> {
	const {
		stateDir,
		loopConfig,
		events,
		decisions,
		snapshot,
		state,
		gitHubPort,
		guardFacts,
		dryRun,
	} = options;

	const now = options.now ?? new Date().toISOString();
	const dispatches: LoopDispatchRecord[] = [];

	const emitDispatch = (
		decisionId: string,
		handler: LoopHandler,
		outcome: LoopDispatchOutcome,
		detail: string,
	): LoopDispatchRecord => {
		const record: LoopDispatchRecord = {
			contract: LOOP_DISPATCH_RECORD_CONTRACT,
			decision_id: decisionId,
			handler,
			outcome,
			detail,
			recorded_at: now,
		};
		dispatches.push(record);
		if (!dryRun) {
			appendLoopDispatch(stateDir, record);
			if (outcome === "executed") {
				const today = now.slice(0, 10);
				if (state.stats.today_date !== today) {
					state.stats.today_date = today;
					state.stats.ticks_today = 0;
					state.stats.dispatches_today = 0;
				}
				state.stats.dispatches_today = (state.stats.dispatches_today ?? 0) + 1;
				state.stats.dispatches_total = (state.stats.dispatches_total ?? 0) + 1;
				state.updated_at = now;
				saveLoopState(stateDir, state);
			}
		}
		return record;
	};

	// Dry run: does not dispatch or mutate GitHub / state
	if (dryRun) {
		return { dispatches };
	}

	// 1. Observe mode gate: records skipped_mode for every would-be dispatch with zero GitHub writes
	if (loopConfig.mode === "observe") {
		for (const decision of decisions) {
			if (decision.handler === "noop_record") {
				continue;
			}
			emitDispatch(
				decision.decision_id,
				decision.handler,
				"skipped_mode",
				"loop.mode is observe",
			);
		}
		return { dispatches };
	}

	// 2. Status Issue In-Place Update (per-tick maintenance, omitted under dryRun or shutdown_requested)
	if (!dryRun && !guardFacts.shutdown_requested) {
		try {
		const openDaemonPrs = snapshot.pull_requests.filter((pr) => isDaemonManagedPr(pr)).length;
		const activeLeaseCount = listLeases(stateDir).length;
		const statusSnapshot: LoopStatusSnapshot = {
			identity_posture: guardFacts.identity_posture ?? "isolated",
			paused: state.paused,
			pause_reason: state.pause_reason,
			active_leases: activeLeaseCount,
			queue_depth: 0,
			open_daemon_prs: openDaemonPrs,
			budget_usage: {
				ticks_today: state.stats.ticks_today ?? state.stats.ticks_total,
				dispatches_today: state.stats.dispatches_today ?? 0,
			},
			recent_escalations: [],
			updated_at: now,
		};

		const statusPlan = planStatusIssue(snapshot.issues, statusSnapshot);
		if (statusPlan.action === "create") {
			await gitHubPort.createIssue("Loop daemon status", statusPlan.body);
		} else if (statusPlan.action === "update" && statusPlan.issue_number) {
			await gitHubPort.editIssue(statusPlan.issue_number, statusPlan.body);
		}
	} catch (error: any) {
		// Status issue failure does not block tick dispatches
	}
	}

	// 3. Process candidate decisions
	const eventById = new Map<string, NormalizedLoopEvent>();
	for (const evt of events) {
		eventById.set(evt.event_id, evt);
	}

	const candidates: ScheduleCandidate[] = [];
	const candidateToDecision = new Map<
		string,
		{ decision: LoopDecisionRecord; event?: NormalizedLoopEvent; candidate: ScheduleCandidate }
	>();

	const allStoredDecisions = loadLoopDecisions(stateDir);
	const knownDecisions = [...allStoredDecisions, ...decisions];

	for (const decision of decisions) {
		const evt = eventById.get(decision.event_id);
		if (evt && evt.kind === "E3_OWNER_COMMENT") {
			const resolved = resolveOwnerCommand(
				{
					body: evt.body,
					author: evt.author,
					author_association: evt.author_association,
					created_at: evt.created_at,
					updated_at: evt.updated_at,
				},
				guardFacts,
			);
			if (resolved.accepted && (resolved.command === "retry" || resolved.command === "ignore")) {
				recordOwnerReversalLabel(stateDir, decision, resolved.command, knownDecisions, now);
			}
		}
		if (decision.handler === "noop_record") {
			// Check if this noop_record was a verified owner command that needs state mutation
			if (evt && evt.kind === "E3_OWNER_COMMENT") {
				const resolved = resolveOwnerCommand(
					{
						body: evt.body,
						author: evt.author,
						author_association: evt.author_association,
						created_at: evt.created_at,
						updated_at: evt.updated_at,
					},
					guardFacts,
				);
				if (resolved.accepted && resolved.command) {
					if (resolved.command === "pause") {
						state.paused = true;
						state.pause_reason = "owner pause";
						state.updated_at = now;
						saveLoopState(stateDir, state);
						emitDispatch(decision.decision_id, decision.handler, "executed", "daemon paused by owner command");
						continue;
					}
					if (resolved.command === "resume") {
						state.paused = false;
						state.pause_reason = null;
						state.updated_at = now;
						saveLoopState(stateDir, state);
						emitDispatch(decision.decision_id, decision.handler, "executed", "daemon resumed by owner command");
						continue;
					}
					if (resolved.command === "retry") {
						emitDispatch(decision.decision_id, decision.handler, "executed", "retry acknowledged by owner command");
						continue;
					}
					if (resolved.command === "ignore") {
						emitDispatch(decision.decision_id, decision.handler, "executed", "ignored by owner command");
						continue;
					}
				}
			}
			continue;
		}

		const target = evt ? eventTarget(evt) : { kind: "issue" as const, id: "0" };
		const targetId = `${target.kind}-${target.id}`;
		const candidateId = `${decision.decision_id}:${targetId}:${decision.handler}`;

		const candidate: ScheduleCandidate = {
			target_id: targetId,
			handler: decision.handler,
			event_kind: evt?.kind,
			scope_hint: (evt as any)?.scope_hint,
			candidate_id: candidateId,
		};

		candidates.push(candidate);
		candidateToDecision.set(candidateId, { decision, event: evt, candidate });
	}

	if (candidates.length === 0) {
		return { dispatches };
	}

	// 4. Admit candidates strictly through scheduleLoopWork
	const limits: ScheduleLimits = {
		max_concurrent: loopConfig.max_concurrent,
		max_ready_buffer: loopConfig.max_ready_buffer,
		max_pr_buffer: loopConfig.max_pr_buffer,
	};

	const scheduleResult = scheduleLoopWork({
		candidates,
		active_leases: listLeases(stateDir),
		ready_buffer: 0,
		open_daemon_prs: snapshot.pull_requests.filter((pr) => isDaemonManagedPr(pr)).length,
		limits,
		budget: {
			ticks_today: state.stats.ticks_today ?? state.stats.ticks_total,
			dispatches_today: state.stats.dispatches_today ?? 0,
			max_ticks_per_day: loopConfig.budget.max_ticks_per_day,
			max_dispatches_per_day: loopConfig.budget.max_dispatches_per_day,
		},
		paused: state.paused,
		shutdown_requested: guardFacts.shutdown_requested,
		allHandlers: true,
	});

	// 5. Execute admitted candidates under an acquired lease
	for (const entry of scheduleResult.entries) {
		const mapping = candidateToDecision.get(entry.candidate_id ?? "");
		if (!mapping) continue;
		const { decision, event, candidate } = mapping;

		if (entry.action === "hold") {
			emitDispatch(decision.decision_id, decision.handler, "held", entry.reason);
			continue;
		}

		// Admitted by scheduler -> acquire lease
		let lease: LoopLease | null = null;
		let acquiredNewLease = false;

		if (decision.handler === "close_out") {
			const existing = loadLease(stateDir, candidate.target_id);
			if (!existing) {
				const leaseRes = acquireLoopLease(stateDir, {
					target_id: candidate.target_id,
					kind: "repair",
					scope_hint: candidate.scope_hint,
				});
				if (leaseRes.acquired) {
					lease = leaseRes.lease;
					acquiredNewLease = true;
				}
			} else {
				lease = existing;
			}
		} else {
			const priority = candidatePriority(candidate, { allHandlers: true });
			const leaseKind =
				priority === "pr_repair"
					? "repair"
					: priority === "planning" || priority === "triage"
					? "plan"
					: "drive";

			const leaseRes = acquireLoopLease(stateDir, {
				target_id: candidate.target_id,
				kind: leaseKind,
				scope_hint: candidate.scope_hint,
			});

			if (!leaseRes.acquired) {
				emitDispatch(
					decision.decision_id,
					decision.handler,
					"held",
					`lease_acquisition_failed: ${leaseRes.reason}`,
				);
				continue;
			}
			lease = leaseRes.lease;
			acquiredNewLease = true;
		}

		try {
			if (decision.handler === "escalate") {
				const target = event ? eventTarget(event) : { kind: "issue" as const, id: "0" };
				const targetNumber = parseInt(target.id, 10);
				const key =
					decision.escalation_key ??
					escalationKey({
						kind: "escalate",
						target: `${target.kind}-${target.id}`,
						detail: decision.reason,
					});

				const existingComments = (
					target.kind === "pr"
						? snapshot.pull_requests.find((p) => p.number === targetNumber)?.comments
						: snapshot.issues.find((i) => i.number === targetNumber)?.comments
				) ?? [];

				const plan = planEscalation(existingComments, { key, message: decision.reason });
				if (plan.action === "post") {
					const posted = await gitHubPort.postComment(targetNumber, plan.body);
					existingComments.push({
						id: posted.id,
						body: plan.body,
						user: { login: guardFacts.daemon_identity ?? "daemon" },
						author_association: "COLLABORATOR",
						created_at: now,
						updated_at: now,
					});
				} else if (plan.action === "update" && plan.comment_id) {
					await gitHubPort.editComment(plan.comment_id, plan.body);
					const existing = existingComments.find((c) => c.id === plan.comment_id);
					if (existing) {
						existing.body = plan.body;
						existing.updated_at = now;
					}
				}

				emitDispatch(
					decision.decision_id,
					decision.handler,
					"executed",
					`escalated key=${key} action=${plan.action}`,
				);
			} else if (decision.handler === "relay_lane_decision_question") {
				if (!event || event.kind !== "E6_LANE_DECISION_NEEDED") {
					emitDispatch(decision.decision_id, decision.handler, "failed", "event is not E6_LANE_DECISION_NEEDED");
					continue;
				}

				const issueNumber =
					event.issue_number ??
					(event.task_id.match(/issue-(\d+)/) ? parseInt(event.task_id.match(/issue-(\d+)/)![1], 10) : undefined);
				const existingComments = issueNumber
					? snapshot.issues.find((i) => i.number === issueNumber)?.comments ?? []
					: [];

				const input: DecisionQuestionInput = {
					task_id: event.task_id,
					run_id: event.run_id,
					record_revision: event.record_revision,
					question: event.question,
					options: event.options,
					issue_number: issueNumber,
				};

				const result = await publishLaneDecisionQuestion(input, {
					postComment: async (inComment) => gitHubPort.postComment(inComment.issue_number, inComment.body),
					existingComments,
					stateDir,
					hostToken: lease?.host_token ?? randomUUID(),
				});

				emitDispatch(
					decision.decision_id,
					decision.handler,
					"executed",
					`published lane decision question for ${event.task_id} (posted: ${result.posted})`,
				);
			} else if (decision.handler === "apply_lane_decision_reply") {
				if (
					!event ||
					(event.kind !== "E7_LANE_DECISION_REPLIED" && event.kind !== "E3_OWNER_COMMENT")
				) {
					emitDispatch(
						decision.decision_id,
						decision.handler,
						"failed",
						"event is not E7_LANE_DECISION_REPLIED or E3_OWNER_COMMENT",
					);
					continue;
				}

				const issueComments =
					snapshot.issues.find((i) => i.number === event.issue_number)?.comments ?? [];

				if (event.kind === "E7_LANE_DECISION_REPLIED") {
					const taskId = event.task_id ?? `issue-${event.issue_number}`;
					const outcome = await handleLaneDecisionReply(
						{
							issue_number: event.issue_number,
							comment_id: event.comment_id,
							author: event.author,
							author_association: event.author_association,
							run_id: event.run_id,
							record_revision: event.record_revision,
							selected_option: event.selected_option,
							reply_body: event.reply_body,
						},
						{
							task_id: taskId,
							run_id: event.run_id,
							record_revision: event.record_revision,
						},
						{
							postComment: async (inComment) => gitHubPort.postComment(inComment.issue_number, inComment.body),
							existingComments: issueComments,
							stateDir,
							hostToken: lease?.host_token ?? randomUUID(),
							guardFacts,
							relayDecision: options.relayDecision ?? relayLaneDecision,
						},
						options.relayInputFactory ??
							createDefaultRelayInputFactory(options.root, taskId, {
								commentId: event.comment_id,
							}),
					);

					if (outcome.action === "relayed" && outcome.relay_outcome?.relayed !== false) {
						emitDispatch(
							decision.decision_id,
							decision.handler,
							"executed",
							`applied lane decision reply (${outcome.action})`,
						);
					} else {
						emitDispatch(
							decision.decision_id,
							decision.handler,
							"failed",
							`relay reply failed (${outcome.action}${outcome.reason ? `: ${outcome.reason}` : ""})`,
						);
					}
					continue;
				}

				// Unparsed Lane decision reply arriving via E3_OWNER_COMMENT (S10-AC2 item 5).
				const factsLane = guardFacts.lane_decision_facts;
				const parkedQuestion = findLatestLaneDecisionQuestion(issueComments);
				const expectedRunId = factsLane?.run_id ?? parkedQuestion?.run_id;
				const expectedRevision =
					factsLane?.record_revision ??
					parkedQuestion?.record_revision ??
					guardFacts.expected_record_revision ??
					undefined;
				const taskId = factsLane?.task_id ?? parkedQuestion?.task_id ?? `issue-${event.issue_number}`;
				const offeredOptions: DecisionOption[] =
					factsLane?.options ?? parkedQuestion?.options ?? [];

				if (!expectedRunId || !expectedRevision) {
					emitDispatch(
						decision.decision_id,
						decision.handler,
						"failed",
						"no parked lane decision (run_id, record_revision) found for owner reply",
					);
					continue;
				}

				const parsedBody = parseDecisionReplyText(event.body);
				const replyRunId = parsedBody.run_id ?? expectedRunId;
				const replyRevision = parsedBody.record_revision ?? expectedRevision;

				let resolvedOption: string | undefined = decision.lane_option;
				if (!resolvedOption && parsedBody.selected_option) {
					if (offeredOptions.length > 0) {
						const matched = matchOfferedOption(parsedBody.selected_option, offeredOptions);
						if (matched) resolvedOption = matched.id;
					} else {
						resolvedOption = parsedBody.selected_option;
					}
				}
				if (!resolvedOption && options.judgingAgent) {
					try {
						const judged = await options.judgingAgent({
							point: "a19_owner_comment_intent",
							escalation_reason: "unparsed lane decision reply requires option resolution",
							event,
							...(decision.classification?.choice
								? { model_choice: decision.classification.choice }
								: {}),
							...(decision.classification?.confidence !== undefined
								? { model_confidence: decision.classification.confidence }
								: {}),
							offered_options: offeredOptions,
						});
						const candidateOption = judged?.lane_option ?? judged?.corrected_option;
						if (candidateOption) {
							const matched =
								offeredOptions.length > 0
									? matchOfferedOption(candidateOption, offeredOptions)
									: null;
							resolvedOption = matched ? matched.id : candidateOption;
						}
					} catch {}
				}

				const outcome = await handleLaneDecisionReply(
					{
						issue_number: event.issue_number,
						comment_id: event.comment_id,
						author: event.author,
						author_association: event.author_association,
						run_id: replyRunId,
						record_revision: replyRevision,
						selected_option: resolvedOption,
						reply_body: event.body,
						created_at: event.created_at,
						updated_at: event.updated_at,
					},
					{
						task_id: taskId,
						run_id: expectedRunId,
						record_revision: expectedRevision,
						...(offeredOptions.length > 0 ? { options: offeredOptions } : {}),
					},
					{
						postComment: async (inComment) => gitHubPort.postComment(inComment.issue_number, inComment.body),
						existingComments: issueComments,
						stateDir,
						hostToken: lease?.host_token ?? randomUUID(),
						guardFacts,
						relayDecision: options.relayDecision ?? relayLaneDecision,
					},
					options.relayInputFactory ??
						createDefaultRelayInputFactory(options.root, taskId, {
							commentId: event.comment_id,
						}),
				);

				if (outcome.action === "relayed" && outcome.relay_outcome?.relayed !== false) {
					emitDispatch(
						decision.decision_id,
						decision.handler,
						"executed",
						`applied unparsed lane decision reply (${outcome.choice?.option_id ?? resolvedOption ?? "unknown"})`,
					);
				} else {
					emitDispatch(
						decision.decision_id,
						decision.handler,
						"failed",
						`relay reply failed (${outcome.action}${outcome.reason ? `: ${outcome.reason}` : ""})`,
					);
				}
			} else if (decision.handler === "open_pr") {
				const target = event ? eventTarget(event) : { kind: "issue" as const, id: "0" };
				const issueNum = (event as any)?.issue_number ? String((event as any).issue_number) : target.id;
				const taskId = (event as any)?.task_id || `issue-${issueNum}`;

				// 1. Resolve TaskIntent
				let intentFile = join(options.root, "docs", "plans", `${taskId}.intent.json`);
				if (!existsSync(intentFile) && (event as any)?.task_id) {
					const fallback = join(options.root, "docs", "plans", `${(event as any).task_id}.intent.json`);
					if (existsSync(fallback)) intentFile = fallback;
				}
				if (!existsSync(intentFile)) {
					const try1 = join(options.root, "docs", "plans", `task-${issueNum}.intent.json`);
					const try2 = join(options.root, "docs", "plans", `issue-${issueNum}.intent.json`);
					if (existsSync(try1)) intentFile = try1;
					else if (existsSync(try2)) intentFile = try2;
				}

				if (!existsSync(intentFile)) {
					emitDispatch(
						decision.decision_id,
						decision.handler,
						"failed",
						`task intent not found for ${taskId} at ${intentFile}`,
					);
					continue;
				}

				let intent: any;
				try {
					intent = JSON.parse(readFileSync(intentFile, "utf8"));
				} catch (err: any) {
					emitDispatch(
						decision.decision_id,
						decision.handler,
						"failed",
						`failed to parse task intent at ${intentFile}: ${err?.message || String(err)}`,
					);
					continue;
				}

				// 2. Resolve Executor Exit
				let exitRecord = readExecutorExit(stateDir, taskId);
				if (!exitRecord && (event as any)?.task_id) {
					exitRecord = readExecutorExit(stateDir, (event as any).task_id);
				}
				if (!exitRecord) {
					exitRecord = readExecutorExit(stateDir, `task-${issueNum}`) ?? readExecutorExit(stateDir, `issue-${issueNum}`);
				}

				if (!exitRecord) {
					emitDispatch(
						decision.decision_id,
						decision.handler,
						"failed",
						`no executor exit record found for ${taskId}`,
					);
					continue;
				}

				if (exitRecord.state !== "exited" || exitRecord.exit_code !== 0) {
					emitDispatch(
						decision.decision_id,
						decision.handler,
						"failed",
						`executor exit not clean: state=${exitRecord.state} exit_code=${exitRecord.exit_code}`,
					);
					continue;
				}

				if (!exitRecord.verification_evidence_digest) {
					emitDispatch(
						decision.decision_id,
						decision.handler,
						"failed",
						`executor exit has no verification evidence digest for ${taskId}`,
					);
					continue;
				}

				const baseBranch = detectBaseBranch(options.root);
				const acceptanceSummary = (intent.acceptance ?? [])
					.map((ac: any) => `- ${ac.id}: ${ac.assertion}`)
					.join("\n");
				const verificationSummary = [
					`Verification evidence digest: \`${exitRecord.verification_evidence_digest}\``,
					`Commit SHA: \`${exitRecord.final_commit_sha ?? "unknown"}\``,
					"",
					"### Acceptance Criteria",
					acceptanceSummary || "All acceptance criteria verified.",
				].join("\n");

				const prReq: LoopPullRequestRequest = {
					slug: taskId,
					task_id: taskId,
					issue_number: parseInt(issueNum, 10),
					risk: intent.risk ?? "routine",
					base: baseBranch,
					title: intent.goal ? `imm(${taskId}): ${intent.goal.slice(0, 60)}` : `imm(${taskId}): deliver`,
					verification_summary: verificationSummary,
				};

				const opened = await openLoopPullRequest(prReq, gitHubPort);
				emitDispatch(
					decision.decision_id,
					decision.handler,
					"executed",
					`opened PR #${opened.number} for ${taskId} (base: ${baseBranch}, commit: ${exitRecord.final_commit_sha}, digest: ${exitRecord.verification_evidence_digest})`,
				);
			} else if (decision.handler === "mark_pr_ready") {
				const prNumber = (event as any)?.pr_number ?? (event ? parseInt(eventTarget(event).id, 10) : 0);
				const pr = snapshot.pull_requests.find((p) => p.number === prNumber);
				if (!pr) {
					emitDispatch(decision.decision_id, decision.handler, "failed", `PR #${prNumber} not found`);
					continue;
				}

				const daemonPr: DaemonPrInput = {
					number: pr.number,
					title: pr.title,
					body: pr.body,
					head_ref_name: pr.head_ref_name,
					head_sha: pr.head_sha,
					base_ref_name: pr.base_ref_name,
					state: pr.state === "merged" ? "merged" : pr.state === "closed" ? "closed" : "open",
					draft: true,
					checks: pr.checks,
					reviews: pr.reviews,
					comments: pr.comments,
				};

				const res = await markPrReady({
					pr: daemonPr,
					deps: {
						markReady: async (num) => gitHubPort.markPrReady(num),
					},
				});

				emitDispatch(
					decision.decision_id,
					decision.handler,
					res.action === "marked_ready" ? "executed" : "failed",
					res.reason,
				);
			} else if (decision.handler === "close_out") {
				const prNumber = (event as any)?.pr_number ?? (event ? parseInt(eventTarget(event).id, 10) : 0);
				const pr = snapshot.pull_requests.find((p) => p.number === prNumber);
				if (!pr) {
					emitDispatch(decision.decision_id, decision.handler, "failed", `PR #${prNumber} not found`);
					continue;
				}

				const daemonPr: DaemonPrInput = {
					number: pr.number,
					title: pr.title,
					body: pr.body,
					head_ref_name: pr.head_ref_name,
					head_sha: pr.head_sha,
					base_ref_name: pr.base_ref_name,
					state: "merged",
					merged: true,
					draft: false,
					checks: pr.checks,
					reviews: pr.reviews,
					comments: pr.comments,
				};

				const res = await closeOut({
					pr: daemonPr,
					context: {
						state_dir: stateDir,
						lease_target_id: `pr-${pr.number}`,
					},
				});

				emitDispatch(
					decision.decision_id,
					decision.handler,
					"executed",
					res.reason,
				);
			} else if (isAgentBackedHandler(decision.handler)) {
				if (!options.agentPort) {
					emitDispatch(
						decision.decision_id,
						decision.handler,
						"agent_port_unavailable",
						"agent port unavailable",
					);
				} else {
					const handled = await options.agentPort.handle(decision.handler, {
						root: options.root,
						stateDir,
						loopConfig,
						snapshot,
						guardFacts,
						gitHubPort,
						event,
						decision,
						now,
						standing_daemon: options.standingDaemon === true,
					});
					emitDispatch(decision.decision_id, decision.handler, handled.outcome, handled.detail);
				}
			} else {
				emitDispatch(
					decision.decision_id,
					decision.handler,
					"failed",
					`unhandled handler: ${decision.handler}`,
				);
			}
		} catch (error: any) {
			emitDispatch(
				decision.decision_id,
				decision.handler,
				"failed",
				error?.message || String(error),
			);
		} finally {
			if (acquiredNewLease && lease && decision.handler !== "close_out") {
				releaseLoopLease(stateDir, lease.target_id, { host_token: lease.host_token });
			}
		}
	}

	return { dispatches };
}
