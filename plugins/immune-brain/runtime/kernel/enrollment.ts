// P2B0 canary enrollment core. NOT exported from kernel/index.ts.
// Atomically creates TaskRecord v3 + workspace working claim + backend claim
// for one confirmed canary task. Requires a valid EnrollmentCapability.
// No CLI, runtime route, or production issuer exists in P2B0.

import { canonicalIntentHash, readTaskIntent } from "./intent";
import {
	type EnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "./enrollment_authority";
import { readTaskTombstone, type BackendClaim } from "./backend_claim";
import { preparePiCanary, readGitHead } from "./pi_canary_prepare";
import {
	commitEnrollmentLocked,
	readTaskRecordRaw,
	readWorkspaceStateRaw,
	withKernelStoreLock,
} from "./storage";
import type { TaskRecord, TaskRecordV4, WorkspaceStateLike } from "./types";

export interface EnrollCanaryInput {
	task_id: string;
	intent_path: string;
	intent_revision: number;
	preparation_digest: string;
	capability: object;
	capability_binding: EnrollmentCapabilityBinding;
	now: string;
}

export interface EnrollCanaryResult {
	record: TaskRecord;
	backend_claim: BackendClaim;
	workspace: { revision: string; state: WorkspaceStateLike };
}

type EnrollmentPreconditionState = {
	validated: ReturnType<EnrollmentAuthorityRegistry["inspect"]> | null;
	current: ReturnType<typeof readTaskRecordRaw> | null;
	workspace: ReturnType<typeof readWorkspaceStateRaw> | null;
	intent: Awaited<ReturnType<typeof readTaskIntent>> | null;
	gitBaseHead: string | null;
};

type EnrollmentPreconditionResult = EnrollmentPreconditionState & {
	blockers: string[];
};

function runEnrollmentPreconditionChecks<T>(
	root: string,
	input: EnrollCanaryInput,
	capability: object,
	registry: EnrollmentAuthorityRegistry,
	mode: "report" | "fail_fast",
	beforeLock: (validated: EnrollmentPreconditionState["validated"]) => void,
	onReady: (state: EnrollmentPreconditionState) => T,
): T;
function runEnrollmentPreconditionChecks(
	root: string,
	input: EnrollCanaryInput,
	capability: object,
	registry: EnrollmentAuthorityRegistry,
	mode: "report" | "fail_fast",
	beforeLock: (validated: EnrollmentPreconditionState["validated"]) => void,
): EnrollmentPreconditionResult;
function runEnrollmentPreconditionChecks<T>(
	root: string,
	input: EnrollCanaryInput,
	capability: object,
	registry: EnrollmentAuthorityRegistry,
	mode: "report" | "fail_fast",
	beforeLock: (validated: EnrollmentPreconditionState["validated"]) => void,
	onReady?: (state: EnrollmentPreconditionState) => T,
): T | EnrollmentPreconditionResult {
	const blockers: string[] = [];
	let validated: EnrollmentPreconditionState["validated"] = null;
	try {
		validated = registry.inspect(capability, input.capability_binding);
		if (mode === "fail_fast" && validated.task_id !== input.task_id)
			throw new Error("enrollment capability task mismatch");
	} catch (error) {
		if (mode === "fail_fast") throw error;
		blockers.push(`capability: ${error instanceof Error ? error.message : String(error)}`);
	}
	beforeLock(validated);

	return withKernelStoreLock(root, () => {
		let current: EnrollmentPreconditionState["current"] = null;
		let workspace: EnrollmentPreconditionState["workspace"] = null;
		let intent: EnrollmentPreconditionState["intent"] = null;
		let gitBaseHead: string | null = null;
		const fail = (report: string, error: unknown) => {
			if (mode === "fail_fast")
				throw error instanceof Error ? error : new Error(String(error));
			blockers.push(report);
		};

		const tombstone = readTaskTombstone(root, input.task_id);
		if (tombstone) {
			fail(
				"task tombstone exists; same-task re-enrollment is forbidden",
				new Error(`task ${input.task_id} is terminal; same-task re-enrollment is forbidden`),
			);
		} else {
			current = readTaskRecordRaw(root, input.task_id);
			if (current.record)
				fail(
					"task record already exists",
					new Error(`task ${input.task_id} already has a TaskRecord`),
				);
		}
		workspace = readWorkspaceStateRaw(root);
		if (workspace.state.current_working !== null)
			fail(
				`workspace already owned by ${workspace.state.current_working}`,
				new Error(`workspace is already owned by ${workspace.state.current_working}`),
			);
		try {
			intent = readTaskIntent(root, input.task_id);
		} catch (error) {
			fail(`intent: ${error instanceof Error ? error.message : String(error)}`, error);
		}
		try {
			gitBaseHead = readGitHead(root);
		} catch (error) {
			fail(`git base: ${error instanceof Error ? error.message : String(error)}`, error);
		}

		const state: EnrollmentPreconditionState = {
			validated,
			current,
			workspace,
			intent,
			gitBaseHead,
		};
		return onReady ? onReady(state) : { ...state, blockers };
	});
}

function buildTaskRecordV4(
	input: EnrollCanaryInput,
	intent: Awaited<ReturnType<typeof readTaskIntent>>,
	gitBaseHead: string,
): TaskRecordV4 {
	return {
		contract: "assurance_kernel/task_record/v4",
		task_id: input.task_id,
		intent_snapshot: intent.intent,
		intent_ref: {
			path: input.intent_path,
			content_hash: intent.content_hash,
		},
		lifecycle: "active",
		artifact_state: "active",
		baseline: intent.content_hash,
		git_base_head: gitBaseHead,
		attestations: [],
		findings: [],
		history: [],
	};
}

/**
 * Rehearsal: validates every precondition and returns evidence, but writes
 * nothing and never consumes the capability.
 */
export function runEnrollmentRehearsal(
	root: string,
	input: EnrollCanaryInput,
	capability: object,
	registry: EnrollmentAuthorityRegistry,
): {
	rehearsed: boolean;
	writes_performed: boolean;
	evidence: {
		contract: "assurance_kernel/enrollment_rehearsal/v1";
		task_id: string;
		outcome: "ready" | "not_ready";
		blockers: string[];
		generated_at: string;
	};
} {
	const preconditions = runEnrollmentPreconditionChecks(
		root,
		input,
		capability,
		registry,
		"report",
		() => undefined,
	);
	return {
		rehearsed: true,
		writes_performed: false,
		evidence: {
			contract: "assurance_kernel/enrollment_rehearsal/v1",
			task_id: input.task_id,
			outcome: preconditions.blockers.length === 0 ? "ready" : "not_ready",
			blockers: preconditions.blockers,
			generated_at: input.now,
		},
	};
}

/**
 * Atomic canary enrollment. Runs inside the same store lock as v1/v2
 * transactions; consumes the capability only after every precondition
 * passes, immediately before writing the enrollment marker.
 */
export function enrollCanaryTask(
	root: string,
	input: EnrollCanaryInput,
	registry: EnrollmentAuthorityRegistry,
): EnrollCanaryResult {
	let gitBaseHead: string | null = null;
	return runEnrollmentPreconditionChecks(
		root,
		input,
		input.capability,
		registry,
		"fail_fast",
		() => {
			// v4 storage retirement: the capability is bound to the preparation
			// digest computed from Kernel owners only. Recompute it before the
			// locked owner reads and reject if the owner set changed.
			const recomputed = preparePiCanary(root, { task_id: input.task_id, now: input.now });
			if (recomputed.digest !== input.preparation_digest)
				throw new Error("enrollment preparation digest mismatch");
			gitBaseHead = recomputed.git_base_head;
			if (!gitBaseHead)
				throw new Error(recomputed.git_error ?? "enrollment requires a committed Git HEAD");
		},
		(checks) => {
			if (!checks.validated || !checks.intent || !checks.workspace || !checks.current)
				throw new Error("enrollment precondition state incomplete");
			if (checks.intent.intent.revision !== input.intent_revision)
				throw new Error("intent revision mismatch");
			if (checks.intent.content_hash !== checks.validated.intent_content_hash)
				throw new Error("intent content hash mismatch");
			// The confirmation is bound to this exact commit; a moved HEAD means the
			// operator approved a different base than the one being recorded.
			if (checks.gitBaseHead !== gitBaseHead)
				throw new Error("Git HEAD moved after the enrollment confirmation");

			// consume immediately before the marker write
			registry.consume(input.capability, input.capability_binding);

			const record = buildTaskRecordV4(input, checks.intent, gitBaseHead);
			const nextWorkspace: WorkspaceStateLike = {
				...checks.workspace.state,
				current_working: input.task_id,
			};
			const claim: BackendClaim = {
				contract: "assurance_kernel/backend_claim/v2",
				backend: "kernel",
				task_id: input.task_id,
				intent_revision: input.intent_revision,
				intent_content_hash: checks.intent.content_hash,
				enrollment_event_id: `enroll-${input.task_id}-${input.now}`,
				lifecycle_status: "active",
				created_at: input.now,
				updated_at: input.now,
			};
			const mutation = commitEnrollmentLocked(
				root,
				input.task_id,
				{
					contract: "assurance_kernel/workspace_transaction/v2",
					task_id: input.task_id,
					expected_record_hash: checks.current.revision,
					next_record_content: `${JSON.stringify(record, null, 2)}\n`,
					expected_workspace_hash: checks.workspace.revision,
					next_workspace_content: `${JSON.stringify(nextWorkspace, null, 2)}\n`,
				},
				claim as unknown as Record<string, unknown>,
			);
			return {
				record: mutation.record,
				backend_claim: claim,
				workspace: { revision: "", state: mutation.workspace },
			};
		},
	);
}
