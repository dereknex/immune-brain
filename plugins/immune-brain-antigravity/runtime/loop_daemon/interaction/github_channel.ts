/**
 * Loop Daemon: `github` Interaction channel (S3)
 *
 * Implements D3 of docs/specs/loop-agent-scheduling.spec.md (BR-DEC-6,
 * BR-DEC-8, BR-DEC-10). The channel owns one comment per `interaction_id`
 * (the comment is the request record), applies exactly the literal-user
 * answers ADR 0039 Decisions 9 and 12 grant, posts every other literal-user
 * operation as a notice, and retires a request whose binding moved.
 *
 * Replies are verified by the code that already owned each check:
 * `verifyLaneDecisionReply` for a Lane decision and `verifyTrackerApproval`
 * for `/approve <digest>`. Pre-protocol markers stay readable: a Lane decision
 * question still carries `kind=lane-decision` plus its `run-id` /
 * `record-revision` markers, and an approval is still `/approve <digest>`.
 */

import { verifyTrackerApproval } from "../../kernel/enrollment_confirmation.ts";
import {
	matchOfferedOption,
	renderLaneDecisionQuestion,
	stripReplyRoutingMarkers,
	verifyLaneDecisionReply,
} from "../decision_relay.ts";
import { parsePlanDigestFromComment } from "../events.ts";
import { DEFAULT_ALLOWED_ASSOCIATIONS, isVerifiedActor, type GuardFacts } from "../guards.ts";
import type { RawComment } from "../types.ts";
import {
	INTERACTION_REQUEST_CONTRACT,
	changedBindingFields,
	interactionAuthority,
	type InteractionBinding,
	type InteractionChannel,
	type InteractionKind,
	type InteractionPollResult,
	type InteractionRequest,
	type InteractionSubject,
} from "./protocol.ts";

export const INTERACTION_MARKER_PREFIX = "<!-- immune-brain:interaction=";
export const INTERACTION_WITHDRAWN_MARKER = "<!-- immune-brain:kind=interaction-withdrawn -->";

const INTERACTION_MARKER_PATTERN = /<!--\s*immune-brain:interaction=([^\s>|]+)((?:\|[^\s>|]+)*)\s*-->/i;

/** What the marker line carries back: the id plus everything `poll` reads. */
export interface InteractionMarker {
	interaction_id: string;
	kind: InteractionKind;
	authority: "advisory" | "literal_user";
	subject: InteractionSubject;
	binding: InteractionBinding;
}

function markerLine(marker: InteractionMarker): string {
	const fields: Array<[string, string | undefined]> = [
		["kind", marker.kind],
		["authority", marker.authority],
		["issue", marker.subject.issue === undefined ? undefined : String(marker.subject.issue)],
		["plan_digest", marker.binding.plan_digest],
		["record_revision", marker.binding.record_revision],
		["issue_revision", marker.binding.issue_revision],
	];
	const encoded = fields
		.filter(([, value]) => value !== undefined && value !== "")
		.map(([key, value]) => `${key}=${value}`)
		.join("|");
	return `${INTERACTION_MARKER_PREFIX}${marker.interaction_id}${encoded ? `|${encoded}` : ""} -->`;
}

export function interactionMarker(req: InteractionRequest): string {
	return markerLine({
		interaction_id: req.interaction_id,
		kind: req.kind,
		authority: req.authority,
		subject: req.subject,
		binding: req.binding,
	});
}

export function parseInteractionMarker(body: string): InteractionMarker | null {
	const match = body.match(INTERACTION_MARKER_PATTERN);
	if (!match) return null;
	const fields = new Map<string, string>();
	for (const part of (match[2] ?? "").split("|")) {
		const at = part.indexOf("=");
		if (at > 0) fields.set(part.slice(0, at), part.slice(at + 1));
	}
	const kind = fields.get("kind") as InteractionKind | undefined;
	if (!kind) return null;
	const issue = fields.get("issue");
	return {
		interaction_id: match[1]!,
		kind,
		authority: (fields.get("authority") as InteractionMarker["authority"] | undefined) ?? interactionAuthority(kind),
		subject: issue === undefined ? {} : { issue: Number.parseInt(issue, 10) },
		binding: {
			plan_digest: fields.get("plan_digest"),
			record_revision: fields.get("record_revision"),
			issue_revision: fields.get("issue_revision"),
		},
	};
}

export function isWithdrawn(body: string): boolean {
	return body.includes(INTERACTION_WITHDRAWN_MARKER);
}

