import { createHash } from "node:crypto";
import { constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, rmSync, writeSync, closeSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type {
	AssuranceHostPort,
	HostReviewReservation,
	ReviewRequest,
} from "../assurance/host_port";

export type ObservedReviewReceipt = { actorId: string; result: string };
export type ConsumeReviewResult =
	| { ok: true; receipt: ObservedReviewReceipt }
	| { ok: false; reason: string; release: boolean };

export const REVIEWER_AGENT = "immune-brain-reviewer";
export const CLAUDE_REVIEWER_AGENT = "immune-brain:immune-brain-reviewer";
export const AGENT_TOOL = "Agent";

export type ClaudeHookEvent =
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
	append(event: ClaudeHookEvent): boolean;
	list(sessionId?: string): ClaudeHookEvent[];
	sessions(): string[];
	clear(sessionId?: string): void;
}

export class MemoryHookEventLog implements HookEventLog {
	private readonly events: ClaudeHookEvent[] = [];
	append(event: ClaudeHookEvent): boolean { this.events.push(event); return true; }
	list(sessionId?: string): ClaudeHookEvent[] {
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

const CACHE_DIR = "immune-brain-claude";

function sessionHash(sessionId: string): string {
	return createHash("sha256").update(sessionId).digest("hex");
}

function cacheDir(root: string): string {
	return join(root, CACHE_DIR);
}

function ownedByUs(stat: { uid: number; isSymbolicLink(): boolean }): boolean {
	if (stat.isSymbolicLink()) return false;
	const uid = process.getuid?.();
	return uid === undefined || stat.uid === uid;
}

function ensurePrivateDir(dir: string): boolean {
	try {
		const existing = lstatSync(dir);
		return existing.isDirectory() && ownedByUs(existing) && (existing.mode & 0o777) === 0o700;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
	}
	try { mkdirSync(dir, { mode: 0o700 }); } catch { return false; }
	try {
		const created = lstatSync(dir);
		return created.isDirectory() && ownedByUs(created) && (created.mode & 0o777) === 0o700;
	} catch {
		return false;
	}
}

function appendPrivate(path: string, dir: string, line: string): boolean {
	if (!ensurePrivateDir(dir)) return false;
	const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK;
	let fd: number;
	try { fd = openSync(path, flags, 0o600); } catch { return false; }
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile() || !ownedByUs(stat) || (stat.mode & 0o777) !== 0o600) return false;
		return writeSync(fd, line) === Buffer.byteLength(line);
	} catch {
		return false;
	} finally {
		closeSync(fd);
	}
}

function readPrivate(path: string, maxBytes = Number.POSITIVE_INFINITY): string | undefined {
	let fd: number;
	try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } catch { return; }
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile() || !ownedByUs(stat) || (stat.mode & 0o777) !== 0o600) return;
		if (stat.size > maxBytes) return;
		const buf = Buffer.alloc(stat.size);
		readSync(fd, buf, 0, stat.size, 0);
		return buf.toString("utf8");
	} finally {
		closeSync(fd);
	}
}

/**
 * Upper bound on a reviewer transcript we are willing to load. A reviewer that
 * produced more than this did not produce a verdict; refusing to allocate for it
 * is safer than trusting whatever the tail happens to contain.
 */
const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024;

export type AsyncAgentLaunch = { agentId: string; outputFile: string };

/**
 * Recognise the launch receipt this Claude Code build returns for `Agent`.
 *
 * Every `Agent` call here runs asynchronously — `run_in_background: false` in
 * the dispatch envelope is not honoured, and there is no synchronous mode. The
 * tool result is therefore
 * `{"isAsync":true,"status":"async_launched","agentId":…,"outputFile":…}`:
 * proof that a subagent started, never its answer. Treating it as the verdict
 * would settle Review on a receipt for starting the reviewer, so the launch
 * envelope is read only as a pointer to where the real bytes live.
 */
export function parseAsyncAgentLaunch(result: string): AsyncAgentLaunch | null {
	let payload: unknown;
	try { payload = JSON.parse(result); } catch { return null; }
	if (!payload || typeof payload !== "object") return null;
	const obj = payload as Record<string, unknown>;
	if (obj.isAsync !== true && obj.status !== "async_launched") return null;
	const agentId = typeof obj.agentId === "string" ? obj.agentId : "";
	const outputFile = typeof obj.outputFile === "string" ? obj.outputFile : "";
	if (!agentId || !outputFile) return null;
	return { agentId, outputFile };
}

/**
 * Extract the reviewer's terminal message from its own transcript.
 *
 * Each record carries the `agentId` that wrote it, so the caller's independently
 * observed id is matched per record rather than trusted for the file as a whole;
 * a transcript that interleaves another agent cannot contribute its text.
 */
