import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	existsSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	writeSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { stableStringify } from "./canonical_json";

export const AUTHORITY_COMMIT_RECEIPT_CONTRACT =
	"assurance_kernel/authority_commit_receipt/v1" as const;
export const AUTHORITY_COMMIT_RECEIPT_V2_CONTRACT =
	"assurance_kernel/authority_commit_receipt/v2" as const;
export const AUTHORITY_OBSERVATION_GENERATION_V2 =
	"automatic-observation/v2" as const;
export const AUTHORITY_OBSERVER_VERSION_V2 =
	"assurance-kernel-p2a-observer/v2" as const;

export type AuthorityCommitSourceKind =
	| "state_mutation"
	| "project_migration";
export type AuthorityCommitReceiptStatus =
	| "prepared"
	| "committed"
	| "aborted"
	| "recovered_committed"
	| "recovered_aborted";

export interface AuthorityObservationSeedV2 {
	contract: "assurance_kernel/authority_observation_seed/v2";
	observer_version: typeof AUTHORITY_OBSERVER_VERSION_V2;
	source_kind: AuthorityCommitSourceKind;
	source_ref: string;
	state_path_identity: string;
	committed_bytes_sha256: string;
	committed_revision: string;
	committed_at: string;
	plan_path: string | null;
	plan_signature: string | null;
	source_events: Array<{ id: string; action: string; at: string | null }>;
	shadow: {
		phase: "working" | "review" | "done" | "stopped" | null;
		reason: string;
		ambiguous: boolean;
		source_states: string[];
	};
	divergence: { detected: boolean; fields: string[] };
}

export interface AuthorityCommitTargetInput {
	absolute_path: string;
	before_bytes: string | null;
	after_bytes: string;
}

export interface AuthorityCommitTarget {
	path: string;
	before_sha256: string | null;
	after_sha256: string;
}

export interface PrepareAuthorityCommitInput {
	source_kind: AuthorityCommitSourceKind;
	targets: AuthorityCommitTargetInput[];
	ledger_revision: string;
	source_ref: string;
	attempt_id?: string;
	observation_generation?: typeof AUTHORITY_OBSERVATION_GENERATION_V2;
	observation_seed?: AuthorityObservationSeedV2;
}

export interface AuthorityCommitReceipt {
	contract:
		| typeof AUTHORITY_COMMIT_RECEIPT_CONTRACT
		| typeof AUTHORITY_COMMIT_RECEIPT_V2_CONTRACT;
	record_id: string;
	attempt_id: string;
	source_kind: AuthorityCommitSourceKind;
	status: AuthorityCommitReceiptStatus;
	state_path_identity: string;
	targets: AuthorityCommitTarget[];
	before_sha256: string | null;
	after_sha256: string;
	ledger_revision: string;
	source_ref: string;
	previous_record_hash: string | null;
	recorded_at: string;
	observation_generation?: typeof AUTHORITY_OBSERVATION_GENERATION_V2;
	observation_seed?: AuthorityObservationSeedV2;
}

export type PreparedAuthorityCommit = AuthorityCommitReceipt & {
	status: "prepared";
};

const JOURNAL_NAME = ".current_iteration.authority_commit_receipts.jsonl";
const ATTEMPT_ID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const TERMINAL_STATUSES = new Set<AuthorityCommitReceiptStatus>([
	"committed",
	"aborted",
	"recovered_committed",
	"recovered_aborted",
]);

let beforeAppendForTest:
	| ((record: Omit<AuthorityCommitReceipt, "record_id">) => void)
	| null = null;

