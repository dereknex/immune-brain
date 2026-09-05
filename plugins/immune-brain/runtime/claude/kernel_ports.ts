import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
	AssuranceCoordinator,
	type AssuranceCoordinatorPorts,
	type AssuranceSubmitReviewResult,
	type AssuranceVerdict,
	type HostContext,
	type SnapshotDescriptor,
} from "../assurance/coordinator";
import {
	assertRunnerCompatible,
	findingsDigest,
	resolveBunRunner,
	type FrozenRunner,
	type VerificationDescriptor,
} from "../assurance/verification";
import {
	captureReviewBundle,
	captureReviewManifest,
	ensureReviewRevision,
	writeNativeReviewEvidence,
} from "../assurance/review_evidence";
import { parseVerificationDescriptor } from "../verification_descriptor";
import { projectAssurance, type AssuranceProjectionResult } from "../kernel/assurance_projection";
import type { TaskRecord } from "../kernel/types";
import { readTaskRecord, readTaskRecordRaw } from "../kernel/storage";
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
import { enrollCanaryTask, runEnrollmentRehearsal } from "../kernel/enrollment";
import { reconcileKernelAuthority, repairKernelAuthority } from "../kernel/storage";
import { preparePiCanary, revalidatePiCanary } from "../kernel/pi_canary_prepare";
import { runDeterministicQa } from "../assurance/qa";
import { taskDiffIdentity, taskRevisionIdentity } from "../workspace_scope";
import {
	confirmationRef,
	enrollmentNonce,
	evaluateNativeGate,
	isPrivilegedOperation,
	NativeAuthorityError,
	type NativeConfirmationPort,
} from "./interaction";
import { ClaudeReviewHost, FileHookEventLog, type ClaudeHookEvent } from "./review_host";
import { probeHost, type PermissionMode } from "./capability";

export function diffSnapshotOf(root: string, record: TaskRecord): {
	diff_hash: string;
	changed_paths: readonly string[];
} {
	if (record.contract === "assurance_kernel/task_record/v4") {
		if (!record.git_base_head) throw new Error("TaskRecord v4 is missing git_base_head");
		return taskRevisionIdentity(root, record.intent_snapshot.scope_hint, record.git_base_head);
	}
	return taskDiffIdentity(root, record.intent_snapshot.scope_hint);
}

export function diffHashOf(root: string, record: TaskRecord): string {
	return diffSnapshotOf(root, record).diff_hash;
}

/**
 * Read the TaskIntent through the TaskRecord's `intent_ref.path`.
 *
 * `freeze_artifacts` relocates the sidecar from `docs/plans/<task-id>.intent.json`
 * into `docs/plans/archive/`, so every post-freeze read — QA settlement included —
 * must follow the record instead of the pre-freeze default path. The Pi adapter
 * resolves the same way in its own runtime stub; both Hosts must stay in step.
 */
function readTaskIntentForRecord(root: string, taskId: string) {
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
		if (observed.release) return coordinator.abandonReview(taskId, observed.reason);
		return { state: "blocked", reason: observed.reason };
	}
	const parentJson = extractVerdictJson(verdictInput);
	const receiptJson = extractVerdictJson(observed.receipt.result);
	if (parentJson && receiptJson && verdictFingerprint(parentJson) !== verdictFingerprint(receiptJson)) {
		return { state: "blocked", reason: "parent verdict does not match reviewer receipt" };
	}
	if (parentJson && !receiptJson) {
		return { state: "blocked", reason: "reviewer receipt is not a valid verdict" };
	}
	return coordinator.submitReview(taskId, ctx, verdictInput);
}

function assertProjectionBinding(before: AssuranceProjectionResult, after: AssuranceProjectionResult, allowDiffChange = false): void {
	const fields = (allowDiffChange
		? ["record_revision", "workspace_revision", "intent_revision", "intent_content_hash"]
		: ["record_revision", "workspace_revision", "intent_revision", "intent_content_hash", "diff_hash"]) as const;
	if (before.error || !before.claim || after.error || !after.claim || before.claim.task_id !== after.claim.task_id
		|| fields.some((field) => before.projection[field] !== after.projection[field])) {
		throw new Error("Task changed after native confirmation; authority aborted before capability issuance");
	}
}

