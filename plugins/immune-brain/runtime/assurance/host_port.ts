import type { ReviewProfile } from "../config/layered_config";
import type { SnapshotDescriptor, StatusProjectionWarning } from "./coordinator";
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
	/** The request-selected Lane Review profile; resolved from the layered config when absent. */
	profile?: ReviewProfile;
	/**
	 * The per-dispatch facts alone: internal role contract references, the snapshot,
	 * the evidence file and the turn budget. Static instructions stay generated from
	 * one source in the role definition instead of being sent a second time.
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
	/** Set by a Host that dispatches Review to an explicit supervised session instead of an in-process agent. */
	review_session?: ReviewSessionSpec;
	verification_session?: ReviewSessionSpec;
	review_profile?: ReviewProfile;
	/** The actor identity the Kernel records for this reservation's verdict. */
	review_actor_id?: string;
	/** Set when this round runs on something the user should know about (Spec review-config-invalid D4). */
	warnings?: StatusProjectionWarning[];
}

/**
 * One explicit supervised session a Review or Verification round runs in
 * (Spec explicit-port-review-session D1, D2, D5). The Parent launches it, so no
 * authority module imports `runtime/session/` (BR-OUT-1).
 */
export interface ReviewSessionSpec {
	transport: "herdr";
	/** The out-of-tree JSON file the session writes its result to; its bytes are the receipt. */
	output_path: string;
	/** Launch it; the printed JSON names the `handle` the other verbs take. */
	create_command: string;
	/**
	 * Submit the entry a startup dialog held back: when `create_command` printed
	 * `entry_submitted: false`, the user answers the dialog in the tab, then this runs once.
	 */
	resume_command: string;
	/** Wait once for the session to finish writing `output_path`; never a submit poll. */
	await_command: string;
	/** Close the single-round session after a consumed receipt; never after a failed one. */
	stop_command: string;
}

/**
 * A Review reservation the Host could not make, with the stable reason the
 * Kernel reports and the single action that repairs it (D7).
 */
export class ReviewPreparationError extends Error {
	constructor(
		readonly code: "review_profile_required" | "review_config_invalid" | "review_host_unavailable" | "review_transport_unavailable",
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
	/** The Lane Review profile the verification inherits from its Review round. */
	profile?: ReviewProfile;
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
