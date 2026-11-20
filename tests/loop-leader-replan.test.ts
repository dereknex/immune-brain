/**
 * Loop Leader: replanning and the replan cap (S4-AC1)
 *
 * Verifies S4-AC1 under docs/specs/loop-leader.spec.md D4.1-D4.3 (BR-REQ-4,
 * BR-DEC-10):
 * - a `resume` on a transiently escalated target resumes its still-running
 *   batch and posts no owner question; a `release` moves `escalated -> triage`;
 * - every accepted `resume`, `release` or `replan` increments `replan_rounds`;
 * - negative: a pending `material`/`critical` approval, a breaking Intent
 *   revision, an open user decision, a parked batch and a `literal_user` Lane
 *   decision reject `resume`/`release`/`replan`; only `ask_owner` is accepted;
 * - bound: a target that re-escalates after three accepted rounds is forced to
 *   `ask_owner` with reason `replan_cap_reached`.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyLeaderProposal, type LeaderDispatchDeps } from "../plugins/immune-brain/runtime/loop_daemon/leader_dispatch.ts";
import { readLeaderJournal } from "../plugins/immune-brain/runtime/loop_daemon/leader_journal.ts";
import type { LeaderProposalItem } from "../plugins/immune-brain/runtime/loop_daemon/leader_proposal.ts";
import { seedLaneBatch } from "./helpers/loop-leader-batch.ts";
import {
	batchStateForTarget,
	collectResolveFacts,
	pendingLaneEntryBlocked,
	pendingLiteralUserRequests,
	REPLAN_CAP,
	resolveBlockers,
	type ResolveFacts,
} from "../plugins/immune-brain/runtime/loop_daemon/replan.ts";
import { createLocalInteractionChannel } from "../plugins/immune-brain/runtime/loop_daemon/interaction/local_channel.ts";
import { laneDecisionInteractionRequest } from "../plugins/immune-brain/runtime/loop_daemon/interaction/local_channel.ts";
import { listRoleSessions } from "../plugins/immune-brain/runtime/loop_daemon/role_sessions.ts";
import { defaultLoopRole, type ResolvedLoopRole } from "../plugins/immune-brain/runtime/loop_daemon/role_catalog.ts";
import { newWorkItem, readWorkItem, writeWorkItem } from "../plugins/immune-brain/runtime/loop_daemon/work_items.ts";
import type { AskOwnerResult } from "../plugins/immune-brain/runtime/loop_daemon/replan.ts";
import { renderEscalationBody } from "../plugins/immune-brain/runtime/loop_daemon/escalation.ts";
import { INTERACTION_WITHDRAWN_MARKER, isWithdrawn } from "../plugins/immune-brain/runtime/loop_daemon/interaction/github_channel.ts";

const NOW = "2026-11-17T10:00:00.000Z";
const TASK = "s4-lane-task";

const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const cleanup of cleanups) cleanup();
	cleanups.length = 0;
});

function workspace(): { root: string; stateDir: string } {
	const root = mkdtempSync(join(tmpdir(), "imm-leader-replan-"));
	cleanups.push(() => rmSync(root, { recursive: true, force: true }));
	execFileSync("git", ["init", "-q", root]);
	mkdirSync(join(root, ".imm/state/loop"), { recursive: true });
	writeFileSync(
		join(root, ".imm/config.json"),
		`${JSON.stringify({ contract: "immune_brain/project_config/v2", loop: { mode: "assist" } }, null, 2)}\n`,
	);
	return { root, stateDir: join(root, ".imm/state/loop") };
}

const GUARD_FACTS = { allowed_actors: ["owner"], allowed_associations: ["OWNER"], daemon_identity: "imm-bot" };

const CONTEXT = {
	blocked_on: "the Lane keeps stopping on the same transient blocker",
	tried: ["resumed the batch twice"],
	options: [{ id: "resume", label: "Resume", consequence: "the batch continues on the same plan" }],
	evidence: [{ label: "run", ref: "https://example.test/run/1" }],
};

const NO_FACTS: ResolveFacts = { batch_state: null, pending_literal_user: [], task_records: [] };

interface Recorded {
	ask_owner: Array<{ target: string; pending: number }>;
	resumed: string[];
}

function deps(
	ws: { root: string; stateDir: string },
	recorded: Recorded,
	overrides: Partial<LeaderDispatchDeps> = {},
): LeaderDispatchDeps {
	return {
		root: ws.root,
		stateDir: ws.stateDir,
		now: NOW,
		dry_run: false,
		fingerprint: "sha256:test",
		roles: [defaultLoopRole("leader"), defaultLoopRole("plan")],
		guardFacts: GUARD_FACTS,
		events: [],
		candidates: [],
		max_concurrent: 3,
		dispatches_today: 0,
		max_dispatches_per_day: null,
		runNext: async () => [],
		planInitiative: async () => null,
		runKernel: () => ({ exit_code: 1, json: { reason: "kernel_unavailable" } }),
		startSession: async () => ({ completed: true, reason: "completed: plan drafted" }),
		resolveFacts: async () => NO_FACTS,
		resumeBatch: ({ target }) => {
			recorded.resumed.push(target);
			return { resumed: true, reason: "batch s4-batch is running" };
		},
		askOwner: async ({ target, pending_literal_user }): Promise<AskOwnerResult> => {
			recorded.ask_owner.push({ target, pending: pending_literal_user.length });
			return { action: "posted", interaction_id: `ask-owner:${target}`, link: "https://example.test/issue/42#issuecomment-7" };
		},
		...overrides,
	};
}

function escalated(
	ws: { stateDir: string },
	target: string,
	overrides: { replan_rounds?: number; task_ids?: string[] } = {},
) {
	const item = newWorkItem(target, "escalated", NOW);
	writeWorkItem(ws.stateDir, {
		...item,
		binding: { ...item.binding, task_ids: overrides.task_ids ?? [] },
		...(overrides.replan_rounds === undefined ? {} : { replan_rounds: overrides.replan_rounds }),
	});
	return readWorkItem(ws.stateDir, target)!;
}

function resolveItem(target: string, kind: "resume" | "release" | "replan" | "ask_owner"): LeaderProposalItem {
	return kind === "ask_owner"
		? { target, action: "resolve", kind, context: CONTEXT }
		: { target, action: "resolve", kind };
}

describe("Loop Leader: replanning (S4-AC1)", () => {
	it("resumes a transiently escalated Lane batch without posting an owner question", async () => {
		const ws = workspace();
		const target = `lane-${TASK}`;
		escalated(ws, target, { task_ids: [TASK] });
		const recorded: Recorded = { ask_owner: [], resumed: [] };

		const results = await applyLeaderProposal([resolveItem(target, "resume")], deps(ws, recorded));

		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({ action: "resolve", outcome: "accepted" });
		expect(recorded.resumed).toEqual([target]);
		expect(recorded.ask_owner).toEqual([]);
		const item = readWorkItem(ws.stateDir, target)!;
		// The item returns to its running batch instead of waiting on the owner.
		expect(item.state).toBe("driving");
		expect(item.replan_rounds).toBe(1);
	});

	it("releases an escalated item to triage and counts the round", async () => {
		const ws = workspace();
		const target = "issue-42";
		escalated(ws, target);
		const recorded: Recorded = { ask_owner: [], resumed: [] };

		const results = await applyLeaderProposal([resolveItem(target, "release")], deps(ws, recorded));

		expect(results[0]).toMatchObject({ action: "resolve", outcome: "accepted" });
		const item = readWorkItem(ws.stateDir, target)!;
		expect(item.state).toBe("triage");
		expect(item.replan_rounds).toBe(1);
		expect(recorded.ask_owner).toEqual([]);
	});

	it("runs a fresh plan session for a replan and counts the round", async () => {
		const ws = workspace();
		const target = "issue-42";
		escalated(ws, target);
		const recorded: Recorded = { ask_owner: [], resumed: [] };

		const results = await applyLeaderProposal([resolveItem(target, "replan")], deps(ws, recorded));

		expect(results[0]).toMatchObject({ action: "resolve", outcome: "accepted" });
		expect(listRoleSessions(ws.stateDir).map((session) => [session.role, session.status])).toEqual([["plan", "completed"]]);
		const item = readWorkItem(ws.stateDir, target)!;
		expect(item.state).toBe("triage");
		expect(item.replan_rounds).toBe(1);
	});

	it("rejects resume, release and replan on an authority-gated target and accepts only ask_owner", async () => {
		const gates: Array<{ name: string; facts: ResolveFacts }> = [
			{
				name: "a pending material approval",
				facts: {
					batch_state: null,
					pending_literal_user: [],
					task_records: [
						{
							task_id: TASK,
							risk: "material",
							open_user_decision_count: 0,
							unresolved_user_decision_ids: [],
							replan_required_ids: [],
							authorization_state: "authorize_rework",
							next_obligation: "awaiting_user",
						},
					],
				},
			},
			{
				name: "a breaking Intent revision",
				facts: {
					batch_state: null,
					pending_literal_user: [],
					task_records: [
						{
							task_id: TASK,
							risk: "routine",
							open_user_decision_count: 0,
							unresolved_user_decision_ids: [],
							replan_required_ids: ["replan-1"],
							authorization_state: "none",
							next_obligation: "none",
						},
					],
				},
			},
			{
				name: "a literal_user Lane decision",
				facts: {
					batch_state: null,
					pending_literal_user: [{ interaction_id: `lane-decision:run-1:rev-1`, kind: "lane_decision" }],
					task_records: [],
				},
			},
			{
				name: "a parked batch",
				facts: { batch_state: "needs_human", pending_literal_user: [], task_records: [] },
			},
			// ULS D5.1: a stalled Executor resumes only through a fresh drive entry.
			{
				name: "a child parked lane_executor_no_progress",
				facts: { batch_state: "running", no_progress_children: [TASK], pending_literal_user: [], task_records: [] },
			},
			// ULS D5.2: an unanswered Lane dialog is already the owner's question.
			{
				name: "a pending lane_entry_blocked escalation",
				facts: {
					batch_state: "running",
					pending_lane_entry_blocked: [{ interaction_id: "escalation:lane_entry_blocked:k" }],
					pending_literal_user: [],
					task_records: [],
				},
			},
		];

		for (const gate of gates) {
			const ws = workspace();
			const target = "issue-42";
			escalated(ws, target, { task_ids: [TASK] });
			const recorded: Recorded = { ask_owner: [], resumed: [] };
			const gated = deps(ws, recorded, { resolveFacts: async () => gate.facts });

			const results = await applyLeaderProposal(
				[resolveItem(target, "resume"), resolveItem(target, "release"), resolveItem(target, "replan")],
				gated,
			);

			expect({ gate: gate.name, outcomes: results.map((result) => result.outcome) }).toEqual({
				gate: gate.name,
				outcomes: ["rejected", "rejected", "rejected"],
			});
			for (const result of results) expect(result.reason).toContain("authority_gated");
			// Nothing moved and no session started: the guard ran before any side effect.
			expect(readWorkItem(ws.stateDir, target)!.state).toBe("escalated");
			expect(readWorkItem(ws.stateDir, target)!.replan_rounds ?? 0).toBe(0);
			expect(recorded.resumed).toEqual([]);
			expect(listRoleSessions(ws.stateDir)).toEqual([]);

			// Only `ask_owner` is accepted on the same target.
			const asked = await applyLeaderProposal([resolveItem(target, "ask_owner")], gated);
			expect(asked[0]).toMatchObject({ action: "resolve", outcome: "accepted" });
			expect(recorded.ask_owner).toHaveLength(1);
			expect(asked[0]!.reason).toContain("owner question posted");
		}
	});

	it("forces ask_owner with replan_cap_reached after three accepted rounds", async () => {
		const ws = workspace();
		const target = "issue-42";
		const recorded: Recorded = { ask_owner: [], resumed: [] };
		const working = deps(ws, recorded);

		// Three accepted resumes: each one re-escalates before the next arrives.
		for (let round = 1; round <= REPLAN_CAP; round += 1) {
			escalated(ws, target, { replan_rounds: round - 1 });
			const [accepted] = await applyLeaderProposal([resolveItem(target, "resume")], working);
			expect(accepted).toMatchObject({ outcome: "accepted" });
			expect(readWorkItem(ws.stateDir, target)!.replan_rounds).toBe(round);
		}

		// The fourth attempt after re-escalation is refused, not looped.
		escalated(ws, target, { replan_rounds: REPLAN_CAP });
		const [refused] = await applyLeaderProposal([resolveItem(target, "resume")], working);
		expect(refused).toMatchObject({ outcome: "rejected", reason: "replan_cap_reached" });
		expect(readWorkItem(ws.stateDir, target)!.state).toBe("escalated");

		const [asked] = await applyLeaderProposal([resolveItem(target, "ask_owner")], working);
		expect(asked).toMatchObject({ outcome: "accepted" });
		expect(readLeaderJournal(ws.stateDir).map((entry) => entry.kind)).toContain("rejected");
	});

	it("counts a replan session against the same per-proposal dispatch budget", async () => {
		const ws = workspace();
		const target = "issue-42";
		escalated(ws, target);
		const recorded: Recorded = { ask_owner: [], resumed: [] };
		const started: string[] = [];
		const budgeted = deps(ws, recorded, {
			max_dispatches_per_day: 1,
			startSession: async ({ role }) => {
				started.push(role.name);
				return { completed: true, reason: "completed: session ran" };
			},
		});

		const results = await applyLeaderProposal(
			[
				{ target, action: "dispatch", role: "plan", subject: "issue 42", brief: "draft the plan" },
				resolveItem(target, "replan"),
			],
			budgeted,
		);

		// The first session spent the one dispatch; the replan may not start another.
		expect(results[0]).toMatchObject({ action: "dispatch", outcome: "accepted", session_started: true });
		expect(results[1]).toMatchObject({ action: "resolve", outcome: "rejected", reason: "dispatch_budget_exhausted" });
		expect(started).toHaveLength(1);
		expect(listRoleSessions(ws.stateDir)).toHaveLength(1);
	});

	it("requires an escalated target and known work item", async () => {
		const ws = workspace();
		const recorded: Recorded = { ask_owner: [], resumed: [] };
		writeWorkItem(ws.stateDir, newWorkItem("issue-7", "driving", NOW));

		const results = await applyLeaderProposal(
			[resolveItem("issue-7", "release"), resolveItem("issue-9", "release")],
			deps(ws, recorded),
		);

		expect(results.map((result) => result.reason)).toEqual([
			"resolve_requires_escalated: driving",
			"work_item_unknown",
		]);
	});
});

describe("Loop Leader: resolve facts come from local state (S4-AC1)", () => {
	it("names the pending literal_user request the subject already holds", async () => {
		const ws = workspace();
		const request = laneDecisionInteractionRequest({
			task_id: TASK,
			run_id: "run-1",
			record_revision: "rev-1",
			question: "which branch?",
			options: [{ id: "a", label: "a" }],
			issue_number: 42,
		});
		await createLocalInteractionChannel({ stateDir: ws.stateDir }).post(request);

		expect(pendingLiteralUserRequests({ subject: { issue: 42 }, stateDir: ws.stateDir })).toEqual([
			{ interaction_id: request.interaction_id, kind: "lane_decision" },
		]);

		const facts = await collectResolveFacts({
			stateDir: ws.stateDir,
			target: "issue-42",
			subject: { issue: 42 },
			task_ids: [TASK],
			project: async () => ({
				risk: "material",
				open_user_decision_count: 1,
				unresolved_user_decision_ids: ["decision-1"],
				replan_required_ids: [],
				authorization: { state: "resolve_user_decision" },
				next_obligation: "awaiting_user",
			}),
			batchState: () => null,
		});

		expect(resolveBlockers(facts)).toEqual([
			"pending_lane_decision",
			"open_user_decision:s4-lane-task",
			"unresolved_user_decision:s4-lane-task",
			"pending_material_approval:s4-lane-task",
		]);
	});

	it("reports no blocker for an orchestration-level escalation", () => {
		expect(resolveBlockers({ batch_state: "running", pending_literal_user: [], task_records: [] })).toEqual([]);
		expect(
			resolveBlockers({
				batch_state: "running",
				pending_literal_user: [],
				task_records: [
					{
						task_id: TASK,
						risk: "routine",
						open_user_decision_count: 0,
						unresolved_user_decision_ids: [],
						replan_required_ids: [],
						authorization_state: "none",
						next_obligation: "run_qa",
					},
				],
			}),
		).toEqual([]);
	});
});

describe("Loop Leader: resolve alignment with ULS (S5-AC1)", () => {
	it("resumes an escalated item with no batch blocker and counts the round", async () => {
		const ws = workspace();
		const target = "issue-42";
		escalated(ws, target, { task_ids: [TASK] });
		const recorded: Recorded = { ask_owner: [], resumed: [] };
		const noBatch = deps(ws, recorded, {
			resolveFacts: async () => ({ ...NO_FACTS, batch_state: null, no_progress_children: [] }),
		});

		const results = await applyLeaderProposal([resolveItem(target, "resume")], noBatch);

		expect(results[0]).toMatchObject({ action: "resolve", outcome: "accepted" });
		expect(recorded.resumed).toEqual([target]);
		expect(readWorkItem(ws.stateDir, target)).toMatchObject({ state: "driving", replan_rounds: 1 });
	});

	it("names the no_progress child in the blocker and leaves a running batch with healthy children unblocked", () => {
		expect(resolveBlockers({ ...NO_FACTS, batch_state: "running", no_progress_children: [TASK] })).toEqual([
			`lane_executor_no_progress:${TASK}`,
		]);
		expect(resolveBlockers({ ...NO_FACTS, batch_state: "running", no_progress_children: [] })).toEqual([]);
	});

	it("reads parked-child facts from the v3 batch record through the active-batch lookup", async () => {
		const ws = workspace();
		seedLaneBatch(ws.root, "batch-s5", [{ task_id: TASK, state: "needs_human", reason: "lane_executor_no_progress" }, { task_id: "other-task" }], {
			batch_state: "running",
			now: NOW,
		});
		expect(batchStateForTarget(ws.root, { task_ids: [TASK] })).toEqual({
			batch_id: "batch-s5",
			batch_state: "running",
			no_progress_children: [TASK],
		});
		// A different parked reason is not a no_progress block.
		seedLaneBatch(ws.root, "batch-s5", [{ task_id: TASK, state: "needs_human", reason: "lane_executor_stopped" }], { now: NOW });
		expect(batchStateForTarget(ws.root, { task_ids: [TASK] })?.no_progress_children).toEqual([]);

		const facts = await collectResolveFacts({
			stateDir: ws.stateDir,
			target: "issue-42",
			subject: { issue: 42 },
			task_ids: [TASK],
			project: async () => null,
			batchState: () => "running",
			noProgressChildren: () => [TASK],
		});
		expect(facts.no_progress_children).toEqual([TASK]);
	});

	it("refuses a task claimed by two active batches instead of taking the first file", async () => {
		const ws = workspace();
		seedLaneBatch(ws.root, "batch-a", [{ task_id: TASK }], { now: NOW });
		seedLaneBatch(ws.root, "batch-b", [{ task_id: TASK }], { now: NOW });
		expect(() => batchStateForTarget(ws.root, { task_ids: [TASK] })).toThrow("batch_lane_ambiguous");

		// The leader dispatch reports the unresolved target as rejected and moves nothing.
		const target = "issue-42";
		escalated(ws, target, { task_ids: [TASK] });
		const recorded: Recorded = { ask_owner: [], resumed: [] };
		const refusing = deps(ws, recorded, {
			resolveFacts: async () =>
				collectResolveFacts({
					stateDir: ws.stateDir,
					target,
					subject: { issue: 42 },
					task_ids: [TASK],
					project: async () => null,
					batchState: () => batchStateForTarget(ws.root, { task_ids: [TASK] })?.batch_state ?? null,
				}),
		});
		const results = await applyLeaderProposal([resolveItem(target, "resume")], refusing);
		expect(results[0]).toMatchObject({ outcome: "rejected" });
		expect(results[0]!.reason).toContain("batch_lane_ambiguous");
		expect(readWorkItem(ws.stateDir, target)!.state).toBe("escalated");
		expect(recorded.resumed).toEqual([]);
	});

	it("stops counting a lane_entry_blocked comment as pending once no child is held for the owner", async () => {
		const ws = workspace();
		const comment = { body: renderEscalationBody("key-1", "Lane t waits on a dialog", { label: "lane_entry_blocked", issue_number: 42 }) };
		const facts = (held: string[]) =>
			collectResolveFacts({
				stateDir: ws.stateDir,
				target: "issue-42",
				subject: { issue: 42 },
				task_ids: [TASK],
				project: async () => null,
				batchState: () => "running",
				heldChildren: () => held,
				comments: [comment],
			});
		expect((await facts([TASK])).pending_lane_entry_blocked).toEqual([{ interaction_id: "escalation:lane_entry_blocked:key-1" }]);
		// The dialog was answered: the old comment no longer blocks resume, release or replan.
		expect((await facts([])).pending_lane_entry_blocked).toEqual([]);
	});

	it("keeps a terminal batch out of the lookup so it never blocks a resume", () => {
		const ws = workspace();
		seedLaneBatch(ws.root, "batch-done", [{ task_id: TASK }], { batch_state: "failed", now: NOW });
		expect(batchStateForTarget(ws.root, { task_ids: [TASK] })).toBeNull();
	});
});

describe("Loop Leader: one question per Lane dialog (S5-AC2)", () => {
	it("recognises the unwithdrawn lane_entry_blocked escalation on the subject Issue only", () => {
		const posted = renderEscalationBody("key-1", "Lane t waits on a dialog", { label: "lane_entry_blocked", issue_number: 42 });
		const other = renderEscalationBody("key-2", "repair cap reached", {});
		const withdrawn = `${posted}\n${INTERACTION_WITHDRAWN_MARKER}\n`;
		expect(pendingLaneEntryBlocked({ subject: { issue: 42 }, comments: [{ body: posted }, { body: other }] })).toEqual([
			{ interaction_id: "escalation:lane_entry_blocked:key-1" },
		]);
		expect(pendingLaneEntryBlocked({ subject: { issue: 43 }, comments: [{ body: posted }] })).toEqual([]);
		expect(isWithdrawn(withdrawn)).toBe(true);
		expect(pendingLaneEntryBlocked({ subject: { issue: 42 }, comments: [{ body: withdrawn }] })).toEqual([]);
	});

	it("folds a leader ask_owner into the pending lane_entry_blocked request instead of asking again", async () => {
		const ws = workspace();
		const target = "issue-42";
		escalated(ws, target, { task_ids: [TASK] });
		const recorded: Recorded = { ask_owner: [], resumed: [] };
		const dialogFacts: ResolveFacts = {
			...NO_FACTS,
			pending_lane_entry_blocked: [{ interaction_id: "escalation:lane_entry_blocked:key-1" }],
		};
		const seen: Array<{ pending: number; entry: number }> = [];
		const folded = deps(ws, recorded, {
			resolveFacts: async () => dialogFacts,
			askOwner: async ({ pending_literal_user, pending_lane_entry_blocked }) => {
				seen.push({ pending: pending_literal_user.length, entry: pending_lane_entry_blocked?.length ?? 0 });
				return { action: "annotated", interaction_id: "escalation:lane_entry_blocked:key-1" };
			},
		});

		const results = await applyLeaderProposal([resolveItem(target, "ask_owner")], folded);
		expect(results[0]).toMatchObject({ outcome: "accepted" });
		expect(results[0]!.reason).toContain("annotated");
		expect(seen).toEqual([{ pending: 0, entry: 1 }]);

		// Every other resolve kind is rejected: the dialog is the owner's to answer.
		const others = await applyLeaderProposal([resolveItem(target, "resume"), resolveItem(target, "release")], folded);
		expect(others.map((entry) => entry.outcome)).toEqual(["rejected", "rejected"]);
		expect(others[0]!.reason).toContain("pending_lane_entry_blocked");
	});
});

/** The catalog shape the replan path reads: one role per base, defaults preserved. */
function roleFor(base: "plan"): ResolvedLoopRole {
	return defaultLoopRole(base);
}
void roleFor;
