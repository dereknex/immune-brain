// Claude Code hook decisions that are not Review observation. PreToolUse guard for batch Lanes: an Edit, Write, MultiEdit or
// NotebookEdit whose target resolves outside the Lane is denied before it
// runs, the same rule the Pi extension applies to `edit`/`write`. Bash is not
// intercepted. Outside a Lane the hook answers nothing and the tool runs as
// configured.
//
// Phase entry gate: UserPromptSubmit records which literal prompt entered
// planning or execution, and a run entry mints the session's entry token (ADR
// 0025); PreToolUse denies `enroll`, `start_unattended_batch`,
// `retire_stale_batch` and the `drive` Skill without a live run entry, and
// otherwise leaves an admission carrying that token, which the tool handler
// consumes by tool-use id. A model Skill call for
// `draw-up` or `clarify` is never denied and changes no entry state.
import { lstatSync, realpathSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { laneWriteRefusal } from "../unattended/lane_workspace";
import { activeTaskNotice } from "../assurance/active_task_notice";
import { releasesRunBinding } from "../assurance/run_continuation";
import { localSkillExists, readAliasFile } from "../assurance/alias_file";
import {
	admitPhaseOperation,
	entryRevocationLogLine,
	NO_PHASE_ENTRY,
	packagedPhaseSkill,
	phaseEntryLogLine,
	phaseRefusalMessage,
	PHASE_ENTRY_RECOVERY,
	recognizePhaseEntry,
	reducePhaseEntryLog,
	RUN_ENTRY_REQUIRED,
	type LocalNames,
	type EntryTokenRevocation,
	type PhaseEntryState,
	type PhaseOperation,
} from "../assurance/phase_entry";
import { appendPrivate, cacheDir, ensurePrivateDir, ownedByUs, readPrivate, sessionHash } from "./review_host";

const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const GATED_MCP_TOOL = /^mcp__.*immune-brain.*__(enroll|start_unattended_batch|retire_stale_batch)$/;

export type GatedTool = "enroll" | "start_unattended_batch" | "retire_stale_batch";

/**
 * A consumed admission. `entry_token` is the live token the hook saw for this
 * call, with the workspace it is bound to; null for an entry recorded before
 * tokens, which still needs the native gate.
 */
export interface PhaseAdmissionGrant {
	entry_token: string | null;
	workspace: string | null;
}

/** Where the phase entry gate keeps its private files and finds user aliases. */
export interface PhaseEntryLocations {
	/** Parent of the private cache directory. Defaults to the OS temp directory. */
	root?: string;
	/** The user's home, for `~/.claude/commands`. */
	home?: string;
	/** The private store's append and read. Default to the real file operations. */
	append?: typeof appendPrivate;
	read?: typeof readPrivate;
}

function denyPreToolUse(reason: string): string {
	return JSON.stringify({
		hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
	});
}

/** The hook's stdout for one PreToolUse payload, or null to stay silent. */
export function laneGuardHookOutput(payload: Record<string, unknown>): string | null {
	if (payload.hook_event_name !== "PreToolUse" || !FILE_TOOLS.has(String(payload.tool_name))) return null;
	const input = (payload.tool_input ?? {}) as { file_path?: unknown; notebook_path?: unknown };
	const cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd();
	const refusal = laneWriteRefusal(cwd, input.file_path ?? input.notebook_path);
	if (!refusal) return null;
	return denyPreToolUse(refusal);
}

/**
 * UserPromptSubmit: when the workspace has an active Managed task, add the
 * advisory notice as context. It never resumes the task.
 */
export async function activeTaskHookOutput(payload: Record<string, unknown>): Promise<string | null> {
	if (payload.hook_event_name !== "UserPromptSubmit") return null;
	const cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd();
	const notice = await activeTaskNotice(cwd);
	if (!notice) return null;
	return JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: notice } });
}

function entryLogPath(sessionId: string, root: string): string {
	return join(cacheDir(root), `${sessionHash(sessionId)}.entry`);
}

