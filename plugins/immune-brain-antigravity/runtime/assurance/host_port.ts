import type { ReviewProfile } from "../config/layered_config";
import type { SnapshotDescriptor } from "./coordinator";
import type { ReviewPacket } from "./review_packet";

export type ConfirmationReferenceSource = (input: {
	snapshot: SnapshotDescriptor;
	actorId: string;
	now: string;
}) => string;

export interface ReviewEvidence {
	path: string;
	writePacket(name: string, content: string): ReviewPacket;
	remove(): void;
}

export interface ReviewRequest {
	taskId: string;
	operationId: string;
	/** The task's working directory; set by the coordinator for a Host that writes reviewer files. */
	root?: string;
	/**
	 * The complete Review prompt: internal role contract, static review rules and
	 * the per-dispatch facts. Written into the packet by a Host whose reviewer
	 * agent carries no instructions of its own.
	 */
	prompt: string;
	/**
	 * The per-dispatch facts alone, a strict suffix of `prompt`. A Host whose
	 * reviewer definition already carries the role contract and the static rules
	 * writes only this into the packet, so static instructions stay generated from one
	 * source instead of being sent twice.
	 */
	snapshotPrompt: string;
	evidencePath: string;
	writePacket: ReviewEvidence["writePacket"];
	/** Requested budget, also stated in the prompt for Hosts without a native turn-cap parameter. */
	maxTurns: number;
}

export interface HostReviewReservation {
	id: string;
	dispatch: unknown;
	/** Set by a Host that dispatches Review to a CLI process instead of an in-process agent. */
	review_command?: string;
	/** Set by a Host that dispatches findings verification to a CLI process (verification CLI stage). */
	verification_command?: string;
	review_profile?: ReviewProfile;
	/** The actor identity the Kernel records for this reservation's verdict. */
	review_actor_id?: string;
}

/**
 * A Review reservation the Host could not make, with the stable reason the
 * Kernel reports and the single action that repairs it (D7).
 */
export class ReviewPreparationError extends Error {
	constructor(
		readonly code: "review_profile_required" | "review_host_unavailable" | "review_transport_unavailable",
		message: string,
		readonly recovery_action: string,
	) {
		super(message);
		this.name = "ReviewPreparationError";
	}
}

export interface VerificationRequest {
	taskId: string;
	operationId: string;
	prompt: string;
	model: string;
	writePacket: ReviewEvidence["writePacket"];
}

export type VerificationReceipt =
	| { ok: true; receipt: { actorId: string; result: string; model: string } }
	| { ok: false; reason: string; release: boolean };

export interface AssuranceHostPort {
	readonly host: "pi" | "claude-code" | "antigravity" | "fake";
	/** Present only on a Host that dispatches Review itself; the CLI dispatcher supplies it. */
	prepareReview?(request: ReviewRequest): HostReviewReservation;
	prepareVerification?(request: VerificationRequest): HostReviewReservation;
	inspectVerification?(reservation: HostReviewReservation): VerificationReceipt;
	releaseReview(reservation: HostReviewReservation): void;
}
