import { stagePlanningArtifactTransition, type VerdictAuthority } from "../assurance/verdict_authority";
export { ensureReviewRevision as ensureClaudeReviewRevision } from "../assurance/verdict_authority";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
	AssuranceCoordinator,
	type AssuranceCoordinatorPorts,
	type AssuranceSubmitReviewResult,
	type HostContext,
} from "../assurance/coordinator";
import {
} from "../assurance/verification";
import {
	writeNativeReviewEvidence,
} from "../assurance/review_evidence";
import { projectAssurance, type AssuranceProjection, type AssuranceProjectionResult } from "../kernel/assurance_projection";
import { type TaskFinding, type TaskRecord } from "../kernel/types";
import { findingsDigestV2 } from "../kernel/reducer";
import { readTaskRecord, readTaskRecordRaw, recoverKernelStoreFollowUps } from "../kernel/storage";
import { canonicalIntentHash, parseTaskIntentV1, readTaskIntent } from "../kernel/intent";
import { capabilityActionFor, createCanaryApplication } from "../kernel/canary_application";
import {
	createMutationAuthorityRegistry,
	digestOfAction,
	type CapabilityBindingV2,
	type MutationAuthorityRegistry,
} from "../kernel/authority_port";
import {
	createEnrollmentAuthorityRegistry,
	type EnrollmentCapabilityBinding,
} from "../kernel/enrollment_authority";
import { enrollTask } from "../kernel/enrollment";
import { reconcileKernelAuthority, repairKernelAuthority } from "../kernel/storage";
import { inspectEnrollmentGitBase, enrollmentGitBaseNotice, initializeEnrollmentGitBase } from "../assurance/enrollment_git_base";
import { preparePiCanary, revalidatePiCanary } from "../kernel/pi_canary_prepare";
import { runDeterministicQa } from "../assurance/qa";
import { taskDeliveryIdentity } from "../workspace_scope";
import { batchReason } from "../unattended/batch_reasons";
import { deriveAuthorizationOperation } from "../authorization_operation";
import { LITERAL_USER_ACTOR_ID, canonicalActorId } from "../kernel/actor_identity";
import {
	captureStagedIntent,
	restoreStagedIntent as restoreStagedIntentShared,
} from "../staged_intent";
import { projectTerminalTrackerState, TRACKER_PROJECTION_FAILURE } from "../assurance/coordinator";
import { runGithubTrackerOperation } from "../github_issue_tracker";
import { readTaskTombstone } from "../kernel/backend_claim";
import {
	authorizeBatch,
	projectBatchPreflight,
	findResumableBatchSlugForTask,
} from "../unattended/batch_preflight";
import {
	startBatch,
	type BatchRunnerKernelPort,
	type BatchRunReport,
} from "../unattended/batch_runner";
import { createBatchKernelPort } from "../unattended/batch_kernel_port";
import {
	createBatchAuthorityRegistry,
} from "../kernel/batch_authority";
import {
	type BatchRunnerGitPort,
} from "../unattended/batch_git";
import type {
	InitiativeObservationReader,
} from "../unattended/types";
import { observeGithubInitiative } from "../github_issue_tracker";
import {
	confirmationRef,
	enrollmentNonce,
	evaluateNativeGate,
	isPrivilegedOperation,
	NativeAuthorityError,
	type NativeConfirmationPort,
	type NativeDecision,
	type PrivilegedOperation,
} from "./interaction";
import { ClaudeReviewHost, FileHookEventLog, type ClaudeHookEvent } from "./review_host";
import { probeHost, type PermissionMode } from "./capability";

export function diffSnapshotOf(root: string, record: TaskRecord): {
	diff_hash: string;
	changed_paths: readonly string[];
} {
	return taskDeliveryIdentity(root, record);
}

export function diffHashOf(root: string, record: TaskRecord): string {
	return diffSnapshotOf(root, record).diff_hash;
}

/**
 * Read the TaskIntent through the TaskRecord's `intent_ref.path`.
 *
 * `freeze_artifacts` binds the sidecar in place. Every post-freeze read — QA
 * settlement included — must follow the record instead of guessing a default
 * path. Historical archived sidecars remain readable. The Pi adapter resolves
 * the same way in its own runtime stub; both Hosts must stay in step.
 */
function readTaskIntentForRecord(root: string, taskId: string) {
	// Converge committed follow-ups first, then follow the record.
	recoverKernelStoreFollowUps(root, taskId);
	const currentPath = readTaskRecordRaw(root, taskId).record?.intent_ref?.path;
	return readTaskIntent(root, taskId, currentPath);
}

function extractVerdictJson(input: unknown): Record<string, unknown> | null {
	if (typeof input === "string") {
		const cleaned = input.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("{") && line.endsWith("}")).join("");
		if (!cleaned) return null;
		try { return JSON.parse(cleaned) as Record<string, unknown>; } catch { return null; }
	}
	if (typeof input === "object" && input !== null && !Array.isArray(input)) return input as Record<string, unknown>;
	return null;
}

function verdictFingerprint(raw: Record<string, unknown>): string {
	return JSON.stringify({
		contract: raw.contract ?? null,
		role: raw.role ?? null,
		task_id: raw.task_id ?? null,
		snapshot_digest: raw.snapshot_digest ?? null,
		decision: raw.decision ?? null,
		approval: raw.approval ?? null,
		findings: raw.findings ?? null,
	});
}

const RELEASED_REVIEW_RECOVERY =
	"Call advance_assurance to obtain a new Review reservation, then dispatch one fresh reviewer with the returned envelope unchanged";
