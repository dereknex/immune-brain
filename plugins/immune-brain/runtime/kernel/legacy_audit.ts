/**
 * Explicit read-only legacy audit projection (v4 storage retirement).
 *
 * This module is the ONLY retained reader for historical v3 State Ledger
 * artifacts. It performs a bounded, no-symlink, deterministic, redacted
 * projection and never writes journal, workflow, migration, receipt,
 * observation, TaskRecord, or workspace state. It never imports, synthesizes,
 * or activates a Kernel TaskRecord from legacy data.
 *
 * Not exported from kernel/index.ts; reached only through the v4 CLI
 * `imm-kernel audit --legacy` surface.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { LEGACY_V3_RELATIVE, legacyV3Path } from "./storage_paths";

const MAX_BYTES = 2 * 1024 * 1024;

export interface LegacyAuditProjection {
	contract: "assurance_kernel/legacy_audit/v1";
	source: string;
	read_only: true;
	writes_performed: false;
	plan_path: string | null;
	runtime_status: string | null;
	active_step: unknown;
	step_count: number;
	phase: string | null;
	digest: string;
	redacted: true;
}

function sha256Hex(bytes: string | Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The archived v3 Ledger lives at `.imm/audit/legacy-v3/` after the
 * one-release migration; before migration it is still read from the legacy
 * `.imm/memory/` path. This is the ONLY production caller of the legacy path
 * after the cutover; Slice 2 deletes the fallback branch once every target
 * repository has migrated.
 */
export function legacyLedgerSourceRelative(canonicalRoot: string): string {
	// review-5: the explicit legacy audit reads ONLY the archived audit
	// layout. A live old-layout Ledger (pre-migration) is reported as a
	// layout condition by the shared gate; this module never falls back to
	// the old authority path again. Absence keeps the empty-projection
	// semantics (ENOENT propagates to readLegacyLedgerBounded -> null).
	let stat;
	try {
		stat = lstatSync(resolve(canonicalRoot, legacyV3Path("current_iteration.json")));
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return legacyV3Path("current_iteration.json");
		throw error;
	}
	if (stat.isSymbolicLink())
		throw new Error("legacy audit rejected: archived v3 Ledger must not be a symlink");
	if (stat.isFile()) return legacyV3Path("current_iteration.json");
	throw new Error("legacy audit rejected: archived v3 Ledger is not a regular file");
}

/**
 * Read a bounded regular file with no symlink segments, returning canonical
 * content bytes. Throws KernelStoreSecurityError-compatible errors; only
 * ENOENT returns null.
 */
export function readLegacyLedgerBounded(root: string): {
	content: string;
	path: string;
} | null {
	const canonicalRoot = resolve(root);
	const sourceRelative = legacyLedgerSourceRelative(canonicalRoot);
	const target = join(canonicalRoot, sourceRelative);
	let stat;
	try {
		stat = lstatSync(target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	if (stat.isSymbolicLink())
		throw new Error("legacy audit rejected: v3 Ledger must not be a symlink");
	if (!stat.isFile())
		throw new Error("legacy audit rejected: v3 Ledger is not a regular file");
	if (stat.size > MAX_BYTES)
		throw new Error("legacy audit rejected: v3 Ledger exceeds the 2 MiB audit bound");
	const content = readFileSync(target, "utf8");
	// Post-read identity re-verification prevents symlink drift.
	const after = lstatSync(target);
	if (after.isSymbolicLink() || after.dev !== stat.dev || after.ino !== stat.ino)
		throw new Error("legacy audit rejected: v3 Ledger identity changed during read");
	return { content, path: sourceRelative };
}

/**
 * Deterministic redacted projection. Only bounded metadata is surfaced;
 * step/history/evidence payloads are never echoed.
 */
export function projectLegacyAudit(
	root: string,
): LegacyAuditProjection {
	const canonicalRoot = resolve(root);
	const read = readLegacyLedgerBounded(root);
	const source = legacyLedgerSourceRelative(canonicalRoot);
	if (!read) {
		return {
			contract: "assurance_kernel/legacy_audit/v1",
			source,
			read_only: true,
			writes_performed: false,
			plan_path: null,
			runtime_status: null,
			active_step: null,
			step_count: 0,
			phase: null,
			digest: "sha256:none",
			redacted: true,
		};
	}
	const raw = JSON.parse(read.content) as Record<string, unknown>;
	if (!raw || typeof raw !== "object" || Array.isArray(raw))
		throw new Error("legacy audit rejected: v3 Ledger root must be an object");
	const steps = raw.steps as Record<string, unknown> | undefined;
	if (steps && typeof steps !== "object")
		throw new Error("legacy audit rejected: v3 Ledger steps must be an object");
	const stepCount = steps ? Object.keys(steps).length : 0;
	if (stepCount > 1024)
		throw new Error("legacy audit rejected: v3 Ledger exceeds the step limit");
	const runtimeStatus = typeof raw.runtime_status === "string" ? raw.runtime_status : null;
	const phase =
		typeof raw.runtime_status === "string" && raw.runtime_status !== "idle"
			? "nonterminal"
			: raw.runtime_status === "idle" &&
					raw.reset_reason === "intentional_reset"
				? "finished"
				: "idle";
	return {
		contract: "assurance_kernel/legacy_audit/v1",
		source,
		read_only: true,
		writes_performed: false,
		plan_path: typeof raw.plan_path === "string" ? raw.plan_path : null,
		runtime_status: runtimeStatus,
		active_step: raw.active_step ?? null,
		step_count: stepCount,
		phase,
		digest: `sha256:${sha256Hex(`assurance_kernel/legacy_audit/v1\0${read.content}`)}`,
		redacted: true,
	};
}
