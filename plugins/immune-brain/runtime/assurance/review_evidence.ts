// Host-captured immutable review evidence.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdtempSync,
	rmSync,
	writeFileSync,
	statSync,
	readFileSync,
	realpathSync,
	chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	captureGitTaskSnapshot,
	captureGitTaskRevisionSnapshot,
	pathMatchesScope,
	taskDiffHash,
	type GitTaskIndexEntry,
	type GitTaskRevisionSnapshot,
} from "../workspace_scope";

const MAX_REVIEW_BUNDLE_BYTES = 2 * 1024 * 1024;

export interface ReviewOutcome {
	status: "passed" | "failed" | "blocked";
	summary: string;
}

export interface ReviewNeighborhoodFile {
	mode: "100644" | "100755" | "120000";
	oid: string;
	base_mode: "100644" | "100755" | "120000";
	base_oid: string;
	fingerprint: string;
	current_content: string;
}

export interface ReviewBundle {
	contract: "assurance_kernel/review_bundle/v4";
	root: string;
	head: string;
	scope: string[];
	diff_hash: string;
	dirty_files: Record<string, GitTaskIndexEntry & {
		fingerprint: string;
		current_content: string | null;
	}>;
	/** Present on newly captured bundles; optional only for legacy in-memory test fixtures. */
	neighborhood_files?: Record<string, ReviewNeighborhoodFile>;
	/** Explicit provenance for every bundled path. */
	path_provenance?: Record<string, "diff" | "neighborhood">;
	outcomes: Record<string, ReviewOutcome>;
	bundle_digest: string;
}

function bundleDigest(bundle: Omit<ReviewBundle, "bundle_digest">): string {
	return `sha256:${createHash("sha256").update(JSON.stringify(bundle)).digest("hex")}`;
}

const reviewUtf8 = new TextDecoder("utf-8", { fatal: true });

function readIndexBlob(
	root: string,
	path: string,
	entry: Pick<GitTaskIndexEntry, "oid">,
): string | null {
	if (!entry.oid) return null;
	const type = execFileSync("git", ["cat-file", "-t", entry.oid], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
		maxBuffer: 16,
		timeout: 10_000,
	}).trim();
	if (type !== "blob") throw new Error(`index object is not a blob for ${path}`);
	const sizeText = execFileSync("git", ["cat-file", "-s", entry.oid], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
		maxBuffer: 64,
		timeout: 10_000,
	}).trim();
	const size = Number(sizeText);
	if (!Number.isSafeInteger(size) || size < 0 || size > MAX_REVIEW_BUNDLE_BYTES)
		throw new Error(`review file exceeds bounded size: ${path}`);
	const bytes = execFileSync("git", ["cat-file", "blob", entry.oid], {
		cwd: root,
		encoding: "buffer",
		stdio: ["ignore", "pipe", "ignore"],
		maxBuffer: MAX_REVIEW_BUNDLE_BYTES + 1,
		timeout: 10_000,
	}) as Buffer;
	if (bytes.length !== size) throw new Error(`index blob size changed during capture: ${path}`);
	let content: string;
	try {
		content = reviewUtf8.decode(bytes);
	} catch {
		throw new Error(`review file is not valid UTF-8: ${path}`);
	}
	if (!Buffer.from(content, "utf8").equals(bytes))
		throw new Error(`review file does not round-trip through UTF-8: ${path}`);
	return content;
}

const GIT_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const REVIEW_MODES = new Set(["100644", "100755", "120000"] as const);

function nullRecords(bytes: Buffer): Buffer[] {
	if (bytes.length === 0) return [];
	if (bytes[bytes.length - 1] !== 0) throw new Error("git index listing is not NUL-terminated");
	const records: Buffer[] = [];
	let start = 0;
	for (let index = 0; index < bytes.length; index += 1) {
		if (bytes[index] !== 0) continue;
		if (index === start) throw new Error("git index listing contains an empty record");
		records.push(bytes.subarray(start, index));
		start = index + 1;
	}
	return records;
}

