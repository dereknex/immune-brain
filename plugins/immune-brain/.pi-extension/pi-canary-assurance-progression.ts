// Foreground Assurance progression for one Pi session.
//
// Deterministic QA runs to completion inside the caller's Tool execution. A
// successful QA pass creates one short-lived Review reservation; the Parent
// invokes a foreground reviewer and explicitly submits its structured verdict.
// No lifecycle work survives a Tool call except the evidence reservation.

import { createHash, randomUUID } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	findingsDigest,
	parseVerificationDescriptor,
	type FrozenRunner,
	type VerificationDescriptor,
	VerificationAbortedError,
} from "./pi-canary-verification";
import { createInvocationRegistry, type InvocationState, type InvocationToken } from "./pi-canary-invocations";
import { describeQaFailure } from "./pi-canary-qa-findings";
import type { ReviewBundle, ReviewManifestV5, ReviewRevision } from "./pi-canary-review-bundle";
import {
	reservedAgentParams,
	type ReservedAgentParams,
} from "./pi-canary-native-review";
import type { AssuranceRole, AssuranceResultPresentation } from "./pi-canary-assurance";
import {
	buildRoleDelegationPacket,
} from "../runtime/role_prompt_bridge";
import type { AssuranceProjectionResult, TaskIntentRead, TaskRecordRead, TaskTombstone } from "./runtime-stub";

export interface GithubTerminalProjectionInput {
	task_id: string;
	phase: "done" | "stopped";
	terminal_event_id: string;
}

export function deriveGithubTerminalProjectionInput(
	taskId: string,
	projection: AssuranceProjectionResult,
	tombstone: TaskTombstone | null,
): GithubTerminalProjectionInput | null {
	if (
		projection.error
		|| projection.claim !== null
		|| (projection.projection.lifecycle !== "done" && projection.projection.lifecycle !== "stopped")
		|| tombstone?.task_id !== taskId
		|| tombstone.lifecycle_status !== "terminal"
		|| tombstone.terminal_lifecycle !== projection.projection.lifecycle
	) return null;
	return {
		task_id: taskId,
		phase: projection.projection.lifecycle,
		terminal_event_id: tombstone.terminal_event_id,
	};
}

export interface AssuranceVerdict {
	contract: "assurance_kernel/assurance_verdict/v2";
	role: AssuranceRole;
	task_id: string;
	snapshot_digest: string;
	decision: "pass" | "rework";
	approval?: {
		kind: "qa" | "review";
		authority_role: "qa" | "reviewer";
		summary: string;
	};
	findings?: Array<{
		id: string;
		kind: "blocking" | "advisory";
		acceptance_id: string | null;
		summary: string;
		findings_digest: string;
	}>;
}

export interface ReviewRevisionIdentity {
	contract: "assurance_kernel/review_revision_identity/v1";
	base_head: string;
	review_commit: string;
	review_tree: string;
	manifest_digest: string;
}

export interface SnapshotDescriptor {
	contract: "assurance_kernel/assurance_snapshot/v2";
	task_id: string;
	role: AssuranceRole;
	record_revision: string;
	workspace_revision: string;
	intent_revision: number;
	intent_content_hash: string;
	diff_hash: string;
	lifecycle: string;
	artifact_state: string;
	risk: "routine" | "material" | "critical";
	fresh_acceptance_ids: string[];
	missing_acceptance_ids: string[];
	stale_attestation_ids: string[];
	acceptance: Array<{ id: string; assertion: string; verification: string }>;
	dirty_files: string[];
	review_bundle_digest: string | null;
	/** Present only when Review authority binds an immutable Git revision (v4). */
	review_revision?: ReviewRevisionIdentity;
	root: string;
}

export interface QaVerificationProgress {
	index: number;
	total: number;
	acceptance_id: string;
	phase: "running" | "passed" | "failed";
	elapsed_ms: number;
}

export interface ForegroundToolUpdate {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
}

export type AssuranceAdvanceResult =
	| { state: "review_ready"; operation: "review"; operation_id: string; snapshot_digest: string; review_bundle_digest: string; agent_params: ReservedAgentParams }
	| { state: "awaiting_user"; operation: "record-user-approval"; operation_id: string }
	| { state: "rework"; operation: "qa"; operation_id: string; summary: string }
	| { state: "cancelled"; operation: "qa" | "review"; operation_id: string; reason: string }
	| { state: "failed"; operation: "qa" | "review"; operation_id: string; reason: string }
	/**
	 * Read-only Review evidence preparation failed after QA authority settled.
	 * The Kernel obligation stays `run_review`, nothing was lost, and the same
	 * deterministic revision can be rebuilt on the next advance.
	 */
	| { state: "review_preparation_failed"; operation: "review"; operation_id: string; reason: string }
	| { state: "settlement_unknown"; operation: "qa" | "review"; operation_id: string; reason: string }
	| { state: "blocked"; reason: string; code?: "verdict_invalid" }
	| { state: "completed" }
	| { state: "stopped" };

export type AssuranceSubmitReviewResult =
	| { state: "rework"; operation: "review"; operation_id: string; summary: string }
	| { state: "awaiting_user"; operation: "record-user-approval"; operation_id: string }
	| { state: "review_preparation_failed"; operation: "review"; operation_id: string; reason: string }
	| { state: "completed" }
	| { state: "settlement_unknown"; operation: "qa" | "review"; operation_id: string; reason: string }
	| { state: "blocked"; reason: string; code?: "verdict_invalid" };

export type ActiveAssuranceState =
	| { state: "running"; operation: "qa"; operation_id: string; deadline_seconds: number }
	| { state: "review_ready"; operation: "review"; operation_id: string }
	| { state: "settlement_unknown"; operation: "qa" | "review"; operation_id: string; reason: string };

