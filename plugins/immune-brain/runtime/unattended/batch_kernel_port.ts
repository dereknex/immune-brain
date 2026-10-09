// The one production child Kernel port for unattended batch runs (D5 of
// docs/specs/deepen-authority-seams.spec.md). runtime/unattended owns every
// Kernel-facing member; a Host supplies only advanceTask, its own progression
// seam. Git operations are not Kernel-port members: the runner drives them
// through BatchRunnerGitPort alone.
import { projectAssurance } from "../kernel/assurance_projection";
import { deriveChildEnrollment, type BatchAuthorizationBinding, type BatchAuthorityRegistry } from "../kernel/batch_authority";
import { enrollTask } from "../kernel/enrollment";
import type { EnrollmentAuthorityRegistry } from "../kernel/enrollment_authority";
import { readTaskRecordRaw } from "../kernel/storage";
import { readActiveClaimTaskId, isOwnBatchClaim } from "./batch_preflight";
import type { AnyBatchRunStateRecord } from "./batch_state";
import { batchQaFailureFacts, type BatchChildAdvanceResult, type BatchRunnerKernelPort } from "./batch_runner";

/** Inputs the shared port closes over. Only advanceTask is Host-owned. */
export interface BatchKernelPortInput {
	/** Worktree root the batch runs in. */
	root: string;
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
