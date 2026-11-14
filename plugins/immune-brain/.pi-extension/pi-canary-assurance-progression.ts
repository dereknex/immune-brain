// Foreground Assurance progression for one Pi session.
//
// Deterministic QA runs to completion inside the caller's Tool execution. A
// successful QA pass creates one short-lived Review reservation; the Parent
// invokes a foreground reviewer and explicitly submits its structured verdict.
// No lifecycle work survives a Tool call except the evidence reservation.

export {
	AssuranceCoordinator,
	deriveGithubTerminalProjectionInput,
	projectTerminalTrackerState,
	deriveQaJobTimeoutMs,
	classifyReviewWorkload,
	reviewTurnBudget,
	snapshotDigest,
	buildReviewPrompt,
	parseAssuranceVerdict,
	parseChildVerdict,
	invocationRegistry,
	QA_MIN_JOB_TIMEOUT_SECONDS,
	QA_MAX_JOB_TIMEOUT_SECONDS,
	QA_JOB_OVERHEAD_SECONDS,
	QA_JOB_TIMEOUT_SECONDS,
	REVIEW_PREPARATION_TIMEOUT_MS,
	REVIEW_DISPATCH_TIMEOUT_MS,
	REVIEW_VERDICT_VALIDATION_TIMEOUT_MS,
	ASSURANCE_STALL_MS,
	REVIEW_TIMING_PROFILES,
} from "../runtime/assurance/coordinator";
export type {
	GithubTerminalProjectionInput,
	AssuranceVerdict,
	ReviewIncompleteOutcome,
	ChildReviewResult,
	ReviewRevisionIdentity,
	SnapshotDescriptor,
	QaVerificationProgress,
	ForegroundToolUpdate,
	AssuranceAdvanceResult,
	AssuranceSubmitReviewResult,
	ActiveAssuranceState,
	AssuranceCoordinatorPorts,
	AssuranceRole,
	AssuranceCorrelation,
	HostContext,
	TaskTombstone,
	TaskRecordRead,
	TaskIntentRead,
	ReviewTimingProfile,
} from "../runtime/assurance/coordinator";

import type { AssuranceCoordinatorPorts } from "../runtime/assurance/coordinator";
import type { AssuranceHostPort, HostReviewReservation, VerificationReceipt, VerificationRequest } from "../runtime/assurance/host_port";
import { verificationPacketError } from "../runtime/assurance/review_packet";
import {
	VerifierObservation,
	type VerifierEvent,
	type VerifierObservationProfile,
} from "../runtime/host-core/verifier_observation";
import {
	MemoryHookEventLog,
	type HookEventLog,
} from "../runtime/host-core/hook_event_log";

import type { VerdictAuthority } from "../runtime/assurance/verdict_authority";

export type AssuranceProgressionPorts = Omit<AssuranceCoordinatorPorts, "host"> & {
	/** Optional test seam; production authority is owned by the coordinator. */
	authorityOverrides?: Partial<VerdictAuthority>;
};

export const PI_VERIFIER_AGENT = "general-purpose";

export const PI_VERIFIER_PROFILE: VerifierObservationProfile<VerifierEvent> = {
	verifierAgents: [PI_VERIFIER_AGENT],
	terminal: "result",
	actorPrefix: "pi",
	dispatch: ({ dispatchPrompt, model }) => ({
		subagent_type: PI_VERIFIER_AGENT,
		description: "Verify Review findings",
		prompt: dispatchPrompt,
		model,
		name: "",
		thinking: "",
		inherit_context: false,
		isolated: true,
		isolation: "off",
		run_in_background: false,
		max_turns: 16,
		resume: "",
		schedule: "",
	}),
	decode: (event) => event,
	resolveResult: (observed) => ({ ok: true, result: observed.result.result }),
};

