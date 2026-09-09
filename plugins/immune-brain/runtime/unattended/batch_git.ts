// Git branch preflight and per-child scope-bounded commit for unattended batch runs.
// Defined by docs/specs/unattended-initiative-batch-run.spec.md section 3.5.
// Invariant: The runtime never creates, switches, or deletes a Git worktree,
// never pushes a ref, and never opens or updates a pull request.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	constants,
	closeSync,
	existsSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { readAuditTaskPair, readSecureProjectFile } from "../kernel/storage";
import { pathMatchesScope } from "../workspace_scope";

export type BatchGitPreflightRejectReason =
	| "batch_branch_exists"
	| "dirty_working_tree"
	| "uncommitted_head"
	| "not_a_git_repository"
	| "not_repository_root"
	| string;

export type BatchGitPreflightResult =
	| { ok: true; branch: string }
	| { ok: false; reason: BatchGitPreflightRejectReason; message: string };

export interface BatchRunnerGitPort {
	preflight(input: {
		root: string;
		initiative_slug: string;
		base_head: string;
	}): Promise<BatchGitPreflightResult> | BatchGitPreflightResult;
	commitChild(
		root: string,
		taskId: string,
		batchId: string,
		head: string,
		branch?: string,
		intentPath?: string,
	): Promise<{ commit: string }>;
	lookupBatchCommit(
		root: string,
		taskId: string,
		batchId: string,
		expectedHead?: string,
		branch?: string,
	): Promise<{ commit: string } | null>;
}

const DEFAULT_GIT_ENV = {
	...process.env,
	GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "Immune-Brain Batch",
	GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "immune-brain@local",
	GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "Immune-Brain Batch",
	GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "immune-brain@local",
};

/**
 * Preflight before any child is enrolled: requires clean working tree,
 * committed HEAD, and absence of refs/heads/imm/<initiative-slug>.
 * Verifies root is the top-level repository root (Finding 5).
 * Explicitly passes --untracked-files=all so repo config cannot bypass dirty check (Finding 2).
 * Disables Git hooks during checkout (Finding 2).
 * Rejection leaves zero writes, zero batch state files, and the original branch.
 * Passing preflight creates and switches to imm/<initiative-slug> from base_head.
 */
