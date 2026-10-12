// Claude Code hook decisions that are not Review observation. PreToolUse guard for batch Lanes: an Edit, Write, MultiEdit or
// NotebookEdit whose target resolves outside the Lane is denied before it
// runs, the same rule the Pi extension applies to `edit`/`write`. Bash is not
// intercepted. Outside a Lane the hook answers nothing and the tool runs as
// configured.
//
// Revision-owner guard: the same file-edit tools are denied inside the active
// claim's scope in a session whose latest entry is a plan entry.
//
// Phase entry gate: UserPromptSubmit records which literal prompt entered
// planning or execution; PreToolUse denies `enroll`, `start_unattended_batch`
// and the `imm-run` Skill without a live run entry, and otherwise leaves an
// admission the tool handler consumes by tool-use id. A model Skill call for
// `imm-planner` or `imm-brainstorm` is never denied; with no active claim it
// revokes the run entry.
import { lstatSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { laneWriteRefusal } from "../unattended/lane_workspace";
import { activeTaskNotice } from "../assurance/active_task_notice";
import { readAliasFile } from "../assurance/alias_file";
import {
	admitPhaseOperation,
	NO_PHASE_ENTRY,
	packagedPhaseSkill,
	phaseEntryLogLine,
	phaseRefusalMessage,
	PHASE_ENTRY_RECOVERY,
	recognizePhaseEntry,
	reducePhaseEntryLog,
	RUN_ENTRY_REQUIRED,
	type AliasReader,
	type PhaseEntry,
	type PhaseEntryState,
	type PhaseOperation,
} from "../assurance/phase_entry";
import { revisionOwnerEditRefusal } from "../assurance/revision_owner";
import { readActiveClaimTaskId } from "../unattended/batch_preflight";
import { appendPrivate, cacheDir, ensurePrivateDir, ownedByUs, readPrivate, sessionHash } from "./review_host";

const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const GATED_MCP_TOOL = /^mcp__.*immune-brain.*__(enroll|start_unattended_batch)$/;

export type GatedTool = "enroll" | "start_unattended_batch";

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

/** Project aliases first, then the user's, as Claude Code resolves commands. */
function claudeAliasReader(cwd: string, home: string): AliasReader {
	return (name) => {
		for (const dir of [join(cwd, ".claude", "commands"), join(home, ".claude", "commands")]) {
			const body = readAliasFile(join(dir, `${name}.md`));
			if (body !== null) return body;
		}
		return null;
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
function appendPhaseEntry(sessionId: string, entry: PhaseEntry | null, root: string, locations: PhaseEntryLocations): boolean {
	const path = entryLogPath(sessionId, root);
	let recorded = false;
	try { recorded = (locations.append ?? appendPrivate)(path, cacheDir(root), phaseEntryLogLine(entry)); } catch { /* an unwritten line drops the log */ }
	if (!recorded) dropPrivate(path);
	return recorded;
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
	const entry = recognizePhaseEntry(prompt, claudeAliasReader(cwdOf(payload), locations.home ?? homedir()));
	return appendPhaseEntry(sessionId, entry, locations.root ?? tmpdir(), locations);
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
 * PreToolUse revision-owner guard: a file-edit tool call inside the active
 * claim's scope is denied when this session's latest entry is a plan entry.
 * An unreadable entry store denies nothing; the guard is not an authority
 * boundary (Spec ceremony-trim-r647 D7). Shell commands are not intercepted.
 */
export function revisionOwnerHookOutput(payload: Record<string, unknown>, locations: PhaseEntryLocations = {}): string | null {
	if (payload.hook_event_name !== "PreToolUse" || !FILE_TOOLS.has(String(payload.tool_name))) return null;
	const sessionId = sessionIdOf(payload);
	if (!sessionId) return null;
	let state: PhaseEntryState | null = null;
	try { state = readPhaseEntryState(sessionId, locations.root ?? tmpdir(), locations.read); } catch { return null; }
	const input = (payload.tool_input ?? {}) as { file_path?: unknown; notebook_path?: unknown };
	const refusal = revisionOwnerEditRefusal(cwdOf(payload), input.file_path ?? input.notebook_path, state);
	return refusal ? denyPreToolUse(refusal) : null;
}

/**
 * PreToolUse for a gated tool: deny without a live run entry; for the two MCP
 * tools, otherwise write the admission the handler consumes. A Planner or
 * Brainstorm Skill call is never denied; with no active claim it records a plan
 * entry first, which revokes the run entry. Any other tool answers null and
 * runs as configured.
 */
export function phaseEntryGateHookOutput(payload: Record<string, unknown>, locations: PhaseEntryLocations = {}): string | null {
	if (payload.hook_event_name !== "PreToolUse") return null;
	const operation = gatedOperation(payload);
	if (!operation) return null;
	const root = locations.root ?? tmpdir();
	if (operation.kind === "skill" && operation.skill !== "imm-run") {
		let activeClaim = false;
		try { activeClaim = readActiveClaimTaskId(cwdOf(payload)) !== null; } catch { /* unreadable authority is no claim */ }
		const sessionId = sessionIdOf(payload);
		if (!activeClaim && sessionId) appendPhaseEntry(sessionId, "plan", root, locations);
		return null;
	}
	let state: PhaseEntryState | null = null;
	try { state = readPhaseEntryState(sessionIdOf(payload), root, locations.read); } catch { /* an unreadable store refuses */ }
	const admission = admitPhaseOperation(operation, state);
	if (!admission.ok) return denyPreToolUse(phaseRefusalMessage(admission));
	if (operation.kind === "skill") return null;
	const toolUseId = typeof payload.tool_use_id === "string" ? payload.tool_use_id : "";
	let recorded = false;
	try {
		recorded = toolUseId !== ""
			&& (locations.append ?? appendPrivate)(admissionPath(toolUseId, root), cacheDir(root), `${JSON.stringify({ v: 1, operation: operation.name })}\n`);
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
 * repeated identical admissions count as one.
 */
export function consumePhaseAdmission(toolUseId: string, operation: GatedTool, root = tmpdir()): boolean {
	if (!toolUseId || !ensurePrivateDir(cacheDir(root))) return false;
	const path = admissionPath(toolUseId, root);
	let text: string | undefined;
	try { text = readPrivate(path); } catch { return false; }
	if (text === undefined) return false;
	dropPrivate(path);
	const lines = text.split("\n").filter(Boolean);
	if (lines.length === 0) return false;
	return lines.every((line) => {
		try {
			const record = JSON.parse(line) as { v?: unknown; operation?: unknown } | null;
			return record?.v === 1 && record.operation === operation;
		} catch {
			return false;
		}
	});
}
