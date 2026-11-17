/**
 * Loop Daemon: `local` Interaction channel (S4)
 *
 * Implements D4 of docs/specs/loop-agent-scheduling.spec.md (BR-DEC-6,
 * BR-DEC-7) and docs/adr/0040-loop-interaction-protocol.md.
 *
 * The daemon writes one request file per `interaction_id` under
 * `.imm/state/loop/interactions/` (`0600`) and reads the answer back from
 * `<id>.answer.json`. Only the privileged `answer_loop_interaction` Host tool
 * writes an answer, and only after its native confirmation returned accept, so
 * an answer file carries a confirmation record the daemon requires: a file
 * without one is ignored. A `plan_approval` is answered by the user's own
 * `drive` entry (native Enrollment), never by the tool.
 *
 * Interface: `createLocalInteractionChannel`, the request/answer store
 * (`readLocalRequests`, `readLocalRequest`, `readLocalAnswer`,
 * `writeLocalAnswer`), `laneDecisionInteractionRequest`,
 * `applyLocalLaneDecisionAnswers`.
 * Invariants: an answer is applied only with a confirmation record, only to the
 * binding that holds now, and never to `plan_approval` or `notice`.
 * Side Effects: files under the daemon state directory, and the Lane through
 * `handleLaneDecisionReply`.
 * Verification: `bun test tests/loop-sched-interaction-local.test.ts`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LITERAL_USER_ACTOR_ID } from "../../kernel/actor_identity.ts";
import { readTaskRecordRaw } from "../../kernel/storage.ts";
import { findLaneRelayTarget } from "../../unattended/lane_decision.ts";
import type { relayLaneDecision } from "../../unattended/lane_decision.ts";
import type { LaneDecisionFacts } from "../../unattended/lane_decision.ts";
import {
	handleLaneDecisionReply,
	type DecisionRelayOutcome,
	type RelayInputFactory,
} from "../decision_relay.ts";
import { decisionId, type LoopDecisionRecord } from "../decision_record.ts";
import type { GuardFacts } from "../guards.ts";
import { LOOP_DECISION_RECORD_CONTRACT, type LoopLease } from "../types.ts";
import { clearWaitingPointer } from "../waiting.ts";
import {
	INTERACTION_REQUEST_CONTRACT,
	changedBindingFields,
	fitInteractionContext,
	interactionAuthority,
	isAdvisoryKind,
	bindingsMatch,
	sanitizeInteractionContext,
	subjectsMatch,
	type InteractionBinding,
	type InteractionChannel,
	type InteractionContext,
	type InteractionKind,
	type InteractionPollResult,
	type InteractionRequest,
} from "./protocol.ts";

export const LOCAL_ANSWER_CONTRACT = "immune_brain/interaction_answer/v1";
export const ANSWER_LOOP_INTERACTION_TOOL = "answer_loop_interaction";

/** The daemon's state directory under a checkout root; `--state-dir` may override it. */
export function loopInteractionStateDir(root: string): string {
	return join(root, ".imm/state/loop");
}

export function localInteractionsDir(stateDir: string): string {
	return join(stateDir, "interactions");
}

function requestPath(stateDir: string, interactionId: string): string {
	return join(localInteractionsDir(stateDir), `${fileName(interactionId)}.json`);
}

function answerPath(stateDir: string, interactionId: string): string {
	return join(localInteractionsDir(stateDir), `${fileName(interactionId)}.answer.json`);
}

/** An interaction id is a file name; anything a path could escape is refused. */
function fileName(interactionId: string): string {
	if (!interactionId || /[/\\]/.test(interactionId) || interactionId.startsWith("."))
		throw new Error(`interaction_id_invalid: ${interactionId} is not a local request file name`);
	return interactionId;
}

/** The request file is the posting record, exactly as the comment is for `github`. */
export interface LocalInteractionRecord extends InteractionRequest {
	posted_at: string;
}

