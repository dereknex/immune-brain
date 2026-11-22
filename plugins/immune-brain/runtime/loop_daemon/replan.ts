/**
 * Loop Daemon: Replanning and In-Context Questions (S4)
 *
 * Implements D4.1-D4.3 and D4.5-D4.6 of docs/specs/loop-leader.spec.md
 * (BR-REQ-4, BR-REQ-5, BR-DEC-3, BR-DEC-10). `resume`, `release` and `replan`
 * may only cross orchestration-level blockers: a pending `material`/`critical`
 * approval, a breaking Intent revision, an open user decision, a parked batch or
 * a pending `literal_user` request accept `ask_owner` and nothing else. Each
 * accepted round counts against the per-item replan cap, so a blocker that
 * survives three rounds ends with the owner instead of looping until the daily
 * wake budget resets.
 *
 * `askOwnerQuestion` asks on the subject itself: an existing `literal_user`
 * request is annotated in place (never withdrawn), otherwise one advisory
 * question carrying the context pack is posted and its pointer recorded.
 *
 * Interface: `REPLAN_CAP`, `resolveBlockers`, `collectResolveFacts`,
 * `askOwnerQuestion`, `ownerQuestionRequest`, `pendingLiteralUserRequests`.
 * Invariants: no reply effect changes (ADR 0040 Decision 4); an unreadable
 * Kernel projection fails closed as an authority blocker (only `ask_owner` is
 * accepted), while a failed owner-question post never blocks a local transition.
 * Side Effects: one interaction request and one waiting pointer.
 * Verification: `bun test tests/loop-leader-replan.test.ts`.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { findActiveLaneBatchForTask } from "../unattended/batch_preflight.ts";
import { readAnyBatchRunState, isLaneBatchRecord, isTerminalBatchState } from "../unattended/batch_state.ts";
import { readLocalRequests } from "./interaction/local_channel.ts";
import { isWithdrawn, parseInteractionMarker } from "./interaction/github_channel.ts";
import {
	INTERACTION_REQUEST_CONTRACT,
	interactionAuthority,
	sanitizeContextText,
	subjectsMatch,
	type InteractionChannel,
	type InteractionContext,
	type InteractionKind,
	type InteractionRequest,
	type InteractionSubject,
} from "./interaction/protocol.ts";
import { LANE_ENTRY_BLOCKED_ID_PREFIX } from "./escalation.ts";
import { recordWaitingPointer, clearWaitingPointersForTarget } from "./waiting.ts";

/** D4.3: at three accepted rounds the item is forced to `ask_owner`. */
export const REPLAN_CAP = 3;

/** What one bound task's Kernel projection says about its authority gates. */
export interface ResolveTaskFacts {
	task_id: string;
	risk: string;
	open_user_decision_count: number;
	unresolved_user_decision_ids: string[];
	replan_required_ids: string[];
	authorization_state: string;
	next_obligation: string;
}

/** The facts a `resolve` item is guarded by. */
export interface ResolveFacts {
	/** The batch record state that owns the target, when one does. */
	batch_state: string | null;
	/** ULS D5.1: children of that batch parked `lane_executor_no_progress`; only the owner resumes them. */
	no_progress_children?: string[];
	/** ULS D5.2: Lane-dialog escalations the subject already holds, annotated rather than asked again. */
	pending_lane_entry_blocked?: Array<{ interaction_id: string }>;
	/** Pending `literal_user` requests on the subject, with the id `annotate` names. */
	pending_literal_user: Array<{ interaction_id: string; kind: InteractionKind }>;
	task_records: ResolveTaskFacts[];
	/** Bound tasks whose Kernel projection failed to read; treated fail-closed as blockers. */
	unreadable_task_projections?: Array<{ task_id: string; reason: string }>;
}

/**
 * D4.2: the authority-gated blockers of one target. A non-empty result means
 * only `ask_owner` is accepted; every other kind is rejected with these names.
 */
