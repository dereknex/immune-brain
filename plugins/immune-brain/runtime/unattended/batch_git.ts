// Git branch preflight and per-child scope-bounded commit for unattended batch runs.
// Defined by docs/specs/unattended-initiative-batch-run.spec.md section 3.5.
// Invariant: The runtime never creates, switches, or deletes a Git worktree,
// never pushes a ref, and never opens or updates a pull request.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	constants,
	closeSync,
	existsSync,
	lstatSync,
	mkdirSync,
	openSync,
	realpathSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { auditEvidencePaths, auditRunRecordPath, auditRunTerminalProofPath } from "../kernel/storage_paths";
import { readSettledTaskEvidence, readAuditTaskPair, readSecureProjectFile } from "../kernel/storage";
import { serializeTaskTombstone, readTaskTombstone, type TaskTombstone } from "../kernel/backend_claim";
import { captureGitTaskRevisionSnapshot, pathMatchesScope, scopedContentIdentity, taskCommitRevisionIdentity, usesBranchDelivery } from "../workspace_scope";
import { readNativeParentFinalReport, writeNativeParentFinalReport, readAnyBatchRunState, isLaneBatchRecord, writeBatchRunState, writeBatchLaneRunState, type AnyBatchRunStateRecord } from "./batch_state";
import { laneCandidateMatches } from "./batch_integration";
import { runFinalVerification } from "./batch_final_verification";
import { withParentWorktree } from "./batch_worktrees";
import type { InitiativeObservationReader } from "./types";
import { readTaskIntent, observeEnrollmentTaskIntent } from "../kernel/intent";
import { classifyBatchLineage, expectedBatchHead, readActiveClaimTaskId as findActiveClaimForCriticalIntegration, findExistingActiveBatch, findSettledBatchRecord } from "./batch_preflight";
import { batchRefName, buildScopedCommit, liveBatchHead, changedPaths as changedPathsBetween, createBatchRef, ignoredPaths, isProgressRef, moveBatchRef, pathsDirtyAgainst, readBatchRef, parentBranchRef, isParentBranch } from "./batch_ref";
export { classifyBatchLineage, type BatchLineage } from "./batch_preflight";

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
	retainLaneEvidence?: typeof retainIntegratedLaneEvidence;
	preflight(input: {
		root: string;
		initiative_slug: string;
		base_head: string;
		batch_id: string;
		blocking_scopes?: readonly string[];
		progress_mode?: "parent_branch";
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
 * Preflight before any child is enrolled (D9, D10): no commit, no checkout, no
 * index write. It rejects only when a dirty path lies inside the scope of a
 * child that has not settled (`blocking_scopes`), and otherwise creates the
 * batch's hidden ref at base_head. Every other dirty path is the user's own.
 * Verifies root is the top-level repository root. A rejection leaves HEAD, the
 * checked-out branch, the index and every ref exactly as they were.
 */
export function runBatchGitPreflight(input: {
	root: string;
	initiative_slug: string;
	base_head: string;
	batch_id: string;
	blocking_scopes?: readonly string[];
	progress_mode?: "parent_branch";
}): BatchGitPreflightResult {
	const { root, base_head: baseHead } = input;
	const scopes = input.progress_mode === "parent_branch" ? [] : input.blocking_scopes ?? [];
	const git = (args: string[]) => spawnSync("git", ["-C", root, ...args], {
		encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
	});

	// 0. Verify root is a Git repository and is the top-level repository root
	const toplevelResult = git(["rev-parse", "--show-toplevel"]);
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

	// 1. Committed base: the hidden ref starts here.
	const headResult = git(["rev-parse", "--verify", "HEAD^{commit}"]);
	if (headResult.status !== 0 || !headResult.stdout.trim()) {
		return {
			ok: false,
			reason: "uncommitted_head",
			message: "HEAD is uncommitted or not a valid commit",
		};
	}
	const baseResult = git(["rev-parse", "--verify", `${baseHead}^{commit}`]);
	if (baseResult.status !== 0 || baseResult.stdout.trim() !== baseHead) {
		return { ok: false, reason: "uncommitted_head", message: `base_head ${baseHead} is not a commit` };
	}

	// 2. One dirt rule: dirty paths inside an unsettled child's scope block.
	const inScope = (path: string) => !isWorkflowAuthoringPath(path) && scopes.some((scope) => pathMatchesScope(path, scope));
	const flagged = getUnsupportedIndexFlags(root).filter((entry) => inScope(entry.path));
	if (flagged.length > 0) {
		return {
			ok: false,
			reason: "dirty_working_tree",
			message: `unsupported index flags (assume-unchanged/skip-worktree) detected: ${scopeRefusal("unsupported_index_flags", flagged).message}`,
		};
	}
	const statusResult = git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--ignore-submodules=none"]);
	if (statusResult.status !== 0) {
		return {
			ok: false,
			reason: "dirty_working_tree",
			message: statusResult.stderr?.trim() || "failed to inspect working tree status",
		};
	}
	const blocking = statusResult.stdout
		.split("\0")
		.filter((entry) => entry.length > 0)
		.map((entry) => entry.slice(3))
		.filter(inScope);
	if (blocking.length > 0) {
		return {
			ok: false,
			reason: "dirty_working_tree",
			message: `working tree has uncommitted changes inside the scope of a child that has not settled: ${[...new Set(blocking)].sort().join(", ")}`,
		};
	}

	// 3. The batch's own hidden ref; the user's branch is never created or switched.
	const ref = input.progress_mode === "parent_branch" ? parentBranchRef(input.initiative_slug) : batchRefName(input.batch_id);
	try {
		createBatchRef(root, ref, baseHead);
	} catch (error) {
		return {
			ok: false,
			reason: input.progress_mode === "parent_branch" ? "batch_parent_branch_exists" : "batch_branch_exists",
			message: error instanceof Error ? error.message : String(error),
		};
	}
	return { ok: true, branch: ref };
}

/**
 * Runtime state and the plan/spec documents the user authored for the batch are its inputs,
 * not competing work: an uncommitted TaskIntent never blocks the batch that executes it.
 */
export function isWorkflowAuthoringPath(path: string): boolean {
	return path.startsWith(".imm/") || path.startsWith("docs/plans/") || path.startsWith("docs/specs/");
}

function hasBoundaryWhitespace(path: string): boolean {
	return path.split("/").some((segment) => segment.trim() !== segment || segment.length === 0);
}

function scopeRefusal(cause: string, entries: Array<{ path: string; flags?: string[] }>): Error {
	const included: typeof entries = [];
	for (const entry of entries.slice(0, 24)) {
		const candidate = { cause, entries: [...included, entry], omitted: entries.length - included.length - 1 };
		if (Buffer.byteLength(`dirty_outside_scope: ${JSON.stringify(candidate)}`) > 4096) break;
		included.push(entry);
	}
	return new Error(`dirty_outside_scope: ${JSON.stringify({ cause, entries: included, omitted: entries.length - included.length })}`);
}

function getUnsupportedIndexFlags(root: string): Array<{ path: string; flags: string[] }> {
	const result = spawnSync("git", ["-C", root, "ls-files", "-v", "-z", "--"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.status !== 0) {
		throw new Error("failed to inspect index flags via git ls-files -v");
	}
	const entries = result.stdout.split("\0").filter((e) => e.length > 0);
	const flagged: Array<{ path: string; flags: string[] }> = [];
	for (const entry of entries) {
		const tag = entry[0];
		// Reject h (assume-unchanged), S (skip-worktree), and s (both flags combined) (Finding 1)
		if (tag === "h" || tag === "S" || tag === "s") {
			flagged.push({ path: entry.slice(2), flags: [
				...(tag === "h" || tag === "s" ? ["assume-unchanged"] : []),
				...(tag === "S" || tag === "s" ? ["skip-worktree"] : []),
			] });
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
	evidence: { batchId: string; taskId: string; commit: string; parentHead: string; previousHead?: string },
): void {
	const path = commitEvidencePath(evidence.batchId, evidence.taskId);
	const payload = {
		contract: "assurance_kernel/batch_commit_evidence/v1",
		batch_id: evidence.batchId,
		task_id: evidence.taskId,
		commit: evidence.commit,
		parent_head: evidence.parentHead,
		...(evidence.previousHead ? { previous_head: evidence.previousHead } : {}),
		created_at: new Date().toISOString(),
	};
	writeFileAtomically(root, path, `${JSON.stringify(payload, null, 2)}\n`);
}

function readBatchCommitEvidence(
	root: string,
	batchId: string,
	taskId: string,
): { commit: string; parent_head: string; previous_head?: string } | null {
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
			previous_head?: unknown;
		};
		if (
			parsed.contract === "assurance_kernel/batch_commit_evidence/v1" &&
			parsed.batch_id === batchId &&
			parsed.task_id === taskId &&
			typeof parsed.commit === "string" &&
			typeof parsed.parent_head === "string" &&
			(parsed.previous_head === undefined || (typeof parsed.previous_head === "string" && /^[a-f0-9]{40}$/.test(parsed.previous_head)))
		) {
			return { commit: parsed.commit, parent_head: parsed.parent_head,
				...(typeof parsed.previous_head === "string" ? { previous_head: parsed.previous_head } : {}) };
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
/** Structural proof equality: every field, in every order. */
function proofEquals(a: TaskTombstone, b: TaskTombstone): boolean {
	return serializeTaskTombstone(a) === serializeTaskTombstone(b);
}

function requireMatchingSettledAudit(
	auditPair: NonNullable<ReturnType<typeof readAuditTaskPair>>,
	settled: NonNullable<ReturnType<typeof readSettledTaskEvidence>>,
): void {
	// Legacy evidence has no local Run; its audit pair is its authority.
	if (settled.runId === null) return;
	if (auditPair.recordRevision !== settled.recordRevision || !proofEquals(auditPair.proof, settled.proof)) {
		throw new Error("batch commit exported audit pair does not match the settled run");
	}
}

/** The delivery about to be committed must still be the one QA attested. */
function assertReviewedDelivery(root: string, authoritative: unknown, scopeHint: string[], taskId: string): void {
	const record = authoritative as {
		contract?: string;
		git_base_head?: string;
		attestations?: Array<{ kind: string; diff_hash: string }>;
	};
	const qa = [...(record.attestations ?? [])].reverse().find((item) => item.kind === "qa");
	if (record.contract === "assurance_kernel/task_record/v4" && qa?.diff_hash) {
		if (!record.git_base_head) throw new Error("batch commit requires a TaskRecord v4 git_base_head");
		const captured = captureGitTaskRevisionSnapshot(root, scopeHint, record.git_base_head, taskId);
		const digest = `sha256:${createHash("sha256").update(JSON.stringify(captured)).digest("hex")}`;
		if (digest !== qa.diff_hash)
			throw new Error("batch commit drifted from the reviewed delivery identity");
	}
}

export async function commitBatchChild(input: {
	root: string;
	taskId: string;
	batchId: string | null;
	expectedHead: string;
	branch?: string;
	intentPath?: string;
}): Promise<{ commit: string }> {
	const { root, taskId, batchId, expectedHead, branch: expectedBranch } = input;

	// 1. Verify the Authority Store reports that child done through its settled
	// Run read (Finding 2). The committed local run owns this task's evidence:
	// another worktree's run directory for the same task is not this batch's
	// audit pair. Settlement clears the active run, so the read includes
	// terminal runs, and the exported pair is what the commit stages.
	const settled = readSettledTaskEvidence(root, taskId);
	if (!settled) {
		throw new Error(`cannot commit child ${taskId}: task is not settled done (no settled run)`);
	}
	// The export is what the commit stages: a terminal run must have reached it.
	const auditPair = readAuditTaskPair(root, taskId, settled.runId ?? undefined);
	if (!auditPair) {
		throw new Error(`cannot commit child ${taskId}: task is not settled done (audit pair missing)`);
	}
	requireMatchingSettledAudit(auditPair, settled);
	const settledLifecycle =
		"lifecycle" in settled.record ? settled.record.lifecycle : (settled.record as { phase: string }).phase;
	if (settledLifecycle !== "done") {
		throw new Error(`cannot commit child ${taskId}: task is not settled done (lifecycle is ${settledLifecycle})`);
	}
	if (settled.proof.terminal_lifecycle !== "done") {
		throw new Error(`cannot commit child ${taskId}: terminal proof lifecycle is not done`);
	}
	if (settled.record.task_id !== taskId || settled.proof.task_id !== taskId) {
		throw new Error(`cannot commit child ${taskId}: audit task id mismatch`);
	}
	// An ignored audit pair would be left out of the commit without error and the
	// delivery refused at integration; refuse it here, before any Git write.
	const auditPaths = settled.runId === null ? auditEvidencePaths(root, taskId) :
		{ record: auditRunRecordPath(taskId, settled.runId), proof: auditRunTerminalProofPath(taskId, settled.runId) };
	const ignoredAudit = ignoredPaths(root, [auditPaths.record, auditPaths.proof]);
	if (ignoredAudit.length > 0) {
		throw new Error(`audit_evidence_ignored: cannot commit child ${taskId}: .gitignore ignores ${ignoredAudit.join(", ")}`);
	}

	// 2. Read scope_hint and goal from the verified terminal TaskRecord.intent_snapshot (Finding 1)
	// The store-validated record decides scope and attestation once the run is
	// known; the export decides them only in the pre-store legacy layout.
	const authoritative = settled.runId === null ? auditPair.record : settled.record;
	const intentSnapshot = authoritative.intent_snapshot;
	const goal = typeof intentSnapshot.goal === "string" ? intentSnapshot.goal : "";
	const scopeHint = Array.isArray(intentSnapshot.scope_hint)
		? intentSnapshot.scope_hint.filter((s): s is string => typeof s === "string")
		: [];

	if (usesBranchDelivery(root, taskId)) {
		const currentBranch = spawnSync("git", ["-C", root, "symbolic-ref", "--short", "HEAD"], { encoding: "utf8" });
		if (expectedBranch !== undefined && currentBranch.stdout.trim() !== expectedBranch)
			throw new Error("batch_head_lineage_broken: Lane branch changed before commit");
		const head = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
		if (spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", expectedHead, head]).status !== 0)
			throw new Error("batch_head_lineage_broken: Lane base is not an ancestor of HEAD");
		const flagged = getUnsupportedIndexFlags(root);
		if (flagged.length) throw scopeRefusal("unsupported_index_flags", flagged);
		assertReviewedDelivery(root, authoritative, scopeHint, taskId);
		const captured = captureGitTaskRevisionSnapshot(root, scopeHint, expectedHead, taskId);
		const deliveryHash = `sha256:${createHash("sha256").update(JSON.stringify(captured)).digest("hex")}`;
		const paths = [...Object.keys(captured.changed_paths), auditPaths.record, auditPaths.proof];
		const message = `imm(${taskId}): ${goal.trim().split(/\r?\n/)[0]?.trim() || taskId}\n\n${batchId === null ? `Immune-Brain-Task: ${taskId}` : `Immune-Brain-Batch: ${batchId}`}\n`;
		const commit = buildScopedCommit(root, { parent: expectedHead, paths, message });
		if (taskCommitRevisionIdentity(root, scopeHint, expectedHead, commit).diff_hash !== deliveryHash)
			throw new Error("batch commit drifted from the reviewed delivery identity");
		writeBatchCommitEvidence(root, { batchId: batchId ?? "native-task", taskId, commit, parentHead: expectedHead, previousHead: head });
		const moved = spawnSync("git", ["-C", root, "update-ref", "HEAD", commit, head], { encoding: "utf8" });
		if (moved.status !== 0) throw new Error(`batch_head_lineage_broken: ${moved.stderr.trim()}`);
		const indexed = spawnSync("git", ["-C", root, "read-tree", commit], { encoding: "utf8" });
		if (indexed.status !== 0) throw new Error(`failed to index Lane delivery: ${indexed.stderr.trim()}`);
		return { commit };
	}

	if (isProgressRef(expectedBranch)) {
		const tip = readBatchRef(root, expectedBranch);
		if (tip !== expectedHead)
			throw new Error(`batch_head_lineage_broken: ${expectedBranch} is at ${tip ?? "nothing"}, expected ${expectedHead}`);
		// What this child delivers: the in-scope paths that differ from the batch head.
		// Dirt outside the scope is the user's own and is neither committed nor refused.
		const delivered = pathsDirtyAgainst(root, expectedHead).filter((path) => isPathAllowedForChild(path, taskId, scopeHint));
		if (delivered.length === 0) throw new Error(`commit failed for child ${taskId}: nothing to commit`);
		assertReviewedDelivery(root, authoritative, scopeHint, taskId);
		const goalFirstLine = goal.trim().split(/\r?\n/)[0]?.trim() || taskId;
		const message = `imm(${taskId}): ${goalFirstLine}\n\n${batchId === null ? `Immune-Brain-Task: ${taskId}` : `Immune-Brain-Batch: ${batchId}`}\n`;
		const commit = buildScopedCommit(root, { parent: expectedHead, paths: delivered, message });
		const outsideDelta = changedPathsBetween(root, expectedHead, commit).filter((path) => !isPathAllowedForChild(path, taskId, scopeHint));
		if (outsideDelta.length > 0) throw scopeRefusal("committed_paths", outsideDelta.map((path) => ({ path })));
		// Evidence first: a crash between the evidence and the ref move is adopted by lookup.
		writeBatchCommitEvidence(root, { batchId: batchId ?? "native-task", taskId, commit, parentHead: expectedHead });
		moveBatchRef(root, expectedBranch, expectedHead, commit);
		return { commit };
	}

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
		throw scopeRefusal("unsupported_index_flags", flaggedCommit);
	}

	// 4. Identify changed paths and verify they are strictly within scope envelope + .imm/audit/<task-id>/** (Finding 2 & 4)
	const changedPaths = getChangedProjectPaths(root);
	const outsideScope = changedPaths.filter((p) => !isPathAllowedForChild(p, taskId, scopeHint));
	if (outsideScope.length > 0) {
		// Nothing is committed
		throw scopeRefusal("changed_paths", outsideScope.map(path => ({ path })));
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
		throw scopeRefusal("staged_paths", stagedOutside.map(path => ({ path })));
	}
	assertReviewedDelivery(root, authoritative, scopeHint, taskId);

	// 6. Commit with structured message, Immune-Brain-Batch trailer, and all hooks disabled (Finding 1)
	const goalFirstLine = goal.trim().split(/\r?\n/)[0]?.trim() || taskId;
	const commitMessage = `imm(${taskId}): ${goalFirstLine}\n\n${batchId === null ? `Immune-Brain-Task: ${taskId}` : `Immune-Brain-Batch: ${batchId}`}\n`;

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
		throw scopeRefusal("committed_paths", deltaOutside.map(path => ({ path })));
	}

	// 9. Persist durable commit evidence before returning (Finding 1)
	writeBatchCommitEvidence(root, { batchId: batchId ?? "native-task", taskId, commit: newHead, parentHead: expectedHead });

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
	batchId: string | null;
	expectedHead?: string;
	branch?: string;
	lane?: { path: string; base_head: string; lane_commit: string; integrated_commit: string };
}): Promise<{ commit: string } | null> {
	const { root, taskId, batchId, expectedHead, branch: expectedBranch } = input;
	const FORMAT = `%H%x00%(trailers:key=${batchId === null ? "Immune-Brain-Task" : "Immune-Brain-Batch"},valueonly)%x00%an%x00%ae%x00%s`;
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
	const retained = readBatchCommitEvidence(root, batchId ?? "native-task", taskId);
	const evidence = retained ?? (input.lane ? readBatchCommitEvidence(input.lane.path, batchId ?? "native-task", taskId) : null);
	if (input.lane && retained && retained.commit !== input.lane.integrated_commit)
		throw new Error("batch_head_lineage_broken: integrated candidate differs from retained delivery");
	if (input.lane && !retained) {
		const lane = input.lane;
		if (!evidence || evidence.commit !== lane.lane_commit || evidence.parent_head !== lane.base_head)
			throw new Error("batch_head_lineage_broken: Lane delivery lacks matching production evidence");
		const common = (path: string) => {
			const result = spawnSync("git", ["-C", path, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" });
			if (result.status !== 0) throw new Error("batch_head_lineage_broken: unreadable Lane repository");
			return realpathSync(result.stdout.trim());
		};
		const sourceParent = spawnSync("git", ["-C", root, "rev-parse", `${lane.lane_commit}^@`], { encoding: "utf8" });
		const candidateParent = spawnSync("git", ["-C", root, "rev-parse", `${lane.integrated_commit}^@`], { encoding: "utf8" });
		const parents = candidateParent.stdout.trim().split(/\s+/).filter(Boolean);
		if (common(lane.path) !== common(root) || sourceParent.status !== 0 || sourceParent.stdout.trim() !== lane.base_head ||
			candidateParent.status !== 0 || parents.length !== 1 ||
			!laneCandidateMatches({ root, lane_base: lane.base_head, lane_commit: lane.lane_commit, batch_head: parents[0]!, candidate: lane.integrated_commit,
				declaration_head: input.batchId ? readAnyBatchRunState(root, input.batchId)?.base_head ?? lane.base_head : lane.base_head }))
			throw new Error("batch_head_lineage_broken: integrated candidate differs from produced Lane delivery");
	}
	const recordedCommit = input.lane?.integrated_commit ?? evidence?.commit;
	type Candidate = { commit: string; trailer: string; authorName: string; subject: string };
	let candidates: Candidate[] = [];
	let evidenceBacked = false;
	if (evidence && recordedCommit) {
		const direct = spawnSync(
			"git",
			["-C", root, "log", "-n", "1", `--format=${FORMAT}`, recordedCommit, "--"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
		if (direct.status !== 0) {
			throw new Error(`failed to inspect batch commit for ${taskId}: ${direct.stderr?.trim() || "git log failed"}`);
		}
		if (direct.stdout?.trim()) {
			const parsed = parseEntry(direct.stdout);
			if (parsed.commit === recordedCommit) {
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
				...(isProgressRef(expectedBranch) ? [expectedBranch] : []),
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
		if (!candidate.commit || candidate.trailer !== (batchId ?? taskId)) continue;
		if (!candidate.subject.startsWith(subjectPrefix)) continue;
		match = candidate;
		break;
	}
	if (!match) return null;
	const commit = match.commit;

	// Finding 1: Require durable commit evidence persisted by commitBatchChild
	// Rejects forged in-scope external commits created during interruption
	if (!evidenceBacked) {
		const evidenceForMatch = readBatchCommitEvidence(root, batchId ?? "native-task", taskId);
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
	if (expectedBranch !== undefined && !isProgressRef(expectedBranch)) {
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

	// Evidence identity is required even when the caller omits lineage checks.
	const adopted = readSettledTaskEvidence(root, taskId);
	const auditPair = adopted ? readAuditTaskPair(root, taskId, adopted.runId ?? undefined) : null;
	if (!adopted || !auditPair) {
		throw new Error(`batch_head_lineage_broken: adopted commit lacks terminal audit pair for ${taskId}`);
	}
	requireMatchingSettledAudit(auditPair, adopted);
	const auditPaths = adopted.runId === null ? auditEvidencePaths(root, taskId) :
		{ record: auditRunRecordPath(taskId, adopted.runId), proof: auditRunTerminalProofPath(taskId, adopted.runId) };
	for (const path of [auditPaths.record, auditPaths.proof]) {
		const committed = spawnSync("git", ["-C", root, "show", `${commit}:${path}`], { encoding: "utf8" });
		if (committed.status !== 0 || committed.stdout !== readSecureProjectFile(root, path))
			throw new Error(`batch_head_lineage_broken: committed terminal evidence differs for ${taskId}`);
	}
	const authoritative = adopted.runId !== null ? adopted.record : auditPair.record;
	const lifecycle =
		"lifecycle" in authoritative ? authoritative.lifecycle : (authoritative as { phase: string }).phase;
	if (lifecycle !== "done") {
		throw new Error(`batch_head_lineage_broken: adopted commit task lifecycle is not done: ${lifecycle}`);
	}

	// Every adopted delivery must be in the current history, even without a predecessor assertion.
	const parentsResult = spawnSync("git", ["-C", root, "rev-parse", `${commit}^@`], { encoding: "utf8" });
	const parents = parentsResult.stdout.trim().split(/\s+/).filter(Boolean);
	let pendingLaneHead: string | null = null;
	let indexLaneDelivery = false;
	if (isProgressRef(expectedBranch)) {
		// The hidden ref is the batch's history. A commit built but not yet reached by
		// the ref (evidence written, ref not moved) is completed here.
		const tip = readBatchRef(root, expectedBranch);
		const reachable = tip !== null && (tip === commit ||
			spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", commit, tip], { stdio: "ignore" }).status === 0);
		if (!reachable) {
			if (tip !== null && parents.length === 1 && parents[0] === tip) moveBatchRef(root, expectedBranch, tip, commit);
			else throw new Error(`batch_head_lineage_broken: ${expectedBranch} at ${tip ?? "nothing"} diverged from adopted commit ${commit}`);
		}
	} else {
		const currentHeadResult = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
		const currentHead = currentHeadResult.stdout.trim();
		if (currentHeadResult.status !== 0)
			throw new Error("batch_head_lineage_broken: unreadable Lane HEAD");
		indexLaneDelivery = usesBranchDelivery(root, taskId) && evidence?.previous_head !== undefined;
		if (currentHead !== commit && spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", commit, currentHead], { stdio: "ignore" }).status !== 0) {
			if (indexLaneDelivery && evidence?.previous_head === currentHead) pendingLaneHead = currentHead;
			else throw new Error(`batch_head_lineage_broken: current HEAD ${currentHead} diverged from adopted commit ${commit}`);
		}
		indexLaneDelivery &&= pendingLaneHead !== null || currentHead === commit;
	}
	if (parentsResult.status !== 0 || parents.length !== 1 || (retained && parents[0] !== retained.parent_head) ||
		(expectedHead !== undefined && parents[0] !== expectedHead))
		throw new Error(`batch_head_lineage_broken: adopted commit parent ${parents.join(",")} does not match expected_head ${expectedHead ?? "single-parent delivery"}`);
	const scopeHint = Array.isArray(authoritative.intent_snapshot.scope_hint)
		? authoritative.intent_snapshot.scope_hint.filter((s): s is string => typeof s === "string") : [];
	const deltaResult = spawnSync("git", ["-C", root, "diff-tree", "--no-commit-id", "--name-only", "-z", "-r", parents[0]!, commit],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	if (deltaResult.status !== 0) throw new Error("batch_head_lineage_broken: failed to inspect adopted commit delta");
	const outside = deltaResult.stdout.split("\0").filter(p => p.length > 0 && !isPathAllowedForChild(p, taskId,
		usesBranchDelivery(root, taskId) || input.lane ? ["**"] : scopeHint));
	if (outside.length > 0)
		throw new Error(`batch_head_lineage_broken: adopted commit contains out-of-scope changes: ${outside.join(", ")}`);

	if (indexLaneDelivery) {
		// Revalidate both the produced commit and live delivery before finishing an interrupted ref/index write.
		assertReviewedDelivery(root, authoritative, scopeHint, taskId);
		const qa = "attestations" in authoritative ? [...authoritative.attestations].reverse().find(item => item.kind === "qa") : undefined;
		if (qa && taskCommitRevisionIdentity(root, scopeHint, parents[0]!, commit).diff_hash !== qa.diff_hash)
			throw new Error("batch commit drifted from the reviewed delivery identity");
		if (pendingLaneHead !== null) {
			const moved = spawnSync("git", ["-C", root, "update-ref", "HEAD", commit, pendingLaneHead], { encoding: "utf8" });
			if (moved.status !== 0) throw new Error(`batch_head_lineage_broken: ${moved.stderr.trim()}`);
		}
		const indexed = spawnSync("git", ["-C", root, "read-tree", commit], { encoding: "utf8" });
		if (indexed.status !== 0) throw new Error(`failed to index Lane delivery: ${indexed.stderr.trim()}`);
	}

	return { commit };
}

/** Retain verified production evidence before the Lane can be released. */
export async function retainIntegratedLaneEvidence(input: Parameters<typeof lookupBatchCommit>[0] & {
	lane: { path: string; base_head: string; lane_commit: string; integrated_commit: string };
}): Promise<void> {
	if (isParentBranch(input.branch)) {
		const lane = input.lane;
		const source = await lookupBatchCommit({ root: lane.path, taskId: input.taskId, batchId: input.batchId,
			branch: spawnSync("git", ["-C", lane.path, "symbolic-ref", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim(),
			expectedHead: lane.base_head });
		const parent = spawnSync("git", ["-C", input.root, "rev-parse", `${lane.integrated_commit}^@`], { encoding: "utf8" });
		const parents = parent.stdout.trim().split(/\s+/).filter(Boolean);
		const tip = readBatchRef(input.root, input.branch);
		if (source?.commit !== lane.lane_commit || parent.status !== 0 || parents.length !== 1 || !tip ||
			spawnSync("git", ["-C", input.root, "merge-base", "--is-ancestor", lane.integrated_commit, tip]).status !== 0 ||
			!laneCandidateMatches({ root: input.root, lane_base: lane.base_head, lane_commit: lane.lane_commit, batch_head: parents[0]!, candidate: lane.integrated_commit,
				declaration_head: input.batchId ? readAnyBatchRunState(input.root, input.batchId)?.base_head ?? lane.base_head : lane.base_head }))
			throw new Error("batch_head_lineage_broken: Parent candidate differs from produced Lane delivery");
		writeBatchCommitEvidence(input.root, { batchId: input.batchId ?? "native-task", taskId: input.taskId,
			commit: lane.integrated_commit, parentHead: parents[0]! });
		return;
	}
	const landed = await lookupBatchCommit(input);
	if (!landed) throw new Error("batch_head_lineage_broken: missing integrated Lane delivery");
	const parent = spawnSync("git", ["-C", input.root, "rev-parse", `${landed.commit}^`], { encoding: "utf8" });
	if (parent.status !== 0) throw new Error("batch_head_lineage_broken: unreadable integrated parent");
	writeBatchCommitEvidence(input.root, { batchId: input.batchId ?? "native-task", taskId: input.taskId,
		commit: landed.commit, parentHead: parent.stdout.trim() });
}

export interface ParentCompletionObservation {
	complete: boolean;
	/** Delivered Tasks: settled `done` with an unchanged TaskIntent, wherever their bytes live. */
	integrated_task_ids: string[];
	missing_task_ids: string[];
	final_passed: boolean;
	head: string;
	reason: string | null;
}

/** New-mode evidence lives on the Parent revision; legacy evidence stays in its original checkout. */
export async function withBatchEvidence<T>(root: string, branch: string | undefined, head: string, read: (path: string) => T | Promise<T>): Promise<T> {
	return isParentBranch(branch) ? withParentWorktree(root, head, async path => read(path)) : read(root);
}

/** Settled `done` with an unchanged TaskIntent is delivered. */
function isDelivered(root: string, taskId: string): boolean {
	const settled = readSettledTaskEvidence(root, taskId);
	if (!settled || settled.proof.terminal_lifecycle !== "done") return false;
	return readTaskIntent(root, taskId, settled.record.intent_ref.path).content_hash === settled.record.intent_ref.content_hash;
}

/** The union of the delivered Tasks' settled scopes, which final verification binds by content. */
export function deliveryScopes(root: string, taskIds: readonly string[]): string[] {
	const scopes = new Set<string>();
	for (const taskId of taskIds) {
		const settled = readSettledTaskEvidence(root, taskId);
		if (!settled) throw new Error(`delivery scope requires settled evidence for ${taskId}`);
		for (const path of settled.record.intent_snapshot.scope_hint as string[]) scopes.add(path);
	}
	return [...scopes].sort();
}

/** Remote closure and batch `completed` are observations; neither proves delivery. */
export async function observeParentCompletion(root: string, initiativeSlug: string,
	requiredTaskIds: readonly string[]): Promise<ParentCompletionObservation> {
	if (!requiredTaskIds.length || new Set(requiredTaskIds).size !== requiredTaskIds.length)
		throw new Error("Parent completion requires a non-empty, unique required Task list");
	const headResult = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
	if (headResult.status !== 0) throw new Error("Parent completion requires a Git HEAD");
	const head = headResult.stdout.trim();
	const directory = join(root, ".imm", "state", "batches");
	const records: AnyBatchRunStateRecord[] = [];
	if (existsSync(directory)) for (const file of readdirSync(directory).sort()) {
		if (!file.endsWith(".json")) continue;
		const candidate = JSON.parse(readSecureProjectFile(root, `.imm/state/batches/${file}`));
		if (!["assurance_kernel/batch_run_state/v1", "assurance_kernel/batch_run_state/v2"].includes(candidate?.contract)
			|| candidate.initiative_slug !== initiativeSlug) continue;
		const record = readAnyBatchRunState(root, file.slice(0, -5));
		if (!record) throw new Error("Parent batch record disappeared during observation");
		records.push(record);
	}
	const native = readNativeParentFinalReport(root, initiativeSlug);
	const allTaskIds = [...new Set([...requiredTaskIds, ...records.flatMap(record => record.repair_tasks?.map(task => task.task_id) ?? []),
		...(native?.repair_tasks?.map(task => task.task_id) ?? [])])];
	const parent = records.filter(record => isParentBranch(record.branch)).sort((a, b) => a.updated_at.localeCompare(b.updated_at)).at(-1);
	const deliveryHead = parent ? readBatchRef(root, parent.branch!) : head;
	if (!deliveryHead) throw new Error("Parent evidence requires an existing Parent ref");
	return withBatchEvidence(root, parent?.branch, deliveryHead, evidenceRoot => {
		const delivered = allTaskIds.filter(taskId => isDelivered(evidenceRoot, taskId));
		const missing = allTaskIds.filter(taskId => !delivered.includes(taskId));
		let content: string | undefined;
		// Parent reports bind their tip; legacy content reports bind only scoped bytes.
		const holds = (final: { head: string | null; content_identity?: string }) => parent || final.content_identity === undefined
			? final.head === deliveryHead : missing.length === 0 && final.content_identity === (content ??= scopedContentIdentity(evidenceRoot, deliveryScopes(evidenceRoot, allTaskIds)));
		const finalPassed = (!parent && native?.final_verification.passed === true && holds(native.final_verification) &&
			JSON.stringify([...native.task_ids].sort()) === JSON.stringify([...requiredTaskIds].sort())) || records.some(record => {
			const final = record.final_verification_result;
			if (parent && (record.branch !== parent.branch || expectedBatchHead(record) !== deliveryHead)) return false;
			return record.batch_state === "completed" && final?.passed === true && holds(final);
		});
		return { complete: missing.length === 0 && finalPassed, integrated_task_ids: delivered,
			missing_task_ids: missing, final_passed: finalPassed, head: deliveryHead,
			reason: missing.length ? `Required delivery is absent: ${missing.join(", ")}`
				: finalPassed ? null : "Final verification has not passed on the delivered content" };
	});
}

/**
 * A Parent whose every Task is already settled needs only final observations,
 * never an empty grant. A critical Task is an ordinary batch child (run-entry
 * decision hosting D5), so an unsettled one keeps the Parent on the batch path.
 */
export async function observeNativeParent(root: string, initiativeSlug: string, readInitiative?: InitiativeObservationReader, blockedNativeTasks: readonly string[] = []) {
	if (findExistingActiveBatch(root, initiativeSlug)) return null;
	const settled = findSettledBatchRecord(root, initiativeSlug);
	// Retirement preserves history but no longer owns the Parent's remaining delivery.
	if (settled && settled.batch_state !== "superseded") return null;
	const parent = await (readInitiative ?? (await import("./batch_plan")).observeInitiative)(root, initiativeSlug);
	// An empty Parent is not a native Parent; the batch path reports its own empty-set refusal.
	if (parent.tasks.length === 0) return null;
	const intents = parent.tasks.map(task => ({ task, intent: readTaskTombstone(root, task.task_id)
		? readTaskIntent(root, task.task_id) : observeEnrollmentTaskIntent(root, task.task_id) }));
	if (parent.tasks.some(task => !readSettledTaskEvidence(root, task.task_id))) return null;
	const native = readNativeParentFinalReport(root, initiativeSlug);
	const proof = await observeParentCompletion(root, initiativeSlug, parent.tasks.map(task => task.task_id));
	const planDigest = `sha256:${createHash("sha256").update(JSON.stringify(intents.map(({ task, intent }) =>
		({ task_id: task.task_id, blocked_by: task.blocked_by, intent: intent.content_hash })))).digest("hex")}`;
	const activeTask = findActiveClaimForCriticalIntegration(root);
	// Settled deliveries need no runtime commit, so there is no integrate action (content-delivery-authority D2).
	const action = activeTask ? "drive" : proof.complete ? "complete" : "enroll";
	const ready = parent.tasks.find(task => !blockedNativeTasks.includes(task.task_id) && !readSettledTaskEvidence(root, task.task_id) &&
		task.blocked_by.every(id => proof.integrated_task_ids.includes(id)));
	const originalDelivered = parent.tasks.every(task => proof.integrated_task_ids.includes(task.task_id));
	const taskId = activeTask ?? ready?.task_id ?? null;
	if (activeTask && !parent.tasks.some(task => task.task_id === activeTask) && !native?.repair_tasks?.some(task => task.task_id === activeTask))
		throw new Error("Parent entry has another task's active Kernel owner");
	return { state: "native_parent" as const, initiative_slug: initiativeSlug, plan_digest: planDigest, batch_id: null,
		action: action === "enroll" && originalDelivered ? native?.final_verification.passed === false ? "repair" : "verify" : action,
		task_id: taskId, proof, parent, native, next_action: action === "drive" ? `Drive active task ${taskId} from Kernel status` :
			ready ? `Invoke native single-task Enrollment for ${ready.task_id}; no ordinary BatchAuthorization is needed` :
			originalDelivered ? "Run recorded Parent final verification; diagnose failure and prepare a stable original-goal repair candidate before its fresh native Enrollment" :
			blockedNativeTasks.length ? `Native gates parked for ${blockedNativeTasks.join(", ")}; resolve their same-Host recovery and enter imm-run explicitly` :
			"No dependency-ready required task remains; report concrete blocked predecessors" };
}

/** What a native Parent run is about to do; the Host renders it in its own native confirmation. */
export interface NativeParentEffects {
	initiative_slug: string;
	plan_digest: string;
	children: Array<{ task_id: string; slice_id: string }>;
	final_commands: string[];
}

export type NativeParentRefusal = { state: "rejected" | "cancelled" | "blocked"; reason: string; recovery_action: string };

/** Resolves null once the literal user accepted exactly these effects, otherwise the Host's refusal envelope. */
export type NativeParentGate = (effects: NativeParentEffects) => Promise<NativeParentRefusal | null>;

export async function advanceNativeParent(root: string, initiativeSlug: string, commands?: string[], readInitiative?: InitiativeObservationReader,
	tracker?: import("./batch_runner").BatchTrackerPort, gate?: NativeParentGate) {
	let facts = await observeNativeParent(root, initiativeSlug, readInitiative);
	if (!facts) return null;
	const recordedCommands = facts.native?.final_verification.results.map(result => result.command);
	if (commands && recordedCommands && JSON.stringify(commands) !== JSON.stringify(recordedCommands))
		throw new Error("Parent final commands changed; start a fresh explicit Parent entry");
	const finalCommands = recordedCommands ?? commands;
	if (["verify", "repair"].includes(facts.action) && facts.proof.missing_task_ids.length === 0 && finalCommands?.length) {
		// New commands need confirmation; recorded commands authorize their replay.
		if (!recordedCommands) {
			const refused: NativeParentRefusal | null = gate ? await gate({ initiative_slug: initiativeSlug, plan_digest: facts.plan_digest,
				children: facts.parent.tasks.map(task => ({ task_id: task.task_id, slice_id: task.slice_id })), final_commands: finalCommands }) :
				{ state: "rejected", reason: "Parent final verification requires native confirmation before execution",
					recovery_action: "retry through a fresh native gate in the current Host" };
			if (refused) return refused;
		}
		const taskIds = [...facts.parent.tasks.map(task => task.task_id), ...(facts.native?.repair_tasks?.map(task => task.task_id) ?? [])];
		const final = await runFinalVerification(root, finalCommands, { scopes: deliveryScopes(root, taskIds) });
		writeNativeParentFinalReport(root, { contract: "assurance_kernel/parent_final_report/v1", initiative_slug: initiativeSlug,
			task_ids: facts.parent.tasks.map(task => task.task_id), final_verification: final, repair_tasks: facts.native?.repair_tasks });
		facts = await observeNativeParent(root, initiativeSlug, readInitiative);
		if (!facts) throw new Error("Parent plan changed during final verification");
	}
	if (facts.action === "complete" && tracker) {
		const last = facts.parent.tasks.at(-1)!;
		const terminal = readTaskTombstone(root, last.task_id);
		if (terminal?.terminal_lifecycle === "done") {
			try {
				const sync = await tracker.markTerminal(root, { task_id: last.task_id, phase: "done", terminal_event_id: terminal.terminal_event_id });
				if (sync.status === "failed") facts.next_action = "Local Parent completed; retry tracker synchronization on this Host";
			} catch { facts.next_action = "Local Parent completed; retry tracker synchronization on this Host"; }
		} else facts.next_action = "Local Parent completed; recover exact terminal evidence before tracker synchronization";
	}
	const { parent, native, ...observation } = facts;
	return { ...observation, final_verification: native?.final_verification,
		final_verification_commands: native?.final_verification.results.map(result => result.command) ?? commands };
}

/** Called only after observing a successful native Enrollment in a bound Parent. */
export async function recordParentRepair(root: string, batchId: string | null, taskId: string, initiativeSlug?: string): Promise<void> {
	const batch = batchId === null ? null : readAnyBatchRunState(root, batchId);
	const native = batchId === null && initiativeSlug ? readNativeParentFinalReport(root, initiativeSlug) : null;
	const container = batch ?? native;
	if (!container || (batch ? batch.final_verification_result?.passed : native?.final_verification.passed) !== false) return;
	if (batch) {
		const parent = await (await import("./batch_plan")).observeInitiative(root, batch.initiative_slug);
		if (parent.tasks.some(child => child.task_id === taskId)) return;
	} else if (native!.task_ids.includes(taskId)) return;
	const status = await (await import("../assurance/coordinator")).projectTaskStatus(root, taskId);
	if (status.error || status.claim?.task_id !== taskId || status.projection.lifecycle !== "active" || !status.projection.run_id)
		throw new Error("repair native Enrollment has no exact active run identity");
	if (container.repair_tasks?.some(task => task.task_id === taskId && task.run_id === status.projection.run_id)) return;
	if (container.repair_tasks?.some(task => task.task_id === taskId)) throw new Error("Parent repair task was replaced by another run");
	container.repair_tasks = [...(container.repair_tasks ?? []), { task_id: taskId, run_id: status.projection.run_id }];
	if (batch) { if (isLaneBatchRecord(batch)) writeBatchLaneRunState(root, batch); else writeBatchRunState(root, batch); }
	else writeNativeParentFinalReport(root, native!);
}

/** Native critical tasks retain their own authority and consume no batch child slot. */
/** Whether `commit` already carries the task's exact settled audit pair. */
function settledDeliveryInTree(root: string, commit: string, taskId: string,
	settled: NonNullable<ReturnType<typeof readSettledTaskEvidence>>): boolean {
	const paths = settled.runId === null ? auditEvidencePaths(root, taskId) :
		{ record: auditRunRecordPath(taskId, settled.runId), proof: auditRunTerminalProofPath(taskId, settled.runId) };
	return [paths.record, paths.proof].every((path) => {
		const committed = spawnSync("git", ["-C", root, "show", `${commit}:${path}`], { encoding: "utf8" });
		try {
			return committed.status === 0 && committed.stdout === readSecureProjectFile(root, path);
		} catch {
			return false;
		}
	});
}

export async function integrateSettledCriticalSlices(root: string, initiativeSlug: string,
	readInitiative?: InitiativeObservationReader): Promise<void> {
	let record = findExistingActiveBatch(root, initiativeSlug);
	if (record?.corrupt) return; // The existing preflight renders the structured refusal; no integration occurs.
	let batch = record && !record.corrupt ? record.record : findSettledBatchRecord(root, initiativeSlug);
	if (!batch || !["running", "completed"].includes(batch.batch_state)) return;
	batch = readAnyBatchRunState(root, batch.batch_id);
	if (!batch) throw new Error("Parent batch disappeared before critical integration");
	if (findActiveClaimForCriticalIntegration(root)) return;
	const parent = await (readInitiative ?? (await import("./batch_plan")).observeInitiative)(root, initiativeSlug);
	const persist = () => { batch = isLaneBatchRecord(batch!) ? writeBatchLaneRunState(root, batch!) : writeBatchRunState(root, batch!); };
	for (const child of [...parent.tasks, ...(batch.repair_tasks ?? []).map(task => ({ task_id: task.task_id }))]) {
		if (batch.children.some(candidate => candidate.task_id === child.task_id)) continue;
		const repair = batch.repair_tasks?.find(task => task.task_id === child.task_id);
		const nativeBatchId = `${batch.batch_id}.${repair ? "repair" : "critical"}`;
		const settled = readSettledTaskEvidence(root, child.task_id);
		if (!settled || settled.proof.terminal_lifecycle !== "done" || (!repair && settled.record.intent_snapshot.risk !== "critical")) continue;
		// Settled before this batch: its delivery is already in the batch base, so it is not this batch's to integrate.
		if (!repair && settledDeliveryInTree(root, batch.base_head, child.task_id, settled)) continue;
		if (repair && settled.runId !== repair.run_id) throw new Error("repair settlement belongs to a different enrolled run");
		const intent = readTaskIntent(root, child.task_id, settled.record.intent_ref.path);
		if (intent.content_hash !== settled.record.intent_ref.content_hash) throw new Error("critical settled Intent changed before integration");
		const existing = await lookupBatchCommit({ root, taskId: child.task_id, batchId: nativeBatchId, branch: batch.branch });
		if (existing) {
			const live = liveBatchHead(root, batch.branch);
			if (!live) throw new Error("cannot verify recovered critical integration HEAD");
			if (live === existing.commit && expectedBatchHead(batch) !== existing.commit) {
				const predecessor = spawnSync("git", ["-C", root, "rev-parse", `${existing.commit}^`], { encoding: "utf8" });
				if (predecessor.status !== 0 || predecessor.stdout.trim() !== expectedBatchHead(batch))
					throw new Error("recovered critical integration does not extend the exact Parent HEAD");
				batch = { ...batch, adopted_heads: [...(batch.adopted_heads ?? []), { from: expectedBatchHead(batch), to: existing.commit }] };
				delete batch.final_verification_result; persist();
			}
			continue;
		}
		const head = liveBatchHead(root, batch.branch);
		if (!head) throw new Error("cannot read native integration HEAD");
		if (head !== expectedBatchHead(batch)) {
			const lineage = classifyBatchLineage({ root, branch: batch.branch ?? "", expectedHead: expectedBatchHead(batch),
				childCommits: batch.commits, batchId: batch.batch_id });
			if (lineage.kind === "broken") throw new Error(lineage.message);
			if (lineage.kind === "fast_forward") {
				batch = { ...batch, adopted_heads: [...(batch.adopted_heads ?? []), { from: expectedBatchHead(batch), to: lineage.head }] };
				delete batch.final_verification_result; persist();
			}
		}
		const from = head;
		const { commit } = await commitBatchChild({ root, taskId: child.task_id, batchId: nativeBatchId, expectedHead: from, branch: batch.branch });
		batch = { ...batch, adopted_heads: [...(batch.adopted_heads ?? []), { from, to: commit }] };
		delete batch.final_verification_result;
		persist();
	}
	if (batch.batch_state === "completed" && batch.final_verification?.length && !batch.final_verification_result) {
		const proof = await observeParentCompletion(root, parent.initiative_id, parent.tasks.map(child => child.task_id));
		if (!proof.missing_task_ids.length) {
			batch.final_verification_result = await runFinalVerification(root, batch.final_verification, { declaration_head: batch.base_head });
			persist();
		}
	}
}

export function createDefaultBatchGitPort(): BatchRunnerGitPort {
	return {
		retainLaneEvidence: retainIntegratedLaneEvidence,
		preflight: runBatchGitPreflight,
		commitChild: (root, taskId, batchId, head, branch, intentPath) =>
			commitBatchChild({ root, taskId, batchId, expectedHead: head, branch, intentPath }),
		lookupBatchCommit: (root, taskId, batchId, expectedHead, branch) =>
			lookupBatchCommit({ root, taskId, batchId, expectedHead, branch }),
	};
}
