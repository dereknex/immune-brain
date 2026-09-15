// P2B0 canary enrollment core. NOT exported from kernel/index.ts.
// Atomically creates TaskRecord v3 + workspace working claim + backend claim
// for one confirmed canary task. Requires a valid EnrollmentCapability.
// No CLI, runtime route, or production issuer exists in P2B0.

import { readRunRowByTask, withKernelRead } from "./sqlite_store";
import { readTaskIntent } from "./intent";
import { inspectSpecBinding } from "./spec_binding";
import {
	type EnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "./enrollment_authority";
import type {
	BatchAuthorityRegistry,
	BatchAuthorizationBinding,
} from "./batch_authority";
import type { BackendClaim } from "./backend_claim";
import { preparePiCanary, readGitHead } from "./pi_canary_prepare";
import {
	commitEnrollmentLocked,
	readTaskRecordRaw,
	readWorkspaceStateRaw,
	reconcileKernelAuthority,
	withKernelStoreLock,
} from "./storage";
import type { TaskRecord, TaskRecordV4, WorkspaceStateLike } from "./types";

/**
 * Present only for a batch-derived enrollment. The child slot is consumed
 * inside the same store lock as the TaskRecord write and released again if that
 * write does not commit, so a consumed slot and a TaskRecord always agree.
 */
export interface EnrollBatchContext {
	registry: BatchAuthorityRegistry;
	capability: object;
	binding: BatchAuthorizationBinding;
	/** base_head, then each commit this batch created on its own branch. */
	expected_head: string;
}

export interface EnrollCanaryInput {
	task_id: string;
	intent_path: string;
	intent_revision: number;
	preparation_digest: string;
	capability: object;
	capability_binding: EnrollmentCapabilityBinding;
	batch?: EnrollBatchContext;
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

		// Terminal protection is the *local* committed run, never the audit
		// evidence: another worktree's run of the same logical task exports its
		// own audit directory, and that evidence must not forbid a first
		// enrollment here. Audit files remain readable as historical evidence for
		// tasks this worktree has no run for (see reconcileKernelAuthority).
		const localRun = reconcileKernelAuthority(root, input.task_id);
		const localTerminal =
			localRun.state === "terminal_owner" &&
			withKernelRead(root, (db) => readRunRowByTask(db, input.task_id)) !== null;
		if (localTerminal) {
			fail(
				"local run is terminal; same-task re-enrollment is forbidden",
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
		// The Spec binding is an enrollment precondition, not a freeze surprise: a
		// scope_hint that cannot name the bound active Spec and its archive path is
		// refused here, before any Executor turn, instead of after the work exists.
		// Freeze-time enforcement stays, because enrollment cannot observe
		// post-implementation scope drift.
		if (intent) {
			const binding = inspectSpecBinding(intent.intent);
			if (!binding.ok) fail(binding.message, new Error(binding.message));
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
	// The batch child slot is consumed with the capability and handed back when
	// the enrollment call fails. The commit happens at the outer store
	// transaction, so any throw from this call means nothing was committed and
	// the release has to wrap the whole call rather than only the record write.
	let consumed = false;
	try {
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

			// A batch-derived enrollment must still stand on the lineage the
			// literal user confirmed: child N's base is the commit child N-1
			// produced on the batch branch, and child 1's base is base_head.
			// expected_head is caller-supplied, so anchor its origin here rather
			// than trusting the caller's own assertion: before this batch has
			// consumed any slot it has created no commit, so the only lineage
			// value it can hold is the confirmed base_head.
			if (input.batch) {
				const batch = input.batch.registry.inspect(
					input.batch.capability,
					input.batch.binding,
					Date.parse(input.now),
				);
				if (
					input.batch.registry.consumedChildren(input.batch.capability).length === 0 &&
					input.batch.expected_head !== batch.base_head
				)
					throw new Error(
						`batch_head_lineage_broken: the first child must enroll on the confirmed base_head ${batch.base_head}, not ${input.batch.expected_head}`,
					);
				if (checks.gitBaseHead !== input.batch.expected_head)
					throw new Error(
						`batch_head_lineage_broken: expected ${input.batch.expected_head}, found ${checks.gitBaseHead}`,
					);
			}

			// consume immediately before the store transaction
			registry.consume(input.capability, input.capability_binding);
			consumed = true;
			if (input.batch)
				input.batch.registry.consumeChild(
					input.batch.capability,
					input.batch.binding,
					input.task_id,
					Date.parse(input.now),
				);

			// Set by beforeLock above, which throws when the repository has no
			// committed HEAD. Re-assert it here: the compiler cannot carry a
			// closure's narrowing across to this one.
			if (!gitBaseHead) throw new Error("enrollment requires a committed Git HEAD");
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
	} catch (error) {
		// A child slot is released only when the enrollment provably did not
		// commit. The envelope can also fail *after* the Kernel transaction
		// committed — a follow-up transaction that cannot start, for example —
		// and releasing then would leave the batch view ahead of an owner the
		// Kernel already recorded. The committed run decides, not the throw.
		const ownership = (() => {
			try {
				return {
					known: true,
					owned:
						reconcileKernelAuthority(root, input.task_id).owner_task_id === input.task_id,
				};
			} catch {
				return { known: false, owned: false };
			}
		})();
		// Unknown is not "not committed". When the store cannot be read the slot
		// stays consumed, so the batch view never runs ahead of a run that may
		// exist, and the operator reconciles from the Kernel's own state.
		if (consumed && input.batch && ownership.known && !ownership.owned)
			input.batch.registry.releaseChild(input.batch.capability, input.task_id);
		throw error;
	}
}
