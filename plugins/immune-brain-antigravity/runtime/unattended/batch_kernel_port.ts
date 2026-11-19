// The one production child Kernel port for unattended batch runs (D5 of
// docs/specs/deepen-authority-seams.spec.md). runtime/unattended owns every
// Kernel-facing member; a Host supplies only advanceTask, its own progression
// seam. Git operations are not Kernel-port members: the runner drives them
// through BatchRunnerGitPort alone.
import { observeParentCompletion } from "./batch_git";
import type { InitiativeObservation } from "./types";
import { projectAssurance, type AssuranceProjectionResult } from "../kernel/assurance_projection";
import { deriveChildEnrollment, type BatchAuthorizationBinding, type BatchAuthorityRegistry } from "../kernel/batch_authority";
import { enrollTask } from "../kernel/enrollment";
import type { EnrollmentAuthorityRegistry } from "../kernel/enrollment_authority";
import { readTaskRecordRaw } from "../kernel/storage";
import { readActiveClaimTaskId, isOwnBatchClaim } from "./batch_preflight";
import type { AnyBatchRunStateRecord } from "./batch_state";
import type { TaskRecord } from "../kernel/types";
import type { TaskRecordRead } from "../assurance/coordinator";
import type { AssuranceRecovery } from "../assurance/coordinator";
import type { QaCheckDiagnostic } from "../assurance/qa";

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
		binding: Pick<import("../kernel/batch_authority").ValidatedBatchAuthorization,
			"batch_id" | "plan_digest" | "base_head" | "initiative_slug" | "budget">;
	}): import("../kernel/batch_authority").ValidatedBatchAuthorization;
}

export type BatchChildAdvanceResult = { diagnostics?: QaCheckDiagnostic[]; environment_failure?: boolean; recovery?: AssuranceRecovery } & (
	| { state: "completed" }
	| { state: "stopped" }
	| { state: "failed"; reason: string }
	| { state: "rework"; operation: "qa" | "review"; summary: string }
	| { state: "blocked"; reason: string }
	| { state: "review_ready"; operation_id: string }
	| { state: "review_preparation_failed"; operation: "review"; operation_id: string; reason: string });

/** The one tracker effect a lane batch may cause: closing an integrated child's Issue. */
export interface BatchTrackerPort {
	markTerminal(
		root: string,
		input: { task_id: string; phase: "done"; terminal_event_id: string },
	): Promise<{ status: string; message: string }>;
}

/** Failed atomic QA attempts observed through Kernel history, including Parent-driven QA. */
export function batchQaFailureFacts(record: Pick<TaskRecord, "history"> & { findings: NonNullable<TaskRecordRead["record"]>["findings"] }) {
	const failed = record.history.filter((event) => event.type === "request_rework" && event.authority?.authority_kind === "qa");
	return { qa_failure_count: failed.length, last_qa_failure_at: failed.at(-1)?.at ?? null,
		recovery_findings: record.findings.filter(f => f.status === "open").map(f => ({ id: f.id, kind: f.kind, status: f.status, acceptance_id: f.acceptance_id })) };
}

/** Inputs the shared port closes over. Only advanceTask is Host-owned. */
export interface BatchKernelPortInput {
	/** Worktree root the batch runs in. */
	root: string;
	parent?: InitiativeObservation;
	/** Enrollment authority registry shared with the single Enrollment entry (D3). */
	enrollmentRegistry: EnrollmentAuthorityRegistry;
	/** The batch's registry, derived capability and validated binding. */
	registry: BatchAuthorityRegistry;
	capability: object;
	binding: BatchAuthorizationBinding;
	/** The Host's own child progression seam; the only member the Host supplies. */
	advanceTask(root: string, taskId: string): Promise<BatchChildAdvanceResult>;
	/** Resume ownership context straight from the batch preflight projection. */
	resume: {
		isResuming: boolean;
		existingBatch: AnyBatchRunStateRecord | null;
		batchBranch: string;
	};
	/** Optional test overrides for the remaining members (invariant I5). */
	overrides?: Partial<BatchRunnerKernelPort>;
	/** Test seam for the shared port's Kernel endpoints; production uses the real ones. */
	deps?: {
		deriveChildEnrollment?: typeof deriveChildEnrollment;
		enrollTask?: typeof enrollTask;
		projectAssurance?: typeof projectAssurance;
		readTaskRecordRaw?: typeof readTaskRecordRaw;
	};
}