export function readAgentTranscriptResult(transcript: string, agentId: string): string | null {
	let last: string | null = null;
	for (const line of transcript.split("\n")) {
		if (!line.trim()) continue;
		let row: Record<string, unknown>;
		try { row = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
		if (row.type !== "assistant" || row.agentId !== agentId) continue;
		const message = row.message;
		if (!message || typeof message !== "object") continue;
		const content = (message as Record<string, unknown>).content;
		if (!Array.isArray(content)) continue;
		let text = "";
		for (const block of content) {
			if (!block || typeof block !== "object") continue;
			const part = block as Record<string, unknown>;
			if (part.type === "text" && typeof part.text === "string") text += part.text;
		}
		if (text.trim()) last = text;
	}
	return last;
}

/**
 * Read the transcript the launch envelope names. The path is a symlink into the
 * session store, so it is resolved once and then opened `O_NOFOLLOW` with the
 * same ownership and mode checks the hook log gets.
 */
function readAgentTranscript(path: string): string | undefined {
	let resolved: string;
	try { resolved = realpathSync(path); } catch { return; }
	return readPrivate(resolved, MAX_TRANSCRIPT_BYTES);
}

export function hookEventPath(sessionId: string, root = tmpdir()): string {
	return join(cacheDir(root), `${sessionHash(sessionId)}.jsonl`);
}

export class FileHookEventLog implements HookEventLog {
	constructor(private readonly root = tmpdir()) {}
	append(event: ClaudeHookEvent): boolean {
		const path = hookEventPath(event.sessionId, this.root);
		return appendPrivate(path, dirname(path), `${JSON.stringify(event)}\n`);
	}
	list(sessionId?: string): ClaudeHookEvent[] {
		if (sessionId) return this.readSession(sessionId);
		const dir = cacheDir(this.root);
		if (!ensurePrivateDir(dir)) return [];
		try {
			return readdirSync(dir)
				.filter((name) => name.endsWith(".jsonl"))
				.flatMap((name) => this.readFile(join(dir, name)));
		} catch {
			return [];
		}
	}
	sessions(): string[] {
		const ids = new Set<string>();
		for (const event of this.list()) if (event.sessionId) ids.add(event.sessionId);
		return [...ids];
	}
	private readFile(path: string): ClaudeHookEvent[] {
		const text = readPrivate(path);
		if (!text) return [];
		try {
			return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as ClaudeHookEvent);
		} catch {
			return [];
		}
	}
	private readSession(sessionId: string): ClaudeHookEvent[] {
		if (!ensurePrivateDir(cacheDir(this.root))) return [];
		return this.readFile(hookEventPath(sessionId, this.root));
	}
	clear(sessionId?: string): void {
		if (!sessionId || !ensurePrivateDir(cacheDir(this.root))) return;
		const path = hookEventPath(sessionId, this.root);
		try {
			const stat = lstatSync(path);
			if (!ownedByUs(stat) || stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o777) !== 0o600) return;
			rmSync(path, { force: true });
		} catch { /* cleanup cannot create authority */ }
	}
}

interface PendingReview {
	request: ReviewRequest;
	initialCursors: Map<string, number>;
	sessionCursors: Map<string, number>;
	startEvent?: Extract<ClaudeHookEvent, { type: "SubagentStart" }>;
	postEvent?: Extract<ClaudeHookEvent, { type: "PostToolUse" }>;
	stopEvent?: Extract<ClaudeHookEvent, { type: "SubagentStop" }>;
	consumed: boolean;
	error?: string;
}

function matchesReservation(event: ClaudeHookEvent, pending: PendingReview): boolean {
	if ("operationId" in event && event.operationId && event.operationId !== pending.request.operationId) return false;
	if ("taskId" in event && event.taskId && event.taskId !== pending.request.taskId) return false;
	if (pending.sessionId && event.sessionId !== pending.sessionId) return false;
	const eventAgentId = "agentId" in event ? event.agentId : "";
	if (event.type === "SubagentStop" && (!eventAgentId || !pending.agentId || eventAgentId !== pending.agentId)) return false;
	if (pending.agentId && eventAgentId && eventAgentId !== pending.agentId) return false;
	return true;
}