/** Written only by `answer_loop_interaction`, after its native confirmation returned accept. */
export interface LocalInteractionAnswer {
	contract: typeof LOCAL_ANSWER_CONTRACT;
	interaction_id: string;
	kind: InteractionKind;
	subject: InteractionRequest["subject"];
	binding: InteractionBinding;
	value: string;
	actor: typeof LITERAL_USER_ACTOR_ID;
	confirmation: { tool: typeof ANSWER_LOOP_INTERACTION_TOOL; confirmed_at: string; confirmation_ref: string | null };
	answered_at: string;
}

function readJson<T>(path: string): T | null {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return null;
	}
}

export function readLocalRequest(stateDir: string, interactionId: string): LocalInteractionRecord | null {
	const record = readJson<LocalInteractionRecord>(requestPath(stateDir, interactionId));
	if (!record || record.contract !== INTERACTION_REQUEST_CONTRACT || record.interaction_id !== interactionId) return null;
	return record;
}

/** Every request the daemon posted and has not retired, oldest first. */
export function readLocalRequests(stateDir: string): LocalInteractionRecord[] {
	const dir = localInteractionsDir(stateDir);
	if (!existsSync(dir)) return [];
	const records: LocalInteractionRecord[] = [];
	for (const entry of readdirSync(dir).sort()) {
		if (!entry.endsWith(".json") || entry.endsWith(".answer.json")) continue;
		const id = entry.slice(0, -".json".length);
		const record = readLocalRequest(stateDir, id);
		if (record) records.push(record);
	}
	return records;
}

/** The answer, only when it carries the privileged tool's confirmation record. */
export function readLocalAnswer(stateDir: string, interactionId: string): LocalInteractionAnswer | null {
	const answer = readJson<LocalInteractionAnswer>(answerPath(stateDir, interactionId));
	if (!answer || answer.contract !== LOCAL_ANSWER_CONTRACT || answer.interaction_id !== interactionId) return null;
	if (answer.confirmation?.tool !== ANSWER_LOOP_INTERACTION_TOOL || typeof answer.confirmation.confirmed_at !== "string")
		return null;
	if (answer.actor !== LITERAL_USER_ACTOR_ID || typeof answer.value !== "string") return null;
	return answer;
}

export function writeLocalRequest(stateDir: string, request: InteractionRequest, now = new Date().toISOString()): LocalInteractionRecord {
	const record: LocalInteractionRecord = { ...request, posted_at: now };
	mkdirSync(localInteractionsDir(stateDir), { recursive: true, mode: 0o700 });
	writeFileSync(requestPath(stateDir, request.interaction_id), `${JSON.stringify(record, null, 2)}\n`, {
		mode: 0o600,
	});
	return record;
}

/**
 * Records one answer. Only the privileged tool may call this, and only once its
 * native confirmation returned accept: the confirmation record is what the
 * daemon requires before it treats the file as an answer.
 */
export function writeLocalAnswer(
	stateDir: string,
	answer: Omit<LocalInteractionAnswer, "contract" | "actor" | "answered_at">,
	now = new Date().toISOString(),
): LocalInteractionAnswer {
	const value: LocalInteractionAnswer = { contract: LOCAL_ANSWER_CONTRACT, actor: LITERAL_USER_ACTOR_ID, answered_at: now, ...answer };
	mkdirSync(localInteractionsDir(stateDir), { recursive: true, mode: 0o700 });
	writeFileSync(answerPath(stateDir, value.interaction_id), `${JSON.stringify(value, null, 2)}\n`, {
		mode: 0o600,
	});
	return value;
}

/** Retires one request: a retired request is no longer pending and its answer is never applied. */
export function retireLocalRequest(stateDir: string, interactionId: string): void {
	rmSync(requestPath(stateDir, interactionId), { force: true });
	rmSync(answerPath(stateDir, interactionId), { force: true });
	// D4.6: a retired request is no longer something the owner is awaited on.
	clearWaitingPointer(stateDir, interactionId);
}