export class PiReviewHost implements AssuranceHostPort {
	readonly host = "pi" as const;
	readonly observation: VerifierObservation<VerifierEvent>;
	readonly log: HookEventLog<VerifierEvent>;
	private readonly toolCallByOperation = new Map<string, string>();
	private readonly operationByToolCall = new Map<string, string>();
	private readonly resultsByToolCall = new Map<string, string>();
	readonly sessionId: string;

	constructor(log: HookEventLog<VerifierEvent> = new MemoryHookEventLog<VerifierEvent>(), sessionId = "pi-session") {
		this.log = log;
		this.sessionId = sessionId;
		this.observation = new VerifierObservation(PI_VERIFIER_PROFILE, log);
	}

	prepareVerification(request: VerificationRequest): HostReviewReservation {
		return this.observation.prepare(request);
	}

	inspectVerification(reservation: HostReviewReservation): VerificationReceipt {
		return this.observation.inspect(reservation);
	}

	releaseReview(reservation: HostReviewReservation): void {
		const callId = this.toolCallByOperation.get(reservation.id);
		if (callId) {
			this.operationByToolCall.delete(callId);
			this.resultsByToolCall.delete(callId);
			this.toolCallByOperation.delete(reservation.id);
		}
		this.observation.release(reservation);
	}

	observe(event: VerifierEvent): void {
		this.observation.observe(event);
	}

	onSessionShutdown(sessionId = this.sessionId): void {
		this.observation.observe({ type: "session_end", sessionId });
		this.toolCallByOperation.clear();
		this.operationByToolCall.clear();
		this.resultsByToolCall.clear();
	}

	/* Extension event seam: correlate one observed `Agent` dispatch to its verifier reservation (ADR 0017). */
	observeVerifierDispatch(input: Record<string, unknown> | undefined, toolCallId: string | undefined): { block: true; reason: string } | undefined {
		if (!input || typeof input.prompt !== "string") return;
		const verifierMarker = /^<!-- immune-brain-verifier:operation_id=([A-Za-z0-9._-]+) task_id=([A-Za-z0-9._-]+) -->/.exec(input.prompt);
		if (!verifierMarker) return;
		const operationId = verifierMarker[1];
		const taskId = verifierMarker[2];
		const pending = this.observation.pendingReservation(operationId);
		if (!pending || pending.request.taskId !== taskId) return { block: true, reason: "unknown verifier reservation" };
		const expected = this.observation.expectedDispatch(operationId) as Record<string, unknown> | undefined;
		if (!expected || Object.keys(expected).some((key) => input[key] !== expected[key])
			|| verificationPacketError(input.prompt)) return { block: true, reason: "verifier dispatch differs from reservation" };
		if (!toolCallId || this.toolCallByOperation.has(operationId) || this.operationByToolCall.has(toolCallId)) return { block: true, reason: "verifier dispatch already observed or missing call id" };
		this.toolCallByOperation.set(operationId, toolCallId);
		this.operationByToolCall.set(toolCallId, operationId);
		this.observation.observe({
			type: "start",
			sessionId: this.sessionId,
			agentId: toolCallId,
			agent: PI_VERIFIER_AGENT,
			prompt: input.prompt,
			taskId,
			operationId,
		});
		return;
	}

	/* Extension event seam: store the observed verifier result bytes (ADR 0017). */
	observeVerifierResult(toolCallId: string | undefined, bytes: string): void {
		if (!toolCallId) return;
		const operationId = this.operationByToolCall.get(toolCallId);
		if (!operationId) return;
		const pending = this.observation.pendingReservation(operationId);
		if (!pending) return;
		const previous = this.resultsByToolCall.get(toolCallId);
		if (previous !== undefined && previous === bytes) return;
		this.resultsByToolCall.set(toolCallId, bytes);
		this.observation.observe({
			type: "result",
			sessionId: this.sessionId,
			agentId: toolCallId,
			result: bytes,
			model: pending.request.model,
			prompt: pending.dispatchPrompt,
			taskId: pending.request.taskId,
			operationId,
		});
	}
}
