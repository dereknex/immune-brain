/**
 * Loop Daemon: Headless `fix-pr` Repair Loop & PR Lifecycle (S7)
 *
 * Implements S7 and D8 of docs/specs/loop-daemon.spec.md (BR-REQ-5).
 * Dispatches bounded headless repair for daemon-opened PRs:
 * - CI check failure (`repair_pr_ci`): reproduces locally via verification seam,
 *   repairs, verifies, and pushes. Enforces a strict 2-attempt cap per
 *   `(head_sha, failure_signature)` across all outcomes before escalating to owner.
 * - Merge conflict (`repair_pr_conflict`): rebases/merges base branch in isolated
 *   worktree, re-runs verification; escalates on semantic conflict outside `scope_hint`
 *   or touching `no_touch`/authority paths.
 * - PR review comments (`address_pr_review`): classifies comments into actionable
 *   in-scope fixes vs scope-changing requests (which escalate to owner); enforces
 *   `scope_hint` and `no_touch` boundaries.
 * - Lifecycle completion (`mark_pr_ready`, `close_out`): marks clean draft PR ready
 *   verifying all check and review gates, leaving merge strictly to the human owner
 *   (ADR 0039 Decision 11: no auto-merge).
 *   On external human owner merge, `close_out` cleans up isolated worktrees and
 *   releases active leases, clearing state.
 */

import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";

import { NO_TOUCH_PATH, noTouchPaths, readNoTouch } from "../no_touch.ts";
import { pathMatchesScope } from "../workspace_scope.ts";
import { escalationKey } from "./escalation.ts";
import { DEFAULT_REPAIR_RETRY_CAP, repairKey } from "./guards.ts";
import type { LoopHandler } from "./handlers.ts";
import { LOOP_PR_MARKER } from "./pr_opener.ts";
import { deleteLease, ensureLoopStateDir, loadLoopState, saveLoopState } from "./state.ts";
import type {
	RawComment,
	RawPRCheck,
	RawPRReview,
	RawPRReviewComment,
} from "./types.ts";

export { LOOP_PR_MARKER, DEFAULT_REPAIR_RETRY_CAP, repairKey };

export const LOOP_REPAIR_DISPATCH_CONTRACT = "assurance_kernel/loop_repair_dispatch/v1" as const;

export interface DaemonPrInput {
	number: number;
	title?: string;
	head_ref_name?: string;
	branch?: string;
	head_sha: string;
	base_ref_name?: string;
	base_branch?: string;
	body?: string | null;
	draft?: boolean;
	state?: "open" | "closed" | "merged";
	merged?: boolean;
	checks?: RawPRCheck[];
	reviews?: RawPRReview[];
	review_comments?: RawPRReviewComment[];
	comments?: RawComment[];
}

export interface FailedCheckInput {
	name: string;
	status?: string;
	conclusion?: string | null;
	log_excerpt?: string | null;
	details_url?: string;
	failure_signature?: string;
}

export interface RepairContext {
	worktree_path: string;
	task_id: string;
	scope_hint?: string[];
	state_dir?: string;
	retry_cap?: number;
	attempts?: number;
	lease_target_id?: string;
}

export type RepairAction =
	| "repaired"
	| "escalate"
	| "ignored"
	| "cannot_reproduce"
	| "retry_failed"
	| "marked_ready"
	| "closed_out";

export interface RepairResult {
	contract: typeof LOOP_REPAIR_DISPATCH_CONTRACT;
	action: RepairAction;
	handler: LoopHandler;
	pr_number: number;
	reason: string;
	commit_sha?: string | null;
	failure_signature?: string | null;
	attempts?: number;
	escalation_key?: string | null;
	cleaned_worktree?: boolean;
	released_lease?: boolean;
	waiting_for_owner_merge?: boolean;
}

/** The branch prefixes the daemon itself creates; only these may be force-pushed (D9). */
export function isDaemonBranch(branch: string): boolean {
	return branch.startsWith("imm/") || branch.startsWith("imm-loop/");
}

/**
 * Validates that the pull request is managed by the loop daemon.
 * Must be on `imm/*` or `imm-loop/*` and its body must carry `<!-- immune-brain:kind=loop-pr -->`.
 */
export function isDaemonManagedPr(pr: {
	head_ref_name?: string;
	branch?: string;
	body?: string | null;
}): boolean {
	const branch = pr.head_ref_name || pr.branch || "";
	if (!isDaemonBranch(branch)) return false;
	const body = pr.body ?? "";
	return body.includes(LOOP_PR_MARKER);
}

export function normalizeRepoPath(raw: string): string {
	if (typeof raw !== "string") return "";
	let p = raw.trim().replace(/\\/g, "/");
	p = posix.normalize(p);
	while (p.startsWith("./")) {
		p = p.slice(2);
	}
	p = p.replace(/^\/+/, "").replace(/\/+$/, "");
	return p;
}

