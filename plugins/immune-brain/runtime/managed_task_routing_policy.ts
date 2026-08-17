/**
 * Git-owned managed-task routing policy (v1).
 *
 * The optional project policy at `docs/plans/managed-task-routing-policy.json`
 * is a strict, canonical, Git-owned routing contract evaluated at the
 * `imm-plan --sync` central boundary. This module owns the policy reader and
 * read-only status projection. The runtime never stages or commits policy
 * bytes; activating a policy is an explicit `git add` integration action.
 *
 * Wire contract (v1, canonical bytes only):
 *
 * ```json
 * {
 *   "contract": "immune_brain/managed_task_routing_policy/v1",
 *   "revision": 1,
 *   "new_task_route": "kernel_task_intent",
 *   "v3_new_plan_sync": "retired",
 *   "legacy_v3_mode": "drain_read_only",
 *   "terminal_import": "disabled"
 * }
 * ```
 *
 * Two-space JSON indentation, the field order shown above, and one trailing
 * newline. Revision 1 accepts no formatting-equivalent alternative.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	closeSync,
	constants as fsConstants,
	fstatSync,
	lstatSync,
	openSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";

export const MANAGED_TASK_ROUTING_POLICY_RELATIVE_PATH =
	"docs/plans/managed-task-routing-policy.json";

export const MANAGED_TASK_ROUTING_POLICY_V1_SHA256 =
	"43949f0ef456efb9ca7dccbe1c8bc2355d6acce66486213fb2750a87388ec71e";

/** Bounded policy size; the canonical v1 wire form is a few hundred bytes. */
const POLICY_MAX_BYTES = 4096;

const POLICY_CONTRACT = "immune_brain/managed_task_routing_policy/v1";
const POLICY_REVISION = 1;
const POLICY_NEW_TASK_ROUTE = "kernel_task_intent";
const POLICY_V3_NEW_PLAN_SYNC = "retired";
const POLICY_LEGACY_V3_MODE = "drain_read_only";
const POLICY_TERMINAL_IMPORT = "disabled";

const POLICY_V1_FIELDS = [
	"contract",
	"revision",
	"new_task_route",
	"v3_new_plan_sync",
	"legacy_v3_mode",
	"terminal_import",
] as const;

export type RoutingPolicyStatus = "legacy_v3" | "active" | "invalid";

export type RoutingPolicyOwnership =
	| "absent"
	| "untracked"
	| "tracked_clean"
	| "tracked_deleted"
	| "worktree_index_drift"
	| "unavailable";

export interface RoutingPolicyProjection {
	policy_status: RoutingPolicyStatus;
	route: "kernel_task_intent" | null;
	v3_new_plan_sync: "retired" | "allowed";
	legacy_v3_mode: "drain_read_only" | null;
	terminal_import: "disabled" | null;
	worktree_sha256: string | null;
	index_sha256: string | null;
	ownership: RoutingPolicyOwnership;
	reason_code: string;
}

export interface RoutingPolicyGateResult {
	blocked: { stdout: string; stderr: string; returncode: number } | null;
}

