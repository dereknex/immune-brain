import {
	INTENT_CONTRACT,
	TASK_PHASES,
	TASK_RECORD_CONTRACT,
	TASK_RECORD_CONTRACT_V2,
	TASK_RISKS,
	type AcceptanceItem,
	type ApprovalAuthorityRole,
	type ApprovalKind,
	type EvidenceStatus,
	type FindingKind,
	type FindingSource,
	type FindingStatus,
	type TaskApproval,
	type TaskApprovalV2,
	type TaskActionV2,
	type AuthorityAuditDescriptorV2,
	type TaskEvidence,
	type TaskEvidenceV2,
	type TaskFinding,
	type TaskHistoryEntry,
	type TaskHistoryEntryV2,
	type TaskIntent,
	type TaskIntentV1,
	type TaskPhase,
	type TaskRecord,
	type TaskRecordV2,
	type UserAuthorityAudit,
} from "./types";
import { canonicalIntentHash, parseTaskIntentV1 } from "./intent";

export class KernelValidationError extends Error {
	readonly code = "kernel_schema_invalid";

	constructor(readonly violations: string[]) {
		super(violations.join("; "));
		this.name = "KernelValidationError";
	}
}

export class KernelInvariantError extends Error {
	readonly code = "kernel_invariant_violation";

	constructor(readonly violations: string[]) {
		super(violations.join("; "));
		this.name = "KernelInvariantError";
	}
}

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
			violations.push(
				path === "record" ? `unknown field: ${key}` : `unknown field: ${path}.${key}`,
			);
	}
}

function stringAt(
	value: unknown,
	path: string,
	violations: string[],
): string {
	if (typeof value !== "string" || !value.trim()) {
		violations.push(`${path} must be a non-empty string`);
		return "";
	}
	return value;
}

function positiveInteger(
	value: unknown,
	path: string,
	violations: string[],
): number {
	if (!Number.isInteger(value) || Number(value) < 1) {
		violations.push(`${path} must be a positive integer`);
		return 0;
	}
	return Number(value);
}

function nullableString(
	value: unknown,
	path: string,
	violations: string[],
): string | null {
	if (value === null) return null;
	return stringAt(value, path, violations);
}

function nullablePositiveInteger(
	value: unknown,
	path: string,
	violations: string[],
): number | null {
	if (value === null) return null;
	return positiveInteger(value, path, violations);
}

function enumAt<T extends string>(
	value: unknown,
	allowed: readonly T[],
	path: string,
	violations: string[],
): T {
	if (typeof value !== "string" || !allowed.includes(value as T)) {
		violations.push(`${path} must be one of ${allowed.join(", ")}`);
		return allowed[0];
	}
	return value as T;
}

function arrayAt(value: unknown, path: string, violations: string[]): unknown[] {
	if (!Array.isArray(value)) {
		violations.push(`${path} must be an array`);
		return [];
	}
	return value;
}

function uniqueIds(
	items: Array<{ id: string }>,
	path: string,
	violations: string[],
): void {
	const seen = new Set<string>();
	for (const item of items) {
		if (seen.has(item.id)) violations.push(`${path} contains duplicate id ${item.id}`);
		seen.add(item.id);
	}
}

function parseAcceptance(
	value: unknown,
	index: number,
	violations: string[],
): AcceptanceItem {
	const path = `intent.acceptance[${index}]`;
	const item = objectAt(value, path, violations);
	rejectUnknown(item, ["id", "text"], path, violations);
	return {
		id: stringAt(item.id, `${path}.id`, violations),
		text: stringAt(item.text, `${path}.text`, violations),
	};
}

export function parseTaskIntent(raw: unknown): TaskIntent {
	const violations: string[] = [];
	const value = objectAt(raw, "intent", violations);
	rejectUnknown(
		value,
		["contract", "task_id", "revision", "goal", "acceptance", "scope_hint", "risk"],
		"intent",
		violations,
	);
	if (value.contract !== INTENT_CONTRACT)
		violations.push(`contract must equal ${INTENT_CONTRACT}`);
	const acceptance = arrayAt(value.acceptance, "intent.acceptance", violations).map(
		(item, index) => parseAcceptance(item, index, violations),
	);
	if (acceptance.length === 0)
		violations.push("intent.acceptance must contain at least one item");
	uniqueIds(acceptance, "intent.acceptance", violations);
	const scopeHint = arrayAt(value.scope_hint, "intent.scope_hint", violations).map(
		(item, index) => stringAt(item, `intent.scope_hint[${index}]`, violations),
	);
	const parsed: TaskIntent = {
		contract: INTENT_CONTRACT,
		task_id: stringAt(value.task_id, "intent.task_id", violations),
		revision: positiveInteger(value.revision, "revision", violations),
		goal: stringAt(value.goal, "intent.goal", violations),
		acceptance,
		scope_hint: scopeHint,
		risk: enumAt(value.risk, TASK_RISKS, "intent.risk", violations),
	};
	if (violations.length > 0) throw new KernelValidationError(violations);
	return parsed;
}

