// P2B2 canary application service. NOT exported from kernel/index.ts.
// The only production caller of applyTaskAction and the only production
// owner of the active -> draining claim transition. Accepts a closed semantic
// operation union; callers can never supply raw TaskAction, CAS identities,
// authority descriptors, or generic patches. Event identity, timestamps,
// expected hashes, and Intent-derived facts are derived inside the trusted
// application boundary. The paired mutation-authority registry is created
// once inside the Pi lifecycle extension activation closure; tests use
// tests/fixtures/mutation-authority-test-seam.ts.

import {
	type MutationAuthorityRegistry,
} from "./authority_port";
import { applyTaskAction } from "./application";
import { asTaskDiffSnapshot } from "./completion";
import { readTaskIntent } from "./intent";
import {
	inspectIntentTokenPair,
	consumeIntentToken,
} from "./intent_token_registry";
import {
	readBackendClaim,
	serializeBackendClaim,
	type BackendClaim,
} from "./backend_claim";
import { canonicalIntentHash } from "./intent";
import { parseTaskRecord } from "./validation";
import type { TaskIntentIdentityToken } from "./intent_token_registry";
import {
	commitDrainLocked,
	commitTaskRecordLocked,
	readSecureProjectFile,
	readTaskRecordRaw,
	readWorkspaceStateRaw,
	revisionForContent,
	withKernelStoreLock,
} from "./storage";
import { KernelInvariantError } from "./validation";
import type {
	StoredTaskMutationV3,
	TaskAction,
	TaskApprovalV2,
	TaskFinding,
	TaskIntentV1,
	TaskRecord,
} from "./types";

export type CanaryOperation =
	| { op: "freeze_artifacts"; actor_id: string }
	| { op: "record_finding"; finding: Omit<TaskFinding, "status" | "source" | "review_round">; actor_id: string }
	| { op: "resolve_finding"; finding_id: string; actor_id: string }
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
	diffProvider: (root: string, record: TaskRecord) => string | { diff_hash: string; changed_paths?: readonly string[] };
	now?: string;
}

export interface CanaryApplication {
	readonly registry: MutationAuthorityRegistry;
	/** Execute a closed semantic operation through the paired reducer port. */
	execute(input: CanaryExecuteInput): StoredTaskMutationV3;
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
export function beginDrainCapabilityAction(taskId: string, at: string): TaskAction {
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
 * payload shape) that execute()/applyTaskAction() will inspect, so a
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
}): TaskAction {
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
			return { ...base, approval: input.approval } as TaskAction;
		case "record_user_approval":
			return { ...base, approval: input.approval } as TaskAction;
		case "request_rework":
			return { ...base, findings: input.findings } as TaskAction;
		case "stop":
			return { ...base, reason: input.reason } as TaskAction;
		case "approve_breaking_intent_revision":
			return {
				...base,
				next_intent: input.next_intent,
				next_intent_ref: input.next_intent_ref,
			} as TaskAction;
		case "resolve_user_decision":
			return {
				...base,
				finding_id: input.finding_id,
				resolution: input.resolution,
			} as TaskAction;
		default:
			throw new KernelInvariantError([
				`unsupported capability action: ${input.op}`,
			]);
	}
}

function archivePath(path: string): string {
	const matched = path.match(/^docs\/(plans|specs)\/([^/]+)$/);
	if (!matched) throw new KernelInvariantError([`artifact path is not active: ${path}`]);
	return `docs/${matched[1]}/archive/${matched[2]}`;
}

function boundSpecPath(intent: TaskIntentV1): string | undefined {
	const candidates = intent.scope_hint.filter(
		(path) => /^docs\/specs\/(?!archive\/)[^/]+\.spec\.md$/.test(path) && intent.scope_hint.includes(archivePath(path)),
	);
	if (candidates.length > 1)
		throw new KernelInvariantError([`artifact transition requires at most one scope-bound Spec; found ${candidates.length}`]);
	return candidates[0];
}

function readBoundActiveSpec(
	root: string,
	intent: TaskIntentV1,
	required = true,
): { path: string; content: string } | undefined {
	const specPath = boundSpecPath(intent);
	if (!specPath) {
		if (required) throw new KernelInvariantError(["artifact freeze requires one scope-bound active Spec"]);
		return undefined;
	}
	try {
		return { path: specPath, content: readSecureProjectFile(root, specPath) };
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("source_missing:") && !required) return undefined;
		throw error;
	}
}

function transitionFor(
	root: string,
	record: { intent_ref: { path: string }; intent_snapshot: TaskIntentV1; artifact_state: "active" | "frozen" },
	direction: "freeze" | "restore",
	allowIntentOnly = false,
) {
	const activeIntent = `docs/plans/${record.intent_snapshot.task_id}.intent.json`;
	const frozenIntent = archivePath(activeIntent);
	if (direction === "freeze") {
		if (record.intent_ref.path !== activeIntent)
			throw new KernelInvariantError(["artifact freeze requires the active intent path"]);
		const spec = readBoundActiveSpec(root, record.intent_snapshot, !allowIntentOnly);
		const intentContent = readSecureProjectFile(root, activeIntent);
		return {
			relocations: [
				{ from_path: activeIntent, to_path: frozenIntent, content_hash: revisionForContent(intentContent) },
				...(spec ? [{ from_path: spec.path, to_path: archivePath(spec.path), content_hash: revisionForContent(spec.content) }] : []),
			],
			next_intent_path: frozenIntent,
			next_artifact_state: "frozen" as const,
		};
	}
	if (record.intent_ref.path !== frozenIntent || record.artifact_state !== "frozen")
		throw new KernelInvariantError(["artifact restore requires a frozen TaskRecord"]);
	const specPath = boundSpecPath(record.intent_snapshot);
	return {
		relocations: [
			{ from_path: frozenIntent, to_path: activeIntent, content_hash: revisionForContent(readSecureProjectFile(root, frozenIntent)) },
			...(specPath ? [{ from_path: archivePath(specPath), to_path: specPath, content_hash: revisionForContent(readSecureProjectFile(root, archivePath(specPath))) }] : []),
		],
		next_intent_path: activeIntent,
		next_artifact_state: "active" as const,
	};
}

