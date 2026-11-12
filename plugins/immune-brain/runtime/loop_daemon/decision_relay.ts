/**
 * Loop Daemon: In-Lane Literal-User Decision Relay (S6)
 *
 * Implements S6 and D7 of docs/specs/loop-daemon.spec.md (BR-REQ-5, BR-SCN-4, ADR 0039 Decision 12):
 * - Detection & Parking: When a supervised Lane pauses on a user_only decision in
 *   `laneDecisionFacts`, transitions the lease to `parked_for_decision` (releasing
 *   the active concurrency slot while preserving worktree and scope_hint reservation).
 * - Structured Question: Posts a structured GitHub Issue comment carrying
 *   `<!-- immune-brain:kind=lane-decision -->`, `run_id`, `record_revision`,
 *   and numbered options.
 * - Verified Owner Reply: Verifies the replying comment author against
 *   `allowed_actors` + `allowed_associations`, rejects unedited-violating or
 *   daemon-authored replies, and matches `(run_id, record_revision)`.
 * - Stale Rejection: Replies referencing a stale `record_revision` are strictly
 *   rejected without mutating Lane state and post a revision-mismatch notice.
 * - Relay: Relays the verified decision via `relayLaneDecision` to resume the Lane.
 */

import { type GuardFacts, isVerifiedActor } from "./guards.ts";
import {
	isUserOnlyDecision,
	relayLaneDecision,
	type LaneDecisionFacts,
	type LaneDecisionOperation,
	type LaneRelayInput,
	type LaneRelayOutcome,
	LaneDecisionStaleError,
} from "../unattended/lane_decision.ts";
import { parkLoopLeaseForDecision, resumeLoopLeaseFromDecision } from "./leases.ts";
import type { LoopLease, RawComment } from "./types.ts";

export { isUserOnlyDecision };

export const LANE_DECISION_MARKER = "<!-- immune-brain:kind=lane-decision -->";
export const REVISION_MISMATCH_NOTICE_MARKER = "<!-- immune-brain:kind=revision-mismatch-notice -->";

export const RUN_ID_MARKER_PREFIX = "<!-- immune-brain:run-id=";
export const RECORD_REVISION_MARKER_PREFIX = "<!-- immune-brain:record-revision=";
export const TASK_ID_MARKER_PREFIX = "<!-- immune-brain:task-id=";
export const DECISION_CHOICE_MARKER_PREFIX = "<!-- immune-brain:decision-choice=";
export const STALE_REVISION_MARKER_PREFIX = "<!-- immune-brain:stale-revision=";
export const CURRENT_REVISION_MARKER_PREFIX = "<!-- immune-brain:current-revision=";

const RUN_ID_PATTERN = /<!--\s*immune-brain:run-id=([^\s>]+)\s*-->/i;
const RECORD_REVISION_PATTERN = /<!--\s*immune-brain:record-revision=([^\s>]+)\s*-->/i;
const TASK_ID_PATTERN = /<!--\s*immune-brain:task-id=([^\s>]+)\s*-->/i;
const DECISION_CHOICE_PATTERN = /<!--\s*immune-brain:decision-choice=([^\s>]+)\s*-->/i;
const STALE_REVISION_PATTERN = /<!--\s*immune-brain:stale-revision=([^\s>]+)\s*-->/i;
const CURRENT_REVISION_PATTERN = /<!--\s*immune-brain:current-revision=([^\s>]+)\s*-->/i;

export interface DecisionOption {
	id: string;
	label: string;
	description?: string;
}

export interface DecisionQuestionInput {
	task_id: string;
	run_id: string;
	record_revision: string;
	question: string;
	options: DecisionOption[];
	gate_kind?: string;
	issue_number?: number;
}

export interface DecisionReplyInput {
	issue_number: number;
	comment_id: number;
	author: string;
	author_association: string;
	run_id?: string;
	record_revision?: string;
	selected_option?: string;
	reply_body: string;
	created_at?: string;
	updated_at?: string;
}

export interface VerifiedDecisionChoice {
	operation: LaneDecisionOperation;
	option_id: string;
	option: DecisionOption | null;
	selected_option: string;
	run_id: string;
	record_revision: string;
}

export interface VerifiedDecisionReply {
	status: "verified";
	run_id: string;
	record_revision: string;
	selected_option: string;
	choice: VerifiedDecisionChoice;
	operation: LaneDecisionOperation;
}

export interface IgnoredDecisionReply {
	status: "ignored";
	reason: string;
}

export interface StaleRevisionDecisionReply {
	status: "stale_revision";
	run_id: string;
	replied_revision: string;
	current_revision: string;
	notice_body: string;
}

