/**
 * Loop Daemon: Resident Leader (S2)
 *
 * Implements D2.2, D2.3 and D2.6 of docs/specs/loop-leader.spec.md (BR-REQ-2,
 * BR-DEC-3, BR-OUT-5). The leader is not a long-lived session: the tick compiles
 * a briefing, and only a briefing fingerprint the journal has not already
 * recorded starts one bounded read-only session. That session reads the briefing
 * and the journal tail, both copied into an empty directory of its own, and
 * prints a `loop_leader_proposal/v1`; the daemon parses it, journals what it
 * accepted and refuses the rest. `S2` executes nothing, so a proposal has no
 * effect yet.
 *
 * The session carries no GitHub credential (`sessionEnvironment(null)`) and no
 * leader module imports the GitHub port: the leader cannot read or write GitHub,
 * and its wake rule never depends on a projection.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { sessionEnvironment, runAgentSession, type AgentSessionProvider, type AgentSessionRecord } from "./agent_runner.ts";
import {
	compileLeaderBriefing,
	type LeaderBriefing,
	type LeaderBriefingBatch,
	type LeaderBriefingInput,
	type LeaderBriefingInteraction,
	type LeaderBriefingOutcome,
	type LeaderBriefingWorkItem,
} from "./leader_briefing.ts";
import {
	appendLeaderJournal,
	leaderJournalTail,
	leaderOwnerHints,
	leaderStateDir,
	lastLeaderWakeFingerprint,
	readLeaderJournal,
} from "./leader_journal.ts";
import { parseLeaderProposal, type LeaderProposal, type LeaderProposalRejection } from "./leader_proposal.ts";
import { readLocalRequests } from "./interaction/local_channel.ts";
import type { InteractionSubject } from "./interaction/protocol.ts";
import type { ResolvedLoopRole } from "./role_catalog.ts";
import { loadLoopDispatches } from "./state.ts";
import { isTerminalBatchState, type BatchRunState } from "../unattended/batch_state.ts";
import { listWorkItems } from "./work_items.ts";

export const LOOP_LEADER_TICK_CONTRACT = "assurance_kernel/loop_leader_tick/v1" as const;
/** `.imm-loop` holds the only two inputs the leader session is given. */
export const LEADER_INPUT_DIR = ".imm-loop";
export const LEADER_BRIEFING_FILE = `${LEADER_INPUT_DIR}/briefing.json`;
export const LEADER_JOURNAL_TAIL_FILE = `${LEADER_INPUT_DIR}/journal-tail.jsonl`;
export const LEADER_PROPOSAL_FILE = `${LEADER_INPUT_DIR}/proposal.json`;
/**
 * The leader's own directory under `leader/`, recreated on every wake. It is not
 * a Git worktree: D2.3 lets the session see only the two inputs, so it starts
 * from an empty directory rather than a checkout of the repository.
 */
export const LEADER_WORKTREE_DIR = "worktree";

export function leaderWorktreePath(stateDir: string): string {
	return join(leaderStateDir(stateDir), LEADER_WORKTREE_DIR);
}

/**
 * Count one live wake against both budgets (D2.2), in one shared step: the leader
 * and dispatch counters can never drift apart, and because the fingerprint
 * carries only availability, the counters this moves cannot change it.
 */
export function recordLeaderWake(stats: {
	leader_wakes_today?: number;
	dispatches_today?: number;
	dispatches_total?: number;
}): void {
	stats.leader_wakes_today = (stats.leader_wakes_today ?? 0) + 1;
	stats.dispatches_today = (stats.dispatches_today ?? 0) + 1;
	stats.dispatches_total = (stats.dispatches_total ?? 0) + 1;
}

export interface LeaderWakeBudget {
	wakes_today: number;
	max_leader_wakes_per_day: number;
	dispatches_today: number;
	max_dispatches_per_day: number | null;
}

export interface LeaderWakeDecision {
	wake: boolean;
	reason:
		| "wake"
		| "leader_disabled"
		| "leader_wake_budget_exhausted"
		| "dispatch_budget_exhausted"
		| "fingerprint_unchanged"
		| "mode_observe"
		| "dry_run"
		| "leader_session_unavailable";
}

/**
 * The wake rule (D2.2). Every gate is a fact the caller already holds, so the
 * decision is deterministic and the refusal names its one cause.
 */