const RETAINED_REVIEW_RECOVERY =
	"Wait for the dispatched reviewer to finish, then call submit_review again with its verdict; do not dispatch or continue another reviewer";
const MISMATCH_REVIEW_RECOVERY =
	"Resubmit the reviewer's verdict exactly as the reviewer returned it";

function withReviewRecovery(
	result: AssuranceSubmitReviewResult,
	recovery_action: string,
): AssuranceSubmitReviewResult {
	if (result.state !== "blocked" || result.code === "verdict_invalid") return result;
	return { ...result, recovery_action };
}

export async function submitClaudeReview(
	host: ClaudeReviewHost,
	coordinator: AssuranceCoordinator,
	ctx: HostContext,
	taskId: string,
	verdictInput: unknown,
): Promise<AssuranceSubmitReviewResult> {
	if (verdictInput === undefined) throw new Error("verdict is required");
	const observed = host.inspectReviewForTask(taskId);
	if (!observed.ok) {
		if (observed.release) return withReviewRecovery(coordinator.abandonReview(taskId, observed.reason), RELEASED_REVIEW_RECOVERY);
		return { state: "blocked", reason: observed.reason, recovery_action: RETAINED_REVIEW_RECOVERY };
	}
	const parentValid = coordinator.isReviewVerdictValid(taskId, verdictInput);
	if (!parentValid) return coordinator.submitReview(taskId, ctx, verdictInput);
	const receiptValid = coordinator.isReviewVerdictValid(taskId, observed.receipt.result);
	if (!receiptValid) {
		return withReviewRecovery(coordinator.abandonReview(taskId, "reviewer receipt is not a valid verdict"), RELEASED_REVIEW_RECOVERY);
	}
	const parentJson = extractVerdictJson(verdictInput)!;
	const receiptJson = extractVerdictJson(observed.receipt.result)!;
	if (verdictFingerprint(parentJson) !== verdictFingerprint(receiptJson)) {
		return { state: "blocked", reason: "parent verdict does not match reviewer receipt", recovery_action: MISMATCH_REVIEW_RECOVERY };
	}
	return coordinator.submitReview(taskId, ctx, verdictInput);
}

/**
 * Whether a Kernel result settled its task: the coordinator's own terminal
 * outcomes, or the lifecycle a privileged mutation committed. Only such a result
 * can have produced the claimless terminal projection the GitHub tracker step
 * needs, and it is exported so the gate's terminal shapes are asserted directly
 * instead of by settling a task against a live tracker.
 */
export function settledKernelResult(result: object): boolean {
	const state = (result as { state?: unknown }).state;
	if (state === "completed" || state === "stopped") return true;
	const lifecycle = (result as { record?: { lifecycle?: unknown } }).record?.lifecycle;
	return lifecycle === "done" || lifecycle === "stopped";
}

/** `extra` arrives as `Record<string, unknown>`; only a real string is a reason. */
function stopReason(value: unknown): string {
	return typeof value === "string" && value.length > 0 ? value : "user stop";
}

function assertProjectionBinding(before: AssuranceProjectionResult, after: AssuranceProjectionResult, allowDiffChange = false): void {
	const fields: ReadonlyArray<keyof AssuranceProjection> = allowDiffChange
		? ["record_revision", "workspace_revision", "intent_revision", "intent_content_hash"]
		: ["record_revision", "workspace_revision", "intent_revision", "intent_content_hash", "diff_hash"];
	if (before.error || !before.claim || after.error || !after.claim || before.claim.task_id !== after.claim.task_id
		|| fields.some((field) => before.projection[field] !== after.projection[field])) {
		throw new Error("Task changed after native confirmation; authority aborted before capability issuance");
	}
}

async function mintCapability(
	registry: MutationAuthorityRegistry,
	input: {
		authority_kind: "review" | "qa" | "user";
		task_id: string;
		run_id?: string | null;
		action_kind: string;
		expected_record_hash: string;
		intent_revision: number;
		intent_content_hash: string;
		diff_hash: string;
		actor_id: string;
		findings?: unknown[];
		approval?: unknown;
		next_intent?: unknown;
		next_intent_ref?: unknown;
		reason?: string;
		finding_id?: string;
		resolution?: string;
		now: string;
		confirmation_ref: string;
	},
) {
	const action = capabilityActionFor({
		op: input.action_kind,
		task_id: input.task_id,
		at: input.now,
		actor_id: input.actor_id,
		...(input.reason !== undefined ? { reason: input.reason } : {}),
		...(input.findings !== undefined ? { findings: input.findings } : {}),
		...(input.approval !== undefined ? { approval: input.approval } : {}),
		...(input.next_intent !== undefined ? { next_intent: input.next_intent } : {}),
		...(input.next_intent_ref !== undefined ? { next_intent_ref: input.next_intent_ref } : {}),
		...(input.finding_id !== undefined ? { finding_id: input.finding_id } : {}),
		...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
	});
	const binding: CapabilityBindingV2 = {
		authority_kind: input.authority_kind,
		task_id: input.task_id,
		...(input.run_id ? { run_id: input.run_id } : {}),
		action_digest: digestOfAction(action),
		expected_record_hash: input.expected_record_hash,
		intent_revision: input.intent_revision,
		intent_content_hash: input.intent_content_hash,
		diff_hash: input.diff_hash,
		actor_id: input.actor_id,
		confirmation_ref: input.confirmation_ref,
		findings_digest: input.action_kind === "request_rework"
			? findingsDigestV2(input.findings as TaskFinding[])
			: null,
	};
	return registry.issue(binding);
}

