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
	mintToken,
	type TaskIntentIdentityToken,
} from "./intent_token_registry";

export const INTENT_MAX_BYTES = 64 * 1024;
export const INTENT_SIDECAR_RELATIVE_PREFIX = "docs/plans/";

// Deterministic risk-tier floor: an intent whose scope_hint touches kernel or
// authority runtime paths is forced to at least `material` regardless of the
// tier the author declared, so self-graded `routine` can never buy weaker
// gating over the paths where gating matters most. The floor is derived solely
// from scope_hint, never from prose fields. The .pi-extension directory is the
// human gate itself (enrollment confirmation, capability minting, and review
// authorization), so a self-graded routine over it must not weaken gating over
// the code that implements gating.
export const RISK_FLOOR_SCOPE_PREFIXES = [
	"plugins/immune-brain/runtime/kernel",
	"plugins/immune-brain/runtime/authority_commit_receipts.ts",
	"plugins/immune-brain/.pi-extension",
] as const;

function segmentMatches(e: string, s: string): boolean {
	if (e === "*") return true;
	if (!e.includes("*") && !e.includes("?")) return e === s;
	const rx = new RegExp(
		`^${e.split("*").map((p) => p.split("?").map((q) => q.replace(/[.\\+^${}()|[\]\\/]/g, "\\$&")).join(".")).join(".*")}$`,
	);
	return rx.test(s);
}

// Decide whether a scope entry can match the kernel/authority prefix itself,
// any of its ancestor prefixes, or any descendant path beneath it. Glob `**`
// spans zero or more segments, `*` matches one segment, `?` one character.
// A match on any of those relations means the entry touches the floored path,
// so a routine-declared intent cannot hide behind wildcard-leading patterns.
function scopeEntryTouchesPrefixSegments(es: string[], ps: string[]): boolean {
	const memo = new Map<string, boolean>();
	const m = (pi: number, ei: number): boolean => {
		const key = `${pi}:${ei}`;
		const cached = memo.get(key);
		if (cached !== undefined) return cached;
		let result: boolean;
		if (ei === es.length) {
			result = true; // es matched a prefix of ps, ps itself, or a descendant
		} else {
			const e = es[ei];
			if (e === "**") {
				if (pi >= ps.length) result = true; // beyond ps, descendant always exists
			else result = m(pi, ei + 1) || m(pi + 1, ei);
			} else if (pi < ps.length && segmentMatches(e, ps[pi])) {
				result = m(pi + 1, ei + 1);
			} else if (pi >= ps.length) {
				result = m(pi + 1, ei + 1); // remaining literal segments match descendant segments
			} else {
				result = false;
			}
		}
		memo.set(key, result);
		return result;
	};
	return m(0, 0);
}

function scopeEntryTouchesRiskFloorPaths(entry: string): boolean {
	if (!entry) return false;
	const es = entry.split("/");
	return RISK_FLOOR_SCOPE_PREFIXES.some((prefix) =>
		scopeEntryTouchesPrefixSegments(es, prefix.split("/")),
	);
}

function riskFloorForScope(scopeHint: string[]): TaskRisk | null {
	return scopeHint.some(scopeEntryTouchesRiskFloorPaths)
		? "material"
		: null;
}

const SHA256_HEX = /^sha256:[a-f0-9]{64}$/;
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

function parseScopeHintV1(value: unknown, violations: string[]): string[] {
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

export function parseTaskIntentV1(raw: unknown): TaskIntentV1 {
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
	const scopeHint = parseScopeHintV1(value.scope_hint, violations);

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
	const declaredRisk = risk as TaskRisk;
	const flooredRisk = riskFloorForScope(scopeHint);
	return {
		contract: TASK_INTENT_CONTRACT_V1,
		task_id: taskId,
		goal,
		acceptance,
		scope_hint: scopeHint,
		risk:
			flooredRisk !== null && RISK_RANK[declaredRisk] < RISK_RANK[flooredRisk]
				? flooredRisk
				: declaredRisk,
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

const RISK_RANK: Record<TaskRisk, number> = { routine: 0, material: 1, critical: 2 };

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

	const breaking =
		previous.contract !== next.contract ||
		previous.task_id !== next.task_id ||
		previous.owner !== next.owner ||
		previous.goal !== next.goal ||
		JSON.stringify(previous.scope_hint) !== JSON.stringify(next.scope_hint) ||
		RISK_RANK[next.risk] < RISK_RANK[previous.risk] ||
		previous.acceptance.some((prior) => {
			const current = next.acceptance.find((item) => item.id === prior.id);
			return !current || current.assertion !== prior.assertion;
		});
	if (breaking) return "breaking";

	return next.revision > previous.revision ? "compatible" : "breaking";
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

export function readTaskIntent(
	root: string,
	taskId: string,
): ReadTaskIntentResult {
	validateTaskId(taskId);

	const canonicalRoot = resolveCanonicalRoot(root);
	const sidecarPath = `${INTENT_SIDECAR_RELATIVE_PREFIX}${taskId}.intent.json`;
	const target = join(canonicalRoot, sidecarPath);
	if (!target.startsWith(canonicalRoot + sep))
		throw new Error("intent sidecar escapes project root");

	const pathIdentities = collectPathIdentities(canonicalRoot, sidecarPath);
	const fileIdentity = pathIdentities[pathIdentities.length - 1];

	// Git tracking is an ownership convention, not user authentication.
	try {
		execFileSync(
			"git",
			["ls-files", "--error-unmatch", "--", sidecarPath],
			{ cwd: canonicalRoot, stdio: ["ignore", "pipe", "pipe"] },
		);
	} catch {
		throw new Error("TaskIntent sidecar is not Git-tracked");
	}

	const before = lstatSync(target);
	if (!before.isFile() || before.size > INTENT_MAX_BYTES)
		throw new Error("TaskIntent sidecar must be a regular file no larger than 64 KiB");

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
		throw new Error("TaskIntent sidecar exceeds 64 KiB");

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
		intent = parseTaskIntentV1(JSON.parse(bytes.toString("utf8")));
	} catch (error) {
		throw new Error(
			`TaskIntent sidecar is invalid: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (intent.task_id !== taskId)
		throw new Error("intent.task_id does not match the sidecar filename task id");

	const contentHash = canonicalIntentHash(intent);
	const token = mintToken({
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
	});

	return {
		intent,
		content_hash: contentHash,
		intent_ref: {
			path: sidecarPath,
			revision: intent.revision,
			content_hash: contentHash,
		},
		token,
	};
}
