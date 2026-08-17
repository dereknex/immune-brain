import {
	AUTHORITY_COMMIT_RECEIPT_V2_CONTRACT,
	AUTHORITY_OBSERVATION_GENERATION_V2,
	AUTHORITY_OBSERVER_VERSION_V2,
	type AuthorityCommitReceipt,
} from "../authority_commit_receipts";
import type { V3AuthorityObservationV2 } from "./automatic_observations";
import {
	loadReadinessEvidence,
	type ReadinessEvidenceBundle,
	type ReadinessEvidenceInput,
} from "./readiness_evidence";

export { loadReadinessEvidence, type ReadinessEvidenceBundle, type ReadinessEvidenceInput } from "./readiness_evidence";

export interface ReadinessGap {
	code:
		| "epoch_empty"
		| "window_too_short"
		| "lifecycle_coverage"
		| "family_coverage"
		| "evidence_bundle_missing"
		| "missing_observation"
		| "orphan_observation"
		| "binding_mismatch"
		| "version_discontinuity"
		| "shadow_divergence"
		| "evidence_integrity"
		| "evidence_bundle_invalid"
		| "rollback_rehearsal_invalid";
	reference: string | null;
	detail: string;
}

export interface ReadinessReport {
	contract: "assurance_kernel/readiness_report/v1";
	status: "collecting" | "blocked" | "candidate";
	observer_version: typeof AUTHORITY_OBSERVER_VERSION_V2;
	epoch_started_at: string | null;
	window_started_at: string | null;
	window_days: number;
	receipts_v2_count: number;
	observations_v2_count: number;
	reconciled_terminal_count: number;
	lifecycle_count: number;
	families_covered: string[];
	families_missing: string[];
	gaps: ReadinessGap[];
	legacy_counts: { receipts_v1: number; observations_v1: number };
	migration_digest: { presented: string | null; current: string | null; match: boolean };
	rollback_rehearsal: { present: boolean; result: string | null; at: string | null };
	generated_at: string;
}

export interface ProjectReadinessInput {
	receipts: AuthorityCommitReceipt[];
	observations: V3AuthorityObservationV2[];
	evidence: ReadinessEvidenceInput;
	current_migration_digest: string | null;
	now: string;
	legacy_counts: { receipts_v1: number; observations_v1: number };
}

const EXECUTION = new Set(["record_execution_evidence", "record_work_probe_evidence"]);
const REVIEW = new Set(["review_step", "review_gate_pass"]);
const TERMINATION = new Set(["finish_reset", "terminate_plan"]);
const ACTIVATION = new Set(["sync_plan_from_imm_plan", "activate_step"]);
const REQUIRED_FAMILIES = ["execution", "review", "termination"];
// Short verification window: a qualifying epoch needs at least one full UTC
// day span (day 1 is the epoch's own day; day 2 means the epoch crossed a
// UTC midnight). This deliberately replaces the original 14-day observation
// gate — the literal user requested a short validation window after the first
// real canary walkthrough; the gate remains waivable at enrollment.
const MIN_QUALIFYING_WINDOW_DAYS = 2;
const BLOCKING_CODES = new Set<ReadinessGap["code"]>([
	"missing_observation",
	"orphan_observation",
	"binding_mismatch",
	"version_discontinuity",
	"shadow_divergence",
	"evidence_integrity",
	"evidence_bundle_invalid",
	"rollback_rehearsal_invalid",
]);