/**
 * Enforces scope_hint and guard G3 (no_touch / authority paths).
 * - Empty scope_hint ([]) is enforced as zero-file scope (no files permitted).
 * - Directory prefixes and glob patterns in scope_hint are matched via pathMatchesScope.
 * - Reads declared no-touch paths from docs/agents/no-touch.json under worktreePath fail-closed.
 * - Normalizes repo-relative paths before checking authority/no-touch boundaries.
 */
export function validatePathsInScope(
	paths: readonly string[],
	scopeHint: readonly string[] | undefined,
	worktreePath?: string,
): { valid: boolean; reason?: string } {
	// Normalize paths and reject illegal traversal or invalid components
	const normalizedPaths: string[] = [];
	for (const raw of paths) {
		const norm = normalizeRepoPath(raw);
		const parts = norm ? norm.split("/") : [];
		if (
			!norm ||
			norm === "." ||
			norm === ".." ||
			parts.some(
				(part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git",
			)
		) {
			return { valid: false, reason: `illegal repository path or traversal: ${raw}` };
		}
		normalizedPaths.push(norm);
	}

	// Read declared no-touch declarations fail-closed
	let declaredNoTouch: string[] = [];
	if (worktreePath) {
		try {
			declaredNoTouch = readNoTouch(worktreePath);
		} catch (error: any) {
			return {
				valid: false,
				reason: `unreadable no-touch declaration: ${error?.message || String(error)}`,
			};
		}
	}

	// Guard G3: Check for forbidden authority/no-touch paths (including declared no-touch)
	const additions = [NO_TOUCH_PATH, ...declaredNoTouch];
	const forbidden = noTouchPaths(normalizedPaths, additions);
	if (forbidden.length > 0) {
		return { valid: false, reason: `authority/no-touch path targeted: ${forbidden.join(", ")}` };
	}

	// Scope hint check: empty array [] is zero-file scope
	if (scopeHint !== undefined) {
		if (scopeHint.length === 0) {
			if (normalizedPaths.length > 0) {
				return {
					valid: false,
					reason: `scope_hint is empty ([]); zero files permitted (attempted: ${normalizedPaths.join(", ")})`,
				};
			}
		} else {
			const outOfScope = normalizedPaths.filter(
				(p) => !scopeHint.some((hint) => pathMatchesScope(p, hint)),
			);
			if (outOfScope.length > 0) {
				return { valid: false, reason: `files outside scope_hint: ${outOfScope.join(", ")}` };
			}
		}
	}
	return { valid: true };
}

/**
 * Normalizes a log excerpt by stripping ANSI codes and excess whitespace.
 */
export function normalizeLogExcerpt(raw: string): string {
	return raw
		.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "")
		.replace(/\r\n/g, "\n")
		.replace(/[ \t]+/g, " ")
		.trim();
}

/** The hard byte bound on the excerpt a repair prompt may carry (D9). */
export const LOG_EXCERPT_BYTE_LIMIT = 16 * 1024;

/**
 * Normalizes a log and keeps its tail inside `limit` bytes: the failing step is
 * the last thing a CI log prints, so the head is what gets dropped.
 */
export function boundLogExcerpt(raw: string, limit: number = LOG_EXCERPT_BYTE_LIMIT): string {
	const normalized = normalizeLogExcerpt(raw);
	if (Buffer.byteLength(normalized, "utf8") <= limit) return normalized;
	let kept = "";
	let bytes = 0;
	for (const char of Array.from(normalized).reverse()) {
		const size = Buffer.byteLength(char, "utf8");
		if (bytes + size > limit) break;
		kept = char + kept;
		bytes += size;
	}
	return kept;
}

/**
 * Computes deterministic failure signature: sha256(check_name + normalized_log_excerpt).
 */
export function computeFailureSignature(checkName: string, logExcerpt?: string | null): string {
	const normalized = logExcerpt ? normalizeLogExcerpt(logExcerpt) : "";
	return createHash("sha256")
		.update(`${checkName}\n${normalized}`)
		.digest("hex");
}

/**
 * Strictly asserts that auto-merge is prohibited under ADR 0039 Decision 11.
 */
export function assertNoAutoMerge(action = "merge"): void {
	throw new Error(`auto_merge_prohibited: ADR 0039 Decision 11 strictly prohibits automated merging under any posture (attempted: ${action})`);
}

/** State file location for retry tracking */
export function repairRetriesPath(stateDir: string): string {
	return join(stateDir, "repair-retries.json");
}

export function loadRepairRetries(stateDir: string): Record<string, number> {
	try {
		const file = repairRetriesPath(stateDir);
		if (existsSync(file)) {
			return JSON.parse(readFileSync(file, "utf8"));
		}
	} catch {}
	return {};
}