/** The comment body one request is posted as. */
export function renderInteractionBody(req: InteractionRequest): string {
	const marker = interactionMarker(req);
	if (req.kind === "lane_decision") {
		// The Lane question format stays the one decision_relay.ts already renders and parses.
		return [
			marker,
			renderLaneDecisionQuestion({
				task_id: req.subject.task_id ?? req.interaction_id,
				run_id: req.subject.run_id ?? "",
				record_revision: req.binding.record_revision ?? "",
				question: req.prompt,
				options: (req.options ?? []).map((id) => ({ id, label: id })),
				issue_number: req.subject.issue,
			}),
		].join("\n");
	}

	const lines = [marker];
	switch (req.kind) {
		case "plan_approval":
			lines.push(
				"## Plan approval required",
				"",
				req.prompt.trim(),
				"",
				`Reply with \`/approve ${req.binding.plan_digest ?? "<plan_digest>"}\` to approve exactly this plan revision.`,
				"A reply naming another digest, an edited reply, or a reply from anyone but a configured owner is ignored.",
			);
			break;
		case "notice":
			lines.push(
				"## Notice: local action required",
				"",
				req.prompt.trim(),
				"",
				"Replies to this comment are not applied; the daemon reads no answer here.",
			);
			break;
		case "escalation":
			lines.push("## Escalation", "", req.prompt.trim());
			break;
		default:
			lines.push("## Clarification requested", "", req.prompt.trim(), "");
			if (req.options && req.options.length > 0) {
				lines.push(
					req.options.map((option, index) => `${index + 1}. **${option}** (\`${option}\`)`).join("\n"),
					"",
				);
			}
			lines.push("Reply with your answer; a reply from a configured owner is the clarification the daemon asked for.");
	}
	return lines.join("\n");
}

export function renderWithdrawnNotice(marker: InteractionMarker, reason: string): string {
	return [
		markerLine(marker),
		INTERACTION_WITHDRAWN_MARKER,
		`## Withdrawn: ${marker.kind} request \`${marker.interaction_id}\``,
		"",
		reason,
		"",
		"No reply to this comment is accepted; the daemon asks again against the current binding.",
	].join("\n");
}

export interface GithubInteractionPort {
	postComment(issueNumber: number, body: string): Promise<{ id: number }>;
	editComment(commentId: number, body: string): Promise<unknown>;
}

export interface GithubInteractionChannelDeps {
	/** The GitHub write port, e.g. `createLoopGitHubPort()` (a fake in tests). */
	port: GithubInteractionPort;
	/** The comments the daemon observed for the subject, in creation order. */
	comments: () => readonly RawComment[];
	/** The binding that holds now; a change retires the request. */
	binding: () => InteractionBinding;
	guardFacts: GuardFacts;
}

/** A request this channel may apply an answer to, in the shape the answer arrives in. */
function answerable(req: {
	kind: InteractionKind;
	binding: InteractionBinding;
	subject: InteractionSubject;
}): boolean {
	if (req.kind === "clarify_question") return true;
	if (req.kind === "plan_approval") return Boolean(req.binding.plan_digest);
	if (req.kind === "lane_decision") return Boolean(req.binding.record_revision && req.subject.run_id);
	return false;
}