function validTime(value: string): number | null {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function utcDay(value: string): number | null {
	const parsed = validTime(value);
	if (parsed === null) return null;
	const date = new Date(parsed);
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function addGap(gaps: ReadinessGap[], code: ReadinessGap["code"], detail: string, reference: string | null = null): void {
	if (gaps.some((gap) => gap.code === code && gap.reference === reference && gap.detail === detail)) return;
	gaps.push({ code, detail, reference });
}

function sameObservation(left: V3AuthorityObservationV2, right: V3AuthorityObservationV2): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function bindingMatches(receipt: AuthorityCommitReceipt, observation: V3AuthorityObservationV2): boolean {
	const seed = receipt.observation_seed;
	return Boolean(
		seed &&
		observation.receipt_record_id === receipt.record_id &&
		observation.receipt_attempt_id === receipt.attempt_id &&
		observation.source_kind === receipt.source_kind &&
		observation.state_path_identity === receipt.state_path_identity &&
		observation.committed_bytes_sha256 === seed.committed_bytes_sha256 &&
		observation.ledger_revision === seed.committed_revision &&
		observation.source_ref === seed.source_ref &&
		observation.plan_path === seed.plan_path &&
		observation.plan_signature === seed.plan_signature,
	);
}

function eventFamily(action: string): string | null {
	if (EXECUTION.has(action)) return "execution";
	if (REVIEW.has(action)) return "review";
	if (TERMINATION.has(action)) return "termination";
	if (ACTIVATION.has(action)) return "activation";
	return null;
}

function lifecycleCount(observations: V3AuthorityObservationV2[]): number {
	const byPlan = new Map<string, Array<{ at: number; family: string }>>();
	for (const observation of observations) {
		if (!observation.plan_path) continue;
		for (const event of observation.source_events) {
			const family = eventFamily(event.action);
			const at = validTime(event.at ?? observation.committed_at);
			if (!family || at === null) continue;
			const entries = byPlan.get(observation.plan_path) ?? [];
			entries.push({ at, family });
			byPlan.set(observation.plan_path, entries);
		}
	}
	let completed = 0;
	for (const events of byPlan.values()) {
		events.sort((left, right) => left.at - right.at);
		const terminations = events.filter((event) => event.family === "termination");
		if (terminations.length !== 1) continue;
		const termination = terminations[0];
		if (events.some((event) => event.at > termination.at)) continue;
		const executions = events.filter((event) => event.family === "execution" && event.at <= termination.at);
		const reviews = events.filter((event) => event.family === "review" && event.at <= termination.at);
		if (executions.length === 0 || reviews.length === 0) continue;
		const executionAt = executions[0].at;
		const reviewAt = reviews.find((event) => event.at >= executionAt)?.at;
		if (reviewAt === undefined || reviewAt > termination.at) continue;
		const activation = events.find((event) => event.family === "activation");
		if (activation && activation.at > executionAt) continue;
		completed += 1;
	}
	return completed;
}

export function projectReadiness(input: ProjectReadinessInput): ReadinessReport {
	const gaps: ReadinessGap[] = [];
	const receipts = input.receipts.filter((receipt) => receipt.contract === AUTHORITY_COMMIT_RECEIPT_V2_CONTRACT);
	const prepared = receipts.filter((receipt) => receipt.status === "prepared");
	const terminals = receipts.filter((receipt) => receipt.status === "committed" || receipt.status === "recovered_committed");
	const terminalByAttempt = new Map<string, AuthorityCommitReceipt>();
	const preparedByAttempt = new Map<string, AuthorityCommitReceipt>();
	for (const record of prepared) {
		if (preparedByAttempt.has(record.attempt_id)) addGap(gaps, "evidence_integrity", "duplicate prepared receipt", record.attempt_id);
		preparedByAttempt.set(record.attempt_id, record);
	}
	for (const record of terminals) {
		if (!preparedByAttempt.has(record.attempt_id) || terminalByAttempt.has(record.attempt_id))
			addGap(gaps, "evidence_integrity", "terminal receipt has no unique prepared receipt", record.record_id);
		terminalByAttempt.set(record.attempt_id, record);
	}

	const expectedGeneration = AUTHORITY_OBSERVATION_GENERATION_V2;
	for (const record of receipts) {
		if (record.observation_generation !== expectedGeneration || record.observation_seed?.observer_version !== AUTHORITY_OBSERVER_VERSION_V2)
			addGap(gaps, "version_discontinuity", "receipt generation or observer version changed", record.record_id);
	}
	for (const observation of input.observations) {
		if (observation.observer_generation !== expectedGeneration || observation.observer_version !== AUTHORITY_OBSERVER_VERSION_V2)
			addGap(gaps, "version_discontinuity", "observation generation or observer version changed", observation.receipt_record_id);
		if (observation.divergence.detected)
			addGap(gaps, "shadow_divergence", `observation divergence: ${observation.divergence.fields.join(",")}`, observation.receipt_record_id);
	}

	const observationsByReceipt = new Map<string, V3AuthorityObservationV2[]>();
	for (const observation of input.observations) {
		const entries = observationsByReceipt.get(observation.receipt_record_id) ?? [];
		entries.push(observation);
		observationsByReceipt.set(observation.receipt_record_id, entries);
	}
	let reconciled = 0;
	for (const terminal of terminals) {
		const entries = observationsByReceipt.get(terminal.record_id) ?? [];
		if (entries.length === 0) {
			addGap(gaps, "missing_observation", "terminal receipt has no automatic observation", terminal.record_id);
			continue;
		}
		if (entries.some((entry) => !sameObservation(entry, entries[0]))) {
			addGap(gaps, "evidence_integrity", "terminal receipt has conflicting observations", terminal.record_id);
			continue;
		}
		if (!bindingMatches(terminal, entries[0])) {
			addGap(gaps, "binding_mismatch", "receipt and observation binding fields differ", terminal.record_id);
			continue;
		}
		reconciled += 1;
	}
	const terminalIds = new Set(terminals.map((terminal) => terminal.record_id));
	for (const receiptId of observationsByReceipt.keys()) {
		if (!terminalIds.has(receiptId)) addGap(gaps, "orphan_observation", "observation has no committed terminal receipt", receiptId);
	}

	const epochTimes = prepared.map((receipt) => validTime(receipt.recorded_at)).filter((value): value is number => value !== null);
	const epochStartedAt = epochTimes.length > 0 ? new Date(Math.min(...epochTimes)).toISOString() : null;
	let windowDays = 0;
	if (epochStartedAt) {
		const start = utcDay(epochStartedAt);
		const end = utcDay(input.now);
		if (start === null || end === null || end < start) addGap(gaps, "evidence_integrity", "readiness clock or epoch timestamp is invalid");
		else windowDays = Math.floor((end - start) / 86_400_000) + 1;
	} else addGap(gaps, "epoch_empty", "no receipt v2 prepared record exists");
	if (epochStartedAt && windowDays < MIN_QUALIFYING_WINDOW_DAYS)
		addGap(gaps, "window_too_short", `qualifying window has ${windowDays} UTC days`);

	const familiesCovered = [...new Set(input.observations.flatMap((observation) => observation.source_events.map((event) => eventFamily(event.action)).filter((family): family is string => Boolean(family))))].sort();
	const familiesMissing = REQUIRED_FAMILIES.filter((family) => !familiesCovered.includes(family));
	if (familiesMissing.length > 0) addGap(gaps, "family_coverage", `missing families: ${familiesMissing.join(",")}`);
	const lifecycles = lifecycleCount(input.observations);
	if (lifecycles < 3) addGap(gaps, "lifecycle_coverage", `only ${lifecycles} complete distinct lifecycles`);

	let migrationPresented: string | null = null;
	let migrationMatch = false;
	let rehearsal = { present: false, result: null as string | null, at: null as string | null };
	if (input.evidence.status === "missing") addGap(gaps, "evidence_bundle_missing", "readiness evidence bundle is missing");
	else if (input.evidence.status === "invalid") addGap(gaps, "evidence_bundle_invalid", input.evidence.reason);
	else {
		const bundle = input.evidence.bundle;
		migrationPresented = bundle.migration_dry_run.digest;
		migrationMatch = Boolean(input.current_migration_digest && migrationPresented === input.current_migration_digest && bundle.migration_dry_run.writes_performed === false);
		if (!migrationMatch) addGap(gaps, "evidence_bundle_invalid", "migration dry-run digest does not match the current report");
		rehearsal = { present: true, result: bundle.rollback_rehearsal.result, at: bundle.rollback_rehearsal.at };
		const rehearsalAt = validTime(bundle.rollback_rehearsal.at);
		const epochAt = epochStartedAt ? validTime(epochStartedAt) : null;
		if (
			bundle.rollback_rehearsal.result !== "passed" ||
			rehearsalAt === null ||
			(epochAt !== null &&
				(rehearsalAt < epochAt || rehearsalAt > (validTime(input.now) ?? -1)))
		)
			addGap(gaps, "rollback_rehearsal_invalid", "rollback rehearsal is outside the current window or did not pass");
	}

	const blocked = gaps.some((gap) => BLOCKING_CODES.has(gap.code));
	const collecting = gaps.some((gap) => !BLOCKING_CODES.has(gap.code));
	return {
		contract: "assurance_kernel/readiness_report/v1",
		status: blocked ? "blocked" : collecting ? "collecting" : "candidate",
		observer_version: AUTHORITY_OBSERVER_VERSION_V2,
		epoch_started_at: epochStartedAt,
		window_started_at: epochStartedAt,
		window_days: windowDays,
		receipts_v2_count: receipts.length,
		observations_v2_count: input.observations.length,
		reconciled_terminal_count: reconciled,
		lifecycle_count: lifecycles,
		families_covered: familiesCovered,
		families_missing: familiesMissing,
		gaps,
		legacy_counts: { ...input.legacy_counts },
		migration_digest: { presented: migrationPresented, current: input.current_migration_digest, match: migrationMatch },
		rollback_rehearsal: rehearsal,
		generated_at: input.now,
	};
}
