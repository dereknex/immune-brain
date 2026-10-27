// Shared batch entry and ports. All execution uses the Lane driver.
import type { BatchAuthorityRegistry, ValidatedBatchAuthorization } from "../kernel/batch_authority";
import type { AssuranceProjectionResult } from "../kernel/assurance_projection";
import type { TaskRecord } from "../kernel/types";
import type { AssuranceRecovery, TaskRecordRead } from "../assurance/coordinator";
import type { QaCheckDiagnostic } from "../assurance/qa";
import type { BatchPlanChild, InitiativeObservationReader } from "./types";
import type { BatchRunnerGitPort } from "./batch_git";
import { expectedBatchHead, findSettledBatchRecord } from "./batch_preflight";
import { laneRejectionReport, retainedLaneAction, retainedLaneNotices, runLaneBatch, createBatchTrackerPort, type LaneOffer } from "./batch_lanes";
import { isLaneBatchRecord, readAnyBatchRunState, writeBatchRunReport, type BatchRunReport } from "./batch_state";
import { readTaskTombstone } from "../kernel/backend_claim";
import { observeInitiative } from "./batch_plan";
import { observeParentCompletion, withBatchEvidence } from "./batch_git";
import { batchReason } from "./batch_reasons";

/** Failed atomic QA attempts observed through Kernel history, including Parent-driven QA. */
export function batchQaFailureFacts(record: Pick<TaskRecord, "history"> & { findings: NonNullable<TaskRecordRead["record"]>["findings"] }) {
	const failed = record.history.filter((event) => event.type === "request_rework" && event.authority?.authority_kind === "qa");
	return { qa_failure_count: failed.length, last_qa_failure_at: failed.at(-1)?.at ?? null,
		recovery_findings: record.findings.filter(f => f.status === "open").map(f => ({ id: f.id, kind: f.kind, status: f.status, acceptance_id: f.acceptance_id })) };
}
export async function completedParentReport(root: string, initiativeSlug: string, readInitiative?: InitiativeObservationReader,
	tracker = createBatchTrackerPort(root, initiativeSlug)): Promise<BatchRunReport | null> {
	const candidate = findSettledBatchRecord(root, initiativeSlug);
	if (!candidate || !isLaneBatchRecord(candidate) || candidate.batch_state !== "completed") return null;
	const batch = readAnyBatchRunState(root, candidate.batch_id);
	if (!batch || batch.final_verification_result?.passed !== true) return null;
	const parent = await (readInitiative ?? observeInitiative)(root, initiativeSlug);
	const proof = await observeParentCompletion(root, initiativeSlug, parent.tasks.map(child => child.task_id));
	if (!proof.complete) return null;
	const last = parent.tasks.at(-1);
	const tombstone = last ? await withBatchEvidence(root, batch.branch, expectedBatchHead(batch),
		path => readTaskTombstone(path, last.task_id)) : null;
	let sync: Awaited<ReturnType<BatchTrackerPort["markTerminal"]>> | null = null;
	if (last && tracker) {
		if (!tombstone || tombstone.terminal_lifecycle !== "done") throw new Error("Parent tracker synchronization requires exact terminal evidence");
		try { sync = await tracker.markTerminal(root, { task_id: last.task_id, phase: "done", terminal_event_id: tombstone.terminal_event_id }); }
		catch { sync = { status: "failed", message: "Local Parent completion proved; retry tracker synchronization on this Host" }; }
	}
	// Rebuilt from durable facts, so a reopened report keeps every cleanup notice.
	const retained = isLaneBatchRecord(batch) ? retainedLaneNotices(root, batch) : [];
	const report = {
		contract: "assurance_kernel/batch_run_report/v1" as const,
		batch_id: batch.batch_id, initiative_slug: initiativeSlug, batch_state: batch.batch_state,
		children: batch.children, commits: batch.commits, final_verification: batch.final_verification_result,
		...(sync ? { tracker: sync } : {}),
		...(retained.length ? { lane_refusals: retained } : {}),
		reason: sync?.status === "failed" ? "Local Parent completion proved; tracker synchronization failed" : null,
		next_action: (sync?.status === "failed" ? sync.message : "Parent delivery and final verification passed") + (retained.length ? "." : "") + retainedLaneAction(retained),
		created_at: new Date().toISOString(), ...(isLaneBatchRecord(batch) ? { max_parallel: batch.max_parallel, handoffs: [] } : {}),
	};
	// The first terminal report is historical; return this HEAD's freshly proved observation.
	writeBatchRunReport(root, report);
	return report as unknown as BatchRunReport;
}

export interface BatchRunnerKernelPort {

