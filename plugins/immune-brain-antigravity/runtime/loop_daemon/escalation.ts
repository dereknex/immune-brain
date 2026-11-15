/**
 * Loop Daemon: Marker-Keyed Escalations (S3)
 *
 * Implements D3.3 of docs/specs/loop-daemon.spec.md (BR-REQ-3). An escalation
 * comment carries `<!-- immune-brain:escalation-key=<hash> -->`; the marker is
 * an idempotency hint only and never an authorization proof (threat model 1).
 * Repeating the same key updates the existing comment instead of posting a
 * second one, and an unchanged body is a no-op.
 */

import { createHash } from "node:crypto";
import {
	INTERACTION_REQUEST_CONTRACT,
	interactionAuthority,
	type InteractionRequest,
} from "./interaction/protocol.ts";
import type { RawComment } from "./types.ts";

export const ESCALATION_KEY_MARKER = "<!-- immune-brain:escalation-key=";

const ESCALATION_KEY_PATTERN = /<!--\s*immune-brain:escalation-key=([^\s>]+)\s*-->/i;

/** Stable key for one escalation subject: same kind, target and detail hash to the same key. */
export function escalationKey(subject: { kind: string; target: string; detail?: string | null }): string {
	return createHash("sha256")
		.update(`${subject.kind}\n${subject.target}\n${subject.detail ?? ""}`)
		.digest("hex");
}

export function escalationKeyMarker(key: string): string {
	return `${ESCALATION_KEY_MARKER}${key} -->`;
}

export function parseEscalationKey(body: string): string | null {
	const match = body.match(ESCALATION_KEY_PATTERN);
	return match ? match[1] : null;
}

/** The comment body an escalation carries: the marker line, then the message. */
export function renderEscalationBody(key: string, message: string): string {
	return `${escalationKeyMarker(key)}\n${message.trim()}\n`;
}

export interface EscalationPlan {
	action: "post" | "update" | "skip";
	key: string;
	body: string;
	/** The existing comment this plan edits or skips, if any. */
	comment_id: number | null;
}

/**
 * Deduplicate one escalation against the comments already on the Issue: post
 * when the key is new, skip when the body is unchanged, otherwise edit the
 * comment that already carries the key.
 */
export function planEscalation(
	existing: readonly RawComment[],
	input: { key: string; message: string },
): EscalationPlan {
	const body = renderEscalationBody(input.key, input.message);
	const match = existing
		.filter((comment) => parseEscalationKey(comment.body) === input.key)
		.sort((a, b) => a.id - b.id)[0];

	if (match === undefined) return { action: "post", key: input.key, body, comment_id: null };
	if (match.body.replace(/\s+/g, " ").trim() === body.replace(/\s+/g, " ").trim()) {
		return { action: "skip", key: input.key, body, comment_id: match.id };
	}
	return { action: "update", key: input.key, body, comment_id: match.id };
}

/**
 * Adapter: one escalation as an `InteractionRequest` (D3 of
 * docs/specs/loop-agent-scheduling.spec.md). The stable `escalationKey` becomes
 * the `interaction_id`, so the `github` channel's one-comment rule replaces the
 * key marker's dedupe for new posts, while `planEscalation()` still reads the
 * markers of comments posted before the channel existed.
 */
export function escalationInteractionRequest(input: {
	key: string;
	message: string;
	issue_number?: number;
	pr_number?: number;
}): InteractionRequest {
	return {
		contract: INTERACTION_REQUEST_CONTRACT,
		interaction_id: `escalation:${input.key}`,
		kind: "escalation",
		subject: {
			...(input.issue_number === undefined ? {} : { issue: input.issue_number }),
			...(input.pr_number === undefined ? {} : { pr: input.pr_number }),
		},
		binding: {},
		prompt: input.message.trim(),
		answer: "none",
		authority: interactionAuthority("escalation"),
	};
}
