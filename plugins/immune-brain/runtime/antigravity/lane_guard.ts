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
import { cacheDir, ensurePrivateDir, sessionHash } from "./review_host";

const FILE_TOOLS = new Set(["write_file", "edit_file", "Write", "Edit", "MultiEdit"]);
const GATED_MCP_TOOL = /^(?:mcp__.*immune-brain.*__|immune-brain__)?(enroll|start_unattended_batch|retire_stale_batch|approve_breaking_intent_revision|stop)$/;

export type GatedTool = "enroll" | "start_unattended_batch" | "retire_stale_batch" | "approve_breaking_intent_revision" | "stop";

export interface PhaseAdmissionGrant {
	entry_token: string | null;
	workspace: string | null;
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
	return join(cacheDir(root), `${sessionHash(sessionId)}.entry`);
}

function admissionPath(toolUseId: string, root: string): string {
	return join(cacheDir(root), `${sessionHash(toolUseId)}.admit`);
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
	if (!ensurePrivateDir(cacheDir(root))) return null;
	try {
		const text = readFileSync(path, "utf8");
		return reducePhaseEntryLog(text);
	} catch {
		return null;
	}
}

function appendPhaseEntry(sessionId: string, line: string, root: string): boolean {
	const path = entryLogPath(sessionId, root);
	ensurePrivateDir(cacheDir(root));
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
		return { entry_token: parsed.token ?? null, workspace: parsed.workspace ?? null };
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

	// Gated operation check
	const match = GATED_MCP_TOOL.exec(toolName);
	if (match) {
		const gated = match[1] as GatedTool;
		const root = locations.root ?? tmpdir();
		const state = readPhaseEntryState(payload.conversationId, root);
		const opName: PhaseOperation = (gated === "enroll" || gated === "start_unattended_batch" || gated === "retire_stale_batch")
			? { kind: "tool", name: gated }
			: { kind: "tool", name: "enroll" };
		const admission = admitPhaseOperation(opName, state);
		if (!admission.ok) {
			return { decision: "force_ask", reason: phaseRefusalMessage(admission) };
		}
		const toolUseId = String(payload.stepIdx ?? payload.toolCall.name);
		const admitLine = JSON.stringify({ operation: gated, token: state?.token, workspace: state?.workspace });
		ensurePrivateDir(cacheDir(root));
		writeFileSync(admissionPath(toolUseId, root), admitLine, { mode: 0o600 });
		return { decision: "allow" };
	}

	return { decision: "allow" };
}
