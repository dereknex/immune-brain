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
 * Invariants: no reply effect changes (ADR 0040 Decision 4); a projection failure
 * never blocks a local transition.
 * Side Effects: one interaction request and one waiting pointer.
 * Verification: `bun test tests/loop-leader-replan.test.ts`.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { readAnyBatchRunState, isLaneBatchRecord } from "../unattended/batch_state.ts";
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
	/** Pending `literal_user` requests on the subject, with the id `annotate` names. */
	pending_literal_user: Array<{ interaction_id: string; kind: InteractionKind }>;
	task_records: ResolveTaskFacts[];
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
	/** The GitHub comments the daemon observed this tick, when that channel owns the request. */
	comments?: ReadonlyArray<{ body: string }>;
}

/** D4.2: read the target's gates from local requests, observed comments and the Kernel. */
export async function collectResolveFacts(sources: ResolveFactSources): Promise<ResolveFacts> {
	const task_records: ResolveTaskFacts[] = [];
	for (const taskId of sources.task_ids) {
		let projection: ResolveProjection | null = null;
		try {
			projection = await sources.project(taskId);
		} catch {
			// An unreadable projection proves nothing: it leaves no blocker and no pass.
			projection = null;
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
		pending_literal_user: pendingLiteralUserRequests({
			subject: sources.subject,
			stateDir: sources.stateDir,
			...(sources.comments ? { comments: sources.comments } : {}),
		}),
		task_records,
	};
}

/**
 * D4.2: the batch record that owns a target, as `{batch_id, batch_state}`. A
 * batch is the target's when it names one of its task ids or its Initiative slug.
 */
export function batchStateForTarget(
	root: string,
	input: { task_ids: readonly string[]; initiative_slug?: string | null },
): { batch_id: string; batch_state: string } | null {
	const dir = join(root, ".imm", "state", "batches");
	if (!existsSync(dir)) return null;
	const wanted = new Set(input.task_ids);
	for (const file of readdirSync(dir).sort()) {
		if (!file.endsWith(".json")) continue;
		const batchId = file.slice(0, -".json".length);
		const record = readAnyBatchRunState(root, batchId);
		if (!record || !isLaneBatchRecord(record)) continue;
		const owns =
			(input.initiative_slug ? record.initiative_slug === input.initiative_slug : false) ||
			record.children.some((child) => wanted.has(child.task_id));
		if (owns) return { batch_id: batchId, batch_state: record.batch_state };
	}
	return null;
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
}

export interface AskOwnerResult {
	action: "annotated" | "posted" | "already_posted" | "failed";
	interaction_id: string;
	link?: string;
	reason?: string;
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
	const pending = deps.pending_literal_user.find(
		(entry) => entry.kind === "plan_approval" || entry.kind === "lane_decision",
	);
	// D4.6: one target waits on one question, so every other pointer it recorded
	// describes a superseded or retired request.
	clearWaitingPointersForTarget(deps.stateDir, deps.target, pending?.interaction_id);
	if (pending) {
		const annotated = await deps.channel.annotate(pending.interaction_id, input.context);
		if (annotated === "annotated") return { action: "annotated", interaction_id: pending.interaction_id };
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