function throwIfCancelled(signal?: AbortSignal): void {
	if (signal?.aborted) throw new NativeAuthorityError("user_cancelled", "Tool call was cancelled");
}

export interface ClaudeRuntimeOptions {
	cwd: string;
	env?: Record<string, string | undefined>;
	host?: ClaudeReviewHost;
	/**
	 * Overrides layered on top of the real production ports, never a
	 * replacement for them. A whole synthetic ports object could previously be
	 * substituted here, so a suite could pass while the object production
	 * actually wires was never constructed once.
	 */
	ports?: Partial<AssuranceCoordinatorPorts>;
	/** Optional authority test seam, separate from host ports. */
	authorityOverrides?: Partial<VerdictAuthority>;
	interactive?: boolean;
	permissionMode?: PermissionMode;
	requestConfirmation?: NativeConfirmationPort;
	batchKernel?: Partial<BatchRunnerKernelPort>;
	batchGit?: BatchRunnerGitPort;
	readInitiative?: InitiativeObservationReader;
}

/**
 * The Claude Host's own failure envelopes for a batch start; the shared
 * authorization flow passes them through untouched.
 */
type ClaudeBatchStartResult =
	| { state: "started"; batch_id: string; report: BatchRunReport }
	| { state: "rejected"; reason: string; recovery_action: string }
	| { state: "cancelled"; reason: string; recovery_action: string }
	| { state: "blocked"; reason: string; recovery_action: string };

/**
 * Synchronous re-verification that the currently held claim for `taskId` is this
 * batch's own Kernel enrollment. Positive evidence only (see the Pi adapter):
 * the driver's durable child slot, the batch Git lineage, the Kernel event-id
 * derivation, the intent identity, and claim creation before the batch's last
 * durable write. The mutable confirmation_time is deliberately not used, so a
 * needs_human re-authorization can never turn this batch's own claim foreign.
 * Called fresh pre/post confirmation and from ownsTaskClaim.
 */
export class ClaudeRuntime {
	readonly host: ClaudeReviewHost;
	readonly coordinator: AssuranceCoordinator;
	private readonly cwd: string;
	private readonly env: Record<string, string | undefined>;
	private readonly interactive: boolean;
	private requestConfirmation?: NativeConfirmationPort;
	private hostVersion: string | undefined;
	private mutationRegistry: MutationAuthorityRegistry | null = null;
	private enrollmentRegistry = createEnrollmentAuthorityRegistry();
	private batchRegistry = createBatchAuthorityRegistry();
	private app: ReturnType<typeof createCanaryApplication> | null = null;
	private readonly batchKernel?: Partial<BatchRunnerKernelPort>;
	private readonly batchGit?: BatchRunnerGitPort;
	private readonly readInitiative?: InitiativeObservationReader;

	constructor(options: ClaudeRuntimeOptions) {
		this.cwd = options.cwd;
		this.env = options.env ?? process.env;
		this.interactive = options.interactive ?? true;
		this.requestConfirmation = options.requestConfirmation;
		this.batchKernel = options.batchKernel;
		this.batchGit = options.batchGit;
		this.readInitiative = options.readInitiative;
		this.host = options.host ?? new ClaudeReviewHost(new FileHookEventLog());
		this.coordinator = new AssuranceCoordinator({
			...this.createKernelPorts(),
			...options.ports,
			host: this.host,
			confirmationReference: ({ actorId }) => `claude:${actorId}`,
		}, options.authorityOverrides);
	}

	observe(event: ClaudeHookEvent): void {
		this.host.observe(event);
	}

	/** Bind the version announced by the connected Host during the MCP handshake. */
	bindHostVersion(version: string | undefined): void {
		this.hostVersion = version || undefined;
	}

	bindNativeConfirmation(port: NativeConfirmationPort): void {
		this.requestConfirmation = port;
	}

	async shutdown(): Promise<void> {
		await this.coordinator.onSessionShutdown();
	}

	/**
	 * The exact ports object the coordinator runs on. Public so a conformance
	 * suite can drive what production wires instead of a hand-built double: the
	 * host adapter defects that reached published plugins all lived in this
	 * object and none of them were reachable from a test while it was private.
	 */
	kernelPorts(): AssuranceCoordinatorPorts {
		return this.createKernelPorts();
	}

	private createKernelPorts(): AssuranceCoordinatorPorts {
		return {
			host: this.host,
			confirmationReference: ({ actorId }) => `claude:${actorId}`,
			projectTask: (root, taskId) => projectAssurance(root, taskId, diffSnapshotOf),
			readTaskRecord: async (root, taskId) => readTaskRecord(root, taskId),
			readTaskIntent: async (root, taskId) => readTaskIntentForRecord(root, taskId),
			runQa: (snapshot, descriptors, options) => runDeterministicQa(snapshot, descriptors, options),
			writeReviewEvidence: (input) => writeNativeReviewEvidence(input.evidence),
			applyOrdinaryOperation: (ctx, input) => this.executeOrdinary(ctx, input),
		};
	}

	private authority() {
		this.mutationRegistry ??= createMutationAuthorityRegistry();
		this.app ??= createCanaryApplication(this.mutationRegistry);
		return { registry: this.mutationRegistry, app: this.app };
	}

