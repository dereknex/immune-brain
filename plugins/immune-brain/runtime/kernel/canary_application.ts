// P2B2 canary application service. NOT exported from kernel/index.ts.
// The only production caller of applyTaskActionV2 and the only production
// owner of the active -> draining claim transition. Accepts a closed semantic
// operation union; callers can never supply raw TaskActionV2, CAS identities,
// authority descriptors, or generic patches. Event identity, timestamps,
// expected hashes, and Intent-derived facts are derived inside the trusted
// application boundary. The paired mutation-authority registry is created
// once inside the Pi lifecycle extension activation closure; tests use
// tests/fixtures/mutation-authority-test-seam.ts.

import {
	type MutationAuthorityRegistry,
} from "./authority_port";
import { applyTaskActionV2 } from "./application_v2";
import {
	readBackendClaim,
	serializeBackendClaim,
	type BackendClaim,
} from "./backend_claim";
import { canonicalIntentHash } from "./intent";
import type { TaskIntentIdentityToken } from "./intent_token_registry";
import {
	commitDrainLocked,
	readTaskRecordV2Raw,
	readWorkspaceStateRaw,
	withKernelStoreLockV2,
} from "./storage";
import { KernelInvariantError } from "./validation";
import type {
	EvidenceStatus,
	StoredTaskMutationV2,
	TaskActionV2,
	TaskApprovalV2,
	TaskFinding,
	TaskIntentV1,
} from "./types";

export type CanaryOperation =
	| { op: "record_evidence"; acceptance_id: string; status: EvidenceStatus; summary: string; actor_id: string }
	| { op: "record_finding"; finding: Omit<TaskFinding, "status" | "source" | "review_round">; actor_id: string }
	| { op: "resolve_finding"; finding_id: string; actor_id: string }
	| { op: "submit_review"; actor_id: string }
	| { op: "request_rework"; capability: object; findings: TaskFinding[]; actor_id: string }
	| { op: "record_approval"; capability: object; approval: TaskApprovalV2; actor_id: string }
	| { op: "record_user_approval"; capability: object; approval: TaskApprovalV2; actor_id: string }
	| { op: "revise_intent"; next_intent: TaskIntentV1; actor_id: string }
	| { op: "approve_breaking_intent_revision"; capability: object; next_intent: TaskIntentV1; actor_id: string }
	| { op: "complete"; actor_id: string }
	| { op: "stop"; capability: object; reason: string; actor_id: string }
	| { op: "resolve_user_decision"; capability: object; finding_id: string; resolution: string; actor_id: string };

export interface CanaryExecuteInput {
	root: string;
	task_id: string;
	operation: CanaryOperation;
	prior_intent_token: TaskIntentIdentityToken;
	/** Trusted injected diff provider; the application derives the diff identity. */
	diffProvider: (root: string, intent: TaskIntentV1) => string;
	now?: string;
}

export interface CanaryApplication {
	readonly registry: MutationAuthorityRegistry;
	/** Execute a closed semantic operation through the paired reducer port. */
	execute(input: CanaryExecuteInput): StoredTaskMutationV2;
	/**
	 * User-confirmed routing-only operation: converges the workspace-active
	 * claim unidirectionally active -> draining under the Kernel store lock.
	 * Preserves TaskRecord and workspace bytes; never touches the reducer.
	 */
	beginDrain(input: {
		root: string;
		task_id: string;
		capability: object;
		now?: string;
	}): BackendClaim;
}

/**
 * Canonical capability-bound action identity for begin_drain. Shared by the
 * issuer (Pi TUI confirm) and the consuming application so the action digest
 * binds the exact drain request.
 */
export function beginDrainCapabilityAction(taskId: string, at: string): TaskActionV2 {
	return {
		type: "stop",
		event_id: `begin_drain:${taskId}:${at}`,
		at,
		actor_id: "user",
		expected_record_hash: "",
		expected_workspace_hash: "",
		diff_hash: "",
		reason: "begin_drain",
	};
}

/**
 * Canonical privileged action builder shared by capability issuance and the
 * consuming application. Returns the exact action object (field order and
 * payload shape) that execute()/applyTaskActionV2() will inspect, so a
 * capability minted against this action's digest always validates.
 * "begin-drain" delegates to the canonical begin_drain action.
 */