	/** Enroll one child through the batch-derived capability. */
	enrollTask(input: {
		root: string;
		task_id: string;
		batch: {
			registry: BatchAuthorityRegistry;
			capability: object;
			binding: { batch_id: string; expected_head: string };
		};
	}): Promise<{ record_revision: string }>;
	/** Drive one enrolled child toward its own Kernel terminal settlement. */
	advanceTask(root: string, taskId: string): Promise<BatchChildAdvanceResult>;
	/** review-2(5th round): read-only claim projection for enrollment
	 * reconciliation after an interruption between enrollTask and its state
	 * persistence. Uses the real AssuranceProjectionResult contract; batch
	 * ownership of the claim is verified separately through the authoritative
	 * batch registry, because the Kernel claim carries no batch id. */
	projectTask(root: string, taskId: string): Promise<AssuranceProjectionResult & { qa_failure_count?: number; last_qa_failure_at?: string | null; recovery_findings?: NonNullable<TaskRecordRead["record"]>["findings"] }>;
	/** Authoritative batch ownership check: true when the task's Kernel claim
	 * is held under this batch's derived capability (consumed child slot). */
	ownsTaskClaim(taskId: string): boolean;
	/** Read-only Parent prerequisites outside the ordinary authorization manifest. */
	canStartTask?(taskId: string): Promise<boolean>;
	/** review-8(4th rework): Kernel-side proof that a replacement parked-batch
	 * authorization is genuine and bound to this exact batch_id,
	 * plan_digest, and base_head, validated against the Kernel's authoritative
	 * binding state. Throws on fabrication or mismatch; the driver
	 * must call this before accepting a parked-batch resume. */
	validateBatchAuthorization(input: {
		registry: BatchAuthorityRegistry;
		capability: object;
		binding: Pick<ValidatedBatchAuthorization,
			"batch_id" | "plan_digest" | "base_head" | "initiative_slug" | "budget">;
	}): ValidatedBatchAuthorization;
}

export type BatchChildAdvanceResult = { diagnostics?: QaCheckDiagnostic[]; environment_failure?: boolean; recovery?: AssuranceRecovery } & (
	| { state: "completed" }
	| { state: "stopped" }
	| { state: "failed"; reason: string }
	| { state: "rework"; operation: "qa" | "review"; summary: string }
	| { state: "blocked"; reason: string }
	| { state: "review_ready"; operation_id: string }
	| { state: "review_preparation_failed"; operation: "review"; operation_id: string; reason: string });

export interface StartBatchInput {
	topology_digest?: string;
	root: string;
	batch_id: string;
	initiative_slug: string;
	registry: BatchAuthorityRegistry;
	capability: object;
	children: BatchPlanChild[];
	plan_digest: string;
	base_head: string;
	confirmation_time: string;
	budget: { max_children: number; qa_failure_limit: number };
	now: string;
	kernel: BatchRunnerKernelPort;
	git?: BatchRunnerGitPort;
	/** Present only in lane mode: how many children may run at once. */
	max_parallel?: number;
	/** Present only in lane mode: Lanes someone else created, offered to the batch. */
	lane_offers?: LaneOffer[];
	/**
	 * Lane mode only: the opted-in tracker projection the coordinator runs after
	 * integrating a child. A Lane settlement writes nothing to the tracker, so
	 * this is where its Child Issue is closed, exactly once. Absent, nothing is
	 * projected.
	 */
	tracker?: BatchTrackerPort;
	/**
	 * Lane mode only: the plugin or runtime directory the Lane Executor Host
	 * loads. Absent, the repository's own plugin source is compared when the
	 * repository is the Immune-Brain package; otherwise nothing is compared.
	 */
	executor_runtime?: string;
	/**
	 * The project's full verification commands, recorded when a new batch starts
	 * and run on its branch after every delivery is integrated. A resume uses
	 * the recorded list in either execution mode.
	 */
	final_verification?: string[];
	/**
	 * Lane mode only: one text instruction the Parent wants to send a Lane
	 * session. The tick records it and answers whether it may be sent; it is
	 * never sent to a blocked or working session.
	 */
	lane_instruction?: import("./batch_lanes").LaneInstructionRequest;
}

/** The one tracker effect a lane batch may cause: closing an integrated child's Issue. */
export interface BatchTrackerPort {
	markTerminal(
		root: string,
		input: { task_id: string; phase: "done"; terminal_event_id: string },
	): Promise<{ status: string; message: string }>;
}

export type { BatchRunReport } from "./batch_state";

export async function startBatch(input: StartBatchInput): Promise<BatchRunReport> {
	const recorded = readAnyBatchRunState(input.root, input.batch_id);
	if (recorded && !isLaneBatchRecord(recorded)) {
		const reason = batchReason("batch_record_shape_retired");
		return {
			contract: "assurance_kernel/batch_run_report/v1", batch_id: recorded.batch_id,
			initiative_slug: recorded.initiative_slug, batch_state: "rejected",
			children: recorded.children, commits: recorded.commits,
			reason: reason.reason, next_action: reason.recovery_action, created_at: input.now,
		};
	}
	try {
		return await runLaneBatch(input, recorded) as unknown as BatchRunReport;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!/retired file-store|kernel store|CAS mismatch|store is busy|locked/i.test(message)) throw error;
		if (!recorded) throw error;
		return laneRejectionReport(input, recorded, message,
			"settle the reported kernel store condition and retry in the current Host") as unknown as BatchRunReport;
	}
}
