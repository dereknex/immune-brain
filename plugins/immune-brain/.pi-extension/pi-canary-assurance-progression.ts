// Pi Assurance progression: the single session-scoped owner of QA/Review
// operation lifecycle for enrolled Kernel canary tasks.
//
// It owns operation reservations, QA and Review jobs, timers, cancellation,
// bounded session shutdown, host tool-event observation, terminal settlement
// (exactly one winner per operation), continuation from fresh evidence to
// QA/Review/authorization/completion, and exactly-once correlated terminal
// follow-up requests.
//
// It does NOT own Task facts, freshness judgment, or mutation authority:
// Kernel facts come exclusively from the injected projectTask port (the
// internal Kernel assurance projection), and every authority write flows
// through the injected applyVerdict / applyOrdinaryOperation ports supplied
// by the Pi adapter. It never grants Kernel authority itself.
//
// The literal-user authorization confirmation flow remains in the adapter;
// this module exposes only the minimum session bridges that flow needs
// (invocation open/close/commit/state, pending native verdict lookup/clear,
// session identity).

import { createHash, randomUUID } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	findingsDigest,
	parseVerificationDescriptor,
	type FrozenRunner,
	type VerificationDescriptor,
} from "./pi-canary-verification";
import { createInvocationRegistry, type InvocationState, type InvocationToken } from "./pi-canary-invocations";
import { describeQaFailure } from "./pi-canary-qa-findings";
import type { ReviewBundle } from "./pi-canary-review-bundle";
import {
	STANDARD_AGENT_RESULT_TOOL,
	STANDARD_AGENT_TOOL,
	classifyDispatchFailure,
	matchesReservedAgentArgs,
	parseAgentResultPayload,
	nativeReviewResultIsFailure,
	parseAgentSpawnReceipt,
	reservedAgentParams,
	type NativeReviewHandle,
	type NativeReviewResult,
	type ReservedAgentParams,
	type ToolExecutionEndLike,
} from "./pi-canary-native-review";
import type {
	AssuranceCorrelation,
	AssuranceFollowUp,
	AssuranceRole,
	AssuranceView,
	AssuranceResultPresentation,
	AssuranceNextAction,
} from "./pi-canary-assurance";
import type {
	AssuranceProjectionResult,
	TaskIntentRead,
	TaskRecordV2Read,
} from "./runtime-stub";

function traceLog(line: string): void {
	try {
		require("node:fs").appendFileSync("/tmp/pi-extension-trace.log", `${new Date().toISOString()} ${line}\n`);
	} catch {
		// ignore
	}
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

function presentationFor(
	snapshot: SnapshotDescriptor,
	verdict: AssuranceVerdict,
): AssuranceResultPresentation {
	return {
		passed_acceptance_ids: [...snapshot.fresh_acceptance_ids],
		missing_acceptance_ids: [...snapshot.missing_acceptance_ids],
		findings: (verdict.findings ?? []).map(({ id, kind, acceptance_id, summary }) => ({
			id,
			kind,
			acceptance_id,
			summary,
		})),
	};
}

export interface PendingReviewVerdict {
	operationId: string;
	snapshot: SnapshotDescriptor;
	verdict: AssuranceVerdict;
	agentId: string;
	durationMs?: number;
	tokens?: { input: number; output: number; total: number };
}

export interface QaVerificationProgress {
	index: number;
	total: number;
	acceptance_id: string;
	phase: "running" | "passed" | "failed";
	elapsed_ms: number;
}

export type AssuranceStartedResult = {
	state: "started";
	operation: AssuranceRole;
	operation_id: string;
	deadline_seconds: number;
};
export type AssuranceAdvanceResult =
	| AssuranceStartedResult
	| { state: "blocked"; reason: string }
	| { state: "awaiting_user"; operation: string; operation_id?: string; reason?: string }
	| { state: "completed" };
export type AssuranceCancelResult =
	| { state: "blocked"; reason: string }
	| { state: "cancellation_requested"; operation: AssuranceRole; operation_id: string }
	| { state: "cancelled"; operation: AssuranceRole; operation_id: string }
	| { state: "idle" };
export type ActiveAssuranceState =
	| AssuranceStartedResult
	| { state: "awaiting_user"; operation: string; operation_id?: string; reason?: string }
	| { state: "settling"; operation: "review"; operation_id: string; lifecycle: "cancellation_requested" | "timed_out" | "dispatch_unknown" };

export interface AssuranceProgressionPorts {
	// UI (adapter wires to AssurancePresenter and ctx.ui with exact text).
	publish(ctx: ExtensionContext, view: AssuranceView): void;
	deliverFollowUp(followUp: AssuranceFollowUp): void;
	notify(ctx: ExtensionContext, message: string, kind: "info" | "warning" | "error"): void;
	// Kernel facts: the internal assurance projection is the ONLY freshness
	// source; hosts never re-filter evidence or approvals.
	projectTask(root: string, taskId: string): Promise<AssuranceProjectionResult>;
	readTaskRecordV2(root: string, taskId: string): Promise<TaskRecordV2Read>;
	readTaskIntent(root: string, taskId: string): Promise<TaskIntentRead>;
	// Execution and authority (adapter supplies production behavior).
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
	writeReviewEvidence(input: {
		snapshot: SnapshotDescriptor;
		review_bundle: ReviewBundle;
	}): { path: string; remove(): void };
	startReview?: (input: {
		prompt: string;
		description: string;
		cwd: string;
		model?: string;
		maxTurns?: number;
	}) => Promise<NativeReviewHandle>;
	dispatchReviewFollowUp(input: {
		taskId: string;
		operationId: string;
		params: ReservedAgentParams;
		correlation: AssuranceCorrelation;
	}): void;
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
	applyOrdinaryOperation(
		ctx: ExtensionContext,
		input: { taskId: string; operation: { op: string; actor_id: string } },
	): Promise<unknown>;
	// Test seams (same names as the previous extension dependencies).
	advanceBeforeProjection?: () => Promise<void>;
	qaBeforeProjection?: () => Promise<void>;
	qaBeforeAuthorityCommit?: () => Promise<void>;
	qaOnAuthorityCommit?: () => void;
	qaAfterAuthorityCommit?: () => Promise<void>;
	qaJobTimeoutMs?: number;
	reviewJobTimeoutMs?: number;
	reviewSoftDeadlineMs?: number;
	reviewPreparationTimeoutMs?: number;
	reviewSpawnTimeoutMs?: number;
}

const SESSION_SHUTDOWN_TIMEOUT_MS = 10_000;

export const QA_MIN_JOB_TIMEOUT_SECONDS = 15 * 60;
export const QA_MAX_JOB_TIMEOUT_SECONDS = 60 * 60;
export const QA_JOB_OVERHEAD_SECONDS = 2 * 60;
// Retained as the pre-snapshot QA floor and compatibility export.
export const QA_JOB_TIMEOUT_SECONDS = QA_MIN_JOB_TIMEOUT_SECONDS;

function declaredQaJobTimeoutMs(
	descriptors: Iterable<Pick<VerificationDescriptor, "timeout_ms">>,
): number {
	let declaredMs = 0;
	for (const descriptor of descriptors) declaredMs += descriptor.timeout_ms;
	return Math.max(
		QA_MIN_JOB_TIMEOUT_SECONDS * 1000,
		declaredMs + QA_JOB_OVERHEAD_SECONDS * 1000,
	);
}

export function deriveQaJobTimeoutMs(
	descriptors: Iterable<Pick<VerificationDescriptor, "timeout_ms">>,
): number {
	const derivedMs = declaredQaJobTimeoutMs(descriptors);
	if (derivedMs > QA_MAX_JOB_TIMEOUT_SECONDS * 1000) {
		throw new Error(
			`declared QA budget ${Math.ceil(derivedMs / 60_000)} minutes exceeds the maximum of 60 minutes`,
		);
	}
	return derivedMs;
}

export const REVIEW_PREPARATION_TIMEOUT_MS = 30_000;
export const REVIEW_DISPATCH_TIMEOUT_MS = 120_000;
export const REVIEW_VERDICT_VALIDATION_TIMEOUT_MS = 30_000;
export const ASSURANCE_STALL_MS = 30_000;

export type ReviewWorkload = "quick" | "standard" | "heavy";

export interface ReviewTimingProfile {
	softDeadlineSeconds: number;
	stopThresholdSeconds: number;
}

export const REVIEW_TIMING_PROFILES: Readonly<Record<ReviewWorkload, ReviewTimingProfile>> = {
	quick: { softDeadlineSeconds: 5 * 60, stopThresholdSeconds: 15 * 60 },
	standard: { softDeadlineSeconds: 10 * 60, stopThresholdSeconds: 30 * 60 },
	heavy: { softDeadlineSeconds: 20 * 60, stopThresholdSeconds: 60 * 60 },
};

const QUICK_REVIEW_MAX_ACCEPTANCE = 3;
const QUICK_REVIEW_MAX_FILES = 5;
const QUICK_REVIEW_MAX_BYTES = 64 * 1024;
const HEAVY_REVIEW_MIN_ACCEPTANCE = 9;
const HEAVY_REVIEW_MIN_BYTES = (512 * 1024) + 1;

export function classifyReviewWorkload(
	snapshot: Pick<SnapshotDescriptor, "risk" | "acceptance">,
	bundle: ReviewBundle,
): ReviewWorkload {
	const bundleBytes = Buffer.byteLength(JSON.stringify(bundle));
	if (
		snapshot.risk === "critical" ||
		snapshot.acceptance.length >= HEAVY_REVIEW_MIN_ACCEPTANCE ||
		bundleBytes >= HEAVY_REVIEW_MIN_BYTES
	) return "heavy";
	if (
		snapshot.risk === "routine" &&
		snapshot.acceptance.length <= QUICK_REVIEW_MAX_ACCEPTANCE &&
		Object.keys(bundle.dirty_files).length <= QUICK_REVIEW_MAX_FILES &&
		bundleBytes <= QUICK_REVIEW_MAX_BYTES
	) return "quick";
	return "standard";
}

export function isSupersededFollowUp(
	currentOperationId: string | undefined,
	followUpOperationId: string,
): boolean {
	return currentOperationId !== followUpOperationId;
}

// Review turn budget scales with workload: provenance verification cost grows
// with dirty-file count and bundle bytes, and a truncated review produces no
// verdict. A heavy review (11+ files, 6+ acceptances) cannot complete within
// the quick budget of 12 turns.
export function reviewTurnBudget(workload: ReviewWorkload): number {
	switch (workload) {
		case "quick": return 12;
		case "standard": return 16;
		case "heavy": return 24;
	}
}

function boundedAssuranceError(error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error);
	const normalized = raw.replace(/\s+/g, " ").trim() || "unknown error";
	return normalized.length <= 300 ? normalized : `${normalized.slice(0, 299)}...`;
}

