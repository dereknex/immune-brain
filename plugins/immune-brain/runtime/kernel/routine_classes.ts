// Project-declared routine allowlist (ADR 0038).
// A `routine` risk declaration stands only while every changed path of the task
// lies under a path the project lists here; any other changed path raises the
// task to `material`, so it needs Review. The list only raises, never lowers.
// This module owns the declaration format and its reader. It must not import
// intent/storage/reducer.

import { readTrackedDeclaration } from "./tracked_declaration";

export const ROUTINE_CLASSES_DECLARATION_PATH = ".imm/routine-classes.json";
export const ROUTINE_CLASSES_CONTRACT = "assurance_kernel/routine_classes/v1";
export const ROUTINE_CLASSES_MAX_BYTES = 64 * 1024;
const CLASS_ID = /^[a-z][a-z0-9-]{0,63}$/;

export interface RoutineClass {
	id: string;
	/** Literal project-relative files or directory prefixes. */
	paths: readonly string[];
}

/**
 * `classes` is null when the project declares no allowlist. `invalid` carries
 * the reason the declaration could not be trusted; the caller raises every task
 * to `critical` for it.
 */
export interface RoutineAllowlist {
	classes: readonly RoutineClass[] | null;
	invalid: string | null;
}

export const NO_ROUTINE_ALLOWLIST: RoutineAllowlist = { classes: null, invalid: null };

function parsePaths(value: unknown, label: string): string[] {
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

/** Strict parse of a declaration document. Throws on any deviation. */
export function parseRoutineClasses(raw: unknown): RoutineClass[] {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw))
		throw new Error("routine classes declaration must be a JSON object");
	const value = raw as Record<string, unknown>;
	if (value.contract !== ROUTINE_CLASSES_CONTRACT)
		throw new Error(`routine classes declaration contract must equal ${ROUTINE_CLASSES_CONTRACT}`);
	for (const key of Object.keys(value))
		if (key !== "contract" && key !== "classes") throw new Error(`routine classes declaration field ${key} is not known`);
	if (!Array.isArray(value.classes)) throw new Error("classes must be an array");
	const seen = new Set<string>();
	return value.classes.map((entry, index) => {
		const label = `classes[${index}]`;
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new Error(`${label} must be an object`);
		const item = entry as Record<string, unknown>;
		for (const key of Object.keys(item))
			if (key !== "id" && key !== "paths") throw new Error(`${label}.${key} is not a known field`);
		if (typeof item.id !== "string" || !CLASS_ID.test(item.id))
			throw new Error(`${label}.id must be a lowercase kebab-case identifier`);
		if (seen.has(item.id)) throw new Error(`${label}.id ${item.id} is repeated`);
		seen.add(item.id);
		return { id: item.id, paths: parsePaths(item.paths, `${label}.paths`) };
	});
}

/** Read the project's allowlist. Never throws; see `readTrackedDeclaration` for trust. */
export function readRoutineAllowlist(root: string): RoutineAllowlist {
	const read = readTrackedDeclaration(root, ROUTINE_CLASSES_DECLARATION_PATH, ROUTINE_CLASSES_MAX_BYTES);
	if (read.kind === "absent") return NO_ROUTINE_ALLOWLIST;
	if (read.kind === "invalid") return { classes: null, invalid: read.reason };
	try {
		return { classes: parseRoutineClasses(read.value), invalid: null };
	} catch (error) {
		return { classes: null, invalid: error instanceof Error ? error.message : String(error) };
	}
}

/** The changed paths that no declared class covers. Empty when no allowlist is declared. */
export function pathsOutsideRoutineClasses(changedPaths: readonly string[], classes: readonly RoutineClass[] | null): string[] {
	if (classes === null) return [];
	const prefixes = classes.flatMap((item) => item.paths);
	return changedPaths.filter((path) => !prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)));
}
