// Shared batch entry and ports. All execution uses the Lane driver.
import type { BatchAuthorityRegistry, ValidatedBatchAuthorization } from "../kernel/batch_authority";
import type { AssuranceProjectionResult } from "../kernel/assurance_projection";
import type { TaskRecord } from "../kernel/types";
import type { AssuranceRecovery, TaskRecordRead } from "../assurance/coordinator";
import type { QaCheckDiagnostic } from "../assurance/qa";
import type { BatchPlanChild, InitiativeObservationReader } from "./types";
import type { BatchRunnerGitPort } from "./batch_git";
import { expectedBatchHead, findExistingActiveBatch, findSettledBatchRecord } from "./batch_preflight";
import { laneRejectionReport, retainedLaneAction, retainedLaneNotices, runLaneBatch, createBatchTrackerPort, type LaneOffer } from "./batch_lanes";
import { isLaneBatchRecord, laneGenerationStore, parkLaneForExecutor, readAnyBatchRunState, writeBatchRunReport, type BatchLaneRunReport, type BatchRunReport } from "./batch_state";
import { exitProofCondition, retainedLaneReason } from "./lane_cleanup";
import { laneDecisionFacts, type LaneDecisionFacts } from "./lane_decision";
import { chooseExecutor, LaneSupervisor, superviseLane, type ExecutorHost, type ExecutorPreferences } from "./lane_supervisor";
import { resolveConfig } from "../config/layered_config";
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
	plan_source?: "single_task";
	/** The Parent supplies an interactive Executor session instead of a runtime child. */
	executor_mode?: "interactive";
	/** Single task only: the exit this call's own wait observed; cleanup compares its generation with the current one. */
	lane_exit_observation?: import("./lane_supervisor").LaneExit | null;
	supervision?: { supervisor: LaneSupervisor; parentHost: ExecutorHost; pluginDir: string; waitMs: number; signal?: AbortSignal; stop?: boolean; request?: ExecutorPreferences };
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
	 * Lane mode: the Review profile resolved from the request-selected Lane
	 * profile, recorded when a new batch starts; a resume keeps the recorded one
	 * (#426 F14).
	 */
	review_profile?: import("../config/layered_config").ReviewProfile;
	/** Bounds each final command; absent, the verifier's own default applies. Not a Host tool parameter. */
	final_verification_timeout_ms?: number;
	/**
	 * Lane mode only: one text instruction the Parent wants to send a Lane
	 * session. The tick records it and answers whether it may be sent; it is
	 * never sent to a blocked or working session.
	 */
	lane_instruction?: import("./batch_lanes").LaneInstructionRequest;
	lane_session_close?: import("./batch_lanes").LaneSessionCloseRequest;
}

/** The one tracker effect a lane batch may cause: closing an integrated child's Issue. */
export interface BatchTrackerPort {
	markTerminal(
		root: string,
		input: { task_id: string; phase: "done"; terminal_event_id: string },
	): Promise<{ status: string; message: string }>;
}

export type { BatchRunReport } from "./batch_state";

export async function stopSingleTaskSupervisor(supervisor: LaneSupervisor, root: string, taskId: string, signal?: AbortSignal) {
	const existing = findExistingActiveBatch(root, taskId);
	if (!existing || existing.corrupt || !isLaneBatchRecord(existing.record) || existing.record.plan_source !== "single_task")
		return { state: "blocked" as const, reason: "lane_executor_not_running", recovery_action: "Inspect the task status in the current Host." };
	const record = existing.record;
	if (record.executor_mode === "interactive")
		return { state: "blocked" as const, reason: "lane_executor_interactive", recovery_action: "Close the Lane's Executor tab yourself; the Lane is retained." };
	const lane = record.children.find(child => child.task_id === taskId)?.lane;
	if (!lane) return { state: "blocked" as const, reason: "lane_executor_not_running", recovery_action: "Inspect the task status in the current Host." };
	const observation = await supervisor.run({ key: `${root}\0${record.batch_id}`, repository: root, lanePath: lane.path, taskId,
		choice: { host: "pi", not_applied: [] }, pluginDir: "", store: laneGenerationStore(root, record.batch_id),
		baseline: "", waitMs: 5_000, graceMs: 1000, signal, stop: true });
	const reason = laneGenerationStore(root, record.batch_id).read()?.state === "interrupted" ? "lane_executor_interrupted" : "lane_executor_stopped";
	const parked = observation.state === "stopped" && observation.exit && record.batch_state === "running"
		? parkLaneForExecutor(root, record.batch_id, taskId, reason) : record;
	const condition = observation.state === "stopped" ? exitProofCondition(laneGenerationStore(root, record.batch_id).read()) : null;
	return { state: "started" as const, batch_id: record.batch_id, report: { ...reportFromLane(parked),
		...(condition ? { lane_refusals: [{ task_id: taskId, path: lane.path, reason: retainedLaneReason(condition) }] } : {}),
		lane_supervision: { ...observation, not_applied: [] } } as unknown as BatchRunReport };
}