function qaOutcomes(record: { attestations: Array<{ kind: string; acceptance_results: Array<{ acceptance_id: string; status: "passed" | "failed" | "blocked"; summary: string }> }> }) {
	return Object.fromEntries(
		record.attestations.filter((item) => item.kind === "qa").flatMap((item) => item.acceptance_results)
			.map((result) => [result.acceptance_id, { status: result.status, summary: result.summary }]),
	);
}

async function buildAssuranceSnapshot(
	root: string,
	taskId: string,
	role: "qa" | "review",
	projection: AssuranceProjectionResult,
	runner: FrozenRunner,
) {
	const record = await readTaskRecord(root, taskId);
	if (!record.record || record.revision !== projection.projection.record_revision) throw new Error("TaskRecord changed before assurance snapshot capture");
	const intent = record.record.intent_snapshot;
	const descriptors = new Map<string, VerificationDescriptor>();
	for (const item of intent.acceptance) {
		const descriptor = parseVerificationDescriptor(item.verification);
		assertRunnerCompatible(descriptor, runner);
		descriptors.set(item.id, descriptor);
	}
	const v4 = record.record.contract === "assurance_kernel/task_record/v4";
	const reviewBundle = role === "review" && !v4
		? captureReviewBundle(root, intent.scope_hint, projection.projection.diff_hash, qaOutcomes(record.record))
		: null;
	const reviewManifest = role === "review" && v4
		? captureReviewManifest(root, {
			taskId,
			baseHead: record.record.git_base_head,
			scopeHint: intent.scope_hint,
			expectedDiffHash: projection.projection.diff_hash,
			intentRevision: projection.projection.intent_revision,
			intentContentHash: projection.projection.intent_content_hash,
			recordRevision: projection.projection.record_revision,
			workspaceRevision: projection.projection.workspace_revision,
			lifecycle: projection.projection.lifecycle,
			artifactState: projection.projection.artifact_state,
			risk: intent.risk,
			outcomes: qaOutcomes(record.record),
		})
		: null;
	const dirtyFiles = reviewManifest ? Object.keys(reviewManifest.changed_paths) : reviewBundle ? Object.keys(reviewBundle.dirty_files) : [];
	const snapshot: SnapshotDescriptor = {
		contract: "assurance_kernel/assurance_snapshot/v2",
		task_id: taskId,
		role,
		record_revision: projection.projection.record_revision,
		workspace_revision: projection.projection.workspace_revision,
		intent_revision: projection.projection.intent_revision,
		intent_content_hash: projection.projection.intent_content_hash,
		diff_hash: projection.projection.diff_hash,
		lifecycle: projection.projection.lifecycle,
		artifact_state: projection.projection.artifact_state,
		risk: intent.risk,
		fresh_acceptance_ids: projection.projection.fresh_acceptance_ids,
		missing_acceptance_ids: projection.projection.missing_acceptance_ids,
		stale_attestation_ids: projection.projection.stale_attestation_ids,
		acceptance: intent.acceptance,
		dirty_files: dirtyFiles,
		review_bundle_digest: reviewManifest?.manifest_digest ?? reviewBundle?.bundle_digest ?? null,
		root,
		...(reviewManifest
			? {
				review_revision: {
					contract: "assurance_kernel/review_revision_identity/v1",
					base_head: reviewManifest.base_head,
					review_commit: reviewManifest.review_commit,
					review_tree: reviewManifest.review_tree,
					manifest_digest: reviewManifest.manifest_digest,
				},
			}
			: {}),
	};
	return { snapshot, descriptors, reviewBundle, reviewManifest };
}