export function saveRepairRetries(stateDir: string, retries: Record<string, number>): void {
	ensureLoopStateDir(stateDir);
	const file = repairRetriesPath(stateDir);
	const temp = `${file}.${randomUUID()}.tmp`;
	writeFileSync(temp, JSON.stringify(retries, null, 2), { mode: 0o600 });
	try {
		chmodSync(temp, 0o600);
	} catch {}
	renameSync(temp, file);
}

export function getRepairAttempts(stateDir: string, headSha: string, failureSignature: string): number {
	const retries = loadRepairRetries(stateDir);
	const key = repairKey(headSha, failureSignature);
	return retries[key] ?? 0;
}

export function recordRepairAttempt(stateDir: string, headSha: string, failureSignature: string): number {
	const retries = loadRepairRetries(stateDir);
	const key = repairKey(headSha, failureSignature);
	const count = (retries[key] ?? 0) + 1;
	retries[key] = count;
	saveRepairRetries(stateDir, retries);
	return count;
}

/**
 * The uncommitted paths the next commit would stage, read right before it; null
 * when unreadable. Verification runs after the scope check and may write files,
 * so this is the last look before anything is committed.
 */
export type PendingCommitPaths = (worktreePath: string) => Promise<string[] | null>;

/**
 * Re-checks scope immediately before a commit. Null means the commit may go
 * ahead; otherwise the reason it must not.
 */
async function precommitScopeViolation(
	pendingCommitPaths: PendingCommitPaths | undefined,
	context: RepairContext,
): Promise<string | null> {
	if (!pendingCommitPaths) return null;
	const pending = await pendingCommitPaths(context.worktree_path);
	if (pending === null) return "the changes about to be committed could not be read";
	const check = validatePathsInScope(pending, context.scope_hint, context.worktree_path);
	return check.valid ? null : `changes about to be committed leave the task scope: ${check.reason}`;
}

export interface RepairCiDeps {
	/** Re-read before commit; absent skips the re-check. */
	pendingCommitPaths?: PendingCommitPaths;
	/** Run local verification in the isolated worktree. Exit code !== 0 means failure reproduced. */
	runVerification: (worktreePath: string) => Promise<{ exit_code: number; stdout: string; stderr: string }>;
	/** Read the failing check's log; null or a throw means the log is unavailable. */
	fetchCheckLog?: (input: { check_name: string; details_url?: string }) => Promise<string | null>;
	/** Dispatch fix-pr implementation to fix the reproduced failure. */
	applyFix: (input: {
		worktree_path: string;
		check_name: string;
		failure_signature: string;
		log_excerpt?: string | null;
		details_url?: string;
		scope_hint?: string[];
	}) => Promise<{ success: boolean; modified_paths: string[]; reason?: string }>;
	/** Commit and push the verified fix. */
	gitCommitAndPush: (input: {
		worktree_path: string;
		branch: string;
		message: string;
	}) => Promise<{ commit_sha: string }>;
	postComment?: (input: { pr_number: number; body: string }) => Promise<void>;
}

export interface RepairCiInput {
	pr: DaemonPrInput;
	check: FailedCheckInput;
	context: RepairContext;
	deps: RepairCiDeps;
}

/**
 * Handles failed CI checks on daemon PRs (`repair_pr_ci`).
 * Requires local reproduction before committing a fix. Enforces a 2-attempt cap
 * per (head_sha, failure_signature) before escalating to owner.
 * Records attempts across every dispatched run (including unreproducible and out-of-scope).
 */