function sha256(value: string): string {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function recordHash(
	record: Omit<AuthorityCommitReceipt, "record_id">,
): string {
	const domain =
		record.contract === AUTHORITY_COMMIT_RECEIPT_V2_CONTRACT
			? "assurance-kernel-authority-commit-receipt/v2"
			: "assurance-kernel-authority-commit-receipt/v1";
	return sha256(`${domain}\0${stableStringify(record)}`);
}

function projectRootForStatePath(statePath: string): string {
	const absoluteStatePath = resolve(statePath);
	const memoryDir = dirname(absoluteStatePath);
	if (dirname(memoryDir) === memoryDir) {
		throw new Error("authority receipt state path has no project root");
	}
	return dirname(dirname(memoryDir));
}

export function authorityStatePathIdentity(statePath: string): string {
	return sha256(
		`assurance-kernel-state-path/v1\0${resolve(statePath).replace(/\\/g, "/")}`,
	);
}

function targetPath(root: string, absolutePath: string): string {
	const absolute = resolve(absolutePath);
	const rel = relative(root, absolute).replace(/\\/g, "/");
	if (!rel || rel === ".." || rel.startsWith("../") || rel.startsWith("/")) {
		throw new Error("authority receipt target must be inside the project root");
	}
	return rel;
}

function currentTargetHash(root: string, target: AuthorityCommitTarget): string | null {
	const absolute = resolve(root, target.path);
	const rel = relative(root, absolute).replace(/\\/g, "/");
	if (rel !== target.path || rel.startsWith("../")) {
		throw new Error("authority receipt target escaped the project root");
	}
	if (!existsSync(absolute)) return null;
	const stat = lstatSync(absolute);
	if (stat.isSymbolicLink() || !stat.isFile()) {
		throw new Error(`authority receipt target is not a regular file: ${target.path}`);
	}
	return sha256(readFileSync(absolute, "utf8"));
}

function fsyncDirectory(path: string): void {
	const descriptor = openSync(path, "r");
	try {
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
}

export function receiptJournalPath(statePath: string): string {
	return resolve(dirname(resolve(statePath)), JOURNAL_NAME);
}

function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("authority receipt record must be an object");
	}
	return value as Record<string, unknown>;
}

function parseTarget(value: unknown): AuthorityCommitTarget {
	const record = asRecord(value);
	if (
		Object.keys(record).sort().join(",") !==
		"after_sha256,before_sha256,path"
	) {
		throw new Error("authority receipt target has unsupported fields");
	}
	if (typeof record.path !== "string" || !record.path) {
		throw new Error("authority receipt target path is invalid");
	}
	if (
		(record.before_sha256 !== null &&
			(typeof record.before_sha256 !== "string" ||
				!SHA256_RE.test(record.before_sha256))) ||
		typeof record.after_sha256 !== "string" ||
		!SHA256_RE.test(record.after_sha256)
	) {
		throw new Error("authority receipt target hashes are invalid");
	}
	return {
		path: record.path,
		before_sha256: record.before_sha256 as string | null,
		after_sha256: record.after_sha256,
	};
}