export function resolveBlockers(facts: ResolveFacts): string[] {
	const blockers: string[] = [];
	for (const entry of facts.pending_literal_user) blockers.push(`pending_${entry.kind}`);
	// A parked batch leaves `needs_human` only through a fresh Batch Authorization.
	if (facts.batch_state === "needs_human") blockers.push("batch_parked");
	// ULS D5.1: a stalled Executor resumes through a fresh drive entry, never a leader `resume`.
	for (const taskId of facts.no_progress_children ?? []) blockers.push(`lane_executor_no_progress:${taskId}`);
	// ULS D5.2: an unanswered Lane dialog is the owner's question already.
	if ((facts.pending_lane_entry_blocked ?? []).length > 0) blockers.push("pending_lane_entry_blocked");
	for (const unreadable of facts.unreadable_task_projections ?? []) {
		blockers.push(`kernel_projection_unreadable:${unreadable.task_id}`);
	}
	for (const record of facts.task_records) {
		if (record.open_user_decision_count > 0) blockers.push(`open_user_decision:${record.task_id}`);
		if (record.unresolved_user_decision_ids.length > 0) blockers.push(`unresolved_user_decision:${record.task_id}`);
		if (record.replan_required_ids.length > 0) blockers.push(`breaking_intent_revision:${record.task_id}`);
		const authorityGate = record.authorization_state !== "none" || record.next_obligation === "awaiting_user";
		if (authorityGate && (record.risk === "material" || record.risk === "critical"))
			blockers.push(`pending_${record.risk}_approval:${record.task_id}`);
	}
	return blockers;
}

/** One Kernel projection, reduced to what a `resolve` guard reads. */
export interface ResolveProjection {
	risk: string;
	open_user_decision_count: number;
	unresolved_user_decision_ids: string[];
	replan_required_ids: string[];
	authorization: { state: string };
	next_obligation: string;
}

export interface ResolveFactSources {
	stateDir: string;
	target: string;
	subject: InteractionSubject;
	/** Every bound task id of the target. */
	task_ids: readonly string[];
	/** The Kernel projection of one task, or null when it has none. */
	project: (taskId: string) => Promise<ResolveProjection | null>;
	/** The batch state that owns the target, or null when no batch does. */
	batchState: (target: string) => string | null;
	/** ULS D5.1: the task ids of that batch's children parked `lane_executor_no_progress`. */
	noProgressChildren?: (target: string) => string[];
	/**
	 * ULS D5.2: the task ids of that batch's children still held for the owner. A
	 * `lane_entry_blocked` comment counts as pending only while one remains, so an
	 * answered dialog never blocks a later resolve.
	 */
	heldChildren?: (target: string) => string[];
	/** The GitHub comments the daemon observed this tick, when that channel owns the request. */
	comments?: ReadonlyArray<{ body: string }>;
}

/** D4.2: read the target's gates from local requests, observed comments and the Kernel. */
export async function collectResolveFacts(sources: ResolveFactSources): Promise<ResolveFacts> {
	const task_records: ResolveTaskFacts[] = [];
	const unreadable_task_projections: Array<{ task_id: string; reason: string }> = [];
	for (const taskId of sources.task_ids) {
		let projection: ResolveProjection | null = null;
		try {
			projection = await sources.project(taskId);
		} catch (error) {
			// Fail closed: an unreadable Kernel projection cannot clear authority gates,
			// so only `ask_owner` remains admissible until the projection is readable.
			unreadable_task_projections.push({
				task_id: taskId,
				reason: error instanceof Error ? error.message : String(error),
			});
			continue;
		}
		if (!projection) continue;
		task_records.push({
			task_id: taskId,
			risk: projection.risk,
			open_user_decision_count: projection.open_user_decision_count,
			unresolved_user_decision_ids: [...projection.unresolved_user_decision_ids],
			replan_required_ids: [...projection.replan_required_ids],
			authorization_state: projection.authorization.state,
			next_obligation: projection.next_obligation,
		});
	}
	return {
		batch_state: sources.batchState(sources.target),
		...(sources.noProgressChildren ? { no_progress_children: sources.noProgressChildren(sources.target) } : {}),
		pending_literal_user: pendingLiteralUserRequests({
			subject: sources.subject,
			stateDir: sources.stateDir,
			...(sources.comments ? { comments: sources.comments } : {}),
		}),
		pending_lane_entry_blocked:
			sources.heldChildren && sources.heldChildren(sources.target).length === 0
				? []
				: pendingLaneEntryBlocked({ subject: sources.subject, comments: sources.comments ?? [] }),
		task_records,
		...(unreadable_task_projections.length > 0 ? { unreadable_task_projections } : {}),
	};
}