function admissionPath(toolUseId: string, root: string): string {
	return join(cacheDir(root), `${sessionHash(toolUseId)}.admit`);
}

function sessionIdOf(payload: Record<string, unknown>): string {
	return typeof payload.session_id === "string" ? payload.session_id : "";
}

function cwdOf(payload: Record<string, unknown>): string {
	return typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd();
}

/** Project commands first, then the user's, as Claude Code resolves commands; and the same two skill roots. */
export function claudeLocalNames(cwd: string, home: string): LocalNames {
	const roots = [join(cwd, ".claude"), join(home, ".claude")];
	return {
		alias: (name) => {
			for (const root of roots) {
				const body = readAliasFile(join(root, "commands", `${name}.md`));
				if (body !== null) return body;
			}
			return null;
		},
		skill: (name) => roots.some((root) => localSkillExists(join(root, "skills"), name)),
	};
}

/** The session's entry state: none recorded yet, or null when the store is unreadable. */
export function readPhaseEntryState(sessionId: string, root = tmpdir(), read: typeof readPrivate = readPrivate): PhaseEntryState | null {
	if (!sessionId) return null;
	const path = entryLogPath(sessionId, root);
	try {
		lstatSync(path);
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT" ? NO_PHASE_ENTRY : null;
	}
	if (!ensurePrivateDir(cacheDir(root))) return null;
	let text: string | undefined;
	try { text = read(path); } catch { return null; }
	return text === undefined ? null : reducePhaseEntryLog(text);
}

/** Removes one of our private files. Never follows a link or touches another owner's file. */
function dropPrivate(path: string): void {
	try {
		const stat = lstatSync(path);
		if (ownedByUs(stat) && stat.isFile()) rmSync(path, { force: true });
	} catch { /* already gone, or not ours to remove */ }
}

/**
 * Appends one entry line to the session log. A line that could not be written
 * drops the log: an earlier entry must not outlive a line the store never saw,
 * so the session is back to no entry.
 */
function appendPhaseEntry(sessionId: string, line: string, root: string, locations: PhaseEntryLocations): boolean {
	const path = entryLogPath(sessionId, root);
	let recorded = false;
	try { recorded = (locations.append ?? appendPrivate)(path, cacheDir(root), line); } catch { /* an unwritten line drops the log */ }
	if (!recorded) dropPrivate(path);
	return recorded;
}

/** SessionEnd: the session's entry and its token end with it. */
export function dropPhaseEntryLog(sessionId: string, root = tmpdir()): void {
	if (sessionId) dropPrivate(entryLogPath(sessionId, root));
}

/** The bound run is terminal: the token stops admitting until a new literal entry. */
export function revokeEntryToken(sessionId: string, reason: EntryTokenRevocation, root = tmpdir()): void {
	if (sessionId && readPhaseEntryState(sessionId, root)?.token) appendPhaseEntry(sessionId, entryRevocationLogLine(reason), root, {});
}

/**
 * UserPromptSubmit: record whether this literal prompt entered a phase. A
 * prompt that could not be recorded drops the log.
 */
export function recordPhaseEntryPrompt(payload: Record<string, unknown>, locations: PhaseEntryLocations = {}): boolean {
	if (payload.hook_event_name !== "UserPromptSubmit") return false;
	const sessionId = sessionIdOf(payload);
	if (!sessionId) return false;
	const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
	const recognized = recognizePhaseEntry(prompt, claudeLocalNames(cwdOf(payload), locations.home ?? homedir()), "claude");
	const entry = releasesRunBinding(prompt, recognized === "plan" ? "planner" : null) ? "plan" : recognized;
	let workspace: string | null = null;
	if (entry === "run") { try { workspace = realpathSync(cwdOf(payload)); } catch { /* no workspace, no token */ } }
	const line = phaseEntryLogLine(entry, workspace ? { token: randomUUID(), workspace } : undefined);
	return appendPhaseEntry(sessionId, line, locations.root ?? tmpdir(), locations);
}

