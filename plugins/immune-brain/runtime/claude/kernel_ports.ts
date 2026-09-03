import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
	AssuranceCoordinator,
	snapshotDigest,
	type AssuranceCoordinatorPorts,
	type AssuranceVerdict,
	type HostContext,
	type SnapshotDescriptor,
} from "../assurance/coordinator";
import {
	assertRunnerCompatible,
	findingsDigest,
	resolveBunRunner,
	runFixedVerification,
	VerificationAbortedError,
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
import { readTaskRecord } from "../kernel/storage";
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
import { qaFindingId } from "../assurance/qa_findings";
import { taskDiffHash, taskRevisionDiffHash } from "../workspace_scope";
import { confirmationRef, enrollmentNonce, evaluateNativeGate, isPrivilegedOperation, type NativeDecision } from "./interaction";
import { ClaudeReviewHost, FileHookEventLog, type ClaudeHookEvent } from "./review_host";
import { probeHost, type PermissionMode } from "./capability";

export function diffHashOf(root: string, record: { contract?: string; git_base_head?: string; intent_snapshot: { scope_hint: string[] } }): string {
	if (record.contract === "assurance_kernel/task_record/v4") {
		if (!record.git_base_head) throw new Error("TaskRecord v4 is missing git_base_head");
		return taskRevisionDiffHash(root, record.intent_snapshot.scope_hint, record.git_base_head);
	}
	return taskDiffHash(root, record.intent_snapshot.scope_hint);
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

export async function runDeterministicQa(
	snapshot: SnapshotDescriptor,
	descriptors: Map<string, VerificationDescriptor>,
	runner: FrozenRunner,
	options: { signal?: AbortSignal; onProgress?: (progress: { index: number; total: number; acceptance_id: string; phase: "running" | "passed" | "failed"; elapsed_ms: number }) => void } = {},
): Promise<AssuranceVerdict> {
	if (snapshot.role !== "qa") throw new Error("deterministic QA requires qa role");
	if (options.signal?.aborted) throw new VerificationAbortedError();
	const findings: NonNullable<AssuranceVerdict["findings"]> = [];
	for (const [offset, item] of snapshot.acceptance.entries()) {
		if (options.signal?.aborted) throw new VerificationAbortedError();
		const descriptor = descriptors.get(item.id);
		if (!descriptor) throw new Error(`verification descriptor missing for ${item.id}`);
		const startedAt = Date.now();
		options.onProgress?.({ index: offset + 1, total: snapshot.acceptance.length, acceptance_id: item.id, phase: "running", elapsed_ms: 0 });
		const result = await runFixedVerification(snapshot.root, descriptor, runner, { signal: options.signal });
		const failed = result.exit_code !== 0 || result.timed_out;
		options.onProgress?.({ index: offset + 1, total: snapshot.acceptance.length, acceptance_id: item.id, phase: failed ? "failed" : "passed", elapsed_ms: Date.now() - startedAt });
		if (failed) {
			findings.push({
				id: qaFindingId(item.id, snapshotDigest(snapshot)),
				kind: "blocking",
				acceptance_id: item.id,
				summary: `verification failed (exit ${result.exit_code}${result.timed_out ? ", timed out" : ""})`,
				findings_digest: "",
			});
		}
	}
	if (findings.length > 0) {
		return { contract: "assurance_kernel/assurance_verdict/v2", role: "qa", task_id: snapshot.task_id, snapshot_digest: snapshotDigest(snapshot), decision: "rework", findings };
	}
	return {
		contract: "assurance_kernel/assurance_verdict/v2",
		role: "qa",
		task_id: snapshot.task_id,
		snapshot_digest: snapshotDigest(snapshot),
		decision: "pass",
		approval: { kind: "qa", authority_role: "qa", summary: `all ${snapshot.acceptance.length} fixed verification descriptor(s) passed` },
	};
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

export interface ClaudeRuntimeOptions {
	cwd: string;
	env?: Record<string, string | undefined>;
	host?: ClaudeReviewHost;
	ports?: AssuranceCoordinatorPorts;
	interactive?: boolean;
	permissionMode?: PermissionMode;
	decisions?: Map<string, NativeDecision>;
}

export class ClaudeRuntime {
	readonly host: ClaudeReviewHost;
	readonly coordinator: AssuranceCoordinator;
	private readonly cwd: string;
	private readonly env: Record<string, string | undefined>;
	private readonly interactive: boolean;
	private readonly permissionMode: PermissionMode;
	private readonly decisions: Map<string, NativeDecision>;
	private hostVersion: string | undefined;
	private mutationRegistry: MutationAuthorityRegistry | null = null;
	private enrollmentRegistry = createEnrollmentAuthorityRegistry();
	private app: ReturnType<typeof createCanaryApplication> | null = null;

	constructor(options: ClaudeRuntimeOptions) {
		this.cwd = options.cwd;
		this.env = options.env ?? process.env;
		this.interactive = options.interactive ?? true;
		this.permissionMode = options.permissionMode ?? "manual";
		this.decisions = options.decisions ?? new Map();
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

	async shutdown(): Promise<void> {
		await this.coordinator.onSessionShutdown();
	}

	private createKernelPorts(): AssuranceCoordinatorPorts {
		return {
			host: this.host,
			projectTask: (root, taskId) => projectAssurance(root, taskId, (cwd, record) => diffHashOf(cwd, record as never)),
			readTaskRecord: (root, taskId) => readTaskRecord(root, taskId),
			readTaskIntent: (root, taskId) => readTaskIntent(root, taskId),
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

	private rejectBeforePreparation(operation: string, meta: ToolMeta): void {
		// Zero-mutation fast path only: a configured deny/cancel rejects before
		// any workspace preparation. The live accept elicitation is requested
		// and consumed only after preparation computes the binding digests, so
		// native confirmation is always bound to hashes computed before it.
		const configured = this.decisions.get(operation) ?? meta.decision;
		if (configured === "deny" || configured === "cancel") this.gate(operation, meta);
	}

	private gate(operation: string, meta: ToolMeta, binding: {
		intentRevision?: number;
		intentContentHash?: string;
		bindingDigest?: string;
	} = {}): { confirmation_ref: string } {
		const probe = probeHost(this.env, process.platform, this.hostVersion);
		if (!probe.ok) throw new Error(probe.reason);
		const requiresUserInteraction = Boolean(meta.requiresUserInteraction);
		const permissionMode = meta.permissionMode ?? this.permissionMode;
		const configuredDecision = this.decisions.get(operation) ?? meta.decision;
		const decision = configuredDecision ?? (
			isPrivilegedOperation(operation)
				&& Boolean(meta.interactive ?? this.interactive)
				&& requiresUserInteraction
				&& permissionMode !== "dontAsk"
				? this.host.takeConfirmation(meta.sessionId, meta.toolCallId)
				: undefined
		);
		const gate = evaluateNativeGate({
			operation,
			permissionMode,
			requiresUserInteraction,
			interactive: meta.interactive ?? this.interactive,
			decision,
		});
		if (!gate.ok) throw new Error(gate.reason);
		return {
			confirmation_ref: confirmationRef({
				sessionId: meta.sessionId,
				toolCallId: meta.toolCallId,
				operation,
				taskId: meta.taskId,
				...binding,
			}),
		};
	}

	async status(taskId: string) {
		return projectAssurance(this.cwd, taskId, (cwd, record) => diffHashOf(cwd, record as never));
	}

	async enroll(taskId: string, meta: ToolMeta) {
		this.rejectBeforePreparation("enroll", { ...meta, taskId });
		const now = new Date().toISOString();
		const preparation = await preparePiCanary(this.cwd, { task_id: taskId, now });
		const gate = this.gate("enroll", { ...meta, taskId }, {
			intentRevision: preparation.intent?.revision,
			intentContentHash: preparation.intent?.content_hash,
			bindingDigest: preparation.digest,
		});
		const { unchanged } = await revalidatePiCanary(this.cwd, { task_id: taskId, now }, preparation);
		if (!unchanged) throw new Error("Workspace changed after confirmation; enrollment aborted before authority");
		if (!preparation.intent) throw new Error("enrollment requires a readable TaskIntent");
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

	async submitReview(taskId: string) {
		return this.coordinator.submitReview(taskId, { cwd: this.cwd });
	}

	async authorize(taskId: string, operation: string, meta: ToolMeta, extra: Record<string, unknown> = {}) {
		if (!isPrivilegedOperation(operation) && operation !== "request_authorization") throw new Error(`unsupported privileged operation ${operation}`);
		this.rejectBeforePreparation(operation, { ...meta, taskId });
		if (operation === "repair_authority_state") {
			const authority = reconcileKernelAuthority(this.cwd, taskId);
			if (authority.state !== "repairable_stale_claim" || authority.owner_task_id !== taskId) {
				throw new Error(authority.diagnostic ?? "authority repair requires a repairable stale claim");
			}
			const gate = this.gate(operation, { ...meta, taskId }, { bindingDigest: `repair:${authority.revision}` });
			const current = reconcileKernelAuthority(this.cwd, taskId);
			if (current.state !== authority.state || current.owner_task_id !== authority.owner_task_id || current.revision !== authority.revision) {
				throw new Error("authority changed after native confirmation; repair aborted before capability issuance");
			}
			return repairKernelAuthority(this.cwd, taskId, current.revision);
		}
		let op = operation === "request_authorization" ? "record_user_approval" : operation;
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
			} else if (readiness.state !== "record_user_approval") {
				throw new Error(readiness.blocked ?? "no unique host-derived authorization operation");
			}
		}
		const priorIntent = await readTaskIntent(this.cwd, taskId);
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
				if (!preparedRecord.record) throw new Error("TaskRecord changed before the breaking revision digest");
				preparedDiffHash = diffHashOf(this.cwd, preparedRecord.record);
			}
			const preparedProjection = await this.status(taskId);
			assertProjectionBinding(projection, preparedProjection, Boolean(nextIntent));
			if (preparedProjection.projection.diff_hash !== preparedDiffHash) {
				throw new Error("Workspace changed while preparing the authority digest");
			}
			gate = this.gate(operation, { ...meta, taskId }, {
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
		const approval = op === "record_user_approval"
			? {
				id: `approval-user-${randomUUID().slice(0, 8)}`,
				kind: "user" as const,
				authority_role: "user" as const,
				task_revision: projection.projection.intent_revision,
				intent_content_hash: projection.projection.intent_content_hash,
				diff_hash: projection.projection.diff_hash,
				actor_id: actorId,
				summary: "literal user approval",
			}
			: undefined;
		try {
			const capabilityProjection = await this.status(taskId);
			assertProjectionBinding(projection, capabilityProjection, Boolean(nextIntent));
			const operationDiffHash = capabilityProjection.projection.diff_hash;
			if (nextIntent && operationDiffHash !== preparedDiffHash) {
				throw new Error("Workspace changed after native confirmation; authority aborted before capability issuance");
			}
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
				...(approval ? { approval } : {}),
				...(op === "approve_breaking_intent_revision" ? { next_intent: nextIntent, next_intent_ref: nextIntentRef } : {}),
				...(op === "resolve_user_decision" && decisionOp ? decisionOp : {}),
				...(op === "stop" ? { reason: extra.reason ?? "user stop" } : {}),
			});
			const result = app.execute({
				root: this.cwd,
				task_id: taskId,
				operation: {
					op,
					capability,
					actor_id: actorId,
					...(approval ? { approval } : {}),
					...(op === "approve_breaking_intent_revision" ? { next_intent: nextIntent, next_intent_ref: nextIntentRef } : {}),
					...(op === "resolve_user_decision" && decisionOp ? decisionOp : {}),
					...(op === "stop" ? { reason: extra.reason ?? "user stop" } : {}),
				} as never,
				prior_intent_token: priorIntent.token,
				diffProvider: (root, record) => diffHashOf(root, record as never),
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
		const priorIntentToken = (await readTaskIntent(ctx.cwd, input.taskId)).token;
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
				diffProvider: (root, record) => diffHashOf(root, record as never),
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
			diffProvider: (root, record) => diffHashOf(root, record as never),
			now,
		}));
	}

	private async executeOrdinary(ctx: HostContext, input: { taskId: string; operation: { op: string; actor_id: string; next_intent?: unknown } }) {
		const { app } = await this.authority();
		const operation = input.operation.op === "revise_intent"
			? { ...input.operation, next_intent: await parseTaskIntentV1(input.operation.next_intent) }
			: input.operation;
		const priorIntent = await readTaskIntent(ctx.cwd, input.taskId);
		const sidecar = join(ctx.cwd, priorIntent.intent_ref.path);
		const priorBytes = operation.op === "revise_intent" ? readFileSync(sidecar) : null;
		try {
			if (priorBytes) writeFileSync(sidecar, `${JSON.stringify(operation.next_intent, null, 2)}\n`);
			const result = await app.execute({
				root: ctx.cwd,
				task_id: input.taskId,
				operation: operation as never,
				prior_intent_token: priorIntent.token,
				diffProvider: (root, record) => diffHashOf(root, record as never),
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
	decision?: NativeDecision;
	signal?: AbortSignal;
}