export async function repairPrCi(input: RepairCiInput): Promise<RepairResult> {
	if (!isDaemonManagedPr(input.pr)) {
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "ignored",
			handler: "repair_pr_ci",
			pr_number: input.pr.number,
			reason: "PR not on imm/* or imm-loop/* or lacking loop-pr marker",
		};
	}

	const branch = input.pr.head_ref_name || input.pr.branch || "";
	const failureSignature = input.check.failure_signature || computeFailureSignature(input.check.name, input.check.log_excerpt);
	const retryCap = input.context.retry_cap ?? DEFAULT_REPAIR_RETRY_CAP;

	const stateDir = input.context.state_dir;
	const existingAttempts = stateDir
		? getRepairAttempts(stateDir, input.pr.head_sha, failureSignature)
		: (input.context.attempts ?? 0);

	// Enforce 2-attempt cap: 3rd failure transitions to escalate
	if (existingAttempts >= retryCap) {
		const escKey = escalationKey({
			kind: "ci_repair_cap",
			target: `pr-${input.pr.number}`,
			detail: repairKey(input.pr.head_sha, failureSignature),
		});
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "escalate",
			handler: "escalate",
			pr_number: input.pr.number,
			reason: `3rd failure for the same (head_sha, failure_signature): repair attempt limit (${retryCap}) reached; escalating to owner`,
			failure_signature: failureSignature,
			attempts: existingAttempts,
			escalation_key: escKey,
		};
	}

	// 1. The failing check's own log is the repair session's first input (D9):
	// without it the session would guess, so an unavailable log escalates first.
	let logExcerpt: string | null = input.check.log_excerpt ?? null;
	if (input.deps.fetchCheckLog) {
		try {
			const fetched = await input.deps.fetchCheckLog({
				check_name: input.check.name,
				details_url: input.check.details_url,
			});
			if (!fetched) throw new Error("the check carries no readable log");
			logExcerpt = boundLogExcerpt(fetched);
		} catch (error: any) {
			return {
				contract: LOOP_REPAIR_DISPATCH_CONTRACT,
				action: "escalate",
				handler: "escalate",
				pr_number: input.pr.number,
				reason: `check log unavailable for ${input.check.name}: ${error?.message || String(error)}`,
				failure_signature: failureSignature,
				attempts: existingAttempts,
			};
		}
	}

	// 2. Local reproduction via the task's verification seam
	const repro = await input.deps.runVerification(input.context.worktree_path);
	if (repro.exit_code === 0) {
		// Could not reproduce failure locally: record attempt and do not commit speculative changes
		const newAttempts = stateDir
			? recordRepairAttempt(stateDir, input.pr.head_sha, failureSignature)
			: existingAttempts + 1;
		const shouldEscalate = newAttempts >= retryCap;
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: shouldEscalate ? "escalate" : "cannot_reproduce",
			handler: shouldEscalate ? "escalate" : "repair_pr_ci",
			pr_number: input.pr.number,
			reason: shouldEscalate
				? `cannot reproduce failure locally and retry cap reached (${newAttempts}/${retryCap}); escalating to owner`
				: "CI check failure could not be reproduced locally via verification seam",
			failure_signature: failureSignature,
			attempts: newAttempts,
		};
	}

	// 3. Local failure reproduced: execute repair fix
	const fixResult = await input.deps.applyFix({
		worktree_path: input.context.worktree_path,
		check_name: input.check.name,
		failure_signature: failureSignature,
		log_excerpt: logExcerpt,
		details_url: input.check.details_url,
		scope_hint: input.context.scope_hint,
	});

	if (!fixResult.success) {
		const newAttempts = stateDir
			? recordRepairAttempt(stateDir, input.pr.head_sha, failureSignature)
			: existingAttempts + 1;
		const shouldEscalate = newAttempts >= retryCap;
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: shouldEscalate ? "escalate" : "retry_failed",
			handler: shouldEscalate ? "escalate" : "repair_pr_ci",
			pr_number: input.pr.number,
			reason: fixResult.reason || `applyFix failed (attempt ${newAttempts}/${retryCap})`,
			failure_signature: failureSignature,
			attempts: newAttempts,
		};
	}

	// Guard: check that modified paths stay within scope_hint and avoid no_touch
	const scopeCheck = validatePathsInScope(
		fixResult.modified_paths,
		input.context.scope_hint,
		input.context.worktree_path,
	);
	if (!scopeCheck.valid) {
		const newAttempts = stateDir
			? recordRepairAttempt(stateDir, input.pr.head_sha, failureSignature)
			: existingAttempts + 1;
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "escalate",
			handler: "escalate",
			pr_number: input.pr.number,
			reason: `repair modified unauthorized files: ${scopeCheck.reason}`,
			failure_signature: failureSignature,
			attempts: newAttempts,
		};
	}

	// 4. Post-fix verification
	const postFix = await input.deps.runVerification(input.context.worktree_path);
	if (postFix.exit_code === 0) {
		const violation = await precommitScopeViolation(input.deps.pendingCommitPaths, input.context);
		if (violation) {
			const newAttempts = stateDir
				? recordRepairAttempt(stateDir, input.pr.head_sha, failureSignature)
				: existingAttempts + 1;
			return {
				contract: LOOP_REPAIR_DISPATCH_CONTRACT,
				action: "escalate",
				handler: "escalate",
				pr_number: input.pr.number,
				reason: `repair not committed: ${violation}`,
				failure_signature: failureSignature,
				attempts: newAttempts,
			};
		}
		const commitMessage =`fix(pr): repair CI check ${input.check.name} [${failureSignature.slice(0, 8)}]`;
		const { commit_sha } = await input.deps.gitCommitAndPush({
			worktree_path: input.context.worktree_path,
			branch,
			message: commitMessage,
		});
		const newAttempts = stateDir
			? recordRepairAttempt(stateDir, input.pr.head_sha, failureSignature)
			: existingAttempts + 1;
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "repaired",
			handler: "repair_pr_ci",
			pr_number: input.pr.number,
			reason: `reproduced failure locally, applied fix, verified, and pushed commit ${commit_sha}`,
			commit_sha,
			failure_signature: failureSignature,
			attempts: newAttempts,
		};
	}

	// Post-fix verification still failed
	const newAttempts = stateDir
		? recordRepairAttempt(stateDir, input.pr.head_sha, failureSignature)
		: existingAttempts + 1;
	const shouldEscalate = newAttempts >= retryCap;
	return {
		contract: LOOP_REPAIR_DISPATCH_CONTRACT,
		action: shouldEscalate ? "escalate" : "retry_failed",
		handler: shouldEscalate ? "escalate" : "repair_pr_ci",
		pr_number: input.pr.number,
		reason: `verification failed after repair fix (attempt ${newAttempts}/${retryCap})${shouldEscalate ? "; escalating to owner" : ""}`,
		failure_signature: failureSignature,
		attempts: newAttempts,
	};
}