class ReviewStartupTimeoutError extends Error {
	constructor(stage: string, timeoutMs: number) {
		super(`native review did not reach ${stage} within ${timeoutMs}ms`);
		this.name = "ReviewStartupTimeoutError";
	}
}

interface SessionQaJob {
	operationId: string;
	controller: AbortController;
	startedAt: number;
	deadlineMs: number;
	deadlineSeconds: number;
	stage: string;
	lastActivityAt: number;
	current: number;
	total: number;
	notifiedProgress: Set<string>;
	correlation?: AssuranceCorrelation;
	heartbeat: ReturnType<typeof setInterval>;
	timeout: ReturnType<typeof setTimeout>;
	invocation?: InvocationToken;
	sessionGeneration: number;
}

interface NativeTerminalReceipt {
	settlement: "native_terminal";
	native: NativeReviewResult;
}

interface SessionReviewJob {
	operationId: string;
	handle?: NativeReviewHandle;
	agentId?: string;
	startedAt: number;
	executionStartedAt?: number;
	workload?: ReviewWorkload;
	softDeadlineSeconds?: number;
	stopThresholdSeconds?: number;
	softDeadlineReached?: boolean;
	stage: string;
	lastActivityAt: number;
	correlation: AssuranceCorrelation;
	heartbeat: ReturnType<typeof setInterval>;
	softTimeout?: ReturnType<typeof setTimeout>;
	timeout: ReturnType<typeof setTimeout>;
	evidence: { path: string; remove(): void };
	snapshot?: SnapshotDescriptor;
	params?: ReservedAgentParams;
	spawnToolCallId?: string;
	resultToolCallId?: string;
	resolveSpawn?: (agentId: string) => void;
	rejectSpawn?: (error: Error) => void;
	resolveHostTerminal?: (receipt: NativeTerminalReceipt) => void;
	rejectHostTerminal?: (error: Error) => void;
	resolveHandleResult?: (result: NativeReviewResult) => void;
	rejectHandleResult?: (error: Error) => void;
	hostTerminalReceipt?: Promise<NativeTerminalReceipt>;
}

interface SessionReviewSettlement {
	operationId: string;
	lifecycle: "cancellation_requested" | "timed_out" | "dispatch_unknown";
	job?: SessionReviewJob;
}

interface ReviewStopSettlement {
	settlement: "native_terminal";
	stopError?: unknown;
	cleanupError?: unknown;
}

function qaJobStatus(job: Pick<SessionQaJob, "startedAt" | "deadlineSeconds" | "stage" | "current" | "total">): string {
	const elapsedSeconds = Math.max(0, Math.floor((Date.now() - job.startedAt) / 1000));
	const progress = job.total > 0 ? `${job.current}/${job.total} ` : "";
	return `qa: ${progress}${job.stage} | ${elapsedSeconds}s/${job.deadlineSeconds}s | background; input available`;
}

function formatQaDuration(seconds: number): string {
	const bounded = Math.max(0, Math.ceil(seconds));
	if (bounded < 60) return `${bounded}s`;
	const minutes = Math.floor(bounded / 60);
	const remainder = bounded % 60;
	return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

function qaProgressNotice(progress: QaVerificationProgress, deadlineSeconds: number): string {
	return `QA ${progress.index}/${progress.total} | ${progress.acceptance_id.slice(0, 80)} ${progress.phase} | elapsed ${formatQaDuration(progress.elapsed_ms / 1000)} | hard limit ${formatQaDuration(deadlineSeconds)}`;
}

function reviewJobStatus(
	job: Pick<SessionReviewJob, "executionStartedAt" | "stage" | "workload" | "stopThresholdSeconds">,
): string {
	const elapsedSeconds = Math.max(0, Math.floor((Date.now() - (job.executionStartedAt ?? Date.now())) / 1000));
	const profile = job.workload ? `${job.workload} ` : "";
	const threshold = job.stopThresholdSeconds ? `/${job.stopThresholdSeconds}s` : "";
	return `review: ${profile}${job.stage} | ${elapsedSeconds}s${threshold} | waiting for native terminal event; input available`;
}

// The invocation registry is module-scoped (shared across extension
// instances and with the adapter's authority application), exactly as in the
// previous extension implementation.
export const invocationRegistry = createInvocationRegistry();

export function snapshotDigest(snapshot: SnapshotDescriptor): string {
	return `sha256:${createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}`;
}

export function buildReviewPrompt(snapshot: SnapshotDescriptor, evidencePath?: string): string {
	if (snapshot.role !== "review") throw new Error("native review prompt requires review role");
	const digest = snapshotDigest(snapshot);
	const acceptance = snapshot.acceptance
		.map((item) => `- ${item.id}: ${item.assertion}`)
		.join("\n");
	return [
		`Perform a read-only code review for Assurance Kernel task ${snapshot.task_id}.`,
		`Verify immutable bundle provenance before analyzing findings. Review the immutable evidence JSON at ${evidencePath ?? "<evidence-path>"}. Read that file first; verify that git rev-parse HEAD equals bundle.head in the isolated worktree. For every tracked dirty_files entry, verify git rev-parse HEAD:<path> equals base_oid, then compare that immutable HEAD blob with current_content. A null base_oid denotes an untracked current file; a null current_content denotes a deletion. Do not inspect or depend on live bytes from the parent worktree.`,
		`Limit repository inspection to the acceptance assertions and dirty_files contents in the immutable bundle. Do not explore unrelated repository paths.`,
		`The isolated worktree contains the committed HEAD snapshot only; staged task changes exist solely in the bundle dirty_files entries as current_content bytes. Analyze code exclusively from those bundle bytes; repository file reads are permitted only for the provenance git commands above. A symbol missing from the worktree but present in current_content is the task change, not an absence.`,
		`Do not edit files, create files, run mutating commands, or change Git state. Focus on correctness, regressions, security, and missing tests.`,
		`Execution outcomes for every acceptance were verified deterministically by the Kernel QA layer before this review and are embedded in this bundle under outcomes (acceptance_id -> {status, summary}); do not re-execute descriptors and do not treat the absence of local test runs as a finding. Your review covers bundle provenance, code correctness, regressions, security, and missing tests against the embedded assertions and code bytes.`,
		`Snapshot digest: ${digest}`,
		`TaskRecord revision: ${snapshot.record_revision}`,
		`Intent revision ${snapshot.intent_revision} (hash ${snapshot.intent_content_hash}), diff ${snapshot.diff_hash}, review bundle ${snapshot.review_bundle_digest}, phase ${snapshot.phase}.`,
		`Acceptance assertions:`,
		acceptance,
		`Reserve the final turn for exactly one strict JSON verdict. Reply with ONLY that object, without markdown fences or commentary.`,
		`PASS shape: {"contract":"assurance_kernel/assurance_verdict/v2","role":"review","task_id":"${snapshot.task_id}","snapshot_digest":"${digest}","decision":"pass","approval":{"kind":"review","authority_role":"reviewer","summary":"<one line>"}}`,
		`REWORK shape: {"contract":"assurance_kernel/assurance_verdict/v2","role":"review","task_id":"${snapshot.task_id}","snapshot_digest":"${digest}","decision":"rework","findings":[{"id":"review-1","kind":"blocking|advisory","acceptance_id":"<id|null>","summary":"<one line>"}]}`,
	].join("\n");
}

export function parseAssuranceVerdict(text: string, snapshot: SnapshotDescriptor): AssuranceVerdict {
	const cleaned = text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("{") && line.endsWith("}"))
		.join("");
	if (!cleaned) throw new Error("child returned no strict JSON verdict");
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(cleaned) as Record<string, unknown>;
	} catch {
		throw new Error("child verdict is not valid JSON");
	}
	const allowed = ["contract", "role", "task_id", "snapshot_digest", "decision", "approval", "findings"];
	const unknown = Object.keys(raw).filter((key) => !allowed.includes(key));
	if (unknown.length > 0) throw new Error(`child verdict has unknown field: ${unknown[0]}`);
	if (raw.contract !== "assurance_kernel/assurance_verdict/v2")
		throw new Error("assurance verdict contract is invalid");
	if (raw.role !== snapshot.role) throw new Error("child verdict role mismatch");
	if (raw.task_id !== snapshot.task_id) throw new Error("child verdict task mismatch");
	if (raw.snapshot_digest !== snapshotDigest(snapshot))
		throw new Error("child verdict snapshot digest mismatch");
	if (raw.decision !== "pass" && raw.decision !== "rework")
		throw new Error("child verdict decision must be pass or rework");
	if (raw.decision === "pass") {
		const approval = raw.approval as Record<string, unknown> | undefined;
		if (!approval || typeof approval !== "object")
			throw new Error("pass verdict requires an approval object");
		const expectedKind = snapshot.role === "qa" ? "qa" : "review";
		const expectedRole = snapshot.role === "qa" ? "qa" : "reviewer";
		if (approval.kind !== expectedKind || approval.authority_role !== expectedRole)
			throw new Error("pass verdict approval kind/role mismatch");
		if (typeof approval.summary !== "string" || !approval.summary.trim())
			throw new Error("pass verdict approval summary is required");
		if (raw.findings !== undefined) throw new Error("pass verdict must omit findings");
		return {
			contract: "assurance_kernel/assurance_verdict/v2",
			role: snapshot.role,
			task_id: snapshot.task_id,
			snapshot_digest: snapshotDigest(snapshot),
			decision: "pass",
			approval: {
				kind: approval.kind as "qa" | "review",
				authority_role: approval.authority_role as "qa" | "reviewer",
				summary: approval.summary,
			},
		};
	}
	const findings = raw.findings;
	if (!Array.isArray(findings) || findings.length === 0)
		throw new Error("rework verdict requires at least one finding");
	if (raw.approval !== undefined) throw new Error("rework verdict must omit approval");
	const normalized: AssuranceVerdict["findings"] = findings.map((item, index) => {
		const f = item as Record<string, unknown>;
		const allowedFindingFields = ["id", "kind", "acceptance_id", "summary"];
		const unknownFindingField = Object.keys(f).find((key) => !allowedFindingFields.includes(key));
		if (unknownFindingField)
			throw new Error(`finding ${index} has unknown field: ${unknownFindingField}`);
		if (typeof f.id !== "string" || !f.id.trim()) throw new Error(`finding ${index} id is invalid`);
		if (f.kind !== "blocking" && f.kind !== "advisory") throw new Error(`finding ${index} kind is invalid`);
		if (f.acceptance_id !== null && typeof f.acceptance_id !== "string")
			throw new Error(`finding ${index} acceptance_id is invalid`);
		if (typeof f.summary !== "string" || !f.summary.trim())
			throw new Error(`finding ${index} summary is required`);
		const localId = String(f.id).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 48);
		const id = `review-${snapshotDigest(snapshot).slice("sha256:".length, "sha256:".length + 12)}-${index + 1}-${localId}`;
		const digest = findingsDigest([
			{
				id,
				kind: String(f.kind),
				acceptance_id: f.acceptance_id === null ? null : String(f.acceptance_id),
				summary: String(f.summary),
			},
		]);
		return {
			id,
			kind: f.kind as "blocking" | "advisory",
			acceptance_id: (f.acceptance_id as string | null) ?? null,
			summary: String(f.summary),
			findings_digest: digest,
		};
	});
	return {
		contract: "assurance_kernel/assurance_verdict/v2",
		role: snapshot.role,
		task_id: snapshot.task_id,
		snapshot_digest: snapshotDigest(snapshot),
		decision: "rework",
		findings: normalized,
	};
}