const EVIDENCE_STATUSES: EvidenceStatus[] = ["passed", "failed", "blocked"];
const FINDING_KINDS: FindingKind[] = [
	"blocking",
	"advisory",
	"unresolved_user_decision",
	"replan_required",
];
const FINDING_STATUSES: FindingStatus[] = ["open", "resolved"];
const FINDING_SOURCES: FindingSource[] = [
	"execution",
	"review",
	"kernel",
	"migration",
];
const APPROVAL_KINDS: ApprovalKind[] = ["review", "qa", "user"];
const APPROVAL_AUTHORITY_ROLES: ApprovalAuthorityRole[] = [
	"reviewer",
	"qa",
	"user",
];

function parseEvidence(
	value: unknown,
	index: number,
	violations: string[],
): TaskEvidence {
	const path = `record.evidence[${index}]`;
	const item = objectAt(value, path, violations);
	rejectUnknown(
		item,
		["id", "acceptance_id", "task_revision", "diff_hash", "status", "actor_id", "summary"],
		path,
		violations,
	);
	return {
		id: stringAt(item.id, `${path}.id`, violations),
		acceptance_id: stringAt(item.acceptance_id, `${path}.acceptance_id`, violations),
		task_revision: positiveInteger(item.task_revision, `${path}.task_revision`, violations),
		diff_hash: stringAt(item.diff_hash, `${path}.diff_hash`, violations),
		status: enumAt(item.status, EVIDENCE_STATUSES, `${path}.status`, violations),
		actor_id: stringAt(item.actor_id, `${path}.actor_id`, violations),
		summary: stringAt(item.summary, `${path}.summary`, violations),
	};
}

function parseFinding(
	value: unknown,
	index: number,
	violations: string[],
): TaskFinding {
	const path = `record.findings[${index}]`;
	const item = objectAt(value, path, violations);
	rejectUnknown(
		item,
		["id", "kind", "status", "acceptance_id", "source", "review_round", "summary"],
		path,
		violations,
	);
	return {
		id: stringAt(item.id, `${path}.id`, violations),
		kind: enumAt(item.kind, FINDING_KINDS, `${path}.kind`, violations),
		status: enumAt(item.status, FINDING_STATUSES, `${path}.status`, violations),
		acceptance_id: nullableString(item.acceptance_id, `${path}.acceptance_id`, violations),
		source: enumAt(item.source, FINDING_SOURCES, `${path}.source`, violations),
		review_round: nullablePositiveInteger(item.review_round, `${path}.review_round`, violations),
		summary: stringAt(item.summary, `${path}.summary`, violations),
	};
}

function parseApproval(
	value: unknown,
	index: number,
	violations: string[],
): TaskApproval {
	const path = `record.approvals[${index}]`;
	const item = objectAt(value, path, violations);
	rejectUnknown(
		item,
		[
			"id",
			"kind",
			"authority_role",
			"task_revision",
			"diff_hash",
			"actor_id",
			"summary",
		],
		path,
		violations,
	);
	return {
		id: stringAt(item.id, `${path}.id`, violations),
		kind: enumAt(item.kind, APPROVAL_KINDS, `${path}.kind`, violations),
		authority_role: enumAt(
			item.authority_role,
			APPROVAL_AUTHORITY_ROLES,
			`${path}.authority_role`,
			violations,
		),
		task_revision: positiveInteger(item.task_revision, `${path}.task_revision`, violations),
		diff_hash: stringAt(item.diff_hash, `${path}.diff_hash`, violations),
		actor_id: stringAt(item.actor_id, `${path}.actor_id`, violations),
		summary: stringAt(item.summary, `${path}.summary`, violations),
	};
}

function parseUserAuthorityAudit(
	value: unknown,
	path: string,
	violations: string[],
): UserAuthorityAudit {
	const item = objectAt(value, path, violations);
	rejectUnknown(
		item,
		["actor_id", "source", "confirmation_ref"],
		path,
		violations,
	);
	if (item.source !== "literal_user")
		violations.push(`${path}.source must equal literal_user`);
	return {
		actor_id: stringAt(item.actor_id, `${path}.actor_id`, violations),
		source: "literal_user",
		confirmation_ref: stringAt(
			item.confirmation_ref,
			`${path}.confirmation_ref`,
			violations,
		),
	};
}

