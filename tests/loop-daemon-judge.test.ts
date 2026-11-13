/**
 * Loop Daemon: Judgement Ladder Tests (S2)
 *
 * Verifies S2-AC1 under docs/plans/loop-daemon-s2-judge.intent.json and
 * S2 / D2 in docs/specs/loop-daemon.spec.md (BR-REQ-2, BR-SCN-1):
 * - Positive Control: guards G1-G10, rule matchers, and the decision-model
 *   points a14/a15/a18/a19/a20 select expected handlers from the 15-handler
 *   catalogue and emit assurance_kernel/loop_decision_record/v1 records.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LOOP_DECISION_RECORD_CONTRACT, LOOP_DAEMON_EVENT_CONTRACT } from "../plugins/immune-brain/runtime/loop_daemon/types.ts";
import type {
	E1NewIssueEvent,
	E3OwnerCommentEvent,
	E4PlanApprovedEvent,
	E5ReadyTaskEvent,
	E6LaneDecisionNeededEvent,
	E7LaneDecisionRepliedEvent,
	E8PRCheckFailedEvent,
	E9PRConflictEvent,
	E10PRReviewCommentEvent,
	E11PRReadyOrMergedEvent,
	E2IssueEditedEvent,
	ObservationInput,
} from "../plugins/immune-brain/runtime/loop_daemon/types.ts";
import { LOOP_HANDLERS, isLoopHandler } from "../plugins/immune-brain/runtime/loop_daemon/handlers.ts";
import {
	type GuardFacts,
	type GuardId,
	evaluateGuards,
	eventTarget,
	repairKey,
} from "../plugins/immune-brain/runtime/loop_daemon/guards.ts";
import {
	type ClassifyFn,
	MIN_CLASSIFIER_CONFIDENCE,
	createDecisionModelClassifier,
	judgeEvent,
	judgeEvents,
} from "../plugins/immune-brain/runtime/loop_daemon/judgement.ts";
import { APPLICATION_POINTS, POINT_REGISTRY } from "../plugins/immune-brain/runtime/decision_model/contract.ts";
import { buildDecisionRecord, decisionId } from "../plugins/immune-brain/runtime/loop_daemon/decision_record.ts";
import { runLoopDaemonCli } from "../plugins/immune-brain/runtime/loop_daemon/cli.ts";
import type { LoopLease } from "../plugins/immune-brain/runtime/loop_daemon/types.ts";

const TS = "2026-01-01T00:00:00.000Z";
const contract = LOOP_DAEMON_EVENT_CONTRACT;

function issueEvent(overrides: Partial<E1NewIssueEvent> = {}): E1NewIssueEvent {
	return {
		contract,
		event_id: "evt-e1-10",
		kind: "E1_NEW_ISSUE",
		timestamp: TS,
		issue_number: 10,
		title: "Add a widget",
		body: "Please add a widget.",
		author: "dev",
		labels: [],
		created_at: TS,
		updated_at: TS,
		...overrides,
	};
}

function editedEvent(overrides: Partial<E2IssueEditedEvent> = {}): E2IssueEditedEvent {
	return {
		contract,
		event_id: "evt-e2-10",
		kind: "E2_ISSUE_EDITED",
		timestamp: TS,
		issue_number: 10,
		title: "Add a widget",
		body: "Please add a widget, revised.",
		author: "dev",
		labels: [],
		updated_at: TS,
		...overrides,
	};
}

function commentEvent(overrides: Partial<E3OwnerCommentEvent> = {}): E3OwnerCommentEvent {
	return {
		contract,
		event_id: "evt-e3-10",
		kind: "E3_OWNER_COMMENT",
		timestamp: TS,
		issue_number: 10,
		comment_id: 900,
		author: "owner",
		author_association: "OWNER",
		body: "Looks good to me.",
		created_at: TS,
		updated_at: TS,
		...overrides,
	};
}

function approvalEvent(overrides: Partial<E4PlanApprovedEvent> = {}): E4PlanApprovedEvent {
	return {
		contract,
		event_id: "evt-e4-10-900",
		kind: "E4_PLAN_APPROVED",
		timestamp: TS,
		issue_number: 10,
		comment_id: 900,
		author: "owner",
		author_association: "OWNER",
		plan_digest: "sha256:plan-a",
		approved_at: TS,
		...overrides,
	};
}

function readyEvent(overrides: Partial<E5ReadyTaskEvent> = {}): E5ReadyTaskEvent {
	return {
		contract,
		event_id: "evt-e5-10",
		kind: "E5_READY_TASK",
		timestamp: TS,
		issue_number: 10,
		task_id: "widget-task",
		...overrides,
	};
}

function laneNeededEvent(overrides: Partial<E6LaneDecisionNeededEvent> = {}): E6LaneDecisionNeededEvent {
	return {
		contract,
		event_id: "evt-e6-run-1-rev-1",
		kind: "E6_LANE_DECISION_NEEDED",
		timestamp: TS,
		task_id: "widget-task",
		run_id: "run-1",
		record_revision: "rev-1",
		question: "Widen the scope?",
		options: [{ id: "yes", label: "Yes" }],
		...overrides,
	};
}

function laneRepliedEvent(overrides: Partial<E7LaneDecisionRepliedEvent> = {}): E7LaneDecisionRepliedEvent {
	return {
		contract,
		event_id: "evt-e7-10-901",
		kind: "E7_LANE_DECISION_REPLIED",
		timestamp: TS,
		issue_number: 10,
		comment_id: 901,
		author: "owner",
		author_association: "OWNER",
		run_id: "run-1",
		record_revision: "rev-1",
		selected_option: "yes",
		reply_body: "yes",
		...overrides,
	};
}

function checkFailedEvent(overrides: Partial<E8PRCheckFailedEvent> = {}): E8PRCheckFailedEvent {
	return {
		contract,
		event_id: "evt-e8-20-check",
		kind: "E8_PR_CHECK_FAILED",
		timestamp: TS,
		pr_number: 20,
		branch: "imm/widget-task",
		head_sha: "abc123",
		check_name: "unit",
		failure_signature: "sig-1",
		...overrides,
	};
}

function conflictEvent(overrides: Partial<E9PRConflictEvent> = {}): E9PRConflictEvent {
	return {
		contract,
		event_id: "evt-e9-20-abc123",
		kind: "E9_PR_CONFLICT",
		timestamp: TS,
		pr_number: 20,
		branch: "imm/widget-task",
		base_branch: "main",
		head_sha: "abc123",
		...overrides,
	};
}

function reviewCommentEvent(overrides: Partial<E10PRReviewCommentEvent> = {}): E10PRReviewCommentEvent {
	return {
		contract,
		event_id: "evt-e10-20-902",
		kind: "E10_PR_REVIEW_COMMENT",
		timestamp: TS,
		pr_number: 20,
		branch: "imm/widget-task",
		comment_id: 902,
		author: "reviewer",
		author_association: "MEMBER",
		body: "This breaks the invoice total.",
		...overrides,
	};
}

function prStateEvent(overrides: Partial<E11PRReadyOrMergedEvent> = {}): E11PRReadyOrMergedEvent {
	return {
		contract,
		event_id: "evt-e11-20-abc123-ready",
		kind: "E11_PR_READY_OR_MERGED",
		timestamp: TS,
		pr_number: 20,
		branch: "imm/widget-task",
		head_sha: "abc123",
		status: "ready",
		...overrides,
	};
}

function lease(targetId: string): LoopLease {
	return {
		contract: "assurance_kernel/loop_daemon_lease/v1",
		target_id: targetId,
		kind: "drive",
		owner_pid: 1234,
		host_token: "test",
		acquired_at: TS,
		heartbeat_at: TS,
		status: "active",
	};
}

/** Facts a configured daemon supplies: the actor allowlist and the published evidence G8 compares against. */
const OWNER_FACTS: GuardFacts = {
	allowed_actors: ["owner"],
	allowed_associations: ["OWNER", "MEMBER", "COLLABORATOR"],
	expected_plan_digest: "sha256:plan-a",
	expected_record_revision: "rev-1",
};
const REVIEWER_FACTS: GuardFacts = {
	allowed_actors: ["reviewer"],
	allowed_associations: ["OWNER", "MEMBER", "COLLABORATOR"],
};

