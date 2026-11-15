/**
 * Loop Daemon: Interaction protocol (S3)
 *
 * Implements D3 of docs/specs/loop-agent-scheduling.spec.md (BR-DEC-6,
 * BR-DEC-8, BR-DEC-10) and docs/adr/0040-loop-interaction-protocol.md.
 *
 * One request shape and one channel interface for every question the daemon
 * asks a person. A channel decides whether it may apply an answer
 * (`accepts`), posts one marker comment per `interaction_id`, reads the answer
 * back (`poll`) and retires a request whose binding moved (`withdraw`). The
 * `github` channel applies only the literal-user decisions ADR 0039 Decisions 9
 * and 12 already grant; everything else is a notice.
 */

import { createHash } from "node:crypto";

export const INTERACTION_REQUEST_CONTRACT = "immune_brain/interaction_request/v1";

export type InteractionKind =
	| "clarify_question"
	| "plan_approval"
	| "lane_decision"
	| "escalation"
	| "notice";

export type InteractionAuthority = "advisory" | "literal_user";

export type InteractionAnswer = "none" | "choice" | "free_text" | "approve_digest";

export interface InteractionSubject {
	issue?: number;
	pr?: number;
	task_id?: string;
	run_id?: string;
}

/** What the question is bound to; a change in any field retires the request. */
export interface InteractionBinding {
	plan_digest?: string;
	record_revision?: string;
	issue_revision?: string;
}

export interface InteractionRequest {
	contract: "immune_brain/interaction_request/v1";
	/** Idempotency key: one marker comment per interaction_id. */
	interaction_id: string;
	kind: InteractionKind;
	subject: InteractionSubject;
	binding: InteractionBinding;
	prompt: string;
	options?: string[];
	answer: InteractionAnswer;
	authority: InteractionAuthority;
}

export type InteractionPollResult =
	| { state: "pending" }
	| { state: "answered"; value: string; actor: string; provenance: string }
	| { state: "stale" }
	| { state: "withdrawn" };

export interface InteractionChannel {
	readonly id: "github" | "local";
	/** May this channel apply an answer to the request at all? */
	accepts(req: InteractionRequest): boolean;
	post(req: InteractionRequest): Promise<"posted" | "already_posted" | "notice_only">;
	poll(interaction_id: string): Promise<InteractionPollResult>;
	withdraw(interaction_id: string): Promise<void>;
}

/** D3 authority table: only the two literal-user decisions carry an answer that is applied. */
export function interactionAuthority(kind: InteractionKind): InteractionAuthority {
	return kind === "clarify_question" || kind === "escalation" ? "advisory" : "literal_user";
}

/**
 * The literal-user operations GitHub may post but never apply (BR-DEC-10).
 * Each names the local action the owner has to take in their own Host session.
 */
export const LOCAL_ONLY_OPERATIONS = {
	stop: "stop the running task",
	breaking_intent_revision: "approve the breaking Intent revision",
	authorization: "authorize the pending Kernel operation",
	credentials: "supply the required credential",
	risk_override: "override the task risk",
} as const;

export type LocalOnlyOperation = keyof typeof LOCAL_ONLY_OPERATIONS;

export const LOCAL_ONLY_LOCAL_ACTION = "run `drive` on the task in your local Host";

/**
 * Build the `notice` request for a literal-user operation that only a local
 * Host session can apply. The `github` channel posts it as `notice_only`; a
 * reply to it is never applied.
 */
export function localOnlyNotice(input: {
	interaction_id: string;
	operation: LocalOnlyOperation;
	subject: InteractionSubject;
	binding?: InteractionBinding;
	detail?: string;
}): InteractionRequest {
	const action = LOCAL_ONLY_OPERATIONS[input.operation];
	return {
		contract: INTERACTION_REQUEST_CONTRACT,
		interaction_id: input.interaction_id,
		kind: "notice",
		subject: input.subject,
		binding: input.binding ?? {},
		prompt: [
			`${action[0]!.toUpperCase()}${action.slice(1)}: only your local Host can apply this, so ${LOCAL_ONLY_LOCAL_ACTION}.`,
			"This GitHub comment is a notice only; a reply here is never applied.",
			input.detail ? input.detail : "",
		]
			.filter(Boolean)
			.join("\n\n"),
		answer: "none",
		authority: interactionAuthority("notice"),
	};
}

/**
 * The `clarify` question of one Issue (D8): the questions are the whole prompt,
 * the answer is free text and the request is advisory, so any allowlisted answer
 * re-runs `clarify` with it.
 */
export function clarifyQuestionRequest(input: {
	issue_number: number;
	questions: readonly string[];
	issue_revision: string;
}): InteractionRequest {
	return {
		contract: INTERACTION_REQUEST_CONTRACT,
		interaction_id: clarifyInteractionId(input.issue_number, input.questions),
		kind: "clarify_question",
		subject: { issue: input.issue_number },
		binding: { issue_revision: input.issue_revision },
		prompt: [
			`Issue #${input.issue_number} needs clarification before it can be planned:`,
			"",
			input.questions.map((question, index) => `${index + 1}. ${question}`).join("\n"),
		].join("\n"),
		answer: "free_text",
		authority: interactionAuthority("clarify_question"),
	};
}

/**
 * One clarify question set per Issue: the idempotency key is stable for the same
 * questions, so a tick that observes no answer posts nothing new (D8).
 */
export function clarifyInteractionId(issueNumber: number, questions: readonly string[]): string {
	const digest = createHash("sha256").update(`${issueNumber}\n${questions.join("\n")}`).digest("hex");
	return `clarify:issue-${issueNumber}:${digest.slice(0, 12)}`;
}

/** The binding fields whose value moved since the request was posted; empty means unchanged. */
export function changedBindingFields(posted: InteractionBinding, current: InteractionBinding): string {
	const keys: ReadonlyArray<keyof InteractionBinding> = ["plan_digest", "record_revision", "issue_revision"];
	return keys.filter((key) => (posted[key] ?? "") !== (current[key] ?? "")).join(", ");
}
