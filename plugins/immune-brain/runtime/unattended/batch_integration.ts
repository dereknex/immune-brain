// Lane integration for unattended batch runs: build the batch-branch candidate
// for a Lane's commit, prove its identity against that commit, and fast-forward
// the batch branch. Git plumbing only. The runtime never creates, switches or
// deletes a Git worktree, never pushes, and never opens a pull request; the
// only ref it moves is the batch branch it already owns, by fast-forward.
// Defined by docs/specs/parallel-batch-lanes.spec.md (Temporal sequence, step 2).
import { spawnSync } from "node:child_process";

export type BatchIntegrationReason = "batch_integration_conflict" | "batch_head_lineage_broken";

/** An integration failure that leaves the batch branch unmoved. */
export class BatchIntegrationError extends Error {
	constructor(
		readonly reason: BatchIntegrationReason,
		message: string,
	) {
		super(message);
		this.name = "BatchIntegrationError";
	}
}

const COMMITTER_ENV = {
	GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "Immune-Brain Batch",
	GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "immune-brain@local",
};

interface GitResult {
	status: number | null;
	stdout: string;
	stderr: string;
}

function git(root: string, args: string[], extra: { input?: string; env?: Record<string, string> } = {}): GitResult {
	const result = spawnSync("git", ["-C", root, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
		input: extra.input,
		env: { ...process.env, ...COMMITTER_ENV, ...(extra.env ?? {}) },
	});
	return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function gitOut(root: string, args: string[], what: string): string {
	const result = git(root, args);
	if (result.status !== 0) throw new Error(`${what}: ${result.stderr.trim() || "git failed"}`);
	return result.stdout;
}

/**
 * The per-path result of the change from `from` to `to`: the new mode and blob
 * of every path the change touches (a deletion is mode 000000 with a null
 * blob). Two changes with equal identities leave the same bytes and modes.
 */
export function changeIdentity(root: string, from: string, to: string): Map<string, string> {
	const raw = gitOut(
		root,
		["diff-tree", "-r", "-z", "--raw", "--no-renames", "--no-ext-diff", "--no-commit-id", from, to],
		`failed to inspect change ${from}..${to}`,
	);
	const tokens = raw.split("\0");
	const identity = new Map<string, string>();
	for (let index = 0; index < tokens.length; index += 1) {
		const meta = tokens[index]!;
		if (!meta.startsWith(":")) continue;
		const [, newMode, , newSha] = meta.slice(1).split(" ");
		const path = tokens[index + 1];
		if (path === undefined || !newMode || !newSha) throw new Error(`unreadable change record for ${from}..${to}`);
		identity.set(path, `${newMode} ${newSha}`);
		index += 1;
	}
	return identity;
}

/** Whether two changes touch exactly the same paths with the same blob and mode. */
export function identitiesEqual(left: Map<string, string>, right: Map<string, string>): boolean {
	if (left.size !== right.size) return false;
	for (const [path, value] of left) if (right.get(path) !== value) return false;
	return true;
}

function singleParent(root: string, commit: string): string {
	const parents = gitOut(root, ["rev-parse", `${commit}^@`], `failed to read parents of ${commit}`)
		.split(/\s+/)
		.filter(Boolean);
	if (parents.length !== 1)
		throw new BatchIntegrationError(
			"batch_head_lineage_broken",
			`batch_head_lineage_broken: lane commit ${commit} has ${parents.length} parents, expected exactly one`,
		);
	return parents[0]!;
}

function isAncestor(root: string, ancestor: string, descendant: string): boolean {
	return git(root, ["merge-base", "--is-ancestor", ancestor, descendant]).status === 0;
}

/**
 * The batch-branch candidate for a lane commit. When the batch head is still
 * the lane base the lane commit itself is the candidate. Otherwise the lane's
 * change is replayed onto the batch head with a tree-level merge that moves no
 * ref and no working tree; a content conflict is an integration conflict.
 */
export function buildCandidate(input: { root: string; batch_head: string; lane_base: string; lane_commit: string }): string {
	const { root, batch_head: head, lane_base: base, lane_commit: laneCommit } = input;
	if (head === base) return laneCommit;
	const merged = git(root, ["merge-tree", "--write-tree", `--merge-base=${base}`, head, laneCommit]);
	if (merged.status === 1)
		throw new BatchIntegrationError(
			"batch_integration_conflict",
			`batch_integration_conflict: lane commit ${laneCommit} does not apply cleanly onto batch head ${head}`,
		);
	if (merged.status !== 0)
		throw new Error(`failed to build integration candidate: ${merged.stderr.trim() || "git merge-tree failed"}`);
	const tree = merged.stdout.split("\n")[0]?.trim();
	if (!tree) throw new Error("failed to build integration candidate: no tree produced");
	const message = gitOut(root, ["log", "-n", "1", "--format=%B", laneCommit], "failed to read lane commit message");
	const author = gitOut(root, ["log", "-n", "1", "--format=%an%x00%ae%x00%aI", laneCommit], "failed to read lane commit author")
		.trim()
		.split("\0");
	const created = git(root, ["commit-tree", tree, "-p", head, "-F", "-"], {
		input: message,
		env: {
			GIT_AUTHOR_NAME: author[0] ?? COMMITTER_ENV.GIT_COMMITTER_NAME,
			GIT_AUTHOR_EMAIL: author[1] ?? COMMITTER_ENV.GIT_COMMITTER_EMAIL,
			...(author[2] ? { GIT_AUTHOR_DATE: author[2] } : {}),
		},
	});
	const candidate = created.stdout.trim();
	if (created.status !== 0 || !candidate)
		throw new Error(`failed to build integration candidate: ${created.stderr.trim() || "git commit-tree failed"}`);
	return candidate;
}

export interface IntegrateLaneInput {
	/** Coordinator worktree root, checked out on the batch branch. */
	root: string;
	branch: string;
	/** The batch head the integration expects to sit on. */
	batch_head: string;
	lane_base: string;
	lane_commit: string;
}

/**
 * Fast-forward the batch branch to the lane commit's candidate. Accepted only
 * when the candidate's changed path set and per-path blob and mode equal the
 * lane commit's; on any refusal the batch branch is unmoved.
 */
export function integrateLaneCommit(input: IntegrateLaneInput): { commit: string } {
	const { root, branch, batch_head: head, lane_base: base, lane_commit: laneCommit } = input;
	const currentBranch = git(root, ["symbolic-ref", "--short", "HEAD"]);
	if (currentBranch.status !== 0 || currentBranch.stdout.trim() !== branch)
		throw new BatchIntegrationError(
			"batch_head_lineage_broken",
			`batch_head_lineage_broken: current branch ${currentBranch.stdout.trim()} does not match expected branch ${branch}`,
		);
	const currentHead = git(root, ["rev-parse", "HEAD"]).stdout.trim();
	if (currentHead !== head)
		throw new BatchIntegrationError(
			"batch_head_lineage_broken",
			`batch_head_lineage_broken: current HEAD ${currentHead} does not match expected batch head ${head}`,
		);
	if (singleParent(root, laneCommit) !== base)
		throw new BatchIntegrationError(
			"batch_head_lineage_broken",
			`batch_head_lineage_broken: lane commit ${laneCommit} does not descend from lane base ${base}`,
		);
	if (!isAncestor(root, base, head))
		throw new BatchIntegrationError(
			"batch_head_lineage_broken",
			`batch_head_lineage_broken: lane base ${base} is not an ancestor of batch head ${head}`,
		);

	const candidate = buildCandidate({ root, batch_head: head, lane_base: base, lane_commit: laneCommit });
	if (!identitiesEqual(changeIdentity(root, base, laneCommit), changeIdentity(root, head, candidate)))
		throw new BatchIntegrationError(
			"batch_integration_conflict",
			`batch_integration_conflict: candidate ${candidate} does not carry the lane commit ${laneCommit} change`,
		);

	const moved = git(root, ["merge", "--ff-only", "--quiet", candidate]);
	if (moved.status !== 0)
		throw new BatchIntegrationError(
			"batch_integration_conflict",
			`batch_integration_conflict: batch branch could not fast-forward to ${candidate}: ${moved.stderr.trim() || "git merge failed"}`,
		);
	const landed = git(root, ["rev-parse", "HEAD"]).stdout.trim();
	if (landed !== candidate) throw new Error(`batch branch landed on ${landed}, expected ${candidate}`);
	return { commit: candidate };
}

/**
 * Find a candidate this batch already fast-forwarded onto the batch branch for
 * a lane commit, so an interruption between the fast-forward and the state
 * write is adopted rather than replayed. A commit qualifies only with the
 * child's subject, the batch trailer, and a change identical to the lane's.
 */
export function findIntegratedCandidate(input: {
	root: string;
	task_id: string;
	batch_id: string;
	from_head: string;
	lane_base: string;
	lane_commit: string;
}): string | null {
	const { root, task_id: taskId, batch_id: batchId, from_head: from, lane_base: base, lane_commit: laneCommit } = input;
	const listed = git(root, [
		"log",
		"--fixed-strings",
		`--grep=imm(${taskId}):`,
		"--format=%H%x00%(trailers:key=Immune-Brain-Batch,valueonly)%x00%s",
		`${from}..HEAD`,
	]);
	if (listed.status !== 0) throw new Error(`failed to search for integrated ${taskId}: ${listed.stderr.trim()}`);
	const lane = changeIdentity(root, base, laneCommit);
	for (const line of listed.stdout.split("\n")) {
		const [commit, trailer, subject] = line.split("\0");
		if (!commit || trailer?.trim() !== batchId || !subject?.startsWith(`imm(${taskId}):`)) continue;
		const parent = git(root, ["rev-parse", `${commit}^`]).stdout.trim();
		if (parent && identitiesEqual(lane, changeIdentity(root, parent, commit))) return commit;
	}
	return null;
}
