// BatchSessionPort (Spec unified-lane-sessions D8).
//
// Interface: the session contract the batch runtime needs, with its own
// observation vocabulary and structural exit proof.
// Invariants: keys are bounded `imm-<folded>-g<n>-<12hex>` (<=36 chars,
// `[a-z0-9-]`); a stored key is never recomputed on read.
// Side Effects: none; the port performs them.
// Verification: `bun test tests/batch-session-port.test.ts`.
import { createHash } from "node:crypto";

/** Observation vocabulary owned by this port. */
export type SessionObservation = "working" | "blocked" | "idle" | "done" | "exited" | "unknown";

/** Structural proof that no live session carries `(handle, key)`. */
export interface SessionExitProof {
	ok: true;
	exited: true;
	handle: string;
	key: string;
}

/** A precise refusal: nothing beyond `reason` was done. */
export interface PortRefusal {
	ok: false;
	code: string;
	reason: string;
}

export function isPortRefusal(result: unknown): result is PortRefusal {
	return (
		typeof result === "object" &&
		result !== null &&
		(result as { ok?: unknown }).ok === false
	);
}

export interface BatchSessionOpenInput {
	key: string;
	cwd: string;
	label: string;
	entry: string;
	env?: Record<string, string>;
}

export type OpenResult =
	| { ok: true; handle: string; entry_submitted: boolean; attention?: string | null }
	| PortRefusal;
export type ResumeResult = { ok: true; entry_submitted: boolean } | PortRefusal;
export type FindResult = ({ ok: true; handle: string } | { ok: true; not_found: true }) | PortRefusal;
export type ObserveResult = ({ ok: true; state: SessionObservation } | PortRefusal);
export type SendResult = ({ ok: true; state: SessionObservation } | PortRefusal);
export type StopResult = ({ ok: true } | PortRefusal);
export type CloseWithProofResult = (SessionExitProof | PortRefusal);

/** Environment key injected for parent-relayed Executors. */
export const LANE_EXECUTOR_ENV = "LANE_EXECUTOR_ENV";

export interface BatchSessionPort {
	readonly provider: string;
	open(input: BatchSessionOpenInput): Promise<OpenResult>;
	resume(handle: string, entry: string): Promise<ResumeResult>;
	find(key: string): Promise<FindResult>;
	observe(handle: string): Promise<ObserveResult>;
	send(handle: string, text: string): Promise<SendResult>;
	stop(handle: string): Promise<StopResult>;
	closeWithProof(handle: string, key: string): Promise<CloseWithProofResult>;
}

function foldTask(taskId: string, maxLen: number): string {
	let folded = taskId
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!folded) folded = "t";
	if (folded.length > maxLen) {
		folded = folded.slice(0, maxLen).replace(/-+$/g, "");
		if (!folded) folded = "t";
	}
	return folded;
}

/**
 * Bounded lane session key, stored on write and never recomputed on read.
 * `imm-<folded_task_16>-g<n>-<sha256(batch_id + "\0" + task_id + "\0" + n).slice(0,12)>`.
 */
export function laneSessionKey(batchId: string, taskId: string, generation: number): string {
	if (!Number.isSafeInteger(generation) || generation <= 0)
		throw new Error("laneSessionKey: generation must be a positive integer");
	const digest = createHash("sha256")
		.update(`${batchId}\0${taskId}\0${String(generation)}`)
		.digest("hex")
		.slice(0, 12);
	const digits = String(generation).length;
	const maxFold = 36 - (4 + 2 + digits + 1 + 12);
	const folded = foldTask(taskId, Math.max(1, maxFold));
	return `imm-${folded}-g${generation}-${digest}`;
}
