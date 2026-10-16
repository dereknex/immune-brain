// Read-only response continuation. Kernel/batch facts own every action and settlement.
import { createHash } from "node:crypto";
import type { StatusProjectionResult } from "./coordinator";
import { captureGitWorkspaceSnapshot, pathMatchesScope } from "../workspace_scope";
import { startableChildren } from "../unattended/batch_schedule";
import { readAnyBatchRunState, isLaneBatchRecord } from "../unattended/batch_state";
import { observeInitiative } from "../unattended/batch_plan";
import { observeParentCompletion, observeNativeParent } from "../unattended/batch_git";
import { projectTaskStatus } from "./coordinator";
import { readActiveClaimTaskId } from "../unattended/batch_preflight";
import { readTaskIntent } from "../kernel/intent";
import { readSettledTaskEvidence, readTaskRecordRaw } from "../kernel/storage";

export interface RunSessionIdentity {
	workspace: string;
	session_id: string;
}
export type RunBinding = RunSessionIdentity & (
	| { kind: "task"; task_id: string; run_id: string }
	| { kind: "parent"; initiative_slug: string; batch_id: string | null; plan_digest: string; final_verification?: string[]; blocked_native_tasks?: string[] }
);
export type ReviewContinuationState = "unobserved" | "ready" | "running" | "returned" | "rejected";
export interface RunContinuationState {
	binding: RunBinding;
	progress_digest: string | null;
	unchanged_observations: number;
	boundary_id: string | null;
}
export interface TaskContinuationObservation extends RunSessionIdentity {
	kind: "task";
	boundary_id: string;
	status: StatusProjectionResult;
	/** Source byte digest, including unstaged scope edits; never a delivery proof. */
	source_digest: string;
	review: ReviewContinuationState;
	recovery_action?: string;
	/** A concrete failed/cancelled Host operation; it must never be auto-retried. */
	host_failure?: string;
}
export interface ParentContinuationObservation extends RunSessionIdentity {
	kind: "parent";
	boundary_id: string;
	initiative_slug: string;
	batch_id: string | null;
	plan_digest: string;
	/** Includes dependency readiness, integrations, corrections and final verification. */
	progress_digest: string;
	all_required_integrated: boolean;
	final_passed: boolean;
	pending_repair: boolean;
	runnable: boolean;
	executors_running: boolean;
	next_action: string;
	blocked_reason?: string;
	host_failure?: string;
}
export type RunContinuationDecision = {
	action: "continue" | "wait" | "pause" | "settled" | "unbound";
	reason: string;
	next_action: string | null;
	state: RunContinuationState;
};

/** One nudge per unchanged progress digest; the next unchanged boundary pauses. */
export const UNCHANGED_CONTINUATION_LIMIT = 1;
/** Appended to every Stop block reason so a user-only wait is never answered by repeating the request. */
export const USER_WAIT_GUIDANCE = "If the remaining step is an action only the user can perform, waiting for it is a valid stop: stop without repeating the request you already made.";

export function bindRun(binding: RunBinding): RunContinuationState {
	if (!binding.workspace || !binding.session_id ||
		(binding.kind === "task" ? !binding.task_id || !binding.run_id : !binding.initiative_slug || (binding.batch_id !== null && !binding.batch_id) || !binding.plan_digest))
		throw new Error("run continuation requires an exact session and committed run identity");
	if (binding.kind === "parent" && binding.blocked_native_tasks !== undefined &&
		(!Array.isArray(binding.blocked_native_tasks) || !binding.blocked_native_tasks.every(id => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id))))
		throw new Error("invalid failed native task observations");
	return { binding, progress_digest: null, unchanged_observations: 0, boundary_id: null };
}

