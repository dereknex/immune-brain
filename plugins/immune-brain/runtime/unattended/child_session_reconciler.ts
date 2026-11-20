// Child session reconciler (Spec unified-lane-sessions D8).
//
// Interface: `reconcileChildSession` advances one child's session from Kernel
// facts and one `observe` reading.
// Invariants: a stored key is never recomputed; `baseline` is the Kernel
// `record_revision` the generation started from; `no_progress` counts only
// consecutive stalls at an unchanged baseline; a recorded intervention digest
// is never handled twice; a generation key is persisted via `onWriteAhead`
// before its `open` runs; a `label` is bounded to the port's 32 characters; a
// refused `open` keeps the child enrolled with no handle and parks it only on
// the second consecutive refusal (Spec D10); an observed `blocked` is written
// into `attention`, and any other observation or a successful resume clears it.
// Side Effects: calls the port's `find`/`open`/`resume`/`send`/`closeWithProof`
// and the caller's `onWriteAhead`; the caller persists the returned session.
// Verification: `bun test tests/batch-session-port.test.ts`.
import {
	isPortRefusal,
	laneSessionKey,
	laneSessionLabel,
	LANE_EXECUTOR_ENV,
	type BatchSessionPort,
	type SessionExitProof,
} from "./batch_session_port";
import type { BatchChildSession } from "./batch_state";

export interface ChildKernelFacts {
	recordRevision: string;
	settled: boolean;
	hasOpenDecision: boolean;
	hasReplan: boolean;
}

export type ChildInteractionMode = "interactive_host" | "parent_relayed";

export interface PendingIntervention {
	text: string;
	digest: string;
}

export interface ReconcileChildInput {
	port: BatchSessionPort;
	batchId: string;
	taskId: string;
	session: BatchChildSession | null | undefined;
	kernel: ChildKernelFacts;
	interactionMode: ChildInteractionMode;
	entry: string;
	laneCwd: string;
	pendingInstruction?: PendingIntervention | string | null;
	pendingCorrection?: PendingIntervention | string | null;
	/** Persisted by the caller before each `open`, so a crash after `open` recovers via `find`. */
	onWriteAhead?: (session: BatchChildSession) => void;
	/**
	 * One-shot stall exemption (loop-leader-uls-alignment D4.3): an idle or done
	 * session at the unchanged baseline is held, not judged, so time spent paused
	 * never counts toward `no_progress`. An exited session is still handled as exited.
	 */
	stallExempt?: boolean;
}

export interface ReconcileChildResult {
	session: BatchChildSession;
	/** What the reconciler did this tick, for reports and tests. */
	action:
		| "opened"
		| "adopted"
		| "resumed"
		| "held"
		| "sent"
		| "rotated"
		| "stalled_idle"
		| "parked_no_progress"
		| "parked_open_rejected"
		| "open_refused";
	parkedReason?: string | null;
}

function baseSession(generation: number): BatchChildSession {
	return {
		key: null,
		generation,
		baseline: null,
		handle: null,
		entry_submitted: false,
		attention: null,
		no_progress: 0,
		exit_proof: null,
	};
}

function openEnv(interactionMode: ChildInteractionMode): Record<string, string> | undefined {
	return interactionMode === "parent_relayed" ? { [LANE_EXECUTOR_ENV]: "headless" } : undefined;
}

function normalizePending(value: PendingIntervention | string | null | undefined): PendingIntervention | null {
	if (!value) return null;
	return typeof value === "string" ? { text: value, digest: `text:${value}` } : value;
}

function isHandled(session: BatchChildSession, digest: string): boolean {
	return (session.handled_interventions ?? []).includes(digest);
}

function markHandled(session: BatchChildSession, digest: string): BatchChildSession {
	if (isHandled(session, digest)) return session;
	return { ...session, handled_interventions: [...(session.handled_interventions ?? []), digest] };
}

/** A refused `open` is a named error, never a silent hold with a null handle. */
function openRefusalReason(refusal: { code?: unknown; reason?: unknown }): string {
	const code = typeof refusal.code === "string" ? refusal.code : "refused";
	const reason = typeof refusal.reason === "string" ? refusal.reason : "the provider refused the session";
	return `lane_session_open_rejected: ${reason} (${code})`;
}

/**
 * D10: a first refusal keeps the child enrolled for a retry on the same
 * provider at the next advance; a second consecutive refusal parks it.
 */
function refusedOpen(session: BatchChildSession, refusal: { code?: unknown; reason?: unknown }): ReconcileChildResult {
	const openRefusals = (session.open_refusals ?? 0) + 1;
	const next = { ...session, handle: null, open_refusals: openRefusals };
	const parkedReason = openRefusalReason(refusal);
	return openRefusals >= 2
		? { session: next, action: "parked_open_rejected", parkedReason }
		: { session: next, action: "open_refused", parkedReason };
}

/** A refusal counter is consecutive: a session that opened again starts at zero. */
function resetOpenRefusals(session: BatchChildSession): BatchChildSession {
	return session.open_refusals ? { ...session, open_refusals: 0 } : session;
}

