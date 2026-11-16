/**
 * Loop Daemon: PR Repair Inputs (S8)
 *
 * Verifies S8-AC1 to S8-AC3 under docs/plans/loop-sched-s8-pr-repair.intent.json
 * and D9 of docs/specs/loop-agent-scheduling.spec.md:
 * - Positive control: the CI repair prompt carries the failing check's bounded log
 *   excerpt and its details URL, the PR worktree is fetched and reset to the PR head
 *   before the session, a conflicted rebase keeps the conflicted tree and runs a
 *   repair session that is pushed back with `--force-with-lease`, and three review
 *   comments on one PR head produce one session and one push with path, line and hunk.
 * - Negative control: an unavailable check log escalates and starts no session; a
 *   branch outside the daemon prefixes is never force-pushed; a review comment whose
 *   path is outside the TaskIntent `scope_hint` escalates instead of being applied; an
 *   unreported out-of-scope change by a CI, conflict or review session, or one left by
 *   verification after the scope check, escalates with no push; acceptance commands
 *   run without the daemon's GitHub credential.
 * - Boundary control: the excerpt never exceeds its byte limit and the S7
 *   two-attempt cap per `(head_sha, failure_signature)` still holds.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { LoopConfig } from "../plugins/immune-brain/runtime/config/layered_config.ts";
import {
	createAgentHandlerPort,
	observedWorktreePaths,
	runAcceptanceCommand,
	syncWorktreeToHead,
	type AgentHandlerContext,
	type AgentHandlerDeps,
	type AgentTaskIntent,
	type WorktreeGitRunner,
} from "../plugins/immune-brain/runtime/loop_daemon/agent_handlers.ts";
import {
	type AgentSessionProvider,
	type AgentSessionRequest,
} from "../plugins/immune-brain/runtime/loop_daemon/agent_runner.ts";
import type { LoopDecisionRecord } from "../plugins/immune-brain/runtime/loop_daemon/decision_record.ts";
import {
	createFakeLoopGitHubPort,
	type LoopGitHubPort,
} from "../plugins/immune-brain/runtime/loop_daemon/github_port.ts";
import {
	LOG_EXCERPT_BYTE_LIMIT,
	LOOP_PR_MARKER,
	boundLogExcerpt,
	isDaemonBranch,
	repairPrConflict,
	repairKey,
	saveRepairRetries,
} from "../plugins/immune-brain/runtime/loop_daemon/repair_agent.ts";
import {
	LOOP_DAEMON_EVENT_CONTRACT,
	type E10PRReviewCommentEvent,
	type E8PRCheckFailedEvent,
	type E9PRConflictEvent,
	type NormalizedLoopEvent,
	type ObservationInput,
	type RawPR,
} from "../plugins/immune-brain/runtime/loop_daemon/types.ts";

const TS = "2026-11-15T09:00:00.000Z";
const TASK_ID = "s8-fixture-task";
const BRANCH = `imm/${TASK_ID}`;
const HEAD_SHA = "a".repeat(40);
const DETAILS_URL = "https://github.com/example/repo/actions/runs/4242/job/9";

const roots: string[] = [];
afterAll(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(root: string, argv: string[]): string {
	return execFileSync("git", ["-C", root, ...argv], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const LOOP_CONFIG: LoopConfig = {
	mode: "assist",
	interval_seconds: 30,
	max_concurrent: 2,
	max_ready_buffer: 5,
	max_pr_buffer: 5,
	auto_enroll_max_risk: "none",
	allowed_actors: ["human-owner"],
	allowed_associations: ["OWNER", "MEMBER", "COLLABORATOR"],
	budget: { max_ticks_per_day: null, max_dispatches_per_day: null },
};

/** A repository on the daemon branch, so a session's `evidence.branch` is readable. */
function makeWorkspace(): { root: string; stateDir: string } {
	const root = mkdtempSync(join(tmpdir(), "imm-s8-pr-repair-"));
	roots.push(root);
	git(root, ["init", "-q"]);
	git(root, ["config", "user.name", "Immune Test"]);
	git(root, ["config", "user.email", "test@immune-brain.internal"]);
	mkdirSync(join(root, "src"), { recursive: true });
	mkdirSync(join(root, "docs/agents"), { recursive: true });
	writeFileSync(join(root, "src/seed.ts"), "export const seed = 1;\n");
	writeFileSync(
		join(root, "docs/agents/no-touch.json"),
		JSON.stringify({ contract: "immune_brain/no_touch/v1", paths: [] }, null, 2),
	);
	git(root, ["add", "-A"]);
	git(root, ["commit", "-q", "-m", "fixture: initial tree"]);
	git(root, ["branch", "-m", BRANCH]);
	const stateDir = join(root, ".imm/state/loop");
	mkdirSync(stateDir, { recursive: true });
	return { root, stateDir };
}