	private async gate(operation: string, meta: ToolMeta, binding: {
		risk?: string;
		intentRevision?: number;
		intentContentHash?: string;
		bindingDigest?: string;
		gitBaseNotice?: string;
	} = {}): Promise<{ confirmation_ref: string }> {
		throwIfCancelled(meta.signal);
		const probe = probeHost(this.env, process.platform, this.hostVersion);
		if (!probe.ok) throw new NativeAuthorityError("unsupported_host", probe.reason);
		const interactive = meta.interactive ?? this.interactive;
		if (!interactive) throw new NativeAuthorityError("unsupported_host", "interactive MCP elicitation is unavailable");
		if (!isPrivilegedOperation(operation)) throw new Error(`unsupported native operation ${operation}`);
		// The text is table-owned; only the form (a thrown native error rather than
		// a returned envelope) is this Host's.
		if (!this.requestConfirmation)
			throw new NativeAuthorityError("interaction_not_opened", batchReason("confirmation_port_unavailable").reason);
		const result = await this.requestConfirmation({ operation, taskId: meta.taskId, toolCallId: meta.toolCallId, signal: meta.signal, ...binding });
		throwIfCancelled(meta.signal);
		const gate = evaluateNativeGate({ operation, interactive, decision: result.decision });
		if (!gate.ok) throw gate.error;
		return {
			confirmation_ref: confirmationRef({
				connectionId: meta.sessionId,
				toolCallId: meta.toolCallId,
				requestId: result.requestId,
				operation,
				taskId: meta.taskId,
				...binding,
			}),
		};
	}

	async status(taskId: string) {
		return projectAssurance(this.cwd, taskId, diffSnapshotOf);
	}

	async enroll(taskId: string, meta: ToolMeta) {
		const now = new Date().toISOString();
		let preparation = await preparePiCanary(this.cwd, { task_id: taskId, now });
		const intent = await readTaskIntentForRecord(this.cwd, taskId);
		const gitBase = inspectEnrollmentGitBase(this.cwd);
		const gate = await this.gate("enroll", { ...meta, taskId }, {
			risk: intent.intent.risk,
			intentRevision: preparation.intent?.revision,
			intentContentHash: preparation.intent?.content_hash,
			bindingDigest: preparation.digest,
			gitBaseNotice: enrollmentGitBaseNotice(gitBase),
		});
		const { unchanged } = await revalidatePiCanary(this.cwd, { task_id: taskId, now }, preparation);
		if (!unchanged) throw new NativeAuthorityError("workspace_changed", "workspace changed after native confirmation");
		if (!preparation.intent) throw new Error("enrollment requires a readable TaskIntent");
		throwIfCancelled(meta.signal);
		preparation = initializeEnrollmentGitBase(this.cwd, { task_id: taskId, now }, preparation, gitBase, meta.signal);
		const gitBaseNote = gitBase.state === "unborn" ? `; empty initial commit ${preparation.git_base_head} remains` : "";
		try {
			if (!preparation.intent) throw new Error("Enrollment requires a readable TaskIntent");
			const nonce = enrollmentNonce();
			const binding: EnrollmentCapabilityBinding = {
				task_id: taskId,
				intent_path: preparation.intent.path,
				intent_revision: preparation.intent.revision,
				intent_content_hash: preparation.intent.content_hash,
				preparation_digest: preparation.digest,
				actor_id: LITERAL_USER_ACTOR_ID,
				confirmation_ref: gate.confirmation_ref,
				nonce,
			};
			return await enrollTask(this.cwd, this.enrollmentRegistry, { binding, now });
		} catch (error) {
			if (gitBaseNote) throw new Error(`${error instanceof Error ? error.message : String(error)}${gitBaseNote}`);
			throw error;
		}
	}

	async advance(taskId: string, signal?: AbortSignal, meta?: ToolMeta) {
		return this.closeOutBatchChild(
			taskId,
			await this.withTerminalTracker(taskId, await this.coordinator.advance(taskId, { cwd: this.cwd }, signal)),
			meta,
		);
	}

	async submitReview(taskId: string, verdictInput: unknown, meta?: ToolMeta) {
		return this.closeOutBatchChild(
			taskId,
			await this.withTerminalTracker(
				taskId,
				await submitClaudeReview(this.host, this.coordinator, { cwd: this.cwd }, taskId, verdictInput),
			),
			meta,
		);
	}

	/**
	 * Gate-free closeout: a batch child that reached Kernel `done` in the
	 * foreground re-enters the batch in the same call, reusing its authorization.
	 * Only `done` continues; a stopped child, a parked child and a live Review
	 * obligation end where they do today. The continuation is transport: the
	 * Kernel result is returned unchanged, and any failure is reported beside it
	 * with one retry action, never thrown into a path that could read as "the
	 * mutation did not happen".
	 */
	private async closeOutBatchChild<T>(taskId: string, result: T, meta?: ToolMeta): Promise<T> {
		if (!meta || result === null || typeof result !== "object") return result;
		const lifecycle = (result as { record?: { lifecycle?: unknown } }).record?.lifecycle;
		if ((result as { state?: unknown }).state !== "completed" && lifecycle !== "done") return result;
		let slug: string | null;
		try {
			slug = findResumableBatchSlugForTask(this.cwd, taskId);
		} catch {
			return result;
		}
		if (!slug) return result;
		try {
			// The batch commit takes exactly the scope envelope plus this task's own
			// audit evidence, and its preflight refuses unstaged changes: stage only
			// that evidence, the step an Executor otherwise does by hand.
			if (existsSync(join(this.cwd, ".imm", "audit", taskId)))
				execFileSync("git", ["-C", this.cwd, "add", "--", `.imm/audit/${taskId}`], { stdio: "ignore" });
			const batch = await this.startUnattendedBatch(slug, meta, { reuseOnly: true });
			return { ...(result as object), batch } as T;
		} catch (error) {
			return {
				...(result as object),
				batch: {
					state: "rejected",
					reason: `batch continuation failed: ${error instanceof Error ? error.message : String(error)}`,
					recovery_action: "call start_unattended_batch with the same Initiative to continue the batch",
				},
			} as T;
		}
	}

