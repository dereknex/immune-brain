// Host-captured immutable review evidence for native Pi subagents.

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
	pathMatchesScope,
	taskDiffHash,
	type GitTaskIndexEntry,
} from "../runtime/workspace_scope";

const MAX_REVIEW_BUNDLE_BYTES = 2 * 1024 * 1024;
const MAX_FILE_BYTES = 256 * 1024;

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
	if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES)
		throw new Error(`review file exceeds bounded size: ${path}`);
	const bytes = execFileSync("git", ["cat-file", "blob", entry.oid], {
		cwd: root,
		encoding: "buffer",
		stdio: ["ignore", "pipe", "ignore"],
		maxBuffer: MAX_FILE_BYTES + 1,
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

const GIT_OBJECT_ID = /^[a-f0-9]{40,64}$/;
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