/**
 * D4.2 / ULS D5.4: the active batch that owns a target, as
 * `{batch_id, batch_state, no_progress_children}`. Each bound task resolves
 * through `findActiveLaneBatchForTask`, which throws on an unreadable record or on
 * two active batches claiming one task, so an ambiguous target refuses instead of
 * taking the first file. Two tasks of one target that resolve to different
 * batches refuse the same way. A target named only by its Initiative slug falls
 * back to a slug scan with the same fail-closed rule.
 */
export function batchStateForTarget(
	root: string,
	input: { task_ids: readonly string[]; initiative_slug?: string | null },
): { batch_id: string; batch_state: string; no_progress_children: string[] } | null {
	const found = new Map<string, { batch_id: string; batch_state: string; no_progress_children: string[] }>();
	const remember = (record: { batch_id: string; batch_state: string; children: ReadonlyArray<{ task_id: string; state: string; reason: string | null }> }) =>
		found.set(record.batch_id, {
			batch_id: record.batch_id,
			batch_state: record.batch_state,
			no_progress_children: record.children
				.filter((child) => child.state === "needs_human" && (child.reason ?? "").startsWith("lane_executor_no_progress"))
				.map((child) => child.task_id)
				.sort(),
		});
	for (const taskId of [...new Set(input.task_ids)].sort()) {
		const active = findActiveLaneBatchForTask(root, taskId);
		if (active) remember(active.record);
	}
	if (found.size === 0 && input.initiative_slug) {
		const dir = join(root, ".imm", "state", "batches");
		if (existsSync(dir)) {
			for (const file of readdirSync(dir).sort()) {
				if (!file.endsWith(".json") || file.endsWith(".report.json")) continue;
				const record = readAnyBatchRunState(root, file.slice(0, -".json".length));
				if (!record || !isLaneBatchRecord(record) || record.initiative_slug !== input.initiative_slug) continue;
				if (isTerminalBatchState(record.batch_state)) continue;
				remember(record);
			}
		}
	}
	if (found.size > 1) throw new Error(`batch_lane_ambiguous: ${[...found.keys()].sort().join(", ")}`);
	return [...found.values()][0] ?? null;
}

/** ULS D5.2: the unwithdrawn `lane_entry_blocked` escalations one subject already holds. */
export function pendingLaneEntryBlocked(input: {
	subject: InteractionSubject;
	comments: ReadonlyArray<{ body: string }>;
}): Array<{ interaction_id: string }> {
	const found = new Set<string>();
	for (const comment of input.comments) {
		if (isWithdrawn(comment.body)) continue;
		const marker = parseInteractionMarker(comment.body);
		if (!marker || !marker.interaction_id.startsWith(LANE_ENTRY_BLOCKED_ID_PREFIX)) continue;
		if (subjectsMatch(marker.subject, input.subject)) found.add(marker.interaction_id);
	}
	return [...found].sort().map((interaction_id) => ({ interaction_id }));
}

/** D4.2: the pending `literal_user` requests one subject already holds. */
export function pendingLiteralUserRequests(input: {
	subject: InteractionSubject;
	stateDir: string;
	comments?: ReadonlyArray<{ body: string }>;
}): Array<{ interaction_id: string; kind: InteractionKind }> {
	const found = new Map<string, InteractionKind>();
	const literalUser = (kind: InteractionKind) => kind === "plan_approval" || kind === "lane_decision";
	for (const request of readLocalRequests(input.stateDir)) {
		if (!literalUser(request.kind)) continue;
		if (subjectsMatch(request.subject, input.subject)) found.set(request.interaction_id, request.kind);
	}
	for (const comment of input.comments ?? []) {
		if (isWithdrawn(comment.body)) continue;
		const marker = parseInteractionMarker(comment.body);
		if (!marker || !literalUser(marker.kind)) continue;
		if (subjectsMatch(marker.subject, input.subject)) found.set(marker.interaction_id, marker.kind);
	}
	return [...found.entries()]
		.map(([interaction_id, kind]) => ({ interaction_id, kind }))
		.sort((left, right) => (left.interaction_id < right.interaction_id ? -1 : left.interaction_id > right.interaction_id ? 1 : 0));
}

