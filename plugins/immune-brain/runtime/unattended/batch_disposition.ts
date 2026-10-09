// Authority-backed disposition for a batch the plan moved past.
//
// A batch whose plan changed can neither reconfirm (reconfirmation is eligible
// only with zero recorded commits) nor continue (its authorization cannot
// execute the revised plan). Before this module the only exits were editing or
// deleting the state file by hand, which destroyed the evidence of what the
// batch had actually delivered — exactly what happened to the batch retired
// during the parallel-lane Initiative, whose record is no longer on disk.
//
// Retiring is one explicit literal-user decision. It writes the record to the
// terminal `superseded` state under the Kernel store lock, preserves every
// child state, commit and the batch branch, and grants no handoff: children
// this batch never executed carry no commit, no batch trailer and no approval,
// and nothing here infers their delivery from a retired record. The old
// authorization is never reused for the revised plan; a later batch starts
// under its own fresh authorization.
//
// Authority shape, deliberately: the literal-user native confirmation plus a
// locked expected-byte check that the record did not move while the gate was
// open. No Batch Authorization capability is minted, because retiring a record
// consumes no child and enrolls nothing — the capability exists to authorize
// child consumption, and minting one here would be ceremony without a property.
import { readSecureProjectBytes } from "../kernel/storage";
import { batchStatePath } from "../kernel/storage_paths";
import { batchReason, type BatchReason } from "./batch_reasons";
import { findExistingActiveBatch, findSettledBatchRecord, type BatchGateDecision } from "./batch_preflight";
import {
	isTerminalBatchState,
	replaceAnyBatchRunState,
	writeBatchRunReport,
	type AnyBatchRunStateRecord,
	type BatchLaneRunReport,
	type BatchRunReport,
	type BatchRunState,
} from "./batch_state";

/** Child states whose Kernel run is still live; a live run settles on its own. */
const SERIAL_IN_FLIGHT: ReadonlySet<string> = new Set(["enrolled", "settled"]);
const LANE_IN_FLIGHT: ReadonlySet<string> = new Set(["lane_admitted", "enrolled", "settled", "lane_committed"]);

/** Evidence-only child projection for the gate; never an execution readiness. */
export interface StaleBatchChildEvidence {
	task_id: string;
	slice_id: string;
	state: string;
	commit: string | null;
	lane_branch: string | null;
}

/** The exact record identity the literal user is asked to retire. */
export interface StaleBatchFacts {
	batch_id: string;
	initiative_slug: string;
	batch_state: BatchRunState;
	plan_digest: string;
	branch: string;
	base_head: string;
	confirmation_time: string;
	/** Commits this batch itself produced, in child order. */
	recorded_commits: string[];
	children: StaleBatchChildEvidence[];
}

export type StaleBatchLookup =
	/** No active record for this Initiative. */
	| { kind: "none" }
	| { kind: "corrupt"; path: string }
	| { kind: "terminal"; batch_id: string }
	| { kind: "in_flight"; batch_id: string; task_id: string }
	| { kind: "retirable"; record: AnyBatchRunStateRecord; facts: StaleBatchFacts };

const RETIRE_REASON =
	"Retired by an explicit literal-user disposition: the batch plan moved past this record, so its authorization could neither reconfirm nor continue. " +
	"Recorded child commits, child states and the batch branch are preserved as evidence. " +
	"Children this batch never executed carry no commit, no batch trailer and no approval; nothing infers their delivery from this record.";

const RETIRE_NEXT_ACTION =
	"The Initiative has no active batch. Run each remaining child with imm-run under its own authorization, or start a new batch for this Initiative after checking out its batch branch.";

function childEvidenceOf(record: AnyBatchRunStateRecord): StaleBatchChildEvidence[] {
	if (record.contract === "assurance_kernel/batch_run_state/v2")
		return record.children.map((child) => ({
			task_id: child.task_id,
			slice_id: child.slice_id,
			state: child.state,
			commit: child.commit,
			lane_branch: child.lane?.branch ?? null,
		}));
	return record.children.map((child) => ({
		task_id: child.task_id,
		slice_id: child.slice_id,
		state: child.state,
		commit: child.commit,
		lane_branch: null,
	}));
}

function inFlightChildOf(record: AnyBatchRunStateRecord): { task_id: string } | null {
	const inFlight = record.contract === "assurance_kernel/batch_run_state/v2" ? LANE_IN_FLIGHT : SERIAL_IN_FLIGHT;
	return record.children.find((child) => inFlight.has(child.state)) ?? null;
}

/**
 * The Initiative's active batch record as retirement evidence, or why it cannot
 * be retired. Read-only; a terminal record is not a batch to dispose.
 */