	/**
	 * Post-settlement GitHub tracker projection: the same shared step the Pi Host
	 * runs, so an opted-in terminal projection no longer depends on which Host
	 * settled the task. Only a call that settled its task pays for it: the step
	 * cannot project anything from a result that reports a live obligation, so
	 * every other invocation returns untouched without reading the Kernel.
	 *
	 * Transport, never authority: the shared projection derives nothing unless the
	 * Kernel already shows a fresh claimless done/stopped task with its exact
	 * terminal tombstone, a tracker failure is reported as `tracker` alongside the
	 * authoritative result rather than as evidence or a blocker, and it never
	 * repeats the settling mutation.
	 */
	private async withTerminalTracker<T>(taskId: string, result: T): Promise<T> {
		if (result === null || typeof result !== "object") return result;
		if (!settledKernelResult(result)) return result;
		try {
			const projection = await this.status(taskId);
			const tracker = await projectTerminalTrackerState({
				root: this.cwd,
				task_id: taskId,
				projection,
				tombstone: readTaskTombstone(this.cwd, taskId),
				markTerminal: (root, input) => runGithubTrackerOperation(root, { op: "mark-terminal", ...input }),
			});
			return tracker ? ({ ...(result as object), tracker } as T) : result;
		} catch {
			// The underlying Kernel mutation already committed, so a failed observation
			// is reported beside the authoritative result instead of rethrown into a
			// path a caller could read as "the mutation did not happen" and retry.
			return { ...(result as object), tracker: TRACKER_PROJECTION_FAILURE } as T;
		}
	}

	async reviseIntent(taskId: string, nextIntent: unknown) {
		return this.executeOrdinary({ cwd: this.cwd }, {
			taskId,
			operation: { op: "revise_intent", next_intent: nextIntent, actor_id: "executor" },
		});
	}

	/**
	 * Ordinary Kernel operation, not a privileged one: canary_application builds
	 * the action without a capability and the Pi Host lists resolve_finding in
	 * its ordinary KERNEL_OPERATIONS. The reducer owns every precondition, so
	 * this port reads no findings and tests no kind.
	 */
	async resolveFinding(taskId: string, findingId: string) {
		return this.executeOrdinary({ cwd: this.cwd }, {
			taskId,
			operation: { op: "resolve_finding", finding_id: findingId, actor_id: "executor" },
		});
	}

	/**
	 * Ordinary Kernel operation, not a privileged one: the actor cannot assert a
	 * refutation, it can only bind a fresh passing QA attestation the Kernel
	 * already validated. The reducer owns every precondition.
	 */
	async refuteFinding(taskId: string, findingId: string, attestationId: string) {
		return this.executeOrdinary({ cwd: this.cwd }, {
			taskId,
			operation: {
				op: "refute_finding",
				finding_id: findingId,
				attestation_id: attestationId,
				actor_id: "executor",
			},
		});
	}

