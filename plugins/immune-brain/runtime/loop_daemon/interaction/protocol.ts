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

/**
 * The context pack a question carries (D4.4): why the daemon asks, what it
 * already tried, the options with their consequences and the evidence links.
 * Optional, so every request written before it existed still reads unchanged.
 */
export interface InteractionContextOption {
	id: string;
	label: string;
	consequence: string;
}

export interface InteractionContextEvidence {
	label: string;
	ref: string;
}

export interface InteractionContext {
	blocked_on: string;
	tried: string[];
	options: InteractionContextOption[];
	evidence: InteractionContextEvidence[];
}

/** The rendered context pack never exceeds 8 KiB (D4.4). */
export const CONTEXT_MAX_BYTES = 8 * 1024;
export const CONTEXT_SECTION_START = "<!-- immune-brain:context -->";
export const CONTEXT_SECTION_END = "<!-- immune-brain:context-end -->";
export const CONTEXT_TRUNCATED_MARKER = "_Context truncated to 8 KiB._";

const HTML_COMMENT = /<!--[\s\S]*?-->/g;

/**
 * Threat model: leader-authored text reaches GitHub, so HTML comments are
 * stripped (no `immune-brain:` marker can be forged) and `@name` is
 * neutralized with a zero-width space (the daemon never notifies a third party).
 *
 * Stripping repeats until nothing changes, because removing an inner comment can
 * join `<!` and `-->` into a new one, and the two delimiters are then removed
 * themselves: an unterminated `<!--` would otherwise hide the rest of the pack
 * on GitHub, and a nested one could still spell our context markers.
 */
export function sanitizeContextText(text: string): string {
	let stripped = text;
	let previous: string;
	do {
		previous = stripped;
		stripped = stripped.replace(HTML_COMMENT, "");
	} while (stripped !== previous);
	return stripped
		.replace(/<!--/g, "")
		.replace(/-->/g, "")
		.replace(/@(?=[A-Za-z0-9_])/g, "@\u200b")
		.trim();
}

export function sanitizeInteractionContext(context: InteractionContext): InteractionContext {
	return {
		blocked_on: sanitizeContextText(context.blocked_on),
		tried: context.tried.map(sanitizeContextText).filter((entry) => entry.length > 0),
		options: context.options.map((option) => ({
			id: sanitizeContextText(option.id),
			label: sanitizeContextText(option.label),
			consequence: sanitizeContextText(option.consequence),
		})),
		evidence: context.evidence.map((entry) => ({ label: sanitizeContextText(entry.label), ref: sanitizeContextText(entry.ref) })),
	};
}

function contextBody(context: InteractionContext): string {
	const list = (entries: readonly string[]) => (entries.length > 0 ? entries.map((entry) => `- ${entry}`).join("\n") : "- none");
	const options =
		context.options.length > 0
			? context.options
					.map((option, index) => `${index + 1}. **${option.label}** (\`${option.id}\`) — ${option.consequence}`)
					.join("\n")
			: "- none";
	const evidence =
		context.evidence.length > 0
			? context.evidence.map((entry) => `- [${entry.label}](${entry.ref})`).join("\n")
			: "- none";
	return [
		"### Blocked on",
		"",
		context.blocked_on,
		"",
		"### Tried",
		"",
		list(context.tried),
		"",
		"### Options",
		"",
		options,
		"",
		"### Evidence",
		"",
		evidence,
	].join("\n");
}

/**
 * Drop trailing entries until the rendered pack fits 8 KiB. Structured trimming
 * keeps the pack readable; a single over-long `blocked_on` is cut by bytes.
 */
export function fitInteractionContext(context: InteractionContext): { context: InteractionContext; truncated: boolean } {
	const next: InteractionContext = {
		blocked_on: context.blocked_on,
		tried: [...context.tried],
		options: [...context.options],
		evidence: [...context.evidence],
	};
	const bytes = () => Buffer.byteLength(contextBody(next), "utf8");
	let truncated = false;
	while (bytes() > CONTEXT_MAX_BYTES) {
		truncated = true;
		if (next.evidence.length > 0) next.evidence.pop();
		else if (next.options.length > 0) next.options.pop();
		else if (next.tried.length > 0) next.tried.pop();
		else {
			// Last resort: the question itself is longer than the cap.
			let cut = next.blocked_on;
			while (cut.length > 0 && bytes() > CONTEXT_MAX_BYTES) cut = cut.slice(0, -1);
			next.blocked_on = cut;
			break;
		}
	}
	return { context: next, truncated };
}

