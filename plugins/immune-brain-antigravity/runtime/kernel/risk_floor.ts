// Project-declared risk floor (ADR 0023).
// The paths that force a higher task risk are data the project owns, read from
// one tracked file. This module owns the declaration format, its fail-closed
// reader and the two path policies. It must not import intent/storage/reducer.

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { TaskIntentV1, TaskRisk } from "./types";

export const RISK_FLOOR_DECLARATION_PATH = ".imm/risk-floor.json";
const NO_TOUCH_DECLARATION_PATH = "docs/agents/no-touch.json";
export const RISK_FLOOR_CONTRACT = "assurance_kernel/risk_floor/v1";
export const RISK_FLOOR_MAX_BYTES = 64 * 1024;

const RISK_RANK: Record<TaskRisk, number> = { routine: 0, material: 1, critical: 2 };
const FLOORED_TIERS = ["material", "critical"] as const;
type FlooredTier = (typeof FLOORED_TIERS)[number];

/**
 * One tier's prefixes. `paths` raises a task whose scope_hint can reach the
 * prefix or whose changed paths sit beneath it. `changed_only` raises a task
 * only through its changed paths, so a scope that merely names the prefix
 * keeps its declared risk.
 */
export interface RiskFloorTier {
	paths: readonly string[];
	changed_only: readonly string[];
}

/**
 * `invalid` carries the reason the declaration could not be trusted; a floor
 * with a reason raises every task to `critical`.
 */
export interface RiskFloor {
	material: RiskFloorTier;
	critical: RiskFloorTier;
	invalid: string | null;
}

const EMPTY_TIER: RiskFloorTier = { paths: [], changed_only: [] };

/** The floor of a project with no declaration. */
export const NO_RISK_FLOOR: RiskFloor = { material: EMPTY_TIER, critical: EMPTY_TIER, invalid: null };

function invalidFloor(reason: string): RiskFloor {
	return { material: EMPTY_TIER, critical: EMPTY_TIER, invalid: reason };
}

function parsePrefixes(value: unknown, label: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error(`${label} must be an array of path prefixes`);
	return value.map((entry, index) => {
		if (typeof entry !== "string" || entry.length === 0 || entry.length > 512)
			throw new Error(`${label}[${index}] must be a non-empty string of at most 512 characters`);
		if (/[\0-\x1f\x7f\\*?]/.test(entry))
			throw new Error(`${label}[${index}] must be a literal forward-slash path prefix`);
		if (entry.startsWith("/") || entry.split("/").some((segment) => segment === "" || segment === "." || segment === ".."))
			throw new Error(`${label}[${index}] must be a normalized project-relative path`);
		return entry;
	});
}

function parseTier(value: unknown, label: string): RiskFloorTier {
	if (value === undefined) return EMPTY_TIER;
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(`${label} must be an object`);
	const tier = value as Record<string, unknown>;
	for (const key of Object.keys(tier))
		if (key !== "paths" && key !== "changed_only") throw new Error(`${label}.${key} is not a known field`);
	return {
		paths: parsePrefixes(tier.paths, `${label}.paths`),
		changed_only: parsePrefixes(tier.changed_only, `${label}.changed_only`),
	};
}

/** Strict parse of a declaration document. Throws on any deviation. */
export function parseRiskFloor(raw: unknown): RiskFloor {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw))
		throw new Error("risk floor declaration must be a JSON object");
	const value = raw as Record<string, unknown>;
	if (value.contract !== RISK_FLOOR_CONTRACT)
		throw new Error(`risk floor declaration contract must equal ${RISK_FLOOR_CONTRACT}`);
	for (const key of Object.keys(value))
		if (key !== "contract" && !FLOORED_TIERS.includes(key as FlooredTier))
			throw new Error(`risk floor declaration field ${key} is not known`);
	return {
		material: parseTier(value.material, "material"),
		critical: parseTier(value.critical, "critical"),
		invalid: null,
	};
}

/**
 * Read the project's declaration. Never throws: a missing file is no floor, and
 * a file that is not a tracked, committed, regular, valid document is an invalid
 * floor. An uncommitted declaration is not trusted, so an edit made beside a
 * task cannot lower that task's floor.
 */