export interface LocalInteractionChannelDeps {
	/** The daemon state directory (`<root>/.imm/state/loop` by default). */
	stateDir: string;
	/** The binding that holds now; a request bound to another one is stale. Omitted: no staleness check. */
	binding?: () => InteractionBinding;
	now?: () => string;
}

export function createLocalInteractionChannel(deps: LocalInteractionChannelDeps): InteractionChannel {
	const now = () => (deps.now ?? (() => new Date().toISOString()))();
	/** D4.4: a stored pack is sanitized and bounded, exactly like a rendered one. */
	const storedContext = (context: InteractionContext | undefined) =>
		context === undefined ? undefined : fitInteractionContext(sanitizeInteractionContext(context)).context;
	/**
	 * D4.5: one pending advisory question per subject and binding. The new request
	 * retires the older local request; a `literal_user` request is never touched.
	 */
	const supersedeAdvisory = (req: InteractionRequest): void => {
		if (!isAdvisoryKind(req.kind)) return;
		for (const existing of readLocalRequests(deps.stateDir)) {
			if (existing.interaction_id === req.interaction_id || !isAdvisoryKind(existing.kind)) continue;
			if (!subjectsMatch(existing.subject, req.subject) || !bindingsMatch(existing.binding, req.binding)) continue;
			retireLocalRequest(deps.stateDir, existing.interaction_id);
		}
	};
	return {
		id: "local",

		accepts(req: InteractionRequest): boolean {
			// D4: `plan_approval` is the user's own `drive` entry on the published
			// TaskIntent, and a notice is never answered at all.
			return req.kind !== "plan_approval" && req.kind !== "notice";
		},

		async post(req: InteractionRequest): Promise<"posted" | "already_posted" | "notice_only"> {
			if (req.contract !== INTERACTION_REQUEST_CONTRACT)
				throw new Error(`interaction_contract_invalid: ${req.interaction_id} carries ${req.contract}`);
			if (req.kind === "lane_decision" && !(req.binding.record_revision && req.subject.run_id))
				throw new Error(
					`interaction_binding_required: ${req.interaction_id} lane_decision needs a record_revision and a run_id`,
				);
			if (readLocalRequest(deps.stateDir, req.interaction_id)) return "already_posted";
			const context = storedContext(req.context);
			supersedeAdvisory(req);
			writeLocalRequest(deps.stateDir, context === undefined ? req : { ...req, context }, now());
			return this.accepts(req) ? "posted" : "notice_only";
		},

		async poll(interactionId: string): Promise<InteractionPollResult> {
			const request = readLocalRequest(deps.stateDir, interactionId);
			if (!request) return { state: "withdrawn" };
			const binding = deps.binding?.();
			if (binding && changedBindingFields(request.binding, binding) !== "") {
				retireLocalRequest(deps.stateDir, interactionId);
				return { state: "stale" };
			}
			const answer = readLocalAnswer(deps.stateDir, interactionId);
			if (!answer) return { state: "pending" };
			if (changedBindingFields(answer.binding, binding ?? request.binding) !== "") {
				retireLocalRequest(deps.stateDir, interactionId);
				return { state: "stale" };
			}
			return {
				state: "answered",
				value: answer.value,
				actor: answer.actor,
				provenance: `local:answer:${interactionId}`,
			};
		},

		async withdraw(interactionId: string): Promise<void> {
			retireLocalRequest(deps.stateDir, interactionId);
		},

		async annotate(interactionId: string, context: InteractionContext): Promise<"annotated" | "absent"> {
			const request = readLocalRequest(deps.stateDir, interactionId);
			if (!request) return "absent";
			const fitted = fitInteractionContext(sanitizeInteractionContext(context)).context;
			// The rewrite keeps `interaction_id`, kind, binding and answer semantics.
			writeLocalRequest(deps.stateDir, { ...request, context: fitted }, request.posted_at);
			return "annotated";
		},

		link(interactionId: string): string | null {
			return requestPath(deps.stateDir, interactionId);
		},
	};
}

