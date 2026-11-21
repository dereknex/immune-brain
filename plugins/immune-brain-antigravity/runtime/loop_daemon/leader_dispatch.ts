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

import { existsSync, mkdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";

import { canonicalIntentHash } from "../kernel/intent.ts";
import { localInitiativePath } from "../local_initiative.ts";
import { planBranchName, renderPlanSummary, type PlanIntentSummary } from "./plan_drafter.ts";
import {
	LOOP_PLAN_PUBLICATION_CONTRACT,
	readPlanPublication,
	removePlanPublication,
	writePlanPublication,
	type LoopPlanPublication,
} from "./agent_handlers.ts";
import type { KernelIntentResult } from "./plan_drafter.ts";
import { buildDecisionRecord, type LoopDecisionRecord } from "./decision_record.ts";
import type { LoopDispatchRecord } from "./dispatch.ts";
import { evaluateGuards, eventTarget, firstBlock, type GuardFacts } from "./guards.ts";
import type { LoopHandler } from "./handlers.ts";
import { appendLeaderJournal } from "./leader_journal.ts";
import type { LeaderProposalActionName, LeaderProposalItem } from "./leader_proposal.ts";
import type { InteractionSubject } from "./interaction/protocol.ts";
import { REPLAN_CAP, resolveBlockers, type AskOwnerResult, type ResolveFacts } from "./replan.ts";
import {
	advanceWorkItem,
	handlerWorkItemState,
	isLegalWorkItemTransition,
	markPlanPublished,
	readWorkItem,
	recordWorkItemOutcome,
	workItemGate,
	writeWorkItem,
	type WorkItem,
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
	 * True when a real catalog session ran for this item, accepted or refused: a
	 * failed or timed-out session still counts against the dispatch budget, so
	 * the next tick must see it.
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
	/** `slice_id`s of other slices in the same plan (BR-DEC-2); the carrier maps them to task ids. */
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
	/** D4.2: the target's authority gates, read from local requests and the Kernel. */
	resolveFacts: (input: { target: string; work_item: WorkItem }) => Promise<ResolveFacts>;
	/**
	 * D4.2: read-only check that the target's batch lets a `resume` through; a
	 * parked batch refuses. It changes no batch state: the item itself moves to
	 * `driving` and the batch advances on its own tick.
	 */
	checkBatchResumable: (input: { target: string; work_item: WorkItem }) => { resumed: boolean; reason: string };
	/** D4.5: post or annotate the owner question of an accepted `ask_owner`. */
	askOwner: (input: {
		target: string;
		subject: InteractionSubject;
		context: NonNullable<Extract<LeaderProposalItem, { action: "resolve" }>["context"]>;
		pending_literal_user: ResolveFacts["pending_literal_user"];
		pending_lane_entry_blocked?: NonNullable<ResolveFacts["pending_lane_entry_blocked"]>;
	}) => Promise<AskOwnerResult>;
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
		const plan: InitiativePlan = { slug: value.slug, slices };
		return validateInitiativePlan(plan) === null ? plan : null;
	} catch {
		return null;
	}
}

function intentTaskId(intent: unknown): string | null {
	if (!intent || typeof intent !== "object" || Array.isArray(intent)) return null;
	const taskId = (intent as Record<string, unknown>).task_id;
	return typeof taskId === "string" && ID_PATTERN.test(taskId) ? taskId : null;
}

/**
 * D2: the plan is one namespace of slice ids. `blocked_by` names slices of the
 * same plan; an unknown id (a task id included), a self reference or a repeat
 * rejects the whole plan, as do duplicate slice ids and duplicate intent task
 * ids. Cycles stay with `batch_plan.ts`. Returns the reason, or null when the
 * plan is consistent. It runs before the first write.
 */
export function validateInitiativePlan(plan: InitiativePlan): string | null {
	const sliceIds = new Set<string>();
	const taskIds = new Set<string>();
	for (const slice of plan.slices) {
		if (sliceIds.has(slice.slice_id)) return `duplicate slice_id ${slice.slice_id}`;
		sliceIds.add(slice.slice_id);
		const taskId = intentTaskId(slice.intent);
		if (taskId === null) return `slice ${slice.slice_id} intent carries no valid task_id`;
		if (taskIds.has(taskId)) return `duplicate intent task_id ${taskId}`;
		taskIds.add(taskId);
		if (slice.path !== `docs/plans/${taskId}.intent.json`) return `slice ${slice.slice_id} path is not docs/plans/${taskId}.intent.json`;
	}
	for (const slice of plan.slices) {
		const seen = new Set<string>();
		for (const id of slice.blocked_by ?? []) {
			if (id === slice.slice_id) return `slice ${slice.slice_id} is blocked by itself`;
			if (seen.has(id)) return `slice ${slice.slice_id} repeats blocked_by ${id}`;
			seen.add(id);
			if (!sliceIds.has(id)) return `slice ${slice.slice_id} is blocked by unknown slice_id ${id}`;
		}
	}
	return null;
}