interface FakeClassifier {
	classify: ClassifyFn;
	calls: string[];
}

type Answer = { choice: string; confidence: number } | "unavailable" | "throw";

function fakeClassifier(answers: Record<string, Answer>): FakeClassifier {
	const calls: string[] = [];
	const classify: ClassifyFn = async (point) => {
		calls.push(point);
		const answer = answers[point];
		if (answer === "throw") throw new Error("classifier exploded");
		if (answer === undefined || answer === "unavailable") {
			return { status: "unavailable", reason: "no_local_config", detail: "test double" };
		}
		return { status: "decided", choice: answer.choice, confidence: answer.confidence };
	};
	return { classify, calls };
}

const tempRoots: string[] = [];

function makeRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "loop-s2-judge-"));
	tempRoots.push(root);
	return root;
}

afterEach(() => {
	while (tempRoots.length > 0) {
		const root = tempRoots.pop();
		if (root) rmSync(root, { recursive: true, force: true });
	}
});

describe("closed 15-handler catalogue", () => {
	it("holds exactly the 15 documented handlers", () => {
		expect(LOOP_HANDLERS.length).toBe(15);
		expect([...LOOP_HANDLERS]).toEqual([
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
		]);
	});

	it("rejects a handler name outside the catalogue", () => {
		expect(isLoopHandler("triage_issue")).toBe(true);
		expect(isLoopHandler("delete_repository")).toBe(false);
	});

	it("registers the decision-model points the ladder uses", () => {
		for (const point of ["a14_ambiguous_user_intent", "a15_task_granularity", "a18_event_prefilter", "a19_owner_comment_intent", "a20_issue_duplicate_pair"]) {
			expect(APPLICATION_POINTS).toContain(point as never);
			expect(POINT_REGISTRY[point]).toBeDefined();
		}
		expect(POINT_REGISTRY.a15_task_granularity?.options).toEqual(["clear_single_task", "needs_initiative_decomposition", "needs_clarification"]);
		expect(POINT_REGISTRY.a14_ambiguous_user_intent?.options).toEqual(["clear_single_task", "needs_initiative_decomposition", "needs_clarification"]);
	});
});

