import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, lstatSync, openSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import {
	AUTHORITY_OBSERVATION_GENERATION_V2,
	AUTHORITY_OBSERVER_VERSION_V2,
} from "../authority_commit_receipts";

export interface ReadinessEvidenceBundle {
	contract: "assurance_kernel/readiness_evidence/v1";
	generated_at: string;
	migration_dry_run: { digest: string; writes_performed: false };
	rollback_rehearsal: {
		result: "passed";
		at: string;
		summary: string;
		receipt_record_ids: string[];
	};
}

export type ReadinessEvidenceInput =
	| { status: "missing" }
	| { status: "invalid"; reason: string }
	| { status: "valid"; bundle: ReadinessEvidenceBundle };

const EVIDENCE_RELATIVE_PATH = "docs/evidence/assurance-kernel/readiness.json";
const EVIDENCE_MAX_BYTES = 64 * 1024;
const SHA256 = /^sha256:[a-f0-9]{64}$/;

function validTime(value: string): number | null {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function object(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseEvidenceBundle(value: unknown): ReadinessEvidenceBundle {
	const root = object(value);
	if (!root || !exactKeys(root, ["contract", "generated_at", "observer_generation", "observer_version", "migration_dry_run", "rollback_rehearsal"]))
		throw new Error("readiness evidence must use the exact v1 schema");
	const migration = object(root.migration_dry_run);
	const rehearsal = object(root.rollback_rehearsal);
	if (!migration || !exactKeys(migration, ["digest", "writes_performed"]) || typeof migration.digest !== "string" || !SHA256.test(migration.digest) || migration.writes_performed !== false)
		throw new Error("readiness migration evidence is invalid");
	if (!rehearsal || !exactKeys(rehearsal, ["result", "at", "summary", "receipt_record_ids"]) || rehearsal.result !== "passed" || typeof rehearsal.at !== "string" || validTime(rehearsal.at) === null || typeof rehearsal.summary !== "string" || rehearsal.summary.trim().length === 0 || !Array.isArray(rehearsal.receipt_record_ids) || rehearsal.receipt_record_ids.length === 0 || rehearsal.receipt_record_ids.some((entry) => typeof entry !== "string" || !SHA256.test(entry)))
		throw new Error("readiness rollback rehearsal evidence is invalid");
	if (root.contract !== "assurance_kernel/readiness_evidence/v1" || root.observer_generation !== AUTHORITY_OBSERVATION_GENERATION_V2 || root.observer_version !== AUTHORITY_OBSERVER_VERSION_V2 || typeof root.generated_at !== "string" || validTime(root.generated_at) === null)
		throw new Error("readiness evidence identity is invalid");
	return {
		contract: "assurance_kernel/readiness_evidence/v1",
		generated_at: root.generated_at,
		migration_dry_run: { digest: migration.digest, writes_performed: false },
		rollback_rehearsal: {
			result: "passed",
			at: rehearsal.at,
			summary: rehearsal.summary,
			receipt_record_ids: [...rehearsal.receipt_record_ids] as string[],
		},
	};
}

function gitClean(root: string, args: string[]): boolean {
	// node:child_process (not Bun.spawnSync) so this module also runs in the
	// Pi extension runtime, which has no Bun global.
	const result = spawnSync("git", args, { cwd: root, stdio: "pipe" });
	return result.status === 0;
}

function ensureNoSymlink(root: string, target: string): void {
	const rel = relative(root, target);
	if (rel.startsWith("..") || rel === "" || rel.split(sep).includes(".."))
		throw new Error("readiness evidence path escapes project root");
	let current = root;
	for (const part of rel.split(sep)) {
		current = resolve(current, part);
		const stat = lstatSync(current);
		if (stat.isSymbolicLink()) throw new Error("readiness evidence path contains a symlink");
	}
}

export function loadReadinessEvidence(root: string, now: string): ReadinessEvidenceInput {
	const target = resolve(root, EVIDENCE_RELATIVE_PATH);
	try {
		ensureNoSymlink(root, target);
	} catch (error) {
		if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT")
			return { status: "missing" };
		return { status: "invalid", reason: error instanceof Error ? error.message : String(error) };
	}
	try {
		if (!gitClean(root, ["ls-files", "--error-unmatch", "--", EVIDENCE_RELATIVE_PATH]))
			throw new Error("readiness evidence is not Git-tracked");
		if (!gitClean(root, ["diff", "--quiet", "--", EVIDENCE_RELATIVE_PATH]))
			throw new Error("readiness evidence has worktree changes");
		if (!gitClean(root, ["diff", "--cached", "--quiet", "--", EVIDENCE_RELATIVE_PATH]))
			throw new Error("readiness evidence has staged changes");
		const before = lstatSync(target);
		if (!before.isFile() || before.size > EVIDENCE_MAX_BYTES)
			throw new Error("readiness evidence must be a regular file no larger than 64 KiB");
		const fd = openSync(target, "r");
		let bytes: Buffer;
		try {
			bytes = readFileSync(fd);
		} finally {
			closeSync(fd);
		}
		const after = lstatSync(target);
		if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
			throw new Error("readiness evidence changed while being read");
		const reread = readFileSync(target);
		if (createHash("sha256").update(bytes).digest("hex") !== createHash("sha256").update(reread).digest("hex"))
			throw new Error("readiness evidence bytes changed while being read");
		const bundle = parseEvidenceBundle(JSON.parse(bytes.toString("utf8")));
		const nowMs = validTime(now);
		if (nowMs === null || (validTime(bundle.generated_at) ?? Infinity) > nowMs || (validTime(bundle.rollback_rehearsal.at) ?? Infinity) > nowMs)
			throw new Error("readiness evidence contains a future timestamp");
		return { status: "valid", bundle };
	} catch (error) {
		return { status: "invalid", reason: error instanceof Error ? error.message : String(error) };
	}
}