function parseHistoryV2(
	value: unknown,
	index: number,
	violations: string[],
): TaskHistoryEntryV2 {
	const item = objectAt(value, `record.history[${index}]`, violations);
	rejectUnknown(
		item,
		["id", "at", "type", "from_phase", "to_phase", "reason", "authority"],
		`record.history[${index}]`,
		violations,
	);
	let authority: AuthorityAuditDescriptorV2 | undefined;
	if (item.authority !== undefined) {
		const auth = objectAt(item.authority, `record.history[${index}].authority`, violations);
		rejectUnknown(
			auth,
			["authority_kind", "actor_id", "confirmation_ref", "issued_at", "expires_at"],
			`record.history[${index}].authority`,
			violations,
		);
		const kind = enumAt(
			auth.authority_kind,
			["review", "qa", "user"],
			`record.history[${index}].authority.authority_kind`,
			violations,
		);
		authority = {
			authority_kind: kind as AuthorityAuditDescriptorV2["authority_kind"],
			actor_id: stringAt(auth.actor_id, `record.history[${index}].authority.actor_id`, violations),
			confirmation_ref: stringAt(auth.confirmation_ref, `record.history[${index}].authority.confirmation_ref`, violations),
			issued_at: stringAt(auth.issued_at, `record.history[${index}].authority.issued_at`, violations),
			expires_at: stringAt(auth.expires_at, `record.history[${index}].authority.expires_at`, violations),
		};
	}
	return {
		id: stringAt(item.id, `record.history[${index}].id`, violations),
		at: stringAt(item.at, `record.history[${index}].at`, violations),
		type: stringAt(item.type, `record.history[${index}].type`, violations),
		from_phase: enumAt(item.from_phase, TASK_PHASES, `record.history[${index}].from_phase`, violations),
		to_phase: enumAt(item.to_phase, TASK_PHASES, `record.history[${index}].to_phase`, violations),
		reason: stringAt(item.reason, `record.history[${index}].reason`, violations),
		...(authority ? { authority } : {}),
	};
}

function parseHistory(
	value: unknown,
	index: number,
	violations: string[],
): TaskHistoryEntry {
	const path = `record.history[${index}]`;
	const item = objectAt(value, path, violations);
	rejectUnknown(
		item,
		["id", "at", "type", "from_phase", "to_phase", "reason", "authority"],
		path,
		violations,
	);
	const nullablePhase = (raw: unknown, field: string): TaskPhase | null =>
		raw === null ? null : enumAt(raw, TASK_PHASES, field, violations);
	const parsed: TaskHistoryEntry = {
		id: stringAt(item.id, `${path}.id`, violations),
		at: stringAt(item.at, `${path}.at`, violations),
		type: stringAt(item.type, `${path}.type`, violations),
		from_phase: nullablePhase(item.from_phase, `${path}.from_phase`),
		to_phase: nullablePhase(item.to_phase, `${path}.to_phase`),
		reason: nullableString(item.reason, `${path}.reason`, violations),
	};
	if (item.authority !== undefined)
		parsed.authority = parseUserAuthorityAudit(
			item.authority,
			`${path}.authority`,
			violations,
		);
	return parsed;
}

export function parseTaskRecord(raw: unknown): TaskRecord {
	const violations: string[] = [];
	const value = objectAt(raw, "record", violations);
	rejectUnknown(
		value,
		["contract", "task_id", "intent_revision", "phase", "baseline", "evidence", "findings", "approvals", "history"],
		"record",
		violations,
	);
	if (value.contract !== TASK_RECORD_CONTRACT)
		violations.push(`contract must equal ${TASK_RECORD_CONTRACT}`);
	const evidence = arrayAt(value.evidence, "record.evidence", violations).map(
		(item, index) => parseEvidence(item, index, violations),
	);
	const findings = arrayAt(value.findings, "record.findings", violations).map(
		(item, index) => parseFinding(item, index, violations),
	);
	const approvals = arrayAt(value.approvals, "record.approvals", violations).map(
		(item, index) => parseApproval(item, index, violations),
	);
	const history = arrayAt(value.history, "record.history", violations).map(
		(item, index) => parseHistory(item, index, violations),
	);
	uniqueIds(evidence, "record.evidence", violations);
	uniqueIds(findings, "record.findings", violations);
	uniqueIds(approvals, "record.approvals", violations);
	uniqueIds(history, "record.history", violations);
	const parsed: TaskRecord = {
		contract: TASK_RECORD_CONTRACT,
		task_id: stringAt(value.task_id, "record.task_id", violations),
		intent_revision: positiveInteger(
			value.intent_revision,
			"record.intent_revision",
			violations,
		),
		phase: enumAt(value.phase, TASK_PHASES, "phase", violations),
		baseline: stringAt(value.baseline, "record.baseline", violations),
		evidence,
		findings,
		approvals,
		history,
	};
	if (violations.length > 0) throw new KernelValidationError(violations);
	return parsed;
}