export async function reconcileChildSession(input: ReconcileChildInput): Promise<ReconcileChildResult> {
	const { port, batchId, taskId, kernel, interactionMode, entry, laneCwd, onWriteAhead } = input;
	const pendingInstruction = normalizePending(input.pendingInstruction);
	const pendingCorrection = normalizePending(input.pendingCorrection);
	let session: BatchChildSession = input.session
		? { ...input.session }
		: { ...baseSession(1), baseline: kernel.recordRevision };
	// Write-ahead key before any open, persisted before the port is touched.
	if (!session.key) {
		session.key = laneSessionKey(batchId, taskId, session.generation || 1);
		session.baseline = kernel.recordRevision;
		session.handle = null;
		session.entry_submitted = false;
		session.attention = null;
		if (!session.no_progress) session.no_progress = 0;
		session.exit_proof = null;
		onWriteAhead?.({ ...session });
	}
	const key = session.key!;

	// Crash recovery: a written key without a handle adopts before opening, and
	// restores only the handle: the recorded `entry_submitted` still decides
	// whether the entry has to be submitted.
	let adopted = false;
	if (!session.handle) {
		const found = await port.find(key);
		if (isPortRefusal(found)) return { session, action: "held" };
		if ("handle" in found) {
			session = { ...session, handle: found.handle };
			adopted = true;
		} else {
			// A correction rotation writes its digest ahead of the open. A refused
			// open leaves that generation handle-less, so the retry must resubmit the
			// correction text rather than the default entry.
			const entryForOpen = pendingCorrection && isHandled(session, pendingCorrection.digest)
				? pendingCorrection.text
				: entry;
			const opened = await port.open({
				key,
				cwd: laneCwd,
				label: laneSessionLabel(taskId),
				entry: entryForOpen,
				...(openEnv(interactionMode) ? { env: openEnv(interactionMode) } : {}),
			});
			if (isPortRefusal(opened)) return refusedOpen(session, opened);
			session = resetOpenRefusals({
				...session,
				handle: opened.handle,
				entry_submitted: opened.entry_submitted,
				attention: opened.attention ?? null,
			});
			return { session, action: "opened" };
		}
	}
	const holdAction = adopted ? ("adopted" as const) : ("held" as const);
	const handle = session.handle!;
	const observed = await port.observe(handle);
	if (isPortRefusal(observed)) return { session, action: holdAction };
	const state = observed.state;
	// A dialog the daemon cannot answer must be visible on the record.
	if (state === "blocked") return { session: { ...session, attention: "blocked" }, action: holdAction };
	// Any other observation, including a successful resume below, clears a held attention.
	session = session.attention === null ? session : { ...session, attention: null };
	if (state === "working" || state === "unknown") return { session, action: holdAction };

	// Startup dialog hold: an unsubmitted entry resumes once idle or done.
	if (!session.entry_submitted) {
		if (state === "idle" || state === "done") {
			const resumed = await port.resume(handle, entry);
			if (isPortRefusal(resumed)) return { session, action: holdAction };
			session = { ...session, entry_submitted: resumed.entry_submitted, attention: null };
			return { session, action: "resumed" };
		}
		if (state === "exited") {
			// An exit before submission still closes with proof and rotates.
			return await stallOrProgress(port, session, { batchId, taskId, kernel, interactionMode, entry, laneCwd, state, onWriteAhead });
		}
		return { session, action: holdAction };
	}

	// Recorded correction wins over an instruction: close this generation and open the next, exactly once per digest.
	if (pendingCorrection && !isHandled(session, pendingCorrection.digest) && (state === "idle" || state === "done" || state === "exited")) {
		const closed = await port.closeWithProof(handle, key);
		if (isPortRefusal(closed)) return { session, action: holdAction };
		const nextGeneration = session.generation + 1;
		const nextKey = laneSessionKey(batchId, taskId, nextGeneration);
		const writeAhead: BatchChildSession = {
			...markHandled(session, pendingCorrection.digest),
			key: nextKey,
			generation: nextGeneration,
			baseline: kernel.recordRevision,
			handle: null,
			entry_submitted: false,
			attention: null,
			exit_proof: null,
		};
		onWriteAhead?.({ ...writeAhead });
		const opened = await port.open({
			key: nextKey,
			cwd: laneCwd,
			label: laneSessionLabel(taskId),
			entry: pendingCorrection.text,
			...(openEnv(interactionMode) ? { env: openEnv(interactionMode) } : {}),
		});
		if (isPortRefusal(opened))
			return refusedOpen({ ...writeAhead, exit_proof: closed as SessionExitProof }, opened);
		session = resetOpenRefusals({
			...writeAhead,
			handle: opened.handle,
			entry_submitted: opened.entry_submitted,
			attention: opened.attention ?? null,
		});
		return { session, action: "rotated" };
	}
	if (pendingInstruction && !isHandled(session, pendingInstruction.digest) && (state === "idle" || state === "done")) {
		const sent = await port.send(handle, pendingInstruction.text);
		if (isPortRefusal(sent)) return { session, action: holdAction };
		return { session: markHandled(session, pendingInstruction.digest), action: "sent" };
	}
	if (
		(pendingInstruction && isHandled(session, pendingInstruction.digest)) ||
		(pendingCorrection && isHandled(session, pendingCorrection.digest))
	) {
		// A consumed intervention never re-sends and never re-rotates; fall through to progress/stall.
	}

	// Settled children and children waiting on a user decision or replan stay for the integrator.
	if (kernel.settled || kernel.hasOpenDecision || kernel.hasReplan) return { session, action: "held" };

	return await stallOrProgress(port, session, { batchId, taskId, kernel, interactionMode, entry, laneCwd, state, onWriteAhead, adopted, stallExempt: input.stallExempt === true });
}

