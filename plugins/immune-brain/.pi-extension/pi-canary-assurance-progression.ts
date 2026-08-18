// Foreground Assurance progression for one Pi session.
//
// Deterministic QA runs to completion inside the caller's Tool execution. A
// successful QA pass creates one short-lived native Review reservation; the
// Parent then invokes the exact foreground Agent arguments returned by the
// Tool and explicitly calls submit_review. No lifecycle work survives a Tool
// call except that reservation and its uncommitted native receipt.

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
import type { ReviewBundle } from "./pi-canary-review-bundle";
import {
	matchesReservedAgentArgs,
	parseForegroundAgentResult,
	reservedAgentParams,
	STANDARD_AGENT_TOOL,
	nativeReviewResultIsFailure,
	type NativeReviewResult,
	type ReservedAgentParams,
	type ToolResultLike,
	type ToolExecutionEndLike,
} from "./pi-canary-native-review";
import type { AssuranceCorrelation, AssuranceRole, AssuranceResultPresentation } from "./pi-canary-assurance";
import {
	buildRoleDelegationPacket,
} from "../runtime/role_prompt_bridge";
import type { AssuranceProjectionResult, TaskIntentRead, TaskRecordV2Read } from "./runtime-stub";

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

export interface SnapshotDescriptor {
	contract: "assurance_kernel/assurance_snapshot/v1";
	task_id: string;
	role: AssuranceRole;
	record_revision: string;
	workspace_revision: string;
	intent_revision: number;
	intent_content_hash: string;
	diff_hash: string;
	phase: string;
	risk: "routine" | "material" | "critical";
	fresh_acceptance_ids: string[];
	missing_acceptance_ids: string[];
	stale_evidence_ids: string[];
	acceptance: Array<{ id: string; assertion: string; verification: string }>;
	dirty_files: string[];
	review_bundle_digest: string | null;
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
	| { state: "rework"; operation: "qa"; operation_id: string; summary: string }
	| { state: "cancelled"; operation: "qa" | "review"; operation_id: string; reason: string }
	| { state: "failed"; operation: "qa" | "review"; operation_id: string; reason: string }
	| { state: "settlement_unknown"; operation: "qa" | "review"; operation_id: string; reason: string }
	| { state: "blocked"; reason: string }
	| { state: "completed" };

export type AssuranceSubmitReviewResult =
	| { state: "awaiting_user"; operation: "record-review-verdict"; operation_id: string }
	| { state: "settlement_unknown"; operation: "qa" | "review"; operation_id: string; reason: string }
	| { state: "blocked"; reason: string };

export type ActiveAssuranceState =
	| { state: "running"; operation: "qa"; operation_id: string; deadline_seconds: number }
	| { state: "review_ready"; operation: "review"; operation_id: string }
	| { state: "awaiting_user"; operation: "review"; operation_id: string }
	| { state: "settlement_unknown"; operation: "qa" | "review"; operation_id: string; reason: string };

export interface AssuranceProgressionPorts {
	projectTask(root: string, taskId: string): Promise<AssuranceProjectionResult>;
	readTaskRecordV2(root: string, taskId: string): Promise<TaskRecordV2Read>;
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
	}>;
	runQa(
		snapshot: SnapshotDescriptor,
		descriptors: Map<string, VerificationDescriptor>,
		runner: FrozenRunner,
		options: { signal?: AbortSignal; onProgress?: (progress: QaVerificationProgress) => void },
	): Promise<AssuranceVerdict>;
	writeReviewEvidence(input: { snapshot: SnapshotDescriptor; review_bundle: ReviewBundle }): { path: string; remove(): void };
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

export function classifyReviewWorkload(snapshot: Pick<SnapshotDescriptor, "risk" | "acceptance">, bundle: ReviewBundle): ReviewWorkload {
	const bytes = Buffer.byteLength(JSON.stringify(bundle));
	if (snapshot.risk === "critical" || snapshot.acceptance.length >= HEAVY_REVIEW_MIN_ACCEPTANCE || bytes >= HEAVY_REVIEW_MIN_BYTES) return "heavy";
	if (snapshot.risk === "routine" && snapshot.acceptance.length <= QUICK_REVIEW_MAX_ACCEPTANCE && Object.keys(bundle.dirty_files).length <= QUICK_REVIEW_MAX_FILES && bytes <= QUICK_REVIEW_MAX_BYTES) return "quick";
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
	return [
		rolePacket.prompt,

		`Verify immutable bundle provenance before analyzing findings. Review the immutable evidence JSON at ${evidencePath ?? "<evidence-path>"}. Read that file first; verify that git rev-parse HEAD equals bundle.head in the isolated worktree. For every tracked dirty_files entry, verify git rev-parse HEAD:<path> equals base_oid, then compare that immutable HEAD blob with current_content. A null base_oid denotes an untracked current file; a null current_content denotes a deletion. Do not inspect or depend on live bytes from the parent worktree.`,
		`Limit repository inspection to the acceptance assertions and dirty_files contents in the immutable bundle. Do not explore unrelated repository paths.`,
		`The isolated worktree contains the committed HEAD snapshot only; staged task changes exist solely in the bundle dirty_files entries as current_content bytes. Analyze code exclusively from those bundle bytes; repository file reads are permitted only for the provenance git commands above. A symbol missing from the worktree but present in current_content is the task change, not an absence.`,
		`Do not edit files, create files, run mutating commands, or change Git state. Focus on correctness, regressions, security, and missing tests.`,
		`Execution outcomes for every acceptance were verified deterministically by the Kernel QA layer before this review and are embedded in this bundle under outcomes (acceptance_id -> {status, summary}); do not re-execute descriptors and do not treat the absence of local test runs as a finding. Your review covers bundle provenance, code correctness, regressions, security, and missing tests against the embedded assertions and code bytes.`,
		`Snapshot digest: ${digest}`,
		`TaskRecord revision: ${snapshot.record_revision}`,
		`Intent revision ${snapshot.intent_revision} (hash ${snapshot.intent_content_hash}), diff ${snapshot.diff_hash}, review bundle ${snapshot.review_bundle_digest}, phase ${snapshot.phase}.`,
		"Acceptance assertions:", acceptance,
		"Reserve the final turn for exactly one strict JSON verdict. Reply with ONLY that object, without markdown fences or commentary.",
		`PASS shape: {"contract":"assurance_kernel/assurance_verdict/v2","role":"review","task_id":"${snapshot.task_id}","snapshot_digest":"${digest}","decision":"pass","approval":{"kind":"review","authority_role":"reviewer","summary":"<one line>"}}`,
		`REWORK shape: {"contract":"assurance_kernel/assurance_verdict/v2","role":"review","task_id":"${snapshot.task_id}","snapshot_digest":"${digest}","decision":"rework","findings":[{"id":"review-1","kind":"blocking|advisory","acceptance_id":"<id|null>","summary":"<one line>"}]}`,
	].join("\n");
}

export function parseAssuranceVerdict(text: string, snapshot: SnapshotDescriptor): AssuranceVerdict {
	const cleaned = text.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("{") && line.endsWith("}")).join("");
	if (!cleaned) throw new Error("child returned no strict JSON verdict");
	let raw: Record<string, unknown>;
	try { raw = JSON.parse(cleaned) as Record<string, unknown>; } catch { throw new Error("child verdict is not valid JSON"); }
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
		if (raw.findings !== undefined) throw new Error("pass verdict must omit findings");
		return { contract: "assurance_kernel/assurance_verdict/v2", role: snapshot.role, task_id: snapshot.task_id, snapshot_digest: snapshotDigest(snapshot), decision: "pass", approval: { kind: expectedKind, authority_role: expectedRole, summary: approval.summary } };
	}
	if (!Array.isArray(raw.findings) || raw.findings.length === 0 || raw.approval !== undefined) throw new Error("rework verdict findings are invalid");
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
	correlation: AssuranceCorrelation;
	snapshot: SnapshotDescriptor;
	params: ReservedAgentParams;
	evidence: { path: string; remove(): void };
	toolCallId?: string;
	resultObserved: boolean;
	ended: boolean;
	endedBeforeResult: boolean;
	receipt?: NativeReviewResult;
	receiptError?: string;
}