export function leaderWakeDecision(input: {
	fingerprint: string;
	last_wake_fingerprint: string | null;
	budget: LeaderWakeBudget;
	mode: string;
	dry_run: boolean;
	session_available: boolean;
}): LeaderWakeDecision {
	if (input.dry_run) return { wake: false, reason: "dry_run" };
	if (input.mode === "observe") return { wake: false, reason: "mode_observe" };
	if (input.budget.max_leader_wakes_per_day <= 0) return { wake: false, reason: "leader_disabled" };
	if (input.budget.wakes_today >= input.budget.max_leader_wakes_per_day)
		return { wake: false, reason: "leader_wake_budget_exhausted" };
	if (input.budget.max_dispatches_per_day !== null && input.budget.dispatches_today >= input.budget.max_dispatches_per_day)
		return { wake: false, reason: "dispatch_budget_exhausted" };
	if (input.fingerprint === input.last_wake_fingerprint) return { wake: false, reason: "fingerprint_unchanged" };
	if (!input.session_available) return { wake: false, reason: "leader_session_unavailable" };
	return { wake: true, reason: "wake" };
}

/** The entry prompt: what the session may read, and the exact reply contract. */
export function leaderEntryPrompt(briefing: LeaderBriefing, fingerprint: string): string {
	return [
		"You are the Loop's read-only leader. Read only these two files in this worktree:",
		`- \`${LEADER_BRIEFING_FILE}\` — this tick's briefing: work items, batch summaries, pending interactions, recent outcomes, reconcile candidates, catalog roles, owner hints and budget availability.`,
		`- \`${LEADER_JOURNAL_TAIL_FILE}\` — the last journal entries, including what you proposed before.`,
		"",
		"You cannot write files, run shell commands or reach GitHub, and you are not asked to. Decide what, if anything, the Loop should do next, and print exactly one JSON object and nothing else:",
		`{"contract": "${"immune_brain/loop_leader_proposal/v1"}", "briefing_fingerprint": "${fingerprint}", "items": []}`,
		"Echo that `briefing_fingerprint` value unchanged: a different value refuses the whole proposal. You cannot compute it, so use exactly the value above.",
		`Each item is \`{"target": "<a target named in the briefing>", "action": ...}\` with at most 20 items, and the action one of:`,
		'- `"next"` with `handler`: one name from the Loop handler catalogue.',
		'- `"priority"` with an integer `rank`.',
		'- `"shape"` with `plan` (`"task"` or `"initiative"`) and `reason`.',
		'- `"dispatch"` with `role` (a catalog role name), `subject` and `brief` (at most 16 KiB).',
		'- `"resolve"` with `kind` (`"resume"`, `"release"`, `"replan"` or `"ask_owner"`) and, for `ask_owner`, the `context` the owner needs.',
		'- `"note"` with `text`.',
		"",
		"Propose nothing when the briefing already says everything that is happening. An empty `items` array is a valid answer.",
	].join("\n");
}

/**
 * The leader's inputs, read from local state only: the work-item store, the
 * dispatch log, pending interactions and batch records. Nothing here is
 * authority and nothing is restored from GitHub (BR-DEC-3).
 */
export function collectLeaderBriefingInput(input: {
	root: string;
	stateDir: string;
	roles: readonly ResolvedLoopRole[];
	ownerHints: readonly string[];
	budget: LeaderBriefingInput["budget"];
}): LeaderBriefingInput {
	const workItems: LeaderBriefingWorkItem[] = listWorkItems(input.stateDir).map((item) => ({
		target: item.target,
		state: item.state,
		revision: item.revision,
		binding: {
			plan_digest: item.binding.plan_digest,
			task_ids: [...item.binding.task_ids],
			run_id: item.binding.run_id,
			pr: item.binding.pr,
		},
		refusals: item.refused_transitions.map((refusal) => ({
			from: refusal.from,
			to: refusal.to,
			handler: refusal.handler,
			reason: refusal.reason,
		})),
		replan_rounds: (item as { replan_rounds?: number }).replan_rounds ?? 0,
		paused: (item as { paused?: boolean }).paused ?? false,
	}));
	const taskIds = new Set(workItems.flatMap((item) => item.binding.task_ids));
	const interactions: LeaderBriefingInteraction[] = readLocalRequests(input.stateDir).map((request) => ({
		id: request.interaction_id,
		kind: request.kind,
		subject: interactionSubjectKey(request.subject),
	}));
	const outcomes: LeaderBriefingOutcome[] = loadLoopDispatches(input.stateDir).map((dispatch) => ({
		handler: typeof dispatch.handler === "string" ? dispatch.handler : null,
		outcome: typeof dispatch.outcome === "string" ? dispatch.outcome : "unknown",
		detail: typeof dispatch.detail === "string" ? dispatch.detail : "",
	}));
	return {
		work_items: workItems,
		// Only batches that own a work item are Initiative-shaped (D2.1).
		batches: readBatchSummaries(input.root).filter((batch) => batch.children.some((child) => taskIds.has(child.task_id))),
		interactions,
		outcomes,
		// D3.4 lists model-skipped decisions here; `S3` fills it.
		reconcile_candidates: [],
		roles: input.roles.map((role) => ({ name: role.name, base: role.base, when: role.when })),
		owner_hints: [...input.ownerHints],
		budget: input.budget,
	};
}