function stagePlanningArtifactTransition(root: string, record: { intent_ref: { path: string }; intent_snapshot: { scope_hint: string[] } }): void {
	const intentActive = record.intent_ref.path.replace("docs/plans/archive/", "docs/plans/");
	const intentArchive = intentActive.replace("docs/plans/", "docs/plans/archive/");
	const specActive = record.intent_snapshot.scope_hint.find((path) =>
		/^docs\/specs\/(?!archive\/)[^/]+\.spec\.md$/.test(path)
		&& record.intent_snapshot.scope_hint.includes(path.replace("docs/specs/", "docs/specs/archive/")),
	);
	const candidates = [
		intentActive,
		intentArchive,
		...(specActive ? [specActive, specActive.replace("docs/specs/", "docs/specs/archive/")] : []),
	];
	const paths = candidates.filter((path) => existsSync(join(root, path)) || execFileSync("git", ["ls-files", "--cached", "--", path], { cwd: root, encoding: "utf8" }).trim().length > 0);
	if (paths.length === 0) return;
	execFileSync("git", ["add", "--", ...paths], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

async function mintCapability(
	registry: MutationAuthorityRegistry,
	input: {
		authority_kind: "review" | "qa" | "user";
		task_id: string;
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
		action_digest: digestOfAction(action),
		expected_record_hash: input.expected_record_hash,
		intent_revision: input.intent_revision,
		intent_content_hash: input.intent_content_hash,
		diff_hash: input.diff_hash,
		actor_id: input.actor_id,
		confirmation_ref: input.confirmation_ref,
		expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
		findings_digest: input.action_kind === "request_rework"
			? await findingsDigest((input.findings as Array<{ id: string; kind: string; acceptance_id: string | null; summary: string }>))
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
	ports?: AssuranceCoordinatorPorts;
	interactive?: boolean;
	permissionMode?: PermissionMode;
	requestConfirmation?: NativeConfirmationPort;
}

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
	private app: ReturnType<typeof createCanaryApplication> | null = null;

	constructor(options: ClaudeRuntimeOptions) {
		this.cwd = options.cwd;
		this.env = options.env ?? process.env;
		this.interactive = options.interactive ?? true;
		this.requestConfirmation = options.requestConfirmation;
		this.host = options.host ?? new ClaudeReviewHost(new FileHookEventLog());
		if (options.ports) {
			this.coordinator = new AssuranceCoordinator({ ...options.ports, host: this.host });
			return;
		}
		this.coordinator = new AssuranceCoordinator(this.createKernelPorts());
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

	private createKernelPorts(): AssuranceCoordinatorPorts {
		return {
			host: this.host,
			projectTask: (root, taskId) => projectAssurance(root, taskId, diffSnapshotOf),
			readTaskRecord: (root, taskId) => readTaskRecord(root, taskId),
			readTaskIntent: (root, taskId) => readTaskIntentForRecord(root, taskId),
			frozenRunner: async () => resolveBunRunner(),
			buildAssurance: (root, taskId, role, projection, runner) => buildAssuranceSnapshot(root, taskId, role, projection, runner),
			ensureReviewRevision: async (root, taskId, projection) => {
				const current = await readTaskRecord(root, taskId);
				if (!current.record) throw new Error(`task ${taskId} has no TaskRecord`);
				if (current.record.contract !== "assurance_kernel/task_record/v4") return null;
				return ensureReviewRevision(root, {
					taskId,
					baseHead: current.record.git_base_head,
					scopeHint: current.record.intent_snapshot.scope_hint,
					expectedDiffHash: projection.projection.diff_hash,
				});
			},
			runQa: (snapshot, descriptors, runner, options) => runDeterministicQa(snapshot, descriptors, runner, options),
			writeReviewEvidence: (input) => writeNativeReviewEvidence(input.evidence),
			applyVerdict: (ctx, input) => this.applyVerdict(ctx, input),
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
	} = {}): Promise<{ confirmation_ref: string }> {
		throwIfCancelled(meta.signal);
		const probe = probeHost(this.env, process.platform, this.hostVersion);
		if (!probe.ok) throw new NativeAuthorityError("unsupported_host", probe.reason);
		const interactive = meta.interactive ?? this.interactive;
		if (!interactive) throw new NativeAuthorityError("unsupported_host", "interactive MCP elicitation is unavailable");
		if (!isPrivilegedOperation(operation)) throw new Error(`unsupported native operation ${operation}`);
		if (!this.requestConfirmation) throw new NativeAuthorityError("interaction_not_opened", "native confirmation port is unavailable");
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
		const preparation = await preparePiCanary(this.cwd, { task_id: taskId, now });
		const intent = await readTaskIntentForRecord(this.cwd, taskId);
		const gate = await this.gate("enroll", { ...meta, taskId }, {
			risk: intent.intent.risk,
			intentRevision: preparation.intent?.revision,
			intentContentHash: preparation.intent?.content_hash,
			bindingDigest: preparation.digest,
		});
		const { unchanged } = await revalidatePiCanary(this.cwd, { task_id: taskId, now }, preparation);
		if (!unchanged) throw new NativeAuthorityError("workspace_changed", "workspace changed after native confirmation");
		if (!preparation.intent) throw new Error("enrollment requires a readable TaskIntent");
		throwIfCancelled(meta.signal);
		const nonce = enrollmentNonce();
		const binding: EnrollmentCapabilityBinding = {
			task_id: taskId,
			intent_path: preparation.intent.path,
			intent_revision: preparation.intent.revision,
			intent_content_hash: preparation.intent.content_hash,
			preparation_digest: preparation.digest,
			actor_id: "user",
			confirmation_ref: gate.confirmation_ref,
			expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
			nonce,
		};
		const capability = this.enrollmentRegistry.issue(binding);
		const input = {
			task_id: taskId,
			intent_path: binding.intent_path,
			intent_revision: binding.intent_revision,
			preparation_digest: binding.preparation_digest,
			capability,
			capability_binding: binding,
			now,
		};
		const rehearsal = runEnrollmentRehearsal(this.cwd, input, capability, this.enrollmentRegistry);
		if (!rehearsal.rehearsed || rehearsal.evidence.outcome !== "ready") {
			throw new Error(`Kernel enrollment rehearsal failed: ${rehearsal.evidence.blockers.join("; ")}`);
		}
		return enrollCanaryTask(this.cwd, input, this.enrollmentRegistry);
	}

	async advance(taskId: string, signal?: AbortSignal) {
		return this.coordinator.advance(taskId, { cwd: this.cwd }, signal);
	}

	async submitReview(taskId: string, verdictInput: unknown) {
		return submitClaudeReview(this.host, this.coordinator, { cwd: this.cwd }, taskId, verdictInput);
	}

	async authorize(taskId: string, operation: string, meta: ToolMeta, extra: Record<string, unknown> = {}) {
		if (operation === "repair_authority_state") {
			const authority = reconcileKernelAuthority(this.cwd, taskId);
			if (authority.state !== "repairable_stale_claim" || authority.owner_task_id !== taskId) {
				throw new Error(authority.diagnostic ?? "authority repair requires a repairable stale claim");
			}
			return repairKernelAuthority(this.cwd, taskId, authority.revision);
		}
		if (!isPrivilegedOperation(operation) && operation !== "request_authorization") throw new Error(`unsupported privileged operation ${operation}`);
		let op = operation;
		let decisionOp: { finding_id: string; resolution: string } | undefined;
		const projection = await this.status(taskId);
		if (projection.error || !projection.claim) throw new Error(projection.error ?? "no active backend claim");
		// Kernel projection is the sole source of authorization readiness:
		// request_authorization submits the exact operation the projection
		// derives, including the single bound user-decision resolution.
		const readiness = projection.projection.authorization;
		if (operation === "request_authorization") {
			if (readiness.state === "resolve_user_decision") {
				const record = await readTaskRecord(this.cwd, taskId);
				const open = (record.record?.findings ?? []).filter(
					(finding) => finding.kind === "unresolved_user_decision" && finding.status === "open",
				);
				if (open.length !== 1) throw new Error(`resolve-user-decision requires exactly one open user decision; found ${open.length}`);
				op = "resolve_user_decision";
				decisionOp = { finding_id: open[0].id, resolution: `resume after literal-user decision: ${open[0].summary}` };
			} else {
				throw new Error(readiness.blocked ?? "no unique host-derived authorization operation");
			}
		}
		const priorIntent = await readTaskIntentForRecord(this.cwd, taskId);
		const now = new Date().toISOString();
		const actorId = "user";
		const nextIntent = extra.next_intent ? await parseTaskIntentV1(extra.next_intent) : undefined;
		if (op === "approve_breaking_intent_revision" && !nextIntent) throw new Error("approve_breaking_intent_revision requires next_intent");
		const nextIntentHash = nextIntent ? canonicalIntentHash(nextIntent) : undefined;
		const nextIntentRef = nextIntent
			? { path: `docs/plans/${nextIntent.task_id}.intent.json`, content_hash: nextIntentHash! }
			: undefined;
		const sidecar = nextIntent ? join(this.cwd, priorIntent.intent_ref.path) : undefined;
		const priorBytes = sidecar ? readFileSync(sidecar) : undefined;
		const priorIndexState = sidecar
			? execFileSync("git", ["ls-files", "--stage", "-z", "--", priorIntent.intent_ref.path], {
				cwd: this.cwd,
				stdio: ["ignore", "pipe", "pipe"],
			})
			: undefined;
		const restoreStagedIntent = (): void => {
			if (!sidecar || !priorBytes || !priorIndexState) return;
			writeFileSync(sidecar, priorBytes);
			execFileSync("git", ["update-index", "--force-remove", "--", priorIntent.intent_ref.path], {
				cwd: this.cwd,
				stdio: ["ignore", "pipe", "pipe"],
			});
			if (priorIndexState.length > 0) {
				execFileSync("git", ["update-index", "-z", "--index-info"], {
					cwd: this.cwd,
					input: priorIndexState,
					stdio: ["pipe", "ignore", "pipe"],
				});
			}
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
			if (sidecar && priorBytes && priorIndexState) {
				const current = await readTaskRecord(this.cwd, taskId);
				if (current.record?.intent_snapshot.revision === priorIntent.intent.revision) {
					restoreStagedIntent();
				}
			}
			throw error;
		}
		const { registry, app } = this.authority();
		const confirmation = gate.confirmation_ref;
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
				action_kind: op,
				expected_record_hash: capabilityProjection.projection.record_revision,
				intent_revision: nextIntent?.revision ?? capabilityProjection.projection.intent_revision,
				intent_content_hash: nextIntentHash ?? capabilityProjection.projection.intent_content_hash,
				diff_hash: operationDiffHash,
				actor_id: actorId,
				now,
				confirmation_ref: confirmation,
				...(op === "approve_breaking_intent_revision" ? { next_intent: nextIntent, next_intent_ref: nextIntentRef } : {}),
				...(op === "resolve_user_decision" && decisionOp ? decisionOp : {}),
				...(op === "stop" ? { reason: extra.reason ?? "user stop" } : {}),
			});
			throwIfCancelled(meta.signal);
			const result = app.execute({
				root: this.cwd,
				task_id: taskId,
				operation: {
					op,
					capability,
					actor_id: actorId,
					...(op === "approve_breaking_intent_revision" ? { next_intent: nextIntent, next_intent_ref: nextIntentRef } : {}),
					...(op === "resolve_user_decision" && decisionOp ? decisionOp : {}),
					...(op === "stop" ? { reason: extra.reason ?? "user stop" } : {}),
				} as never,
				prior_intent_token: priorIntent.token,
				diffProvider: diffSnapshotOf,
				now,
			});
			if (op === "stop" || op === "approve_breaking_intent_revision") stagePlanningArtifactTransition(this.cwd, result.record);
			return result;
		} catch (error) {
			if (sidecar && priorBytes && priorIndexState) {
				const current = await readTaskRecord(this.cwd, taskId);
				if (current.record?.intent_snapshot.revision === priorIntent.intent.revision) {
					restoreStagedIntent();
				}
			}
			throw error;
		}
	}

	private async applyVerdict(
		ctx: HostContext,
		input: {
			taskId: string;
			snapshot: SnapshotDescriptor;
			verdict: AssuranceVerdict;
			invocation: { /* token */ };
			actorId: string;
			hooks?: { beforeCommit?: () => Promise<void>; onCommit?: () => void; afterCommit?: () => Promise<void> };
		},
	): Promise<void> {
		const { registry, app } = await this.authority();
		const priorIntentToken = (await readTaskIntentForRecord(ctx.cwd, input.taskId)).token;
		const now = new Date().toISOString();
		const commitAndApply = async <T>(apply: () => Promise<T>): Promise<T> => {
			this.coordinator.commitInvocation(input.invocation as never);
			const settlement = apply();
			input.hooks?.onCommit?.();
			const result = await settlement;
			await input.hooks?.afterCommit?.();
			return result;
		};
		if (input.verdict.decision === "rework") {
			const findings = input.verdict.findings!.map((finding) => ({
				id: finding.id,
				kind: finding.kind,
				status: "open",
				acceptance_id: finding.acceptance_id,
				source: "review",
				review_round: null,
				summary: finding.summary,
			}));
			const capability = await mintCapability(registry, {
				authority_kind: input.snapshot.role,
				task_id: input.taskId,
				action_kind: "request_rework",
				expected_record_hash: input.snapshot.record_revision,
				intent_revision: input.snapshot.intent_revision,
				intent_content_hash: input.snapshot.intent_content_hash,
				diff_hash: input.snapshot.diff_hash,
				actor_id: input.actorId,
				findings,
				now,
				confirmation_ref: `claude:${input.actorId}`,
			});
			await input.hooks?.beforeCommit?.();
			const result = await commitAndApply(async () => app.execute({
				root: ctx.cwd,
				task_id: input.taskId,
				operation: { op: "request_rework", capability, findings: findings as never[], actor_id: input.actorId },
				prior_intent_token: priorIntentToken,
				diffProvider: diffSnapshotOf,
				now,
			}));
			stagePlanningArtifactTransition(ctx.cwd, result.record);
			return;
		}
		const approval = {
			id: `approval-${input.snapshot.role}-${randomUUID().slice(0, 8)}`,
			kind: input.snapshot.role === "qa" ? "qa" : "review",
			authority_role: input.snapshot.role === "qa" ? "qa" : "reviewer",
			task_revision: input.snapshot.intent_revision,
			intent_content_hash: input.snapshot.intent_content_hash,
			diff_hash: input.snapshot.diff_hash,
			actor_id: input.actorId,
			summary: input.verdict.approval!.summary,
			...(input.snapshot.role === "review" && input.snapshot.review_revision ? { review_revision: input.snapshot.review_revision } : {}),
		};
		const capability = await mintCapability(registry, {
			authority_kind: input.snapshot.role,
			task_id: input.taskId,
			action_kind: "record_approval",
			expected_record_hash: input.snapshot.record_revision,
			intent_revision: input.snapshot.intent_revision,
			intent_content_hash: input.snapshot.intent_content_hash,
			diff_hash: input.snapshot.diff_hash,
			actor_id: input.actorId,
			approval,
			now,
			confirmation_ref: `claude:${input.actorId}`,
		});
		await input.hooks?.beforeCommit?.();
		await commitAndApply(async () => app.execute({
			root: ctx.cwd,
			task_id: input.taskId,
			operation: { op: "record_approval", capability, approval, actor_id: input.actorId },
			prior_intent_token: priorIntentToken,
			diffProvider: diffSnapshotOf,
			now,
		}));
	}

	private async executeOrdinary(ctx: HostContext, input: { taskId: string; operation: { op: string; actor_id: string; next_intent?: unknown } }) {
		const { app } = await this.authority();
		const operation = input.operation.op === "revise_intent"
			? { ...input.operation, next_intent: await parseTaskIntentV1(input.operation.next_intent) }
			: input.operation;
		const priorIntent = await readTaskIntentForRecord(ctx.cwd, input.taskId);
		const sidecar = join(ctx.cwd, priorIntent.intent_ref.path);
		const priorBytes = operation.op === "revise_intent" ? readFileSync(sidecar) : null;
		try {
			if (priorBytes) writeFileSync(sidecar, `${JSON.stringify(operation.next_intent, null, 2)}\n`);
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
			if (priorBytes) {
				const current = await readTaskRecord(ctx.cwd, input.taskId);
				if (current.record?.intent_snapshot.revision === priorIntent.intent.revision) writeFileSync(sidecar, priorBytes);
			}
			throw error;
		}
	}
}

export interface ToolMeta {
	sessionId: string;
	toolCallId: string;
	taskId: string;
	requiresUserInteraction?: boolean;
	permissionMode?: PermissionMode;
	interactive?: boolean;
	signal?: AbortSignal;
}