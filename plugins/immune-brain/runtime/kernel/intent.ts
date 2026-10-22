// P2C1 TaskIntent v1 identity module.
// Owns the strict TaskIntent v1 parser, canonical serializer/hash, secure
// descriptor reader, opaque identity-token producer, and revision classifier.
// This module must not import storage/reducer/observation/readiness/runtime.

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
import { execFileSync } from "node:child_process";
import { join, resolve, sep } from "node:path";
import { stableStringify } from "../canonical_json";
import {
	TASK_INTENT_CONTRACT_V1,
	TASK_RISKS,
	type TaskIntentRefV1,
	type TaskIntentV1,
	type TaskRisk,
} from "./types";
import {
	applyScopeRiskFloor,
	changedPathRiskFloor,
	NO_RISK_FLOOR,
	raiseRisk,
	readRiskFloor,
	type RiskFloor,
} from "./risk_floor";
import {
	mintToken,
	type TaskIntentIdentityToken,
	type TokenIdentity,
} from "./intent_token_registry";
import { parseVerificationDescriptor } from "../verification_descriptor";
import { assertNoTouch, readNoTouch } from "../no_touch";

export const INTENT_MAX_BYTES = 64 * 1024;
export const INTENT_SIDECAR_RELATIVE_PREFIX = "docs/plans/";

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const portablePathCollator = new Intl.Collator("und", {
	usage: "search",
	sensitivity: "base",
	numeric: false,
	ignorePunctuation: false,
});

function sha256Hex(bytes: string | Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

// ---------------------------------------------------------------------------
// Strict TaskIntent v1 parser (independent of the P1 intent parser).
// ---------------------------------------------------------------------------

function objectAt(
	value: unknown,
	path: string,
	violations: string[],
): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		violations.push(`${path} must be an object`);
		return {};
	}
	return value as Record<string, unknown>;
}

function rejectUnknown(
	record: Record<string, unknown>,
	allowed: readonly string[],
	path: string,
	violations: string[],
): void {
	for (const key of Object.keys(record)) {
		if (!allowed.includes(key))
			violations.push(`unknown field: ${path}.${key}`);
	}
}

function nonEmptyString(
	value: unknown,
	path: string,
	violations: string[],
	max: number,
): string {
	if (typeof value !== "string" || !value.trim() || value.length > max) {
		violations.push(`${path} must be a non-empty string no longer than ${max}`);
		return "";
	}
	return value;
}

function positiveInteger(value: unknown, path: string, violations: string[]): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		violations.push(`${path} must be a positive integer`);
		return 0;
	}
	return value;
}

function parseAcceptanceItemV1(
	value: unknown,
	index: number,
	violations: string[],
): { id: string; assertion: string; verification: string } {
	const item = objectAt(value, `intent.acceptance[${index}]`, violations);
	rejectUnknown(
		item,
		["id", "assertion", "verification"],
		`intent.acceptance[${index}]`,
		violations,
	);
	return {
		id: nonEmptyString(item.id, `intent.acceptance[${index}].id`, violations, 64),
		assertion: nonEmptyString(
			item.assertion,
			`intent.acceptance[${index}].assertion`,
			violations,
			2000,
		),
		verification: nonEmptyString(
			item.verification,
			`intent.acceptance[${index}].verification`,
			violations,
			2000,
		),
	};
}

function parseScopeHintV1(value: unknown, violations: string[], noTouch: readonly string[] = []): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		violations.push("intent.scope_hint must contain at least one path");
		return [];
	}
	const entries: string[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const path = `intent.scope_hint[${index}]`;
		const raw = nonEmptyString(value[index], path, violations, 200);
		if (!raw) continue;
		if (raw !== raw.trim()) violations.push(`${path} must not contain surrounding whitespace`);
		let entry = raw.trim();
		while (entry.endsWith("/")) entry = entry.slice(0, -1);
		if (
			!entry ||
			entry === "." ||
			entry === "*" ||
			entry === "**" ||
			entry === "**/*" ||
			entry.includes("\0") ||
			entry.includes("\\") ||
			entry.startsWith("/") ||
			/^[A-Za-z]:\//.test(entry) ||
			entry.split("/").some((part) => !part || part === "." || part === "..")
		) {
			violations.push(`${path} must be a canonical project-relative path or pattern`);
			continue;
		}
		if (Buffer.from(entry, "utf8").toString("utf8") !== entry) {
			violations.push(`${path} must contain valid round-trippable UTF-8`);
			continue;
		}
		if (entry.normalize("NFC") !== entry) {
			violations.push(`${path} must use NFC Unicode normalization`);
			continue;
		}
		entries.push(entry);
	}

	const componentIdentities: string[] = [];
	for (const entry of entries) {
		let prefix = "";
		for (const component of entry.split("/")) {
			prefix = prefix ? `${prefix}/${component}` : component;
			const prior = componentIdentities.find(
				(candidate) => candidate !== prefix && portablePathCollator.compare(candidate, prefix) === 0,
			);
			if (prior !== undefined) {
				violations.push(`intent.scope_hint contains a case-fold path collision: ${prior} and ${prefix}`);
			} else if (!componentIdentities.includes(prefix)) {
				componentIdentities.push(prefix);
			}
		}
	}

	assertNoTouch(entries, noTouch);
	const unique = [...new Set(entries)].sort((left, right) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
	return unique.filter(
		(entry) =>
			!unique.some(
				(candidate) =>
					candidate !== entry &&
					!candidate.includes("*") &&
					!candidate.includes("?") &&
					entry.startsWith(`${candidate}/`),
			),
	);
}

