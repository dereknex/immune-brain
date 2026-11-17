/**
 * Loop Daemon: Leader Guarded Dispatch, Initiative Shape and Session Listing (S3)
 *
 * Pins D3 of docs/specs/loop-leader.spec.md: an accepted proposal item executes
 * only behind its own code guard, an Initiative shape writes the Local carrier
 * plus one Kernel-authored TaskIntent per slice, and a `dispatch` starts one
 * catalog role session whose completion comes from its own record. Every refused
 * item journals one reason and changes nothing.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import type { AgentSessionProcess, AgentSessionProvider, AgentSessionRequest } from "../plugins/immune-brain/runtime/loop_daemon/agent_runner.ts";
import {
	READ_ONLY_SESSION_ROLES,
	ROLE_SESSION_LIMITS,
} from "../plugins/immune-brain/runtime/loop_daemon/agent_runner.ts";
import { runLoopDaemonCli } from "../plugins/immune-brain/runtime/loop_daemon/cli.ts";
import { buildDecisionRecord } from "../plugins/immune-brain/runtime/loop_daemon/decision_record.ts";
import { eventTarget } from "../plugins/immune-brain/runtime/loop_daemon/guards.ts";
import {
	applyLeaderProposal,
	parseInitiativePlan,
	renderLocalInitiativeCarrier,
	shapeInitiative,
	type LeaderDispatchDeps,
} from "../plugins/immune-brain/runtime/loop_daemon/leader_dispatch.ts";
import { driveInitiativeLane } from "../plugins/immune-brain/runtime/loop_daemon/agent_handlers.ts";
import { loadLoopState } from "../plugins/immune-brain/runtime/loop_daemon/state.ts";
import type { LoopGitHubPort } from "../plugins/immune-brain/runtime/loop_daemon/github_port.ts";
import type { GhTransport } from "../plugins/immune-brain/runtime/github_issue_tracker.ts";
import {
	drivingObserver,
	drivingPlanSource,
} from "../plugins/immune-brain/runtime/loop_daemon/work_items.ts";
import { readLeaderJournal } from "../plugins/immune-brain/runtime/loop_daemon/leader_journal.ts";
import { collectLeaderBriefingInput } from "../plugins/immune-brain/runtime/loop_daemon/leader_agent.ts";
import { compileLeaderBriefing } from "../plugins/immune-brain/runtime/loop_daemon/leader_briefing.ts";
import { LOOP_LEADER_PROPOSAL_CONTRACT } from "../plugins/immune-brain/runtime/loop_daemon/leader_proposal.ts";
import { observeInitiative, observeSingleTask } from "../plugins/immune-brain/runtime/unattended/batch_plan.ts";
import { reconcileCandidates, reconcileSkippedDecisions } from "../plugins/immune-brain/runtime/loop_daemon/reconcile.ts";
import { defaultLoopRole, resolveLoopRoles, type ResolvedLoopRole } from "../plugins/immune-brain/runtime/loop_daemon/role_catalog.ts";
import { listRoleSessions, runningRoleSessions, startRoleSession } from "../plugins/immune-brain/runtime/loop_daemon/role_sessions.ts";
import { SCHEDULE_PRIORITY, scheduleLoopWork, type ScheduleCandidate } from "../plugins/immune-brain/runtime/loop_daemon/scheduler.ts";
import { appendLoopDecision } from "../plugins/immune-brain/runtime/loop_daemon/state.ts";
import {
	LOOP_DAEMON_EVENT_CONTRACT,
	type E1NewIssueEvent,
	type E3OwnerCommentEvent,
} from "../plugins/immune-brain/runtime/loop_daemon/types.ts";
import {
	newWorkItem,
	readWorkItem,
	writeWorkItem,
} from "../plugins/immune-brain/runtime/loop_daemon/work_items.ts";
import type { LoopDispatchRecord } from "../plugins/immune-brain/runtime/loop_daemon/dispatch.ts";

const NOW = "2026-11-17T10:00:00.000Z";

const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const cleanup of cleanups) cleanup();
	cleanups.length = 0;
});

function tempDir(prefix: string): string {
	const path = mkdtempSync(join(tmpdir(), prefix));
	cleanups.push(() => rmSync(path, { recursive: true, force: true }));
	return path;
}

/** A repository root with the project config the daemon reads, plus its loop state dir. */
function workspace(): { root: string; stateDir: string } {
	const root = tempDir("imm-leader-dispatch-");
	execFileSync("git", ["init", "-q", root]);
	mkdirSync(join(root, ".imm/state/loop"), { recursive: true });
	writeFileSync(
		join(root, ".imm/config.json"),
		`${JSON.stringify({ contract: "immune_brain/project_config/v2", loop: { mode: "assist", allowed_actors: ["owner"], allowed_associations: ["OWNER"] } }, null, 2)}\n`,
	);
	return { root, stateDir: join(root, ".imm/state/loop") };
}

function mockGh(): GhTransport {
	return { async run(): Promise<{ status: number; stdout: string; stderr: string }> {
		return { status: 0, stdout: "", stderr: "" };
	} };
}