function bindsStart(event: Extract<ClaudeHookEvent, { type: "SubagentStart" }>, pending: PendingReview): boolean {
	if (event.taskId && event.taskId !== pending.request.taskId) return false;
	if (event.prompt !== undefined) {
		const match = /<!-- immune-brain:operation_id=([^\s]+)\s+task_id=([^\s]+)\s+-->/.exec(event.prompt);
		if (match) {
			if (match[1] !== pending.request.operationId || match[2] !== pending.request.taskId) return false;
		} else if (event.prompt !== pending.request.prompt) {
			return false;
		}
	}
	if (event.operationId) return event.operationId === pending.request.operationId;
	return event.prompt !== undefined && event.prompt === pending.request.prompt;
}

export class ClaudeReviewHost implements AssuranceHostPort {
	readonly host = "claude-code" as const;
	private readonly pending = new Map<string, PendingReview>();
	private readonly appliedBySession = new Map<string, number>();
	constructor(private readonly log: HookEventLog = new MemoryHookEventLog()) {}

	prepareReview(request: ReviewRequest): HostReviewReservation {
		// Retire whatever the log already holds before the cursors are taken. A
		// resumed session inherits its predecessor's file, and an unprocessed
		// `SessionEnd` sitting in it used to survive until the first inspection —
		// long after this reservation's own events had been appended behind it.
		this.drain();
		const initialCursors = new Map<string, number>();
		const sessionCursors = new Map<string, number>();
		for (const sessionId of this.log.sessions()) {
			const len = this.log.list(sessionId).length;
			initialCursors.set(sessionId, len);
			sessionCursors.set(sessionId, len);
		}
		this.pending.set(request.operationId, {
			request,
			initialCursors,
			sessionCursors,
			consumed: false,
		});
		return {
			id: request.operationId,
			dispatch: {
				name: CLAUDE_REVIEWER_AGENT,
				prompt: `<!-- immune-brain:operation_id=${request.operationId} task_id=${request.taskId} -->\n${request.prompt}`,
				max_turns: request.maxTurns,
				run_in_background: false,
			},
		};
	}

