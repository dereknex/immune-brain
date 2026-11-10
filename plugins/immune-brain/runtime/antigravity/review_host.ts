import { FileHookEventLog, MemoryHookEventLog, type HookEventLog } from "../host-core/hook_event_log";
import {
	VerifierObservation,
	type VerifierEvent,
	type VerifierObservationProfile,
} from "../host-core/verifier_observation";
import { tmpdir } from "node:os";
import type {
	AssuranceHostPort,
	HostReviewReservation,
	VerificationReceipt,
	VerificationRequest,
} from "../assurance/host_port";

export const VERIFIER_AGENT = "immune-brain-review-verifier";

/**
 * This adapter's log already holds only verifier evidence, so it stores the
 * shared vocabulary directly (D4, D5): `start` for an allowed dispatch, `result`
 * for its `PostToolUse`, which is terminal on its own.
 */
export type AntigravityHookEvent = VerifierEvent;

/** The Antigravity Host keeps its own cache directory name; storage is shared (D3). */
export const ANTIGRAVITY_CACHE_DIR = "immune-brain-antigravity";

/** The event log this adapter constructs: the shared file log over the Antigravity cache. */
export function antigravityHookEventLog(root = tmpdir()): FileHookEventLog<AntigravityHookEvent> {
	return new FileHookEventLog<AntigravityHookEvent>(ANTIGRAVITY_CACHE_DIR, root);
}

const ANTIGRAVITY_VERIFIER_PROFILE: VerifierObservationProfile<AntigravityHookEvent> = {
	verifierAgents: [VERIFIER_AGENT],
	// BR-SCN-1 / BR-DEC-3: `PostToolUse` is this Host's terminal event, so a
	// `stop` never follows and never gates the receipt.
	terminal: "result",
	actorPrefix: "antigravity",
	dispatch: ({ dispatchPrompt, model }) => ({
		TypeName: VERIFIER_AGENT,
		Role: "Review Verifier",
		Prompt: dispatchPrompt,
		Model: model,
	}),
	decode: (event) => event,
	resolveResult: (observed) => ({ ok: true, result: observed.result.result }),
};

export class AntigravityReviewHost implements AssuranceHostPort {
	readonly host = "antigravity" as const;
	private readonly observation: VerifierObservation<AntigravityHookEvent>;

	constructor(log: HookEventLog<AntigravityHookEvent> = new MemoryHookEventLog<AntigravityHookEvent>()) {
		this.observation = new VerifierObservation(ANTIGRAVITY_VERIFIER_PROFILE, log);
	}

	prepareVerification(request: VerificationRequest): HostReviewReservation {
		return this.observation.prepare(request);
	}

	inspectVerification(reservation: HostReviewReservation): VerificationReceipt {
		return this.observation.inspect(reservation);
	}

	observe(event: AntigravityHookEvent): void {
		this.observation.observe(event);
	}

	releaseReview(reservation: HostReviewReservation): void {
		this.observation.release(reservation);
	}
}
