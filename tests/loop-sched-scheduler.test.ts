/**
 * Loop Daemon: Scheduler Corrections (S9)
 *
 * Verifies S9-AC1 and S9-AC2 under docs/plans/loop-sched-s9-scheduler.intent.json
 * and D7 in docs/specs/loop-agent-scheduling.spec.md:
 * - Positive Control: the scheduler's scope comes from the work item's TaskIntent
 *   (or its published plan framing), `ready_buffer` counts `plan_published` work
 *   items, an Issue body/title edit emits E2, and E8 identity carries `head_sha`.
 * - Negative Control: a comment-only update that moves `updated_at` emits no E2,
 *   and two candidates whose work item scopes overlap never run together.
 * - Boundary / Fault Control: reaching `max_ready_buffer` holds further planning,
 *   and one head plus one failure signature share one `event_id`.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
	LOOP_PLAN_PUBLICATION_CONTRACT,
	writePlanPublication,
} from "../plugins/immune-brain/runtime/loop_daemon/agent_handlers.ts";
import { issueContentHash, issueContentKey, normalizeEvents } from "../plugins/immune-brain/runtime/loop_daemon/events.ts";
import {
	scheduleLoopWork,
	type ScheduleCandidate,
	type ScheduleInput,
} from "../plugins/immune-brain/runtime/loop_daemon/scheduler.ts";
import { initLoopState } from "../plugins/immune-brain/runtime/loop_daemon/state.ts";
import type { LoopHandler } from "../plugins/immune-brain/runtime/loop_daemon/handlers.ts";
import type { ObservationInput, RawIssue, RawPR } from "../plugins/immune-brain/runtime/loop_daemon/types.ts";
import {
	newWorkItem,
	plannedWorkItemCount,
	workItemScopeHint,
	writeWorkItem,
	type WorkItem,
	type WorkItemState,
} from "../plugins/immune-brain/runtime/loop_daemon/work_items.ts";

const temp = realpathSync(mkdtempSync(join(tmpdir(), "loop-sched-scheduler-")));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
let counter = 0;

function project(): { root: string; stateDir: string } {
	const root = join(temp, `project-${counter++}`);
	const stateDir = join(root, ".imm/state/loop");
	mkdirSync(stateDir, { recursive: true });
	return { root, stateDir };
}

/** A TaskIntent sidecar the kernel reader accepts (§ kernel/intent.ts). */
function writeIntent(root: string, taskId: string, scopeHint: string[], path = `docs/plans/${taskId}.intent.json`): void {
	const destination = join(root, path);
	mkdirSync(dirname(destination), { recursive: true });
	writeFileSync(
		destination,
		`${JSON.stringify(
			{
				contract: "assurance_kernel/task_intent/v1",
				task_id: taskId,
				goal: `goal of ${taskId}`,
				acceptance: [{ id: "AC1", assertion: "behavior", verification: "bun test" }],
				scope_hint: scopeHint,
				risk: "routine",
				revision: 1,
				owner: "user",
			},
			null,
			2,
		)}\n`,
	);
}

function workItem(stateDir: string, target: string, state: WorkItemState, taskIds: string[] = []): WorkItem {
	const item = newWorkItem(target, state, "2026-01-01T00:00:00.000Z");
	item.binding.task_ids = [...taskIds];
	writeWorkItem(stateDir, item);
	return item;
}

/** The candidate dispatch builds: target, handler, and the scope its work item owns. */
function candidate(
	root: string,
	stateDir: string,
	target: string,
	handler: LoopHandler,
): ScheduleCandidate {
	return { target_id: target, handler, scope_hint: workItemScopeHint(root, stateDir, target) };
}

function scheduleInput(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
	return {
		candidates: [],
		active_leases: [],
		ready_buffer: 0,
		open_daemon_prs: 0,
		limits: { max_concurrent: 4, max_ready_buffer: 5, max_pr_buffer: 5 },
		budget: { ticks_today: 0, dispatches_today: 0, max_ticks_per_day: null, max_dispatches_per_day: null },
		...overrides,
	};
}

function issue(overrides: Partial<RawIssue> = {}): RawIssue {
	return {
		id: 42,
		number: 42,
		title: "Scheduler issue",
		body: "Body unchanged",
		state: "open",
		created_at: "2026-01-01T08:00:00Z",
		updated_at: "2026-01-02T09:00:00Z",
		author: { login: "owner" },
		labels: [],
		...overrides,
	};
}

function pr(headSha: string): RawPR {
	return {
		number: 7,
		title: "imm-loop PR",
		head_ref_name: "imm-loop/s9",
		head_sha: headSha,
		base_ref_name: "main",
		state: "open",
		merged: false,
		mergeable: "MERGEABLE",
		checks: [{ name: "unit", status: "completed", conclusion: "failure" }],
	};
}

