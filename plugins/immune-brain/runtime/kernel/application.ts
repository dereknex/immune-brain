// TaskRecord v3 mutation port. The single locked application path that
// rereads and consumes Intent identity, validates action/record/diff/CAS
// identity, consumes authority when privileged, reduces, and commits through
// the dedicated recoverable workspace transaction. Consumed by the Pi canary
// host adapter via canary_application.

import {
	type MutationAuthorityRegistry,
	type ValidatedAuthorityV2,
} from "./authority_port";
import { canonicalIntentHash, readTaskIntent } from "./intent";
import {
	inspectIntentTokenPair,
	consumeIntentToken,
	type TaskIntentIdentityToken,
} from "./intent_token_registry";
import {
	reduceTask,
	canonicalRecordHash,
	findingsDigestV2,
	isReducedMutation,
} from "./reducer";
import {
	commitTaskRecordLocked,
	commitTerminalLocked,
	readTaskRecordRaw,
	readWorkspaceStateRaw,
	revisionForContent,
	serializeWorkspace,
	withKernelStoreLock,
	type WorkspaceState,
	type WorkspaceTransactionV2,
	type ArtifactRelocationV1,
} from "./storage";
import type {
	AuthorityAuditDescriptor,
	MutationAuthorityCapabilityV2,
	StoredTaskMutationV3,
	TaskAction,
	TaskIntentV1,
} from "./types";
import { TASK_TOMBSTONE_CONTRACT, type TaskTombstone } from "./backend_claim";
import { KernelInvariantError, parseTaskAction } from "./validation";

export interface ApplyTaskActionInput {
	root: string;
	task_id: string;
	action: unknown;
	prior_intent_token: TaskIntentIdentityToken;
	/** Paired mutation authority registry that must recognize every supplied capability. */
	registry: MutationAuthorityRegistry;
	capability?: MutationAuthorityCapabilityV2;
	/** Trusted injected diff provider; the action's diff_hash is only an expectation. */
	diffProvider: (root: string, intent: TaskIntentV1) => string;
	now?: number;
	/**
	 * Terminal commit mode: record + workspace + active-claim removal + task
	 * tombstone converge through one recoverable terminal transaction marker
	 * instead of the ordinary v2 transaction.
	 */
	terminal?: {
		terminalized_at: string;
	};
	artifact_transition?: {
		relocations: ArtifactRelocationV1[];
		next_intent_path: string;
		next_artifact_state: "active" | "frozen";
	};
}