export interface AssuranceProgressionPorts {
	projectTask(root: string, taskId: string): Promise<AssuranceProjectionResult>;
	readTaskRecord(root: string, taskId: string): Promise<TaskRecordRead>;
	readTaskIntent(root: string, taskId: string): Promise<TaskIntentRead>;
	frozenRunner(): Promise<FrozenRunner>;
	buildAssurance(
		root: string,
		taskId: string,
		role: AssuranceRole,
		projection: AssuranceProjectionResult,
		runner: FrozenRunner,
	): Promise<{
		snapshot: SnapshotDescriptor;
		descriptors: Map<string, VerificationDescriptor>;
		reviewBundle: ReviewBundle | null;
		reviewManifest?: ReviewManifestV5 | null;
	}>;
	/**
	 * Publish and prove the deterministic task-scoped revision before QA runs, so
	 * a preparation failure can never consume or fake a settled QA attestation.
	 * Returns null for records still on the legacy v3 bundle path.
	 */
	ensureReviewRevision?(
		root: string,
		taskId: string,
		projection: AssuranceProjectionResult,
	): Promise<ReviewRevision | null>;
	runQa(
		snapshot: SnapshotDescriptor,
		descriptors: Map<string, VerificationDescriptor>,
		runner: FrozenRunner,
		options: { signal?: AbortSignal; onProgress?: (progress: QaVerificationProgress) => void },
	): Promise<AssuranceVerdict>;
	writeReviewEvidence(input: { snapshot: SnapshotDescriptor; evidence: ReviewBundle | ReviewManifestV5 }): { path: string; remove(): void };
	applyVerdict(
		ctx: ExtensionContext,
		input: {
			taskId: string;
			snapshot: SnapshotDescriptor;
			verdict: AssuranceVerdict;
			invocation: InvocationToken;
			actorId: string;
			hooks?: {
				beforeCommit?: () => Promise<void>;
				onCommit?: () => void;
				afterCommit?: () => Promise<void>;
			};
		},
	): Promise<void>;
	applyOrdinaryOperation(ctx: ExtensionContext, input: { taskId: string; operation: { op: string; actor_id: string } }): Promise<unknown>;
	advanceBeforeProjection?: () => Promise<void>;
	qaBeforeProjection?: () => Promise<void>;
	qaBeforeAuthorityCommit?: () => Promise<void>;
	qaOnAuthorityCommit?: () => void;
	qaAfterAuthorityCommit?: () => Promise<void>;
	qaJobTimeoutMs?: number;
}

export const QA_MIN_JOB_TIMEOUT_SECONDS = 15 * 60;
export const QA_MAX_JOB_TIMEOUT_SECONDS = 60 * 60;
export const QA_JOB_OVERHEAD_SECONDS = 2 * 60;
export const QA_JOB_TIMEOUT_SECONDS = QA_MIN_JOB_TIMEOUT_SECONDS;
export const REVIEW_PREPARATION_TIMEOUT_MS = 30_000;
export const REVIEW_DISPATCH_TIMEOUT_MS = 120_000;
export const REVIEW_VERDICT_VALIDATION_TIMEOUT_MS = 30_000;
export const ASSURANCE_STALL_MS = 30_000;

type ReviewWorkload = "quick" | "standard" | "heavy";
export interface ReviewTimingProfile { softDeadlineSeconds: number; stopThresholdSeconds: number }
export const REVIEW_TIMING_PROFILES: Readonly<Record<ReviewWorkload, ReviewTimingProfile>> = {
	quick: { softDeadlineSeconds: 5 * 60, stopThresholdSeconds: 15 * 60 },
	standard: { softDeadlineSeconds: 10 * 60, stopThresholdSeconds: 30 * 60 },
	heavy: { softDeadlineSeconds: 20 * 60, stopThresholdSeconds: 60 * 60 },
};

function declaredQaJobTimeoutMs(descriptors: Iterable<Pick<VerificationDescriptor, "timeout_ms">>): number {
	let declaredMs = 0;
	for (const descriptor of descriptors) declaredMs += descriptor.timeout_ms;
	return Math.max(QA_MIN_JOB_TIMEOUT_SECONDS * 1000, declaredMs + QA_JOB_OVERHEAD_SECONDS * 1000);
}

export function deriveQaJobTimeoutMs(descriptors: Iterable<Pick<VerificationDescriptor, "timeout_ms">>): number {
	const derivedMs = declaredQaJobTimeoutMs(descriptors);
	if (derivedMs > QA_MAX_JOB_TIMEOUT_SECONDS * 1000)
		throw new Error(`declared QA budget ${Math.ceil(derivedMs / 60_000)} minutes exceeds the maximum of 60 minutes`);
	return derivedMs;
}

const QUICK_REVIEW_MAX_ACCEPTANCE = 3;
const QUICK_REVIEW_MAX_FILES = 5;
const QUICK_REVIEW_MAX_BYTES = 64 * 1024;
const HEAVY_REVIEW_MIN_ACCEPTANCE = 9;
const HEAVY_REVIEW_MIN_BYTES = 512 * 1024 + 1;

export function classifyReviewWorkload(snapshot: Pick<SnapshotDescriptor, "risk" | "acceptance">, evidence: ReviewBundle | ReviewManifestV5): ReviewWorkload {
	const bytes = Buffer.byteLength(JSON.stringify(evidence));
	const paths = "changed_paths" in evidence ? Object.keys(evidence.changed_paths) : Object.keys(evidence.dirty_files);
	if (snapshot.risk === "critical" || snapshot.acceptance.length >= HEAVY_REVIEW_MIN_ACCEPTANCE || bytes >= HEAVY_REVIEW_MIN_BYTES) return "heavy";
	if (snapshot.risk === "routine" && snapshot.acceptance.length <= QUICK_REVIEW_MAX_ACCEPTANCE && paths.length <= QUICK_REVIEW_MAX_FILES && bytes <= QUICK_REVIEW_MAX_BYTES) return "quick";
	return "standard";
}