export class AssuranceProgression {
	private readonly ports: AssuranceProgressionPorts;
	private readonly qaJobs = new Map<string, SessionQaJob>();
	private readonly qaPreparations = new Map<string, string>();
	private readonly reviewJobs = new Map<string, SessionReviewJob>();
	private readonly reviewReservations = new Map<string, string>();
	private readonly reviewSettlements = new Map<string, SessionReviewSettlement>();
	/** Immutable review evidence artifacts by operation; removed at terminal settlement or explicit release. */
	private readonly reviewEvidenceByOperation = new Map<string, { path: string; remove(): void }>();
	/** Operations whose dispatch failed with a no-verdict provider failure; the reservation stays valid for exactly one re-dispatch. */
	private readonly dispatchFailedOperations = new Map<string, boolean>();
	private readonly advanceReservations = new Map<string, string>();
	private readonly pendingReviewVerdicts = new Map<string, PendingReviewVerdict>();
	private readonly sessionInvocations = new Set<InvocationToken>();
	private readonly pendingStandardSpawns = new Map<string, SessionReviewJob>();
	private readonly terminalOperations = new Set<string>();
	private sessionActive = true;
	private sessionGeneration = 0;

	constructor(ports: AssuranceProgressionPorts) {
		this.ports = ports;
	}

	// -- session lifecycle -------------------------------------------------

	onSessionStart(): void {
		this.sessionActive = true;
		this.sessionGeneration += 1;
		this.terminalOperations.clear();
	}

	async onSessionShutdown(): Promise<void> {
		this.sessionActive = false;
		this.sessionGeneration += 1;
		this.pendingReviewVerdicts.clear();
		this.reviewReservations.clear();
		this.reviewSettlements.clear();
		this.advanceReservations.clear();
		for (const pending of this.pendingStandardSpawns.values()) {
			this.invalidateReviewJob(pending, "session shutdown");
			clearInterval(pending.heartbeat);
			if (pending.softTimeout) clearTimeout(pending.softTimeout);
			clearTimeout(pending.timeout);
		}
		this.pendingStandardSpawns.clear();
		for (const invocation of [...this.sessionInvocations]) this.closeSessionInvocation(invocation);
		const qa = [...this.qaJobs.values()];
		this.qaJobs.clear();
		for (const job of qa) {
			clearInterval(job.heartbeat);
			clearTimeout(job.timeout);
			const committed = job.invocation && invocationRegistry.stateOf(job.invocation) === "committed";
			if (!committed) {
				job.controller.abort();
				if (job.invocation) invocationRegistry.cancel(job.invocation);
			}
			if (job.invocation) this.sessionInvocations.delete(job.invocation);
		}
		const jobs = [...this.reviewJobs.values()];
		this.reviewJobs.clear();
		const stops: Promise<unknown>[] = [];
		for (const job of jobs) {
			clearInterval(job.heartbeat);
			if (job.softTimeout) clearTimeout(job.softTimeout);
			clearTimeout(job.timeout);
			stops.push(this.stopReviewAndRemoveEvidence(job));
		}
		if (stops.length > 0) {
			await Promise.race([
				Promise.allSettled(stops).then(() => undefined),
				new Promise<void>((resolve) => setTimeout(resolve, SESSION_SHUTDOWN_TIMEOUT_MS)),
			]);
		}
	}

	// -- host tool observation ---------------------------------------------

	observeToolStart(event: { toolName?: string; args?: unknown; toolCallId?: string }): void {
		traceLog(`tool_start name=${event.toolName} args=${JSON.stringify(event.args ?? null).slice(0, 400)} pending=${this.pendingStandardSpawns.size}`);
		if (event.toolName !== STANDARD_AGENT_TOOL) return;
		for (const job of this.reservedReviewJobs()) {
			if (!job.params || job.agentId || !matchesReservedAgentArgs(event.args, job.params)) continue;
			job.spawnToolCallId = event.toolCallId;
			job.lastActivityAt = Date.now();
		}
	}

	observeToolEnd(event: ToolExecutionEndLike): void {
		traceLog(`tool_end name=${event.toolName} id=${event.toolCallId} pending=${this.pendingStandardSpawns.size} jobs=${this.reviewJobs.size}`);
		for (const job of this.reservedReviewJobs()) {
			if (!this.sessionActive || !job.params) continue;
			const spawnId = parseAgentSpawnReceipt(event);
			if (spawnId && !job.agentId) {
				const startBound = Boolean(job.spawnToolCallId) && event.toolCallId === job.spawnToolCallId;
				const argsBound = matchesReservedAgentArgs(event.args, job.params);
				if (!startBound && !argsBound) continue;
				job.agentId = spawnId;
				job.spawnToolCallId = event.toolCallId ?? job.spawnToolCallId;
				job.lastActivityAt = Date.now();
				traceLog(`spawn-matched op=${job.operationId} agentId=${spawnId}`);
				job.resolveSpawn?.(spawnId);
				continue;
			}
			if (!job.agentId || job.resultToolCallId || event.toolName !== STANDARD_AGENT_RESULT_TOOL) continue;
			try {
				const native = parseAgentResultPayload(event, job.agentId);
				if (!native) continue;
				job.resultToolCallId = event.toolCallId;
				job.lastActivityAt = Date.now();
				job.resolveHostTerminal?.({ settlement: "native_terminal", native });
				if (nativeReviewResultIsFailure(native))
					job.rejectHandleResult?.(new Error(native.result));
				else
					job.resolveHandleResult?.(native);
			} catch (error) {
				job.resultToolCallId = event.toolCallId;
				const terminalError = error instanceof Error ? error : new Error(String(error));
				job.rejectHostTerminal?.(terminalError);
				job.rejectHandleResult?.(terminalError);
			}
		}
	}

	// -- state accessors for the adapter -----------------------------------

	active(taskId: string): ActiveAssuranceState | null {
		const advanceReservation = this.advanceReservations.get(taskId);
		if (advanceReservation)
			return {
				state: "started",
				operation: "qa",
				operation_id: advanceReservation,
				deadline_seconds: QA_JOB_TIMEOUT_SECONDS,
			};
		const qa = this.qaJobs.get(taskId);
		if (qa)
			return {
				state: "started",
				operation: "qa",
				operation_id: qa.operationId,
				deadline_seconds: qa.deadlineSeconds,
			};
		const review = this.reviewJobs.get(taskId);
		if (review)
			return {
				state: "started",
				operation: "review",
				operation_id: review.operationId,
				deadline_seconds: review.stopThresholdSeconds ?? this.reviewDeadlineSeconds(),
			};
		const reviewReservation = this.reviewReservations.get(taskId);
		if (reviewReservation && !this.dispatchFailedOperations.get(reviewReservation))
			return {
				state: "started",
				operation: "review",
				operation_id: reviewReservation,
				deadline_seconds: Math.max(
					1,
					Math.ceil((this.ports.reviewSpawnTimeoutMs ?? REVIEW_DISPATCH_TIMEOUT_MS) / 1000),
				),
			};
		const reviewSettlement = this.reviewSettlements.get(taskId);
		if (reviewSettlement)
			return {
				state: "settling",
				operation: "review",
				operation_id: reviewSettlement.operationId,
				lifecycle: reviewSettlement.lifecycle,
			};
		const pendingReview = this.pendingReviewVerdicts.get(taskId);
		if (pendingReview)
			return {
				state: "awaiting_user",
				operation: "review",
				operation_id: pendingReview.operationId,
				reason: "native review verdict awaits literal-user confirmation",
			};
		return null;
	}

	hasPendingReviewVerdict(taskId: string): boolean {
		return this.pendingReviewVerdicts.has(taskId);
	}

	pendingReviewVerdict(taskId: string): PendingReviewVerdict | undefined {
		return this.pendingReviewVerdicts.get(taskId);
	}

	clearPendingReviewVerdict(taskId: string): void {
		this.pendingReviewVerdicts.delete(taskId);
	}

	openInvocation(taskId: string): InvocationToken {
		const invocation = invocationRegistry.open(taskId);
		this.sessionInvocations.add(invocation);
		return invocation;
	}

	closeInvocation(invocation: InvocationToken): void {
		try {
			invocationRegistry.cancel(invocation);
		} catch {
			// A later invocation may already have replaced this closed token.
		}
		this.sessionInvocations.delete(invocation);
	}

	private closeSessionInvocation(invocation: InvocationToken): void {
		try {
			invocationRegistry.cancel(invocation);
		} catch {
			// A later invocation may already have replaced this closed token.
		}
		this.sessionInvocations.delete(invocation);
	}

	commitInvocation(invocation: InvocationToken): void {
		invocationRegistry.commit(invocation);
	}

	invocationState(invocation: InvocationToken): InvocationState {
		return invocationRegistry.stateOf(invocation);
	}

	isInvocationOpen(taskId: string): boolean {
		return invocationRegistry.isOpen(taskId);
	}

	sessionActiveValue(): boolean {
		return this.sessionActive;
	}

	sessionGenerationValue(): number {
		return this.sessionGeneration;
	}

	// -- operations --------------------------------------------------------

