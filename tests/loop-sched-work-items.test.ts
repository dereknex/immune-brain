/**
 * Loop Daemon: Work Items (S5)
 *
 * Verifies S5-AC1 and S5-AC2 under docs/plans/loop-sched-s5-work-items.intent.json
 * and D5 in docs/specs/loop-agent-scheduling.spec.md.
 *
 * - Positive Control: a `ready-for-agent` Issue without a published plan routes
 *   to `planning`, and the published plan turns the label into the approval
 *   signal; an empty store is rebuilt from GitHub and Kernel fixtures.
 * - Negative Control: a handler result that would make an illegal transition is
 *   refused and recorded; an unchanged level fact writes no second decision.
 * - Boundary: edge events keep their `event_id` deduplication.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	LOOP_PLAN_PUBLICATION_CONTRACT,
	writePlanPublication,
} from "../plugins/immune-brain/runtime/loop_daemon/agent_handlers.ts";
import { runLoopDaemonCli } from "../plugins/immune-brain/runtime/loop_daemon/cli.ts";
import type { LoopGitHubPort } from "../plugins/immune-brain/runtime/loop_daemon/github_port.ts";
import { loadLoopDecisions } from "../plugins/immune-brain/runtime/loop_daemon/state.ts";
import type { ObservationInput } from "../plugins/immune-brain/runtime/loop_daemon/types.ts";
import {
	LOOP_WORK_ITEM_CONTRACT,
	advanceWorkItem,
	ensureWorkItems,
	isLegalWorkItemTransition,
	newWorkItem,
	readWorkItem,
	recordJudgedEvents,
	selectUnjudgedEvents,
	writeWorkItem,
	type WorkItem,
} from "../plugins/immune-brain/runtime/loop_daemon/work_items.ts";
import type { GhExecution, GhTransport } from "../plugins/immune-brain/runtime/github_issue_tracker.ts";
import type { ClassifyFn } from "../plugins/immune-brain/runtime/loop_daemon/judgement.ts";

const TS = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-01T00:10:00.000Z";

const cleanups: Array<() => void> = [];
afterEach(() => {
	while (cleanups.length > 0) cleanups.pop()!();
});

function makeWorkspace() {
	const root = mkdtempSync(join(tmpdir(), "loop-s5-work-items-"));
	cleanups.push(() => rmSync(root, { recursive: true, force: true }));
	execFileSync("git", ["init", "-q", root]);
	execFileSync("git", ["config", "user.name", "Immune Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "test@immune-brain.internal"], { cwd: root });

	mkdirSync(join(root, ".imm/state/loop"), { recursive: true });
	mkdirSync(join(root, "docs/agents"), { recursive: true });
	writeFileSync(
		join(root, ".imm/config.json"),
		`${JSON.stringify({
			contract: "immune_brain/project_config/v2",
			loop: { mode: "assist", allowed_actors: ["owner"], allowed_associations: ["OWNER"] },
		})}\n`,
	);
	execFileSync("git", ["add", ".imm/config.json"], { cwd: root });

	return { root, stateDir: join(root, ".imm/state/loop") };
}

function mockGh(): GhTransport {
	return {
		async run(_args): Promise<GhExecution> {
			return { status: 0, stdout: "", stderr: "" };
		},
	};
}

function makeFakeGitHubPort(): LoopGitHubPort {
	return {
		async postComment() {
			return { id: 9001 };
		},
		async editComment() {},
		async createIssue() {
			return { number: 999 };
		},
		async editIssue() {},
		async upsertPullRequest() {
			return { number: 200, url: "https://example.test/pr/200" };
		},
		async markPrReady() {},
	};
}

/** Tier-2 triage is not this slice's subject: every point stays unavailable. */
const offlineClassifier: ClassifyFn = async () => ({
	status: "unavailable",
	reason: "no_local_config",
	detail: "s5 work-item test",
});

function readyIssue(overrides: Record<string, unknown> = {}) {
	return {
		id: 42,
		number: 42,
		title: "Ready task",
		body: "<!-- immune-brain:task-id=widget-task -->",
		state: "open" as const,
		created_at: TS,
		updated_at: TS,
		author: { login: "owner" },
		labels: [{ name: "ready-for-agent" }],
		...overrides,
	};
}

function snapshot(overrides: Partial<ObservationInput> = {}): ObservationInput {
	return { issues: [], pull_requests: [], observed_at: TS, ...overrides };
}

async function tick(root: string, snapshotOverride: ObservationInput) {
	const result = await runLoopDaemonCli(["tick", "--json"], root, {
		gh: mockGh(),
		gitHubPort: makeFakeGitHubPort(),
		classify: offlineClassifier,
		guardFacts: { daemon_identity: "imm-bot" },
		snapshotOverride,
	});
	expect(result.returncode).toBe(0);
	return JSON.parse(result.stdout) as {
		decisions: Array<{ event_id: string; handler: string }>;
		events: Array<{ event_id: string; kind: string }>;
	};
}

