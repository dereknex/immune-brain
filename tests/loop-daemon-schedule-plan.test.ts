/**
 * Loop Daemon: Scheduler, Leases, Analysis Cache & Headless draw-up Tests (S4)
 *
 * Verifies S4-AC1 under docs/plans/loop-daemon-s4-schedule-plan.intent.json and
 * S4 / D4 in docs/specs/loop-daemon.spec.md:
 * - Positive Control: the scheduler dispatches in priority order under
 *   `max_concurrent`, `max_ready_buffer` and `max_pr_buffer`; leases are claimed
 *   atomically with heartbeats; analysis is cached under
 *   `.imm/state/loop/analysis/`; a validated plan is published on
 *   `imm-loop/<issue>` with a `plan_digest`.
 * - Negative Control: a candidate whose `scope_hint` overlaps an active lease via
 *   `scopesOverlap()` is held, and a plan the kernel does not report
 *   `enrollment_ready` (or whose intents overlap) is refused before any comment.
 * - Boundary / Fault Control: an expired lease with a dead PID is reclaimed
 *   cleanly, and budget exhaustion halts new dispatches via `G2`.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, existsSync, statSync, rmSync, writeFileSync } from "node:fs";
import process from "node:process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	analysisCacheKey,
	analyzeCodebase,
	readCachedAnalysis,
	type CodebaseAnalysisFindings,
} from "../plugins/immune-brain/runtime/loop_daemon/analysis_agent.ts";
import {
	acquireLoopLease,
	heartbeatLoopLease,
	leaseExpired,
	reclaimExpiredLeases,
	releaseLoopLease,
} from "../plugins/immune-brain/runtime/loop_daemon/leases.ts";
import {
	PLAN_DIGEST_MARKER,
	draftAndPublishPlan,
	parsePlanDigest,
	planBranchName,
	type PlanDraftDeps,
	type PlanDraftRequest,
} from "../plugins/immune-brain/runtime/loop_daemon/plan_drafter.ts";
import {
	SCHEDULE_PRIORITY,
	budgetExhausted,
	candidatePriority,
	scheduleLoopWork,
	type ScheduleBudget,
	type ScheduleCandidate,
	type ScheduleInput,
} from "../plugins/immune-brain/runtime/loop_daemon/scheduler.ts";
import { listLeases, saveLease } from "../plugins/immune-brain/runtime/loop_daemon/state.ts";
import {
	LOOP_DAEMON_LEASE_CONTRACT,
	type LoopLease,
} from "../plugins/immune-brain/runtime/loop_daemon/types.ts";

const TS = "2026-01-01T00:00:00.000Z";
const FIVE_MINUTES_LATER = "2026-01-01T00:05:00.000Z";
const ONE_HOUR_LATER = "2026-01-01T01:00:00.000Z";

const temp = mkdtempSync(join(tmpdir(), "loop-schedule-plan-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
let counter = 0;

function stateDir(): string {
	return join(temp, `state-${counter++}`);
}

function lease(targetId: string, overrides: Partial<LoopLease> = {}): LoopLease {
	return {
		contract: LOOP_DAEMON_LEASE_CONTRACT,
		target_id: targetId,
		kind: "drive",
		owner_pid: 4242,
		host_token: "host-a",
		scope_hint: [],
		acquired_at: TS,
		heartbeat_at: TS,
		status: "active",
		...overrides,
	};
}

function budget(overrides: Partial<ScheduleBudget> = {}): ScheduleBudget {
	return { ticks_today: 0, dispatches_today: 0, max_ticks_per_day: null, max_dispatches_per_day: null, ...overrides };
}

function scheduleInput(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
	return {
		candidates: [],
		active_leases: [],
		ready_buffer: 0,
		open_daemon_prs: 0,
		limits: { max_concurrent: 2, max_ready_buffer: 5, max_pr_buffer: 5 },
		budget: budget(),
		...overrides,
	};
}

describe("S4 continuous scheduler", () => {
	it("dispatches by D4.1 priority order and stops at max_concurrent", () => {
		const candidates: ScheduleCandidate[] = [
			{ target_id: "issue-5", handler: "triage_issue", scope_hint: ["tests/a/"] },
			{ target_id: "issue-6", handler: "draft_plan", scope_hint: ["docs/b/"] },
			{ target_id: "issue-7", handler: "enroll_and_drive", scope_hint: ["src/c/"] },
			{ target_id: "pr-9", handler: "repair_pr_ci", scope_hint: ["src/d/"] },
			{
				target_id: "issue-8",
				handler: "apply_lane_decision_reply",
				event_kind: "E7_LANE_DECISION_REPLIED",
				scope_hint: ["docs/e/"],
			},
		];

		const result = scheduleLoopWork(scheduleInput({ candidates }));

		// Only two slots: the owner reply (class 1) and the PR repair (class 2) start.
		expect(result.guard).toBeNull();
		expect(result.dispatched).toEqual(["issue-8", "pr-9"]);
		expect(result.entries.filter((entry) => entry.action === "hold").map((entry) => entry.target_id)).toEqual([
			"issue-7",
			"issue-6",
			"issue-5",
		]);
		expect(result.entries.find((entry) => entry.target_id === "issue-7")?.reason).toStartWith("max_concurrent:");
		// The projection counts its own tick, so persisting it advances max_ticks_per_day.
		expect(result.budget_after).toEqual({ ticks_today: 1, dispatches_today: 2 });
	});

	it("ranks every class exactly once and refuses handlers the scheduler does not own", () => {
		expect(candidatePriority({ target_id: "a", handler: "repair_pr_conflict" })).toBe("pr_repair");
		expect(candidatePriority({ target_id: "a", handler: "analyze_codebase" })).toBe("planning");
		expect(candidatePriority({ target_id: "a", handler: "noop_record" })).toBeNull();
		expect(candidatePriority({ target_id: "a", handler: "escalate" })).toBeNull();
		expect(
			candidatePriority({ target_id: "a", handler: "triage_issue", event_kind: "E3_OWNER_COMMENT" }),
		).toBe("owner_control");
		// An owner event elevates a dispatchable handler; it never makes an undispatched one schedulable.
		expect(candidatePriority({ target_id: "a", handler: "escalate", event_kind: "E3_OWNER_COMMENT" })).toBeNull();
		expect(candidatePriority({ target_id: "a", handler: "noop_record", event_kind: "E7_LANE_DECISION_REPLIED" })).toBeNull();
		expect(SCHEDULE_PRIORITY.owner_control).toBeLessThan(SCHEDULE_PRIORITY.pr_repair);
		expect(SCHEDULE_PRIORITY.pr_repair).toBeLessThan(SCHEDULE_PRIORITY.ready_task);
		expect(SCHEDULE_PRIORITY.ready_task).toBeLessThan(SCHEDULE_PRIORITY.planning);
		expect(SCHEDULE_PRIORITY.planning).toBeLessThan(SCHEDULE_PRIORITY.triage);

		const result = scheduleLoopWork(
			scheduleInput({ candidates: [{ target_id: "issue-1", handler: "escalate" }] }),
		);
		expect(result.dispatched).toEqual([]);
		expect(result.entries[0]!.reason).toStartWith("handler_not_scheduled:");
	});

	it("holds planning at max_ready_buffer and enrollment at max_pr_buffer", () => {
		const planning = scheduleLoopWork(
			scheduleInput({
				candidates: [{ target_id: "issue-6", handler: "draft_plan" }],
				ready_buffer: 2,
				limits: { max_concurrent: 4, max_ready_buffer: 2, max_pr_buffer: 5 },
			}),
		);
		expect(planning.dispatched).toEqual([]);
		expect(planning.entries[0]!.reason).toStartWith("max_ready_buffer:");

		const enrollment = scheduleLoopWork(
			scheduleInput({
				candidates: [{ target_id: "issue-7", handler: "enroll_and_drive" }],
				open_daemon_prs: 3,
				limits: { max_concurrent: 4, max_ready_buffer: 5, max_pr_buffer: 3 },
			}),
		);
		expect(enrollment.dispatched).toEqual([]);
		expect(enrollment.entries[0]!.reason).toStartWith("max_pr_buffer:");

		const planningUnderLimit = scheduleLoopWork(
			scheduleInput({
				candidates: [{ target_id: "issue-6", handler: "draft_plan" }],
				ready_buffer: 1,
				limits: { max_concurrent: 4, max_ready_buffer: 2, max_pr_buffer: 5 },
			}),
		);
		expect(planningUnderLimit.dispatched).toEqual(["issue-6"]);
	});

	it("counts a parked lane's lease against max_concurrent", () => {
		const result = scheduleLoopWork(
			scheduleInput({
				candidates: [{ target_id: "issue-7", handler: "enroll_and_drive", scope_hint: ["src/a/"] }],
				active_leases: [lease("issue-6", { status: "parked_for_decision", scope_hint: ["docs/b/"] })],
				limits: { max_concurrent: 1, max_ready_buffer: 5, max_pr_buffer: 5 },
			}),
		);
		expect(result.dispatched).toEqual([]);
		expect(result.entries[0]!.reason).toStartWith("max_concurrent:");
	});

	it("holds a candidate whose scope overlaps an active lease or an earlier dispatch", () => {
		const overlapping = scheduleLoopWork(
			scheduleInput({
				candidates: [
					{ target_id: "issue-7", handler: "draft_plan", scope_hint: ["plugins/immune-brain/runtime/loop_daemon/scheduler.ts"] },
				],
				active_leases: [lease("issue-6", { scope_hint: ["plugins/immune-brain/runtime/loop_daemon/"] })],
				limits: { max_concurrent: 4, max_ready_buffer: 5, max_pr_buffer: 5 },
			}),
		);
		expect(overlapping.dispatched).toEqual([]);
		expect(overlapping.entries[0]!.reason).toStartWith("scope_overlap:");

		const sameTick = scheduleLoopWork(
			scheduleInput({
				limits: { max_concurrent: 4, max_ready_buffer: 5, max_pr_buffer: 5 },
				candidates: [
					{ target_id: "issue-7", handler: "draft_plan", scope_hint: ["docs/specs/"] },
					{ target_id: "issue-8", handler: "draft_plan", scope_hint: ["docs/specs/loop-daemon.spec.md"] },
				],
			}),
		);
		expect(sameTick.dispatched).toEqual(["issue-7"]);
		expect(sameTick.entries[1]!.reason).toStartWith("scope_overlap:");

		// An unknown scope proves nothing about a candidate, so it is serialized behind the lease.
		const unknownScope = scheduleLoopWork(
			scheduleInput({
				candidates: [{ target_id: "issue-7", handler: "draft_plan" }],
				active_leases: [lease("issue-6", { scope_hint: ["docs/"] })],
				limits: { max_concurrent: 4, max_ready_buffer: 5, max_pr_buffer: 5 },
			}),
		);
		expect(unknownScope.dispatched).toEqual([]);
		expect(unknownScope.entries[0]!.reason).toStartWith("scope_overlap:");

		const disjoint = scheduleLoopWork(
			scheduleInput({
				limits: { max_concurrent: 4, max_ready_buffer: 5, max_pr_buffer: 5 },
				candidates: [
					{ target_id: "issue-7", handler: "draft_plan", scope_hint: ["docs/specs/"] },
					{ target_id: "issue-8", handler: "draft_plan", scope_hint: ["tests/"] },
				],
			}),
		);
		expect(disjoint.dispatched).toEqual(["issue-7", "issue-8"]);
	});

	it("caps a tick's dispatches by the remaining daily budget", () => {
		const result = scheduleLoopWork(
			scheduleInput({
				candidates: [
					{ target_id: "pr-9", handler: "repair_pr_ci", scope_hint: ["src/a/"] },
					{ target_id: "pr-10", handler: "repair_pr_ci", scope_hint: ["src/b/"] },
				],
				limits: { max_concurrent: 4, max_ready_buffer: 5, max_pr_buffer: 5 },
				budget: budget({ dispatches_today: 3, max_dispatches_per_day: 4 }),
			}),
		);
		expect(result.guard).toBeNull();
		expect(result.dispatched).toHaveLength(1);
		const held = result.entries.filter((entry) => entry.action === "hold");
		expect(held).toHaveLength(1);
		expect(held[0]!.reason).toStartWith("daily dispatch budget exhausted");
		expect(result.budget_after).toEqual({ ticks_today: 1, dispatches_today: 4 });
	});

	it("holds the second ready task once a same-tick dispatch fills the PR buffer", () => {
		const result = scheduleLoopWork(
			scheduleInput({
				candidates: [
					{ target_id: "issue-7", handler: "enroll_and_drive", scope_hint: ["src/a/"] },
					{ target_id: "issue-8", handler: "enroll_and_drive", scope_hint: ["src/b/"] },
				],
				open_daemon_prs: 2,
				limits: { max_concurrent: 4, max_ready_buffer: 5, max_pr_buffer: 3 },
			}),
		);
		expect(result.dispatched).toEqual(["issue-7"]);
		expect(result.entries[1]!.reason).toStartWith("max_pr_buffer:");
	});

	it("binds max_ticks_per_day across successive ticks through the returned projection", () => {
		const first = scheduleLoopWork(scheduleInput({ budget: budget({ max_ticks_per_day: 2 }) }));
		expect(first.guard).toBeNull();
		expect(first.budget_after.ticks_today).toBe(1);

		const second = scheduleLoopWork(scheduleInput({ budget: { ...budget({ max_ticks_per_day: 2 }), ticks_today: first.budget_after.ticks_today } }));
		expect(second.guard).toBeNull();
		expect(second.budget_after.ticks_today).toBe(2);

		const third = scheduleLoopWork(scheduleInput({ budget: { ...budget({ max_ticks_per_day: 2 }), ticks_today: second.budget_after.ticks_today } }));
		expect(third.guard).toEqual({ id: "G2", detail: "daily tick budget exhausted (2/2)" });
	});

	it("halts every dispatch on budget exhaustion via G2", () => {
		const result = scheduleLoopWork(
			scheduleInput({
				candidates: [
					{ target_id: "pr-9", handler: "repair_pr_ci" },
					{ target_id: "issue-7", handler: "enroll_and_drive" },
				],
				budget: budget({ dispatches_today: 4, max_dispatches_per_day: 4 }),
			}),
		);
		expect(budgetExhausted(budget({ dispatches_today: 4, max_dispatches_per_day: 4 }))).toBe(
			"daily dispatch budget exhausted (4/4)",
		);
		expect(result.guard).toEqual({ id: "G2", detail: "daily dispatch budget exhausted (4/4)" });
		expect(result.dispatched).toEqual([]);
		expect(result.entries.every((entry) => entry.reason.startsWith("G2:"))).toBe(true);
		expect(result.budget_after).toEqual({ ticks_today: 1, dispatches_today: 4 });

		const tickBudget = scheduleLoopWork(
			scheduleInput({
				candidates: [{ target_id: "pr-9", handler: "repair_pr_ci" }],
				budget: budget({ ticks_today: 3, max_ticks_per_day: 3 }),
			}),
		);
		expect(tickBudget.guard?.id).toBe("G2");

		const paused = scheduleLoopWork(
			scheduleInput({ candidates: [{ target_id: "pr-9", handler: "repair_pr_ci" }], paused: true }),
		);
		expect(paused.guard?.id).toBe("G1");
		expect(paused.dispatched).toEqual([]);
	});
});

describe("S4 atomic leases", () => {
	it("claims .imm/state/loop/leases/<target>.lease.json atomically and refuses a live incumbent", () => {
		const dir = stateDir();
		const first = acquireLoopLease(dir, {
			target_id: "issue-7",
			kind: "drive",
			scope_hint: ["plugins/immune-brain/runtime/loop_daemon/"],
			host_token: "host-a",
			owner_pid: 4242,
			now: TS,
		});
		expect(first.acquired).toBe(true);

		const path = join(dir, "leases", "issue-7.lease.json");
		expect(statSync(path).mode & 0o777).toBe(0o600);
		const stored = JSON.parse(readFileSync(path, "utf8")) as LoopLease;
		expect(stored.contract).toBe(LOOP_DAEMON_LEASE_CONTRACT);
		expect(stored.host_token).toBe("host-a");
		expect(stored.scope_hint).toEqual(["plugins/immune-brain/runtime/loop_daemon/"]);

		const second = acquireLoopLease(
			dir,
			{ target_id: "issue-7", kind: "plan", host_token: "host-b", owner_pid: 777, now: FIVE_MINUTES_LATER },
			{ now: FIVE_MINUTES_LATER, is_alive: () => true },
		);
		expect(second.acquired).toBe(false);
		if (!second.acquired) expect(second.reason).toStartWith("leased by live pid 4242");
		expect(listLeases(dir)).toHaveLength(1);
		expect(listLeases(dir)[0]!.host_token).toBe("host-a");
	});

	it("heartbeats and releases only the lease's own host token", () => {
		const dir = stateDir();
		acquireLoopLease(dir, { target_id: "issue-7", kind: "drive", host_token: "host-a", owner_pid: 4242, now: TS });

		expect(heartbeatLoopLease(dir, "issue-7", { host_token: "host-b", now: FIVE_MINUTES_LATER })).toBeNull();
		expect(listLeases(dir)[0]!.heartbeat_at).toBe(TS);

		const refreshed = heartbeatLoopLease(dir, "issue-7", { host_token: "host-a", now: FIVE_MINUTES_LATER });
		expect(refreshed?.heartbeat_at).toBe(FIVE_MINUTES_LATER);

		expect(releaseLoopLease(dir, "issue-7", { host_token: "host-b" })).toBe(false);
		expect(releaseLoopLease(dir, "issue-7", { host_token: "host-a" })).toBe(true);
		expect(listLeases(dir)).toEqual([]);
	});

	it("never mutates another owner's lease when the host token is missing", () => {
		const dir = stateDir();
		acquireLoopLease(dir, { target_id: "issue-7", kind: "drive", host_token: "host-a", owner_pid: 4242, now: TS });

		expect(heartbeatLoopLease(dir, "issue-7", {} as { host_token: string })).toBeNull();
		expect(releaseLoopLease(dir, "issue-7", {} as { host_token: string })).toBe(false);
		const [stored] = listLeases(dir);
		expect(stored?.host_token).toBe("host-a");
		expect(stored?.heartbeat_at).toBe(TS);
	});

	it("never removes another holder's live gate", () => {
		const dir = stateDir();
		acquireLoopLease(dir, { target_id: "issue-7", kind: "drive", host_token: "host-a", owner_pid: 4242, now: TS });
		const liveGate = join(dir, "leases", ".issue-7.gate.1");
		writeFileSync(liveGate, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), gen: 1 }));

		expect(heartbeatLoopLease(dir, "issue-7", { host_token: "host-a", now: ONE_HOUR_LATER })).toBeNull();
		expect(heartbeatLoopLease(dir, "issue-7", { host_token: "host-a", now: ONE_HOUR_LATER })).toBeNull();
		expect(existsSync(liveGate)).toBe(true);

		rmSync(liveGate, { force: true });
		expect(heartbeatLoopLease(dir, "issue-7", { host_token: "host-a", now: ONE_HOUR_LATER })?.heartbeat_at).toBe(ONE_HOUR_LATER);
	});

	it("takes over an abandoned gate without leaving a live one behind", () => {
		const dir = stateDir();
		saveLease(dir, lease("issue-7", { heartbeat_at: TS, owner_pid: 4242, host_token: "host-a" }));
		writeFileSync(join(dir, "leases", ".issue-7.gate.1"), JSON.stringify({ pid: 999999, at: TS, gen: 1 }));

		const reclaimed = reclaimExpiredLeases(dir, { now: ONE_HOUR_LATER, is_alive: () => false });
		expect(reclaimed.map((entry) => entry.target_id)).toEqual(["issue-7"]);
		expect(existsSync(join(dir, "leases", ".issue-7.gate.1"))).toBe(false);
		const gateFilesNow = readdirSync(join(dir, "leases")).filter((name) => name.includes(".gate."));
		expect(gateFilesNow.every((name) => JSON.parse(readFileSync(join(dir, "leases", name), "utf8")).released === true)).toBe(true);
		// The reclaimed lease is gone, so the old owner cannot revive it.
		expect(heartbeatLoopLease(dir, "issue-7", { host_token: "host-a", now: ONE_HOUR_LATER })).toBeNull();
	});

	it("never reuses a gate generation, so a delayed release writes only its own path", () => {
		const dir = stateDir();
		const gateRecords = (): Array<{ gen: number; released?: boolean }> =>
			readdirSync(join(dir, "leases"))
				.filter((name) => name.includes(".gate."))
				.map((name) => JSON.parse(readFileSync(join(dir, "leases", name), "utf8")));
		const highestGeneration = (): number => Math.max(0, ...gateRecords().map((gate) => gate.gen));
		const expiry = { now: ONE_HOUR_LATER, is_alive: () => false };
		// Every acquisition below must take over an abandoned lease, which is the path that gates.
		const acquire = (host: string, pid: number) => {
			saveLease(dir, lease("issue-7", { heartbeat_at: TS, owner_pid: 999999 }));
			return acquireLoopLease(
				dir,
				{ target_id: "issue-7", kind: "drive", host_token: host, owner_pid: pid, now: ONE_HOUR_LATER },
				expiry,
			);
		};

		expect(acquire("h1", 9101).acquired).toBe(true);
		expect(highestGeneration()).toBe(1);
		expect(releaseLoopLease(dir, "issue-7", { host_token: "h1" })).toBe(true);
		expect(highestGeneration()).toBe(2);
		expect(acquire("h2", 9102).acquired).toBe(true);
		expect(highestGeneration()).toBe(3);
		const generations = gateRecords().map((gate) => gate.gen);
		expect(new Set(generations).size).toBe(generations.length);

		// The delayed holder of generation 1 gives its gate back: only its own path changes,
		// and the current generation record survives untouched.
		const current = gateRecords().find((gate) => gate.gen === 3);
		writeFileSync(
			join(dir, "leases", ".issue-7.gate.1"),
			JSON.stringify({ pid: process.pid, at: new Date().toISOString(), gen: 1, released: true }),
		);
		expect(gateRecords().find((gate) => gate.gen === 3)).toEqual(current);
		expect(heartbeatLoopLease(dir, "issue-7", { host_token: "h2", now: FIVE_MINUTES_LATER })?.heartbeat_at).toBe(FIVE_MINUTES_LATER);
		expect(highestGeneration()).toBe(4);
	});

	it("keeps heartbeat and reclaim mutually exclusive", () => {
		const dir = stateDir();
		saveLease(dir, lease("issue-7", { heartbeat_at: TS, owner_pid: 4242, host_token: "host-a" }));

		let heartbeat: LoopLease | null = null;
		const reclaimed = reclaimExpiredLeases(dir, {
			now: ONE_HOUR_LATER,
			is_alive: () => {
				// The reclaim already owns this target's gate: a heartbeat cannot land inside it.
				heartbeat = heartbeatLoopLease(dir, "issue-7", { host_token: "host-a", now: ONE_HOUR_LATER });
				return false;
			},
		});

		expect(heartbeat).toBeNull();
		expect(reclaimed.map((entry) => entry.target_id)).toEqual(["issue-7"]);
		expect(listLeases(dir)).toEqual([]);
		// The old owner cannot resurrect a lease the reclaimer took.
		expect(heartbeatLoopLease(dir, "issue-7", { host_token: "host-a", now: ONE_HOUR_LATER })).toBeNull();
	});

	it("reclaims an expired lease with a dead PID cleanly", () => {
		const dir = stateDir();
		saveLease(dir, lease("issue-7", { owner_pid: 999999, heartbeat_at: TS }));

		const result = acquireLoopLease(
			dir,
			{ target_id: "issue-7", kind: "drive", host_token: "host-a", owner_pid: 4242, now: ONE_HOUR_LATER },
			{ now: ONE_HOUR_LATER, is_alive: () => false },
		);
		expect(result.acquired).toBe(true);
		expect(result.reclaimed?.owner_pid).toBe(999999);
		const leases = listLeases(dir);
		expect(leases).toHaveLength(1);
		expect(leases[0]!.owner_pid).toBe(4242);
		expect(leases[0]!.host_token).toBe("host-a");
	});

	it("expires by TTL, by dead owner, and treats a corrupt heartbeat as expired", () => {
		const live = { is_alive: () => true };
		expect(leaseExpired(lease("a"), { now: FIVE_MINUTES_LATER, ...live })).toBe(false);
		expect(leaseExpired(lease("a"), { now: ONE_HOUR_LATER, ...live })).toBe(true);
		expect(leaseExpired(lease("a"), { now: FIVE_MINUTES_LATER, is_alive: () => false })).toBe(true);
		expect(leaseExpired(lease("a", { heartbeat_at: "not-a-time" }), { now: FIVE_MINUTES_LATER, ...live })).toBe(true);

		const dir = stateDir();
		saveLease(dir, lease("issue-7", { heartbeat_at: TS, owner_pid: 999999 }));
		saveLease(dir, lease("issue-8", { heartbeat_at: FIVE_MINUTES_LATER, owner_pid: 4242 }));
		const reclaimed = reclaimExpiredLeases(dir, { now: ONE_HOUR_LATER, is_alive: () => false });
		expect(reclaimed.map((entry) => entry.target_id).sort()).toEqual(["issue-7", "issue-8"]);
		expect(listLeases(dir)).toEqual([]);
	});
});

describe("S4 cached read-only analysis", () => {
	const findings: CodebaseAnalysisFindings = {
		scopes: ["plugins/immune-brain/runtime/loop_daemon/scheduler.ts"],
		seams: ["plugins/immune-brain/runtime/unattended/batch_schedule.ts#scopesOverlap"],
		questions: ["does the plan reuse the batch overlap helper?"],
	};

	it("caches findings under .imm/state/loop/analysis/ keyed by issue, body digest and tree", () => {
		const dir = stateDir();
		let probes = 0;
		const probe = () => {
			probes += 1;
			return findings;
		};
		const request = { stateDir: dir, issue_number: 42, issue_body: "body", base_tree_sha: "tree-a", probe, now: TS };

		const first = analyzeCodebase(request);
		expect(first.cached).toBe(false);
		expect(probes).toBe(1);

		const key = analysisCacheKey(request);
		const path = join(dir, "analysis", `${key}.json`);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(readCachedAnalysis(dir, key)?.findings).toEqual({
			scopes: findings.scopes,
			seams: findings.seams,
			questions: findings.questions!,
		});

		const second = analyzeCodebase(request);
		expect(second.cached).toBe(true);
		expect(probes).toBe(1);
		expect(second.entry.cache_key).toBe(key);

		const newTree = analyzeCodebase({ ...request, base_tree_sha: "tree-b" });
		expect(newTree.cached).toBe(false);
		expect(probes).toBe(2);
		expect(newTree.entry.cache_key).not.toBe(key);

		const newBody = analyzeCodebase({ ...request, issue_body: "body v2" });
		expect(newBody.cached).toBe(false);
		expect(probes).toBe(3);

		// An unreadable cache entry is rebuildable state: the probe runs again.
		writeFileSync(path, "{");
		expect(readCachedAnalysis(dir, key)).toBeNull();
		expect(analyzeCodebase(request).cached).toBe(false);
		expect(probes).toBe(4);
	});
});

describe("S4 headless draw-up plan publication", () => {
	function planRequest(overrides: Partial<PlanDraftRequest> = {}): PlanDraftRequest {
		return {
			root: join(temp, "repo"),
			issue_number: 7,
			worktree_path: join(temp, `worktree-${counter++}`),
			intents: [{ path: "docs/plans/issue-7.intent.json", intent: { task_id: "issue-7" } }],
			auto_enroll_max_risk: "routine",
			identity_posture: "isolated",
			...overrides,
		};
	}

	function deps(options: {
		enrollment_ready?: boolean;
		valid?: boolean;
		risk?: string;
		overlaps?: unknown[];
		malformedOverlap?: boolean;
	} = {}): PlanDraftDeps & { worktrees: Array<{ branch: string; path: string }>; comments: string[]; kernel_calls: string[][] } {
		const worktrees: Array<{ branch: string; path: string }> = [];
		const comments: string[] = [];
		const kernel_calls: string[][] = [];
		return {
			worktrees,
			comments,
			kernel_calls,
			createWorktree: (input) => worktrees.push({ branch: input.branch, path: input.path }),
			postComment: (input) => comments.push(input.body),
			runKernel: ({ argv }) => {
				kernel_calls.push(argv);
				if (argv[1] === "overlap") {
					if (options.malformedOverlap) return { exit_code: 0, json: {} };
					return {
						exit_code: 0,
						json: { contract: "assurance_kernel/intent_scope_overlap/v1", overlaps: options.overlaps ?? [] },
					};
				}
				return {
					exit_code: 0,
					json: {
						valid: options.valid ?? true,
						enrollment_ready: options.enrollment_ready ?? true,
						task_id: "issue-7",
						risk: options.risk ?? "routine",
						content_hash: `hash-${argv[2]}`,
					},
				};
			},
		};
	}

	it("publishes a validated plan on imm-loop/<issue> with a plan_digest marker", () => {
		const request = planRequest({
			spec: { path: "docs/specs/issue-7.spec.md", content: "# Spec\n" },
		});
		const fake = deps();

		const draft = draftAndPublishPlan(request, fake);

		expect(draft.branch).toBe("imm-loop/7");
		expect(planBranchName(7)).toBe("imm-loop/7");
		expect(fake.worktrees).toEqual([{ branch: "imm-loop/7", path: request.worktree_path }]);
		expect(readFileSync(join(request.worktree_path, "docs/specs/issue-7.spec.md"), "utf8")).toBe("# Spec\n");
		expect(fake.kernel_calls[0]).toEqual(["intent", "author", "docs/plans/issue-7.intent.json", "--stdin", "--json"]);
		expect(fake.comments).toHaveLength(1);
		expect(fake.comments[0]).toStartWith(`${PLAN_DIGEST_MARKER}${draft.digest} -->`);
		expect(parsePlanDigest(fake.comments[0]!)).toBe(draft.digest);
		expect(draft.comment_body).toBe(fake.comments[0]!);
		expect(draft.spec?.path).toBe("docs/specs/issue-7.spec.md");
		expect(draft.spec?.content_hash).toHaveLength(64);
		// Routine intent, isolated posture and routine-only policy_auto: no owner approval.
		expect(draft.requires_owner_approval).toBe(false);
		expect(fake.comments[0]).toContain("Eligible for `policy_auto` enrollment");
	});

	it("requires owner approval for a non-routine intent, a degraded posture or policy_auto none", () => {
		const cases: Array<{ request: Partial<PlanDraftRequest>; risk: string }> = [
			{ request: {}, risk: "material" },
			{ request: { auto_enroll_max_risk: "none" }, risk: "routine" },
			{ request: { identity_posture: "degraded" }, risk: "routine" },
		];
		for (const entry of cases) {
			const fake = deps({ risk: entry.risk });
			const draft = draftAndPublishPlan(planRequest(entry.request), fake);
			expect(draft.requires_owner_approval).toBe(true);
			expect(fake.comments[0]).toContain(`@imm-loop approve ${draft.digest}`);
		}
	});

	it("refuses a plan the kernel does not report enrollment_ready", () => {
		for (const overrides of [{ enrollment_ready: false }, { valid: false }]) {
			const fake = deps(overrides);
			expect(() => draftAndPublishPlan(planRequest(), fake)).toThrow(/intent_(not_enrollment_ready|validation_failed)/);
			expect(fake.comments).toEqual([]);
		}
	});

	it("refuses a plan whose drafted intents overlap", () => {
		const fake = deps({ overlaps: [{ task_ids: ["issue-7", "issue-8"], entries: [["docs/", "docs/plans/x.json"]] }] });
		const request = planRequest({
			intents: [
				{ path: "docs/plans/a.intent.json", intent: { task_id: "a" } },
				{ path: "docs/plans/b.intent.json", intent: { task_id: "b" } },
			],
		});
		expect(() => draftAndPublishPlan(request, fake)).toThrow(/intent_scope_overlap/);
		expect(fake.comments).toEqual([]);
		expect(fake.kernel_calls.map((argv) => argv[1])).toEqual(["author", "author", "overlap"]);

		const disjoint = deps();
		const published = draftAndPublishPlan(request, disjoint);
		expect(published.intents).toHaveLength(2);
		expect(disjoint.comments).toHaveLength(1);
	});

	it("refuses a plan when the kernel returns no overlap report", () => {
		const fake = deps({ malformedOverlap: true });
		const request = planRequest({
			intents: [
				{ path: "docs/plans/a.intent.json", intent: { task_id: "a" } },
				{ path: "docs/plans/b.intent.json", intent: { task_id: "b" } },
			],
		});
		expect(() => draftAndPublishPlan(request, fake)).toThrow(/intent_overlap_unverifiable/);
		expect(fake.comments).toEqual([]);
	});

	it("refuses a plan with no drafted intent", () => {
		const fake = deps();
		expect(() => draftAndPublishPlan(planRequest({ intents: [] }), fake)).toThrow(/plan_intents_required/);
		expect(fake.worktrees).toEqual([]);
		expect(fake.comments).toEqual([]);
	});
});