export interface RepairConflictDeps {
	/** Re-read before commit; absent skips the re-check. */
	pendingCommitPaths?: PendingCommitPaths;
	/** Start a rebase onto the base branch; on conflict the conflicted tree is left in place. */
	rebaseOrMerge: (input: {
		worktree_path: string;
		base_branch: string;
	}) => Promise<{ success: boolean; conflicting_paths?: string[]; error?: string }>;
	/** Resolve the conflicted tree in a repair session; absent means escalate. */
	applyConflictFix?: (input: {
		worktree_path: string;
		base_branch: string;
		conflicting_paths: string[];
		scope_hint?: string[];
	}) => Promise<{ success: boolean; modified_paths: string[]; reason?: string }>;
	/** Run verification seam in worktree. */
	runVerification: (worktreePath: string) => Promise<{ exit_code: number; stdout: string; stderr: string }>;
	/** Commit and push rebased branch. */
	gitCommitAndPush: (input: {
		worktree_path: string;
		branch: string;
		message: string;
	}) => Promise<{ commit_sha: string }>;
	/** Commit the resolved rebase and push with `--force-with-lease` (daemon branches only). */
	gitForcePushWithLease?: (input: {
		worktree_path: string;
		branch: string;
		message: string;
	}) => Promise<{ commit_sha: string }>;
}

export interface RepairConflictInput {
	pr: DaemonPrInput;
	context: RepairContext;
	deps: RepairConflictDeps;
}

/**
 * Handles PR merge conflicts (`repair_pr_conflict`).
 * Rebases/merges base branch in isolated worktree and re-runs verification;
 * escalates on semantic conflict outside `scope_hint` or touching `no_touch` paths.
 */
export async function repairPrConflict(input: RepairConflictInput): Promise<RepairResult> {
	if (!isDaemonManagedPr(input.pr)) {
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "ignored",
			handler: "repair_pr_conflict",
			pr_number: input.pr.number,
			reason: "PR not on imm/* or imm-loop/* or lacking loop-pr marker",
		};
	}

	const branch = input.pr.head_ref_name || input.pr.branch || "";
	const baseBranch = input.pr.base_ref_name || input.pr.base_branch || "main";

	// Rebase/merge base branch in isolated worktree
	const rebaseRes = await input.deps.rebaseOrMerge({
		worktree_path: input.context.worktree_path,
		base_branch: baseBranch,
	});

	if (!rebaseRes.success) {
		const conflictingPaths = rebaseRes.conflicting_paths || [];
		const scopeCheck = validatePathsInScope(
			conflictingPaths,
			input.context.scope_hint,
			input.context.worktree_path,
		);
		if (!scopeCheck.valid) {
			return {
				contract: LOOP_REPAIR_DISPATCH_CONTRACT,
				action: "escalate",
				handler: "escalate",
				pr_number: input.pr.number,
				reason: `semantic conflict outside scope_hint: ${scopeCheck.reason}`,
			};
		}
		if (!input.deps.applyConflictFix) {
			return {
				contract: LOOP_REPAIR_DISPATCH_CONTRACT,
				action: "escalate",
				handler: "escalate",
				pr_number: input.pr.number,
				reason: `unresolvable merge conflict: ${rebaseRes.error || conflictingPaths.join(", ")}`,
			};
		}

		// D9: keep the conflicted tree and let a repair session resolve it.
		const resolution = await input.deps.applyConflictFix({
			worktree_path: input.context.worktree_path,
			base_branch: baseBranch,
			conflicting_paths: conflictingPaths,
			scope_hint: input.context.scope_hint,
		});
		if (!resolution.success) {
			return {
				contract: LOOP_REPAIR_DISPATCH_CONTRACT,
				action: "escalate",
				handler: "escalate",
				pr_number: input.pr.number,
				reason: resolution.reason || "conflict repair session did not resolve the conflicted tree",
			};
		}
		const resolvedScope = validatePathsInScope(
			resolution.modified_paths,
			input.context.scope_hint,
			input.context.worktree_path,
		);
		if (!resolvedScope.valid) {
			return {
				contract: LOOP_REPAIR_DISPATCH_CONTRACT,
				action: "escalate",
				handler: "escalate",
				pr_number: input.pr.number,
				reason: `conflict repair touched unauthorized files: ${resolvedScope.reason}`,
			};
		}
	}

	// Re-run verification after rebase
	const verify = await input.deps.runVerification(input.context.worktree_path);
	if (verify.exit_code !== 0) {
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "escalate",
			handler: "escalate",
			pr_number: input.pr.number,
			reason: "verification failed after base branch rebase",
		};
	}
	const conflictViolation = await precommitScopeViolation(input.deps.pendingCommitPaths, input.context);
	if (conflictViolation) {
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "escalate",
			handler: "escalate",
			pr_number: input.pr.number,
			reason: `rebase not committed: ${conflictViolation}`,
		};
	}

	const commitMessage = `chore(pr): rebase ${baseBranch} onto ${branch}`;
	// ADR 0039 Decision 10: a rewrite is only ever pushed back to a branch the daemon created.
	const push = rebaseRes.success
		? input.deps.gitCommitAndPush
		: isDaemonBranch(branch) && input.deps.gitForcePushWithLease
			? input.deps.gitForcePushWithLease
			: null;
	if (!push) {
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "escalate",
			handler: "escalate",
			pr_number: input.pr.number,
			reason: `refusing to force-push the resolved rebase: ${branch || "unknown branch"} is not a daemon-created branch`,
		};
	}
	const { commit_sha } = await push({
		worktree_path: input.context.worktree_path,
		branch,
		message: commitMessage,
	});

	return {
		contract: LOOP_REPAIR_DISPATCH_CONTRACT,
		action: "repaired",
		handler: "repair_pr_conflict",
		pr_number: input.pr.number,
		reason: `rebased ${baseBranch}, re-verified cleanly, and pushed commit ${commit_sha}`,
		commit_sha,
	};
}