/** One stable subject label, so two briefings about the same request read the same. */
function interactionSubjectKey(subject: InteractionSubject): string {
	if (typeof subject.issue === "number") return `issue-${subject.issue}`;
	if (typeof subject.pr === "number") return `pr-${subject.pr}`;
	if (typeof subject.task_id === "string") return `task-${subject.task_id}`;
	if (typeof subject.run_id === "string") return `run-${subject.run_id}`;
	return "unknown";
}

function readBatchSummaries(root: string): LeaderBriefingBatch[] {
	const dir = join(root, ".imm/state/batches");
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return [];
	}
	const batches: LeaderBriefingBatch[] = [];
	for (const name of names.sort()) {
		if (!name.startsWith("batch-") || !name.endsWith(".json") || name.endsWith(".report.json")) continue;
		let record: Record<string, any>;
		try {
			record = JSON.parse(readFileSync(join(dir, name), "utf8"));
		} catch {
			continue;
		}
		if (typeof record?.contract !== "string" || !record.contract.startsWith("assurance_kernel/batch_run_state/")) continue;
		if (typeof record.batch_state !== "string" || isTerminalBatchState(record.batch_state as BatchRunState)) continue;
		batches.push({
			batch_id: String(record.batch_id ?? name.replace(/\.json$/, "")),
			initiative_slug: typeof record.initiative_slug === "string" ? record.initiative_slug : null,
			batch_state: record.batch_state,
			children: Array.isArray(record.children)
				? record.children.map((child: any) => ({ task_id: String(child?.task_id ?? ""), state: String(child?.state ?? "unknown") }))
				: [],
		});
	}
	return batches;
}

export interface LeaderTickDeps {
	root: string;
	stateDir: string;
	roles: readonly ResolvedLoopRole[];
	mode: string;
	dry_run: boolean;
	now: string;
	/** The leader role's own session limits (catalog limits, else the built-in table). */
	turn_budget: number;
	timeout_ms: number;
	budget: LeaderWakeBudget;
	/** The session backend; absent compiles and reports the briefing but wakes nothing. */
	sessionProvider: AgentSessionProvider | null;
}

export interface LeaderTickResult {
	contract: typeof LOOP_LEADER_TICK_CONTRACT;
	briefing_fingerprint: string;
	briefing_bytes: number;
	dropped_outcomes: number;
	woke: boolean;
	reason: LeaderWakeDecision["reason"];
	journal_seq: number | null;
	proposal: { items: number; rejected: LeaderProposalRejection[] } | null;
	proposal_rejection: string | null;
	session_reason: string | null;
	/** Set when a live wake was counted; the caller persists it into the daemon budget. */
	counted_wake: boolean;
}

/**
 * One leader step. The briefing is always compiled and reported; a wake happens
 * only when the rule allows it, and the wake and its proposal are journaled
 * together so a crash mid-session leaves no wake and the next tick retries.
 */