export function createCanaryApplication(
	registry: MutationAuthorityRegistry,
): CanaryApplication {
	function freezeArtifacts(input: CanaryExecuteInput): StoredTaskMutationV3 {
		return withKernelStoreLock(input.root, () => {
			const current = readTaskRecordRaw(input.root, input.task_id);
			if (!current.record)
				throw new KernelInvariantError([`task ${input.task_id} has no TaskRecord v3`]);
			const workspace = readWorkspaceStateRaw(input.root);
			if (current.record.artifact_state === "frozen")
				return { revision: current.revision, record: current.record, workspace };
			if (current.record.lifecycle !== "active")
				throw new KernelInvariantError([`artifact freeze requires active lifecycle, got ${current.record.lifecycle}`]);
			if (workspace.state.current_working !== input.task_id)
				throw new KernelInvariantError([`workspace is not owned by task ${input.task_id}`]);
			const fresh = readTaskIntent(input.root, input.task_id, current.record.intent_ref.path);
			const pair = inspectIntentTokenPair(input.prior_intent_token, fresh.token);
			if (
				pair.prior.intent_content_hash !== current.record.intent_ref.content_hash
				|| pair.current.intent_content_hash !== current.record.intent_ref.content_hash
				|| pair.prior.sidecar_path !== current.record.intent_ref.path
				|| pair.current.sidecar_path !== current.record.intent_ref.path
				|| pair.prior.path_dev !== pair.current.path_dev
				|| pair.prior.path_ino !== pair.current.path_ino
				|| pair.prior.fd_dev !== pair.current.fd_dev
				|| pair.prior.fd_ino !== pair.current.fd_ino
			)
				throw new KernelInvariantError(["intent token does not bind the active freeze artifact"]);
			const transition = transitionFor(input.root, current.record, "freeze");
			consumeIntentToken(input.prior_intent_token);
			consumeIntentToken(fresh.token);
			const at = input.now ?? new Date().toISOString();
			const nextRecord = parseTaskRecord({
				...current.record,
				intent_ref: { ...current.record.intent_ref, path: transition.next_intent_path },
				artifact_state: transition.next_artifact_state,
				history: [
					...current.record.history,
					{
						id: `freeze_artifacts:${input.task_id}:${at}`,
						at,
						type: "freeze_artifacts",
						from_state: "active:active",
						to_state: "active:frozen",
						reason: `TaskIntent and Spec frozen at ${transition.next_intent_path}`,
					},
				],
			});
			return commitTaskRecordLocked(
				input.root,
				input.task_id,
				current.revision,
				nextRecord,
				workspace.revision,
				workspace.state,
				transition.relocations,
			);
		});
	}

	function execute(input: CanaryExecuteInput): StoredTaskMutationV3 {
		if (input.operation.op === "freeze_artifacts") return freezeArtifacts(input);
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.task_id))
			throw new KernelInvariantError(["task id is not a safe file identity"]);
		const now = input.now ?? new Date().toISOString();
		const operation = input.operation;
		const at = now;
		// Preflight snapshot inside the store lock derives the exact current
		// identities; authoritative CAS revalidation still happens inside the
		// locked application port, so any concurrent change fails closed.
		const snapshot = withKernelStoreLock(input.root, () => {
			const current = readTaskRecordRaw(input.root, input.task_id);
			if (!current.record)
				throw new KernelInvariantError([
					`task ${input.task_id} has no TaskRecord v2`,
				]);
			const workspace = readWorkspaceStateRaw(input.root);
			return {
				record_revision: current.revision,
				workspace_revision: workspace.revision,
				intent_revision: current.record.intent_snapshot.revision,
				intent_content_hash: current.record.intent_ref.content_hash,
				intent_snapshot: current.record.intent_snapshot,
				record: current.record,
			};
		});
		const diffHash = asTaskDiffSnapshot(input.diffProvider(input.root, snapshot.record)).diff_hash;
		if (operation.op === "stop" && !("capability" in operation))
			throw new KernelInvariantError(["stop requires user authority capability"]);
		const hasBoundSpec = snapshot.intent_snapshot.scope_hint.some(
			(path) => /^docs\/specs\/(?!archive\/)[^/]+\.spec\.md$/.test(path)
				&& snapshot.intent_snapshot.scope_hint.includes(archivePath(path)),
		);
		if (operation.op === "complete" && hasBoundSpec && snapshot.record.artifact_state !== "frozen")
			throw new KernelInvariantError(["complete requires frozen planning artifacts"]);
		const artifactTransition = snapshot.record.artifact_state === "frozen"
			&& (
				operation.op === "request_rework"
				|| operation.op === "approve_breaking_intent_revision"
			)
			? transitionFor(input.root, snapshot.record, "restore")
			: operation.op === "stop" && snapshot.record.artifact_state !== "frozen"
				? transitionFor(input.root, snapshot.record, "freeze", true)
				: undefined;
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
		return applyTaskAction({
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
			...(artifactTransition ? { artifact_transition: artifactTransition } : {}),
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
		return withKernelStoreLock(input.root, () => {
			const current = readTaskRecordRaw(input.root, input.task_id);
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
			if (current.record.lifecycle !== "active")
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
				intent_revision: current.record.intent_snapshot.revision,
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
