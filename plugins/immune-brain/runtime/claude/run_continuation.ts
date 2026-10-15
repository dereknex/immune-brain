import { realpathSync, lstatSync, rmSync, renameSync, openSync, fstatSync, readSync, closeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectTaskStatus } from "../assurance/coordinator";
import { readTaskRecordRaw } from "../kernel/storage";
import { recordParentRepair } from "../unattended/batch_git";
import { readAnyBatchRunState } from "../unattended/batch_state";
import { bindRun, decideRunContinuation, observeParentRun, parkFailedCriticalGate, releasesRunBinding, scopedSourceDigest,
	type RunContinuationState, type ReviewContinuationState } from "../assurance/run_continuation";
import { digestOfReviewerBytes } from "../assurance/review_mediation";
import { recognizePhaseEntry } from "../assurance/phase_entry";
import { homedir } from "node:os";
import { readPhaseEntryState, claudeAliasReader } from "./lane_guard";
import { appendPrivate, cacheDir, ensurePrivateDir, ownedByUs, readPrivate, sessionHash } from "./review_host";

const MCP_TOOL = /^mcp__.*immune-brain.*__(\w+)$/;
const NATIVE_OPERATIONS = new Set(["enroll", "start_unattended_batch", "request_authorization", "approve_breaking_intent_revision", "stop"]);
const MAX_METADATA_BYTES = 256 * 1024;
interface Correlation { session_id: string; workspace: string; tool_use_id: string; operation: string; task_id: string | null }
interface ContinuationMetadata {
	state: RunContinuationState | null;
	sequence: number;
	review: ReviewContinuationState;
	reviewer_prompt: string | null;
	reviewer_call_id: string | null;
	reviewer_agent_id: string | null;
	recovery_action: string | null;
	paused: string | null;
	stop_blocks: number;
}
const blank = (): ContinuationMetadata => ({ state: null, sequence: 0, review: "unobserved", reviewer_prompt: null,
	reviewer_call_id: null, reviewer_agent_id: null, recovery_action: null, paused: null, stop_blocks: 0 });
const statePath = (sessionId: string, root: string) => join(cacheDir(root), `${sessionHash(sessionId)}.continuation`);
const callPath = (toolId: string, root: string) => join(cacheDir(root), `${sessionHash(toolId)}.continuation-call`);
function drop(path: string, root: string): void {
	if (!ensurePrivateDir(cacheDir(root))) return;
	try { const stat = lstatSync(path); if (stat.isFile() && ownedByUs(stat)) rmSync(path); } catch { /* absent */ }
}
function readLast(path: string): unknown {
	let stat;
	try { stat = lstatSync(path); } catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	if (!stat.isFile() || !ownedByUs(stat)) throw new Error("unsafe continuation metadata");
	const text = readPrivate(path, MAX_METADATA_BYTES);
	if (text === undefined) throw new Error("continuation metadata could not be read");
	const lines = text.trim().split("\n");
	return JSON.parse(lines.at(-1) ?? "null");
}
function readMetadata(sessionId: string, root: string): ContinuationMetadata {
	const value = readLast(statePath(sessionId, root)) as ContinuationMetadata | null;
	if (!value) return blank();
	if (typeof value !== "object" || !Number.isInteger(value.sequence) || value.sequence < 0 ||
		!Number.isInteger(value.stop_blocks) || value.stop_blocks < 0 ||
		!["unobserved", "ready", "running", "returned", "rejected"].includes(value.review) ||
		![value.reviewer_prompt, value.reviewer_call_id, value.reviewer_agent_id, value.recovery_action, value.paused].every(v => v === null || typeof v === "string"))
		throw new Error("invalid continuation metadata");
	if (value.state) {
		const { binding } = value.state;
		if (!binding || binding.session_id !== sessionId || !Number.isInteger(value.state.unchanged_observations) || value.state.unchanged_observations < 0 ||
			!(value.state.progress_digest === null || typeof value.state.progress_digest === "string") ||
			!(value.state.boundary_id === null || typeof value.state.boundary_id === "string")) throw new Error("invalid bound run metadata");
		bindRun(binding);
	}
	return value;
}
function save(sessionId: string, root: string, value: ContinuationMetadata): void {
	const path = statePath(sessionId, root);
	const temporary = `${path}.${randomUUID()}`;
	if (!appendPrivate(temporary, cacheDir(root), JSON.stringify(value) + "\n")) throw new Error("continuation metadata could not be written");
	try { renameSync(temporary, path); } finally { drop(temporary, root); }
}

