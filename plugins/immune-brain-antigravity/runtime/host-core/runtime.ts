// Host-neutral adapter runtime (Issue #414 slice S3, Spec
// docs/specs/host-neutral-adapter-core.spec.md D7). One `HostRuntime` holds the
// body the two Hosts used to share by inheritance; each adapter supplies a
// `HostRuntimeProfile` and owns the instance.
//
// Interface: `HostRuntime`, `HostRuntimeOptions`, `HostRuntimeProfile`,
// `ToolMeta`, `diffSnapshotOf`, `diffHashOf`, `settledKernelResult`,
// Invariants: every Host-specific fact arrives through the profile; this module
// imports no adapter, and no adapter extends another.
// Side Effects: through the coordinator and the Kernel store.
// Verification: `bun test tests/dual-host-assurance-conformance.test.ts -t 'runtime composition'`.

import { stagePlanningArtifactTransition, type VerdictAuthority } from "../assurance/verdict_authority";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/** The Hosts an adapter runtime serves. */
export type HostKind = "claude-code" | "pi" | "antigravity";
import type { AssuranceHostPort } from "../assurance/host_port";

import {
	AssuranceCoordinator,
	type AssuranceCoordinatorPorts,
	type AssuranceSubmitReviewResult,
	type HostContext,
} from "../assurance/coordinator";
import {
} from "../assurance/verification";
import {
	projectAssurance,
	type AssuranceProjection,
	type AssuranceProjectionResult,
	type ReworkChoice,
	type ReworkExitsReadiness,
} from "../kernel/assurance_projection";
import { type TaskFinding, type TaskRecord } from "../kernel/types";
import { findingsDigestV2 } from "../kernel/reducer";
import { readTaskRecordRaw, recoverKernelStoreFollowUps } from "../kernel/storage";
import {
	canonicalIntentHash,
	classifyIntentRevision,
	parseProjectTaskIntent,
	readTaskIntent,
	withNextScope,
} from "../kernel/intent";
import { capabilityActionFor, createCanaryApplication, type CanaryApplication } from "../kernel/canary_application";
import {
	createMutationAuthorityRegistry,
	digestOfAction,
	type CapabilityBindingV2,
	type MutationAuthorityRegistry,
} from "../kernel/authority_port";
import { createEnrollmentAuthorityRegistry, type EnrollmentCapabilityBinding } from "../kernel/enrollment_authority";
import { enrollTask, EnrollmentRehearsalError, singleTaskEnrollmentDirt } from "../kernel/enrollment";
import { inspectSpecBinding } from "../kernel/spec_binding";
import { preparePiCanary } from "../assurance/enrollment";
import { reconcileKernelAuthority, repairKernelAuthority } from "../kernel/storage";
import { withSettleCommit } from "../assurance/workflow_autocommit";
import { runDeterministicQa } from "../assurance/qa";
import { taskDeliveryIdentity } from "../workspace_scope";
import { deriveAuthorizationOperation, reviewRetryNotice } from "../authorization_operation";
import { currentReviewContractHash } from "../role_prompt_bridge";
import { LITERAL_USER_ACTOR_ID, canonicalActorId } from "../kernel/actor_identity";
import { projectTaskStatus, projectTerminalTrackerState, TRACKER_PROJECTION_FAILURE } from "../assurance/coordinator";
import { runGithubTrackerOperation } from "../github_issue_tracker";
import { readTaskTombstone } from "../kernel/backend_claim";
import {
	captureStagedIntent,
	restoreStagedIntent as restoreStagedIntentShared,
} from "../staged_intent";
import {
	enrollmentNonce,
	evaluateNativeGate,
	isPrivilegedOperation,
	NativeAuthorityError,
	type ConfirmationRefInput,
	type NativeConfirmationInput,
	type NativeConfirmationPort,
	type NativeConfirmationResult,
	type PrivilegedOperation,
} from "./interaction";
import { CliReviewHost } from "../assurance/cli_review";

/** The Host's native permission mode; each adapter's capability module validates its own accepted set. */
export type PermissionMode = "manual" | "acceptEdits" | "auto" | "bypassPermissions" | "dontAsk";

/** What a Host probe reports; the shared runtime reads only the refusal reason. */
export type HostProbe = { ok: true } | { ok: false; reason: string };

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
 * A revision is prepared, checked and bound against the scope it asks for, so
 * the delivery identity of that operation reads the next scope (ADR 0021, D6).
 */