interface Harness {
	root: string;
	stateDir: string;
	gitHubPort: ReturnType<typeof createFakeLoopGitHubPort>;
	sessions: AgentSessionRequest[];
	trace: string[];
	pushed: Array<{ branch: string; message: string }>;
	forcePushed: Array<{ branch: string; message: string }>;
	port: ReturnType<typeof createAgentHandlerPort>;
	context: (
		event: NormalizedLoopEvent,
		overrides?: { scope_hint?: string[]; classification?: LoopDecisionRecord["classification"] },
	) => AgentHandlerContext;
}

function makeHarness(
	options: {
		scopeHint?: string[];
		verification?: number[];
		/** One answer per read, in order (the session's changes, then the pending commit); the last repeats. */
		changedPaths?: Array<string[] | null>;
	} = {},
): Harness {
	const workspace = makeWorkspace();
	const gitHubPort = createFakeLoopGitHubPort();
	const sessions: AgentSessionRequest[] = [];
	const trace: string[] = [];
	const pushed: Array<{ branch: string; message: string }> = [];
	const forcePushed: Array<{ branch: string; message: string }> = [];
	const verification = [...(options.verification ?? [1, 0])];
	const changed = [...(options.changedPaths ?? [["src/seed.ts"]])];

	const sessionProvider: AgentSessionProvider = {
		async run(request) {
			sessions.push(request);
			trace.push(`session:${request.kind}`);
			if (request.output_path === undefined) throw new Error(`repair session without an output path`);
			const target = join(request.worktree_path, request.output_path);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(
				target,
				JSON.stringify({ success: true, modified_paths: ["src/seed.ts"], reason: "fixture repair" }),
			);
			return { exit_code: 0, exit_signal: null, timed_out: false };
		},
	};

	const intent: AgentTaskIntent = {
		task_id: TASK_ID,
		path: `docs/plans/${TASK_ID}.intent.json`,
		revision: 1,
		content_hash: `sha256:${"b".repeat(64)}`,
		risk: "routine",
		scope_hint: options.scopeHint ?? ["src/"],
	};

	const deps: AgentHandlerDeps = {
		sessionProvider,
		session_credential: "ghs_daemon_credential",
		createWorktree: () => workspace.root,
		// What the session really changed, read from the worktree, not from its report.
		changedPaths: () => (changed.length > 1 ? changed.shift()! : (changed[0] ?? null)),
		prWorktree: ({ pr_number, branch, head_sha }) => {
			trace.push(`worktree:${pr_number}:${branch}:${head_sha}`);
			return workspace.root;
		},
		head: () => HEAD_SHA,
		baseBranch: () => "main",
		runKernel: () => ({ exit_code: 1, json: null }),
		readIntent: (taskId) => (taskId === TASK_ID ? intent : null),
		readComment: async () => null,
		enroll: async () => ({ record_revision: `sha256:${"c".repeat(64)}` }),
		drive: async () => ({ settled: false, exit: null, reason: "unused" }),
		runVerification: async () => {
			const exit_code = verification.length > 1 ? verification.shift()! : (verification[0] ?? 0);
			return { exit_code, stdout: "", stderr: exit_code === 0 ? "" : "fixture verification failed" };
		},
		gitCommitAndPush: async ({ branch, message }) => {
			pushed.push({ branch, message });
			return { commit_sha: "d".repeat(40) };
		},
		gitForcePushWithLease: async ({ branch, message }) => {
			forcePushed.push({ branch, message });
			return { commit_sha: "e".repeat(40) };
		},
		rebaseOrMerge: async () => ({ success: true }),
		now: () => TS,
	};

	return {
		root: workspace.root,
		stateDir: workspace.stateDir,
		gitHubPort,
		sessions,
		trace,
		pushed,
		forcePushed,
		port: createAgentHandlerPort(deps),
		context: (event, overrides = {}) => ({
			root: workspace.root,
			stateDir: workspace.stateDir,
			loopConfig: LOOP_CONFIG,
			snapshot: snapshotOf(event, daemonPr(event.pr_number)),
			guardFacts: {
				daemon_identity: "daemon-bot",
				allowed_actors: ["lead-reviewer", "human-owner"],
				allowed_associations: ["OWNER", "MEMBER", "COLLABORATOR"],
			},
			gitHubPort: gitHubPort as LoopGitHubPort,
			event,
			decision: decisionOf(event, overrides.classification ?? null),
			now: TS,
			standing_daemon: true,
		}),
	};
}