/** The advisory question one `ask_owner` posts: the pack is its whole explanation. */
export function ownerQuestionRequest(input: {
	target: string;
	subject: InteractionSubject;
	context: InteractionContext;
}): InteractionRequest {
	return {
		contract: INTERACTION_REQUEST_CONTRACT,
		interaction_id: ownerQuestionInteractionId(input.target, input.context),
		kind: "escalation",
		subject: input.subject,
		binding: {},
		prompt: sanitizeContextText(input.context.blocked_on),
		...(input.context.options.length > 0 ? { options: input.context.options.map((option) => option.id) } : {}),
		context: input.context,
		answer: "none",
		authority: interactionAuthority("escalation"),
	};
}

export function ownerQuestionInteractionId(target: string, context: InteractionContext): string {
	const digest = createHash("sha256").update(`${target}\n${JSON.stringify(context)}`).digest("hex");
	return `ask-owner:${target}:${digest.slice(0, 12)}`;
}

export interface AskOwnerDeps {
	stateDir: string;
	now: string;
	target: string;
	channel: InteractionChannel;
	/** The `literal_user` requests the subject already waits on (D4.5). */
	pending_literal_user: ReadonlyArray<{ interaction_id: string; kind: InteractionKind }>;
	/** ULS D5.2: the Lane dialog the daemon already escalated on the subject; annotated like a pending request. */
	pending_lane_entry_blocked?: ReadonlyArray<{ interaction_id: string }>;
}

export interface AskOwnerResult {
	action: "annotated" | "posted" | "already_posted" | "failed";
	interaction_id: string;
	link?: string;
	reason?: string;
}

/** The kind of the pending request an annotation targets: a Lane dialog escalation unless a literal_user entry names it. */
function pendingKind(deps: AskOwnerDeps, interactionId: string): InteractionKind {
	return deps.pending_literal_user.find((entry) => entry.interaction_id === interactionId)?.kind ?? "escalation";
}

/**
 * D4.5: annotate a pending `literal_user` request in place, else post one
 * advisory question carrying the pack. A failed post is reported, never thrown:
 * a projection failure must not block the local transition it describes.
 */
export async function askOwnerQuestion(
	deps: AskOwnerDeps,
	input: { subject: InteractionSubject; context: InteractionContext },
): Promise<AskOwnerResult> {
	const pending =
		deps.pending_literal_user.find((entry) => entry.kind === "plan_approval" || entry.kind === "lane_decision") ??
		deps.pending_lane_entry_blocked?.[0];
	// D4.6: one target waits on one question, so every other pointer it recorded
	// describes a superseded or retired request.
	clearWaitingPointersForTarget(deps.stateDir, deps.target, pending?.interaction_id);
	if (pending) {
		const annotated = await deps.channel.annotate(pending.interaction_id, input.context);
		if (annotated === "annotated") {
			// The annotated request is the owner's question now, so the target waits on
			// it: record its pointer exactly as the post branch does (a null link
			// records nothing).
			const annotatedLink = deps.channel.link(pending.interaction_id, input.subject);
			if (annotatedLink !== null) {
				recordWaitingPointer(deps.stateDir, {
					interaction_id: pending.interaction_id,
					target: deps.target,
					kind: pendingKind(deps, pending.interaction_id),
					channel: deps.channel.id,
					link: annotatedLink,
					recorded_at: deps.now,
				});
			}
			return {
				action: "annotated",
				interaction_id: pending.interaction_id,
				...(annotatedLink === null ? {} : { link: annotatedLink }),
			};
		}
	}
	const request = ownerQuestionRequest({ target: deps.target, subject: input.subject, context: input.context });
	try {
		const posted = await deps.channel.post(request);
		const link = deps.channel.link(request.interaction_id, request.subject);
		if (link !== null) {
			recordWaitingPointer(deps.stateDir, {
				interaction_id: request.interaction_id,
				target: deps.target,
				kind: request.kind,
				channel: deps.channel.id,
				link,
				recorded_at: deps.now,
			});
		}
		return {
			action: posted === "already_posted" ? "already_posted" : "posted",
			interaction_id: request.interaction_id,
			...(link === null ? {} : { link }),
		};
	} catch (error) {
		return {
			action: "failed",
			interaction_id: request.interaction_id,
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}
