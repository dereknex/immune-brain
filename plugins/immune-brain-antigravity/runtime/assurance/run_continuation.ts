// Read-only response continuation. Kernel facts own every action and settlement.
import { createHash } from "node:crypto";
import type { StatusProjectionResult } from "./coordinator";
import { captureGitWorkspaceSnapshot, pathMatchesScope } from "../workspace_scope";

export interface RunSessionIdentity {
	workspace: string;
	session_id: string;
}
export type RunBinding = RunSessionIdentity & { kind: "task"; task_id: string; run_id: string };
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
export type RunContinuationDecision = {
	action: "continue" | "wait" | "pause" | "settled" | "unbound";
	reason: string;
	next_action: string | null;
	state: RunContinuationState;
	/** The pause is only an unchanged progress digest; a Host may yield the turn instead (Spec D12). */
	stalled?: true;
	/**
	 * The bound identity is gone or terminal, so the entry token is spent (Spec
	 * docs/specs/workflow-friction-simplification.spec.md D1.1). Every other pause only
	 * suspends the run until the user replies in the same session.
	 */
	revoke?: true;
};

/** One nudge per unchanged progress digest; the next unchanged boundary pauses. */
export const UNCHANGED_CONTINUATION_LIMIT = 1;
/** Appended to every Stop block reason so a user-only wait is never answered by repeating the request. */
export const USER_WAIT_GUIDANCE = "If the remaining step is an action only the user can perform, waiting for it is a valid stop: stop without repeating the request you already made.";

export function bindRun(binding: RunBinding): RunContinuationState {
	if (!binding.workspace || !binding.session_id || binding.kind !== "task" || !binding.task_id || !binding.run_id)
		throw new Error("run continuation requires an exact session and committed run identity");
	return { binding, progress_digest: null, unchanged_observations: 0, boundary_id: null };
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

export function decideRunContinuation(previous: RunContinuationState,
	observation: TaskContinuationObservation): RunContinuationDecision {
	const result = (action: RunContinuationDecision["action"], reason: string, next_action: string | null,
		state = previous): RunContinuationDecision => ({ action, reason, next_action, state });
	const binding = previous.binding;
	if (binding.workspace !== observation.workspace || binding.session_id !== observation.session_id)
		return result("unbound", "Host session or workspace changed", null);
	if (binding.kind !== observation.kind)
		return { ...result("pause", "run observation does not match the bound entry", null), revoke: true };
	if (observation.host_failure)
		return result("pause", observation.host_failure, null);

	let progressDigest: string;
	let nextAction: string;
	let wait = false;
	const { status } = observation;
	const p = status.projection;
	if (status.error || status.task_id !== binding.task_id || p.run_id !== binding.run_id)
		return { ...result("pause", status.error ?? "Kernel task/run identity changed", null), revoke: true };
	if (p.lifecycle === "done" && p.completion_ready && status.claim === null)
		return result("settled", "Kernel terminal settlement confirmed", null);
	if (p.lifecycle === "stopped" && status.claim === null)
		return { ...result("pause", "Kernel task stopped", null), revoke: true };
	if (status.claim?.task_id !== binding.task_id || status.claim.lifecycle_status !== "active" || p.lifecycle !== "active")
		return { ...result("pause", "Kernel authority is missing or contradictory", null), revoke: true };
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
	if (previous.boundary_id === observation.boundary_id)
		return result("wait", "duplicate Host boundary", null);
	const unchanged = wait ? previous.unchanged_observations : previous.progress_digest === progressDigest ? previous.unchanged_observations + 1 : 0;
	const state = { ...previous, progress_digest: progressDigest, unchanged_observations: unchanged, boundary_id: observation.boundary_id };
	// Running reviewers/executors progress through their own supervised exit boundary.
	if (!wait && unchanged >= UNCHANGED_CONTINUATION_LIMIT)
		return { ...result("pause", "no substantive progress across continuation boundaries", nextAction, state), stalled: true };
	return result(wait ? "wait" : "continue", wait ? "observed foreground work is still running" : "authorized work remains", nextAction, state);
}
