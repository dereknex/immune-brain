// One verifier observation state machine for every adapter (Spec
// docs/specs/host-neutral-adapter-core.spec.md D5). A reservation binds the
// `VerificationRequest` directly, so no synthesized Review request is involved.
//
// Interface: `VerifierObservation<E>(profile, log)` with `prepare`, `inspect`,
// `observe` and `release`; the profile supplies the accepted verifier agent
// names, whether a `result` is terminal by itself, the actor prefix, the
// dispatch envelope, the Host's own event mapping and its result resolution.
// Invariants: only Hook evidence settles nothing by itself — an `ok` inspect
// returns a receipt and the coordinator owns settlement. A reservation reports
// `release: false` while its terminal event order is still incomplete.
// Side Effects: appends to the Host's hook event log.
// Verification: `bun test tests/dual-host-assurance-conformance.test.ts -t 'verifier observation'`.

import { verificationPacketError, verificationPacketHandle } from "../assurance/review_packet";
import type { HostReviewReservation, VerificationReceipt, VerificationRequest } from "../assurance/host_port";
import type { HookEventLog, SessionEvent } from "./hook_event_log";

/** The neutral vocabulary every adapter maps its own hook events into (D5). */
export type VerifierEvent =
	| {
		type: "start";
		sessionId: string;
		agentId: string;
		agent?: string;
		prompt?: string;
		taskId?: string;
		operationId?: string;
	}
	| {
		type: "result";
		sessionId: string;
		agentId: string;
		result: string;
		model?: string;
		prompt?: string;
		taskId?: string;
		operationId?: string;
	}
	| {
		type: "stop";
		sessionId: string;
		agentId: string;
		agent?: string;
		taskId?: string;
		operationId?: string;
	}
	| { type: "session_end"; sessionId: string };

export type VerifierStart = Extract<VerifierEvent, { type: "start" }>;
export type VerifierResult = Extract<VerifierEvent, { type: "result" }>;
export type VerifierStop = Extract<VerifierEvent, { type: "stop" }>;

/** One reservation's correlated terminal evidence, with the Host payloads it came from. */
export interface ObservedVerification<E> {
	agentId: string;
	start: VerifierStart;
	result: VerifierResult;
	stop?: VerifierStop;
	/** The adapter's own events the neutral ones were decoded from. */
	host: { start: E; result: E; stop?: E };
}

export type ResolvedVerification =
	| { ok: true; result: string }
	| { ok: false; reason: string; release: boolean };

export interface VerifierObservationProfile<E extends SessionEvent> {
	/** Agent names a `start` may carry to bind this Host's reservation. */
	verifierAgents: readonly string[];
	/** `result` is terminal on its own, or a `stop` must follow it. */
	terminal: "result" | "result+stop";
	/** The actor identity prefix the Kernel records, per Host. */
	actorPrefix: string;
	/** The envelope the Parent dispatches; its prompt carries the packet handle. */
	dispatch(input: { dispatchPrompt: string; model: string }): unknown;
	/** This Host's entry in the shared event log, or null when it is not evidence. */
	decode(event: E): VerifierEvent | null;
	/** The reviewer text this Host settles from, or its typed refusal. */
	resolveResult(observed: ObservedVerification<E>): ResolvedVerification;
}

interface Applied<E extends SessionEvent, T extends VerifierEvent> {
	sessionId: string;
	index: number;
	event: T;
	host: E;
}

interface Pending<E extends SessionEvent> {
	request: VerificationRequest;
	/** The prompt the Parent was asked to dispatch, packet handle included. */
	dispatchPrompt: string;
	/** Per session, the first log index this reservation may read. */
	initialCursors: Map<string, number>;
	start?: Applied<E, VerifierStart>;
	result?: Applied<E, VerifierResult>;
	stop?: Applied<E, VerifierStop>;
	error?: string;
}

export class VerifierObservation<E extends SessionEvent> {
	private readonly pending = new Map<string, Pending<E>>();

	constructor(
		readonly profile: VerifierObservationProfile<E>,
		private readonly log: HookEventLog<E>,
	) {}

	pendingReservation(operationId: string): { request: VerificationRequest; dispatchPrompt: string } | undefined {
		const state = this.pending.get(operationId);
		return state ? { request: state.request, dispatchPrompt: state.dispatchPrompt } : undefined;
	}