/** Suppress only this rejected gate; independently authorized branches remain runnable. */
export async function parkFailedCriticalGate(binding: RunBinding, taskId: string | undefined): Promise<boolean> {
	if (binding.kind !== "parent" || !taskId || readActiveClaimTaskId(binding.workspace) === taskId) return false;
	const parent = await observeInitiative(binding.workspace, binding.initiative_slug);
	if (!parent.tasks.some(task => task.task_id === taskId) || readTaskIntent(binding.workspace, taskId).intent.risk !== "critical") return false;
	binding.blocked_native_tasks = [...new Set([...(binding.blocked_native_tasks ?? []), taskId])];
	return true;
}

/** Explicit cancellation or a planning entry releases conversational continuation only. */
export function releasesRunBinding(prompt: string, phase: "run" | "planner" | "brainstorm" | null): boolean {
	return phase === "planner" || phase === "brainstorm" ||
		/^(?:stop|cancel|pause)(?:\s+(?:execution|the task|this run))?[.!\s]*$/i.test(prompt.trim()) ||
		/^(?:请)?(?:停止|取消|暂停)(?:执行|任务|本次运行|这个任务)?[。！!\s]*$/.test(prompt.trim());
}

function digest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function scopedSourceDigest(root: string, scope: readonly string[]): string {
	const snapshot = captureGitWorkspaceSnapshot(root);
	if (!snapshot) throw new Error("cannot observe source progress without a Git workspace");
	return digest(Object.entries(snapshot.dirty_files).filter(([path]) => scope.some(entry => pathMatchesScope(path, entry))));
}

function finalProgress(report: import("../unattended/batch_final_verification").FinalVerificationReport | undefined): unknown {
	return report ? { passed: report.passed, head: report.head,
		results: report.results.map(result => ({ command: result.command, passed: result.passed, exit_code: result.exit_code, signal: result.signal })) } : null;
}

