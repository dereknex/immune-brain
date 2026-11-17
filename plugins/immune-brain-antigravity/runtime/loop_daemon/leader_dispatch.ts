/**
 * Loop Daemon: Leader Guard and Dispatch (S3)
 *
 * Implements D3.1-D3.3 of docs/specs/loop-leader.spec.md (BR-REQ-3, BR-DEC-5,
 * BR-DEC-10). `S2` journals what the leader proposed; this module is where an
 * accepted item finally has an effect — and only after a code guard says so.
 * Every refusal journals `rejected` with a reason code and changes nothing: the
 * leader cannot grant Enrollment, cannot approve, cannot merge, and cannot
 * touch a branch the daemon does not own.
 *
 * `shape{plan:"initiative"}` writes the Local carrier `docs/initiatives/<slug>.md`
 * plus one Kernel-authored TaskIntent per slice and records the binding; nothing
 * reaches a GitHub tracker. `dispatch` starts one catalog role session and takes
 * its outcome from the session record, never from what the session printed.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

import { localInitiativePath } from "../local_initiative.ts";
import { planBranchName, renderPlanSummary, type PlanIntentSummary } from "./plan_drafter.ts";
import { LOOP_PLAN_PUBLICATION_CONTRACT, writePlanPublication, type LoopPlanPublication } from "./agent_handlers.ts";
import type { KernelIntentResult } from "./plan_drafter.ts";
import { buildDecisionRecord, type LoopDecisionRecord } from "./decision_record.ts";
import type { LoopDispatchRecord } from "./dispatch.ts";
import { evaluateGuards, eventTarget, firstBlock, type GuardFacts } from "./guards.ts";
import type { LoopHandler } from "./handlers.ts";
import { appendLeaderJournal } from "./leader_journal.ts";
import type { LeaderProposalActionName, LeaderProposalItem } from "./leader_proposal.ts";
import {
	handlerWorkItemState,
	isLegalWorkItemTransition,
	markPlanPublished,
	readWorkItem,
	recordWorkItemOutcome,
	writeWorkItem,
} from "./work_items.ts";
import type { ReconcileCandidate } from "./reconcile.ts";
import { type LoopRoleBase, type ResolvedLoopRole } from "./role_catalog.ts";
import { finishRoleSession, runningRoleSessions, startRoleSession } from "./role_sessions.ts";

import type { NormalizedLoopEvent } from "./types.ts";

export const LOOP_LEADER_ITEM_RESULT_CONTRACT = "assurance_kernel/loop_leader_items/v1" as const;

export type LeaderItemOutcome = "accepted" | "rejected" | "noted";

export interface LeaderItemResult {
	index: number;
	target: string;
	action: LeaderProposalActionName;
	outcome: LeaderItemOutcome;
	reason: string;
	handler: LoopHandler | null;
	/** The catalog session a `dispatch` item started, when it started one. */
	session_id: string | null;
	/**
	 * True when a real session ran even though the item was refused: a failed
	 * or timed-out session still counts against the dispatch budget, so the
	 * next tick must see it.
	 */
	session_started?: boolean;
}

/** One Initiative slice: the carrier section plus the TaskIntent the Kernel authors. */
export interface InitiativeSlice {
	slice_id: string;
	/** The result the carrier's `## <slice-id>: <result>` heading names. */
	result: string;
	/** Repository-relative TaskIntent path the Kernel authors. */
	path: string;
	/** The candidate TaskIntent bytes. */
	intent: unknown;
	blocked_by?: string[];
}

export interface InitiativePlan {
	slug: string;
	slices: InitiativeSlice[];
}

/** The carrier sections one shaped Initiative produced. */
export interface ShapedInitiative {
	slug: string;
	carrier_path: string;
	plan_digest: string;
	task_ids: string[];
	/** One entry per slice, for the local plan publication the drive enrolls. */
	intents: PlanIntentSummary[];
}

