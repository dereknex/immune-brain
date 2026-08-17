import { createHash } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { stableStringify } from "../canonical_json";
import { inspectLegacyAggregate, mapLegacyState } from "./legacy";
import {
	appendObservationJournalEntry,
	type JournalEntry,
} from "./storage";
import {
	appendAutomaticObservationV2,
	readAutomaticObservationsV2,
	type V3AuthorityObservationV2,
} from "./automatic_observations";
import {
	AUTHORITY_OBSERVATION_GENERATION_V2,
	AUTHORITY_OBSERVER_VERSION_V2,
	readAuthorityCommitReceipts,
	type AuthorityCommitReceipt,
	type AuthorityObservationSeedV2,
} from "../authority_commit_receipts";
import type {
	V3AuthorityObservation,
	V3CommitSourceEvent,
} from "./types";

export const V3_OBSERVER_VERSION = "assurance-kernel-p2a-observer/v1";

export interface CommittedLedgerReceipt {
	attempt_id: string;
	source_kind: "state_mutation" | "project_migration";
	source_ref: string;
	receipt_status:
		| "committed"
		| "prepared"
		| "recovered_committed";
	previous_state: Record<string, unknown>;
	proposed_state: Record<string, unknown>;
	committed_state: Record<string, unknown>;
	committed_bytes: string;
	ledger_revision: string;
	committed_at: string;
}

type ObservationAppender = (
	root: string,
	entry: JournalEntry & { observation: V3AuthorityObservation },
) => "appended" | "duplicate";

type ObservationV2Appender = (
	root: string,
	observation: V3AuthorityObservationV2,
) => "appended" | "duplicate";

let observationAppenderForTest: ObservationAppender | null = null;
let observationV2AppenderForTest: ObservationV2Appender | null = null;

/** Test-only fault seam; production always appends through secure kernel storage. */
export function setObservationAppenderForTest(
	appender: ObservationAppender | null,
): void {
	observationAppenderForTest = appender;
}