describe("Tier 0: deterministic code guards G1-G10", () => {
	const cases: Array<{ guard: GuardId; event: ReturnType<typeof issueEvent> | ReturnType<typeof readyEvent> | ReturnType<typeof approvalEvent> | ReturnType<typeof checkFailedEvent>; facts: GuardFacts }> = [
		{ guard: "G1", event: issueEvent(), facts: { paused: true } },
		{ guard: "G2", event: issueEvent(), facts: { budget_exhausted: true } },
		{ guard: "G3", event: issueEvent(), facts: { target_paths: ["docs/agents/no-touch.json"] } },
		{ guard: "G4", event: readyEvent({ issue_number: 42 }), facts: { active_leases: { "issue-42": lease("issue-42") } } },
		{
			guard: "G5",
			event: checkFailedEvent(),
			facts: { retry_counts: { [repairKey("abc123", "sig-1")]: 2 }, retry_cap: 2 },
		},
		{ guard: "G6", event: issueEvent({ blocked_by: [7] }), facts: {} },
		{ guard: "G7", event: approvalEvent({ author: "drive-by", author_association: "NONE" }), facts: {} },
		{
			guard: "G8",
			event: approvalEvent({ plan_digest: "sha256:stale" }),
			facts: { allowed_actors: ["owner"], expected_plan_digest: "sha256:plan-a" },
		},
		{ guard: "G9", event: issueEvent(), facts: { worktree_dirty: true } },
		{ guard: "G10", event: readyEvent(), facts: { identity_posture: "degraded", confirmation_source: "policy_auto" } },
	];

	for (const testCase of cases) {
		it(`${testCase.guard} blocks before any tier-1 or tier-2 rule runs`, async () => {
			const verdicts = evaluateGuards(testCase.event, testCase.facts);
			const verdict = verdicts.find((entry) => entry.guard === testCase.guard);
			expect(verdict?.blocked).toBe(true);

			const classifier = fakeClassifier({});
			const judgement = await judgeEvent(testCase.event, { facts: testCase.facts, classify: classifier.classify });
			expect(judgement.tier).toBe(0);
			expect(judgement.guard?.id).toBe(testCase.guard);
			expect(classifier.calls).toEqual([]);
			expect(isLoopHandler(judgement.handler)).toBe(true);
		});
	}

	it("allows a clean event through every applicable guard", async () => {
		const verdicts = evaluateGuards(issueEvent(), {});
		expect(verdicts.map((entry) => entry.guard)).toEqual(["G1", "G2", "G3", "G4", "G6", "G8", "G9", "G10"]);
		expect(verdicts.filter((entry) => entry.blocked)).toEqual([]);
	});

	it("G7 fails closed when no actor allowlist is configured", async () => {
		const unconfigured = await judgeEvent(approvalEvent({ author: "collaborator", author_association: "COLLABORATOR" }), {
			facts: { expected_plan_digest: "sha256:plan-a" },
		});
		expect(unconfigured.tier).toBe(0);
		expect(unconfigured.guard?.id).toBe("G7");

		const configured = await judgeEvent(approvalEvent({ author: "collaborator", author_association: "COLLABORATOR" }), {
			facts: { allowed_actors: ["collaborator"], expected_plan_digest: "sha256:plan-a" },
		});
		expect(configured.tier).toBe(1);
		expect(configured.handler).toBe("enroll_and_drive");
	});

	it("G8 fails closed when no published digest or revision is known", async () => {
		const unbound = await judgeEvent(approvalEvent(), { facts: { allowed_actors: ["owner"] } });
		expect(unbound.tier).toBe(0);
		expect(unbound.guard?.id).toBe("G8");
		expect(unbound.reason).toContain("no published plan digest");

		const unboundReply = await judgeEvent(laneRepliedEvent(), { facts: { allowed_actors: ["owner"] } });
		expect(unboundReply.tier).toBe(0);
		expect(unboundReply.guard?.id).toBe("G8");
		expect(unboundReply.reason).toContain("no current record revision");
	});

	it("lets G10 block only policy_auto, and only while degraded", () => {
		const degradedAuto = evaluateGuards(readyEvent(), { identity_posture: "degraded", confirmation_source: "policy_auto" });
		expect(degradedAuto.find((entry) => entry.guard === "G10")?.blocked).toBe(true);
		const degradedOwner = evaluateGuards(readyEvent(), { identity_posture: "degraded", confirmation_source: "tracker_approval" });
		expect(degradedOwner.find((entry) => entry.guard === "G10")?.blocked).toBe(false);
		const isolatedAuto = evaluateGuards(readyEvent(), { identity_posture: "isolated", confirmation_source: "policy_auto" });
		expect(isolatedAuto.find((entry) => entry.guard === "G10")?.blocked).toBe(false);
	});
});

