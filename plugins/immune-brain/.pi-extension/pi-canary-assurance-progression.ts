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
import type { AssuranceHostPort, HostReviewReservation, ReviewRequest } from "../runtime/assurance/host_port";
import { submitMediatedReview, type ReviewObservation } from "../runtime/assurance/review_mediation";
import { reservedAgentParams, promptDigest, type ReservedAgentParams } from "./pi-canary-native-review";
import { parseReviewMarker } from "../runtime/claude/review_host";
import { reviewPacketError } from "../runtime/assurance/review_packet";

import type { VerdictAuthority } from "../runtime/assurance/verdict_authority";

export type AssuranceProgressionPorts = Omit<AssuranceCoordinatorPorts, "host"> & {
	/** Optional test seam; production authority is owned by the coordinator. */
	authorityOverrides?: Partial<VerdictAuthority>;
};

interface RecordedReviewReceipt {
	taskId: string;
	params: ReservedAgentParams;
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
			writePacket: request.writePacket,
			max_turns: request.maxTurns,
		});
		this.pending.add(request.operationId);
		this.receipts.set(request.operationId, { taskId: request.taskId, params, promptDigest: promptDigest(params.prompt) });
		return { id: request.operationId, dispatch: params };
	}

	releaseReview(reservation: HostReviewReservation): void {
		this.pending.delete(reservation.id);
		this.receipts.delete(reservation.id);
	}

	/** Extension event seam: correlate one observed `Agent` dispatch to its reservation (ADR 0017). */
	observeReviewDispatch(input: Partial<Record<keyof ReservedAgentParams, unknown>> | undefined, toolCallId: string | undefined): { block: true; reason: string } | undefined {
		const marker = parseReviewMarker(input?.prompt);
		if (!marker) {
			if (input?.subagent_type === "Review" && this.pending.size > 0)
				return { block: true, reason: "Review dispatch requires the reserved prompt verbatim, including its operation marker." };
			return;
		}
		const record = this.receipts.get(marker.operationId);
		if (!record || record.taskId !== marker.taskId)
			return { block: true, reason: "Unknown or released Review operation; call advance_assurance for a fresh reservation." };
		const differing: string[] = [];
		for (const field of ["subagent_type", "run_in_background", "isolated", "max_turns"] as const) {
			if (input?.[field] !== record.params[field]) differing.push(field);
		}
		if (input?.inherit_context !== undefined && input.inherit_context !== false) differing.push("inherit_context");
		if (typeof input?.prompt !== "string" || record.promptDigest !== promptDigest(input.prompt)) differing.push("prompt");
		if (differing.length)
			return { block: true, reason: `Review dispatch differs in ${differing.join(", ")}; dispatch the reserved prompt verbatim and reserved Agent parameters.` };
		const packetError = reviewPacketError(record.params.prompt);
		if (packetError) return { block: true, reason: packetError };
		if (record.toolCallId !== undefined)
			return { block: true, reason: "the reserved reviewer was dispatched more than once" };
		if (!toolCallId) return { block: true, reason: "Review reservation requires an observable tool call id." };
		record.toolCallId = toolCallId;
	}

	/** Extension event seam: store the observed reviewer result bytes (ADR 0017). */
	observeReviewResult(toolCallId: string | undefined, bytes: string): void {
		if (!toolCallId) return;
		for (const record of this.receipts.values()) {
			if (record.toolCallId !== toolCallId) continue;
			if (record.result === undefined) record.result = bytes;
			else if (record.result !== bytes) record.error = "the reserved reviewer returned conflicting result bytes";
			return;
		}
	}

	inspectReview(taskId: string): ReviewObservation {
		for (const record of this.receipts.values()) {
			if (record.taskId !== taskId) continue;
			const packetError = reviewPacketError(record.params.prompt);
			if (packetError) return { ok: false, release: true, reason: packetError };
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

	/** Under `Git integration: auto` a settlement reached here also carries its settle commit (ADR 0024). */
	override async advance(taskId: string, ctx: HostContext, signal?: AbortSignal, onUpdate?: (update: ForegroundToolUpdate) => void): Promise<AssuranceAdvanceResult> {
		return withSettleCommit(ctx.cwd, taskId, await super.advance(taskId, ctx, signal, onUpdate), signal);
	}

	override async submitReview(taskId: string, ctx: HostContext, verdictInput: unknown, options?: ReviewSubmissionOptions): Promise<AssuranceSubmitReviewResult> {
		return withSettleCommit(ctx.cwd, taskId, await super.submitReview(taskId, ctx, verdictInput, options));
	}

	/** ADR 0017: verdict-source resolution happens here, before the shared submit path. */
	submitMediated(taskId: string, ctx: HostContext, verdictInput: unknown): Promise<AssuranceSubmitReviewResult> {
		return submitMediatedReview(this, ctx, taskId, verdictInput, () => this.piReviewHost.inspectReview(taskId));
	}
}