function sha256(bytes: string | Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function resolveCanonicalRoot(root: string): string {
	const resolved = resolve(root);
	const rootStat = lstatSync(resolved);
	if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
		throw new Error("project root must be a real directory, not a symlink");
	return realpathSync(resolved);
}

function collectPathIdentities(
	canonicalRoot: string,
	relativePath: string,
): { dev: number; ino: number }[] {
	const identities: { dev: number; ino: number }[] = [];
	let current = canonicalRoot;
	for (const part of relativePath.split("/")) {
		current = join(current, part);
		const stat = lstatSync(current);
		if (stat.isSymbolicLink())
			throw new Error("routing policy path contains a symlink");
		identities.push({ dev: stat.dev, ino: stat.ino });
	}
	return identities;
}

function assertIdentitiesUnchanged(
	expected: { dev: number; ino: number }[],
	canonicalRoot: string,
	relativePath: string,
): void {
	let current = canonicalRoot;
	const parts = relativePath.split("/");
	for (let index = 0; index < parts.length; index += 1) {
		current = join(current, parts[index]);
		const stat = lstatSync(current);
		if (stat.dev !== expected[index].dev || stat.ino !== expected[index].ino)
			throw new Error(
				`path component changed while being read: ${parts.slice(0, index + 1).join("/")}`,
			);
	}
}

/** Test-only fault seam; production always reads through the secure path. */
let routingPolicyReaderTestHook: {
	onBeforeDescriptorRead?: () => void;
} | null = null;

export function setRoutingPolicyReaderTestHook(
	hook: { onBeforeDescriptorRead?: () => void } | null,
): void {
	routingPolicyReaderTestHook = hook;
}

function statIdentity(stat: ReturnType<typeof statSync>): {
	dev: number;
	ino: number;
	size: number;
	mtimeMs: number;
} {
	return {
		dev: Number(stat.dev),
		ino: Number(stat.ino),
		size: Number(stat.size),
		mtimeMs: Number(stat.mtimeMs),
	};
}

function assertSameIdentity(
	before: { dev: number; ino: number; size: number; mtimeMs: number },
	after: ReturnType<typeof fstatSync>,
	what: string,
): void {
	const current = {
		dev: Number(after.dev),
		ino: Number(after.ino),
		size: Number(after.size),
		mtimeMs: Number(after.mtimeMs),
	};
	if (
		current.dev !== before.dev ||
		current.ino !== before.ino ||
		current.size !== before.size ||
		current.mtimeMs !== before.mtimeMs
	)
		throw new Error(`${what} changed while being read`);
}

/** Strict canonical v1 parse. Returns a stable reason code on failure. */
function parseCanonicalPolicy(
	raw: string,
): { parsed: Record<string, unknown> } | string {
	// Duplicate-key detection must happen before JSON.parse: the reviver runs
	// only on the final object, where an earlier duplicate was already
	// overwritten. The canonical v1 wire form has no ':' inside string values.
	const scanned = [...raw.matchAll(/"([A-Za-z0-9_]+)"\s*:/g)].map(
		(match) => match[1],
	);
	const seenKeys = new Set<string>();
	for (const key of scanned) {
		if (seenKeys.has(key)) return "policy_duplicate_key";
		seenKeys.add(key);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return "policy_invalid_json";
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return "policy_invalid_json";
	}
	const record = parsed as Record<string, unknown>;
	const keys = Object.keys(record);
	const expected = new Set<string>(POLICY_V1_FIELDS);
	if (keys.length !== POLICY_V1_FIELDS.length) {
		const missing = POLICY_V1_FIELDS.some((field) => !(field in record));
		return missing ? "policy_missing_field" : "policy_unknown_field";
	}
	for (const key of keys) {
		if (!expected.has(key)) return "policy_unknown_field";
	}
	// Field order is part of the wire contract; JSON.parse preserves file order,
	// so a reordered object needs an explicit sequence check.
	for (let index = 0; index < POLICY_V1_FIELDS.length; index += 1) {
		if (keys[index] !== POLICY_V1_FIELDS[index]) {
			return "policy_non_canonical_bytes";
		}
	}
	if (record.contract !== POLICY_CONTRACT) return "policy_unsupported_value";
	if (record.revision !== POLICY_REVISION) return "policy_unsupported_value";
	if (record.new_task_route !== POLICY_NEW_TASK_ROUTE)
		return "policy_unsupported_value";
	if (record.v3_new_plan_sync !== POLICY_V3_NEW_PLAN_SYNC)
		return "policy_unsupported_value";
	if (record.legacy_v3_mode !== POLICY_LEGACY_V3_MODE)
		return "policy_unsupported_value";
	if (record.terminal_import !== POLICY_TERMINAL_IMPORT)
		return "policy_unsupported_value";
	// Indentation and trailing newline are part of the wire contract too.
	if (JSON.stringify(record, null, 2) + "\n" !== raw) {
		return "policy_non_canonical_bytes";
	}
	return { parsed: record };
}

function invalidProjection(
	reasonCode: string,
	ownership: RoutingPolicyOwnership,
): RoutingPolicyProjection {
	return {
		policy_status: "invalid",
		route: null,
		v3_new_plan_sync: "allowed",
		legacy_v3_mode: null,
		terminal_import: null,
		worktree_sha256: null,
		index_sha256: null,
		ownership,
		reason_code: reasonCode,
	};
}

/**
 * Read-only routing-policy projection. Never writes project state and never
 * mutates the Git index. Fails closed: any present policy that cannot prove
 * exact canonical worktree/index bytes is `invalid`.
 */
export function inspectRoutingPolicy(root: string): RoutingPolicyProjection {
	const canonicalRoot = resolveCanonicalRoot(root);
	const relativePath = MANAGED_TASK_ROUTING_POLICY_RELATIVE_PATH;
	const target = join(canonicalRoot, relativePath);
	if (!target.startsWith(canonicalRoot + sep)) {
		return invalidProjection("policy_path_outside_root", "unavailable");
	}

	// Presence uses lstat, so a symlink at the policy path counts as present.
	let worktreeEntry: ReturnType<typeof lstatSync> | null = null;
	try {
		worktreeEntry = lstatSync(target);
	} catch {
		worktreeEntry = null;
	}
	const inWorktree = worktreeEntry !== null;

	// Git ownership check: the policy must be present in the index.
	let tracked = false;
	try {
		execFileSync("git", ["ls-files", "--error-unmatch", "--", relativePath], {
			cwd: canonicalRoot,
			stdio: ["ignore", "pipe", "pipe"],
		});
		tracked = true;
	} catch {
		tracked = false;
	}

	if (!tracked && !inWorktree) {
		// Absent from both worktree and index: legacy compatibility state.
		return {
			policy_status: "legacy_v3",
			route: null,
			v3_new_plan_sync: "allowed",
			legacy_v3_mode: null,
			terminal_import: null,
			worktree_sha256: null,
			index_sha256: null,
			ownership: "absent",
			reason_code: "policy_absent",
		};
	}
	if (tracked && !inWorktree) {
		// Indexed but deleted from the worktree: drift, never treated as missing.
		const indexBytes = indexPolicyBytes(canonicalRoot, relativePath);
		return {
			policy_status: "invalid",
			route: null,
			v3_new_plan_sync: "allowed",
			legacy_v3_mode: null,
			terminal_import: null,
			worktree_sha256: null,
			index_sha256: indexBytes === null ? null : sha256(indexBytes),
			ownership: "tracked_deleted",
			reason_code: "policy_tracked_deleted",
		};
	}
	if (!tracked) {
		// A symlinked policy is invalid before ownership: it cannot be a trusted
		// regular file regardless of index state.
		try {
			collectPathIdentities(canonicalRoot, relativePath);
		} catch {
			return invalidProjection("policy_symlink", "untracked");
		}
		return invalidProjection("policy_untracked", "untracked");
	}

	// Secure regular-file read with symlink rejection and identity re-check.
	const pathIdentities = collectPathIdentities(canonicalRoot, relativePath);
	let before: ReturnType<typeof lstatSync>;
	try {
		before = lstatSync(target);
	} catch {
		return invalidProjection("policy_read_drift", "unavailable");
	}
	if (!before.isFile()) {
		return invalidProjection("policy_not_regular_file", "tracked_clean");
	}
	if (before.size > POLICY_MAX_BYTES) {
		return invalidProjection("policy_oversize", "tracked_clean");
	}

	// Worktree/index byte identity is checked before canonical parsing: an
	// unstaged rewrite is drift even when the worktree bytes are malformed.
	let indexBytes: string | null = null;
	try {
		indexBytes = indexPolicyBytes(canonicalRoot, relativePath);
	} catch {
		indexBytes = null;
	}
	if (indexBytes === null) {
		return invalidProjection("policy_index_unavailable", "unavailable");
	}
	let bytes: Buffer;
	const fd = openSync(
		target,
		fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
	);
	try {
		const fdStat = fstatSync(fd);
		assertSameIdentity(
			statIdentity(before),
			fdStat,
			"routing policy descriptor",
		);
		routingPolicyReaderTestHook?.onBeforeDescriptorRead?.();
		bytes = readFileSync(fd);
	} catch {
		closeSync(fd);
		return invalidProjection("policy_read_drift", "unavailable");
	}
	closeSync(fd);
	try {
		assertIdentitiesUnchanged(pathIdentities, canonicalRoot, relativePath);
	} catch {
		return invalidProjection("policy_read_drift", "unavailable");
	}
	// Re-stat the target itself: a same-inode rewrite after the descriptor read
	// is still drift (size/mtime differ from the pre-read snapshot).
	let afterRead: ReturnType<typeof lstatSync>;
	try {
		afterRead = lstatSync(target);
	} catch {
		return invalidProjection("policy_read_drift", "unavailable");
	}
	const beforeIdentity = statIdentity(before);
	if (
		afterRead.dev !== beforeIdentity.dev ||
		afterRead.ino !== beforeIdentity.ino ||
		afterRead.size !== beforeIdentity.size ||
		afterRead.mtimeMs !== beforeIdentity.mtimeMs
	) {
		return invalidProjection("policy_read_drift", "unavailable");
	}

	const raw = bytes.toString("utf8");
	const worktreeHash = sha256(raw);
	if (worktreeHash !== sha256(indexBytes)) {
		return {
			policy_status: "invalid",
			route: null,
			v3_new_plan_sync: "allowed",
			legacy_v3_mode: null,
			terminal_import: null,
			worktree_sha256: worktreeHash,
			index_sha256: sha256(indexBytes),
			ownership: "worktree_index_drift",
			reason_code: "policy_worktree_index_drift",
		};
	}
	const parsed = parseCanonicalPolicy(raw);
	if (typeof parsed === "string") {
		return invalidProjection(parsed, "tracked_clean");
	}
	if (worktreeHash !== MANAGED_TASK_ROUTING_POLICY_V1_SHA256) {
		return invalidProjection("policy_hash_mismatch", "tracked_clean");
	}

	return {
		policy_status: "active",
		route: "kernel_task_intent",
		v3_new_plan_sync: "retired",
		legacy_v3_mode: "drain_read_only",
		terminal_import: "disabled",
		worktree_sha256: worktreeHash,
		index_sha256: sha256(indexBytes),
		ownership: "tracked_clean",
		reason_code: "policy_active",
	};
}

function indexPolicyBytes(
	canonicalRoot: string,
	relativePath: string,
): string | null {
	try {
		return execFileSync("git", ["show", `:${relativePath}`], {
			cwd: canonicalRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch {
		return null;
	}
}

/** Canonical v1 policy bytes for fixtures and documentation. */
export function policyV1CanonicalBytes(): string {
	return (
		'{\n' +
		'  "contract": "immune_brain/managed_task_routing_policy/v1",\n' +
		'  "revision": 1,\n' +
		'  "new_task_route": "kernel_task_intent",\n' +
		'  "v3_new_plan_sync": "retired",\n' +
		'  "legacy_v3_mode": "drain_read_only",\n' +
		'  "terminal_import": "disabled"\n' +
		'}\n'
	);
}
