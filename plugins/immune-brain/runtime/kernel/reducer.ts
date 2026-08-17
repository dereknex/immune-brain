import { createHash } from "node:crypto";
import { completionDecision } from "./completion";
import type {
	TaskAction,
	TaskFinding,
	TaskHistoryEntry,
	TaskPhase,
	TaskRecord,
	UserAuthorityAudit,
} from "./types";
import { KernelInvariantError, assertTaskRecordUpdate, parseTaskRecord } from "./validation";

const TRANSITIONS: Record<TaskPhase, TaskPhase[]> = {
	working: ["review", "stopped"],
	review: ["working", "done", "stopped"],
	done: [],
	stopped: [],
};

const USER_AUTHORITY_CONTEXT = Symbol("assurance-kernel-user-authority");

export interface UserAuthorityContext {
	readonly audit: UserAuthorityAudit;
	readonly [USER_AUTHORITY_CONTEXT]: true;
}

function validatedAuthorityAudit(
	audit: UserAuthorityAudit,
): UserAuthorityAudit {
	const violations: string[] = [];
	if (!audit || typeof audit !== "object")
		violations.push("user authority audit must be an object");
	else {
		if (typeof audit.actor_id !== "string" || !audit.actor_id.trim())
			violations.push("user authority actor_id must be a non-empty string");
		if (audit.source !== "literal_user")
			violations.push("user authority source must equal literal_user");
		if (
			typeof audit.confirmation_ref !== "string" ||
			!audit.confirmation_ref.trim()
		)
			violations.push(
				"user authority confirmation_ref must be a non-empty string",
			);
	}
	if (violations.length > 0) throw new KernelInvariantError(violations);
	return { ...audit };
}

/** Internal fixture seam. Host authority minting remains unavailable in P1. */
export function createUserAuthorityContextForTest(
	audit: UserAuthorityAudit,
): UserAuthorityContext {
	return Object.freeze({
		audit: Object.freeze(validatedAuthorityAudit(audit)),
		[USER_AUTHORITY_CONTEXT]: true as const,
	});
}

function authorityForAction(
	action: TaskAction,
	context: UserAuthorityContext | undefined,
): UserAuthorityAudit | null {
	const privileged =
		action.type === "stop" || action.type === "resolve_user_decision";
	if (!privileged) {
		if (context !== undefined)
			throw new KernelInvariantError([
				`${action.type} does not accept user authority context`,
			]);
		return null;
	}
	if (
		!context ||
		typeof context !== "object" ||
		(context as UserAuthorityContext)[USER_AUTHORITY_CONTEXT] !== true
	)
		throw new KernelInvariantError([
			`${action.type} requires user authority context`,
		]);
	return validatedAuthorityAudit(context.audit);
}

function transition(record: TaskRecord, to: TaskPhase): void {
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

function actionFingerprint(
	action: TaskAction,
	authority: UserAuthorityAudit | null,
): string {
	const payload = authority ? { action, authority } : action;
	return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function historyReason(
	action: TaskAction,
	detail: string | null,
	authority: UserAuthorityAudit | null,
): string {
	const fingerprint = `action_sha256:${actionFingerprint(action, authority)}`;
	return detail ? `${detail}\n${fingerprint}` : fingerprint;
}

function recordedActionFingerprint(reason: string | null): string | null {
	const matched = reason?.match(/(?:^|\n)action_sha256:([a-f0-9]{64})$/);
	return matched?.[1] ?? null;
}

function appendHistory(
	record: TaskRecord,
	action: TaskAction,
	from: TaskPhase,
	reason: string | null,
	authority: UserAuthorityAudit | null = null,
): void {
	if (record.history.some((entry) => entry.id === action.event_id))
		throw new KernelInvariantError([
			`history contains duplicate id ${action.event_id}`,
		]);
	const entry: TaskHistoryEntry = {
		id: action.event_id,
		at: action.at,
		type: action.type,
		from_phase: from,
		to_phase: record.phase,
		reason: historyReason(action, reason, authority),
	};
	if (authority) entry.authority = { ...authority };
	record.history.push(entry);
}

function copyRecord(record: TaskRecord): TaskRecord {
	return {
		...record,
		evidence: record.evidence.map((item) => ({ ...item })),
		findings: record.findings.map((item) => ({ ...item })),
		approvals: record.approvals.map((item) => ({ ...item })),
		history: record.history.map((item) => ({ ...item })),
	};
}

function reviewRound(record: TaskRecord): number {
	return (
		Math.max(
			0,
			...record.findings
				.filter((item) => item.source === "review")
				.map((item) => item.review_round ?? 0),
		) + 1
	);
}

export function reduceTask(
	recordRaw: TaskRecord,
	action: TaskAction,
	authorityContext?: UserAuthorityContext,
): TaskRecord {
	const previous = parseTaskRecord(recordRaw);
	const record = copyRecord(previous);
	const from = record.phase;
	if (!action.event_id.trim())
		throw new KernelInvariantError(["event_id must be a non-empty string"]);
	if (!action.at.trim())
		throw new KernelInvariantError(["event timestamp must be a non-empty string"]);
	const authority = authorityForAction(action, authorityContext);
	const existingEvent = previous.history.find(
		(entry) => entry.id === action.event_id,
	);
	if (existingEvent) {
		if (
			existingEvent.type === action.type &&
			existingEvent.at === action.at &&
			recordedActionFingerprint(existingEvent.reason) ===
				actionFingerprint(action, authority)
		)
			return copyRecord(previous);
		throw new KernelInvariantError([
			`event_id ${action.event_id} conflicts with a recorded action`,
		]);
	}

	switch (action.type) {
		case "submit_review":
			if (record.findings.some((item) => item.status === "open" && item.kind === "replan_required"))
				throw new KernelInvariantError([
					"cannot submit review while a replan boundary is open",
				]);
			transition(record, "review");
			appendHistory(record, action, from, null);
			break;
		case "request_rework": {
			if (action.findings.length === 0)
				throw new KernelInvariantError([
					"request_rework requires at least one finding",
				]);
			const round = reviewRound(record);
			const parkForReplan = round >= 2;
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
				const disputed = action.findings.find(
					(item) => item.kind === "blocking",
				) ?? action.findings[0];
				const boundary: TaskFinding = {
					id: `${action.event_id}:replan-required`,
					kind: "replan_required",
					status: "open",
					acceptance_id: disputed.acceptance_id,
					source: "kernel",
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
			appendHistory(record, action, from, `review_round_${round}`);
			break;
		}
		case "complete": {
			if (record.phase !== "review")
				throw new KernelInvariantError([
					`illegal phase transition: ${record.phase} -> done`,
				]);
			const decision = completionDecision(
				action.intent,
				record,
				action.current_diff_hash,
			);
			if (!decision.complete)
				throw new KernelInvariantError([
					"task is not eligible for completion",
				]);
			transition(record, "done");
			appendHistory(record, action, from, null);
			break;
		}
		case "stop":
			if (!action.reason.trim())
				throw new KernelInvariantError(["stop requires a reason"]);
			transition(record, "stopped");
			appendHistory(record, action, from, action.reason, authority);
			break;
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
			finding.status = "resolved";
			appendHistory(record, action, from, action.finding_id);
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
			finding.status = "resolved";
			appendHistory(
				record,
				action,
				from,
				`${action.finding_id}: ${action.resolution}`,
				authority,
			);
			break;
		}
		default: {
			const unreachable: never = action;
			throw new KernelInvariantError([
				`unsupported task action: ${String((unreachable as TaskAction).type)}`,
			]);
		}
	}

	assertTaskRecordUpdate(previous, record);
	return record;
}