/**
 * Build the production child Kernel port. A Host contributes only advanceTask
 * (plus its test overrides); enrollment goes through the single Enrollment
 * entry, projection and ownership are shared, and batch authorization is
 * validated against the authoritative registry.
 */
export function createBatchKernelPort(input: BatchKernelPortInput): BatchRunnerKernelPort {
	const project = input.deps?.projectAssurance ?? projectAssurance;
	const readRecord = input.deps?.readTaskRecordRaw ?? readTaskRecordRaw;
	const deriveEnrollment = input.deps?.deriveChildEnrollment ?? deriveChildEnrollment;
	const enrollKernelTask = input.deps?.enrollTask ?? enrollTask;
	const base: BatchRunnerKernelPort = {
		canStartTask: async taskId => {
			if (!input.parent) return true;
			const task = input.parent.tasks.find(child => child.task_id === taskId);
			if (!task) throw new Error("authorized child absent from confirmed Parent topology");
			const authorizedIds = new Set(input.registry.children(input.capability).map(child => child.task_id));
			const external = task.blocked_by.filter(id => !authorizedIds.has(id));
			if (!external.length) return true;
			const observation = await observeParentCompletion(input.root, input.parent.initiative_id, external);
			return observation.missing_task_ids.length === 0;
		},
		enrollTask: async ({ root, task_id, batch }) => {
			const now = new Date().toISOString();
			const derived = deriveEnrollment(root, batch.registry, {
				capability: batch.capability,
				binding: input.binding,
				task_id,
				expected_head: batch.binding.expected_head,
				now,
			});
			await enrollKernelTask(root, input.enrollmentRegistry, {
				binding: derived.binding,
				batch: {
					registry: batch.registry,
					capability: batch.capability,
					binding: input.binding,
					expected_head: batch.binding.expected_head,
				},
				now,
			});
			// The enrollment itself is the effect; its record is re-read below.
			const recordRaw = readRecord(root, task_id);
			return { record_revision: recordRaw.revision };
		},
		advanceTask: input.advanceTask,
		projectTask: async (root, taskId) => {
			const fresh = await project(root, taskId);
			if (!fresh.claim || fresh.projection.lifecycle !== "active" || fresh.error !== null) return fresh;
			const { record, revision } = readRecord(root, taskId);
			if (!record || revision !== fresh.projection.record_revision)
				throw new Error(`Kernel recovery projection changed for ${taskId}`);
			return { ...fresh, ...batchQaFailureFacts(record) };
		},
		ownsTaskClaim: (taskId) =>
			input.registry.isChildConsumed(input.capability, taskId),
		validateBatchAuthorization: (request) =>
			request.registry.inspect(request.capability, request.binding as never),
	};
	const port: BatchRunnerKernelPort = { ...base, ...(input.overrides ?? {}) };
	const overriddenOwnsTaskClaim = port.ownsTaskClaim;
	return {
		...port,
		ownsTaskClaim: (taskId) => {
			if (input.resume.isResuming && taskId === readActiveClaimTaskId(input.root)) {
				// Re-verify the CURRENT claim identity synchronously: a claim swapped
				// during confirmation is never adopted.
				return isOwnBatchClaim(input.root, input.resume.existingBatch!, taskId, input.resume.batchBranch);
			}
			return overriddenOwnsTaskClaim(taskId);
		},
	};
}