describe("Tier 1: deterministic rule matchers", () => {
	const cases: Array<{ name: string; event: Parameters<typeof judgeEvent>[0]; handler: string; facts?: GuardFacts }> = [
		{ name: "blocked label", event: issueEvent({ labels: ["blocked"] }), handler: "noop_record" },
		{ name: "ready-for-agent label", event: issueEvent({ labels: ["ready-for-agent"] }), handler: "enroll_and_drive" },
		{ name: "edited issue marked blocked", event: editedEvent({ labels: ["blocked"] }), handler: "noop_record" },
		{ name: "verified @imm-loop replan", event: commentEvent({ body: "@imm-loop replan please" }), handler: "draft_plan", facts: OWNER_FACTS },
		{ name: "verified @imm-loop retry", event: commentEvent({ body: "@imm-loop retry" }), handler: "repair_pr_ci", facts: OWNER_FACTS },
		{ name: "verified @imm-loop ignore", event: commentEvent({ body: "@imm-loop ignore" }), handler: "noop_record", facts: OWNER_FACTS },
		{ name: "plan approval marker", event: approvalEvent(), handler: "enroll_and_drive", facts: OWNER_FACTS },
		{ name: "ready task", event: readyEvent(), handler: "enroll_and_drive" },
		{ name: "parked lane decision", event: laneNeededEvent(), handler: "relay_lane_decision_question" },
		{ name: "lane decision reply", event: laneRepliedEvent(), handler: "apply_lane_decision_reply", facts: OWNER_FACTS },
		{ name: "failed check", event: checkFailedEvent(), handler: "repair_pr_ci" },
		{ name: "merge conflict", event: conflictEvent(), handler: "repair_pr_conflict" },
		{ name: "ready PR", event: prStateEvent(), handler: "mark_pr_ready" },
		{ name: "merged PR", event: prStateEvent({ status: "merged" }), handler: "close_out" },
	];

	for (const testCase of cases) {
		it(`selects ${testCase.handler} for ${testCase.name} without consulting a model`, async () => {
			const classifier = fakeClassifier({});
			const judgement = await judgeEvent(testCase.event, { facts: testCase.facts, classify: classifier.classify });
			expect(judgement.tier).toBe(1);
			expect(judgement.handler).toBe(testCase.handler as never);
			expect(classifier.calls).toEqual([]);
		});
	}
});

