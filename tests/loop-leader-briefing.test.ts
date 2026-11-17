/**
 * Loop Daemon: Resident Leader Briefing, Wake and Journal (S2)
 *
 * Pins D2 of docs/specs/loop-leader.spec.md: the briefing is a pure function of
 * local state whose fingerprint is its digest, one changed fingerprint starts one
 * read-only leader session inside the wake budget, and every proposal is parsed
 * strictly and journaled without executing anything.
 */

import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import {
	isReadOnlyRole,
	sessionArguments,
	type AgentSessionProcess,
	type AgentSessionProvider,
	type AgentSessionRequest,
} from "../plugins/immune-brain/runtime/loop_daemon/agent_runner.ts";
import {
	LEADER_BRIEFING_MAX_BYTES,
	LEADER_RECENT_OUTCOMES,
	compileLeaderBriefing,
	leaderBriefingFingerprint,
	type LeaderBriefingInput,
} from "../plugins/immune-brain/runtime/loop_daemon/leader_briefing.ts";
import {
	LEADER_BRIEFING_FILE,
	LEADER_JOURNAL_TAIL_FILE,
	leaderEntryPrompt,
	leaderWakeDecision,
	leaderWorktreePath,
	runLeaderTick,
	type LeaderTickDeps,
} from "../plugins/immune-brain/runtime/loop_daemon/leader_agent.ts";
import {
	LEADER_JOURNAL_MAX_BYTES,
	leaderJournalPath,
	leaderJournalPreviousPath,
	leaderStateDir,
	readLeaderJournal,
} from "../plugins/immune-brain/runtime/loop_daemon/leader_journal.ts";
import {
	LOOP_LEADER_PROPOSAL_CONTRACT,
	LEADER_PROPOSAL_MAX_ITEMS,
	parseLeaderProposal,
} from "../plugins/immune-brain/runtime/loop_daemon/leader_proposal.ts";
import { defaultLoopRole } from "../plugins/immune-brain/runtime/loop_daemon/role_catalog.ts";
import { newWorkItem, writeWorkItem } from "../plugins/immune-brain/runtime/loop_daemon/work_items.ts";
import { runLoopDaemonCli } from "../plugins/immune-brain/runtime/loop_daemon/cli.ts";
import { loadLoopState } from "../plugins/immune-brain/runtime/loop_daemon/state.ts";
import { DEFAULT_LOOP_CONFIG } from "../plugins/immune-brain/runtime/config/layered_config.ts";

const NOW = "2026-11-17T10:00:00.000Z";
const ROOT = join(import.meta.dir, "..");

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

function stateDir(): string {
	return tempDir("imm-leader-state-");
}

/** One work item in the store, so the briefing has a target to name. */
function seedWorkItem(dir: string, target = "issue-42"): string {
	writeWorkItem(dir, newWorkItem(target, "triage", NOW));
	return target;
}

interface Recorded {
	request: AgentSessionRequest;
	/** The `.imm-loop` inputs the session was given, listed at call time. */
	inputs: string[];
	/** The briefing bytes exactly as the session read them. */
	briefing: string;
}

/**
 * A fake leader session: it answers with whatever `reply` builds from the
 * briefing it was shown, which is how a real session learns the fingerprint.
 */
function fakeLeader(reply: (recorded: Recorded) => string): { provider: AgentSessionProvider; calls: Recorded[] } {
	const calls: Recorded[] = [];
	const provider: AgentSessionProvider = {
		async run(request: AgentSessionRequest): Promise<AgentSessionProcess> {
			const inputDir = join(request.worktree_path, ".imm-loop");
			const briefing = readFileSync(join(request.worktree_path, LEADER_BRIEFING_FILE), "utf8");
			const recorded: Recorded = { request, inputs: readdirSync(inputDir).sort(), briefing };
			calls.push(recorded);
			return { exit_code: 0, exit_signal: null, timed_out: false, stdout: reply(recorded) };
		},
	};
	return { provider, calls };
}

/**
 * The fingerprint the prompt tells the session to echo. A real read-only session
 * cannot hash the briefing, so the prompt is the only place it can come from.
 */
function fingerprintFromPrompt(recorded: Recorded): string {
	const match = /"briefing_fingerprint": "(sha256:[0-9a-f]{64})"/.exec(recorded.request.prompt);
	if (!match) throw new Error("prompt carries no briefing_fingerprint");
	return match[1]!;
}

