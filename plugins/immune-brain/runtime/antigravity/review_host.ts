import { createHash } from "node:crypto";
import { reviewPacketHandle, reviewPacketError, verificationPacketHandle, verificationPacketError } from "../assurance/review_packet";
import { mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
	AssuranceHostPort,
	HostReviewReservation,
	ReviewRequest,
	VerificationRequest,
	VerificationReceipt,
} from "../assurance/host_port";

export type ObservedReviewReceipt = { actorId: string; result: string; model?: string };
export type ConsumeReviewResult =
	| { ok: true; receipt: ObservedReviewReceipt }
	| { ok: false; reason: string; release: boolean };

export const REVIEWER_AGENT = "immune-brain-reviewer";
export const VERIFIER_AGENT = "immune-brain-review-verifier";
export const SUBAGENT_TOOL = "invoke_subagent";

export type AntigravityHookEvent =
	| {
		type: "SubagentStart";
		sessionId: string;
		agent: string;
		agentId: string;
		taskId?: string;
		operationId?: string;
		prompt?: string;
	}
	| {
		type: "PostToolUse";
		sessionId: string;
		agentId: string;
		toolName: string;
		result: string;
		model?: string;
		taskId?: string;
		operationId?: string;
		prompt?: string;
	}
	| {
		type: "SubagentStop";
		sessionId: string;
		agent: string;
		agentId: string;
		taskId?: string;
		operationId?: string;
	}
	| { type: "SessionEnd"; sessionId: string };

export interface HookEventLog {
	append(event: AntigravityHookEvent): boolean;
	list(sessionId?: string): AntigravityHookEvent[];
	sessions(): string[];
	clear(sessionId?: string): void;
}

export class MemoryHookEventLog implements HookEventLog {
	private readonly events: AntigravityHookEvent[] = [];
	append(event: AntigravityHookEvent): boolean { this.events.push(event); return true; }
	list(sessionId?: string): AntigravityHookEvent[] {
		return sessionId ? this.events.filter((event) => event.sessionId === sessionId) : [...this.events];
	}
	sessions(): string[] {
		return [...new Set(this.events.map((event) => event.sessionId))];
	}
	clear(sessionId?: string): void {
		if (!sessionId) {
			this.events.length = 0;
			return;
		}
		for (let i = this.events.length - 1; i >= 0; i--) {
			if (this.events[i].sessionId === sessionId) this.events.splice(i, 1);
		}
	}
}

const CACHE_DIR = "immune-brain-antigravity";

export function sessionHash(sessionId: string): string {
	return createHash("sha256").update(sessionId).digest("hex");
}

export function cacheDir(root: string): string {
	return join(root, CACHE_DIR);
}

export function ensurePrivateDir(dir: string): boolean {
	try {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		return true;
	} catch {
		return false;
	}
}

export class FileHookEventLog implements HookEventLog {
	constructor(private readonly root: string = tmpdir()) {}

	private dir(): string {
		const path = cacheDir(this.root);
		ensurePrivateDir(path);
		return path;
	}

	private file(sessionId: string): string {
		return join(this.dir(), `${sessionHash(sessionId)}.events.jsonl`);
	}

	append(event: AntigravityHookEvent): boolean {
		try {
			const line = JSON.stringify(event) + "\n";
			writeFileSync(this.file(event.sessionId), line, { flag: "a", mode: 0o600 });
			return true;
		} catch {
			return false;
		}
	}

	list(sessionId?: string): AntigravityHookEvent[] {
		if (!sessionId) {
			const results: AntigravityHookEvent[] = [];
			for (const session of this.sessions()) results.push(...this.list(session));
			return results;
		}
		try {
			const content = readFileSync(this.file(sessionId), "utf8");
			return content
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line));
		} catch {
			return [];
		}
	}

	sessions(): string[] {
		try {
			const files = readdirSync(this.dir());
			return files.filter(f => f.endsWith(".events.jsonl")).map(f => f.replace(/\.events\.jsonl$/, ""));
		} catch {
			return [];
		}
	}

	clear(sessionId?: string): void {
		if (sessionId) {
			try { rmSync(this.file(sessionId), { force: true }); } catch {}
		} else {
			try { rmSync(this.dir(), { recursive: true, force: true }); } catch {}
		}
	}
}