export function runBatchGitPreflight(input: {
	root: string;
	initiative_slug: string;
	base_head: string;
}): BatchGitPreflightResult {
	const { root, initiative_slug: initiativeSlug, base_head: baseHead } = input;
	const branch = `imm/${initiativeSlug}`;

	// 0. Verify root is a Git repository and is the top-level repository root (Finding 5)
	const toplevelResult = spawnSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (toplevelResult.status !== 0 || !toplevelResult.stdout.trim()) {
		return {
			ok: false,
			reason: "not_a_git_repository",
			message: "root must be a Git repository with a committed HEAD",
		};
	}
	let realToplevel: string;
	let realRoot: string;
	try {
		realToplevel = realpathSync(toplevelResult.stdout.trim());
		realRoot = realpathSync(root);
	} catch {
		return {
			ok: false,
			reason: "not_repository_root",
			message: "failed to resolve repository root",
		};
	}
	if (realToplevel !== realRoot) {
		return {
			ok: false,
			reason: "not_repository_root",
			message: "batch root must be the top-level repository root, not a subdirectory",
		};
	}

	// 1. Clean working tree check: explicitly pass --untracked-files=all so status.showUntrackedFiles=no is overridden (Finding 2)
	// Also reject unsupported index flags (assume-unchanged/skip-worktree) that hide modifications (Finding 2)
	const flaggedPreflight = getUnsupportedIndexFlags(root);
	if (flaggedPreflight.length > 0) {
		return {
			ok: false,
			reason: "dirty_working_tree",
			message: `unsupported index flags (assume-unchanged/skip-worktree) detected: ${flaggedPreflight.join(", ")}`,
		};
	}

	const statusResult = spawnSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (statusResult.status !== 0) {
		return {
			ok: false,
			reason: "dirty_working_tree",
			message: statusResult.stderr?.trim() || "failed to inspect working tree status",
		};
	}
	if (statusResult.stdout.trim().length > 0) {
		return {
			ok: false,
			reason: "dirty_working_tree",
			message: "working tree is dirty before batch preflight",
		};
	}

	// 2. Committed HEAD check
	const headResult = spawnSync("git", ["-C", root, "rev-parse", "--verify", "HEAD^{commit}"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (headResult.status !== 0 || !headResult.stdout.trim()) {
		return {
			ok: false,
			reason: "uncommitted_head",
			message: "HEAD is uncommitted or not a valid commit",
		};
	}

	// 3. Absence of refs/heads/imm/<initiative-slug>
	const branchCheck = spawnSync(
		"git",
		["-C", root, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
		{ stdio: ["ignore", "ignore", "ignore"] },
	);
	if (branchCheck.status === 0) {
		return {
			ok: false,
			reason: "batch_branch_exists",
			message: `branch refs/heads/${branch} already exists`,
		};
	}

	const originalBranchResult = spawnSync("git", ["-C", root, "symbolic-ref", "--short", "HEAD"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	const originalBranch = originalBranchResult.stdout.trim();

	// 4. Create and switch to imm/<initiative-slug> from base_head with hooks explicitly disabled (Finding 2)
	const checkoutResult = spawnSync(
		"git",
		["-C", root, "-c", "core.hooksPath=/dev/null", "checkout", "-b", branch, baseHead],
		{
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			env: DEFAULT_GIT_ENV,
		},
	);
	if (checkoutResult.status !== 0) {
		const stderr = checkoutResult.stderr?.trim() || "";
		// Check if checkout failed because branch already exists concurrently (Finding 2)
		const branchExists =
			stderr.includes("already exists") ||
			spawnSync("git", ["-C", root, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).status === 0;

		// Restore original branch checkout if HEAD was switched
		const currentBranchCheck = spawnSync("git", ["-C", root, "symbolic-ref", "--short", "HEAD"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).stdout.trim();
		if (currentBranchCheck === branch && originalBranch && originalBranch !== branch) {
			spawnSync("git", ["-C", root, "-c", "core.hooksPath=/dev/null", "checkout", originalBranch], {
				stdio: ["ignore", "ignore", "ignore"],
			});
		}
		// Do not unconditionally delete branch with branch -D; preserve concurrent external refs (Finding 2)

		if (branchExists) {
			return {
				ok: false,
				reason: "batch_branch_exists",
				message: `branch refs/heads/${branch} already exists`,
			};
		}
		return {
			ok: false,
			reason: "branch_creation_failed",
			message: stderr || `failed to checkout -b ${branch} ${baseHead}`,
		};
	}

	return { ok: true, branch };
}

function hasBoundaryWhitespace(path: string): boolean {
	return path.split("/").some((segment) => segment.trim() !== segment || segment.length === 0);
}

function getUnsupportedIndexFlags(root: string): string[] {
	const result = spawnSync("git", ["-C", root, "ls-files", "-v", "-z", "--"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.status !== 0) {
		throw new Error("failed to inspect index flags via git ls-files -v");
	}
	const entries = result.stdout.split("\0").filter((e) => e.length > 0);
	const flagged: string[] = [];
	for (const entry of entries) {
		const tag = entry[0];
		// Reject h (assume-unchanged), S (skip-worktree), and s (both flags combined) (Finding 1)
		if (tag === "h" || tag === "S" || tag === "s") {
			flagged.push(entry.slice(2));
		}
	}
	return flagged;
}

function isPathAllowedForChild(path: string, taskId: string, scopeHint: string[]): boolean {
	// Finding 4: reject segment-level leading/trailing whitespace
	if (hasBoundaryWhitespace(path)) return false;
	// Finding 2: on POSIX, literal backslashes are valid filename characters and must not
	// be normalized into path separators; reject non-canonical backslash paths before check
	if (path.includes("\\")) return false;

	const normalized = path.replace(/^\.\//, "");
	if (normalized === `.imm/audit/${taskId}` || normalized.startsWith(`.imm/audit/${taskId}/`)) {
		return true;
	}
	return scopeHint.some((scopePath) => {
		if (scopePath.includes("*") || scopePath.includes("?")) {
			return pathMatchesScope(normalized, scopePath);
		}
		return normalized === scopePath || normalized.startsWith(`${scopePath}/`);
	});
}

function getChangedProjectPaths(root: string): string[] {
	const tracked = spawnSync("git", ["-C", root, "diff-index", "--name-only", "-z", "--ignore-submodules=none", "HEAD", "--"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (tracked.status !== 0) throw new Error("failed to inspect tracked diff vs HEAD");
	const untracked = spawnSync("git", ["-C", root, "ls-files", "--others", "--exclude-standard", "-z", "--"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (untracked.status !== 0) throw new Error("failed to inspect untracked files");

	// Finding 4: do NOT trim NUL-delimited paths; preserve exact path bytes
	const splitZ = (s: string) => s.split("\0").filter((p) => p.length > 0);
	return [...new Set([...splitZ(tracked.stdout), ...splitZ(untracked.stdout)])];
}

function getStagedProjectPaths(root: string): string[] {
	const staged = spawnSync("git", ["-C", root, "diff-index", "--cached", "--name-only", "-z", "--ignore-submodules=none", "HEAD", "--"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (staged.status !== 0) throw new Error("failed to inspect staged diff vs HEAD");
	return staged.stdout.split("\0").filter((p) => p.length > 0);
}

function getUnstagedProjectPaths(root: string): string[] {
	const diffFiles = spawnSync("git", ["-C", root, "diff-files", "--name-only", "-z", "--ignore-submodules=none", "--"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (diffFiles.status !== 0) throw new Error("failed to inspect unstaged tracked changes");
	const untracked = spawnSync("git", ["-C", root, "ls-files", "--others", "--exclude-standard", "-z", "--"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (untracked.status !== 0) throw new Error("failed to inspect untracked files");

	const splitZ = (s: string) => s.split("\0").filter((p) => p.length > 0);
	return [...new Set([...splitZ(diffFiles.stdout), ...splitZ(untracked.stdout)])];
}

function getCommittedDeltaPaths(root: string): string[] {
	const delta = spawnSync(
		"git",
		["-C", root, "diff-tree", "--no-commit-id", "--name-only", "-z", "-r", "HEAD~1", "HEAD"],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	);
	if (delta.status !== 0) throw new Error("failed to inspect committed tree delta");
	return delta.stdout.split("\0").filter((p) => p.length > 0);
}

function commitEvidencePath(batchId: string, taskId: string): string {
	return join(".imm", "state", "batches", "commits", `${batchId}-${taskId}.json`);
}

function ensureSecureDirectory(root: string, relativePath: string): string {
	const segments = relativePath.split("/").filter(Boolean);
	let current = root;
	for (const segment of segments) {
		current = join(current, segment);
		if (existsSync(current)) {
			const stats = lstatSync(current);
			if (stats.isSymbolicLink() || !stats.isDirectory()) {
				throw new Error(`${segment} exists but is not a real directory`);
			}
		} else {
			mkdirSync(current);
		}
	}
	return current;
}

function writeFileAtomically(root: string, relativePath: string, bytes: string): void {
	const target = join(root, relativePath);
	const targetDir = dirname(target);
	ensureSecureDirectory(root, dirname(relativePath));
	const stats = lstatSync(targetDir);
	if (stats.isSymbolicLink() || !stats.isDirectory()) {
		throw new Error(`${dirname(relativePath)} is not a real directory`);
	}
	if (existsSync(target)) {
		const targetStats = lstatSync(target);
		if (targetStats.isSymbolicLink()) {
			throw new Error(`${relativePath} is a symlink`);
		}
	}
	const tempPath = `${target}.${randomUUID()}.tmp`;
	let fd: number | null = null;
	try {
		fd = openSync(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
		writeFileSync(fd, bytes, "utf8");
		closeSync(fd);
		fd = null;
		renameSync(tempPath, target);
	} finally {
		if (fd !== null) closeSync(fd);
		if (existsSync(tempPath)) {
			try {
				rmSync(tempPath);
			} catch {
				/* temp already moved */
			}
		}
	}
}

function writeBatchCommitEvidence(
	root: string,
	evidence: { batchId: string; taskId: string; commit: string; parentHead: string },
): void {
	const path = commitEvidencePath(evidence.batchId, evidence.taskId);
	const payload = {
		contract: "assurance_kernel/batch_commit_evidence/v1",
		batch_id: evidence.batchId,
		task_id: evidence.taskId,
		commit: evidence.commit,
		parent_head: evidence.parentHead,
		created_at: new Date().toISOString(),
	};
	writeFileAtomically(root, path, `${JSON.stringify(payload, null, 2)}\n`);
}

function readBatchCommitEvidence(
	root: string,
	batchId: string,
	taskId: string,
): { commit: string; parent_head: string } | null {
	const path = commitEvidencePath(batchId, taskId);
	const fullPath = join(root, path);
	if (!existsSync(fullPath)) return null;
	try {
		const content = readSecureProjectFile(root, path);
		const parsed = JSON.parse(content) as {
			contract?: unknown;
			batch_id?: unknown;
			task_id?: unknown;
			commit?: unknown;
			parent_head?: unknown;
		};
		if (
			parsed.contract === "assurance_kernel/batch_commit_evidence/v1" &&
			parsed.batch_id === batchId &&
			parsed.task_id === taskId &&
			typeof parsed.commit === "string" &&
			typeof parsed.parent_head === "string"
		) {
			return { commit: parsed.commit, parent_head: parsed.parent_head };
		}
	} catch {
		return null;
	}
	return null;
}

/**
 * Scope-bounded commit after Kernel reports a child done.
 * Reads authorized scope and goal from verified terminal TaskRecord.intent_snapshot (Finding 1).
 * Full audit pair validation with identity, contract, and hash checks (Finding 2).
 * Staging includes exactly the changed paths inside that child's TaskIntent scope
 * envelope plus .imm/audit/<task-id>/**. If any change exists outside that set,
 * nothing is committed and an error with message "dirty_outside_scope" is thrown.
 * Advances expected_head lineage. Disables all Git hooks (Finding 1).
 * Preserves files on failure without destructive rollback (Finding 1).
 * Records durable commit evidence for tamper-proof crash recovery (Finding 1).
 */
export async function commitBatchChild(input: {
	root: string;
	taskId: string;
	batchId: string;
	expectedHead: string;
	branch?: string;
	intentPath?: string;
}): Promise<{ commit: string }> {
	const { root, taskId, batchId, expectedHead, branch: expectedBranch } = input;

	// 1. Verify Kernel reports that child done via immutable terminal audit pair (Finding 2)
	const auditPair = readAuditTaskPair(root, taskId);
	if (!auditPair) {
		throw new Error(`cannot commit child ${taskId}: task is not settled done (audit pair missing)`);
	}
	const lifecycle = "lifecycle" in auditPair.record ? auditPair.record.lifecycle : auditPair.record.phase;
	if (lifecycle !== "done") {
		throw new Error(`cannot commit child ${taskId}: task is not settled done (lifecycle is ${lifecycle})`);
	}
	if (auditPair.proof.terminal_lifecycle !== "done") {
		throw new Error(`cannot commit child ${taskId}: terminal proof lifecycle is not done`);
	}
	if (auditPair.record.task_id !== taskId || auditPair.proof.task_id !== taskId) {
		throw new Error(`cannot commit child ${taskId}: audit task id mismatch`);
	}

	// 2. Read scope_hint and goal from the verified terminal TaskRecord.intent_snapshot (Finding 1)
	const intentSnapshot = auditPair.record.intent_snapshot;
	const goal = typeof intentSnapshot.goal === "string" ? intentSnapshot.goal : "";
	const scopeHint = Array.isArray(intentSnapshot.scope_hint)
		? intentSnapshot.scope_hint.filter((s): s is string => typeof s === "string")
		: [];

	// 3. Verify symbolic HEAD branch and HEAD lineage before commit (Review Round 7 Finding 1)
	if (expectedBranch !== undefined) {
		const currentBranchResult = spawnSync("git", ["-C", root, "symbolic-ref", "--short", "HEAD"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		const currentBranch = currentBranchResult.stdout.trim();
		if (currentBranchResult.status !== 0 || currentBranch !== expectedBranch) {
			throw new Error(
				`batch_head_lineage_broken: current branch ${currentBranch} does not match expected branch ${expectedBranch}`,
			);
		}
	}

	const currentHeadResult = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	const currentHead = currentHeadResult.stdout.trim();
	if (currentHeadResult.status !== 0 || !currentHead || currentHead !== expectedHead) {
		throw new Error(
			`batch_head_lineage_broken: current HEAD ${currentHead} does not match expected_head ${expectedHead}`,
		);
	}

	// 3b. Reject unsupported index flags before scope inspection (Finding 2)
	const flaggedCommit = getUnsupportedIndexFlags(root);
	if (flaggedCommit.length > 0) {
		throw new Error("dirty_outside_scope");
	}

	// 4. Identify changed paths and verify they are strictly within scope envelope + .imm/audit/<task-id>/** (Finding 2 & 4)
	const changedPaths = getChangedProjectPaths(root);
	const outsideScope = changedPaths.filter((p) => !isPathAllowedForChild(p, taskId, scopeHint));
	if (outsideScope.length > 0) {
		// Nothing is committed
		throw new Error("dirty_outside_scope");
	}

	// 5. Stage only paths needing an update, preserving already-staged deletions/renames (Finding 2)
	const pathsToStage = getUnstagedProjectPaths(root);
	if (pathsToStage.length > 0) {
		const addResult = spawnSync("git", ["-C", root, "--literal-pathspecs", "add", "-A", "--", ...pathsToStage], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		if (addResult.status !== 0) {
			throw new Error(`failed to stage changed paths: ${addResult.stderr?.trim() || "git add failed"}`);
		}
	}

	// 6. review round 16: git add cannot capture submodule-internal changes in
	// the parent repository; reject residual unstaged work so a child's
	// implementation is never left uncommitted while the batch reports success.
	const residualUnstaged = getUnstagedProjectPaths(root);
	if (residualUnstaged.length > 0) {
		throw new Error(
			`residual unstaged changes cannot be captured by the parent repository: ${residualUnstaged.join(", ")}`,
		);
	}

	// 5b. Verify actual staged path set before commit (Finding 4)
	const staged = getStagedProjectPaths(root);
	const stagedOutside = staged.filter((p) => !isPathAllowedForChild(p, taskId, scopeHint));
	if (stagedOutside.length > 0) {
		spawnSync("git", ["-C", root, "reset", "--quiet"], { stdio: ["ignore", "ignore", "ignore"] });
		throw new Error("dirty_outside_scope");
	}

	// 6. Commit with structured message, Immune-Brain-Batch trailer, and all hooks disabled (Finding 1)
	const goalFirstLine = goal.trim().split(/\r?\n/)[0]?.trim() || taskId;
	const commitMessage = `imm(${taskId}): ${goalFirstLine}\n\nImmune-Brain-Batch: ${batchId}\n`;

	const commitResult = spawnSync(
		"git",
		["-C", root, "-c", "core.hooksPath=/dev/null", "commit", "--no-verify", "-F", "-"],
		{
			input: commitMessage,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
			env: DEFAULT_GIT_ENV,
		},
	);
	if (commitResult.status !== 0) {
		throw new Error(`commit failed for child ${taskId}: ${commitResult.stderr?.trim() || "git commit failed"}`);
	}

	// 7. Verify new HEAD and verify single parent equals expectedHead (Finding 3)
	const newHeadResult = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	const newHead = newHeadResult.stdout.trim();
	if (newHeadResult.status !== 0 || !newHead || newHead === expectedHead) {
		throw new Error("commit_failed");
	}

	const parentsResult = spawnSync("git", ["-C", root, "rev-parse", "HEAD^@"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	const parents = parentsResult.stdout.trim().split(/\s+/).filter(Boolean);
	if (parents.length !== 1 || parents[0] !== expectedHead) {
		throw new Error(
			`batch_head_lineage_broken: commit parent ${parents.join(",")} does not match expected_head ${expectedHead}`,
		);
	}

	// 8. Post-commit verification: verify committed tree delta contains strictly authorized paths.
	// Preserves files on disk on failure without destructive rollback (Finding 1)
	const committedDelta = getCommittedDeltaPaths(root);
	const deltaOutside = committedDelta.filter((p) => !isPathAllowedForChild(p, taskId, scopeHint));
	if (deltaOutside.length > 0) {
		throw new Error("dirty_outside_scope");
	}

	// 9. Persist durable commit evidence before returning (Finding 1)
	writeBatchCommitEvidence(root, { batchId, taskId, commit: newHead, parentHead: expectedHead });

	return { commit: newHead };
}

/**
 * Look up an existing batch commit for a child to support idempotent crash recovery.
 * Requires durable batch commit evidence persisted by commitBatchChild (Finding 1).
 * Verifies current HEAD equals the commit and its single parent equals expectedHead (Finding 3).
 * Verifies terminal audit, batch author identity, and commit tree delta within scope (Finding 3).
 * Throws on git lookup error rather than treating non-zero as missing (Finding 3).
 */
export async function lookupBatchCommit(input: {
	root: string;
	taskId: string;
	batchId: string;
	expectedHead?: string;
	branch?: string;
}): Promise<{ commit: string } | null> {
	const { root, taskId, batchId, expectedHead, branch: expectedBranch } = input;
	const FORMAT = "%H%x00%(trailers:key=Immune-Brain-Batch,valueonly)%x00%an%x00%ae%x00%s";
	const subjectPrefix = `imm(${taskId}):`;
	const parseEntry = (entry: string) => {
		const parts = entry.split("\0");
		return {
			commit: parts[0]?.trim() ?? "",
			trailer: parts[1]?.trim() ?? "",
			authorName: parts[2]?.trim() ?? "",
			// review round 13: the marker must sit on the subject prefix, not
			// merely anywhere in the message body.
			subject: parts[4]?.trim() ?? "",
		};
	};

	// review round 14: resolve the recorded commit directly from durable
	// evidence so a later commit whose goal text mentions the marker can never
	// shadow it, independent of grep dialect config. The fixed-strings scan
	// below remains only as a discovery fallback for evidence-less commits.
	const evidence = readBatchCommitEvidence(root, batchId, taskId);
	type Candidate = { commit: string; trailer: string; authorName: string; subject: string };
	let candidates: Candidate[] = [];
	let evidenceBacked = false;
	if (evidence && evidence.commit) {
		const direct = spawnSync(
			"git",
			["-C", root, "log", "-n", "1", `--format=${FORMAT}`, evidence.commit, "--"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
		if (direct.status !== 0) {
			throw new Error(`failed to inspect batch commit for ${taskId}: ${direct.stderr?.trim() || "git log failed"}`);
		}
		if (direct.stdout?.trim()) {
			const parsed = parseEntry(direct.stdout);
			if (parsed.commit === evidence.commit) {
				candidates = [parsed];
				evidenceBacked = true;
			}
		}
	}
	if (!candidates.length) {
		// --fixed-strings overrides grep.patternType config (e.g.
		// grep.extendedRegexp=true); bounded scan, fully validated below.
		const result = spawnSync(
			"git",
			[
				"-C",
				root,
				"log",
				"--fixed-strings",
				`--grep=${subjectPrefix}`,
				"-n",
				"20",
				`--format=%x1e${FORMAT}`,
			],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
		if (result.status !== 0) {
			throw new Error(`failed to lookup batch commit for ${taskId}: ${result.stderr?.trim() || "git log failed"}`);
		}
		candidates = (result.stdout ?? "")
			.split("\x1e")
			.filter((entry) => entry.trim())
			.map(parseEntry);
	}

	let match: Candidate | null = null;
	for (const candidate of candidates) {
		if (!candidate.commit || candidate.trailer !== batchId) continue;
		if (!candidate.subject.startsWith(subjectPrefix)) continue;
		match = candidate;
		break;
	}
	if (!match) return null;
	const commit = match.commit;

	// Finding 1: Require durable commit evidence persisted by commitBatchChild
	// Rejects forged in-scope external commits created during interruption
	if (!evidenceBacked) {
		const evidenceForMatch = readBatchCommitEvidence(root, batchId, taskId);
		if (!evidenceForMatch || evidenceForMatch.commit !== commit) {
			throw new Error(
				`batch_head_lineage_broken: commit ${commit} lacks durable batch runner production evidence`,
			);
		}
	}

	// Verify author identity matches batch runner
	if (match.authorName && match.authorName !== DEFAULT_GIT_ENV.GIT_AUTHOR_NAME) {
		throw new Error(
			`batch_head_lineage_broken: adopted commit author ${match.authorName} does not match batch authority ${DEFAULT_GIT_ENV.GIT_AUTHOR_NAME}`,
		);
	}

	// Verify symbolic branch matches expected branch (Review Round 7 Finding 1)
	if (expectedBranch !== undefined) {
		const currentBranchResult = spawnSync("git", ["-C", root, "symbolic-ref", "--short", "HEAD"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		const currentBranch = currentBranchResult.stdout.trim();
		if (currentBranchResult.status !== 0 || currentBranch !== expectedBranch) {
			throw new Error(
				`batch_head_lineage_broken: current branch ${currentBranch} does not match expected branch ${expectedBranch}`,
			);
		}
	}

	// Finding 3: Verify terminal audit, expectedHead, single parent, and commit tree delta within authorized scope
	if (expectedHead !== undefined) {
		const currentHeadResult = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		const currentHead = currentHeadResult.stdout.trim();
		if (currentHead !== commit) {
			throw new Error(`batch_head_lineage_broken: current HEAD ${currentHead} diverged from adopted commit ${commit}`);
		}
		const parentsResult = spawnSync("git", ["-C", root, "rev-parse", `${commit}^@`], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		const parents = parentsResult.stdout.trim().split(/\s+/).filter(Boolean);
		if (parents.length !== 1 || parents[0] !== expectedHead) {
			throw new Error(
				`batch_head_lineage_broken: adopted commit parent ${parents.join(",")} does not match expected_head ${expectedHead}`,
			);
		}

		// Verify terminal audit exists and is settled done
		const auditPair = readAuditTaskPair(root, taskId);
		if (!auditPair) {
			throw new Error(`batch_head_lineage_broken: adopted commit lacks terminal audit pair for ${taskId}`);
		}
		const lifecycle = "lifecycle" in auditPair.record ? auditPair.record.lifecycle : auditPair.record.phase;
		if (lifecycle !== "done") {
			throw new Error(`batch_head_lineage_broken: adopted commit task lifecycle is not done: ${lifecycle}`);
		}

		// Verify commit tree delta is strictly within authorized scope_hint
		const scopeHint = Array.isArray(auditPair.record.intent_snapshot.scope_hint)
			? auditPair.record.intent_snapshot.scope_hint.filter((s): s is string => typeof s === "string")
			: [];
		const deltaResult = spawnSync(
			"git",
			["-C", root, "diff-tree", "--no-commit-id", "--name-only", "-z", "-r", expectedHead, commit],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
		if (deltaResult.status !== 0) {
			throw new Error("batch_head_lineage_broken: failed to inspect adopted commit delta");
		}
		const changedInCommit = deltaResult.stdout.split("\0").filter((p) => p.length > 0);
		const outside = changedInCommit.filter((p) => !isPathAllowedForChild(p, taskId, scopeHint));
		if (outside.length > 0) {
			throw new Error(
				`batch_head_lineage_broken: adopted commit contains out-of-scope changes: ${outside.join(", ")}`,
			);
		}
	}

	return { commit };
}

/** Default Git port using the real repository Git operations. */
export function createDefaultBatchGitPort(): BatchRunnerGitPort {
	return {
		preflight: runBatchGitPreflight,
		commitChild: (root, taskId, batchId, head, branch, intentPath) =>
			commitBatchChild({ root, taskId, batchId, expectedHead: head, branch, intentPath }),
		lookupBatchCommit: (root, taskId, batchId, expectedHead, branch) =>
			lookupBatchCommit({ root, taskId, batchId, expectedHead, branch }),
	};
}