function daemonPr(prNumber: number, overrides: Partial<RawPR> = {}): RawPR {
	return {
		number: prNumber,
		title: "imm(s8): fixture",
		body: `${LOOP_PR_MARKER}\n\nCloses #10`,
		head_ref_name: BRANCH,
		head_sha: HEAD_SHA,
		base_ref_name: "main",
		state: "open",
		merged: false,
		mergeable: "CONFLICTING",
		checks: [],
		...overrides,
	};
}

function snapshotOf(event: NormalizedLoopEvent, pr: RawPR): ObservationInput {
	return { issues: [], pull_requests: [pr], lane_decisions: [], observed_at: TS };
}

function decisionOf(
	event: NormalizedLoopEvent,
	classification: LoopDecisionRecord["classification"],
): LoopDecisionRecord {
	return {
		contract: "assurance_kernel/loop_decision_record/v1",
		decision_id: `dec-${event.event_id}`,
		event_id: event.event_id,
		event_kind: event.kind,
		target: { kind: "pr", id: String("pr_number" in event ? event.pr_number : 0) },
		handler: "repair_pr_ci",
		tier: 2,
		reason: "fixture",
		guard: null,
		classification,
		dry_run: false,
		mutations: [],
		recorded_at: TS,
	};
}

function checkFailedEvent(overrides: Partial<E8PRCheckFailedEvent> = {}): E8PRCheckFailedEvent {
	return {
		contract: LOOP_DAEMON_EVENT_CONTRACT,
		event_id: "evt-e8-77",
		kind: "E8_PR_CHECK_FAILED",
		timestamp: TS,
		pr_number: 77,
		branch: BRANCH,
		head_sha: HEAD_SHA,
		check_name: "typecheck",
		failure_signature: "f".repeat(64),
		details_url: DETAILS_URL,
		...overrides,
	};
}

function conflictEvent(overrides: Partial<E9PRConflictEvent> = {}): E9PRConflictEvent {
	return {
		contract: LOOP_DAEMON_EVENT_CONTRACT,
		event_id: "evt-e9-77",
		kind: "E9_PR_CONFLICT",
		timestamp: TS,
		pr_number: 77,
		branch: BRANCH,
		base_branch: "main",
		head_sha: HEAD_SHA,
		...overrides,
	};
}

function reviewEvent(commentId: number): E10PRReviewCommentEvent {
	return {
		contract: LOOP_DAEMON_EVENT_CONTRACT,
		event_id: `evt-e10-78-${commentId}`,
		kind: "E10_PR_REVIEW_COMMENT",
		timestamp: TS,
		pr_number: 78,
		branch: BRANCH,
		comment_id: commentId,
		author: "lead-reviewer",
		author_association: "MEMBER",
		body: `comment ${commentId}`,
		path: "src/seed.ts",
		line: commentId,
	};
}

/** A log whose head is a unique marker and whose failing line is last, like a real CI log. */
function ciLog(): { text: string; tail: string } {
	const tail = "ERROR: expected 2 received 3";
	const text = `HEAD-MARKER\n${"noise line\n".repeat(3000)}${tail}`;
	return { text, tail };
}