function scopedNeighborhoodFiles(
	root: string,
	scope: string[],
	dirtyPaths: Set<string>,
): Record<string, ReviewNeighborhoodFile> {
	const listing = execFileSync("git", ["ls-files", "--stage", "-z"], {
		cwd: root,
		encoding: "buffer",
		stdio: ["ignore", "pipe", "ignore"],
		maxBuffer: 32 * 1024 * 1024,
		timeout: 10_000,
	}) as Buffer;
	const entries: Array<[string, ReviewNeighborhoodFile]> = [];
	for (const record of nullRecords(listing)) {
		const tab = record.indexOf(9);
		if (tab < 0) throw new Error("git index entry is malformed");
		const [mode, oid, stage] = record.subarray(0, tab).toString("ascii").split(" ");
		let path: string;
		try {
			path = reviewUtf8.decode(record.subarray(tab + 1));
		} catch {
			throw new Error("git index path is not valid UTF-8");
		}
		if (!Buffer.from(path, "utf8").equals(record.subarray(tab + 1)))
			throw new Error("git index path does not round-trip through UTF-8");
		if (!scope.some((scopePath) => pathMatchesScope(path, scopePath)) || dirtyPaths.has(path)) continue;
		if (!REVIEW_MODES.has(mode as "100644" | "100755" | "120000"))
			throw new Error(`review neighborhood file has unsupported mode: ${path}`);
		if (!GIT_OBJECT_ID.test(oid ?? "") || /^0+$/.test(oid ?? "") || stage !== "0")
			throw new Error(`review neighborhood file has invalid index identity: ${path}`);
		const content = readIndexBlob(root, path, { oid });
		if (content === null) throw new Error(`review neighborhood file is missing index content: ${path}`);
		entries.push([path, {
			mode: mode as ReviewNeighborhoodFile["mode"],
			oid,
			base_mode: mode as ReviewNeighborhoodFile["base_mode"],
			base_oid: oid,
			fingerprint: `index:${mode}:${oid}`,
			current_content: content,
		}]);
	}
	entries.sort(([left], [right]) => left.localeCompare(right));
	return Object.fromEntries(entries);
}

export function captureReviewBundle(
	root: string,
	scopeHint: unknown,
	expectedDiffHash: string,
	outcomes: Record<string, ReviewOutcome>,
): ReviewBundle {
	const before = captureGitTaskSnapshot(root, scopeHint);
	if (taskDiffHash(root, before.scope) !== expectedDiffHash)
		throw new Error("review task snapshot does not match assurance snapshot");
	const dirtyFiles = Object.fromEntries(
		Object.entries(before.staged_files).map(([path, entry]) => [path, {
			...entry,
			fingerprint: `index:${entry.mode ?? "missing"}:${entry.oid ?? "missing"}`,
			current_content: readIndexBlob(before.repository_root, path, entry),
		}]),
	);
	const neighborhoodFiles = scopedNeighborhoodFiles(
		before.repository_root,
		before.scope,
		new Set(Object.keys(dirtyFiles)),
	);
	const pathProvenance = Object.fromEntries([
		...Object.keys(dirtyFiles).map((path) => [path, "diff"] as const),
		...Object.keys(neighborhoodFiles).map((path) => [path, "neighborhood"] as const),
	].sort(([left], [right]) => left.localeCompare(right)));
	const after = captureGitTaskSnapshot(root, before.scope);
	if (
		JSON.stringify(after) !== JSON.stringify(before) ||
		taskDiffHash(root, before.scope) !== expectedDiffHash
	) {
		throw new Error("task snapshot changed while capturing immutable review bundle");
	}
	const unsigned = {
		contract: "assurance_kernel/review_bundle/v4" as const,
		root: before.repository_root,
		head: before.head,
		scope: before.scope,
		diff_hash: expectedDiffHash,
		dirty_files: dirtyFiles,
		neighborhood_files: neighborhoodFiles,
		path_provenance: pathProvenance,
		// Defensive copies so later caller mutation cannot alter the frozen record.
		outcomes: Object.fromEntries(
			Object.entries(outcomes).map(([id, outcome]) => [id, { ...outcome }]),
		),
	};
	if (Buffer.byteLength(JSON.stringify(unsigned)) > MAX_REVIEW_BUNDLE_BYTES) {
		throw new Error("immutable review bundle exceeds bounded output limit");
	}
	return { ...unsigned, bundle_digest: bundleDigest(unsigned) };
}

