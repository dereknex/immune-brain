/**
 * Loop Daemon: Closed Handler Catalogue (S2)
 *
 * Implements S2 and D2 of docs/specs/loop-daemon.spec.md (BR-REQ-2).
 * Every judgement selects exactly one handler from this closed set. A name
 * outside it cannot reach a decision record: `assertLoopHandler` refuses it.
 */

export const LOOP_HANDLERS = [
	"noop_record",
	"triage_issue",
	"analyze_codebase",
	"draft_plan",
	"publish_plan_for_approval",
	"enroll_and_drive",
	"relay_lane_decision_question",
	"apply_lane_decision_reply",
	"open_pr",
	"repair_pr_ci",
	"repair_pr_conflict",
	"address_pr_review",
	"mark_pr_ready",
	"close_out",
	"escalate",
] as const;

export type LoopHandler = (typeof LOOP_HANDLERS)[number];

export function isLoopHandler(value: unknown): value is LoopHandler {
	return typeof value === "string" && (LOOP_HANDLERS as readonly string[]).includes(value);
}

export function assertLoopHandler(value: unknown): asserts value is LoopHandler {
	if (!isLoopHandler(value)) throw new Error(`handler_outside_catalogue: ${String(value)}`);
}
