// Host-captured immutable Review revision (#565).
//
// Review reads one immutable synthetic Git revision whose only parent is the
// Enrollment base. The reviewer runs `git diff <base_head> <review_commit>`
// itself, so no evidence file or manifest is handed to it; the runtime keeps
// only the facts Git cannot show (QA outcomes, estimate escapes) for the brief.

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import type { ReviewPacketWriter } from "./host_port";
import { routineAllowlistEscapes } from "../kernel/completion";
import { readRiskFloor } from "../kernel/risk_floor";
import type { TaskIntentV1 } from "../kernel/types";
import { packetDigest } from "./review_packet";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	captureGitTaskRevisionSnapshot,
	pathMatchesScope,
	type GitTaskRevisionSnapshot,
} from "../workspace_scope";
import { currentRunId } from "../kernel/storage";
import { freshSlotDirectory } from "../session_result_slot";

export interface ReviewOutcome {
	status: "passed" | "failed" | "blocked";
	summary: string;
}

const reviewUtf8 = new TextDecoder("utf-8", { fatal: true });

// ---------------------------------------------------------------------------
// TaskRecord v4 transport: the reviewed bytes are an immutable synthetic Git
// revision, so the host envelope carries metadata only and source size, encoding,
// and binary content can never block Review.
// ---------------------------------------------------------------------------

const GIT_COMMIT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const REVIEW_TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REVISION_DIFF_HASH = /^sha256:[a-f0-9]{64}$/;
export const REVIEW_REF_NAMESPACE = "refs/immune-brain/reviews";
const SNAPSHOT_IDENTITY = {
	name: "Immune-Brain Assurance",
	email: "assurance@immune-brain.local",
	date: "1970-01-01T00:00:00 +0000",
};

/**
 * The bare synthetic-commit identity. `publishReviewRevision` can prove these
 * five fields from Git alone; it has no manifest inputs and therefore cannot
 * produce a digest.
 */
export interface ReviewRevisionCommit {
	contract: "assurance_kernel/review_revision/v1";
	base_head: string;
	review_tree: string;
	review_commit: string;
	review_ref: string;
	diff_hash: string;
}

function gitEvidenceBytes(root: string, args: string[], extraEnv: Record<string, string> = {}): Buffer {
	return execFileSync("git", args, {
		cwd: root,
		encoding: "buffer",
		stdio: ["ignore", "pipe", "pipe"],
		maxBuffer: 16 * 1024 * 1024,
		timeout: 30_000,
		env: { ...process.env, ...extraEnv },
	}) as Buffer;
}

function gitEvidence(root: string, args: string[], extraEnv: Record<string, string> = {}): string {
	return gitEvidenceBytes(root, args, extraEnv).toString("utf8").trim();
}

function decodeNullPaths(bytes: Buffer, label: string): string[] {
	if (bytes.length === 0) return [];
	if (bytes[bytes.length - 1] !== 0) throw new Error(`${label} is not NUL-terminated`);
	const paths: string[] = [];
	let start = 0;
	for (let index = 0; index < bytes.length; index += 1) {
		if (bytes[index] !== 0) continue;
		if (index === start) throw new Error(`${label} contains an empty path`);
		const raw = bytes.subarray(start, index);
		let path: string;
		try {
			path = reviewUtf8.decode(raw);
		} catch {
			throw new Error(`${label} contains invalid UTF-8 path bytes`);
		}
		if (!Buffer.from(path, "utf8").equals(raw)) throw new Error(`${label} path does not round-trip through UTF-8`);
		paths.push(path);
		start = index + 1;
	}
	return paths;
}

function reviewRefTaskSegment(taskId: string): string {
	if (!REVIEW_TASK_ID.test(taskId)) throw new Error("review task id has invalid identity");
	if (!taskId.includes("..") && !taskId.endsWith(".")) return taskId;
	return `_${Buffer.from(taskId, "utf8").toString("base64url")}`;
}

function taskIdFromReviewRefSegment(segment: string): string {
	if (!segment.startsWith("_")) {
		if (reviewRefTaskSegment(segment) !== segment) throw new Error("review ref task segment has invalid identity");
		return segment;
	}
	const taskId = Buffer.from(segment.slice(1), "base64url").toString("utf8");
	if (reviewRefTaskSegment(taskId) !== segment) throw new Error("review ref task segment has invalid identity");
	return taskId;
}

function workspaceRefSegment(root: string): string {
	return createHash("sha256").update(realpathSync(root)).digest("hex").slice(0, 16);
}

function reviewRef(root: string, taskId: string, reviewCommit: string): string {
	const taskSegment = reviewRefTaskSegment(taskId);
	if (!GIT_COMMIT_ID.test(reviewCommit)) throw new Error("review commit has invalid identity");
	const runId = currentRunId(root, taskId) ?? "none";
	if (!REVIEW_TASK_ID.test(runId) && runId !== "none") throw new Error("review run id has invalid identity");
	return `${REVIEW_REF_NAMESPACE}/${workspaceRefSegment(root)}/${runId}/${taskSegment}/${reviewCommit}`;
}