function parseObservationSeed(value: unknown): AuthorityObservationSeedV2 {
	const record = asRecord(value);
	const expectedKeys = [
		"committed_at",
		"committed_bytes_sha256",
		"committed_revision",
		"contract",
		"divergence",
		"observer_version",
		"plan_path",
		"plan_signature",
		"shadow",
		"source_events",
		"source_kind",
		"source_ref",
		"state_path_identity",
	].sort();
	if (Object.keys(record).sort().join(",") !== expectedKeys.join(",")) {
		throw new Error("authority observation seed has unsupported fields");
	}
	if (
		record.contract !== "assurance_kernel/authority_observation_seed/v2" ||
		record.observer_version !== AUTHORITY_OBSERVER_VERSION_V2 ||
		(record.source_kind !== "state_mutation" &&
			record.source_kind !== "project_migration") ||
		typeof record.source_ref !== "string" ||
		!record.source_ref ||
		typeof record.state_path_identity !== "string" ||
		!SHA256_RE.test(record.state_path_identity) ||
		typeof record.committed_bytes_sha256 !== "string" ||
		!SHA256_RE.test(record.committed_bytes_sha256) ||
		typeof record.committed_revision !== "string" ||
		!record.committed_revision ||
		typeof record.committed_at !== "string" ||
		!Number.isFinite(Date.parse(record.committed_at)) ||
		(record.plan_path !== null && typeof record.plan_path !== "string") ||
		(record.plan_signature !== null && typeof record.plan_signature !== "string") ||
		!Array.isArray(record.source_events) ||
		record.source_events.length === 0 ||
		record.source_events.length > 256
	) {
		throw new Error("authority observation seed fields are invalid");
	}
	const sourceEvents = record.source_events.map((value) => {
		const event = asRecord(value);
		if (
			Object.keys(event).sort().join(",") !== "action,at,id" ||
			typeof event.id !== "string" ||
			!event.id ||
			typeof event.action !== "string" ||
			!event.action ||
			(event.at !== null &&
				(typeof event.at !== "string" || !Number.isFinite(Date.parse(event.at))))
		) {
			throw new Error("authority observation seed source event is invalid");
		}
		return { id: event.id, action: event.action, at: event.at as string | null };
	});
	const shadow = asRecord(record.shadow);
	const divergence = asRecord(record.divergence);
	if (
		Object.keys(shadow).sort().join(",") !==
			"ambiguous,phase,reason,source_states" ||
		(shadow.phase !== null &&
			!['working', 'review', 'done', 'stopped'].includes(String(shadow.phase))) ||
		typeof shadow.reason !== "string" ||
		typeof shadow.ambiguous !== "boolean" ||
		!Array.isArray(shadow.source_states) ||
		shadow.source_states.length > 128 ||
		shadow.source_states.some((state) => typeof state !== "string") ||
		Object.keys(divergence).sort().join(",") !== "detected,fields" ||
		typeof divergence.detected !== "boolean" ||
		!Array.isArray(divergence.fields) ||
		divergence.fields.length > 128 ||
		divergence.fields.some((field) => typeof field !== "string")
	) {
		throw new Error("authority observation seed projection is invalid");
	}
	return {
		contract: "assurance_kernel/authority_observation_seed/v2",
		observer_version: AUTHORITY_OBSERVER_VERSION_V2,
		source_kind: record.source_kind,
		source_ref: record.source_ref,
		state_path_identity: record.state_path_identity,
		committed_bytes_sha256: record.committed_bytes_sha256,
		committed_revision: record.committed_revision,
		committed_at: record.committed_at,
		plan_path: record.plan_path as string | null,
		plan_signature: record.plan_signature as string | null,
		source_events: sourceEvents,
		shadow: {
			phase: shadow.phase as AuthorityObservationSeedV2["shadow"]["phase"],
			reason: shadow.reason,
			ambiguous: shadow.ambiguous,
			source_states: shadow.source_states as string[],
		},
		divergence: {
			detected: divergence.detected,
			fields: divergence.fields as string[],
		},
	};
}