async function observeNativeFailure(metadata: ContinuationMetadata, correlation: Correlation, root: string, reason: string): Promise<void> {
	metadata.paused = reason;
	save(correlation.session_id, root, metadata);
	if (correlation.operation === "enroll" && metadata.state && await parkFailedCriticalGate(metadata.state.binding, correlation.task_id ?? undefined)) {
		metadata.paused = null;
		save(correlation.session_id, root, metadata);
	}
}

/** Exact PreToolUse correlation; the transport connection ID is never a Hook session. */
export function readRunToolSession(toolId: string, operation: string, workspace: string, root = tmpdir()): string | null {
	const record = readLast(callPath(toolId, root)) as Correlation | null;
	if (!record || record.operation !== operation || record.tool_use_id !== toolId || record.workspace !== realpathSync(workspace) ||
		typeof record.session_id !== "string" || !record.session_id || !readPhaseEntryState(record.session_id, root)?.run_live) return null;
	return record.session_id;
}
export function selectedClaudeParent(toolId: string, workspace: string, slug: string, root = tmpdir()): boolean {
	const call = readLast(callPath(toolId, root)) as Correlation | null;
	if (!call || call.workspace !== realpathSync(workspace) || !["advance_assurance", "submit_review"].includes(call.operation) ||
		!readPhaseEntryState(call.session_id, root)?.run_live) return false;
	const state = readMetadata(call.session_id, root).state;
	return state?.binding.kind === "parent" && state.binding.workspace === call.workspace && state.binding.initiative_slug === slug;
}

/** A transcript assistant UUID identifies a Host turn; local callback counters do not. */
function stopBoundary(payload: Record<string, unknown>): string | null {
	if (typeof payload.transcript_path !== "string" || !payload.transcript_path) return null;
	const fd = openSync(payload.transcript_path, "r");
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile()) throw new Error("Stop transcript must be a regular file");
		const bytes = Buffer.alloc(Math.min(stat.size, 256 * 1024));
		readSync(fd, bytes, 0, bytes.length, stat.size - bytes.length);
		for (const line of bytes.toString("utf8").trim().split("\n").reverse()) {
			let value; try { value = JSON.parse(line); } catch { continue; }
			if (value.type === "assistant" && !value.isSidechain && typeof value.uuid === "string" && value.uuid)
				return digestOfReviewerBytes(`${payload.transcript_path}\n${value.uuid}`);
		}
		return null;
	} finally { closeSync(fd); }
}

function toolResponse(payload: Record<string, unknown>): Record<string, unknown> | null {
	const response = payload.tool_response;
	if (Array.isArray(response)) {
		const text = response.filter(item => item?.type === "text" && typeof item.text === "string").map(item => item.text).join("");
		try { return JSON.parse(text); } catch { return null; }
	}
	if (response && typeof response === "object" && !Array.isArray(response)) {
		const object = response as Record<string, unknown>;
		if (typeof object.state === "string") return object;
		if (Array.isArray(object.content)) {
			const text = object.content.filter(item => item?.type === "text" && typeof item.text === "string").map(item => item.text).join("");
			try { return JSON.parse(text); } catch { return null; }
		}
		return object;
	}
	if (typeof response === "string") { try { return JSON.parse(response); } catch { return null; } }
	return null;
}
function warning(reason: string): string { return JSON.stringify({ systemMessage: `Immune-Brain run paused: ${reason}` }); }

