import { FileHookEventLog, MemoryHookEventLog, hookEventPath as sharedHookEventPath, type HookEventLog } from "../host-core/hook_event_log";
import { readPrivate } from "../host-core/private_file";
import { VerifierObservation, type VerifierObservationProfile } from "../host-core/verifier_observation";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import type {
	AssuranceHostPort,
	HostReviewReservation,
	VerificationRequest,
} from "../assurance/host_port";

export const AGENT_TOOL = "Agent";
/** The verifier agent types a Claude Host reports for its own dispatch. */
const VERIFIER_AGENTS = ["immune-brain-review-verifier", "immune-brain:immune-brain-review-verifier"];

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
		model?: string;
		taskId?: string;
		operationId?: string;
		prompt?: string;
		/** Session transcript the Host reported for this hook. */
		transcriptPath?: string;
	}
	| {
		type: "SubagentStop";
		sessionId: string;
		agent: string;
		agentId: string;
		taskId?: string;
		operationId?: string;
		transcriptPath?: string;
		agentTranscriptPath?: string;
	}
	| { type: "SessionEnd"; sessionId: string };

/** The Claude Host keeps its own cache directory name; storage is shared (D3). */
export const CLAUDE_CACHE_DIR = "immune-brain-claude";

/** Claude session files stay `<hash>.jsonl` under the Claude cache directory. */
export function hookEventPath(sessionId: string, root = tmpdir()): string {
	return sharedHookEventPath(CLAUDE_CACHE_DIR, sessionId, root);
}

/** The event log this adapter constructs: the shared file log over the Claude cache. */
export function claudeHookEventLog(root = tmpdir()): FileHookEventLog<ClaudeHookEvent> {
	return new FileHookEventLog<ClaudeHookEvent>(CLAUDE_CACHE_DIR, root);
}

/**
 * Upper bound on a reviewer transcript we are willing to load. A reviewer that
 * produced more than this did not produce a verdict; refusing to allocate for it
 * is safer than trusting whatever the tail happens to contain.
 */
const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024;

export type AsyncAgentLaunch = { agentId: string; outputFile: string; resolvedModel?: string };

/**
 * Recognise the launch receipt this Claude Code build returns for `Agent`.
 *
 * Every `Agent` call here runs asynchronously: this Host has no synchronous
 * mode and no background switch, so the dispatch envelope carries nothing that
 * would ask for one. The tool result is therefore
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
	const resolvedModel = typeof obj.resolvedModel === "string" && obj.resolvedModel.trim() ? obj.resolvedModel : undefined;
	return { agentId, outputFile, ...(resolvedModel ? { resolvedModel } : {}) };
}

const HANDBACK_TOOL = "SubagentHandback";

/**
 * Extract the reviewer's terminal message from its own transcript.
 *
 * Each record carries the `agentId` that wrote it, so the caller's independently
 * observed id is matched per record rather than trusted for the file as a whole;
 * a transcript that interleaves another agent cannot contribute its text.
 *
 * A subagent ends its run either with an assistant text message or, on Hosts
 * that hand the report back through a tool, with a `SubagentHandback` call whose
 * `input.message` is that same report and which leaves no text block behind.
 * Both are the reviewer's own record in its own transcript, so whichever the
 * observed agent wrote last is its result — across records and across the
 * ordered content blocks of a single record.
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
			if (part.type === "tool_use" && part.name === HANDBACK_TOOL && part.input && typeof part.input === "object") {
				const report = (part.input as Record<string, unknown>).message;
				// Blocks are ordered, so text before the report is a preamble and
				// only text written after it can supersede it.
				if (typeof report === "string" && report.trim()) { last = report; text = ""; }
			}
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

const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Read the transcript a synchronous `Agent` result is settled from.
 *
 * A synchronous result carries no pointer, so the only locator the Host wrote
 * is a hook field: the subagent's own transcript when `SubagentStop` reported it,
 * otherwise the path the session store derives for the correlated `agentId`. A
 * locator that is present but unusable never falls back to the other one — a
 * fallback is a second way to settle, and the Parent can force the weaker one.
 */
function readSyncAgentTranscript(
	post: Extract<ClaudeHookEvent, { type: "PostToolUse" }>,
	stop: Extract<ClaudeHookEvent, { type: "SubagentStop" }>,
): string | undefined {
	if (stop.agentTranscriptPath) return readAgentTranscript(stop.agentTranscriptPath);
	const session = post.transcriptPath;
	if (!session || !isAbsolute(session) || !AGENT_ID_PATTERN.test(post.agentId)) return;
	const derived = join(dirname(session), basename(session, ".jsonl"), "subagents", `agent-${post.agentId}.jsonl`);
	return readAgentTranscript(derived);
}

export function parseReviewMarker(prompt: unknown): { operationId: string; taskId: string } | undefined {
	if (typeof prompt !== "string") return;
	const match = /<!-- immune-brain:operation_id=([^\s]+)\s+task_id=([^\s]+)\s+-->/.exec(prompt);
	if (match) return { operationId: match[1], taskId: match[2] };
}

/**
 * The Claude Host's own mapping into the shared state machine (D5): its hook
 * vocabulary, its dispatch envelope, and its transcript-based result
 * resolution. Everything the reservation does lives in `VerifierObservation`.
 */