export async function observeParentRun(binding: RunBinding & { kind: "parent" },
	boundaryId: string, review: ReviewContinuationState = "unobserved",
	recoveryAction?: string): Promise<ParentContinuationObservation> {
	const root = binding.workspace;
	if (binding.batch_id === null) {
		const facts = await observeNativeParent(root, binding.initiative_slug, undefined, binding.blocked_native_tasks);
		if (!facts || facts.plan_digest !== binding.plan_digest) throw new Error("native Parent plan identity changed");
		let nextAction = ["verify", "repair"].includes(facts.action) ?
			`Call start_unattended_batch for ${binding.initiative_slug} with final_verification ${JSON.stringify(binding.final_verification ?? facts.native?.final_verification.results.map(result => result.command) ?? [])}; if it fails, diagnose and canonically prepare/validate the stable original-goal repair before fresh native Enrollment` : facts.next_action;
		let runnable = ["verify", "repair", "integrate"].includes(facts.action) || (facts.action === "enroll" && facts.task_id !== null);
		let running = false;
		let taskProgress: unknown = null;
		if (facts.action === "drive" && facts.task_id) {
			const status = await projectTaskStatus(root, facts.task_id);
			const task = readTaskRecordRaw(root, facts.task_id).record;
			if (status.error || !task || !status.projection.run_id) throw new Error(status.error ?? "native Parent has no exact child run");
			const source = scopedSourceDigest(root, task.intent_snapshot.scope_hint);
			const decision = decideRunContinuation(bindRun({ kind: "task", workspace: root, session_id: binding.session_id,
				task_id: facts.task_id, run_id: status.projection.run_id }), { kind: "task", workspace: root, session_id: binding.session_id,
				boundary_id: boundaryId, status, source_digest: source, review, recovery_action: recoveryAction });
			runnable = decision.action === "continue"; running = decision.action === "wait";
			nextAction = decision.next_action ?? decision.reason; taskProgress = decision.state.progress_digest;
		}
		if (facts.action === "repair" && (facts.native?.repair_tasks?.length ?? 0) >= 2) {
			runnable = false; nextAction = "Parent coordinator correction budget exhausted; request a user decision";
		}
		return { kind: "parent", workspace: root, session_id: binding.session_id, boundary_id: boundaryId,
			initiative_slug: binding.initiative_slug, batch_id: null, plan_digest: facts.plan_digest,
			progress_digest: digest({ proof: facts.proof, action: facts.action, repair_tasks: facts.native?.repair_tasks,
				final: finalProgress(facts.native?.final_verification), taskProgress }),
			all_required_integrated: facts.proof.missing_task_ids.length === 0, final_passed: facts.proof.final_passed,
			pending_repair: facts.action === "repair", runnable, executors_running: running,
			next_action: nextAction, blocked_reason: facts.proof.reason ?? undefined };
	}
	const record = readAnyBatchRunState(root, binding.batch_id);
	if (!record || record.initiative_slug !== binding.initiative_slug || record.plan_digest !== binding.plan_digest)
		throw new Error("Parent continuation has no matching persisted batch identity");
	const plan = await observeInitiative(root, binding.initiative_slug);
	const completion = await observeParentCompletion(root, binding.initiative_slug, plan.tasks.map(child => child.task_id));
	let runnable = false;
	let running = false;
	let nextAction = `Call start_unattended_batch for ${binding.initiative_slug} to consume the current authorized handoff`;
	let childProgress: unknown = null;
	const activeTask = readActiveClaimTaskId(root);
	const nativeTask = activeTask && !record.children.some(child => child.task_id === activeTask) &&
		(plan.tasks.some(child => child.task_id === activeTask) || record.repair_tasks?.some(task => task.task_id === activeTask));
	const activeChild = nativeTask ? { task_id: activeTask } : record.children.find(child => child.state === "enrolled" || child.state === "settled");
	if (activeChild && (!isLaneBatchRecord(record) || nativeTask)) {
		const status = await projectTaskStatus(root, activeChild.task_id);
		if (status.error) throw new Error(status.error);
		if (status.projection.lifecycle === "active" && status.projection.run_id) {
			const task = readTaskRecordRaw(root, activeChild.task_id).record;
			if (!task) throw new Error("Parent's active child has no TaskRecord");
			const source = scopedSourceDigest(root, task.intent_snapshot.scope_hint);
			const taskBinding = bindRun({ kind: "task", workspace: root, session_id: binding.session_id,
				task_id: activeChild.task_id, run_id: status.projection.run_id });
			const decision = decideRunContinuation(taskBinding, { kind: "task", workspace: root, session_id: binding.session_id,
				boundary_id: boundaryId, status, source_digest: source, review, recovery_action: recoveryAction });
			runnable = decision.action === "continue";
			running = decision.action === "wait";
			nextAction = decision.next_action ?? decision.reason;
			childProgress = decision.state.progress_digest;
		} else if (status.projection.lifecycle === "done") runnable = true;
	} else {
		const live = isLaneBatchRecord(record) ? record.children.filter(child => ["lane_admitted", "enrolled", "settled", "lane_committed"].includes(child.state)) : [];
		running = live.length > 0;
		const schedule = plan.tasks.map(task => ({ task_id: task.task_id, blocked_by: task.blocked_by,
			scope_hint: readTaskIntent(root, task.task_id).intent.scope_hint,
			state: completion.integrated_task_ids.includes(task.task_id) ? "committed" as const :
				record.children.find(child => child.task_id === task.task_id)?.state ?? "needs_human" as const }));
		runnable = record.batch_state === "running" && (startableChildren(schedule, isLaneBatchRecord(record) ? record.max_parallel : 1).length > 0 ||
			live.length > 0);
		if (running && runnable) nextAction = `Supervise the observed Lane Executor handoff for ${binding.initiative_slug}; use the Host's live-session wait/observation before resuming the batch, rather than repeatedly observing an unchanged batch`;
	}
	if (!activeChild && !running) {
		for (const child of plan.tasks) {
			if (binding.blocked_native_tasks?.includes(child.task_id)) continue;
			if (record.children.some(candidate => candidate.task_id === child.task_id) || completion.integrated_task_ids.includes(child.task_id)) continue;
			const intent = readTaskIntent(root, child.task_id);
			if (intent.intent.risk !== "critical") continue;
			if (readSettledTaskEvidence(root, child.task_id)?.proof.terminal_lifecycle === "done") {
				runnable = true; nextAction = `Call start_unattended_batch for ${binding.initiative_slug} to integrate the settled critical Slice and resume the intact ordinary batch authorization`; break;
			}
			if (child.blocked_by.every(id => completion.integrated_task_ids.includes(id))) {
				runnable = true; nextAction = `Invoke native single-task Enrollment for critical Slice ${child.task_id}; it consumes no ordinary batch slot. Drive its Loop to settlement, then resume Parent ${binding.initiative_slug}`; break;
			}
		}
	}
	const failedFinal = record.final_verification_result?.passed === false && plan.tasks.every(child => completion.integrated_task_ids.includes(child.task_id));
	const pendingRepair = record.repair_tasks?.some(task => !completion.integrated_task_ids.includes(task.task_id));
	const exhausted = failedFinal && !activeChild && !pendingRepair && (record.repair_tasks?.length ?? 0) >= 2;
	if (failedFinal && !activeChild) nextAction = pendingRepair
		? `Call start_unattended_batch for ${binding.initiative_slug} to integrate the settled repair and run recorded final verification again`
		: "Diagnose final verification, call prepareFinalRepairCandidate with the original goal, diagnosed minimum scope, recorded failure and spent repair count; canonically author/validate its stable candidate, then request fresh native Enrollment. Preserve settled deliveries";
	if (exhausted) nextAction = "Parent coordinator correction budget exhausted; resolve the final failure with a user decision before further repair Enrollment";
	return { kind: "parent", workspace: root, session_id: binding.session_id, boundary_id: boundaryId,
		initiative_slug: record.initiative_slug, batch_id: record.batch_id, plan_digest: record.plan_digest,
		progress_digest: digest({ children: record.children.map(child => ({ task_id: child.task_id, state: child.state, commit: child.commit })),
			commits: record.commits, completion, childProgress, final: finalProgress(record.final_verification_result) }), all_required_integrated: completion.missing_task_ids.length === 0,
		final_passed: completion.final_passed, pending_repair: failedFinal, runnable: !exhausted && (runnable || (failedFinal && !activeChild)),
		executors_running: running, next_action: nextAction, blocked_reason: completion.reason ?? undefined };
}

