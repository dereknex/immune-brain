import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { laneWriteRefusal } from "../unattended/lane_workspace";
import {
	laneRuntimeContractRefusal,
	parseLaneInstruction,
	parseLaneOffers,
	parseMaxParallel,
	resolveLaneParallel,
} from "../unattended/batch_lanes";
import { parseFinalVerification } from "../unattended/batch_final_verification";
import {
	authorizeBatch,
	findExistingActiveBatch,
	findSettledBatchRecord,
	prepareBatchPreflight,
	readConfirmedBatchTopology,
	type BatchConfirmationFacts,
} from "../unattended/batch_preflight";
import { observeNativeParent, observeParentCompletion } from "../unattended/batch_git";
import { observeInitiative, observeSingleTask } from "../unattended/batch_plan";
import { isLaneBatchRecord } from "../unattended/batch_state";
import { readStaleBatchLookup } from "../unattended/batch_disposition";
import type { InitiativeObservationReader } from "../unattended/types";
import { resolveConfig } from "../config/layered_config";
import { parseReworkChoice, reworkExitLines, type ReworkChoice } from "../kernel/assurance_projection";
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
import {
	isPrivilegedOperation,
	NativeAuthorityError,
	type NativeConfirmationInput,
	type NativeConfirmationResult,
	type PrivilegedOperation,
} from "../host-core/interaction";
import { cacheDir, ensurePrivateDir, sessionHash } from "../host-core/private_file";
import { AntigravityRuntime } from "./kernel_ports";
import { ANTIGRAVITY_CACHE_DIR } from "./review_host";

const FILE_TOOLS = new Set(["write_file", "edit_file", "Write", "Edit", "MultiEdit"]);
const PRIVILEGED_MCP_TOOL =
	/^(?:mcp__.*immune-brain.*__|immune-brain__)?(start_unattended_batch|retire_stale_batch|request_authorization|approve_breaking_intent_revision|stop)$/;
/** The lazy `call_mcp_tool` form names its target operation bare, inside `args.ToolName`. */
const LAZY_PRIVILEGED_TOOL =
	/^(start_unattended_batch|retire_stale_batch|request_authorization|approve_breaking_intent_revision|stop)$/;
/** The lazy calls this Host may admit: Immune-Brain itself, under either registered server name. */
const IMMUNE_BRAIN_SERVERS = new Set(["immune-brain", "immune-brain_immune-brain"]);

export type GatedTool = "start_unattended_batch" | "retire_stale_batch";

function isGatedTool(operation: PrivilegedOperation): operation is GatedTool {
	return operation === "start_unattended_batch" || operation === "retire_stale_batch";
}

function extractPrivilegedCall(
	toolName: string,
	args: Record<string, unknown>,
): { operation: PrivilegedOperation; opArgs: Record<string, unknown> } | null {
	if (toolName === "call_mcp_tool") {
		if (!IMMUNE_BRAIN_SERVERS.has(String(args.ServerName ?? ""))) return null;
		const lazy = LAZY_PRIVILEGED_TOOL.exec(String(args.ToolName ?? ""));
		if (!lazy) return null;
		const raw = args.Arguments;
		const opArgs =
			typeof raw === "object" && raw !== null && !Array.isArray(raw)
				? (raw as Record<string, unknown>)
				: {};
		return { operation: lazy[1] as PrivilegedOperation, opArgs };
	}
	const direct = PRIVILEGED_MCP_TOOL.exec(toolName);
	if (!direct) return null;
	return { operation: direct[1] as PrivilegedOperation, opArgs: args };
}

export interface PhaseAdmissionGrant {
	entry_token: string | null;
	workspace: string | null;
	/** The Host conversation the admission belongs to; it becomes the runtime Hook session. */
	session_id?: string | null;
}

export interface NativeConfirmationGrant {
	request_id: string;
	conversation: string;
	step_idx: number;
	operation: PrivilegedOperation;
	workspace: string;
	task_id?: string;
	initiative_slug?: string;
	intent_revision?: number;
	intent_content_hash?: string;
	binding_digest?: string;
	plan_digest?: string;
	batch_id?: string;
	disposition_plan_digest?: string;
	rework_choice?: ReworkChoice;
	verifier_choice?: "accept_verifier_dispute" | "dismiss_verifier_dispute";
}