function gatedOperation(payload: Record<string, unknown>): PhaseOperation | null {
	const toolName = String(payload.tool_name ?? "");
	if (toolName === "Skill") {
		const input = (payload.tool_input ?? {}) as { skill?: unknown };
		const skill = typeof input.skill === "string" ? packagedPhaseSkill(input.skill) : null;
		return skill ? { kind: "skill", skill } : null;
	}
	const mcp = GATED_MCP_TOOL.exec(toolName);
	return mcp ? { kind: "tool", name: mcp[1] as GatedTool } : null;
}

/**
 * PreToolUse for a gated tool: deny without a live run entry; for the two MCP
 * tools, otherwise write the admission the handler consumes. A Planner or
 * Brainstorm Skill call is never denied and leaves the entry store untouched.
 * Any other tool answers null and runs as configured.
 */
export function phaseEntryGateHookOutput(payload: Record<string, unknown>, locations: PhaseEntryLocations = {}): string | null {
	if (payload.hook_event_name !== "PreToolUse") return null;
	const operation = gatedOperation(payload);
	if (!operation) return null;
	if (operation.kind === "skill" && operation.skill !== "drive") return null;
	const root = locations.root ?? tmpdir();
	const sessionId = sessionIdOf(payload);
	let state: PhaseEntryState | null = null;
	try { state = readPhaseEntryState(sessionId, root, locations.read); } catch { /* an unreadable store refuses */ }
	const admission = admitPhaseOperation(operation, state);
	if (!admission.ok) return denyPreToolUse(phaseRefusalMessage(admission));
	if (operation.kind === "skill") return null;
	const toolUseId = typeof payload.tool_use_id === "string" ? payload.tool_use_id : "";
	let recorded = false;
	try {
		recorded = toolUseId !== ""
			&& (locations.append ?? appendPrivate)(admissionPath(toolUseId, root), cacheDir(root),
				`${JSON.stringify({ v: 2, operation: operation.name, session_id: sessionId, entry_token: state?.token ?? null })}\n`);
	} catch { /* an admission that could not be written refuses */ }
	if (recorded) return null;
	return denyPreToolUse(
		`${RUN_ENTRY_REQUIRED}: the admission for this ${operation.name} call could not be recorded; recovery: ${PHASE_ENTRY_RECOVERY[RUN_ENTRY_REQUIRED]}`,
	);
}

/**
 * Tool side: take the admission the hook wrote for this exact call. One use;
 * absent, unreadable or written for another operation all refuse. The hook may
 * run more than once for one call (two enabled copies of the plugin), so
 * repeated identical admissions count as one. A token admission is re-read
 * against the session's entry state, so a token revoked, replaced or ended
 * between the hook and the call no longer admits.
 */
export function consumePhaseAdmission(toolUseId: string, operation: GatedTool, root = tmpdir()): PhaseAdmissionGrant | false {
	if (!toolUseId || !ensurePrivateDir(cacheDir(root))) return false;
	const path = admissionPath(toolUseId, root);
	let text: string | undefined;
	try { text = readPrivate(path); } catch { return false; }
	if (text === undefined) return false;
	dropPrivate(path);
	const lines = text.split("\n").filter(Boolean);
	if (lines.length === 0) return false;
	const records: Array<{ session_id: string; entry_token: string | null }> = [];
	for (const line of lines) {
		let record: { v?: unknown; operation?: unknown; session_id?: unknown; entry_token?: unknown } | null;
		try { record = JSON.parse(line); } catch { return false; }
		if (record?.v !== 2 || record.operation !== operation || typeof record.session_id !== "string" || !record.session_id ||
			!(record.entry_token === null || (typeof record.entry_token === "string" && record.entry_token))) return false;
		records.push({ session_id: record.session_id, entry_token: record.entry_token });
	}
	const [first] = records;
	if (!records.every((record) => record.session_id === first.session_id && record.entry_token === first.entry_token)) return false;
	let state: PhaseEntryState | null = null;
	try { state = readPhaseEntryState(first.session_id, root); } catch { /* an unreadable store refuses */ }
	if (!state?.run_live || state.token !== first.entry_token) return false;
	return { entry_token: state.token, workspace: state.workspace };
}
