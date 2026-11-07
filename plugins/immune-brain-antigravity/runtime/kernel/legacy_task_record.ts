/**
 * Frozen historical TaskRecord reader. TaskRecord v2 and v3 are no longer
 * live contracts: nothing in the reducer/validation/coordinator dispatch
 * accepts them. This module exists solely so `readAuditTaskPair` can keep
 * reading `.imm/audit/` evidence written before the v3 drain window closed.
 * Nothing here changes; it is relocated, not reimplemented.
 */
import {
	TASK_PHASES,
	TASK_RECORD_CONTRACT_V2,
	type ApprovalAuthorityRole,
	type ApprovalKind,
	type AuthorityAuditDescriptor,
	type EvidenceStatus,
	type TaskFinding,
	type TaskIntentRefV1,
	type TaskIntentV1,
	type TaskApprovalV2,
	type TaskPhase,
	type TaskRecordV3,
} from "./types";
import { canonicalIntentHash, parseTaskIntentV1 } from "./intent";
import {
	EVIDENCE_STATUSES,
	KernelInvariantError,
	KernelValidationError,
	SHA256_HEX,
	arrayAt,
	enumAt,
	objectAt,
	parseApprovalV2,
	parseFinding,
	parseTaskRecordAtVersion,
	positiveInteger,
	rejectUnknown,
	stringAt,
	uniqueIds,
} from "./validation";

export interface TaskEvidenceV2 {
	id: string;
	acceptance_id: string;
	task_revision: number;
	intent_content_hash: string;
	diff_hash: string;
	status: EvidenceStatus;
	actor_id: string;
	summary: string;
}

export interface TaskHistoryEntryV2 {
	id: string;
	at: string;
	type: string;
	from_phase: TaskPhase;
	to_phase: TaskPhase;
	reason: string;
	authority?: AuthorityAuditDescriptor;
}

export interface TaskRecordV2 {
	contract: typeof TASK_RECORD_CONTRACT_V2;
	task_id: string;
	intent_revision: number;
	intent_snapshot: TaskIntentV1;
	intent_ref: TaskIntentRefV1;
	artifact_ref?: { state: "active" | "frozen"; spec_path?: string };
	phase: TaskPhase;
	baseline: string;
	evidence: TaskEvidenceV2[];
	findings: TaskFinding[];
	approvals: TaskApprovalV2[];
	history: TaskHistoryEntryV2[];
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
	let authority: AuthorityAuditDescriptor | undefined;
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
			authority_kind: kind as AuthorityAuditDescriptor["authority_kind"],
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

export function parseTaskRecordV2(raw: unknown): TaskRecordV2 {
	const violations: string[] = [];
	const value = objectAt(raw, "record", violations);
	rejectUnknown(
		value,
		["contract", "task_id", "intent_revision", "intent_snapshot", "intent_ref", "artifact_ref", "phase", "baseline", "evidence", "findings", "approvals", "history"],
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

	let artifactRef: TaskRecordV2["artifact_ref"];
	if (value.artifact_ref !== undefined) {
		const artifactRaw = objectAt(value.artifact_ref, "record.artifact_ref", violations);
		rejectUnknown(artifactRaw, ["state", "spec_path"], "record.artifact_ref", violations);
		const state = enumAt(artifactRaw.state, ["active", "frozen"], "record.artifact_ref.state", violations) as "active" | "frozen";
		const specPath = artifactRaw.spec_path === undefined
			? undefined
			: stringAt(artifactRaw.spec_path, "record.artifact_ref.spec_path", violations);
		if (specPath !== undefined && (!/^docs\/specs\/(?!archive\/)[A-Za-z0-9._/-]+\.spec\.md$/.test(specPath) || specPath.includes("..")))
			violations.push("record.artifact_ref.spec_path must be one canonical active Spec path");
		artifactRef = { state, ...(specPath === undefined ? {} : { spec_path: specPath }) };
	}

	const activeIntentPath = `docs/plans/${taskId}.intent.json`;
	const frozenIntentPath = `docs/plans/archive/${taskId}.intent.json`;
	if (
		snapshot &&
		(snapshot.task_id !== taskId ||
			snapshot.revision !== intentRevision ||
			snapshot.revision !== refRevision ||
			(refPath !== activeIntentPath && refPath !== frozenIntentPath))
	)
		violations.push("intent_snapshot and intent_ref must match record identity");
	if (artifactRef?.state === "active" && refPath !== activeIntentPath)
		violations.push("active artifact_ref requires the active intent path");
	if (artifactRef?.state === "frozen" && refPath !== activeIntentPath && refPath !== frozenIntentPath)
		violations.push("frozen artifact_ref requires the active or archived intent path");
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
		...(artifactRef ? { artifact_ref: artifactRef } : {}),
		phase,
		baseline,
		evidence,
		findings,
		approvals,
		history,
	};
}

/** Strict v3 drain parser: unknown fields and revision identity stay illegal. */
export function parseTaskRecordV3(raw: unknown): TaskRecordV3 {
	return parseTaskRecordAtVersion(raw, 3) as TaskRecordV3;
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