export function reviewTurnBudget(workload: ReviewWorkload): number {
	return workload === "quick" ? 12 : workload === "standard" ? 16 : 24;
}

export function snapshotDigest(snapshot: SnapshotDescriptor): string {
	return `sha256:${createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}`;
}

export function buildReviewPrompt(snapshot: SnapshotDescriptor, evidencePath?: string): string {
	if (snapshot.role !== "review") throw new Error("native review prompt requires review role");
	const acceptance = snapshot.acceptance.map((item) => `- ${item.id}: ${item.assertion}`).join("\n");
	const digest = snapshotDigest(snapshot);
	const rolePacket = buildRoleDelegationPacket({
		role: "code-review",
		context: {
			task_id: snapshot.task_id,
			review_gate: "imm-code-review",
			changed_files_signature: snapshot.diff_hash,
			snapshot_digest: digest,
		},
	});
	const revision = snapshot.review_revision;
	const evidenceContract = revision
		? [
				`Review evidence contract: assurance_kernel/review_manifest/v5. The manifest is metadata only; source is read from immutable Git objects.`,
				`Review one immutable Git revision, not live workspace bytes. Read the metadata manifest at ${evidencePath ?? "<evidence-path>"} first; it carries no source. Verify that git rev-parse ${revision.base_head} and git rev-parse ${revision.review_commit} both resolve, that ${revision.review_commit}^{} is a commit whose only parent is ${revision.base_head}, and that its tree is ${revision.review_tree}.`,
				`Analyze the change with git diff ${revision.base_head} ${revision.review_commit} (and git show ${revision.review_commit}:<path> for full files). Every path in changed_paths is the task's work: added, modified, or deleted since Enrollment. Deleted paths have a null oid. Never treat a path that is absent from ${revision.base_head} as pre-existing, and never review files outside the revision.`,
				`Unchanged files are not part of the mutation authority. Read one only when it is directly required by an acceptance assertion, a changed caller, or the same state machine, and cite the path plus the reason in your finding. Repository-wide exploration is out of scope.`,
				`The user-selected worktree may contain staged or committed work that is not in this revision, and revision objects may not be checked out anywhere. Do not read working-tree files as evidence; git object reads against the shared object database are the only source of truth.`,
			]
		: [
				`Verify immutable bundle provenance before analyzing findings. Review the immutable evidence JSON at ${evidencePath ?? "<evidence-path>"}. Read that file first; verify that git rev-parse HEAD in the isolated reviewer worktree equals bundle.head. For every tracked dirty_files entry, verify git rev-parse HEAD:<path> equals base_oid, then compare that immutable HEAD blob with current_content. A null base_oid denotes an untracked current file; a null current_content denotes a deletion. Do not inspect or depend on live task bytes outside the immutable bundle.`,
				`Limit repository inspection to the acceptance assertions and dirty_files contents in the immutable bundle. Do not explore unrelated repository paths.`,
				`The user-selected worktree may contain staged task changes that are absent from the isolated reviewer worktree. Review authority is bound only to the bundle dirty_files current_content bytes and committed HEAD provenance. Analyze code exclusively from those bundle bytes; repository file reads are permitted only for the provenance git commands above. A symbol present in current_content but absent from HEAD is the task change, not an absence.`,
			];
	return [
		rolePacket.prompt,
		...evidenceContract,
		`Do not edit files, create files, run mutating commands, or change Git state. Focus on correctness, regressions, security, and missing tests.`,
		`Execution outcomes for every acceptance were verified deterministically by the Kernel QA layer before this review and are embedded in this bundle under outcomes (the immutable evidence file, acceptance_id -> {status, summary}); do not re-execute descriptors and do not treat the absence of local test runs as a finding. Your review covers evidence provenance, code correctness, regressions, security, and missing tests against the embedded assertions and code.`,
		`Snapshot digest: ${digest}`,
		`TaskRecord revision: ${snapshot.record_revision}`,
		revision
			? `Intent revision ${snapshot.intent_revision} (hash ${snapshot.intent_content_hash}), diff ${snapshot.diff_hash}, review revision ${revision.review_commit} (base ${revision.base_head}, tree ${revision.review_tree}, manifest ${revision.manifest_digest}), state ${snapshot.lifecycle}:${snapshot.artifact_state}.`
			: `Intent revision ${snapshot.intent_revision} (hash ${snapshot.intent_content_hash}), diff ${snapshot.diff_hash}, review bundle ${snapshot.review_bundle_digest}, state ${snapshot.lifecycle}:${snapshot.artifact_state}.`,
		"Acceptance assertions:", acceptance,
		"Reserve the final turn for exactly one strict JSON verdict. Reply with ONLY that object, without markdown fences or commentary.",
		`PASS shape: {"contract":"assurance_kernel/assurance_verdict/v2","role":"review","task_id":"${snapshot.task_id}","snapshot_digest":"${digest}","decision":"pass","approval":{"kind":"review","authority_role":"reviewer","summary":"<one line>"}}`,
		`REWORK shape: {"contract":"assurance_kernel/assurance_verdict/v2","role":"review","task_id":"${snapshot.task_id}","snapshot_digest":"${digest}","decision":"rework","findings":[{"id":"review-1","kind":"blocking|advisory","acceptance_id":"<id|null>","summary":"<one line>"}]}`,
		`REWORK verdicts must omit the approval field entirely; do not emit "approval": null.`,
	].join("\n");
}