function sameJson(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function assertKernelInvariants(
	intentRaw: TaskIntent,
	recordRaw: TaskRecord,
): void {
	const intent = parseTaskIntent(intentRaw);
	const record = parseTaskRecord(recordRaw);
	const violations: string[] = [];
	if (intent.task_id !== record.task_id)
		violations.push("intent and record task_id must match");
	if (intent.revision !== record.intent_revision)
		violations.push("intent revision and record intent_revision must match");
	const acceptanceIds = new Set(intent.acceptance.map((item) => item.id));
	for (const evidence of record.evidence) {
		if (!acceptanceIds.has(evidence.acceptance_id))
			violations.push(
				`evidence ${evidence.id} references unknown acceptance ${evidence.acceptance_id}`,
			);
	}
	for (const finding of record.findings) {
		if (finding.acceptance_id && !acceptanceIds.has(finding.acceptance_id))
			violations.push(
				`finding ${finding.id} references unknown acceptance ${finding.acceptance_id}`,
			);
	}
	const requiredRole: Record<ApprovalKind, ApprovalAuthorityRole> = {
		review: "reviewer",
		qa: "qa",
		user: "user",
	};
	for (const approval of record.approvals) {
		if (approval.authority_role !== requiredRole[approval.kind])
			violations.push(
				`approval ${approval.id} kind ${approval.kind} requires authority_role ${requiredRole[approval.kind]}`,
			);
	}
	if (violations.length > 0) throw new KernelInvariantError(violations);
}

const RISK_RANK = { routine: 0, material: 1, critical: 2 } as const;

export function assertIntentUpdate(
	previousRaw: TaskIntent,
	nextRaw: TaskIntent,
	recordRaw: TaskRecord,
): void {
	const previous = parseTaskIntent(previousRaw);
	const next = parseTaskIntent(nextRaw);
	const record = parseTaskRecord(recordRaw);
	const violations: string[] = [];
	if (previous.task_id !== next.task_id || previous.task_id !== record.task_id)
		violations.push("intent update must preserve task_id");
	if (next.revision < previous.revision)
		violations.push("intent revision cannot decrease");
	if (RISK_RANK[next.risk] < RISK_RANK[previous.risk])
		violations.push("risk cannot be downgraded");
	const contractChanged =
		previous.goal !== next.goal ||
		!sameJson(previous.acceptance, next.acceptance);
	if (contractChanged && next.revision <= previous.revision)
		violations.push("goal or acceptance changes require a revision bump");
	if (next.risk !== previous.risk && next.revision <= previous.revision)
		violations.push("risk changes require a revision bump");
	if (violations.length > 0) throw new KernelInvariantError(violations);
}

const ALLOWED_PHASE_TRANSITIONS: Record<TaskPhase, TaskPhase[]> = {
	working: ["review", "stopped"],
	review: ["working", "done", "stopped"],
	done: [],
	stopped: [],
};

export function assertTaskRecordUpdate(
	previousRaw: TaskRecord,
	nextRaw: TaskRecord,
): void {
	const previous = parseTaskRecord(previousRaw);
	const next = parseTaskRecord(nextRaw);
	const violations: string[] = [];
	if (previous.task_id !== next.task_id)
		violations.push("task record update must preserve task_id");
	if (next.intent_revision < previous.intent_revision)
		violations.push("record intent_revision cannot decrease");
	if (
		previous.phase !== next.phase &&
		!ALLOWED_PHASE_TRANSITIONS[previous.phase].includes(next.phase)
	)
		violations.push(`illegal phase transition: ${previous.phase} -> ${next.phase}`);
	if (next.history.length < previous.history.length)
		violations.push("history is append-only");
	else {
		for (let index = 0; index < previous.history.length; index += 1) {
			if (!sameJson(previous.history[index], next.history[index])) {
				violations.push(`history entry ${index} is immutable`);
				break;
			}
		}
	}
	if (violations.length > 0) throw new KernelInvariantError(violations);
}

// ---------------------------------------------------------------------------
// P2C1 additive TaskRecord v2 parser/invariants.
// v1 APIs above remain byte-for-byte unchanged and stay v1-only.
// ---------------------------------------------------------------------------

const SHA256_HEX = /^sha256:[a-f0-9]{64}$/;

function parseEvidenceV2(
	value: unknown,
	index: number,
	acceptanceIds: Set<string> | null,
	violations: string[],
): TaskEvidenceV2 {
	const item = objectAt(value, `record.evidence[${index}]`, violations);
	rejectUnknown(
		item,
		["id", "acceptance_id", "task_revision", "intent_content_hash", "diff_hash", "status", "actor_id", "summary"],
		`record.evidence[${index}]`,
		violations,
	);
	const acceptanceId = stringAt(
		item.acceptance_id,
		`record.evidence[${index}].acceptance_id`,
		violations,
	);
	if (acceptanceIds && !acceptanceIds.has(acceptanceId))
		violations.push(
			`evidence ${String(item.id)} references unknown acceptance ${acceptanceId}`,
		);
	const intentContentHash = stringAt(
		item.intent_content_hash,
		`record.evidence[${index}].intent_content_hash`,
		violations,
	);
	if (!SHA256_HEX.test(intentContentHash))
		violations.push(`record.evidence[${index}].intent_content_hash must be sha256:<64 hex>`);
	const diffHash = stringAt(item.diff_hash, `record.evidence[${index}].diff_hash`, violations);
	if (!SHA256_HEX.test(diffHash))
		violations.push(`record.evidence[${index}].diff_hash must be sha256:<64 hex>`);
	return {
		id: stringAt(item.id, `record.evidence[${index}].id`, violations),
		acceptance_id: acceptanceId,
		task_revision: positiveInteger(
			item.task_revision,
			`record.evidence[${index}].task_revision`,
			violations,
		),
		intent_content_hash: intentContentHash,
		diff_hash: diffHash,
		status: enumAt(item.status, EVIDENCE_STATUSES, `record.evidence[${index}].status`, violations),
		actor_id: stringAt(item.actor_id, `record.evidence[${index}].actor_id`, violations),
		summary: stringAt(item.summary, `record.evidence[${index}].summary`, violations),
	};
}

function parseApprovalV2(
	value: unknown,
	index: number,
	violations: string[],
): TaskApprovalV2 {
	const item = objectAt(value, `record.approvals[${index}]`, violations);
	rejectUnknown(
		item,
		["id", "kind", "authority_role", "task_revision", "intent_content_hash", "diff_hash", "actor_id", "summary"],
		`record.approvals[${index}]`,
		violations,
	);
	const intentContentHash = stringAt(
		item.intent_content_hash,
		`record.approvals[${index}].intent_content_hash`,
		violations,
	);
	if (!SHA256_HEX.test(intentContentHash))
		violations.push(`record.approvals[${index}].intent_content_hash must be sha256:<64 hex>`);
	const diffHash = stringAt(item.diff_hash, `record.approvals[${index}].diff_hash`, violations);
	if (!SHA256_HEX.test(diffHash))
		violations.push(`record.approvals[${index}].diff_hash must be sha256:<64 hex>`);
	return {
		id: stringAt(item.id, `record.approvals[${index}].id`, violations),
		kind: enumAt(item.kind, APPROVAL_KINDS, `record.approvals[${index}].kind`, violations),
		authority_role: enumAt(
			item.authority_role,
			APPROVAL_AUTHORITY_ROLES,
			`record.approvals[${index}].authority_role`,
			violations,
		),
		task_revision: positiveInteger(
			item.task_revision,
			`record.approvals[${index}].task_revision`,
			violations,
		),
		intent_content_hash: intentContentHash,
		diff_hash: diffHash,
		actor_id: stringAt(item.actor_id, `record.approvals[${index}].actor_id`, violations),
		summary: stringAt(item.summary, `record.approvals[${index}].summary`, violations),
	};
}

export function parseTaskRecordV2(raw: unknown): TaskRecordV2 {
	const violations: string[] = [];
	const value = objectAt(raw, "record", violations);
	rejectUnknown(
		value,
		["contract", "task_id", "intent_revision", "intent_snapshot", "intent_ref", "phase", "baseline", "evidence", "findings", "approvals", "history"],
		"record",
		violations,
	);
	if (value.contract !== TASK_RECORD_CONTRACT_V2)
		violations.push(`contract must equal ${TASK_RECORD_CONTRACT_V2}`);

	let snapshot: TaskIntentV1 | null = null;
	try {
		snapshot = parseTaskIntentV1(value.intent_snapshot);
	} catch {
		violations.push("record.intent_snapshot must be a valid TaskIntent v1");
	}

	const taskId = stringAt(value.task_id, "record.task_id", violations);
	const intentRevision = positiveInteger(
		value.intent_revision,
		"record.intent_revision",
		violations,
	);

	const refRaw = objectAt(value.intent_ref, "record.intent_ref", violations);
	rejectUnknown(refRaw, ["path", "revision", "content_hash"], "record.intent_ref", violations);
	const refPath = stringAt(refRaw.path, "record.intent_ref.path", violations);
	const refRevision = positiveInteger(
		refRaw.revision,
		"record.intent_ref.revision",
		violations,
	);
	const refContentHash = stringAt(
		refRaw.content_hash,
		"record.intent_ref.content_hash",
		violations,
	);
	if (!SHA256_HEX.test(refContentHash))
		violations.push("record.intent_ref.content_hash must be sha256:<64 hex>");

	if (
		snapshot &&
		(snapshot.task_id !== taskId ||
			snapshot.revision !== intentRevision ||
			snapshot.revision !== refRevision ||
			refPath !== `docs/plans/${taskId}.intent.json`)
	)
		violations.push("intent_snapshot and intent_ref must match record identity");
	if (
		snapshot &&
		refContentHash !== "" &&
		canonicalIntentHash(snapshot) !== refContentHash
	)
		violations.push("intent_ref.content_hash must equal the snapshot canonical hash");

	const baseline = stringAt(value.baseline, "record.baseline", violations);
	if (!SHA256_HEX.test(baseline))
		violations.push("record.baseline must be sha256:<64 hex>");

	const acceptanceIds = new Set(
		snapshot ? snapshot.acceptance.map((item) => item.id) : [],
	);
	const evidence = arrayAt(value.evidence, "record.evidence", violations).map(
		(item, index) => parseEvidenceV2(item, index, acceptanceIds, violations),
	);
	const findings = arrayAt(value.findings, "record.findings", violations).map(
		(item, index) => parseFinding(item, index, violations),
	);
	const approvals = arrayAt(value.approvals, "record.approvals", violations).map(
		(item, index) => parseApprovalV2(item, index, violations),
	);
	const history = arrayAt(value.history, "record.history", violations).map(
		(item, index) => parseHistoryV2(item, index, violations),
	);
	uniqueIds(evidence, "record.evidence", violations);
	uniqueIds(findings, "record.findings", violations);
	uniqueIds(approvals, "record.approvals", violations);
	uniqueIds(history, "record.history", violations);

	const phase = enumAt(value.phase, TASK_PHASES, "phase", violations);

	if (violations.length > 0) throw new KernelValidationError(violations);
	return {
		contract: TASK_RECORD_CONTRACT_V2,
		task_id: taskId,
		intent_revision: intentRevision,
		intent_snapshot: snapshot as TaskIntentV1,
		intent_ref: {
			path: refPath,
			revision: refRevision,
			content_hash: refContentHash,
		},
		phase,
		baseline,
		evidence,
		findings,
		approvals,
		history,
	};
}

export function assertKernelInvariantsV2(
	intentRaw: TaskIntentV1,
	recordRaw: TaskRecordV2,
): void {
	const intent = parseTaskIntentV1(intentRaw);
	const record = parseTaskRecordV2(recordRaw);
	const violations: string[] = [];
	if (intent.task_id !== record.task_id)
		violations.push("intent and record task_id must match");
	if (intent.revision !== record.intent_revision)
		violations.push("intent revision and record intent_revision must match");
	if (canonicalIntentHash(record.intent_snapshot) !== record.intent_ref.content_hash)
		violations.push("record intent_ref.content_hash must match its snapshot");
	const requiredRole: Record<ApprovalKind, ApprovalAuthorityRole> = {
		review: "reviewer",
		qa: "qa",
		user: "user",
	};
	for (const approval of record.approvals) {
		if (approval.authority_role !== requiredRole[approval.kind])
			violations.push(
				`approval ${approval.id} kind ${approval.kind} requires authority_role ${requiredRole[approval.kind]}`,
			);
	}
	if (violations.length > 0) throw new KernelInvariantError(violations);
}

// ---------------------------------------------------------------------------
// R2C2 TaskActionV2 strict parser and update invariants.
// ---------------------------------------------------------------------------

const ACTION_V2_TYPES = [
	"record_evidence",
	"record_finding",
	"resolve_finding",
	"record_approval",
	"record_user_approval",
	"revise_intent",
	"approve_breaking_intent_revision",
	"submit_review",
	"request_rework",
	"complete",
	"stop",
	"resolve_user_decision",
] as const;

const ACTION_BASE_FIELDS = [
	"type",
	"event_id",
	"at",
	"actor_id",
	"expected_record_hash",
	"expected_workspace_hash",
	"diff_hash",
] as const;

function parseActionBase(
	value: Record<string, unknown>,
	path: string,
	violations: string[],
): {
	type: (typeof ACTION_V2_TYPES)[number];
	event_id: string;
	at: string;
	actor_id: string;
	expected_record_hash: string;
	expected_workspace_hash: string;
	diff_hash: string;
} {
	const type = enumAt(value.type, ACTION_V2_TYPES as unknown as string[], `${path}.type`, violations);
	for (const field of ACTION_BASE_FIELDS) {
		if (field !== "type" && !(field in value))
			violations.push(`${path}.${field} is required`);
	}
	return {
		type: type as (typeof ACTION_V2_TYPES)[number],
		event_id: stringAt(value.event_id, `${path}.event_id`, violations),
		at: stringAt(value.at, `${path}.at`, violations),
		actor_id: stringAt(value.actor_id, `${path}.actor_id`, violations),
		expected_record_hash: stringAt(
			value.expected_record_hash,
			`${path}.expected_record_hash`,
			violations,
		),
		expected_workspace_hash: stringAt(
			value.expected_workspace_hash,
			`${path}.expected_workspace_hash`,
			violations,
		),
		diff_hash: stringAt(value.diff_hash, `${path}.diff_hash`, violations),
	};
}

export function parseTaskActionV2(raw: unknown): TaskActionV2 {
	const violations: string[] = [];
	const value = objectAt(raw, "action", violations);
	const base = parseActionBase(value, "action", violations);
	if (!SHA256_HEX.test(base.expected_record_hash))
		violations.push("action.expected_record_hash must be sha256:<64 hex>");
	if (!SHA256_HEX.test(base.expected_workspace_hash))
		violations.push("action.expected_workspace_hash must be sha256:<64 hex>");
	if (!SHA256_HEX.test(base.diff_hash))
		violations.push("action.diff_hash must be sha256:<64 hex>");

	let action: TaskActionV2 | null = null;
	switch (base.type) {
		case "record_evidence": {
			rejectUnknown(
				value,
				[...ACTION_BASE_FIELDS, "evidence"],
				"action",
				violations,
			);
			const evidence = parseEvidenceV2(
				value.evidence,
				0,
				null,
				violations,
			);
			action = { ...base, type: "record_evidence", evidence };
			break;
		}
		case "record_finding": {
			rejectUnknown(
				value,
				[...ACTION_BASE_FIELDS, "finding"],
				"action",
				violations,
			);
			action = {
				...base,
				type: "record_finding",
				finding: parseFinding(value.finding, 0, violations),
			};
			break;
		}
		case "resolve_finding": {
			rejectUnknown(
				value,
				[...ACTION_BASE_FIELDS, "finding_id"],
				"action",
				violations,
			);
			action = {
				...base,
				type: "resolve_finding",
				finding_id: stringAt(
					value.finding_id,
					"action.finding_id",
					violations,
				),
			};
			break;
		}
		case "record_approval":
		case "record_user_approval": {
			rejectUnknown(
				value,
				[...ACTION_BASE_FIELDS, "approval"],
				"action",
				violations,
			);
			const approval = parseApprovalV2(value.approval, 0, violations);
			action = {
				...base,
				type: base.type,
				approval,
			};
			break;
		}
		case "revise_intent":
		case "approve_breaking_intent_revision": {
			rejectUnknown(
				value,
				[...ACTION_BASE_FIELDS, "next_intent", "next_intent_ref"],
				"action",
				violations,
			);
			let nextIntent: TaskIntentV1 | null = null;
			try {
				nextIntent = parseTaskIntentV1(value.next_intent);
			} catch {
				violations.push("action.next_intent must be a valid TaskIntent v1");
			}
			const refRaw = objectAt(
				value.next_intent_ref,
				"action.next_intent_ref",
				violations,
			);
			rejectUnknown(
				refRaw,
				["path", "revision", "content_hash"],
				"action.next_intent_ref",
				violations,
			);
			const refPath = stringAt(
				refRaw.path,
				"action.next_intent_ref.path",
				violations,
			);
			const refRevision = positiveInteger(
				refRaw.revision,
				"action.next_intent_ref.revision",
				violations,
			);
			const refContentHash = stringAt(
				refRaw.content_hash,
				"action.next_intent_ref.content_hash",
				violations,
			);
			if (!SHA256_HEX.test(refContentHash))
				violations.push(
					"action.next_intent_ref.content_hash must be sha256:<64 hex>",
				);
			action = {
				...base,
				type: base.type,
				next_intent: nextIntent as TaskIntentV1,
				next_intent_ref: {
					path: refPath,
					revision: refRevision,
					content_hash: refContentHash,
				},
			};
			break;
		}
		case "submit_review":
		case "complete": {
			rejectUnknown(value, [...ACTION_BASE_FIELDS], "action", violations);
			action = { ...base, type: base.type };
			break;
		}
		case "request_rework": {
			rejectUnknown(
				value,
				[...ACTION_BASE_FIELDS, "findings"],
				"action",
				violations,
			);
			const findings = arrayAt(
				value.findings,
				"action.findings",
				violations,
			).map((item, index) => parseFinding(item, index, violations));
			if (findings.length === 0)
				violations.push("action.findings must contain at least one finding");
			action = { ...base, type: "request_rework", findings };
			break;
		}
		case "stop": {
			rejectUnknown(value, [...ACTION_BASE_FIELDS, "reason"], "action", violations);
			action = {
				...base,
				type: "stop",
				reason: stringAt(value.reason, "action.reason", violations),
			};
			break;
		}
		case "resolve_user_decision": {
			rejectUnknown(
				value,
				[...ACTION_BASE_FIELDS, "finding_id", "resolution"],
				"action",
				violations,
			);
			action = {
				...base,
				type: "resolve_user_decision",
				finding_id: stringAt(
					value.finding_id,
					"action.finding_id",
					violations,
				),
				resolution: stringAt(
					value.resolution,
					"action.resolution",
					violations,
				),
			};
			break;
		}
	}

	if (violations.length > 0) throw new KernelValidationError(violations);
	return action as TaskActionV2;
}

export function assertTaskRecordUpdateV2(
	previousRaw: TaskRecordV2,
	nextRaw: TaskRecordV2,
	action: TaskActionV2,
): void {
	const previous = parseTaskRecordV2(previousRaw);
	const next = parseTaskRecordV2(nextRaw);
	const violations: string[] = [];

	if (next.contract !== previous.contract)
		violations.push("record contract must remain immutable");
	if (next.task_id !== previous.task_id)
		violations.push("record task_id must remain immutable");
	if (next.baseline !== previous.baseline)
		violations.push("record baseline must remain immutable");

	const isIntentAction =
		action.type === "revise_intent" ||
		action.type === "approve_breaking_intent_revision";

	if (isIntentAction) {
		if (
			next.intent_snapshot.task_id !== previous.intent_snapshot.task_id ||
			next.intent_snapshot.goal !== previous.intent_snapshot.goal ||
			next.intent_snapshot.owner !== previous.intent_snapshot.owner
		)
			violations.push("intent revision cannot change task identity, goal, or owner");
		if (
			next.intent_revision !== next.intent_snapshot.revision ||
			next.intent_revision !== next.intent_ref.revision
		)
			violations.push("intent_revision must equal snapshot and ref revision");
	} else {
		if (next.intent_revision !== previous.intent_revision)
			violations.push("non-intent action cannot change intent_revision");
		if (
			next.intent_snapshot.task_id !== previous.intent_snapshot.task_id ||
			next.intent_snapshot.goal !== previous.intent_snapshot.goal ||
			next.intent_snapshot.risk !== previous.intent_snapshot.risk ||
			next.intent_snapshot.revision !== previous.intent_snapshot.revision ||
			next.intent_snapshot.owner !== previous.intent_snapshot.owner ||
			canonicalIntentHash(next.intent_snapshot) !==
				canonicalIntentHash(previous.intent_snapshot)
		)
			violations.push("non-intent action cannot change the intent snapshot");
		if (
			next.intent_ref.path !== previous.intent_ref.path ||
			next.intent_ref.revision !== previous.intent_ref.revision ||
			next.intent_ref.content_hash !== previous.intent_ref.content_hash
		)
			violations.push("non-intent action cannot change intent_ref");
	}

	// Append-only collections except resolve_* transitions and the closed
	// request_rework review batch.
	if (next.evidence.length < previous.evidence.length)
		violations.push("evidence is append-only");
	if (next.approvals.length < previous.approvals.length)
		violations.push("approvals are append-only");
	if (next.history.length !== previous.history.length + 1)
		violations.push("exactly one history entry must be appended");

	for (const prior of previous.evidence) {
		const current = next.evidence.find((item) => item.id === prior.id);
		if (!current || JSON.stringify(current) !== JSON.stringify(prior))
			violations.push(`evidence item ${prior.id} was rewritten`);
	}
	for (const prior of previous.approvals) {
		const current = next.approvals.find((item) => item.id === prior.id);
		if (!current || JSON.stringify(current) !== JSON.stringify(prior))
			violations.push(`approval item ${prior.id} was rewritten`);
	}
	const resolvingFindingIds =
		action.type === "resolve_finding"
			? [action.finding_id]
			: action.type === "resolve_user_decision"
				? [action.finding_id]
				: action.type === "approve_breaking_intent_revision"
					? previous.findings
						.filter((item) => item.kind === "replan_required" && item.status === "open")
						.map((item) => item.id)
					: [];
	const reworkFindingIds =
		action.type === "request_rework"
			? new Set(action.findings.map((item) => item.id))
			: new Set<string>();
	for (const prior of previous.findings) {
		const current = next.findings.find((item) => item.id === prior.id);
		if (!current)
			violations.push(`finding item ${prior.id} was removed`);
		else if (
			JSON.stringify(current) !== JSON.stringify(prior) &&
			!(
				resolvingFindingIds.includes(prior.id) &&
				prior.status === "open" &&
				current.status === "resolved"
			) &&
			!(reworkFindingIds.has(prior.id) && current.review_round !== null)
		)
			violations.push(`finding item ${prior.id} was rewritten`);
	}

	if (violations.length > 0) throw new KernelInvariantError(violations);
}