function publishPlan(root: string, issueNumber: number, digest: string): void {
	writePlanPublication(join(root, ".imm/state/loop"), {
		contract: LOOP_PLAN_PUBLICATION_CONTRACT,
		issue_number: issueNumber,
		branch: `imm-loop/issue-${issueNumber}`,
		worktree_path: root,
		digest,
		requires_owner_approval: true,
		intents: [],
		task_id: "widget-task",
		comment_body: "plan",
		drafted_at: TS,
		published_at: TS,
		published_comment_id: 4242,
	});
}

describe("S5-AC1: one rebuildable work item per target with the D5 state machine", () => {
	it("routes a ready-for-agent Issue without a published plan to planning and never selects enroll_and_drive", async () => {
		const ws = makeWorkspace();

		const result = await tick(ws.root, snapshot({ issues: [readyIssue()] }));

		const handlers = result.decisions.map((decision) => decision.handler);
		expect(handlers).toContain("draft_plan");
		expect(handlers).not.toContain("enroll_and_drive");

		const item = readWorkItem(ws.stateDir, "issue-42");
		expect(item).toMatchObject({
			contract: LOOP_WORK_ITEM_CONTRACT,
			target: "issue-42",
			state: "planning",
			binding: { plan_digest: null },
			refused_transitions: [],
		});
	});

	it("counts the ready-for-agent label as the approval signal once a plan is published", async () => {
		const ws = makeWorkspace();
		publishPlan(ws.root, 42, "sha256:published-plan");

		const result = await tick(ws.root, snapshot({ issues: [readyIssue()] }));

		expect(result.decisions.map((decision) => decision.handler)).toContain("enroll_and_drive");
		const item = readWorkItem(ws.stateDir, "issue-42");
		expect(item?.state).toBe("driving");
		expect(item?.binding.plan_digest).toBe("sha256:published-plan");
	});

	it("refuses and records a handler result that would make an illegal transition", async () => {
		const ws = makeWorkspace();
		// A PR still in planning cannot be moved to repairing by a failed check.
		writeWorkItem(ws.stateDir, newWorkItem("pr-20", "planning", TS));

		await tick(
			ws.root,
			snapshot({
				pull_requests: [
					{
						number: 20,
						title: "[imm-loop] widget task",
						head_ref_name: "imm/widget-task",
						head_sha: "abc123",
						base_ref_name: "main",
						state: "open",
						merged: false,
						mergeable: "MERGEABLE",
						checks: [{ name: "unit", status: "completed", conclusion: "failure" }],
					},
				],
			}),
		);

		const item = readWorkItem(ws.stateDir, "pr-20");
		expect(item?.state).toBe("planning");
		expect(item?.refused_transitions).toHaveLength(1);
		expect(item?.refused_transitions[0]).toMatchObject({
			from: "planning",
			to: "repairing",
			handler: "repair_pr_ci",
		});
	});

	it("rebuilds an empty store from GitHub and Kernel fixtures before scheduling", async () => {
		const ws = makeWorkspace();
		mkdirSync(join(ws.root, ".imm/runs/run-a"), { recursive: true });
		writeFileSync(
			join(ws.root, ".imm/runs/run-a/run.json"),
			`${JSON.stringify({
				contract: "assurance_kernel/run/v1",
				lifecycle: "active",
				task_id: "lane-task-a",
				issue_number: 7,
				run_id: "run-a",
			})}\n`,
		);

		const result = await tick(
			ws.root,
			snapshot({
				issues: [readyIssue({ id: 5, number: 5, body: "no plan yet" })],
				pull_requests: [
					{
						number: 20,
						title: "[imm-loop] widget task",
						head_ref_name: "imm/widget-task",
						head_sha: "abc123",
						base_ref_name: "main",
						state: "open",
						merged: false,
						mergeable: "MERGEABLE",
					},
				],
			}),
		);

		expect(readWorkItem(ws.stateDir, "issue-5")?.state).toBe("planning");
		expect(readWorkItem(ws.stateDir, "pr-20")?.state).toBe("pr_open");
		expect(readWorkItem(ws.stateDir, "issue-7")).toMatchObject({
			state: "driving",
			binding: { task_ids: ["lane-task-a"], run_id: "run-a" },
		});
		// Rebuilt before scheduling: the ready Issue without a plan still plans.
		expect(result.decisions.map((decision) => decision.handler)).toContain("draft_plan");
	});

	it("rebuilds one lost target from its published plan or active run without touching the others", () => {
		const ws = makeWorkspace();
		const kept = advanceWorkItem(newWorkItem("issue-5", "triage", TS), "clarifying", { now: TS }).item;
		writeWorkItem(ws.stateDir, kept);
		publishPlan(ws.root, 9, "sha256:plan-nine");
		mkdirSync(join(ws.root, ".imm/runs/run-a"), { recursive: true });
		writeFileSync(
			join(ws.root, ".imm/runs/run-a/run.json"),
			`${JSON.stringify({ lifecycle: "active", task_id: "lane-task-a", issue_number: 7, run_id: "run-a" })}\n`,
		);

		ensureWorkItems(
			ws.root,
			ws.stateDir,
			snapshot({
				issues: [
					readyIssue({ id: 5, number: 5 }),
					readyIssue({ id: 9, number: 9 }),
					readyIssue({ id: 11, number: 11 }),
				],
			}),
			{ 9: "sha256:plan-nine" },
			TS,
		);

		expect(readWorkItem(ws.stateDir, "issue-5")).toEqual(kept);
		expect(readWorkItem(ws.stateDir, "issue-9")).toMatchObject({
			state: "plan_published",
			binding: { plan_digest: "sha256:plan-nine" },
		});
		expect(readWorkItem(ws.stateDir, "issue-7")).toMatchObject({ state: "driving", binding: { run_id: "run-a" } });
		// Nothing shows where Issue 11 was, so it is left to the normal triage path.
		expect(readWorkItem(ws.stateDir, "issue-11")).toBeNull();
	});

	it("keeps the D5 transition table closed", () => {
		for (const [from, targets] of Object.entries({
			triage: ["clarifying", "planning", "escalated"],
			plan_published: ["driving"],
			pr_open: ["repairing", "ready_for_merge"],
			ready_for_merge: ["closed"],
			closed: [],
		})) {
			for (const to of targets) expect(isLegalWorkItemTransition(from as never, to as never)).toBe(true);
		}
		expect(isLegalWorkItemTransition("planning", "repairing")).toBe(false);
		const refused: { item: WorkItem; refused: boolean } = advanceWorkItem(
			newWorkItem("pr-21", "planning", TS),
			"repairing",
			{ handler: "repair_pr_ci", now: TS },
		);
		expect(refused.refused).toBe(true);
		expect(refused.item.state).toBe("planning");
	});
});