export function parseAssuranceVerdict(input: unknown, snapshot: SnapshotDescriptor): AssuranceVerdict {
	let raw: Record<string, unknown>;
	if (typeof input === "string") {
		const cleaned = input.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("{") && line.endsWith("}")).join("");
		if (!cleaned) throw new Error("reviewer returned no strict JSON verdict");
		try { raw = JSON.parse(cleaned) as Record<string, unknown>; } catch { throw new Error("reviewer verdict is not valid JSON"); }
	} else if (typeof input === "object" && input !== null && !Array.isArray(input)) {
		raw = input as Record<string, unknown>;
	} else {
		throw new Error("reviewer verdict must be a JSON object");
	}
	const allowed = ["contract", "role", "task_id", "snapshot_digest", "decision", "approval", "findings"];
	const unknown = Object.keys(raw).find((key) => !allowed.includes(key));
	if (unknown) throw new Error(`child verdict has unknown field: ${unknown}`);
	if (raw.contract !== "assurance_kernel/assurance_verdict/v2") throw new Error("assurance verdict contract is invalid");
	if (raw.role !== snapshot.role) throw new Error("child verdict role mismatch");
	if (raw.task_id !== snapshot.task_id) throw new Error("child verdict task mismatch");
	if (raw.snapshot_digest !== snapshotDigest(snapshot)) throw new Error("child verdict snapshot digest mismatch");
	if (raw.decision !== "pass" && raw.decision !== "rework") throw new Error("child verdict decision must be pass or rework");
	if (raw.decision === "pass") {
		const approval = raw.approval as Record<string, unknown> | undefined;
		const expectedKind = snapshot.role === "qa" ? "qa" : "review";
		const expectedRole = snapshot.role === "qa" ? "qa" : "reviewer";
		if (!approval || approval.kind !== expectedKind || approval.authority_role !== expectedRole || typeof approval.summary !== "string" || !approval.summary.trim()) throw new Error("pass verdict approval is invalid");
		const unknownApproval = Object.keys(approval).find((key) => !["kind", "authority_role", "summary"].includes(key));
		if (unknownApproval) throw new Error(`pass verdict approval has unknown field: ${unknownApproval}`);
		if (raw.findings !== undefined) throw new Error("pass verdict must omit findings");
		return { contract: "assurance_kernel/assurance_verdict/v2", role: snapshot.role, task_id: snapshot.task_id, snapshot_digest: snapshotDigest(snapshot), decision: "pass", approval: { kind: expectedKind, authority_role: expectedRole, summary: approval.summary } };
	}
	if (!Array.isArray(raw.findings) || raw.findings.length === 0) throw new Error("rework verdict findings are invalid");
	if (raw.approval !== undefined && raw.approval !== null) throw new Error("rework verdict must omit approval");
	const findings = raw.findings.map((item, index) => {
		const finding = item as Record<string, unknown>;
		const unknownFinding = Object.keys(finding).find((key) => !["id", "kind", "acceptance_id", "summary"].includes(key));
		if (unknownFinding) throw new Error(`finding ${index} has unknown field: ${unknownFinding}`);
		if (typeof finding.id !== "string" || !finding.id.trim() || (finding.kind !== "blocking" && finding.kind !== "advisory") || (finding.acceptance_id !== null && typeof finding.acceptance_id !== "string") || typeof finding.summary !== "string" || !finding.summary.trim()) throw new Error(`finding ${index} is invalid`);
		const id = `review-${snapshotDigest(snapshot).slice(7, 19)}-${index + 1}-${finding.id.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 48)}`;
		const normalized = { id, kind: finding.kind as "blocking" | "advisory", acceptance_id: finding.acceptance_id as string | null, summary: finding.summary as string };
		return { ...normalized, findings_digest: findingsDigest([normalized]) };
	});
	return { contract: "assurance_kernel/assurance_verdict/v2", role: snapshot.role, task_id: snapshot.task_id, snapshot_digest: snapshotDigest(snapshot), decision: "rework", findings };
}

interface ReviewReservation {
	taskId: string;
	operationId: string;
	snapshot: SnapshotDescriptor;
	params: ReservedAgentParams;
	verdictCorrectionRequired: boolean;
	evidence: { path: string; remove(): void };
}

export const invocationRegistry = createInvocationRegistry();

export class AssuranceProgression {
	private readonly activeOperations = new Map<string, string>();
	private readonly operationControllers = new Map<string, { operationId: string; controller: AbortController }>();
	private readonly reviewReservations = new Map<string, ReviewReservation>();
	private readonly rejectedReviewOperations = new Map<string, { operationId: string; reason: string }>();
	private readonly unknownOperations = new Map<string, { operation: "qa" | "review"; operationId: string; reason: string }>();
	private readonly sessionInvocations = new Set<InvocationToken>();
	private sessionActive = true;
	private sessionGeneration = 0;

	constructor(private readonly ports: AssuranceProgressionPorts) {}

	onSessionStart(): void {
		this.sessionActive = true;
		this.sessionGeneration += 1;
	}

	async onSessionShutdown(): Promise<void> {
		this.sessionActive = false;
		this.sessionGeneration += 1;
		for (const { controller } of this.operationControllers.values()) {
			if (!controller.signal.aborted) controller.abort(new Error("session shutdown"));
		}
		this.operationControllers.clear();
		this.activeOperations.clear();
		this.rejectedReviewOperations.clear();
		for (const reservation of this.reviewReservations.values()) this.removeEvidence(reservation);
		this.reviewReservations.clear();
		for (const invocation of [...this.sessionInvocations]) this.closeSessionInvocation(invocation);
	}