	observe(event: ClaudeHookEvent): void {
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
					// Any reservation that already bound evidence from the finished
					// session loses it outright; that evidence can never be revived.
					for (const [id, state] of this.pending) {
						if (state.startEvent?.sessionId === event.sessionId || state.postEvent?.sessionId === event.sessionId || state.stopEvent?.sessionId === event.sessionId) {
							this.pending.delete(id);
						}
					}
					// A resumed session reuses its id, so the same log can hold events
					// appended after an earlier end. Advancing every surviving cursor
					// past this point keeps the pre-end events unusable — the property
					// the old whole-log clear was protecting — while still letting the
					// events that follow reach their reservation. Clearing and stopping
					// here instead silently discarded a live Review receipt.
					for (const state of this.pending.values()) {
						const current = state.initialCursors.get(sessionId) ?? 0;
						if (i + 1 > current) state.initialCursors.set(sessionId, i + 1);
					}
					if (i === events.length - 1) {
						// Nothing followed the end, so the log is safe to reclaim.
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
				// Second pass for out-of-order correlation: if postEvent arrived during this batch,
				// run earlier events >= initialCursor so startEvent/stopEvent are correlated.
				for (const state of this.pending.values()) {
					if (state.consumed || state.error || !state.postEvent || state.postEvent.sessionId !== sessionId) continue;
					if (!state.startEvent || !state.stopEvent) {
						const from = state.initialCursors.get(sessionId) ?? 0;
						for (let j = from; j < events.length; j++) {
							this.applyReviewEvent(events[j], state);
							if (state.error) break;
						}
					}
				}
			}
		}
	}

	private applyReviewEvent(event: ClaudeHookEvent, state: PendingReview): void {
		if (state.error) return;
		if (event.type === "SubagentStart") {
			if (event.agent !== REVIEWER_AGENT && event.agent !== CLAUDE_REVIEWER_AGENT) return;
			// If operationId or prompt is explicit on Start, it must bind to this reservation
			if (event.operationId || event.prompt !== undefined) {
				if (!bindsStart(event, state)) return;
			}
			// If PostToolUse already bound to this reservation, match its agentId and session
			if (state.postEvent) {
				if (event.sessionId !== state.postEvent.sessionId || event.agentId !== state.postEvent.agentId) return;
			}
			if (state.stopEvent) {
				if (event.sessionId !== state.stopEvent.sessionId || event.agentId !== state.stopEvent.agentId) return;
			}
			// If neither postEvent nor stopEvent is present yet and this Start lacks operationId/prompt,
			// it cannot be bound proactively to a reservation without evidence; skip until correlated.
			if (!event.operationId && event.prompt === undefined && !state.postEvent && !state.stopEvent) {
				return;
			}
			if (state.startEvent) {
				if (state.startEvent === event) return;
				state.error = "reserved Review already has a native tool call";
				return;
			}
			state.startEvent = event;
			return;
		}
		if (event.type === "PostToolUse") {
			if (event.toolName !== AGENT_TOOL) return;
			if (!event.agentId || !event.operationId || event.operationId !== state.request.operationId) return;
			if ("taskId" in event && event.taskId && event.taskId !== state.request.taskId) return;
			if (state.startEvent && event.sessionId !== state.startEvent.sessionId) return;
			if (state.startEvent && event.agentId !== state.startEvent.agentId) return;
			if (state.stopEvent && event.sessionId !== state.stopEvent.sessionId) return;
			if (state.stopEvent && event.agentId !== state.stopEvent.agentId) return;
			if (state.postEvent !== undefined) {
				if (state.postEvent === event) return;
				state.error = "duplicate PostToolUse result observed for review reservation";
				return;
			}
			state.postEvent = event;
			return;
		}
		if (event.type === "SubagentStop") {
			if (event.agent !== REVIEWER_AGENT && event.agent !== CLAUDE_REVIEWER_AGENT) return;
			if (!event.agentId) return;
			if ("operationId" in event && event.operationId && event.operationId !== state.request.operationId) return;
			if ("taskId" in event && event.taskId && event.taskId !== state.request.taskId) return;
			if (state.startEvent && (event.sessionId !== state.startEvent.sessionId || event.agentId !== state.startEvent.agentId)) return;
			if (state.postEvent && (event.sessionId !== state.postEvent.sessionId || event.agentId !== state.postEvent.agentId)) return;
			if (!event.operationId && !state.startEvent && !state.postEvent) {
				return;
			}
			if (state.stopEvent) {
				if (state.stopEvent === event) return;
				state.error = "duplicate SubagentStop observed for review reservation";
				return;
			}
			state.stopEvent = event;
		}
	}

	inspectReview(reservation: HostReviewReservation): ConsumeReviewResult {
		this.drain();
		const state = this.pending.get(reservation.id);
		if (!state) return { ok: false, reason: "reserved foreground Agent was not observed", release: false };
		if (state.consumed) return { ok: false, reason: "review receipt already consumed", release: true };
		if (state.error) return { ok: false, reason: state.error, release: true };
		if (!state.startEvent) return { ok: false, reason: "reserved foreground Agent was not observed", release: false };
		if (!state.stopEvent || !state.postEvent?.result?.trim()) {
			return { ok: false, reason: "foreground Agent terminal event order is incomplete", release: false };
		}
		// Reconcile: all 3 events must belong to the exact same session and agentId
		if (
			state.startEvent.sessionId !== state.postEvent.sessionId ||
			state.startEvent.sessionId !== state.stopEvent.sessionId ||
			state.startEvent.agentId !== state.postEvent.agentId ||
			state.startEvent.agentId !== state.stopEvent.agentId
		) {
			return { ok: false, reason: "foreground Agent terminal event correlation mismatch", release: true };
		}
		const actorId = `claude:${state.startEvent.agentId ?? reservation.id}`;
		const launch = parseAsyncAgentLaunch(state.postEvent.result);
		if (!launch) {
			return { ok: true, receipt: { actorId, result: state.postEvent.result } };
		}
		// Invariant guard. Correlation already binds the PostToolUse through the
		// same `agentId` this envelope carries, so a foreign id normally never
		// reaches here; assert it anyway rather than read a transcript the three
		// observed events did not agree on.
		if (launch.agentId !== state.postEvent.agentId) {
			return { ok: false, reason: "async Agent launch envelope names a different agent", release: true };
		}
		const transcript = readAgentTranscript(launch.outputFile);
		if (transcript === undefined) {
			// Fail closed rather than falling back to bytes the Parent supplied:
			// an optional weaker path is a path the Parent can choose to force.
			return { ok: false, reason: "async Agent transcript is not readable", release: false };
		}
		const verdict = readAgentTranscriptResult(transcript, launch.agentId);
		if (!verdict?.trim()) {
			return { ok: false, reason: "async Agent transcript carries no reviewer result", release: false };
		}
		return { ok: true, receipt: { actorId, result: verdict } };
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
		if (!entry) return { ok: false, reason: "reserved foreground Agent was not observed", release: false };
		return this.inspectReview({ id: entry[0], dispatch: entry[1].request });
	}

	releaseReview(reservation: HostReviewReservation): void {
		this.pending.delete(reservation.id);
	}
}