export function parseTaskIntentV1(raw: unknown, noTouch: readonly string[] = []): TaskIntentV1 {
	const violations: string[] = [];
	const value = objectAt(raw, "intent", violations);
	rejectUnknown(
		value,
		["contract", "task_id", "goal", "acceptance", "scope_hint", "risk", "revision", "owner"],
		"intent",
		violations,
	);
	if (value.contract !== TASK_INTENT_CONTRACT_V1)
		violations.push(`contract must equal ${TASK_INTENT_CONTRACT_V1}`);
	const acceptanceRaw = value.acceptance;
	if (!Array.isArray(acceptanceRaw) || acceptanceRaw.length === 0) {
		violations.push("intent.acceptance must contain at least one item");
	} else {
		const acceptance = acceptanceRaw.map((item, index) =>
			parseAcceptanceItemV1(item, index, violations),
		);
		const ids = new Set<string>();
		for (const item of acceptance) {
			if (ids.has(item.id))
				violations.push(`duplicate acceptance id: ${item.id}`);
			ids.add(item.id);
		}
	}
	const scopeHint = parseScopeHintV1(value.scope_hint, violations, noTouch);

	const risk = value.risk;
	if (typeof risk !== "string" || !TASK_RISKS.includes(risk as TaskRisk))
		violations.push(`intent.risk must be one of ${TASK_RISKS.join(", ")}`);
	if (value.owner !== "user") violations.push("intent.owner must equal user");
	const taskId = nonEmptyString(value.task_id, "intent.task_id", violations, 128);
	const goal = nonEmptyString(value.goal, "intent.goal", violations, 2000);
	const revision = positiveInteger(value.revision, "intent.revision", violations);

	if (violations.length > 0) throw new Error(violations.join("; "));

	const acceptance = (acceptanceRaw as unknown[]).map((item, index) =>
		parseAcceptanceItemV1(item, index, []),
	);
	// The declared risk is returned as written. The project's risk floor is
	// applied where a risk is decided, by a caller that knows the project root
	// (ADR 0023): `readTaskIntent`, `parseProjectTaskIntent`, `classifyTaskRisk`.
	return {
		contract: TASK_INTENT_CONTRACT_V1,
		task_id: taskId,
		goal,
		acceptance,
		scope_hint: scopeHint,
		risk: risk as TaskRisk,
		revision,
		owner: "user",
	};
}

// ---------------------------------------------------------------------------
// Canonical identity.
// ---------------------------------------------------------------------------

export function canonicalIntentHash(intent: unknown): string {
	return `sha256:${sha256Hex(stableStringify(intent))}`;
}

// An active Spec path, matching spec_binding.ts (which this module cannot import).
const ACTIVE_SPEC_PATH = /^docs\/specs\/(?!archive\/)[^/]+\.spec\.md$/;

/**
 * The command a verification string runs: executable, argv and cwd of a v2
 * descriptor. Run parameters (timeout, output bound, environment) are not part
 * of it. A string that is not a v2 descriptor is its own command.
 */
function verificationCommandSubject(verification: string): unknown {
	try {
		const { command } = parseVerificationDescriptor(verification);
		return { executable: command.executable, argv: command.argv, cwd: command.cwd };
	} catch {
		return verification;
	}
}

/**
 * The frozen part of a TaskIntent a batch authorization binds (Spec
 * branch-boundary D5): identity, goal, owner, the bound Spec path, and every
 * acceptance item's id, assertion and verification command. `scope_hint` other
 * than the Spec binding, `revision`, `risk` and run parameters are outside it.
 */