	active(taskId: string): ActiveAssuranceState | null {
		const operationId = this.activeOperations.get(taskId);
		if (operationId) return { state: "running", operation: "qa", operation_id: operationId, deadline_seconds: QA_JOB_TIMEOUT_SECONDS };
		const reservation = this.reviewReservations.get(taskId);
		if (reservation) return { state: "review_ready", operation: "review", operation_id: reservation.operationId };
		const unknown = this.unknownOperations.get(taskId);
		if (unknown) return { state: "settlement_unknown", operation: unknown.operation, operation_id: unknown.operationId, reason: unknown.reason };
		return null;
	}

	openInvocation(taskId: string): InvocationToken {
		const invocation = invocationRegistry.open(taskId);
		this.sessionInvocations.add(invocation);
		return invocation;
	}
	closeInvocation(invocation: InvocationToken): void { this.closeSessionInvocation(invocation); }
	private closeSessionInvocation(invocation: InvocationToken): void {
		try { invocationRegistry.cancel(invocation); } catch { /* already terminal */ }
		this.sessionInvocations.delete(invocation);
	}
	commitInvocation(invocation: InvocationToken): void { invocationRegistry.commit(invocation); }
	invocationState(invocation: InvocationToken): InvocationState { return invocationRegistry.stateOf(invocation); }
	isInvocationOpen(taskId: string): boolean { return invocationRegistry.isOpen(taskId); }
	sessionActiveValue(): boolean { return this.sessionActive; }
	sessionGenerationValue(): number { return this.sessionGeneration; }