/** The fingerprint of the briefing bytes, for proving the prompt value is the real one. */
function digestOfBriefing(recorded: Recorded): string {
	return `sha256:${createHash("sha256").update(recorded.briefing.trim()).digest("hex")}`;
}

function proposal(recorded: Recorded, items: unknown[]): string {
	const targets = (JSON.parse(recorded.briefing) as { work_items: Array<{ target: string }> }).work_items;
	return JSON.stringify({
		contract: LOOP_LEADER_PROPOSAL_CONTRACT,
		briefing_fingerprint: fingerprintFromPrompt(recorded),
		items: items.map((item) => ({ target: targets[0]?.target ?? "issue-42", ...(item as object) })),
	});
}

function deps(dir: string, provider: AgentSessionProvider | null, overrides: Partial<LeaderTickDeps> = {}): LeaderTickDeps {
	return {
		root: tempDir("imm-leader-root-"),
		stateDir: dir,
		roles: [defaultLoopRole("leader"), defaultLoopRole("analyze")],
		mode: "assist",
		dry_run: false,
		now: NOW,
		turn_budget: 40,
		timeout_ms: 900_000,
		budget: { wakes_today: 0, max_leader_wakes_per_day: 48, dispatches_today: 0, max_dispatches_per_day: null },
		sessionProvider: provider,
		...overrides,
	};
}