function reportFromLane(record: import("./batch_state").BatchLaneRunStateRecord): BatchLaneRunReport {
	return { contract: "assurance_kernel/batch_run_report/v1", batch_id: record.batch_id, initiative_slug: record.initiative_slug,
		batch_state: record.batch_state, max_parallel: record.max_parallel, children: record.children, commits: record.commits,
		reason: null, handoffs: [], next_action: "Continue supervising the Lane.", created_at: record.updated_at };
}

/**
 * The report after a single-task Executor exited and the batch advanced once more. A Lane that waits on a
 * literal-user decision keeps `lane_decision_required` and its next_action: the advanced report alone would
 * tell the caller to start another generation instead of answering the decision (Spec D11).
 */
function afterExecutorExit(advanced: BatchLaneRunReport, observed: BatchLaneRunReport): BatchRunReport {
	const decision = observed.lane_decision_required;
	return { ...advanced, handoffs: advanced.handoffs.filter(h => h.role !== "executor"),
		...(decision ? { lane_decision_required: decision } : {}),
		next_action: decision ? observed.next_action : advanced.handoffs.some(h => h.role === "executor") ? "Call start_unattended_batch again to continue the Lane." : advanced.next_action,
		lane_supervision: observed.lane_supervision } as unknown as BatchRunReport;
}

async function superviseSingle(input: StartBatchInput, report: BatchLaneRunReport): Promise<BatchLaneRunReport> {
	const options = input.supervision!;
	const child = report.children.find(c => c.task_id === input.initiative_slug && c.lane);
	if (!child?.lane) return report;
	const config = resolveConfig(input.root);
	if (!config.lanes.valid) return { ...report, batch_state: "rejected", reason: "lane_config_invalid", next_action: "Correct the Lane configuration and retry." };
	const active = config.lanes.active.value;
	const profile = active ? config.lanes.profiles.value[active] ?? {} : {};
	const choice = chooseExecutor([options.request ?? {}, profile, config.lanes.project_defaults.value], options.parentHost);
	const store = laneGenerationStore(input.root, input.batch_id);
	const observation = await superviseLane(options.supervisor, {
		key: `${input.root}\0${input.batch_id}`, repository: input.root, lanePath: child.lane.path, taskId: child.task_id,
		choice, pluginDir: options.pluginDir, store, baseline: "", waitMs: options.waitMs, graceMs: 1000,
		signal: options.signal, stop: options.stop,
		project: async () => { const result = await input.kernel.projectTask(child.lane!.path, child.task_id);
			if (result.error !== null) throw new Error(`batch_lane_unreadable: ${result.error}`);
			return result.projection;
		},
	});
	if (observation.reason === "lane_executor_no_progress") {
		const parked = parkLaneForExecutor(input.root, input.batch_id, child.task_id, "lane_executor_no_progress");
		report = { ...reportFromLane(parked), reason: batchReason("lane_executor_no_progress").reason, next_action: batchReason("lane_executor_no_progress").recovery_action };
	} else if (observation.state === "stopped" && observation.exit) {
		const reason = store.read()?.state === "interrupted" ? "lane_executor_interrupted" : "lane_executor_stopped";
		const parked = parkLaneForExecutor(input.root, input.batch_id, child.task_id, reason);
		report = { ...reportFromLane(parked), reason, next_action: "Inspect the Lane and resume with a fresh drive entry." };
	} else if (observation.state === "unavailable" || observation.state === "unobservable") {
		report = { ...report, reason: batchReason(observation.state === "unavailable" ? "lane_executor_unavailable" : "lane_executor_unobservable").reason };
	}
	// #426 D5: a Pi Executor outside Herdr is handed to the user. The child stays enrolled, the executor
	// handoff (Lane path and task_id) stays in the report, and no lane_refusals entry is added.
	if (observation.reason === "lane_executor_requires_tui") {
		const tui = batchReason("lane_executor_requires_tui");
		return { ...report, reason: tui.reason, next_action: tui.recovery_action.replaceAll("<task_id>", child.task_id),
			lane_supervision: { ...observation, not_applied: choice.not_applied } } as unknown as BatchLaneRunReport;
	}
	// Spec drive-always-lanes D11: an Executor that stopped on a literal-user decision is answered at this Host's native gate.
	let decision: LaneDecisionFacts | null = null;
	if (observation.state === "exited" && !observation.reason) {
		const read = await input.kernel.projectTask(child.lane.path, child.task_id);
		if (read.error === null) decision = laneDecisionFacts(child.task_id, read.projection);
	}
	// Spec drive-always-lanes D7: a Lane whose Executor did not exit normally under supervision is kept and said so.
	const kept = observation.state === "stopped" || observation.state === "unobservable" || observation.state === "unavailable" || !!observation.reason;
	const condition = observation.reason === "lane_executor_no_progress" ? "the Executor exited twice without Kernel progress" : exitProofCondition(store.read());
	return { ...report, handoffs: report.handoffs.filter(handoff => handoff.role !== "executor"),
		...(kept && condition ? { lane_refusals: [{ task_id: child.task_id, path: child.lane.path, reason: retainedLaneReason(condition) }] } : {}),
		...(decision ? { lane_decision_required: decision } : {}),
		next_action: decision ? `The Lane waits on a user decision (record ${decision.record_revision}). Call request_authorization for ${decision.task_id} in the current Host with record_revision ${decision.record_revision}; it opens the native gate and continues the Lane.` :
			observation.state === "running" ? "Call start_unattended_batch again to continue supervising this generation." :
			observation.state === "unobservable" ? batchReason("lane_executor_unobservable").recovery_action :
			observation.state === "unavailable" ? batchReason("lane_executor_unavailable").recovery_action : report.next_action,
		lane_supervision: { ...observation, not_applied: choice.not_applied } };
}

