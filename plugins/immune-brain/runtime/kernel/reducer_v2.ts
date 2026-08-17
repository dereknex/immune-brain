// R2C2 pure TaskRecord v2 reducer with a closed factual action vocabulary.
// Never reads files, Git, workspace, or host context. Returns a branded
// ReducedTaskMutationV2; the caller cannot construct or serialize it.

import { createHash } from "node:crypto";
import { completionDecisionV2 } from "./completion";
import {
	REDUCED_MUTATION_BRAND,
	type AuthorityAuditDescriptorV2,
	type ReducedTaskMutationV2,
	type TaskActionV2,
	type TaskFinding,
	type TaskIntentRefV1,
	type TaskIntentV1,
	type TaskPhase,
	type TaskRecordV2,
} from "./types";
import {
	KernelInvariantError,
	assertKernelInvariantsV2,
	assertTaskRecordUpdateV2,
	parseTaskActionV2,
	parseTaskRecordV2,
} from "./validation";
import { classifyIntentRevision, canonicalIntentHash } from "./intent";

const TRANSITIONS: Record<TaskPhase, TaskPhase[]> = {
	working: ["review", "stopped"],
	review: ["working", "done", "stopped"],
	done: [],
	stopped: [],
};

function transition(record: TaskRecordV2, to: TaskPhase): void {
	if (!TRANSITIONS[record.phase].includes(to))
		throw new KernelInvariantError([
			`illegal phase transition: ${record.phase} -> ${to}`,
		]);
	record.phase = to;
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
			.join(",")}}`;
	}
	const primitive = JSON.stringify(value);
	return primitive === undefined ? "null" : primitive;
}

export function canonicalRecordHashV2(record: TaskRecordV2): string {
	// Must equal the storage CAS revision: the exact serialized file bytes.
	return `sha256:${createHash("sha256")
		.update(`${JSON.stringify(record, null, 2)}\n`)
		.digest("hex")}`;
}

export function actionFingerprintV2(
	action: TaskActionV2,
	intentRevision: number,
	intentContentHash: string,
	audit: AuthorityAuditDescriptorV2 | null,
): string {
	// The fingerprint binds the semantic payload, not the caller-supplied CAS
	// expectations, so an exact replay retried against an advanced record
	// still matches its committed history entry while any payload change
	// (including the diff identity) is detected as a conflict.
	const { expected_record_hash: _r, expected_workspace_hash: _w, diff_hash: _d, ...payload } = action;
	const base = audit
		? { action: payload, intentRevision, intentContentHash, audit }
		: { action: payload, intentRevision, intentContentHash };
	return createHash("sha256").update(stableJson(base)).digest("hex");
}

function historyReason(
	action: TaskActionV2,
	intentRevision: number,
	intentContentHash: string,
	audit: AuthorityAuditDescriptorV2 | null,
	detail: string | null,
): string {
	const fingerprint = `action_v2_sha256:${actionFingerprintV2(
		action,
		intentRevision,
		intentContentHash,
		audit,
	)}`;
	return detail ? `${detail}\n${fingerprint}` : fingerprint;
}

export function recordedActionFingerprintV2(reason: string | null): string | null {
	const matched = reason?.match(/(?:^|\n)action_v2_sha256:([a-f0-9]{64})$/);
	return matched?.[1] ?? null;
}

function copyRecord(record: TaskRecordV2): TaskRecordV2 {
	return {
		...record,
		intent_snapshot: { ...record.intent_snapshot },
		intent_ref: { ...record.intent_ref },
		evidence: record.evidence.map((item) => ({ ...item })),
		findings: record.findings.map((item) => ({ ...item })),
		approvals: record.approvals.map((item) => ({ ...item })),
		history: record.history.map((item) => ({ ...item })),
	};
}

function reviewRound(record: TaskRecordV2): number {
	return (
		Math.max(
			0,
			...record.findings
				.filter((item) => item.source === "review")
				.map((item) => item.review_round ?? 0),
		) + 1
	);
}

function appendHistory(
	record: TaskRecordV2,
	action: TaskActionV2,
	from: TaskPhase,
	detail: string | null,
	audit: AuthorityAuditDescriptorV2 | null,
): void {
	if (record.history.some((entry) => entry.id === action.event_id))
		throw new KernelInvariantError([
			`history contains duplicate id ${action.event_id}`,
		]);
	const entry: {
		id: string;
		at: string;
		type: string;
		from_phase: TaskPhase;
		to_phase: TaskPhase;
		reason: string;
		authority?: AuthorityAuditDescriptorV2;
	} = {
		id: action.event_id,
		at: action.at,
		type: action.type,
		from_phase: from,
		to_phase: record.phase,
		reason: historyReason(
			action,
			record.intent_revision,
			record.intent_ref.content_hash,
			audit,
			detail,
		),
	};
	if (audit) entry.authority = { ...audit };
	record.history.push(entry as (typeof record.history)[number]);
}

function sha256Hex(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function intentRefMatches(intent: TaskIntentV1, ref: TaskIntentRefV1): boolean {
	return (
		ref.path === `docs/plans/${intent.task_id}.intent.json` &&
		ref.revision === intent.revision &&
		ref.content_hash === canonicalIntentHash(intent)
	);
}

function hasPrivilegedKind(action: TaskActionV2): boolean {
	return (
		action.type === "record_approval" ||
		action.type === "record_user_approval" ||
		action.type === "approve_breaking_intent_revision" ||
		action.type === "request_rework" ||
		action.type === "stop" ||
		action.type === "resolve_user_decision"
	);
}

/**
 * Normalized findings digest for a request_rework capability binding. Derived
 * from the same projection the capability issuer must bind (id, kind,
 * acceptance_id, summary), so a capability cannot be bound to one findings
 * set and applied to another.
 */
export function findingsDigestV2(findings: TaskFinding[]): string {
	const normalized = findings.map((finding) => ({
		id: finding.id,
		kind: finding.kind,
		acceptance_id: finding.acceptance_id,
		summary: finding.summary,
	}));
	return `sha256:${createHash("sha256").update(stableJson(normalized)).digest("hex")}`;
}

export function reduceTaskV2(
	recordRaw: TaskRecordV2,
	actionRaw: TaskActionV2,
	authorityAudit: AuthorityAuditDescriptorV2 | null = null,
): ReducedTaskMutationV2 {
	const previous = parseTaskRecordV2(recordRaw);
	assertKernelInvariantsV2(previous.intent_snapshot, previous);
	const action = parseTaskActionV2(actionRaw);
	const record = copyRecord(previous);
	const from = record.phase;

	if (!action.event_id.trim())
		throw new KernelInvariantError(["event_id must be a non-empty string"]);
	if (!action.at.trim())
		throw new KernelInvariantError(["event timestamp must be a non-empty string"]);

	const privileged = hasPrivilegedKind(action);
	if (privileged && !authorityAudit)
		throw new KernelInvariantError([
			`${action.type} requires an authority audit descriptor`,
		]);
	if (!privileged && authorityAudit)
		throw new KernelInvariantError([
			`${action.type} does not accept an authority audit descriptor`,
		]);

	const recordHash = canonicalRecordHashV2(previous);
	const intentRevision = previous.intent_revision;
	const intentContentHash = previous.intent_ref.content_hash;

	// Exact committed replay or conflicting event reuse. Replay is detected
	// against the action-expected identity so an identical retry returns the
	// committed snapshot even after the record has advanced.
	const existingEvent = previous.history.find((entry) => entry.id === action.event_id);
	if (existingEvent) {
		if (
			existingEvent.type === action.type &&
			existingEvent.at === action.at &&
			recordedActionFingerprintV2(existingEvent.reason) ===
				actionFingerprintV2(action, intentRevision, intentContentHash, authorityAudit)
		)
			return brandResult(previous, null);
		throw new KernelInvariantError([
			`event_id ${action.event_id} conflicts with a recorded action`,
		]);
	}

	// New events must carry the exact current record identity.
	if (action.expected_record_hash !== recordHash)
		throw new KernelInvariantError([
			`expected record hash mismatch: ${action.expected_record_hash} != ${recordHash}`,
		]);

	const diffHash = action.diff_hash;
	if (!/^sha256:[a-f0-9]{64}$/.test(diffHash))
		throw new KernelInvariantError(["diff_hash must be a canonical sha256 hash"]);

	switch (action.type) {
		case "record_evidence": {
			if (record.phase !== "working")
				throw new KernelInvariantError([
					`cannot record evidence while phase is ${record.phase}`,
				]);
			const evidence = action.evidence;
			if (record.evidence.some((item) => item.id === evidence.id))
				throw new KernelInvariantError([
					`evidence contains duplicate id ${evidence.id}`,
				]);
			if (
				!record.intent_snapshot.acceptance.some(
					(item) => item.id === evidence.acceptance_id,
				)
			)
				throw new KernelInvariantError([
					`evidence acceptance_id ${evidence.acceptance_id} does not exist in the current intent`,
				]);
			if (evidence.status !== "passed" && evidence.status !== "failed" && evidence.status !== "blocked")
				throw new KernelInvariantError(["evidence status is invalid"]);
			if (evidence.task_revision !== record.intent_revision)
				throw new KernelInvariantError(["evidence task_revision must equal the current intent revision"]);
			if (evidence.intent_content_hash !== record.intent_ref.content_hash)
				throw new KernelInvariantError(["evidence intent_content_hash must equal the current intent hash"]);
			if (evidence.diff_hash !== diffHash)
				throw new KernelInvariantError(["evidence diff_hash must equal the action diff hash"]);
			record.evidence.push({ ...evidence });
			appendHistory(record, action, from, evidence.acceptance_id, authorityAudit);
			break;
		}
		case "record_finding": {
			if (record.phase !== "working" && record.phase !== "review")
				throw new KernelInvariantError([
					`cannot record findings while phase is ${record.phase}`,
				]);
			const finding = action.finding;
			if (record.findings.some((item) => item.id === finding.id))
				throw new KernelInvariantError([
					`findings contains duplicate id ${finding.id}`,
				]);
			if (finding.kind === "replan_required")
				throw new KernelInvariantError([
					"record_finding cannot create a replan boundary; use request_rework",
				]);
			if (
				finding.kind === "unresolved_user_decision" &&
				!/^user-decision-[A-Za-z0-9._-]+$/.test(finding.id)
			)
				throw new KernelInvariantError([
					"unresolved_user_decision findings require a canonical user-decision- id",
				]);
			record.findings.push({
				...finding,
				status: "open",
				source: finding.source === "execution" || finding.source === "review" || finding.source === "kernel" ? finding.source : "execution",
				review_round: null,
			});
			appendHistory(record, action, from, finding.id, authorityAudit);
			break;
		}
		case "resolve_finding": {
			if (record.phase !== "working" && record.phase !== "review")
				throw new KernelInvariantError([
					`cannot resolve findings while phase is ${record.phase}`,
				]);
			const finding = record.findings.find(
				(item) => item.id === action.finding_id,
			);
			if (!finding)
				throw new KernelInvariantError([
					`finding ${action.finding_id} does not exist`,
				]);
			if (finding.kind === "unresolved_user_decision" || finding.kind === "replan_required")
				throw new KernelInvariantError([
					"generic resolve_finding cannot resolve a user decision or replan boundary",
				]);
			if (finding.status === "resolved")
				throw new KernelInvariantError([
					`finding ${action.finding_id} is already resolved`,
				]);
			finding.status = "resolved";
			appendHistory(record, action, from, action.finding_id, authorityAudit);
			break;
		}
		case "record_approval": {
			if (record.phase !== "review")
				throw new KernelInvariantError([
					`cannot record approval while phase is ${record.phase}`,
				]);
			const approval = action.approval;
			if (approval.kind !== "review" && approval.kind !== "qa")
				throw new KernelInvariantError([
					"record_approval accepts only review or qa approvals",
				]);
			if (!authorityAudit)
				throw new KernelInvariantError([
					"record_approval requires a consumed authority capability",
				]);
			const expectedRole =
				authorityAudit.authority_kind === "review"
					? "reviewer"
					: authorityAudit.authority_kind;
			if (approval.authority_role !== expectedRole)
				throw new KernelInvariantError([
					"approval authority_role must match the consumed capability kind",
				]);
			if (approval.task_revision !== record.intent_revision)
				throw new KernelInvariantError(["approval task_revision must equal the current intent revision"]);
			if (approval.intent_content_hash !== record.intent_ref.content_hash)
				throw new KernelInvariantError(["approval intent_content_hash must equal the current intent hash"]);
			if (approval.diff_hash !== diffHash)
				throw new KernelInvariantError(["approval diff_hash must equal the action diff hash"]);
			if (record.approvals.some((item) => item.id === approval.id))
				throw new KernelInvariantError([
					`approvals contains duplicate id ${approval.id}`,
				]);
			record.approvals.push({ ...approval });
			appendHistory(record, action, from, approval.id, authorityAudit);
			break;
		}
		case "record_user_approval": {
			if (record.phase !== "review")
				throw new KernelInvariantError([
					`cannot record user approval while phase is ${record.phase}`,
				]);
			const approval = action.approval;
			if (approval.kind !== "user")
				throw new KernelInvariantError([
					"record_user_approval requires kind user",
				]);
			if (!authorityAudit || authorityAudit.authority_kind !== "user")
				throw new KernelInvariantError([
					"record_user_approval requires user authority",
				]);
			if (approval.task_revision !== record.intent_revision)
				throw new KernelInvariantError(["approval task_revision must equal the current intent revision"]);
			if (approval.intent_content_hash !== record.intent_ref.content_hash)
				throw new KernelInvariantError(["approval intent_content_hash must equal the current intent hash"]);
			if (approval.diff_hash !== diffHash)
				throw new KernelInvariantError(["approval diff_hash must equal the action diff hash"]);
			if (record.approvals.some((item) => item.id === approval.id))
				throw new KernelInvariantError([
					`approvals contains duplicate id ${approval.id}`,
				]);
			record.approvals.push({ ...approval });
			appendHistory(record, action, from, approval.id, authorityAudit);
			break;
		}
		case "revise_intent":
		case "approve_breaking_intent_revision": {
			if (record.phase !== "working" && record.phase !== "review")
				throw new KernelInvariantError([
					`cannot revise intent while phase is ${record.phase}`,
				]);
			const revisionClass = classifyIntentRevision(
				record.intent_snapshot,
				action.next_intent,
			);
			if (action.type === "revise_intent" && revisionClass !== "compatible")
				throw new KernelInvariantError([
					"revise_intent requires a compatible revision",
				]);
			if (action.type === "approve_breaking_intent_revision" && revisionClass !== "breaking")
				throw new KernelInvariantError([
					"approve_breaking_intent_revision requires a breaking revision",
				]);
			if (!authorityAudit && action.type === "approve_breaking_intent_revision")
				throw new KernelInvariantError([
					"breaking intent revision requires user authority",
				]);
			if (action.next_intent.task_id !== record.task_id ||
				action.next_intent.task_id !== record.intent_snapshot.task_id)
				throw new KernelInvariantError([
					"intent revision cannot change task identity",
				]);
			if (
				action.next_intent.goal !== record.intent_snapshot.goal ||
				action.next_intent.owner !== record.intent_snapshot.owner
			)
				throw new KernelInvariantError([
					"intent revision cannot change goal or owner",
				]);
			if (!intentRefMatches(action.next_intent, action.next_intent_ref))
				throw new KernelInvariantError([
					"next intent ref must match the next intent",
				]);
			record.intent_snapshot = { ...action.next_intent };
			record.intent_ref = { ...action.next_intent_ref };
			record.intent_revision = action.next_intent.revision;
			if (action.type === "approve_breaking_intent_revision") {
				for (const finding of record.findings) {
					if (finding.kind === "replan_required" && finding.status === "open")
						finding.status = "resolved";
				}
				if (record.phase === "review") transition(record, "working");
			}
			appendHistory(record, action, from, `intent_revision_${record.intent_revision}`, authorityAudit);
			break;
		}
		case "submit_review": {
			if (record.phase !== "working")
				throw new KernelInvariantError([
					`cannot submit review while phase is ${record.phase}`,
				]);
			if (record.findings.some((item) => item.status === "open" && item.kind === "replan_required"))
				throw new KernelInvariantError([
					"cannot submit review while a replan boundary is open",
				]);
			transition(record, "review");
			appendHistory(record, action, from, null, authorityAudit);
			break;
		}
		case "request_rework": {
			if (record.phase !== "review")
				throw new KernelInvariantError([
					`cannot request rework while phase is ${record.phase}`,
				]);
			if (action.findings.length === 0)
				throw new KernelInvariantError([
					"request_rework requires at least one finding",
				]);
			if (!authorityAudit)
				throw new KernelInvariantError([
					"request_rework requires an authority audit descriptor",
				]);
			if (
				authorityAudit.authority_kind !== "review" &&
				authorityAudit.authority_kind !== "qa"
			)
				throw new KernelInvariantError([
					"request_rework requires review or qa authority",
				]);
			const round = reviewRound(record);
			const reviewAuthorityReworks = record.history.filter(
				(entry) =>
					entry.type === "request_rework" &&
					entry.authority?.authority_kind === "review",
			).length;
			const parkForReplan =
				authorityAudit.authority_kind === "review" && reviewAuthorityReworks >= 1;
			if (!parkForReplan) transition(record, "working");
			const findingIds = new Set(record.findings.map((item) => item.id));
			for (const finding of action.findings) {
				if (findingIds.has(finding.id))
					throw new KernelInvariantError([
						`findings contains duplicate id ${finding.id}`,
					]);
				findingIds.add(finding.id);
				record.findings.push({
					...finding,
					status: "open",
					source: "review",
					review_round: round,
				});
			}
			if (
				parkForReplan &&
				!record.findings.some(
					(item) => item.status === "open" && item.kind === "replan_required",
				)
			) {
				const disputed =
					action.findings.find((item: TaskFinding) => item.kind === "blocking") ??
					action.findings[0];
				const boundary = {
					id: `${action.event_id}:replan-required`,
					kind: "replan_required" as const,
					status: "open" as const,
					acceptance_id: disputed.acceptance_id,
					source: "kernel" as const,
					review_round: round,
					summary:
						"Review returned this acceptance boundary twice; a durable replan is required.",
				};
				if (findingIds.has(boundary.id))
					throw new KernelInvariantError([
						`findings contains duplicate id ${boundary.id}`,
					]);
				record.findings.push(boundary);
			}
			appendHistory(record, action, from, `review_round_${round}`, authorityAudit);
			break;
		}
		case "complete": {
			if (record.phase !== "review")
				throw new KernelInvariantError([
					`cannot complete while phase is ${record.phase}`,
				]);
			const decision = completionDecisionV2(
				record.intent_snapshot,
				record,
				diffHash,
				record.intent_ref.content_hash,
			);
			if (!decision.complete)
				throw new KernelInvariantError([
					"task is not eligible for completion",
				]);
			transition(record, "done");
			appendHistory(record, action, from, null, authorityAudit);
			break;
		}
		case "stop": {
			if (!action.reason.trim())
				throw new KernelInvariantError(["stop requires a reason"]);
			transition(record, "stopped");
			appendHistory(record, action, from, action.reason, authorityAudit);
			break;
		}
		case "resolve_user_decision": {
			if (record.phase !== "working" && record.phase !== "review")
				throw new KernelInvariantError([
					`cannot resolve user decisions while phase is ${record.phase}`,
				]);
			if (!action.resolution.trim())
				throw new KernelInvariantError([
					"resolve_user_decision requires a resolution",
				]);
			const finding = record.findings.find(
				(item) => item.id === action.finding_id,
			);
			if (!finding)
				throw new KernelInvariantError([
					`finding ${action.finding_id} does not exist`,
				]);
			if (finding.kind !== "unresolved_user_decision")
				throw new KernelInvariantError([
					`finding ${action.finding_id} is not a user decision`,
				]);
			if (finding.status === "resolved")
				throw new KernelInvariantError([
					`finding ${action.finding_id} is already resolved`,
				]);
			finding.status = "resolved";
			appendHistory(
				record,
				action,
				from,
				`${action.finding_id}: ${action.resolution}`,
				authorityAudit,
			);
			break;
		}
		default: {
			const unreachable: never = action as never;
			throw new KernelInvariantError([
				`unsupported task action: ${String((unreachable as TaskActionV2).type)}`,
			]);
		}
	}

	assertTaskRecordUpdateV2(previous, record, action);
	return brandResult(record, nextWorkingFor(record));
}

function nextWorkingFor(record: TaskRecordV2): string | null {
	return record.phase === "working" ? record.task_id : null;
}

function brandResult(
	record: TaskRecordV2,
	nextWorking: string | null,
): ReducedTaskMutationV2 {
	const target = {} as ReducedTaskMutationV2;
	Object.defineProperty(target, REDUCED_MUTATION_BRAND, {
		value: true,
		enumerable: false,
		writable: false,
		configurable: false,
	});
	Object.defineProperty(target, "record", {
		value: record,
		enumerable: true,
		writable: false,
	});
	Object.defineProperty(target, "next_workspace_working", {
		value: nextWorking,
		enumerable: true,
		writable: false,
	});
	return Object.freeze(target);
}

export function isReducedMutationV2(value: unknown): value is ReducedTaskMutationV2 {
	return (
		!!value &&
		typeof value === "object" &&
		(value as ReducedTaskMutationV2)[REDUCED_MUTATION_BRAND] === true
	);
}