describe("Loop Leader: briefing and wake (S2-AC1)", () => {
	it("wakes one read-only leader session on a changed fingerprint and journals wake and proposal", async () => {
		const dir = stateDir();
		seedWorkItem(dir);
		const { provider, calls } = fakeLeader((recorded) => proposal(recorded, [{ action: "note", text: "nothing to do" }]));
		const result = await runLeaderTick(deps(dir, provider));

		expect(result.woke).toBe(true);
		expect(result.reason).toBe("wake");
		expect(result.counted_wake).toBe(true);
		expect(result.proposal).toEqual({ items: 1, rejected: [] });
		expect(calls).toHaveLength(1);

		// The session is read-only and holds only the two leader inputs.
		expect(calls[0]!.request.kind).toBe("leader");
		expect(isReadOnlyRole("leader")).toBe(true);
		expect(calls[0]!.inputs).toEqual(["briefing.json", "journal-tail.jsonl"]);
		// The production path: no injected directory factory, so the real one is used.
		expect(calls[0]!.request.worktree_path).toBe(leaderWorktreePath(dir));
		expect(readdirSync(calls[0]!.request.worktree_path).sort()).toEqual([".imm-loop"]);
		// The prompt carries the real digest, which is the only way a read-only session can echo it.
		expect(fingerprintFromPrompt(calls[0]!)).toBe(digestOfBriefing(calls[0]!));
		expect(fingerprintFromPrompt(calls[0]!)).toBe(result.briefing_fingerprint);
		expect(calls[0]!.request.prompt).toContain(LEADER_BRIEFING_FILE);
		expect(calls[0]!.request.prompt).toContain(LEADER_JOURNAL_TAIL_FILE);

		// BR-REQ-2: no GitHub credential reaches the leader.
		expect(calls[0]!.request.env.GH_TOKEN).toBeUndefined();
		expect(calls[0]!.request.env.GITHUB_TOKEN).toBeUndefined();

		const journal = readLeaderJournal(dir);
		expect(journal.map((entry) => entry.kind)).toEqual(["wake", "proposal"]);
		expect(journal[0]!.fingerprint).toBe(result.briefing_fingerprint);
	});

	it("never grants the leader a write permission on any Host", () => {
		for (const host of ["claude-code", "pi", "antigravity"] as const) {
			const argv = sessionArguments("leader", { host, model: "m", effort: "high" }, "prompt", 40);
			expect(argv.join(" ")).not.toContain("acceptEdits");
			expect(argv.at(-1)).toBe("prompt");
		}
	});

	it("starts zero sessions when the fingerprint is unchanged, twice over", async () => {
		const dir = stateDir();
		seedWorkItem(dir);
		const { provider, calls } = fakeLeader((recorded) => proposal(recorded, [{ action: "note", text: "wait" }]));
		const first = await runLeaderTick(deps(dir, provider));
		const second = await runLeaderTick(deps(dir, provider));
		const third = await runLeaderTick(deps(dir, provider));

		expect(first.woke).toBe(true);
		expect(second.reason).toBe("fingerprint_unchanged");
		expect(third.reason).toBe("fingerprint_unchanged");
		expect(calls).toHaveLength(1);
		// The wake counts, the leader's own entries and the counters it moves are not facts.
		expect(second.briefing_fingerprint).toBe(first.briefing_fingerprint);
		expect(third.briefing_fingerprint).toBe(first.briefing_fingerprint);
	});

	it("wakes again when a local fact changes", async () => {
		const dir = stateDir();
		const target = seedWorkItem(dir);
		const { provider, calls } = fakeLeader((recorded) => proposal(recorded, []));
		const first = await runLeaderTick(deps(dir, provider));
		const item = newWorkItem(target, "triage", NOW);
		writeWorkItem(dir, { ...item, state: "clarifying", revision: item.revision + 1 });
		const second = await runLeaderTick(deps(dir, provider));

		expect(second.briefing_fingerprint).not.toBe(first.briefing_fingerprint);
		expect(second.woke).toBe(true);
		expect(calls).toHaveLength(2);
	});

	it("starts zero sessions when the leader wake budget is 0 or exhausted, or the dispatch budget is spent", async () => {
		const dir = stateDir();
		seedWorkItem(dir);
		const { provider, calls } = fakeLeader((recorded) => proposal(recorded, []));
		const disabled = await runLeaderTick(
			deps(dir, provider, { budget: { wakes_today: 0, max_leader_wakes_per_day: 0, dispatches_today: 0, max_dispatches_per_day: null } }),
		);
		const wakes = await runLeaderTick(
			deps(dir, provider, { budget: { wakes_today: 2, max_leader_wakes_per_day: 2, dispatches_today: 0, max_dispatches_per_day: null } }),
		);
		const dispatches = await runLeaderTick(
			deps(dir, provider, { budget: { wakes_today: 0, max_leader_wakes_per_day: 48, dispatches_today: 5, max_dispatches_per_day: 5 } }),
		);

		expect(disabled.reason).toBe("leader_disabled");
		expect(wakes.reason).toBe("leader_wake_budget_exhausted");
		expect(dispatches.reason).toBe("dispatch_budget_exhausted");
		expect(calls).toHaveLength(0);
		expect(readLeaderJournal(dir)).toEqual([]);
	});

	it("compiles and reports the briefing without waking under --dry-run or loop.mode observe", async () => {
		const dir = stateDir();
		seedWorkItem(dir);
		const { provider, calls } = fakeLeader((recorded) => proposal(recorded, []));
		const dry = await runLeaderTick(deps(dir, provider, { dry_run: true }));
		const observe = await runLeaderTick(deps(dir, provider, { mode: "observe" }));

		expect(dry.reason).toBe("dry_run");
		expect(observe.reason).toBe("mode_observe");
		expect(dry.briefing_fingerprint).toBe(observe.briefing_fingerprint);
		expect(dry.briefing_bytes).toBeGreaterThan(0);
		expect(calls).toHaveLength(0);
		expect(readLeaderJournal(dir)).toEqual([]);
	});

	it("names its one refusal cause in the wake rule", () => {
		const base = { fingerprint: "a", last_wake_fingerprint: null, mode: "assist", dry_run: false, session_available: true };
		const budget = { wakes_today: 0, max_leader_wakes_per_day: 48, dispatches_today: 0, max_dispatches_per_day: null };
		expect(leaderWakeDecision({ ...base, budget }).wake).toBe(true);
		expect(leaderWakeDecision({ ...base, budget, session_available: false }).reason).toBe("leader_session_unavailable");
		expect(leaderWakeDecision({ ...base, budget, last_wake_fingerprint: "a" }).reason).toBe("fingerprint_unchanged");
	});

	it("imports nothing from github_port.ts in any leader module", () => {
		for (const name of ["leader_agent", "leader_briefing", "leader_journal", "leader_proposal"]) {
			const source = readFileSync(join(ROOT, "plugins/immune-brain/runtime/loop_daemon", `${name}.ts`), "utf8");
			expect(source).not.toContain("github_port");
		}
	});

	it("caps the briefing at 64 KiB by dropping the oldest outcomes and never a work item", () => {
		const workItems = Array.from({ length: 40 }, (_, index) => ({
			target: `issue-${index}`,
			state: "triage",
			revision: 1,
			binding: { plan_digest: null, task_ids: [], run_id: null, pr: null },
			refusals: [],
			replan_rounds: 0,
			paused: false,
		}));
		const outcomes = Array.from({ length: LEADER_RECENT_OUTCOMES }, () => ({
			handler: "clarify_issue",
			outcome: "executed",
			detail: "x".repeat(5000),
		}));
		const input: LeaderBriefingInput = {
			work_items: workItems,
			batches: [],
			interactions: [],
			outcomes,
			reconcile_candidates: [],
			roles: [],
			owner_hints: [],
			budget: { leader_wakes: "available", dispatches: "available" },
		};
		const compiled = compileLeaderBriefing(input);

		expect(compiled.bytes).toBeLessThanOrEqual(LEADER_BRIEFING_MAX_BYTES);
		expect(compiled.dropped_outcomes).toBeGreaterThan(0);
		expect(compiled.briefing.outcomes.length).toBeLessThan(outcomes.length);
		expect(compiled.briefing.work_items).toHaveLength(workItems.length);
		// A briefing that fits is untouched, and equal briefings share one fingerprint.
		const small = compileLeaderBriefing({ ...input, outcomes: [], work_items: workItems.slice(0, 1) });
		expect(small.dropped_outcomes).toBe(0);
		expect(leaderBriefingFingerprint(small.briefing)).toBe(small.fingerprint);
	});

	it("counts one wake exactly once against both budgets through the daemon tick, and those counters never re-wake it", async () => {
		const root = tempDir("imm-leader-tick-");
		const dir = join(root, ".imm/state/loop");
		mkdirSync(dir, { recursive: true });
		seedWorkItem(dir);
		const { provider, calls } = fakeLeader((recorded) => proposal(recorded, [{ action: "note", text: "wait" }]));
		// The real tick, so the counting is the production one rather than a local copy.
		const tickOptions = () => ({
			stateDir: dir,
			lockHeld: true,
			isShutdownRequested: () => false,
			classify: async () => ({ status: "unavailable" as const, reason: "no_binding" as const, detail: "leader test" }),
			enabledPoints: [],
			snapshotOverride: { issues: [], pull_requests: [], observed_at: NOW },
			guardFacts: { daemon_identity: "daemon-bot" },
			loopConfig: { ...DEFAULT_LOOP_CONFIG, mode: "assist" as const, interaction: { channel: "github" as const } },
			leader: { provider },
		});

		const first = await runLoopDaemonCli(["tick", "--json"], root, tickOptions());
		expect(first.returncode).toBe(0);
		const firstLeader = (JSON.parse(first.stdout) as { leader: { woke: boolean; counted_wake: boolean; briefing_fingerprint: string } }).leader;
		expect(firstLeader).toMatchObject({ woke: true, counted_wake: true });

		const afterFirst = loadLoopState(dir)!;
		expect(afterFirst.stats.leader_wakes_today).toBe(1);
		expect(afterFirst.stats.dispatches_today).toBe(1);
		expect(afterFirst.stats.dispatches_total).toBe(1);

		// The counters the wake moved are not briefing facts, so the digest is unchanged
		// and the second tick starts nothing.
		const second = await runLoopDaemonCli(["tick", "--json"], root, tickOptions());
		expect(second.returncode).toBe(0);
		const secondLeader = (JSON.parse(second.stdout) as { leader: { woke: boolean; counted_wake: boolean; reason: string; briefing_fingerprint: string } }).leader;
		expect(secondLeader).toMatchObject({ woke: false, counted_wake: false, reason: "fingerprint_unchanged" });
		expect(secondLeader.briefing_fingerprint).toBe(firstLeader.briefing_fingerprint);
		expect(calls).toHaveLength(1);

		const afterSecond = loadLoopState(dir)!;
		expect(afterSecond.stats.leader_wakes_today).toBe(1);
		expect(afterSecond.stats.dispatches_today).toBe(1);
		expect(afterSecond.stats.dispatches_total).toBe(1);
	});
});

