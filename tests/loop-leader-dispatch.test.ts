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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
import { resolveInitiativeBatchId } from "../plugins/immune-brain/runtime/loop_daemon/drive_dispatcher.ts";
import { batchStatePath } from "../plugins/immune-brain/runtime/kernel/storage_paths.ts";
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
import { observeInitiative, observeSingleTask, projectBatchPlan } from "../plugins/immune-brain/runtime/unattended/batch_plan.ts";
import { canonicalIntentHash } from "../plugins/immune-brain/runtime/kernel/intent.ts";
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

/** A complete TaskIntent, so a shaped carrier can be projected into a batch plan. */
function fullIntent(taskId: string, scope: string) {
	return {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		goal: `Deliver ${taskId}`,
		acceptance: [{ id: `acc-${taskId}`, assertion: `Deliver ${taskId}`, verification: "{}" }],
		scope_hint: [scope],
		risk: "material",
		revision: 1,
		owner: "user",
	};
}

/** Behaves like `intent author`: an exclusive create that refuses an existing destination. */
function exclusiveKernel(root: string, failOn: string[] = []): LeaderDispatchDeps["runKernel"] {
	return ({ argv, stdin }) => {
		const path = join(root, argv[2]!);
		if (failOn.includes(argv[2]!)) return { exit_code: 1, json: { valid: false, reason: "intent_invalid" } };
		if (existsSync(path)) return { exit_code: 1, json: { valid: false, reason: "destination_exists" } };
		const intent = JSON.parse(stdin ?? "{}") as { task_id: string; risk?: string };
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, stdin ?? "");
		return { exit_code: 0, json: { valid: true, task_id: intent.task_id, content_hash: canonicalIntentHash(intent), risk: intent.risk ?? "routine" } };
	};
}

/** Every path and byte under `root` that a shape could touch, for a before/after comparison. */
function snapshot(root: string): Record<string, string> {
	const out: Record<string, string> = {};
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (dir === root && (entry.name === ".git" || entry.name === ".imm")) continue;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				out[path.slice(root.length)] = "<dir>";
				walk(path);
			} else out[path.slice(root.length)] = readFileSync(path, "utf8");
		}
	};
	walk(root);
	return out;
}

