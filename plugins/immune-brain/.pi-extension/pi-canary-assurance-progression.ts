// Foreground Assurance progression for one Pi session.
//
// Deterministic QA runs to completion inside the caller's Tool execution. A
// successful QA pass creates one short-lived Review reservation; the Parent
// invokes a foreground reviewer and explicitly submits its structured verdict.
// No lifecycle work survives a Tool call except the evidence reservation.

export {
	AssuranceCoordinator,
	deriveGithubTerminalProjectionInput,
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

import { AssuranceCoordinator, type AssuranceCoordinatorPorts } from "../runtime/assurance/coordinator";
import type { AssuranceHostPort, HostReviewReservation, ReviewRequest } from "../runtime/assurance/host_port";
import { reservedAgentParams } from "./pi-canary-native-review";

export type AssuranceProgressionPorts = Omit<AssuranceCoordinatorPorts, "host">;

class PiReviewHost implements AssuranceHostPort {
	readonly host = "pi" as const;
	private readonly pending = new Set<string>();

	prepareReview(request: ReviewRequest): HostReviewReservation {
		const params = reservedAgentParams({
			taskId: request.taskId,
			operationId: request.operationId,
			prompt: request.prompt,
			max_turns: request.maxTurns,
		});
		this.pending.add(request.operationId);
		return { id: request.operationId, dispatch: params };
	}

	releaseReview(reservation: HostReviewReservation): void {
		this.pending.delete(reservation.id);
	}
}

export class AssuranceProgression extends AssuranceCoordinator {
	constructor(ports: AssuranceProgressionPorts) {
		(ports as AssuranceCoordinatorPorts).host = new PiReviewHost();
		super(ports as AssuranceCoordinatorPorts);
	}
}