describe("Tier 2: decision-model points", () => {
	it("a19 yields a format reminder (never enroll_and_drive) when an owner comment looks like approve_plan", async () => {
		const classifier = fakeClassifier({
			a18_event_prefilter: { choice: "actionable", confidence: 0.9 },
			a19_owner_comment_intent: { choice: "approve_plan", confidence: 0.88 },
		});
		const judgement = await judgeEvent(commentEvent(), { facts: OWNER_FACTS, classify: classifier.classify });
		expect(judgement.tier).toBe(2);
		expect(judgement.handler).toBe("escalate");
		expect(judgement.escalation_key).toBe("a19_format_reminder:issue:10:comment:900");
		expect(judgement.classification).toEqual({ point: "a19_owner_comment_intent", choice: "approve_plan", confidence: 0.88 });
		expect(classifier.calls).toEqual(["a18_event_prefilter", "a19_owner_comment_intent"]);
	});

	it("a19 maps every intent option onto one catalogue handler", async () => {
		const expectations: Array<[string, string]> = [
			["approve_plan", "escalate"],
			["request_plan_revision", "draft_plan"],
			["answer_lane_decision", "apply_lane_decision_reply"],
			["command", "escalate"],
			["discussion", "noop_record"],
		];
		for (const [choice, handler] of expectations) {
			const classifier = fakeClassifier({
				a18_event_prefilter: { choice: "actionable", confidence: 0.9 },
				a19_owner_comment_intent: { choice, confidence: 0.9 },
			});
			const judgement = await judgeEvent(commentEvent(), { facts: OWNER_FACTS, classify: classifier.classify });
			expect(judgement.handler).toBe(handler as never);
		}
	});

	it("a18 silence-triages a noisy comment before a19", async () => {
		const classifier = fakeClassifier({ a18_event_prefilter: { choice: "ignore", confidence: 0.95 } });
		const judgement = await judgeEvent(commentEvent({ body: "thanks!" }), { facts: OWNER_FACTS, classify: classifier.classify });
		expect(judgement.tier).toBe(2);
		expect(judgement.handler).toBe("noop_record");
		expect(classifier.calls).toEqual(["a18_event_prefilter"]);
	});

	it("a14_pr_comment_triage maps every option onto one catalogue handler", async () => {
		const expectations: Array<[string, string]> = [
			["blocking", "address_pr_review"],
			["nit", "address_pr_review"],
			["out_of_scope", "escalate"],
			["duplicate", "noop_record"],
		];
		for (const [choice, handler] of expectations) {
			const classifier = fakeClassifier({ a14_pr_comment_triage: { choice, confidence: 0.9 } });
			const judgement = await judgeEvent(reviewCommentEvent(), { facts: REVIEWER_FACTS, classify: classifier.classify });
			expect(judgement.handler).toBe(handler as never);
			expect(judgement.classification).toEqual({ point: "a14_pr_comment_triage", choice, confidence: 0.9 });
		}
	});

	it("a18 then a15_task_granularity triage an unlabelled issue", async () => {
		const classifier = fakeClassifier({
			a18_event_prefilter: { choice: "actionable", confidence: 0.9 },
			a15_task_granularity: { choice: "clear_single_task", confidence: 0.8 },
		});
		const judgement = await judgeEvent(issueEvent(), { classify: classifier.classify });
		expect(judgement.tier).toBe(2);
		expect(judgement.handler).toBe("triage_issue");
		expect(classifier.calls).toEqual(["a18_event_prefilter", "a15_task_granularity"]);
	});

	it("a15_task_granularity maps all three outcomes", async () => {
		const expectations: Array<[string, string]> = [
			["clear_single_task", "triage_issue"],
			["needs_initiative_decomposition", "draft_plan"],
			["needs_clarification", "escalate"],
		];
		for (const [choice, handler] of expectations) {
			const classifier = fakeClassifier({
				a18_event_prefilter: { choice: "actionable", confidence: 0.9 },
				a15_task_granularity: { choice, confidence: 0.8 },
			});
			const judgement = await judgeEvent(issueEvent(), { classify: classifier.classify });
			expect(judgement.handler).toBe(handler as never);
			expect(judgement.classification).toEqual({ point: "a15_task_granularity", choice, confidence: 0.8 });
		}
	});

	it("a20 evaluates a duplicate candidate pair before planning", async () => {
		const facts: GuardFacts = { duplicate_candidate: { number: 3, title: "Add a widget", body: "widget" } };
		const duplicate = fakeClassifier({
			a18_event_prefilter: { choice: "actionable", confidence: 0.9 },
			a20_issue_duplicate_pair: { choice: "duplicate", confidence: 0.9 },
		});
		const dupJudgement = await judgeEvent(issueEvent(), { facts, classify: duplicate.classify });
		expect(dupJudgement.handler).toBe("escalate");
		expect(dupJudgement.classification?.point).toBe("a20_issue_duplicate_pair");

		const unrelated = fakeClassifier({
			a18_event_prefilter: { choice: "actionable", confidence: 0.9 },
			a20_issue_duplicate_pair: { choice: "unrelated", confidence: 0.9 },
			a15_task_granularity: { choice: "clear_single_task", confidence: 0.9 },
		});
		const freshJudgement = await judgeEvent(issueEvent(), { facts, classify: unrelated.classify });
		expect(freshJudgement.handler).toBe("triage_issue");
	});
});