export interface LaneDecisionQuestionFacts {
	task_id: string;
	run_id: string;
	record_revision: string;
	question: string;
	options?: ReadonlyArray<{ id: string; label: string }>;
	issue_number?: number;
}

/**
 * The `lane_decision` request of one E6. The idempotency key is the (run,
 * revision) the question binds, so a tick that observes the same decision posts
 * nothing new.
 */
export function laneDecisionInteractionRequest(facts: LaneDecisionQuestionFacts): InteractionRequest {
	return {
		contract: INTERACTION_REQUEST_CONTRACT,
		interaction_id: `lane-decision:${facts.run_id}:${facts.record_revision}`,
		kind: "lane_decision",
		subject: {
			task_id: facts.task_id,
			run_id: facts.run_id,
			...(facts.issue_number === undefined ? {} : { issue: facts.issue_number }),
		},
		binding: { record_revision: facts.record_revision },
		prompt: facts.question,
		...(facts.options && facts.options.length > 0 ? { options: facts.options.map((option) => option.id) } : {}),
		answer: "choice",
		authority: interactionAuthority("lane_decision"),
	};
}

/**
 * The store that owns a request's `record_revision`: the single-task Lane that
 * owns the task when there is one, else this checkout. A Lane's decision is
 * bound to the Lane's TaskRecord, so reading the checkout's record instead would
 * refuse every real Lane decision as stale.
 */
export function localDecisionAuthorityRoot(root: string, taskId: string): string {
	return findLaneRelayTarget(root, taskId)?.lane_path ?? root;
}

/** The record revision the owner of this task holds now; null when unreadable. */
export function localDecisionRecordRevision(root: string, taskId: string): string | null {
	const revision = readTaskRecordRaw(localDecisionAuthorityRoot(root, taskId), taskId).revision;
	return revision && revision !== "missing" ? revision : null;
}

/** One applied local answer, as the tick reports it. */
export interface LocalAnswerOutcome {
	interaction_id: string;
	task_id: string;
	action: "relayed" | "ignored" | "rejected_stale" | "awaiting_relay";
	reason?: string;
	relay?: DecisionRelayOutcome;
}

export interface LocalAnswerDeps {
	stateDir: string;
	guardFacts: GuardFacts;
	/** The record revision that holds now for a task, from the store that owns it; null when unreadable. */
	recordRevision: (taskId: string) => string | null;
	/** The relay input of one task, when this process can relay a Lane decision at all. */
	relayInputFactory?: (taskId: string) => RelayInputFactory<unknown> | undefined;
	relayDecision?: typeof relayLaneDecision;
	resumeLease?: (targetId: string) => LoopLease | null;
	hostToken?: string;
}

/**
 * Applies every answered local `lane_decision` through the same verifier and
 * relay a GitHub reply uses. The answer already carried the Host's native
 * confirmation (D4), so the literal user is its verified actor.
 */