export type DecisionReplyVerificationResult =
	| VerifiedDecisionReply
	| IgnoredDecisionReply
	| StaleRevisionDecisionReply;

/**
 * Render the structured GitHub comment asking the human owner for an in-Lane decision.
 */
export function renderLaneDecisionQuestion(input: DecisionQuestionInput): string {
	const optionLines = input.options.length
		? input.options
				.map((opt, i) => `${i + 1}. **${opt.label}** (\`${opt.id}\`)${opt.description ? `: ${opt.description}` : ""}`)
				.join("\n")
		: "1. **Proceed** (`proceed`)";

	return [
		LANE_DECISION_MARKER,
		`${RUN_ID_MARKER_PREFIX}${input.run_id} -->`,
		`${RECORD_REVISION_MARKER_PREFIX}${input.record_revision} -->`,
		`${TASK_ID_MARKER_PREFIX}${input.task_id} -->`,
		`## In-Lane Decision Required for \`${input.task_id}\``,
		"",
		input.question.trim(),
		"",
		"### Options:",
		optionLines,
		"",
		"Reply to this comment with your choice, e.g.:",
		`- \`<!-- immune-brain:run-id=${input.run_id} --> <!-- immune-brain:record-revision=${input.record_revision} --> Option 1\``,
		`- \`@imm-loop select <option_id>\``,
		"",
	].join("\n");
}

/**
 * Render the revision-mismatch notice posted when a reply references a stale revision.
 */
export function renderRevisionMismatchNotice(input: {
	task_id: string;
	run_id: string;
	replied_revision: string;
	current_revision: string;
}): string {
	return [
		REVISION_MISMATCH_NOTICE_MARKER,
		`${RUN_ID_MARKER_PREFIX}${input.run_id} -->`,
		`${TASK_ID_MARKER_PREFIX}${input.task_id} -->`,
		`${STALE_REVISION_MARKER_PREFIX}${input.replied_revision} -->`,
		`${CURRENT_REVISION_MARKER_PREFIX}${input.current_revision} -->`,
		`## Lane Decision Revision Mismatch for \`${input.task_id}\``,
		"",
		`The decision reply referenced record revision \`${input.replied_revision}\`, but the current Lane record revision is \`${input.current_revision}\`.`,
		"The reply was rejected without mutating Lane state. Please review the updated decision prompt before replying.",
		"",
	].join("\n");
}

/**
 * Parse markers from a lane-decision question comment body.
 */
export function parseLaneDecisionQuestion(body: string): { run_id: string; record_revision: string; task_id?: string } | null {
	if (!body.includes(LANE_DECISION_MARKER)) return null;
	const runMatch = body.match(RUN_ID_PATTERN);
	const revMatch = body.match(RECORD_REVISION_PATTERN);
	if (!runMatch || !revMatch) return null;
	const taskMatch = body.match(TASK_ID_PATTERN);
	return {
		run_id: runMatch[1],
		record_revision: revMatch[1],
		task_id: taskMatch ? taskMatch[1] : undefined,
	};
}

/**
 * Parse markers from a revision-mismatch notice comment body.
 */
export function parseRevisionMismatchNotice(body: string): {
	run_id: string;
	task_id?: string;
	stale_revision?: string;
	current_revision?: string;
} | null {
	if (!body.includes(REVISION_MISMATCH_NOTICE_MARKER)) return null;
	const runMatch = body.match(RUN_ID_PATTERN);
	if (!runMatch) return null;
	const taskMatch = body.match(TASK_ID_PATTERN);
	const staleMatch = body.match(STALE_REVISION_PATTERN);
	const currMatch = body.match(CURRENT_REVISION_PATTERN);
	return {
		run_id: runMatch[1],
		task_id: taskMatch ? taskMatch[1] : undefined,
		stale_revision: staleMatch ? staleMatch[1] : undefined,
		current_revision: currMatch ? currMatch[1] : undefined,
	};
}

/**
 * Strip HTML routing markers (<!-- immune-brain:... -->) and metadata lines
 * from reply text/selected_option before matching options or resolving operations.
 */
export function stripReplyRoutingMarkers(text: string): string {
	return text
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/^\s*(?:run_id|record_revision|task_id):\s*[^\r\n]+/gim, "")
		.trim();
}

/**
 * Parse decision reply fields from body text or markers.
 */