export interface LeaderDispatchDeps {
	root: string;
	stateDir: string;
	now: string;
	dry_run: boolean;
	fingerprint: string | null;
	roles: readonly ResolvedLoopRole[];
	guardFacts: GuardFacts;
	/** Every event observed this tick, so a `next` can find its target's own event. */
	events: readonly NormalizedLoopEvent[];
	/** Model-skipped and needs_judging decisions: the events a reconcile `next` may act on. */
	candidates: readonly ReconcileCandidate[];
	max_concurrent: number;
	dispatches_today: number;
	max_dispatches_per_day: number | null;
	/** Runs one accepted `next` through the daemon's own dispatch path. */
	runNext: (input: { decision: LoopDecisionRecord; event: NormalizedLoopEvent }) => Promise<LoopDispatchRecord[]>;
	/** The plan role's slices for a `shape{plan:"initiative"}` item. */
	planInitiative: (input: { target: string; reason: string }) => Promise<InitiativePlan | null>;
	/** `imm-kernel intent author <path> --stdin --json`. */
	runKernel: (input: { argv: string[]; cwd: string; stdin?: string }) => KernelIntentResult;
	/** Starts one catalog role session and reports what its own record says. */
	startSession: (input: {
		role: ResolvedLoopRole;
		target: string;
		subject: string;
		brief: string;
		session_id: string;
	}) => Promise<{ completed: boolean; reason: string }>;
}

const LEADER_UNDISPATCHABLE_BASES: readonly LoopRoleBase[] = ["leader"];

export const LOOP_INITIATIVE_PLAN_CONTRACT = "immune_brain/loop_initiative_plan/v1" as const;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * The plan role's Initiative shape: one slug plus one slice per Task. Anything
 * else is refused as a whole, so a half-read plan never reaches the carrier.
 * Each slice's `path` must be the intent's canonical sidecar
 * `docs/plans/<task-id>.intent.json`: the drive later reads every slice
 * through that path, so anything else would strand the Task it just authored.
 */
export function parseInitiativePlan(bytes: string): InitiativePlan | null {
	try {
		const value = JSON.parse(bytes) as Record<string, unknown>;
		if (!value || typeof value !== "object" || Array.isArray(value)) return null;
		if (value.contract !== LOOP_INITIATIVE_PLAN_CONTRACT) return null;
		if (typeof value.slug !== "string" || !ID_PATTERN.test(value.slug)) return null;
		if (!Array.isArray(value.slices) || value.slices.length === 0) return null;
		const slices: InitiativeSlice[] = [];
		for (const raw of value.slices) {
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
			const entry = raw as Record<string, unknown>;
			if (typeof entry.slice_id !== "string" || !ID_PATTERN.test(entry.slice_id)) return null;
			if (typeof entry.result !== "string" || entry.result.trim().length === 0) return null;
			if (!entry.intent || typeof entry.intent !== "object" || Array.isArray(entry.intent)) return null;
			const intent = entry.intent as Record<string, unknown>;
			// The Kernel authors the intent to its canonical sidecar path, so the
			// slice must already name the task_id the drive will read back.
			if (typeof intent.task_id !== "string" || !ID_PATTERN.test(intent.task_id)) return null;
			if (entry.path !== `docs/plans/${intent.task_id}.intent.json`) return null;
			if (
				entry.blocked_by !== undefined &&
				(!Array.isArray(entry.blocked_by) || entry.blocked_by.some((id) => typeof id !== "string"))
			)
				return null;
			slices.push({
				slice_id: entry.slice_id,
				result: entry.result,
				path: entry.path as string,
				intent: entry.intent,
				...(entry.blocked_by ? { blocked_by: entry.blocked_by as string[] } : {}),
			});
		}
		return { slug: value.slug, slices };
	} catch {
		return null;
	}
}

/** The event a `next` acts on: its reconcile candidate's own event, else its target's latest. */
export function leaderEventFor(
	target: string,
	events: readonly NormalizedLoopEvent[],
	candidates: readonly ReconcileCandidate[],
): NormalizedLoopEvent | null {
	const candidate = [...candidates].reverse().find((entry) => entry.target === target);
	if (candidate) {
		const byCandidate = [...events].reverse().find((event) => event.event_id === candidate.event_id);
		if (byCandidate) return byCandidate;
	}
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index]!;
		const resolved = eventTarget(event);
		if (`${resolved.kind}-${resolved.id}` === target) return event;
	}
	return null;
}

function shortDigest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