export function intentAuthoritySubject(intent: TaskIntentV1): unknown {
	return {
		contract: intent.contract,
		task_id: intent.task_id,
		goal: intent.goal,
		owner: intent.owner,
		specs: intent.scope_hint.filter((path) => ACTIVE_SPEC_PATH.test(path)).sort(),
		acceptance: intent.acceptance
			.map((item) => ({ id: item.id, assertion: item.assertion, command: verificationCommandSubject(item.verification) }))
			.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
	};
}

export function intentAuthorityHash(intent: TaskIntentV1): string {
	return canonicalIntentHash(intentAuthoritySubject(intent));
}

const RISK_RANK: Record<TaskRisk, number> = { routine: 0, material: 1, critical: 2 };

/**
 * A candidate intent parsed for one project: the strict parse, then that
 * project's scope floor. Every caller that turns candidate JSON into an intent
 * the Kernel will hash or record uses this, so the recorded risk and the risk
 * `readTaskIntent` later reads back agree.
 */
export function parseProjectTaskIntent(root: string, raw: unknown, recordedIntent?: TaskIntentV1): TaskIntentV1 {
	const parsed = parseTaskIntentV1(raw, readNoTouch(root));
	// An enrolled revision keeps its recorded risk; today's policy only changes gating.
	if (recordedIntent && parsed.revision === recordedIntent.revision &&
		raiseRisk(recordedIntent.risk, parsed.risk) === recordedIntent.risk)
		return { ...parsed, risk: recordedIntent.risk };
	return applyScopeRiskFloor(parsed, readRiskFloor(root));
}

export function classifyTaskRisk(
	changedPaths: readonly string[],
	declaredRisk: TaskRisk,
	floor: RiskFloor = NO_RISK_FLOOR,
): TaskRisk {
	return raiseRisk(declaredRisk, changedPathRiskFloor(changedPaths, floor));
}

function contentHashWithoutRevision(intent: TaskIntentV1): string {
	const { revision: _revision, ...rest } = intent;
	return canonicalIntentHash(rest);
}

export function classifyIntentRevision(
	previous: TaskIntentV1,
	next: TaskIntentV1,
): "unchanged" | "compatible" | "breaking" {
	if (contentHashWithoutRevision(previous) === contentHashWithoutRevision(next))
		return "unchanged";

	const boundSpecs = (intent: TaskIntentV1) =>
		intent.scope_hint.filter((path) => ACTIVE_SPEC_PATH.test(path)).sort();
	const breaking =
		previous.contract !== next.contract ||
		previous.task_id !== next.task_id ||
		previous.owner !== next.owner ||
		previous.goal !== next.goal ||
		JSON.stringify(boundSpecs(previous)) !== JSON.stringify(boundSpecs(next)) ||
		RISK_RANK[next.risk] < RISK_RANK[previous.risk] ||
		previous.acceptance.some((prior) => {
			const current = next.acceptance.find((item) => item.id === prior.id);
			return !current || current.assertion !== prior.assertion ||
				JSON.stringify(verificationCommandSubject(current.verification)) !==
					JSON.stringify(verificationCommandSubject(prior.verification));
		}) ||
		// Frozen acceptance (Spec branch-boundary D6): a new item is a new obligation.
		next.acceptance.some((item) => !previous.acceptance.some((prior) => prior.id === item.id));
	if (breaking) return "breaking";

	return next.revision > previous.revision ? "compatible" : "breaking";
}

/**
 * The record as if the next intent's scope were already in force. A revision is
 * prepared, checked and bound against the scope it asks for, not the scope it
 * replaces (ADR 0021, D6).
 */
export function withNextScope<R extends { intent_snapshot: { scope_hint: string[] } }>(
	record: R,
	nextScope: readonly string[],
): R {
	return {
		...record,
		intent_snapshot: { ...record.intent_snapshot, scope_hint: [...nextScope] },
	};
}

// ---------------------------------------------------------------------------
// Opaque file identity token.
// ---------------------------------------------------------------------------

// Opaque file identity token (brand and store live in intent_token_registry;
// this module re-exports the type for API compatibility).
export type { TaskIntentIdentityToken } from "./intent_token_registry";

// ---------------------------------------------------------------------------
// Secure descriptor reader.
// ---------------------------------------------------------------------------