describe("loop scheduler corrections (S9)", () => {
	describe("S9-AC1: work item scope and ready buffer", () => {
		it("runs one of two overlapping work item scopes and both disjoint ones", () => {
			const { root, stateDir } = project();
			writeIntent(root, "alpha", ["plugins/immune-brain/runtime/loop_daemon/"]);
			writeIntent(root, "beta", ["plugins/immune-brain/runtime/loop_daemon/scheduler.ts"]);
			writeIntent(root, "gamma", ["docs/specs/"]);
			workItem(stateDir, "issue-1", "driving", ["alpha"]);
			workItem(stateDir, "issue-2", "driving", ["beta"]);
			workItem(stateDir, "issue-3", "driving", ["gamma"]);

			const result = scheduleLoopWork(
				scheduleInput({
					candidates: [
						candidate(root, stateDir, "issue-1", "enroll_and_drive"),
						candidate(root, stateDir, "issue-2", "enroll_and_drive"),
						candidate(root, stateDir, "issue-3", "enroll_and_drive"),
					],
				}),
			);

			expect(result.dispatched).toEqual(["issue-1", "issue-3"]);
			const held = result.entries.find((entry) => entry.target_id === "issue-2");
			expect(held?.action).toBe("hold");
			expect(held?.reason.startsWith("scope_overlap:")).toBe(true);
		});

		it("counts plan_published work items into the ready buffer and holds planning at the bound", () => {
			const { root, stateDir } = project();
			workItem(stateDir, "issue-1", "plan_published");
			workItem(stateDir, "issue-2", "plan_published");
			workItem(stateDir, "issue-3", "triage");
			expect(plannedWorkItemCount(stateDir)).toBe(2);

			const held = scheduleLoopWork(
				scheduleInput({
					candidates: [candidate(root, stateDir, "issue-4", "draft_plan")],
					ready_buffer: plannedWorkItemCount(stateDir),
					limits: { max_concurrent: 4, max_ready_buffer: 2, max_pr_buffer: 5 },
				}),
			);
			expect(held.dispatched).toEqual([]);
			expect(held.entries[0]!.reason.startsWith("max_ready_buffer:")).toBe(true);

			const admitted = scheduleLoopWork(
				scheduleInput({
					candidates: [candidate(root, stateDir, "issue-4", "draft_plan")],
					ready_buffer: plannedWorkItemCount(stateDir),
					limits: { max_concurrent: 4, max_ready_buffer: 3, max_pr_buffer: 5 },
				}),
			);
			expect(admitted.dispatched).toEqual(["issue-4"]);
		});

		it("takes the scope from the published plan framing when no task is bound yet", () => {
			const { root, stateDir } = project();
			const worktree = join(temp, `plan-worktree-${counter++}`);
			writeIntent(worktree, "eps", ["src/eps/"]);
			writePlanPublication(stateDir, {
				contract: LOOP_PLAN_PUBLICATION_CONTRACT,
				issue_number: 5,
				branch: "imm-loop/5",
				worktree_path: worktree,
				digest: "a".repeat(64),
				requires_owner_approval: true,
				intents: [{ path: "docs/plans/eps.intent.json", task_id: "eps", content_hash: "b".repeat(64), risk: "routine" }],
				task_id: "eps",
				comment_body: "plan",
				drafted_at: "2026-01-01T00:00:00.000Z",
				published_at: "2026-01-01T01:00:00.000Z",
				published_comment_id: 11,
			});
			workItem(stateDir, "issue-5", "plan_published");

			expect(workItemScopeHint(root, stateDir, "issue-5")).toEqual(["src/eps/"]);
			// An unbound work item with no plan proves nothing and stays serialized.
			expect(workItemScopeHint(root, stateDir, "issue-6")).toEqual([]);
		});
	});

	describe("S9-AC2: E2 content change and E8 identity", () => {
		function storedState(input: RawIssue) {
			const state = initLoopState();
			state.watermarks.issues_updated_at = "2026-01-01T12:00:00Z";
			state.watermarks.etag_by_resource[issueContentKey(input.number)] = issueContentHash(input);
			return state;
		}

		function eventsFor(input: RawIssue, previous: ReturnType<typeof initLoopState>) {
			const observation: ObservationInput = { issues: [input], pull_requests: [], observed_at: "2026-01-03T00:00:00Z" };
			return normalizeEvents(observation, previous);
		}

		it("emits E2 when the body changes and none when only a comment does", () => {
			const original = issue();
			const edited = issue({ body: "Body rewritten", updated_at: "2026-01-02T10:00:00Z" });
			const commented = issue({
				updated_at: "2026-01-02T10:00:00Z",
				comments: [
					{
						id: 900,
						body: "a new comment",
						user: { login: "owner" },
						author_association: "OWNER",
						created_at: "2026-01-02T10:00:00Z",
						updated_at: "2026-01-02T10:00:00Z",
					},
				],
			});

			expect(eventsFor(edited, storedState(original)).filter((event) => event.kind === "E2_ISSUE_EDITED")).toHaveLength(1);
			expect(eventsFor(commented, storedState(original)).filter((event) => event.kind === "E2_ISSUE_EDITED")).toHaveLength(0);
		});

		it("emits E2 when only the title changes", () => {
			const original = issue();
			const retitled = issue({ title: "Scheduler issue renamed", updated_at: "2026-01-02T10:00:00Z" });

			const events = eventsFor(retitled, storedState(original));
			const e2 = events.find((event) => event.kind === "E2_ISSUE_EDITED");
			expect(e2?.issue_number).toBe(42);
		});

		it("gives failures of one check on different heads different E8 ids and one head one id", () => {
			const idsFor = (headSha: string) =>
				normalizeEvents(
					{ issues: [], pull_requests: [pr(headSha)], observed_at: "2026-01-03T00:00:00Z" },
					null,
				)
					.filter((event) => event.kind === "E8_PR_CHECK_FAILED")
					.map((event) => event.event_id);

			const first = idsFor("a".repeat(40));
			const second = idsFor("b".repeat(40));
			expect(first).toHaveLength(1);
			expect(second).toHaveLength(1);
			expect(first[0]).not.toBe(second[0]);
			expect(idsFor("a".repeat(40))).toEqual(first);
		});
	});
});