export async function startBatch(input: StartBatchInput): Promise<BatchRunReport> {
	const recorded = readAnyBatchRunState(input.root, input.batch_id);
	// Keep the recorded execution mode across re-entry; an existing runtime child is never replaced.
	const interactive = recorded ? isLaneBatchRecord(recorded) && recorded.executor_mode === "interactive" : input.executor_mode === "interactive";
	if (interactive) input = { ...input, executor_mode: "interactive", supervision: undefined, lane_exit_observation: null };
	if (input.plan_source === "single_task" && input.supervision && !input.supervision.stop && !resolveConfig(input.root).lanes.valid) {
		const report = recorded && isLaneBatchRecord(recorded) ? reportFromLane(recorded) : null;
		if (!report) throw new Error("lane_config_invalid");
		return { ...report, batch_state: "rejected", reason: "lane_config_invalid" } as unknown as BatchRunReport;
	}
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
		if (input.plan_source === "single_task" && input.supervision && recorded && isLaneBatchRecord(recorded) && recorded.batch_state === "running") {
			const generation = laneGenerationStore(input.root, input.batch_id).read();
			if (generation && ["starting", "running", "unobservable", "exited"].includes(generation.state)) {
				const observed = await superviseSingle(input, reportFromLane(recorded));
				if (observed.reason || observed.lane_supervision?.state !== "exited" || input.supervision.stop)
					return observed as unknown as BatchRunReport;
				const advanced = await runLaneBatch({ ...input, lane_exit_observation: observed.lane_supervision?.exit ?? null }, readAnyBatchRunState(input.root, input.batch_id));
				return afterExecutorExit(advanced, observed);
			}
		}
		const report = await runLaneBatch(input, recorded);
		if (interactive) {
			const child = report.children.find(c => (c.state === "enrolled" || c.state === "needs_human") && c.lane);
			if (child?.lane) {
				const read = await input.kernel.projectTask(child.lane.path, child.task_id);
				if (read.error !== null) throw new Error(`batch_lane_unreadable: ${read.error}`);
				const decision = laneDecisionFacts(child.task_id, read.projection);
				if (decision) return { ...report, lane_decision_required: decision,
					handoffs: report.handoffs.filter(h => h.role !== "executor"),
					next_action: `The Lane waits on a user decision (record ${decision.record_revision}). Use the current Host's native decision gate for ${decision.task_id}; then resume the existing interactive Lane session.` } as unknown as BatchRunReport;
			}
			return { ...report, next_action: report.batch_state === "running" && report.reason === null && report.handoffs.some(h => h.role === "executor")
				? `Run ${input.initiative_slug} in its existing Herdr tab, creating one only when no live tab exists. Resume inside Herdr; re-enter start_unattended_batch with task_id ${input.initiative_slug} and no initiative_slug.`
				: report.next_action } as unknown as BatchRunReport;
		}
		if (input.plan_source === "single_task" && input.supervision && recorded?.batch_state === "needs_human" && report.batch_state === "running") {
			const store = laneGenerationStore(input.root, input.batch_id);
			const generation = store.read();
			if (generation && ["exited", "stopped_by_parent", "interrupted"].includes(generation.state)) store.update(value => {
				if (!value || value.generation !== generation.generation || value.state !== generation.state) throw new Error("lane_executor_generation_changed");
				return { ...value, no_progress: 0, handled_generation: value.generation };
			});
		}
		if (input.plan_source === "single_task" && input.supervision && report.handoffs.some(h => h.role === "executor")) {
			const observed = await superviseSingle(input, report);
			if (!observed.reason && observed.lane_supervision?.state === "exited" && !input.supervision.stop) {
				const advanced = await runLaneBatch({ ...input, lane_exit_observation: observed.lane_supervision?.exit ?? null }, readAnyBatchRunState(input.root, input.batch_id));
				return afterExecutorExit(advanced, observed);
			}
			return observed as unknown as BatchRunReport;
		}
		return report as unknown as BatchRunReport;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!/retired file-store|kernel store|CAS mismatch|store is busy|locked/i.test(message)) throw error;
		if (!recorded) throw error;
		return laneRejectionReport(input, recorded, message,
			"settle the reported kernel store condition and retry in the current Host") as unknown as BatchRunReport;
	}
}
