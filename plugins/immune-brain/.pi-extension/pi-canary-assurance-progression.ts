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

import { AssuranceCoordinator, type AssuranceAdvanceResult, type AssuranceCoordinatorPorts, type ForegroundToolUpdate, type HostContext, type AssuranceSubmitReviewResult, type ReviewSubmissionOptions } from "../runtime/assurance/coordinator";
import { withSettleCommit } from "../runtime/assurance/workflow_autocommit";
import type { AssuranceHostPort, HostReviewReservation, VerificationRequest } from "../runtime/assurance/host_port";
import { verificationPacketHandle, verificationPacketError } from "../runtime/assurance/review_packet";
import { submitMediatedReview } from "../runtime/assurance/review_mediation";
import { CliReviewHost } from "../runtime/assurance/cli_review";

import type { VerdictAuthority } from "../runtime/assurance/verdict_authority";

export type AssuranceProgressionPorts = Omit<AssuranceCoordinatorPorts, "host"> & {
	/** Optional test seam; production authority is owned by the coordinator. */
	authorityOverrides?: Partial<VerdictAuthority>;
};

interface RecordedVerificationReceipt {
	taskId: string;
	params: Record<string, unknown>;
	callId?: string;
	result?: string;
	error?: string;
}

class PiReviewHost implements AssuranceHostPort {
	readonly host = "pi" as const;
	private readonly verifiers = new Map<string, RecordedVerificationReceipt>();

	prepareVerification(request: VerificationRequest): HostReviewReservation {
		if (this.verifiers.has(request.operationId)) throw new Error("duplicate verifier reservation");
		const params = {
			subagent_type: "general-purpose", description: "Verify Review findings",
			prompt: verificationPacketHandle({ taskId: request.taskId, operationId: request.operationId,
				packet: request.writePacket(request.operationId, request.prompt) }),
			model: request.model, name: "", thinking: "", inherit_context: false, isolated: true, isolation: "off",
			run_in_background: false, max_turns: 16, resume: "", schedule: "",
		};
		this.verifiers.set(request.operationId, { taskId: request.taskId, params });
		return { id: request.operationId, dispatch: params };
	}

	inspectVerification(reservation: HostReviewReservation) {
		const state = this.verifiers.get(reservation.id);
		if (!state) return { ok: false as const, reason: "verifier reservation not found", release: true };
		const error = verificationPacketError(state.params.prompt as string) ?? state.error;
		if (error) return { ok: false as const, reason: error, release: true };
		if (!state.callId) return { ok: false as const, reason: "verifier dispatch not observed", release: true };
		if (state.result === undefined) return { ok: false as const, reason: "verifier result pending", release: false };
		return { ok: true as const, receipt: { actorId: `pi:${state.callId}`, result: state.result, model: state.params.model as string } };
	}

	releaseReview(reservation: HostReviewReservation): void {
		this.verifiers.delete(reservation.id);
	}

	/* Extension event seam: correlate one observed `Agent` dispatch to its verifier reservation (ADR 0017). */
	observeVerifierDispatch(input: Record<string, unknown> | undefined, toolCallId: string | undefined): { block: true; reason: string } | undefined {
		const verifierMarker = typeof input?.prompt === "string" ? /^<!-- immune-brain-verifier:operation_id=([A-Za-z0-9._-]+) task_id=([A-Za-z0-9._-]+) -->/.exec(input.prompt) : null;
		if (!verifierMarker) return;
		const state = this.verifiers.get(verifierMarker[1]);
		if (!state || state.taskId !== verifierMarker[2]) return { block: true, reason: "unknown verifier reservation" };
		if (Object.keys(state.params).some(key => input?.[key] !== state.params[key])
			|| verificationPacketError(input!.prompt as string)) return { block: true, reason: "verifier dispatch differs from reservation" };
		if (state.callId || !toolCallId) return { block: true, reason: "verifier dispatch already observed or missing call id" };
		state.callId = toolCallId;
		return;
	}

	/* Extension event seam: store the observed verifier result bytes (ADR 0017). */
	observeVerifierResult(toolCallId: string | undefined, bytes: string): void {
		if (!toolCallId) return;
		for (const state of this.verifiers.values()) {
			if (state.callId !== toolCallId) continue;
			if (state.result === undefined) state.result = bytes;
			else if (state.result !== bytes) state.error = "conflicting verifier result bytes";
		}
	}
}

export class AssuranceProgression extends AssuranceCoordinator {
	readonly piReviewHost: PiReviewHost;
	/** The Review port this composition root reserves: the CLI dispatcher (D11). */
	private readonly reviewHost: CliReviewHost;

	constructor(ports: AssuranceProgressionPorts) {
		const host = new PiReviewHost();
		const reviewHost = new CliReviewHost(host);
		(ports as AssuranceCoordinatorPorts).host = reviewHost;
		super(ports as AssuranceCoordinatorPorts, ports.authorityOverrides);
		this.piReviewHost = host;
		this.reviewHost = reviewHost;
	}

	/** Under `Git integration: auto` a settlement reached here also carries its settle commit (ADR 0024). */
	override async advance(taskId: string, ctx: HostContext, signal?: AbortSignal, onUpdate?: (update: ForegroundToolUpdate) => void): Promise<AssuranceAdvanceResult> {
		return withSettleCommit(ctx.cwd, taskId, await super.advance(taskId, ctx, signal, onUpdate), signal);
	}

	override async submitReview(taskId: string, ctx: HostContext, verdictInput: unknown, options?: ReviewSubmissionOptions): Promise<AssuranceSubmitReviewResult> {
		return withSettleCommit(ctx.cwd, taskId, await super.submitReview(taskId, ctx, verdictInput, options));
	}

	/** ADR 0017: verdict-source resolution happens here, before the shared submit path. */
	submitMediated(taskId: string, ctx: HostContext, verdictInput: unknown): Promise<AssuranceSubmitReviewResult> {
		return submitMediatedReview(this, ctx, taskId, verdictInput, () => this.reviewHost.inspectReview(taskId));
	}
}