	advance(taskId: string, ctx: ExtensionContext): Promise<AssuranceAdvanceResult> {
		const active = this.active(taskId);
		if (active) return Promise.resolve(this.advanceResultForActive(active));
		const operationId = randomUUID();
		this.advanceReservations.set(taskId, operationId);
		this.ports.publish(ctx, {
			task_id: taskId,
			operation_id: operationId,
			role: "qa",
			lifecycle: "starting",
			stage: "deriving next assurance action",
			started_at: Date.now(),
			deadline_seconds: QA_JOB_TIMEOUT_SECONDS,
			telemetry: "deterministic",
		});
		return (async () => {
			try {
				await this.ports.advanceBeforeProjection?.();
				let projection = await this.ports.projectTask(ctx.cwd, taskId);
				if (this.advanceReservations.get(taskId) !== operationId)
					return { state: "blocked", reason: "assurance advance was cancelled before dispatch" };
				if (projection.error || !projection.claim)
					return { state: "blocked", reason: projection.error ?? "no active backend claim" };
				// Keep the mutation boundary self-defending even though the
				// projection already rejects a mismatched workspace claim.
				if (projection.claim.task_id !== taskId)
					return { state: "blocked", reason: `backend claim belongs to ${projection.claim.task_id}, not ${taskId}` };
				if (projection.projection.phase === "done") return { state: "completed" };
				if (projection.projection.phase === "stopped")
					return { state: "blocked", reason: "task is stopped" };
				const parked = await this.ports.readTaskRecordV2(ctx.cwd, taskId);
				if (
					parked.record?.findings.some(
						(finding) => finding.kind === "replan_required" && finding.status === "open",
					)
				) {
					return {
						state: "blocked",
						reason: "review rework limit reached; a durable replan is required",
					};
				}
				if (projection.projection.phase === "working") {
					if (projection.projection.missing_acceptance_ids.length > 0) {
						return {
							state: "blocked",
							reason: `fresh evidence is missing for: ${projection.projection.missing_acceptance_ids.join(",")}`,
						};
					}
					await this.ports.applyOrdinaryOperation(ctx, {
						taskId,
						operation: { op: "submit_review", actor_id: "executor" },
					});
					projection = await this.ports.projectTask(ctx.cwd, taskId);
					if (projection.error || projection.projection.phase !== "review")
						return { state: "blocked", reason: projection.error ?? "submit_review did not enter review phase" };
				}
				const pending = this.pendingReviewVerdicts.get(taskId);
				if (pending) return { state: "awaiting_user", operation: "record-review-verdict" };
				const freshApprovalKinds = projection.projection.fresh_approval_kinds;
				const correlation: AssuranceCorrelation = {
					record_revision: projection.projection.record_revision,
					intent_content_hash: projection.projection.intent_content_hash,
					diff_hash: projection.projection.diff_hash,
				};
				if (!freshApprovalKinds.includes("qa")) {
					this.advanceReservations.delete(taskId);
					return this.startQa(taskId, ctx, operationId, correlation);
				}
				if (!freshApprovalKinds.includes("review")) {
					this.advanceReservations.delete(taskId);
					return this.startReview(taskId, ctx, undefined, operationId, correlation);
				}
				const intent = await this.ports.readTaskIntent(ctx.cwd, taskId);
				if (intent.intent.risk === "critical" && !freshApprovalKinds.includes("user"))
					return { state: "awaiting_user", operation: "record-user-approval" };
				return { state: "completed" };
			} catch (error) {
				return { state: "blocked", reason: boundedAssuranceError(error) };
			} finally {
				if (this.advanceReservations.get(taskId) === operationId) this.advanceReservations.delete(taskId);
			}
		})();
	}

	async cancel(taskId: string, ctx: ExtensionContext): Promise<AssuranceCancelResult> {
		const advanceReservation = this.advanceReservations.get(taskId);
		if (advanceReservation) {
			this.advanceReservations.delete(taskId);
			this.ports.publish(ctx, {
				task_id: taskId,
				operation_id: advanceReservation,
				role: "qa",
				lifecycle: "cancelled",
				stage: "advance cancelled before dispatch",
				started_at: Date.now(),
				deadline_seconds: QA_JOB_TIMEOUT_SECONDS,
				telemetry: "deterministic",
				footer: "qa: advance cancelled before dispatch",
			});
			this.ports.notify(ctx, `assurance advance cancellation requested for ${taskId}`, "info");
			return { state: "cancelled", operation: "qa", operation_id: advanceReservation };
		}
		const qaJob = this.qaJobs.get(taskId);
		if (qaJob) {
			if (qaJob.invocation && invocationRegistry.stateOf(qaJob.invocation) === "committed") {
				qaJob.stage = "authority apply already committed; cancellation unavailable";
				this.presentQa(ctx, taskId, qaJob, "cancellation_requested", `qa: ${qaJob.stage}`);
				this.ports.notify(
					ctx,
					`deterministic QA for ${taskId} has crossed the authority commit point and cannot be cancelled`,
					"warning",
				);
				return { state: "blocked", reason: qaJob.stage };
			}
			this.qaJobs.delete(taskId);
			clearInterval(qaJob.heartbeat);
			clearTimeout(qaJob.timeout);
			qaJob.controller.abort();
			if (qaJob.invocation) {
				invocationRegistry.cancel(qaJob.invocation);
				this.sessionInvocations.delete(qaJob.invocation);
			}
			qaJob.stage = "cancelled";
			this.presentQa(ctx, taskId, qaJob, "cancelled", "qa: cancelled");
			this.ports.notify(ctx, `deterministic QA cancellation requested for ${taskId}`, "info");
			this.deliverTerminal(qaJob, taskId, "qa", "cancelled", "deterministic QA cancelled before authority commit");
			return { state: "cancelled", operation: "qa", operation_id: qaJob.operationId };
		}
		const reviewReservation = this.reviewReservations.get(taskId);
		if (reviewReservation) {
			this.reviewReservations.delete(taskId);
			this.reviewSettlements.set(taskId, { operationId: reviewReservation, lifecycle: "cancellation_requested" });
			// Keep a dispatched standard Agent reservation observable. A late spawn
			// receipt and its matching result are the only terminal evidence.
			this.presentReview(
				ctx,
				taskId,
				reviewReservation,
				"startup cancellation requested",
				"cancellation_requested",
				Date.now(),
				undefined,
				"review: startup cancellation requested",
			);
			this.ports.notify(ctx, `native review startup cancellation requested for ${taskId}`, "info");
			return { state: "cancellation_requested", operation: "review", operation_id: reviewReservation };
		}
		const reviewSettlement = this.reviewSettlements.get(taskId);
		if (reviewSettlement)
			return { state: "cancellation_requested", operation: "review", operation_id: reviewSettlement.operationId };
		const reviewJob = this.reviewJobs.get(taskId);
		if (!reviewJob) return { state: "idle" };
		this.reviewJobs.delete(taskId);
		this.reviewSettlements.set(taskId, {
			operationId: reviewJob.operationId,
			lifecycle: "cancellation_requested",
			job: reviewJob,
		});
		clearInterval(reviewJob.heartbeat);
		if (reviewJob.softTimeout) clearTimeout(reviewJob.softTimeout);
		clearTimeout(reviewJob.timeout);
		reviewJob.stage = "cancellation requested";
		this.presentReview(ctx, taskId, reviewJob.operationId, reviewJob.stage, "cancellation_requested", reviewJob.startedAt, reviewJob.agentId ?? reviewJob.handle?.agentId, "review: cancellation requested");
		void this.stopReviewAndRemoveEvidence(reviewJob).then((outcome) => {
			if (this.reviewSettlements.get(taskId)?.operationId === reviewJob.operationId)
				this.reviewSettlements.delete(taskId);
			if (!this.sessionActive) return;
			this.notifyReviewStopOutcome(ctx, outcome);
			reviewJob.stage = "cancelled";
			this.presentReview(ctx, taskId, reviewJob.operationId, reviewJob.stage, "cancelled", reviewJob.startedAt, reviewJob.agentId ?? reviewJob.handle?.agentId, "review: cancelled");
			this.deliverTerminal(reviewJob, taskId, "review", "cancelled", "native review reached terminal settlement after cancellation");
		}, (error) => {
			if (this.sessionActive)
				this.ports.notify(ctx, `native review cancellation remains unsettled: ${boundedAssuranceError(error)}`, "warning");
		});
		this.ports.notify(ctx, `native review cancellation requested for ${taskId}`, "info");
		return { state: "cancellation_requested", operation: "review", operation_id: reviewJob.operationId };
	}

	async startQa(
		taskId: string,
		ctx: ExtensionContext,
		operationId = randomUUID(),
		initialCorrelation?: AssuranceCorrelation,
	): Promise<AssuranceAdvanceResult> {
		const active = this.active(taskId);
		if (active) return this.advanceResultForActive(active);
		const preparingOperationId = this.qaPreparations.get(taskId);
		if (preparingOperationId) {
			return {
				state: "blocked",
				reason: `deterministic QA ${preparingOperationId} is deriving its declared aggregate deadline`,
			};
		}
		this.qaPreparations.set(taskId, operationId);
		let qaDeadlineMs: number;
		try {
			if (this.ports.qaJobTimeoutMs !== undefined) {
				qaDeadlineMs = this.ports.qaJobTimeoutMs;
			} else {
				const parked = await this.ports.readTaskRecordV2(ctx.cwd, taskId);
				if (!parked.record) throw new Error("TaskRecord v2 is missing");
				if (this.qaPreparations.get(taskId) !== operationId)
					return { state: "blocked", reason: "deterministic QA deadline derivation was cancelled" };
				const descriptors = parked.record.intent_snapshot.acceptance.map((item) =>
					parseVerificationDescriptor(item.verification)
				);
				qaDeadlineMs = deriveQaJobTimeoutMs(descriptors);
			}
		} catch (error) {
			const reason = `deterministic QA deadline derivation failed: ${boundedAssuranceError(error)}`;
			this.ports.notify(ctx, reason, "error");
			return { state: "blocked", reason };
		} finally {
			if (this.qaPreparations.get(taskId) === operationId) this.qaPreparations.delete(taskId);
		}
		const job: SessionQaJob = {
			operationId,
			controller: new AbortController(),
			startedAt: Date.now(),
			deadlineMs: qaDeadlineMs,
			deadlineSeconds: Math.max(1, Math.ceil(qaDeadlineMs / 1000)),
			stage: "starting",
			lastActivityAt: Date.now(),
			current: 0,
			total: 0,
			notifiedProgress: new Set(),
			...(initialCorrelation ? { correlation: initialCorrelation } : {}),
			heartbeat: setInterval(() => {}, 1000),
			timeout: setTimeout(() => {}, 1),
			sessionGeneration: this.sessionGeneration,
		};
		clearInterval(job.heartbeat);
		clearTimeout(job.timeout);
		this.qaJobs.set(taskId, job);
		this.presentQa(ctx, taskId, job, "starting");
		job.heartbeat = setInterval(() => {
			if (!this.qaJobIsActive(taskId, job)) return;
			const stalled = Date.now() - job.lastActivityAt >= ASSURANCE_STALL_MS;
			this.presentQa(
				ctx,
				taskId,
				job,
				stalled ? "stalled" : "running",
				stalled ? `${qaJobStatus(job)} | no progress for 30s` : undefined,
			);
			const stalledKey = `stalled:${job.current}:${job.stage}`;
			if (stalled && !job.notifiedProgress.has(stalledKey)) {
				job.notifiedProgress.add(stalledKey);
				this.ports.notify(
					ctx,
					`QA ${job.current}/${job.total} | ${job.stage} | no progress for 30s | hard limit ${formatQaDuration(job.deadlineSeconds)}`,
					"warning",
				);
			}
		}, 1000);
		this.armQaTimeout(taskId, ctx, job);
		this.ports.notify(
			ctx,
			`deterministic QA started for ${taskId} in the background; hard limit ${formatQaDuration(job.deadlineSeconds)}; input remains available; use /imm-canary-assure ${taskId} cancel to stop it`,
			"info",
		);
		void this.runQaJob(taskId, ctx, job);
		return {
			state: "started",
			operation: "qa",
			operation_id: operationId,
			deadline_seconds: job.deadlineSeconds,
		};
	}