/** Test-only fault seam for the additive automatic-observation v2 journal. */
export function setObservationV2AppenderForTest(
	appender: ObservationV2Appender | null,
): void {
	observationV2AppenderForTest = appender;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function digest(domain: string, value: string): string {
	return `sha256:${createHash("sha256").update(`${domain}\0${value}`).digest("hex")}`;
}

function projectRootForLedgerPath(statePath: string): string | null {
	if (basename(statePath) !== "current_iteration.json") return null;
	const memoryDirectory = dirname(statePath);
	if (basename(memoryDirectory) !== "memory") return null;
	const immDirectory = dirname(memoryDirectory);
	if (basename(immDirectory) !== ".imm") return null;
	return resolve(dirname(immDirectory));
}

function newHistoryEvents(
	previous: Record<string, unknown>,
	proposed: Record<string, unknown>,
	receipt: Pick<
		CommittedLedgerReceipt,
		| "attempt_id"
		| "source_kind"
		| "source_ref"
		| "receipt_status"
		| "committed_at"
	>,
): V3CommitSourceEvent[] {
	const before = Array.isArray(previous.history) ? previous.history : [];
	const after = Array.isArray(proposed.history) ? proposed.history : [];
	if (after.length < before.length)
		throw new Error("authority commit removed history events");
	for (let index = 0; index < before.length; index += 1) {
		if (stableStringify(before[index]) !== stableStringify(after[index]))
			throw new Error("authority commit rewrote existing history");
	}
	const appended = after.slice(before.length).map((raw) => {
		const entry = asRecord(raw);
		const canonical = stableStringify(entry);
		return {
			id: digest("assurance-kernel-v3-history-event/v1", canonical),
			action: stringOrNull(entry.action) ?? "unknown",
			at: stringOrNull(entry.at),
		};
	});
	if (appended.length > 0) return appended;
	return [
		{
			id: receipt.attempt_id,
			action:
				receipt.source_kind === "project_migration"
					? `project_migration:${receipt.source_ref}`
					: receipt.receipt_status === "recovered_committed"
						? `recovered_state_mutation:${receipt.source_ref}`
						: `state_mutation:${receipt.source_ref}`,
			at: receipt.committed_at,
		},
	];
}

function divergenceFields(state: Record<string, unknown>): string[] {
	const aggregate = inspectLegacyAggregate(state);
	const fields: string[] = [];
	if (aggregate.replan_mismatch || aggregate.replan_type_invalid)
		fields.push("requires_replan");
	if (aggregate.active_step_mismatch) fields.push("active_step");
	if (aggregate.ownership_conflict) fields.push("ownership");
	if (aggregate.follow_up_malformed || aggregate.follow_up_state === "closed")
		fields.push("pending_follow_up");
	if (aggregate.steps_malformed) fields.push("steps");
	if (["invalid", "conflict"].includes(aggregate.terminal))
		fields.push("plan_terminal");
	const nextAction = asRecord(state.next_action);
	if (
		aggregate.replan_signal &&
		(nextAction.action === "activate" ||
			(typeof nextAction.command === "string" &&
				nextAction.command.includes("imm-work activate")))
	)
		fields.push("next_action");
	return fields;
}

function legacyTaskId(state: Record<string, unknown>): string {
	const identity = [state.plan_path, state.plan_signature]
		.map((value) => (typeof value === "string" ? value : ""))
		.join("\0");
	return `legacy-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
}

export function buildV3AuthorityObservation(
	receipt: CommittedLedgerReceipt,
): V3AuthorityObservation {
	const sourceEvents = newHistoryEvents(
		receipt.previous_state,
		receipt.proposed_state,
		receipt,
	);
	const shadow = mapLegacyState(receipt.committed_state);
	const fields = divergenceFields(receipt.committed_state);
	const core = {
		contract: "assurance_kernel/v3_authority_observation/v1" as const,
		observer_version: V3_OBSERVER_VERSION,
		commit_id: receipt.attempt_id,
		ledger_revision: receipt.ledger_revision,
		committed_at: receipt.committed_at,
		plan_path: stringOrNull(receipt.committed_state.plan_path),
		plan_signature: stringOrNull(receipt.committed_state.plan_signature),
		source_events: sourceEvents,
		shadow,
		divergence: { detected: fields.length > 0, fields },
	};
	return {
		...core,
		observation_id: digest(
			"assurance-kernel-v3-observation/v1",
			stableStringify(core),
		),
	};
}

export function buildAuthorityObservationSeedV2(
	statePathIdentity: string,
	receipt: CommittedLedgerReceipt,
): AuthorityObservationSeedV2 {
	const sourceEvents = newHistoryEvents(
		receipt.previous_state,
		receipt.proposed_state,
		receipt,
	);
	const shadow = mapLegacyState(receipt.committed_state);
	const fields = divergenceFields(receipt.committed_state);
	return {
		contract: "assurance_kernel/authority_observation_seed/v2",
		observer_version: AUTHORITY_OBSERVER_VERSION_V2,
		source_kind: receipt.source_kind,
		source_ref: receipt.source_ref,
		state_path_identity: statePathIdentity,
		committed_bytes_sha256: `sha256:${createHash("sha256")
			.update(receipt.committed_bytes)
			.digest("hex")}`,
		committed_revision: receipt.ledger_revision,
		plan_path: stringOrNull(receipt.committed_state.plan_path),
		plan_signature: stringOrNull(receipt.committed_state.plan_signature),
		source_events: sourceEvents,
		shadow,
		divergence: { detected: fields.length > 0, fields },
		committed_at: receipt.committed_at,
	};
}

function committedReceiptV2(
	receipt: AuthorityCommitReceipt,
): receipt is AuthorityCommitReceipt & {
	status: "committed" | "recovered_committed";
	observation_seed: AuthorityObservationSeedV2;
} {
	return (
		(receipt.status === "committed" ||
			receipt.status === "recovered_committed") &&
		receipt.observation_seed !== undefined
	);
}

export function buildAutomaticObservationV2(
	receipt: AuthorityCommitReceipt,
): V3AuthorityObservationV2 {
	if (!committedReceiptV2(receipt))
		throw new Error("automatic observation requires a committed receipt-v2 seed");
	const seed = receipt.observation_seed;
	const core = {
		contract: "assurance_kernel/v3_authority_observation/v2" as const,
		receipt_record_id: receipt.record_id,
		receipt_attempt_id: receipt.attempt_id,
		receipt_protocol: receipt.contract,
		receipt_status: receipt.status,
		source_kind: seed.source_kind,
		source_ref: seed.source_ref,
		state_path_identity: seed.state_path_identity,
		committed_bytes_sha256: seed.committed_bytes_sha256,
		ledger_revision: seed.committed_revision,
		plan_path: seed.plan_path,
		plan_signature: seed.plan_signature,
		source_events: seed.source_events,
		shadow: seed.shadow,
		divergence: seed.divergence,
		observer_generation: AUTHORITY_OBSERVATION_GENERATION_V2,
		observer_version: seed.observer_version,
		committed_at: seed.committed_at,
		observed_at: receipt.recorded_at,
	};
	return {
		...core,
		observation_id: digest(
			"assurance-kernel-v3-observation/v2",
			stableStringify(core),
		),
	};
}

export function setAutomaticObservationV2AppenderForTest(
	appender:
		| ((
				root: string,
				observation: V3AuthorityObservationV2,
			) => "appended" | "duplicate")
		| null,
): void {
	observationV2AppenderForTest = appender;
}

export function observeTerminalReceiptV2(
	statePath: string,
	receipt: AuthorityCommitReceipt,
): "appended" | "duplicate" | "not_production_ledger" {
	const root = projectRootForLedgerPath(statePath);
	if (!root) return "not_production_ledger";
	return (observationV2AppenderForTest ?? appendAutomaticObservationV2)(
		root,
		buildAutomaticObservationV2(receipt),
	);
}

export function replayMissingAutomaticObservationsV2(statePath: string): number {
	const root = projectRootForLedgerPath(statePath);
	if (!root) return 0;
	const receipts = readAuthorityCommitReceipts(statePath);
	const existing = new Set(
		readAutomaticObservationsV2(root).map((entry) => entry.receipt_record_id),
	);
	let appended = 0;
	for (const receipt of receipts) {
		if (receipt.contract !== "assurance_kernel/authority_commit_receipt/v2")
			continue;
		if (!committedReceiptV2(receipt) || existing.has(receipt.record_id)) continue;
		observeTerminalReceiptV2(statePath, receipt);
		existing.add(receipt.record_id);
		appended += 1;
	}
	return appended;
}

export function observeTerminalReceiptV2BestEffort(
	statePath: string,
	receipt: AuthorityCommitReceipt,
): void {
	try {
		observeTerminalReceiptV2(statePath, receipt);
	} catch (error) {
		console.error(
			`warning: authority receipt v2 persisted but automatic observation failed: ${
				error instanceof Error ? error.message : error
			}`,
		);
	}
}

export function replayMissingAutomaticObservationsV2BestEffort(
	statePath: string,
): void {
	try {
		replayMissingAutomaticObservationsV2(statePath);
	} catch (error) {
		console.error(
			`warning: automatic observation recovery failed: ${
				error instanceof Error ? error.message : error
			}`,
		);
	}
}

export function observeCommittedLedger(
	statePath: string,
	receipt: CommittedLedgerReceipt,
): "appended" | "duplicate" | "not_production_ledger" {
	const root = projectRootForLedgerPath(statePath);
	if (!root) return "not_production_ledger";
	const observation = buildV3AuthorityObservation(receipt);
	const entry: JournalEntry & { observation: V3AuthorityObservation } = {
		contract: "assurance_kernel/journal/v1",
		timestamp: new Date().toISOString(),
		task_id: legacyTaskId(receipt.committed_state),
		command: "observe_v3_authority_commit",
		entry_phase: observation.shadow.phase,
		result:
			observation.shadow.ambiguous || observation.divergence.detected
				? "escalated"
				: "ok",
		reason_code: observation.divergence.detected
			? "shadow_divergence"
			: "authority_commit_observed",
		recovery_hint: observation.divergence.detected
			? "Inspect the committed v3 authority fields; the observer never repairs them."
			: null,
		planner_reentry: false,
		user_intervention: false,
		observation,
	};
	return (observationAppenderForTest ?? appendObservationJournalEntry)(
		root,
		entry,
	);
}

export function observeCommittedLedgerBestEffort(
	statePath: string,
	receipt: CommittedLedgerReceipt,
): void {
	try {
		observeCommittedLedger(statePath, receipt);
	} catch (error) {
		console.error(
			`warning: v3 authority commit was persisted but shadow observation failed: ${
				error instanceof Error ? error.message : error
			}`,
		);
	}
}