function nextScopeDiffProvider(nextScope: readonly string[]): typeof diffSnapshotOf {
	return (root, record) => diffSnapshotOf(root, withNextScope(record, nextScope));
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
	const record = readTaskRecordRaw(root, taskId).record;
	return readTaskIntent(root, taskId, record?.intent_ref.path, record?.intent_snapshot);
}

/**
 * Ordinary Kernel mutation shared by all Hosts; only Intent recovery is injected.
 * A content-changing revision writes the sidecar before the Kernel's drift check
 * runs, and an unstaged write is itself scoped drift that deadlocks the
 * revision. So the written sidecar is staged (worktree == index) and, if the
 * revision fails, the exact prior bytes and index entry are restored, verified.
 */
export async function executeOrdinaryKernelOperation(input: {
	root: string;
	taskId: string;
	operation: { op: string; actor_id: string; next_intent?: unknown; finding_id?: string; attestation_id?: string };
	app: CanaryApplication;
	readIntent?: (root: string, taskId: string) => ReturnType<typeof readTaskIntent>;
}) {
	const { root, taskId, app } = input;
	const operation = input.operation.op === "revise_intent"
		? { ...input.operation, next_intent: parseProjectTaskIntent(root, input.operation.next_intent) }
		: input.operation;
	const priorIntent = (input.readIntent ?? readTaskIntentForRecord)(root, taskId);
	const nextScope = operation.op === "revise_intent"
		? (operation.next_intent as { scope_hint: string[] }).scope_hint
		: undefined;
	const sidecar = join(root, priorIntent.intent_ref.path);
	const priorBytes = operation.op === "revise_intent" ? readFileSync(sidecar) : null;
	const priorStaged = priorBytes !== null ? captureStagedIntent(root, priorIntent.intent_ref.path) : null;
	try {
		if (priorBytes) {
			writeFileSync(sidecar, `${JSON.stringify(operation.next_intent, null, 2)}\n`);
			execFileSync("git", ["add", "--", priorIntent.intent_ref.path], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
		}
		const result = await app.execute({
			root,
			task_id: taskId,
			operation: operation as never,
			reviewContractHash: currentReviewContractHash(),
			prior_intent_token: priorIntent.token,
			diffProvider: nextScope ? nextScopeDiffProvider(nextScope) : diffSnapshotOf,
			now: new Date().toISOString(),
		});
		if (operation.op === "freeze_artifacts" || operation.op === "stop") stagePlanningArtifactTransition(root, result.record);
		return result;
	} catch (error) {
		if (priorStaged) {
			const current = await readTaskRecordRaw(root, taskId);
			if (current.record?.intent_snapshot.revision === priorIntent.intent.revision)
				restoreStagedIntentShared(root, priorStaged);
		}
		throw error;
	}
}

import {
	extractVerdictJson,
	submitMediatedReview,
} from "../assurance/review_mediation";
export { extractVerdictJson };

export async function submitHostReview(
	host: { inspectReviewForTask(taskId: string): any },
	coordinator: AssuranceCoordinator,
	ctx: HostContext,
	taskId: string,
	verdictInput: unknown,
): Promise<AssuranceSubmitReviewResult> {
	// ADR 0017: an omitted verdict applies the hook-observed reviewer receipt.
	return submitMediatedReview(coordinator, ctx, taskId, verdictInput, () => host.inspectReviewForTask(taskId));
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
		rounds?: number;
		review_contract_hash?: string;
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
		...(input.rounds !== undefined ? { rounds: input.rounds } : {}),
		...(input.review_contract_hash ? { review_contract_hash: input.review_contract_hash, intent_content_hash: input.intent_content_hash } : {}),
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

/** Internal control flow for a read-only native-gate preview, never a user decision. */
class ConfirmationPreviewSignal extends Error {
	constructor(readonly input: NativeConfirmationInput) {
		super("native confirmation preview");
	}
}

/** Every Host-specific fact this runtime needs; each adapter's composition root supplies one. */
export interface HostRuntimeProfile {
	/** The Kernel host id of this adapter, and its default parent host. */
	readonly hostId: HostKind;
	/** The adapter's AssuranceHostPort, built when the runtime needs its default. */
	createHost(): AssuranceHostPort & { observe(event: any): void };
	/** Records one raw Host event on that port. */
	observe(host: AssuranceHostPort & { observe(event: any): void }, event: unknown): void;
	/** The Host probe this composition root chose; the shared runtime never selects one. */
	probeHost: (env: Record<string, string | undefined>, platform: NodeJS.Platform, hostVersion?: string) => HostProbe;
	/** The Kernel-bound reference this Host records for one native confirmation. */
	confirmationRef(input: ConfirmationRefInput): string;
}

export interface HostRuntimeOptions {
	cwd: string;
	env?: Record<string, string | undefined>;
	parentHost?: HostKind;
	probeHost?: HostRuntimeProfile["probeHost"];
	host?: AssuranceHostPort & {
		observe(event: any): void;
	};
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
}

/**
 * One Host's adapter runtime. Every host-neutral step — Kernel operations and
 * native gate plumbing — lives here; the adapter supplies a
 * `HostRuntimeProfile` and composes an instance.
 */
export class HostRuntime {
	private readonly parentHost: HostKind;
	readonly host: AssuranceHostPort & {
		observe(event: any): void;
	};
	/** The Review port the coordinator and `submit_review` use: the CLI dispatcher (D11). */
	private readonly reviewHost: CliReviewHost;
	readonly coordinator: AssuranceCoordinator;
	private cwd: string;
	private readonly options: HostRuntimeOptions;
	private readonly env: Record<string, string | undefined>;
	private readonly interactive: boolean;
	private requestConfirmation?: NativeConfirmationPort;
	private hostVersion: string | undefined;
	private mutationRegistry: MutationAuthorityRegistry | null = null;
	private enrollmentRegistry = createEnrollmentAuthorityRegistry();
	private app: ReturnType<typeof createCanaryApplication> | null = null;

	constructor(readonly profile: HostRuntimeProfile, options: HostRuntimeOptions) {
		this.cwd = options.cwd;
		this.options = options;
		this.env = options.env ?? process.env;
		this.interactive = options.interactive ?? true;
		this.parentHost = options.parentHost ?? profile.hostId;
		this.requestConfirmation = options.requestConfirmation;
		this.host = options.host ?? profile.createHost();
		this.reviewHost = new CliReviewHost(this.host, { env: this.env });
		this.coordinator = new AssuranceCoordinator({
			...this.createKernelPorts(),
			...options.ports,
			host: this.reviewHost,
			confirmationReference: this.actorConfirmationRef,
		}, options.authorityOverrides);
	}

	/** The coordinator-facing confirmation reference: this Host's name over the exact actor. */
	private actorConfirmationRef = ({ actorId }: { actorId: string }): string =>
		`${this.parentHost === "claude-code" ? "claude" : this.parentHost}:${actorId}`;

	observe(event: unknown): void {
		this.profile.observe(this.host, event);
	}

	/** Bind the version announced by the connected Host during the MCP handshake. */
	/**
	 * Bind the workspace this connection's next call runs in. The MCP server
	 * resolves it per tool call, so a long-lived server started from the plugin
	 * root follows the session workspace instead of its own `cwd`.
	 */
	bindWorkspace(cwd: string): void {
		this.cwd = cwd;
	}

	bindHostVersion(version: string | undefined): void {
		this.hostVersion = version || undefined;
	}

	private probeHost(): HostProbe {
		return (this.options.probeHost ?? this.profile.probeHost)(this.env, process.platform, this.hostVersion);
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
			host: this.reviewHost,
			confirmationReference: this.actorConfirmationRef,
			projectTask: (root, taskId) => projectAssurance(root, taskId, diffSnapshotOf),
			readTaskRecord: async (root, taskId) => readTaskRecordRaw(root, taskId),
			readTaskIntent: async (root, taskId) => readTaskIntentForRecord(root, taskId),
			runQa: (snapshot, descriptors, options) => runDeterministicQa(snapshot, descriptors, options),
			applyOrdinaryOperation: (ctx, input) => this.executeOrdinary(ctx, input),
		};
	}

	private authority() {
		this.mutationRegistry ??= createMutationAuthorityRegistry();
		this.app ??= createCanaryApplication(this.mutationRegistry);
		return { registry: this.mutationRegistry, app: this.app };
	}

	/** ADR 0025: every privileged operation opens this Host's native gate; no entry token stands in for it. */
	private async confirm(input: NativeConfirmationInput, meta: ToolMeta): Promise<NativeConfirmationResult> {
		if (!this.requestConfirmation)
			throw new NativeAuthorityError("interaction_not_opened", "native confirmation port is unavailable");
		return this.requestConfirmation({
			...input,
			...(meta.admissionId ? { admissionId: meta.admissionId } : {}),
			...(meta.workspace ? { workspace: meta.workspace } : {}),
		});
	}

	private async gate(operation: string, meta: ToolMeta, binding: {
		risk?: string;
		intentRevision?: number;
		intentContentHash?: string;
		bindingDigest?: string;
		gitBaseNotice?: string;
		reworkExits?: ReworkExitsReadiness;
		verifierDispute?: NativeConfirmationInput["verifierDispute"];
		reviewRetryNotice?: string;
	} = {}): Promise<{ confirmation_ref: string; reworkChoice?: ReworkChoice; verifierChoice?: NativeConfirmationResult["verifierChoice"] }> {
		throwIfCancelled(meta.signal);
		const probe = this.probeHost();
		if (!probe.ok) throw new NativeAuthorityError("unsupported_host", probe.reason);
		const interactive = meta.interactive ?? this.interactive;
		if (!interactive) throw new NativeAuthorityError("unsupported_host", "interactive MCP elicitation is unavailable");
		if (!isPrivilegedOperation(operation)) throw new Error(`unsupported native operation ${operation}`);
		// The text is table-owned; only the form (a thrown native error rather than
		// a returned envelope) is this Host's.
		const result = await this.confirm({ operation, taskId: meta.taskId, toolCallId: meta.toolCallId, signal: meta.signal, ...binding }, meta);
		throwIfCancelled(meta.signal);
		const gate = evaluateNativeGate({ operation, interactive, decision: result.decision });
		if (!gate.ok) throw gate.error;
		const { reworkExits: _exits, verifierDispute: _dispute, ...refBinding } = binding;
		return {
			confirmation_ref: this.profile.confirmationRef({
				connectionId: meta.sessionId,
				toolCallId: meta.toolCallId,
				requestId: result.requestId,
				operation,
				taskId: meta.taskId,
				...refBinding,
			}),
			...(result.reworkChoice ? { reworkChoice: result.reworkChoice } : {}),
			...(result.verifierChoice ? { verifierChoice: result.verifierChoice } : {}),
		};
	}

	/** The status Tool: readable with unstaged in-scope paths, which come back as a warning. */
	async status(taskId: string, nextScope?: readonly string[]) {
		return nextScope ? this.project(taskId, nextScope) : projectTaskStatus(this.cwd, taskId);
	}

	/** The refusing projection every mutation and authorization is bound to. */
	private async project(taskId: string, nextScope?: readonly string[]) {
		return projectAssurance(this.cwd, taskId, nextScope ? nextScopeDiffProvider(nextScope) : diffSnapshotOf);
	}

	/**
	 * In-place Enrollment of one validated TaskIntent in this workspace. Every
	 * refusal the Kernel can foresee is raised before the native gate opens, so
	 * the user never confirms a task that cannot commit; the Kernel then
	 * recomputes the confirmed preparation digest under its store lock.
	 */
	async enroll(taskId: string, meta: ToolMeta) {
		const now = new Date().toISOString();
		const preparation = preparePiCanary(this.cwd, { task_id: taskId, now });
		// No TaskRecord exists yet, so the sidecar path comes from the preparation's own read.
		const { intent, intent_ref, content_hash } = readTaskIntent(this.cwd, taskId, preparation.intent?.path);
		if (preparation.task_record_v3?.present || preparation.task_tombstone.present)
			throw new EnrollmentRehearsalError([`task ${taskId} already has a Kernel record; read its status instead of enrolling`]);
		if (preparation.workspace.current_working !== null)
			throw new EnrollmentRehearsalError([`workspace is owned by ${preparation.workspace.current_working}; finish or stop it first`]);
		if (!preparation.intent || preparation.intent.content_hash !== content_hash)
			throw new EnrollmentRehearsalError(["TaskIntent changed during preparation; retry enroll"]);
		if (!preparation.git_base_head)
			throw new EnrollmentRehearsalError([preparation.git_error ?? "enrollment requires a committed Git HEAD"]);
		const binding = inspectSpecBinding(intent);
		if (!binding.ok) throw new EnrollmentRehearsalError([binding.message]);
		const dirt = singleTaskEnrollmentDirt(this.cwd, intent_ref.path, intent);
		if (dirt.length > 0) throw new EnrollmentRehearsalError([`workspace_not_clean: ${dirt.join(", ")}`]);
		const gate = await this.gate("enroll", { ...meta, taskId }, {
			risk: intent.risk,
			intentRevision: preparation.intent.revision,
			intentContentHash: preparation.intent.content_hash,
			bindingDigest: preparation.digest,
			gitBaseNotice: `Goal: ${intent.goal}\nGit base: ${preparation.git_base_head} (implemented in this workspace)`,
		});
		const capabilityBinding: EnrollmentCapabilityBinding = {
			task_id: taskId,
			intent_path: preparation.intent.path,
			intent_revision: preparation.intent.revision,
			intent_content_hash: preparation.intent.content_hash,
			preparation_digest: preparation.digest,
			actor_id: LITERAL_USER_ACTOR_ID,
			confirmation_ref: gate.confirmation_ref,
			nonce: enrollmentNonce(),
		};
		const outcome = await enrollTask(this.cwd, this.enrollmentRegistry, {
			binding: capabilityBinding,
			confirmation: { source: "user_session" },
			now,
			checkpoint: () => !meta.signal?.aborted,
		});
		if (outcome.outcome === "cancelled") throw new NativeAuthorityError("user_cancelled", "enrollment cancelled before commit");
		return { ...(await this.status(taskId)), state: "enrolled" as const, task_id: taskId };
	}

	async advance(taskId: string, signal?: AbortSignal, _meta?: ToolMeta) {
		return withSettleCommit(this.cwd, taskId, await this.withTerminalTracker(taskId, await this.coordinator.advance(taskId, { cwd: this.cwd }, signal)), signal);
	}

	async submitReview(taskId: string, verdictInput: unknown, meta?: ToolMeta) {
		return withSettleCommit(this.cwd, taskId, await this.withTerminalTracker(
			taskId,
			await submitHostReview(this.reviewHost, this.coordinator, { cwd: this.cwd }, taskId, verdictInput),
		), meta?.signal);
	}

	async submitVerification(taskId: string, result: string | undefined, meta?: ToolMeta) {
		return withSettleCommit(this.cwd, taskId, await this.withTerminalTracker(taskId,
			await this.coordinator.submitVerification(taskId, { cwd: this.cwd }, result)), meta?.signal);
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
			// An observation after the commit, not an authority binding: it reads
			// through the same status the Tool returns.
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

	/** Enrollment opens its own gate; every other privileged operation runs in this workspace. */
	async authorize(taskId: string, operation: string, meta: ToolMeta, extra: Record<string, unknown> = {}) {
		if (operation === "enroll") return this.enroll(taskId, meta);
		return this.authorizeInRoot(taskId, operation, meta, extra);
	}

	private async authorizeInRoot(taskId: string, operation: string, meta: ToolMeta, extra: Record<string, unknown> = {}) {
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
		let op: PrivilegedOperation | "request_authorization" | "resolve_user_decision" | "authorize_rework" | "authorize_review_retry" | "accept_residual_risk" = operation;
		let decisionOp: { finding_id: string; resolution: string } | undefined;
		let verifierDispute: NativeConfirmationInput["verifierDispute"];
		// Set only at a replan boundary: the exits the literal user chooses between.
		let reworkExits: ReworkExitsReadiness | undefined;
		let reworkChoice: ReworkChoice | undefined;
		let reviewRetry: { review_contract_hash: string; previous_contract_hash: string | null } | undefined;
		const nextIntent = extra.next_intent ? parseProjectTaskIntent(this.cwd, extra.next_intent) : undefined;
		// The whole operation is judged against the scope it asks for (D6).
		const nextScope = nextIntent?.scope_hint;
		const diffProvider = nextScope ? nextScopeDiffProvider(nextScope) : diffSnapshotOf;
		const projection = await this.project(taskId, nextScope);
		if (projection.error || !projection.claim) throw new Error(projection.error ?? "no active backend claim");
		// Kernel projection is the sole source of authorization readiness, and the
		// derivation is the shared export both Hosts use, so it cannot drift:
		// request_authorization submits the exact operation the projection derives,
		// including the single bound user-decision resolution.
		if (operation === "request_authorization") {
			const derived = deriveAuthorizationOperation({ readiness: projection.projection.authorization });
			if ("blocked" in derived) throw new Error(derived.blocked);
			if (derived.operation === "resolve-user-decision") {
				const record = await readTaskRecordRaw(this.cwd, taskId);
				const open = (record.record?.findings ?? []).filter(
					(finding) => finding.kind === "unresolved_user_decision" && finding.status === "open",
				);
				if (open.length !== 1) throw new Error(`resolve-user-decision requires exactly one open user decision; found ${open.length}`);
				op = "resolve_user_decision";
				decisionOp = { finding_id: open[0].id, resolution: `resume after literal-user decision: ${open[0].summary}` };
				const dispute = record.record?.history.find(entry => entry.review_verifier_dispute?.decision_id === open[0].id)?.review_verifier_dispute;
				if (dispute) verifierDispute = { claim: dispute.finding.summary, trigger: dispute.finding.evidence.trigger,
					caller_chain: dispute.finding.evidence.caller_chain, counter_path: dispute.counter_path };
			} else if (derived.operation === "authorize-review-retry") {
				op = "authorize_review_retry";
				reviewRetry = projection.projection.authorization.review_retry;
				if (!reviewRetry || reviewRetry.review_contract_hash !== currentReviewContractHash()) throw new Error("Review retry contract changed");
			} else {
				op = "authorize_rework";
				reworkExits = projection.projection.authorization.exits;
			}
		}
		const priorIntent = await readTaskIntentForRecord(this.cwd, taskId);
		const now = new Date().toISOString();
		const actorId = LITERAL_USER_ACTOR_ID;
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
		let gate: { confirmation_ref: string; reworkChoice?: ReworkChoice; verifierChoice?: NativeConfirmationResult["verifierChoice"] };
		try {
			if (sidecar && nextIntent) {
				// A gate the Kernel would refuse afterwards is never opened.
				if (op === "approve_breaking_intent_revision" && classifyIntentRevision(priorIntent.intent, nextIntent) !== "breaking")
					throw new Error("approve_breaking_intent_revision requires a breaking revision");
				writeFileSync(sidecar, `${JSON.stringify(nextIntent, null, 2)}\n`);
				execFileSync("git", ["add", "--", priorIntent.intent_ref.path], { cwd: this.cwd, stdio: ["ignore", "pipe", "pipe"] });
				const preparedRecord = await readTaskRecordRaw(this.cwd, taskId);
				if (!preparedRecord.record) {
					throw new NativeAuthorityError("workspace_changed", "TaskRecord changed before the breaking revision digest");
				}
				preparedDiffHash = diffProvider(this.cwd, preparedRecord.record).diff_hash;
			}
			const preparedProjection = await this.project(taskId, nextScope);
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
				...(reworkExits ? { reworkExits } : {}),
				...(verifierDispute ? { verifierDispute } : {}),
				...(reviewRetry ? { reviewRetryNotice: reviewRetryNotice(reviewRetry) } : {}),
			});
			reworkChoice = gate.reworkChoice;
		} catch (error) {
			if (stagedSnapshot) {
				const current = await readTaskRecordRaw(this.cwd, taskId);
				if (current.record?.intent_snapshot.revision === priorIntent.intent.revision) {
					restoreStagedIntent();
				}
			}
			throw error;
		}
		if (verifierDispute) {
			if (!decisionOp || (gate.verifierChoice !== "accept_verifier_dispute" && gate.verifierChoice !== "dismiss_verifier_dispute"))
				throw new NativeAuthorityError("interaction_not_opened", "native interaction returned no verifier dispute choice");
			decisionOp.resolution = gate.verifierChoice;
		}
		if (reworkExits) {
			if (!reworkChoice) throw new NativeAuthorityError("interaction_not_opened", "native interaction returned no exit");
			// A replan is not a mutation of this operation: the user chose to revise
			// the Intent, which has its own gate. Nothing is written.
			if (reworkChoice.exit === "replan") {
				return {
					state: "replan_selected",
					task_id: taskId,
					next: "revise the Intent, then call approve_breaking_intent_revision",
				};
			}
			if (reworkChoice.exit === "accept_residual_risk") op = "accept_residual_risk";
		}
		const { registry, app } = this.authority();
		const confirmation = gate.confirmation_ref;
		let committed: ReturnType<typeof app.execute>;
		try {
			const capabilityProjection = await this.project(taskId, nextScope);
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
				...(op === "authorize_review_retry" && reviewRetry ? { review_contract_hash: reviewRetry.review_contract_hash } : {}),				...(op === "approve_breaking_intent_revision" ? { next_intent: nextIntent, next_intent_ref: nextIntentRef } : {}),
				...(op === "resolve_user_decision" && decisionOp ? decisionOp : {}),
				...(op === "stop" ? { reason: stopReason(extra.reason) } : {}),
				...(op === "authorize_rework" && reworkChoice?.exit === "grant_rounds" ? { rounds: reworkChoice.rounds } : {}),
				...(op === "accept_residual_risk" && reworkChoice?.exit === "accept_residual_risk" ? { reason: reworkChoice.reason } : {}),
			});
			throwIfCancelled(meta.signal);
			const result = app.execute({
				root: this.cwd,
				task_id: taskId,
				operation: {
					op,
					capability,
					...(op === "authorize_review_retry" && reviewRetry ? { review_contract_hash: reviewRetry.review_contract_hash, intent_content_hash: projection.projection.intent_content_hash } : {}),
					actor_id: canonicalActorId(actorId),
					...(op === "approve_breaking_intent_revision" ? { next_intent: nextIntent, next_intent_ref: nextIntentRef } : {}),
					...(op === "resolve_user_decision" && decisionOp ? decisionOp : {}),
					...(op === "stop" ? { reason: stopReason(extra.reason) } : {}),
					...(op === "authorize_rework" && reworkChoice?.exit === "grant_rounds" ? { rounds: reworkChoice.rounds } : {}),
					...(op === "accept_residual_risk" && reworkChoice?.exit === "accept_residual_risk" ? { reason: reworkChoice.reason } : {}),
				} as never,
				prior_intent_token: priorIntent.token,
				reviewContractHash: currentReviewContractHash(),
				diffProvider,
				now,
			});
			committed = result;
			if (
				op === "stop" ||
				op === "authorize_rework" ||
				op === "accept_residual_risk" ||
				(op === "resolve_user_decision" && decisionOp?.resolution === "accept_verifier_dispute") ||
				op === "approve_breaking_intent_revision"
			) stagePlanningArtifactTransition(this.cwd, result.record);
		} catch (error) {
			if (stagedSnapshot) {
				const current = await readTaskRecordRaw(this.cwd, taskId);
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
		return executeOrdinaryKernelOperation({ root: ctx.cwd, taskId: input.taskId, operation: input.operation, app });
	}

	/**
	 * Build the exact native-gate input without accepting, declining or applying
	 * the operation. Hook-based Hosts use this instead of running a second,
	 * deliberately-cancelled authorization implementation. Breaking revisions
	 * still roll their staged sidecar back in the ordinary gate error path.
	 *
	 * It swaps the instance's confirmation port for the duration of `run`, so it
	 * is only safe on a runtime that serves one call at a time (the Hook builds a
	 * fresh one per preview); concurrent calls on a shared instance are refused.
	 */
	private previewing = false;

	private async previewConfirmation(run: () => Promise<unknown>): Promise<NativeConfirmationInput | null> {
		if (this.previewing) throw new Error("a confirmation preview is already running on this runtime");
		this.previewing = true;
		const previous = this.requestConfirmation;
		this.requestConfirmation = async (input) => { throw new ConfirmationPreviewSignal(input); };
		try {
			await run();
			return null;
		} catch (error) {
			if (error instanceof ConfirmationPreviewSignal) return error.input;
			throw error;
		} finally {
			this.requestConfirmation = previous;
			this.previewing = false;
		}
	}

	async previewAuthorization(taskId: string, operation: string, meta: ToolMeta, extra: Record<string, unknown> = {}) {
		return this.previewConfirmation(() => this.authorize(taskId, operation, meta, extra));
	}

	async previewEnrollment(taskId: string, meta: ToolMeta) {
		return this.previewConfirmation(() => this.enroll(taskId, meta));
	}
}

export interface ToolMeta {
	sessionId: string;
	toolCallId: string;
	taskId: string;
	initiativeSlug?: string;
	/** ADR 0025: the live entry token the phase entry hook admitted for this call. */
	entryToken?: string;
	requiresUserInteraction?: boolean;
	permissionMode?: PermissionMode;
	interactive?: boolean;
	signal?: AbortSignal;
	/** Absolute workspace resolved for this call from Host metadata or MCP roots. */
	workspace?: string;
	/** The admission the Host correlated with this exact call, when it is not the display call id. */
	admissionId?: string;
}