/** A question body carries its run/task/options in the body, not in the marker. */
function questionFacts(marker: InteractionMarker, body: string): InteractionMarker & { options?: string[] } {
	const runMatch = body.match(/<!--\s*immune-brain:run-id=([^\s>]+)\s*-->/i);
	const taskMatch = body.match(/<!--\s*immune-brain:task-id=([^\s>]+)\s*-->/i);
	const options = [...body.matchAll(/^\s*\d+\.\s+\*\*[^*]+\*\*\s+\(`([^`]+)`\)/gm)].map((m) => m[1]!);
	return {
		...marker,
		subject: {
			...marker.subject,
			...(runMatch ? { run_id: runMatch[1] } : {}),
			...(taskMatch ? { task_id: taskMatch[1] } : {}),
		},
		...(options.length > 0 ? { options } : {}),
	};
}

function repliesTo(request: RawComment, comments: readonly RawComment[]): RawComment[] {
	return comments.filter(
		(comment) => comment.id !== request.id && comment.created_at > request.created_at && !isWithdrawn(comment.body),
	);
}

function pollClarify(
	request: RawComment,
	marker: InteractionMarker & { options?: string[] },
	deps: GithubInteractionChannelDeps,
): InteractionPollResult {
	for (const reply of repliesTo(request, deps.comments())) {
		if (!isVerifiedActor(reply.user.login, reply.author_association, deps.guardFacts)) continue;
		const text = stripReplyRoutingMarkers(reply.body) || reply.body.trim();
		const offered = (marker.options ?? []).map((id) => ({ id, label: id }));
		return {
			state: "answered",
			value: (offered.length > 0 ? matchOfferedOption(text, offered)?.id : undefined) ?? text,
			actor: reply.user.login,
			provenance: `github:comment:${reply.id}`,
		};
	}
	return { state: "pending" };
}

function pollLaneDecision(
	request: RawComment,
	marker: InteractionMarker & { options?: string[] },
	deps: GithubInteractionChannelDeps,
): InteractionPollResult {
	const facts = {
		task_id: marker.subject.task_id ?? marker.interaction_id,
		run_id: marker.subject.run_id ?? "",
		record_revision: marker.binding.record_revision ?? "",
		options: (marker.options ?? []).map((id) => ({ id, label: id })),
	};
	for (const reply of repliesTo(request, deps.comments())) {
		const verdict = verifyLaneDecisionReply(
			{
				issue_number: marker.subject.issue ?? 0,
				comment_id: reply.id,
				author: reply.user.login,
				author_association: reply.author_association,
				reply_body: reply.body,
				created_at: reply.created_at,
				updated_at: reply.updated_at,
			},
			facts,
			deps.guardFacts,
		);
		if (verdict.status === "verified") {
			return {
				state: "answered",
				value: verdict.choice.option_id,
				actor: reply.user.login,
				provenance: `github:comment:${reply.id}`,
			};
		}
	}
	return { state: "pending" };
}

function pollPlanApproval(
	request: RawComment,
	marker: InteractionMarker,
	deps: GithubInteractionChannelDeps,
): InteractionPollResult {
	for (const reply of repliesTo(request, deps.comments())) {
		const named = parsePlanDigestFromComment(reply.body);
		if (named === null) continue;
		const verdict = verifyTrackerApproval(
			{
				issue_number: marker.subject.issue ?? 0,
				comment_id: reply.id,
				actor_login: reply.user.login,
				author_association: reply.author_association,
				created_at: reply.created_at,
				updated_at: reply.updated_at,
				plan_digest: named,
			},
			{
				allowed_actors: deps.guardFacts.allowed_actors ?? [],
				allowed_associations: deps.guardFacts.allowed_associations ?? [...DEFAULT_ALLOWED_ASSOCIATIONS],
				daemon_identity: deps.guardFacts.daemon_identity ?? "",
				plan_digest: marker.binding.plan_digest ?? "",
				plan_published_at: request.created_at,
			},
		);
		if (verdict.ok) {
			return {
				state: "answered",
				value: named,
				actor: reply.user.login,
				provenance: `github:comment:${reply.id}`,
			};
		}
	}
	return { state: "pending" };
}

/**
 * The `github` channel. `accepts` is the authority boundary: this channel may
 * apply an answer only when it arrives as the digest approval or the Lane
 * decision reply today's code already verifies. Everything else is posted,
 * returns `notice_only`, and is never answered.
 */
export function createGithubInteractionChannel(deps: GithubInteractionChannelDeps): InteractionChannel {
	const find = (interactionId: string): { comment: RawComment; marker: InteractionMarker } | null => {
		for (const comment of deps.comments()) {
			const marker = parseInteractionMarker(comment.body);
			if (marker && marker.interaction_id === interactionId) return { comment, marker };
		}
		return null;
	};

	return {
		id: "github",

		accepts(req: InteractionRequest): boolean {
			return answerable(req);
		},

		async post(req: InteractionRequest): Promise<"posted" | "already_posted" | "notice_only"> {
			if (req.contract !== INTERACTION_REQUEST_CONTRACT) {
				throw new Error(`interaction_contract_invalid: ${req.interaction_id} carries ${req.contract}`);
			}
			if (req.kind === "plan_approval" && !req.binding.plan_digest) {
				throw new Error(`interaction_binding_required: ${req.interaction_id} plan_approval needs a plan_digest`);
			}
			if (req.kind === "lane_decision" && !(req.binding.record_revision && req.subject.run_id)) {
				throw new Error(
					`interaction_binding_required: ${req.interaction_id} lane_decision needs a record_revision and a run_id`,
				);
			}
			if (find(req.interaction_id)) return "already_posted";
			if (req.subject.issue === undefined) {
				throw new Error(`interaction_subject_issue_required: ${req.interaction_id} has no issue to post on`);
			}
			await deps.port.postComment(req.subject.issue, renderInteractionBody(req));
			return answerable(req) ? "posted" : "notice_only";
		},

		async poll(interactionId: string): Promise<InteractionPollResult> {
			const found = find(interactionId);
			if (!found) return { state: "pending" };
			if (isWithdrawn(found.comment.body)) return { state: "withdrawn" };

			const changed = changedBindingFields(found.marker.binding, deps.binding());
			if (changed !== "") {
				await deps.port.editComment(
					found.comment.id,
					renderWithdrawnNotice(
						found.marker,
						`The request was bound to a ${changed} that has since changed, so any answer it collected cannot be applied.`,
					),
				);
				return { state: "stale" };
			}
			if (found.marker.kind === "clarify_question") {
				return pollClarify(found.comment, questionFacts(found.marker, found.comment.body), deps);
			}
			if (found.marker.kind === "lane_decision") {
				return pollLaneDecision(found.comment, questionFacts(found.marker, found.comment.body), deps);
			}
			if (found.marker.kind === "plan_approval") {
				return pollPlanApproval(found.comment, found.marker, deps);
			}
			return { state: "pending" };
		},

		async withdraw(interactionId: string): Promise<void> {
			const found = find(interactionId);
			if (!found || isWithdrawn(found.comment.body)) return;
			const changed = changedBindingFields(found.marker.binding, deps.binding());
			await deps.port.editComment(
				found.comment.id,
				renderWithdrawnNotice(
					found.marker,
					changed === ""
						? "The request was withdrawn before it was answered."
						: `The request was bound to a ${changed} that has since changed, so any answer it collected cannot be applied.`,
				),
			);
		},
	};
}