export function decideRunContinuation(previous: RunContinuationState,
	observation: TaskContinuationObservation | ParentContinuationObservation): RunContinuationDecision {
	const result = (action: RunContinuationDecision["action"], reason: string, next_action: string | null,
		state = previous): RunContinuationDecision => ({ action, reason, next_action, state });
	const binding = previous.binding;
	if (binding.workspace !== observation.workspace || binding.session_id !== observation.session_id)
		return result("unbound", "Host session or workspace changed", null);
	if (binding.kind !== observation.kind)
		return result("pause", "run observation does not match the bound entry", null);
	if (observation.host_failure)
		return result("pause", observation.host_failure, null);

	let progressDigest: string;
	let nextAction: string;
	let wait = false;
	if (binding.kind === "parent" && observation.kind === "parent") {
		if (binding.initiative_slug !== observation.initiative_slug || binding.batch_id !== observation.batch_id || binding.plan_digest !== observation.plan_digest)
			return result("pause", "batch identity changed; reread its authorized plan", null);
		if (observation.all_required_integrated && observation.final_passed && !observation.pending_repair)
			return result("settled", "every required delivery is integrated and final verification passed", null);
		if (!observation.runnable && !observation.executors_running)
			return result("pause", observation.blocked_reason ?? "no executable Parent work remains", observation.next_action);
		progressDigest = observation.progress_digest;
		nextAction = observation.next_action;
		wait = !observation.runnable && observation.executors_running;
	} else if (binding.kind === "task" && observation.kind === "task") {
		const { status } = observation;
		const p = status.projection;
		if (status.error || status.task_id !== binding.task_id || p.run_id !== binding.run_id)
			return result("pause", status.error ?? "Kernel task/run identity changed", null);
		if (p.lifecycle === "done" && p.completion_ready && status.claim === null)
			return result("settled", "Kernel terminal settlement confirmed", null);
		if (p.lifecycle === "stopped" && status.claim === null)
			return result("pause", "Kernel task stopped", null);
		if (status.claim?.task_id !== binding.task_id || status.claim.lifecycle_status !== "active" || p.lifecycle !== "active")
			return result("pause", "Kernel authority is missing or contradictory", null);
		if (p.unresolved_user_decision_ids.length || p.replan_required_ids.length || p.open_user_decision_count ||
			p.next_obligation === "resolve_user_decision" || p.next_obligation === "revise_intent" || p.authorization.state !== "none" || p.authorization.blocked)
			return result("pause", "Kernel requires a concrete user decision or authorization", "Use the existing native authorization operation");
		progressDigest = digest({ lifecycle: p.lifecycle, artifact_state: p.artifact_state, intent_content_hash: p.intent_content_hash,
			diff_hash: p.diff_hash, next_obligation: p.next_obligation, fresh_acceptance_ids: [...p.fresh_acceptance_ids].sort(),
			fresh_approval_kinds: [...p.fresh_approval_kinds].sort(), blocking_finding_ids: [...p.blocking_finding_ids].sort(),
			source_digest: observation.source_digest, review: observation.review });
		if (p.next_obligation === "run_review") {
			switch (observation.review) {
				case "ready": nextAction = "Invoke the exact reserved foreground reviewer once"; break;
				case "running": nextAction = "Await the observed foreground reviewer; do not dispatch another"; wait = true; break;
				case "returned": nextAction = "Call submit_review immediately with the observed verdict before editing"; break;
				case "rejected":
					if (!observation.recovery_action) return result("pause", "Review submission failed without an observed recovery action", null);
					nextAction = observation.recovery_action; break;
				case "unobserved": nextAction = "Call advance_assurance to recover or prepare the current Review reservation"; break;
			}
		} else if (status.warnings?.some(warning => warning.code === "unstaged_scope_paths")) {
			nextAction = "Finish the in-scope implementation and stage task-owned changes before advance_assurance";
		} else {
			switch (p.next_obligation) {
				case "submit_assurance": case "run_qa": nextAction = "Complete in-scope implementation and focused checks, then call advance_assurance"; break;
				case "resolve_findings": nextAction = "Repair the open findings, verify, resolve them and call advance_assurance"; break;
				case "complete": nextAction = "Call advance_assurance to finish Kernel settlement"; break;
				default: return result("pause", "Kernel has no actionable obligation", null);
			}
		}
	} else {
		return result("pause", "run observation does not match the bound entry", null);
	}
	if (previous.boundary_id === observation.boundary_id)
		return result("wait", "duplicate Host boundary", null);
	const unchanged = wait ? previous.unchanged_observations : previous.progress_digest === progressDigest ? previous.unchanged_observations + 1 : 0;
	const state = { ...previous, progress_digest: progressDigest, unchanged_observations: unchanged, boundary_id: observation.boundary_id };
	// Running reviewers/executors progress through their own supervised exit boundary.
	if (!wait && unchanged >= UNCHANGED_CONTINUATION_LIMIT)
		return result("pause", "no substantive progress across continuation boundaries", nextAction, state);
	return result(wait ? "wait" : "continue", wait ? "observed foreground work is still running" : "authorized work remains", nextAction, state);
}