	async authorize(taskId: string, operation: string, meta: ToolMeta, extra: Record<string, unknown> = {}) {
		if (operation === "repair_authority_state") {
			const authority = reconcileKernelAuthority(this.cwd, taskId);
			// The workspace owner is derived from the single active run, so a claim
			// that contradicts the run index cannot exist: a settled or unowned
			// authority has nothing to repair, and any leftover retired claim file
			// is inert. A live owner is a conflict the caller must resolve.
			if (authority.state === "terminal_owner" || authority.state === "unowned")
				return repairKernelAuthority(this.cwd, taskId, authority.revision);
			if (authority.state !== "repairable_stale_claim" || authority.owner_task_id !== taskId) {
				throw new Error(authority.diagnostic ?? "authority repair requires a repairable stale claim");
			}
			return repairKernelAuthority(this.cwd, taskId, authority.revision);
		}
		if (!isPrivilegedOperation(operation) && operation !== "request_authorization") throw new Error(`unsupported privileged operation ${operation}`);
		let op: PrivilegedOperation | "request_authorization" | "resolve_user_decision" | "authorize_rework" = operation;
		let decisionOp: { finding_id: string; resolution: string } | undefined;
		const projection = await this.status(taskId);
		if (projection.error || !projection.claim) throw new Error(projection.error ?? "no active backend claim");
		// Kernel projection is the sole source of authorization readiness, and the
		// derivation is the shared export both Hosts use, so it cannot drift:
		// request_authorization submits the exact operation the projection derives,
		// including the single bound user-decision resolution.
		if (operation === "request_authorization") {
			const derived = deriveAuthorizationOperation({ readiness: projection.projection.authorization });
			if ("blocked" in derived) throw new Error(derived.blocked);
			if (derived.operation === "resolve-user-decision") {
				const record = await readTaskRecord(this.cwd, taskId);
				const open = (record.record?.findings ?? []).filter(
					(finding) => finding.kind === "unresolved_user_decision" && finding.status === "open",
				);
				if (open.length !== 1) throw new Error(`resolve-user-decision requires exactly one open user decision; found ${open.length}`);
				op = "resolve_user_decision";
				decisionOp = { finding_id: open[0].id, resolution: `resume after literal-user decision: ${open[0].summary}` };
			} else {
				op = "authorize_rework";
			}
		}
		const priorIntent = await readTaskIntentForRecord(this.cwd, taskId);
		const now = new Date().toISOString();
		const actorId = LITERAL_USER_ACTOR_ID;
		const nextIntent = extra.next_intent ? await parseTaskIntentV1(extra.next_intent) : undefined;
		if (op === "approve_breaking_intent_revision" && !nextIntent) throw new Error("approve_breaking_intent_revision requires next_intent");
		const nextIntentHash = nextIntent ? canonicalIntentHash(nextIntent) : undefined;
		const nextIntentRef = nextIntent
			? { path: `docs/plans/${nextIntent.task_id}.intent.json`, content_hash: nextIntentHash! }
			: undefined;
		const sidecar = nextIntent ? join(this.cwd, priorIntent.intent_ref.path) : undefined;
		// The snapshot carries the prior bytes; a second read would only be a
		// second source for the same fact.
		const stagedSnapshot = sidecar ? captureStagedIntent(this.cwd, priorIntent.intent_ref.path) : undefined;
		const restoreStagedIntent = (): void => {
			if (!stagedSnapshot) return;
			restoreStagedIntentShared(this.cwd, stagedSnapshot);
		};
		let preparedDiffHash = projection.projection.diff_hash;
		let gate: { confirmation_ref: string };
		try {
			if (sidecar && nextIntent) {
				writeFileSync(sidecar, `${JSON.stringify(nextIntent, null, 2)}\n`);
				execFileSync("git", ["add", "--", priorIntent.intent_ref.path], { cwd: this.cwd, stdio: ["ignore", "pipe", "pipe"] });
				const preparedRecord = await readTaskRecord(this.cwd, taskId);
				if (!preparedRecord.record) {
					throw new NativeAuthorityError("workspace_changed", "TaskRecord changed before the breaking revision digest");
				}
				preparedDiffHash = diffHashOf(this.cwd, preparedRecord.record);
			}
			const preparedProjection = await this.status(taskId);
			try {
				assertProjectionBinding(projection, preparedProjection, Boolean(nextIntent));
				if (preparedProjection.projection.diff_hash !== preparedDiffHash) {
					throw new Error("workspace changed while preparing the authority digest");
				}
			} catch (error) {
				throw new NativeAuthorityError("workspace_changed", error instanceof Error ? error.message : String(error));
			}
			gate = await this.gate(operation, { ...meta, taskId }, {
				risk: projection.projection.risk,
				intentRevision: nextIntent?.revision ?? projection.projection.intent_revision,
				intentContentHash: nextIntentHash ?? projection.projection.intent_content_hash,
				bindingDigest: `${preparedDiffHash}:${nextIntentHash ?? ""}`,
			});
		} catch (error) {
			if (stagedSnapshot) {
				const current = await readTaskRecord(this.cwd, taskId);
				if (current.record?.intent_snapshot.revision === priorIntent.intent.revision) {
					restoreStagedIntent();
				}
			}
			throw error;
		}
		const { registry, app } = this.authority();
		const confirmation = gate.confirmation_ref;
		let committed: ReturnType<typeof app.execute>;
		try {
			const capabilityProjection = await this.status(taskId);
			try {
				assertProjectionBinding(projection, capabilityProjection, Boolean(nextIntent));
			} catch (error) {
				throw new NativeAuthorityError("workspace_changed", error instanceof Error ? error.message : String(error));
			}
			const operationDiffHash = capabilityProjection.projection.diff_hash;
			if (nextIntent && operationDiffHash !== preparedDiffHash) {
				throw new NativeAuthorityError("workspace_changed", "workspace changed after native confirmation");
			}
			throwIfCancelled(meta.signal);
			const capability = await mintCapability(registry, {
				authority_kind: "user",
				task_id: taskId,
				run_id: capabilityProjection.projection.run_id,
				action_kind: op,
				expected_record_hash: capabilityProjection.projection.record_revision,
				intent_revision: nextIntent?.revision ?? capabilityProjection.projection.intent_revision,
				intent_content_hash: nextIntentHash ?? capabilityProjection.projection.intent_content_hash,
				diff_hash: operationDiffHash,
				actor_id: canonicalActorId(actorId),
				now,
				confirmation_ref: confirmation,
				...(op === "approve_breaking_intent_revision" ? { next_intent: nextIntent, next_intent_ref: nextIntentRef } : {}),
				...(op === "resolve_user_decision" && decisionOp ? decisionOp : {}),
				...(op === "stop" ? { reason: stopReason(extra.reason) } : {}),
			});
			throwIfCancelled(meta.signal);
			const result = app.execute({
				root: this.cwd,
				task_id: taskId,
				operation: {
					op,
					capability,
					actor_id: canonicalActorId(actorId),
					...(op === "approve_breaking_intent_revision" ? { next_intent: nextIntent, next_intent_ref: nextIntentRef } : {}),
					...(op === "resolve_user_decision" && decisionOp ? decisionOp : {}),
					...(op === "stop" ? { reason: stopReason(extra.reason) } : {}),
				} as never,
				prior_intent_token: priorIntent.token,
				diffProvider: diffSnapshotOf,
				now,
			});
			committed = result;
			if (
				op === "stop" ||
				op === "authorize_rework" ||
				op === "approve_breaking_intent_revision"
			) stagePlanningArtifactTransition(this.cwd, result.record);
		} catch (error) {
			if (stagedSnapshot) {
				const current = await readTaskRecord(this.cwd, taskId);
				if (current.record?.intent_snapshot.revision === priorIntent.intent.revision) {
					restoreStagedIntent();
				}
			}
			throw error;
		}
		// A stop settles the task: project the terminal tracker state exactly as the
		// Pi Host does after its own settlement. It runs once the mutation's own
		// try/catch has closed, so observation can never roll the staged intent back
		// or turn a committed mutation into an exception.
		return this.withTerminalTracker(taskId, committed);
	}

