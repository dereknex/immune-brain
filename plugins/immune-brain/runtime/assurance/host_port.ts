export interface ReviewRequest {
	taskId: string;
	operationId: string;
	/**
	 * The complete Review prompt: internal role contract, static review rules and
	 * the per-dispatch facts. Dispatched by a Host whose reviewer agent carries no
	 * instructions of its own.
	 */
	prompt: string;
	/**
	 * The per-dispatch facts alone, a strict suffix of `prompt`. A Host whose
	 * reviewer definition already carries the role contract and the static rules
	 * dispatches only this, so the static instructions stay generated from one
	 * source instead of being sent twice.
	 */
	snapshotPrompt: string;
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