export async function runLeaderTick(deps: LeaderTickDeps): Promise<LeaderTickResult> {
	const journal = readLeaderJournal(deps.stateDir);
	const lastFingerprint = lastLeaderWakeFingerprint(journal);
	const inputs = collectLeaderBriefingInput({
		root: deps.root,
		stateDir: deps.stateDir,
		roles: deps.roles,
		ownerHints: leaderOwnerHints(journal),
		budget: {
			leader_wakes: deps.budget.wakes_today >= deps.budget.max_leader_wakes_per_day ? "exhausted" : "available",
			dispatches:
				deps.budget.max_dispatches_per_day !== null && deps.budget.dispatches_today >= deps.budget.max_dispatches_per_day
					? "exhausted"
					: "available",
		},
	});
	const compiled = compileLeaderBriefing(inputs);
	const sessionAvailable = deps.sessionProvider !== null;
	const decision = leaderWakeDecision({
		fingerprint: compiled.fingerprint,
		last_wake_fingerprint: lastFingerprint,
		budget: deps.budget,
		mode: deps.mode,
		dry_run: deps.dry_run,
		session_available: sessionAvailable,
	});
	const result: LeaderTickResult = {
		contract: LOOP_LEADER_TICK_CONTRACT,
		briefing_fingerprint: compiled.fingerprint,
		briefing_bytes: compiled.bytes,
		dropped_outcomes: compiled.dropped_outcomes,
		woke: false,
		reason: decision.reason,
		journal_seq: null,
		proposal: null,
		proposal_rejection: null,
		session_reason: null,
		counted_wake: false,
	};
	if (!decision.wake || deps.sessionProvider === null) return result;

	// Recreated from scratch on every wake, so the session sees only the two inputs
	// and never a previous wake's proposal (D2.3).
	const worktree = leaderWorktreePath(deps.stateDir);
	rmSync(worktree, { recursive: true, force: true });
	mkdirSync(join(worktree, LEADER_INPUT_DIR), { recursive: true, mode: 0o700 });
	writeFileSync(join(worktree, LEADER_BRIEFING_FILE), `${compiled.json}\n`, { mode: 0o600 });
	writeFileSync(
		join(worktree, LEADER_JOURNAL_TAIL_FILE),
		leaderJournalTail(journal)
			.map((entry) => `${JSON.stringify(entry)}\n`)
			.join(""),
		{ mode: 0o600 },
	);

	const session: AgentSessionRecord = await runAgentSession(
		{
			kind: "leader",
			worktree_path: worktree,
			prompt: leaderEntryPrompt(compiled.briefing, compiled.fingerprint),
			turn_budget: deps.turn_budget,
			timeout_ms: deps.timeout_ms,
			// BR-REQ-2: no GitHub credential reaches the leader.
			env: sessionEnvironment(null),
		},
		deps.sessionProvider,
	);

	result.woke = true;
	result.counted_wake = true;
	result.session_reason = session.reason;
	const parsed =
		session.status === "completed"
			? parseLeaderProposal(session.output ?? "", {
					fingerprint: compiled.fingerprint,
					targets: compiled.briefing.work_items.map((item) => item.target),
					roles: compiled.briefing.roles.map((role) => role.name),
				})
			: null;
	let proposal: LeaderProposal | null = null;
	if (parsed === null) result.proposal_rejection = `session_${session.status}: ${session.reason}`;
	else if (!parsed.ok) result.proposal_rejection = parsed.reason;
	else {
		proposal = parsed.proposal;
		result.proposal = { items: proposal.items.length, rejected: parsed.rejected };
		writeFileSync(join(worktree, LEADER_PROPOSAL_FILE), `${JSON.stringify(proposal, null, 2)}\n`, { mode: 0o600 });
	}

	const written = appendLeaderJournal(deps.stateDir, [
		{ at: deps.now, kind: "wake", fingerprint: compiled.fingerprint, payload: { bytes: compiled.bytes, dropped_outcomes: compiled.dropped_outcomes } },
		...(proposal === null
			? [{ at: deps.now, kind: "rejected" as const, fingerprint: compiled.fingerprint, payload: { reason: result.proposal_rejection } }]
			: [
					{ at: deps.now, kind: "proposal" as const, fingerprint: compiled.fingerprint, payload: proposal },
					...(result.proposal?.rejected ?? []).map((rejection) => ({
						at: deps.now,
						kind: "rejected" as const,
						fingerprint: compiled.fingerprint,
						payload: rejection,
					})),
				]),
	]);
	result.journal_seq = written[written.length - 1]?.seq ?? null;
	return result;
}
