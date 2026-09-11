import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import {
	AssuranceCoordinator,
	reviewReworkFindings,
	type AssuranceCoordinatorPorts,
	type AssuranceSubmitReviewResult,
	type AssuranceVerdict,
	type HostContext,
	type SnapshotDescriptor,
} from "../assurance/coordinator";
import {
	assertRunnerCompatible,
	resolveBunRunner,
	type FrozenRunner,
	type VerificationDescriptor,
} from "../assurance/verification";
import {
	captureReviewBundle,
	captureReviewManifest,
	writeNativeReviewEvidence,
	type ReviewRevision,
} from "../assurance/review_evidence";
import { parseVerificationDescriptor } from "../verification_descriptor";
import { projectAssurance, type AssuranceProjection, type AssuranceProjectionResult } from "../kernel/assurance_projection";
import { isTaskRecordV4, type TaskApprovalV2, type TaskFinding, type TaskRecord } from "../kernel/types";
import { findingsDigestV2 } from "../kernel/reducer";
import { readAuditTaskPair, readTaskRecord, readTaskRecordRaw } from "../kernel/storage";
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
import { taskDiffIdentity, taskRevisionIdentity, pathMatchesScope } from "../workspace_scope";
import { projectBatchPlan } from "../unattended/batch_plan";
import {
	startBatch,
	type BatchRunnerKernelPort,
	type BatchRunReport,
} from "../unattended/batch_runner";
import {
	createBatchAuthorityRegistry,
	computeBatchPlanDigest,
	deriveChildEnrollment,
	type BatchAuthorityRegistry,
	type BatchAuthorizationBinding,
} from "../kernel/batch_authority";
import {
	runBatchGitPreflight,
	type BatchRunnerGitPort,
} from "../unattended/batch_git";
import type {
	BatchPlan,
	BatchPlanChild,
	InitiativeObservationReader,
} from "../unattended/types";
import { observeGithubInitiative } from "../github_issue_tracker";
import { readWorkspaceStateRaw } from "../kernel/storage";
import { readBackendClaim } from "../kernel/backend_claim";
import { readGitHead } from "../kernel/pi_canary_prepare";
import {
	confirmationRef,
	enrollmentNonce,
	evaluateNativeGate,
	isPrivilegedOperation,
	NativeAuthorityError,
	type NativeConfirmationPort,
	type PrivilegedOperation,
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
	const parentValid = coordinator.isReviewVerdictValid(taskId, verdictInput);
	if (!parentValid) return coordinator.submitReview(taskId, ctx, verdictInput);
	const receiptValid = coordinator.isReviewVerdictValid(taskId, observed.receipt.result);
	if (!receiptValid) {
		return coordinator.abandonReview(taskId, "reviewer receipt is not a valid verdict");
	}
	const parentJson = extractVerdictJson(verdictInput)!;
	const receiptJson = extractVerdictJson(observed.receipt.result)!;
	if (verdictFingerprint(parentJson) !== verdictFingerprint(receiptJson)) {
		return { state: "blocked", reason: "parent verdict does not match reviewer receipt" };
	}
	return coordinator.submitReview(taskId, ctx, verdictInput);
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

function qaOutcomes(record: { attestations: Array<{ kind: string; acceptance_results: Array<{ acceptance_id: string; status: "passed" | "failed" | "blocked"; summary: string }> }> }) {
	return Object.fromEntries(
		record.attestations.filter((item) => item.kind === "qa").flatMap((item) => item.acceptance_results)
			.map((result) => [result.acceptance_id, { status: result.status, summary: result.summary }]),
	);
}

/**
 * Publish the task-scoped synthetic revision for a v4 record and return the
 * exact identity the Review snapshot binds.
 *
 * `submitReview` re-derives this identity and compares all four fields —
 * `manifest_digest` included — against the reservation. Returning the bare
 * commit identity therefore compared a real digest against `undefined` and
 * failed every v4 submission with "Review revision changed before submission",
 * so the manifest is recomputed here rather than only the commit. The outcomes
 * come from the same `qaOutcomes` the Review snapshot is built from, which
 * makes the two digests equal by construction instead of by coincidence.
 *
 * v3 records keep the legacy full-source bundle and return null.
 */
export async function ensureClaudeReviewRevision(
	root: string,
	taskId: string,
	projection: AssuranceProjectionResult,
): Promise<ReviewRevision | null> {
	const current = await readTaskRecord(root, taskId);
	const record = current.record;
	if (!record) throw new Error(`task ${taskId} has no TaskRecord`);
	if (current.revision !== projection.projection.record_revision)
		throw new Error("TaskRecord changed before Review revision preparation");
	if (record.contract !== "assurance_kernel/task_record/v4") return null;
	if (!record.git_base_head)
		throw new Error("Review revision requires a TaskRecord v4 git_base_head");
	const manifest = captureReviewManifest(root, {
		taskId,
		baseHead: record.git_base_head,
		scopeHint: record.intent_snapshot.scope_hint,
		expectedDiffHash: projection.projection.diff_hash,
		intentRevision: projection.projection.intent_revision,
		intentContentHash: projection.projection.intent_content_hash,
		recordRevision: projection.projection.record_revision,
		workspaceRevision: projection.projection.workspace_revision,
		lifecycle: projection.projection.lifecycle,
		artifactState: projection.projection.artifact_state,
		risk: record.intent_snapshot.risk,
		outcomes: qaOutcomes(record),
	});
	return {
		contract: "assurance_kernel/review_revision/v1",
		base_head: manifest.base_head,
		review_tree: manifest.review_tree,
		review_commit: manifest.review_commit,
		review_ref: manifest.review_ref,
		diff_hash: manifest.diff_hash,
		manifest_digest: manifest.manifest_digest,
	};
}

async function buildAssuranceSnapshot(
	root: string,
	taskId: string,
	role: "qa" | "review",
	projection: AssuranceProjectionResult,
	runner: FrozenRunner,
) {
	const read = await readTaskRecord(root, taskId);
	const record = read.record;
	if (!record || read.revision !== projection.projection.record_revision) throw new Error("TaskRecord changed before assurance snapshot capture");
	const intent = record.intent_snapshot;
	const descriptors = new Map<string, VerificationDescriptor>();
	for (const item of intent.acceptance) {
		const descriptor = parseVerificationDescriptor(item.verification);
		assertRunnerCompatible(descriptor, runner);
		descriptors.set(item.id, descriptor);
	}
	// `git_base_head` exists only on TaskRecord v4, so this must narrow the union
	// rather than test the contract string into a plain boolean.
	const reviewBundle = role === "review" && !isTaskRecordV4(record)
		? captureReviewBundle(root, intent.scope_hint, projection.projection.diff_hash, qaOutcomes(record))
		: null;
	const reviewManifest = role === "review" && isTaskRecordV4(record)
		? captureReviewManifest(root, {
			taskId,
			baseHead: record.git_base_head,
			scopeHint: intent.scope_hint,
			expectedDiffHash: projection.projection.diff_hash,
			intentRevision: projection.projection.intent_revision,
			intentContentHash: projection.projection.intent_content_hash,
			recordRevision: projection.projection.record_revision,
			workspaceRevision: projection.projection.workspace_revision,
			lifecycle: projection.projection.lifecycle,
			artifactState: projection.projection.artifact_state,
			risk: intent.risk,
			outcomes: qaOutcomes(record),
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
	interactive?: boolean;
	permissionMode?: PermissionMode;
	requestConfirmation?: NativeConfirmationPort;
	batchKernel?: Partial<BatchRunnerKernelPort>;
	batchGit?: BatchRunnerGitPort;
	readInitiative?: InitiativeObservationReader;
}

/**
 * Synchronous re-verification that the currently held claim for `taskId` is this
 * batch's own Kernel enrollment. Positive evidence only (see the Pi adapter):
 * the driver's durable child slot, the batch Git lineage, the Kernel event-id
 * derivation, the intent identity, and claim creation before the batch's last
 * durable write. The mutable confirmation_time is deliberately not used, so a
 * needs_human re-authorization can never turn this batch's own claim foreign.
 * Called fresh pre/post confirmation and from ownsTaskClaim.
 */
function syncIsOwnBatchClaim(
	cwd: string,
	existingBatch: any,
	taskId: string,
	batchBranch: string,
): boolean {
	let claim: any = null;
	let workspace: any = null;
	try {
		claim = JSON.parse(readFileSync(join(cwd, ".imm", "state", "active-claim.json"), "utf8"));
		workspace = JSON.parse(readFileSync(join(cwd, ".imm", "state", "workspace.json"), "utf8"));
	} catch {
		return false;
	}
	const currentTaskId =
		workspace?.state?.current_working ||
		(claim?.lifecycle_status === "active" ? claim?.task_id : null);
	if (currentTaskId !== taskId || !claim) return false;
	const branch = spawnSync("git", ["-C", cwd, "branch", "--show-current"], { encoding: "utf8" }).stdout.trim();
	if (branch !== batchBranch) return false;
	const childInBatch = existingBatch.children.find((c: { task_id: string }) => c.task_id === taskId);
	if (!childInBatch || !(childInBatch.state === "enrolled" || childInBatch.state === "needs_human")) {
		return false;
	}
	let rec: any = null;
	try {
		rec = JSON.parse(readFileSync(join(cwd, ".imm", "state", "tasks", `${taskId}.json`), "utf8"));
	} catch {
		return false;
	}
	const lineageHeads = [existingBatch.base_head].concat(
		Array.isArray(existingBatch.commits) ? existingBatch.commits : [],
	);
	if (!lineageHeads.includes(rec.git_base_head)) return false;
	if (claim.enrollment_event_id !== `enroll-${taskId}-${claim.created_at}`) return false;
	const createdAt = Date.parse(claim.created_at);
	if (!Number.isFinite(createdAt) || createdAt > Date.parse(existingBatch.updated_at)) return false;
	if (claim.task_id !== taskId || claim.lifecycle_status !== "active") return false;
	if (claim.intent_revision !== rec.intent_snapshot?.revision) return false;
	if (claim.intent_content_hash !== rec.intent_ref?.content_hash) return false;
	return true;
}

function findExistingActiveBatch(root: string, initiativeSlug: string): any {
	const batchesDir = join(root, ".imm", "state", "batches");
	if (!existsSync(batchesDir)) return null;
	const files = readdirSync(batchesDir);
	for (const file of files) {
		if (!file.endsWith(".json")) continue;
		let record: any;
		try {
			record = JSON.parse(readFileSync(join(batchesDir, file), "utf8"));
		} catch {
			// Unreadable Kernel batch state must fail closed: silently treating the
			// initiative as batchless could authorize a parallel run.
			return { corrupt: true, path: file };
		}
		if (record.contract === "assurance_kernel/batch_run_state/v1" && record.initiative_slug === initiativeSlug) {
			const validStates = new Set([
				"prepared",
				"running",
				"needs_human",
				"completed",
				"budget_stopped",
				"failed",
				"rejected",
			]);
			if (
				typeof record.batch_id !== "string" ||
				typeof record.base_head !== "string" ||
				!Array.isArray(record.children) ||
				!validStates.has(record.batch_state)
			) {
				return { corrupt: true, path: file };
			}
			return record;
		}
	}
	return null;
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
		});
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
			projectTask: (root, taskId) => projectAssurance(root, taskId, diffSnapshotOf),
			readTaskRecord: async (root, taskId) => readTaskRecord(root, taskId),
			readTaskIntent: async (root, taskId) => readTaskIntentForRecord(root, taskId),
			frozenRunner: async () => resolveBunRunner(),
			buildAssurance: (root, taskId, role, projection, runner) => buildAssuranceSnapshot(root, taskId, role, projection, runner),
			ensureReviewRevision: (root, taskId, projection) => ensureClaudeReviewRevision(root, taskId, projection),
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
			} else if (readiness.state === "authorize_rework") {
				op = "authorize_rework";
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
				...(op === "stop" ? { reason: stopReason(extra.reason) } : {}),
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
					...(op === "stop" ? { reason: stopReason(extra.reason) } : {}),
				} as never,
				prior_intent_token: priorIntent.token,
				diffProvider: diffSnapshotOf,
				now,
			});
			if (
				op === "stop" ||
				op === "authorize_rework" ||
				op === "approve_breaking_intent_revision"
			) stagePlanningArtifactTransition(this.cwd, result.record);
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
			const findings = reviewReworkFindings(input.verdict);
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
		const approval: TaskApprovalV2 = {
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

	private async executeOrdinary(ctx: HostContext, input: { taskId: string; operation: { op: string; actor_id: string; next_intent?: unknown; finding_id?: string; attestation_id?: string } }) {
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

	async startUnattendedBatch(
		initiativeSlug: string,
		meta: ToolMeta,
	): Promise<
		| { state: "started"; batch_id: string; report: BatchRunReport }
		| { state: "rejected"; reason: string; recovery_action: string }
		| { state: "cancelled"; reason: string; recovery_action: string }
		| { state: "blocked"; reason: string; recovery_action: string }
	> {
		throwIfCancelled(meta.signal);
		const probe = probeHost(this.env, process.platform, this.hostVersion);
		if (!probe.ok) throw new NativeAuthorityError("unsupported_host", probe.reason);
		const interactive = meta.interactive ?? this.interactive;
		if (!interactive) throw new NativeAuthorityError("unsupported_host", "interactive MCP elicitation is unavailable");
		if (!this.requestConfirmation) throw new NativeAuthorityError("interaction_not_opened", "native confirmation port is unavailable");

		// 1. Validate initiative slug
		if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(initiativeSlug)) {
			return {
				state: "rejected",
				reason: `invalid initiative slug: ${initiativeSlug}`,
				recovery_action: "specify a valid initiative slug and retry in the current Host",
			};
		}

		// Check for an existing active/paused batch for this initiative
		const existingBatch = findExistingActiveBatch(this.cwd, initiativeSlug);
		const isResuming = existingBatch !== null;
		if (existingBatch?.corrupt) {
			return {
				state: "blocked",
				reason: `batch run state is unreadable or invalid: ${existingBatch.path}`,
				recovery_action: "resolve or remove the invalid batch state file, then retry in the current Host",
			};
		}
		const batchBranch = `imm/${initiativeSlug}`;

		// 2. Active workspace claim check (pre-confirmation)
		const workspaceState = readWorkspaceStateRaw(this.cwd);
		const claim = readBackendClaim(this.cwd);
		const activeTaskId = workspaceState.state.current_working || (claim?.lifecycle_status === "active" ? claim.task_id : null);
		const isOwnClaim =
			isResuming &&
			activeTaskId !== null &&
			syncIsOwnBatchClaim(this.cwd, existingBatch, activeTaskId, batchBranch);
		if (activeTaskId && !isOwnClaim) {
			return {
				state: "blocked",
				reason: `an active workspace claim already exists for task: ${activeTaskId}`,
				recovery_action: "resolve or stop the active task before starting a batch in the current Host",
			};
		}

		// 3. Git HEAD & read-only preflight check (pre-confirmation)
		let baseHead: string;
		try {
			baseHead = readGitHead(this.cwd);
		} catch (err) {
			return {
				state: "rejected",
				reason: err instanceof Error ? err.message : String(err),
				recovery_action: "commit working changes and ensure a committed Git HEAD exists in the current Host",
			};
		}

		// Read-only check: verify clean tree and branch does not exist without creating refs before confirmation
		const branchExists = spawnSync("git", ["-C", this.cwd, "show-ref", "--verify", "--quiet", `refs/heads/${batchBranch}`]);
		if (branchExists.status === 0 && !isResuming) {
			return {
				state: "rejected",
				reason: `branch preflight failed: branch refs/heads/${batchBranch} already exists`,
				recovery_action: "delete or rename the conflicting branch, or commit working changes in the current Host",
			};
		}
		// review-batch-resume-porcelain-leading-space: parse the NUL-delimited v1
		// format so an unstaged modification (" M path") keeps its status columns.
		const statusProc = spawnSync("git", ["-C", this.cwd, "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], {
			encoding: "utf8",
		});
		if (statusProc.status !== 0) {
			return {
				state: "rejected",
				reason: "branch preflight failed: git status is unreadable",
				recovery_action: "check the repository integrity and retry in the current Host",
			};
		}
		const statusEntries: Array<{ code: string; path: string }> = [];
		// -z with --no-renames lists each side of a rename as its own D/A entry, so a
		// cross-scope rename cannot hide the out-of-scope source deletion.
		for (const entry of statusProc.stdout.split("\0")) {
			if (entry.length === 0) continue;
			statusEntries.push({ code: entry.slice(0, 2), path: entry.slice(3) });
		}
		if (statusEntries.length > 0) {
			if (!isResuming) {
				return {
					state: "rejected",
					reason: "branch preflight failed: working tree is dirty",
					recovery_action: "delete or rename the conflicting branch, or commit working changes in the current Host",
				};
			}
			// Kernel projections accept staged in-flight work inside the active child's
			// authorized scope, and reject unstaged/untracked bytes or out-of-scope paths.
			// `settled` belongs here: Kernel settlement happens before the batch commits the
			// child, and settlement clears the live state record, so a crash in that window
			// resumes into a settled child whose staged work is legitimate.
			const inFlightChild = existingBatch.children.find(
				(c: { state: string }) => c.state === "enrolled" || c.state === "needs_human" || c.state === "settled",
			);
			let authorizedScope: string[] = [];
			if (inFlightChild) {
				// Derive the scope from the Kernel TaskRecord intent snapshot first: a
				// frozen/archived sidecar must not shrink the authorized scope to empty.
				try {
					// Lock-free read: readTaskRecord would run pending-transaction recovery
					// before the literal user approved anything, violating zero-write on
					// decline/cancel/preflight rejection. Mutating Kernel entrypoints take
					// their own lock when the batch actually starts.
					const recordRead = readTaskRecordRaw(this.cwd, inFlightChild.task_id);
					authorizedScope = (recordRead.record as any)?.intent_snapshot?.scope_hint ?? [];
				} catch {
					// fallback below
				}
				if (authorizedScope.length === 0 && inFlightChild.state === "settled") {
					// A settled child has no live state record; its authority is the immutable
					// terminal audit pair. Read-only, so a refusal still writes nothing.
					try {
						const settled = readAuditTaskPair(this.cwd, inFlightChild.task_id)?.record as
							| { intent_snapshot?: { scope_hint?: string[] } }
							| undefined;
						authorizedScope = settled?.intent_snapshot?.scope_hint ?? [];
					} catch {
						// fallback below
					}
				}
				if (authorizedScope.length === 0) {
					// Resolve through the TaskRecord's intent_ref: after freeze the
					// sidecar lives in docs/plans/archive/, so the default pre-freeze
					// path would either throw or read a stale file.
					try {
						const read = readTaskIntentForRecord(this.cwd, inFlightChild.task_id);
						authorizedScope = read.intent.scope_hint ?? [];
					} catch {
						// fallback below
					}
				}
				if (authorizedScope.length === 0) {
					return {
						state: "rejected",
						reason: "branch preflight failed: cannot derive the in-flight child's authorized scope",
						recovery_action: "resolve the child's intent record, then retry in the current Host",
					};
				}
			}
			const dirtyBytes = statusEntries.some(({ code }) => code === "??" || code[1] !== " ");
			if (dirtyBytes) {
				return {
					state: "rejected",
					reason: "branch preflight failed: working tree has unstaged or untracked changes",
					recovery_action: "stage the in-flight changes with git add, then retry in the current Host",
				};
			}
			const outsideScope = statusEntries.some(({ path }) => {
				if (path.startsWith(".imm/") || path.startsWith("docs/plans/") || path.startsWith("docs/specs/")) return false;
				// Scope entries may be exact files, directories, or globs; delegate to the
				// Kernel's own boundary matcher instead of exact includes.
				return !authorizedScope.some((scopePath) => pathMatchesScope(path, scopePath));
			});
			if (outsideScope) {
				return {
					state: "rejected",
					reason: "branch preflight failed: working tree has changes outside the authorized child scope",
					recovery_action: "commit or unstage changes outside the active task scope, then retry in the current Host",
				};
			}
		}

		// 4. Project or reconstruct batch plan (pre-confirmation)
		const now = new Date().toISOString();
		let recoveryChildren: BatchPlanChild[] = [];
		let planDigest: string;
		let confirmChildrenDetails: Array<{ task_id: string; slice_id: string; risk: string }> = [];
		let confirmExcludedDetails: Array<{ task_id: string; slice_id: string; reason: string }> = [];
		const recoveryRiskByTask = new Map<string, string>();
		let budget = existingBatch ? existingBatch.budget : { max_children: 10, deadline_at: new Date(Date.now() + 8 * 3600 * 1000).toISOString(), qa_failure_limit: 2 };

		if (isResuming) {
			try {
				recoveryChildren = await Promise.all(
					existingBatch.children.map(async (c: any) => {
						const intentPath = `docs/plans/${c.task_id}.intent.json`;
						let read = { intent: { revision: 1, risk: "material" }, content_hash: "" };
						try {
							const taskRecordRead = readTaskRecordRaw(this.cwd, c.task_id);
							if (taskRecordRead.record) {
								read = {
									intent: taskRecordRead.record.intent_snapshot,
									content_hash: taskRecordRead.record.intent_ref.content_hash,
								};
							} else {
								read = (await readTaskIntent(this.cwd, c.task_id, intentPath)) as any;
							}
						} catch {
							const archivePath = `docs/plans/archive/${c.task_id}.intent.json`;
							try {
								read = (await readTaskIntent(this.cwd, c.task_id, archivePath)) as any;
							} catch {
								read = (await readTaskIntent(this.cwd, c.task_id, intentPath)) as any;
							}
						}
						// Keep the risk captured by the authoritative read; a stale reconstructed
						// path must never fabricate a risk in the confirmation details.
						recoveryRiskByTask.set(c.task_id, read.intent?.risk ?? "material");
						const isDone = c.state === "committed" || c.state === "settled";
						return {
							task_id: c.task_id,
							slice_id: c.slice_id,
							status: isDone ? ("already_settled" as const) : ("enrollable" as const),
							blocked_by: [...c.blocked_by],
							reason: c.reason ?? null,
							intent_path: intentPath,
							intent_revision: read.intent.revision,
							intent_content_hash: read.content_hash,
						};
					}),
				);
			} catch (err) {
				return {
					state: "rejected",
					reason: `failed to project batch plan: ${err instanceof Error ? err.message : String(err)}`,
					recovery_action: "review initiative issues and planning sidecars in the current Host",
				};
			}
			planDigest = computeBatchPlanDigest(recoveryChildren as any);
			for (const c of recoveryChildren) {
				// Risk captured from the authoritative recovery read; never fabricated.
				confirmChildrenDetails.push({
					task_id: c.task_id,
					slice_id: c.slice_id,
					risk: recoveryRiskByTask.get(c.task_id) ?? "material",
				});
			}
		} else {
			let plan: BatchPlan;
			try {
				plan = await projectBatchPlan(
					this.cwd,
					initiativeSlug,
					{ confirmation_time: now },
					this.readInitiative ?? observeGithubInitiative,
				);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (msg.includes("has no enrollable children")) {
					return {
						state: "rejected",
						reason: "empty enrollable child set: no enrollable child tasks found in the initiative plan",
						recovery_action: "ensure the initiative has uncompleted, non-critical child tasks in the current Host",
					};
				}
				return {
					state: "rejected",
					reason: `failed to project batch plan: ${msg}`,
					recovery_action: "review initiative issues and planning sidecars in the current Host",
				};
			}

			if (plan.enrollable.length === 0) {
				return {
					state: "rejected",
					reason: "empty enrollable child set: no enrollable child tasks found in the initiative plan",
					recovery_action: "ensure the initiative has uncompleted, non-critical child tasks in the current Host",
				};
			}

			budget = plan.budget;
			const enrollableChildById = new Map(plan.enrollable.map((c) => [c.task_id, c]));
			recoveryChildren = plan.children
				.filter((c) => c.status === "enrollable")
				.map((c) => {
					const digestChild = enrollableChildById.get(c.task_id);
					return {
						...c,
						blocked_by: digestChild ? [...digestChild.blocked_by] : c.blocked_by,
					};
				});
			planDigest = computeBatchPlanDigest(plan.enrollable);

			for (const c of plan.children.filter((item) => item.status === "enrollable")) {
				let childRisk = "material";
				try {
					const intentRead = await readTaskIntent(this.cwd, c.task_id, c.intent_path ?? undefined);
					childRisk = intentRead.intent.risk;
				} catch {
					// fallback
				}
				confirmChildrenDetails.push({
					task_id: c.task_id,
					slice_id: c.slice_id,
					risk: childRisk,
				});
			}
			confirmExcludedDetails = plan.children
				.filter((c) => c.status !== "enrollable")
				.map((c) => ({
					task_id: c.task_id,
					slice_id: c.slice_id,
					reason: c.status === "needs_human" && c.reason === "critical" ? "critical" : (c.reason ?? c.status),
				}));
		}

		// 5. Native confirmation elicitation
		const isExistingExpired = isResuming && Date.parse(existingBatch.authorization_expires_at) <= Date.now();
		const expiresAt = isResuming && !isExistingExpired && existingBatch.batch_state === "running"
			? existingBatch.authorization_expires_at
			: new Date(Date.now() + 10 * 60 * 1000).toISOString();
		const batchDetails = {
			initiative_slug: initiativeSlug,
			batch_branch: batchBranch,
			children: confirmChildrenDetails,
			excluded: confirmExcludedDetails,
			budget,
			expires_at: expiresAt,
		};

		// review-4: bounded elicitation timeout preventing indefinite hang on missing/replayed evidence
		const configuredTimeout = Number(this.env.IMMUNE_BRAIN_BATCH_TIMEOUT_MS);
		const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 60_000;
		const timeoutController = new AbortController();
		const timeoutTimer = setTimeout(() => {
			timeoutController.abort(new NativeAuthorityError("user_cancelled", "native confirmation timed out"));
		}, timeoutMs);
		const elicitationSignal = meta.signal
			? AbortSignal.any([meta.signal, timeoutController.signal])
			: timeoutController.signal;

		let confirmationResult: { decision: "accept" | "decline" | "cancel"; requestId: string };
		try {
			confirmationResult = await this.requestConfirmation({
				operation: "start_unattended_batch",
				initiativeSlug,
				toolCallId: meta.toolCallId,
				planDigest,
				batchDetails,
				signal: elicitationSignal,
			});
		} catch (err) {
			if (timeoutController.signal.aborted && !meta.signal?.aborted) {
				return {
					state: "rejected",
					reason: "native confirmation timed out waiting for user interaction",
					recovery_action: "retry through a fresh native gate in the current Host",
				};
			}
			if (meta.signal?.aborted) {
				return {
					state: "cancelled",
					reason: "user cancelled before batch execution",
					recovery_action: "wait for a fresh literal-user request",
				};
			}
			if (err instanceof NativeAuthorityError) {
				if (err.reasonCode === "unsupported_host") throw err;
				if (err.reasonCode === "user_cancelled") {
					return { state: "cancelled", reason: err.message, recovery_action: err.recoveryAction };
				}
				if (err.reasonCode === "user_denied") {
					return { state: "rejected", reason: err.message, recovery_action: err.recoveryAction };
				}
				return { state: "rejected", reason: err.message, recovery_action: err.recoveryAction };
			}
			return {
				state: "rejected",
				reason: err instanceof Error ? err.message : String(err),
				recovery_action: "retry through a fresh native gate in the current Host",
			};
		} finally {
			clearTimeout(timeoutTimer);
		}

		if (meta.signal?.aborted) {
			return {
				state: "cancelled",
				reason: "user cancelled before batch execution",
				recovery_action: "wait for a fresh literal-user request",
			};
		}

		if (confirmationResult.decision === "decline") {
			return {
				state: "rejected",
				reason: "native interaction declined",
				recovery_action: "wait for a fresh literal-user request",
			};
		}
		if (confirmationResult.decision === "cancel") {
			return {
				state: "cancelled",
				reason: "native interaction cancelled",
				recovery_action: "wait for a fresh literal-user request",
			};
		}
		if (confirmationResult.decision !== "accept") {
			return {
				state: "rejected",
				reason: "native interaction returned no decision",
				recovery_action: "retry through a fresh native gate in the current Host",
			};
		}

		// 6. Post-confirmation Revalidation (Drift check, Workspace claim, Git HEAD)
		const postWorkspaceState = readWorkspaceStateRaw(this.cwd);
		const postClaim = readBackendClaim(this.cwd);
		const postActiveTaskId = postWorkspaceState.state.current_working || (postClaim?.lifecycle_status === "active" ? postClaim.task_id : null);
		const isPostOwnClaim =
			isResuming &&
			postActiveTaskId !== null &&
			syncIsOwnBatchClaim(this.cwd, existingBatch, postActiveTaskId, batchBranch);
		if (postActiveTaskId && !isPostOwnClaim) {
			return {
				state: "blocked",
				reason: `an active workspace claim appeared during confirmation for task: ${postActiveTaskId}`,
				recovery_action: "resolve or stop the active task before starting a batch in the current Host",
			};
		}

		if (isResuming) {
			let recheckedDigest: string;
			try {
				const recheckedChildren = await Promise.all(
					existingBatch.children.map(async (c: any) => {
						const intentPath = `docs/plans/${c.task_id}.intent.json`;
						let read = { intent: { revision: 1, risk: "material" }, content_hash: "" };
						try {
							const taskRecordRead = readTaskRecordRaw(this.cwd, c.task_id);
							if (taskRecordRead.record) {
								read = {
									intent: taskRecordRead.record.intent_snapshot,
									content_hash: taskRecordRead.record.intent_ref.content_hash,
								};
							} else {
								read = (await readTaskIntent(this.cwd, c.task_id, intentPath)) as any;
							}
						} catch {
							const archivePath = `docs/plans/archive/${c.task_id}.intent.json`;
							try {
								read = (await readTaskIntent(this.cwd, c.task_id, archivePath)) as any;
							} catch {
								read = (await readTaskIntent(this.cwd, c.task_id, intentPath)) as any;
							}
						}
						const isDone = c.state === "committed" || c.state === "settled";
						return {
							task_id: c.task_id,
							slice_id: c.slice_id,
							status: isDone ? ("already_settled" as const) : ("enrollable" as const),
							blocked_by: [...c.blocked_by],
							reason: c.reason ?? null,
							intent_path: intentPath,
							intent_revision: read.intent.revision,
							intent_content_hash: read.content_hash,
						};
					}),
				);
				recheckedDigest = computeBatchPlanDigest(recheckedChildren);
			} catch (err) {
				return {
					state: "rejected",
					reason: "batch plan became unreadable after native confirmation",
					recovery_action: "review the current workspace and retry through a fresh native gate in the current Host",
				};
			}
			if (recheckedDigest !== planDigest) {
				return {
					state: "rejected",
					reason: "batch plan changed after native confirmation",
					recovery_action: "review the current workspace and retry through a fresh native gate in the current Host",
				};
			}
		} else {
			let revalidatedPlan: BatchPlan;
			try {
				revalidatedPlan = await projectBatchPlan(
					this.cwd,
					initiativeSlug,
					{ confirmation_time: now },
					this.readInitiative ?? observeGithubInitiative,
				);
			} catch (err) {
				return {
					state: "rejected",
					reason: "batch plan became unreadable after native confirmation",
					recovery_action: "review the current workspace and retry through a fresh native gate in the current Host",
				};
			}

			const revalidatedDigest = computeBatchPlanDigest(revalidatedPlan.enrollable);
			if (revalidatedDigest !== planDigest) {
				return {
					state: "rejected",
					reason: "batch plan changed after native confirmation",
					recovery_action: "review the current workspace and retry through a fresh native gate in the current Host",
				};
			}
		}

		// review-batch-head-revalidation-window: re-verify Git HEAD after asynchronous revalidation
		let postHead: string;
		try {
			postHead = readGitHead(this.cwd);
		} catch (err) {
			return {
				state: "rejected",
				reason: "Git repository became unreadable after native confirmation",
				recovery_action: "review the current workspace and retry through a fresh native gate in the current Host",
			};
		}
		if (postHead !== baseHead) {
			return {
				state: "rejected",
				reason: "Git HEAD moved after native confirmation",
				recovery_action: "review the current workspace and retry through a fresh native gate in the current Host",
			};
		}

		// review-batch-active-claim-race: re-check workspace and backend claim after asynchronous revalidation
		const finalWorkspaceState = readWorkspaceStateRaw(this.cwd);
		const finalClaim = readBackendClaim(this.cwd);
		const finalActiveTaskId = finalWorkspaceState.state.current_working || (finalClaim?.lifecycle_status === "active" ? finalClaim.task_id : null);
		// Re-verify the full claim identity now: a claim swapped for the same child
		// during confirmation must stay blocked even when plan and HEAD are stable.
		const finalIsOwnClaim =
			isResuming &&
			finalActiveTaskId !== null &&
			syncIsOwnBatchClaim(this.cwd, existingBatch, finalActiveTaskId, batchBranch);
		if (finalActiveTaskId && !finalIsOwnClaim) {
			return {
				state: "blocked",
				reason: `an active workspace claim appeared during confirmation for task: ${finalActiveTaskId}`,
				recovery_action: "resolve or stop the active task before starting a batch in the current Host",
			};
		}

		// review-1: verify cancellation signal right before authority issuance and startBatch
		if (meta.signal?.aborted) {
			return {
				state: "cancelled",
				reason: "user cancelled before batch execution",
				recovery_action: "wait for a fresh literal-user request",
			};
		}

		// 7. Issue Batch Authorization through Kernel registry and startBatch
		const batchId = existingBatch ? existingBatch.batch_id : `batch-${initiativeSlug}-${Date.now()}`;
		const confirmation = confirmationRef({
			connectionId: meta.sessionId,
			toolCallId: meta.toolCallId,
			requestId: confirmationResult.requestId,
			operation: "start_unattended_batch",
			initiativeSlug,
			planDigest,
		});
		const binding: BatchAuthorizationBinding = {
			batch_id: batchId,
			initiative_slug: initiativeSlug,
			plan_digest: planDigest,
			branch: batchBranch,
			base_head: isResuming ? existingBatch.base_head : baseHead,
			budget,
			actor_id: "user",
			confirmation_ref: confirmation,
			expires_at: expiresAt,
			nonce: enrollmentNonce(),
		};

		const capability = this.batchRegistry.issue(binding, recoveryChildren as any, now);

		const basePort = this.createBatchKernelPort(this.batchRegistry, capability, binding);
		const kernelPort: BatchRunnerKernelPort = {
			...basePort,
			ownsTaskClaim: (taskId) => {
				if (isResuming && taskId === activeTaskId) {
					// Re-verify the CURRENT claim identity synchronously.
					return syncIsOwnBatchClaim(this.cwd, existingBatch, taskId, batchBranch);
				}
				return basePort.ownsTaskClaim(taskId);
			},
		};
		const report = await startBatch({
			root: this.cwd,
			batch_id: batchId,
			initiative_slug: initiativeSlug,
			registry: this.batchRegistry,
			capability,
			children: recoveryChildren,
			plan_digest: planDigest,
			base_head: isResuming ? existingBatch.base_head : baseHead,
			confirmation_time: now,
			authorization_expires_at: expiresAt,
			budget,
			now,
			kernel: kernelPort,
			git: this.batchGit,
		});

		// review-3 & review-batch-preflight-recovery-is-diagnostic: map rejected batch state to rejected result with same-Host recovery action
		if (report.batch_state === "rejected") {
			return {
				state: "rejected",
				reason: report.reason ?? "batch run rejected",
				recovery_action: "delete or rename the conflicting branch, or commit working changes and retry in the current Host",
			};
		}

		return {
			state: "started",
			batch_id: batchId,
			report,
		};
	}

	private createBatchKernelPort(
		registry: BatchAuthorityRegistry,
		capability: object,
		binding: BatchAuthorizationBinding,
	): BatchRunnerKernelPort {
		// review-batch-partial-port-fabricates-enrollment: construct real production port first, never fabricate stubs
		const realPort: BatchRunnerKernelPort = {
			enrollTask: async ({ root, task_id, batch }) => {
				const now = new Date().toISOString();
				const derived = deriveChildEnrollment(root, batch.registry, {
					capability: batch.capability,
					binding,
					task_id,
					expected_head: batch.binding.expected_head,
					now,
				});
				const enrollmentCapability = this.enrollmentRegistry.issue(derived.binding);
				const input = {
					task_id,
					intent_path: derived.binding.intent_path,
					intent_revision: derived.binding.intent_revision,
					preparation_digest: derived.binding.preparation_digest,
					capability: enrollmentCapability,
					capability_binding: derived.binding,
					batch: {
						registry: batch.registry,
						capability: batch.capability,
						binding,
						expected_head: batch.binding.expected_head,
					},
					now,
				};
				const rehearsal = runEnrollmentRehearsal(root, input, enrollmentCapability, this.enrollmentRegistry);
				if (!rehearsal.rehearsed || rehearsal.evidence.outcome !== "ready") {
					throw new Error(`Kernel enrollment rehearsal failed: ${rehearsal.evidence.blockers.join("; ")}`);
				}
				const enrolled = enrollCanaryTask(root, input, this.enrollmentRegistry);
				const recordRaw = readTaskRecordRaw(root, task_id);
				return { record_revision: recordRaw.revision };
			},
			advanceTask: async (root, taskId) => {
				const result = await this.coordinator.advance(taskId, { cwd: root });
				if (result.state === "completed") return { state: "completed" };
				if (result.state === "stopped") return { state: "stopped" };
				if (result.state === "rework") return { state: "rework", operation: result.operation, summary: result.summary };
				if (result.state === "review_ready") return { state: "review_ready", operation_id: result.operation_id };
				if (result.state === "blocked") return { state: "blocked", reason: result.reason };
				return { state: "failed", reason: (result as { reason?: string }).reason ?? "advance failed" };
			},
			projectTask: async (root, taskId) => projectAssurance(root, taskId, diffSnapshotOf),
			ownsTaskClaim: (taskId) => {
				return registry.isChildConsumed(capability, taskId);
			},
			validateBatchAuthorization: (input) => {
				return input.registry.inspect(input.capability, input.binding as never);
			},
		};

		if (!this.batchKernel) return realPort;
		return {
			...realPort,
			...this.batchKernel,
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