/**
 * Loop Daemon: Headless `fix-pr` Repair Loop, Review Comment Triage,
 * `mark_ready`, and `close_out` (S7)
 *
 * Verifies S7-AC1 under docs/plans/loop-daemon-s7-repair.intent.json and S7 / D8
 * in docs/specs/loop-daemon.spec.md:
 * - Positive Control: failing CI check on `imm/<slug>` is reproduced locally,
 *   fixed via headless `fix-pr`, and pushed; clean PR transitions via
 *   `mark_pr_ready` and waits for human owner merge; upon owner merge,
 *   `close_out` cleans up worktrees and leases. Merge conflicts are rebased and
 *   verified; in-scope review comments are addressed and pushed.
 * - Negative Control: PR not on `imm/*` or `imm-loop/*` (or lacking `loop-pr`
 *   marker) is ignored; auto-merge is prohibited (ADR 0039 Decision 11);
 *   unreproducible CI failures are not committed; conflicts or review requests
 *   outside `scope_hint` escalate to owner; authority/no_touch paths are strictly
 *   rejected; empty scope_hint ([]) permits zero files.
 * - Boundary / Fault Control: 3rd failure for the same
 *   `(head_sha, failure_signature)` stops repair and dispatches `escalate`;
 *   attempts are recorded on all outcomes including cannot_reproduce and out-of-scope;
 *   guard G5 blocks and falls back to escalate; mark_pr_ready verifies open draft,
 *   review gates, and non-empty passing checks; close_out requires merged PR and
 *   clears active_leases in state.json; unified `dispatchRepair` routes E8, E9, E10, E11.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { evaluateGuards, GUARD_FALLBACKS, repairKey } from "../plugins/immune-brain/runtime/loop_daemon/guards.ts";
import {
	LOOP_PR_MARKER,
	LOOP_REPAIR_DISPATCH_CONTRACT,
	DEFAULT_REPAIR_RETRY_CAP,
	addressPrReview,
	assertNoAutoMerge,
	closeOut,
	computeFailureSignature,
	dispatchRepair,
	isDaemonManagedPr,
	loadRepairRetries,
	markPrReady,
	normalizeLogExcerpt,
	recordRepairAttempt,
	repairPrCi,
	repairPrConflict,
	saveRepairRetries,
	validatePathsInScope,
	type DaemonPrInput,
	type RepairContext,
} from "../plugins/immune-brain/runtime/loop_daemon/repair_agent.ts";
import { loadLease, loadLoopState, saveLease, saveLoopState, initLoopState } from "../plugins/immune-brain/runtime/loop_daemon/state.ts";
import {
	LOOP_DAEMON_EVENT_CONTRACT,
	LOOP_DAEMON_LEASE_CONTRACT,
	type E8PRCheckFailedEvent,
	type E9PRConflictEvent,
	type E10PRReviewCommentEvent,
	type E11PRReadyOrMergedEvent,
	type LoopLease,
} from "../plugins/immune-brain/runtime/loop_daemon/types.ts";

const TS = "2026-11-12T10:00:00.000Z";
const roots: string[] = [];
afterAll(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix = "loop-repair-"): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	roots.push(root);
	return root;
}

function write(root: string, path: string, content: string): void {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), content);
}

function gitFixture(files: Record<string, string> = {}): string {
	const root = tempRoot();
	const git = (args: string[]) =>
		execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
			cwd: root,
			stdio: ["ignore", "pipe", "pipe"],
		});
	git(["init", "-q"]);
	for (const [path, content] of Object.entries({ "README.md": "fixture\n", ...files })) {
		write(root, path, content);
	}
	git(["add", "-A"]);
	git(["commit", "-q", "-m", "fixture"]);
	return root;
}

function daemonPr(overrides: Partial<DaemonPrInput> = {}): DaemonPrInput {
	return {
		number: 42,
		title: "Fix issue 42",
		head_ref_name: "imm/task-42",
		head_sha: "a".repeat(40),
		base_ref_name: "main",
		body: `${LOOP_PR_MARKER}\nCloses #42\n`,
		draft: true,
		state: "open",
		...overrides,
	};
}

describe("Suite 1: Daemon PR Identification and Scope Filtering (D8.1, Negative Control 1)", () => {
	it("identifies imm/* and imm-loop/* branches carrying the loop-pr marker as daemon-managed", () => {
		expect(
			isDaemonManagedPr({
				head_ref_name: "imm/repair-task",
				body: `Some header\n${LOOP_PR_MARKER}\nSome footer`,
			}),
		).toBe(true);

		expect(
			isDaemonManagedPr({
				branch: "imm-loop/issue-100",
				body: `${LOOP_PR_MARKER}`,
			}),
		).toBe(true);
	});

	it("rejects non-daemon branches even if they carry the loop-pr marker", () => {
		expect(
			isDaemonManagedPr({
				head_ref_name: "main",
				body: `${LOOP_PR_MARKER}`,
			}),
		).toBe(false);

		expect(
			isDaemonManagedPr({
				head_ref_name: "feature/awesome",
				body: `${LOOP_PR_MARKER}`,
			}),
		).toBe(false);
	});

	it("rejects imm/* and imm-loop/* PRs if they lack the loop-pr marker", () => {
		expect(
			isDaemonManagedPr({
				head_ref_name: "imm/manual-branch",
				body: "User created PR without marker",
			}),
		).toBe(false);

		expect(
			isDaemonManagedPr({
				head_ref_name: "imm-loop/manual",
				body: null,
			}),
		).toBe(false);
	});

	it("repair operations ignore non-daemon PRs immediately without side effects", async () => {
		const nonDaemon = daemonPr({
			head_ref_name: "feature/user-fix",
			body: "no marker here",
		});
		const context: RepairContext = {
			worktree_path: "/dummy",
			task_id: "test",
		};
		const dummyDeps = {
			runVerification: async () => ({ exit_code: 0, stdout: "", stderr: "" }),
			applyFix: async () => ({ success: true, modified_paths: [] }),
			gitCommitAndPush: async () => ({ commit_sha: "123" }),
		};

		const ciResult = await repairPrCi({
			pr: nonDaemon,
			check: { name: "test-check" },
			context,
			deps: dummyDeps,
		});
		expect(ciResult.action).toBe("ignored");
		expect(ciResult.reason).toContain("not on imm/*");

		const conflictResult = await repairPrConflict({
			pr: nonDaemon,
			context,
			deps: {
				rebaseOrMerge: async () => ({ success: true }),
				runVerification: dummyDeps.runVerification,
				gitCommitAndPush: dummyDeps.gitCommitAndPush,
			},
		});
		expect(conflictResult.action).toBe("ignored");

		const reviewResult = await addressPrReview({
			pr: nonDaemon,
			comment: { id: 1, body: "fix this" },
			context,
			deps: {
				applyReviewFix: async () => ({ success: true, modified_paths: [] }),
				runVerification: dummyDeps.runVerification,
				gitCommitAndPush: dummyDeps.gitCommitAndPush,
			},
		});
		expect(reviewResult.action).toBe("ignored");

		const readyResult = await markPrReady({
			pr: nonDaemon,
			deps: { markReady: async () => ({ success: true }) },
		});
		expect(readyResult.action).toBe("ignored");

		const closeResult = await closeOut({
			pr: nonDaemon,
			context: {},
		});
		expect(closeResult.action).toBe("ignored");
	});
});

describe("Suite 2: Auto-Merge Strict Prohibition (ADR 0039 Decision 11, Negative Control 2)", () => {
	it("assertNoAutoMerge strictly throws auto_merge_prohibited error", () => {
		expect(() => assertNoAutoMerge("direct_merge")).toThrow(/auto_merge_prohibited.*ADR 0039 Decision 11/);
		expect(() => assertNoAutoMerge("graphql_merge")).toThrow(/ADR 0039 Decision 11 strictly prohibits automated merging/);
	});

	it("markPrReady transitions PR to ready but strictly waits for human owner merge without auto-merging", async () => {
		let markedReadyPr: number | null = null;
		const pr = daemonPr({
			checks: [{ name: "ci", status: "completed", conclusion: "success" }],
		});

		const result = await markPrReady({
			pr,
			deps: {
				markReady: async (num) => {
					markedReadyPr = num;
					return { success: true };
				},
			},
		});

		expect(markedReadyPr).toBe(42);
		expect(result.action).toBe("marked_ready");
		expect(result.handler).toBe("mark_pr_ready");
		expect(result.waiting_for_owner_merge).toBe(true);
		expect(result.reason).toContain("waiting strictly for human owner merge");
	});

	it("markPrReady rejects any input asking for auto_merge", async () => {
		const pr = daemonPr({
			checks: [{ name: "ci", status: "completed", conclusion: "success" }],
			...({ auto_merge: true } as any),
		});

		expect(markPrReady({ pr, deps: { markReady: async () => ({ success: true }) } })).rejects.toThrow(
			/auto_merge_prohibited/,
		);
	});
});

describe("Suite 3: Headless CI Check Failure Repair (D8.2, Positive Control 1)", () => {
	it("computes deterministic failure signature from check name and log excerpt", () => {
		const rawLog = "\u001b[31mError:\u001b[0m test failed\r\n  at   line 42\n";
		const normalized = normalizeLogExcerpt(rawLog);
		expect(normalized).toBe("Error: test failed\n at line 42");

		const sig1 = computeFailureSignature("bun test", rawLog);
		const sig2 = computeFailureSignature("bun test", normalized);
		expect(sig1).toBe(sig2);
		expect(sig1).toMatch(/^[0-9a-f]{64}$/);
	});

	it("reproduces failing check locally, applies fix, verifies, and pushes commit", async () => {
		const worktreeRoot = gitFixture({ "src/index.ts": "broken\n" });
		const stateDir = join(tempRoot(), ".imm/state/loop");

		let verificationCalls = 0;
		let appliedFix = false;
		let pushedCommit: string | null = null;

		const pr = daemonPr();
		const check = {
			name: "bun test tests/unit.test.ts",
			log_excerpt: "AssertionError: expected true to be false",
		};
		const context: RepairContext = {
			worktree_path: worktreeRoot,
			task_id: "task-42",
			scope_hint: ["src/index.ts"],
			state_dir: stateDir,
		};

		const result = await repairPrCi({
			pr,
			check,
			context,
			deps: {
				runVerification: async () => {
					verificationCalls++;
					if (verificationCalls === 1) {
						return { exit_code: 1, stdout: "", stderr: "assertion error" };
					}
					return { exit_code: 0, stdout: "pass", stderr: "" };
				},
				applyFix: async () => {
					appliedFix = true;
					write(worktreeRoot, "src/index.ts", "fixed\n");
					return { success: true, modified_paths: ["src/index.ts"] };
				},
				gitCommitAndPush: async ({ branch, message }) => {
					pushedCommit = "c0ffee".repeat(6) + "0000";
					return { commit_sha: pushedCommit };
				},
			},
		});

		expect(verificationCalls).toBe(2);
		expect(appliedFix).toBe(true);
		expect(result.action).toBe("repaired");
		expect(result.handler).toBe("repair_pr_ci");
		expect(result.commit_sha).toBe(pushedCommit);
		expect(result.attempts).toBe(1);

		const sig = computeFailureSignature(check.name, check.log_excerpt);
		const retries = loadRepairRetries(stateDir);
		expect(retries[repairKey(pr.head_sha, sig)]).toBe(1);
	});

	it("negative control (review-1): records attempt when failure cannot be reproduced locally", async () => {
		const stateDir = join(tempRoot(), ".imm/state/loop");
		let appliedFix = false;
		let pushedCommit = false;

		const pr = daemonPr();
		const check = { name: "flaky-test", log_excerpt: "timed out remotely" };
		const sig = computeFailureSignature(check.name, check.log_excerpt);

		const result = await repairPrCi({
			pr,
			check,
			context: {
				worktree_path: "/worktree",
				task_id: "task-42",
				state_dir: stateDir,
			},
			deps: {
				runVerification: async () => ({ exit_code: 0, stdout: "all tests passed", stderr: "" }),
				applyFix: async () => {
					appliedFix = true;
					return { success: true, modified_paths: [] };
				},
				gitCommitAndPush: async () => {
					pushedCommit = true;
					return { commit_sha: "dummy" };
				},
			},
		});

		expect(result.action).toBe("cannot_reproduce");
		expect(result.handler).toBe("repair_pr_ci");
		expect(result.reason).toContain("could not be reproduced locally");
		expect(result.attempts).toBe(1);
		expect(appliedFix).toBe(false);
		expect(pushedCommit).toBe(false);

		// Verified that attempt was recorded in stateDir
		expect(loadRepairRetries(stateDir)[repairKey(pr.head_sha, sig)]).toBe(1);
	});

	it("negative control (review-1): records attempt when fix modifies files outside scope_hint", async () => {
		const stateDir = join(tempRoot(), ".imm/state/loop");
		const pr = daemonPr();
		const check = { name: "test-check" };
		const sig = computeFailureSignature(check.name);

		const result = await repairPrCi({
			pr,
			check,
			context: {
				worktree_path: "/worktree",
				task_id: "task-42",
				scope_hint: ["src/allowed.ts"],
				state_dir: stateDir,
			},
			deps: {
				runVerification: async () => ({ exit_code: 1, stdout: "", stderr: "failed" }),
				applyFix: async () => ({
					success: true,
					modified_paths: ["src/allowed.ts", "package.json"],
				}),
				gitCommitAndPush: async () => ({ commit_sha: "dummy" }),
			},
		});

		expect(result.action).toBe("escalate");
		expect(result.handler).toBe("escalate");
		expect(result.reason).toContain("package.json");
		expect(result.attempts).toBe(1);
		expect(loadRepairRetries(stateDir)[repairKey(pr.head_sha, sig)]).toBe(1);
	});
});

describe("Suite 4: Bounded Retry Cap (2 Attempts per head_sha + failure_signature, Boundary / Fault Control)", () => {
	it("caps repair at 2 attempts per (head_sha, failure_signature) and transitions to escalate on 3rd failure", async () => {
		const stateDir = join(tempRoot(), ".imm/state/loop");
		const headSha = "b".repeat(40);
		const check = { name: "strict-ci-check", log_excerpt: "syntax error" };
		const sig = computeFailureSignature(check.name, check.log_excerpt);

		const pr = daemonPr({ head_sha: headSha });
		const context: RepairContext = {
			worktree_path: "/worktree",
			task_id: "task-42",
			state_dir: stateDir,
			retry_cap: 2,
		};

		// Attempt 1: fix fails post-verification
		const attempt1 = await repairPrCi({
			pr,
			check,
			context,
			deps: {
				runVerification: async () => ({ exit_code: 1, stdout: "", stderr: "fail" }),
				applyFix: async () => ({ success: true, modified_paths: [] }),
				gitCommitAndPush: async () => ({ commit_sha: "sha1" }),
			},
		});
		expect(attempt1.action).toBe("retry_failed");
		expect(attempt1.attempts).toBe(1);
		expect(loadRepairRetries(stateDir)[repairKey(headSha, sig)]).toBe(1);

		// Attempt 2: fix fails post-verification -> cap reached, escalates
		const attempt2 = await repairPrCi({
			pr,
			check,
			context,
			deps: {
				runVerification: async () => ({ exit_code: 1, stdout: "", stderr: "fail" }),
				applyFix: async () => ({ success: true, modified_paths: [] }),
				gitCommitAndPush: async () => ({ commit_sha: "sha2" }),
			},
		});
		expect(attempt2.action).toBe("escalate");
		expect(attempt2.handler).toBe("escalate");
		expect(attempt2.attempts).toBe(2);
		expect(loadRepairRetries(stateDir)[repairKey(headSha, sig)]).toBe(2);

		// Attempt 3 (or later tick): existing attempts == 2 >= cap -> immediate escalation
		let ranReproOn3rd = false;
		const attempt3 = await repairPrCi({
			pr,
			check,
			context,
			deps: {
				runVerification: async () => {
					ranReproOn3rd = true;
					return { exit_code: 1, stdout: "", stderr: "fail" };
				},
				applyFix: async () => ({ success: true, modified_paths: [] }),
				gitCommitAndPush: async () => ({ commit_sha: "sha3" }),
			},
		});
		expect(attempt3.action).toBe("escalate");
		expect(attempt3.handler).toBe("escalate");
		expect(attempt3.reason).toContain("repair attempt limit (2) reached");
		expect(attempt3.escalation_key).toBeDefined();
		expect(ranReproOn3rd).toBe(false);
	});

	it("integrates with Guard G5: 2 attempts triggers G5 block and escalate fallback", () => {
		const headSha = "d".repeat(40);
		const sig = "sig-458";
		const event: E8PRCheckFailedEvent = {
			contract: LOOP_DAEMON_EVENT_CONTRACT,
			event_id: "evt-e8-test",
			kind: "E8_PR_CHECK_FAILED",
			timestamp: TS,
			pr_number: 42,
			branch: "imm/task-42",
			head_sha: headSha,
			check_name: "ci",
			failure_signature: sig,
		};

		const v1 = evaluateGuards(event, {
			retry_counts: { [repairKey(headSha, sig)]: 1 },
			retry_cap: 2,
		});
		const g5Under = v1.find((g) => g.guard === "G5")!;
		expect(g5Under.blocked).toBe(false);

		const v2 = evaluateGuards(event, {
			retry_counts: { [repairKey(headSha, sig)]: 2 },
			retry_cap: 2,
		});
		const g5Blocked = v2.find((g) => g.guard === "G5")!;
		expect(g5Blocked.blocked).toBe(true);
		expect(GUARD_FALLBACKS.G5).toBe("escalate");
	});
});

describe("Suite 5: Scope Enforcement and Authority/No-Touch Rejection (review-2)", () => {
	it("enforces empty scope_hint ([]) as zero-file scope in validatePathsInScope", () => {
		const resEmpty = validatePathsInScope([], []);
		expect(resEmpty.valid).toBe(true);

		const resBlocked = validatePathsInScope(["src/index.ts"], []);
		expect(resBlocked.valid).toBe(false);
		expect(resBlocked.reason).toContain("scope_hint is empty ([])");
	});

	it("strictly rejects authority and no-touch paths in validatePathsInScope", () => {
		const noTouchFile = validatePathsInScope(["docs/agents/no-touch.json"], undefined);
		expect(noTouchFile.valid).toBe(false);
		expect(noTouchFile.reason).toContain("authority/no-touch path targeted");

		const workflowFile = validatePathsInScope([".github/workflows/ci.yml"], undefined);
		expect(workflowFile.valid).toBe(false);
		expect(workflowFile.reason).toContain("authority/no-touch path targeted");
	});

	it("repairPrCi rejects applyFix touching authority path even when scope_hint is undefined", async () => {
		const pr = daemonPr();
		const result = await repairPrCi({
			pr,
			check: { name: "check-1" },
			context: {
				worktree_path: "/worktree",
				task_id: "task-42",
				scope_hint: undefined,
			},
			deps: {
				runVerification: async () => ({ exit_code: 1, stdout: "", stderr: "failed" }),
				applyFix: async () => ({
					success: true,
					modified_paths: [".github/workflows/ci.yml"],
				}),
				gitCommitAndPush: async () => ({ commit_sha: "dummy" }),
			},
		});

		expect(result.action).toBe("escalate");
		expect(result.reason).toContain("authority/no-touch path targeted");
	});

	it("repairPrConflict rejects conflict on authority path or outside scope_hint", async () => {
		const pr = daemonPr();
		const resultNoTouch = await repairPrConflict({
			pr,
			context: { worktree_path: "/worktree", task_id: "task-42" },
			deps: {
				rebaseOrMerge: async () => ({
					success: false,
					conflicting_paths: [".github/workflows/release.yml"],
				}),
				runVerification: async () => ({ exit_code: 0, stdout: "", stderr: "" }),
				gitCommitAndPush: async () => ({ commit_sha: "dummy" }),
			},
		});
		expect(resultNoTouch.action).toBe("escalate");
		expect(resultNoTouch.reason).toContain("authority/no-touch path targeted");

		const resultEmptyScope = await repairPrConflict({
			pr,
			context: { worktree_path: "/worktree", task_id: "task-42", scope_hint: [] },
			deps: {
				rebaseOrMerge: async () => ({
					success: false,
					conflicting_paths: ["src/foo.ts"],
				}),
				runVerification: async () => ({ exit_code: 0, stdout: "", stderr: "" }),
				gitCommitAndPush: async () => ({ commit_sha: "dummy" }),
			},
		});
		expect(resultEmptyScope.action).toBe("escalate");
		expect(resultEmptyScope.reason).toContain("scope_hint is empty");
	});

	it("addressPrReview rejects review comment targeting authority path or outside empty scope_hint", async () => {
		const pr = daemonPr();
		const resultNoTouch = await addressPrReview({
			pr,
			comment: { id: 1, body: "update", path: "docs/agents/no-touch.json" },
			context: { worktree_path: "/worktree", task_id: "task-42" },
			deps: {
				applyReviewFix: async () => ({ success: true, modified_paths: [] }),
				runVerification: async () => ({ exit_code: 0, stdout: "", stderr: "" }),
				gitCommitAndPush: async () => ({ commit_sha: "dummy" }),
			},
		});
		expect(resultNoTouch.action).toBe("escalate");
		expect(resultNoTouch.reason).toContain("authority/no-touch path targeted");

		const resultEmpty = await addressPrReview({
			pr,
			comment: { id: 2, body: "update", path: "src/foo.ts" },
			context: { worktree_path: "/worktree", task_id: "task-42", scope_hint: [] },
			deps: {
				applyReviewFix: async () => ({ success: true, modified_paths: [] }),
				runVerification: async () => ({ exit_code: 0, stdout: "", stderr: "" }),
				gitCommitAndPush: async () => ({ commit_sha: "dummy" }),
			},
		});
		expect(resultEmpty.action).toBe("escalate");
		expect(resultEmpty.reason).toContain("scope_hint is empty");
	});

	it("normalizes repo-relative paths and rejects traversal", () => {
		const res1 = validatePathsInScope(["./.github/workflows/ci.yml"], undefined);
		expect(res1.valid).toBe(false);
		expect(res1.reason).toContain("authority/no-touch path targeted");

		const res2 = validatePathsInScope(["../secret.txt"], undefined);
		expect(res2.valid).toBe(false);
		expect(res2.reason).toContain("illegal repository path or traversal");

		// Review Round 3 variants: internal '.', empty '//', leading '/./', '.GIT', empty/'.'
		const resInternalDot = validatePathsInScope(["docs//agents/no-touch.json"], undefined);
		expect(resInternalDot.valid).toBe(false);
		expect(resInternalDot.reason).toContain("authority/no-touch path targeted");

		const resLeadingSlashDot = validatePathsInScope(["/./.github/workflows/ci.yml"], undefined);
		expect(resLeadingSlashDot.valid).toBe(false);
		expect(resLeadingSlashDot.reason).toContain("authority/no-touch path targeted");

		const resGitCase = validatePathsInScope([".GIT/config"], undefined);
		expect(resGitCase.valid).toBe(false);
		expect(resGitCase.reason).toContain("illegal repository path or traversal");

		const resEmpty = validatePathsInScope([""], undefined);
		expect(resEmpty.valid).toBe(false);
		expect(resEmpty.reason).toContain("illegal repository path or traversal");

		const resDot = validatePathsInScope(["."], undefined);
		expect(resDot.valid).toBe(false);
		expect(resDot.reason).toContain("illegal repository path or traversal");
	});

	it("reads declared protected prefixes from docs/agents/no-touch.json via worktree_path", () => {
		const tempWorktree = tempRoot("no-touch-wt-");
		write(
			tempWorktree,
			"docs/agents/no-touch.json",
			JSON.stringify({
				contract: "immune_brain/no_touch/v1",
				paths: ["src/protected", "config/secrets.json"],
			}),
		);

		const resAllowed = validatePathsInScope(["src/public/index.ts"], undefined, tempWorktree);
		expect(resAllowed.valid).toBe(true);

		const resBlockedPrefix = validatePathsInScope(["src/protected/internal.ts"], undefined, tempWorktree);
		expect(resBlockedPrefix.valid).toBe(false);
		expect(resBlockedPrefix.reason).toContain("authority/no-touch path targeted");

		// Review Round 3: internal '.' normalization before no-touch check
		const resInternalDotProtected = validatePathsInScope(["src/./protected/secret.ts"], ["src"], tempWorktree);
		expect(resInternalDotProtected.valid).toBe(false);
		expect(resInternalDotProtected.reason).toContain("authority/no-touch path targeted");

		const resBlockedFile = validatePathsInScope(["config/secrets.json"], undefined, tempWorktree);
		expect(resBlockedFile.valid).toBe(false);
		expect(resBlockedFile.reason).toContain("authority/no-touch path targeted");
	});

	it("fails closed when docs/agents/no-touch.json in worktree is unreadable or invalid", () => {
		const tempWorktree = tempRoot("bad-no-touch-wt-");
		write(tempWorktree, "docs/agents/no-touch.json", "{ invalid json");

		const res = validatePathsInScope(["src/index.ts"], undefined, tempWorktree);
		expect(res.valid).toBe(false);
		expect(res.reason).toContain("unreadable no-touch declaration");
	});

	it("matches TaskIntent directory prefixes and glob patterns in scope_hint", () => {
		const scopeHint = ["src/module", "tests/*.test.ts", "README.md"];

		// Exact match
		expect(validatePathsInScope(["README.md"], scopeHint).valid).toBe(true);
		// Directory prefix match
		expect(validatePathsInScope(["src/module/sub/file.ts"], scopeHint).valid).toBe(true);
		// Glob pattern match
		expect(validatePathsInScope(["tests/unit.test.ts"], scopeHint).valid).toBe(true);
		// Relative path with ./ prefix
		expect(validatePathsInScope(["./src/module/index.ts"], scopeHint).valid).toBe(true);

		// Out of scope
		const resOutOfScope = validatePathsInScope(["src/other/file.ts"], scopeHint);
		expect(resOutOfScope.valid).toBe(false);
		expect(resOutOfScope.reason).toContain("files outside scope_hint: src/other/file.ts");

		const resGlobMismatch = validatePathsInScope(["tests/sub/deep.test.ts"], scopeHint);
		expect(resGlobMismatch.valid).toBe(false);
		expect(resGlobMismatch.reason).toContain("files outside scope_hint: tests/sub/deep.test.ts");
	});
});

describe("Suite 6: Merge Conflict Resolution (D8.2, Positive Control 2 & Boundary Control)", () => {
	it("rebases base branch in isolated worktree, verifies, and pushes commit", async () => {
		let rebaseCalled = false;
		let verifiedCalled = false;
		let pushedSha: string | null = null;

		const pr = daemonPr();
		const result = await repairPrConflict({
			pr,
			context: {
				worktree_path: "/worktree",
				task_id: "task-42",
				scope_hint: ["src/file.ts"],
			},
			deps: {
				rebaseOrMerge: async ({ base_branch }) => {
					rebaseCalled = true;
					expect(base_branch).toBe("main");
					return { success: true };
				},
				runVerification: async () => {
					verifiedCalled = true;
					return { exit_code: 0, stdout: "ok", stderr: "" };
				},
				gitCommitAndPush: async ({ branch, message }) => {
					pushedSha = "deadbeef".repeat(5);
					return { commit_sha: pushedSha };
				},
			},
		});

		expect(rebaseCalled).toBe(true);
		expect(verifiedCalled).toBe(true);
		expect(result.action).toBe("repaired");
		expect(result.handler).toBe("repair_pr_conflict");
		expect(result.commit_sha).toBe(pushedSha);
	});

	it("escalates on semantic conflict outside scope_hint", async () => {
		const pr = daemonPr();
		const result = await repairPrConflict({
			pr,
			context: {
				worktree_path: "/worktree",
				task_id: "task-42",
				scope_hint: ["src/file.ts"],
			},
			deps: {
				rebaseOrMerge: async () => ({
					success: false,
					conflicting_paths: ["docs/adr/0039.md"],
				}),
				runVerification: async () => ({ exit_code: 0, stdout: "", stderr: "" }),
				gitCommitAndPush: async () => ({ commit_sha: "dummy" }),
			},
		});

		expect(result.action).toBe("escalate");
		expect(result.handler).toBe("escalate");
		expect(result.reason).toContain("docs/adr/0039.md");
	});

	it("escalates if verification fails after rebase", async () => {
		const pr = daemonPr();
		const result = await repairPrConflict({
			pr,
			context: {
				worktree_path: "/worktree",
				task_id: "task-42",
			},
			deps: {
				rebaseOrMerge: async () => ({ success: true }),
				runVerification: async () => ({ exit_code: 1, stdout: "", stderr: "type error" }),
				gitCommitAndPush: async () => ({ commit_sha: "dummy" }),
			},
		});

		expect(result.action).toBe("escalate");
		expect(result.handler).toBe("escalate");
		expect(result.reason).toContain("verification failed after base branch rebase");
	});
});

describe("Suite 7: PR Review Comments Handling (D8.2, Positive Control 3 & Boundary Control)", () => {
	it("addresses in-scope review comment, verifies, and pushes commit", async () => {
		let fixApplied = false;
		let verified = false;

		const pr = daemonPr();
		const comment = {
			id: 101,
			author: "reviewer",
			body: "Please rename variable x to y",
			path: "src/file.ts",
			line: 12,
		};

		const result = await addressPrReview({
			pr,
			comment,
			context: {
				worktree_path: "/worktree",
				task_id: "task-42",
				scope_hint: ["src/file.ts"],
			},
			deps: {
				classifyComment: async () => ({ is_scope_changing: false }),
				applyReviewFix: async () => {
					fixApplied = true;
					return { success: true, modified_paths: ["src/file.ts"] };
				},
				runVerification: async () => {
					verified = true;
					return { exit_code: 0, stdout: "", stderr: "" };
				},
				gitCommitAndPush: async () => ({ commit_sha: "beef".repeat(10) }),
			},
		});

		expect(fixApplied).toBe(true);
		expect(verified).toBe(true);
		expect(result.action).toBe("repaired");
		expect(result.handler).toBe("address_pr_review");
		expect(result.commit_sha).toBe("beef".repeat(10));
	});

	it("escalates when review comment targets a file outside scope_hint", async () => {
		const pr = daemonPr();
		const comment = {
			id: 102,
			body: "Edit this other config",
			path: "config/external.json",
		};

		const result = await addressPrReview({
			pr,
			comment,
			context: {
				worktree_path: "/worktree",
				task_id: "task-42",
				scope_hint: ["src/file.ts"],
			},
			deps: {
				applyReviewFix: async () => ({ success: true, modified_paths: [] }),
				runVerification: async () => ({ exit_code: 0, stdout: "", stderr: "" }),
				gitCommitAndPush: async () => ({ commit_sha: "dummy" }),
			},
		});

		expect(result.action).toBe("escalate");
		expect(result.handler).toBe("escalate");
		expect(result.reason).toContain("config/external.json");
	});

	it("escalates when review comment is classified as scope-changing request", async () => {
		const pr = daemonPr();
		const comment = {
			id: 103,
			body: "Also please implement a whole new database migration and caching subsystem",
			path: "src/file.ts",
		};

		const result = await addressPrReview({
			pr,
			comment,
			context: {
				worktree_path: "/worktree",
				task_id: "task-42",
				scope_hint: ["src/file.ts"],
			},
			deps: {
				classifyComment: async () => ({
					is_scope_changing: true,
					reason: "request asks for new subsystems beyond original task intent",
				}),
				applyReviewFix: async () => ({ success: true, modified_paths: [] }),
				runVerification: async () => ({ exit_code: 0, stdout: "", stderr: "" }),
				gitCommitAndPush: async () => ({ commit_sha: "dummy" }),
			},
		});

		expect(result.action).toBe("escalate");
		expect(result.handler).toBe("escalate");
		expect(result.reason).toContain("scope-changing");
	});
});

describe("Suite 8: PR Lifecycle Completion: mark_pr_ready Gate Enforcement (review-3)", () => {
	it("ignores PR when reviews contain CHANGES_REQUESTED", async () => {
		const prWithChanges = daemonPr({
			checks: [{ name: "ci", status: "completed", conclusion: "success" }],
			reviews: [
				{
					id: 1,
					user: { login: "alice" },
					author_association: "OWNER",
					state: "CHANGES_REQUESTED",
					body: "needs rework",
					submitted_at: TS,
				},
			],
		});

		const res = await markPrReady({
			pr: prWithChanges,
			deps: { markReady: async () => ({ success: true }) },
		});
		expect(res.action).toBe("ignored");
		expect(res.reason).toContain("CHANGES_REQUESTED");
	});

	it("ignores PR when checks is empty or contains startup_failure", async () => {
		const emptyChecksPr = daemonPr({ checks: [] });
		const resEmpty = await markPrReady({
			pr: emptyChecksPr,
			deps: { markReady: async () => ({ success: true }) },
		});
		expect(resEmpty.action).toBe("ignored");
		expect(resEmpty.reason).toContain("no checks");

		const startupFailPr = daemonPr({
			checks: [{ name: "ci", status: "completed", conclusion: "startup_failure" }],
		});
		const resFail = await markPrReady({
			pr: startupFailPr,
			deps: { markReady: async () => ({ success: true }) },
		});
		expect(resFail.action).toBe("ignored");
		expect(resFail.reason).toContain("failing or pending");
	});

	it("ignores PR when PR is already not draft or not open", async () => {
		const notDraftPr = daemonPr({
			draft: false,
			checks: [{ name: "ci", status: "completed", conclusion: "success" }],
		});
		const resNotDraft = await markPrReady({
			pr: notDraftPr,
			deps: { markReady: async () => ({ success: true }) },
		});
		expect(resNotDraft.action).toBe("ignored");
		expect(resNotDraft.reason).toContain("not an open draft");

		const closedPr = daemonPr({
			state: "closed",
			draft: true,
			checks: [{ name: "ci", status: "completed", conclusion: "success" }],
		});
		const resClosed = await markPrReady({
			pr: closedPr,
			deps: { markReady: async () => ({ success: true }) },
		});
		expect(resClosed.action).toBe("ignored");
		expect(resClosed.reason).toContain("not an open draft");
	});

	it("resolves latest decisive review per reviewer, allowing ready when superseded by approval", async () => {
		let markedReadyCalled = false;
		const prSuperseded = daemonPr({
			checks: [{ name: "ci", status: "completed", conclusion: "success" }],
			reviews: [
				{
					id: 1,
					user: { login: "alice" },
					author_association: "OWNER",
					state: "CHANGES_REQUESTED",
					body: "needs rework",
					submitted_at: "2026-11-12T10:00:00Z",
				},
				{
					id: 2,
					user: { login: "alice" },
					author_association: "OWNER",
					state: "APPROVED",
					body: "looks great now",
					submitted_at: "2026-11-12T10:10:00Z",
				},
				{
					id: 3,
					user: { login: "alice" },
					author_association: "OWNER",
					state: "COMMENTED",
					body: "nit: small comment",
					submitted_at: "2026-11-12T10:20:00Z",
				},
			],
		});

		const res = await markPrReady({
			pr: prSuperseded,
			deps: {
				markReady: async () => {
					markedReadyCalled = true;
					return { success: true };
				},
			},
		});

		expect(res.action).toBe("marked_ready");
		expect(markedReadyCalled).toBe(true);

		// Now add a later CHANGES_REQUESTED from bob
		const prBlockedByBob = daemonPr({
			checks: [{ name: "ci", status: "completed", conclusion: "success" }],
			reviews: [
				...prSuperseded.reviews!,
				{
					id: 4,
					user: { login: "bob" },
					author_association: "MEMBER",
					state: "CHANGES_REQUESTED",
					body: "blocking issue",
					submitted_at: "2026-11-12T10:30:00Z",
				},
			],
		});

		const resBlocked = await markPrReady({
			pr: prBlockedByBob,
			deps: { markReady: async () => ({ success: true }) },
		});

		expect(resBlocked.action).toBe("ignored");
		expect(resBlocked.reason).toContain("CHANGES_REQUESTED");
	});
});

describe("Suite 9: PR Lifecycle Completion: close_out State Cleanup (review-4)", () => {
	it("ignores unmerged PR and refuses to clean worktree or lease", async () => {
		const unmergedPr = daemonPr({ state: "open", merged: false });
		const worktree = tempRoot("unmerged-wt-");
		const stateDir = join(tempRoot(), ".imm/state/loop");

		const res = await closeOut({
			pr: unmergedPr,
			context: { worktree_path: worktree, state_dir: stateDir, lease_target_id: "t42" },
		});
		expect(res.action).toBe("ignored");
		expect(res.reason).toContain("requires merged PR state");
		expect(existsSync(worktree)).toBe(true);
	});

	it("cleans up isolated worktree, releases lease file, and removes lease from state.json", async () => {
		const worktree = tempRoot("worktree-to-clean-");
		const stateDir = join(tempRoot(), ".imm/state/loop");

		// Seed state.json with active_leases
		const loopState = initLoopState();
		const lease: LoopLease = {
			contract: LOOP_DAEMON_LEASE_CONTRACT,
			target_id: "task-42",
			kind: "repair",
			owner_pid: process.pid,
			host_token: "test-token",
			worktree_path: worktree,
			acquired_at: TS,
			heartbeat_at: TS,
			status: "active",
		};
		loopState.active_leases["task-42"] = lease;
		saveLoopState(stateDir, loopState);
		saveLease(stateDir, lease);

		expect(loadLease(stateDir, "task-42")).toBeDefined();
		expect(loadLoopState(stateDir)?.active_leases["task-42"]).toBeDefined();
		expect(existsSync(worktree)).toBe(true);

		const pr = daemonPr({
			state: "merged",
			merged: true,
		});

		const result = await closeOut({
			pr,
			context: {
				worktree_path: worktree,
				state_dir: stateDir,
				lease_target_id: "task-42",
			},
		});

		expect(result.action).toBe("closed_out");
		expect(result.handler).toBe("close_out");
		expect(result.cleaned_worktree).toBe(true);
		expect(result.released_lease).toBe(true);
		expect(existsSync(worktree)).toBe(false);
		expect(loadLease(stateDir, "task-42")).toBeNull();
		// Verified that active_leases in state.json is also cleared!
		expect(loadLoopState(stateDir)?.active_leases["task-42"]).toBeUndefined();
	});
});

describe("Suite 10: Unified Dispatcher (dispatchRepair)", () => {
	it("dispatches E8_PR_CHECK_FAILED to repairPrCi", async () => {
		const pr = daemonPr();
		const event: E8PRCheckFailedEvent = {
			contract: LOOP_DAEMON_EVENT_CONTRACT,
			event_id: "evt-e8",
			kind: "E8_PR_CHECK_FAILED",
			timestamp: TS,
			pr_number: 42,
			branch: "imm/task-42",
			head_sha: pr.head_sha,
			check_name: "test-run",
			failure_signature: "sig123",
		};

		let called = false;
		const result = await dispatchRepair({
			event,
			pr,
			context: { worktree_path: "/dummy", task_id: "task-42" },
			deps: {
				ci: {
					runVerification: async () => {
						called = true;
						return { exit_code: 0, stdout: "", stderr: "" };
					},
					applyFix: async () => ({ success: true, modified_paths: [] }),
					gitCommitAndPush: async () => ({ commit_sha: "abc" }),
				},
			},
		});

		expect(called).toBe(true);
		expect(result.action).toBe("cannot_reproduce");
	});

	it("dispatches E9_PR_CONFLICT to repairPrConflict", async () => {
		const pr = daemonPr();
		const event: E9PRConflictEvent = {
			contract: LOOP_DAEMON_EVENT_CONTRACT,
			event_id: "evt-e9",
			kind: "E9_PR_CONFLICT",
			timestamp: TS,
			pr_number: 42,
			branch: "imm/task-42",
			base_branch: "main",
			head_sha: pr.head_sha,
		};

		let rebased = false;
		const result = await dispatchRepair({
			event,
			pr,
			context: { worktree_path: "/dummy", task_id: "task-42" },
			deps: {
				conflict: {
					rebaseOrMerge: async () => {
						rebased = true;
						return { success: true };
					},
					runVerification: async () => ({ exit_code: 0, stdout: "", stderr: "" }),
					gitCommitAndPush: async () => ({ commit_sha: "rebased-sha" }),
				},
			},
		});

		expect(rebased).toBe(true);
		expect(result.action).toBe("repaired");
	});

	it("dispatches E10_PR_REVIEW_COMMENT to addressPrReview", async () => {
		const pr = daemonPr();
		const event: E10PRReviewCommentEvent = {
			contract: LOOP_DAEMON_EVENT_CONTRACT,
			event_id: "evt-e10",
			kind: "E10_PR_REVIEW_COMMENT",
			timestamp: TS,
			pr_number: 42,
			branch: "imm/task-42",
			comment_id: 88,
			author: "owner",
			author_association: "OWNER",
			body: "please update",
		};

		let fixApplied = false;
		const result = await dispatchRepair({
			event,
			pr,
			context: { worktree_path: "/dummy", task_id: "task-42" },
			deps: {
				review: {
					applyReviewFix: async () => {
						fixApplied = true;
						return { success: true, modified_paths: [] };
					},
					runVerification: async () => ({ exit_code: 0, stdout: "", stderr: "" }),
					gitCommitAndPush: async () => ({ commit_sha: "fix-sha" }),
				},
			},
		});

		expect(fixApplied).toBe(true);
		expect(result.action).toBe("repaired");
	});

	it("dispatches E11_PR_READY_OR_MERGED (ready) to markPrReady and (merged) to closeOut", async () => {
		const pr = daemonPr({
			checks: [{ name: "ci", status: "completed", conclusion: "success" }],
		});

		const readyEvent: E11PRReadyOrMergedEvent = {
			contract: LOOP_DAEMON_EVENT_CONTRACT,
			event_id: "evt-e11-ready",
			kind: "E11_PR_READY_OR_MERGED",
			timestamp: TS,
			pr_number: 42,
			branch: "imm/task-42",
			head_sha: pr.head_sha,
			status: "ready",
		};

		let marked = false;
		const readyResult = await dispatchRepair({
			event: readyEvent,
			pr,
			context: { worktree_path: "/dummy", task_id: "task-42" },
			deps: {
				mark_ready: {
					markReady: async () => {
						marked = true;
						return { success: true };
					},
				},
			},
		});
		expect(marked).toBe(true);
		expect(readyResult.action).toBe("marked_ready");

		const mergedEvent: E11PRReadyOrMergedEvent = {
			contract: LOOP_DAEMON_EVENT_CONTRACT,
			event_id: "evt-e11-merged",
			kind: "E11_PR_READY_OR_MERGED",
			timestamp: TS,
			pr_number: 42,
			branch: "imm/task-42",
			head_sha: pr.head_sha,
			status: "merged",
		};

		let cleaned = false;
		const mergedPr = daemonPr({ state: "merged", merged: true });
		const mergedResult = await dispatchRepair({
			event: mergedEvent,
			pr: mergedPr,
			context: { worktree_path: "/dummy", task_id: "task-42" },
			deps: {
				close_out: {
					removeWorktree: async () => {
						cleaned = true;
					},
				},
			},
		});
		expect(cleaned).toBe(true);
		expect(mergedResult.action).toBe("closed_out");
	});
});