describe("S5-AC2: level events are judged once per changed fact", () => {
	it("writes no second decision for an unchanged level fact across two ticks", async () => {
		const ws = makeWorkspace();
		const first = await tick(ws.root, snapshot({ issues: [readyIssue()] }));
		expect(first.decisions.filter((decision) => decision.event_id.startsWith("evt-e5-42"))).toHaveLength(1);
		const afterFirst = loadLoopDecisions(ws.stateDir).length;

		const second = await tick(ws.root, snapshot({ issues: [readyIssue()] }));
		expect(second.decisions.filter((decision) => decision.event_id.startsWith("evt-e5-42"))).toHaveLength(0);
		expect(loadLoopDecisions(ws.stateDir).length).toBe(afterFirst);

		const item = readWorkItem(ws.stateDir, "issue-42");
		expect(Object.keys(item?.last_judged ?? {})).toContain("E5_READY_TASK:issue-42");
		expect(item?.last_judged["E5_READY_TASK:issue-42"]).toMatch(/^[0-9a-f]{64}$/);
	});

	it("judges a level event once when its fact changes", async () => {
		const ws = makeWorkspace();
		await tick(ws.root, snapshot({ issues: [readyIssue()] }));

		const changed = await tick(
			ws.root,
			snapshot({ issues: [readyIssue({ body: "<!-- immune-brain:task-id=widget-task-b -->" })] }),
		);

		expect(changed.decisions.filter((decision) => decision.event_id.startsWith("evt-e5-42"))).toHaveLength(1);
		// A third identical tick adds nothing: the new fact was judged exactly once.
		const repeated = await tick(
			ws.root,
			snapshot({ issues: [readyIssue({ body: "<!-- immune-brain:task-id=widget-task-b -->" })] }),
		);
		expect(repeated.decisions.filter((decision) => decision.event_id.startsWith("evt-e5-42"))).toHaveLength(0);
	});

	it("still deduplicates edge events by event_id and re-judges a level event only on a fact change", () => {
		const ws = makeWorkspace();
		const checkFailed = (headSha: string) => ({
			contract: "assurance_kernel/loop_daemon_event/v1" as const,
			event_id: `evt-e8-20-unit`,
			kind: "E8_PR_CHECK_FAILED" as const,
			timestamp: TS,
			pr_number: 20,
			branch: "imm/widget-task",
			head_sha: headSha,
			check_name: "unit",
			failure_signature: "sig",
		});
		const ownerComment = {
			contract: "assurance_kernel/loop_daemon_event/v1" as const,
			event_id: "evt-e3-42-700",
			kind: "E3_OWNER_COMMENT" as const,
			timestamp: TS,
			issue_number: 42,
			comment_id: 700,
			author: "owner",
			author_association: "OWNER",
			body: "please look",
			created_at: TS,
			updated_at: TS,
		};

		const first = selectUnjudgedEvents([checkFailed("abc123"), ownerComment], ws.stateDir);
		expect(first.events).toHaveLength(2);
		recordJudgedEvents(first, ws.stateDir, TS);

		const repeated = selectUnjudgedEvents([checkFailed("abc123"), ownerComment], ws.stateDir);
		expect(repeated.events).toHaveLength(0);

		const newHead = selectUnjudgedEvents([checkFailed("def456"), ownerComment], ws.stateDir);
		expect(newHead.events.map((event) => event.kind)).toEqual(["E8_PR_CHECK_FAILED"]);
	});
});