export async function applyLocalLaneDecisionAnswers(deps: LocalAnswerDeps): Promise<LocalAnswerOutcome[]> {
	const outcomes: LocalAnswerOutcome[] = [];
	for (const request of readLocalRequests(deps.stateDir)) {
		if (request.kind !== "lane_decision" || !request.subject.task_id) continue;
		const taskId = request.subject.task_id;
		// The relay re-projects the Lane and enforces `expectedRecordRevision`
		// itself, so an unreadable revision here cannot apply a stale answer.
		const channel = createLocalInteractionChannel({
			stateDir: deps.stateDir,
			binding: () => ({ record_revision: deps.recordRevision(taskId) ?? request.binding.record_revision }),
		});
		const polled = await channel.poll(request.interaction_id);
		if (polled.state === "pending" || polled.state === "withdrawn") continue;
		if (polled.state === "stale") {
			outcomes.push({
				interaction_id: request.interaction_id,
				task_id: taskId,
				action: "rejected_stale",
				reason: "the request was bound to a record revision that has since changed",
			});
			continue;
		}
		const relayInputFactory = deps.relayInputFactory?.(taskId);
		if (!relayInputFactory) {
			// The answer stays on disk: the next tick of a process that can relay applies it.
			outcomes.push({
				interaction_id: request.interaction_id,
				task_id: taskId,
				action: "awaiting_relay",
				reason: "this daemon has no Lane runtime to relay the decision",
			});
			continue;
		}
		const facts: LaneDecisionFacts = {
			task_id: taskId,
			run_id: request.subject.run_id ?? null,
			record_revision: request.binding.record_revision ?? "",
			authorization: { state: "none", blocked: null },
			open_user_decision_count: 0,
			replan_required_ids: [],
			...(request.options && request.options.length > 0
				? { options: request.options.map((id) => ({ id, label: id })) }
				: {}),
		};
		const outcome = await handleLaneDecisionReply(
			{
				issue_number: request.subject.issue ?? 0,
				comment_id: 0,
				author: LITERAL_USER_ACTOR_ID,
				author_association: "OWNER",
				run_id: request.subject.run_id,
				record_revision: request.binding.record_revision,
				selected_option: polled.value,
				reply_body: polled.value,
			},
			facts,
			{
				stateDir: deps.stateDir,
				...(deps.hostToken ? { hostToken: deps.hostToken } : {}),
				...(deps.resumeLease ? { resumeLease: deps.resumeLease } : {}),
				// The local answer is the literal user's own: its native confirmation
				// is the proof a GitHub comment cannot carry (ADR 0040 Decision 4).
				guardFacts: { ...deps.guardFacts, allowed_actors: [LITERAL_USER_ACTOR_ID] },
				...(deps.relayDecision ? { relayDecision: deps.relayDecision } : {}),
			},
			relayInputFactory,
		);
		// One answer is consumed once: an applied or unusable answer is retired so
		// the next tick cannot relay it again.
		if (outcome.action === "relayed" || outcome.action === "ignored")
			retireLocalRequest(deps.stateDir, request.interaction_id);
		outcomes.push({
			interaction_id: request.interaction_id,
			task_id: taskId,
			action: outcome.action === "relayed" ? "relayed" : outcome.action,
			...(outcome.reason ? { reason: outcome.reason } : {}),
			relay: outcome,
		});
	}
	return outcomes;
}

/**
 * D8 with the `local` channel: an Issue waiting on its clarify question resumes
 * when the user answered the request in their own Host. Each answered request
 * becomes one `apply_clarify_reply` decision on the Issue; the handler polls
 * the answer through the channel, so a stale or unconfirmed file resumes
 * nothing. `pending` is the Issue → interaction map the work items hold.
 */
export function localClarifyAnswerDecisions(
	stateDir: string,
	pending: Readonly<Record<number, string>>,
	options: { recorded_at: string; dry_run: boolean },
): LoopDecisionRecord[] {
	const decisions: LoopDecisionRecord[] = [];
	for (const [issue, interactionId] of Object.entries(pending)) {
		const request = readLocalRequest(stateDir, interactionId);
		if (!request || request.kind !== "clarify_question" || !readLocalAnswer(stateDir, interactionId)) continue;
		const eventId = `local-interaction:${interactionId}`;
		decisions.push({
			contract: LOOP_DECISION_RECORD_CONTRACT,
			decision_id: decisionId(eventId, "apply_clarify_reply", 0),
			recorded_at: options.recorded_at,
			event_id: eventId,
			event_kind: "E3_OWNER_COMMENT",
			target: { kind: "issue", id: issue },
			tier: 0,
			handler: "apply_clarify_reply",
			reason: `issue #${issue} clarify ${interactionId} answered in the local Host`,
			guard: null,
			classification: null,
			dry_run: options.dry_run,
			mutations: [],
		});
	}
	return decisions;
}