export interface ReviewCommentInput {
	id: number;
	body: string;
	path?: string;
	line?: number;
	diff_hunk?: string;
	author?: string;
	author_association?: string;
}

export interface AddressReviewDeps {
	/** Re-read before commit; absent skips the re-check. */
	pendingCommitPaths?: PendingCommitPaths;
	classifyComment?: (input: {
		comment: ReviewCommentInput;
		scope_hint?: string[];
	}) => Promise<{ is_scope_changing: boolean; reason?: string }>;
	applyReviewFix: (input: {
		worktree_path: string;
		comments: ReviewCommentInput[];
	}) => Promise<{ success: boolean; modified_paths: string[]; reason?: string }>;
	runVerification: (worktreePath: string) => Promise<{ exit_code: number; stdout: string; stderr: string }>;
	gitCommitAndPush: (input: {
		worktree_path: string;
		branch: string;
		message: string;
	}) => Promise<{ commit_sha: string }>;
}

export interface AddressReviewInput {
	pr: DaemonPrInput;
	comments: ReviewCommentInput[];
	context: RepairContext;
	deps: AddressReviewDeps;
}

/**
 * The highest review comment id of one PR head already batched into a session
 * (D9), or 0. A comment at or below it was addressed; a later one on the same
 * head starts the next batch instead of being dropped.
 */