function twoSlicePlan(overrides: { s2_blocked_by?: string[]; s2_slice_id?: string; s2_task_id?: string } = {}) {
	const taskB = overrides.s2_task_id ?? "task-b";
	return {
		slug: "widget-initiative",
		slices: [
			{ slice_id: "s1", result: "schema first", path: "docs/plans/task-a.intent.json", intent: fullIntent("task-a", "a/**") },
			{
				slice_id: overrides.s2_slice_id ?? "s2",
				result: "then the widget",
				path: `docs/plans/${taskB}.intent.json`,
				intent: fullIntent(taskB, "b/**"),
				blocked_by: overrides.s2_blocked_by ?? ["s1"],
			},
		],
	};
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
		// D2: the leader names s1, the carrier names its task, the namespace the drive reads.
		expect(carrier).toContain("Blocked by: task-a");
		expect(carrier).not.toContain("Blocked by: s1");

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

	// RF-AC2 / BR-SCN-1: dependencies live in the slice namespace and reach the carrier as task ids.
	it("writes the predecessor's task id into the carrier and projects the shaped plan without an unknown-Task error", async () => {
		const ws = workspace();
		seedItem(ws, "planning");
		const results = await applyLeaderProposal([{ target: "issue-42", action: "shape", plan: "initiative", reason: "two slices" }], {
			...deps(ws),
			planInitiative: async () => twoSlicePlan(),
			runKernel: exclusiveKernel(ws.root),
		});
		expect(results[0]).toMatchObject({ action: "shape", outcome: "accepted" });

		expect(readFileSync(join(ws.root, "docs/initiatives/widget-initiative.md"), "utf8")).toContain("Blocked by: task-a");
		execFileSync("git", ["add", "docs/plans"], { cwd: ws.root });
		const observed = await observeInitiative(ws.root, "widget-initiative");
		expect(observed.tasks.map((task) => [task.task_id, task.blocked_by])).toEqual([["task-a", []], ["task-b", ["task-a"]]]);
		const plan = await projectBatchPlan(ws.root, "widget-initiative", { confirmation_time: "2099-01-01T00:00:00.000Z" });
		expect(plan.children.map((child) => [child.task_id, child.blocked_by])).toEqual([["task-a", []], ["task-b", ["task-a"]]]);
	});

	it.each([
		["an unknown slice id", { s2_blocked_by: ["s9"] }, "unknown slice_id s9"],
		["its own slice id", { s2_blocked_by: ["s2"] }, "blocked by itself"],
		["a task id instead of a slice id", { s2_blocked_by: ["task-a"] }, "unknown slice_id task-a"],
		["a repeated predecessor", { s2_blocked_by: ["s1", "s1"] }, "repeats blocked_by s1"],
		["a duplicate slice id", { s2_slice_id: "s1", s2_blocked_by: [] }, "duplicate slice_id s1"],
		["a duplicate task id", { s2_task_id: "task-a", s2_blocked_by: [] }, "duplicate intent task_id task-a"],
	])("rejects a plan with %s and leaves no carrier, intent or binding", async (_name, overrides, reason) => {
		const ws = workspace();
		seedItem(ws, "planning");
		const before = snapshot(ws.root);
		const results = await applyLeaderProposal([{ target: "issue-42", action: "shape", plan: "initiative", reason: "inconsistent" }], {
			...deps(ws),
			planInitiative: async () => twoSlicePlan(overrides),
			runKernel: exclusiveKernel(ws.root),
		});
		expect(results[0]).toMatchObject({ action: "shape", outcome: "rejected" });
		expect(results[0]!.reason).toContain("shape_plan_failed");
		expect(results[0]!.reason).toContain(reason);
		expect(snapshot(ws.root)).toEqual(before);
		const stored = readWorkItem(ws.stateDir, "issue-42")!;
		expect(stored.binding.initiative_slug ?? null).toBeNull();
		expect(stored.binding.plan_digest ?? null).toBeNull();
		expect(readLeaderJournal(ws.stateDir).map((entry) => entry.kind)).toContain("rejected");
	});

	it("refuses to parse the same inconsistencies from the plan role's JSON", () => {
		const json = (blockedBy: string[]) =>
			JSON.stringify({
				contract: "immune_brain/loop_initiative_plan/v1",
				slug: "widget-initiative",
				slices: [
					{ slice_id: "s1", result: "r1", path: "docs/plans/task-a.intent.json", intent: { task_id: "task-a" } },
					{ slice_id: "s2", result: "r2", path: "docs/plans/task-b.intent.json", intent: { task_id: "task-b" }, blocked_by: blockedBy },
				],
			});
		expect(parseInitiativePlan(json(["s1"]))).not.toBeNull();
		expect(parseInitiativePlan(json(["task-a"]))).toBeNull();
		expect(parseInitiativePlan(json(["s2"]))).toBeNull();
	});

	// RF-AC3 / BR-SCN-2: a refused shape leaves the checkout byte-identical.
	it("leaves docs/plans and docs/initiatives untouched when a later slice's Kernel author fails", async () => {
		const ws = workspace();
		seedItem(ws, "planning");
		mkdirSync(join(ws.root, "docs/plans"), { recursive: true });
		writeFileSync(join(ws.root, "docs/plans/keep.md"), "unrelated\n");
		const plan = twoSlicePlan();
		plan.slices.push({ slice_id: "s3", result: "third", path: "docs/plans/task-c.intent.json", intent: fullIntent("task-c", "c/**"), blocked_by: ["s2"] });
		const before = snapshot(ws.root);

		const results = await applyLeaderProposal([{ target: "issue-42", action: "shape", plan: "initiative", reason: "three slices" }], {
			...deps(ws),
			planInitiative: async () => plan,
			runKernel: exclusiveKernel(ws.root, ["docs/plans/task-c.intent.json"]),
		});

		expect(results[0]).toMatchObject({ outcome: "rejected" });
		expect(results[0]!.reason).toContain("intent_validation_failed: docs/plans/task-c.intent.json");
		expect(snapshot(ws.root)).toEqual(before);
		expect(readWorkItem(ws.stateDir, "issue-42")!.binding.plan_digest ?? null).toBeNull();
		expect(readLeaderJournal(ws.stateDir).map((entry) => entry.kind)).toContain("rejected");
	});

	it("neither overwrites nor removes a file that already sat at a slice path", async () => {
		const ws = workspace();
		seedItem(ws, "planning");
		mkdirSync(join(ws.root, "docs/plans"), { recursive: true });
		const theirs = `${JSON.stringify(fullIntent("task-b", "mine/**"), null, 2)}\n`;
		writeFileSync(join(ws.root, "docs/plans/task-b.intent.json"), theirs);
		const before = snapshot(ws.root);

		const results = await applyLeaderProposal([{ target: "issue-42", action: "shape", plan: "initiative", reason: "collision" }], {
			...deps(ws),
			planInitiative: async () => twoSlicePlan(),
			runKernel: exclusiveKernel(ws.root),
		});

		expect(results[0]).toMatchObject({ outcome: "rejected" });
		expect(results[0]!.reason).toContain("destination_exists");
		// task-a was authored first and is rolled back; task-b is the user's and stays as it was.
		expect(snapshot(ws.root)).toEqual(before);
		expect(readFileSync(join(ws.root, "docs/plans/task-b.intent.json"), "utf8")).toBe(theirs);
	});

	it("removes every authored intent and the directories it created when the carrier write fails", async () => {
		const ws = workspace();
		seedItem(ws, "planning");
		// A regular file where the carrier directory belongs makes the carrier write fail after all intents exist.
		mkdirSync(join(ws.root, "docs"), { recursive: true });
		writeFileSync(join(ws.root, "docs/initiatives"), "not a directory\n");
		const before = snapshot(ws.root);

		const results = await applyLeaderProposal([{ target: "issue-42", action: "shape", plan: "initiative", reason: "carrier fails" }], {
			...deps(ws),
			planInitiative: async () => twoSlicePlan(),
			runKernel: exclusiveKernel(ws.root),
		});

		expect(results[0]).toMatchObject({ outcome: "rejected" });
		expect(existsSync(join(ws.root, "docs/plans"))).toBe(false);
		expect(snapshot(ws.root)).toEqual(before);
		expect(readWorkItem(ws.stateDir, "issue-42")!.binding.plan_digest ?? null).toBeNull();
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

describe("Loop Leader: Initiative entry batch resolution (ULS S2-AC2)", () => {
	const SLUG = "widget-initiative";
	const TASKS = ["task-a", "task-b"];

	/** A minimal v3 lane batch record, written where the batch store reads it. */
	function seedBatch(root: string, batchId: string, batchState: string, children = TASKS): void {
		const integrated = batchState === "completed";
		const commit = "a".repeat(40);
		const record = {
			contract: "assurance_kernel/batch_run_state/v3",
			batch_id: batchId,
			initiative_slug: SLUG,
			base_head: "deadbeef",
			branch: `imm/${SLUG}`,
			plan_digest: "sha256:plan",
			confirmation_time: NOW,
			batch_state: batchState,
			max_parallel: 1,
			children: children.map((taskId) => ({
				task_id: taskId,
				slice_id: taskId,
				state: integrated ? "integrated" : "pending",
				commit: integrated ? commit : null,
				blocked_by: [],
				reason: null,
				qa_failures: 0,
				lane: integrated
					? { path: root, branch: `imm/${SLUG}-${taskId}`, base_head: "deadbeef", lane_commit: commit, run_id: `run-${taskId}` }
					: null,
			})),
			commits: integrated ? [commit] : [],
			consecutive_qa_failures: 0,
			budget: { max_children: children.length, qa_failure_limit: 2 },
			created_at: NOW,
			updated_at: NOW,
		};
		const path = join(root, batchStatePath(batchId));
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
	}

	it("re-enters the recorded batch while it is active, without minting a second one", () => {
		const { root } = workspace();
		seedBatch(root, "batch-recorded", "running");
		for (let tick = 0; tick < 3; tick++) {
			expect(resolveInitiativeBatchId(root, SLUG, "batch-recorded", TASKS)).toEqual({ batch_id: "batch-recorded", origin: "recorded" });
		}
		expect(readdirSync(join(root, ".imm/state/batches")).filter((name) => name.endsWith(".json"))).toEqual(["batch-recorded.json"]);
	});

	it("adopts an active batch found by task lookup when the binding write never landed", () => {
		const { root } = workspace();
		// The daemon crashed after startLanes wrote the record but before WorkItem.binding.batch_id.
		seedBatch(root, "batch-orphaned", "running");
		expect(resolveInitiativeBatchId(root, SLUG, null, TASKS)).toEqual({ batch_id: "batch-orphaned", origin: "adopted" });
	});

	it("keeps a completed recorded batch so the job settles from it instead of starting another", () => {
		const { root } = workspace();
		seedBatch(root, "batch-done", "completed");
		expect(resolveInitiativeBatchId(root, SLUG, "batch-done", TASKS)).toEqual({ batch_id: "batch-done", origin: "recorded" });
	});

	it("drops a terminal or missing recorded batch before a new start", () => {
		const { root } = workspace();
		seedBatch(root, "batch-failed", "failed");
		for (const recorded of ["batch-failed", "batch-gone"]) {
			const resolved = resolveInitiativeBatchId(root, SLUG, recorded, TASKS);
			expect(resolved.origin).toBe("fresh");
			expect(resolved.batch_id).not.toBe(recorded);
			expect(resolved.batch_id.startsWith(`batch-${SLUG}-`)).toBe(true);
		}
	});

	it("no longer refuses lane_initiative_entry_pending: a fresh drive without configured final verification refuses final_verification_required before any write", async () => {
		const { root, stateDir } = workspace();
		const result = await driveInitiativeLane(
			{
				root,
				slug: SLUG,
				task_ids: TASKS,
				batch_id: null,
				plan_digest: "sha256:plan",
				confirmation_ref: "policy_auto:plan",
				base_head: "deadbeef",
				now: NOW,
			},
			{ stateDir, profile: { host: "claude-code" }, pluginRoot: root },
		);
		expect(result.settled).toBe(false);
		expect(result.exit).toBeNull();
		expect(result.batch_id).toBeNull();
		expect(result.reason).toContain("final_verification_required");
		expect(result.reason).not.toContain("lane_initiative_entry_pending");
		expect(existsSync(join(root, ".imm/state/batches"))).toBe(false);
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