export interface ReadTaskIntentResult {
	intent: TaskIntentV1;
	content_hash: string;
	intent_ref: TaskIntentRefV1;
	token: TaskIntentIdentityToken;
}

export interface ObservedTaskIntent {
	intent: TaskIntentV1;
	content_hash: string;
	intent_ref: TaskIntentRefV1;
}

export class TaskIntentObservationError extends Error {
	readonly code: "missing" | "invalid";

	constructor(code: "missing" | "invalid", message: string) {
		super(message);
		this.name = "TaskIntentObservationError";
		this.code = code;
	}
}

interface TaskIntentReadSource extends ObservedTaskIntent {
	identity: TokenIdentity;
}

export function setIntentReaderTestHook(
	hook: { onBeforeDescriptorRead?: () => void } | null,
): void {
	intentReaderTestHook = hook;
}

/** Test-only fault seam; production always reads through the secure path. */
let intentReaderTestHook: { onBeforeDescriptorRead?: () => void } | null = null;

function validateTaskId(taskId: string): void {
	if (!TASK_ID_PATTERN.test(taskId))
		throw new Error(
			"task id must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}",
		);
}

function statIdentity(stat: ReturnType<typeof statSync>): {
	dev: number;
	ino: number;
	size: number;
	mtimeMs: number;
} {
	if (!stat) throw new Error("stat identity is unavailable");
	return {
		dev: Number(stat.dev),
		ino: Number(stat.ino),
		size: Number(stat.size),
		mtimeMs: Number(stat.mtimeMs),
	};
}

function assertSameIdentity(
	before: { dev: number; ino: number; size: number; mtimeMs: number },
	after: ReturnType<typeof statSync>,
	what: string,
): void {
	const current = statIdentity(after);
	if (
		current.dev !== before.dev ||
		current.ino !== before.ino ||
		current.size !== before.size ||
		current.mtimeMs !== before.mtimeMs
	)
		throw new Error(`${what} changed while being read`);
}

function resolveCanonicalRoot(root: string): string {
	const resolved = resolve(root);
	const rootStat = lstatSync(resolved);
	if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
		throw new Error("project root must be a real directory, not a symlink");
	// Parent components may be symlinks (e.g. /var -> /private/var on macOS);
	// we bind containment and Git cwd to the canonical root so root identity
	// is unambiguous, and reject drift afterwards.
	return realpathSync(resolved);
}

// Resolve a path-less read to the sidecar that actually exists.
//
// The active path stays authoritative whenever it is present. A leftover
// archived sidecar from an earlier task reusing the same id must never shadow
// it. Only when the active path is gone does the historical archive answer.
function resolveSidecarPath(
	canonicalRoot: string,
	activePath: string,
	archivedPath: string,
): string {
	if (sidecarPresent(canonicalRoot, activePath)) return activePath;
	if (sidecarPresent(canonicalRoot, archivedPath)) return archivedPath;
	return activePath;
}

// Existence only. A symlink counts as present so `collectPathIdentities` still
// rejects it as a symlink; reporting it as missing would turn a security
// rejection into a lookup failure.
function sidecarPresent(canonicalRoot: string, relativePath: string): boolean {
	try {
		lstatSync(join(canonicalRoot, relativePath));
		return true;
	} catch {
		return false;
	}
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
			throw new Error("intent sidecar path contains a symlink");
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
			throw new Error(`path component changed while being read: ${parts.slice(0, index + 1).join("/")}`);
	}
}

