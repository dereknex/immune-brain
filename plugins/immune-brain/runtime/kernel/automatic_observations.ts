import { createHash } from "node:crypto";
import {
	closeSync,
	constants,
	existsSync,
	fstatSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { stableStringify } from "../canonical_json";
import {
	AUTHORITY_OBSERVATION_GENERATION_V2,
	AUTHORITY_OBSERVER_VERSION_V2,
} from "../authority_commit_receipts";
import type { LegacyMapping, V3CommitSourceEvent } from "./types";

const JOURNAL_RELATIVE_PATH =
	".imm/memory/.current_iteration.automatic_observations.jsonl";
const LOCK_RELATIVE_PATH =
	".imm/memory/.current_iteration.automatic_observations.lock";
const MAX_JOURNAL_BYTES = 64 * 1024 * 1024;

export interface V3AuthorityObservationV2 {
	contract: "assurance_kernel/v3_authority_observation/v2";
	observation_id: string;
	receipt_record_id: string;
	receipt_attempt_id: string;
	receipt_protocol: "assurance_kernel/authority_commit_receipt/v2";
	receipt_status: "committed" | "recovered_committed";
	source_kind: "state_mutation" | "project_migration";
	source_ref: string;
	state_path_identity: string;
	committed_bytes_sha256: string;
	ledger_revision: string;
	plan_path: string | null;
	plan_signature: string | null;
	source_events: V3CommitSourceEvent[];
	shadow: LegacyMapping;
	divergence: { detected: boolean; fields: string[] };
	observer_generation: typeof AUTHORITY_OBSERVATION_GENERATION_V2;
	observer_version: typeof AUTHORITY_OBSERVER_VERSION_V2;
	committed_at: string;
	observed_at: string;
}

export class AutomaticObservationSecurityError extends Error {}
export class AutomaticObservationConflictError extends Error {}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function digest(domain: string, payload: string): string {
	return `sha256:${sha256(`${domain}\0${payload}`)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new AutomaticObservationSecurityError(
			"automatic observation must be an object",
		);
	return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, expected: string[]): void {
	if (
		JSON.stringify(Object.keys(record).sort()) !==
		JSON.stringify([...expected].sort())
	)
		throw new AutomaticObservationSecurityError(
			"automatic observation v2 has unknown or missing fields",
		);
}

function nonEmptyString(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || !value)
		throw new AutomaticObservationSecurityError(
			`automatic observation v2 ${key} is invalid`,
		);
	return value;
}

function parseSourceEvents(value: unknown): V3CommitSourceEvent[] {
	if (!Array.isArray(value))
		throw new AutomaticObservationSecurityError(
			"automatic observation v2 source_events is invalid",
		);
	return value.map((entry) => {
		const record = asRecord(entry);
		exactKeys(record, ["action", "at", "id"]);
		const id = nonEmptyString(record, "id");
		const action = nonEmptyString(record, "action");
		if (record.at !== null && typeof record.at !== "string")
			throw new AutomaticObservationSecurityError(
				"automatic observation v2 source event time is invalid",
			);
		return { id, action, at: record.at as string | null };
	});
}

function parseLegacyMapping(value: unknown): LegacyMapping {
	const record = asRecord(value);
	exactKeys(record, ["ambiguous", "phase", "reason", "source_states"]);
	if (
		(record.phase !== null &&
			!(["working", "review", "done", "stopped"] as unknown[]).includes(
				record.phase,
			)) ||
		typeof record.reason !== "string" ||
		typeof record.ambiguous !== "boolean" ||
		!Array.isArray(record.source_states) ||
		record.source_states.some((entry) => typeof entry !== "string")
	)
		throw new AutomaticObservationSecurityError(
			"automatic observation v2 shadow is invalid",
		);
	return record as unknown as LegacyMapping;
}

function parseDivergence(
	value: unknown,
): { detected: boolean; fields: string[] } {
	const record = asRecord(value);
	exactKeys(record, ["detected", "fields"]);
	if (
		typeof record.detected !== "boolean" ||
		!Array.isArray(record.fields) ||
		record.fields.some((entry) => typeof entry !== "string") ||
		record.detected !== (record.fields.length > 0)
	)
		throw new AutomaticObservationSecurityError(
			"automatic observation v2 divergence is invalid",
		);
	return { detected: record.detected, fields: [...record.fields] as string[] };
}

export function parseAutomaticObservationV2(
	raw: unknown,
): V3AuthorityObservationV2 {
	const record = asRecord(raw);
	exactKeys(record, [
		"committed_at",
		"committed_bytes_sha256",
		"contract",
		"divergence",
		"ledger_revision",
		"observation_id",
		"observed_at",
		"observer_generation",
		"observer_version",
		"plan_path",
		"plan_signature",
		"receipt_attempt_id",
		"receipt_protocol",
		"receipt_record_id",
		"receipt_status",
		"shadow",
		"source_events",
		"source_kind",
		"source_ref",
		"state_path_identity",
	]);
	if (
		record.contract !== "assurance_kernel/v3_authority_observation/v2" ||
		record.receipt_protocol !==
			"assurance_kernel/authority_commit_receipt/v2" ||
		(record.receipt_status !== "committed" &&
			record.receipt_status !== "recovered_committed") ||
		record.observer_generation !== AUTHORITY_OBSERVATION_GENERATION_V2 ||
		record.observer_version !== AUTHORITY_OBSERVER_VERSION_V2 ||
		(record.source_kind !== "state_mutation" &&
			record.source_kind !== "project_migration")
	)
		throw new AutomaticObservationSecurityError(
			"automatic observation v2 identity is invalid",
		);
	for (const key of [
		"observation_id",
		"receipt_record_id",
		"receipt_attempt_id",
		"source_ref",
		"state_path_identity",
		"committed_bytes_sha256",
		"ledger_revision",
		"committed_at",
		"observed_at",
	])
		nonEmptyString(record, key);
	if (
		(record.plan_path !== null && typeof record.plan_path !== "string") ||
		(record.plan_signature !== null &&
			typeof record.plan_signature !== "string")
	)
		throw new AutomaticObservationSecurityError(
			"automatic observation v2 Plan identity is invalid",
		);
	const observation: V3AuthorityObservationV2 = {
		...(record as unknown as V3AuthorityObservationV2),
		source_events: parseSourceEvents(record.source_events),
		shadow: parseLegacyMapping(record.shadow),
		divergence: parseDivergence(record.divergence),
	};
	const { observation_id: _observationId, ...core } = observation;
	if (
		observation.observation_id !==
		digest(
			"assurance-kernel-v3-observation/v2",
			stableStringify(core),
		)
	)
		throw new AutomaticObservationSecurityError(
			"automatic observation v2 identity mismatch",
		);
	return observation;
}

function canonicalRoot(root: string): string {
	const resolved = resolve(root);
	const stat = lstatSync(resolved);
	if (stat.isSymbolicLink() || !stat.isDirectory())
		throw new AutomaticObservationSecurityError(
			"automatic observation root must be a real directory",
		);
	return realpathSync(resolved);
}

function insideRoot(root: string, candidate: string): boolean {
	return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function ensureMemoryDirectory(root: string): { root: string; memory: string } {
	const canonical = canonicalRoot(root);
	let cursor = canonical;
	for (const segment of [".imm", "memory"]) {
		cursor = resolve(cursor, segment);
		if (!existsSync(cursor)) mkdirSync(cursor, { mode: 0o700 });
		const stat = lstatSync(cursor);
		if (stat.isSymbolicLink() || !stat.isDirectory())
			throw new AutomaticObservationSecurityError(
				"automatic observation directory is not a real directory",
			);
		const real = realpathSync(cursor);
		if (!insideRoot(canonical, real))
			throw new AutomaticObservationSecurityError(
				"automatic observation directory escapes the project",
			);
		cursor = real;
	}
	return { root: canonical, memory: cursor };
}

function journalPath(root: string): string {
	return resolve(canonicalRoot(root), JOURNAL_RELATIVE_PATH);
}

export function automaticObservationJournalPath(root: string): string {
	return journalPath(root);
}

function assertRegularPathOrMissing(path: string): void {
	if (!existsSync(path)) return;
	const stat = lstatSync(path);
	if (stat.isSymbolicLink() || !stat.isFile())
		throw new AutomaticObservationSecurityError(
			"automatic observation path is not a regular file",
		);
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

function clearStaleLock(path: string): boolean {
	if (!existsSync(path)) return true;
	const before = lstatSync(path);
	if (before.isSymbolicLink() || !before.isFile())
		throw new AutomaticObservationSecurityError(
			"automatic observation lock is not a regular file",
		);
	let stale = false;
	try {
		const record = JSON.parse(readFileSync(path, "utf8")) as {
			pid?: unknown;
		};
		stale =
			Number.isInteger(record.pid) &&
			Number(record.pid) > 0 &&
			!processIsAlive(Number(record.pid));
	} catch {
		stale = Date.now() - before.mtimeMs > 30_000;
	}
	if (!stale) return false;
	const after = lstatSync(path);
	if (
		after.isSymbolicLink() ||
		after.dev !== before.dev ||
		after.ino !== before.ino
	)
		throw new AutomaticObservationSecurityError(
			"automatic observation lock identity changed",
		);
	rmSync(path);
	return true;
}

function withLock<T>(root: string, operation: () => T): T {
	const { memory } = ensureMemoryDirectory(root);
	const path = resolve(memory, LOCK_RELATIVE_PATH.split("/").at(-1)!);
	let fd: number | null = null;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			fd = openSync(
				path,
				constants.O_WRONLY |
					constants.O_CREAT |
					constants.O_EXCL |
					(constants.O_NOFOLLOW ?? 0),
				0o600,
			);
			break;
		} catch (error) {
			if (
				attempt === 0 &&
				(error as NodeJS.ErrnoException).code === "EEXIST" &&
				clearStaleLock(path)
			)
				continue;
			throw new AutomaticObservationConflictError(
				`automatic observation lock is busy: ${error instanceof Error ? error.message : error}`,
			);
		}
	}
	if (fd === null)
		throw new AutomaticObservationConflictError(
			"automatic observation lock could not be acquired",
		);
	const identity = fstatSync(fd);
	try {
		writeFileSync(
			fd,
			`${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`,
			"utf8",
		);
		fsyncSync(fd);
		return operation();
	} finally {
		closeSync(fd);
		if (existsSync(path)) {
			const current = lstatSync(path);
			if (
				!current.isSymbolicLink() &&
				current.dev === identity.dev &&
				current.ino === identity.ino
			)
				rmSync(path);
		}
	}
}

export function readAutomaticObservationsV2(
	root: string,
): V3AuthorityObservationV2[] {
	const path = journalPath(root);
	assertRegularPathOrMissing(path);
	if (!existsSync(path)) return [];
	const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const before = fstatSync(fd);
		if (before.size > MAX_JOURNAL_BYTES)
			throw new AutomaticObservationSecurityError(
				"automatic observation journal exceeds the read limit",
			);
		const content = readFileSync(fd, "utf8");
		const after = fstatSync(fd);
		if (before.dev !== after.dev || before.ino !== after.ino)
			throw new AutomaticObservationSecurityError(
				"automatic observation journal identity changed",
			);
		return content
			.split("\n")
			.filter((line) => line.trim())
			.map((line, index) => {
				try {
					return parseAutomaticObservationV2(JSON.parse(line));
				} catch (error) {
					throw new AutomaticObservationSecurityError(
						`automatic observation line ${index + 1} is invalid: ${error instanceof Error ? error.message : error}`,
					);
				}
			});
	} finally {
		closeSync(fd);
	}
}

export function appendAutomaticObservationV2(
	root: string,
	input: V3AuthorityObservationV2,
): "appended" | "duplicate" {
	const observation = parseAutomaticObservationV2(input);
	return withLock(root, () => {
		for (const existing of readAutomaticObservationsV2(root)) {
			if (existing.receipt_record_id !== observation.receipt_record_id)
				continue;
			if (existing.observation_id === observation.observation_id)
				return "duplicate";
			throw new AutomaticObservationConflictError(
				`automatic observation receipt identity conflict: ${observation.receipt_record_id}`,
			);
		}
		const { memory } = ensureMemoryDirectory(root);
		const path = resolve(memory, JOURNAL_RELATIVE_PATH.split("/").at(-1)!);
		assertRegularPathOrMissing(path);
		const fd = openSync(
			path,
			constants.O_WRONLY |
				constants.O_CREAT |
				constants.O_APPEND |
				(constants.O_NOFOLLOW ?? 0),
			0o600,
		);
		try {
			writeFileSync(fd, `${JSON.stringify(observation)}\n`, "utf8");
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		const directoryFd = openSync(dirname(path), constants.O_RDONLY);
		try {
			fsyncSync(directoryFd);
		} finally {
			closeSync(directoryFd);
		}
		return "appended";
	});
}
