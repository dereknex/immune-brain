// Child session reconciler (Spec unified-lane-sessions D8).
//
// Interface: `reconcileChildSession` advances one child's session from Kernel
// facts and one `observe` reading.
// Invariants: a stored key is never recomputed; `baseline` is the Kernel
// `record_revision` the generation started from; `no_progress` counts only
// consecutive stalls at an unchanged baseline; a recorded intervention digest
// is never handled twice; a generation key is persisted via `onWriteAhead`
// before its `open` runs.
// Side Effects: calls the port's `find`/`open`/`resume`/`send`/`closeWithProof`
// and the caller's `onWriteAhead`; the caller persists the returned session.
// Verification: `bun test tests/batch-session-port.test.ts`.
import {
	isPortRefusal,
	laneSessionKey,
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
		| "parked_no_progress";
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

	// Crash recovery: a written key without a handle adopts before opening.
	if (!session.handle) {
		const found = await port.find(key);
		if (!isPortRefusal(found)) {
			if ("handle" in found) {
				session.handle = found.handle;
				session.entry_submitted = true;
				return { session, action: "adopted" };
			}
		} else {
			return { session, action: "held" };
		}
		const opened = await port.open({
			key,
			cwd: laneCwd,
			label: taskId,
			entry,
			...(openEnv(interactionMode) ? { env: openEnv(interactionMode) } : {}),
		});
		if (isPortRefusal(opened)) return { session, action: "held" };
		session.handle = opened.handle;
		session.entry_submitted = opened.entry_submitted;
		if (opened.attention !== undefined) session.attention = opened.attention ?? null;
		return { session, action: "opened" };
	}

	const handle = session.handle;
	const observed = await port.observe(handle);
	if (isPortRefusal(observed)) return { session, action: "held" };
	const state = observed.state;
	if (state === "working" || state === "unknown") return { session, action: "held" };
	if (state === "blocked") return { session, action: "held" };

	// Startup dialog hold: an unsubmitted entry resumes once idle or done.
	if (!session.entry_submitted) {
		if (state === "idle" || state === "done") {
			const resumed = await port.resume(handle, entry);
			if (isPortRefusal(resumed)) return { session, action: "held" };
			session.entry_submitted = resumed.entry_submitted;
			return { session, action: "resumed" };
		}
		if (state === "exited") {
			// An exit before submission still closes with proof and rotates.
			return await stallOrProgress(port, session, { batchId, taskId, kernel, interactionMode, entry, laneCwd, state, onWriteAhead });
		}
		return { session, action: "held" };
	}

	// Recorded correction wins over an instruction: close this generation and open the next, exactly once per digest.
	if (pendingCorrection && !isHandled(session, pendingCorrection.digest) && (state === "idle" || state === "done")) {
		const closed = await port.closeWithProof(handle, key);
		if (isPortRefusal(closed)) return { session, action: "held" };
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
			label: taskId,
			entry: pendingCorrection.text,
			...(openEnv(interactionMode) ? { env: openEnv(interactionMode) } : {}),
		});
		if (isPortRefusal(opened)) {
			return { session: { ...writeAhead, exit_proof: closed as SessionExitProof }, action: "held" };
		}
		session = {
			...writeAhead,
			handle: opened.handle,
			entry_submitted: opened.entry_submitted,
			attention: opened.attention ?? null,
		};
		return { session, action: "rotated" };
	}
	if (pendingInstruction && !isHandled(session, pendingInstruction.digest) && (state === "idle" || state === "done")) {
		const sent = await port.send(handle, pendingInstruction.text);
		if (isPortRefusal(sent)) return { session, action: "held" };
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

	return await stallOrProgress(port, session, { batchId, taskId, kernel, interactionMode, entry, laneCwd, state, onWriteAhead });
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
	},
): Promise<ReconcileChildResult> {
	const { batchId, taskId, kernel, interactionMode, entry, laneCwd, state, onWriteAhead } = opts;
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
			label: taskId,
			entry,
			...(openEnv(interactionMode) ? { env: openEnv(interactionMode) } : {}),
		});
		if (isPortRefusal(opened)) {
			session = { ...writeAhead, exit_proof: closed as SessionExitProof };
			return { session, action: "held" };
		}
		session = {
			...writeAhead,
			handle: opened.handle,
			entry_submitted: opened.entry_submitted,
			attention: opened.attention ?? null,
		};
		return { session, action: "rotated" };
	}

	// Stall at an unchanged baseline.
	if (state === "exited" || interactionMode === "parent_relayed") {
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
			label: taskId,
			entry,
			...(openEnv(interactionMode) ? { env: openEnv(interactionMode) } : {}),
		});
		if (isPortRefusal(opened)) {
			session = { ...writeAhead, exit_proof: closed as SessionExitProof };
			return { session, action: "held" };
		}
		session = {
			...writeAhead,
			handle: opened.handle,
			entry_submitted: opened.entry_submitted,
			attention: opened.attention ?? null,
		};
		return { session, action: "rotated" };
	}

	// Interactive-host idle/done stall: the user may be conversing in the tab.
	if ((state === "idle" || state === "done") && interactionMode === "interactive_host") {
		session = { ...session, attention: "stalled_idle" };
		return { session, action: "stalled_idle" };
	}
	return { session, action: "held" };
}