	private async executeOrdinary(ctx: HostContext, input: { taskId: string; operation: { op: string; actor_id: string; next_intent?: unknown; finding_id?: string; attestation_id?: string } }) {
		const { app } = await this.authority();
		const operation = input.operation.op === "revise_intent"
			? { ...input.operation, next_intent: await parseTaskIntentV1(input.operation.next_intent) }
			: input.operation;
		const priorIntent = await readTaskIntentForRecord(ctx.cwd, input.taskId);
		const sidecar = join(ctx.cwd, priorIntent.intent_ref.path);
		const priorBytes = operation.op === "revise_intent" ? readFileSync(sidecar) : null;
		// A content-changing revision writes the sidecar before the kernel's drift
		// check runs, so the written sidecar is staged and the exact prior bytes and
		// index entry are restored, verified, if the revision fails.
		const priorStaged = priorBytes !== null ? captureStagedIntent(ctx.cwd, priorIntent.intent_ref.path) : null;
		try {
			if (priorBytes) {
				writeFileSync(sidecar, `${JSON.stringify(operation.next_intent, null, 2)}\n`);
				execFileSync("git", ["add", "--", priorIntent.intent_ref.path], {
					cwd: ctx.cwd,
					stdio: ["ignore", "pipe", "pipe"],
				});
			}
			const result = await app.execute({
				root: ctx.cwd,
				task_id: input.taskId,
				operation: operation as never,
				prior_intent_token: priorIntent.token,
				diffProvider: diffSnapshotOf,
				now: new Date().toISOString(),
			});
			if (operation.op === "freeze_artifacts" || operation.op === "stop") stagePlanningArtifactTransition(ctx.cwd, result.record);
			return result;
		} catch (error) {
			if (priorStaged) {
				const current = await readTaskRecord(ctx.cwd, input.taskId);
				if (current.record?.intent_snapshot.revision === priorIntent.intent.revision)
					restoreStagedIntentShared(ctx.cwd, priorStaged);
			}
			throw error;
		}
	}

