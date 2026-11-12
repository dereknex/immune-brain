/**
 * Loop Daemon: Continuous Priority Scheduler (S4)
 *
 * Implements D4.1 of docs/specs/loop-daemon.spec.md. One tick hands the judged
 * candidates to this module, which decides which of them may start now:
 * priority order first (owner control, PR repair, ready tasks, planning,
 * triage), then the concurrency slots, the ready and PR buffers, the daily
 * budget and `scopesOverlap()` against every lease that is still in flight. The
 * result is a deterministic projection: same input, same dispatch list.
 *
 * Nothing here writes a lease or mutates state; the caller acquires the lease
 * for each `dispatch` entry and persists the returned budget counters.
 */

import { scopesOverlap } from "../unattended/batch_schedule.ts";
import type { LoopHandler } from "./handlers.ts";
import type { LoopEventKind, LoopLease } from "./types.ts";

export const LOOP_SCHEDULE_CONTRACT = "assurance_kernel/loop_schedule/v1";

/** Dispatch classes in priority order, 1 highest (D4.1). */
export const SCHEDULE_PRIORITY = {
	owner_control: 1,
	pr_repair: 2,
	ready_task: 3,
	planning: 4,
	triage: 5,
} as const;

export type SchedulePriority = keyof typeof SCHEDULE_PRIORITY;

const HANDLER_PRIORITY: Partial<Record<LoopHandler, SchedulePriority>> = {
	// Class 1: an in-Lane decision reply is always the owner's own answer.
	apply_lane_decision_reply: "owner_control",
	repair_pr_ci: "pr_repair",
	repair_pr_conflict: "pr_repair",
	address_pr_review: "pr_repair",
	enroll_and_drive: "ready_task",
	analyze_codebase: "planning",
	draft_plan: "planning",
	publish_plan_for_approval: "planning",
	triage_issue: "triage",
};

export interface ScheduleCandidate {
	/** Lease target, e.g. `issue-42` or `pr-17`. */
	target_id: string;
	handler: LoopHandler;
	/** A verified owner action keeps class 1 whatever handler it selects. */
	event_kind?: LoopEventKind;
	scope_hint?: string[];
}

/**
 * The class of one candidate, or null when this scheduler never dispatches it
 * (`noop_record`, `escalate`, and the PR-lifecycle handlers S5/S7 own).
 */
export function candidatePriority(candidate: ScheduleCandidate): SchedulePriority | null {
	// The handler filter is the closed gate: an owner event elevates a handler the
	// daemon may dispatch, but it never makes an undispatched handler schedulable.
	const base = HANDLER_PRIORITY[candidate.handler];
	if (base === undefined) return null;
	const ownerAddressed = candidate.event_kind === "E3_OWNER_COMMENT" || candidate.event_kind === "E7_LANE_DECISION_REPLIED";
	return ownerAddressed ? "owner_control" : base;
}

export interface ScheduleLimits {
	max_concurrent: number;
	max_ready_buffer: number;
	max_pr_buffer: number;
}

export interface ScheduleBudget {
	ticks_today: number;
	dispatches_today: number;
	/** null means the budget is unlimited. */
	max_ticks_per_day: number | null;
	max_dispatches_per_day: number | null;
}

/** The G2 detail when the daily budget is spent, or null when work may still start. */
export function budgetExhausted(budget: ScheduleBudget): string | null {
	const { ticks_today, dispatches_today, max_ticks_per_day, max_dispatches_per_day } = budget;
	if (max_dispatches_per_day !== null && dispatches_today >= max_dispatches_per_day) {
		return `daily dispatch budget exhausted (${dispatches_today}/${max_dispatches_per_day})`;
	}
	if (max_ticks_per_day !== null && ticks_today >= max_ticks_per_day) {
		return `daily tick budget exhausted (${ticks_today}/${max_ticks_per_day})`;
	}
	return null;
}

export interface ScheduleInput {
	candidates: readonly ScheduleCandidate[];
	/** Leases still in flight; a parked lane keeps its slot. */
	active_leases: readonly LoopLease[];
	/** Planned tasks awaiting execution. */
	ready_buffer: number;
	open_daemon_prs: number;
	limits: ScheduleLimits;
	budget: ScheduleBudget;
	paused?: boolean;
	shutdown_requested?: boolean;
}

export interface ScheduleEntry {
	target_id: string;
	handler: LoopHandler;
	priority: SchedulePriority | null;
	action: "dispatch" | "hold";
	reason: string;
}

export interface ScheduleResult {
	contract: typeof LOOP_SCHEDULE_CONTRACT;
	/** The guard that halted the whole tick, or null when candidates were considered. */
	guard: { id: "G1" | "G2"; detail: string } | null;
	entries: ScheduleEntry[];
	dispatched: string[];
	budget_after: { ticks_today: number; dispatches_today: number };
}