	expectedDispatch(operationId: string): unknown | undefined {
		const state = this.pending.get(operationId);
		if (!state) return undefined;
		return this.profile.dispatch({ dispatchPrompt: state.dispatchPrompt, model: state.request.model });
	}

	prepare(request: VerificationRequest): HostReviewReservation {
		this.drain();
		const initialCursors = new Map(this.log.sessions().map((sessionId) => [sessionId, this.log.list(sessionId).length]));
		const dispatchPrompt = verificationPacketHandle({
			taskId: request.taskId,
			operationId: request.operationId,
			packet: request.writePacket(request.operationId, request.prompt),
		});
		this.pending.set(request.operationId, { request, dispatchPrompt, initialCursors });
		return { id: request.operationId, dispatch: this.profile.dispatch({ dispatchPrompt, model: request.model }) };
	}

	observe(event: E): void {
		this.log.append(event);
	}

	inspect(reservation: HostReviewReservation): VerificationReceipt {
		this.drain();
		const state = this.pending.get(reservation.id);
		if (!state) return { ok: false, reason: "reserved foreground Agent was not observed", release: true };
		const packetError = verificationPacketError(state.dispatchPrompt);
		if (packetError) return { ok: false, reason: packetError, release: true };
		if (state.error) return { ok: false, reason: state.error, release: true };
		if (!state.start) return { ok: false, reason: "reserved foreground Agent was not observed", release: true };
		const { start, result, stop } = state;
		if (!result?.event.result.trim() || (this.profile.terminal === "result+stop" && !stop)) {
			return { ok: false, reason: "foreground Agent terminal event order is incomplete", release: false };
		}
		// Every correlated event must name the same session and the same agent.
		if (start.sessionId !== result.sessionId || start.event.agentId !== result.event.agentId
			|| (stop !== undefined && (start.sessionId !== stop.sessionId || start.event.agentId !== stop.event.agentId))) {
			return { ok: false, reason: "foreground Agent terminal event correlation mismatch", release: true };
		}
		const resolved = this.profile.resolveResult({
			agentId: start.event.agentId,
			start: start.event,
			result: result.event,
			...(stop ? { stop: stop.event } : {}),
			host: { start: start.host, result: result.host, ...(stop ? { stop: stop.host } : {}) },
		});
		if (!resolved.ok) return { ok: false, reason: resolved.reason, release: resolved.release };
		return {
			ok: true,
			receipt: { actorId: `${this.profile.actorPrefix}:${start.event.agentId}`, result: resolved.result, model: state.request.model },
		};
	}

	release(reservation: HostReviewReservation): void {
		this.pending.delete(reservation.id);
	}

	private drain(): void {
		for (const sessionId of this.log.sessions()) {
			const events = this.log.list(sessionId);
			for (let index = 0; index < events.length; index++) {
				const host = events[index];
				const event = this.profile.decode(host);
				if (!event) continue;
				if (event.type === "session_end") {
					this.endSession(sessionId, index, events.length);
					continue;
				}
				for (const state of this.pending.values()) this.consider(state, sessionId, index, event, host);
			}
			// A Host may write the terminal event before the start it belongs to, so a
			// reservation whose correlation is incomplete replays its own window once
			// more. The per-event index guards make that replay idempotent.
			for (const state of this.pending.values()) this.reconsider(state, sessionId, events);
		}
	}

	private consider(state: Pending<E>, sessionId: string, index: number, event: VerifierEvent, host: E): void {
		if (state.error || event.type === "session_end") return;
		if (index < (state.initialCursors.get(sessionId) ?? 0)) return;
		this.apply(state, sessionId, index, event, host);
	}

	private reconsider(state: Pending<E>, sessionId: string, events: E[]): void {
		if (state.error || !state.result) return;
		if (state.start && (this.profile.terminal === "result" || state.stop)) return;
		for (let index = state.initialCursors.get(sessionId) ?? 0; index < events.length; index++) {
			const host = events[index];
			const event = this.profile.decode(host);
			if (!event || event.type === "session_end") continue;
			this.apply(state, sessionId, index, event, host);
			if (state.error) return;
		}
	}