function parseReceipt(value: unknown): AuthorityCommitReceipt {
	const record = asRecord(value);
	const v2 = record.contract === AUTHORITY_COMMIT_RECEIPT_V2_CONTRACT;
	const expectedKeys = [
		"after_sha256",
		"attempt_id",
		"before_sha256",
		"contract",
		"ledger_revision",
		...(v2 ? ["observation_generation", "observation_seed"] : []),
		"previous_record_hash",
		"record_id",
		"recorded_at",
		"source_kind",
		"source_ref",
		"state_path_identity",
		"status",
		"targets",
	].sort();
	if (Object.keys(record).sort().join(",") !== expectedKeys.join(",")) {
		throw new Error("authority receipt has unsupported fields");
	}
	if (
		record.contract !== AUTHORITY_COMMIT_RECEIPT_CONTRACT &&
		record.contract !== AUTHORITY_COMMIT_RECEIPT_V2_CONTRACT
	) {
		throw new Error("authority receipt contract is unsupported");
	}
	if (typeof record.record_id !== "string" || !SHA256_RE.test(record.record_id)) {
		throw new Error("authority receipt record_id is invalid");
	}
	if (typeof record.attempt_id !== "string" || !ATTEMPT_ID_RE.test(record.attempt_id)) {
		throw new Error("authority receipt attempt_id is invalid");
	}
	if (
		record.source_kind !== "state_mutation" &&
		record.source_kind !== "project_migration"
	) {
		throw new Error("authority receipt source_kind is invalid");
	}
	if (
		record.status !== "prepared" &&
		record.status !== "committed" &&
		record.status !== "aborted" &&
		record.status !== "recovered_committed" &&
		record.status !== "recovered_aborted"
	) {
		throw new Error("authority receipt status is invalid");
	}
	if (
		typeof record.state_path_identity !== "string" ||
		!SHA256_RE.test(record.state_path_identity) ||
		!Array.isArray(record.targets) ||
		record.targets.length === 0 ||
		(record.before_sha256 !== null &&
			(typeof record.before_sha256 !== "string" ||
				!SHA256_RE.test(record.before_sha256))) ||
		typeof record.after_sha256 !== "string" ||
		!SHA256_RE.test(record.after_sha256) ||
		typeof record.ledger_revision !== "string" ||
		!record.ledger_revision ||
		typeof record.source_ref !== "string" ||
		!record.source_ref ||
		(record.previous_record_hash !== null &&
			(typeof record.previous_record_hash !== "string" ||
				!SHA256_RE.test(record.previous_record_hash))) ||
		typeof record.recorded_at !== "string" ||
		!Number.isFinite(Date.parse(record.recorded_at))
	) {
		throw new Error("authority receipt fields are invalid");
	}
	const targets = record.targets.map(parseTarget);
	if (
		record.before_sha256 !== targets[0].before_sha256 ||
		record.after_sha256 !== targets[0].after_sha256
	) {
		throw new Error("authority receipt primary hashes do not match targets");
	}
	const observationSeed = v2
		? parseObservationSeed(record.observation_seed)
		: undefined;
	if (
		v2 &&
		(record.observation_generation !== AUTHORITY_OBSERVATION_GENERATION_V2 ||
			observationSeed!.observer_version !== AUTHORITY_OBSERVER_VERSION_V2 ||
			observationSeed!.committed_bytes_sha256 !== targets[0].after_sha256 ||
			observationSeed!.committed_revision !== record.ledger_revision)
	) {
		throw new Error("authority receipt observation seed binding is invalid");
	}
	return {
		contract: record.contract,
		record_id: record.record_id,
		attempt_id: record.attempt_id,
		source_kind: record.source_kind,
		status: record.status,
		state_path_identity: record.state_path_identity,
		targets,
		before_sha256: record.before_sha256 as string | null,
		after_sha256: record.after_sha256,
		ledger_revision: record.ledger_revision,
		source_ref: record.source_ref,
		previous_record_hash: record.previous_record_hash as string | null,
		recorded_at: record.recorded_at,
		...(v2
			? {
					observation_generation: AUTHORITY_OBSERVATION_GENERATION_V2,
					observation_seed: observationSeed,
				}
			: {}),
	};
}

function withoutRecordId(
	record: AuthorityCommitReceipt,
): Omit<AuthorityCommitReceipt, "record_id"> {
	const { record_id: _recordId, ...body } = record;
	return body;
}

function sameAttemptContract(
	prepared: AuthorityCommitReceipt,
	terminal: AuthorityCommitReceipt,
): boolean {
	return (
		prepared.contract === terminal.contract &&
		prepared.attempt_id === terminal.attempt_id &&
		prepared.source_kind === terminal.source_kind &&
		prepared.state_path_identity === terminal.state_path_identity &&
		stableStringify(prepared.targets) === stableStringify(terminal.targets) &&
		prepared.ledger_revision === terminal.ledger_revision &&
		prepared.source_ref === terminal.source_ref &&
		prepared.observation_generation === terminal.observation_generation &&
		stableStringify(prepared.observation_seed ?? null) ===
			stableStringify(terminal.observation_seed ?? null)
	);
}