interface PendingReview {
	request: ReviewRequest;
	verifierModel?: string;
	dispatchPrompt: string;
	initialCursors: Map<string, number>;
	sessionCursors: Map<string, number>;
	startEvent?: Extract<AntigravityHookEvent, { type: "SubagentStart" }>;
	postEvent?: Extract<AntigravityHookEvent, { type: "PostToolUse" }>;
	stopEvent?: Extract<AntigravityHookEvent, { type: "SubagentStop" }>;
	consumed: boolean;
	error?: string;
}

function bindsPrompt(prompt: string | undefined, state: PendingReview): boolean {
	if (prompt === undefined) return true;
	return prompt.trim() === state.dispatchPrompt.trim();
}

export class AntigravityReviewHost implements AssuranceHostPort {
	readonly host = "antigravity" as const;
	private readonly pending = new Map<string, PendingReview>();
	private readonly appliedBySession = new Map<string, number>();

	constructor(private readonly log: HookEventLog = new MemoryHookEventLog()) {}

	prepareVerification(request: VerificationRequest): HostReviewReservation {
		const reviewRequest: ReviewRequest = {
			taskId: request.taskId,
			operationId: request.operationId,
			prompt: request.prompt,
			snapshotPrompt: request.prompt,
			evidencePath: "",
			writePacket: request.writePacket,
			maxTurns: 16,
		};
		this.drain();
		const cursors = new Map(this.log.sessions().map(sessionId => [sessionId, this.log.list(sessionId).length]));
		const dispatchPrompt = verificationPacketHandle({
			taskId: request.taskId,
			operationId: request.operationId,
			packet: request.writePacket(request.operationId, request.prompt),
		});
		this.pending.set(request.operationId, {
			request: reviewRequest,
			verifierModel: request.model,
			dispatchPrompt,
			initialCursors: new Map(cursors),
			sessionCursors: new Map(cursors),
			consumed: false,
		});
		return {
			id: request.operationId,
			dispatch: {
				TypeName: VERIFIER_AGENT,
				Role: "Review Verifier",
				Prompt: dispatchPrompt,
				Model: request.model,
			},
		};
	}

	inspectVerification(reservation: HostReviewReservation): VerificationReceipt {
		const state = this.pending.get(reservation.id);
		if (!state?.verifierModel) return { ok: false, reason: "verifier reservation not found", release: true };
		const result = this.inspectReview(reservation);
		if (!result.ok) return result;
		return {
			ok: true,
			receipt: {
				actorId: result.receipt.actorId,
				result: result.receipt.result,
				model: state.verifierModel,
			},
		};
	}

	prepareReview(request: ReviewRequest): HostReviewReservation {
		this.drain();
		const initialCursors = new Map<string, number>();
		const sessionCursors = new Map<string, number>();
		for (const sessionId of this.log.sessions()) {
			const len = this.log.list(sessionId).length;
			initialCursors.set(sessionId, len);
			sessionCursors.set(sessionId, len);
		}
		const dispatchPrompt = reviewPacketHandle({
			taskId: request.taskId,
			operationId: request.operationId,
			packet: request.writePacket(request.operationId, request.snapshotPrompt),
		});
		this.pending.set(request.operationId, {
			request,
			dispatchPrompt,
			initialCursors,
			sessionCursors,
			consumed: false,
		});
		return {
			id: request.operationId,
			dispatch: {
				TypeName: REVIEWER_AGENT,
				Role: "Code Reviewer",
				Prompt: dispatchPrompt,
				Model: "inherit",
			},
		};
	}

	observe(event: AntigravityHookEvent): void {
		this.log.append(event);
	}

	private drain(): void {
		for (const sessionId of this.log.sessions()) {
			const events = this.log.list(sessionId);
			let start = this.appliedBySession.get(sessionId) ?? 0;
			if (start > events.length) start = 0;
			let ended = false;
			for (let i = start; i < events.length; i++) {
				const event = events[i];
				if (event.type === "SessionEnd") {
					for (const [id, state] of this.pending) {
						if (state.startEvent?.sessionId === event.sessionId || state.postEvent?.sessionId === event.sessionId || state.stopEvent?.sessionId === event.sessionId) {
							this.pending.delete(id);
						}
					}
					for (const state of this.pending.values()) {
						const current = state.initialCursors.get(sessionId) ?? 0;
						if (i + 1 > current) state.initialCursors.set(sessionId, i + 1);
					}
					if (i === events.length - 1) {
						this.log.clear(event.sessionId);
						ended = true;
						this.appliedBySession.delete(event.sessionId);
						break;
					}
					continue;
				}
				for (const state of this.pending.values()) {
					if (state.consumed || state.error || i < (state.initialCursors.get(sessionId) ?? 0)) continue;
					this.applyReviewEvent(event, state);
				}
			}
			if (ended) {
				this.appliedBySession.delete(sessionId);
				for (const state of this.pending.values()) state.sessionCursors.delete(sessionId);
			} else {
				this.appliedBySession.set(sessionId, events.length);
				for (const state of this.pending.values()) state.sessionCursors.set(sessionId, events.length);
			}
		}
	}

