import { lstatSync, realpathSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { laneWriteRefusal } from "../unattended/lane_workspace";
import { releasesRunBinding } from "../assurance/run_continuation";
import { localSkillExists, readAliasFile } from "../assurance/alias_file";
import {
	admitPhaseOperation,
	entryRevocationLogLine,
	NO_PHASE_ENTRY,
	phaseEntryLogLine,
	phaseRefusalMessage,
	recognizePhaseEntry,
	reducePhaseEntryLog,
	type LocalNames,
	type EntryTokenRevocation,
	type PhaseEntryState,
	type PhaseOperation,
} from "../assurance/phase_entry";
import { cacheDir, ensurePrivateDir, sessionHash } from "../host-core/private_file";
import { ANTIGRAVITY_CACHE_DIR } from "./review_host";

const FILE_TOOLS = new Set(["write_file", "edit_file", "Write", "Edit", "MultiEdit"]);
const GATED_MCP_TOOL = /^(?:mcp__.*immune-brain.*__|immune-brain__)?(start_unattended_batch|retire_stale_batch)$/;
/** The lazy `call_mcp_tool` form names its target operation bare, inside `args.ToolName`. */
const LAZY_GATED_TOOL = /^(start_unattended_batch|retire_stale_batch)$/;
/** The lazy calls this Host may admit: Immune-Brain itself, under either registered server name. */
const IMMUNE_BRAIN_SERVERS = new Set(["immune-brain", "immune-brain_immune-brain"]);

export type GatedTool = "start_unattended_batch" | "retire_stale_batch";

/**
 * The gated operation one PreToolUse payload asks for, or null (D2). A direct
 * tool name is the operation; a lazy `call_mcp_tool` is one only when it targets
 * Immune-Brain, so every other lazy call stays an ordinary allow.
 */
function gatedOperation(toolName: string, args: Record<string, unknown>): GatedTool | null {
	const direct = GATED_MCP_TOOL.exec(toolName);
	if (direct) return direct[1] as GatedTool;
	if (toolName !== "call_mcp_tool" || !IMMUNE_BRAIN_SERVERS.has(String(args.ServerName ?? ""))) return null;
	const lazy = LAZY_GATED_TOOL.exec(String(args.ToolName ?? ""));
	return lazy ? (lazy[1] as GatedTool) : null;
}

export interface PhaseAdmissionGrant {
	entry_token: string | null;
	workspace: string | null;
	/** The Host conversation the admission belongs to; it becomes the runtime Hook session. */
	session_id?: string | null;
}

export interface PhaseEntryLocations {
	root?: string;
	home?: string;
}

export interface AntigravityPreInvocationPayload {
	invocationNum?: number;
	initialNumSteps?: number;
	conversationId: string;
	workspacePaths?: string[];
	transcriptPath?: string;
	artifactDirectoryPath?: string;
	modelName?: string;
	lastUserInput?: string;
}

export interface AntigravityPreToolUsePayload {
	toolCall: {
		name: string;
		args: Record<string, unknown>;
	};
	stepIdx?: number;
	conversationId: string;
	workspacePaths?: string[];
	transcriptPath?: string;
	artifactDirectoryPath?: string;
	modelName?: string;
	lastUserInput?: string;
}

export interface AntigravityPostToolUsePayload {
	toolCall: {
		name: string;
		args: Record<string, unknown>;
	};
	stepIdx?: number;
	error?: string;
	result?: string;
	conversationId: string;
	workspacePaths?: string[];
	transcriptPath?: string;
	artifactDirectoryPath?: string;
	modelName?: string;
	lastUserInput?: string;
}

export interface AntigravityStopPayload {
	executionNum?: number;
	terminationReason?: string;
	error?: string;
	fullyIdle?: boolean;
	conversationId: string;
	workspacePaths?: string[];
	transcriptPath?: string;
	artifactDirectoryPath?: string;
}

function entryLogPath(sessionId: string, root: string): string {
	return join(cacheDir(root, ANTIGRAVITY_CACHE_DIR), `${sessionHash(sessionId)}.entry`);
}

function admissionPath(toolUseId: string, root: string): string {
	return join(cacheDir(root, ANTIGRAVITY_CACHE_DIR), `${sessionHash(toolUseId)}.admit`);
}

function dropPrivate(path: string): void {
	try {
		rmSync(path, { force: true });
	} catch {}
}

export function antigravityLocalNames(cwd: string, home: string): LocalNames {
	const roots = [join(cwd, ".agents"), join(home, ".agents"), join(home, ".gemini/config")];
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

export function readPhaseEntryState(sessionId: string, root = tmpdir()): PhaseEntryState | null {
	if (!sessionId) return null;
	const path = entryLogPath(sessionId, root);
	try {
		lstatSync(path);
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT" ? NO_PHASE_ENTRY : null;
	}
	if (!ensurePrivateDir(cacheDir(root, ANTIGRAVITY_CACHE_DIR))) return null;
	try {
		const text = readFileSync(path, "utf8");
		return reducePhaseEntryLog(text);
	} catch {
		return null;
	}
}

function appendPhaseEntry(sessionId: string, line: string, root: string): boolean {
	const path = entryLogPath(sessionId, root);
	ensurePrivateDir(cacheDir(root, ANTIGRAVITY_CACHE_DIR));
	try {
		writeFileSync(path, line + "\n", { flag: "a", mode: 0o600 });
		return true;
	} catch {
		dropPrivate(path);
		return false;
	}
}

export function dropPhaseEntryLog(sessionId: string, root = tmpdir()): void {
	if (sessionId) dropPrivate(entryLogPath(sessionId, root));
}

export function revokeEntryToken(sessionId: string, reason: EntryTokenRevocation, root = tmpdir()): void {
	if (sessionId && readPhaseEntryState(sessionId, root)?.token) appendPhaseEntry(sessionId, entryRevocationLogLine(reason), root);
}

export function recordPhaseEntryPrompt(
	conversationId: string,
	prompt: string,
	cwd: string,
	locations: PhaseEntryLocations = {},
): boolean {
	if (!conversationId) return false;
	const recognized = recognizePhaseEntry(prompt, antigravityLocalNames(cwd, locations.home ?? homedir()), "antigravity");
	const entry = releasesRunBinding(prompt, recognized === "plan" ? "planner" : null) ? "plan" : recognized;
	let workspace: string | null = null;
	if (entry === "run") {
		try {
			workspace = realpathSync(cwd);
		} catch {}
	}
	const line = phaseEntryLogLine(entry, workspace ? { token: randomUUID(), workspace } : undefined);
	return appendPhaseEntry(conversationId, line, locations.root ?? tmpdir());
}

export function consumePhaseAdmission(toolCallId: string, operation: GatedTool, root = tmpdir()): PhaseAdmissionGrant | null {
	const path = admissionPath(toolCallId, root);
	try {
		const text = readFileSync(path, "utf8");
		dropPrivate(path);
		const parsed = JSON.parse(text);
		if (parsed.operation !== operation) return null;
		// D5: the admission is only live while its own conversation still holds the
		// entry token it was written under. A later /drive or /draw-up revokes it.
		if (typeof parsed.conversation !== "string" || !parsed.conversation) return null;
		const state = readPhaseEntryState(parsed.conversation, root);
		if (!state?.run_live || state.token !== parsed.token) return null;
		return { entry_token: parsed.token ?? null, workspace: parsed.workspace ?? null, session_id: parsed.conversation };
	} catch {
		return null;
	}
}

export function antigravityPreInvocationHook(
	payload: AntigravityPreInvocationPayload,
	locations: PhaseEntryLocations = {},
): { injectSteps?: unknown[]; terminationBehavior?: string } {
	const prompt = payload.lastUserInput ?? "";
	const cwd = payload.workspacePaths?.[0] ?? process.cwd();
	recordPhaseEntryPrompt(payload.conversationId, prompt, cwd, locations);
	return { injectSteps: [], terminationBehavior: "" };
}

export function antigravityPreToolUseHook(
	payload: AntigravityPreToolUsePayload,
	locations: PhaseEntryLocations = {},
): { decision: "allow" | "deny" | "ask" | "force_ask"; reason?: string } {
	const toolName = payload.toolCall.name;
	const cwd = payload.workspacePaths?.[0] ?? process.cwd();

	// Lane write check
	if (FILE_TOOLS.has(toolName)) {
		const filePath = (payload.toolCall.args.Path ?? payload.toolCall.args.file_path ?? payload.toolCall.args.path) as string | undefined;
		const refusal = laneWriteRefusal(cwd, filePath);
		if (refusal) {
			return { decision: "deny", reason: refusal };
		}
	}

	// Gated operation check: a direct Immune-Brain tool, or the matching lazy call.
	const gated = gatedOperation(toolName, payload.toolCall.args ?? {});
	if (gated) {
		const root = locations.root ?? tmpdir();
		const state = readPhaseEntryState(payload.conversationId, root);
		const opName: PhaseOperation = { kind: "tool", name: gated };
		const admission = admitPhaseOperation(opName, state);
		if (!admission.ok) {
			return { decision: "force_ask", reason: phaseRefusalMessage(admission) };
		}
		if (payload.stepIdx === undefined) {
			return { decision: "deny", reason: "Tool invocation identity (stepIdx) is missing; admission cannot be recorded" };
		}
		const toolUseId = `${payload.conversationId}:${payload.stepIdx}:${gated}`;
		const admitLine = JSON.stringify({ operation: gated, token: state?.token, workspace: state?.workspace, conversation: payload.conversationId });
		ensurePrivateDir(cacheDir(root, ANTIGRAVITY_CACHE_DIR));
		writeFileSync(admissionPath(toolUseId, root), admitLine, { mode: 0o600 });
		return { decision: "allow" };
	}

	return { decision: "allow" };
}