	async advance(taskId: string, ctx: ExtensionContext, signal?: AbortSignal, onUpdate?: (update: ForegroundToolUpdate) => void): Promise<AssuranceAdvanceResult> {
		const active = this.active(taskId);
		if (active?.state === "review_ready") {
			const reservation = this.reviewReservations.get(taskId);
			let projection: AssuranceProjectionResult;
			try {
				projection = await this.ports.projectTask(ctx.cwd, taskId);
			} catch (error) {
				return { state: "blocked", reason: `cannot validate Review reservation: ${boundedAssuranceError(error)}` };
			}
			const current = projection.projection;
			const matches = !projection.error
				&& projection.claim?.task_id === taskId
				&& current.lifecycle === "active"
				&& current.next_obligation === "run_review"
				&& reservation !== undefined
				&& reservation.snapshot.record_revision === current.record_revision
				&& reservation.snapshot.workspace_revision === current.workspace_revision
				&& reservation.snapshot.intent_revision === current.intent_revision
				&& reservation.snapshot.intent_content_hash === current.intent_content_hash
				&& reservation.snapshot.diff_hash === current.diff_hash;
			if (matches) return this.reviewReadyResult(taskId);
			if (reservation) this.releaseReviewReservation(taskId, reservation);
			this.rejectedReviewOperations.delete(taskId);
		}
		const refreshed = this.active(taskId);
		if (refreshed?.state === "settlement_unknown") return refreshed;
		if (refreshed?.state === "running") return { state: "blocked", reason: `assurance operation ${refreshed.operation_id} is already running` };
		const operationId = randomUUID();
		const operationGeneration = this.sessionGeneration;
		const operationController = new AbortController();
		const relayExternalAbort = () => operationController.abort(
			signal?.reason instanceof Error ? signal.reason : new Error("assurance operation cancelled"),
		);
		signal?.addEventListener("abort", relayExternalAbort, { once: true });
		if (signal?.aborted) relayExternalAbort();
		this.activeOperations.set(taskId, operationId);
		this.operationControllers.set(taskId, { operationId, controller: operationController });
		this.rejectedReviewOperations.delete(taskId);
		let authorityCommitted = false;
		let authorityBoundaryStarted = false;
		let reviewPreparationStarted = false;
		let phase = "preparing";
		const operationLive = () => this.sessionActive
			&& this.sessionGeneration === operationGeneration
			&& this.activeOperations.get(taskId) === operationId
			&& !operationController.signal.aborted;
		const ensureOperationLive = () => {
			if (!operationLive()) throw new VerificationAbortedError();
		};
		const progress = (stage: string, summary: string, details: Record<string, unknown> = {}) => {
			phase = stage;
			onUpdate?.({ content: [{ type: "text", text: summary }], details: { state: "running", operation: "qa", operation_id: operationId, stage, ...details } });
		};
		const aborted = () => operationController.signal.aborted;
		try {
			ensureOperationLive();
			progress(phase, `Preparing deterministic QA for ${taskId}`);
			await this.ports.advanceBeforeProjection?.();
			ensureOperationLive();
			let projection = await this.ports.projectTask(ctx.cwd, taskId);
			ensureOperationLive();
			if (projection.error) return { state: "blocked", reason: projection.error };
			if (projection.projection.lifecycle === "done") return { state: "completed" };
			if (projection.projection.lifecycle === "stopped") return { state: "stopped" };
			if (!projection.claim) return { state: "blocked", reason: "no active backend claim" };
			if (projection.claim.task_id !== taskId) return { state: "blocked", reason: `backend claim belongs to ${projection.claim.task_id}, not ${taskId}` };
			const parked = await this.ports.readTaskRecord(ctx.cwd, taskId);
			ensureOperationLive();
			if (parked.record?.findings.some((finding) => finding.kind === "replan_required" && finding.status === "open")) return { state: "blocked", reason: "review rework limit reached; a durable replan is required" };
			if (projection.projection.artifact_state === "active") {
				if (projection.projection.next_obligation !== "submit_assurance")
					return { state: "blocked", reason: `Kernel requires ${projection.projection.next_obligation}` };
				if (aborted()) return this.cancelled("qa", operationId, "host cancellation before artifact freeze");
				progress("freezing_artifacts", "Freezing planning artifacts for deterministic assurance");
				const freeze = this.ports.applyOrdinaryOperation(ctx, { taskId, operation: { op: "freeze_artifacts", actor_id: "executor" } });
				authorityBoundaryStarted = true;
				await freeze;
				ensureOperationLive();
				projection = await this.ports.projectTask(ctx.cwd, taskId);
				ensureOperationLive();
				if (projection.error || projection.projection.lifecycle !== "active" || projection.projection.artifact_state !== "frozen")
					return this.unknownAfterCommit(taskId, "qa", operationId, projection.error ?? "artifact freeze did not settle");
				// The freeze outcome is proven by the re-projection above, so later
				// read-only preparation failures are never a committed-authority mystery.
				authorityBoundaryStarted = false;
			}
			if (projection.projection.next_obligation === "complete") {
				progress("completing", "Completing the routine task after deterministic QA");
				try {
					await this.ports.applyOrdinaryOperation(ctx, { taskId, operation: { op: "complete", actor_id: "kernel-assurance" } });
					return { state: "completed" };
				} catch (error) {
					return this.unknownAfterCommit(taskId, "qa", operationId, boundedAssuranceError(error));
				}
			}
			if (projection.projection.next_obligation === "authorize_user")
				return { state: "awaiting_user", operation: "record-user-approval", operation_id: operationId };
			if (projection.projection.next_obligation !== "run_qa" && projection.projection.next_obligation !== "run_review")
				return { state: "blocked", reason: `Kernel requires ${projection.projection.next_obligation}` };
			const qaAlreadySettled = projection.projection.next_obligation === "run_review";
			if (qaAlreadySettled) reviewPreparationStarted = true;
			const runner = await this.ports.frozenRunner();
			ensureOperationLive();
			// Prove the immutable Review revision before any descriptor runs. A task
			// that cannot publish its revision must stop with zero QA attestation
			// rather than approving bytes nobody can review.
			if (!qaAlreadySettled && projection.projection.risk !== "routine") {
				progress("preparing_review_revision", "Proving the immutable Review revision before QA");
				try {
					if (parked.record?.contract === "assurance_kernel/task_record/v4") {
						if (!this.ports.ensureReviewRevision)
							throw new Error("v4 Review revision preparation is unavailable");
						await this.ports.ensureReviewRevision(ctx.cwd, taskId, projection);
					}
				} catch (error) {
					return { state: "blocked", reason: `review revision preparation failed: ${boundedAssuranceError(error)}` };
				}
				ensureOperationLive();
			}
			let qaVerdict: AssuranceVerdict | undefined;
			if (qaAlreadySettled) {
				progress("resuming_review", "Resuming Review preparation from the Kernel assurance projection");
			} else {
				progress("capturing_snapshot", "Capturing the immutable QA snapshot");
				await this.ports.qaBeforeProjection?.();
				ensureOperationLive();
				const assurance = await this.ports.buildAssurance(ctx.cwd, taskId, "qa", projection, runner);
				ensureOperationLive();
				qaVerdict = await this.ports.runQa(assurance.snapshot, assurance.descriptors, runner, {
					signal: operationController.signal,
					onProgress: (item) => progress("verifying", `QA ${item.index}/${item.total} ${item.acceptance_id} ${item.phase}`, { current: item.index, total: item.total, acceptance_id: item.acceptance_id }),
				});
				ensureOperationLive();
				const invocation = this.openInvocation(taskId);
				try {
					progress("settling_qa", "Settling deterministic QA through the Kernel revision boundary");
					authorityBoundaryStarted = true;
					await this.ports.applyVerdict(ctx, {
						taskId,
						snapshot: assurance.snapshot,
						verdict: qaVerdict,
						invocation,
						actorId: "deterministic-qa",
						hooks: {
							beforeCommit: async () => {
								ensureOperationLive();
								await this.ports.qaBeforeAuthorityCommit?.();
								ensureOperationLive();
							},
							onCommit: () => { authorityCommitted = true; this.ports.qaOnAuthorityCommit?.(); },
							afterCommit: async () => {
								await this.ports.qaAfterAuthorityCommit?.();
							},
						},
					});
					if (!(authorityCommitted && aborted())) {
						ensureOperationLive();
						authorityBoundaryStarted = false;
					}
				} catch (error) {
					if (!authorityCommitted && (aborted() || error instanceof VerificationAbortedError)) return this.cancelled("qa", operationId, "host cancellation before QA authority commit");
					return authorityCommitted
						? this.unknownAfterCommit(taskId, "qa", operationId, boundedAssuranceError(error))
						: { state: "failed", operation: "qa", operation_id: operationId, reason: boundedAssuranceError(error) };
				} finally {
					if (this.invocationState(invocation) === "open") this.closeInvocation(invocation);
				}
			}
			if (qaVerdict?.decision === "rework") return { state: "rework", operation: "qa", operation_id: operationId, summary: qaVerdict.findings?.map((finding) => finding.summary).join("; ") ?? "deterministic QA requested rework" };
			if (!(authorityCommitted && aborted())) ensureOperationLive();
			progress("preparing_review", "Preparing the reserved foreground Review bundle");
			let fresh: AssuranceProjectionResult;
			try {
				fresh = await this.ports.projectTask(ctx.cwd, taskId);
			} catch (error) {
				return this.reviewPreparationFailed(taskId, operationId, boundedAssuranceError(error));
			}
			if (fresh.error || !fresh.claim) {
				if (qaAlreadySettled) return this.reviewPreparationFailed(taskId, operationId, fresh.error ?? "claim disappeared after QA settlement");
				return this.unknownAfterCommit(taskId, "qa", operationId, fresh.error ?? "claim disappeared after QA settlement");
			}
			if (fresh.projection.next_obligation === "complete") {
				progress("completing", "Deterministic QA passed; completing the routine task");
				try {
					await this.ports.applyOrdinaryOperation(ctx, { taskId, operation: { op: "complete", actor_id: "kernel-assurance" } });
					return { state: "completed" };
				} catch (error) {
					return this.unknownAfterCommit(taskId, "qa", operationId, boundedAssuranceError(error));
				}
			}
			if (fresh.projection.next_obligation === "authorize_user")
				return { state: "awaiting_user", operation: "record-user-approval", operation_id: operationId };
			if (fresh.projection.next_obligation !== "run_review") {
				if (authorityCommitted && aborted()) return this.unknownAfterCommit(taskId, "qa", operationId, "QA settlement projection did not require Review after cancellation");
				return { state: "blocked", reason: `Kernel requires ${fresh.projection.next_obligation} after QA` };
			}
			reviewPreparationStarted = true;
			authorityCommitted = false;
			authorityBoundaryStarted = false;
			if (aborted()) return this.reviewPreparationFailed(taskId, operationId, "host cancellation after QA authority settlement");
			progress("preparing_review", "Preparing the reserved foreground Review evidence");
			let review: Awaited<ReturnType<AssuranceProgressionPorts["buildAssurance"]>>;
			let evidence: { path: string; remove(): void };
			try {
				review = await this.ports.buildAssurance(ctx.cwd, taskId, "review", fresh, runner);
				const payload = review.reviewManifest ?? review.reviewBundle;
				if (!payload) throw new Error("review evidence is missing after QA settlement");
				evidence = this.ports.writeReviewEvidence({ snapshot: review.snapshot, evidence: payload });
			} catch (error) {
				// QA authority is already settled and durable; only the read-only
				// evidence transport failed. Keep run_review and allow a retry.
				return this.reviewPreparationFailed(taskId, operationId, boundedAssuranceError(error));
			}
			try {
				ensureOperationLive();
			} catch (error) {
				try { evidence.remove(); } catch { /* cleanup cannot create authority */ }
				throw error;
			}
			const reservation: ReviewReservation = {
				taskId,
				operationId,
				snapshot: review.snapshot,
				params: { subagent_type: "Review", description: "", prompt: "", name: "", model: "", thinking: "", inherit_context: false, isolated: true, isolation: "worktree", run_in_background: false, max_turns: 0, resume: "", schedule: "" },
				verdictCorrectionRequired: false,
				evidence,
			};
			this.reviewReservations.set(taskId, reservation);
			try {
				ensureOperationLive();
				const workload = classifyReviewWorkload(review.snapshot, review.reviewManifest ?? review.reviewBundle!);
				reservation.params = reservedAgentParams({ taskId, operationId, prompt: buildReviewPrompt(review.snapshot, evidence.path), max_turns: reviewTurnBudget(workload) });
				ensureOperationLive();
			} catch (error) {
				this.releaseReviewReservation(taskId, reservation);
				return this.reviewPreparationFailed(taskId, operationId, boundedAssuranceError(error));
			}
			progress("review_ready", "QA passed; invoke the foreground reviewer, then submit its verdict", { snapshot_digest: snapshotDigest(review.snapshot), review_bundle_digest: review.snapshot.review_bundle_digest ?? "", agent_params: reservation.params });
			return { state: "review_ready", operation: "review", operation_id: operationId, snapshot_digest: snapshotDigest(review.snapshot), review_bundle_digest: review.snapshot.review_bundle_digest ?? "", agent_params: reservation.params };
		} catch (error) {
			if (reviewPreparationStarted) {
				const reason = aborted() || error instanceof VerificationAbortedError
					? `${phase}: host cancellation`
					: `${phase}: ${boundedAssuranceError(error)}`;
				return this.reviewPreparationFailed(taskId, operationId, reason);
			}
			if (authorityCommitted || authorityBoundaryStarted) return this.unknownAfterCommit(taskId, "qa", operationId, `${phase}: ${boundedAssuranceError(error)}`);
			if (aborted() || error instanceof VerificationAbortedError) return this.cancelled("qa", operationId, `${phase}: host cancellation`);
			return { state: "failed", operation: "qa", operation_id: operationId, reason: `${phase}: ${boundedAssuranceError(error)}` };
		} finally {
			if (this.activeOperations.get(taskId) === operationId) this.activeOperations.delete(taskId);
			const controller = this.operationControllers.get(taskId);
			if (controller?.operationId === operationId) this.operationControllers.delete(taskId);
			signal?.removeEventListener("abort", relayExternalAbort);
		}
	}