describe("Tier 3: escalation fallback and baseline behaviour", () => {
	it("escalates a classification below the point threshold when no judging agent is present", async () => {
		const classifier = fakeClassifier({
			a18_event_prefilter: { choice: "actionable", confidence: 0.9 },
			a19_owner_comment_intent: { choice: "request_plan_revision", confidence: 0.55 },
		});
		const judgement = await judgeEvent(commentEvent(), { facts: OWNER_FACTS, classify: classifier.classify });
		expect(judgement.tier).toBe(3);
		expect(judgement.handler).toBe("escalate");
	});

	it("keeps the D12 baseline behaviour when the decision model and judging agent are unavailable", async () => {
		const unavailable = fakeClassifier({});
		const reviewComment = await judgeEvent(reviewCommentEvent(), { facts: REVIEWER_FACTS, classify: unavailable.classify });
		expect(reviewComment.tier).toBe(3);
		expect(reviewComment.handler).toBe("address_pr_review");

		const triage = await judgeEvent(issueEvent(), { classify: unavailable.classify });
		expect(triage.tier).toBe(3);
		expect(triage.handler).toBe("escalate");

		const comment = await judgeEvent(commentEvent(), { facts: OWNER_FACTS, classify: unavailable.classify });
		expect(comment.tier).toBe(3);
		expect(comment.handler).toBe("escalate");
	});

	it("treats a throwing classifier as unavailable rather than crashing the tick", async () => {
		const classifier = fakeClassifier({ a14_pr_comment_triage: "throw" });
		const judgement = await judgeEvent(reviewCommentEvent(), { facts: REVIEWER_FACTS, classify: classifier.classify });
		expect(judgement.handler).toBe("address_pr_review");
		expect(judgement.tier).toBe(3);
	});

	it("resolves the production classifier seam without throwing and reports unavailable offline", async () => {
		const root = makeRoot();
		const classify = createDecisionModelClassifier(root, {
			env: {},
			fetch: async () => {
				throw new Error("offline");
			},
		});
		const result = await classify("a18_event_prefilter", { title: "Add a widget" });
		expect(result.status).toBe("unavailable");
		if (result.status === "unavailable") expect(result.reason).toBe("no_local_config");
	});

	it("escalates an unknown event kind instead of guessing", async () => {
		const orphan = { ...issueEvent(), kind: "E12_UNKNOWN" as never };
		const judgement = await judgeEvent(orphan, { classify: fakeClassifier({}).classify });
		expect(judgement.tier).toBe(3);
		expect(judgement.handler).toBe("escalate");
	});
});

