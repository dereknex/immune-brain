export interface ReviewRequest {
	taskId: string;
	operationId: string;
	prompt: string;
	evidencePath: string;
	maxTurns: number;
}

export interface HostReviewReservation {
	id: string;
	dispatch: unknown;
}

export interface AssuranceHostPort {
	readonly host: "pi" | "claude-code" | "fake";
	prepareReview(request: ReviewRequest): HostReviewReservation;
	releaseReview(reservation: HostReviewReservation): void;
}
