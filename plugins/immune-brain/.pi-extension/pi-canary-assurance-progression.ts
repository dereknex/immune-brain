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

import { AssuranceCoordinator, type AssuranceCoordinatorPorts, type HostContext, type AssuranceSubmitReviewResult } from "../runtime/assurance/coordinator";
import type { AssuranceHostPort, HostReviewReservation, ReviewRequest } from "../runtime/assurance/host_port";
import { submitMediatedReview, type ReviewObservation } from "../runtime/assurance/review_mediation";
import { reservedAgentParams, promptDigest } from "./pi-canary-native-review";

import type { VerdictAuthority } from "../runtime/assurance/verdict_authority";

export type AssuranceProgressionPorts = Omit<AssuranceCoordinatorPorts, "host"> & {
	/** Optional test seam; production authority is owned by the coordinator. */
	authorityOverrides?: Partial<VerdictAuthority>;
};

interface RecordedReviewReceipt {
	taskId: string;
	promptDigest: string;
	toolCallId?: string;
	result?: string;
	error?: string;
}

class PiReviewHost implements AssuranceHostPort {
	readonly host = "pi" as const;
	private readonly pending = new Set<string>();
	private readonly receipts = new Map<string, RecordedReviewReceipt>();

	prepareReview(request: ReviewRequest): HostReviewReservation {
		const params = reservedAgentParams({
			taskId: request.taskId,
			operationId: request.operationId,
			prompt: request.prompt,
			max_turns: request.maxTurns,
		});
		this.pending.add(request.operationId);
		this.receipts.set(request.operationId, { taskId: request.taskId, promptDigest: promptDigest(params.prompt) });
		return { id: request.operationId, dispatch: params };
	}

	releaseReview(reservation: HostReviewReservation): void {
		this.pending.delete(reservation.id);
		this.receipts.delete(reservation.id);
	}

	/** Extension event seam: correlate one observed `Agent` dispatch to its reservation (ADR 0017). */
	observeReviewDispatch(input: { prompt?: unknown; subagent_type?: unknown } | undefined, toolCallId: string | undefined): void {
		if (typeof input?.prompt !== "string") return;
		for (const record of this.receipts.values()) {
			if (record.promptDigest !== promptDigest(input.prompt)) continue;
			if (input.subagent_type !== "Review") {
				record.error = "the reserved reviewer prompt was dispatched with a different Agent type";
				return;
			}
			if (record.toolCallId !== undefined && record.toolCallId !== toolCallId) {
				record.error = "the reserved reviewer was dispatched more than once";
				return;
			}
			record.toolCallId = toolCallId;
			return;
		}
	}

	/** Extension event seam: store the observed reviewer result bytes (ADR 0017). */
	observeReviewResult(toolCallId: string | undefined, bytes: string): void {
		if (!toolCallId) return;
		for (const record of this.receipts.values()) {
			if (record.toolCallId !== toolCallId) continue;
			if (record.result === undefined) record.result = bytes;
			return;
		}
	}

	inspectReview(taskId: string): ReviewObservation {
		for (const record of this.receipts.values()) {
			if (record.taskId !== taskId) continue;
			if (record.error) return { ok: false, release: true, reason: record.error };
			if (record.toolCallId === undefined)
				return { ok: false, release: true, reason: "the reserved foreground Agent was not observed in this session" };
			if (record.result === undefined)
				return { ok: false, release: false, reason: "the reserved foreground reviewer has not returned its result yet; wait for it, then call submit_review again" };
			return { ok: true, receipt: { actorId: "pi-review-agent", result: record.result } };
		}
		return { ok: false, release: true, reason: "the reserved foreground Agent was not observed in this session" };
	}
}

export class AssuranceProgression extends AssuranceCoordinator {
	readonly piReviewHost: PiReviewHost;

	constructor(ports: AssuranceProgressionPorts) {
		const host = new PiReviewHost();
		(ports as AssuranceCoordinatorPorts).host = host;
		super(ports as AssuranceCoordinatorPorts, ports.authorityOverrides);
		this.piReviewHost = host;
	}

	/** ADR 0017: verdict-source resolution happens here, before the shared submit path. */
	submitMediated(taskId: string, ctx: HostContext, verdictInput: unknown): Promise<AssuranceSubmitReviewResult> {
		return submitMediatedReview(this, ctx, taskId, verdictInput, () => this.piReviewHost.inspectReview(taskId));
	}
}