	private applyReviewEvent(event: AntigravityHookEvent, state: PendingReview): void {
		if (state.error) return;
		if (event.type === "SubagentStart") {
			const expectedAgents = state.verifierModel ? [VERIFIER_AGENT] : [REVIEWER_AGENT];
			if (!expectedAgents.includes(event.agent)) return;
			if (event.operationId && event.operationId !== state.request.operationId) return;
			if (!bindsPrompt(event.prompt, state)) return;
			if (state.startEvent && state.startEvent !== event) {
				state.error = "reserved Review already has a native tool call";
				return;
			}
			state.startEvent = event;
			return;
		}
		if (event.type === "PostToolUse") {
			if (event.toolName !== SUBAGENT_TOOL) return;
			if (event.operationId && event.operationId !== state.request.operationId) return;
			if (event.taskId && event.taskId !== state.request.taskId) return;
			if (!bindsPrompt(event.prompt, state)) return;
			if (state.verifierModel && event.model && event.model !== state.verifierModel) {
				state.error = "verifier model differs from reservation";
				return;
			}
			if (state.postEvent !== undefined && state.postEvent !== event) {
				state.error = "duplicate PostToolUse result observed for review reservation";
				return;
			}
			state.postEvent = event;
			return;
		}
		if (event.type === "SubagentStop") {
			const expectedAgents = state.verifierModel ? [VERIFIER_AGENT] : [REVIEWER_AGENT];
			if (!expectedAgents.includes(event.agent)) return;
			if (event.operationId && event.operationId !== state.request.operationId) return;
			if (state.stopEvent && state.stopEvent !== event) {
				state.error = "duplicate SubagentStop observed for review reservation";
				return;
			}
			state.stopEvent = event;
		}
	}

	inspectReview(reservation: HostReviewReservation): ConsumeReviewResult {
		this.drain();
		const state = this.pending.get(reservation.id);
		if (!state) return { ok: false, reason: "reserved foreground Agent was not observed", release: true };
		const packetError = state.verifierModel ? verificationPacketError(state.dispatchPrompt) : reviewPacketError(state.dispatchPrompt);
		if (packetError) return { ok: false, reason: packetError, release: true };
		if (state.consumed) return { ok: false, reason: "review receipt already consumed", release: true };
		if (state.error) return { ok: false, reason: state.error, release: true };
		if (!state.startEvent) return { ok: false, reason: "reserved foreground Agent was not observed", release: true };
		if (!state.stopEvent || !state.postEvent?.result?.trim()) {
			return { ok: false, reason: "foreground Agent terminal event order is incomplete", release: false };
		}
		const actorId = `antigravity:${state.startEvent.agentId || reservation.id}`;
		return {
			ok: true,
			receipt: {
				actorId,
				result: state.postEvent.result,
				...(state.postEvent.model ? { model: state.postEvent.model } : {}),
			},
		};
	}

	consumeReview(reservation: HostReviewReservation): ConsumeReviewResult {
		const result = this.inspectReview(reservation);
		if (result.ok) {
			const pending = this.pending.get(reservation.id);
			if (pending) pending.consumed = true;
		}
		return result;
	}

	inspectReviewForTask(taskId: string): ConsumeReviewResult {
		this.drain();
		const entry = [...this.pending.entries()].find(([, state]) => state.request.taskId === taskId);
		if (!entry) return { ok: false, reason: "reserved foreground Agent was not observed", release: true };
		return this.inspectReview({ id: entry[0], dispatch: entry[1].request });
	}

	releaseReview(reservation: HostReviewReservation): void {
		this.pending.delete(reservation.id);
	}
}