export function capabilityActionFor(input: {
	op: string;
	task_id: string;
	at: string;
	actor_id: string;
	reason?: string;
	findings?: unknown[];
	approval?: unknown;
	next_intent?: unknown;
	next_intent_ref?: unknown;
	finding_id?: string;
	resolution?: unknown;
}): TaskActionV2 {
	if (input.op === "begin-drain") {
		return beginDrainCapabilityAction(input.task_id, input.at);
	}
	const base = {
		type: input.op,
		event_id: `${input.op}:${input.task_id}:${input.at}`,
		at: input.at,
		actor_id: input.actor_id,
		// Placeholder hashes satisfy the strict v2 action parser; the digest
		// excludes these three fields, so the minted digest equals the digest
		// of the parsed action the application will inspect.
		expected_record_hash: "sha256:" + "0".repeat(64),
		expected_workspace_hash: "sha256:" + "0".repeat(64),
		diff_hash: "sha256:" + "0".repeat(64),
	};
	switch (input.op) {
		case "record_approval":
			return { ...base, approval: input.approval } as TaskActionV2;
		case "record_user_approval":
			return { ...base, approval: input.approval } as TaskActionV2;
		case "request_rework":
			return { ...base, findings: input.findings } as TaskActionV2;
		case "stop":
			return { ...base, reason: input.reason } as TaskActionV2;
		case "approve_breaking_intent_revision":
			return {
				...base,
				next_intent: input.next_intent,
				next_intent_ref: input.next_intent_ref,
			} as TaskActionV2;
		case "resolve_user_decision":
			return {
				...base,
				finding_id: input.finding_id,
				resolution: input.resolution,
			} as TaskActionV2;
		default:
			throw new KernelInvariantError([
				`unsupported capability action: ${input.op}`,
			]);
	}
}

