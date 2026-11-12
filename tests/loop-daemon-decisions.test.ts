/**
 * Loop Daemon: In-Lane Literal-User Decision Detection, Slot Parking,
 * Structured Question Publication, and Verified Owner Reply Relay (S6)
 *
 * Verifies S6-AC1 under docs/plans/loop-daemon-s6-decisions.intent.json and S6 / D7
 * in docs/specs/loop-daemon.spec.md:
 * - Positive Control (BR-SCN-4): when a supervised Lane pauses on a user_only
 *   decision in `laneDecisionFacts`, `decision_relay.ts` parks the active concurrency
 *   slot, posts a structured GitHub Issue comment carrying `run_id` and `record_revision`,
 *   verifies the replying owner login/association and matching `(run_id, record_revision)`,
 *   and relays the decision via `relayLaneDecision` to resume the Lane.
 * - Negative Control: a reply from a non-owner, unallowlisted association, daemon-authored
 *   identity, edited comment, or without matching `run_id` is strictly ignored without
 *   mutating Lane state or posting a comment.
 * - Boundary / Fault Control: a reply referencing a stale `record_revision` is rejected
 *   without mutating Lane state and posts a revision-mismatch notice to the Issue.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { AssuranceProjectionResult } from "../plugins/immune-brain/runtime/kernel/assurance_projection.ts";
import {
	isUserOnlyDecision,
	relayLaneDecision,
	type LaneDecisionFacts,
	type LaneDecisionOperation,
	type LaneRelayInput,
	type LaneRelayTarget,
	LaneDecisionStaleError,
} from "../plugins/immune-brain/runtime/unattended/lane_decision.ts";
import { LaneSupervisor } from "../plugins/immune-brain/runtime/unattended/lane_supervisor.ts";
import {
	LANE_DECISION_MARKER,
	REVISION_MISMATCH_NOTICE_MARKER,
	RUN_ID_MARKER_PREFIX,
	RECORD_REVISION_MARKER_PREFIX,
	handleLaneDecisionReply,
	parseDecisionReplyText,
	parseLaneDecisionQuestion,
	parseRevisionMismatchNotice,
	publishLaneDecisionQuestion,
	renderLaneDecisionQuestion,
	renderRevisionMismatchNotice,
	resolveDecisionOperation,
	verifyLaneDecisionReply,
	type DecisionQuestionInput,
	type DecisionReplyInput,
} from "../plugins/immune-brain/runtime/loop_daemon/decision_relay.ts";
import type { GuardFacts } from "../plugins/immune-brain/runtime/loop_daemon/guards.ts";
import {
	acquireLoopLease,
	parkLoopLeaseForDecision,
	resumeLoopLeaseFromDecision,
} from "../plugins/immune-brain/runtime/loop_daemon/leases.ts";
import { loadLease } from "../plugins/immune-brain/runtime/loop_daemon/state.ts";
import type { LoopLease, RawComment } from "../plugins/immune-brain/runtime/loop_daemon/types.ts";
import { scheduleLoopWork, type ScheduleInput } from "../plugins/immune-brain/runtime/loop_daemon/scheduler.ts";

const TS = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-01T00:10:00.000Z";
const TASK_ID = "lane-decision-task";
const RUN_ID = "run-bcbfc187";
const REVISION = "rev-001";
const STALE_REVISION = "rev-000";

const OWNER_FACTS: GuardFacts = {
	allowed_actors: ["dereknex"],
	allowed_associations: ["OWNER", "MEMBER", "COLLABORATOR"],
	daemon_identity: "imm-loop-bot",
};

const roots: string[] = [];
afterAll(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix = "loop-decisions-"): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	roots.push(root);
	return root;
}

function write(root: string, path: string, content: string): void {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), content);
}

function makeFacts(overrides: Partial<LaneDecisionFacts> = {}): LaneDecisionFacts {
	return {
		task_id: TASK_ID,
		run_id: RUN_ID,
		record_revision: REVISION,
		authorization: { state: "resolve_user_decision", blocked: null },
		open_user_decision_count: 1,
		replan_required_ids: [],
		...overrides,
	};
}

function validReply(overrides: Partial<DecisionReplyInput> = {}): DecisionReplyInput {
	return {
		issue_number: 465,
		comment_id: 1001,
		author: "dereknex",
		author_association: "OWNER",
		run_id: RUN_ID,
		record_revision: REVISION,
		selected_option: "proceed",
		reply_body: `<!-- immune-brain:run-id=${RUN_ID} --> <!-- immune-brain:record-revision=${REVISION} --> <!-- immune-brain:decision-choice=proceed --> Looks good, proceed.`,
		created_at: LATER,
		updated_at: LATER,
		...overrides,
	};
}

describe("S6 literal-user decision detection (BR-SCN-4, D7)", () => {
	it("detects user_only decision for widen_scope or unresolved user decisions", () => {
		const facts = makeFacts({
			authorization: { state: "resolve_user_decision", blocked: null },
			open_user_decision_count: 1,
		});
		expect(isUserOnlyDecision(facts)).toBe(true);
	});

	it("detects user_only decision for breaking intent revisions and replan boundaries", () => {
		const facts = makeFacts({
			authorization: { state: "authorize_rework", blocked: null },
			open_user_decision_count: 0,
			replan_required_ids: ["S6-AC1"],
		});
		expect(isUserOnlyDecision(facts)).toBe(true);
	});

	it("returns false when facts are null or not waiting on a user decision", () => {
		expect(isUserOnlyDecision(null)).toBe(false);
		const nonWaiting = makeFacts({
			authorization: { state: "none", blocked: null },
			open_user_decision_count: 0,
			replan_required_ids: [],
		});
		expect(isUserOnlyDecision(nonWaiting)).toBe(false);
	});
});

describe("S6 slot parking and structured question publication (BR-SCN-4, D7)", () => {
	it("renders structured question comment carrying run_id, record_revision, and numbered options", () => {
		const q: DecisionQuestionInput = {
			task_id: TASK_ID,
			run_id: RUN_ID,
			record_revision: REVISION,
			question: "The executor encountered an ambiguity requiring human input.",
			options: [
				{ id: "opt-1", label: "Accept scope expansion", description: "Expands scope to include auth helper" },
				{ id: "opt-2", label: "Reject and retry", description: "Keep strict boundary" },
			],
			issue_number: 465,
		};
		const body = renderLaneDecisionQuestion(q);
		expect(body).toContain(LANE_DECISION_MARKER);
		expect(body).toContain(`${RUN_ID_MARKER_PREFIX}${RUN_ID} -->`);
		expect(body).toContain(`${RECORD_REVISION_MARKER_PREFIX}${REVISION} -->`);
		expect(body).toContain("1. **Accept scope expansion** (`opt-1`): Expands scope to include auth helper");
		expect(body).toContain("2. **Reject and retry** (`opt-2`): Keep strict boundary");

		const parsed = parseLaneDecisionQuestion(body);
		expect(parsed).toEqual({
			run_id: RUN_ID,
			record_revision: REVISION,
			task_id: TASK_ID,
		});
	});

	it("parks the active concurrency slot by transitioning lease to parked_for_decision", () => {
		const stateDir = tempRoot();
		const hostToken = "token-host-1";
		acquireLoopLease(stateDir, {
			target_id: TASK_ID,
			kind: "drive",
			owner_pid: process.pid,
			host_token: hostToken,
			scope_hint: ["plugins/immune-brain/runtime/loop_daemon/decision_relay.ts"],
			worktree_path: "/tmp/worktree",
		});

		const initial = loadLease(stateDir, TASK_ID);
		expect(initial?.status).toBe("active");
		expect(initial?.scope_hint).toEqual(["plugins/immune-brain/runtime/loop_daemon/decision_relay.ts"]);

		const parked = parkLoopLeaseForDecision(stateDir, TASK_ID, { host_token: hostToken });
		expect(parked).not.toBeNull();
		expect(parked?.status).toBe("parked_for_decision");
		// Reservations are preserved while slot is released
		expect(parked?.scope_hint).toEqual(["plugins/immune-brain/runtime/loop_daemon/decision_relay.ts"]);
		expect(parked?.worktree_path).toBe("/tmp/worktree");

		// Resuming brings it back to active
		const resumed = resumeLoopLeaseFromDecision(stateDir, TASK_ID, { host_token: hostToken });
		expect(resumed?.status).toBe("active");
	});

	it("frees concurrency slot in scheduleLoopWork while holding overlapping scope (Finding review-1)", () => {
		const stateDir = tempRoot();
		const hostToken = "token-host-1";
		acquireLoopLease(stateDir, {
			target_id: TASK_ID,
			kind: "drive",
			owner_pid: process.pid,
			host_token: hostToken,
			scope_hint: ["plugins/immune-brain/runtime/loop_daemon/decision_relay.ts"],
		});
		parkLoopLeaseForDecision(stateDir, TASK_ID, { host_token: hostToken });
		const parkedLease = loadLease(stateDir, TASK_ID)!;

		// Concurrency slot is freed: with max_concurrent: 1, a disjoint candidate can dispatch
		const scheduled = scheduleLoopWork({
			candidates: [{ target_id: "issue-99", handler: "enroll_and_drive", scope_hint: ["docs/other.md"] }],
			active_leases: [parkedLease],
			ready_buffer: 0,
			open_daemon_prs: 0,
			limits: { max_concurrent: 1, max_ready_buffer: 5, max_pr_buffer: 5 },
			budget: { ticks_today: 0, dispatches_today: 0, max_ticks_per_day: null, max_dispatches_per_day: null },
		});
		expect(scheduled.dispatched).toEqual(["issue-99"]);

		// Scope reservation is preserved: an overlapping candidate is held
		const overlapping = scheduleLoopWork({
			candidates: [
				{
					target_id: "issue-100",
					handler: "enroll_and_drive",
					scope_hint: ["plugins/immune-brain/runtime/loop_daemon/"],
				},
			],
			active_leases: [parkedLease],
			ready_buffer: 0,
			open_daemon_prs: 0,
			limits: { max_concurrent: 1, max_ready_buffer: 5, max_pr_buffer: 5 },
			budget: { ticks_today: 0, dispatches_today: 0, max_ticks_per_day: null, max_dispatches_per_day: null },
		});
		expect(overlapping.dispatched).toEqual([]);
		expect(overlapping.entries[0]!.reason).toStartWith("scope_overlap:");
	});

	it("publishes question to Issue and deduplicates against already posted comments", async () => {
		const stateDir = tempRoot();
		const hostToken = "token-host-1";
		acquireLoopLease(stateDir, {
			target_id: TASK_ID,
			kind: "drive",
			owner_pid: process.pid,
			host_token: hostToken,
			scope_hint: [],
		});

		const postedComments: Array<{ issue_number: number; body: string }> = [];
		const postComment = async (c: { issue_number: number; body: string }) => {
			postedComments.push(c);
		};

		const q: DecisionQuestionInput = {
			task_id: TASK_ID,
			run_id: RUN_ID,
			record_revision: REVISION,
			question: "Please confirm decision",
			options: [{ id: "proceed", label: "Proceed" }],
			issue_number: 465,
		};

		// First publish: posts comment and parks lease
		const res1 = await publishLaneDecisionQuestion(q, {
			postComment,
			existingComments: [],
			stateDir,
			hostToken,
		});
		expect(res1.posted).toBe(true);
		expect(res1.parked).toBe(true);
		expect(postedComments.length).toBe(1);

		const lease = loadLease(stateDir, TASK_ID);
		expect(lease?.status).toBe("parked_for_decision");

		// Second publish for same (run_id, record_revision): deduplicated
		const existing: RawComment[] = [
			{
				id: 1,
				body: postedComments[0]!.body,
				user: { login: "imm-loop-bot" },
				author_association: "COLLABORATOR",
				created_at: TS,
				updated_at: TS,
			},
		];
		const res2 = await publishLaneDecisionQuestion(q, {
			postComment,
			existingComments: existing,
			stateDir,
			hostToken,
		});
		expect(res2.posted).toBe(false);
		expect(postedComments.length).toBe(1);
	});
});

describe("S6 verified owner reply verification and parsing (BR-SCN-4, D7)", () => {
	it("accepts a verified owner reply with matching (run_id, record_revision)", () => {
		const current = makeFacts();
		const reply = validReply();
		const verification = verifyLaneDecisionReply(reply, current, OWNER_FACTS);
		expect(verification.status).toBe("verified");
		if (verification.status === "verified") {
			expect(verification.run_id).toBe(RUN_ID);
			expect(verification.record_revision).toBe(REVISION);
			expect(verification.selected_option).toBe("proceed");
			expect(verification.operation).toBe("request_authorization");
		}
	});

	it("parses deterministic token, @imm-loop select, or numeric option", () => {
		const current = makeFacts();
		const commandReply = validReply({
			reply_body: `@imm-loop select opt-2\nrun_id: ${RUN_ID}\nrecord_revision: ${REVISION}`,
			selected_option: undefined,
		});
		const parsed = verifyLaneDecisionReply(commandReply, current, OWNER_FACTS);
		expect(parsed.status).toBe("verified");
		if (parsed.status === "verified") {
			expect(parsed.selected_option).toBe("opt-2");
		}
	});

	it("resolves operation to approve_breaking_intent_revision on replan", () => {
		const current = makeFacts({
			replan_required_ids: ["S6-AC1"],
			authorization: { state: "authorize_rework", blocked: null },
		});
		const replanReply = validReply({
			selected_option: "replan",
			reply_body: `<!-- immune-brain:run-id=${RUN_ID} --> <!-- immune-brain:record-revision=${REVISION} --> <!-- immune-brain:decision-choice=replan -->`,
		});
		const res = verifyLaneDecisionReply(replanReply, current, OWNER_FACTS);
		expect(res.status).toBe("verified");
		if (res.status === "verified") {
			expect(res.operation).toBe("approve_breaking_intent_revision");
		}
	});

	it("resolves operation to stop on stop or cancel", () => {
		const current = makeFacts();
		const stopReply = validReply({
			selected_option: "stop",
			reply_body: `<!-- immune-brain:run-id=${RUN_ID} --> <!-- immune-brain:record-revision=${REVISION} --> stop`,
		});
		const res = verifyLaneDecisionReply(stopReply, current, OWNER_FACTS);
		expect(res.status).toBe("verified");
		if (res.status === "verified") {
			expect(res.operation).toBe("stop");
		}
	});

	it("validates chosen option against offered question options (Finding review-1)", () => {
		const current = makeFacts({
			options: [
				{ id: "opt-1", label: "Accept scope expansion" },
				{ id: "opt-2", label: "Dismiss and continue" },
			],
		});

		// 1. By direct option id
		const byId = verifyLaneDecisionReply(
			validReply({
				selected_option: "opt-1",
				reply_body: `<!-- immune-brain:run-id=${RUN_ID} --> <!-- immune-brain:record-revision=${REVISION} --> opt-1`,
			}),
			current,
			OWNER_FACTS,
		);
		expect(byId.status).toBe("verified");
		if (byId.status === "verified") {
			expect(byId.selected_option).toBe("opt-1");
			expect(byId.choice.option_id).toBe("opt-1");
		}

		// 2. By numeric index (e.g. 2 -> opt-2)
		const byIndex = verifyLaneDecisionReply(
			validReply({
				selected_option: undefined,
				reply_body: `<!-- immune-brain:run-id=${RUN_ID} --> <!-- immune-brain:record-revision=${REVISION} --> Option 2`,
			}),
			current,
			OWNER_FACTS,
		);
		expect(byIndex.status).toBe("verified");
		if (byIndex.status === "verified") {
			expect(byIndex.selected_option).toBe("opt-2");
			expect(byIndex.choice.option_id).toBe("opt-2");
		}

		// 3. By option label
		const byLabel = verifyLaneDecisionReply(
			validReply({
				selected_option: "Accept scope expansion",
				reply_body: `<!-- immune-brain:run-id=${RUN_ID} --> <!-- immune-brain:record-revision=${REVISION} --> Accept scope expansion`,
			}),
			current,
			OWNER_FACTS,
		);
		expect(byLabel.status).toBe("verified");
		if (byLabel.status === "verified") {
			expect(byLabel.selected_option).toBe("opt-1");
			expect(byLabel.choice.option_id).toBe("opt-1");
		}

		// 4. Reject unoffered option
		const unoffered = verifyLaneDecisionReply(
			validReply({
				selected_option: "arbitrary free text",
				reply_body: `<!-- immune-brain:run-id=${RUN_ID} --> <!-- immune-brain:record-revision=${REVISION} --> arbitrary free text`,
			}),
			current,
			OWNER_FACTS,
		);
		expect(unoffered.status).toBe("ignored");
		if (unoffered.status === "ignored") {
			expect(unoffered.reason).toContain("unoffered_option");
		}

		// 5. Invariant class normalization: unmocked reply_body with HTML routing markers and no selected_option
		const unmockedBody = verifyLaneDecisionReply(
			validReply({
				selected_option: undefined,
				reply_body: `<!-- immune-brain:run-id=${RUN_ID} --> <!-- immune-brain:record-revision=${REVISION} --> opt-1`,
			}),
			current,
			OWNER_FACTS,
		);
		expect(unmockedBody.status).toBe("verified");
		if (unmockedBody.status === "verified") {
			expect(unmockedBody.selected_option).toBe("opt-1");
			expect(unmockedBody.choice.option_id).toBe("opt-1");
		}

		// 6. Multi-word label in unmocked reply_body with markers
		const unmockedLabel = verifyLaneDecisionReply(
			validReply({
				selected_option: undefined,
				reply_body: `<!-- immune-brain:run-id=${RUN_ID} --> <!-- immune-brain:record-revision=${REVISION} --> Accept scope expansion`,
			}),
			current,
			OWNER_FACTS,
		);
		expect(unmockedLabel.status).toBe("verified");
		if (unmockedLabel.status === "verified") {
			expect(unmockedLabel.selected_option).toBe("opt-1");
			expect(unmockedLabel.choice.option_id).toBe("opt-1");
		}

		// 7. #1 token in unmocked reply_body
		const unmockedHashIndex = verifyLaneDecisionReply(
			validReply({
				selected_option: undefined,
				reply_body: `<!-- immune-brain:run-id=${RUN_ID} --> <!-- immune-brain:record-revision=${REVISION} --> #1`,
			}),
			current,
			OWNER_FACTS,
		);
		expect(unmockedHashIndex.status).toBe("verified");
		if (unmockedHashIndex.status === "verified") {
			expect(unmockedHashIndex.selected_option).toBe("opt-1");
			expect(unmockedHashIndex.choice.option_id).toBe("opt-1");
		}

		// 8. Preserves stop intent on matched option when option label is 'Stop' and id is not 'stop'
		const currentWithStopOption = makeFacts({
			options: [
				{ id: "opt-1", label: "Accept scope expansion" },
				{ id: "opt-2", label: "Stop" },
			],
		});
		const matchedStopOption = verifyLaneDecisionReply(
			validReply({
				selected_option: undefined,
				reply_body: `<!-- immune-brain:run-id=${RUN_ID} --> <!-- immune-brain:record-revision=${REVISION} --> opt-2`,
			}),
			currentWithStopOption,
			OWNER_FACTS,
		);
		expect(matchedStopOption.status).toBe("verified");
		if (matchedStopOption.status === "verified") {
			expect(matchedStopOption.operation).toBe("stop");
			expect(matchedStopOption.choice.option_id).toBe("opt-2");
		}

		// 9. When options is absent or empty, 'stop' reply resolves to 'stop'
		const currentNoOptions = makeFacts({ options: [] });
		const stopNoOptions = verifyLaneDecisionReply(
			validReply({
				selected_option: undefined,
				reply_body: `<!-- immune-brain:run-id=${RUN_ID} --> <!-- immune-brain:record-revision=${REVISION} --> stop`,
			}),
			currentNoOptions,
			OWNER_FACTS,
		);
		expect(stopNoOptions.status).toBe("verified");
		if (stopNoOptions.status === "verified") {
			expect(stopNoOptions.operation).toBe("stop");
		}
	});
});

describe("S6 Negative Controls: non-owner or unverified replies are ignored (Table line 274)", () => {
	it("ignores a reply from an actor outside loop.allowed_actors", async () => {
		const current = makeFacts();
		const reply = validReply({ author: "unauthorized-user" });
		const postCalls: string[] = [];
		let relayCalled = false;

		const outcome = await handleLaneDecisionReply(
			reply,
			current,
			{
				guardFacts: OWNER_FACTS,
				postComment: (c) => postCalls.push(c.body),
				relayDecision: async () => {
					relayCalled = true;
					return { relayed: true, result: null, lane_relay: {} as any };
				},
			},
		);

		expect(outcome.action).toBe("ignored");
		expect(relayCalled).toBe(false);
		expect(postCalls.length).toBe(0);
	});

	it("ignores a reply whose author_association is outside loop.allowed_associations", async () => {
		const current = makeFacts();
		const reply = validReply({ author_association: "CONTRIBUTOR" });
		const outcome = await handleLaneDecisionReply(reply, current, { guardFacts: OWNER_FACTS });
		expect(outcome.action).toBe("ignored");
		expect(outcome.reason).toContain("unverified_actor");
	});

	it("ignores a daemon-authored reply even if login is in allowed_actors", async () => {
		const current = makeFacts();
		const reply = validReply({ author: "imm-loop-bot" });
		const outcome = await handleLaneDecisionReply(reply, current, { guardFacts: OWNER_FACTS });
		expect(outcome.action).toBe("ignored");
	});

	it("ignores a reply that was edited after creation", async () => {
		const current = makeFacts();
		const reply = validReply({
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-01T00:05:00.000Z",
		});
		const outcome = await handleLaneDecisionReply(reply, current, { guardFacts: OWNER_FACTS });
		expect(outcome.action).toBe("ignored");
		expect(outcome.reason).toBe("comment_edited");
	});

	it("ignores a reply with a mismatched run_id", async () => {
		const current = makeFacts();
		const reply = validReply({
			run_id: "other-run-id",
			reply_body: `<!-- immune-brain:run-id=other-run-id --> <!-- immune-brain:record-revision=${REVISION} --> ok`,
		});
		const outcome = await handleLaneDecisionReply(reply, current, { guardFacts: OWNER_FACTS });
		expect(outcome.action).toBe("ignored");
		expect(outcome.reason).toContain("run_id_mismatch");
	});

	it("ignores a reply with no run_id marker or field", async () => {
		const current = makeFacts();
		const reply = validReply({
			run_id: undefined,
			reply_body: "Just an ordinary comment with no run ID at all",
		});
		const outcome = await handleLaneDecisionReply(reply, current, { guardFacts: OWNER_FACTS });
		expect(outcome.action).toBe("ignored");
	});
});

describe("S6 Boundary / Fault Controls: stale record_revision rejection (Table line 274)", () => {
	it("rejects a reply referencing a stale record_revision and posts a revision-mismatch notice", async () => {
		const current = makeFacts({ record_revision: REVISION });
		const reply = validReply({
			record_revision: STALE_REVISION,
			reply_body: `<!-- immune-brain:run-id=${RUN_ID} --> <!-- immune-brain:record-revision=${STALE_REVISION} --> Choice A`,
		});

		const postedComments: Array<{ issue_number: number; body: string }> = [];
		let relayCalled = false;

		const outcome = await handleLaneDecisionReply(
			reply,
			current,
			{
				guardFacts: OWNER_FACTS,
				postComment: (c) => postedComments.push(c),
				relayDecision: async () => {
					relayCalled = true;
					return { relayed: true, result: null, lane_relay: {} as any };
				},
			},
		);

		// Negative control on Lane mutation
		expect(relayCalled).toBe(false);
		expect(outcome.action).toBe("rejected_stale");
		expect(outcome.replied_revision).toBe(STALE_REVISION);
		expect(outcome.current_revision).toBe(REVISION);

		// Fault control: posted revision-mismatch notice to the Issue
		expect(postedComments.length).toBe(1);
		expect(postedComments[0]!.issue_number).toBe(465);
		expect(postedComments[0]!.body).toContain(REVISION_MISMATCH_NOTICE_MARKER);
		expect(postedComments[0]!.body).toContain(RUN_ID);
		expect(postedComments[0]!.body).toContain(STALE_REVISION);
		expect(postedComments[0]!.body).toContain(REVISION);

		const parsedNotice = parseRevisionMismatchNotice(postedComments[0]!.body);
		expect(parsedNotice).toEqual({
			run_id: RUN_ID,
			task_id: TASK_ID,
			stale_revision: STALE_REVISION,
			current_revision: REVISION,
		});
	});

	it("does not post duplicate mismatch notices if already notified", async () => {
		const current = makeFacts({ record_revision: REVISION });
		const reply = validReply({
			record_revision: STALE_REVISION,
			reply_body: `<!-- immune-brain:run-id=${RUN_ID} --> <!-- immune-brain:record-revision=${STALE_REVISION} --> Choice A`,
		});

		const existingNotice = renderRevisionMismatchNotice({
			task_id: TASK_ID,
			run_id: RUN_ID,
			replied_revision: STALE_REVISION,
			current_revision: REVISION,
		});

		const existingComments: RawComment[] = [
			{
				id: 99,
				body: existingNotice,
				user: { login: "imm-loop-bot" },
				author_association: "COLLABORATOR",
				created_at: TS,
				updated_at: TS,
			},
		];

		const postedComments: string[] = [];
		const outcome = await handleLaneDecisionReply(
			reply,
			current,
			{
				guardFacts: OWNER_FACTS,
				existingComments,
				postComment: (c) => postedComments.push(c.body),
			},
		);

		expect(outcome.action).toBe("rejected_stale");
		expect(postedComments.length).toBe(0);
	});

	it("catches concurrent LaneDecisionStaleError from relayLaneDecision and posts notice", async () => {
		const current = makeFacts({ record_revision: REVISION });
		const reply = validReply({ record_revision: REVISION });

		const postedComments: string[] = [];
		const outcome = await handleLaneDecisionReply(
			reply,
			current,
			{
				guardFacts: OWNER_FACTS,
				postComment: (c) => postedComments.push(c.body),
				relayDecision: async () => {
					throw new LaneDecisionStaleError("record revision changed concurrently under gate");
				},
			},
			() => ({
				root: "/repo",
				taskId: TASK_ID,
				operation: "request_authorization",
				expectedRecordRevision: REVISION,
				project: async () => ({} as any),
				apply: async () => ({}),
				supervisor: new LaneSupervisor(),
				parentHost: "claude-code",
				pluginDir: "/plugin",
				waitMs: 1000,
			}),
		);

		expect(outcome.action).toBe("rejected_stale");
		expect(outcome.notice_posted).toBe(true);
		expect(postedComments.length).toBe(1);
		expect(postedComments[0]).toContain(REVISION_MISMATCH_NOTICE_MARKER);
	});
});

describe("S6 Positive Control: End-to-End verified owner reply relay (BR-SCN-4, D7)", () => {
	it("relays decision via relayLaneDecision and resumes concurrency lease", async () => {
		const stateDir = tempRoot();
		const hostToken = "token-host-1";

		// 1. Acquire lease and park it on decision
		acquireLoopLease(stateDir, {
			target_id: TASK_ID,
			kind: "drive",
			owner_pid: process.pid,
			host_token: hostToken,
			scope_hint: ["src/mod.ts"],
		});
		parkLoopLeaseForDecision(stateDir, TASK_ID, { host_token: hostToken });
		expect(loadLease(stateDir, TASK_ID)?.status).toBe("parked_for_decision");

		// 2. Verified owner reply arrives with chosen option
		const current = makeFacts({
			record_revision: REVISION,
			options: [
				{ id: "proceed", label: "Proceed with execution" },
				{ id: "stop", label: "Stop task" },
			],
		});
		const reply = validReply({
			author: "dereknex",
			author_association: "OWNER",
			run_id: RUN_ID,
			record_revision: REVISION,
			selected_option: "proceed",
		});

		let relayInvokedWith: { operation: LaneDecisionOperation; expectedRevision?: string; optionId?: string } | null = null;

		const outcome = await handleLaneDecisionReply(
			reply,
			current,
			{
				guardFacts: OWNER_FACTS,
				stateDir,
				hostToken,
				relayDecision: async (input: LaneRelayInput<any>) => {
					relayInvokedWith = {
						operation: input.operation,
						expectedRevision: input.expectedRecordRevision,
						optionId: (input as any).extra?.chosen_option,
					};
					return {
						relayed: true,
						result: { success: true },
						lane_relay: {
							batch_id: "batch-s6",
							operation: input.operation,
							applied: true,
							rebound: false,
							lane_supervision: { state: "running" },
						},
					};
				},
			},
			(operation, rev, choice) => ({
				root: "/repo",
				taskId: TASK_ID,
				operation,
				expectedRecordRevision: rev,
				project: async () => ({} as any),
				apply: async () => ({ success: true }),
				supervisor: new LaneSupervisor(),
				parentHost: "claude-code",
				pluginDir: "/plugin",
				waitMs: 5000,
				extra: { chosen_option: choice.option_id },
			} as any),
		);

		// Assert relay invoked with matching revision, operation, and chosen option
		expect(outcome.action).toBe("relayed");
		expect(outcome.choice?.option_id).toBe("proceed");
		expect(relayInvokedWith).toEqual({
			operation: "request_authorization",
			expectedRevision: REVISION,
			optionId: "proceed",
		});

		// Assert lease resumed from parked_for_decision back to active
		const resumedLease = loadLease(stateDir, TASK_ID);
		expect(resumedLease?.status).toBe("active");
		expect(outcome.lease?.status).toBe("active");
	});

	it("refuses to report relay or resume lease when relayInputFactory is omitted (Finding review-2)", async () => {
		const stateDir = tempRoot();
		const hostToken = "token-host-1";

		acquireLoopLease(stateDir, {
			target_id: TASK_ID,
			kind: "drive",
			owner_pid: process.pid,
			host_token: hostToken,
			scope_hint: ["src/mod.ts"],
		});
		parkLoopLeaseForDecision(stateDir, TASK_ID, { host_token: hostToken });
		expect(loadLease(stateDir, TASK_ID)?.status).toBe("parked_for_decision");

		const current = makeFacts({ record_revision: REVISION });
		const reply = validReply();

		// Calling without relayInputFactory must strictly throw and never fabricate success or resume lease
		await expect(
			handleLaneDecisionReply(
				reply,
				current,
				{
					guardFacts: OWNER_FACTS,
					stateDir,
					hostToken,
				},
				// relayInputFactory explicitly omitted
			),
		).rejects.toThrow(/relay_input_factory_required/);

		// Lease must remain parked_for_decision
		const unchangedLease = loadLease(stateDir, TASK_ID);
		expect(unchangedLease?.status).toBe("parked_for_decision");
	});
});
