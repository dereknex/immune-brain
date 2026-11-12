// Run continuation session state and the Antigravity Stop rule (Spec
// docs/specs/host-neutral-adapter-core.spec.md D9, D11). The state machine owns
// session metadata files, one-use tool-call correlation, pause, the native
// failure counter and binding migration; an adapter parses its Host payload into
// typed events and renders the outcome.
//
// Interface: `RunContinuationHost` (cache directory name and the Host's ADR 0025
// phase-entry ports), `readSessionToolCall`, `selectedParentSession`,
// `applyRunContinuationEvent`, `decideAutomatedStop`.
// Invariants: every continuation decision re-reads the Kernel; a private file
// past `MAX_METADATA_BYTES` carries no metadata; a correlation recorded for one
// workspace never answers another; a paused or settled entry spends its token.
// Side Effects: writes and removes private session files under the cache directory.
// Verification: `bun test tests/claude-run-continuation.test.ts` and
// `bun test tests/antigravity-assurance-conformance.test.ts -t 'Run Continuation Hook'`.

import { existsSync, lstatSync, realpathSync, renameSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { projectTaskStatus } from "../assurance/coordinator";
import { readTaskRecordRaw } from "../kernel/storage";
import { readAnyBatchRunState } from "../unattended/batch_state";
import { bindRun, decideRunContinuation, observeParentRun, scopedSourceDigest,
	type ReviewContinuationState, type RunContinuationState } from "../assurance/run_continuation";
import { digestOfReviewerBytes } from "../assurance/review_mediation";
import type { AssuranceObligation } from "../kernel/types";
import type { AssuranceProjection } from "../kernel/assurance_projection";
import { appendPrivate, cacheDir, ensurePrivateDir, ownedByUs, readPrivate, sessionHash } from "./private_file";

const NATIVE_OPERATIONS = new Set(["start_unattended_batch", "retire_stale_batch", "request_authorization", "approve_breaking_intent_revision", "stop"]);
const MAX_METADATA_BYTES = 256 * 1024;
/** Spec D9: the third native-operation failure under one entry pauses; the first two leave the run live for a retry. */
const NATIVE_FAILURE_LIMIT = 3;
/** Obligations the Antigravity Stop hook continues without a user action (Spec D11). */
const AUTOMATED_STOP_OBLIGATIONS: AssuranceObligation[] = ["run_qa", "run_review", "submit_assurance", "resolve_findings"];

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
	native_failures: number;
}

/** What only the Host knows: its cache directory and its ADR 0025 phase entry. */
export interface RunContinuationHost {
	/** Per-Host cache directory name; no Host reads another's session files. */
	cache_name: string;
	/** The session's phase-entry state, or null when it cannot be read. */
	entry_state(session_id: string): { run_live?: boolean } | null;
	/** Spend the session's entry token: a paused or settled entry needs a new literal entry. */
	revoke_entry(session_id: string): void;
	drop_entry_log(session_id: string): void;
}

export type RunContinuationEvent =
	| { kind: "session_end" }
	| { kind: "prompt"; releases: boolean }
	/** A tool call the Host correlated with this session; the gate itself stays in the machine. */
	| { kind: "tool_call"; operation: string; tool_id: string; task_id: string | null }
	| { kind: "tool_result"; operation: string; tool_id: string; response: Record<string, unknown> | null; failed: boolean }
	/** The Host's agent tool: one foreground reviewer dispatch or its result. */
	| { kind: "reviewer"; phase: "dispatch" | "return"; call_id: string; prompt_digest: string | null; agent_id: string | null; asynchronous: boolean }
	| { kind: "reviewer_stop"; agent_id: string | null }
	/** A Host turn boundary; `boundary` is resolved only for a live bound run, so an idle session never reads it. */
	| { kind: "stop"; boundary: () => string | null; stop_hook_active: boolean };

export type RunContinuationOutcome =
	| { kind: "none" }
	| { kind: "deny"; reason: string }
	| { kind: "paused"; reason: string }
	| { kind: "continue"; label: string; next_action: string | null };

export interface RunContinuationSession {
	session_id: string;
	workspace: string;
}

const blank = (): ContinuationMetadata => ({ state: null, sequence: 0, review: "unobserved", reviewer_prompt: null,
	reviewer_call_id: null, reviewer_agent_id: null, recovery_action: null, paused: null, stop_blocks: 0, native_failures: 0 });