function makeFakeGitHubPort(): LoopGitHubPort {
	return {
		async postComment(targetNumber: number) {
			return { id: targetNumber * 1000 + 1 };
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
		async checkLog() {
			return null;
		},
		async prReviewComments() {
			return [];
		},
	};
}

function issueEvent(number = 42): E1NewIssueEvent {
	return {
		contract: LOOP_DAEMON_EVENT_CONTRACT,
		event_id: `evt-e1-${number}`,
		kind: "E1_NEW_ISSUE",
		timestamp: NOW,
		issue_number: number,
		title: "Add a widget",
		body: "Please add a widget.",
		author: "dev",
		labels: [],
		created_at: NOW,
		updated_at: NOW,
	};
}

function ownerComment(author = "owner"): E3OwnerCommentEvent {
	return {
		contract: LOOP_DAEMON_EVENT_CONTRACT,
		event_id: "evt-e3-1",
		kind: "E3_OWNER_COMMENT",
		timestamp: NOW,
		issue_number: 42,
		comment_id: 1,
		author,
		author_association: "OWNER",
		body: "Thanks.",
		created_at: NOW,
		updated_at: NOW,
	};
}

const GUARD_FACTS = { allowed_actors: ["owner"], allowed_associations: ["OWNER"], daemon_identity: "imm-bot" };

function analyzeRole(overrides: Partial<ResolvedLoopRole> = {}): ResolvedLoopRole {
	return {
		...defaultLoopRole("analyze"),
		name: "security-analyst",
		source: "project",
		...overrides,
	};
}

function catalog(): ResolvedLoopRole[] {
	return [defaultLoopRole("leader"), defaultLoopRole("plan"), analyzeRole()];
}

function dispatched(decision: { decision_id: string }, outcome: LoopDispatchRecord["outcome"], detail: string): LoopDispatchRecord {
	return { contract: "assurance_kernel/loop_dispatch_record/v1", decision_id: decision.decision_id, handler: "draft_plan", outcome, detail, recorded_at: NOW };
}

function deps(ws: { root: string; stateDir: string }, overrides: Partial<LeaderDispatchDeps> = {}): LeaderDispatchDeps {
	return {
		root: ws.root,
		stateDir: ws.stateDir,
		now: NOW,
		dry_run: false,
		fingerprint: "sha256:test",
		roles: catalog(),
		guardFacts: GUARD_FACTS,
		events: [issueEvent()],
		candidates: [],
		max_concurrent: 3,
		dispatches_today: 0,
		max_dispatches_per_day: null,
		runNext: async ({ decision }) => [dispatched(decision, "executed", "handler ran")],
		planInitiative: async () => null,
		runKernel: () => ({ exit_code: 1, json: { reason: "kernel_unavailable" } }),
		startSession: async () => ({ completed: false, reason: "session_provider_unavailable" }),
		...overrides,
	};
}

function seedItem(ws: { stateDir: string }, state: "triage" | "planning" | "plan_published" | "repairing" = "triage") {
	writeWorkItem(ws.stateDir, newWorkItem("issue-42", state, NOW));
	return readWorkItem(ws.stateDir, "issue-42")!;
}

function itemFile(ws: { stateDir: string }): string {
	return readFileSync(join(ws.stateDir, "work_items", "issue-42.json"), "utf8");
}

describe("Loop Leader: guarded dispatch (S3-AC1)", () => {
	it("runs a legal next item's handler and moves the work item", async () => {
		const ws = workspace();
		seedItem(ws);
		const seen: Array<{ handler: string; tier: number; target: string }> = [];
		const results = await applyLeaderProposal([{ target: "issue-42", action: "next", handler: "draft_plan" }], {
			...deps(ws),
			runNext: async ({ decision }) => {
				seen.push({ handler: decision.handler, tier: decision.tier, target: `${decision.target.kind}-${decision.target.id}` });
				return [dispatched(decision, "executed", "draft_plan ran")];
			},
		});

		expect(seen).toEqual([{ handler: "draft_plan", tier: 0, target: "issue-42" }]);
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({ target: "issue-42", action: "next", outcome: "accepted", handler: "draft_plan" });
		expect(readWorkItem(ws.stateDir, "issue-42")?.state).toBe("planning");
		expect(readLeaderJournal(ws.stateDir).map((entry) => entry.kind)).toEqual(["accepted"]);
	});

	it("reorders ties inside one schedule class only", () => {
		const candidates: ScheduleCandidate[] = [
			{ target_id: "issue-2", handler: "draft_plan", leader_rank: 5, scope_hint: ["src/c"] },
			{ target_id: "issue-1", handler: "draft_plan", leader_rank: 1, scope_hint: ["src/b"] },
			// A higher class keeps its place whatever its rank says.
			{ target_id: "pr-9", handler: "repair_pr_ci", leader_rank: 9, scope_hint: ["src/a"] },
		];
		const result = scheduleLoopWork({
			candidates,
			active_leases: [],
			ready_buffer: 0,
			open_daemon_prs: 0,
			limits: { max_concurrent: 3, max_ready_buffer: 5, max_pr_buffer: 5 },
			budget: { ticks_today: 0, dispatches_today: 0, max_ticks_per_day: null, max_dispatches_per_day: null },
		});

		expect(result.dispatched).toEqual(["pr-9", "issue-1", "issue-2"]);
		const priorityOf = (target: string) => result.entries.find((entry) => entry.target_id === target)!.priority!;
		expect(priorityOf("pr-9")).toBe("pr_repair");
		expect(SCHEDULE_PRIORITY[priorityOf("pr-9")]).toBeLessThan(SCHEDULE_PRIORITY[priorityOf("issue-1")]);
	});

	it("shapes an Initiative into the Local carrier and one TaskIntent per slice, then drives it as an Initiative", async () => {
		const ws = workspace();
		const item = seedItem(ws, "planning");
		const prompts: string[] = [];
		const results = await applyLeaderProposal([{ target: "issue-42", action: "shape", plan: "initiative", reason: "four slices" }], {
			...deps(ws),
			planInitiative: async ({ target, reason }) => {
				prompts.push(`${target} ${reason}`);
				return {
					slug: "widget-initiative",
					slices: [
						{ slice_id: "s1", result: "schema first", path: "docs/plans/task-a.intent.json", intent: { task_id: "task-a", goal: "a" } },
						{ slice_id: "s2", result: "then the widget", path: "docs/plans/task-b.intent.json", intent: { task_id: "task-b", goal: "b" }, blocked_by: ["s1"] },
					],
				};
			},
			runKernel: ({ argv }) => {
				const taskId = argv[2]!.includes("task-a") ? "task-a" : "task-b";
				return { exit_code: 0, json: { valid: true, task_id: taskId, content_hash: `sha256:${taskId}`, risk: "routine" } };
			},
		});

		expect(prompts).toEqual(["issue-42 four slices"]);
		expect(results[0]).toMatchObject({ action: "shape", outcome: "accepted" });

		const carrier = readFileSync(join(ws.root, "docs/initiatives/widget-initiative.md"), "utf8");
		expect(carrier).toContain("## s1: schema first");
		expect(carrier).toContain("Tasks:");
		expect(carrier).toContain("- task-a");
		expect(carrier).toContain("Blocked by: s1");

		const shaped = readWorkItem(ws.stateDir, "issue-42")!;
		expect(shaped.binding.initiative_slug).toBe("widget-initiative");
		expect(shaped.binding.task_ids).toEqual(["task-a", "task-b"]);
		expect(shaped.binding.plan_digest).toMatch(/^[0-9a-f]{64}$/);
		expect(shaped.state).toBe("plan_published");
		expect(item.binding.initiative_slug).toBeUndefined();

		// The shape records a local-only publication: the drive enrolls from it and
		// the owner may approve its digest, but no plan comment is ever posted.
		const { readPlanPublication } = await import(
			"../plugins/immune-brain/runtime/loop_daemon/agent_handlers.ts"
		);
		const publication = readPlanPublication(ws.stateDir, 42)!;
		expect(publication.digest).toBe(shaped.binding.plan_digest);
		expect(publication.intents.map((intent) => intent.task_id).sort()).toEqual(["task-a", "task-b"]);
		expect(publication.published_comment_id).toBeNull();
		expect(publication.published_at).toBe(NOW);

		// D3.3: `driving` reads the carrier, not a single task intent.
		expect(drivingPlanSource(shaped)).toBe("initiative");
		expect(drivingObserver(shaped)).toBe(observeInitiative);
		expect(drivingPlanSource(item)).toBe("single_task");
		expect(drivingObserver(item)).toBe(observeSingleTask);
	});

	it("covers the carrier and every TaskIntent in the plan digest", () => {
		const run = (result: string, contentHash: string) =>
			shapeInitiative(
				{ slug: "digest-initiative", slices: [{ slice_id: "s1", result, path: "docs/plans/task-a.intent.json", intent: { task_id: "task-a" } }] },
				{
					root: tempDir("imm-leader-digest-"),
					now: NOW,
					runKernel: () => ({ exit_code: 0, json: { valid: true, task_id: "task-a", content_hash: contentHash, risk: "routine" } }),
				},
			).plan_digest;

		expect(run("schema first", "sha256:a")).toBe(run("schema first", "sha256:a"));
		expect(run("schema first", "sha256:a")).not.toBe(run("schema second", "sha256:a"));
		expect(run("schema first", "sha256:a")).not.toBe(run("schema first", "sha256:b"));
		expect(renderLocalInitiativeCarrier({ slug: "x", slices: [{ slice_id: "s1", result: "r", task_id: "t" }] })).toBe(
			"# Initiative: x\n\n## s1: r\n\nTasks:\n\n- t\n",
		);
	});

	it("lists model-skipped decisions as briefing reconcile candidates and gates a leader next through Tier-0", async () => {
		const ws = workspace();
		seedItem(ws);
		const skipped = ownerComment();
		appendLoopDecision(
			ws.stateDir,
			buildDecisionRecord(
				skipped,
				{
					tier: 2,
					handler: "noop_record",
					reason: "a18_event_prefilter judged the comment informational",
					guard: null,
					classification: { point: "a18_event_prefilter", choice: "ignore", confidence: 0.95 },
					kept_for_reconciliation: true,
				},
				eventTarget(skipped),
				{ recorded_at: NOW, dry_run: false },
			),
		);

		expect(reconcileCandidates(ws.stateDir)).toEqual([
			expect.objectContaining({ target: "issue-42", point: "a18_event_prefilter", choice: "ignore" }),
		]);
		const briefingBefore = compileLeaderBriefing(
			collectLeaderBriefingInput({
				root: ws.root,
				stateDir: ws.stateDir,
				roles: catalog(),
				ownerHints: [],
				budget: { leader_wakes: "available", dispatches: "available" },
			}),
		);
		expect(briefingBefore.briefing.reconcile_candidates).toEqual([{ target: "issue-42", reason: "a18_event_prefilter: ignore" }]);

		const reconcile = await reconcileSkippedDecisions({ stateDir: ws.stateDir, dryRun: true, now: NOW });
		expect(reconcile).toMatchObject({ checked: 1 });
		// D3.4: reconcile starts no session and writes nothing of its own.
		expect(listRoleSessions(ws.stateDir)).toEqual([]);

		// A live pass reports the skip once and retires it: the candidate list
		// cannot grow without bound while the decision log keeps the evidence.
		const live = await reconcileSkippedDecisions({ stateDir: ws.stateDir, dryRun: false, now: NOW });
		expect(live.candidates).toHaveLength(1);
		const again = await reconcileSkippedDecisions({ stateDir: ws.stateDir, dryRun: false, now: NOW });
		expect(again).toMatchObject({ checked: 0, candidates: [] });
		expect(reconcileCandidates(ws.stateDir)).toEqual([]);

		// A verified owner comment passes every Tier-0 guard, so the next runs.
		const accepted = await applyLeaderProposal([{ target: "issue-42", action: "next", handler: "draft_plan" }], {
			...deps(ws),
			events: [skipped],
			candidates: reconcileCandidates(ws.stateDir),
		});
		expect(accepted[0]).toMatchObject({ outcome: "accepted", handler: "draft_plan" });

		// An unverified comment is blocked by G7: refused with its reason and no effect.
		const stranger = ownerComment("stranger");
		writeWorkItem(ws.stateDir, newWorkItem("issue-42", "triage", NOW));
		const before = itemFile(ws);
		const refused = await applyLeaderProposal([{ target: "issue-42", action: "next", handler: "draft_plan" }], {
			...deps(ws),
			events: [stranger],
			candidates: reconcileCandidates(ws.stateDir),
		});
		expect(refused[0]).toMatchObject({ outcome: "rejected" });
		expect(refused[0]!.reason).toContain("G7");
		expect(itemFile(ws)).toBe(before);
	});

	it("rejects an illegal transition, execute without Enrollment authority, repair outside the daemon branch, and shape after publication with zero side effects", async () => {
		const ws = workspace();
		seedItem(ws, "plan_published");
		const before = itemFile(ws);
		const results = await applyLeaderProposal(
			[
				// `plan_published` cannot go back to `planning`.
				{ target: "issue-42", action: "next", handler: "draft_plan" },
				{ target: "issue-42", action: "dispatch", role: "executor", subject: "write it", brief: "do the work" },
				{ target: "issue-42", action: "dispatch", role: "repairer", subject: "fix it", brief: "fix the branch" },
				{ target: "issue-42", action: "shape", plan: "initiative", reason: "too late" },
			],
			{
				...deps(ws),
				roles: [
					...catalog(),
					{ ...defaultLoopRole("execute"), name: "executor", source: "project" },
					{ ...defaultLoopRole("repair"), name: "repairer", source: "project" },
				],
			},
		);

		expect(results.map((result) => result.outcome)).toEqual(["rejected", "rejected", "rejected", "rejected"]);
		expect(results[0]!.reason).toContain("illegal_transition");
		expect(results[1]!.reason).toBe("execute_requires_enrollment_authority");
		expect(results[2]!.reason).toBe("repair_outside_daemon_branch");
		expect(results[3]!.reason).toContain("shape_after_plan_publication");
		expect(itemFile(ws)).toBe(before);
		expect(listRoleSessions(ws.stateDir)).toEqual([]);
		expect(existsSync(join(ws.root, "docs/initiatives"))).toBe(false);
		expect(readLeaderJournal(ws.stateDir).map((entry) => entry.kind)).toEqual(["rejected", "rejected", "rejected", "rejected"]);
	});

	it("retires the judging agent: no judging role, no judging session and no reconcile session", async () => {
		const ws = workspace();
		expect(READ_ONLY_SESSION_ROLES).not.toContain("judging" as never);
		expect(Object.keys(ROLE_SESSION_LIMITS)).not.toContain("judging");
		expect(existsSync(join(import.meta.dir, "../plugins/immune-brain/runtime/loop_daemon/judging_agent.ts"))).toBe(false);

		const skipped = ownerComment();
		appendLoopDecision(
			ws.stateDir,
			buildDecisionRecord(
				skipped,
				{
					tier: 2,
					handler: "noop_record",
					reason: "kept for reconciliation",
					guard: null,
					classification: { point: "a19_owner_comment_intent", choice: "discussion", confidence: 0.99 },
					kept_for_reconciliation: true,
				},
				eventTarget(skipped),
				{ recorded_at: NOW, dry_run: false },
			),
		);
		const reconcile = await runLoopDaemonCli(["reconcile", "--json"], ws.root);
		expect(reconcile.returncode).toBe(0);
		const payload = JSON.parse(reconcile.stdout);
		expect(payload.candidates).toHaveLength(1);
		expect(payload.candidates[0]).toMatchObject({ target: "issue-42", point: "a19_owner_comment_intent" });
		expect(listRoleSessions(ws.stateDir)).toEqual([]);
	});
});

describe("Loop Leader: catalog dispatch sessions (S3-AC2)", () => {
	it("starts one read-only analyze session, lists it while running, and takes completion from the record", async () => {
		const ws = workspace();
		seedItem(ws);
		const requests: AgentSessionRequest[] = [];
		let release: (() => void) | null = null;
		const started = applyLeaderProposal(
			[
				{
					target: "issue-42",
					action: "dispatch",
					role: "security-analyst",
					subject: "Extract the auth module",
					brief: "Check the auth module for injection paths.",
				},
			],
			{
				...deps(ws),
				startSession: async ({ role, brief }) => {
					requests.push({
						kind: "analyze",
						worktree_path: "/tmp/unused",
						prompt: `${role.name}: ${brief}`,
						turn_budget: role.limits.turn_budget,
						timeout_ms: role.limits.timeout_s * 1000,
						env: {},
					});
					await new Promise<void>((resolve) => {
						release = resolve;
					});
					return { completed: true, reason: "completed: evidence output sha256:abc" };
				},
			},
		);

		// The session record is written before the session runs, so status can list it.
		await new Promise((resolve) => setTimeout(resolve, 5));
		const status = await runLoopDaemonCli(["status", "--json"], ws.root);
		expect(status.returncode).toBe(0);
		expect(JSON.parse(status.stdout).sessions).toEqual([
			{ target: "issue-42", role: "security-analyst", base: "analyze", started_at: NOW },
		]);

		release!();
		const results = await started;
		expect(requests).toHaveLength(1);
		expect(requests[0]!.prompt).toContain("Check the auth module for injection paths.");
		expect(results[0]).toMatchObject({ action: "dispatch", outcome: "accepted", session_id: expect.any(String) });
		expect(runningRoleSessions(ws.stateDir)).toEqual([]);
		expect(listRoleSessions(ws.stateDir)).toEqual([
			expect.objectContaining({ target: "issue-42", role: "security-analyst", base: "analyze", status: "completed" }),
		]);
		expect(readLeaderJournal(ws.stateDir).map((entry) => entry.kind)).toEqual(["accepted"]);
	});

	it("takes a failed session's outcome from its record, not from what it printed", async () => {
		const ws = workspace();
		seedItem(ws);
		const provider: AgentSessionProvider = {
			// A truthful-looking reply is not evidence: a read-only role that printed nothing delivered nothing.
			async run(_request: AgentSessionRequest): Promise<AgentSessionProcess> {
				return { exit_code: 0, exit_signal: null, timed_out: false, stdout: "" };
			},
		};
		const module = await import("../plugins/immune-brain/runtime/loop_daemon/cli.ts");
		const results = await applyLeaderProposal(
			[{ target: "issue-42", action: "dispatch", role: "security-analyst", subject: "s", brief: "b" }],
			{
				...deps(ws),
				startSession: module.createRoleSessionRunner({ provider, root: ws.root, stateDir: ws.stateDir, snapshot: { issues: [], pull_requests: [], observed_at: NOW } }),
			},
		);
		expect(results[0]).toMatchObject({ outcome: "rejected" });
		expect(results[0]!.reason).toContain("session_output_missing");
		expect(listRoleSessions(ws.stateDir)[0]).toMatchObject({ status: "failed" });
	});

	it("rejects a role absent from the catalog, one at max_parallel, and an exhausted daily dispatch budget", async () => {
		const ws = workspace();
		seedItem(ws);
		const catalogWithBrokenRole = resolveLoopRoles({
			root: ws.root,
			roles: {
				"security-analyst": { base: "analyze" },
				"dropped-role": { base: "invented" },
			},
		});
		expect(catalogWithBrokenRole.errors.map((error) => error.code)).toEqual(["role_base_unknown"]);
		expect(catalogWithBrokenRole.roles.map((role) => role.name)).not.toContain("dropped-role");

		const absent = await applyLeaderProposal(
			[{ target: "issue-42", action: "dispatch", role: "dropped-role", subject: "s", brief: "b" }],
			{ ...deps(ws), roles: catalogWithBrokenRole.roles },
		);
		expect(absent[0]).toMatchObject({ outcome: "rejected", reason: "role_not_in_catalog" });
		expect(listRoleSessions(ws.stateDir)).toEqual([]);

		const atParallel = analyzeRole({ limits: { turn_budget: 40, timeout_s: 900, max_parallel: 1 } });
		startRoleSession(ws.stateDir, { target: "issue-7", role: atParallel.name, base: atParallel.base, started_at: NOW });
		const parallel = await applyLeaderProposal(
			[{ target: "issue-42", action: "dispatch", role: "security-analyst", subject: "s", brief: "b" }],
			{ ...deps(ws), roles: [defaultLoopRole("leader"), atParallel] },
		);
		expect(parallel[0]).toMatchObject({ outcome: "rejected", reason: "role_max_parallel" });

		const exhausted = await applyLeaderProposal(
			[{ target: "issue-42", action: "dispatch", role: "plan", subject: "s", brief: "b" }],
			{ ...deps(ws), dispatches_today: 3, max_dispatches_per_day: 3 },
		);
		expect(exhausted[0]).toMatchObject({ outcome: "rejected", reason: "dispatch_budget_exhausted" });
		expect(runningRoleSessions(ws.stateDir).map((session) => session.target)).toEqual(["issue-7"]);
	});
});

describe("Loop Leader: one base, several roles (S3-AC2)", () => {
	it("runs the dispatched role on its own Host, model, effort and instructions", async () => {
		const ws = workspace();
		writeWorkItem(ws.stateDir, newWorkItem("issue-42", "triage", NOW));
		writeFileSync(join(ws.root, "role-notes.md"), "Check the auth module for confused-deputy paths.\n");
		const first = analyzeRole({ limits: { turn_budget: 40, timeout_s: 900, max_parallel: 1 } });
		const second: ResolvedLoopRole = {
			...analyzeRole({ name: "perf-analyst", host: "claude-code", model: "m", effort: "high", instructions: "role-notes.md", source: "project" }),
			limits: { turn_budget: 12, timeout_s: 120, max_parallel: 1 },
		};
		const requests: AgentSessionRequest[] = [];
		const module = await import("../plugins/immune-brain/runtime/loop_daemon/cli.ts");
		const results = await applyLeaderProposal(
			[{ target: "issue-42", action: "dispatch", role: "perf-analyst", subject: "s", brief: "b" }],
			{
				...deps(ws),
				roles: [defaultLoopRole("leader"), first, second],
				startSession: module.createRoleSessionRunner({
					provider: {
						async run(request: AgentSessionRequest) {
							requests.push(request);
							return { exit_code: 0, exit_signal: null, timed_out: false, stdout: "{}" };
						},
					},
					root: ws.root,
					stateDir: ws.stateDir,
					snapshot: { issues: [], pull_requests: [], observed_at: NOW },
				}),
			},
		);
		expect(results[0]).toMatchObject({ outcome: "accepted" });
		expect(requests).toHaveLength(1);
		// The session runs as perf-analyst, not as the first analyze role: its own
		// Host and instructions, and its own limits.
		expect(requests[0]!.profile).toEqual({ host: "claude-code", model: "m", effort: "high", instructions: "role-notes.md" });
		expect(requests[0]!.turn_budget).toBe(12);
		expect(requests[0]!.timeout_ms).toBe(120_000);
	});
});

describe("Loop Leader: failed sessions and orphaned records (S3-AC2)", () => {
	it("counts a failed session against the daily dispatch budget", async () => {
		const ws = workspace();
		writeWorkItem(ws.stateDir, newWorkItem("issue-42", "triage", NOW));
		// A truthful-looking reply with no bytes is not evidence: the session
		// ran and failed, so the budget must see the attempt anyway.
		const provider: AgentSessionProvider = {
			async run() {
				return { exit_code: 0, exit_signal: null, timed_out: false, stdout: "" };
			},
		};
		const module = await import("../plugins/immune-brain/runtime/loop_daemon/cli.ts");
		const results = await applyLeaderProposal(
			[{ target: "issue-42", action: "dispatch", role: "security-analyst", subject: "s", brief: "b" }],
			{
				...deps(ws),
				startSession: module.createRoleSessionRunner({ provider, root: ws.root, stateDir: ws.stateDir, snapshot: { issues: [], pull_requests: [], observed_at: NOW } }),
			},
		);
		expect(results[0]).toMatchObject({ outcome: "rejected", session_started: true });
		expect(results[0]!.reason).toContain("session_output_missing");
	});

	it("counts a failed catalog session in the persisted daily budget", async () => {
		const ws = workspace();
		writeWorkItem(ws.stateDir, newWorkItem("issue-42", "triage", NOW));
		// One provider serves both sessions: the leader answers its proposal,
		// the catalog session it orders prints nothing and fails.
		const provider: AgentSessionProvider = {
			async run(request) {
				if (request.kind !== "leader") return { exit_code: 0, exit_signal: null, timed_out: false, stdout: "" };
				const promptFingerprint = /"briefing_fingerprint": "(sha256:[0-9a-f]{64})"/.exec(request.prompt)?.[1];
				return {
					exit_code: 0,
					exit_signal: null,
					timed_out: false,
					stdout: JSON.stringify({
						contract: LOOP_LEADER_PROPOSAL_CONTRACT,
						briefing_fingerprint: promptFingerprint,
						items: [{ target: "issue-42", action: "dispatch", role: "analyze", subject: "s", brief: "b" }],
					}),
				};
			},
		};
		const res = await runLoopDaemonCli(["tick", "--json"], ws.root, {
			gh: mockGh(),
			gitHubPort: makeFakeGitHubPort(),
			guardFacts: { daemon_identity: "imm-bot" },
			leader: { provider },
			snapshotOverride: { issues: [], pull_requests: [], observed_at: NOW },
		});
		expect(res.returncode).toBe(0);
		const payload = JSON.parse(res.stdout);
		expect(payload.leader_items).toHaveLength(1);
		expect(payload.leader_items[0]).toMatchObject({ action: "dispatch", outcome: "rejected", session_started: true });
		// One wake plus one failed catalog session: the attempt counts.
		expect(loadLoopState(ws.stateDir)?.stats.dispatches_today).toBe(2);
	});

	it("reaps a session a dead tick left running before admitting this tick's dispatch", async () => {
		const ws = workspace();
		writeWorkItem(ws.stateDir, newWorkItem("issue-42", "triage", NOW));
		const orphan = startRoleSession(ws.stateDir, { target: "issue-7", role: "analyze", base: "analyze", started_at: NOW });
		expect(runningRoleSessions(ws.stateDir)).toHaveLength(1);

		const provider: AgentSessionProvider = {
			async run(request) {
				const promptFingerprint = /"briefing_fingerprint": "(sha256:[0-9a-f]{64})"/.exec(request.prompt)?.[1];
				return {
					exit_code: 1,
					exit_signal: null,
					timed_out: false,
					stdout: "",
				};
			},
		};
		// A failing leader session still runs the tick: the reap happens before
		// items are applied, so the orphan is failed even with no accepted items.
		const res = await runLoopDaemonCli(["tick", "--json"], ws.root, {
			gh: mockGh(),
			gitHubPort: makeFakeGitHubPort(),
			guardFacts: { daemon_identity: "imm-bot" },
			leader: { provider },
			snapshotOverride: { issues: [], pull_requests: [], observed_at: NOW },
		});
		expect(res.returncode).toBe(0);
		const reaped = listRoleSessions(ws.stateDir).find((session) => session.session_id === orphan.session_id);
		expect(reaped).toMatchObject({ status: "failed" });
		expect(reaped!.reason).toContain("tick_interrupted");
		expect(runningRoleSessions(ws.stateDir)).toEqual([]);
	});
});

describe("Loop Leader: proposal contract stays closed (S3)", () => {
	it("carries the S2 proposal contract unchanged", () => {
		expect(LOOP_LEADER_PROPOSAL_CONTRACT).toBe("immune_brain/loop_leader_proposal/v1");
	});
});

describe("Loop Leader: initiative plan contract (S3-AC1)", () => {
	it("refuses a slice whose path is not the intent's canonical sidecar", () => {
		const bytes = JSON.stringify({
			contract: "immune_brain/loop_initiative_plan/v1",
			slug: "widget-initiative",
			slices: [
				{ slice_id: "s1", result: "schema first", path: "docs/plans/slice-a.intent.json", intent: { task_id: "task-a", goal: "a" } },
			],
		});
		expect(parseInitiativePlan(bytes)).toBeNull();
	});

	it("refuses a slice whose intent names no task_id", () => {
		const bytes = JSON.stringify({
			contract: "immune_brain/loop_initiative_plan/v1",
			slug: "widget-initiative",
			slices: [{ slice_id: "s1", result: "schema first", path: "docs/plans/task-a.intent.json", intent: { goal: "a" } }],
		});
		expect(parseInitiativePlan(bytes)).toBeNull();
	});

	it("rejects a shape for a target that is not one Issue", async () => {
		const ws = workspace();
		writeWorkItem(ws.stateDir, newWorkItem("pr-9", "triage", NOW));
		const results = await applyLeaderProposal([{ target: "pr-9", action: "shape", plan: "initiative", reason: "slices" }], {
			...deps(ws),
			planInitiative: async () => ({
				slug: "widget-initiative",
				slices: [{ slice_id: "s1", result: "r", path: "docs/plans/task-a.intent.json", intent: { task_id: "task-a" } }],
			}),
			runKernel: () => ({ exit_code: 0, json: { valid: true, task_id: "task-a", content_hash: "sha256:a", risk: "routine" } }),
		});
		expect(results[0]).toMatchObject({ outcome: "rejected", reason: "shape_target_not_issue" });
		expect(existsSync(join(ws.root, "docs/initiatives"))).toBe(false);
	});

	it("shapes from triage through planning, so the publication lands in plan_published", async () => {
		const ws = workspace();
		seedItem(ws, "triage");
		const results = await applyLeaderProposal([{ target: "issue-42", action: "shape", plan: "initiative", reason: "one slice" }], {
			...deps(ws),
			planInitiative: async () => ({
				slug: "widget-initiative",
				slices: [{ slice_id: "s1", result: "r", path: "docs/plans/task-a.intent.json", intent: { task_id: "task-a" } }],
			}),
			runKernel: () => ({ exit_code: 0, json: { valid: true, task_id: "task-a", content_hash: "sha256:a", risk: "routine" } }),
		});

		expect(results[0]).toMatchObject({ action: "shape", outcome: "accepted" });
		const shaped = readWorkItem(ws.stateDir, "issue-42")!;
		expect(shaped.state).toBe("plan_published");
		expect(shaped.refused_transitions).toEqual([]);
	});
});

function writeInitiativeFixture(ws: { root: string }): void {
	const verification = JSON.stringify({
		contract: "assurance_kernel/verification_descriptor/v2",
		command: { executable: "bun", argv: ["-e", "process.exit(0)"], cwd: ".", timeout_ms: 60000, max_output_bytes: 4096 },
		environment: { prepare: null, writable_paths: [] },
	});
	const intent = (taskId: string) =>
		`${JSON.stringify({ contract: "assurance_kernel/task_intent/v1", task_id: taskId, owner: "user", goal: `Deliver ${taskId}`,
			acceptance: [{ id: "A1", assertion: "A1 holds", verification }], scope_hint: ["delivery.txt"], risk: "routine", revision: 1 })}\n`;
	mkdirSync(join(ws.root, "docs/initiatives"), { recursive: true });
	mkdirSync(join(ws.root, "docs/plans"), { recursive: true });
	writeFileSync(
		join(ws.root, "docs/initiatives/widget-initiative.md"),
		"# Initiative: widget-initiative\n\n## s1: schema first\n\nTasks:\n\n- task-a\n\n## s2: then the widget\n\nTasks:\n\n- task-b\n\nBlocked by: task-a\n",
	);
	writeFileSync(join(ws.root, "docs/plans/task-a.intent.json"), intent("task-a"));
	writeFileSync(join(ws.root, "docs/plans/task-b.intent.json"), intent("task-b"));
	writeFileSync(join(ws.root, "delivery.txt"), "deliver\n");
	mkdirSync(join(ws.root, "docs/agents"), { recursive: true });
	writeFileSync(
		join(ws.root, "docs/agents/no-touch.json"),
		`${JSON.stringify({ contract: "immune_brain/no_touch/v1", paths: [] })}\n`,
	);
	execFileSync("git", ["add", "-A"], { cwd: ws.root });
	execFileSync("git", ["commit", "-qm", "initiative fixture"], { cwd: ws.root });
}

describe("Loop Leader: initiative drive (S3-AC1)", () => {
	it("drives the carrier as one batch through observeInitiative, with every slice as a batch child", async () => {
		const ws = workspace();
		execFileSync("git", ["config", "user.name", "Immune Test"], { cwd: ws.root });
		execFileSync("git", ["config", "user.email", "test@immune-brain.internal"], { cwd: ws.root });
		writeInitiativeFixture(ws);

		const seen: Array<{ initiative_slug: string; children: Array<{ task_id: string; blocked_by: string[] }> }> = [];
		const driver = (async (input: {
			initiative_slug: string;
			children: Array<{ task_id: string; blocked_by: string[] }>;
			plan_digest: string;
			batch_id: string;
		}) => {
			seen.push({ initiative_slug: input.initiative_slug, children: input.children.map((child) => ({ task_id: child.task_id, blocked_by: [...child.blocked_by] })) });
			return {
				report: {
					contract: "assurance_kernel/batch_run_report/v1",
					batch_id: input.batch_id,
					initiative_slug: input.initiative_slug,
					batch_state: "completed",
					children: input.children.map((child) => ({ task_id: child.task_id, state: "settled" })),
					commits: [],
					reason: null,
				},
				exit_record: {
					state: "exited",
					exit_code: 0,
					generation: 1,
					final_commit_sha: "a".repeat(40),
					verification_evidence_digest: "sha256:evidence",
				},
			};
		}) as never;

		const result = await driveInitiativeLane(
			{ root: ws.root, slug: "widget-initiative", task_ids: ["task-a", "task-b"], plan_digest: "sha256:plan", confirmation_ref: "policy_auto:plan", base_head: "deadbeef", now: NOW },
			{ stateDir: ws.stateDir, profile: { host: "pi", model: null, effort: null }, pluginRoot: ws.root },
			driver,
		);

		expect(result.settled).toBe(true);
		expect(result.exit).toMatchObject({ state: "exited", exit_code: 0 });
		// The batch ran the carrier's slices in carrier order with the carrier's
		// blocked_by edges: this is the `observeInitiative` drive D3.3 requires.
		expect(seen).toHaveLength(1);
		expect(seen[0]!.initiative_slug).toBe("widget-initiative");
		expect(seen[0]!.children.map((child) => child.task_id)).toEqual(["task-a", "task-b"]);
		expect(seen[0]!.children.find((child) => child.task_id === "task-b")!.blocked_by).toEqual(["task-a"]);
	});

	it("fails a drive whose carrier vanished before any driver runs", async () => {
		const ws = workspace();
		let driverCalls = 0;
		const result = await driveInitiativeLane(
			{ root: ws.root, slug: "missing-initiative", task_ids: [], plan_digest: "sha256:plan", confirmation_ref: "policy_auto:plan", base_head: "deadbeef", now: NOW },
			{ stateDir: ws.stateDir, profile: { host: "pi", model: null, effort: null }, pluginRoot: ws.root },
			(async () => {
				driverCalls += 1;
				throw new Error("must not run without a carrier");
			}) as never,
		);
		expect(result.settled).toBe(false);
		expect(result.reason).toContain("drive_preflight_failed");
		expect(driverCalls).toBe(0);
	});
});

describe("Loop Leader: dispatch budget persistence (S3-AC2)", () => {
	it("persists started leader sessions to the daily dispatch budget", async () => {
		const ws = workspace();
		writeWorkItem(ws.stateDir, newWorkItem("issue-42", "triage", NOW));
		const provider: AgentSessionProvider = {
			async run(request) {
				const promptFingerprint = /"briefing_fingerprint": "(sha256:[0-9a-f]{64})"/.exec(request.prompt)?.[1];
				return {
					exit_code: 0,
					exit_signal: null,
					timed_out: false,
					stdout: JSON.stringify({
						contract: LOOP_LEADER_PROPOSAL_CONTRACT,
						briefing_fingerprint: promptFingerprint,
						items: [
							{ target: "issue-42", action: "dispatch", role: "analyze", subject: "Extract the auth module", brief: "Check it." },
						],
					}),
				};
			},
		};
		const first = await runLoopDaemonCli(["tick", "--json"], ws.root, {
			gh: mockGh(),
			gitHubPort: makeFakeGitHubPort(),
			guardFacts: { daemon_identity: "imm-bot" },
			leader: { provider },
			// No events: the seeded work item names the briefing target, so the
			// only dispatches this tick are the leader's own.
			snapshotOverride: { issues: [], pull_requests: [], observed_at: NOW },
		});
		expect(first.returncode).toBe(0);
		const payload = JSON.parse(first.stdout);
		expect(payload.leader_items).toHaveLength(1);
		expect(payload.leader_items[0]).toMatchObject({ action: "dispatch", outcome: "accepted" });
		// One wake plus one started catalog session.
		expect(loadLoopState(ws.stateDir)?.stats.dispatches_today).toBe(2);
		// The session ran to completion inside the tick, so the registry holds
		// its completed record rather than a running entry.
		expect(listRoleSessions(ws.stateDir)).toEqual([
			expect.objectContaining({ target: "issue-42", role: "analyze", base: "analyze", status: "completed" }),
		]);
		expect(runningRoleSessions(ws.stateDir)).toEqual([]);
	});
});