export function readAuthorityCommitReceipts(
	statePath: string,
): AuthorityCommitReceipt[] {
	const journal = receiptJournalPath(statePath);
	if (!existsSync(journal)) return [];
	const stat = lstatSync(journal);
	if (stat.isSymbolicLink() || !stat.isFile()) {
		throw new Error("authority receipt journal must be a regular file");
	}
	const content = readFileSync(journal, "utf8");
	if (!content) return [];
	if (!content.endsWith("\n")) {
		throw new Error("authority receipt journal has a partial record");
	}
	const records = content
		.trimEnd()
		.split("\n")
		.map((line, index) => {
			try {
				return parseReceipt(JSON.parse(line));
			} catch (error) {
				throw new Error(
					`authority receipt line ${index + 1} is invalid: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		});
	const attempts = new Map<
		string,
		{ prepared: AuthorityCommitReceipt; terminal: AuthorityCommitReceipt | null }
	>();
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		const expectedPrevious = index === 0 ? null : records[index - 1].record_id;
		if (record.previous_record_hash !== expectedPrevious) {
			throw new Error(`authority receipt line ${index + 1} chain predecessor mismatch`);
		}
		if (recordHash(withoutRecordId(record)) !== record.record_id) {
			throw new Error(`authority receipt line ${index + 1} record hash mismatch`);
		}
		const current = attempts.get(record.attempt_id);
		if (record.status === "prepared") {
			if (current) throw new Error("authority receipt attempt_id was reused");
			attempts.set(record.attempt_id, { prepared: record, terminal: null });
			continue;
		}
		if (!current || current.terminal) {
			throw new Error("authority receipt terminal record has no unique prepared record");
		}
		if (!sameAttemptContract(current.prepared, record)) {
			throw new Error("authority receipt terminal record changed attempt identity");
		}
		current.terminal = record;
	}
	return records;
}

function appendReceipt(
	statePath: string,
	body: Omit<AuthorityCommitReceipt, "record_id" | "previous_record_hash">,
): AuthorityCommitReceipt {
	const records = readAuthorityCommitReceipts(statePath);
	const recordWithoutId: Omit<AuthorityCommitReceipt, "record_id"> = {
		...body,
		previous_record_hash:
			records.length === 0 ? null : records[records.length - 1].record_id,
	};
	beforeAppendForTest?.(recordWithoutId);
	const record: AuthorityCommitReceipt = {
		...recordWithoutId,
		record_id: recordHash(recordWithoutId),
	};
	const journal = receiptJournalPath(statePath);
	mkdirSync(dirname(journal), { recursive: true, mode: 0o700 });
	if (existsSync(journal) && lstatSync(journal).isSymbolicLink()) {
		throw new Error("authority receipt journal must not be a symlink");
	}
	const descriptor = openSync(
		journal,
		constants.O_WRONLY |
			constants.O_CREAT |
			constants.O_APPEND |
			(constants.O_NOFOLLOW ?? 0),
		0o600,
	);
	try {
		writeSync(descriptor, `${JSON.stringify(record)}\n`, undefined, "utf8");
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
	fsyncDirectory(dirname(journal));
	return record;
}

function pendingPrepared(records: AuthorityCommitReceipt[]): PreparedAuthorityCommit[] {
	const pending = new Map<string, PreparedAuthorityCommit>();
	for (const record of records) {
		if (record.status === "prepared") {
			pending.set(record.attempt_id, record as PreparedAuthorityCommit);
		} else {
			pending.delete(record.attempt_id);
		}
	}
	return [...pending.values()];
}

export function prepareAuthorityCommit(
	statePath: string,
	input: PrepareAuthorityCommitInput,
): PreparedAuthorityCommit {
	const records = readAuthorityCommitReceipts(statePath);
	if (pendingPrepared(records).length > 0) {
		throw new Error(
			"authority receipt has a pending attempt; recover it before another commit",
		);
	}
	if (!input.targets.length) throw new Error("authority commit requires targets");
	if (!input.ledger_revision.trim() || !input.source_ref.trim()) {
		throw new Error("authority commit revision and source_ref are required");
	}
	const root = projectRootForStatePath(statePath);
	const targets = input.targets.map((target) => ({
		path: targetPath(root, target.absolute_path),
		before_sha256:
			target.before_bytes === null ? null : sha256(target.before_bytes),
		after_sha256: sha256(target.after_bytes),
	}));
	const attemptId = input.attempt_id ?? randomUUID();
	if (!ATTEMPT_ID_RE.test(attemptId)) {
		throw new Error("authority commit attempt_id must be a random UUID v4");
	}
	const wantsV2 =
		input.observation_generation !== undefined ||
		input.observation_seed !== undefined;
	if (
		wantsV2 &&
		(input.observation_generation !== AUTHORITY_OBSERVATION_GENERATION_V2 ||
			input.observation_seed === undefined)
	) {
		throw new Error(
			"authority receipt v2 requires the supported observation generation and seed",
		);
	}
	if (
		wantsV2 &&
		(input.observation_seed!.committed_bytes_sha256 !== targets[0].after_sha256 ||
			input.observation_seed!.committed_revision !== input.ledger_revision)
	) {
		throw new Error("authority receipt v2 seed does not bind the committed target");
	}
	return appendReceipt(statePath, {
		contract: wantsV2
			? AUTHORITY_COMMIT_RECEIPT_V2_CONTRACT
			: AUTHORITY_COMMIT_RECEIPT_CONTRACT,
		attempt_id: attemptId,
		source_kind: input.source_kind,
		status: "prepared",
		state_path_identity: authorityStatePathIdentity(statePath),
		targets,
		before_sha256: targets[0].before_sha256,
		after_sha256: targets[0].after_sha256,
		ledger_revision: input.ledger_revision,
		source_ref: input.source_ref,
		recorded_at: new Date().toISOString(),
		...(wantsV2
			? {
					observation_generation: AUTHORITY_OBSERVATION_GENERATION_V2,
					observation_seed: input.observation_seed,
				}
			: {}),
	}) as PreparedAuthorityCommit;
}

export function terminalizeAuthorityCommit(
	statePath: string,
	prepared: PreparedAuthorityCommit,
	status: Exclude<AuthorityCommitReceiptStatus, "prepared">,
): AuthorityCommitReceipt {
	if (!TERMINAL_STATUSES.has(status)) {
		throw new Error("authority commit terminal status is invalid");
	}
	const records = readAuthorityCommitReceipts(statePath);
	const pending = pendingPrepared(records);
	if (
		pending.length !== 1 ||
		pending[0].attempt_id !== prepared.attempt_id ||
		!sameAttemptContract(pending[0], prepared)
	) {
		throw new Error("authority commit is not the unique pending attempt");
	}
	return appendReceipt(statePath, {
		contract: prepared.contract,
		attempt_id: prepared.attempt_id,
		source_kind: prepared.source_kind,
		status,
		state_path_identity: prepared.state_path_identity,
		targets: prepared.targets,
		before_sha256: prepared.before_sha256,
		after_sha256: prepared.after_sha256,
		ledger_revision: prepared.ledger_revision,
		source_ref: prepared.source_ref,
		recorded_at: new Date().toISOString(),
		...(prepared.contract === AUTHORITY_COMMIT_RECEIPT_V2_CONTRACT
			? {
					observation_generation: prepared.observation_generation,
					observation_seed: prepared.observation_seed,
				}
			: {}),
	});
}

export function recoverAuthorityCommitReceipts(
	statePath: string,
): AuthorityCommitReceipt[] {
	const root = projectRootForStatePath(statePath);
	const pending = pendingPrepared(readAuthorityCommitReceipts(statePath));
	const recovered: AuthorityCommitReceipt[] = [];
	for (const prepared of pending) {
		if (prepared.state_path_identity !== authorityStatePathIdentity(statePath)) {
			throw new Error("authority receipt recovery state path identity mismatch");
		}
		const current = prepared.targets.map((target) =>
			currentTargetHash(root, target),
		);
		const matchesBefore = current.every(
			(hash, index) => hash === prepared.targets[index].before_sha256,
		);
		const matchesAfter = current.every(
			(hash, index) => hash === prepared.targets[index].after_sha256,
		);
		if (matchesAfter) {
			recovered.push(
				terminalizeAuthorityCommit(
					statePath,
					prepared,
					"recovered_committed",
				),
			);
		} else if (matchesBefore) {
			recovered.push(
				terminalizeAuthorityCommit(
					statePath,
					prepared,
					"recovered_aborted",
				),
			);
		} else {
			throw new Error(
				`authority receipt recovery is ambiguous for attempt ${prepared.attempt_id}`,
			);
		}
	}
	return recovered;
}

export function setBeforeAuthorityReceiptAppendForTest(
	hook: ((record: Omit<AuthorityCommitReceipt, "record_id">) => void) | null,
): void {
	beforeAppendForTest = hook;
}