export function readStaleBatchLookup(root: string, initiativeSlug: string): StaleBatchLookup {
	const found = findExistingActiveBatch(root, initiativeSlug);
	if (found === null) {
		const settled = findSettledBatchRecord(root, initiativeSlug);
		if (settled) return { kind: "terminal", batch_id: settled.batch_id };
		return { kind: "none" };
	}
	if (found.corrupt) return { kind: "corrupt", path: found.path };
	const record = found.record;
	if (isTerminalBatchState(record.batch_state)) return { kind: "terminal", batch_id: record.batch_id };
	const inFlight = inFlightChildOf(record);
	if (inFlight) return { kind: "in_flight", batch_id: record.batch_id, task_id: inFlight.task_id };
	return {
		kind: "retirable",
		record,
		facts: {
			batch_id: record.batch_id,
			initiative_slug: record.initiative_slug,
			batch_state: record.batch_state,
			plan_digest: record.plan_digest,
			branch: record.branch ?? `imm/${record.initiative_slug}`,
			base_head: record.base_head,
			confirmation_time: record.confirmation_time,
			recorded_commits: [...record.commits],
			children: childEvidenceOf(record),
		},
	};
}

export type RetireStaleBatchOutcome<HostRejection> =
	| {
			outcome: "retired";
			batch_id: string;
			record: AnyBatchRunStateRecord;
			report: BatchRunReport | BatchLaneRunReport;
	  }
	| { outcome: "rejected"; rejection: BatchReason }
	| { outcome: "host_rejection"; value: HostRejection };

/**
 * Retire one Initiative's active batch record after a literal-user gate. The
 * gate receives the record's own evidence; a declined, cancelled or failed
 * interaction writes nothing. Between the gate and the write the record is
 * re-read and must be byte-identical, so a record that moved while the gate was
 * open is never retired under a stale decision.
 */
export async function retireStaleBatch<HostRejection>(options: {
	root: string;
	initiative_slug: string;
	now: string;
	gate: (facts: StaleBatchFacts) => Promise<BatchGateDecision<HostRejection>>;
}): Promise<RetireStaleBatchOutcome<HostRejection>> {
	const { root, initiative_slug: initiativeSlug, now } = options;
	const lookup = readStaleBatchLookup(root, initiativeSlug);
	if (lookup.kind === "none")
		return { outcome: "rejected", rejection: batchReason("stale_batch_absent", `Initiative ${initiativeSlug} has no active batch`) };
	if (lookup.kind === "corrupt")
		return { outcome: "rejected", rejection: batchReason("batch_state_unreadable", lookup.path) };
	if (lookup.kind === "terminal")
		return {
			outcome: "rejected",
			rejection: batchReason("stale_batch_absent", `batch ${lookup.batch_id} already reached a terminal state`),
		};
	if (lookup.kind === "in_flight")
		return {
			outcome: "rejected",
			rejection: batchReason("stale_batch_in_flight", `batch ${lookup.batch_id}, child ${lookup.task_id}`),
		};

	const { record, facts } = lookup;
	const expected = readSecureProjectBytes(root, batchStatePath(record.batch_id));
	const decision = await options.gate(facts);
	if (decision.kind === "host_rejection") return { outcome: "host_rejection", value: decision.value };
	// A decline or a cancel is the Host's own envelope (batchReason
	// confirmation_declined / confirmation_cancelled), so it arrives here as a
	// host_rejection: nothing is written and the record stays parked.

	// Confirmation cannot adopt a record that moved while the gate was open.
	if (!readSecureProjectBytes(root, batchStatePath(record.batch_id)).equals(expected))
		return { outcome: "rejected", rejection: batchReason("plan_changed", record.batch_id) };

	// Children, commits and branch are carried over untouched: the disposition
	// records what the batch did and did not do, and invents neither.
	const retired: AnyBatchRunStateRecord = { ...record, batch_state: "superseded" };
	const stored = replaceAnyBatchRunState(root, expected, retired, () => {
		if (!readSecureProjectBytes(root, batchStatePath(record.batch_id)).equals(expected))
			throw new Error("batch state changed before the disposition was applied");
	});
	const report =
		stored.contract === "assurance_kernel/batch_run_state/v2"
			? writeBatchRunReport(root, {
					contract: "assurance_kernel/batch_run_report/v1",
					batch_id: stored.batch_id,
					initiative_slug: stored.initiative_slug,
					batch_state: stored.batch_state,
					max_parallel: stored.max_parallel,
					children: stored.children,
					commits: stored.commits,
					reason: RETIRE_REASON,
					handoffs: [],
					next_action: RETIRE_NEXT_ACTION,
					created_at: now,
				} satisfies BatchLaneRunReport)
			: writeBatchRunReport(root, {
					contract: "assurance_kernel/batch_run_report/v1",
					batch_id: stored.batch_id,
					initiative_slug: stored.initiative_slug,
					batch_state: stored.batch_state,
					children: stored.children,
					commits: stored.commits,
					reason: RETIRE_REASON,
					next_action: RETIRE_NEXT_ACTION,
					created_at: now,
				} satisfies BatchRunReport);
	return { outcome: "retired", batch_id: stored.batch_id, record: stored, report };
}