/** The carrier bytes: one `## <slice>: <result>` section, one Task, optional `Blocked by:`. */
export function renderLocalInitiativeCarrier(plan: { slug: string; slices: Array<{ slice_id: string; result: string; task_id: string; blocked_by?: string[] }> }): string {
	const lines = [`# Initiative: ${plan.slug}`, ""];
	for (const slice of plan.slices) {
		lines.push(`## ${slice.slice_id}: ${slice.result}`, "", "Tasks:", "", `- ${slice.task_id}`, "");
		if (slice.blocked_by && slice.blocked_by.length > 0) lines.push(`Blocked by: ${slice.blocked_by.join(", ")}`, "");
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * Author every slice's TaskIntent through the Kernel and write the Local carrier.
 * The digest covers the carrier and every authored intent, so re-shaping any of
 * them changes the identity a later approval would name.
 */
export function shapeInitiative(
	plan: InitiativePlan,
	deps: { root: string; now: string; runKernel: LeaderDispatchDeps["runKernel"] },
): ShapedInitiative {
	const authored: Array<{ slice_id: string; result: string; blocked_by?: string[]; path: string; task_id: string; content_hash: string; risk: string }> = [];
	for (const slice of plan.slices) {
		const result = deps.runKernel({
			argv: ["intent", "author", slice.path, "--stdin", "--json"],
			cwd: deps.root,
			stdin: `${JSON.stringify(slice.intent, null, 2)}\n`,
		});
		const verdict = result.json ?? {};
		if (result.exit_code !== 0 || verdict.valid !== true)
			throw new Error(`intent_validation_failed: ${slice.path}: ${verdict.reason ?? verdict.code ?? `exit ${result.exit_code}`}`);
		if (typeof verdict.task_id !== "string" || typeof verdict.content_hash !== "string")
			throw new Error(`intent_validation_failed: ${slice.path}: kernel result carries no task_id and content_hash`);
		authored.push({
			slice_id: slice.slice_id,
			result: slice.result,
			...(slice.blocked_by ? { blocked_by: slice.blocked_by } : {}),
			path: slice.path,
			task_id: verdict.task_id,
			content_hash: verdict.content_hash,
			risk: typeof verdict.risk === "string" ? verdict.risk : "unknown",
		});
	}
	const carrier = renderLocalInitiativeCarrier({
		slug: plan.slug,
		slices: authored.map((slice) => ({ slice_id: slice.slice_id, result: slice.result, task_id: slice.task_id, ...(slice.blocked_by ? { blocked_by: slice.blocked_by } : {}) })),
	});
	const carrierPath = localInitiativePath(plan.slug);
	const path = join(deps.root, carrierPath);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, carrier, { mode: 0o644 });
	const intents: PlanIntentSummary[] = authored
		.map(({ path: intentPath, task_id, content_hash, risk }) => ({ path: intentPath, task_id, content_hash, risk }))
		.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
	return {
		slug: plan.slug,
		carrier_path: carrierPath,
		// Sorted, so the same carrier and intents always yield the same digest.
		plan_digest: shortDigest(JSON.stringify({ slug: plan.slug, carrier, intents })),
		task_ids: authored.map((slice) => slice.task_id),
		intents,
	};
}

/**
 * Apply one parsed proposal. Each item yields exactly one result: accepted (its
 * effect ran), noted (`note` only) or rejected (a guard named its reason and
 * nothing changed).
 */
export async function applyLeaderProposal(
	items: readonly LeaderProposalItem[],
	deps: LeaderDispatchDeps,
): Promise<LeaderItemResult[]> {
	const results: LeaderItemResult[] = [];
	let dispatchesToday = deps.dispatches_today;
	for (const [index, item] of items.entries()) {
		const result = await applyItem(index, item, deps, () => dispatchesToday, () => {
			dispatchesToday += 1;
		});
		results.push(result);
	}
	if (!deps.dry_run) {
		appendLeaderJournal(
			deps.stateDir,
			results.map((result) => ({
				at: deps.now,
				kind: result.outcome === "rejected" ? ("rejected" as const) : ("accepted" as const),
				fingerprint: deps.fingerprint,
				payload: {
					index: result.index,
					target: result.target,
					action: result.action,
					reason: result.reason,
					...(result.handler === null ? {} : { handler: result.handler }),
					...(result.session_id === null ? {} : { session_id: result.session_id }),
				},
			})),
		);
	}
	return results;
}

function reject(
	index: number,
	item: LeaderProposalItem,
	reason: string,
	handler: LoopHandler | null = null,
): LeaderItemResult {
	return { index, target: item.target, action: item.action, outcome: "rejected", reason, handler, session_id: null };
}

async function applyItem(
	index: number,
	item: LeaderProposalItem,
	deps: LeaderDispatchDeps,
	dispatchesToday: () => number,
	countDispatch: () => void,
): Promise<LeaderItemResult> {
	if (item.action === "note") {
		return { index, target: item.target, action: "note", outcome: "noted", reason: item.text, handler: null, session_id: null };
	}
	// D3.1 lists next, priority, shape and dispatch; `resolve` is `S4`'s contract and
	// journaling it as refused keeps `S3` from half-applying a replanning decision.
	if (item.action === "resolve") return reject(index, item, "resolve_not_supported_in_slice");
	switch (item.action) {
		case "next":
			return applyNext(index, item, deps);
		case "priority":
			return applyPriority(index, item, deps);
		case "shape":
			return applyShape(index, item, deps);
		default:
			return applyDispatch(index, item, deps, dispatchesToday, countDispatch);
	}
}

async function applyNext(
	index: number,
	item: Extract<LeaderProposalItem, { action: "next" }>,
	deps: LeaderDispatchDeps,
): Promise<LeaderItemResult> {
	const workItem = readWorkItem(deps.stateDir, item.target);
	if (!workItem) return reject(index, item, "work_item_unknown", item.handler);
	const nextState = handlerWorkItemState(item.handler);
	if (nextState === null) return reject(index, item, "handler_moves_no_state", item.handler);
	if (!isLegalWorkItemTransition(workItem.state, nextState))
		return reject(index, item, `illegal_transition: ${workItem.state} -> ${nextState}`, item.handler);
	const event = leaderEventFor(item.target, deps.events, deps.candidates);
	if (event === null) return reject(index, item, "event_unavailable", item.handler);
	// D3.4: a reconcile `next` passes the same Tier-0 guards a judging override did.
	const blocked = firstBlock(evaluateGuards(event, deps.guardFacts));
	if (blocked !== null) return reject(index, item, `guard_${blocked.guard}: ${blocked.detail}`, item.handler);
	if (deps.dry_run)
		return { index, target: item.target, action: "next", outcome: "accepted", reason: "dry_run", handler: item.handler, session_id: null };

	const decision = buildDecisionRecord(
		event,
		{ tier: 0, handler: item.handler, reason: `leader next for ${item.target}`, guard: null, classification: null },
		eventTarget(event),
		{ recorded_at: deps.now, dry_run: false },
	);
	const records = await deps.runNext({ decision, event });
	const record = records.find((entry) => entry.decision_id === decision.decision_id);
	if (!record || record.outcome !== "executed")
		return reject(index, item, `dispatch_${record?.outcome ?? "missing"}: ${record?.detail ?? "no dispatch record"}`, item.handler);
	recordWorkItemOutcome(deps.stateDir, {
		event,
		handler: item.handler,
		plan_digest: workItem.binding.plan_digest,
		now: deps.now,
	});
	return { index, target: item.target, action: "next", outcome: "accepted", reason: record.detail, handler: item.handler, session_id: null };
}

function applyPriority(
	index: number,
	item: Extract<LeaderProposalItem, { action: "priority" }>,
	deps: LeaderDispatchDeps,
): LeaderItemResult {
	const workItem = readWorkItem(deps.stateDir, item.target);
	if (!workItem) return reject(index, item, "work_item_unknown");
	if (!Number.isSafeInteger(item.rank)) return reject(index, item, "leader_rank_invalid");
	if (!deps.dry_run) writeWorkItem(deps.stateDir, { ...workItem, leader_rank: item.rank, updated_at: deps.now });
	return { index, target: item.target, action: "priority", outcome: "accepted", reason: `leader_rank ${item.rank}`, handler: null, session_id: null };
}

async function applyShape(
	index: number,
	item: Extract<LeaderProposalItem, { action: "shape" }>,
	deps: LeaderDispatchDeps,
): Promise<LeaderItemResult> {
	const workItem = readWorkItem(deps.stateDir, item.target);
	if (!workItem) return reject(index, item, "work_item_unknown");
	// D3.1: shape happens in triage or planning, before the plan is published.
	if (workItem.state !== "triage" && workItem.state !== "planning")
		return reject(index, item, `shape_after_plan_publication: ${workItem.state}`);
	if (item.plan === "task") {
		// A single task is the daemon's default shape; nothing to write.
		return { index, target: item.target, action: "shape", outcome: "accepted", reason: "shape_task_default", handler: null, session_id: null };
	}
	if (deps.dry_run)
		return { index, target: item.target, action: "shape", outcome: "accepted", reason: "dry_run", handler: null, session_id: null };
	// A shape targets one Issue: the local publication below is keyed by it, and
	// nothing is posted to any tracker. Checked before any write, so a refusal
	// leaves zero side effects.
	const issueNumber = /^issue-(\d+)$/.exec(item.target);
	if (!issueNumber) return reject(index, item, "shape_target_not_issue");
	let plan: InitiativePlan | null;
	try {
		plan = await deps.planInitiative({ target: item.target, reason: item.reason });
	} catch (error) {
		return reject(index, item, `shape_plan_failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (plan === null || plan.slices.length === 0) return reject(index, item, "shape_plan_missing");
	let shaped: ShapedInitiative;
	try {
		shaped = shapeInitiative(plan, { root: deps.root, now: deps.now, runKernel: deps.runKernel });
	} catch (error) {
		return reject(index, item, error instanceof Error ? error.message : String(error));
	}
	// D3.3: the binding is what makes `driving` observe the carrier, not a task.
	const issue = Number(issueNumber[1]);
	const branch = planBranchName(issue);
	const requiresOwnerApproval = shaped.intents.some((intent) => intent.risk !== "routine");
	const publication: LoopPlanPublication = {
		contract: LOOP_PLAN_PUBLICATION_CONTRACT,
		issue_number: issue,
		branch,
		worktree_path: deps.root,
		digest: shaped.plan_digest,
		requires_owner_approval: requiresOwnerApproval,
		intents: shaped.intents,
		task_id: shaped.task_ids[0]!,
		comment_body: renderPlanSummary({
			issue_number: issue,
			branch,
			worktree_path: deps.root,
			digest: shaped.plan_digest,
			requires_owner_approval: requiresOwnerApproval,
			intents: shaped.intents,
			spec: null,
		}),
		drafted_at: deps.now,
		published_at: deps.now,
		// Local only: the daemon never posts a plan comment for an Initiative.
		published_comment_id: null,
	};
	writeWorkItem(deps.stateDir, {
		...workItem,
		binding: {
			...workItem.binding,
			initiative_slug: shaped.slug,
			task_ids: shaped.task_ids,
			plan_digest: shaped.plan_digest,
		},
		updated_at: deps.now,
	});
	writePlanPublication(deps.stateDir, publication);
	markPlanPublished(deps.stateDir, item.target, shaped.plan_digest, deps.now);
	return {
		index,
		target: item.target,
		action: "shape",
		outcome: "accepted",
		reason: `initiative ${shaped.carrier_path} (${shaped.task_ids.length} slice(s))`,
		handler: null,
		session_id: null,
	};
}

async function applyDispatch(
	index: number,
	item: Extract<LeaderProposalItem, { action: "dispatch" }>,
	deps: LeaderDispatchDeps,
	dispatchesToday: () => number,
	countDispatch: () => void,
): Promise<LeaderItemResult> {
	const role = deps.roles.find((entry) => entry.name === item.role);
	if (!role) return reject(index, item, "role_not_in_catalog");
	if (LEADER_UNDISPATCHABLE_BASES.includes(role.base)) return reject(index, item, "leader_role_not_dispatchable");
	// D1.2/D3.1: `execute` is reachable only through `enroll_and_drive` with
	// existing Enrollment authority; the leader cannot grant that authority.
	if (role.base === "execute") return reject(index, item, "execute_requires_enrollment_authority");
	if (role.base === "repair") {
		const workItem = readWorkItem(deps.stateDir, item.target);
		if (!workItem || workItem.state !== "repairing" || workItem.binding.pr === null)
			return reject(index, item, "repair_outside_daemon_branch");
	}
	const running = runningRoleSessions(deps.stateDir);
	if (running.filter((session) => session.role === role.name).length >= role.limits.max_parallel)
		return reject(index, item, "role_max_parallel");
	if (running.length >= deps.max_concurrent) return reject(index, item, "max_concurrent");
	if (deps.max_dispatches_per_day !== null && dispatchesToday() >= deps.max_dispatches_per_day)
		return reject(index, item, "dispatch_budget_exhausted");
	if (deps.dry_run)
		return { index, target: item.target, action: "dispatch", outcome: "accepted", reason: "dry_run", handler: null, session_id: null };

	const session = startRoleSession(deps.stateDir, {
		target: item.target,
		role: role.name,
		base: role.base,
		started_at: deps.now,
	});
	countDispatch();
	let outcome: { completed: boolean; reason: string };
	try {
		outcome = await deps.startSession({
			role,
			target: item.target,
			subject: item.subject,
			brief: item.brief,
			session_id: session.session_id,
		});
	} catch (error) {
		outcome = { completed: false, reason: `session_provider_error: ${error instanceof Error ? error.message : String(error)}` };
	}
	// D3.2: the session record decides completion, never the session's own text.
	finishRoleSession(deps.stateDir, session, {
		status: outcome.completed ? "completed" : "failed",
		reason: outcome.reason,
		at: deps.now,
	});
	if (outcome.completed)
		return { index, target: item.target, action: "dispatch", outcome: "accepted", reason: outcome.reason, handler: null, session_id: session.session_id };
	const failed = reject(index, item, `session_failed: ${outcome.reason}`);
	// The session ran and failed: the budget must see the attempt even though
	// nothing was achieved.
	failed.session_started = true;
	return failed;
}