describe("Loop Leader: proposal parsing and journal (S2-AC2)", () => {
	it("parses every typed action and journals it while nothing else moves", async () => {
		const dir = stateDir();
		const target = seedWorkItem(dir);
		const before = JSON.parse(readFileSync(join(dir, "work_items", `${target}.json`), "utf8"));
		const { provider } = fakeLeader((recorded) =>
			proposal(recorded, [
				{ action: "next", handler: "clarify_issue" },
				{ action: "priority", rank: 3 },
				{ action: "shape", plan: "initiative", reason: "three slices" },
				{ action: "dispatch", role: "analyze", subject: "auth", brief: "check the token path" },
				{ action: "resolve", kind: "ask_owner", context: "which branch?" },
				{ action: "note", text: "waiting" },
			]),
		);
		const result = await runLeaderTick(deps(dir, provider));

		expect(result.proposal).toEqual({ items: 6, rejected: [] });
		const journal = readLeaderJournal(dir);
		expect(journal.map((entry) => entry.kind)).toEqual(["wake", "proposal"]);
		const recorded = journal[1]!.payload as { items: Array<{ action: string }> };
		expect(recorded.items.map((item) => item.action)).toEqual(["next", "priority", "shape", "dispatch", "resolve", "note"]);

		// Nothing executed: no state move, no interaction request, no journal `accepted`.
		const after = JSON.parse(readFileSync(join(dir, "work_items", `${target}.json`), "utf8"));
		expect(after.state).toBe(before.state);
		expect(after.revision).toBe(before.revision);
		expect(existsSync(join(dir, "interactions"))).toBe(false);
		expect(journal.some((entry) => entry.kind === "accepted")).toBe(false);
	});

	it("rejects the whole proposal on prose, a wrong contract or a stale fingerprint", async () => {
		const prose = fakeLeader(() => "I think we should clarify the Issue next.");
		const proseDir = stateDir();
		seedWorkItem(proseDir);
		expect((await runLeaderTick(deps(proseDir, prose.provider))).proposal_rejection).toBe("proposal_not_json");
		expect(readLeaderJournal(proseDir).map((entry) => entry.kind)).toEqual(["wake", "rejected"]);

		const wrong = fakeLeader((recorded) =>
			JSON.stringify({ contract: "assurance_kernel/loop_leader_proposal/v2", briefing_fingerprint: fingerprintFromPrompt(recorded), items: [] }),
		);
		const wrongDir = stateDir();
		seedWorkItem(wrongDir);
		expect((await runLeaderTick(deps(wrongDir, wrong.provider))).proposal_rejection).toBe("proposal_contract_mismatch");

		const stale = fakeLeader(() => JSON.stringify({ contract: LOOP_LEADER_PROPOSAL_CONTRACT, briefing_fingerprint: "sha256:stale", items: [] }));
		const staleDir = stateDir();
		seedWorkItem(staleDir);
		expect((await runLeaderTick(deps(staleDir, stale.provider))).proposal_rejection).toBe("proposal_fingerprint_mismatch");
	});

	it("rejects only the offending item and journals one rejected entry per item", async () => {
		const dir = stateDir();
		seedWorkItem(dir);
		const { provider } = fakeLeader((recorded) =>
			proposal(recorded, [
				{ action: "next", handler: "become_president" },
				{ action: "dispatch", role: "nobody", subject: "auth", brief: "check" },
				{ action: "dispatch", role: "analyze", subject: "auth", brief: "x".repeat(17 * 1024) },
				{ action: "resolve", kind: "ask_owner" },
				{ action: "note", text: "keep me" },
			]),
		);
		const result = await runLeaderTick(deps(dir, provider));

		expect(result.proposal?.items).toBe(1);
		expect(result.proposal?.rejected.map((rejection) => rejection.reason)).toEqual([
			"item_unknown_handler",
			"item_unknown_role",
			"item_brief_too_large",
			"item_ask_owner_context_missing",
		]);
		expect(readLeaderJournal(dir).map((entry) => entry.kind)).toEqual([
			"wake",
			"proposal",
			"rejected",
			"rejected",
			"rejected",
			"rejected",
		]);
	});

	it("refuses a proposal about a target the briefing never named", () => {
		const parsed = parseLeaderProposal(
			JSON.stringify({
				contract: LOOP_LEADER_PROPOSAL_CONTRACT,
				briefing_fingerprint: "sha256:abc",
				items: [{ target: "issue-999", action: "note", text: "hi" }],
			}),
			{ fingerprint: "sha256:abc", targets: ["issue-42"], roles: ["analyze"] },
		);
		expect(parsed.ok).toBe(true);
		expect(parsed.ok && parsed.rejected).toEqual([{ index: 0, target: "issue-999", reason: "item_unknown_target" }]);
	});

	it("refuses a proposal with more than 20 items", () => {
		const items = Array.from({ length: LEADER_PROPOSAL_MAX_ITEMS + 1 }, () => ({ target: "issue-42", action: "note", text: "hi" }));
		const parsed = parseLeaderProposal(
			JSON.stringify({ contract: LOOP_LEADER_PROPOSAL_CONTRACT, briefing_fingerprint: "sha256:abc", items }),
			{ fingerprint: "sha256:abc", targets: ["issue-42"], roles: [] },
		);
		expect(parsed).toEqual({ ok: false, reason: "proposal_items_exceeded" });
	});

	it("rebuilds an empty journal and wakes once after the leader state is deleted", async () => {
		const dir = stateDir();
		seedWorkItem(dir);
		const { provider, calls } = fakeLeader((recorded) => proposal(recorded, [{ action: "note", text: "hi" }]));
		expect((await runLeaderTick(deps(dir, provider))).woke).toBe(true);
		expect((await runLeaderTick(deps(dir, provider))).woke).toBe(false);

		rmSync(leaderStateDir(dir), { recursive: true, force: true });
		expect(readLeaderJournal(dir)).toEqual([]);
		const rebuilt = await runLeaderTick(deps(dir, provider));
		expect(rebuilt.woke).toBe(true);
		expect(calls).toHaveLength(2);
	});

	it("rotates the journal at 2 MiB and keeps exactly one previous file", async () => {
		const dir = stateDir();
		mkdirSync(leaderStateDir(dir), { recursive: true });
		const path = leaderJournalPath(dir);
		const filler = JSON.stringify({
			contract: "immune_brain/loop_leader_journal/v1",
			seq: 7,
			at: NOW,
			kind: "note",
			fingerprint: null,
			payload: { text: "x".repeat(LEADER_JOURNAL_MAX_BYTES) },
		});
		writeFileSync(path, `${filler}\n`, { mode: 0o600 });
		chmodSync(path, 0o600);
		expect(statSync(path).size).toBeGreaterThanOrEqual(LEADER_JOURNAL_MAX_BYTES);

		const dir2 = stateDir();
		mkdirSync(leaderStateDir(dir2), { recursive: true });
		writeFileSync(leaderJournalPath(dir2), `${filler}\n`, { mode: 0o600 });
		const { provider } = fakeLeader((recorded) => proposal(recorded, []));
		seedWorkItem(dir2);
		await runLeaderTick(deps(dir2, provider));

		expect(existsSync(leaderJournalPreviousPath(dir2))).toBe(true);
		expect(statSync(leaderJournalPreviousPath(dir2)).size).toBeGreaterThanOrEqual(LEADER_JOURNAL_MAX_BYTES);
		const current = readLeaderJournal(dir2);
		expect(current.map((entry) => entry.kind)).toEqual(["wake", "proposal"]);
		// Sequence numbers stay monotonic across the rotation.
		expect(current[0]!.seq).toBe(8);
		expect(statSync(leaderJournalPath(dir2)).mode & 0o777).toBe(0o600);
	});

	it("keeps the entry prompt to the two inputs and the reply contract", () => {
		const compiled = compileLeaderBriefing({
			work_items: [],
			batches: [],
			interactions: [],
			outcomes: [],
			reconcile_candidates: [],
			roles: [],
			owner_hints: [],
			budget: { leader_wakes: "available", dispatches: "available" },
		});
		const prompt = leaderEntryPrompt(compiled.briefing, compiled.fingerprint);
		expect(prompt).toContain(LEADER_BRIEFING_FILE);
		expect(prompt).toContain(LEADER_JOURNAL_TAIL_FILE);
		expect(prompt).toContain(LOOP_LEADER_PROPOSAL_CONTRACT);
		expect(prompt).toContain(compiled.fingerprint);
	});

	it("recreates its own directory each wake, so a previous proposal never reaches the next session", async () => {
		const dir = stateDir();
		const target = seedWorkItem(dir);
		const { provider, calls } = fakeLeader((recorded) => proposal(recorded, [{ action: "note", text: "hi" }]));
		expect((await runLeaderTick(deps(dir, provider))).woke).toBe(true);
		const worktree = leaderWorktreePath(dir);
		// A previous wake's artifacts and any stray file the daemon left behind.
		expect(existsSync(join(worktree, ".imm-loop/proposal.json"))).toBe(true);
		writeFileSync(join(worktree, "stray.txt"), "left over");

		const item = newWorkItem(target, "triage", NOW);
		writeWorkItem(dir, { ...item, state: "clarifying", revision: item.revision + 1 });
		expect((await runLeaderTick(deps(dir, provider))).woke).toBe(true);

		expect(calls).toHaveLength(2);
		// The session sees only the two inputs, and the stray file is gone.
		expect(calls[1]!.inputs).toEqual(["briefing.json", "journal-tail.jsonl"]);
		expect(existsSync(join(worktree, "stray.txt"))).toBe(false);
		expect(readdirSync(worktree).sort()).toEqual([".imm-loop"]);
	});
});