const CLAUDE_VERIFIER_PROFILE: VerifierObservationProfile<ClaudeHookEvent> = {
	verifierAgents: VERIFIER_AGENTS,
	terminal: "result+stop",
	actorPrefix: "claude",
	dispatch: ({ dispatchPrompt, model }) => ({
		subagent_type: "immune-brain:immune-brain-review-verifier",
		model,
		prompt: dispatchPrompt,
	}),
	decode(event) {
		if (event.type === "SessionEnd") return { type: "session_end", sessionId: event.sessionId };
		if (event.type === "SubagentStart") return {
			type: "start",
			sessionId: event.sessionId,
			agentId: event.agentId,
			...(event.agent ? { agent: event.agent } : {}),
			...(event.prompt !== undefined ? { prompt: event.prompt } : {}),
			...(event.taskId ? { taskId: event.taskId } : {}),
			...(event.operationId ? { operationId: event.operationId } : {}),
		};
		if (event.type === "PostToolUse") {
			// An `Agent` result names its reservation through the operation id, so a
			// result without one is not evidence for any reservation.
			if (event.toolName !== AGENT_TOOL || !event.agentId || !event.operationId) return null;
			return {
				type: "result",
				sessionId: event.sessionId,
				agentId: event.agentId,
				result: event.result,
				...(event.model !== undefined ? { model: event.model } : {}),
				...(event.prompt !== undefined ? { prompt: event.prompt } : {}),
				...(event.taskId ? { taskId: event.taskId } : {}),
				operationId: event.operationId,
			};
		}
		if (!event.agentId) return null;
		return {
			type: "stop",
			sessionId: event.sessionId,
			agentId: event.agentId,
			...(event.agent ? { agent: event.agent } : {}),
			...(event.taskId ? { taskId: event.taskId } : {}),
			...(event.operationId ? { operationId: event.operationId } : {}),
		};
	},
	resolveResult(observed) {
		const post = observed.host.result as Extract<ClaudeHookEvent, { type: "PostToolUse" }>;
		const stop = observed.host.stop as Extract<ClaudeHookEvent, { type: "SubagentStop" }>;
		const launch = parseAsyncAgentLaunch(observed.result.result);
		if (!launch) {
			// A synchronous result is a pointer notice, not the report, so the
			// receipt still comes from the reviewer's own transcript. The tool
			// result text and any `handbackReport` field are bytes the Parent can
			// see or forge, and are never a receipt.
			const transcript = readSyncAgentTranscript(post, stop);
			if (transcript === undefined) return { ok: false, reason: "sync Agent transcript is not readable", release: false };
			const report = readAgentTranscriptResult(transcript, post.agentId);
			if (!report?.trim()) return { ok: false, reason: "sync Agent transcript carries no reviewer result", release: false };
			return { ok: true, result: report };
		}
		// Invariant guard. Correlation already binds the PostToolUse through the
		// same `agentId` this envelope carries, so a foreign id normally never
		// reaches here; assert it anyway rather than read a transcript the three
		// observed events did not agree on.
		if (launch.agentId !== post.agentId) return { ok: false, reason: "async Agent launch envelope names a different agent", release: true };
		const transcript = readAgentTranscript(launch.outputFile);
		// Fail closed rather than falling back to bytes the Parent supplied: an
		// optional weaker path is a path the Parent can choose to force.
		if (transcript === undefined) return { ok: false, reason: "async Agent transcript is not readable", release: false };
		const verdict = readAgentTranscriptResult(transcript, launch.agentId);
		if (!verdict?.trim()) return { ok: false, reason: "async Agent transcript carries no reviewer result", release: false };
		return { ok: true, result: verdict };
	},
};

export class ClaudeReviewHost implements AssuranceHostPort {
	readonly host = "claude-code" as const;
	private readonly observation: VerifierObservation<ClaudeHookEvent>;

	constructor(log: HookEventLog<ClaudeHookEvent> = new MemoryHookEventLog<ClaudeHookEvent>()) {
		this.observation = new VerifierObservation(CLAUDE_VERIFIER_PROFILE, log);
	}

	prepareVerification(request: VerificationRequest): HostReviewReservation {
		return this.observation.prepare(request);
	}

	inspectVerification(reservation: HostReviewReservation) {
		return this.observation.inspect(reservation);
	}

	observe(event: ClaudeHookEvent): void {
		this.observation.observe(event);
	}

	releaseReview(reservation: HostReviewReservation): void {
		this.observation.release(reservation);
	}
}

/** A hook-reported path is usable only when the Host wrote a non-empty absolute string. */
function hookPath(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() && isAbsolute(value) ? value : undefined;
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
	const transcriptPath = hookPath(payload.transcript_path);
	const agentTranscriptPath = hookPath(payload.agent_transcript_path);
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
		const marker = parseReviewMarker(prompt.replace("<!-- immune-brain-verifier:operation_id=", "<!-- immune-brain:operation_id="));
		if (marker) {
			if (extractedOpId && extractedOpId !== marker.operationId) return null;
			if (extractedTaskId && extractedTaskId !== marker.taskId) return null;
			extractedOpId = marker.operationId;
			extractedTaskId = marker.taskId;
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
			...(hookType === "SubagentStop" ? {
				...(transcriptPath ? { transcriptPath } : {}),
				...(agentTranscriptPath ? { agentTranscriptPath } : {}),
			} : {}),
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
			...(transcriptPath ? { transcriptPath } : {}),
			model: typeof (payload.tool_input as Record<string, unknown> | undefined)?.model === "string" ? (payload.tool_input as Record<string, string>).model : undefined,
			taskId: extractedTaskId,
			operationId: extractedOpId,
			prompt,
		};
	}
	if (hookType === "SessionEnd") return { type: "SessionEnd", sessionId };
	return null;
}