const statePath = (host: RunContinuationHost, sessionId: string, root: string) => join(cacheDir(root, host.cache_name), `${sessionHash(sessionId)}.continuation`);
const callPath = (host: RunContinuationHost, toolId: string, root: string) => join(cacheDir(root, host.cache_name), `${sessionHash(toolId)}.continuation-call`);
function drop(host: RunContinuationHost, path: string, root: string): void {
	// Nothing to drop means no cache directory either: an idle session must leave the store untouched.
	if (!existsSync(path)) return;
	if (!ensurePrivateDir(cacheDir(root, host.cache_name))) return;
	try { const stat = lstatSync(path); if (stat.isFile() && ownedByUs(stat)) rmSync(path); } catch { /* absent */ }
}
function readLast(path: string): unknown {
	let stat;
	try {
		stat = lstatSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	if (!stat.isFile() || !ownedByUs(stat)) throw new Error("unsafe continuation metadata");
	// Past the bound the file holds no metadata this Host parsed: blank, not an error.
	if (stat.size > MAX_METADATA_BYTES) return null;
	const text = readPrivate(path, MAX_METADATA_BYTES);
	if (text === undefined) throw new Error("continuation metadata could not be read");
	const lines = text.trim().split("\n");
	return JSON.parse(lines.at(-1) ?? "null");
}
function readMetadata(host: RunContinuationHost, sessionId: string, root: string): ContinuationMetadata {
	const value = readLast(statePath(host, sessionId, root)) as ContinuationMetadata | null;
	if (!value) return blank();
	// Metadata written before the retry budget existed has no failure count.
	value.native_failures ??= 0;
	if (typeof value !== "object" || !Number.isInteger(value.sequence) || value.sequence < 0 ||
		!Number.isInteger(value.stop_blocks) || value.stop_blocks < 0 ||
		!Number.isInteger(value.native_failures ?? 0) || (value.native_failures ?? 0) < 0 ||
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
function save(host: RunContinuationHost, sessionId: string, root: string, value: ContinuationMetadata): void {
	const path = statePath(host, sessionId, root);
	const temporary = `${path}.${randomUUID()}`;
	if (!appendPrivate(temporary, cacheDir(root, host.cache_name), JSON.stringify(value) + "\n")) throw new Error("continuation metadata could not be written");
	try { renameSync(temporary, path); } finally { drop(host, temporary, root); }
}

/** ADR 0025: a pause ends the entry token, so the MCP server itself refuses token-backed calls until a new literal entry. */
function pauseRun(host: RunContinuationHost, metadata: ContinuationMetadata, sessionId: string, root: string, reason: string): void {
	metadata.paused = reason;
	save(host, sessionId, root, metadata);
	// The log has one revocation kind: a paused entry is spent exactly like a settled one.
	host.revoke_entry(sessionId);
}

async function observeNativeFailure(host: RunContinuationHost, metadata: ContinuationMetadata, correlation: Correlation, root: string, reason: string): Promise<void> {
	metadata.native_failures++;
	if (metadata.native_failures < NATIVE_FAILURE_LIMIT) { save(host, correlation.session_id, root, metadata); return; }
	pauseRun(host, metadata, correlation.session_id, root, reason);
}

/** Exact PreToolUse correlation; the transport connection ID is never a Hook session. */
export function readSessionToolCall(host: RunContinuationHost, root: string, toolId: string, operation: string, workspace: string): string | null {
	const record = readLast(callPath(host, toolId, root)) as Correlation | null;
	if (!record || record.operation !== operation || record.tool_use_id !== toolId || record.workspace !== realpathSync(workspace) ||
		typeof record.session_id !== "string" || !record.session_id || !host.entry_state(record.session_id)?.run_live) return null;
	return record.session_id;
}
export function selectedParentSession(host: RunContinuationHost, root: string, toolId: string, workspace: string, slug: string): boolean {
	const call = readLast(callPath(host, toolId, root)) as Correlation | null;
	if (!call || call.workspace !== realpathSync(workspace) || !["advance_assurance", "submit_review"].includes(call.operation) ||
		!host.entry_state(call.session_id)?.run_live) return false;
	const state = readMetadata(host, call.session_id, root).state;
	return state?.binding.kind === "parent" && state.binding.workspace === call.workspace && state.binding.initiative_slug === slug;
}

/** One typed Host event. Every decision below re-reads the actual Kernel. */
export async function applyRunContinuationEvent(host: RunContinuationHost, root: string,
		session: RunContinuationSession, event: RunContinuationEvent): Promise<RunContinuationOutcome> {
	const sessionId = session.session_id;
	const { workspace } = session;
	// ADR 0025: the entry token ends with its session.
	if (event.kind === "session_end") {
		drop(host, statePath(host, sessionId, root), root);
		host.drop_entry_log(sessionId);
		return { kind: "none" };
	}
	if (event.kind === "prompt") {
		if (event.releases) drop(host, statePath(host, sessionId, root), root);
		return { kind: "none" };
	}
	if (event.kind === "tool_call" && host.entry_state(sessionId)?.run_live) {
		const metadata = readMetadata(host, sessionId, root);
		if (metadata.paused && NATIVE_OPERATIONS.has(event.operation)) return { kind: "deny", reason: metadata.paused };
		const correlation: Correlation = { session_id: sessionId, workspace, tool_use_id: event.tool_id, operation: event.operation,
			task_id: event.task_id };
		if (!appendPrivate(callPath(host, event.tool_id, root), cacheDir(root, host.cache_name), JSON.stringify(correlation) + "\n"))
			throw new Error("tool correlation could not be recorded");
		return { kind: "none" };
	}
	const metadata = readMetadata(host, sessionId, root);
	if (metadata.paused) return event.kind === "stop" ? { kind: "paused", reason: metadata.paused } : { kind: "none" };
	if (event.kind === "tool_result") {
		const correlated = readLast(callPath(host, event.tool_id, root)) as Correlation | null;
		if (!correlated || correlated.session_id !== sessionId || correlated.workspace !== workspace || correlated.operation !== event.operation ||
			readSessionToolCall(host, root, event.tool_id, event.operation, workspace) !== sessionId) return { kind: "none" };
		drop(host, callPath(host, event.tool_id, root), root);
		if (event.failed) {
			if (NATIVE_OPERATIONS.has(event.operation)) await observeNativeFailure(host, metadata, correlated, root,
				`${event.operation} failed ${NATIVE_FAILURE_LIMIT} times under this entry; no further automatic retry`);
			else if (event.operation === "submit_review") { metadata.review = "rejected"; save(host, sessionId, root, metadata); }
			return { kind: "none" };
		}
		const response = event.response;
		if (event.operation === "start_unattended_batch" && response?.state === "native_parent" && typeof response.plan_digest === "string" && typeof response.initiative_slug === "string") {
			if (metadata.state?.binding.kind !== "parent") metadata.state = bindRun({ kind: "parent", workspace, session_id: sessionId,
				batch_id: null, initiative_slug: response.initiative_slug, plan_digest: response.plan_digest,
				final_verification: response.final_verification_commands as string[] | undefined });
		}
		if (event.operation === "start_unattended_batch" && response?.state === "started" && typeof response.batch_id === "string") {
			const batch = readAnyBatchRunState(workspace, response.batch_id);
			if (!batch) throw new Error("batch receipt has no persisted identity");
			if (metadata.state?.binding.kind !== "parent") metadata.state = bindRun({ kind: "parent", workspace,
				session_id: sessionId, batch_id: batch.batch_id, initiative_slug: batch.initiative_slug, plan_digest: batch.plan_digest });
		}
		if (!metadata.state && correlated.task_id && event.operation === "status") {
			const status = await projectTaskStatus(workspace, correlated.task_id);
			if (!status.error && status.claim?.task_id === correlated.task_id && status.projection.lifecycle === "active" && status.projection.run_id)
				metadata.state = bindRun({ kind: "task", workspace, session_id: sessionId, task_id: correlated.task_id, run_id: status.projection.run_id });
		}
		if (metadata.state?.binding.kind === "task" && correlated.task_id !== metadata.state.binding.task_id) return { kind: "none" };
		if (event.operation === "advance_assurance" && response?.state === "review_ready") {
			const params = response.agent_params as { prompt?: unknown } | undefined;
			if (typeof params?.prompt === "string" && digestOfReviewerBytes(params.prompt) !== metadata.reviewer_prompt) {
				metadata.reviewer_prompt = digestOfReviewerBytes(params.prompt); metadata.reviewer_call_id = null; metadata.reviewer_agent_id = null; metadata.review = "ready";
			}
		}
		if (["advance_assurance", "submit_review"].includes(event.operation) && response?.state === "review_incomplete") {
			pauseRun(host, metadata, sessionId, root, `review_incomplete: ${String(response.recovery_action)}`);
			return { kind: "none" };
		}
		if (event.operation === "submit_review") {
			if (response?.reason === "review_incomplete_retry") {
				metadata.review = "unobserved"; metadata.reviewer_prompt = null; metadata.reviewer_call_id = null; metadata.recovery_action = null;
			} else if (["blocked", "rejected", "failed"].includes(String(response?.state))) {
				metadata.review = "rejected";
				const recovery = response?.recovery_action ?? response?.next_action;
				metadata.recovery_action = typeof recovery === "string" ? recovery : null;
			} else { metadata.review = "unobserved"; metadata.reviewer_prompt = null; metadata.reviewer_call_id = null; metadata.recovery_action = null; }
		}
		if (NATIVE_OPERATIONS.has(event.operation) && ["blocked", "cancelled", "rejected", "failed"].includes(String(response?.state)))
			await observeNativeFailure(host, metadata, correlated, root, `${event.operation} did not apply ${NATIVE_FAILURE_LIMIT} times under this entry; inspect the same-Host recovery`);
		if (metadata.state) save(host, sessionId, root, metadata);
		return { kind: "none" };
	}
	if (event.kind === "reviewer" && metadata.state && metadata.reviewer_prompt) {
		if (event.phase === "dispatch" && event.call_id && event.prompt_digest !== null && event.prompt_digest === metadata.reviewer_prompt) {
			if (metadata.reviewer_call_id) { metadata.review = "rejected"; }
			else { metadata.reviewer_call_id = event.call_id; metadata.review = "running"; }
			save(host, sessionId, root, metadata);
		}
		if (event.phase === "return" && event.call_id === metadata.reviewer_call_id) {
			if (event.asynchronous) metadata.reviewer_agent_id = event.agent_id;
			else metadata.review = "returned";
			save(host, sessionId, root, metadata);
		}
		return { kind: "none" };
	}
	if (event.kind === "reviewer_stop") {
		if (metadata.reviewer_agent_id && event.agent_id === metadata.reviewer_agent_id) {
			metadata.review = "returned"; save(host, sessionId, root, metadata);
		}
		return { kind: "none" };
	}
	if (event.kind !== "stop" || !metadata.state) return { kind: "none" };
	if (!host.entry_state(sessionId)?.run_live) { drop(host, statePath(host, sessionId, root), root); return { kind: "none" }; }
	if (metadata.state.binding.workspace !== workspace) {
		drop(host, statePath(host, sessionId, root), root);
		return { kind: "paused", reason: "workspace changed; enter drive explicitly in this workspace" };
	}
	const boundary = event.boundary();
	if (!boundary) return { kind: "none" };
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
	if (decision.action === "unbound" || decision.action === "settled") {
		// A terminal bound run spends its entry token; the next run needs a new literal entry.
		if (decision.action === "settled") host.revoke_entry(sessionId);
		drop(host, statePath(host, sessionId, root), root);
		return { kind: "none" };
	}
	if (decision.action === "wait") { metadata.state = decision.state; save(host, sessionId, root, metadata); return { kind: "none" }; }
	// Spec D12: an unchanged digest after the nudge yields the turn instead of pausing, so waiting on
	// background work never spends the entry. Later progress blocks again.
	if (decision.action === "pause" && decision.stalled) { metadata.state = decision.state; metadata.stop_blocks = 0; save(host, sessionId, root, metadata); return { kind: "none" }; }
	if (decision.state.progress_digest !== metadata.state.progress_digest || !event.stop_hook_active) metadata.stop_blocks = 0;
	metadata.state = decision.state;
	if (decision.action === "pause" || metadata.stop_blocks >= 7) {
		pauseRun(host, metadata, sessionId, root, metadata.stop_blocks >= 7 ? "Claude consecutive Stop boundary reached; resume explicitly in the same Host" : decision.reason);
		return { kind: "paused", reason: metadata.paused! };
	}
	metadata.stop_blocks++;
	save(host, sessionId, root, metadata);
	return { kind: "continue", label: taskId, next_action: decision.next_action };
}

/**
 * Spec D11: the Antigravity Stop hook continues exactly when the projection is
 * active, no user decision is open and the next obligation is automated. It
 * adopts none of the Claude phase-entry or call-correlation mechanism.
 */
export function decideAutomatedStop(taskId: string, projection: AssuranceProjection): { decision?: "continue"; reason?: string } {
	if (projection.lifecycle !== "active") return {};
	// If waiting on user, allow stop
	if (projection.next_obligation === "resolve_user_decision" || projection.next_obligation === "revise_intent" ||
		projection.open_user_decision_count > 0 || projection.unresolved_user_decision_ids.length > 0) return {};
	if (!AUTOMATED_STOP_OBLIGATIONS.includes(projection.next_obligation)) return {};
	return { decision: "continue", reason: `Task ${taskId} is active with next obligation: ${projection.next_obligation}. Please proceed.` };
}