	async submitReview(taskId: string, ctx: ExtensionContext, verdictInput: unknown): Promise<AssuranceSubmitReviewResult> {
		const unknown = this.unknownOperations.get(taskId);
		if (unknown) { this.unknownOperations.delete(taskId); return { state: "settlement_unknown", operation: unknown.operation, operation_id: unknown.operationId, reason: unknown.reason }; }
		const rejected = this.rejectedReviewOperations.get(taskId);
		if (rejected) return { state: "blocked", reason: rejected.reason };
		const reservation = this.reviewReservations.get(taskId);
		if (!reservation) return { state: "blocked", reason: "no active Review operation" };
		let fresh: AssuranceProjectionResult;
		try {
			fresh = await this.ports.projectTask(ctx.cwd, taskId);
		} catch (error) {
			const reason = boundedAssuranceError(error);
			this.releaseReviewReservation(taskId, reservation, reason);
			return { state: "blocked", reason };
		}
		if (fresh.error || !fresh.claim || fresh.claim.task_id !== taskId || fresh.projection.record_revision !== reservation.snapshot.record_revision || fresh.projection.workspace_revision !== reservation.snapshot.workspace_revision || fresh.projection.intent_revision !== reservation.snapshot.intent_revision || fresh.projection.intent_content_hash !== reservation.snapshot.intent_content_hash || fresh.projection.diff_hash !== reservation.snapshot.diff_hash || fresh.projection.lifecycle !== reservation.snapshot.lifecycle || fresh.projection.artifact_state !== reservation.snapshot.artifact_state) {
			const reason = fresh.error ?? "assurance snapshot changed before Review submission";
			this.releaseReviewReservation(taskId, reservation, reason);
			return { state: "blocked", reason };
		}
		if (reservation.snapshot.review_revision) {
			try {
				if (!this.ports.ensureReviewRevision)
					throw new Error("v4 Review revision verification is unavailable");
				const revision = await this.ports.ensureReviewRevision(ctx.cwd, taskId, fresh);
				if (!revision || revision.base_head !== reservation.snapshot.review_revision.base_head || revision.review_commit !== reservation.snapshot.review_revision.review_commit || revision.review_tree !== reservation.snapshot.review_revision.review_tree || revision.manifest_digest !== reservation.snapshot.review_revision.manifest_digest)
					throw new Error("Review revision changed before submission");
			} catch (error) {
				return this.reviewPreparationFailed(taskId, reservation.operationId, boundedAssuranceError(error));
			}
		}
		let verdict: AssuranceVerdict;
		try { verdict = parseAssuranceVerdict(verdictInput, reservation.snapshot); }
		catch (error) {
			reservation.verdictCorrectionRequired = true;
			return { state: "blocked", code: "verdict_invalid", reason: boundedAssuranceError(error) };
		}
		const invocation = this.openInvocation(taskId);
		this.releaseReviewReservation(taskId, reservation);
		try {
			await this.ports.applyVerdict(ctx, {
				taskId,
				snapshot: reservation.snapshot,
				verdict,
				invocation,
				actorId: "parent-mediated-review",
			});
		} catch (error) {
			const reason = boundedAssuranceError(error);
			return this.invocationState(invocation) === "committed"
				? this.unknownAfterCommit(taskId, "review", reservation.operationId, reason)
				: { state: "blocked", reason };
		} finally {
			this.closeInvocation(invocation);
		}
		if (verdict.decision === "rework") {
			return {
				state: "rework",
				operation: "review",
				operation_id: reservation.operationId,
				summary: verdict.findings?.map((finding) => finding.summary).join("; ") ?? "independent Review requested rework",
			};
		}
		let settled: AssuranceProjectionResult;
		try {
			settled = await this.ports.projectTask(ctx.cwd, taskId);
		} catch (error) {
			return this.unknownAfterCommit(taskId, "review", reservation.operationId, boundedAssuranceError(error));
		}
		if (settled.error || !settled.claim)
			return this.unknownAfterCommit(taskId, "review", reservation.operationId, settled.error ?? "claim disappeared after Review settlement");
		if (settled.projection.next_obligation === "complete") {
			try {
				await this.ports.applyOrdinaryOperation(ctx, { taskId, operation: { op: "complete", actor_id: "kernel-assurance" } });
				return { state: "completed" };
			} catch (error) {
				return this.unknownAfterCommit(taskId, "review", reservation.operationId, boundedAssuranceError(error));
			}
		}
		if (settled.projection.next_obligation === "authorize_user")
			return { state: "awaiting_user", operation: "record-user-approval", operation_id: reservation.operationId };
		return { state: "blocked", reason: `Kernel requires ${settled.projection.next_obligation} after Review` };
	}

