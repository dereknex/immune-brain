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

const SOURCE_RELATIVE = ".imm/memory/current_iteration.json";
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
 * Read a bounded regular file with no symlink segments, returning canonical
 * content bytes. Throws KernelStoreSecurityError-compatible errors; only
 * ENOENT returns null.
 */
export function readLegacyLedgerBounded(root: string): {
	content: string;
	path: string;
} | null {
	const canonicalRoot = resolve(root);
	const target = join(canonicalRoot, SOURCE_RELATIVE);
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
	return { content, path: SOURCE_RELATIVE };
}

/**
 * Deterministic redacted projection. Only bounded metadata is surfaced;
 * step/history/evidence payloads are never echoed.
 */
export function projectLegacyAudit(
	root: string,
): LegacyAuditProjection {
	const read = readLegacyLedgerBounded(root);
	if (!read) {
		return {
			contract: "assurance_kernel/legacy_audit/v1",
			source: SOURCE_RELATIVE,
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
		source: SOURCE_RELATIVE,
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