export function scheduleLoopWork(input: ScheduleInput): ScheduleResult {
	const guard: ScheduleResult["guard"] =
		input.shutdown_requested === true
			? { id: "G1", detail: "shutdown requested" }
			: input.paused === true
				? { id: "G1", detail: "daemon paused" }
				: (() => {
						const detail = budgetExhausted(input.budget);
						return detail === null ? null : { id: "G2" as const, detail };
					})();

	const busy = input.active_leases.filter((lease) => lease.status !== "releasing");
	// Every claim that must not be duplicated this tick: live leases plus the dispatches made below.
	const inFlight: Array<{ target_id: string; scope: string[] }> = busy.map((lease) => ({
		target_id: lease.target_id,
		scope: lease.scope_hint ?? [],
	}));
	let slots = busy.length;
	let ready = input.ready_buffer;
	let prs = input.open_daemon_prs;
	// The guard only halts a tick that starts with a spent budget; a tick may still
	// run out of dispatches part-way through its candidates.
	const remainingDispatches =
		input.budget.max_dispatches_per_day === null
			? Number.POSITIVE_INFINITY
			: Math.max(0, input.budget.max_dispatches_per_day - input.budget.dispatches_today);

	const ordered = input.candidates
		.map((candidate, index) => ({ candidate, index, priority: candidatePriority(candidate) }))
		.sort((left, right) => {
			const leftRank = left.priority === null ? Number.MAX_SAFE_INTEGER : SCHEDULE_PRIORITY[left.priority];
			const rightRank = right.priority === null ? Number.MAX_SAFE_INTEGER : SCHEDULE_PRIORITY[right.priority];
			if (leftRank !== rightRank) return leftRank - rightRank;
			if (left.candidate.target_id !== right.candidate.target_id) {
				return left.candidate.target_id < right.candidate.target_id ? -1 : 1;
			}
			return left.index - right.index;
		});

	const entries: ScheduleEntry[] = [];
	const dispatched: string[] = [];
	const hold = (entry: { target_id: string; handler: LoopHandler; priority: SchedulePriority | null }, reason: string): void => {
		entries.push({ ...entry, action: "hold", reason });
	};
	const start = (entry: { target_id: string; handler: LoopHandler; priority: SchedulePriority }): void => {
		entries.push({ ...entry, action: "dispatch", reason: `priority ${SCHEDULE_PRIORITY[entry.priority]}` });
		dispatched.push(entry.target_id);
	};

	for (const { candidate, priority } of ordered) {
		const entry = { target_id: candidate.target_id, handler: candidate.handler, priority };
		if (guard !== null) {
			hold(entry, `${guard.id}: ${guard.detail}`);
			continue;
		}
		if (priority === null) {
			hold(entry, `handler_not_scheduled: ${candidate.handler}`);
			continue;
		}
		if (dispatched.length >= remainingDispatches) {
			hold(
				entry,
				`daily dispatch budget exhausted (${input.budget.dispatches_today + dispatched.length}/${input.budget.max_dispatches_per_day})`,
			);
			continue;
		}
		const scope = candidate.scope_hint ?? [];
		const overlap = inFlight.findIndex((other) => scopesOverlap(other.scope, scope));
		if (overlap !== -1) {
			hold(entry, `scope_overlap: shares a path with the in-flight lease ${inFlight[overlap]!.target_id}`);
			continue;
		}
		if (slots >= input.limits.max_concurrent) {
			hold(entry, `max_concurrent: ${slots}/${input.limits.max_concurrent} worker slots in use`);
			continue;
		}
		if (priority === "planning" && ready >= input.limits.max_ready_buffer) {
			hold(entry, `max_ready_buffer: ${ready}/${input.limits.max_ready_buffer} planned tasks awaiting execution`);
			continue;
		}
		if (priority === "ready_task" && prs >= input.limits.max_pr_buffer) {
			hold(entry, `max_pr_buffer: ${prs}/${input.limits.max_pr_buffer} daemon PRs open`);
			continue;
		}
		start({ target_id: candidate.target_id, handler: candidate.handler, priority });
		slots += 1;
		inFlight.push({ target_id: candidate.target_id, scope });
		if (priority === "planning") ready += 1;
		if (priority === "ready_task") prs += 1;
	}

	return {
		contract: LOOP_SCHEDULE_CONTRACT,
		guard,
		entries,
		dispatched,
		// The projection already counts this tick: persisting it is what makes
		// `max_ticks_per_day` bind across successive ticks.
		budget_after: {
			ticks_today: input.budget.ticks_today + 1,
			dispatches_today: input.budget.dispatches_today + dispatched.length,
		},
	};
}