	async startUnattendedBatch(
		initiativeSlug: string,
		meta: ToolMeta,
		options: { reuseOnly?: boolean } = {},
	): Promise<ClaudeBatchStartResult> {
		throwIfCancelled(meta.signal);
		const reuseOnly = options.reuseOnly === true;
		const probe = probeHost(this.env, process.platform, this.hostVersion);
		if (!probe.ok) throw new NativeAuthorityError("unsupported_host", probe.reason);
		// A reuse-only continuation never opens a gate, so it needs no confirmation port.
		const interactive = meta.interactive ?? this.interactive;
		if (!reuseOnly && !interactive) throw new NativeAuthorityError("unsupported_host", "interactive MCP elicitation is unavailable");
		// The text is table-owned; only the form (a thrown native error rather than
		// a returned envelope) is this Host's.
		if (!reuseOnly && !this.requestConfirmation)
			throw new NativeAuthorityError("interaction_not_opened", batchReason("confirmation_port_unavailable").reason);

		// 1. Host-independent batch preflight: claim ownership, branch
		// availability, working-tree cleanliness against the authorized scope,
		// recovery children, plan digest, and base HEAD are one shared projection,
		// so neither Host re-implements a batch decision.
		let now = new Date().toISOString();
		const preflight = await projectBatchPreflight({
			root: this.cwd,
			initiative_slug: initiativeSlug,
			now,
			readInitiative: this.readInitiative ?? observeGithubInitiative,
		});
		if (!preflight.ok) {
			return {
				state: preflight.state,
				reason: preflight.reason,
				recovery_action: preflight.recovery_action,
			};
		}
		const isResuming = preflight.projection.is_resuming;
		const batchBranch = preflight.projection.batch_branch;
		const existingBatch = preflight.projection.existing_batch;
		const budget = preflight.projection.budget;
		const planDigest = preflight.projection.plan_digest;
		const recoveryChildren = preflight.projection.recovery_children;
		// 5. Literal-user gate plus the shared reuse decision, the post-gate
		// claim/drift cascade, and the Batch Authorization binding. The Host supplies
		// only its gate, its confirmation reference, and its binding nonce.
		const authorization = await authorizeBatch<ClaudeBatchStartResult>({
			root: this.cwd,
			initiative_slug: initiativeSlug,
			now,
			projection: preflight.projection,
			readInitiative: this.readInitiative ?? observeGithubInitiative,
			nonce: enrollmentNonce(),
			gate: async (facts) => {
				// A continuation after a foreground child never opens a gate: when the
				// authorization cannot be reused, the user re-enters the batch tool.
				if (reuseOnly)
					return {
						kind: "host_rejection",
						value: {
							state: "blocked",
							reason: `batch authorization cannot be reused (${facts.reuse_blockers.join(", ")})`,
							recovery_action: "call start_unattended_batch with the same Initiative to confirm a fresh authorization",
						},
					};
				// The gate settles only on the literal user's answer or the caller's
				// cancellation signal.
				let confirmationResult: { decision: NativeDecision; requestId: string };
				try {
					confirmationResult = await this.requestConfirmation!({
						operation: "start_unattended_batch",
						initiativeSlug,
						toolCallId: meta.toolCallId,
						planDigest,
						batchDetails: {
							initiative_slug: facts.initiative_slug,
							batch_branch: facts.batch_branch,
							children: facts.children.map((child) => ({
								task_id: child.task_id,
								slice_id: child.slice_id,
								risk: child.risk,
							})),
							excluded: facts.excluded.map((child) => ({
								task_id: child.task_id,
								slice_id: child.slice_id,
								reason: child.reason,
							})),
							budget: facts.budget,
							...(facts.reuse_blockers.length > 0
								? {
										re_confirmation_required: facts.reuse_blockers,
										recovery: "confirm to issue a fresh authorization bound to the current plan and HEAD",
									}
								: {}),
						},
						signal: meta.signal,
					});
				} catch (err) {
					if (meta.signal?.aborted)
						return { kind: "host_rejection", value: batchReason("cancelled_before_execution") };
					if (err instanceof NativeAuthorityError) {
						if (err.reasonCode === "unsupported_host") throw err;
						if (err.reasonCode === "user_cancelled") {
							return {
								kind: "host_rejection",
								value: { state: "cancelled", reason: err.message, recovery_action: err.recoveryAction },
							};
						}
						return {
							kind: "host_rejection",
							value: { state: "rejected", reason: err.message, recovery_action: err.recoveryAction },
						};
					}
					return {
						kind: "host_rejection",
						value: batchReason("confirmation_failed", err instanceof Error ? err.message : String(err)),
					};
				}

				if (confirmationResult.decision === "cancel" && meta.signal?.aborted)
					return { kind: "host_rejection", value: batchReason("confirmation_cancelled") };
				if (meta.signal?.aborted)
					return { kind: "host_rejection", value: batchReason("cancelled_before_execution") };
				if (confirmationResult.decision === "decline")
					return { kind: "host_rejection", value: batchReason("confirmation_declined") };
				if (confirmationResult.decision === "cancel")
					return { kind: "host_rejection", value: batchReason("confirmation_cancelled") };
				if (confirmationResult.decision !== "accept")
					return { kind: "host_rejection", value: batchReason("confirmation_no_decision") };
				return { kind: "confirmed", request_id: confirmationResult.requestId };
			},
			// A reused authorization keeps this invocation's Kernel binding without a new
			// literal-user act, so its confirmation reference names the resumed batch
			// rather than a requestId no elicitation produced.
			confirmationRef: ({ batch_id, request_id }) =>
				confirmationRef({
					connectionId: meta.sessionId,
					toolCallId: meta.toolCallId,
					requestId: request_id ?? `resumed-${batch_id}`,
					operation: "start_unattended_batch",
					initiativeSlug,
					planDigest,
				}),
		});
		if (authorization.outcome === "host_rejection") return authorization.value;
		if (authorization.outcome === "rejected") return authorization.rejection;
		const { binding, batch_id: batchId } = authorization;

		// review-1: verify cancellation signal right before authority issuance and startBatch
		if (meta.signal?.aborted) return batchReason("cancelled_before_execution");

		now = new Date().toISOString();
		const capability = this.batchRegistry.issue(binding, recoveryChildren as any, now);

		// review-batch-partial-port-fabricates-enrollment: the production child
		// Kernel port is the shared runtime/unattended one; this Host supplies
		// only its own advanceTask progression seam (D5).
		const advanceTask: BatchRunnerKernelPort["advanceTask"] = async (root, taskId) => {
			const result = await this.coordinator.advance(taskId, { cwd: root });
			const facts = { diagnostics: result.diagnostics, environment_failure: result.environment_failure, recovery: result.recovery };
			if (result.state === "completed") return { state: "completed", ...facts };
			if (result.state === "stopped") return { state: "stopped", ...facts };
			if (result.state === "rework") return { state: "rework", operation: result.operation, summary: result.summary, ...facts };
			if (result.state === "review_ready") return { state: "review_ready", operation_id: result.operation_id, ...facts };
			if (result.state === "review_preparation_failed") return { state: result.state, operation: result.operation, operation_id: result.operation_id, reason: result.reason, ...facts };
			if (result.state === "blocked") return { state: "blocked", reason: result.reason, ...facts };
			return { state: "failed", reason: (result as { reason?: string }).reason ?? "advance failed", ...facts };
		};
		const kernelPort = createBatchKernelPort({
			root: this.cwd,
			enrollmentRegistry: this.enrollmentRegistry,
			registry: this.batchRegistry,
			capability,
			binding,
			advanceTask,
			resume: { isResuming, existingBatch, batchBranch },
			overrides: this.batchKernel,
		});
		const report = await startBatch({
			root: this.cwd,
			batch_id: batchId,
			initiative_slug: initiativeSlug,
			registry: this.batchRegistry,
			capability,
			children: recoveryChildren,
			plan_digest: planDigest,
			base_head: binding.base_head,
			confirmation_time: now,
			budget,
			now,
			kernel: kernelPort,
			git: this.batchGit,
		});

		// review-3 & review-batch-preflight-recovery-is-diagnostic: map rejected batch state to rejected result with same-Host recovery action
		if (report.batch_state === "rejected") return batchReason("batch_run_rejected", report.reason ?? "");

		return {
			state: "started",
			batch_id: batchId,
			report,
		};
	}
}

export interface ToolMeta {
	sessionId: string;
	toolCallId: string;
	taskId: string;
	initiativeSlug?: string;
	requiresUserInteraction?: boolean;
	permissionMode?: PermissionMode;
	interactive?: boolean;
	signal?: AbortSignal;
}