	private reviewReadyResult(taskId: string): AssuranceAdvanceResult {
		const reservation = this.reviewReservations.get(taskId);
		if (!reservation) return { state: "blocked", reason: "Review reservation disappeared" };
		if (reservation.verdictCorrectionRequired) return { state: "blocked", code: "verdict_invalid", reason: "Review verdict correction is required before advancing" };
		return { state: "review_ready", operation: "review", operation_id: reservation.operationId, snapshot_digest: snapshotDigest(reservation.snapshot), review_bundle_digest: reservation.snapshot.review_bundle_digest ?? "", agent_params: reservation.params };
	}

	private releaseReviewReservation(taskId: string, reservation: ReviewReservation, rejectionReason?: string): void {
		if (this.reviewReservations.get(taskId) !== reservation) return;
		this.reviewReservations.delete(taskId);
		if (rejectionReason) this.rejectedReviewOperations.set(taskId, { operationId: reservation.operationId, reason: rejectionReason });
		this.removeEvidence(reservation);
	}

	private removeEvidence(reservation: ReviewReservation): void {
		try { reservation.evidence.remove(); } catch { /* cleanup cannot create authority */ }
	}

	private cancelled(operation: "qa" | "review", operationId: string, reason: string): AssuranceAdvanceResult {
		return { state: "cancelled", operation, operation_id: operationId, reason };
	}

	private reviewPreparationFailed(
		taskId: string,
		operationId: string,
		reason: string,
	): Extract<AssuranceAdvanceResult, { state: "review_preparation_failed" }> {
		const reservation = this.reviewReservations.get(taskId);
		if (reservation) this.releaseReviewReservation(taskId, reservation);
		this.rejectedReviewOperations.delete(taskId);
		return { state: "review_preparation_failed", operation: "review", operation_id: operationId, reason };
	}

	private unknownAfterCommit(taskId: string, operation: "qa" | "review", operationId: string, reason: string): AssuranceAdvanceResult {
		this.unknownOperations.set(taskId, { operation, operationId, reason });
		return { state: "settlement_unknown", operation, operation_id: operationId, reason };
	}
}

function boundedAssuranceError(error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error);
	const normalized = raw.replace(/\s+/g, " ").trim() || "unknown error";
	return normalized.length <= 300 ? normalized : `${normalized.slice(0, 299)}...`;
}