	private apply(state: Pending<E>, sessionId: string, index: number, event: VerifierEvent, host: E): void {
		const { request } = state;
		// Hook evidence carries Parent-authored text, so only the exact reserved
		// dispatch prompt binds; the operation marker alone is not an acceptance path.
		if (event.type === "start") {
			if (this.applied(state.start, sessionId, index)) return;
			if (!this.profile.verifierAgents.includes(event.agent ?? "")) return;
			if (event.taskId !== undefined && event.taskId !== request.taskId) return;
			if (event.operationId !== undefined && event.operationId !== request.operationId) return;
			if (event.prompt !== undefined && event.prompt !== state.dispatchPrompt) return;
			if (state.result && (event.sessionId !== state.result.sessionId || event.agentId !== state.result.event.agentId)) return;
			if (state.stop && (event.sessionId !== state.stop.sessionId || event.agentId !== state.stop.event.agentId)) return;
			// A start that names neither the reservation nor a correlated terminal is
			// not evidence yet; the replay above binds it once its terminal lands.
			if (event.operationId === undefined && event.prompt === undefined && !state.result && !state.stop) return;
			if (state.start) {
				state.error = "reserved Review already has a native tool call";
				return;
			}
			state.start = { sessionId, index, event, host };
			return;
		}
		if (event.type === "result") {
			if (this.applied(state.result, sessionId, index)) return;
			if (event.operationId !== undefined && event.operationId !== request.operationId) return;
			if (event.taskId !== undefined && event.taskId !== request.taskId) return;
			if (event.prompt !== undefined && event.prompt !== state.dispatchPrompt) return;
			if (state.start && (event.sessionId !== state.start.sessionId || event.agentId !== state.start.event.agentId)) return;
			if (state.stop && (event.sessionId !== state.stop.sessionId || event.agentId !== state.stop.event.agentId)) return;
			if (event.operationId === undefined && event.prompt === undefined && !state.start) return;
			if (event.model !== undefined && event.model !== request.model) {
				state.error = "verifier model differs from reservation";
				return;
			}
			if (state.result) {
				state.error = state.result.event.result !== event.result
					? "conflicting verifier result bytes: duplicate PostToolUse result observed for review reservation"
					: "duplicate PostToolUse result observed for review reservation";
				return;
			}
			state.result = { sessionId, index, event, host };
			return;
		}
		if (event.type === "stop") {
			if (this.applied(state.stop, sessionId, index)) return;
			if (!this.profile.verifierAgents.includes(event.agent ?? "")) return;
			if (event.taskId !== undefined && event.taskId !== request.taskId) return;
			if (event.operationId !== undefined && event.operationId !== request.operationId) return;
			if (event.operationId === undefined && !state.start && !state.result) return;
			// A stop that cannot agree with the correlated events is recorded rather
			// than dropped, so the mismatch is refused at inspection instead of leaving
			// the reservation waiting for a terminal that already arrived.
			if (state.stop) {
				state.error = "duplicate SubagentStop observed for review reservation: a reviewer was continued after it finished; a reviewer cannot be continued and a fresh reviewer must be dispatched";
				return;
			}
			state.stop = { sessionId, index, event, host };
		}
	}

	private applied(applied: Applied<E, VerifierEvent> | undefined, sessionId: string, index: number): boolean {
		return applied?.sessionId === sessionId && applied.index === index;
	}

	/**
	 * A finished session retires every reservation bound to it, because that
	 * evidence can never be completed. A resumed session reuses its id, so the
	 * cursor moves past the end while later events still reach their reservation.
	 */
	private endSession(sessionId: string, index: number, size: number): void {
		for (const [id, state] of this.pending) {
			if (state.start?.sessionId === sessionId || state.result?.sessionId === sessionId || state.stop?.sessionId === sessionId) {
				this.pending.delete(id);
			}
		}
		for (const state of this.pending.values()) {
			const current = state.initialCursors.get(sessionId) ?? 0;
			if (index + 1 > current) state.initialCursors.set(sessionId, index + 1);
		}
		// Nothing followed the end, so the log is safe to reclaim.
		if (index + 1 === size) this.log.clear(sessionId);
	}
}