export function verifyReviewBundle(bundle: ReviewBundle): void {
	const { bundle_digest, ...unsigned } = bundle;
	if (bundle_digest !== bundleDigest(unsigned)) throw new Error("immutable review bundle digest mismatch");
}

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

export interface ReviewRevision {
	contract: "assurance_kernel/review_revision/v1";
	base_head: string;
	review_tree: string;
	review_commit: string;
	review_ref: string;
	diff_hash: string;
	manifest_digest?: string;
}

export interface ReviewManifestV5 {
	contract: "assurance_kernel/review_manifest/v5";
	task_id: string;
	intent_revision: number;
	intent_content_hash: string;
	scope: string[];
	base_head: string;
	review_tree: string;
	review_commit: string;
	review_ref: string;
	changed_paths: Record<string, GitTaskIndexEntry>;
	diff_hash: string;
	outcomes: Record<string, ReviewOutcome>;
	record_revision: string;
	workspace_revision: string;
	lifecycle: string;
	artifact_state: string;
	risk: string;
	manifest_digest: string;
}

function manifestDigest(manifest: Omit<ReviewManifestV5, "manifest_digest">): string {
	return `sha256:${createHash("sha256").update(JSON.stringify(manifest)).digest("hex")}`;
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

function reviewRef(taskId: string, reviewCommit: string): string {
	const taskSegment = reviewRefTaskSegment(taskId);
	if (!GIT_COMMIT_ID.test(reviewCommit)) throw new Error("review commit has invalid identity");
	return `${REVIEW_REF_NAMESPACE}/${taskSegment}/${reviewCommit}`;
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
): ReviewRevision {
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
		const ref = reviewRef(taskId, reviewCommit);
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
): { snapshot: GitTaskRevisionSnapshot; revision: ReviewRevision } {
	if (typeof input.baseHead !== "string" || !GIT_COMMIT_ID.test(input.baseHead))
		throw new Error("review requires a TaskRecord v4 git_base_head");
	if (!REVISION_DIFF_HASH.test(input.expectedDiffHash))
		throw new Error("review task revision hash has invalid identity");
	const snapshot = captureGitTaskRevisionSnapshot(root, input.scopeHint, input.baseHead);
	const recomputed = `sha256:${createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}`;
	if (recomputed !== input.expectedDiffHash)
		throw new Error("review task revision does not match assurance snapshot");
	return { snapshot, revision: publishReviewRevision(snapshot.repository_root, snapshot, recomputed, input.taskId) };
}

export function captureReviewManifest(
	root: string,
	input: {
		taskId: string;
		baseHead: string;
		scopeHint: unknown;
		expectedDiffHash: string;
		intentRevision: number;
		intentContentHash: string;
		recordRevision: string;
		workspaceRevision: string;
		lifecycle: string;
		artifactState: string;
		risk: string;
		outcomes: Record<string, ReviewOutcome>;
	},
): ReviewManifestV5 {
	const { snapshot, revision } = publishInput(root, input);
	const unsigned = {
		contract: "assurance_kernel/review_manifest/v5" as const,
		task_id: input.taskId,
		intent_revision: input.intentRevision,
		intent_content_hash: input.intentContentHash,
		scope: snapshot.scope,
		base_head: revision.base_head,
		review_tree: revision.review_tree,
		review_commit: revision.review_commit,
		review_ref: revision.review_ref,
		changed_paths: snapshot.changed_paths,
		diff_hash: revision.diff_hash,
		outcomes: Object.fromEntries(
			Object.entries(input.outcomes).map(([id, outcome]) => [id, { ...outcome }]),
		),
		record_revision: input.recordRevision,
		workspace_revision: input.workspaceRevision,
		lifecycle: input.lifecycle,
		artifact_state: input.artifactState,
		risk: input.risk,
	};
	const manifest = { ...unsigned, manifest_digest: manifestDigest(unsigned) };
	if (Buffer.byteLength(JSON.stringify(manifest)) > MAX_REVIEW_BUNDLE_BYTES)
		throw new Error("immutable review manifest metadata exceeds bounded output limit");
	return manifest;
}

/** Publish and return the exact revision a v4 task must use. */
export function ensureReviewRevision(
	root: string,
	input: { taskId: string; baseHead: string; scopeHint: unknown; expectedDiffHash: string },
): ReviewRevision {
	return publishInput(root, input).revision;
}

export function listReviewRefs(root: string): Array<{ ref: string; commit: string; taskId: string }> {
	const output = gitEvidence(root, ["for-each-ref", "--format=%(refname) %(objectname)", `${REVIEW_REF_NAMESPACE}/`]);
	const refs: Array<{ ref: string; commit: string; taskId: string }> = [];
	for (const line of output.split("\n").filter(Boolean)) {
		const [ref, commit] = line.split(" ");
		const segment = ref?.slice(REVIEW_REF_NAMESPACE.length + 1).split("/")[0] ?? "";
		let taskId: string;
		try {
			taskId = taskIdFromReviewRefSegment(segment);
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

export function deleteReviewRef(root: string, revision: ReviewRevision): void {
	const parts = revision.review_ref.split("/");
	let validRef = false;
	if (
		parts.length === 5 &&
		parts[0] === "refs" &&
		parts[1] === "immune-brain" &&
		parts[2] === "reviews" &&
		parts[4] === revision.review_commit
	) {
		try {
			taskIdFromReviewRefSegment(parts[3] ?? "");
			validRef = true;
		} catch {
			validRef = false;
		}
	}
	if (!validRef || !GIT_COMMIT_ID.test(revision.review_commit))
		throw new Error("review ref has invalid identity");
	gitEvidence(root, ["update-ref", "-d", revision.review_ref, revision.review_commit]);
}

export function writeNativeReviewEvidence(payload: unknown): { path: string; remove(): void } {
	const rawDirectory = mkdtempSync(join(tmpdir(), "imm-canary-native-review-"));
	try {
		const directory = realpathSync(rawDirectory);
		chmodSync(directory, 0o755);
		const path = join(directory, "evidence.json");
		writeFileSync(path, JSON.stringify(payload), { encoding: "utf8", mode: 0o644, flag: "wx" });
		// Fail-closed artifact check: the immutable evidence must be readable
		// before a reserved review is dispatched.
		assertReviewArtifact(path);
		return {
			path,
			remove: () => rmSync(directory, { recursive: true, force: true }),
		};
	} catch (error) {
		rmSync(rawDirectory, { recursive: true, force: true });
		throw error;
	}
}

/**
 * Fail-closed artifact check: the immutable evidence file must exist and be
 * readable before a reserved review is dispatched. Missing or unreadable
 * artifacts throw so dispatch writes zero authority and exposes an explicit
 * re-reserve path.
 */
export function assertReviewArtifact(path: string): void {
	const targetPath = realpathSync(path);
	let stat;
	try {
		stat = statSync(targetPath);
	} catch {
		throw new Error(`review evidence artifact is missing or empty: ${path}`);
	}
	if (!stat.isFile() || stat.size === 0) throw new Error(`review evidence artifact is missing or empty: ${path}`);
	const read = readFileSync(targetPath, { encoding: "utf8" });
	if (read.trim().length === 0) throw new Error(`review evidence artifact is empty: ${path}`);
}