describe("Suite 1: CI repair inputs (S8-AC1, D9)", () => {
	it("carries the bounded log excerpt and details URL, after resetting the worktree to the PR head", async () => {
		const harness = makeHarness({ verification: [1, 0] });
		const { text, tail } = ciLog();
		harness.gitHubPort.checkLogs.set(DETAILS_URL, text);

		const event = checkFailedEvent();
		const result = await harness.port.handle("repair_pr_ci", harness.context(event));

		expect(result.outcome).toBe("executed");
		expect(harness.sessions).toHaveLength(1);
		expect(harness.trace[0]).toBe(`worktree:77:${BRANCH}:${HEAD_SHA}`);
		expect(harness.trace[1]).toBe("session:repair");

		const prompt = harness.sessions[0]!.prompt;
		expect(prompt).toContain(DETAILS_URL);
		expect(prompt).toContain(tail);
		expect(prompt).not.toContain("HEAD-MARKER");
		expect(prompt).toContain(`signature ${event.failure_signature}`);
		expect(harness.pushed).toHaveLength(1);
	});

	it("runs the repair session without the daemon's GitHub credential", async () => {
		const harness = makeHarness({ verification: [1, 0] });
		harness.gitHubPort.checkLogs.set(DETAILS_URL, ciLog().text);

		await harness.port.handle("repair_pr_ci", harness.context(checkFailedEvent()));

		expect(harness.sessions).toHaveLength(1);
		expect(Object.keys(harness.sessions[0]!.env)).toEqual(["PATH"]);
	});

	it("escalates without pushing when the session changed a path it did not report and scope_hint excludes", async () => {
		// The session reports only src/seed.ts but also rewrote a workflow file.
		const harness = makeHarness({ verification: [1, 0], changedPaths: [["src/seed.ts", ".github/workflows/ci.yml"]] });
		harness.gitHubPort.checkLogs.set(DETAILS_URL, ciLog().text);

		const result = await harness.port.handle("repair_pr_ci", harness.context(checkFailedEvent()));

		expect(result.outcome).toBe("failed");
		expect(result.detail).toContain("escalate");
		expect(result.detail).toContain(".github/workflows/ci.yml");
		expect(harness.pushed).toHaveLength(0);
	});

	it("escalates without pushing when verification leaves an out-of-scope change behind", async () => {
		// The session stays in scope; the acceptance command then writes a workflow file.
		const harness = makeHarness({
			verification: [1, 0],
			changedPaths: [["src/seed.ts"], ["src/seed.ts", ".github/workflows/ci.yml"]],
		});
		harness.gitHubPort.checkLogs.set(DETAILS_URL, ciLog().text);

		const result = await harness.port.handle("repair_pr_ci", harness.context(checkFailedEvent()));

		expect(result.outcome).toBe("failed");
		expect(result.detail).toContain("not committed");
		expect(result.detail).toContain(".github/workflows/ci.yml");
		expect(harness.pushed).toHaveLength(0);
	});

	it("runs acceptance commands without the daemon's GitHub credential", () => {
		const saved = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
		process.env.GH_TOKEN = "ghs_daemon_credential";
		process.env.GITHUB_TOKEN = "ghs_daemon_credential";
		try {
			const { root } = makeWorkspace();
			const result = runAcceptanceCommand(root, {
				executable: "env",
				argv: [],
				cwd: ".",
				timeout_ms: 10_000,
				max_output_bytes: 65_536,
			});
			expect(result.exit_code).toBe(0);
			expect(result.stdout).toContain("PATH=");
			expect(result.stdout).not.toContain("ghs_daemon_credential");
		} finally {
			for (const [key, value] of Object.entries(saved)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});

	it("fails closed without pushing when the worktree changes cannot be read", async () => {
		const harness = makeHarness({ verification: [1, 0], changedPaths: [null] });
		harness.gitHubPort.checkLogs.set(DETAILS_URL, ciLog().text);

		const result = await harness.port.handle("repair_pr_ci", harness.context(checkFailedEvent()));

		expect(result.outcome).toBe("failed");
		expect(harness.pushed).toHaveLength(0);
	});

	it("observes committed, uncommitted and untracked changes since the start head, without session scratch", () => {
		const { root } = makeWorkspace();
		const run = (...argv: string[]) => execFileSync("git", argv, { cwd: root, encoding: "utf8" }).trim();
		run("add", "--all");
		run("commit", "-q", "--allow-empty", "-m", "base");
		const start = run("rev-parse", "HEAD");

		// A commit the session made itself, an unstaged edit, an untracked file and its result file.
		mkdirSync(join(root, ".github", "workflows"), { recursive: true });
		writeFileSync(join(root, ".github", "workflows", "ci.yml"), "on: push\n");
		run("add", ".github");
		run("commit", "-q", "-m", "session commit");
		writeFileSync(join(root, "src", "seed.ts"), "two\n");
		writeFileSync(join(root, "src", "new.ts"), "new\n");
		mkdirSync(join(root, ".imm-loop"), { recursive: true });
		writeFileSync(join(root, ".imm-loop", "repair.json"), "{}");

		expect(observedWorktreePaths(root, start)?.sort()).toEqual([".github/workflows/ci.yml", "src/new.ts", "src/seed.ts"]);
		expect(observedWorktreePaths(root, "0".repeat(40))).toBeNull();
	});

	it("escalates an unavailable check log and starts no session", async () => {
		const harness = makeHarness();
		// No log registered for the details URL: the fetch yields nothing.

		const result = await harness.port.handle("repair_pr_ci", harness.context(checkFailedEvent()));

		expect(result.outcome).toBe("failed");
		expect(result.detail).toContain("escalate");
		expect(result.detail).toContain("check log unavailable");
		expect(harness.sessions).toHaveLength(0);
		expect(harness.pushed).toHaveLength(0);
	});

	it("never lets the excerpt exceed its byte limit and keeps the failing tail", () => {
		const { text, tail } = ciLog();
		const bounded = boundLogExcerpt(text);
		expect(Buffer.byteLength(bounded, "utf8")).toBeLessThanOrEqual(LOG_EXCERPT_BYTE_LIMIT);
		expect(bounded.endsWith(tail)).toBe(true);
		expect(boundLogExcerpt("short log")).toBe("short log");
	});

	it("fetches the PR branch and resets the worktree to the PR head before a session", () => {
		const recorder = (rebasing: boolean) => {
			const calls: Array<{ cwd: string; argv: string[] }> = [];
			const run: WorktreeGitRunner = (cwd, argv) => {
				calls.push({ cwd, argv });
				if (argv[0] === "rev-parse" && argv[argv.length - 1] === "REBASE_HEAD")
					return { status: rebasing ? 0 : 1, stdout: "", stderr: "" };
				return { status: 0, stdout: "", stderr: "" };
			};
			return { calls, run };
		};

		const clean = recorder(false);
		syncWorktreeToHead({ worktree_path: "/worktrees/pr-77", branch: BRANCH, head_sha: HEAD_SHA }, clean.run);

		expect(clean.calls).toEqual([
			{ cwd: "/worktrees/pr-77", argv: ["rev-parse", "--verify", "--quiet", "REBASE_HEAD"] },
			{ cwd: "/worktrees/pr-77", argv: ["fetch", "origin", BRANCH] },
			{ cwd: "/worktrees/pr-77", argv: ["reset", "--hard", HEAD_SHA] },
		]);

		// An escalated conflict repair can leave a rebase in progress; the reset alone
		// would keep that state, so the sync aborts it before resetting.
		const stale = recorder(true);
		syncWorktreeToHead({ worktree_path: "/worktrees/pr-77", branch: BRANCH, head_sha: HEAD_SHA }, stale.run);

		expect(stale.calls).toEqual([
			{ cwd: "/worktrees/pr-77", argv: ["rev-parse", "--verify", "--quiet", "REBASE_HEAD"] },
			{ cwd: "/worktrees/pr-77", argv: ["rebase", "--abort"] },
			{ cwd: "/worktrees/pr-77", argv: ["fetch", "origin", BRANCH] },
			{ cwd: "/worktrees/pr-77", argv: ["reset", "--hard", HEAD_SHA] },
		]);

		const failing: WorktreeGitRunner = () => ({ status: 1, stdout: "", stderr: "boom" });
		expect(() =>
			syncWorktreeToHead({ worktree_path: "/worktrees/pr-77", branch: BRANCH, head_sha: HEAD_SHA }, failing),
		).toThrow("loop_worktree_failed");
	});

	it("still holds the two-attempt cap per (head_sha, failure_signature)", async () => {
		const harness = makeHarness();
		const event = checkFailedEvent();
		saveRepairRetries(harness.stateDir, { [repairKey(HEAD_SHA, event.failure_signature)]: 2 });

		const result = await harness.port.handle("repair_pr_ci", harness.context(event));

		expect(result.outcome).toBe("failed");
		expect(result.detail).toContain("repair attempt limit");
		expect(harness.sessions).toHaveLength(0);
	});
});

describe("Suite 2: Conflict repair (S8-AC2, D9)", () => {
	/** The handler deps of a conflicted rebase whose session reports `src/seed.ts` and really changed `changed`. */
	function conflictDeps(harness: Harness, changed: string[]): AgentHandlerDeps {
		return {
			sessionProvider: {
				async run(request) {
					harness.sessions.push(request);
					if (request.output_path === undefined) throw new Error("no output path");
					const target = join(request.worktree_path, request.output_path);
					mkdirSync(dirname(target), { recursive: true });
					writeFileSync(target, JSON.stringify({ success: true, modified_paths: ["src/seed.ts"] }));
					return { exit_code: 0, exit_signal: null, timed_out: false };
				},
			},
			session_credential: null,
			createWorktree: () => harness.root,
			changedPaths: () => changed,
			prWorktree: ({ head_sha }) => {
				harness.trace.push(`worktree:${head_sha}`);
				return harness.root;
			},
			head: () => HEAD_SHA,
			baseBranch: () => "main",
			runKernel: () => ({ exit_code: 1, json: null }),
			readIntent: () => ({
				task_id: TASK_ID,
				path: `docs/plans/${TASK_ID}.intent.json`,
				revision: 1,
				content_hash: `sha256:${"b".repeat(64)}`,
				risk: "routine",
				scope_hint: ["src/"],
			}),
			readComment: async () => null,
			enroll: async () => ({ record_revision: `sha256:${"c".repeat(64)}` }),
			drive: async () => ({ settled: false, exit: null, reason: "unused" }),
			runVerification: async () => ({ exit_code: 0, stdout: "", stderr: "" }),
			gitCommitAndPush: async ({ branch, message }) => {
				harness.pushed.push({ branch, message });
				return { commit_sha: "d".repeat(40) };
			},
			gitForcePushWithLease: async ({ branch, message }) => {
				harness.forcePushed.push({ branch, message });
				return { commit_sha: "e".repeat(40) };
			},
			rebaseOrMerge: async () => ({
				success: false,
				conflicting_paths: ["src/seed.ts"],
				error: "CONFLICT (content): Merge conflict in src/seed.ts",
			}),
			now: () => TS,
		};
	}

	it("keeps the conflicted tree, runs a repair session and force-pushes with lease on a daemon branch", async () => {
		const harness = makeHarness();
		// The production conflict deps are injected at the repair_agent seam; the handler
		// only binds the session and the lease-guarded push.
		const result = await createAgentHandlerPort(conflictDeps(harness, ["src/seed.ts"])).handle(
			"repair_pr_conflict",
			harness.context(conflictEvent()),
		);

		expect(result.outcome).toBe("executed");
		expect(harness.sessions).toHaveLength(1);
		expect(harness.sessions[0]!.prompt).toContain("src/seed.ts");
		expect(harness.forcePushed).toHaveLength(1);
		expect(harness.forcePushed[0]!.branch).toBe(BRANCH);
		expect(harness.pushed).toHaveLength(0);
	});

	it("escalates without pushing when the conflict session changed a path it did not report and scope_hint excludes", async () => {
		const harness = makeHarness();
		const result = await createAgentHandlerPort(conflictDeps(harness, ["src/seed.ts", ".github/workflows/ci.yml"])).handle(
			"repair_pr_conflict",
			harness.context(conflictEvent()),
		);

		expect(result.outcome).toBe("failed");
		expect(result.detail).toContain(".github/workflows/ci.yml");
		expect(harness.forcePushed).toHaveLength(0);
		expect(harness.pushed).toHaveLength(0);
	});

	it("never force-pushes a branch outside the daemon prefixes", async () => {
		const forcePushed: string[] = [];
		const result = await repairPrConflict({
			pr: {
				number: 91,
				head_ref_name: "feature/manual-branch",
				head_sha: HEAD_SHA,
				base_ref_name: "main",
				body: LOOP_PR_MARKER,
			},
			context: { worktree_path: "/worktree", task_id: "manual", scope_hint: ["src/"] },
			deps: {
				rebaseOrMerge: async () => ({ success: false, conflicting_paths: ["src/seed.ts"] }),
				applyConflictFix: async () => ({ success: true, modified_paths: ["src/seed.ts"] }),
				runVerification: async () => ({ exit_code: 0, stdout: "", stderr: "" }),
				gitCommitAndPush: async () => ({ commit_sha: "d".repeat(40) }),
				gitForcePushWithLease: async ({ branch }) => {
					forcePushed.push(branch);
					return { commit_sha: "e".repeat(40) };
				},
			},
		});

		expect(result.action).toBe("ignored");
		expect(forcePushed).toHaveLength(0);
		expect(isDaemonBranch("imm/x")).toBe(true);
		expect(isDaemonBranch("imm-loop/7")).toBe(true);
		expect(isDaemonBranch("feature/x")).toBe(false);
	});
});

describe("Suite 3: Review comment batching (S8-AC3, D9)", () => {
	const comments = [
		{
			id: 9001,
			path: "src/seed.ts",
			line: 3,
			body: "rename this helper",
			diff_hunk: "@@ -1,3 +1,3 @@ hunk-one",
			author: "lead-reviewer",
			author_association: "MEMBER",
		},
		{
			id: 9002,
			path: "src/seed.ts",
			line: 7,
			body: "drop the unused import",
			diff_hunk: "@@ -5,2 +5,2 @@ hunk-two",
			author: "lead-reviewer",
			author_association: "MEMBER",
		},
		{
			id: 9003,
			path: "src/seed.ts",
			line: 9,
			body: "tighten the type",
			diff_hunk: "@@ -9,1 +9,1 @@ hunk-three",
			author: "lead-reviewer",
			author_association: "MEMBER",
		},
	];

	it("turns three comments on one PR head into one session and one push carrying path, line and hunk", async () => {
		const harness = makeHarness({ verification: [0] });
		harness.gitHubPort.reviewComments = comments;
		const pr = daemonPr(78);

		const results = [];
		for (const comment of comments) {
			const event = reviewEvent(comment.id);
			const context: AgentHandlerContext = {
				...harness.context(event, {
					classification: { point: "a14_pr_comment_triage", choice: "nit", confidence: 0.9, truncation: "none" },
				}),
				snapshot: snapshotOf(event, pr),
			};
			results.push(await harness.port.handle("address_pr_review", context));
		}

		expect(results.map((entry) => entry.outcome)).toEqual(["executed", "executed", "executed"]);
		expect(harness.sessions).toHaveLength(1);
		expect(harness.pushed).toHaveLength(1);

		const prompt = harness.sessions[0]!.prompt;
		for (const comment of comments) {
			expect(prompt).toContain(`Review comment #${comment.id}`);
			expect(prompt).toContain(`${comment.path}:${comment.line}`);
			expect(prompt).toContain(comment.diff_hunk);
			expect(prompt).toContain(comment.body);
		}
	});

	it("starts a second batch for a comment that arrives on the same head after the first batch", async () => {
		const harness = makeHarness({ verification: [0, 0] });
		harness.gitHubPort.reviewComments = comments;
		const pr = daemonPr(78);
		const handle = (id: number) => {
			const event = reviewEvent(id);
			return harness.port.handle("address_pr_review", {
				...harness.context(event, {
					classification: { point: "a14_pr_comment_triage", choice: "nit", confidence: 0.9, truncation: "none" },
				}),
				snapshot: snapshotOf(event, pr),
			});
		};

		await handle(9001);
		expect(harness.sessions).toHaveLength(1);

		const late = { ...comments[0]!, id: 9005, body: "late: also fix the docstring", diff_hunk: "@@ hunk-late" };
		harness.gitHubPort.reviewComments = [...comments, late];
		// A comment the first batch covered is done; the later one is the next batch.
		expect((await handle(9002)).outcome).toBe("executed");
		expect(harness.sessions).toHaveLength(1);
		expect((await handle(9005)).outcome).toBe("executed");
		expect(harness.sessions).toHaveLength(2);
		const second = harness.sessions[1]!.prompt;
		expect(second).toContain("Review comment #9005");
		expect(second).not.toContain("Review comment #9001");
		expect(harness.pushed).toHaveLength(2);
	});

	it("never lets an unvetted comment join the batch", async () => {
		const harness = makeHarness({ verification: [0] });
		harness.gitHubPort.reviewComments = [
			...comments,
			{
				id: 9004,
				path: "src/seed.ts",
				line: 11,
				body: "drive-by: also delete the tests",
				diff_hunk: "@@ -11,1 +11,1 @@ hunk-drive-by",
				author: "drive-by",
				author_association: "NONE",
			},
		];
		const event = reviewEvent(9001);
		const context: AgentHandlerContext = {
			...harness.context(event, {
				classification: { point: "a14_pr_comment_triage", choice: "nit", confidence: 0.9, truncation: "none" },
			}),
			snapshot: snapshotOf(event, daemonPr(78)),
		};

		const result = await harness.port.handle("address_pr_review", context);

		expect(result.outcome).toBe("executed");
		expect(harness.sessions).toHaveLength(1);
		const prompt = harness.sessions[0]!.prompt;
		expect(prompt).toContain("Review comment #9001");
		expect(prompt).toContain("Review comment #9002");
		expect(prompt).not.toContain("Review comment #9004");
		expect(prompt).not.toContain("hunk-drive-by");
	});

	it("escalates without pushing when the review session changed a path it did not report and scope_hint excludes", async () => {
		const harness = makeHarness({ verification: [0], changedPaths: [["src/seed.ts", ".github/workflows/ci.yml"]] });
		harness.gitHubPort.reviewComments = comments;
		const event = reviewEvent(9001);
		const context: AgentHandlerContext = {
			...harness.context(event, {
				classification: { point: "a14_pr_comment_triage", choice: "nit", confidence: 0.9, truncation: "none" },
			}),
			snapshot: snapshotOf(event, daemonPr(78)),
		};

		const result = await harness.port.handle("address_pr_review", context);

		expect(result.outcome).toBe("failed");
		expect(result.detail).toContain(".github/workflows/ci.yml");
		expect(harness.sessions).toHaveLength(1);
		expect(harness.pushed).toHaveLength(0);
	});

	it("escalates instead of applying a comment whose path is outside scope_hint", async () => {
		const harness = makeHarness({ scopeHint: ["src/"] });
		harness.gitHubPort.reviewComments = [
			{
				id: 9001,
				path: "src/seed.ts",
				line: 3,
				body: "rename this helper",
				author: "lead-reviewer",
				author_association: "MEMBER",
			},
			{
				id: 9002,
				path: "docs/release-notes.md",
				line: 1,
				body: "rewrite the release notes",
				author: "lead-reviewer",
				author_association: "MEMBER",
			},
		];
		const event = reviewEvent(9001);
		const context: AgentHandlerContext = {
			...harness.context(event, {
				classification: { point: "a14_pr_comment_triage", choice: "nit", confidence: 0.9, truncation: "none" },
			}),
			snapshot: snapshotOf(event, daemonPr(78)),
		};

		const result = await harness.port.handle("address_pr_review", context);

		expect(result.outcome).toBe("failed");
		expect(result.detail).toContain("unauthorized path");
		expect(harness.sessions).toHaveLength(0);
		expect(harness.pushed).toHaveLength(0);
	});
});