export function parseDecisionReplyText(body: string): {
	run_id?: string;
	record_revision?: string;
	selected_option?: string;
} {
	const runMatch = body.match(RUN_ID_PATTERN) || body.match(/\brun_id:\s*([^\s]+)/i);
	const revMatch = body.match(RECORD_REVISION_PATTERN) || body.match(/\brecord_revision:\s*([^\s]+)/i);
	
	const stripped = stripReplyRoutingMarkers(body);
	const explicitChoiceMatch =
		body.match(DECISION_CHOICE_PATTERN) ||
		stripped.match(/^(?:@imm-loop\s+select|\/select)\s+(.+)$/im) ||
		stripped.match(/\b(?:option|choice|select)(?:\s+|:\s*)([a-zA-Z0-9_#-]+)/i);

	const selected_option = explicitChoiceMatch
		? explicitChoiceMatch[1].trim()
		: (stripped || undefined);

	return {
		run_id: runMatch ? runMatch[1] : undefined,
		record_revision: revMatch ? revMatch[1] : undefined,
		selected_option,
	};
}

/**
 * Park one Lane lease for a literal-user decision (releasing the active concurrency slot).
 */
export function parkLaneSlot(
	stateDir: string,
	targetId: string,
	options: { host_token: string; now?: string },
): LoopLease | null {
	return parkLoopLeaseForDecision(stateDir, targetId, options);
}

/**
 * Resume one parked Lane lease back to active execution.
 */
export function resumeLaneSlot(
	stateDir: string,
	targetId: string,
	options: { host_token: string; now?: string },
): LoopLease | null {
	return resumeLoopLeaseFromDecision(stateDir, targetId, options);
}

export interface PublishQuestionDeps {
	postComment: (input: { issue_number: number; body: string }) => Promise<unknown> | unknown;
	existingComments?: readonly RawComment[];
	stateDir?: string;
	hostToken?: string;
}

export interface PublishQuestionResult {
	posted: boolean;
	parked: boolean;
	comment_body: string;
	lease: LoopLease | null;
}

/**
 * Detect a literal-user decision, park the concurrency slot, and post a structured
 * question comment to GitHub if not already published.
 */
export async function publishLaneDecisionQuestion(
	input: DecisionQuestionInput,
	deps: PublishQuestionDeps,
): Promise<PublishQuestionResult> {
	let lease: LoopLease | null = null;
	if (deps.stateDir && deps.hostToken) {
		lease = parkLaneSlot(deps.stateDir, input.task_id, { host_token: deps.hostToken });
	}

	const comment_body = renderLaneDecisionQuestion(input);

	// Deduplication: check if already posted on the issue
	const alreadyPosted = (deps.existingComments || []).some((c) => {
		const parsed = parseLaneDecisionQuestion(c.body);
		return parsed && parsed.run_id === input.run_id && parsed.record_revision === input.record_revision;
	});

	let posted = false;
	if (!alreadyPosted && input.issue_number) {
		await deps.postComment({ issue_number: input.issue_number, body: comment_body });
		posted = true;
	}

	return {
		posted,
		parked: lease !== null,
		comment_body,
		lease,
	};
}

/**
 * Resolve the LaneDecisionOperation for a chosen option.
 * Preserves stop/replan intent on matched options (by id or label),
 * and resolves "stop" even when options is empty/absent.
 */
export function resolveDecisionOperation(
	selectedOption: string,
	facts: LaneDecisionFacts | { task_id: string; run_id: string | null; record_revision: string; replan_required_ids?: string[]; authorization?: { state: string } },
	matchedOption?: DecisionOption | null,
): LaneDecisionOperation {
	const opt = selectedOption.toLowerCase().trim();
	const label = matchedOption?.label?.toLowerCase().trim() ?? "";

	if (
		opt === "stop" ||
		opt === "cancel" ||
		opt === "abort" ||
		label === "stop" ||
		label === "cancel" ||
		label === "abort"
	) {
		return "stop";
	}
	const isReplan =
		opt === "replan" ||
		opt === "revise_intent" ||
		opt === "breaking" ||
		label === "replan" ||
		label === "revise_intent" ||
		(facts.replan_required_ids && facts.replan_required_ids.length > 0) ||
		(facts.authorization && facts.authorization.state === "authorize_rework");
	if (isReplan) {
		return "approve_breaking_intent_revision";
	}
	return "request_authorization";
}

/**
 * Match a raw decision token against the offered options of the question.
 * Normalizes tokens by stripping HTML markers and metadata, then checking
 * direct ID, 1-based index (e.g. 1, 2, #1, Option 1), or label.
 */
export function matchOfferedOption(
	token: string,
	options: DecisionOption[],
): DecisionOption | null {
	const cleaned = stripReplyRoutingMarkers(token);
	const normalized = cleaned.trim().toLowerCase();
	if (!normalized) return null;

	// 1. Direct ID match
	const byId = options.find((o) => o.id.toLowerCase() === normalized);
	if (byId) return byId;

	// 2. 1-based index match: "1", "2", "option 1", "#1", "select 1"
	const indexMatch = normalized.match(/^(?:(?:option|choice|select)\s+)?#?(\d+)$/i);
	if (indexMatch) {
		const idx = Number.parseInt(indexMatch[1]!, 10) - 1;
		if (idx >= 0 && idx < options.length) {
			return options[idx]!;
		}
	}

	// 3. Label match
	const byLabel = options.find((o) => o.label.toLowerCase() === normalized);
	if (byLabel) return byLabel;

	// 4. Match option id without prefix (e.g. "1" matches "opt-1")
	for (const opt of options) {
		const unprefixedId = opt.id.toLowerCase().replace(/^(?:opt|option)-?/i, "");
		const unprefixedToken = normalized.replace(/^(?:opt|option)-?/i, "");
		if (unprefixedId === unprefixedToken) {
			return opt;
		}
	}

	return null;
}

/**
 * Verify one incoming decision reply against owner rules, matching run_id, and matching record_revision.
 */
export function verifyLaneDecisionReply(
	reply: DecisionReplyInput,
	currentFacts: LaneDecisionFacts | { task_id: string; run_id: string | null; record_revision: string; options?: DecisionOption[]; replan_required_ids?: string[]; authorization?: { state: string } },
	guardFacts: GuardFacts = {},
): DecisionReplyVerificationResult {
	// 1. Owner verification boundary (allowed_actors, allowed_associations, never daemon)
	if (!isVerifiedActor(reply.author, reply.author_association, guardFacts)) {
		return { status: "ignored", reason: "unverified_actor" };
	}

	// 2. Unedited comment invariant
	if (reply.created_at && reply.updated_at && reply.updated_at !== reply.created_at) {
		return { status: "ignored", reason: "comment_edited" };
	}

	// Extract parsed tokens from body if not already on the reply object
	const parsedText = parseDecisionReplyText(reply.reply_body);
	const runId = reply.run_id ?? parsedText.run_id;
	const recordRevision = reply.record_revision ?? parsedText.record_revision;
	const rawChoice = reply.selected_option ?? parsedText.selected_option ?? stripReplyRoutingMarkers(reply.reply_body);

	// 3. run_id matching: must match the active/parked run_id
	if (!runId || runId !== currentFacts.run_id) {
		return { status: "ignored", reason: `run_id_mismatch: got ${runId ?? "none"}, expected ${currentFacts.run_id}` };
	}

	// 4. record_revision matching: stale revision is rejected and requires mismatch notice
	if (!recordRevision || recordRevision !== currentFacts.record_revision) {
		const notice_body = renderRevisionMismatchNotice({
			task_id: currentFacts.task_id,
			run_id: runId,
			replied_revision: recordRevision ?? "unknown",
			current_revision: currentFacts.record_revision,
		});
		return {
			status: "stale_revision",
			run_id: runId,
			replied_revision: recordRevision ?? "unknown",
			current_revision: currentFacts.record_revision,
			notice_body,
		};
	}

	// 5. Option validation against offered question options
	const offeredOptions = "options" in currentFacts && Array.isArray(currentFacts.options) ? currentFacts.options : [];
	let matchedOption: DecisionOption | null = null;
	const cleanedChoice = stripReplyRoutingMarkers(rawChoice);
	let effectiveOptionId = cleanedChoice;

	if (offeredOptions.length > 0) {
		matchedOption = matchOfferedOption(cleanedChoice, offeredOptions);
		const lower = cleanedChoice.toLowerCase().trim();
		const isUniversal = lower === "stop" || lower === "cancel" || lower === "abort" || lower === "replan";
		if (!matchedOption && !isUniversal) {
			return {
				status: "ignored",
				reason: `unoffered_option: '${cleanedChoice}' is not among offered options [${offeredOptions.map((o) => o.id).join(", ")}]`,
			};
		}
		if (matchedOption) {
			effectiveOptionId = matchedOption.id;
		}
	}

	// 6. Verified: build choice and resolve operation (preserving matched option intent)
	const operation = resolveDecisionOperation(effectiveOptionId, currentFacts, matchedOption);
	const choice: VerifiedDecisionChoice = {
		operation,
		option_id: effectiveOptionId,
		option: matchedOption,
		selected_option: cleanedChoice,
		run_id: runId,
		record_revision: recordRevision,
	};

	return {
		status: "verified",
		run_id: runId,
		record_revision: recordRevision,
		selected_option: effectiveOptionId,
		choice,
		operation,
	};
}

export interface DecisionRelayDeps {
	postComment?: (input: { issue_number: number; body: string }) => Promise<unknown> | unknown;
	existingComments?: readonly RawComment[];
	relayDecision?: typeof relayLaneDecision;
	stateDir?: string;
	hostToken?: string;
	resumeLease?: (targetId: string) => LoopLease | null;
	guardFacts?: GuardFacts;
}

export interface DecisionRelayOutcome {
	action: "relayed" | "rejected_stale" | "ignored";
	reason?: string;
	replied_revision?: string;
	current_revision?: string;
	notice_posted?: boolean;
	choice?: VerifiedDecisionChoice;
	relay_outcome?: LaneRelayOutcome<unknown>;
	lease?: LoopLease | null;
}

export type RelayInputFactory<R> = (
	operation: LaneDecisionOperation,
	record_revision: string,
	choice: VerifiedDecisionChoice,
) => LaneRelayInput<R>;

/**
 * Handle one in-Lane decision reply end-to-end:
 * - If unverified actor or mismatched run_id: ignored without mutating Lane or posting.
 * - If stale record_revision: rejected without mutating Lane, and posts revision-mismatch notice.
 * - If verified owner with matching (run_id, record_revision): invokes relayLaneDecision,
 *   unparks the lease, and resumes the Lane.
 */
export async function handleLaneDecisionReply<R = unknown>(
	reply: DecisionReplyInput,
	currentFacts: LaneDecisionFacts | { task_id: string; run_id: string; record_revision: string; options?: DecisionOption[]; replan_required_ids?: string[]; authorization?: { state: string } },
	deps: DecisionRelayDeps,
	relayInputFactory?: RelayInputFactory<R>,
): Promise<DecisionRelayOutcome> {
	const verification = verifyLaneDecisionReply(reply, currentFacts, deps.guardFacts ?? {});

	if (verification.status === "ignored") {
		return { action: "ignored", reason: verification.reason };
	}

	if (verification.status === "stale_revision") {
		let notice_posted = false;
		if (deps.postComment && reply.issue_number) {
			const alreadyNotified = (deps.existingComments || []).some((c) => {
				const parsed = parseRevisionMismatchNotice(c.body);
				return (
					parsed &&
					parsed.run_id === verification.run_id &&
					parsed.stale_revision === verification.replied_revision
				);
			});
			if (!alreadyNotified) {
				await deps.postComment({ issue_number: reply.issue_number, body: verification.notice_body });
				notice_posted = true;
			}
		}
		return {
			action: "rejected_stale",
			replied_revision: verification.replied_revision,
			current_revision: verification.current_revision,
			notice_posted,
		};
	}

	// Verified owner with matching revision: relayLaneDecision is strictly required (no fabricated success)
	if (!relayInputFactory) {
		throw new Error(
			"relay_input_factory_required: handleLaneDecisionReply requires relayInputFactory to invoke relayLaneDecision",
		);
	}

	const relayer = deps.relayDecision ?? relayLaneDecision;
	let relayOutcome: LaneRelayOutcome<unknown>;
	const relayArgs = relayInputFactory(
		verification.operation,
		verification.record_revision,
		verification.choice,
	);
	try {
		relayOutcome = await relayer(relayArgs);
	} catch (error) {
		if (error instanceof LaneDecisionStaleError) {
			// Record moved concurrently under the gate
			const notice_body = renderRevisionMismatchNotice({
				task_id: currentFacts.task_id,
				run_id: verification.run_id,
				replied_revision: verification.record_revision,
				current_revision: "concurrently_updated",
			});
			if (deps.postComment && reply.issue_number) {
				await deps.postComment({ issue_number: reply.issue_number, body: notice_body });
			}
			return {
				action: "rejected_stale",
				replied_revision: verification.record_revision,
				current_revision: "concurrently_updated",
				notice_posted: true,
			};
		}
		throw error;
	}

	let lease: LoopLease | null = null;
	if (relayOutcome.relayed) {
		if (deps.resumeLease) {
			lease = deps.resumeLease(currentFacts.task_id);
		} else if (deps.stateDir && deps.hostToken) {
			lease = resumeLaneSlot(deps.stateDir, currentFacts.task_id, { host_token: deps.hostToken });
		}
	}

	return {
		action: "relayed",
		choice: verification.choice,
		relay_outcome: relayOutcome,
		lease,
	};
}