export interface PhaseEntryLocations {
	root?: string;
	home?: string;
	readInitiative?: InitiativeObservationReader;
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

export type PreToolUseHookDecision = {
	decision: "allow" | "deny" | "ask" | "force_ask";
	reason?: string;
};

function formatReworkChoiceSummary(choice: ReworkChoice): string {
	if (choice.exit === "grant_rounds") return `grant_rounds (rounds=${choice.rounds})`;
	if (choice.exit === "accept_residual_risk") return `accept_residual_risk (reason=${JSON.stringify(choice.reason)})`;
	return "replan";
}

/**
 * Formats a prepared privileged operation into the `reason` string shown by
 * Antigravity's native `PreToolUse` `force_ask` confirmation gate (ADR 0004).
 */
export function formatAntigravityConfirmationReason(
	input: NativeConfirmationInput,
	choices: {
		verifierChoice?: "accept_verifier_dispute" | "dismiss_verifier_dispute";
		reworkChoice?: ReworkChoice;
	} = {},
): string {
	if (input.operation === "retire_stale_batch") {
		const d = input.batchDisposition;
		const details = [
			`Operation: retire_stale_batch`,
			`Initiative: ${input.initiativeSlug}`,
			d ? `Batch: ${d.batch_id}` : null,
			d ? `Batch state: ${d.batch_state}` : null,
			d ? `Batch branch: ${d.batch_branch}` : null,
			d ? `Plan digest: ${d.plan_digest}` : null,
			d ? `Recorded child commits: ${d.recorded_commits}` : null,
			d
				? `Children (${d.children.length}):\n${d.children
						.map(
							(child) =>
								`  - ${child.task_id} (${child.slice_id}) [state: ${child.state}]${child.commit ? ` [commit: ${child.commit}]` : " [no commit]"}${child.lane_branch ? ` [lane: ${child.lane_branch}]` : ""}${child.kernel_lifecycle ? ` [Kernel run: ${child.kernel_lifecycle}]` : ""}`,
						)
						.join("\n")}`
				: null,
			"Retiring writes this record to the terminal superseded state. Child states, recorded commits and the batch branch are preserved as evidence; nothing is deleted and no batch trailer or approval is manufactured.",
		].filter(Boolean);
		return `Retire this stale batch record for ${input.initiativeSlug}?\n\n${details.join("\n")}`;
	}

	if (input.operation === "start_unattended_batch") {
		const b = input.batchDetails;
		if (b?.parent_final_verification) {
			const lines = [
				`Operation: start_unattended_batch (native Parent final verification; no batch run is started)`,
				`Initiative: ${input.initiativeSlug ?? b.initiative_slug}`,
				input.planDigest ? `Plan digest: ${input.planDigest}` : null,
				`Parent Tasks (${b.children.length}):\n${b.children.map((c) => `  - ${c.task_id} (${c.slice_id})`).join("\n")}`,
				`Final verification commands run in this workspace outside Host permission:\n${(b.final_verification ?? []).map((command) => `  - ${command}`).join("\n")}`,
			].filter(Boolean);
			return `Authorize this Parent final verification for ${input.initiativeSlug ?? b.initiative_slug}?\n\n${lines.join("\n")}`;
		}
		const details = [
			`Operation: start_unattended_batch`,
			`Initiative: ${input.initiativeSlug ?? b?.initiative_slug}`,
			b?.batch_branch ? `Batch branch: ${b.batch_branch}` : null,
			input.planDigest ? `Plan digest: ${input.planDigest}` : null,
			input.intentRevision !== undefined ? `TaskIntent revision: ${input.intentRevision}` : null,
			input.intentContentHash ? `TaskIntent content hash: ${input.intentContentHash}` : null,
			input.bindingDigest ? `Preparation digest: ${input.bindingDigest}` : null,
			b?.children ? `Ordered children (${b.children.length}):\n${b.children.map((c) => `  - ${c.task_id} (${c.slice_id}) [risk: ${c.risk ?? "unknown"}]`).join("\n")}` : null,
			b?.excluded && b.excluded.length > 0 ? `Excluded children (${b.excluded.length}):\n${b.excluded.map((e) => `  - ${e.task_id} (${e.slice_id}): ${e.reason}`).join("\n")}` : null,
			b?.budget ? `Budget: max_children=${b.budget.max_children}, qa_failure_limit=${b.budget.qa_failure_limit}` : null,
			b?.lane_mode ? `Lane mode: max_parallel=${b.lane_mode.max_parallel}` : null,
			b?.lane_mode ? `Parallel groups (${b.lane_mode.parallel_groups.length}):\n${b.lane_mode.parallel_groups.map((group) => `  - ${group.join(", ")}`).join("\n")}` : null,
			b?.lane_mode && b.lane_mode.serialized.length > 0 ? `Serialized by overlapping scope (${b.lane_mode.serialized.length}):\n${b.lane_mode.serialized.map((c) => `  - ${c.task_id} after ${c.overlaps_with.join(", ")}`).join("\n")}` : null,
			b?.final_verification ? `Final verification: ${b.final_verification.join("; ")}` : null,
			b?.re_confirmation_required?.length ? `Re-confirmation required: ${b.re_confirmation_required.join(", ")}` : null,
			b?.recovery ?? null,
		].filter(Boolean);
		return `Authorize this unattended batch run for ${input.initiativeSlug ?? b?.initiative_slug}?\n\n${details.join("\n")}`;
	}

	if (input.verifierDispute) {
		const dispute = input.verifierDispute;
		const lines = [
			`Operation: ${input.operation}`,
			`Task: ${input.taskId}`,
			`Proposed decision: ${choices.verifierChoice ?? "unspecified"}`,
			input.bindingDigest ? `Binding digest: ${input.bindingDigest}` : null,
			`Claim: ${dispute.claim}`,
			`Trigger: ${dispute.trigger}`,
			`Caller chain: ${dispute.caller_chain.join(" → ")}`,
			`Counter-path: ${dispute.counter_path}`,
		].filter(Boolean);
		return `Resolve this Review verifier dispute for ${input.taskId}?\n\n${lines.join("\n")}`;
	}

	if (input.reworkExits) {
		const lines = [
			`Operation: ${input.operation}`,
			`Task: ${input.taskId}`,
			`Proposed exit: ${choices.reworkChoice ? formatReworkChoiceSummary(choices.reworkChoice) : "unspecified"}`,
			input.risk ? `Risk: ${input.risk}` : null,
			input.bindingDigest ? `Binding digest: ${input.bindingDigest}` : null,
			...reworkExitLines(input.reworkExits),
		].filter(Boolean);
		return `Authorize this replan-boundary exit for ${input.taskId}?\n\n${lines.join("\n")}`;
	}

	const details = [
		`Operation: ${input.operation}`,
		`Task: ${input.taskId}`,
		input.risk ? `Risk: ${input.risk}` : null,
		input.intentRevision !== undefined ? `Intent revision: ${input.intentRevision}` : null,
		input.intentContentHash ? `Intent hash: ${input.intentContentHash}` : null,
		input.bindingDigest ? `Binding digest: ${input.bindingDigest}` : null,
		input.gitBaseNotice,
		input.reviewRetryNotice,
	].filter(Boolean);
	return `Authorize this exact Immune-Brain operation?\n\n${details.join("\n")}`;
}

function entryLogPath(sessionId: string, root: string): string {
	return join(cacheDir(root, ANTIGRAVITY_CACHE_DIR), `${sessionHash(sessionId)}.entry`);
}

function admissionPath(toolUseId: string, root: string): string {
	return join(cacheDir(root, ANTIGRAVITY_CACHE_DIR), `${sessionHash(toolUseId)}.admit`);
}

function parseAdmissionId(
	admissionId: string,
): { conversation: string; stepIdx: number; operation: PrivilegedOperation } | null {
	const match = /^(.+):(\d+):([a-z_]+)$/.exec(admissionId);
	if (!match) return null;
	const [, conversation, stepRaw, opRaw] = match;
	if (!conversation || !isPrivilegedOperation(opRaw)) return null;
	const stepIdx = Number(stepRaw);
	if (!Number.isSafeInteger(stepIdx) || stepIdx < 0) return null;
	return { conversation, stepIdx, operation: opRaw };
}

function confirmationPath(conversation: string, admissionId: string, root: string): string {
	return join(cacheDir(root, ANTIGRAVITY_CACHE_DIR), `${sessionHash(conversation)}.${sessionHash(admissionId)}.confirm`);
}

function dropPrivate(path: string): void {
	try {
		rmSync(path, { force: true });
	} catch {}
}

function dropConversationConfirmations(conversationId: string, root: string): void {
	if (!conversationId) return;
	const dir = cacheDir(root, ANTIGRAVITY_CACHE_DIR);
	if (!existsSync(dir)) return;
	const prefix = `${sessionHash(conversationId)}.`;
	try {
		for (const file of readdirSync(dir)) {
			if (file.startsWith(prefix) && file.endsWith(".confirm")) {
				dropPrivate(join(dir, file));
			}
		}
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
	const storeRoot = locations.root ?? tmpdir();
	dropConversationConfirmations(conversationId, storeRoot);
	const recognized = recognizePhaseEntry(prompt, antigravityLocalNames(cwd, locations.home ?? homedir()), "antigravity");
	const entry = releasesRunBinding(prompt, recognized === "plan" ? "planner" : null) ? "plan" : recognized;
	let workspace: string | null = null;
	if (entry === "run") {
		try {
			workspace = realpathSync(cwd);
		} catch {}
	}
	const line = phaseEntryLogLine(entry, workspace ? { token: randomUUID(), workspace } : undefined);
	return appendPhaseEntry(conversationId, line, storeRoot);
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

function writeConfirmationGrant(
	conversation: string,
	stepIdx: number,
	admissionId: string,
	workspace: string,
	input: NativeConfirmationInput,
	root: string,
	choices: {
		verifierChoice?: "accept_verifier_dispute" | "dismiss_verifier_dispute";
		reworkChoice?: ReworkChoice;
	} = {},
): string {
	const requestId = `antigravity-hook:${conversation}:${stepIdx}:${randomUUID()}`;
	const grant: NativeConfirmationGrant = {
		request_id: requestId,
		conversation,
		step_idx: stepIdx,
		operation: input.operation,
		workspace,
		...(input.taskId !== undefined ? { task_id: input.taskId } : {}),
		...(input.initiativeSlug !== undefined ? { initiative_slug: input.initiativeSlug } : {}),
		...(input.intentRevision !== undefined ? { intent_revision: input.intentRevision } : {}),
		...(input.intentContentHash !== undefined ? { intent_content_hash: input.intentContentHash } : {}),
		...(input.bindingDigest !== undefined ? { binding_digest: input.bindingDigest } : {}),
		...(input.planDigest !== undefined ? { plan_digest: input.planDigest } : {}),
		...(input.batchDisposition ? { batch_id: input.batchDisposition.batch_id, disposition_plan_digest: input.batchDisposition.plan_digest } : {}),
		...(choices.reworkChoice ? { rework_choice: choices.reworkChoice } : {}),
		...(choices.verifierChoice ? { verifier_choice: choices.verifierChoice } : {}),
	};
	ensurePrivateDir(cacheDir(root, ANTIGRAVITY_CACHE_DIR));
	writeFileSync(confirmationPath(conversation, admissionId, root), JSON.stringify(grant), { mode: 0o600 });
	return requestId;
}

/**
 * Single-use consumer for the native confirmation grant written when Antigravity's
 * `PreToolUse` hook returned `force_ask` (ADR 0004). Any missing, replayed,
 * uncorrelated, or post-confirmation drifted call fails closed.
 */
export async function consumeNativeConfirmation(
	input: NativeConfirmationInput,
	root = tmpdir(),
): Promise<NativeConfirmationResult> {
	if (input.signal?.aborted) {
		throw new NativeAuthorityError("user_cancelled", "Tool call was cancelled");
	}
	const parsedId = input.admissionId ? parseAdmissionId(input.admissionId) : null;
	if (!parsedId || !input.admissionId) {
		throw new NativeAuthorityError(
			"interaction_not_opened",
			"Antigravity PreToolUse native confirmation grant is missing (step correlation unavailable)",
		);
	}
	const path = confirmationPath(parsedId.conversation, input.admissionId, root);
	let grant: NativeConfirmationGrant;
	try {
		const raw = readFileSync(path, "utf8");
		dropPrivate(path);
		grant = JSON.parse(raw) as NativeConfirmationGrant;
	} catch {
		dropPrivate(path);
		throw new NativeAuthorityError(
			"interaction_not_opened",
			"Antigravity PreToolUse native confirmation grant is missing or already consumed",
		);
	}
	if (
		grant.conversation !== parsedId.conversation ||
		grant.step_idx !== parsedId.stepIdx ||
		grant.operation !== input.operation ||
		typeof grant.request_id !== "string" ||
		!grant.request_id
	) {
		throw new NativeAuthorityError("interaction_not_opened", "Antigravity PreToolUse confirmation grant does not match this operation");
	}
	let currentWorkspace: string | null = null;
	try {
		if (input.workspace) currentWorkspace = realpathSync(input.workspace);
	} catch {}
	if (!currentWorkspace || grant.workspace !== currentWorkspace) {
		throw new NativeAuthorityError("workspace_changed", "workspace changed after PreToolUse native confirmation");
	}
	if ((grant.task_id ?? undefined) !== (input.taskId ?? undefined) || (grant.initiative_slug ?? undefined) !== (input.initiativeSlug ?? undefined)) {
		throw new NativeAuthorityError("workspace_changed", "target task or initiative changed after PreToolUse native confirmation");
	}
	if (
		(grant.plan_digest ?? undefined) !== (input.planDigest ?? undefined) ||
		(grant.binding_digest ?? undefined) !== (input.bindingDigest ?? undefined) ||
		(grant.intent_revision ?? undefined) !== (input.intentRevision ?? undefined) ||
		(grant.intent_content_hash ?? undefined) !== (input.intentContentHash ?? undefined) ||
		(grant.batch_id ?? undefined) !== (input.batchDisposition?.batch_id ?? undefined) ||
		(grant.disposition_plan_digest ?? undefined) !== (input.batchDisposition?.plan_digest ?? undefined) ||
		Boolean(grant.verifier_choice) !== Boolean(input.verifierDispute) ||
		Boolean(grant.rework_choice) !== Boolean(input.reworkExits)
	) {
		throw new NativeAuthorityError("workspace_changed", "plan or authority binding changed after PreToolUse native confirmation");
	}
	return {
		decision: "accept",
		requestId: grant.request_id,
		...(grant.rework_choice ? { reworkChoice: grant.rework_choice } : {}),
		...(grant.verifier_choice ? { verifierChoice: grant.verifier_choice } : {}),
	};
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

export function antigravityPostToolUseHook(
	payload: AntigravityPostToolUsePayload,
	locations: PhaseEntryLocations = {},
): void {
	if (payload.stepIdx === undefined || !payload.conversationId) return;
	const call = extractPrivilegedCall(payload.toolCall.name, payload.toolCall.args ?? {});
	if (!call) return;
	const root = locations.root ?? tmpdir();
	const admissionId = `${payload.conversationId}:${payload.stepIdx}:${call.operation}`;
	dropPrivate(confirmationPath(payload.conversationId, admissionId, root));
	if (typeof payload.error === "string" && payload.error.length > 0 && isGatedTool(call.operation)) {
		dropPrivate(admissionPath(admissionId, root));
	}
}

type SyncPreToolUseEvaluation =
	| { done: true; result: PreToolUseHookDecision }
	| {
			done: false;
			call: { operation: PrivilegedOperation; opArgs: Record<string, unknown> };
			state: PhaseEntryState | null;
			root: string;
			cwd: string;
			stepIdx: number;
			admissionId: string;
	  };

function evaluatePreToolUseSync(
	payload: AntigravityPreToolUsePayload,
	locations: PhaseEntryLocations = {},
): SyncPreToolUseEvaluation {
	const toolName = payload.toolCall.name;
	const cwd = payload.workspacePaths?.[0] ?? process.cwd();

	// Lane write check
	if (FILE_TOOLS.has(toolName)) {
		const filePath = (payload.toolCall.args.Path ?? payload.toolCall.args.file_path ?? payload.toolCall.args.path) as string | undefined;
		const refusal = laneWriteRefusal(cwd, filePath);
		if (refusal) {
			return { done: true, result: { decision: "deny", reason: refusal } };
		}
	}

	const call = extractPrivilegedCall(toolName, payload.toolCall.args ?? {});
	if (!call) {
		return { done: true, result: { decision: "allow" } };
	}

	const root = locations.root ?? tmpdir();
	if (isGatedTool(call.operation)) {
		const state = readPhaseEntryState(payload.conversationId, root);
		const opName: PhaseOperation = { kind: "tool", name: call.operation };
		const admission = admitPhaseOperation(opName, state);
		if (!admission.ok) {
			return { done: true, result: { decision: "force_ask", reason: phaseRefusalMessage(admission) } };
		}
		if (payload.stepIdx === undefined) {
			return {
				done: true,
				result: { decision: "deny", reason: "Tool invocation identity (stepIdx) is missing; admission cannot be recorded" },
			};
		}
		const admissionId = `${payload.conversationId}:${payload.stepIdx}:${call.operation}`;
		const admitLine = JSON.stringify({
			operation: call.operation,
			token: state?.token,
			workspace: state?.workspace,
			conversation: payload.conversationId,
		});
		ensurePrivateDir(cacheDir(root, ANTIGRAVITY_CACHE_DIR));
		writeFileSync(admissionPath(admissionId, root), admitLine, { mode: 0o600 });
		return { done: false, call, state, root, cwd, stepIdx: payload.stepIdx, admissionId };
	}

	const taskId = typeof call.opArgs.task_id === "string" ? call.opArgs.task_id : "";
	if (!taskId || "native_decision" in call.opArgs || "entry_token" in call.opArgs) {
		return { done: true, result: { decision: "allow" } };
	}
	if (call.operation === "approve_breaking_intent_revision" && !call.opArgs.next_intent) {
		return { done: true, result: { decision: "allow" } };
	}
	if (payload.stepIdx === undefined) {
		return {
			done: true,
			result: { decision: "deny", reason: "Tool invocation identity (stepIdx) is missing; native confirmation cannot be correlated" },
		};
	}
	const admissionId = `${payload.conversationId}:${payload.stepIdx}:${call.operation}`;
	return { done: false, call, state: null, root, cwd, stepIdx: payload.stepIdx, admissionId };
}

export function antigravityPreToolUseHook(
	payload: AntigravityPreToolUsePayload,
	locations: PhaseEntryLocations = {},
): PreToolUseHookDecision {
	const sync = evaluatePreToolUseSync(payload, locations);
	return sync.done ? sync.result : { decision: "allow" };
}

async function prepareBatchConfirmation(
	conversationId: string,
	sync: Extract<SyncPreToolUseEvaluation, { done: false }>,
	locations: PhaseEntryLocations,
): Promise<PreToolUseHookDecision> {
	const { call, cwd, root, stepIdx, admissionId } = sync;
	const opArgs = call.opArgs;
	if (Object.hasOwn(opArgs, "lane_revision")) return { decision: "allow" };
	const initiative = typeof opArgs.initiative_slug === "string" ? opArgs.initiative_slug : "";
	const task = typeof opArgs.task_id === "string" ? opArgs.task_id : "";
	if (opArgs.stop !== undefined && typeof opArgs.stop !== "boolean") return { decision: "allow" };
	if (opArgs.stop === true) return { decision: "allow" };
	if (
		opArgs.executor_host !== undefined &&
		opArgs.executor_host !== "pi" &&
		opArgs.executor_host !== "claude-code" &&
		opArgs.executor_host !== "antigravity"
	) {
		return { decision: "allow" };
	}
	for (const key of ["executor_model", "executor_effort"]) {
		if (opArgs[key] !== undefined && (typeof opArgs[key] !== "string" || !opArgs[key])) {
			return { decision: "allow" };
		}
	}
	if (!!initiative === !!task) return { decision: "allow" };
	if ("native_decision" in opArgs || "entry_token" in opArgs) return { decision: "allow" };

	let workspaceRealpath: string;
	try {
		workspaceRealpath = realpathSync(cwd);
	} catch {
		return { decision: "allow" };
	}

	const initiativeSlug = task || initiative;
	const planSource = task ? ("single_task" as const) : undefined;
	const readInitiative = planSource === "single_task" ? observeSingleTask : locations.readInitiative ?? observeInitiative;

	let maxParallel: number | undefined;
	let finalVerification: string[] | undefined;
	try {
		const laneOffers = parseLaneOffers(opArgs.lane_offers);
		const laneInstruction = parseLaneInstruction(opArgs.lane_instruction);
		maxParallel = task ? 1 : resolveLaneParallel(cwd, initiativeSlug, parseMaxParallel(opArgs.max_parallel), laneOffers, laneInstruction);
		finalVerification =
			Array.isArray(opArgs.final_verification) && opArgs.final_verification.length === 0
				? undefined
				: parseFinalVerification(opArgs.final_verification);
	} catch {
		return { decision: "allow" };
	}

	if (planSource && !resolveConfig(cwd).lanes.valid) return { decision: "allow" };

	const existing = findExistingActiveBatch(cwd, initiativeSlug);
	if (existing && !existing.corrupt && !isLaneBatchRecord(existing.record)) return { decision: "allow" };
	const integrationBatch = existing && !existing.corrupt ? existing.record : existing ? null : findSettledBatchRecord(cwd, initiativeSlug);
	if (integrationBatch && (isLaneBatchRecord(integrationBatch) ? integrationBatch.plan_source : undefined) !== planSource) {
		return { decision: "allow" };
	}

	if (!planSource && !existing && integrationBatch && isLaneBatchRecord(integrationBatch) && integrationBatch.batch_state === "completed") {
		try {
			const confirmed = await readConfirmedBatchTopology(cwd, integrationBatch, locations.readInitiative);
			if (integrationBatch.final_verification_result?.passed === true) {
				const proof = await observeParentCompletion(
					cwd,
					initiativeSlug,
					confirmed.observation.tasks.map((child) => child.task_id),
				);
				if (proof.complete) return { decision: "allow" };
			}
		} catch {
			// Terminal history does not own a revised plan; continue to preflight.
		}
	}

	if (!planSource) {
		const nativeFacts = await observeNativeParent(cwd, initiativeSlug, locations.readInitiative);
		if (nativeFacts) {
			const recordedCommands = nativeFacts.native?.final_verification.results.map((result) => result.command);
			if (finalVerification && recordedCommands && JSON.stringify(finalVerification) !== JSON.stringify(recordedCommands)) {
				return { decision: "allow" };
			}
			const finalCommands = recordedCommands ?? finalVerification;
			if (
				["verify", "repair"].includes(nativeFacts.action) &&
				nativeFacts.proof.missing_task_ids.length === 0 &&
				finalCommands?.length &&
				!recordedCommands
			) {
				const confirmInput: NativeConfirmationInput = {
					operation: "start_unattended_batch",
					initiativeSlug,
					toolCallId: admissionId,
					planDigest: nativeFacts.plan_digest,
					batchDetails: {
						initiative_slug: initiativeSlug,
						batch_branch: "",
						children: nativeFacts.parent.tasks.map((child) => ({ task_id: child.task_id, slice_id: child.slice_id })),
						excluded: [],
						final_verification: finalCommands,
						parent_final_verification: {},
					},
				};
				writeConfirmationGrant(conversationId, stepIdx, admissionId, workspaceRealpath, confirmInput, root);
				return { decision: "force_ask", reason: formatAntigravityConfirmationReason(confirmInput) };
			}
			return { decision: "allow" };
		}
	}

	const now = new Date().toISOString();
	const preflight = await prepareBatchPreflight({
		root: cwd,
		initiative_slug: initiativeSlug,
		plan_source: planSource,
		now,
		readInitiative,
		max_parallel: maxParallel,
	});
	if (!preflight.ok) return { decision: "allow" };
	if (!preflight.projection.is_resuming && !planSource && !finalVerification?.length) return { decision: "allow" };
	if (maxParallel !== undefined && !preflight.projection.is_resuming && laneRuntimeContractRefusal(cwd)) {
		return { decision: "allow" };
	}

	const authorization = await authorizeBatch<BatchConfirmationFacts>({
		root: cwd,
		initiative_slug: initiativeSlug,
		now,
		projection: preflight.projection,
		readInitiative,
		nonce: "antigravity-pretooluse-probe",
		gate: async (facts) => ({ kind: "host_rejection", value: facts }),
		confirmationRef: () => "antigravity-pretooluse-probe",
	});
	if (authorization.outcome !== "host_rejection") {
		return { decision: "allow" };
	}

	const facts = authorization.value;
	const confirmInput: NativeConfirmationInput = {
		operation: "start_unattended_batch",
		initiativeSlug,
		toolCallId: admissionId,
		planDigest: preflight.projection.plan_digest,
		...(facts.preparation?.intent
			? {
					intentRevision: facts.preparation.intent.revision,
					intentContentHash: facts.preparation.intent.content_hash,
					bindingDigest: facts.preparation.digest,
				}
			: {}),
		batchDetails: {
			initiative_slug: facts.initiative_slug,
			batch_branch: facts.batch_branch,
			children: facts.children.map((child) => ({
				task_id: child.task_id,
				slice_id: child.slice_id,
				risk: child.risk,
			})),
			excluded: facts.excluded.map((child) => ({
				task_id: child.task_id,
				slice_id: child.slice_id,
				reason: child.reason,
			})),
			budget: facts.budget,
			...(finalVerification ? { final_verification: finalVerification } : {}),
			...(maxParallel !== undefined
				? {
						lane_mode: {
							max_parallel: maxParallel,
							parallel_groups: facts.parallel_groups,
							serialized: facts.scope_conflicts,
							...(finalVerification ? { final_verification: finalVerification } : {}),
						},
					}
				: {}),
			...(facts.reuse_blockers.length > 0
				? {
						re_confirmation_required: facts.reuse_blockers,
						recovery: "confirm to issue a fresh authorization bound to the current plan and HEAD",
					}
				: {}),
		},
	};
	writeConfirmationGrant(conversationId, stepIdx, admissionId, workspaceRealpath, confirmInput, root);
	return { decision: "force_ask", reason: formatAntigravityConfirmationReason(confirmInput) };
}

async function prepareRetireConfirmation(
	conversationId: string,
	sync: Extract<SyncPreToolUseEvaluation, { done: false }>,
): Promise<PreToolUseHookDecision> {
	const { call, state, cwd, root, stepIdx, admissionId } = sync;
	// ADR 0025: a live entry token stands in for the native gate on retire_stale_batch.
	if (state?.token) return { decision: "allow" };
	const initiativeSlug = typeof call.opArgs.initiative_slug === "string" ? call.opArgs.initiative_slug : "";
	if (!initiativeSlug || "native_decision" in call.opArgs || "entry_token" in call.opArgs) {
		return { decision: "allow" };
	}
	let workspaceRealpath: string;
	try {
		workspaceRealpath = realpathSync(cwd);
	} catch {
		return { decision: "allow" };
	}
	const lookup = readStaleBatchLookup(cwd, initiativeSlug);
	if (lookup.kind !== "retirable") return { decision: "allow" };
	const facts = lookup.facts;
	const confirmInput: NativeConfirmationInput = {
		operation: "retire_stale_batch",
		initiativeSlug,
		toolCallId: admissionId,
		batchDisposition: {
			batch_id: facts.batch_id,
			batch_state: facts.batch_state,
			batch_branch: facts.branch,
			plan_digest: facts.plan_digest,
			recorded_commits: facts.recorded_commits.length,
			children: facts.children.map((child) => ({
				task_id: child.task_id,
				slice_id: child.slice_id,
				state: child.state,
				commit: child.commit,
				lane_branch: child.lane_branch,
				kernel_lifecycle: child.kernel_lifecycle,
			})),
		},
	};
	writeConfirmationGrant(conversationId, stepIdx, admissionId, workspaceRealpath, confirmInput, root);
	return { decision: "force_ask", reason: formatAntigravityConfirmationReason(confirmInput) };
}

async function prepareTaskAuthorityConfirmation(
	conversationId: string,
	sync: Extract<SyncPreToolUseEvaluation, { done: false }>,
): Promise<PreToolUseHookDecision> {
	const { call, cwd, root, stepIdx, admissionId } = sync;
	const taskId = String(call.opArgs.task_id ?? "");
	if (!existsSync(join(cwd, ".imm"))) return { decision: "allow" };
	let workspaceRealpath: string;
	try {
		workspaceRealpath = realpathSync(cwd);
	} catch {
		return { decision: "allow" };
	}

	let captured: NativeConfirmationInput | null = null;
	const probeRuntime = new AntigravityRuntime({
		cwd,
		env: {},
		interactive: true,
		probeHost: () => ({ ok: true, version: "1.0.0", platform: process.platform }),
		requestConfirmation: async (input) => {
			captured = input;
			return { decision: "cancel", requestId: "antigravity-pretooluse-probe" };
		},
	});
	try {
		await probeRuntime.authorize(
			taskId,
			call.operation,
			{ sessionId: conversationId, toolCallId: admissionId, taskId, interactive: true },
			call.opArgs,
		);
	} catch {
		// Expected: either preconditions refused before the gate (`captured === null`)
		// or the cancelling probe rolled back any staged sidecar after capturing `input`.
	} finally {
		await probeRuntime.shutdown();
	}

	if (!captured) return { decision: "allow" };
	const confirmInput: NativeConfirmationInput = captured;

	let verifierChoice: "accept_verifier_dispute" | "dismiss_verifier_dispute" | undefined;
	if (confirmInput.verifierDispute) {
		const rawChoice = call.opArgs.choice;
		if (rawChoice !== "accept_verifier_dispute" && rawChoice !== "dismiss_verifier_dispute") {
			return {
				decision: "deny",
				reason: `request_authorization for ${taskId} requires choice ("accept_verifier_dispute" or "dismiss_verifier_dispute") to resolve the Review verifier dispute.\n\nClaim: ${confirmInput.verifierDispute.claim}\nCounter-path: ${confirmInput.verifierDispute.counter_path}`,
			};
		}
		verifierChoice = rawChoice;
	}

	let reworkChoice: ReworkChoice | undefined;
	if (confirmInput.reworkExits) {
		const parsed = parseReworkChoice(confirmInput.reworkExits, {
			...(call.opArgs.exit !== undefined ? { exit: call.opArgs.exit } : {}),
			...(call.opArgs.rounds !== undefined ? { rounds: call.opArgs.rounds } : {}),
			...(call.opArgs.reason !== undefined ? { reason: call.opArgs.reason } : {}),
		});
		if (!parsed) {
			const exits = ["grant_rounds", ...(confirmInput.reworkExits.accept_residual_risk ? ["accept_residual_risk"] : []), "replan"];
			return {
				decision: "deny",
				reason: `request_authorization for ${taskId} requires a valid exit (${exits.join(", ")}) to resolve the replan boundary.\n\n${reworkExitLines(confirmInput.reworkExits).join("\n")}`,
			};
		}
		reworkChoice = parsed;
	}

	writeConfirmationGrant(conversationId, stepIdx, admissionId, workspaceRealpath, confirmInput, root, {
		verifierChoice,
		reworkChoice,
	});
	return {
		decision: "force_ask",
		reason: formatAntigravityConfirmationReason(confirmInput, { verifierChoice, reworkChoice }),
	};
}

export async function antigravityPreToolUseHookAsync(
	payload: AntigravityPreToolUsePayload,
	locations: PhaseEntryLocations = {},
): Promise<PreToolUseHookDecision> {
	const sync = evaluatePreToolUseSync(payload, locations);
	if (sync.done) return sync.result;
	try {
		if (sync.call.operation === "start_unattended_batch") {
			return await prepareBatchConfirmation(payload.conversationId, sync, locations);
		}
		if (sync.call.operation === "retire_stale_batch") {
			return await prepareRetireConfirmation(payload.conversationId, sync);
		}
		return await prepareTaskAuthorityConfirmation(payload.conversationId, sync);
	} catch {
		return { decision: "allow" };
	}
}