export function reviewHeadBatchedThrough(stateDir: string, headSha: string): number {
	const value = loadRepairRetries(stateDir)[`review:${headSha}`];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** True once the comment `commentId` of this head has been batched into a session (D9). */
export function isReviewHeadBatched(stateDir: string, headSha: string, commentId: number): boolean {
	return reviewHeadBatchedThrough(stateDir, headSha) >= commentId;
}

export function markReviewHeadBatched(stateDir: string, headSha: string, throughCommentId: number): void {
	const retries = loadRepairRetries(stateDir);
	retries[`review:${headSha}`] = Math.max(reviewHeadBatchedThrough(stateDir, headSha), throughCommentId);
	saveRepairRetries(stateDir, retries);
}

/**
 * Handles PR review comments (`address_pr_review`).
 * Every comment of one PR head goes into one session and one push (D9): the
 * comments are classified together, so a scope-changing one escalates the batch
 * instead of being applied.
 */
export async function addressPrReview(input: AddressReviewInput): Promise<RepairResult> {
	if (!isDaemonManagedPr(input.pr)) {
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "ignored",
			handler: "address_pr_review",
			pr_number: input.pr.number,
			reason: "PR not on imm/* or imm-loop/* or lacking loop-pr marker",
		};
	}
	if (input.comments.length === 0) {
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "ignored",
			handler: "address_pr_review",
			pr_number: input.pr.number,
			reason: "no review comments to batch",
		};
	}

	const branch = input.pr.head_ref_name || input.pr.branch || "";

	for (const comment of input.comments) {
		// Check if target file path is unauthorized (outside scope_hint or touches no_touch)
		if (comment.path) {
			const scopeCheck = validatePathsInScope(
				[comment.path],
				input.context.scope_hint,
				input.context.worktree_path,
			);
			if (!scopeCheck.valid) {
				return {
					contract: LOOP_REPAIR_DISPATCH_CONTRACT,
					action: "escalate",
					handler: "escalate",
					pr_number: input.pr.number,
					reason: `review comment #${comment.id} references unauthorized path (${comment.path}): ${scopeCheck.reason}`,
				};
			}
		}

		if (input.deps.classifyComment) {
			const classified = await input.deps.classifyComment({
				comment,
				scope_hint: input.context.scope_hint,
			});
			if (classified.is_scope_changing) {
				return {
					contract: LOOP_REPAIR_DISPATCH_CONTRACT,
					action: "escalate",
					handler: "escalate",
					pr_number: input.pr.number,
					reason: `scope-changing review comment #${comment.id}: ${classified.reason || "request beyond original task intent"}; escalating to owner`,
				};
			}
		}
	}

	// Apply the whole batch in one session
	const fixResult = await input.deps.applyReviewFix({
		worktree_path: input.context.worktree_path,
		comments: input.comments,
	});

	if (!fixResult.success) {
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "escalate",
			handler: "escalate",
			pr_number: input.pr.number,
			reason: fixResult.reason || "failed to apply review fix; escalating to owner",
		};
	}

	// Check that modified files stayed in scope and avoided no_touch
	const modifiedScopeCheck = validatePathsInScope(
		fixResult.modified_paths,
		input.context.scope_hint,
		input.context.worktree_path,
	);
	if (!modifiedScopeCheck.valid) {
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "escalate",
			handler: "escalate",
			pr_number: input.pr.number,
			reason: `review fix touched unauthorized files: ${modifiedScopeCheck.reason}`,
		};
	}

	// Re-verify after review fix
	const verify = await input.deps.runVerification(input.context.worktree_path);
	if (verify.exit_code !== 0) {
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "escalate",
			handler: "escalate",
			pr_number: input.pr.number,
			reason: "verification failed after addressing review comment; escalating to owner",
		};
	}
	const reviewViolation = await precommitScopeViolation(input.deps.pendingCommitPaths, input.context);
	if (reviewViolation) {
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "escalate",
			handler: "escalate",
			pr_number: input.pr.number,
			reason: `review fix not committed: ${reviewViolation}`,
		};
	}

	const ids = input.comments.map((comment) => `#${comment.id}`).join(", ");
	const commitMessage = `fix(pr): address review comments ${ids}`;
	const { commit_sha } = await input.deps.gitCommitAndPush({
		worktree_path: input.context.worktree_path,
		branch,
		message: commitMessage,
	});

	return {
		contract: LOOP_REPAIR_DISPATCH_CONTRACT,
		action: "repaired",
		handler: "address_pr_review",
		pr_number: input.pr.number,
		reason: `addressed review comments ${ids} in one session, re-verified cleanly, and pushed commit ${commit_sha}`,
		commit_sha,
	};
}

export interface MarkReadyDeps {
	markReady: (prNumber: number) => Promise<{ success: boolean; error?: string }>;
}

export interface MarkReadyInput {
	pr: DaemonPrInput;
	deps: MarkReadyDeps;
}

/**
 * Marks draft PR ready when checks and review gates pass (`mark_pr_ready`).
 * Verifies open-draft state, non-empty passing checks, and no CHANGES_REQUESTED reviews.
 * Merging stays strictly with the human owner under ADR 0039 Decision 11: no auto-merge under any posture.
 */