/** Hook metadata only. Every continuation decision re-reads the actual Kernel. */
export async function runContinuationHookOutput(payload: Record<string, unknown>, root = tmpdir()): Promise<string | null> {
	const sessionId = typeof payload.session_id === "string" ? payload.session_id : "";
	if (!sessionId) return null;
	const workspace = realpathSync(typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd());
	const event = String(payload.hook_event_name ?? "");
	if (event === "SessionEnd") { drop(statePath(sessionId, root), root); return null; }
	if (event === "UserPromptSubmit") {
		const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
		const entry = recognizePhaseEntry(prompt, claudeAliasReader(workspace, homedir()));
		if (releasesRunBinding(prompt, entry === "plan" ? "planner" : null) || entry === "run")
			drop(statePath(sessionId, root), root);
		return null;
	}
	try {
		const operation = MCP_TOOL.exec(String(payload.tool_name ?? ""))?.[1];
		const toolId = typeof payload.tool_use_id === "string" ? payload.tool_use_id : "";
		if (event === "PreToolUse" && operation && toolId && readPhaseEntryState(sessionId, root)?.run_live) {
			const metadata = readMetadata(sessionId, root);
			if (metadata.paused && NATIVE_OPERATIONS.has(operation)) return JSON.stringify({ hookSpecificOutput: {
				hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `Run paused: ${metadata.paused}; enter imm-run explicitly before another native gate` } });
			const input = (payload.tool_input ?? {}) as Record<string, unknown>;
			if (operation === "enroll" && metadata.state?.binding.kind === "parent" &&
				metadata.state.binding.blocked_native_tasks?.includes(String(input.task_id))) return JSON.stringify({ hookSpecificOutput: {
					hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "This critical gate is parked; continue independent work or resolve its same-Host recovery and enter imm-run explicitly" } });
			const correlation: Correlation = { session_id: sessionId, workspace, tool_use_id: toolId, operation,
				task_id: typeof input.task_id === "string" ? input.task_id : null };
			if (!appendPrivate(callPath(toolId, root), cacheDir(root), JSON.stringify(correlation) + "\n")) throw new Error("tool correlation could not be recorded");
			return null;
		}
		const metadata = readMetadata(sessionId, root);
		if (metadata.paused) return event === "Stop" ? warning(metadata.paused) : null;
		if ((event === "PostToolUse" || event === "PostToolUseFailure") && operation && toolId) {
			const correlated = readLast(callPath(toolId, root)) as Correlation | null;
			if (!correlated || correlated.session_id !== sessionId || correlated.workspace !== workspace || correlated.operation !== operation ||
				readRunToolSession(toolId, operation, workspace, root) !== sessionId) return null;
			drop(callPath(toolId, root), root);
			if (event === "PostToolUseFailure") {
				if (NATIVE_OPERATIONS.has(operation)) await observeNativeFailure(metadata, correlated, root, `${operation} failed or was cancelled; no automatic native retry`);
				else if (operation === "submit_review") { metadata.review = "rejected"; save(sessionId, root, metadata); }
				return null;
			}
			const response = toolResponse(payload);
			if (operation === "start_unattended_batch" && response?.state === "native_parent" && typeof response.plan_digest === "string" && typeof response.initiative_slug === "string") {
				if (metadata.state?.binding.kind !== "parent") metadata.state = bindRun({ kind: "parent", workspace, session_id: sessionId,
					batch_id: null, initiative_slug: response.initiative_slug, plan_digest: response.plan_digest,
					final_verification: response.final_verification_commands as string[] | undefined });
			}
			if (operation === "start_unattended_batch" && response?.state === "started" && typeof response.batch_id === "string") {
				const batch = readAnyBatchRunState(workspace, response.batch_id);
				if (!batch) throw new Error("batch receipt has no persisted identity");
				if (metadata.state?.binding.kind !== "parent") metadata.state = bindRun({ kind: "parent", workspace,
					session_id: sessionId, batch_id: batch.batch_id, initiative_slug: batch.initiative_slug, plan_digest: batch.plan_digest });
			}
			if (!metadata.state && correlated.task_id && ["enroll", "status"].includes(operation)) {
				const status = await projectTaskStatus(workspace, correlated.task_id);
				if (!status.error && status.claim?.task_id === correlated.task_id && status.projection.lifecycle === "active" && status.projection.run_id)
					metadata.state = bindRun({ kind: "task", workspace, session_id: sessionId, task_id: correlated.task_id, run_id: status.projection.run_id });
			}
			if (operation === "enroll" && correlated.task_id && metadata.state?.binding.kind === "parent" && !["blocked", "cancelled", "failed", "rejected"].includes(String(response?.state)))
				await recordParentRepair(workspace, metadata.state.binding.batch_id, correlated.task_id, metadata.state.binding.initiative_slug);
			if (metadata.state?.binding.kind === "task" && correlated.task_id !== metadata.state.binding.task_id) return null;
			if (operation === "advance_assurance" && response?.state === "review_ready") {
				const params = response.agent_params as { prompt?: unknown } | undefined;
				if (typeof params?.prompt === "string" && digestOfReviewerBytes(params.prompt) !== metadata.reviewer_prompt) {
					metadata.reviewer_prompt = digestOfReviewerBytes(params.prompt); metadata.reviewer_call_id = null; metadata.reviewer_agent_id = null; metadata.review = "ready";
				}
			}
			if (operation === "submit_review") {
				if (["blocked", "rejected", "failed"].includes(String(response?.state))) {
					metadata.review = "rejected";
					const recovery = response?.recovery_action ?? response?.next_action;
					metadata.recovery_action = typeof recovery === "string" ? recovery : null;
				} else { metadata.review = "unobserved"; metadata.reviewer_prompt = null; metadata.reviewer_call_id = null; metadata.recovery_action = null; }
			}
			if (NATIVE_OPERATIONS.has(operation) && ["blocked", "cancelled", "rejected", "failed"].includes(String(response?.state)))
				await observeNativeFailure(metadata, correlated, root, `${operation} did not apply; inspect the same-Host recovery before retrying`);
			if (metadata.state) save(sessionId, root, metadata);
			return null;
		}
		if (payload.tool_name === "Agent" && metadata.state && metadata.reviewer_prompt) {
			const input = payload.tool_input as { prompt?: unknown; subagent_type?: unknown } | undefined;
			if (event === "PreToolUse" && typeof input?.prompt === "string" && digestOfReviewerBytes(input.prompt) === metadata.reviewer_prompt && toolId) {
				if (metadata.reviewer_call_id) { metadata.review = "rejected"; }
				else { metadata.reviewer_call_id = toolId; metadata.review = "running"; }
				save(sessionId, root, metadata);
			}
			if ((event === "PostToolUse" || event === "PostToolUseFailure") && toolId === metadata.reviewer_call_id) {
				const response = toolResponse(payload);
				if (response?.isAsync === true || response?.status === "async_launched") {
					metadata.reviewer_agent_id = typeof response.agentId === "string" ? response.agentId : null;
				} else metadata.review = "returned";
				save(sessionId, root, metadata);
			}
		}
		if (event === "SubagentStop" && metadata.reviewer_agent_id && payload.agent_id === metadata.reviewer_agent_id) {
			metadata.review = "returned"; save(sessionId, root, metadata); return null;
		}
		if (event !== "Stop" || !metadata.state) return null;
		if (!readPhaseEntryState(sessionId, root)?.run_live) { drop(statePath(sessionId, root), root); return null; }
		if (metadata.state.binding.workspace !== workspace) {
			drop(statePath(sessionId, root), root);
			return warning("workspace changed; enter imm-run explicitly in this workspace");
		}
		const boundary = stopBoundary(payload);
		if (!boundary) return null;
		metadata.sequence++;
		const taskId = metadata.state.binding.kind === "task" ? metadata.state.binding.task_id : metadata.state.binding.initiative_slug;
		let observation: Parameters<typeof decideRunContinuation>[1];
		if (metadata.state.binding.kind === "parent") observation = await observeParentRun(metadata.state.binding,
			boundary, metadata.review, metadata.recovery_action ?? undefined);
		else {
			const status = await projectTaskStatus(workspace, taskId);
			const record = readTaskRecordRaw(workspace, taskId);
			observation = { kind: "task", workspace, session_id: sessionId,
				boundary_id: boundary, status,
				source_digest: record.record ? scopedSourceDigest(workspace, record.record.intent_snapshot.scope_hint) : "terminal",
				review: metadata.review, recovery_action: metadata.recovery_action ?? undefined };
		}
		const decision = decideRunContinuation(metadata.state, observation);
		if (decision.action === "unbound" || decision.action === "settled") { drop(statePath(sessionId, root), root); return null; }
		if (decision.action === "wait") { metadata.state = decision.state; save(sessionId, root, metadata); return null; }
		if (decision.state.progress_digest !== metadata.state.progress_digest || payload.stop_hook_active !== true) metadata.stop_blocks = 0;
		metadata.state = decision.state;
		if (decision.action === "pause" || metadata.stop_blocks >= 7) {
			metadata.paused = metadata.stop_blocks >= 7 ? "Claude consecutive Stop boundary reached; resume explicitly in the same Host" : decision.reason;
			save(sessionId, root, metadata); return warning(metadata.paused);
		}
		metadata.stop_blocks++;
		save(sessionId, root, metadata);
		return JSON.stringify({ decision: "block", reason: `Explicit imm-run is bound to ${taskId}; Kernel settlement is incomplete. ${decision.next_action}. Continue the authorized Loop.` });
	} catch (error) {
		return warning(`continuation facts could not be verified: ${error instanceof Error ? error.message : String(error)}`);
	}
}