export function applyTaskAction(
	input: ApplyTaskActionInput,
): StoredTaskMutationV3 {
	const { root, task_id, prior_intent_token, registry, capability, diffProvider, now } =
		input;
	return withKernelStoreLock(root, () => {
		const current = readTaskRecordRaw(root, task_id);
		if (!current.record)
			throw new KernelInvariantError([
				`task ${task_id} has no TaskRecord v3`,
			]);
		const workspace = readWorkspaceStateRaw(root);
		const action = parseTaskAction(input.action);

		// Expected-hash CAS and workspace ownership are validated after the
		// preflight reduction: exact committed replay returns before these
		// checks (the action carries the pre-commit expected hashes), while
		// new events must carry the exact current identities and must fail
		// closed before any token or capability is consumed.

		// Trusted diff provider is the only diff authority.
		const diffHash = diffProvider(root, current.record.intent_snapshot);
		if (diffHash !== action.diff_hash)
			throw new KernelInvariantError([
				`action diff_hash ${action.diff_hash} does not match the trusted diff ${diffHash}`,
			]);

		// Fresh secure reread of the sidecar inside the same lock.
		const freshRead = readTaskIntent(root, task_id, current.record.intent_ref.path);
		const { prior: priorIdentity, current: currentIdentity } =
			inspectIntentTokenPair(prior_intent_token, freshRead.token);
		if (
			priorIdentity.sidecar_path !== freshRead.intent_ref.path ||
			currentIdentity.sidecar_path !== freshRead.intent_ref.path
		)
			throw new KernelInvariantError([
				"intent token sidecar path mismatch",
			]);
		// A→B→A swap detection: the prior token must represent the same file
		// identity as the fresh reread, even when the content hash is equal.
		if (
			priorIdentity.path_dev !== currentIdentity.path_dev ||
			priorIdentity.path_ino !== currentIdentity.path_ino ||
			priorIdentity.fd_dev !== currentIdentity.fd_dev ||
			priorIdentity.fd_ino !== currentIdentity.fd_ino
		)
			throw new KernelInvariantError([
				"intent sidecar identity changed between reads",
			]);

		const isRevisionAction =
			action.type === "revise_intent" ||
			action.type === "approve_breaking_intent_revision";

		if (isRevisionAction) {
			// Prior token must bind the old committed record identity.
			if (
				priorIdentity.intent_content_hash !==
				current.record.intent_ref.content_hash
			)
				throw new KernelInvariantError([
					"prior intent token does not match the committed record intent",
				]);
			// Fresh token must bind the next intent carried by the action.
			if (
				freshRead.content_hash !==
					canonicalIntentHash(action.next_intent) ||
				action.next_intent_ref.content_hash !== freshRead.content_hash ||
				action.next_intent.revision !== freshRead.intent.revision
			)
				throw new KernelInvariantError([
					"fresh intent token does not match the requested next intent",
				]);
		} else {
			// Both tokens must bind the committed record intent identity.
			if (
				priorIdentity.intent_content_hash !==
					current.record.intent_ref.content_hash ||
				currentIdentity.intent_content_hash !==
					current.record.intent_ref.content_hash
			)
				throw new KernelInvariantError([
					"intent token does not match the committed record intent",
				]);
		}

		const privileged =
			action.type === "record_approval" ||
			action.type === "record_user_approval" ||
			action.type === "approve_breaking_intent_revision" ||
			action.type === "request_rework" ||
			action.type === "stop" ||
			action.type === "resolve_user_decision";

		const expectedAuthority = privileged
			? {
					task_id,
					action,
					expected_record_hash: current.revision,
					intent_revision: isRevisionAction
						? action.next_intent.revision
						: current.record.intent_snapshot.revision,
					intent_content_hash: isRevisionAction
						? freshRead.content_hash
						: current.record.intent_ref.content_hash,
					diff_hash: diffHash,
					...(action.type === "request_rework"
						? { findings_digest: findingsDigestV2(action.findings) }
						: {}),
				}
			: null;

		// Preflight reduction with inspected (not consumed) authority. The pure
		// reducer enforces expected-hash equality for new events, lifecycle rules,
		// replay identity, and conflicting reuse, so any throw is a zero-write
		// failure (including stale record/workspace CAS).
		const inspectedAudit = expectedAuthority
			? registry.inspect(capability, expectedAuthority, now)
			: null;
		const mutation = reduceTask(
			current.record,
			action,
			inspectedAudit ? (inspectedAudit.audit as AuthorityAuditDescriptor) : null,
		);
		if (!isReducedMutation(mutation))
			throw new KernelInvariantError(["reducer returned an invalid mutation"]);

		// Exact committed replay: identical record -> return committed snapshot
		// without consuming tokens or authority.
		if (canonicalRecordHash(mutation.record) === current.revision)
			return {
				revision: current.revision,
				record: current.record,
				workspace,
			};

		// New event: enforce stale CAS and workspace ownership preflight.
		if (action.expected_record_hash !== current.revision)
			throw new KernelInvariantError([
				`expected record hash mismatch: ${action.expected_record_hash} != ${current.revision}`,
			]);
		if (action.expected_workspace_hash !== workspace.revision)
			throw new KernelInvariantError([
				`expected workspace hash mismatch: ${action.expected_workspace_hash} != ${workspace.revision}`,
			]);
		if (
			workspace.state.current_working !== null &&
			workspace.state.current_working !== task_id
		)
			throw new KernelInvariantError([
				`workspace is already owned by ${workspace.state.current_working}`,
			]);

		// All preflight passed: consume tokens and authority, then commit.
		consumeIntentToken(prior_intent_token);
		consumeIntentToken(freshRead.token);
		let consumedAudit: ValidatedAuthorityV2 | null = null;
		if (expectedAuthority) {
			consumedAudit = registry.consume(
				capability as MutationAuthorityCapabilityV2,
				expectedAuthority,
				now,
			);
		}

		const nextWorking = mutation.next_workspace_working;
		const nextRecord = input.artifact_transition
			? {
					...mutation.record,
					intent_ref: {
						...mutation.record.intent_ref,
						path: input.artifact_transition.next_intent_path,
					},
					artifact_state: input.artifact_transition.next_artifact_state,
				}
			: mutation.record;
		let nextWorkspaceState: WorkspaceState = workspace.state;
		if (nextWorking !== null) {
			nextWorkspaceState = {
				...workspace.state,
				current_working: task_id,
			};
		} else if (workspace.state.current_working === task_id) {
			nextWorkspaceState = {
				...workspace.state,
				current_working: null,
			};
		}

		if (input.terminal) {
			const tombstone: TaskTombstone = {
				contract: TASK_TOMBSTONE_CONTRACT,
				task_id,
				lifecycle_status: "terminal",
				terminal_lifecycle: nextRecord.lifecycle,
				terminal_event_id: action.event_id,
				final_record_hash: canonicalRecordHash(nextRecord),
				terminalized_at: input.terminal.terminalized_at,
			};
			const transaction: WorkspaceTransactionV2 = {
				contract: "assurance_kernel/workspace_transaction/v2",
				task_id,
				expected_record_hash: current.revision,
				next_record_content: `${JSON.stringify(nextRecord, null, 2)}\n`,
				expected_workspace_hash: workspace.revision,
				next_workspace_content: serializeWorkspace(nextWorkspaceState),
				...(input.artifact_transition ? { artifact_relocations: input.artifact_transition.relocations } : {}),
			};
			commitTerminalLocked(root, task_id, transaction, tombstone);
			return {
				revision: canonicalRecordHash(nextRecord),
				record: nextRecord,
				workspace: {
					revision: revisionForContent(serializeWorkspace(nextWorkspaceState)),
					state: nextWorkspaceState,
				},
			};
		}

		return commitTaskRecordLocked(
			root,
			task_id,
			current.revision,
			nextRecord,
			workspace.revision,
			nextWorkspaceState,
			input.artifact_transition?.relocations,
		);
	});
}