export function createCanaryApplication(
	registry: MutationAuthorityRegistry,
): CanaryApplication {
	function execute(input: CanaryExecuteInput): StoredTaskMutationV2 {
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.task_id))
			throw new KernelInvariantError(["task id is not a safe file identity"]);
		const now = input.now ?? new Date().toISOString();
		const operation = input.operation;
		const at = now;
		// Preflight snapshot inside the store lock derives the exact current
		// identities; authoritative CAS revalidation still happens inside the
		// locked application port, so any concurrent change fails closed.
		const snapshot = withKernelStoreLockV2(input.root, () => {
			const current = readTaskRecordV2Raw(input.root, input.task_id);
			if (!current.record)
				throw new KernelInvariantError([
					`task ${input.task_id} has no TaskRecord v2`,
				]);
			const workspace = readWorkspaceStateRaw(input.root);
			return {
				record_revision: current.revision,
				workspace_revision: workspace.revision,
				intent_revision: current.record.intent_revision,
				intent_content_hash: current.record.intent_ref.content_hash,
				intent_snapshot: current.record.intent_snapshot,
			};
		});
		const diffHash = input.diffProvider(input.root, snapshot.intent_snapshot);
		const event_id = `${operation.op}:${input.task_id}:${at}`;
		const base = {
			event_id,
			at,
			actor_id: operation.actor_id,
			expected_record_hash: snapshot.record_revision,
			expected_workspace_hash: snapshot.workspace_revision,
			diff_hash: diffHash,
		};
		let action: unknown;
		let capability: object | undefined;
		switch (operation.op) {
			case "record_evidence":
				action = {
					...base,
					type: "record_evidence",
					evidence: {
						id: `evidence-${event_id}`,
						acceptance_id: operation.acceptance_id,
						task_revision: snapshot.intent_revision,
						intent_content_hash: snapshot.intent_content_hash,
						diff_hash: diffHash,
						status: operation.status,
						actor_id: operation.actor_id,
						summary: operation.summary,
					},
				};
				break;
			case "record_finding":
				action = {
					...base,
					type: "record_finding",
					finding: {
						...operation.finding,
						status: "open",
						source: operation.finding.kind === "unresolved_user_decision" ? "kernel" : "execution",
						review_round: null,
					},
				};
				break;
			case "resolve_finding":
				action = { ...base, type: "resolve_finding", finding_id: operation.finding_id };
				break;
			case "submit_review":
				action = { ...base, type: "submit_review" };
				break;
			case "request_rework":
				capability = operation.capability;
				action = { ...base, type: "request_rework", findings: operation.findings };
				break;
			case "record_approval":
				capability = operation.capability;
				action = { ...base, type: "record_approval", approval: operation.approval };
				break;
			case "record_user_approval":
				capability = operation.capability;
				action = { ...base, type: "record_user_approval", approval: operation.approval };
				break;
			case "revise_intent":
				action = {
					...base,
					type: "revise_intent",
					next_intent: operation.next_intent,
					next_intent_ref: {
						path: `docs/plans/${operation.next_intent.task_id}.intent.json`,
						revision: operation.next_intent.revision,
						content_hash: canonicalIntentHash(operation.next_intent),
					},
				};
				break;
			case "approve_breaking_intent_revision":
				capability = operation.capability;
				action = {
					...base,
					type: "approve_breaking_intent_revision",
					next_intent: operation.next_intent,
					next_intent_ref: {
						path: `docs/plans/${operation.next_intent.task_id}.intent.json`,
						revision: operation.next_intent.revision,
						content_hash: canonicalIntentHash(operation.next_intent),
					},
				};
				break;
			case "complete":
				action = { ...base, type: "complete" };
				break;
			case "stop":
				capability = operation.capability;
				action = { ...base, type: "stop", reason: operation.reason };
				break;
			case "resolve_user_decision":
				capability = operation.capability;
				action = {
					...base,
					type: "resolve_user_decision",
					finding_id: operation.finding_id,
					resolution: operation.resolution,
				};
				break;
			default: {
				const unreachable: never = operation;
				throw new KernelInvariantError([
					`unsupported canary operation: ${String((unreachable as CanaryOperation).op)}`,
				]);
			}
		}
		return applyTaskActionV2({
			root: input.root,
			task_id: input.task_id,
			action,
			prior_intent_token: input.prior_intent_token,
			registry,
			capability: capability as never,
			diffProvider: input.diffProvider,
			now: Date.parse(now),
			...(operation.op === "complete" || operation.op === "stop"
				? { terminal: { terminalized_at: now } }
				: {}),
		});
	}

	function beginDrain(input: {
		root: string;
		task_id: string;
		capability: object;
		now?: string;
	}): BackendClaim {
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.task_id))
			throw new KernelInvariantError(["task id is not a safe file identity"]);
		const now = input.now ?? new Date().toISOString();
		return withKernelStoreLockV2(input.root, () => {
			const current = readTaskRecordV2Raw(input.root, input.task_id);
			if (!current.record)
				throw new KernelInvariantError([
					`task ${input.task_id} has no TaskRecord v2`,
				]);
			const workspace = readWorkspaceStateRaw(input.root);
			const claim = readBackendClaim(input.root);
			if (!claim)
				throw new KernelInvariantError([
					`task ${input.task_id} has no active backend claim`,
				]);
			if (claim.task_id !== input.task_id)
				throw new KernelInvariantError([
					`backend claim belongs to task ${claim.task_id}, not ${input.task_id}`,
				]);
			if (claim.lifecycle_status === "draining") {
				// Exact committed drain replay is idempotent: the claim is
				// already draining and the capability is not re-consumed.
				return claim;
			}
			if (claim.lifecycle_status !== "active")
				throw new KernelInvariantError([
					`backend claim is not active for task ${input.task_id}`,
				]);
			if (current.record.phase === "done" || current.record.phase === "stopped")
				throw new KernelInvariantError([
					`task ${input.task_id} is already terminal; drain is not permitted`,
				]);
			if (workspace.state.current_working !== input.task_id)
				throw new KernelInvariantError([
					`workspace is not owned by task ${input.task_id}`,
				]);
			// The capability is bound to the canonical begin_drain action.
			registry.consume(input.capability as never, {
				task_id: input.task_id,
				action: beginDrainCapabilityAction(input.task_id, now),
				expected_record_hash: current.revision,
				intent_revision: current.record.intent_revision,
				intent_content_hash: current.record.intent_ref.content_hash,
				diff_hash: "sha256:" + "0".repeat(64),
			}, Date.parse(now));
			const nextClaim: BackendClaim = {
				...claim,
				lifecycle_status: "draining",
				updated_at: now,
			};
			return commitDrainLocked(
				input.root,
				input.task_id,
				serializeBackendClaim(claim),
				serializeBackendClaim(nextClaim),
				now,
			);
		});
	}

	return { registry, execute, beginDrain };
}