describe("loop_decision_record/v1 emission", () => {
	it("builds a deterministic record for one judgement", async () => {
		const event = issueEvent();
		const judgement = await judgeEvent(event, { classify: fakeClassifier({}).classify });
		const record = buildDecisionRecord(event, judgement, eventTarget(event), { recorded_at: TS, dry_run: true });

		expect(record.contract).toBe(LOOP_DECISION_RECORD_CONTRACT);
		expect(record.handler).toBe("escalate");
		expect(record.mutations).toEqual([]);
		expect(record.dry_run).toBe(true);
		expect(record.decision_id).toBe(decisionId(event.event_id, judgement.handler, judgement.tier));
		expect(buildDecisionRecord(event, judgement, eventTarget(event), { recorded_at: "later", dry_run: true }).decision_id).toBe(record.decision_id);
	});

	it("emits records during imm-loop tick --dry-run and writes no state", async () => {
		const root = makeRoot();
		const snapshot: ObservationInput = {
			issues: [
				{
					id: 1,
					number: 10,
					title: "Add a widget",
					body: "Please add a widget.",
					state: "open",
					created_at: TS,
					updated_at: TS,
					author: { login: "dev" },
					labels: [],
				},
			],
			pull_requests: [],
			observed_at: TS,
		};
		const classifier = fakeClassifier({
			a18_event_prefilter: { choice: "actionable", confidence: 0.9 },
			a15_task_granularity: { choice: "clear_single_task", confidence: 0.9 },
		});

		const result = await runLoopDaemonCli(["tick", "--dry-run", "--json"], root, {
			snapshotOverride: snapshot,
			classify: classifier.classify,
		});
		expect(result.returncode).toBe(0);

		const payload = JSON.parse(result.stdout);
		expect(payload.dry_run).toBe(true);
		expect(payload.decisions_count).toBe(payload.events_count);
		expect(payload.decisions.length).toBeGreaterThan(0);
		for (const decision of payload.decisions) {
			expect(decision.contract).toBe(LOOP_DECISION_RECORD_CONTRACT);
			expect(isLoopHandler(decision.handler)).toBe(true);
			expect(decision.dry_run).toBe(true);
			expect(decision.mutations).toEqual([]);
		}
		expect(payload.decisions.map((entry: { handler: string }) => entry.handler)).toContain("triage_issue");
		expect(existsSync(join(root, ".imm/state/loop/decisions.jsonl"))).toBe(false);
		expect(existsSync(join(root, ".imm/state/loop/state.json"))).toBe(false);
	});

	it("judges every event of a mixed observation exactly once", async () => {
		const judgements = await judgeEvents([issueEvent(), readyEvent(), checkFailedEvent()], {
			classify: fakeClassifier({}).classify,
		});
		expect(judgements.length).toBe(3);
		for (const judgement of judgements) expect(isLoopHandler(judgement.handler)).toBe(true);
	});
});
