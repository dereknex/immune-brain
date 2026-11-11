/**
 * Loop Daemon: Observation, Normalization, State & Lock Tests (S1)
 *
 * Verifies S1-AC1 under docs/plans/loop-daemon-s1-observe.intent.json and
 * S1 / D2 in docs/specs/loop-daemon.spec.md:
 * - Positive Control: imm-loop tick --dry-run normalizes E1-E11 events,
 *   persists state.json (0600), and imm-loop status --json reports watermarks.
 * - Negative Control: rejects concurrent imm-loop tick when daemon.lock is held by live PID.
 * - Boundary / Fault Control: deleting .imm/state/loop/ and running rebuildLoopState()
 *   reconstructs active leases and watermarks from GitHub fixtures + .imm/runs/*
 *   without re-dispatching active work.
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	LOOP_DAEMON_EVENT_CONTRACT,
	LOOP_DAEMON_LEASE_CONTRACT,
	LOOP_DAEMON_LOCK_CONTRACT,
	LOOP_DAEMON_STATE_CONTRACT,
	type ObservationInput,
	type RawIssue,
	type RawPR,
} from "../plugins/immune-brain/runtime/loop_daemon/types.ts";
import {
	acquireDaemonLock,
	findReclaimClaims,
	isPidAlive,
	readDaemonLock,
} from "../plugins/immune-brain/runtime/loop_daemon/lock.ts";
import {
	deleteLease,
	initLoopState,
	listLeases,
	loadLease,
	loadLoopState,
	saveLease,
	saveLoopState,
} from "../plugins/immune-brain/runtime/loop_daemon/state.ts";
import { normalizeEvents } from "../plugins/immune-brain/runtime/loop_daemon/events.ts";
import { observeGithub, pollPRsFromGithub } from "../plugins/immune-brain/runtime/loop_daemon/observer.ts";
import { rebuildLoopState } from "../plugins/immune-brain/runtime/loop_daemon/rebuild.ts";
import { runLoopDaemonCli } from "../plugins/immune-brain/runtime/loop_daemon/cli.ts";
import type { GhExecution, GhTransport } from "../plugins/immune-brain/runtime/github_issue_tracker.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN_IMM_LOOP = resolve(ROOT, "plugins/immune-brain/bin/imm-loop");

function createMockGhTransport(responses: {
	issuesJson?: unknown[];
	prsJson?: unknown[];
}): GhTransport {
	return {
		run: async (args: string[]): Promise<GhExecution> => {
			if (args[0] === "issue" && args[1] === "list") {
				return {
					exit_code: 0,
					stdout: JSON.stringify(responses.issuesJson ?? []),
					stderr: "",
					timed_out: false,
					output_exceeded: false,
				};
			}
			if (args[0] === "pr" && args[1] === "list") {
				return {
					exit_code: 0,
					stdout: JSON.stringify(responses.prsJson ?? []),
					stderr: "",
					timed_out: false,
					output_exceeded: false,
				};
			}
			return {
				exit_code: 0,
				stdout: "[]",
				stderr: "",
				timed_out: false,
				output_exceeded: false,
			};
		},
	};
}

describe("loop daemon observe, normalization, and state persistence (S1)", () => {
	let testDir: string;
	let stateDir: string;

	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), "loop-daemon-test-"));
		stateDir = join(testDir, ".imm/state/loop");
	});

	afterEach(() => {
		try {
			rmSync(testDir, { recursive: true, force: true });
		} catch {}
	});

	describe("1. Contract and Event Normalization (E1-E11)", () => {
		it("normalizes E1 (new issue) and E2 (edited issue)", () => {
			const input: ObservationInput = {
				issues: [
					{
						id: 101,
						number: 101,
						title: "Fresh issue",
						body: "Initial issue body",
						state: "open",
						created_at: "2026-11-11T10:00:00Z",
						updated_at: "2026-11-11T10:00:00Z",
						author: { login: "alice" },
						labels: ["enhancement"],
					},
					{
						id: 102,
						number: 102,
						title: "Existing edited issue",
						body: "Body updated after initial creation",
						state: "open",
						created_at: "2026-11-10T08:00:00Z",
						updated_at: "2026-11-11T11:00:00Z",
						author: { login: "bob" },
						labels: ["bug"],
					},
				],
				pull_requests: [],
				observed_at: "2026-11-11T12:00:00Z",
			};

			const prevState = initLoopState();
			prevState.watermarks.issues_updated_at = "2026-11-10T12:00:00Z";

			const events = normalizeEvents(input, prevState);

			const e1 = events.find((e) => e.kind === "E1_NEW_ISSUE");
			expect(e1).toBeDefined();
			expect(e1?.issue_number).toBe(101);
			expect(e1?.author).toBe("alice");
			expect(e1?.contract).toBe(LOOP_DAEMON_EVENT_CONTRACT);

			const e2 = events.find((e) => e.kind === "E2_ISSUE_EDITED");
			expect(e2).toBeDefined();
			expect(e2?.issue_number).toBe(102);
			expect(e2?.author).toBe("bob");
		});

		it("normalizes E3 (owner comment) and E4 (plan approval)", () => {
			const input: ObservationInput = {
				issues: [
					{
						id: 201,
						number: 201,
						title: "Plan discussion issue",
						body: "Issue tracking task planning",
						state: "open",
						created_at: "2026-11-10T10:00:00Z",
						updated_at: "2026-11-11T10:00:00Z",
						author: { login: "owner" },
						comments: [
							{
								id: 501,
								body: "Let's review the approach first.",
								user: { login: "owner" },
								author_association: "OWNER",
								created_at: "2026-11-11T10:05:00Z",
								updated_at: "2026-11-11T10:05:00Z",
							},
							{
								id: 502,
								body: "/approve sha256:1d2a6a07a243c6d7814be7885d225f9fa5ad972fedeab732c313a2530844e275",
								user: { login: "owner" },
								author_association: "OWNER",
								created_at: "2026-11-11T10:10:00Z",
								updated_at: "2026-11-11T10:10:00Z",
							},
						],
					},
				],
				pull_requests: [],
				observed_at: "2026-11-11T12:00:00Z",
			};

			const prevState = initLoopState();
			prevState.watermarks.issues_updated_at = "2026-11-11T10:00:00Z";
			prevState.watermarks.comments_updated_at = "2026-11-11T10:00:00Z";

			const events = normalizeEvents(input, prevState);

			const e3 = events.find((e) => e.kind === "E3_OWNER_COMMENT");
			expect(e3).toBeDefined();
			expect(e3?.comment_id).toBe(501);

			const e4 = events.find((e) => e.kind === "E4_PLAN_APPROVED");
			expect(e4).toBeDefined();
			expect(e4?.comment_id).toBe(502);
			expect(e4?.plan_digest).toBe("sha256:1d2a6a07a243c6d7814be7885d225f9fa5ad972fedeab732c313a2530844e275");
		});

		it("normalizes E5 (ready task) and ignores blocked tasks", () => {
			const input: ObservationInput = {
				issues: [
					{
						id: 301,
						number: 301,
						title: "Ready unblocked task",
						body: "<!-- immune-brain:task-id=task-301 -->\n<!-- immune-brain:plan-digest=sha256:abcd -->",
						state: "open",
						created_at: "2026-11-10T10:00:00Z",
						updated_at: "2026-11-11T10:00:00Z",
						author: { login: "dev" },
						labels: ["ready-for-agent"],
						blocked_by: [],
					},
					{
						id: 302,
						number: 302,
						title: "Blocked task with active prerequisite",
						body: "<!-- immune-brain:task-id=task-302 -->",
						state: "open",
						created_at: "2026-11-10T10:00:00Z",
						updated_at: "2026-11-11T10:00:00Z",
						author: { login: "dev" },
						labels: ["ready-for-agent"],
						blocked_by: [301], // blocked by 301!
					},
				],
				pull_requests: [],
				observed_at: "2026-11-11T12:00:00Z",
			};

			const events = normalizeEvents(input, null);
			const e5List = events.filter((e) => e.kind === "E5_READY_TASK");
			expect(e5List).toHaveLength(1);
			expect(e5List[0].issue_number).toBe(301);
			expect(e5List[0].task_id).toBe("task-301");
			expect(e5List[0].plan_digest).toBe("sha256:abcd");
		});

		it("normalizes E6 (lane decision needed) and E7 (lane decision replied)", () => {
			const input: ObservationInput = {
				issues: [
					{
						id: 401,
						number: 401,
						title: "Active task issue with parked decision",
						body: "Work in progress",
						state: "open",
						created_at: "2026-11-10T10:00:00Z",
						updated_at: "2026-11-11T10:00:00Z",
						author: { login: "dev" },
						comments: [
							{
								id: 601,
								body: "<!-- immune-brain:run-id=run-abc-123 --> <!-- immune-brain:record-revision=rev-456 --> Option 2: widen scope to include tests",
								user: { login: "owner" },
								author_association: "OWNER",
								created_at: "2026-11-11T11:00:00Z",
								updated_at: "2026-11-11T11:00:00Z",
							},
						],
					},
				],
				pull_requests: [],
				lane_decisions: [
					{
						task_id: "loop-daemon-s6",
						run_id: "run-abc-123",
						record_revision: "rev-456",
						question: "Do you approve widening the scope?",
						options: [
							{ id: "1", label: "No, stop" },
							{ id: "2", label: "Yes, widen" },
						],
					},
				],
				observed_at: "2026-11-11T12:00:00Z",
			};

			const events = normalizeEvents(input, null);

			const e6 = events.find((e) => e.kind === "E6_LANE_DECISION_NEEDED");
			expect(e6).toBeDefined();
			expect(e6?.task_id).toBe("loop-daemon-s6");
			expect(e6?.run_id).toBe("run-abc-123");
			expect(e6?.options).toHaveLength(2);

			const e7 = events.find((e) => e.kind === "E7_LANE_DECISION_REPLIED");
			expect(e7).toBeDefined();
			expect(e7?.run_id).toBe("run-abc-123");
			expect(e7?.selected_option).toBe("2");
		});

		it("normalizes E8 (failed PR check) with deterministic failure signature on imm/* PR", () => {
			const input: ObservationInput = {
				issues: [],
				pull_requests: [
					{
						number: 801,
						title: "imm: add feature",
						head_ref_name: "imm/loop-feature",
						head_sha: "commit-sha-123",
						base_ref_name: "main",
						state: "open",
						merged: false,
						mergeable: "MERGEABLE",
						checks: [
							{
								name: "unit-tests",
								status: "completed",
								conclusion: "failure",
								details_url: "https://ci.example.com/build/1",
							},
						],
					},
				],
				observed_at: "2026-11-11T12:00:00Z",
			};

			const events = normalizeEvents(input, null);
			const e8 = events.find((e) => e.kind === "E8_PR_CHECK_FAILED");
			expect(e8).toBeDefined();
			expect(e8?.pr_number).toBe(801);
			expect(e8?.check_name).toBe("unit-tests");
			expect(e8?.failure_signature).toHaveLength(64); // sha256 hex string
		});

		it("normalizes E9 (PR conflict), E10 (PR review comment), and E11 (PR ready / merged)", () => {
			const input: ObservationInput = {
				issues: [],
				pull_requests: [
					{
						number: 901,
						title: "Conflicted daemon PR",
						head_ref_name: "imm/conflicted-pr",
						head_sha: "commit-sha-901",
						base_ref_name: "main",
						state: "open",
						merged: false,
						mergeable: "CONFLICTING",
						checks: [],
					},
					{
						number: 902,
						title: "PR with review comments",
						head_ref_name: "imm/review-pr",
						head_sha: "commit-sha-902",
						base_ref_name: "main",
						state: "open",
						merged: false,
						mergeable: "UNKNOWN",
						review_comments: [
							{
								id: 999,
								user: { login: "reviewer" },
								author_association: "MEMBER",
								body: "Please add a test case for edge cases.",
								path: "plugins/foo.ts",
								line: 42,
								created_at: "2026-11-11T11:30:00Z",
								updated_at: "2026-11-11T11:30:00Z",
							},
						],
					},
					{
						number: 903,
						title: "Clean green ready PR",
						head_ref_name: "imm/clean-pr",
						head_sha: "commit-sha-903",
						base_ref_name: "main",
						state: "open",
						merged: false,
						mergeable: "MERGEABLE",
						checks: [
							{
								name: "ci",
								status: "completed",
								conclusion: "success",
							},
						],
					},
					{
						number: 904,
						title: "Already merged PR",
						head_ref_name: "imm/merged-pr",
						head_sha: "commit-sha-904",
						base_ref_name: "main",
						state: "closed",
						merged: true,
					},
					{
						number: 905,
						title: "Non-daemon external PR",
						head_ref_name: "feat/external-change",
						head_sha: "commit-sha-905",
						base_ref_name: "main",
						state: "open",
						merged: false,
						mergeable: "CONFLICTING",
					},
				],
				observed_at: "2026-11-11T12:00:00Z",
			};

			const events = normalizeEvents(input, null);

			// E9 on 901
			const e9 = events.find((e) => e.kind === "E9_PR_CONFLICT");
			expect(e9).toBeDefined();
			expect(e9?.pr_number).toBe(901);

			// E10 on 902
			const e10 = events.find((e) => e.kind === "E10_PR_REVIEW_COMMENT");
			expect(e10).toBeDefined();
			expect(e10?.pr_number).toBe(902);
			expect(e10?.comment_id).toBe(999);

			// E11 ready on 903
			const e11Ready = events.find(
				(e) => e.kind === "E11_PR_READY_OR_MERGED" && e.pr_number === 903,
			);
			expect(e11Ready).toBeDefined();
			expect(e11Ready?.status).toBe("ready");

			// E11 merged on 904
			const e11Merged = events.find(
				(e) => e.kind === "E11_PR_READY_OR_MERGED" && e.pr_number === 904,
			);
			expect(e11Merged).toBeDefined();
			expect(e11Merged?.status).toBe("merged");

			// 905 (non-daemon branch) ignored
			const e905 = events.find((e) => (e as any).pr_number === 905);
			expect(e905).toBeUndefined();
		});

		it("review-1: pollIssuesFromGithub requests blockedBy and normalizer drops E5_READY_TASK when blocked", async () => {
			let capturedArgs: string[] = [];
			const mockGh: GhTransport = {
				run: async (args) => {
					capturedArgs = args;
					return {
						exit_code: 0,
						stdout: JSON.stringify([
							{
								id: 111,
								number: 111,
								title: "Blocked ready task",
								body: "Ready but blocked",
								state: "open",
								labels: ["ready-for-agent"],
								blockedBy: [{ number: 99 }],
								createdAt: "2026-11-11T10:00:00Z",
								updatedAt: "2026-11-11T10:00:00Z",
								comments: [],
							},
						]),
						stderr: "",
						timed_out: false,
						output_exceeded: false,
					};
				},
			};

			const issues = await (await import("../plugins/immune-brain/runtime/loop_daemon/observer.ts")).pollIssuesFromGithub(mockGh, testDir);
			expect(capturedArgs.join(" ")).toContain("blockedBy");
			expect(issues).toHaveLength(1);
			expect(issues[0].blocked_by).toEqual([99]);

			// Verify normalizer blocks E5
			const events = normalizeEvents({ issues, pull_requests: [], observed_at: "2026-11-11T12:00:00Z" }, null);
			const e5 = events.find((e) => e.kind === "E5_READY_TASK");
			expect(e5).toBeUndefined();
		});

		it("review-2: PR review comments and discussion comments are both preserved without conflation", () => {
			const input: ObservationInput = {
				issues: [],
				pull_requests: [
					{
						number: 950,
						title: "imm: feature with discussion and review",
						head_ref_name: "imm/feat-950",
						head_sha: "sha-950",
						base_ref_name: "main",
						state: "open",
						merged: false,
						mergeable: "MERGEABLE",
						comments: [
							{
								id: 8881,
								body: "General PR conversation comment",
								user: { login: "owner" },
								author_association: "OWNER",
								created_at: "2026-11-11T11:00:00Z",
								updated_at: "2026-11-11T11:00:00Z",
							},
						],
						review_comments: [
							{
								id: 8882,
								user: { login: "reviewer" },
								author_association: "MEMBER",
								body: "Inline diff review comment",
								path: "src/index.ts",
								line: 10,
								created_at: "2026-11-11T11:05:00Z",
								updated_at: "2026-11-11T11:05:00Z",
							},
						],
					},
				],
				observed_at: "2026-11-11T12:00:00Z",
			};

			const events = normalizeEvents(input, null);
			const e3 = events.find((e) => e.kind === "E3_OWNER_COMMENT" && e.comment_id === 8881);
			const e10 = events.find((e) => e.kind === "E10_PR_REVIEW_COMMENT" && e.comment_id === 8882);

			expect(e3).toBeDefined();
			expect(e10).toBeDefined();
			expect(e10?.path).toBe("src/index.ts");
		});

		it("review-5: negative control: PR with MERGEABLE but pending checks does not emit E11 ready", () => {
			const input: ObservationInput = {
				issues: [],
				pull_requests: [
					{
						number: 960,
						title: "imm: feature with pending checks",
						head_ref_name: "imm/feat-960",
						head_sha: "sha-960",
						base_ref_name: "main",
						state: "open",
						merged: false,
						mergeable: "MERGEABLE", // MERGEABLE, but checks are still running!
						checks: [
							{
								name: "ci/build",
								status: "in_progress",
								conclusion: null,
							},
						],
					},
				],
				observed_at: "2026-11-11T12:00:00Z",
			};

			const events = normalizeEvents(input, null);
			const e11 = events.find((e) => e.kind === "E11_PR_READY_OR_MERGED");
			expect(e11).toBeUndefined(); // MUST NOT emit E11 ready!
		});
	});

	describe("2. State & Lock Persistence and 0600 Permissions (Positive Control)", () => {
		it("persists daemon.lock with mode 0600 and PID/host token", () => {
			const lockResult = acquireDaemonLock(stateDir);
			expect(lockResult.acquired).toBe(true);

			if (lockResult.acquired) {
				const lockFile = join(stateDir, "daemon.lock");
				expect(existsSync(lockFile)).toBe(true);

				// Strict 0600 mode verification
				const stat = statSync(lockFile);
				const permissions = stat.mode & 0o777;
				expect(permissions).toBe(0o600);

				const content = JSON.parse(readFileSync(lockFile, "utf8"));
				expect(content.contract).toBe(LOOP_DAEMON_LOCK_CONTRACT);
				expect(content.pid).toBe(process.pid);
				expect(content.host_token).toBeDefined();

				lockResult.release();
				expect(existsSync(lockFile)).toBe(false);
			}
		});

		it("persists state.json and leases with mode 0600", () => {
			const state = initLoopState();
			state.watermarks.issues_updated_at = "2026-11-11T12:00:00Z";
			state.stats.ticks_total = 5;
			saveLoopState(stateDir, state);

			const stateFile = join(stateDir, "state.json");
			expect(existsSync(stateFile)).toBe(true);

			const statState = statSync(stateFile);
			expect(statState.mode & 0o777).toBe(0o600);

			const loaded = loadLoopState(stateDir);
			expect(loaded).not.toBeNull();
			expect(loaded?.contract).toBe(LOOP_DAEMON_STATE_CONTRACT);
			expect(loaded?.stats.ticks_total).toBe(5);

			// Lease persistence
			saveLease(stateDir, {
				contract: LOOP_DAEMON_LEASE_CONTRACT,
				target_id: "issue-458",
				kind: "plan",
				owner_pid: process.pid,
				host_token: "test-token",
				acquired_at: new Date().toISOString(),
				heartbeat_at: new Date().toISOString(),
				status: "active",
			});

			const leaseFile = join(stateDir, "leases/issue-458.lease.json");
			expect(existsSync(leaseFile)).toBe(true);
			const statLease = statSync(leaseFile);
			expect(statLease.mode & 0o777).toBe(0o600);

			const lease = loadLease(stateDir, "issue-458");
			expect(lease?.target_id).toBe("issue-458");
			expect(listLeases(stateDir)).toHaveLength(1);

			deleteLease(stateDir, "issue-458");
			expect(listLeases(stateDir)).toHaveLength(0);
		});
	});

	describe("3. Concurrent Lock Rejection (Negative Control)", () => {
		it("refuses concurrent ticks when daemon.lock is held by a live PID", async () => {
			// Acquire lock as current live process
			const firstLock = acquireDaemonLock(stateDir);
			expect(firstLock.acquired).toBe(true);

			// Second attempt while live PID holds lock must fail closed
			const secondAttempt = acquireDaemonLock(stateDir);
			expect(secondAttempt.acquired).toBe(false);
			if (!secondAttempt.acquired) {
				expect(secondAttempt.reason).toContain("daemon.lock is held by live PID");
				expect(secondAttempt.existing?.pid).toBe(process.pid);
			}

			// CLI tick attempt must also exit 1 with concurrent tick rejected
			const cliRes = await runLoopDaemonCli(["tick"], testDir, { stateDir });
			expect(cliRes.returncode).toBe(1);
			expect(cliRes.stderr).toContain("concurrent tick rejected");

			if (firstLock.acquired) firstLock.release();
		});

		it("reclaims stale daemon.lock if recorded PID is dead", () => {
			mkdirSync(stateDir, { recursive: true, mode: 0o700 });
			const lockFile = join(stateDir, "daemon.lock");

			// Write a lock file with a dead PID (e.g. 99999999)
			const deadPid = 99999999;
			expect(isPidAlive(deadPid)).toBe(false);

			const staleLock = {
				contract: LOOP_DAEMON_LOCK_CONTRACT,
				pid: deadPid,
				hostname: "dead-host",
				started_at: "2026-11-10T00:00:00Z",
				host_token: "dead-token",
				heartbeat_at: "2026-11-10T00:00:00Z",
			};
			writeFileSync(lockFile, JSON.stringify(staleLock, null, 2), { mode: 0o600 });

			// Inspect lock
			const check = readDaemonLock(stateDir);
			expect(check.exists).toBe(true);
			expect(check.isLive).toBe(false);

			// Acquire should cleanly reclaim dead lock
			const freshAcquisition = acquireDaemonLock(stateDir);
			expect(freshAcquisition.acquired).toBe(true);
			if (freshAcquisition.acquired) {
				expect(freshAcquisition.lock.pid).toBe(process.pid);
				freshAcquisition.release();
			}
		});
	});

	describe("4. State Rebuildability (Boundary / Fault Control)", () => {
		it("reconstructs watermarks and active leases after .imm/state/loop/ deletion without re-dispatching active work", async () => {
			// Set up an active run in .imm/runs/run-active-01
			const activeRunDir = join(testDir, ".imm/runs/run-active-01");
			mkdirSync(activeRunDir, { recursive: true });
			const activeRun = {
				contract: "assurance_kernel/run_record/v1",
				run_id: "run-active-01",
				task_id: "loop-daemon-s1-observe",
				lifecycle: "active",
				artifact_state: "active",
				scope_hint: ["plugins/immune-brain/runtime/loop_daemon/"],
				created_at: "2026-11-11T12:00:00Z",
			};
			writeFileSync(join(activeRunDir, "run.json"), JSON.stringify(activeRun, null, 2));

			// Mock GitHub fixtures
			const mockSnapshot: ObservationInput = {
				issues: [
					{
						id: 458,
						number: 458,
						title: "[Initiative] Loop daemon",
						body: "<!-- immune-brain:initiative=loop-daemon -->",
						state: "open",
						created_at: "2026-11-11T10:00:00Z",
						updated_at: "2026-11-11T14:30:00Z",
						author: { login: "owner" },
						comments: [
							{
								id: 701,
								body: "Initiative in progress",
								user: { login: "owner" },
								author_association: "OWNER",
								created_at: "2026-11-11T14:35:00Z",
								updated_at: "2026-11-11T14:35:00Z",
							},
						],
					},
					{
						id: 460,
						number: 460,
						title: "[Child] loop-daemon-s1-observe",
						body: "<!-- immune-brain:task-id=loop-daemon-s1-observe -->",
						state: "open",
						created_at: "2026-11-11T10:00:00Z",
						updated_at: "2026-11-11T13:00:00Z",
						author: { login: "owner" },
						labels: ["in-progress"],
					},
				],
				pull_requests: [
					{
						number: 478,
						title: "imm: loop daemon observe",
						head_ref_name: "imm/loop-daemon-s1-observe",
						head_sha: "head-sha-789",
						base_ref_name: "main",
						state: "open",
						merged: false,
						mergeable: "MERGEABLE",
					},
				],
				observed_at: "2026-11-11T15:00:00Z",
			};

			// Delete .imm/state/loop/ entirely
			rmSync(stateDir, { recursive: true, force: true });
			expect(existsSync(stateDir)).toBe(false);

			// Run rebuildLoopState()
			const rebuild = await rebuildLoopState(testDir, {
				stateDir,
				fixtureSnapshot: mockSnapshot,
			});

			expect(rebuild.state.contract).toBe(LOOP_DAEMON_STATE_CONTRACT);
			expect(rebuild.state.watermarks.issues_updated_at).toBe("2026-11-11T14:30:00Z");
			expect(rebuild.state.watermarks.comments_updated_at).toBe("2026-11-11T14:35:00Z");

			// Active lease for loop-daemon-s1-observe was reconstructed from .imm/runs/*
			const lease = rebuild.reconstructedLeases.find(
				(l) => l.target_id === "loop-daemon-s1-observe",
			);
			expect(lease).toBeDefined();
			expect(lease?.kind).toBe("drive");
			expect(lease?.status).toBe("active");

			// State and leases are properly saved with 0600 permissions
			const savedState = loadLoopState(stateDir);
			expect(savedState?.active_leases["loop-daemon-s1-observe"]).toBeDefined();
			const savedLease = loadLease(stateDir, "loop-daemon-s1-observe");
			expect(savedLease?.target_id).toBe("loop-daemon-s1-observe");

			const leaseFile = join(stateDir, "leases/loop-daemon-s1-observe.lease.json");
			expect(statSync(leaseFile).mode & 0o777).toBe(0o600);
			expect(statSync(join(stateDir, "state.json")).mode & 0o777).toBe(0o600);
		});
	});

	describe("5. CLI Operations: tick, status, pause, resume, and dry-run", () => {
		const sampleSnapshot: ObservationInput = {
			issues: [
				{
					id: 1,
					number: 1,
					title: "Issue 1",
					body: "Body",
					state: "open",
					created_at: "2026-11-11T10:00:00Z",
					updated_at: "2026-11-11T10:00:00Z",
					author: { login: "alice" },
				},
			],
			pull_requests: [],
			observed_at: "2026-11-11T12:00:00Z",
		};

		it("imm-loop tick --dry-run performs zero writes and leaves no lock", async () => {
			const res = await runLoopDaemonCli(["tick", "--dry-run", "--json"], testDir, {
				stateDir,
				snapshotOverride: sampleSnapshot,
			});

			expect(res.returncode).toBe(0);
			const parsed = JSON.parse(res.stdout);
			expect(parsed.dry_run).toBe(true);
			expect(parsed.events.length).toBeGreaterThan(0);

			// Zero disk mutations: state.json and events.jsonl do NOT exist!
			expect(existsSync(join(stateDir, "state.json"))).toBe(false);
			expect(existsSync(join(stateDir, "events.jsonl"))).toBe(false);
			expect(existsSync(join(stateDir, "daemon.lock"))).toBe(false);
		});

		it("imm-loop tick (live) writes state.json, events.jsonl, and releases lock", async () => {
			const res = await runLoopDaemonCli(["tick", "--json"], testDir, {
				stateDir,
				snapshotOverride: sampleSnapshot,
			});

			expect(res.returncode).toBe(0);
			const parsed = JSON.parse(res.stdout);
			expect(parsed.dry_run).toBe(false);

			expect(existsSync(join(stateDir, "state.json"))).toBe(true);
			expect(existsSync(join(stateDir, "events.jsonl"))).toBe(true);
			expect(existsSync(join(stateDir, "daemon.lock"))).toBe(false); // Lock released after tick

			const state = loadLoopState(stateDir);
			expect(state?.stats.ticks_total).toBe(1);
			expect(state?.watermarks.issues_updated_at).toBe("2026-11-11T10:00:00Z");
		});

		it("imm-loop status --json reports daemon state and watermarks", async () => {
			// First initialize state with live tick
			await runLoopDaemonCli(["tick"], testDir, {
				stateDir,
				snapshotOverride: sampleSnapshot,
			});

			const statusRes = await runLoopDaemonCli(["status", "--json"], testDir, {
				stateDir,
			});

			expect(statusRes.returncode).toBe(0);
			const status = JSON.parse(statusRes.stdout);
			expect(status.daemon_running).toBe(false);
			expect(status.watermarks.issues_updated_at).toBe("2026-11-11T10:00:00Z");
			expect(status.paused).toBe(false);
		});

		it("imm-loop pause and resume mutate state cleanly", async () => {
			await runLoopDaemonCli(["tick"], testDir, {
				stateDir,
				snapshotOverride: sampleSnapshot,
			});

			const pauseRes = await runLoopDaemonCli(
				["pause", "--reason", "Scheduled maintenance"],
				testDir,
				{ stateDir },
			);
			expect(pauseRes.returncode).toBe(0);

			let state = loadLoopState(stateDir);
			expect(state?.paused).toBe(true);
			expect(state?.pause_reason).toBe("Scheduled maintenance");

			const resumeRes = await runLoopDaemonCli(["resume"], testDir, { stateDir });
			expect(resumeRes.returncode).toBe(0);

			state = loadLoopState(stateDir);
			expect(state?.paused).toBe(false);
			expect(state?.pause_reason).toBeNull();
		});

		it("imm-loop binary runs executable help cleanly via child process", () => {
			const res = spawnSync(BIN_IMM_LOOP, ["--help"], {
				cwd: ROOT,
				encoding: "utf8",
			});
			expect(res.status).toBe(0);
			expect(res.stdout).toContain("Usage: imm-loop <command> [options]");
			expect(res.stdout).toContain("tick");
			expect(res.stdout).toContain("status");
			expect(res.stdout).toContain("rebuild");
		});

		it("review-3: GitHub polling failures fail closed, exit 1, and do not persist tick or state", async () => {
			const failingGh: GhTransport = {
				run: async () => ({
					exit_code: 1,
					stdout: "",
					stderr: "network connection failed: api.github.com timed out",
					timed_out: true,
					output_exceeded: false,
				}),
			};

			const res = await runLoopDaemonCli(["tick"], testDir, {
				stateDir,
				gh: failingGh,
			});

			expect(res.returncode).toBe(1);
			expect(res.stderr).toContain("Error: observation failed");
			expect(res.stderr).toContain("gh issue list failed");

			// Must not persist state or events on failure
			expect(existsSync(join(stateDir, "state.json"))).toBe(false);
			expect(existsSync(join(stateDir, "events.jsonl"))).toBe(false);
		});

		it("review-4: standing run command does not deadlock on daemon.lock and executes iteration cleanly", async () => {
			const runRes = await runLoopDaemonCli(["run", "--interval", "1"], testDir, {
				stateDir,
				snapshotOverride: sampleSnapshot,
				singleIteration: true,
			});

			expect(runRes.returncode).toBe(0);
			// Lock is released after standing loop stops
			expect(existsSync(join(stateDir, "daemon.lock"))).toBe(false);

			// State is saved from the tick executed under the held lock
			const state = loadLoopState(stateDir);
			expect(state?.stats.ticks_total).toBe(1);
		});

		it("review-round-2-1: pollPRsFromGithub fetches inline review comments via gh api and emits E10", async () => {
			const mockGh: GhTransport = {
				run: async (args: string[]) => {
					if (args[0] === "issue" && args[1] === "list") {
						return { exit_code: 0, stdout: "[]", stderr: "", timed_out: false, output_exceeded: false };
					}
					if (args[0] === "pr" && args[1] === "list") {
						return {
							exit_code: 0,
							stdout: JSON.stringify([
								{
									number: 901,
									title: "imm: remote feature with inline review",
									headRefName: "imm/feat-901",
									headRefOid: "sha-901",
									baseRefName: "main",
									state: "OPEN",
									mergeable: "MERGEABLE",
									comments: [],
									reviews: [],
								},
							]),
							stderr: "",
							timed_out: false,
							output_exceeded: false,
						};
					}
					if (args[0] === "api" && args[1] === "repos/{owner}/{repo}/pulls/901/comments") {
						return {
							exit_code: 0,
							stdout: JSON.stringify([
								{
									id: 701,
									user: { login: "reviewer1" },
									author_association: "MEMBER",
									body: "Please fix this edge case in calc.ts",
									path: "src/calc.ts",
									line: 42,
									created_at: "2026-11-11T12:00:00Z",
									updated_at: "2026-11-11T12:00:00Z",
								},
							]),
							stderr: "",
							timed_out: false,
							output_exceeded: false,
						};
					}
					return { exit_code: 0, stdout: "[]", stderr: "", timed_out: false, output_exceeded: false };
				},
			};

			const prs = await pollPRsFromGithub(mockGh, testDir);
			expect(prs).toHaveLength(1);
			expect(prs[0].review_comments).toHaveLength(1);
			expect(prs[0].review_comments?.[0].id).toBe(701);
			expect(prs[0].review_comments?.[0].path).toBe("src/calc.ts");

			// Normalize and verify E10_PR_REVIEW_COMMENT is emitted
			const events = normalizeEvents(
				{ issues: [], pull_requests: prs, observed_at: "2026-11-11T12:05:00Z" },
				null,
			);
			const e10 = events.find((e) => e.kind === "E10_PR_REVIEW_COMMENT");
			expect(e10).toBeDefined();
			expect(e10?.pr_number).toBe(901);
			expect(e10?.branch).toBe("imm/feat-901");
			expect((e10 as any)?.comment_id).toBe(701);
			expect((e10 as any)?.path).toBe("src/calc.ts");
		});

		it("review-round-2-2: two-tick test: advances prs_updated_at from discussion comments & reviews so events don't duplicate", async () => {
			const mockGh: GhTransport = {
				run: async (args: string[]) => {
					if (args[0] === "issue" && args[1] === "list") {
						return { exit_code: 0, stdout: "[]", stderr: "", timed_out: false, output_exceeded: false };
					}
					if (args[0] === "pr" && args[1] === "list") {
						return {
							exit_code: 0,
							stdout: JSON.stringify([
								{
									number: 902,
									title: "imm: feature with discussion comment and review body",
									headRefName: "imm/feat-902",
									headRefOid: "sha-902",
									baseRefName: "main",
									state: "OPEN",
									mergeable: "MERGEABLE",
									comments: [
										{
											id: 801,
											author: { login: "owner" },
											authorAssociation: "OWNER",
											body: "General PR comment",
											createdAt: "2026-11-11T10:00:00Z",
											updatedAt: "2026-11-11T10:00:00Z",
										},
									],
									reviews: [
										{
											id: 802,
											author: { login: "approver" },
											authorAssociation: "COLLABORATOR",
											state: "APPROVED",
											body: "LGTM!",
											submittedAt: "2026-11-11T10:05:00Z",
										},
									],
								},
							]),
							stderr: "",
							timed_out: false,
							output_exceeded: false,
						};
					}
					return { exit_code: 0, stdout: "[]", stderr: "", timed_out: false, output_exceeded: false };
				},
			};

			// Tick 1
			const res1 = await runLoopDaemonCli(["tick"], testDir, {
				stateDir,
				gh: mockGh,
			});
			expect(res1.returncode).toBe(0);
			const state1 = loadLoopState(stateDir);
			expect(state1?.watermarks.prs_updated_at).toBe("2026-11-11T10:05:00Z");

			// Tick 2 (with same PR state, no new comments)
			const res2 = await runLoopDaemonCli(["tick"], testDir, {
				stateDir,
				gh: mockGh,
			});
			expect(res2.returncode).toBe(0);
			// Must emit 0 new duplicate events on tick 2
			expect(res2.stdout).toContain("observed 0 events");
		});

		it("review-round-2-3: atomic stale-lock reclamation rejects simultaneous reclaimers without deleting fresh lock", async () => {
			mkdirSync(stateDir, { recursive: true, mode: 0o700 });
			const lockPath = join(stateDir, "daemon.lock");
			// Write a stale daemon.lock with dead PID 99999999
			const deadLock = {
				contract: LOOP_DAEMON_LOCK_CONTRACT,
				pid: 99999999,
				hostname: "dead-host",
				started_at: "2026-11-11T00:00:00Z",
				host_token: "stale-dead-token",
				heartbeat_at: "2026-11-11T00:00:00Z",
			};
			writeFileSync(lockPath, JSON.stringify(deadLock, null, 2), { mode: 0o600 });

			// Reclaimer A claims and reclaims the stale lock
			const resA = acquireDaemonLock(stateDir, { hostToken: "reclaimer-a" });
			expect(resA.acquired).toBe(true);
			expect(resA.lock?.pid).toBe(process.pid);
			expect(resA.lock?.host_token).toBe("reclaimer-a");

			// Reclaimer B tries to acquire while A holds the newly created live lock
			const resB = acquireDaemonLock(stateDir, { hostToken: "reclaimer-b" });
			expect(resB.acquired).toBe(false);
			expect(resB.reason).toContain("held by live PID");

			// Reclaimer A's lock must be preserved intact!
			const currentLock = readDaemonLock(stateDir);
			expect(currentLock.exists).toBe(true);
			expect(currentLock.lock?.pid).toBe(process.pid);
			expect(currentLock.lock?.host_token).toBe("reclaimer-a");

			resA.release?.();
			expect(existsSync(lockPath)).toBe(false);
		});

		it("review-round-2-4: rebuildLoopState reconstructs active-work lease from open remote daemon PR without local branch or run record", async () => {
			const remoteOnlySnapshot: ObservationInput = {
				issues: [],
				pull_requests: [
					{
						number: 904,
						title: "imm: remote only active work",
						head_ref_name: "imm/task-remote-orphan",
						head_sha: "sha-remote-904",
						base_ref_name: "main",
						state: "open",
						merged: false,
						mergeable: "MERGEABLE",
						updated_at: "2026-11-11T11:00:00Z",
					},
				],
				observed_at: "2026-11-11T11:05:00Z",
			};

			const { state, reconstructedLeases } = await rebuildLoopState(testDir, {
				fixtureSnapshot: remoteOnlySnapshot,
			});

			expect(reconstructedLeases).toHaveLength(1);
			expect(reconstructedLeases[0].target_id).toBe("task-remote-orphan");
			expect(reconstructedLeases[0].kind).toBe("drive");
			expect(reconstructedLeases[0].status).toBe("active");

			// Saved lease file must exist on disk
			const leaseOnDisk = loadLease(stateDir, "task-remote-orphan");
			expect(leaseOnDisk).not.toBeNull();
			expect(leaseOnDisk?.target_id).toBe("task-remote-orphan");
			expect(state.active_leases["task-remote-orphan"]).toBeDefined();
		});

		it("review-round-2-5: conditional polling: sends If-None-Match and handles 304 Not Modified unchanged-resource revalidation", async () => {
			let capturedArgs: string[][] = [];
			const mockGh: GhTransport = {
				run: async (args: string[]) => {
					capturedArgs.push(args);
					if (args[0] === "api" && args[1].includes("issues")) {
						if (args.includes("If-None-Match: etag-issues-v1") || args.some((a) => a.includes("etag-issues-v1"))) {
							return {
								exit_code: 304,
								stdout: "HTTP/1.1 304 Not Modified\r\n\r\n",
								stderr: "",
								timed_out: false,
								output_exceeded: false,
							};
						}
						return {
							exit_code: 0,
							stdout: 'HTTP/1.1 200 OK\r\nETag: "etag-issues-v1"\r\n\r\n[{"id":1,"number":1,"title":"Bug","body":"Fix","state":"open","createdAt":"2026-11-11T10:00:00Z","updatedAt":"2026-11-11T10:00:00Z","author":{"login":"u"},"labels":[]}]',
							stderr: "",
							timed_out: false,
							output_exceeded: false,
						};
					}
					if (args[0] === "issue" && args[1] === "list") {
						return {
							exit_code: 0,
							stdout: '[{"id":1,"number":1,"title":"Bug","body":"Fix","state":"open","createdAt":"2026-11-11T10:00:00Z","updatedAt":"2026-11-11T10:00:00Z","author":{"login":"u"},"labels":[]}]',
							stderr: "",
							timed_out: false,
							output_exceeded: false,
						};
					}
					return { exit_code: 0, stdout: "[]", stderr: "", timed_out: false, output_exceeded: false };
				},
			};

			// Tick 1: Fetches issues, records ETag in state
			const res1 = await runLoopDaemonCli(["tick"], testDir, {
				stateDir,
				gh: mockGh,
			});
			expect(res1.returncode).toBe(0);
			const state1 = loadLoopState(stateDir);
			expect(state1?.watermarks.etag_by_resource.issues).toBeDefined();

			// Tick 2: Passes If-None-Match header
			capturedArgs = [];
			const res2 = await runLoopDaemonCli(["tick"], testDir, {
				stateDir,
				gh: mockGh,
			});
			expect(res2.returncode).toBe(0);
			// Verified that If-None-Match conditional was sent at the transport seam
			const condCall = capturedArgs.find((args) =>
				args.some((a) => a.includes("If-None-Match")),
			);
			expect(condCall).toBeDefined();
		});

		it("review-round-3-1: conditional observation completeness: falls back to gh issue list when conditional 200 payload lacks comments/blockedBy", async () => {
			let issueListCalled = false;
			const mockGh: GhTransport = {
				run: async (args: string[]) => {
					if (args[0] === "api" && args[1].includes("issues")) {
						// Return standard REST issue payload (lacks GraphQL blockedBy / comments array)
						return {
							exit_code: 0,
							stdout: 'HTTP/1.1 200 OK\r\nETag: "etag-issues-rest-v2"\r\n\r\n[{"id":55,"number":55,"title":"Blocked issue","body":"Some body","state":"open","created_at":"2026-11-11T10:00:00Z","updated_at":"2026-11-11T10:00:00Z"}]',
							stderr: "",
							timed_out: false,
							output_exceeded: false,
						};
					}
					if (args[0] === "issue" && args[1] === "list") {
						issueListCalled = true;
						// Full issue data with blockedBy and comments
						return {
							exit_code: 0,
							stdout: JSON.stringify([
								{
									number: 55,
									title: "Blocked issue",
									body: "Some body",
									state: "OPEN",
									labels: [{ name: "ready-for-agent" }],
									assignees: [],
									author: { login: "user1" },
									comments: [{ id: "c1", body: "comment" }],
									createdAt: "2026-11-11T10:00:00Z",
									updatedAt: "2026-11-11T10:00:00Z",
									closedAt: null,
									blockedBy: [{ number: 99, title: "Prerequisite issue" }],
								},
							]),
							stderr: "",
							timed_out: false,
							output_exceeded: false,
						};
					}
					return { exit_code: 0, stdout: "[]", stderr: "", timed_out: false, output_exceeded: false };
				},
			};

			// Initialize state with an existing etag so conditional polling is triggered
			const stateBefore = initLoopState();
			stateBefore.watermarks.etag_by_resource.issues = "etag-issues-rest-v1";
			saveLoopState(stateDir, stateBefore);

			const res = await runLoopDaemonCli(["tick"], testDir, {
				stateDir,
				gh: mockGh,
			});
			expect(res.returncode).toBe(0);
			expect(issueListCalled).toBe(true);

			// Check normalized events: E5_READY_TASK must NOT be emitted because blockedBy: [99] was preserved
			const eventsRaw = readFileSync(join(stateDir, "events.jsonl"), "utf8");
			const events = eventsRaw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
			const readyEvt = events.find((e) => e.kind === "E5_READY_TASK");
			expect(readyEvt).toBeUndefined();

			// Check that conditional ETag was retained in state
			const stateAfter = loadLoopState(stateDir);
			expect(stateAfter?.watermarks.etag_by_resource.issues).toBe("etag-issues-rest-v2");
		});

		it("review-round-3-2: atomic stale-lock reclamation via renameSync: racing reclaimers do not corrupt or delete live lock", async () => {
			const lockPath = join(stateDir, "daemon.lock");
			// Create a stale lock pointing to a dead PID
			const deadPid = 99999999;
			const staleRecord = {
				contract: LOOP_DAEMON_LOCK_CONTRACT,
				pid: deadPid,
				hostname: "testhost",
				started_at: new Date(Date.now() - 3600000).toISOString(),
				host_token: "stale-token",
				heartbeat_at: new Date(Date.now() - 3600000).toISOString(),
			};
			mkdirSync(stateDir, { recursive: true, mode: 0o700 });
			writeFileSync(lockPath, JSON.stringify(staleRecord, null, 2), { mode: 0o600 });

			// Reclaimer A claims and acquires
			const resA = acquireDaemonLock(stateDir, { hostToken: "reclaimer-a" });
			expect(resA.acquired).toBe(true);
			expect(resA.lock?.pid).toBe(process.pid);
			expect(resA.lock?.host_token).toBe("reclaimer-a");

			// Reclaimer B tries to acquire while A holds the live lock
			const resB = acquireDaemonLock(stateDir, { hostToken: "reclaimer-b" });
			expect(resB.acquired).toBe(false);
			expect(resB.reason).toContain("held by live PID");

			// Reclaimer B calls release() on its failed attempt - MUST NOT delete A's live lock!
			if (resB.release) resB.release();
			const currentLock = readDaemonLock(stateDir);
			expect(currentLock.exists).toBe(true);
			expect(currentLock.lock?.pid).toBe(process.pid);
			expect(currentLock.lock?.host_token).toBe("reclaimer-a");

			// Release winner
			resA.release!();
			expect(existsSync(lockPath)).toBe(false);
		});

		it("review-round-3-3: rebuild lease identity consistency: local branch imm-loop/123 and remote PR imm-loop/123 both map to issue-123 and create exactly one lease", async () => {
			// In testDir, create local branch imm-loop/123
			execFileSync("git", ["init", "-b", "main"], { cwd: testDir });
			execFileSync("git", ["config", "user.name", "test"], { cwd: testDir });
			execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: testDir });
			writeFileSync(join(testDir, "README.md"), "# test");
			execFileSync("git", ["add", "."], { cwd: testDir });
			execFileSync("git", ["commit", "-m", "init"], { cwd: testDir });
			execFileSync("git", ["branch", "imm-loop/123"], { cwd: testDir });

			// Remote PR fixture for the same branch imm-loop/123
			const fixturePr: RawPR = {
				number: 50,
				title: "Plan for issue 123",
				head_ref_name: "imm-loop/123",
				head_ref_oid: "sha123",
				base_ref_name: "main",
				state: "open",
				updated_at: "2026-11-11T12:00:00Z",
			};

			const { state, reconstructedLeases } = await rebuildLoopState(testDir, {
				fixtureSnapshot: {
					issues: [],
					pull_requests: [fixturePr],
				},
			});

			// Must produce exactly ONE lease with target_id "issue-123", kind "plan"
			expect(reconstructedLeases).toHaveLength(1);
			expect(reconstructedLeases[0].target_id).toBe("issue-123");
			expect(reconstructedLeases[0].kind).toBe("plan");
			expect(reconstructedLeases[0].status).toBe("active");
			expect(state.active_leases["issue-123"]).toBeDefined();
			expect(state.active_leases["123"]).toBeUndefined();
		});

		it("review-round-3-4: PR update watermark: gh pr list requests updatedAt and advances prs_updated_at on PR update", async () => {
			let prListRequestedFields = "";
			const mockGh: GhTransport = {
				run: async (args: string[]) => {
					if (args[0] === "pr" && args[1] === "list") {
						const jsonIdx = args.indexOf("--json");
						if (jsonIdx !== -1 && args[jsonIdx + 1]) {
							prListRequestedFields = args[jsonIdx + 1];
						}
						return {
							exit_code: 0,
							stdout: JSON.stringify([
								{
									number: 88,
									title: "Updated PR title",
									headRefName: "imm/feat-88",
									headRefOid: "sha88",
									baseRefName: "main",
									state: "OPEN",
									updatedAt: "2026-11-11T14:30:00Z",
									mergedAt: null,
									mergeable: "MERGEABLE",
									comments: [],
									reviews: [],
								},
							]),
							stderr: "",
							timed_out: false,
							output_exceeded: false,
						};
					}
					return { exit_code: 0, stdout: "[]", stderr: "", timed_out: false, output_exceeded: false };
				},
			};

			// Run tick with the mock GH transport
			const res = await runLoopDaemonCli(["tick"], testDir, {
				stateDir,
				gh: mockGh,
			});
			expect(res.returncode).toBe(0);

			// Check that updatedAt was requested in --json fields
			expect(prListRequestedFields).toContain("updatedAt");

			// Check that prs_updated_at was advanced to 2026-11-11T14:30:00Z
			const state = loadLoopState(stateDir);
			expect(state?.watermarks.prs_updated_at).toBe("2026-11-11T14:30:00Z");
		});

		it("review-round-4-1: three-party race: stale reclamation cannot rename aside a replacement live lock or overwrite another lock, ensuring single-instance mutual exclusion", async () => {
			const lockPath = join(stateDir, "daemon.lock");
			mkdirSync(stateDir, { recursive: true, mode: 0o700 });

			// Initial state: stale daemon.lock with dead PID 99999999
			const deadPid = 99999999;
			const staleRecord = {
				contract: LOOP_DAEMON_LOCK_CONTRACT,
				pid: deadPid,
				hostname: "dead-host",
				started_at: "2026-11-10T00:00:00Z",
				host_token: "stale-token-xyz",
				heartbeat_at: "2026-11-10T00:00:00Z",
			};
			writeFileSync(lockPath, JSON.stringify(staleRecord, null, 2), { mode: 0o600 });

			// A reclaims the stale lock and creates A's live lock
			const resA = acquireDaemonLock(stateDir, { hostToken: "token-a" });
			expect(resA.acquired).toBe(true);
			expect(resA.lock?.host_token).toBe("token-a");
			expect(resA.lock?.pid).toBe(process.pid);

			// daemon.lock must be present and owned by A
			const currentAfterA = readDaemonLock(stateDir);
			expect(currentAfterA.exists).toBe(true);
			expect(currentAfterA.lock?.host_token).toBe("token-a");
			expect(currentAfterA.isLive).toBe(true);

			// Process B tries to acquire (simulating acting after inspecting stale lock or racing)
			// B must fail closed and MUST NOT rename or remove A's live lock!
			const resB = acquireDaemonLock(stateDir, { hostToken: "token-b" });
			expect(resB.acquired).toBe(false);
			expect(resB.reason).toContain("held by live PID");

			// Verify daemon.lock was NEVER moved or renamed aside by B
			const currentAfterB = readDaemonLock(stateDir);
			expect(currentAfterB.exists).toBe(true);
			expect(currentAfterB.lock?.host_token).toBe("token-a");
			expect(currentAfterB.lock?.pid).toBe(process.pid);

			// Process C arrives: attempts to acquire
			// Because daemon.lock was never absent, C cannot sneak in and create a new lock
			const resC = acquireDaemonLock(stateDir, { hostToken: "token-c" });
			expect(resC.acquired).toBe(false);
			expect(resC.reason).toContain("held by live PID");

			// Exactly one of the three processes has acquired: true (A)
			expect([resA.acquired, resB.acquired, resC.acquired].filter(Boolean)).toHaveLength(1);

			// A releases its lock cleanly
			resA.release!();
			expect(existsSync(lockPath)).toBe(false);
		});

		it("review-round-5-1: interleaved two-reclaimer race: atomic populated reclamation claim prevents unlinking in-flight claim or overwriting replacement lock", async () => {
			const lockPath = join(stateDir, "daemon.lock");
			mkdirSync(stateDir, { recursive: true, mode: 0o700 });

			// 1. Initial state: stale daemon.lock with dead PID 99999999
			const deadPid = 99999999;
			const staleRecord = {
				contract: LOOP_DAEMON_LOCK_CONTRACT,
				pid: deadPid,
				hostname: "dead-host",
				started_at: "2026-11-10T00:00:00Z",
				host_token: "stale-token-round-5",
				heartbeat_at: "2026-11-10T00:00:00Z",
			};
			writeFileSync(lockPath, JSON.stringify(staleRecord, null, 2), { mode: 0o600 });

			// 2. Interleaved scenario: Reclaimer A's in-flight claim exists on disk
			// Reclaimer A creates its claim file with its live PID
			const claimPath = join(stateDir, `.reclaim.stale-token-round-5.lock`);
			writeFileSync(claimPath, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { mode: 0o600 });

			// 3. Reclaimer B inspects the stale lock and attempts to acquire/reclaim
			// B sees A's in-flight claim with live PID: B MUST NOT unlink A's claim, MUST NOT touch daemon.lock!
			const resB = acquireDaemonLock(stateDir, { hostToken: "reclaimer-b-token" });
			expect(resB.acquired).toBe(false);
			expect(resB.reason).toContain("already claimed by concurrent reclaimer");

			// Claim file must remain intact (not unlinked by B)
			expect(existsSync(claimPath)).toBe(true);

			// daemon.lock must remain untouched (still the stale lock, not deleted or replaced by B)
			const currentLock = readDaemonLock(stateDir);
			expect(currentLock.exists).toBe(true);
			expect(currentLock.lock?.host_token).toBe("stale-token-round-5");

			// 4. Now Reclaimer A finishes its reclamation:
			// Cleanup claim file so A can execute the acquisition
			rmSync(claimPath, { force: true });
			const resA = acquireDaemonLock(stateDir, { hostToken: "reclaimer-a-token" });
			expect(resA.acquired).toBe(true);
			expect(resA.lock?.host_token).toBe("reclaimer-a-token");
			expect(resA.lock?.pid).toBe(process.pid);

			// daemon.lock is now live with A's token
			const lockAfterA = readDaemonLock(stateDir);
			expect(lockAfterA.exists).toBe(true);
			expect(lockAfterA.lock?.host_token).toBe("reclaimer-a-token");
			expect(lockAfterA.isLive).toBe(true);

			// 5. Subsequent attempts by B or C must see A's live lock and fail closed
			const resB2 = acquireDaemonLock(stateDir, { hostToken: "reclaimer-b-token" });
			expect(resB2.acquired).toBe(false);
			expect(resB2.reason).toContain("held by live PID");

			// A's lock must remain uncorrupted
			const finalLock = readDaemonLock(stateDir);
			expect(finalLock.lock?.host_token).toBe("reclaimer-a-token");

			resA.release!();
			expect(existsSync(lockPath)).toBe(false);
		});

		it("review-round-6-1: interleaved two-dead-claim-recoverer race: monotonic claim generations prevent concurrent dead-claim takeover and ensure single-instance mutual exclusion", async () => {
			const lockPath = join(stateDir, "daemon.lock");
			mkdirSync(stateDir, { recursive: true, mode: 0o700 });

			// 1. Initial state: stale daemon.lock with dead PID 99999999
			const deadPid = 99999999;
			const staleRecord = {
				contract: LOOP_DAEMON_LOCK_CONTRACT,
				pid: deadPid,
				hostname: "dead-host",
				started_at: "2026-11-10T00:00:00Z",
				host_token: "stale-token-round-6",
				heartbeat_at: "2026-11-10T00:00:00Z",
			};
			writeFileSync(lockPath, JSON.stringify(staleRecord, null, 2), { mode: 0o600 });

			// 2. Existing claim on disk with dead PID 88888888 (e.g. from an earlier recoverer that died)
			const deadClaimPid = 88888888;
			const gen0Path = join(stateDir, `.reclaim.stale-token-round-6.0.lock`);
			writeFileSync(gen0Path, JSON.stringify({ pid: deadClaimPid, at: "2026-11-10T00:01:00Z" }), { mode: 0o600 });

			// Verify findReclaimClaims detects gen 0 and dead PID
			const detectedClaims = findReclaimClaims(stateDir, "stale-token-round-6");
			expect(detectedClaims).toHaveLength(1);
			expect(detectedClaims[0].gen).toBe(0);
			expect(detectedClaims[0].pid).toBe(deadClaimPid);
			expect(isPidAlive(deadClaimPid)).toBe(false);

			// 3. Two recoverers B and C both discover the stale lock and dead claim 0.
			// Instead of unlinking dead claim 0, monotonic generations advance to gen 1.
			// Recoverer B acquires claim gen 1:
			// To strictly simulate an interleaved race where B has linked gen 1 with live PID:
			const gen1Path = join(stateDir, `.reclaim.stale-token-round-6.1.lock`);
			writeFileSync(gen1Path, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { mode: 0o600 });

			// Concurrent recoverer C attempts to acquire:
			// C sees gen 1 is held by live PID (process.pid). C MUST NOT unlink gen 0 or gen 1!
			const resC = acquireDaemonLock(stateDir, { hostToken: "reclaimer-c-token" });
			expect(resC.acquired).toBe(false);
			expect(resC.reason).toContain("already claimed by concurrent reclaimer");

			// Gen 0 and Gen 1 must both still exist on disk (neither was deleted)
			expect(existsSync(gen0Path)).toBe(true);
			expect(existsSync(gen1Path)).toBe(true);

			// daemon.lock is still untouched (still stale, not overwritten by C)
			const lockDuringC = readDaemonLock(stateDir);
			expect(lockDuringC.lock?.host_token).toBe("stale-token-round-6");

			// 4. Clean up B's simulated interim claim so B can execute acquireDaemonLock fully
			rmSync(gen1Path, { force: true });
			// Gen 0 is still on disk with dead PID
			expect(existsSync(gen0Path)).toBe(true);

			// Recoverer B runs acquireDaemonLock:
			// B sees gen 0 is dead, advances to gen 1 atomically via linkSync, replaces daemon.lock
			const resB = acquireDaemonLock(stateDir, { hostToken: "reclaimer-b-token" });
			expect(resB.acquired).toBe(true);
			expect(resB.lock?.host_token).toBe("reclaimer-b-token");
			expect(resB.lock?.pid).toBe(process.pid);

			// daemon.lock is now live with B's token
			const lockAfterB = readDaemonLock(stateDir);
			expect(lockAfterB.exists).toBe(true);
			expect(lockAfterB.lock?.host_token).toBe("reclaimer-b-token");
			expect(lockAfterB.isLive).toBe(true);

			// 5. Subsequent attempts by C must see B's live lock and fail closed
			const resC2 = acquireDaemonLock(stateDir, { hostToken: "reclaimer-c-token" });
			expect(resC2.acquired).toBe(false);
			expect(resC2.reason).toContain("held by live PID");

			// Clean up
			resB.release!();
			expect(existsSync(lockPath)).toBe(false);
		});
	});
});
