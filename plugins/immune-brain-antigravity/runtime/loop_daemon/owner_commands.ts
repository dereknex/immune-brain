/**
 * Loop Daemon: Verified Owner Commands (S3, S5)
 *
 * Implements D3.4 of docs/specs/loop-daemon.spec.md (BR-REQ-3). `@imm-loop`
 * text is untrusted input: a command is only evidence once its REST comment
 * metadata proves the author is an allowlisted, non-daemon actor with an
 * allowlisted `author_association`, and the comment was never edited.
 *
 * S5/D5 adds the advisory `focus`/`priority` hints and the local-only
 * `pause`/`resume`/`abandon` verbs (BR-DEC-11): a GitHub comment is a notice,
 * never a state change.
 */

import { type GuardFacts, isVerifiedActor } from "./guards.ts";
import type { LoopHandler } from "./handlers.ts";

export const OWNER_COMMANDS = ["pause", "resume", "abandon", "replan", "approve", "retry", "ignore", "focus", "priority"] as const;

export type OwnerCommand = (typeof OWNER_COMMANDS)[number];

/** The handler one daemon command selects from the closed catalogue. */
export const OWNER_COMMAND_HANDLERS: Readonly<Record<OwnerCommand, LoopHandler>> = {
	pause: "noop_record",
	resume: "noop_record",
	abandon: "noop_record",
	replan: "draft_plan",
	approve: "enroll_and_drive",
	retry: "repair_pr_ci",
	ignore: "noop_record",
	focus: "noop_record",
	priority: "noop_record",
};

/** D5.1: the advisory hints the journal keeps and the next briefing reads. */
export const OWNER_HINT_COMMANDS = ["focus", "priority"] as const;
export const OWNER_PRIORITY_LEVELS = ["high", "normal", "low"] as const;
/** BR-DEC-11: a GitHub command for one of these is a notice naming the local action. */
export const LOCAL_ONLY_OWNER_COMMANDS = ["pause", "resume", "abandon"] as const;

export type LocalOnlyOwnerCommand = (typeof LOCAL_ONLY_OWNER_COMMANDS)[number];

export function isLocalOnlyOwnerCommand(command: string): command is LocalOnlyOwnerCommand {
	return (LOCAL_ONLY_OWNER_COMMANDS as readonly string[]).includes(command);
}

/** The advisory text one hint command contributes to the briefing, or null. */
export function ownerHintText(command: OwnerCommand, argument: string | null): string | null {
	if (command === "focus") return argument;
	if (command === "priority") return argument === null ? null : `priority: ${argument}`;
	return null;
}

const OWNER_COMMAND_PATTERN = /@imm-loop\s+([a-z][a-z-]*)(?:\s+([^\n]*))?/i;

export interface ParsedOwnerCommand {
	command: OwnerCommand;
	/** The token after the command, e.g. the plan digest for `approve`. */
	argument: string | null;
}

export function isOwnerCommand(value: unknown): value is OwnerCommand {
	return typeof value === "string" && (OWNER_COMMANDS as readonly string[]).includes(value);
}

/** The first `@imm-loop` command in a comment body, or null when it names no daemon command. */
export function parseOwnerCommand(body: string): ParsedOwnerCommand | null {
	const match = (body ?? "").match(OWNER_COMMAND_PATTERN);
	if (match === null) return null;
	const command = match[1].toLowerCase();
	if (!isOwnerCommand(command)) return null;
	const rest = (match[2] ?? "").trim();
	if (command === "focus") return { command, argument: rest.length === 0 ? null : rest };
	const first = rest.split(/\s+/)[0] ?? "";
	if (first.length === 0) return { command, argument: null };
	return { command, argument: command === "priority" ? first.toLowerCase() : first };
}

/** The REST comment metadata the verification boundary reads. */
export interface OwnerCommandComment {
	body: string;
	/** `comment.user.login` from the REST API. */
	author: string;
	/** `comment.author_association` from the REST API. */
	author_association: string;
	created_at: string;
	updated_at: string;
}

export interface OwnerCommandDecision {
	command: OwnerCommand | null;
	argument: string | null;
	/** The handler a verified command selects; null means "not a verified command". */
	handler: LoopHandler | null;
	accepted: boolean;
	reason: string;
}

/**
 * Verify one comment and resolve it to a handler. Rejections fail closed:
 * unverified actor, edited comment, and an `approve` without a plan digest are
 * all non-evidence, so the caller keeps them out of the handler catalogue.
 */
export function resolveOwnerCommand(
	comment: OwnerCommandComment,
	facts: GuardFacts = {},
): OwnerCommandDecision {
	const parsed = parseOwnerCommand(comment.body);
	if (parsed === null) {
		return { command: null, argument: null, handler: null, accepted: false, reason: "not an @imm-loop command" };
	}
	const reject = (reason: string): OwnerCommandDecision => ({
		command: parsed.command,
		argument: parsed.argument,
		handler: null,
		accepted: false,
		reason,
	});

	if (!isVerifiedActor(comment.author, comment.author_association, facts)) {
		return reject("unverified actor");
	}
	if (comment.updated_at !== comment.created_at) return reject("comment was edited after posting");
	if (parsed.command === "approve" && parsed.argument === null) {
		return reject("approve names no plan digest");
	}
	if (parsed.command === "focus" && parsed.argument === null) {
		return reject("focus names no text");
	}
	if (parsed.command === "priority" && !(OWNER_PRIORITY_LEVELS as readonly string[]).includes(parsed.argument ?? "")) {
		return reject(`priority names no level: ${OWNER_PRIORITY_LEVELS.join("|")}`);
	}

	return {
		command: parsed.command,
		argument: parsed.argument,
		handler: OWNER_COMMAND_HANDLERS[parsed.command],
		accepted: true,
		reason: `verified owner @imm-loop ${parsed.command}`,
	};
}