export function parseHookStdin(raw: string): ClaudeHookEvent | null {
	let payload: Record<string, unknown>;
	try { payload = JSON.parse(raw) as Record<string, unknown>; }
	catch { return null; }
	const hookType = String(payload.hook_event_name ?? payload.type ?? "");
	const sessionId = String(payload.session_id ?? payload.sessionId ?? process.env.CLAUDE_SESSION_ID ?? "");
	if (!sessionId) return null;
	const agent = String(payload.agent_type ?? payload.agent ?? payload.subagent_type ?? "");
	const agentId = String(payload.agent_id ?? payload.agentId ?? "");
	const taskId = typeof payload.task_id === "string" ? payload.task_id : undefined;
	const operationId = typeof payload.operation_id === "string" ? payload.operation_id : undefined;
	let prompt = typeof payload.prompt === "string" ? payload.prompt : undefined;
	if (!prompt && typeof payload.input === "object" && payload.input !== null) {
		const inputObj = payload.input as Record<string, unknown>;
		if (typeof inputObj.prompt === "string") prompt = inputObj.prompt;
	}
	if (!prompt && typeof payload.tool_input === "object" && payload.tool_input !== null) {
		const toolInputObj = payload.tool_input as Record<string, unknown>;
		if (typeof toolInputObj.prompt === "string") prompt = toolInputObj.prompt;
	}
	// The async launch envelope echoes the dispatched prompt. It is the only
	// place the reservation marker appears when a payload omits `tool_input`,
	// and it is written by the Host, not by the Parent, like every other field
	// read here.
	if (!prompt && typeof payload.tool_response === "object" && payload.tool_response !== null) {
		const toolResponseObj = payload.tool_response as Record<string, unknown>;
		if (typeof toolResponseObj.prompt === "string") prompt = toolResponseObj.prompt;
	}
	let extractedOpId = operationId;
	let extractedTaskId = taskId;
	// Extract nested operation_id/task_id from tool_input or tool_response (e.g. { tool_input: { operation_id, task_id } })
	for (const candidate of [payload.input, payload.tool_input, payload.tool_response, payload.toolResponse, payload.response, payload.result]) {
		if (candidate && typeof candidate === "object" && candidate !== null) {
			const obj = candidate as Record<string, unknown>;
			const nestedOp = typeof obj.operation_id === "string" ? obj.operation_id : typeof obj.operationId === "string" ? obj.operationId : undefined;
			const nestedTask = typeof obj.task_id === "string" ? obj.task_id : typeof obj.taskId === "string" ? obj.taskId : undefined;
			if (nestedOp) {
				if (extractedOpId && extractedOpId !== nestedOp) return null;
				extractedOpId = nestedOp;
			}
			if (nestedTask) {
				if (extractedTaskId && extractedTaskId !== nestedTask) return null;
				extractedTaskId = nestedTask;
			}
		}
	}
	if (prompt) {
		const match = /<!-- immune-brain:operation_id=([^\s]+)\s+task_id=([^\s]+)\s+-->/.exec(prompt);
		if (match) {
			if (extractedOpId && extractedOpId !== match[1]) return null;
			if (extractedTaskId && extractedTaskId !== match[2]) return null;
			extractedOpId = match[1];
			extractedTaskId = match[2];
		}
	}
	if (hookType === "SubagentStart" || hookType === "SubagentStop") {
		return {
			type: hookType,
			sessionId,
			agent,
			agentId,
			taskId: extractedTaskId,
			operationId: extractedOpId,
			...(hookType === "SubagentStart" ? { prompt } : {}),
		};
	}
	if (hookType === "PostToolUse") {
		const toolName = String(payload.tool_name ?? payload.toolName ?? payload.tool ?? "");
		const response = payload.tool_response ?? payload.toolResponse ?? payload.response ?? payload.result;
		let result = typeof response === "string" ? response : JSON.stringify(response ?? "");
		let extractedAgentId = agentId;
		if (response && typeof response === "object" && response !== null) {
			const respObj = response as Record<string, unknown>;
			if (typeof respObj.agentId === "string" && respObj.agentId) {
				if (extractedAgentId && extractedAgentId !== respObj.agentId) return null;
				extractedAgentId = respObj.agentId;
			}
			if (Array.isArray(respObj.content)) {
				const textItem = respObj.content.find((c: unknown) => typeof c === "object" && c !== null && (c as { type?: unknown }).type === "text");
				if (textItem && typeof (textItem as { text?: unknown }).text === "string") {
					result = (textItem as { text: string }).text;
				}
			}
		}
		return {
			type: "PostToolUse",
			sessionId,
			agentId: extractedAgentId,
			toolName,
			result,
			taskId: extractedTaskId,
			operationId: extractedOpId,
			prompt,
		};
	}
	if (hookType === "SessionEnd") return { type: "SessionEnd", sessionId };
	return null;
}