function readTaskIntentSource(
	root: string,
	taskId: string,
	requestedPath?: string,
	requireTracked = true,
	recordedIntent?: TaskIntentV1,
): TaskIntentReadSource {
	validateTaskId(taskId);

	const canonicalRoot = resolveCanonicalRoot(root);
	const activePath = `${INTENT_SIDECAR_RELATIVE_PREFIX}${taskId}.intent.json`;
	const archivedPath = `${INTENT_SIDECAR_RELATIVE_PREFIX}archive/${taskId}.intent.json`;
	// Freeze binds the sidecar in place. The caller's TaskRecord `intent_ref.path`
	// is the authority. When no path is requested, resolve the sidecar that exists
	// (active, else historical archive). A missing sidecar is a stable contract
	// failure, not a raw `lstat` ENOENT.
	const sidecarPath = requestedPath ?? resolveSidecarPath(canonicalRoot, activePath, archivedPath);
	if (sidecarPath !== activePath && sidecarPath !== archivedPath)
		throw new Error("intent sidecar path is not the active or archived task path");
	const target = join(canonicalRoot, sidecarPath);
	if (!target.startsWith(canonicalRoot + sep))
		throw new Error("intent sidecar escapes project root");
	if (!sidecarPresent(canonicalRoot, sidecarPath))
		throw new TaskIntentObservationError("missing", `TaskIntent sidecar is missing at ${sidecarPath}`);

	const pathIdentities = collectPathIdentities(canonicalRoot, sidecarPath);
	const fileIdentity = pathIdentities[pathIdentities.length - 1];

	// Git tracking is an ownership convention, not user authentication.
	if (requireTracked) try {
		execFileSync(
			"git",
			["ls-files", "--error-unmatch", "--", sidecarPath],
			{ cwd: canonicalRoot, stdio: ["ignore", "pipe", "pipe"] },
		);
	} catch (error) {
		if (
			typeof error === "object"
			&& error !== null
			&& "status" in error
			&& (error as { status?: unknown }).status === 1
		) throw new TaskIntentObservationError("invalid", "TaskIntent sidecar is not Git-tracked");
		throw error;
	}

	const before = lstatSync(target);
	if (!before.isFile() || before.size > INTENT_MAX_BYTES)
		throw new TaskIntentObservationError("invalid", "TaskIntent sidecar must be a regular file no larger than 64 KiB");

	const fd = openSync(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
	let bytes: Buffer;
	try {
		const fdStat = fstatSync(fd);
		assertSameIdentity(statIdentity(before), fdStat, "intent sidecar descriptor");
		intentReaderTestHook?.onBeforeDescriptorRead?.();
		bytes = readFileSync(fd);
	} finally {
		closeSync(fd);
	}
	if (bytes.byteLength > INTENT_MAX_BYTES)
		throw new TaskIntentObservationError("invalid", "TaskIntent sidecar exceeds 64 KiB");

	// Post-read identity re-verification without a second path read as the
	// source of bytes.
	const after = lstatSync(target);
	assertSameIdentity(statIdentity(before), after, "intent sidecar");
	assertIdentitiesUnchanged(pathIdentities, canonicalRoot, sidecarPath);
	const canonicalAgain = realpathSync(root);
	if (canonicalAgain !== canonicalRoot)
		throw new Error("canonical project root drifted while being read");
	if (lstatSync(canonicalAgain).isSymbolicLink())
		throw new Error("canonical project root became a symlink while being read");

	const sourceBytesSha256 = sha256Hex(bytes);
	let intent: TaskIntentV1;
	try {
		intent = parseProjectTaskIntent(canonicalRoot, JSON.parse(bytes.toString("utf8")), recordedIntent);
	} catch (error) {
		throw new TaskIntentObservationError(
			"invalid",
			`TaskIntent sidecar is invalid: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (intent.task_id !== taskId)
		throw new TaskIntentObservationError("invalid", "intent.task_id does not match the sidecar filename task id");

	const contentHash = canonicalIntentHash(intent);
	return {
		intent,
		content_hash: contentHash,
		intent_ref: {
			path: sidecarPath,
			revision: intent.revision,
			content_hash: contentHash,
		},
		identity: {
			canonical_root: canonicalRoot,
			sidecar_path: sidecarPath,
			path_dev: fileIdentity.dev,
			path_ino: fileIdentity.ino,
			fd_dev: before.dev,
			fd_ino: before.ino,
			fd_size: before.size,
			fd_mtime_ms: before.mtimeMs,
			source_bytes_sha256: sourceBytesSha256,
			intent_content_hash: contentHash,
		},
	};
}

/** Validate the active sidecar before Enrollment can commit its untracked preconditions. */
export function observeEnrollmentTaskIntent(root: string, taskId: string): ObservedTaskIntent {
	const { identity: _identity, ...observed } = readTaskIntentSource(
		root, taskId, `${INTENT_SIDECAR_RELATIVE_PREFIX}${taskId}.intent.json`, false,
	);
	return observed;
}

export function observeTaskIntent(
	root: string,
	taskId: string,
	requestedPath?: string,
	recordedIntent?: TaskIntentV1,
): ObservedTaskIntent {
	const { identity: _identity, ...observed } = readTaskIntentSource(root, taskId, requestedPath, true, recordedIntent);
	return observed;
}

export function readTaskIntent(
	root: string,
	taskId: string,
	requestedPath?: string,
	recordedIntent?: TaskIntentV1,
): ReadTaskIntentResult {
	const { identity, ...observed } = readTaskIntentSource(root, taskId, requestedPath, true, recordedIntent);
	return { ...observed, token: mintToken(identity) };
}