export function readRiskFloor(root: string): RiskFloor {
	let canonicalRoot: string;
	try {
		canonicalRoot = realpathSync(root);
	} catch {
		return NO_RISK_FLOOR;
	}
	const target = join(canonicalRoot, RISK_FLOOR_DECLARATION_PATH);
	let present = false;
	try {
		const stat = lstatSync(target);
		if (!stat.isFile()) return invalidFloor(`${RISK_FLOOR_DECLARATION_PATH} is not a regular file`);
		if (stat.size > RISK_FLOOR_MAX_BYTES) return invalidFloor(`${RISK_FLOOR_DECLARATION_PATH} exceeds 64 KiB`);
		present = true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ENOTDIR")
			return invalidFloor(`${RISK_FLOOR_DECLARATION_PATH} cannot be read`);
	}
	let pending: string;
	try {
		pending = execFileSync(
			"git",
			["--no-optional-locks", "status", "--porcelain=v1", "-z", "--ignored", "--", RISK_FLOOR_DECLARATION_PATH],
			{ cwd: canonicalRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
	} catch {
		// Outside a Git repository nothing vouches for the file.
		return present ? invalidFloor(`${RISK_FLOOR_DECLARATION_PATH} cannot be checked against Git`) : NO_RISK_FLOOR;
	}
	if (pending.length > 0)
		return invalidFloor(`${RISK_FLOOR_DECLARATION_PATH} has changes that are not committed`);
	try {
		const entry = execFileSync("git", ["ls-tree", "HEAD", "--", RISK_FLOOR_DECLARATION_PATH],
			{ cwd: canonicalRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
		if (!entry) return present ? invalidFloor(`${RISK_FLOOR_DECLARATION_PATH} is not committed`) : NO_RISK_FLOOR;
		if (!present || !/^100(?:644|755) blob /.test(entry))
			return invalidFloor(`${RISK_FLOOR_DECLARATION_PATH} does not match a committed regular file`);
		const bytes = readFileSync(target);
		const committed = execFileSync("git", ["show", `HEAD:${RISK_FLOOR_DECLARATION_PATH}`],
			{ cwd: canonicalRoot, maxBuffer: RISK_FLOOR_MAX_BYTES, stdio: ["ignore", "pipe", "pipe"] });
		// Index flags can hide changes from status; compare the bytes we parse.
		if (!bytes.equals(committed))
			return invalidFloor(`${RISK_FLOOR_DECLARATION_PATH} differs from its committed bytes`);
		return parseRiskFloor(JSON.parse(bytes.toString("utf8")));
	} catch (error) {
		return present ? invalidFloor(error instanceof Error ? error.message : String(error)) : NO_RISK_FLOOR;
	}
}

function segmentMatches(e: string, s: string): boolean {
	if (e === "*") return true;
	if (!e.includes("*") && !e.includes("?")) return e === s;
	const rx = new RegExp(
		`^${e.split("*").map((p) => p.split("?").map((q) => q.replace(/[.\\+^${}()|[\]\\/]/g, "\\$&")).join(".")).join(".*")}$`,
	);
	return rx.test(s);
}

// Decide whether a scope entry can match the prefix itself, any of its
// ancestor prefixes, or any descendant path beneath it. Glob `**` spans zero
// or more segments, `*` matches one segment, `?` one character. A match on any
// of those relations means the entry touches the floored path, so a
// routine-declared intent cannot hide behind wildcard-leading patterns.
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

function entryTouches(entry: string, prefixes: readonly string[]): boolean {
	if (!entry) return false;
	const es = entry.split("/");
	return prefixes.some((prefix) => scopeEntryTouchesPrefixSegments(es, prefix.split("/")));
}

// The declaration is one file, so only an entry that can match the file or one
// of its ancestor directories reaches it; nothing lives beneath it.
function entryReachesFile(entry: string, file: string): boolean {
	if (!entry) return false;
	const es = entry.split("/");
	const ps = file.split("/");
	const memo = new Map<string, boolean>();
	const m = (pi: number, ei: number): boolean => {
		const key = `${pi}:${ei}`;
		const cached = memo.get(key);
		if (cached !== undefined) return cached;
		let result: boolean;
		if (ei === es.length) result = true;
		else if (es[ei] === "**") result = m(pi, ei + 1) || (pi < ps.length && m(pi + 1, ei));
		else result = pi < ps.length && segmentMatches(es[ei], ps[pi]) && m(pi + 1, ei + 1);
		memo.set(key, result);
		return result;
	};
	return m(0, 0);
}

function pathBeneath(path: string, prefixes: readonly string[]): boolean {
	return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** The tier one scope entry is raised to, or null. The declaration's own path is always critical. */
export function scopeEntryRiskFloor(entry: string, floor: RiskFloor): TaskRisk | null {
	if (floor.invalid !== null) return "critical";
	if (entryReachesFile(entry, RISK_FLOOR_DECLARATION_PATH) || entryTouches(entry, floor.critical.paths)) return "critical";
	if (entryTouches(entry, floor.material.paths)) return "material";
	return null;
}

function highest(tiers: ReadonlyArray<TaskRisk | null>): TaskRisk | null {
	let result: TaskRisk | null = null;
	for (const tier of tiers)
		if (tier !== null && (result === null || RISK_RANK[tier] > RISK_RANK[result])) result = tier;
	return result;
}

/** The tier a scope_hint is raised to, or null. Derived from scope only, never from prose. */
export function scopeRiskFloor(scopeHint: readonly string[], floor: RiskFloor): TaskRisk | null {
	if (floor.invalid !== null) return "critical";
	return highest(scopeHint.map((entry) => scopeEntryRiskFloor(entry, floor)));
}

/** The tier a set of concrete changed paths is raised to, or null. */
export function changedPathRiskFloor(changedPaths: readonly string[], floor: RiskFloor): TaskRisk | null {
	if (floor.invalid !== null) return "critical";
	if (changedPaths.some((path) =>
		pathBeneath(path, [RISK_FLOOR_DECLARATION_PATH, NO_TOUCH_DECLARATION_PATH, ...floor.critical.paths, ...floor.critical.changed_only])))
		return "critical";
	if (changedPaths.some((path) => pathBeneath(path, [...floor.material.paths, ...floor.material.changed_only])))
		return "material";
	return null;
}

/**
 * Whether a concrete scope entry equals a floored path, sits beneath one, or is
 * an ancestor directory that would swallow one. Used by the same-directory
 * scope rule (ADR 0021), which never self-serves an addition on a floored path.
 */
export function touchesChangedPathFloor(entry: string, floor: RiskFloor): boolean {
	if (floor.invalid !== null) return true;
	return entryReachesFile(entry, RISK_FLOOR_DECLARATION_PATH) || entryTouches(entry, [
		...floor.critical.paths,
		...floor.critical.changed_only,
		...floor.material.paths,
		...floor.material.changed_only,
	]);
}

export function raiseRisk(declared: TaskRisk, floor: TaskRisk | null): TaskRisk {
	return floor !== null && RISK_RANK[declared] < RISK_RANK[floor] ? floor : declared;
}

/** The intent with its risk raised to the scope floor. Returns the input when nothing is raised. */
export function applyScopeRiskFloor(intent: TaskIntentV1, floor: RiskFloor): TaskIntentV1 {
	const risk = raiseRisk(intent.risk, scopeRiskFloor(intent.scope_hint, floor));
	return risk === intent.risk ? intent : { ...intent, risk };
}

/** The scope entries that raise the task, for the `inspect` and `intent` reports. */
export function floorMatchingScopeEntries(scopeHint: readonly string[], floor: RiskFloor): string[] {
	return scopeHint.filter((entry) => scopeEntryRiskFloor(entry, floor) !== null);
}

/** Every prefix that raises a scope, for the `inspect` and `intent` reports. */
export function floorScopePrefixes(floor: RiskFloor): string[] {
	return [RISK_FLOOR_DECLARATION_PATH, ...floor.critical.paths, ...floor.material.paths];
}