/** The one context section a request renders: markers delimit it so `annotate` can replace it in place. */
export function renderInteractionContext(context: InteractionContext): string {
	const fitted = fitInteractionContext(sanitizeInteractionContext(context));
	return [
		CONTEXT_SECTION_START,
		contextBody(fitted.context),
		...(fitted.truncated ? ["", CONTEXT_TRUNCATED_MARKER] : []),
		CONTEXT_SECTION_END,
	].join("\n");
}

/** Replace a body's context section, or append one when it carries none yet. */
export function replaceContextSection(body: string, context: InteractionContext): string {
	const section = renderInteractionContext(context);
	const start = body.indexOf(CONTEXT_SECTION_START);
	const end = body.indexOf(CONTEXT_SECTION_END);
	if (start >= 0 && end > start) {
		return `${body.slice(0, start)}${section}${body.slice(end + CONTEXT_SECTION_END.length)}`;
	}
	return `${body.trimEnd()}\n\n${section}\n`;
}

/**
 * Same subject: the request is asked in the same place. Identifiers both sides
 * name must agree; a request that carries extra binding identifiers (a Lane task
 * and run on an Issue) still belongs to that Issue.
 */
export function subjectsMatch(left: InteractionSubject, right: InteractionSubject): boolean {
	const pairs: Array<[number | string | undefined, number | string | undefined]> = [
		[left.issue, right.issue],
		[left.pr, right.pr],
		[left.task_id, right.task_id],
		[left.run_id, right.run_id],
	];
	let shared = false;
	for (const [a, b] of pairs) {
		if (a === undefined || b === undefined) continue;
		if (a !== b) return false;
		shared = true;
	}
	return shared;
}

export function bindingsMatch(left: InteractionBinding, right: InteractionBinding): boolean {
	return changedBindingFields(left, right) === "";
}

/** D4.5: the advisory kinds one new request supersedes; a literal_user request never is. */
export function isAdvisoryKind(kind: InteractionKind): boolean {
	return kind === "clarify_question" || kind === "escalation";
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
	/** D4.4: explanation only; it never widens what a reply may effect. */
	context?: InteractionContext;
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
	/**
	 * D4.5: attach a context pack to a pending `literal_user` request in place,
	 * keeping its `interaction_id`, kind, binding and answer semantics. `absent`
	 * means the channel holds no such request, so the caller posts a new one.
	 */
	annotate(interaction_id: string, context: InteractionContext): Promise<"annotated" | "absent">;
	/** D4.6: the pointer the status projection shows, or null when the channel names none. */
	link(interaction_id: string, subject: InteractionSubject): string | null;
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

/**
 * The `plan_approval` request of one published plan (D3): bound to the plan
 * digest, answered on GitHub only by `/approve <digest>` under ADR 0039
 * Decision 9.
 */
export function planApprovalInteractionRequest(input: {
	issue_number: number;
	plan_digest: string;
	prompt: string;
}): InteractionRequest {
	return {
		contract: INTERACTION_REQUEST_CONTRACT,
		interaction_id: `plan-approval:issue-${input.issue_number}`,
		kind: "plan_approval",
		subject: { issue: input.issue_number },
		binding: { plan_digest: input.plan_digest },
		prompt: input.prompt,
		answer: "approve_digest",
		authority: interactionAuthority("plan_approval"),
	};
}

/**
 * The Lane decision operations the `github` channel may post but never apply
 * (BR-DEC-10): a Lane choice that resolves to one of these is a notice.
 */
export const GITHUB_LOCAL_ONLY_LANE_OPERATIONS = {
	stop: "stop",
	approve_breaking_intent_revision: "breaking_intent_revision",
} as const satisfies Record<string, LocalOnlyOperation>;

export type GithubLocalOnlyLaneOperation = keyof typeof GITHUB_LOCAL_ONLY_LANE_OPERATIONS;

export function isGithubLocalOnlyLaneOperation(operation: string): operation is GithubLocalOnlyLaneOperation {
	return Object.hasOwn(GITHUB_LOCAL_ONLY_LANE_OPERATIONS, operation);
}