export const invocationRegistry = createInvocationRegistry();

export class AssuranceProgression {
	private readonly activeOperations = new Map<string, string>();
	private readonly operationControllers = new Map<string, { operationId: string; controller: AbortController }>();
	private readonly reviewReservations = new Map<string, ReviewReservation>();
	private readonly rejectedReviewOperations = new Map<string, { operationId: string; reason: string }>();
	private readonly pendingReviewVerdicts = new Map<string, PendingReviewVerdict>();
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
		this.pendingReviewVerdicts.clear();
		this.rejectedReviewOperations.clear();
		for (const reservation of this.reviewReservations.values()) this.removeEvidence(reservation);
		this.reviewReservations.clear();
		for (const invocation of [...this.sessionInvocations]) this.closeSessionInvocation(invocation);
	}

	observeToolCall(event: { toolName?: string; input?: unknown; toolCallId?: string }): { block: boolean; reason?: string } | undefined {
		if (event.toolName !== STANDARD_AGENT_TOOL || !event.toolCallId) return undefined;
		for (const reservation of this.reviewReservations.values()) {
			if (!matchesReservedAgentArgs(event.input, reservation.params)) continue;
			if (reservation.toolCallId || reservation.ended || reservation.resultObserved) {
				return { block: true, reason: "reserved Review already has a native tool call" };
			}
			reservation.toolCallId = event.toolCallId;
			return undefined;
		}
		return undefined;
	}

	observeToolResult(event: ToolResultLike): void {
		if (event.toolName !== STANDARD_AGENT_TOOL || !event.toolCallId) return;
		const reservation = this.reservationForCall(event.toolCallId);
		if (!reservation || reservation.endedBeforeResult || reservation.resultObserved) return;
		if (!matchesReservedAgentArgs(event.input ?? event.args, reservation.params)) return;
		reservation.resultObserved = true;
		try {
			reservation.receipt = parseForegroundAgentResult(event, event.toolCallId);
			if (nativeReviewResultIsFailure(reservation.receipt)) reservation.receiptError = `native Agent returned ${reservation.receipt.status}`;
		} catch (error) {
			reservation.receiptError = boundedAssuranceError(error);
		}
	}

	observeToolEnd(event: ToolExecutionEndLike): void {
		if (event.toolName !== STANDARD_AGENT_TOOL || !event.toolCallId) return;
		const reservation = this.reservationForCall(event.toolCallId);
		if (!reservation) return;
		if (!reservation.resultObserved) reservation.endedBeforeResult = true;
		reservation.ended = true;
	}

	active(taskId: string): ActiveAssuranceState | null {
		const operationId = this.activeOperations.get(taskId);
		if (operationId) return { state: "running", operation: "qa", operation_id: operationId, deadline_seconds: QA_JOB_TIMEOUT_SECONDS };
		const reservation = this.reviewReservations.get(taskId);
		if (reservation) return { state: "review_ready", operation: "review", operation_id: reservation.operationId };
		const pending = this.pendingReviewVerdicts.get(taskId);
		if (pending) return { state: "awaiting_user", operation: "review", operation_id: pending.operationId };
		const unknown = this.unknownOperations.get(taskId);
		if (unknown) return { state: "settlement_unknown", operation: unknown.operation, operation_id: unknown.operationId, reason: unknown.reason };
		return null;
	}

	hasPendingReviewVerdict(taskId: string): boolean { return this.pendingReviewVerdicts.has(taskId); }
	pendingReviewVerdict(taskId: string): PendingReviewVerdict | undefined { return this.pendingReviewVerdicts.get(taskId); }
	clearPendingReviewVerdict(taskId: string): void { this.pendingReviewVerdicts.delete(taskId); }

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
		if (active?.state === "review_ready") return this.reviewReadyResult(taskId);
		if (active?.state === "awaiting_user") return { state: "blocked", reason: "native Review verdict already awaits authorization" };
		if (active?.state === "settlement_unknown") return active;
		if (active?.state === "running") return { state: "blocked", reason: `assurance operation ${active.operation_id} is already running` };
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
			if (projection.error || !projection.claim) return { state: "blocked", reason: projection.error ?? "no active backend claim" };
			if (projection.claim.task_id !== taskId) return { state: "blocked", reason: `backend claim belongs to ${projection.claim.task_id}, not ${taskId}` };
			if (projection.projection.phase === "done") return { state: "completed" };
			if (projection.projection.phase === "stopped") return { state: "blocked", reason: "task is stopped" };
			const parked = await this.ports.readTaskRecordV2(ctx.cwd, taskId);
			ensureOperationLive();
			if (parked.record?.findings.some((finding) => finding.kind === "replan_required" && finding.status === "open")) return { state: "blocked", reason: "review rework limit reached; a durable replan is required" };
			if (projection.projection.phase === "working") {
				if (projection.projection.missing_acceptance_ids.length > 0) return { state: "blocked", reason: `fresh evidence is missing for: ${projection.projection.missing_acceptance_ids.join(",")}` };
				if (aborted()) return this.cancelled("qa", operationId, "host cancellation before review transition");
				progress("submitting_review", "Submitting the fresh evidence for deterministic QA");
				const reviewTransition = this.ports.applyOrdinaryOperation(ctx, { taskId, operation: { op: "submit_review", actor_id: "executor" } });
				authorityBoundaryStarted = true;
				await reviewTransition;
				authorityCommitted = true;
				ensureOperationLive();
				projection = await this.ports.projectTask(ctx.cwd, taskId);
				ensureOperationLive();
				if (projection.error || projection.projection.phase !== "review") return this.unknownAfterCommit(taskId, "qa", operationId, projection.error ?? "review transition did not settle");
			}
			const qaAlreadySettled = projection.projection.phase === "review"
				&& (projection.projection.fresh_approval_kinds?.includes("qa") ?? false);
			const runner = await this.ports.frozenRunner();
			ensureOperationLive();
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
					ensureOperationLive();
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
			ensureOperationLive();
			progress("preparing_review", "Preparing the reserved foreground Review bundle");
			const fresh = await this.ports.projectTask(ctx.cwd, taskId);
			ensureOperationLive();
			if (fresh.error || !fresh.claim) return this.unknownAfterCommit(taskId, "qa", operationId, fresh.error ?? "claim disappeared after QA settlement");
			const review = await this.ports.buildAssurance(ctx.cwd, taskId, "review", fresh, runner);
			ensureOperationLive();
			if (!review.reviewBundle) return this.unknownAfterCommit(taskId, "qa", operationId, "review bundle is missing after QA settlement");
			const evidence = this.ports.writeReviewEvidence({ snapshot: review.snapshot, review_bundle: review.reviewBundle });
			const reservation: ReviewReservation = {
				taskId,
				operationId,
				correlation: { record_revision: review.snapshot.record_revision, intent_content_hash: review.snapshot.intent_content_hash, diff_hash: review.snapshot.diff_hash },
				snapshot: review.snapshot,
				params: { subagent_type: "general-purpose", description: "", prompt: "", inherit_context: false, isolated: true, isolation: "worktree", run_in_background: false, max_turns: 0 },
				evidence,
				resultObserved: false,
				ended: false,
				endedBeforeResult: false,
			};
			this.reviewReservations.set(taskId, reservation);
			try {
				ensureOperationLive();
				const workload = classifyReviewWorkload(review.snapshot, review.reviewBundle);
				reservation.params = reservedAgentParams({ taskId, operationId, prompt: buildReviewPrompt(review.snapshot, evidence.path), max_turns: reviewTurnBudget(workload) });
				ensureOperationLive();
			} catch (error) {
				this.releaseReviewReservation(taskId, reservation);
				throw error;
			}
			progress("review_ready", "QA passed; invoke the reserved foreground Agent, then call submit_review", { snapshot_digest: snapshotDigest(review.snapshot), review_bundle_digest: review.snapshot.review_bundle_digest ?? "", agent_params: reservation.params });
			return { state: "review_ready", operation: "review", operation_id: operationId, snapshot_digest: snapshotDigest(review.snapshot), review_bundle_digest: review.snapshot.review_bundle_digest ?? "", agent_params: reservation.params };
		} catch (error) {
			if (authorityCommitted || (authorityBoundaryStarted && aborted())) return this.unknownAfterCommit(taskId, "qa", operationId, `${phase}: ${boundedAssuranceError(error)}`);
			if (aborted() || error instanceof VerificationAbortedError) return this.cancelled("qa", operationId, `${phase}: host cancellation`);
			return { state: "failed", operation: "qa", operation_id: operationId, reason: `${phase}: ${boundedAssuranceError(error)}` };
		} finally {
			if (this.activeOperations.get(taskId) === operationId) this.activeOperations.delete(taskId);
			const controller = this.operationControllers.get(taskId);
			if (controller?.operationId === operationId) this.operationControllers.delete(taskId);
			signal?.removeEventListener("abort", relayExternalAbort);
		}
	}

	async submitReview(taskId: string, ctx: ExtensionContext): Promise<AssuranceSubmitReviewResult> {
		const pending = this.pendingReviewVerdicts.get(taskId);
		if (pending) return { state: "awaiting_user", operation: "record-review-verdict", operation_id: pending.operationId };
		const unknown = this.unknownOperations.get(taskId);
		if (unknown) { this.unknownOperations.delete(taskId); return { state: "settlement_unknown", operation: unknown.operation, operation_id: unknown.operationId, reason: unknown.reason }; }
		const rejected = this.rejectedReviewOperations.get(taskId);
		if (rejected) return { state: "blocked", reason: rejected.reason };
		const reservation = this.reviewReservations.get(taskId);
		if (!reservation) return { state: "blocked", reason: "no reserved foreground Review operation" };
		if (!reservation.toolCallId) return { state: "blocked", reason: "reserved foreground Agent was not observed" };
		if (reservation.endedBeforeResult) {
			const reason = "foreground Agent terminal event arrived before its result";
			this.releaseReviewReservation(taskId, reservation, reason);
			return { state: "blocked", reason };
		}
		if (!reservation.ended) return { state: "blocked", reason: "foreground Agent terminal event order is incomplete" };
		if (reservation.receiptError || !reservation.receipt) {
			const reason = reservation.receiptError ?? "foreground Agent result is missing";
			this.releaseReviewReservation(taskId, reservation, reason);
			return { state: "blocked", reason };
		}
		let fresh: AssuranceProjectionResult;
		try {
			fresh = await this.ports.projectTask(ctx.cwd, taskId);
		} catch (error) {
			const reason = boundedAssuranceError(error);
			this.releaseReviewReservation(taskId, reservation, reason);
			return { state: "blocked", reason };
		}
		if (fresh.error || !fresh.claim || fresh.claim.task_id !== taskId || fresh.projection.record_revision !== reservation.snapshot.record_revision || fresh.projection.workspace_revision !== reservation.snapshot.workspace_revision || fresh.projection.intent_revision !== reservation.snapshot.intent_revision || fresh.projection.intent_content_hash !== reservation.snapshot.intent_content_hash || fresh.projection.diff_hash !== reservation.snapshot.diff_hash || fresh.projection.phase !== reservation.snapshot.phase) {
			const reason = fresh.error ?? "assurance snapshot changed before Review submission";
			this.releaseReviewReservation(taskId, reservation, reason);
			return { state: "blocked", reason };
		}
		let verdict: AssuranceVerdict;
		try { verdict = parseAssuranceVerdict(reservation.receipt.result, reservation.snapshot); }
		catch (error) {
			const reason = boundedAssuranceError(error);
			this.releaseReviewReservation(taskId, reservation, reason);
			return { state: "blocked", reason };
		}
		this.pendingReviewVerdicts.set(taskId, {
			operationId: reservation.operationId,
			snapshot: reservation.snapshot,
			verdict,
			agentId: reservation.receipt.agentId,
			durationMs: reservation.receipt.durationMs,
			tokens: reservation.receipt.tokens,
		});
		this.releaseReviewReservation(taskId, reservation);
		return { state: "awaiting_user", operation: "record-review-verdict", operation_id: reservation.operationId };
	}

	private reviewReadyResult(taskId: string): AssuranceAdvanceResult {
		const reservation = this.reviewReservations.get(taskId);
		if (!reservation) return { state: "blocked", reason: "Review reservation disappeared" };
		return { state: "review_ready", operation: "review", operation_id: reservation.operationId, snapshot_digest: snapshotDigest(reservation.snapshot), review_bundle_digest: reservation.snapshot.review_bundle_digest ?? "", agent_params: reservation.params };
	}

	private reservationForCall(toolCallId: string): ReviewReservation | undefined {
		for (const reservation of this.reviewReservations.values()) if (reservation.toolCallId === toolCallId) return reservation;
		return undefined;
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

	private unknownAfterCommit(taskId: string, operation: "qa" | "review", operationId: string, reason: string): AssuranceAdvanceResult {
		this.unknownOperations.set(taskId, { operation, operationId, reason });
		return { state: "settlement_unknown", operation, operation_id: operationId, reason };
	}
}

export interface PendingReviewVerdict {
	operationId: string;
	snapshot: SnapshotDescriptor;
	verdict: AssuranceVerdict;
	agentId: string;
	durationMs?: number;
	tokens?: { input: number; output: number; total: number };
}

function boundedAssuranceError(error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error);
	const normalized = raw.replace(/\s+/g, " ").trim() || "unknown error";
	return normalized.length <= 300 ? normalized : `${normalized.slice(0, 299)}...`;
}