/** The scoped delta of one captured revision, as base->tree paths. */
function revisionDelta(snapshot: GitTaskRevisionSnapshot): string[] {
	return Object.keys(snapshot.changed_paths).sort(compareRevisionPaths);
}

function compareRevisionPaths(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Publish the task-scoped synthetic commit for one already-captured revision
 * snapshot. The ref name embeds the commit id, so an existing ref can only ever
 * point at that same immutable commit; a non-resolving or mismatched target
 * fails loudly and is never overwritten.
 */
export function publishReviewRevision(
	root: string,
	snapshot: GitTaskRevisionSnapshot,
	diffHash: string,
	taskId: string,
): ReviewRevisionCommit {
	if (snapshot.base_head !== snapshot.base_head.toLowerCase() || !GIT_COMMIT_ID.test(snapshot.base_head))
		throw new Error("review revision base has invalid identity");
	if (!REVISION_DIFF_HASH.test(diffHash)) throw new Error("review revision diff hash has invalid identity");
	const indexDirectory = mkdtempSync(join(tmpdir(), "imm-review-index-"));
	try {
		const indexFile = join(indexDirectory, "index");
		const env = { GIT_INDEX_FILE: indexFile };
		gitEvidence(root, ["read-tree", snapshot.base_tree], env);
		for (const [path, entry] of Object.entries(snapshot.changed_paths)) {
			if (entry.oid && entry.mode)
				gitEvidence(root, ["update-index", "--add", "--cacheinfo", `${entry.mode},${entry.oid},${path}`], env);
			else gitEvidence(root, ["update-index", "--force-remove", "--", path], env);
		}
		const reviewTree = gitEvidence(root, ["write-tree"], env);
		if (!GIT_COMMIT_ID.test(reviewTree)) throw new Error("review synthetic tree write failed");
		const message = `Immune-Brain review snapshot task=${taskId} base=${snapshot.base_head} diff=${diffHash}`;
		const reviewCommit = gitEvidence(
			root,
			["commit-tree", reviewTree, "-p", snapshot.base_head, "-m", message],
			{
				...env,
				GIT_AUTHOR_NAME: SNAPSHOT_IDENTITY.name,
				GIT_AUTHOR_EMAIL: SNAPSHOT_IDENTITY.email,
				GIT_AUTHOR_DATE: SNAPSHOT_IDENTITY.date,
				GIT_COMMITTER_NAME: SNAPSHOT_IDENTITY.name,
				GIT_COMMITTER_EMAIL: SNAPSHOT_IDENTITY.email,
				GIT_COMMITTER_DATE: SNAPSHOT_IDENTITY.date,
				GPG_PROGRAM: "",
			},
		);
		// Determinism proof: the synthetic commit's tree-to-tree delta against the
		// Enrollment base must be exactly the captured scoped delta, nothing more.
		if (!GIT_COMMIT_ID.test(reviewCommit)) throw new Error("review synthetic commit write failed");
		const ref = reviewRef(root, taskId, reviewCommit);
		const expected = revisionDelta(snapshot);
		const actual = decodeNullPaths(
			gitEvidenceBytes(root, ["diff", "--no-renames", "--name-only", "-z", snapshot.base_head, reviewCommit]),
			"review synthetic commit paths",
		).sort(compareRevisionPaths);
		if (JSON.stringify(actual) !== JSON.stringify(expected))
			throw new Error(
				`review synthetic commit delta mismatch: expected ${expected.length} paths, got ${actual.length}`,
			);
		const existing = (() => {
			try {
				return gitEvidence(root, ["rev-parse", "--verify", ref]);
			} catch {
				return null;
			}
		})();
		if (existing !== null && existing !== reviewCommit)
			throw new Error(`review ref ${ref} resolves to ${existing}, not ${reviewCommit}`);
		if (existing === null) gitEvidence(root, ["update-ref", ref, reviewCommit, ""]);
		return {
			contract: "assurance_kernel/review_revision/v1",
			base_head: snapshot.base_head,
			review_tree: reviewTree,
			review_commit: reviewCommit,
			review_ref: ref,
			diff_hash: diffHash,
		};
	} finally {
		rmSync(indexDirectory, { recursive: true, force: true });
	}
}

function publishInput(
	root: string,
	input: {
		taskId: string;
		baseHead: string;
		scopeHint: unknown;
		expectedDiffHash: string;
	},
): { snapshot: GitTaskRevisionSnapshot; revision: ReviewRevisionCommit } {
	if (typeof input.baseHead !== "string" || !GIT_COMMIT_ID.test(input.baseHead))
		throw new Error("review requires a TaskRecord v4 git_base_head");
	if (!REVISION_DIFF_HASH.test(input.expectedDiffHash))
		throw new Error("review task revision hash has invalid identity");
	const snapshot = captureGitTaskRevisionSnapshot(root, input.scopeHint, input.baseHead, input.taskId);
	const recomputed = `sha256:${createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}`;
	if (recomputed !== input.expectedDiffHash)
		throw new Error("review task revision does not match assurance snapshot");
	// A revision whose tree equals the base carries nothing to review; reserving
	// Review for it would settle QA outcomes against bytes it does not contain.
	if (Object.keys(snapshot.changed_paths).length === 0)
		throw new Error("review revision carries no task change; stage the task's in-scope work before Review");
	return { snapshot, revision: publishReviewRevision(snapshot.repository_root, snapshot, recomputed, input.taskId) };
}

/**
 * The facts a Review brief carries that Git cannot show the reviewer: which
 * delivered paths escape the TaskIntent estimate or keep a `routine`
 * declaration from standing (ADR 0038), and the settled QA outcomes. The
 * changed paths themselves are `git diff --name-status base review_commit`.
 */
export interface ReviewFacts {
	revision: ReviewRevisionCommit;
	changed_paths: string[];
	beyond_estimate: string[];
	outside_routine_allowlist: string[];
	outcomes: Record<string, ReviewOutcome>;
}

export function captureReviewFacts(
	root: string,
	input: {
		taskId: string;
		baseHead: string;
		scopeHint: unknown;
		expectedDiffHash: string;
		outcomes: Record<string, ReviewOutcome>;
		/** The task's intent, so a `routine` declaration raised by the allowlist names its paths. */
		intent?: TaskIntentV1;
	},
): ReviewFacts {
	const { snapshot, revision } = publishInput(root, input);
	const changed = Object.keys(snapshot.changed_paths).sort(compareRevisionPaths);
	return {
		revision,
		changed_paths: changed,
		beyond_estimate: changed.filter(path => !snapshot.scope.some(entry => pathMatchesScope(path, entry))),
		outside_routine_allowlist: input.intent
			? routineAllowlistEscapes(input.intent, changed, readRiskFloor(root)).sort(compareRevisionPaths)
			: [],
		outcomes: Object.fromEntries(Object.entries(input.outcomes).map(([id, outcome]) => [id, { ...outcome }])),
	};
}

export function listReviewRefs(root: string): Array<{ ref: string; commit: string; taskId: string }> {
	const output = gitEvidence(root, ["for-each-ref", "--format=%(refname) %(objectname)", `${REVIEW_REF_NAMESPACE}/${workspaceRefSegment(root)}/`]);
	const refs: Array<{ ref: string; commit: string; taskId: string }> = [];
	for (const line of output.split("\n").filter(Boolean)) {
		const [ref, commit] = line.split(" ");
		const parts = ref?.slice(REVIEW_REF_NAMESPACE.length + 1).split("/") ?? [];
		const segment = parts.length >= 4 ? parts[parts.length - 2] : parts[0] ?? "";
		let taskId: string;
		try {
			taskId = taskIdFromReviewRefSegment(segment ?? "");
		} catch {
			continue;
		}
		if (!ref || !commit || !taskId) continue;
		refs.push({ ref, commit, taskId });
	}
	return refs;
}

/**
 * Remove refs with no live TaskRecord owner. A ref is evidence transport, never
 * workflow authority, so this is idempotent and its failure is non-fatal.
 */
export function reconcileReviewRefs(
	root: string,
	liveTaskIds: Set<string>,
): { removed: string[]; failed: string[] } {
	const removed: string[] = [];
	const failed: string[] = [];
	for (const entry of listReviewRefs(root)) {
		if (liveTaskIds.has(entry.taskId)) continue;
		try {
			gitEvidence(root, ["update-ref", "-d", entry.ref, entry.commit]);
			removed.push(entry.ref);
		} catch {
			failed.push(entry.ref);
		}
	}
	return { removed, failed };
}

/**
 * Packets for a Host that dispatches findings Verification in-process. They live
 * in an ignored session slot directory inside the task root, never `$TMPDIR`.
 * The directory is created on the first packet only, so a Review round that
 * never verifies, and every CLI round (which writes its own result slot), leaves none.
 */
export function createReviewPacketWriter(root: string): ReviewPacketWriter {
	let directory: string | null = null;
	return {
		writePacket(name, content) {
			if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error("invalid review packet name");
			directory ??= freshSlotDirectory(root, `packets-${randomUUID()}`);
			const path = join(directory, `review-packet-${name}.md`);
			writeFileSync(path, content, { encoding: "utf8", mode: 0o644, flag: "wx" });
			return { path, sha256: packetDigest(content) };
		},
		remove() {
			if (directory) rmSync(directory, { recursive: true, force: true });
			directory = null;
		},
	};
}