async function stallOrProgress(
	port: BatchSessionPort,
	session: BatchChildSession,
	opts: {
		batchId: string;
		taskId: string;
		kernel: ChildKernelFacts;
		interactionMode: ChildInteractionMode;
		entry: string;
		laneCwd: string;
		state: "idle" | "done" | "exited";
		onWriteAhead?: (session: BatchChildSession) => void;
		/** A session adopted this tick has not been observed working yet, so its idle is not a stall. */
		adopted?: boolean;
		stallExempt?: boolean;
	},
): Promise<ReconcileChildResult> {
	const { batchId, taskId, kernel, interactionMode, entry, laneCwd, state, onWriteAhead, adopted } = opts;
	// Revision progress: a new Kernel revision resets the stall counter.
	if (kernel.recordRevision !== session.baseline) {
		if (state === "idle" || state === "done") {
			const resumed = await port.resume(session.handle!, entry);
			if (isPortRefusal(resumed)) return { session, action: "held" };
			session = { ...session, baseline: kernel.recordRevision, no_progress: 0 };
			return { session, action: "resumed" };
		}
		// Exited with progress: close with proof and open the next generation.
		const closed = await port.closeWithProof(session.handle!, session.key!);
		if (isPortRefusal(closed)) return { session, action: "held" };
		const nextGeneration = session.generation + 1;
		const nextKey = laneSessionKey(batchId, taskId, nextGeneration);
		const writeAhead: BatchChildSession = {
			...session,
			key: nextKey,
			generation: nextGeneration,
			baseline: kernel.recordRevision,
			handle: null,
			entry_submitted: false,
			attention: null,
			no_progress: 0,
			exit_proof: null,
		};
		onWriteAhead?.({ ...writeAhead });
		const opened = await port.open({
			key: nextKey,
			cwd: laneCwd,
			label: laneSessionLabel(taskId),
			entry,
			...(openEnv(interactionMode) ? { env: openEnv(interactionMode) } : {}),
		});
		if (isPortRefusal(opened)) return refusedOpen({ ...writeAhead, exit_proof: closed as SessionExitProof }, opened);
		session = resetOpenRefusals({
			...writeAhead,
			handle: opened.handle,
			entry_submitted: opened.entry_submitted,
			attention: opened.attention ?? null,
		});
		return { session, action: "rotated" };
	}

	// A one-shot exemption holds an idle or done session without judging it; an
	// exited session falls through to the exit handling below.
	if (opts.stallExempt && state !== "exited") return { session, action: "held" };

	// Stall at an unchanged baseline. A session adopted this tick was never
	// observed working, so its idle or done is not evidence of a stall.
	if (state === "exited" || (interactionMode === "parent_relayed" && !adopted)) {
		const closed = await port.closeWithProof(session.handle!, session.key!);
		if (isPortRefusal(closed)) return { session, action: "held" };
		const noProgress = (session.no_progress ?? 0) + 1;
		if (noProgress >= 2) {
			session = { ...session, no_progress: noProgress, exit_proof: closed as SessionExitProof };
			return { session, action: "parked_no_progress", parkedReason: "lane_executor_no_progress" };
		}
		const nextGeneration = session.generation + 1;
		const nextKey = laneSessionKey(batchId, taskId, nextGeneration);
		const writeAhead: BatchChildSession = {
			...session,
			key: nextKey,
			generation: nextGeneration,
			baseline: kernel.recordRevision,
			handle: null,
			entry_submitted: false,
			attention: null,
			no_progress: noProgress,
			exit_proof: null,
		};
		onWriteAhead?.({ ...writeAhead });
		const opened = await port.open({
			key: nextKey,
			cwd: laneCwd,
			label: laneSessionLabel(taskId),
			entry,
			...(openEnv(interactionMode) ? { env: openEnv(interactionMode) } : {}),
		});
		if (isPortRefusal(opened)) return refusedOpen({ ...writeAhead, exit_proof: closed as SessionExitProof }, opened);
		session = resetOpenRefusals({
			...writeAhead,
			handle: opened.handle,
			entry_submitted: opened.entry_submitted,
			attention: opened.attention ?? null,
		});
		return { session, action: "rotated" };
	}

	// Interactive-host idle/done stall: the user may be conversing in the tab.
	if ((state === "idle" || state === "done") && interactionMode === "interactive_host") {
		session = { ...session, attention: "stalled_idle" };
		return { session, action: "stalled_idle" };
	}
	return { session, action: "held" };
}