	startReview(
		taskId: string,
		ctx: ExtensionContext,
		model?: string,
		operationId?: string,
		initialCorrelation?: AssuranceCorrelation,
	): AssuranceAdvanceResult {
		const active = this.active(taskId);
		if (active) return this.advanceResultForActive(active);
		// Exactly one re-dispatch of the same reserved operation: when a prior
		// dispatch failed with a provider no-verdict failure (no settlement,
		// reservation kept), the next start reuses the reservation. A caller
		// that supplies an explicit operation id always wins.
		const reusedReservation =
			operationId === undefined &&
			this.reviewReservations.has(taskId) &&
			!this.reviewSettlements.has(taskId) &&
			this.dispatchFailedOperations.get(this.reviewReservations.get(taskId)!) === true;
		const usedOperationId: string = reusedReservation
			? this.reviewReservations.get(taskId)!
			: (operationId ?? randomUUID());
		const preparationBudgetMs = this.ports.reviewPreparationTimeoutMs ?? REVIEW_PREPARATION_TIMEOUT_MS;
		const dispatchBudgetMs = this.ports.reviewSpawnTimeoutMs ?? REVIEW_DISPATCH_TIMEOUT_MS;
		const startedAt = Date.now();
		const remainingPhaseMs = (phaseStartedAt: number, budgetMs: number): number =>
			Math.max(0, budgetMs - (Date.now() - phaseStartedAt));
		const raceWithDeadline = async <T>(
			promise: Promise<T>,
			stage: string,
			phaseStartedAt: number,
			budgetMs: number,
		): Promise<T> => {
			const remaining = remainingPhaseMs(phaseStartedAt, budgetMs);
			if (remaining <= 0) throw new ReviewStartupTimeoutError(stage, budgetMs);
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				const result = await Promise.race([
					promise,
					new Promise<never>((_resolve, reject) => {
						timer = setTimeout(
							() => reject(new ReviewStartupTimeoutError(stage, budgetMs)),
							remaining,
						);
					}),
				]);
				if (Date.now() - phaseStartedAt >= budgetMs)
					throw new ReviewStartupTimeoutError(stage, budgetMs);
				return result;
			} finally {
				if (timer) clearTimeout(timer);
			}
		};
		const withinPreparationBudget = async <T>(promise: Promise<T>, stage: string): Promise<T> =>
			raceWithDeadline(promise, stage, startedAt, preparationBudgetMs);
		this.reviewReservations.set(taskId, usedOperationId);
		this.presentReview(ctx, taskId, usedOperationId, "starting", "starting", startedAt);
		this.ports.notify(
			ctx,
			`native Review is starting for ${taskId} in the background; input remains available`,
			"info",
		);
		const startupHeartbeat = setInterval(() => {
			if (!this.sessionActive || this.reviewReservations.get(taskId) !== usedOperationId) {
				clearInterval(startupHeartbeat);
				return;
			}
			this.presentReview(ctx, taskId, usedOperationId, "preparing native review", "starting", startedAt);
		}, 1000);
		void (async () => {
			let correlation: AssuranceCorrelation | undefined = initialCorrelation;
			let nativeSpawnStarted = false;
			const terminalTarget = { operationId: usedOperationId, correlation };
			const continueStartup = (): boolean => {
				if (!this.sessionActive) return false;
				if (this.reviewReservations.get(taskId) === usedOperationId) return true;
				this.presentReview(ctx, taskId, usedOperationId, "cancelled", "cancelled", startedAt);
				return false;
			};
			try {
				this.presentReview(ctx, taskId, usedOperationId, "reading task state", "starting", startedAt);
				const projection = await withinPreparationBudget(
					this.ports.projectTask(ctx.cwd, taskId),
					"task projection",
				);
				if (projection.error || !projection.claim)
					throw new Error(projection.error ?? "no active backend claim");
				correlation = {
					record_revision: projection.projection.record_revision,
					intent_content_hash: projection.projection.intent_content_hash,
					diff_hash: projection.projection.diff_hash,
				};
				terminalTarget.correlation = correlation;
				if (!continueStartup()) return;

				this.presentReview(ctx, taskId, usedOperationId, "resolving frozen runner", "starting", startedAt);
				const runner = await withinPreparationBudget(this.ports.frozenRunner(), "runner resolution");
				if (!continueStartup()) return;
				this.presentReview(ctx, taskId, usedOperationId, "capturing immutable snapshot", "starting", startedAt);
				const assurance = await withinPreparationBudget(
					this.ports.buildAssurance(ctx.cwd, taskId, "review", projection, runner),
					"immutable snapshot",
				);
				const { snapshot, reviewBundle } = assurance;
				correlation = {
					record_revision: snapshot.record_revision,
					intent_content_hash: snapshot.intent_content_hash,
					diff_hash: snapshot.diff_hash,
				};
				terminalTarget.correlation = correlation;
				if (!continueStartup()) return;
				if (!reviewBundle) throw new Error("immutable review bundle is missing");
				const workload = classifyReviewWorkload(snapshot, reviewBundle);
				const timing = this.reviewTimingProfile(workload);
				const maxTurns = reviewTurnBudget(workload);
				this.pendingReviewVerdicts.delete(taskId);
				// Reuse of the same reserved operation removes the prior dispatch's
				// artifact before writing the fresh one; the artifact is otherwise
				// kept until terminal settlement or explicit release.
				const priorEvidence = this.reviewEvidenceByOperation.get(usedOperationId);
				if (priorEvidence) {
					priorEvidence.remove();
					this.reviewEvidenceByOperation.delete(usedOperationId);
				}
				const evidence = this.ports.writeReviewEvidence({ snapshot, review_bundle: reviewBundle });
				this.reviewEvidenceByOperation.set(usedOperationId, evidence);
				const prompt = this.buildReviewPrompt(snapshot, evidence.path);
				const params = reservedAgentParams({
					taskId,
					operationId: usedOperationId,
					prompt,
					model,
					max_turns: maxTurns,
				});
				let handle: NativeReviewHandle | undefined;
				nativeSpawnStarted = true;
				if (!this.ports.startReview && correlation) {
					this.ports.dispatchReviewFollowUp({ taskId, operationId: usedOperationId, params, correlation });
				}
				const spawn = this.ports.startReview
					? this.ports.startReview({
						prompt,
						description: params.description,
						cwd: ctx.cwd,
						model,
						maxTurns,
					})
					: this.requestStandardAgentSpawn({ taskId, operationId: usedOperationId, params });
				try {
					this.presentReview(ctx, taskId, usedOperationId, "dispatching native subagent", "starting", startedAt);
					const dispatchStartedAt = Date.now();
					handle = await raceWithDeadline(
						spawn,
						this.ports.startReview ? "native spawn" : "standard Agent spawn",
						dispatchStartedAt,
						dispatchBudgetMs,
					);
				} catch (error) {
					const existingSettlement = this.reviewSettlements.get(taskId);
					if (
						existingSettlement?.operationId === usedOperationId &&
						existingSettlement.lifecycle === "cancellation_requested"
					) {
						void spawn.then(
							async (lateHandle) => {
								let outcome: ReviewStopSettlement;
								try {
									outcome = await this.stopReviewAndRemoveEvidence({
										operationId: usedOperationId,
										handle: lateHandle,
										startedAt,
										stage: "cancelled",
										lastActivityAt: Date.now(),
										correlation: correlation!,
										heartbeat: setInterval(() => {}, 1_000_000),
										timeout: setTimeout(() => {}, 1),
										evidence,
										params,
									});
								} catch (settlementError) {
									if (this.sessionActive)
										this.ports.notify(ctx, `native review startup cancellation remains unsettled: ${boundedAssuranceError(settlementError)}`, "warning");
									return;
								}
								if (this.reviewSettlements.get(taskId)?.operationId === usedOperationId)
									this.reviewSettlements.delete(taskId);
								if (this.sessionActive) {
									this.notifyReviewStopOutcome(ctx, outcome);
									this.presentReview(ctx, taskId, usedOperationId, "cancelled", "cancelled", startedAt);
									this.deliverTerminal(
										terminalTarget,
										taskId,
										"review",
										"cancelled",
										"native review startup reached terminal settlement after cancellation",
									);
								}
							},
							(spawnError) => {
								if (!this.sessionActive) return;
								this.ports.notify(
									ctx,
									`native review dispatch rejected after cancellation; terminal settlement remains unknown: ${boundedAssuranceError(spawnError)}`,
									"warning",
								);
							},
						);
						return;
					}
					if (error instanceof ReviewStartupTimeoutError) {
						this.releaseReviewReservation(taskId, usedOperationId);
						this.reviewSettlements.set(taskId, { operationId: usedOperationId, lifecycle: "timed_out" });
						this.presentReview(
							ctx,
							taskId,
							usedOperationId,
							"dispatch stop requested; awaiting native terminal settlement",
							"settling",
							startedAt,
						);
						this.ports.notify(
							ctx,
							`native review dispatch exceeded ${Math.ceil(dispatchBudgetMs / 1000)}s; awaiting terminal settlement`,
							"warning",
						);
						void spawn.then(
							async (lateHandle) => {
								let outcome: ReviewStopSettlement;
								try {
									outcome = await this.stopReviewAndRemoveEvidence({
										operationId: usedOperationId,
										handle: lateHandle,
										startedAt,
										stage: "timed_out",
										lastActivityAt: Date.now(),
										correlation: correlation!,
										heartbeat: setInterval(() => {}, 1_000_000),
										timeout: setTimeout(() => {}, 1),
										evidence,
										params,
									});
								} catch (settlementError) {
									if (this.sessionActive)
										this.ports.notify(ctx, `native review dispatch timeout remains unsettled: ${boundedAssuranceError(settlementError)}`, "warning");
									return;
								}
								if (this.reviewSettlements.get(taskId)?.operationId === usedOperationId)
									this.reviewSettlements.delete(taskId);
								if (this.sessionActive) {
									this.notifyReviewStopOutcome(ctx, outcome);
									this.presentReview(ctx, taskId, usedOperationId, "dispatch timed out", "timed_out", startedAt);
									this.deliverTerminal(
										terminalTarget,
										taskId,
										"review",
										"timed_out",
										"native review dispatch reached terminal settlement after its stop threshold",
									);
								}
							},
							(spawnError) => {
								if (!this.sessionActive) return;
								this.ports.notify(
									ctx,
									`native review dispatch promise rejected without a handle; terminal settlement remains unknown: ${boundedAssuranceError(spawnError)}`,
									"warning",
								);
							},
						);
						return;
					}
					// Provider quota/transport failures (429/rate-limit/quota/…) are
					// no-verdict dispatch failures: zero authority writes, the
					// reserved operation stays valid, no terminal review event, no
					// review round consumed, and exactly one re-dispatch of the
					// SAME reserved operation is permitted (the next startReview
					// reuses the reservation). The evidence artifact is kept.
					if (
						classifyDispatchFailure(error) === "no_verdict_dispatch_failure" &&
						!reusedReservation
					) {
						clearInterval(startupHeartbeat);
						this.dispatchFailedOperations.set(usedOperationId, true);
						this.ports.notify(
							ctx,
							`native review dispatch failed with a provider no-verdict failure (${boundedAssuranceError(error)}); reserved operation ${usedOperationId} remains valid; rerun the review to re-dispatch exactly once`,
							"warning",
						);
						return;
					}
					this.releaseReviewReservation(taskId, usedOperationId);
					this.dispatchFailedOperations.delete(usedOperationId);
					this.reviewSettlements.set(taskId, { operationId: usedOperationId, lifecycle: "dispatch_unknown" });
					// The evidence artifact is retained after an unsettled dispatch
					// (recovery may re-reserve); it is removed on a later dispatch of
					// the same operation or by session shutdown.
					this.presentReview(
						ctx,
						taskId,
						usedOperationId,
						"dispatch failed; native terminal settlement remains unknown",
						"settling",
						startedAt,
					);
					this.ports.notify(
						ctx,
						`native review dispatch failed without a terminal receipt; settlement remains unknown: ${boundedAssuranceError(error)}`,
						"warning",
					);
					return;
				}
				clearInterval(startupHeartbeat);
				this.dispatchFailedOperations.delete(usedOperationId);
				if (!this.sessionActive || this.reviewReservations.get(taskId) !== usedOperationId) {
					void this.stopReviewAndRemoveEvidence({
						operationId: usedOperationId,
						handle,
						startedAt,
						stage: "cancelled",
						lastActivityAt: Date.now(),
						correlation: correlation!,
						heartbeat: setInterval(() => {}, 1_000_000),
						timeout: setTimeout(() => {}, 1),
						evidence,
						params,
					}).then((outcome) => {
						if (this.reviewSettlements.get(taskId)?.operationId === usedOperationId)
							this.reviewSettlements.delete(taskId);
						if (!this.sessionActive) return;
						this.notifyReviewStopOutcome(ctx, outcome);
						this.presentReview(ctx, taskId, usedOperationId, "cancelled", "cancelled", startedAt, handle.agentId);
						this.deliverTerminal(terminalTarget, taskId, "review", "cancelled", "native review startup was cancelled");
					}, (settlementError) => {
						if (this.sessionActive)
							this.ports.notify(ctx, `native review startup cancellation remains unsettled: ${boundedAssuranceError(settlementError)}`, "warning");
					});
					return;
				}
				const executionStartedAt = Date.now();
				const job: SessionReviewJob = {
					operationId: usedOperationId,
					handle,
					agentId: handle.agentId,
					startedAt,
					executionStartedAt,
					workload,
					softDeadlineSeconds: timing.softDeadlineSeconds,
					stopThresholdSeconds: timing.stopThresholdSeconds,
					softDeadlineReached: false,
					stage: `native agent ${handle.agentId} running`,
					lastActivityAt: Date.now(),
					correlation,
					heartbeat: setInterval(() => {}, 1000),
					timeout: setTimeout(() => {}, 1),
					evidence,
					snapshot,
					params,
				};
				this.bindHostTerminalReceipt(job);
				const advisoryResult = job.hostTerminalReceipt;
				if (!advisoryResult)
					throw new Error("native review host terminal receipt is unavailable after standard Agent spawn");
				clearInterval(job.heartbeat);
				clearTimeout(job.timeout);
				job.heartbeat = setInterval(() => {
					if (!this.sessionActive || this.reviewJobs.get(taskId) !== job) return;
					this.presentReview(
						ctx,
						taskId,
						usedOperationId,
						job.stage,
						job.softDeadlineReached ? "slow" : "running",
						startedAt,
						handle.agentId,
						reviewJobStatus(job),
						job.stopThresholdSeconds,
					);
				}, 1000);
				const enforceReviewStopThreshold = () => {
					if (this.reviewJobs.get(taskId) !== job) return;
					this.reviewJobs.delete(taskId);
					this.reviewSettlements.set(taskId, { operationId: usedOperationId, lifecycle: "timed_out", job });
					clearInterval(job.heartbeat);
					if (job.softTimeout) clearTimeout(job.softTimeout);
					job.stage = `${workload} review stop requested after ${timing.stopThresholdSeconds}s; awaiting native terminal settlement`;
					this.presentReview(
						ctx,
						taskId,
						usedOperationId,
						job.stage,
						"settling",
						startedAt,
						job.agentId ?? handle.agentId,
						`review: ${job.stage}`,
						job.stopThresholdSeconds,
					);
					this.ports.notify(
						ctx,
						`native ${workload} review reached its ${timing.stopThresholdSeconds}s stop threshold; awaiting terminal settlement`,
						"warning",
					);
					void this.stopReviewAndRemoveEvidence(job).then((outcome) => {
						if (this.reviewSettlements.get(taskId)?.operationId === usedOperationId)
							this.reviewSettlements.delete(taskId);
						if (!this.sessionActive) return;
						this.notifyReviewStopOutcome(ctx, outcome);
						job.stage = `${workload} review reached terminal settlement after its stop threshold`;
						this.presentReview(
							ctx,
							taskId,
							usedOperationId,
							job.stage,
							"timed_out",
							startedAt,
							job.agentId ?? handle.agentId,
							`review: ${job.stage}`,
							job.stopThresholdSeconds,
						);
						this.deliverTerminal(job, taskId, "review", "timed_out", job.stage);
					}, (settlementError) => {
						if (this.sessionActive)
							this.ports.notify(ctx, `native review stop threshold remains unsettled: ${boundedAssuranceError(settlementError)}`, "warning");
					});
				};
				this.reviewJobs.set(taskId, job);
				this.releaseReviewReservation(taskId, usedOperationId);
				this.presentReview(
					ctx,
					taskId,
					usedOperationId,
					job.stage,
					"running",
					startedAt,
					handle.agentId,
					reviewJobStatus(job),
					job.stopThresholdSeconds,
				);
				this.ports.notify(
					ctx,
					`Pi native subagent ${handle.agentId} is reviewing ${taskId} in the background; input remains available; use /imm-canary-assure ${taskId} cancel to stop it`,
					"info",
				);
				void handle.result.then(() => undefined, () => undefined);
				let terminalReceiptObserved = false;
				void advisoryResult.then(async (receipt) => {
					terminalReceiptObserved = true;
					const native = receipt.native;
					if (nativeReviewResultIsFailure(native)) throw new Error(native.result);
					if (!this.sessionActive || this.reviewJobs.get(taskId) !== job) return;
					job.lastActivityAt = Date.now();
					const validationStartedAt = Date.now();
					const fresh = await raceWithDeadline(
						this.ports.projectTask(ctx.cwd, taskId),
						"verdict freshness validation",
						validationStartedAt,
						REVIEW_VERDICT_VALIDATION_TIMEOUT_MS,
					);
					if (!this.sessionActive || this.reviewJobs.get(taskId) !== job) return;
					if (
						fresh.error ||
						fresh.claim?.task_id !== taskId ||
						fresh.projection.record_revision !== snapshot.record_revision ||
						fresh.projection.workspace_revision !== snapshot.workspace_revision ||
						fresh.projection.intent_revision !== snapshot.intent_revision ||
						fresh.projection.intent_content_hash !== snapshot.intent_content_hash ||
						fresh.projection.diff_hash !== snapshot.diff_hash ||
						fresh.projection.phase !== snapshot.phase
					) {
						throw new Error("assurance snapshot changed before advisory parse");
					}
					const verdict = this.parseAssuranceVerdict(native.result, snapshot);
					if (Date.now() - validationStartedAt >= REVIEW_VERDICT_VALIDATION_TIMEOUT_MS)
						throw new ReviewStartupTimeoutError("verdict parse", REVIEW_VERDICT_VALIDATION_TIMEOUT_MS);
					this.pendingReviewVerdicts.set(taskId, {
						operationId: usedOperationId,
						snapshot,
						verdict,
						agentId: native.agentId,
						durationMs: native.durationMs,
						tokens: native.tokens,
					});
					job.stage = `native verdict ${verdict.decision}; awaiting user confirmation`;
					this.presentReview(ctx, taskId, usedOperationId, job.stage, "awaiting_user", startedAt, handle.agentId, `review: ${job.stage}`);
					this.ports.notify(
						ctx,
						`native review ${verdict.decision} is ready; call request_authorization for ${taskId}`,
						verdict.decision === "pass" ? "info" : "warning",
					);
					this.deliverTerminal(
						job,
						taskId,
						"review",
						"verdict_ready",
						`native review ${verdict.decision} awaits literal-user confirmation`,
						presentationFor(snapshot, verdict),
					);
				}).catch((error) => {
					if (!terminalReceiptObserved) {
						if (this.sessionActive && this.reviewJobs.get(taskId) === job)
							this.ports.notify(ctx, `native review terminal receipt remains unsettled: ${boundedAssuranceError(error)}`, "warning");
						return;
					}
					if (!this.sessionActive || this.reviewJobs.get(taskId) !== job) return;
					const message = boundedAssuranceError(error);
					job.stage = `failed - ${message}`;
					this.presentReview(ctx, taskId, usedOperationId, job.stage, "failed", startedAt, handle.agentId, `review: ${job.stage}`);
					this.ports.notify(ctx, `native review failed: ${message}`, "error");
					this.deliverTerminal(job, taskId, "review", "failed", message);
				}).finally(() => {
					if (!terminalReceiptObserved) return;
					if (this.reviewJobs.get(taskId) !== job) return;
					this.reviewJobs.delete(taskId);
					clearInterval(job.heartbeat);
					if (job.softTimeout) clearTimeout(job.softTimeout);
					clearTimeout(job.timeout);
					job.evidence.remove();
					this.reviewEvidenceByOperation.delete(job.operationId);
				});
				// Result settlement owns the operation before deadline callbacks can run.
				queueMicrotask(() => {
					if (this.reviewJobs.get(taskId) !== job) return;
					job.softTimeout = setTimeout(() => {
						if (this.reviewJobs.get(taskId) !== job) return;
						job.softDeadlineReached = true;
						job.stage = `native agent ${handle.agentId} running; ${workload} review is slow`;
						this.presentReview(
							ctx,
							taskId,
							usedOperationId,
							job.stage,
							"slow",
							startedAt,
							handle.agentId,
							reviewJobStatus(job),
							job.stopThresholdSeconds,
						);
						this.ports.notify(
							ctx,
							`native ${workload} review is slow after ${timing.softDeadlineSeconds}s; it remains active`,
							"warning",
						);
					}, timing.softDeadlineSeconds * 1000);
					job.timeout = setTimeout(
						enforceReviewStopThreshold,
						timing.stopThresholdSeconds * 1000,
					);
				});
			} catch (error) {
				clearInterval(startupHeartbeat);
				this.releaseReviewReservation(taskId, usedOperationId);
				if (!this.sessionActive) return;
				const message = boundedAssuranceError(error);
				const cancellationSettled =
					this.reviewSettlements.get(taskId)?.operationId === usedOperationId &&
					this.reviewSettlements.get(taskId)?.lifecycle === "cancellation_requested";
				const timedOut = !cancellationSettled && error instanceof ReviewStartupTimeoutError;
				const lifecycle = cancellationSettled ? "cancelled" : timedOut ? "timed_out" : "failed";
				const displayLifecycle = timedOut ? "timed out" : lifecycle;
				const terminalMessage = cancellationSettled
					? "native review startup reached terminal settlement after cancellation"
					: message;
				this.presentReview(
					ctx,
					taskId,
					usedOperationId,
					`${displayLifecycle} - ${terminalMessage}`,
					lifecycle,
					startedAt,
					undefined,
					`review: ${displayLifecycle} - ${terminalMessage}`,
				);
				this.ports.notify(
					ctx,
					cancellationSettled
						? `native review startup cancellation settled locally for ${taskId}`
						: timedOut
							? `native review startup timed out before dispatch: ${message}`
							: `native review failed to start: ${message}`,
					cancellationSettled ? "info" : "error",
				);
			} finally {
				if (
					!nativeSpawnStarted &&
					this.reviewReservations.get(taskId) !== usedOperationId &&
					this.reviewSettlements.get(taskId)?.operationId === usedOperationId
				) this.reviewSettlements.delete(taskId);
			}
		})();
		return {
			state: "started",
			operation: "review",
			operation_id: usedOperationId,
			deadline_seconds: Math.max(1, Math.ceil(dispatchBudgetMs / 1000)),
		};
	}

	// -- internal lifecycle -------------------------------------------------

	private reviewTimingProfile(workload: ReviewWorkload): ReviewTimingProfile {
		const configured = REVIEW_TIMING_PROFILES[workload];
		const stopThresholdMs = this.ports.reviewJobTimeoutMs ?? configured.stopThresholdSeconds * 1000;
		const softDeadlineMs = this.ports.reviewSoftDeadlineMs ?? Math.min(
			configured.softDeadlineSeconds * 1000,
			stopThresholdMs,
		);
		return {
			softDeadlineSeconds: Math.max(0.001, softDeadlineMs / 1000),
			stopThresholdSeconds: Math.max(0.001, stopThresholdMs / 1000),
		};
	}

	private reviewDeadlineSeconds(): number {
		const totalMs = this.ports.reviewJobTimeoutMs ?? REVIEW_TIMING_PROFILES.standard.stopThresholdSeconds * 1000;
		return Math.max(1, Math.ceil(totalMs / 1000));
	}

	private advanceResultForActive(active: ActiveAssuranceState): AssuranceAdvanceResult {
		if (active.state !== "settling") return active;
		return {
			state: "blocked",
			reason: `review operation ${active.operation_id} is awaiting terminal ${active.lifecycle} settlement`,
		};
	}

	private armQaTimeout(taskId: string, ctx: ExtensionContext, job: SessionQaJob): void {
		clearTimeout(job.timeout);
		const remainingMs = Math.max(1, job.deadlineMs - (Date.now() - job.startedAt));
		job.timeout = setTimeout(() => {
			if (this.qaJobs.get(taskId) !== job) return;
			if (job.invocation && invocationRegistry.stateOf(job.invocation) === "committed") {
				this.qaJobs.delete(taskId);
				clearInterval(job.heartbeat);
				this.sessionInvocations.delete(job.invocation);
				job.stage = "authority settlement unknown; next operation will revalidate Kernel state";
				this.presentQa(ctx, taskId, job, "timed_out", `qa: ${job.stage}`);
				this.ports.notify(
					ctx,
					"deterministic QA reached its job ceiling after authority commit; background ownership was released and the next operation must revalidate Kernel state",
					"warning",
				);
				this.deliverTerminal(job, taskId, "qa", "timed_out", job.stage);
				return;
			}
			this.qaJobs.delete(taskId);
			clearInterval(job.heartbeat);
			job.controller.abort();
			if (job.invocation) {
				invocationRegistry.cancel(job.invocation);
				this.sessionInvocations.delete(job.invocation);
			}
			if (this.sessionActive) {
				job.stage = `timed out after ${job.deadlineSeconds}s`;
				this.presentQa(ctx, taskId, job, "timed_out", `qa: ${job.stage}`);
				this.ports.notify(ctx, `deterministic QA timed out after ${job.deadlineSeconds}s`, "error");
				this.deliverTerminal(job, taskId, "qa", "timed_out", job.stage);
			}
		}, remainingMs);
	}

	private presentQa(
		ctx: ExtensionContext,
		taskId: string,
		job: SessionQaJob,
		lifecycle: AssuranceView["lifecycle"] = "running",
		footer = qaJobStatus(job),
	): void {
		this.ports.publish(ctx, {
			task_id: taskId,
			operation_id: job.operationId,
			role: "qa",
			lifecycle,
			stage: job.stage,
			started_at: job.startedAt,
			deadline_seconds: job.deadlineSeconds,
			current: job.current,
			total: job.total,
			telemetry: "deterministic",
			footer,
		});
	}

	private presentReview(
		ctx: ExtensionContext,
		taskId: string,
		operationId: string,
		stage: string,
		lifecycle: AssuranceView["lifecycle"],
		startedAt: number,
		agentId?: string,
		footer?: string,
		deadlineSeconds = this.reviewDeadlineSeconds(),
	): void {
		this.ports.publish(ctx, {
			task_id: taskId,
			operation_id: operationId,
			role: "review",
			lifecycle,
			stage,
			started_at: startedAt,
			deadline_seconds: deadlineSeconds,
			agent_id: agentId,
			telemetry: "native_lifecycle_only",
			...(footer ? { footer } : {}),
		});
	}

	private deliverTerminal(
		job: { operationId: string; correlation?: AssuranceCorrelation },
		taskId: string,
		role: AssuranceRole,
		terminal: "rework" | "verdict_ready" | "failed" | "timed_out" | "cancelled",
		summary: string,
		presentation?: AssuranceResultPresentation,
	): void {
		if (!job.correlation || !this.sessionActive) return;
		const terminalKey = `${taskId}:${job.operationId}:${role}`;
		if (this.terminalOperations.has(terminalKey)) return;
		this.terminalOperations.add(terminalKey);
		const nextAction: AssuranceNextAction = terminal === "verdict_ready"
			? "request_authorization"
			: terminal === "rework"
				? "repair_findings"
				: "inspect_assurance_failure";
		this.ports.deliverFollowUp({
			contract: "assurance_kernel/assurance_follow_up/v1",
			task_id: taskId,
			operation_id: job.operationId,
			role,
			terminal,
			summary,
			next_action: nextAction,
			superseded: isSupersededFollowUp(this.currentOperationId(taskId), job.operationId),
			...(presentation ? { presentation } : {}),
			...job.correlation,
		});
	}

	// The current operation for a task is its newest live job, settlement, or
	// reservation; a follow-up whose operation is no longer current is stale and
	// must be annotated rather than acted on.
	currentOperationId(taskId: string): string | undefined {
		const active = this.active(taskId);
		if (active) return active.operation_id;
		const settlement = this.reviewSettlements.get(taskId);
		if (settlement) return settlement.operationId;
		const reservation = this.reviewReservations.get(taskId);
		return reservation ?? undefined;
	}

	private releaseReviewReservation(taskId: string, nonce: string | undefined) {
		if (nonce && this.reviewReservations.get(taskId) === nonce) this.reviewReservations.delete(taskId);
	}

	private invalidateReviewJob(job: SessionReviewJob, reason: string): void {
		job.rejectSpawn?.(new Error(reason));
		job.rejectHostTerminal?.(new Error(reason));
		job.rejectHandleResult?.(new Error(reason));
		job.resolveSpawn = undefined;
		job.rejectSpawn = undefined;
		job.resolveHostTerminal = undefined;
		job.rejectHostTerminal = undefined;
		job.resolveHandleResult = undefined;
		job.rejectHandleResult = undefined;
	}

	private async stopReviewAndRemoveEvidence(
		job: SessionReviewJob,
	): Promise<ReviewStopSettlement> {
		clearInterval(job.heartbeat);
		if (job.softTimeout) clearTimeout(job.softTimeout);
		clearTimeout(job.timeout);
		if (!job.handle) throw new Error("native review handle is unavailable; terminal settlement remains unknown");
		for (const settlement of this.reviewSettlements.values()) {
			if (settlement.operationId === job.operationId && !settlement.job)
				settlement.job = job;
		}
		this.bindHostTerminalReceipt(job);
		const terminal = job.hostTerminalReceipt;
		if (!terminal) throw new Error("native review host terminal receipt is unavailable");
		let stopError: unknown;
		void Promise.resolve()
			.then(() => job.handle!.stop())
			.catch((error) => { stopError = error; });
		const receipt = await terminal;
		let cleanupError: unknown;
		try {
			job.evidence.remove();
			this.reviewEvidenceByOperation.delete(job.operationId);
		} catch (error) {
			cleanupError = error;
		}
		return {
			settlement: receipt.settlement,
			...(stopError !== undefined ? { stopError } : {}),
			...(cleanupError !== undefined ? { cleanupError } : {}),
		};
	}

	private notifyReviewStopOutcome(ctx: ExtensionContext, outcome: ReviewStopSettlement): void {
		if (outcome.stopError !== undefined)
			this.ports.notify(ctx, `native review stop failed: ${boundedAssuranceError(outcome.stopError)}`, "error");
		if (outcome.cleanupError !== undefined)
			this.ports.notify(ctx, `native review evidence cleanup failed after terminal settlement: ${boundedAssuranceError(outcome.cleanupError)}`, "error");
	}

	private bindHostTerminalReceipt(job: SessionReviewJob): void {
		if (!this.ports.startReview) {
			const pending = this.pendingStandardSpawns.get(job.operationId);
			if (pending && pending !== job) {
				job.hostTerminalReceipt = pending.hostTerminalReceipt;
				job.resolveHostTerminal = pending.resolveHostTerminal;
				job.rejectHostTerminal = pending.rejectHostTerminal;
				job.resolveHandleResult = pending.resolveHandleResult;
				job.rejectHandleResult = pending.rejectHandleResult;
				job.spawnToolCallId = pending.spawnToolCallId;
				job.resultToolCallId = pending.resultToolCallId;
				this.pendingStandardSpawns.delete(job.operationId);
			}
		}
		if (job.handle && !job.agentId) job.agentId = job.handle.agentId;
		if (job.handle) void job.handle.result.then(() => undefined, () => undefined);
		if (job.hostTerminalReceipt) return;
		job.hostTerminalReceipt = new Promise<NativeTerminalReceipt>((resolve, reject) => {
			job.resolveHostTerminal = resolve;
			job.rejectHostTerminal = reject;
		});
		void job.hostTerminalReceipt.then(() => undefined, () => undefined);
	}

	private requestStandardAgentSpawn(input: {
		taskId: string;
		operationId: string;
		params: ReservedAgentParams;
	}): Promise<NativeReviewHandle> {
		const job: SessionReviewJob = {
			operationId: input.operationId,
			startedAt: Date.now(),
			stage: "awaiting standard Agent spawn",
			lastActivityAt: Date.now(),
			correlation: { record_revision: "", intent_content_hash: "", diff_hash: "" },
			heartbeat: setInterval(() => {}, 1_000_000),
			timeout: setTimeout(() => {}, 1),
			evidence: { path: "", remove() {} },
			params: input.params,
		};
		clearInterval(job.heartbeat);
		clearTimeout(job.timeout);
		const spawn = new Promise<string>((resolve, reject) => {
			job.resolveSpawn = resolve;
			job.rejectSpawn = reject;
		});
		const result = new Promise<NativeReviewResult>((resolve, reject) => {
			job.resolveHandleResult = resolve;
			job.rejectHandleResult = reject;
		});
		job.hostTerminalReceipt = new Promise<NativeTerminalReceipt>((resolve, reject) => {
			job.resolveHostTerminal = resolve;
			job.rejectHostTerminal = reject;
		});
		void result.then(() => undefined, () => undefined);
		void job.hostTerminalReceipt.then(() => undefined, () => undefined);
		this.pendingStandardSpawns.set(input.operationId, job);
		traceLog(`spawn-registered op=${input.operationId} params=${JSON.stringify(input.params).slice(0, 200)}`);
		return spawn.then((agentId) => {
			job.agentId = agentId;
			return {
				agentId,
				result,
			stop: async () => {
					traceLog(`stop-requested op=${input.operationId}; awaiting native terminal tool event`);
				},
			};
		});
	}

	private reservedReviewJobs(): SessionReviewJob[] {
		return [
			...this.pendingStandardSpawns.values(),
			...this.reviewJobs.values(),
			...[...this.reviewSettlements.values()].flatMap((settlement) => settlement.job ? [settlement.job] : []),
		];
	}

	private qaJobIsActive(taskId: string, job: SessionQaJob): boolean {
		return (
			this.sessionActive &&
			this.sessionGeneration === job.sessionGeneration &&
			this.qaJobs.get(taskId) === job &&
			!job.controller.signal.aborted
		);
	}

	private releaseQaJob(taskId: string, job: SessionQaJob): void {
		if (this.qaJobs.get(taskId) === job) this.qaJobs.delete(taskId);
		clearInterval(job.heartbeat);
		clearTimeout(job.timeout);
		if (job.invocation) {
			try {
				invocationRegistry.cancel(job.invocation);
			} catch {
				// Already committed or cancelled.
			}
			this.sessionInvocations.delete(job.invocation);
		}
	}

	private async runQaJob(taskId: string, ctx: ExtensionContext, job: SessionQaJob): Promise<void> {
		let lastVerdict: AssuranceVerdict | undefined;
		try {
			job.stage = "reading task state";
			this.presentQa(ctx, taskId, job);
			await this.ports.qaBeforeProjection?.();
			if (!this.qaJobIsActive(taskId, job)) return;
			const projection = await this.ports.projectTask(ctx.cwd, taskId);
			if (!this.qaJobIsActive(taskId, job)) return;
			if (projection.error || !projection.claim)
				throw new Error(projection.error ?? "no active backend claim");
			job.correlation = {
				record_revision: projection.projection.record_revision,
				intent_content_hash: projection.projection.intent_content_hash,
				diff_hash: projection.projection.diff_hash,
			};

			job.stage = "resolving frozen runner";
			this.presentQa(ctx, taskId, job);
			const runner = await this.ports.frozenRunner();
			if (!this.qaJobIsActive(taskId, job)) return;

			job.stage = "capturing immutable snapshot";
			this.presentQa(ctx, taskId, job);
			const assurance = await this.ports.buildAssurance(ctx.cwd, taskId, "qa", projection, runner);
			if (!this.qaJobIsActive(taskId, job)) return;
			const { snapshot, descriptors } = assurance;
			job.total = snapshot.acceptance.length;
			job.correlation = {
				record_revision: snapshot.record_revision,
				intent_content_hash: snapshot.intent_content_hash,
				diff_hash: snapshot.diff_hash,
			};
			if (this.ports.qaJobTimeoutMs === undefined) {
				job.deadlineMs = deriveQaJobTimeoutMs(descriptors.values());
				job.deadlineSeconds = job.deadlineMs / 1000;
				this.armQaTimeout(taskId, ctx, job);
			}

			const invocation = invocationRegistry.open(taskId);
			job.invocation = invocation;
			this.sessionInvocations.add(invocation);
			job.stage = "running fixed verifications";
			this.presentQa(ctx, taskId, job);
			const verdict = await this.ports.runQa(snapshot, descriptors, runner, {
				signal: job.controller.signal,
				onProgress: (progress) => {
					if (!this.qaJobIsActive(taskId, job)) return;
					job.current = progress.index;
					job.total = progress.total;
					const elapsed = progress.elapsed_ms > 0 ? ` (${Math.ceil(progress.elapsed_ms / 1000)}s)` : "";
					job.stage = `${progress.acceptance_id.slice(0, 80)} ${progress.phase}${elapsed}`;
					job.lastActivityAt = Date.now();
					for (const key of job.notifiedProgress) {
						if (key.startsWith("stalled:")) job.notifiedProgress.delete(key);
					}
					const progressKey = `${progress.index}:${progress.acceptance_id}:${progress.phase}`;
					if (!job.notifiedProgress.has(progressKey)) {
						job.notifiedProgress.add(progressKey);
						this.ports.notify(
							ctx,
							qaProgressNotice(progress, job.deadlineSeconds),
							progress.phase === "failed" ? "error" : "info",
						);
					}
					this.presentQa(ctx, taskId, job);
				},
			});
			lastVerdict = verdict;
			if (!this.qaJobIsActive(taskId, job)) return;

			job.stage = "applying authority verdict";
			this.presentQa(ctx, taskId, job);
			await this.ports.applyVerdict(ctx, {
				taskId,
				snapshot,
				verdict,
				invocation,
				actorId: `qa-host-${randomUUID().slice(0, 8)}`,
				hooks: {
					beforeCommit: this.ports.qaBeforeAuthorityCommit,
					onCommit: () => {
						if (this.qaJobIsActive(taskId, job)) {
							job.stage = "authority commit won; applying verdict";
							this.presentQa(ctx, taskId, job);
						}
						this.ports.qaOnAuthorityCommit?.();
					},
					afterCommit: this.ports.qaAfterAuthorityCommit,
				},
			});
			if (!this.qaJobIsActive(taskId, job)) return;
			if (verdict.decision === "pass") {
				job.stage = "passed; starting native review";
				this.presentQa(ctx, taskId, job, "completed", `qa: completed pass; starting review`);
				this.ports.notify(ctx, `deterministic QA pass completed for ${taskId}; starting native review`, "info");
				this.releaseQaJob(taskId, job);
				this.startReview(taskId, ctx, undefined, undefined, job.correlation);
			} else {
				job.stage = "rework recorded";
				this.presentQa(ctx, taskId, job, "completed", `qa: completed rework`);
				this.ports.notify(ctx, `deterministic QA rework completed for ${taskId}`, "warning");
				this.deliverTerminal(
					job,
					taskId,
					"qa",
					"rework",
					"deterministic QA recorded rework findings",
					presentationFor(snapshot, verdict),
				);
			}
		} catch (error) {
			if (!this.qaJobIsActive(taskId, job)) return;
			const message = describeQaFailure(boundedAssuranceError(error), lastVerdict?.findings);
			job.stage = `failed - ${message}`;
			this.presentQa(ctx, taskId, job, "failed", `qa: failed - ${message}`);
			this.ports.notify(ctx, `assurance failed: ${message}`, "error");
			this.deliverTerminal(job, taskId, "qa", "failed", message);
		} finally {
			this.releaseQaJob(taskId, job);
		}
	}

	private buildReviewPrompt(snapshot: SnapshotDescriptor, evidencePath?: string): string {
		return buildReviewPrompt(snapshot, evidencePath);
	}

	private parseAssuranceVerdict(text: string, snapshot: SnapshotDescriptor): AssuranceVerdict {
		return parseAssuranceVerdict(text, snapshot);
	}
}