export async function markPrReady(input: MarkReadyInput): Promise<RepairResult> {
	if (!isDaemonManagedPr(input.pr)) {
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "ignored",
			handler: "mark_pr_ready",
			pr_number: input.pr.number,
			reason: "PR not on imm/* or imm-loop/* or lacking loop-pr marker",
		};
	}

	// Verify open draft state: must be open and draft === true
	if (input.pr.state !== "open" || input.pr.draft === false) {
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "ignored",
			handler: "mark_pr_ready",
			pr_number: input.pr.number,
			reason: `PR is not an open draft (state: ${input.pr.state}, draft: ${input.pr.draft})`,
		};
	}

	// Verify review gates: evaluate each reviewer's latest decisive review state (APPROVED vs CHANGES_REQUESTED)
	const reviews = input.pr.reviews || [];
	const latestDecisiveByUser = new Map<string, RawPRReview>();
	for (const review of reviews) {
		const login = review.user?.login;
		if (!login) continue;
		if (review.state !== "APPROVED" && review.state !== "CHANGES_REQUESTED") continue;
		const existing = latestDecisiveByUser.get(login);
		if (!existing) {
			latestDecisiveByUser.set(login, review);
		} else {
			const existingTime = existing.submitted_at ? Date.parse(existing.submitted_at) : 0;
			const newTime = review.submitted_at ? Date.parse(review.submitted_at) : 0;
			if (newTime > existingTime || (newTime === existingTime && (review.id || 0) >= (existing.id || 0))) {
				latestDecisiveByUser.set(login, review);
			}
		}
	}
	const hasChangesRequested = Array.from(latestDecisiveByUser.values()).some(
		(r) => r.state === "CHANGES_REQUESTED",
	);
	if (hasChangesRequested) {
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "ignored",
			handler: "mark_pr_ready",
			pr_number: input.pr.number,
			reason: "PR has unresolved CHANGES_REQUESTED review gate",
		};
	}

	// Verify non-empty passing checks: must have checks and all must be completed & success
	const checks = input.pr.checks || [];
	if (checks.length === 0) {
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "ignored",
			handler: "mark_pr_ready",
			pr_number: input.pr.number,
			reason: "PR has no checks; cannot mark ready without passing verification checks",
		};
	}

	const hasFailingChecks = checks.some(
		(c) =>
			c.conclusion === "failure" ||
			c.conclusion === "timed_out" ||
			c.conclusion === "action_required" ||
			c.conclusion === "cancelled" ||
			c.conclusion === "startup_failure",
	);
	const hasPendingChecks = checks.some((c) => c.status !== "completed" || c.conclusion === null);

	if (hasFailingChecks || hasPendingChecks) {
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "ignored",
			handler: "mark_pr_ready",
			pr_number: input.pr.number,
			reason: "PR has failing or pending checks; cannot mark ready",
		};
	}

	// Strictly assert auto-merge prohibition: any attempt to auto-merge fails closed
	if (
		(input as any).auto_merge ||
		(input as any).merge ||
		(input.pr as any).auto_merge ||
		(input.pr as any).merge
	) {
		assertNoAutoMerge("auto_merge");
	}

	const res = await input.deps.markReady(input.pr.number);
	if (!res.success) {
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "escalate",
			handler: "escalate",
			pr_number: input.pr.number,
			reason: `failed to mark PR ready: ${res.error || "unknown error"}`,
		};
	}

	return {
		contract: LOOP_REPAIR_DISPATCH_CONTRACT,
		action: "marked_ready",
		handler: "mark_pr_ready",
		pr_number: input.pr.number,
		reason: "marked draft PR ready; waiting strictly for human owner merge (ADR 0039 Decision 11: no auto-merge)",
		waiting_for_owner_merge: true,
	};
}

export interface CloseOutDeps {
	removeWorktree?: (worktreePath: string) => Promise<void> | void;
	releaseLease?: (stateDir: string, targetId: string) => Promise<void> | void;
}

export interface CloseOutInput {
	pr: DaemonPrInput;
	context: {
		worktree_path?: string;
		state_dir?: string;
		lease_target_id?: string;
	};
	deps?: CloseOutDeps;
}

/**
 * Cleans up worktrees and releases active leases upon external PR merge by owner (`close_out`).
 * Verifies that the PR is truly in a merged state and updates active_leases in state.json.
 */
export async function closeOut(input: CloseOutInput): Promise<RepairResult> {
	if (!isDaemonManagedPr(input.pr)) {
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "ignored",
			handler: "close_out",
			pr_number: input.pr.number,
			reason: "PR not on imm/* or imm-loop/* or lacking loop-pr marker",
		};
	}

	// Verify merged PR state
	const isMerged = input.pr.state === "merged" || input.pr.merged === true;
	if (!isMerged) {
		return {
			contract: LOOP_REPAIR_DISPATCH_CONTRACT,
			action: "ignored",
			handler: "close_out",
			pr_number: input.pr.number,
			reason: "PR is not merged; close_out requires merged PR state",
		};
	}

	let cleanedWorktree = false;
	if (input.context.worktree_path) {
		if (input.deps?.removeWorktree) {
			await input.deps.removeWorktree(input.context.worktree_path);
			cleanedWorktree = true;
		} else if (existsSync(input.context.worktree_path)) {
			rmSync(input.context.worktree_path, { recursive: true, force: true });
			cleanedWorktree = true;
		}
	}

	let releasedLease = false;
	if (input.context.state_dir && input.context.lease_target_id) {
		if (input.deps?.releaseLease) {
			await input.deps.releaseLease(input.context.state_dir, input.context.lease_target_id);
			releasedLease = true;
		} else {
			const deleted = deleteLease(input.context.state_dir, input.context.lease_target_id);
			releasedLease = deleted;

			// Also update state.json's active_leases mapping
			const state = loadLoopState(input.context.state_dir);
			if (state && state.active_leases && state.active_leases[input.context.lease_target_id]) {
				delete state.active_leases[input.context.lease_target_id];
				saveLoopState(input.context.state_dir, state);
			}
		}
	}

	return {
		contract: LOOP_REPAIR_DISPATCH_CONTRACT,
		action: "closed_out",
		handler: "close_out",
		pr_number: input.pr.number,
		reason: "PR merged by human owner; worktree cleaned up and lease closed out",
		cleaned_worktree: cleanedWorktree,
		released_lease: releasedLease,
	};
}