/**
 * The event a `next` acts on: its reconcile candidate's own event, else its target's latest.
 * Repeat dispatch of the same event is not deduplicated per tick (loop-leader D3.4):
 * `WORK_ITEM_TRANSITIONS` refuses an illegal re-run and the Tier-0 guards refuse a
 * blocked one, so a second `next` for an unchanged item is rejected by them.
 */
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

/**
 * The carrier bytes: one `## <slice>: <result>` section, one Task, optional
 * `Blocked by:`. `blocked_by` here already holds task ids, the namespace
 * `local_initiative.ts` and `batch_plan.ts` read.
 */
export function renderLocalInitiativeCarrier(plan: { slug: string; slices: Array<{ slice_id: string; result: string; task_id: string; blocked_by?: string[] }> }): string {
	const lines = [`# Initiative: ${plan.slug}`, ""];
	for (const slice of plan.slices) {
		lines.push(`## ${slice.slice_id}: ${slice.result}`, "", "Tasks:", "", `- ${slice.task_id}`, "");
		if (slice.blocked_by && slice.blocked_by.length > 0) lines.push(`Blocked by: ${slice.blocked_by.join(", ")}`, "");
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

/** The topmost ancestor directory of `path` that does not exist yet, deepest last. */
function missingAncestors(path: string): string[] {
	const missing: string[] = [];
	let dir = dirname(path);
	while (!existsSync(dir) && dirname(dir) !== dir) {
		missing.unshift(dir);
		dir = dirname(dir);
	}
	return missing;
}

/**
 * Author every slice's TaskIntent through the Kernel and write the Local carrier.
 * The digest covers the carrier and every authored intent, so re-shaping any of
 * them changes the identity a later approval would name.
 *
 * D3: all-or-nothing. The plan is validated before the first write; after that
 * every file this call creates (intents, carrier, new directories) is recorded and
 * removed again when any later step refuses, and a carrier it overwrote is
 * restored. A destination that already existed is never removed: the Kernel
 * refuses it with `destination_exists` and it is not recorded as created.
 */
export function shapeInitiative(
	plan: InitiativePlan,
	deps: { root: string; now: string; runKernel: LeaderDispatchDeps["runKernel"] },
): ShapedInitiative {
	const invalid = validateInitiativePlan(plan);
	if (invalid !== null) throw new Error(`shape_plan_failed: ${invalid}`);
	const createdFiles: string[] = [];
	const createdDirectories: string[] = [];
	let carrierBackup: { path: string; bytes: Buffer } | null = null;
	const rollback = (): void => {
		for (const file of createdFiles.reverse()) rmSync(file, { force: true });
		if (carrierBackup) writeFileSync(carrierBackup.path, carrierBackup.bytes, { mode: 0o644 });
		// Deepest first; a directory that still holds anything is not ours to remove.
		for (const directory of createdDirectories.reverse()) {
			try {
				rmdirSync(directory);
			} catch {}
		}
	};
	const noteCreated = (path: string, existedBefore: boolean, missing: string[]): void => {
		if (existedBefore || !existsSync(path)) return;
		createdFiles.push(path);
		createdDirectories.push(...missing.filter((directory) => !createdDirectories.includes(directory)));
	};
	try {
		const authored: Array<{ slice_id: string; result: string; blocked_by?: string[]; path: string; task_id: string; content_hash: string; risk: string }> = [];
		for (const slice of plan.slices) {
			const absolute = join(deps.root, slice.path);
			const existedBefore = existsSync(absolute);
			const missing = missingAncestors(absolute);
			const result = deps.runKernel({
				argv: ["intent", "author", slice.path, "--stdin", "--json"],
				cwd: deps.root,
				stdin: `${JSON.stringify(slice.intent, null, 2)}\n`,
			});
			noteCreated(absolute, existedBefore, missing);
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
		// D2: the leader names predecessors by slice id; the carrier's `Blocked by:`
		// line, which the drive and the batch plan read, names task ids.
		const taskIdBySlice = new Map(authored.map((slice) => [slice.slice_id, slice.task_id]));
		const carrier = renderLocalInitiativeCarrier({
			slug: plan.slug,
			slices: authored.map((slice) => ({
				slice_id: slice.slice_id,
				result: slice.result,
				task_id: slice.task_id,
				...(slice.blocked_by ? { blocked_by: slice.blocked_by.map((id) => taskIdBySlice.get(id) ?? id) } : {}),
			})),
		});
		const carrierPath = localInitiativePath(plan.slug);
		const path = join(deps.root, carrierPath);
		const carrierExisted = existsSync(path);
		if (carrierExisted) carrierBackup = { path, bytes: readFileSync(path) };
		const carrierMissing = missingAncestors(path);
		mkdirSync(dirname(path), { recursive: true });
		createdDirectories.push(...carrierMissing.filter((directory) => !createdDirectories.includes(directory)));
		writeFileSync(path, carrier, { mode: 0o644 });
		if (!carrierExisted) createdFiles.push(path);
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
	} catch (error) {
		rollback();
		throw error;
	}
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
	// D5.2: a paused or abandoned target yields no candidate from leader dispatch,
	// so every action but a note is refused before it can start anything.
	const gate = workItemGate(readWorkItem(deps.stateDir, item.target));
	if (gate) return reject(index, item, gate);
	// D3.1 lists next, priority, shape and dispatch; `resolve` is D4's replanning
	// contract (S4) and is guarded by the target's authority gates.
	switch (item.action) {
		case "resolve":
			return applyResolve(index, item, deps);
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

/** The subject a target is asked on: its Issue, its PR or its Lane task. */
export function resolveSubject(target: string): InteractionSubject {
	const issue = /^issue-(\d+)$/.exec(target);
	if (issue) return { issue: Number(issue[1]) };
	const pr = /^pr-(\d+)$/.exec(target);
	if (pr) return { pr: Number(pr[1]) };
	const lane = /^lane-(.+)$/.exec(target);
	return lane ? { task_id: lane[1]! } : {};
}

/**
 * D4.1-D4.3: `resume`, `release` and `replan` cross orchestration-level blockers
 * only. An authority-gated target accepts `ask_owner` alone, and the third
 * accepted round forces it (`replan_cap_reached`).
 */
async function applyResolve(
	index: number,
	item: Extract<LeaderProposalItem, { action: "resolve" }>,
	deps: LeaderDispatchDeps,
): Promise<LeaderItemResult> {
	const workItem = readWorkItem(deps.stateDir, item.target);
	if (!workItem) return reject(index, item, "work_item_unknown");
	if (workItem.state !== "escalated") return reject(index, item, `resolve_requires_escalated: ${workItem.state}`);
	let facts: ResolveFacts;
	try {
		facts = await deps.resolveFacts({ target: item.target, work_item: workItem });
	} catch (error) {
		return reject(index, item, `resolve_facts_unavailable: ${error instanceof Error ? error.message : String(error)}`);
	}

	if (item.kind === "ask_owner") {
		if (!item.context) return reject(index, item, "item_ask_owner_context_missing");
		if (deps.dry_run)
			return { index, target: item.target, action: "resolve", outcome: "accepted", reason: "dry_run", handler: null, session_id: null };
		const asked = await deps.askOwner({
			target: item.target,
			subject: resolveSubject(item.target),
			context: item.context,
			pending_literal_user: facts.pending_literal_user,
			pending_lane_entry_blocked: facts.pending_lane_entry_blocked ?? [],
		});
		if (asked.action === "failed") return reject(index, item, `owner_question_failed: ${asked.reason ?? "unknown"}`);
		return {
			index,
			target: item.target,
			action: "resolve",
			outcome: "accepted",
			reason: `owner question ${asked.action} ${asked.interaction_id}`,
			handler: null,
			session_id: null,
		};
	}

	const rounds = workItem.replan_rounds ?? 0;
	if (rounds >= REPLAN_CAP) return reject(index, item, "replan_cap_reached");
	const blockers = resolveBlockers(facts);
	if (blockers.length > 0)
		return reject(index, item, `authority_gated: ${blockers.join(", ")}; only ask_owner is accepted`);

	if (item.kind === "resume") {
		const resumed = deps.checkBatchResumable({ target: item.target, work_item: workItem });
		if (!resumed.resumed) return reject(index, item, `batch_resume_refused: ${resumed.reason}`);
		if (deps.dry_run)
			return { index, target: item.target, action: "resolve", outcome: "accepted", reason: "dry_run", handler: null, session_id: null };
		return countResolveRound(index, item, deps, workItem, "driving", rounds, `batch resumed: ${resumed.reason}`);
	}
	if (item.kind === "release") {
		if (deps.dry_run)
			return { index, target: item.target, action: "resolve", outcome: "accepted", reason: "dry_run", handler: null, session_id: null };
		return countResolveRound(index, item, deps, workItem, "triage", rounds, "released to triage");
	}

	// D4.2 (amended by loop-leader-review-fixes D1): `replan` starts no session. It
	// invalidates the item's plan and returns it to triage, so the existing plan
	// path produces the new plan, digest and (where required) approval.
	// Guards first, each refusing with zero side effects.
	if (facts.batch_state !== null) return reject(index, item, `replan_batch_active: ${facts.batch_state}`);
	const issueMatch = /^issue-(\d+)$/.exec(item.target);
	const issueNumber = issueMatch ? Number(issueMatch[1]) : null;
	const publication = issueNumber === null ? null : readPlanPublication(deps.stateDir, issueNumber);
	const drafts = inspectPlanDrafts(deps.root, workItem, publication);
	if (drafts.changed !== null) return reject(index, item, `replan_draft_changed: ${drafts.changed}`);
	if (deps.dry_run)
		return { index, target: item.target, action: "resolve", outcome: "accepted", reason: "dry_run", handler: null, session_id: null };
	try {
		// Drafts and the publication record go first and the work item last, so a
		// failure leaves the item escalated with its binding intact; every removal
		// is idempotent, so the next accepted replan retries it.
		for (const file of drafts.files) rmSync(file, { force: true });
		if (issueNumber !== null) removePlanPublication(deps.stateDir, issueNumber);
	} catch (error) {
		return reject(index, item, `replan_invalidation_failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	const invalidated: WorkItem = {
		...workItem,
		binding: { ...workItem.binding, plan_digest: null, task_ids: [], initiative_slug: null },
	};
	return countResolveRound(index, item, deps, invalidated, "triage", rounds, "plan invalidated; re-planning from triage");
}

/**
 * D1.2(c): the daemon-authored drafts of the prior plan. Each intent the
 * publication records, and the Initiative carrier a shape wrote, is listed for
 * removal only while it still matches what the daemon recorded; one that changed
 * is a user's or another session's edit and refuses the replan. An absent file
 * is already removed. A carrier with no publication to verify it against is
 * treated as changed.
 */
function inspectPlanDrafts(
	root: string,
	workItem: WorkItem,
	publication: LoopPlanPublication | null,
): { files: string[]; changed: string | null } {
	const files: string[] = [];
	if (publication) {
		const base = resolve(publication.worktree_path);
		for (const intent of publication.intents) {
			const absolute = resolve(base, intent.path);
			const escaped = relative(base, absolute).startsWith("..");
			if (escaped) return { files: [], changed: intent.path };
			if (!existsSync(absolute)) continue;
			let current: string | null = null;
			try {
				current = canonicalIntentHash(JSON.parse(readFileSync(absolute, "utf8")));
			} catch {}
			if (current !== intent.content_hash) return { files: [], changed: intent.path };
			files.push(absolute);
		}
	}
	const slug = workItem.binding.initiative_slug;
	if (slug) {
		const carrierPath = localInitiativePath(slug);
		const absolute = join(root, carrierPath);
		if (existsSync(absolute)) {
			const digest = publication
				? shortDigest(JSON.stringify({ slug, carrier: readFileSync(absolute, "utf8"), intents: publication.intents }))
				: null;
			if (digest === null || digest !== publication!.digest) return { files: [], changed: carrierPath };
			files.push(absolute);
		}
	}
	return { files, changed: null };
}

/** D4.3: an accepted round moves the item and increments `replan_rounds`. */
function countResolveRound(
	index: number,
	item: Extract<LeaderProposalItem, { action: "resolve" }>,
	deps: LeaderDispatchDeps,
	workItem: WorkItem,
	to: "driving" | "triage",
	rounds: number,
	reason: string,
): LeaderItemResult {
	const moved = advanceWorkItem(workItem, to, { reason: `${item.kind}: ${reason}`, now: deps.now });
	if (moved.refused) return reject(index, item, `illegal_transition: ${workItem.state} -> ${to}`);
	writeWorkItem(deps.stateDir, { ...moved.item, replan_rounds: rounds + 1 });
	return {
		index,
		target: item.target,
		action: "resolve",
		outcome: "accepted",
		reason: `${item.kind}: ${reason} (round ${rounds + 1}/${REPLAN_CAP})`,
		handler: null,
		session_id: null,
	};
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
	const inconsistent = validateInitiativePlan(plan);
	if (inconsistent !== null) return reject(index, item, `shape_plan_failed: ${inconsistent}`);
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
		return {
			index,
			target: item.target,
			action: "dispatch",
			outcome: "accepted",
			reason: outcome.reason,
			handler: null,
			session_id: session.session_id,
			session_started: true,
		};
	const failed = reject(index, item, `session_failed: ${outcome.reason}`);
	// The session ran and failed: the budget must see the attempt even though
	// nothing was achieved.
	failed.session_started = true;
	return failed;
}
