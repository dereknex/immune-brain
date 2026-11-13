import { buildAssuranceSnapshot } from "../runtime/assurance/verdict_authority";
export { buildSnapshot, ensureReviewRevision as ensureTaskReviewRevision } from "../runtime/assurance/verdict_authority";
export type { SnapshotDescriptorInput } from "../runtime/assurance/verdict_authority";
import type { ConfirmationReferenceSource } from "../runtime/assurance/host_port";
// P3 Pi lifecycle extension: the only production route for Kernel canary
// assurance after enrollment.
//
// Surface:
//   1. `imm_kernel_canary` — foreground assurance and Review authority.
//   2. `imm_loop_action` — read-only projection of internal Loop actions.
//   3. `input` — Task Rail refresh; ordinary input stays host-native.
//
// Deterministic QA and native Review sequencing lives in
// `pi-canary-assurance-progression.ts`. The adapter owns Tool schemas, TUI
// authorization, Kernel capability creation, and translation of direct
// progression results. No detached assurance job, completion follow-up,
// progression path, Footer content, polling, or secondary authority state is
// created here. A bounded task-level Task Rail mirrors existing projections at
// host input and Tool lifecycle boundaries.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { PLUGIN_VERSION } from "../runtime/plugin_version";
import { registerPiRunContinuation } from "./pi-run-continuation";
import {
	listReviewRefs,
	reconcileReviewRefs,
	writeNativeReviewEvidence,
} from "./pi-canary-review-bundle";
import { localSkillExists, readAliasFile } from "../runtime/assurance/alias_file";
import { runDeterministicQa } from "../runtime/assurance/qa";
import {
	renderCanaryCall,
	renderCanaryResult,
} from "./pi-canary-assurance";
import {
	USER_ATTENTION_EVENT,
	clearTerminalTaskRailOnInput,
	loopResultDetails,
	notifyOnce,
	type UiContext,
	presentTaskOverviewOverlay,
	presentTaskRail,
	presentTaskRailResult,
	renderStructuredCall,
	renderStructuredResult,
	requestAuthorityDialog,
	resetInteractionPresentation,
	type TaskOverviewEntry,
	type TaskRailState,
	type UserAttentionEventV1,
} from "./pi-canary-interaction";
import { isToolFailureState, throwToolFailure, type AssuranceFailureDetails, type ToolFailureV1 } from "./pi-canary-tool-failure";
import { resolveUxLanguage, uxText } from "./ux-language";

/** Host-native UI language; see ux-language.ts. Resolved once per process. */
const UX_LANG = resolveUxLanguage();
import { taskDeliveryIdentity } from "../runtime/workspace_scope";
import {
	buildReviewPrompt,
	classifyReviewWorkload,
	deriveQaJobTimeoutMs,
	parseAssuranceVerdict,
	snapshotDigest,
	QA_JOB_TIMEOUT_SECONDS,
	REVIEW_DISPATCH_TIMEOUT_MS,
	REVIEW_PREPARATION_TIMEOUT_MS,
	REVIEW_TIMING_PROFILES,
	REVIEW_VERDICT_VALIDATION_TIMEOUT_MS,
	type AssuranceProgressionPorts,
	type HostContext,
	PiReviewHost,
} from "./pi-canary-assurance-progression";
import { PiRuntime, bindPiSelectedParent, type ToolMeta } from "./pi-host-runtime";
import type { InvocationToken } from "./pi-canary-invocations";
import {
	NativeAuthorityError,
	type NativeConfirmationPort,
	type NativeConfirmationInput,
	type NativeConfirmationResult,
} from "../runtime/host-core/interaction";
import { mapDialogSelection } from "./imm-unattended-batch";
import { findLaneRelayTarget } from "../runtime/unattended/lane_decision";

// The Pi adapter imports the host-neutral runtime modules statically, exactly
// as the Claude adapter does; the retired dynamic-import isolation layer is
// gone. The adapter-owned logic that used to live behind it (the
// record-aware intent read, the tracker terminal wrapper, the shared batch
// progression accessors) is defined below, next to the machinery it uses.
import { LITERAL_USER_ACTOR_ID } from "../runtime/kernel/actor_identity";
import {
	readTaskRecordRaw,
	withKernelStoreLockForTask,
} from "../runtime/kernel/storage";
import { inspectStorageLayout } from "../runtime/kernel/storage_paths";
import { migrateLegacyLayout } from "../runtime/kernel/storage_layout_migration";
import {
	parseProjectTaskIntent,
	parseTaskIntentV1,
	readTaskIntent,
	type ReadTaskIntentResult,
	withNextScope,
} from "../runtime/kernel/intent";
import { readBackendClaim, readTaskTombstone } from "../runtime/kernel/backend_claim";
import {
	parseReworkChoice,
	projectAssurance,
	reworkExitLines,
	type AssuranceProjectionResult,
} from "../runtime/kernel/assurance_projection";
import type { TaskIntentV1, TaskRecord } from "../runtime/kernel/types";
import type { RoleDelegationContext } from "../runtime/role_prompt_bridge";
import { buildLoopAction, buildLoopRoleDispatch } from "../runtime/loop_contract";
import { projectTaskStatus, reviewReworkFindings, type StatusProjectionResult } from "../runtime/assurance/coordinator";
import { laneEditRefusal } from "../runtime/unattended/lane_workspace";
import { activeTaskNotice } from "../runtime/assurance/active_task_notice";
import {
	admitPhaseOperation,
	applyPrompt,
	NO_PHASE_ENTRY,
	recognizePhaseEntry,
	type LocalNames,
	type PhaseAdmission,
	type PhaseEntryState,
} from "../runtime/assurance/phase_entry";

const LOOP_OWNERS = ["plan", "kernel", "brainstorm", "planner", "loop"] as const;
const LOOP_TARGETS = [
	"step",
	"test-repair",
	"pr-repair",
	"architecture-exploration",
	"advisory-review",
	"compounder",
	"lane-supply",
] as const;
const LOOP_DIRECT_ROLES = ["qa", "code-review", "ui-review"] as const;
const KERNEL_OPERATIONS = [
	"status",
	"freeze_artifacts",
	"record_finding",
	"resolve_finding",
	"refute_finding",
	"revise_intent",
	"complete",
] as const;

function literalUnion(values: readonly string[]) {
	return Type.Union(values.map((value) => Type.Literal(value)));
}

const TASK_INTENT_SCHEMA = Type.Object({
	contract: Type.Literal("assurance_kernel/task_intent/v1"),
	task_id: Type.String(),
	goal: Type.String(),
	acceptance: Type.Array(
		Type.Object({
			id: Type.String(),
			assertion: Type.String(),
			verification: Type.String(),
		}),
	),
	scope_hint: Type.Array(Type.String()),
	risk: Type.Union([
		Type.Literal("routine"),
		Type.Literal("material"),
		Type.Literal("critical"),
	]),
	revision: Type.Number(),
	owner: Type.Literal("user"),
});

export type { AssuranceRole } from "./pi-canary-assurance";
export type AuthorizeOperation =
	| "approve-breaking-intent-revision"
	| "resolve-user-decision"
	| "authorize-review-retry"
	| "authorize-rework"
	| "stop";

export interface CanaryWorkExtensionDependencies {
	buildAssurance?: typeof buildAssuranceSnapshot;
	runQa?: typeof runDeterministicQa;
	writeReviewEvidence?: typeof writeNativeReviewEvidence;
	advanceBeforeProjection?: () => Promise<void>;
	qaBeforeProjection?: () => Promise<void>;
	qaBeforeAuthorityCommit?: () => Promise<void>;
	qaOnAuthorityCommit?: () => void;
	qaAfterAuthorityCommit?: () => Promise<void>;
	authorizationBeforeRecordRead?: () => Promise<void>;
	authorizationAfterSidecarStage?: () => Promise<void>;
	qaJobTimeoutMs?: number;
	reviewJobTimeoutMs?: number;
	reviewSoftDeadlineMs?: number;
	reviewPreparationTimeoutMs?: number;
	reviewSpawnTimeoutMs?: number;
}

type LoopToolAction =
	| {
		op: "route";
		ownership: (typeof LOOP_OWNERS)[number];
		target: (typeof LOOP_TARGETS)[number];
		context?: Record<string, unknown>;
		scope_expansion?: boolean;
		kernel_operation?: (typeof KERNEL_OPERATIONS)[number];
	}
	| {
		op: "dispatch_role";
		role: (typeof LOOP_DIRECT_ROLES)[number];
		context: Record<string, unknown>;
	};

/**
 * The exact ports object the Pi Assurance progression runs on.
 *
 * This lived as an inline literal inside the anonymous default export, so no
 * test could ever obtain what production wires; every host adapter defect that
 * reached a published plugin lived in this object. Exporting the factory lets
 * the dual-host conformance suite drive the real thing.
 */
export function createPiAssuranceProgressionPorts(
	dependencies: CanaryWorkExtensionDependencies = {},
): AssuranceProgressionPorts {
	return {
		confirmationReference: piConfirmationReference,
		onReworkApplied: (ctx, taskId, count) => notifyHost(ctx, `rework-parked:${taskId}`, `rework applied: review parked for replan with ${count} finding(s)`, "warning"),
		projectTask: (root, taskId) => projectAssuranceForTask(root, taskId),
		readTaskRecord: async (root, taskId) => readTaskRecordRaw(root, taskId),
		readTaskIntent: async (root, taskId) => readTaskIntentForRecord(root, taskId),
		runQa: (snapshot, descriptors, options) =>
			(dependencies.runQa ?? runDeterministicQa)(snapshot, descriptors, options),
		writeReviewEvidence: (input) =>
			(dependencies.writeReviewEvidence ?? writeNativeReviewEvidence)(input),
		applyOrdinaryOperation: async (ctx, input) => {
			const runtime = await getSharedPiProgression();
			return runtime.executeOrdinary(ctx, input);
		},
		advanceBeforeProjection: dependencies.advanceBeforeProjection,
		qaBeforeProjection: dependencies.qaBeforeProjection,
		qaBeforeAuthorityCommit: dependencies.qaBeforeAuthorityCommit,
		qaOnAuthorityCommit: dependencies.qaOnAuthorityCommit,
		qaAfterAuthorityCommit: dependencies.qaAfterAuthorityCommit,
		qaJobTimeoutMs: dependencies.qaJobTimeoutMs,
		...(dependencies.buildAssurance ? { authorityOverrides: { buildAssurance: dependencies.buildAssurance } } : {}),
	} satisfies AssuranceProgressionPorts;
}

const GLOBAL_PI_PROGRESSION_KEY = Symbol.for("immune_brain.pi_assurance_progression");

/**
 * The shared session progression the batch adapter advances children through.
 * The work extension publishes the instance at load; this accessor is the
 * lazy fallback that builds one from the production ports when no extension
 * factory has run (tests, direct batch drives). Both paths publish under the
 * same global key, so a batch Review reservation and the session's
 * submit_review always share one progression instance.
 */
export async function getSharedPiProgression(): Promise<PiRuntime> {
	let runtime = (globalThis as any)[GLOBAL_PI_PROGRESSION_KEY] as PiRuntime | undefined;
	if (!runtime) {
		runtime = new PiRuntime({ cwd: process.cwd(), ports: { ...createPiAssuranceProgressionPorts() } });
		(globalThis as any)[GLOBAL_PI_PROGRESSION_KEY] = runtime;
	}
	return runtime;
}

/**
 * Advance one task through the shared session progression and translate the
 * progression result into the batch runner's advance report shape.
 */
export async function advancePiTask(root: string, taskId: string): Promise<any> {
	const runtime = await getSharedPiProgression();
	runtime.bindWorkspace(root);
	const result = await runtime.advance(taskId);
	const facts = { diagnostics: (result as any).diagnostics, environment_failure: (result as any).environment_failure, recovery: (result as any).recovery };
	if (result.state === "completed") return { state: "completed", ...facts };
	if (result.state === "stopped") return { state: "stopped", ...facts };
	if (result.state === "rework") return { state: "rework", operation: (result as any).operation, summary: (result as any).summary, ...facts };
	if (result.state === "review_ready") return { state: "review_ready", operation_id: (result as any).operation_id, agent_params: (result as any).agent_params, review_command: (result as any).review_command, review_profile: (result as any).review_profile, ...facts };
	if (result.state === "review_preparation_failed") return { state: result.state, operation: (result as any).operation, operation_id: (result as any).operation_id, reason: (result as any).reason, code: (result as any).code, recovery_action: (result as any).recovery_action, ...facts };
	if (result.state === "blocked") return { state: "blocked", reason: (result as any).reason, ...facts };
	return { state: "failed", reason: (result as { reason?: string }).reason ?? "advance failed", ...facts };
}

const GLOBAL_PI_PHASE_ENTRY_KEY = Symbol.for("immune_brain.pi_phase_entry");

type PhaseEntryContext = { cwd?: string; sessionManager?: { getSessionId?: () => unknown } } | undefined;

// Pi loads each extension file as its own module graph, so the entry state
// lives under a global key that every copy of this module shares. It is
// process memory: a resumed session starts without an entry and refuses.
function piPhaseEntries(): Map<string, PhaseEntryState> {
	const holder = globalThis as unknown as Record<symbol, Map<string, PhaseEntryState> | undefined>;
	return holder[GLOBAL_PI_PHASE_ENTRY_KEY] ??= new Map();
}

function piSessionId(ctx: PhaseEntryContext): string {
	try {
		const id = ctx?.sessionManager?.getSessionId?.();
		return typeof id === "string" ? id : "";
	} catch {
		return "";
	}
}

/** Prompt templates and skills in the order Pi resolves them: the user's, then the project's. */
function piLocalNames(cwd: string): LocalNames {
	const roots = [process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), join(cwd, ".pi")];
	return {
		alias: (name) => {
			for (const root of roots) {
				const body = readAliasFile(join(root, "prompts", `${name}.md`));
				if (body !== null) return body;
			}
			return null;
		},
		skill: (name) => roots.some((root) => localSkillExists(join(root, "skills"), name)),
	};
}

function piWorkspace(cwd: string | undefined): string | null {
	try { return realpathSync(cwd ?? process.cwd()); } catch { return null; }
}

/**
 * One Host input: record whether this literal prompt entered a phase. A run
 * entry mints the session's entry token bound to the workspace realpath (ADR
 * 0025). Input an extension injected is never the user's and leaves the entry
 * state untouched.
 */
export function recordPiPhaseInput(event: { text?: unknown; source?: unknown }, ctx: PhaseEntryContext): void {
	if (event.source === "extension") return;
	const sessionId = piSessionId(ctx);
	if (!sessionId) return;
	const entries = piPhaseEntries();
	const text = typeof event.text === "string" ? event.text : "";
	const entry = recognizePhaseEntry(text, piLocalNames(ctx?.cwd ?? process.cwd()), "pi");
	const workspace = entry === "run" ? piWorkspace(ctx?.cwd) : null;
	entries.set(sessionId, applyPrompt(entries.get(sessionId) ?? NO_PHASE_ENTRY, entry, workspace ? { token: randomUUID(), workspace } : undefined));
}

/**
 * The session's entry and its token end: at session shutdown, a pause, or when
 * the bound run is terminal. The next authority operation needs a new literal entry.
 */
export function revokePiPhaseEntry(sessionId: string): void {
	if (sessionId) piPhaseEntries().delete(sessionId);
}

/**
 * The phase entry gate for a Pi tool, checked before any preparation or
 * authority dialog. A session without an identity refuses, and a live token
 * bound to another workspace refuses rather than falling back to a dialog.
 */
export function piRunEntryRefusal(
	operation: "start_unattended_batch" | "retire_stale_batch",
	ctx: PhaseEntryContext,
): Extract<PhaseAdmission, { ok: false }> | null {
	const sessionId = piSessionId(ctx);
	let state = sessionId ? piPhaseEntries().get(sessionId) ?? NO_PHASE_ENTRY : null;
	if (state?.token && state.workspace !== piWorkspace(ctx?.cwd)) state = NO_PHASE_ENTRY;
	const admission = admitPhaseOperation({ kind: "tool", name: operation }, state);
	return admission.ok ? null : admission;
}

/** The live entry token this session's literal run entry minted for this workspace, or null. */
export function piEntryToken(ctx: PhaseEntryContext): string | null {
	const sessionId = piSessionId(ctx);
	const state = sessionId ? piPhaseEntries().get(sessionId) : undefined;
	return state?.run_live && state.token && state.workspace === piWorkspace(ctx?.cwd) ? state.token : null;
}

export interface ActiveAuthorizeCall {
	ctx: ExtensionContext;
	invocation?: InvocationToken;
	startGen?: number;
	derivedOperation?: AuthorizeOperation;
}

export interface PiConfirmationHooks {
	resolveCall?: (toolCallId?: string) => ActiveAuthorizeCall | undefined;
	isSessionValid?: (startGen?: number, invocation?: InvocationToken) => boolean;
	onAfterSidecarStage?: () => Promise<void>;
}

export function createPiNativeConfirmation(
	pi: ExtensionAPI,
	getCtx: () => ExtensionContext | undefined,
	hooks: PiConfirmationHooks = {},
): NativeConfirmationPort {
	return async (input: NativeConfirmationInput): Promise<NativeConfirmationResult> => {
		const activeCall = hooks.resolveCall?.(input.toolCallId);
		const ctx = activeCall?.ctx ?? getCtx();
		if (!ctx || ctx.mode !== "tui") {
			throw new NativeAuthorityError("unsupported_host", "interactive MCP elicitation is unavailable");
		}
		if (input.signal?.aborted || ctx.signal?.aborted) {
			throw new NativeAuthorityError("user_cancelled", "Tool call was cancelled");
		}
		const signal = input.signal && ctx.signal
			? AbortSignal.any([input.signal, ctx.signal])
			: input.signal ?? ctx.signal;
		const runDialog = async <T>(fn: () => Promise<T>): Promise<T> => {
			try {
				return await fn();
			} catch (error) {
				const aborted = Boolean(
					input.signal?.aborted ||
					ctx.signal?.aborted ||
					(error instanceof Error && error.name === "AbortError"),
				);
				if (input.operation === "stop" && !aborted) throw error;
				throw new NativeAuthorityError("user_cancelled", "confirmation aborted");
			}
		};
		const assertConfirmStillValid = (): void => {
			if (input.signal?.aborted || ctx.signal?.aborted) {
				throw new NativeAuthorityError("user_cancelled", "Tool call was cancelled");
			}
			if (hooks.isSessionValid && !hooks.isSessionValid(activeCall?.startGen, activeCall?.invocation)) {
				throw new NativeAuthorityError("interaction_not_opened", "session changed; confirmation discarded");
			}
		};
		const requestId = randomUUID();
		const taskId = input.taskId ?? input.initiativeSlug ?? "";

		if (input.reworkExits) {
			const reworkExits = input.reworkExits;
			const opName = "authorize-rework";
			const dialogSummary = [
				`Task: ${taskId}`,
				`Decision: ${opName}`,
			].join("\n");
			const dialogDetails = [
				`Operation: ${opName}`,
				...(reworkExitLines(reworkExits)),
			].join("\n");

			presentTaskRail(ctx, {
				task_id: taskId,
				state: "Approval required",
				result: uxText(UX_LANG, `${opName} requires your confirmation`, `${opName} 需要您的确认`),
				next: uxText(UX_LANG, `Decide ${opName}`, `请决策 ${opName}`),
			});
			const attention = {
				attention_id: randomUUID(),
				task_id: taskId,
				reason: "review_authorization" as const,
				label: uxText(UX_LANG, `${opName} approval required`, `${opName} 待您批准`),
			};
			const actions = [
				{ value: "grant_rounds", label: uxText(UX_LANG, "Grant more Review rounds", "追加 Review 轮次"), description: uxText(UX_LANG, `Grant ${reworkExits.grant_rounds.min}-${reworkExits.grant_rounds.max} further rounds`, `追加 ${reworkExits.grant_rounds.min}-${reworkExits.grant_rounds.max} 轮`) },
				...(reworkExits.accept_residual_risk
					? [{ value: "accept_residual_risk", label: uxText(UX_LANG, "Accept residual risk", "接受残余风险"), description: uxText(UX_LANG, "Accept the open Review findings with a reason", "附理由接受未决 Review 发现") }]
					: []),
				{ value: "replan", label: uxText(UX_LANG, "Replan", "重新规划"), description: uxText(UX_LANG, "Revise the Intent instead", "改为修订 Intent") },
				{ value: "cancel", label: uxText(UX_LANG, "Cancel", "取消"), description: uxText(UX_LANG, "Leave managed authority unchanged", "保持托管权限状态不变") },
			];
			const selected = await runDialog(() => requestAuthorityDialog(pi, ctx, attention, {
				title: uxText(UX_LANG, `Authorize ${opName}?`, `是否批准 ${opName}？`),
				summary: dialogSummary,
				details: dialogDetails,
				signal,
				actions,
			}));
			if (selected === "grant_rounds" || selected === "accept_residual_risk" || selected === "replan") {
				const raw: Record<string, unknown> = { exit: selected };
				if (selected === "grant_rounds") {
					const text = await runDialog(() => ctx.ui.input(
						uxText(UX_LANG, `Further Review rounds (${reworkExits.grant_rounds.min}-${reworkExits.grant_rounds.max})`, `追加 Review 轮次(${reworkExits.grant_rounds.min}-${reworkExits.grant_rounds.max})`),
						String(reworkExits.grant_rounds.min),
						{ signal },
					));
					if (text !== undefined && text.trim()) raw.rounds = Number(text.trim());
					if (text === undefined) raw.exit = "cancelled";
				} else if (selected === "accept_residual_risk") {
					const text = await runDialog(() => ctx.ui.input(uxText(UX_LANG, "Reason for accepting residual risk", "接受残余风险的理由"), "", { signal }));
					if (text === undefined) raw.exit = "cancelled";
					else raw.reason = text;
				}
				const reworkChoice = raw.exit === "cancelled" ? undefined : (parseReworkChoice(reworkExits, raw) ?? undefined);
				if (reworkChoice) {
					assertConfirmStillValid();
					return { decision: "accept", requestId, reworkChoice };
				}
				if (raw.exit !== "cancelled") {
					notifyOnce(ctx, `authorization-exit:${taskId}`, `authorize ${opName}: the chosen exit was not valid; nothing applied`, "warning");
				}
			}
			return { decision: "cancel", requestId };
		}

		if (input.verifierDispute) {
			const dispute = input.verifierDispute;
			const opName = "resolve-user-decision";
			const dialogSummary = [
				`Task: ${taskId}`,
				`Decision: ${opName}`,
			].join("\n");
			const dialogDetails = [
				`Operation: ${opName}`,
				`Claim: ${dispute.claim}`,
				`Trigger: ${dispute.trigger}`,
				`Caller chain: ${dispute.caller_chain.join(" → ")}`,
				`Counter-path: ${dispute.counter_path}`,
			].join("\n");

			presentTaskRail(ctx, {
				task_id: taskId,
				state: "Approval required",
				result: uxText(UX_LANG, `${opName} requires your confirmation`, `${opName} 需要您的确认`),
				next: uxText(UX_LANG, `Decide ${opName}`, `请决策 ${opName}`),
			});
			const attention = {
				attention_id: randomUUID(),
				task_id: taskId,
				reason: "review_authorization" as const,
				label: uxText(UX_LANG, `${opName} approval required`, `${opName} 待您批准`),
			};
			const actions = [
				{ value: "accept_verifier_dispute", label: uxText(UX_LANG, "Accept finding as rework", "接受发现并返工"), description: uxText(UX_LANG, "Project the finding to the Executor", "将该发现交给执行者") },
				{ value: "dismiss_verifier_dispute", label: uxText(UX_LANG, "Dismiss and review again", "驳回并重新审查"), description: uxText(UX_LANG, "Request a fresh Review", "请求新的 Review") },
				{ value: "cancel", label: uxText(UX_LANG, "Cancel", "取消"), description: uxText(UX_LANG, "Leave managed authority unchanged", "保持托管权限状态不变") },
			];
			const selected = await runDialog(() => requestAuthorityDialog(pi, ctx, attention, {
				title: uxText(UX_LANG, `Authorize ${opName}?`, `是否批准 ${opName}？`),
				summary: dialogSummary,
				details: dialogDetails,
				signal,
				actions,
			}));
			if (selected === "accept_verifier_dispute" || selected === "dismiss_verifier_dispute") {
				assertConfirmStillValid();
				return { decision: "accept", requestId, verifierChoice: selected };
			}
			return { decision: "cancel", requestId };
		}

		if (input.batchDetails) {
			const b = input.batchDetails;
			const isParent = b.parent_final_verification !== undefined;
			const title = isParent
				? `Authorize Parent Final Verification: ${b.initiative_slug}`
				: `Authorize Unattended Batch: ${b.initiative_slug}`;
			const summary = isParent
				? [
					`Initiative: ${b.initiative_slug}`,
					`Plan digest: ${input.planDigest ?? ""}`,
					"No batch run is started.",
					"Final verification commands run in this workspace outside Host permission:",
					...(b.final_verification ?? []).map((cmd) => `  - ${cmd}`),
				].join("\n")
				: [
					`Initiative: ${b.initiative_slug}`,
					`Batch branch: ${b.batch_branch}`,
					`Plan digest: ${input.planDigest ?? ""}`,
					...(input.intentRevision ? [`TaskIntent revision: ${input.intentRevision}`, `TaskIntent content hash: ${input.intentContentHash ?? ""}`, `Preparation digest: ${input.bindingDigest ?? ""}`] : []),
					...(b.budget ? [`Budget: max_children=${b.budget.max_children}, qa_failure_limit=${b.budget.qa_failure_limit}`] : []),
					...(b.lane_mode ? [`Lane mode: max_parallel=${b.lane_mode.max_parallel}`] : []),
					...(b.final_verification ? [`Final verification: ${b.final_verification.join("; ")}`] : []),
				].join("\n");
			const details = isParent
				? `Parent Tasks (${b.children.length}):\n${b.children.map((c) => `  - ${c.task_id} (${c.slice_id})`).join("\n")}`
				: [
					`Ordered children (${b.children.length}):\n${b.children.map((c) => `  - ${c.task_id} (${c.slice_id}) [risk: ${c.risk ?? "unknown"}]`).join("\n")}`,
					...(b.excluded.length > 0 ? [`\nExcluded children:\n${b.excluded.map((c) => `  - ${c.task_id} (${c.slice_id}): ${c.reason}`).join("\n")}`] : []),
					...(b.lane_mode ? [
						`\nParallel groups (${b.lane_mode.parallel_groups.length}):\n${b.lane_mode.parallel_groups.map((g) => `  - ${g.join(", ")}`).join("\n")}`,
						...(b.lane_mode.serialized.length > 0 ? [`\nSerialized by overlapping scope:\n${b.lane_mode.serialized.map((c) => `  - ${c.task_id} after ${c.overlaps_with.join(", ")}`).join("\n")}`] : []),
					] : []),
					...(b.re_confirmation_required?.length ? [`\nRe-confirmation required: ${b.re_confirmation_required.join(", ")}.\nRecovery: confirm to issue a fresh authorization bound to the current plan and HEAD.`] : []),
				].join("\n");

			presentTaskRail(ctx, {
				task_id: b.initiative_slug,
				state: "Approval required",
				result: title,
				next: "Review batch plan evidence",
			});
			const selected = await requestAuthorityDialog(
				pi,
				ctx,
				{
					attention_id: randomUUID(),
					task_id: b.initiative_slug,
					reason: "enrollment",
					label: title,
				},
				{
					title,
					summary,
					details,
					signal: ctx.signal,
					actions: [
						{ value: "confirm", label: "Authorize batch run", description: "Start the unattended Lane batch run" },
						{ value: "decline", label: "Decline batch", description: "Reject this batch authorization; repository and authority stay unchanged" },
						{ value: "cancel", label: "Cancel", description: "Leave repository and authority unchanged" },
					],
				},
			);
			return { decision: mapDialogSelection(selected), requestId };
		}

		if (input.batchDisposition) {
			const d = input.batchDisposition;
			const title = `Retire Stale Batch Record: ${input.initiativeSlug ?? taskId}`;
			const summary = [
				`Initiative: ${input.initiativeSlug ?? taskId}`,
				`Batch ID: ${d.batch_id}`,
				`State: ${d.batch_state}`,
				`Batch branch: ${d.batch_branch}`,
				`Plan digest: ${d.plan_digest}`,
				`Recorded commits: ${d.recorded_commits}`,
			].join("\n");
			const details = `Children (${d.children.length}):\n${d.children.map((c) => `  - ${c.task_id} (${c.slice_id}): state=${c.state}, commit=${c.commit ?? "none"}, lane=${c.lane_branch ?? "none"}, lifecycle=${c.kernel_lifecycle ?? "none"}`).join("\n")}`;

			presentTaskRail(ctx, {
				task_id: input.initiativeSlug ?? taskId,
				state: "Approval required",
				result: title,
				next: "Review batch record evidence",
			});
			const selected = await requestAuthorityDialog(
				pi,
				ctx,
				{
					attention_id: randomUUID(),
					task_id: input.initiativeSlug ?? taskId,
					reason: "enrollment",
					label: title,
				},
				{
					title,
					summary,
					details,
					signal: ctx.signal,
					actions: [
						{ value: "confirm", label: "Retire batch record", description: "Write the terminal superseded state and its report" },
						{ value: "decline", label: "Keep batch parked", description: "Leave the batch record and its authorization unchanged" },
						{ value: "cancel", label: "Cancel", description: "Leave repository and authority unchanged" },
					],
				},
			);
			return { decision: mapDialogSelection(selected), requestId };
		}

		if (input.operation === "approve_breaking_intent_revision") {
			const targetRoot = input.workspace ?? findLaneRelayTarget(ctx.cwd, taskId)?.lane_path ?? ctx.cwd;
			const priorRecord = await readTaskRecordRaw(targetRoot, taskId);
			const priorIntent = priorRecord.record
				? { intent: priorRecord.record.intent_snapshot, intent_ref: priorRecord.record.intent_ref }
				: await readTaskIntentForRecord(targetRoot, taskId);
			let nextIntent: TaskIntentV1 | undefined;
			try {
				const sidecar = join(targetRoot, priorIntent.intent_ref.path);
				nextIntent = parseProjectTaskIntent(targetRoot, JSON.parse(readFileSync(sidecar, "utf8")));
			} catch {}
			const intentDelta = nextIntent
				? [
						`Risk: ${priorIntent.intent.risk} -> ${nextIntent.risk}`,
						`Goal: ${priorIntent.intent.goal} -> ${nextIntent.goal}`,
						`Scope added: ${nextIntent.scope_hint.filter((path: string) => !priorIntent.intent.scope_hint.includes(path)).join(", ") || "none"}`,
						`Scope removed: ${priorIntent.intent.scope_hint.filter((path: string) => !nextIntent.scope_hint.includes(path)).join(", ") || "none"}`,
						`Acceptance added: ${nextIntent.acceptance.filter((item: { id: string }) => !priorIntent.intent.acceptance.some((prior: { id: string }) => prior.id === item.id)).map((item: { id: string }) => item.id).join(", ") || "none"}`,
						`Acceptance removed: ${priorIntent.intent.acceptance.filter((item: { id: string }) => !nextIntent.acceptance.some((next: { id: string }) => next.id === item.id)).map((item: { id: string }) => item.id).join(", ") || "none"}`,
						`Acceptance changed: ${nextIntent.acceptance.filter((item: { id: string; assertion: string; verification: string }) => { const prior = priorIntent.intent.acceptance.find((candidate: { id: string }) => candidate.id === item.id); return prior && (prior.assertion !== item.assertion || prior.verification !== item.verification); }).map((item: { id: string }) => item.id).join(", ") || "none"}`,
					]
				: [];
			const digestMatch = input.bindingDigest?.match(/^(sha256:[a-f0-9]{64})/i);
			const stagedDiff = digestMatch?.[1] ?? input.bindingDigest?.split(":")[0];
			const nextIntentHash = input.intentContentHash;
			const opName = "approve-breaking-intent-revision";
			const dialogSummary = [
				`Task: ${taskId}`,
				`Decision: ${opName}`,
				`State: Approval required`,
			].join("\n");
			const dialogDetails = [
				`Operation: ${opName}`,
				...(nextIntent ? [
					`Next Intent: rev ${nextIntent.revision} (${nextIntentHash})`,
					...intentDelta,
					`Acceptance Items: ${priorIntent.intent.acceptance.length} -> ${nextIntent.acceptance.length}`,
					`Next staged diff: ${stagedDiff}`,
				] : []),
			].join("\n");
			presentTaskRail(ctx, {
				task_id: taskId,
				state: "Approval required",
				result: uxText(UX_LANG, `${opName} requires your confirmation`, `${opName} 需要您的确认`),
				next: uxText(UX_LANG, `Decide ${opName}`, `请决策 ${opName}`),
			});
			const attention = {
				attention_id: randomUUID(),
				task_id: taskId,
				reason: "breaking_intent_revision" as const,
				label: uxText(UX_LANG, `${opName} approval required`, `${opName} 待您批准`),
			};
			const actions = [
				{ value: "authorize", label: uxText(UX_LANG, "Authorize", "批准"), description: uxText(UX_LANG, `Apply ${opName} after re-checking state`, `重新校验状态后应用 ${opName}`) },
				{ value: "cancel", label: uxText(UX_LANG, "Cancel", "取消"), description: uxText(UX_LANG, "Leave managed authority unchanged", "保持托管权限状态不变") },
			];
			const selected = await runDialog(() => requestAuthorityDialog(pi, ctx, attention, {
				title: uxText(UX_LANG, `Authorize ${opName}?`, `是否批准 ${opName}？`),
				summary: dialogSummary,
				details: dialogDetails,
				signal,
				actions,
			}));
			if (selected === "authorize" || selected === "confirm") {
				assertConfirmStillValid();
				await hooks.onAfterSidecarStage?.();
				return { decision: "accept", requestId };
			}
			return { decision: "cancel", requestId };
		}

		// Standard operations: request_authorization, stop
		const targetRoot = input.workspace ?? findLaneRelayTarget(ctx.cwd, taskId)?.lane_path ?? ctx.cwd;
		let openDecision: { id: string; summary: string } | undefined;
		if (input.operation === "request_authorization" && !input.reviewRetryNotice) {
			const { record } = await readTaskRecordRaw(targetRoot, taskId);
			const open = (record?.findings ?? []).filter(
				(finding) => finding.kind === "unresolved_user_decision" && finding.status === "open",
			);
			if (open.length === 1) openDecision = { id: open[0].id, summary: open[0].summary };
		}
		const opName = input.operation === "stop"
			? "stop"
			: activeCall?.derivedOperation ?? (input.reviewRetryNotice ? "authorize-review-retry" : openDecision ? "resolve-user-decision" : input.operation);
		presentTaskRail(ctx, {
			task_id: taskId,
			state: "Approval required",
			result: uxText(UX_LANG, `${opName} requires your confirmation`, `${opName} 需要您的确认`),
			next: uxText(UX_LANG, `Decide ${opName}`, `请决策 ${opName}`),
		});
		const attention = {
			attention_id: randomUUID(),
			task_id: taskId,
			reason: "review_authorization" as const,
			label: uxText(UX_LANG, `${opName} approval required`, `${opName} 待您批准`),
		};
		const dialogSummary = [
			`Task: ${taskId}`,
			`Decision: ${opName}`,
			...(input.risk ? [`Risk: ${input.risk}`] : []),
		].join("\n");
		const dialogDetails = [
			...(input.reviewRetryNotice ? [input.reviewRetryNotice] : []),
			`Operation: ${opName}`,
			...(openDecision ? [
				`Finding: ${openDecision.id}`,
				`Resolution: resume after literal-user decision: ${openDecision.summary}`,
			] : []),
			...(input.intentRevision ? [`Intent revision: ${input.intentRevision} (${input.intentContentHash ?? ""})`] : []),
			...(input.bindingDigest ? [`Binding digest: ${input.bindingDigest}`] : []),
			...(input.gitBaseNotice ? [input.gitBaseNotice] : []),
		].join("\n");
		const actions = [
			{ value: "authorize", label: uxText(UX_LANG, "Authorize", "批准"), description: uxText(UX_LANG, `Apply ${opName} after re-checking state`, `重新校验状态后应用 ${opName}`) },
			{ value: "cancel", label: uxText(UX_LANG, "Cancel", "取消"), description: uxText(UX_LANG, "Leave managed authority unchanged", "保持托管权限状态不变") },
		];
		const selected = await runDialog(() => requestAuthorityDialog(pi, ctx, attention, {
			title: uxText(UX_LANG, `Authorize ${opName}?`, `是否批准 ${opName}？`),
			summary: dialogSummary,
			details: dialogDetails,
			signal,
			actions,
		}));
		if (selected === "authorize" || selected === "confirm") {
			assertConfirmStillValid();
			return { decision: "accept", requestId };
		}
		return { decision: "cancel", requestId };
	};
}

export default function (
	pi: ExtensionAPI,
	dependencies: CanaryWorkExtensionDependencies = {},
) {
	// One progression per extension load, published for the batch gate to reuse.
	// Reusing whatever instance a previous load left behind would leak another
	// session's Review reservations into this one, so the load always replaces it.
	const ports = createPiAssuranceProgressionPorts(dependencies);
	const runtime = new PiRuntime({
		cwd: process.cwd(),
		ports,
		...(ports.authorityOverrides ? { authorityOverrides: ports.authorityOverrides } : {}),
	});
	(globalThis as any)[GLOBAL_PI_PROGRESSION_KEY] = runtime;
	const activeAuthorizeCalls = new Map<string, ActiveAuthorizeCall>();
	runtime.bindNativeConfirmation(createPiNativeConfirmation(pi, () => railContext, {
		resolveCall: (toolCallId) => (toolCallId ? activeAuthorizeCalls.get(toolCallId) : undefined),
		isSessionValid: (startGen, invocation) =>
			runtime.coordinator.sessionActiveValue()
			&& (startGen === undefined || runtime.coordinator.sessionGenerationValue() === startGen)
			&& (!invocation || runtime.coordinator.invocationState(invocation) === "open"),
		onAfterSidecarStage: async () => {
			await dependencies.authorizationAfterSidecarStage?.();
		},
	}));

	let railContext: ExtensionContext | undefined;
	const refreshTaskRail = async (ctx: ExtensionContext) => {
		try {
			const claim = await readBackendClaim(ctx.cwd);
			if (!claim) return;
			const projection = await projectAssuranceForTask(ctx.cwd, claim.task_id);
			if (projection.error) {
				presentTaskRail(ctx, {
					task_id: claim.task_id,
					state: "Blocked",
					result: projection.error,
					next: uxText(UX_LANG, "Inspect authority state", "检查权限状态"),
				});
				return;
			}
			presentTaskRailResult(ctx, claim.task_id, {
				state: "status",
				operation: "status",
				task_state: projection.projection,
				result: "Authoritative Assurance projection loaded",
				next_action: projection.projection.next_obligation,
			});
		} catch (error) {
			notifyOnce(
				ctx,
				"task-rail:projection",
				`Task Rail projection failed: ${error instanceof Error ? error.message : String(error)}`,
				"warning",
			);
		}
	};
	const attentionEvents = pi.events as unknown as {
		on?: (name: string, listener: (event: UserAttentionEventV1) => void) => void;
	} | undefined;
	attentionEvents?.on?.(USER_ATTENTION_EVENT, (event) => {
		if (!event.active || !railContext) return;
		presentTaskRail(railContext, {
			task_id: event.task_id,
			state: "Approval required",
			result: event.label ?? "Literal-user decision required",
			next: "Complete or cancel the native authorization dialog",
		});
	});
	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return { action: "continue" } as const;
		recordPiPhaseInput(event, ctx);
		railContext = ctx;
		clearTerminalTaskRailOnInput(ctx);
		await refreshTaskRail(ctx);
		return { action: "continue" } as const;
	});

	// Validate dispatch before the receipt observer records an Agent call.
	const continuation = registerPiRunContinuation(pi, {
		entry: (text, root) => recognizePhaseEntry(text, piLocalNames(root), "pi"),
		revokeEntry: revokePiPhaseEntry,
		entryState: (sessionId) => piPhaseEntries().get(sessionId) ?? null,
	});
	bindPiSelectedParent((toolCallId, root, slug) => {
		return continuation.selectedParent(toolCallId, root, slug);
	});
	pi.registerCommand("imm-tasks", {
		handler: async (_args: string, ctx?: ExtensionContext) => {
			if (!ctx || ctx.mode !== "tui") return;
			try {
				const view = await buildTaskOverview(ctx.cwd);
				await presentTaskOverviewOverlay(ctx, view);
			} catch (error) {
				notifyOnce(
					ctx,
					"task-overview:command",
					`Task overview failed: ${error instanceof Error ? error.message : String(error)}`,
					"warning",
				);
			}
		},
	});

	pi.on("session_start", async (_event: unknown, ctx?: ExtensionContext) => {
		runtime.coordinator.onSessionStart();
		if (!ctx) return;
		railContext = ctx;
		runtime.bindWorkspace(ctx.cwd);
		await reconcileRefsQuietly(ctx.cwd);
		if (ctx.mode !== "tui") return;
		await refreshTaskRail(ctx);
	});
	pi.on("before_agent_start", async (event: { prompt?: string; systemPrompt?: string }, ctx?: ExtensionContext) => {
		// Advisory only: an active Managed task is announced, never resumed.
		const notice = await activeTaskNotice(ctx?.cwd ?? process.cwd());
		if (!notice || typeof event.systemPrompt !== "string") return undefined;
		return { systemPrompt: `${event.systemPrompt}\n\n${notice}` };
	});
	pi.on("tool_call", (event: { toolName?: string; input?: unknown; toolCallId?: string }, ctx?: ExtensionContext) => {
		if (ctx) {
			railContext = ctx;
			runtime.bindWorkspace(ctx.cwd);
		}
		const laneRefusal = laneEditRefusal(event, ctx?.cwd ?? process.cwd());
		if (laneRefusal) return { block: true, reason: laneRefusal };
		if (event.toolName === "Agent") {
			// ADR 0017: validate a marker-targeted dispatch before binding the verifier.
			return (runtime.host as PiReviewHost).observeVerifierDispatch(event.input as Record<string, unknown> | undefined, event.toolCallId);
		}
	});
	pi.on("tool_result", (event: unknown, ctx?: ExtensionContext) => {
		if (ctx) {
			railContext = ctx;
			runtime.bindWorkspace(ctx.cwd);
		}
		const result = event as { toolName?: string; details?: Record<string, unknown>; toolCallId?: string; content?: Array<{ type?: string; text?: string }> };
		if (result.toolName === "Agent" && result.toolCallId) {
			// ADR 0017: record the verifier's own result bytes for receipt-bound submission.
			const text = Array.isArray(result.content)
				? result.content.filter((part) => typeof part?.text === "string").map((part) => part.text as string).join("\n")
				: "";
			(runtime.host as PiReviewHost).observeVerifierResult(result.toolCallId, text);
		}
	});
	pi.on("session_shutdown", async (_event: unknown, ctx?: ExtensionContext) => {
		// ADR 0025: the entry token ends with its session.
		revokePiPhaseEntry(piSessionId(ctx ?? railContext));
		resetInteractionPresentation(ctx ?? railContext);
		railContext = undefined;
		await runtime.shutdown();
	});

	pi.registerTool({
		name: "imm_kernel_canary",
		label: "Kernel canary assurance and executor operations",
		description:
			"Advance observable QA/Review orchestration, record executor facts, or request host confirmation for one enrolled Kernel canary task.",
		promptSnippet: "Kernel canary: record facts, run foreground QA, then submit one structured Review verdict without polling.",
		promptGuidelines: [
			"Only the exact enrolled canary task is routable; verify the active backend claim first via status.",
			"After implementation and focused verification, freeze the artifacts, call advance_assurance, and consume its direct terminal result; do not poll or create a detached job.",
			"When advance_assurance returns review_ready, invoke the foreground Agent from agent_params once, then call submit_review: omit the verdict to apply the observed reviewer result, or relay its structured verdict exactly.",
			"When submit_review returns verification_ready, invoke its exact foreground Agent once, then call submit_verification; omit the result to apply the Host-observed receipt.",
			"For a complete breaking revision, call approve_breaking_intent_revision with the complete next_intent directly; do not ask for chat pre-confirmation because the host opens the single native confirmation before applying it.",
			"For a proven stale authority claim, call repair_authority_state directly; the Kernel revalidates and removes only the redundant claim without user interaction.",
			"After awaiting_user, call request_authorization directly so the host opens the single native confirmation; do not ask for chat pre-confirmation or ask the user to copy or report a command.",
		],
		parameters: Type.Object({
			task_id: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
			action: Type.Union([
				Type.Object({ op: Type.Literal("status") }),
				Type.Object({ op: Type.Literal("advance_assurance") }),
				Type.Object({ op: Type.Literal("submit_review"), verdict: Type.Optional(Type.Unknown()) }),
				Type.Object({ op: Type.Literal("submit_verification"), result: Type.Optional(Type.String()) }),
				// record_revision: the Lane record revision read in `lane_decision_required` (Spec drive-always-lanes D11); a Lane that moved since is refused as stale.
				Type.Object({ op: Type.Literal("request_authorization"), record_revision: Type.Optional(Type.String()) }),
				Type.Object({ op: Type.Literal("request_stop"), record_revision: Type.Optional(Type.String()) }),
				Type.Object({ op: Type.Literal("repair_authority_state") }),
				Type.Object({ op: Type.Literal("freeze_artifacts") }),
				Type.Object({
					op: Type.Literal("record_finding"),
					finding: Type.Object({
						id: Type.String(),
						kind: Type.Union([Type.Literal("blocking"), Type.Literal("advisory")]),
						acceptance_id: Type.Union([Type.String(), Type.Null()]),
						summary: Type.String(),
					}),
				}),
				Type.Object({ op: Type.Literal("resolve_finding"), finding_id: Type.String() }),
				Type.Object({
					op: Type.Literal("refute_finding"),
					finding_id: Type.String(),
					attestation_id: Type.String(),
				}),
				Type.Object({
					op: Type.Literal("revise_intent"),
					next_intent: TASK_INTENT_SCHEMA,
				}),
				Type.Object({
					op: Type.Literal("approve_breaking_intent_revision"),
					next_intent: TASK_INTENT_SCHEMA,
					record_revision: Type.Optional(Type.String()),
				}),
				Type.Object({ op: Type.Literal("complete") }),
			]),
		}),
		prepareArguments: prepareActionArgs,
		execute: async (toolCallId: string, params: { task_id: string; action: { op: string; verdict?: unknown; result?: string } }, signal: AbortSignal | undefined, onUpdate: ((update: ReturnType<typeof toolResult>) => void) | undefined, ctx: ExtensionContext) => {
			const { task_id: taskId, action } = params;
			railContext = ctx;
			runtime.bindWorkspace(ctx.cwd);
			presentTaskRailResult(ctx, taskId, {
				state: "running",
				operation: action.op,
				result: `${action.op} started`,
				next_action: "Wait for the foreground Tool result",
			});
			// Storage-layout gate (BR-REQ-005/006): only `status` is read-only
			// and may inspect a non-ready layout. Every mutation recovers
			// Kernel transaction markers first, then runs the one-release
			// migration and STOPS until the affected diff is committed.
			if (action.op !== "status") {
				if (ctx.mode !== "tui")
					return failCanaryTool(taskId, action.op, "blocked", "tui_required", "Kernel mutation is TUI-only", "invoke the TUI Tool");
				try {
					// Recovery also retires a leftover derived claim/owner file whose
					// task the store already holds: that file is inert, not authority.
					await withKernelStoreLockForTask(ctx.cwd, taskId, () => undefined);
				} catch (error) {
					return failCanaryTool(taskId, action.op, "blocked", "layout_recovery_failed", `Kernel transaction recovery failed: ${error instanceof Error ? error.message : String(error)}`, "resolve the pending marker and retry");
				}
				const inspection = await inspectStorageLayout(ctx.cwd);
				if (inspection.layout === "migration_required" || inspection.layout === "recovery_required") {
					const migration = await migrateLegacyLayout(ctx.cwd);
					const summary = migration.outcome === "migrated"
						? `Legacy storage migrated (${migration.affected_paths.length} paths); commit the affected migration diff and retry ${action.op}`
						: `Mutation blocked by storage layout (${migration.outcome}): ${migration.reason ?? inspection.reason ?? ""}`;
					return failCanaryTool(taskId, action.op, "blocked", "layout_migration_required", summary, "commit the migration diff and retry");
				}
				if (inspection.layout !== "ready") {
					return failCanaryTool(taskId, action.op, "blocked", "layout_not_ready", `Mutation blocked by storage layout (${inspection.layout}): ${inspection.reason ?? ""}`, "resolve the layout condition and retry");
				}
			}
			if (action.op === "repair_authority_state") {
				if (ctx.mode !== "tui") return failCanaryTool(taskId, action.op, "blocked", "tui_required", "imm_kernel_canary mutation is TUI-only", "invoke the TUI Tool");
				const meta: ToolMeta = {
					sessionId: piSessionId(ctx),
					toolCallId,
					workspace: ctx.cwd,
					taskId,
					interactive: ctx.mode === "tui",
					signal,
				};
				try {
					const repaired = await runtime.authorize(taskId, "repair_authority_state", meta);
					const result = {
						state: "recovered_retry",
						operation: action.op,
						authority: repaired,
						result: `Stale authority claim repaired for ${taskId}`,
						next_action: "retry the blocked managed request once",
					};
					return toolResult(JSON.stringify(result, null, 2), result);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					const blocked = {
						state: "authority_conflict",
						operation: action.op,
						result: message,
						next_action: "inspect authority state",
					};
					presentTaskRailResult(ctx, taskId, blocked);
					return failCanaryTool(taskId, action.op, "authority_conflict", "authority_repair_failed", message, blocked.next_action);
				}
			}
			if (action.op === "advance_assurance" || action.op === "request_stop" || action.op === "request_authorization" || action.op === "submit_review" || action.op === "submit_verification" || action.op === "approve_breaking_intent_revision") {
				const isAuthorizeOp = action.op === "request_stop" || action.op === "request_authorization" || action.op === "approve_breaking_intent_revision";
				if (isAuthorizeOp && ctx.mode !== "tui")
					return failCanaryTool(taskId, action.op, "blocked", "tui_required", "literal-user authorization is TUI-only", "invoke the TUI Tool");
				if (isAuthorizeOp && runtime.coordinator.active(taskId)?.state === "running") {
					return failCanaryTool(taskId, action.op, "blocked", "authority_failed", "assurance operation is already running", "wait for the active assurance operation to finish");
				}
				let derivedOperation: AuthorizeOperation | undefined;
				if (action.op === "request_authorization") {
					if (runtime.coordinator.isInvocationOpen(taskId)) {
						return failCanaryTool(
							taskId,
							action.op,
							"blocked",
							"authority_failed",
							`task ${taskId} already has an open invocation; concurrent assure/authorize is rejected`,
							"inspect authority state",
						);
					}
					const projection = await projectAssuranceForTask(ctx.cwd, taskId);
					if (projection.error || !projection.claim) {
						return failCanaryTool(taskId, action.op, "blocked", "authority_failed", projection.error ?? "no active backend claim", "inspect authority state");
					}
					await dependencies.authorizationBeforeRecordRead?.();
					const read = await readTaskRecordRaw(ctx.cwd, taskId);
					if (!read.record) {
						return failCanaryTool(taskId, action.op, "blocked", "authority_failed", `task ${taskId} has no TaskRecord v3`, "inspect authority state");
					}
					if (read.revision !== projection.projection.record_revision) {
						return failCanaryTool(taskId, action.op, "blocked", "authority_failed", "TaskRecord changed while deriving authorization operation", "inspect authority state");
					}
					const derived = deriveAuthorizationOperation({ readiness: projection.projection.authorization });
					if ("blocked" in derived) {
						return failCanaryTool(taskId, action.op, "blocked", "authority_failed", derived.blocked, "inspect authority state");
					}
					derivedOperation = derived.operation;
				}
				const effectiveSignal = signal && ctx.signal
					? AbortSignal.any([signal, ctx.signal])
					: signal ?? ctx.signal;
				const meta: ToolMeta = {
					sessionId: piSessionId(ctx),
					toolCallId,
					workspace: ctx.cwd,
					taskId,
					interactive: ctx.mode === "tui",
					signal: effectiveSignal,
				};
				let preStopLifecycle: string | undefined;
				if (action.op === "request_stop") {
					try {
						preStopLifecycle = readTaskRecordRaw(ctx.cwd, taskId).record?.lifecycle;
					} catch {}
				}
				const startGen = runtime.coordinator.sessionGenerationValue();
				let invocation: InvocationToken | undefined;
				if (isAuthorizeOp) {
					try {
						invocation = runtime.coordinator.openInvocation(taskId);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						return failCanaryTool(taskId, action.op, "blocked", "authority_failed", message, "inspect authority state");
					}
					activeAuthorizeCalls.set(toolCallId, { ctx, invocation, startGen, derivedOperation });
				}
				const reportedOperation = action.op === "request_stop"
					? "stop"
					: action.op === "approve_breaking_intent_revision"
						? "approve-breaking-intent-revision"
						: derivedOperation ?? action.op;
				let result: unknown;
				try {
					if (action.op === "advance_assurance") {
						result = await runtime.advance(taskId, effectiveSignal, meta, (update: any) => {
							onUpdate?.(update);
							presentTaskRailResult(ctx, taskId, update.details as Record<string, unknown> | undefined);
						});
					} else if (action.op === "submit_review") {
						result = await runtime.submitReview(taskId, action.verdict, meta);
					} else if (action.op === "submit_verification") {
						result = await runtime.submitVerification(taskId, action.result, meta);
					} else if (action.op === "approve_breaking_intent_revision") {
						result = await runtime.authorize(taskId, "approve_breaking_intent_revision", meta, {
							next_intent: (action as { next_intent?: unknown }).next_intent,
							record_revision: (action as { record_revision?: string }).record_revision,
						});
					} else if (action.op === "request_stop") {
						result = await runtime.authorize(taskId, "stop", meta, {
							record_revision: (action as { record_revision?: string }).record_revision,
						});
						runtime.coordinator.releaseStoppedReview(taskId);
					} else {
						result = await runtime.authorize(taskId, "request_authorization", meta, {
							record_revision: (action as { record_revision?: string }).record_revision,
						});
					}
				} catch (error) {
					if (error instanceof NativeAuthorityError && error.reasonCode === "user_cancelled") {
						result = {
							state: "cancelled",
							operation: reportedOperation,
							reason: error.message,
						};
					} else if (
						action.op === "approve_breaking_intent_revision" &&
						error instanceof NativeAuthorityError &&
						error.reasonCode === "workspace_changed" &&
						error.message.includes("workspace changed after native confirmation")
					) {
						return failCanaryTool(taskId, action.op, "blocked", "authority_failed", "staged next-state diff changed after native confirmation", "inspect authority state");
					} else if (action.op === "request_stop" && preStopLifecycle && preStopLifecycle !== "stopped") {
						const terminal = await projectAssuranceForTask(ctx.cwd, taskId).catch(() => null);
						if (terminal && !terminal.error && terminal.projection.lifecycle === "stopped") {
							runtime.coordinator.releaseStoppedReview(taskId);
							result = {
								state: "applied",
								operation: "stop",
								lifecycle: "stopped",
								delivery_error: error instanceof Error ? error.message : String(error),
							};
						} else {
							const message = error instanceof Error ? error.message : String(error);
							return failCanaryTool(taskId, action.op, "blocked", "authority_failed", message, "inspect authority state");
						}
					} else {
						const message = error instanceof Error ? error.message : String(error);
						return failCanaryTool(taskId, action.op, "blocked", "authority_failed", message, "inspect authority state");
					}
				} finally {
					activeAuthorizeCalls.delete(toolCallId);
					if (invocation) runtime.coordinator.closeInvocation(invocation);
				}
				if (result && typeof result === "object" && "record" in result) {
					const resObj = result as Record<string, unknown>;
					result = {
						...resObj,
						state: "applied",
						operation: reportedOperation,
						lifecycle: (resObj.record as any)?.lifecycle,
					};
				} else if (result && typeof result === "object" && (result as Record<string, unknown>).state === "replan_selected") {
					result = {
						...(result as Record<string, unknown>),
						operation: reportedOperation,
					};
				}
				const enriched = await enrichAssuranceResult(ctx, taskId, result as unknown as Record<string, unknown>);
				presentTaskRailResult(ctx, taskId, enriched);
				throwIfCanaryToolFailure(taskId, action.op, enriched);
				return toolResult(JSON.stringify(enriched, null, 2), enriched);
			}
			const requested = requestedScope(action as { op: string; next_intent?: unknown });
			// Status is a read: unstaged in-scope paths come back as a warning. Every
			// other operation projects through the refusing delivery identity.
			const projection: StatusProjectionResult = action.op === "status"
				? await projectTaskStatus(ctx.cwd, taskId)
				: await projectAssuranceForTask(ctx.cwd, taskId, requested);
			if (action.op === "status" && projection.error && projection.batch) {
				const details = { state: "status", operation: "status", plugin_version: PLUGIN_VERSION,
					batch: projection.batch, task_error: projection.error,
					next_action: "Inspect batch evidence; this read grants no execution authority." };
				presentTaskRailResult(ctx, taskId, details);
				return toolResult(JSON.stringify(details, null, 2), details);
			}
			if (projection.error) {
				const nextAction = recoveryActionForAssuranceFailure(projection.error) ?? "inspect authority state";
				const details = {
					state: "blocked",
					operation: action.op,
					result: projection.error,
					next_action: nextAction,
				};
				presentTaskRailResult(ctx, taskId, details);
				return failCanaryTool(taskId, action.op, "blocked", "projection_unavailable", projection.error, details.next_action);
			}
			if (action.op === "status") {
				const state = projection.projection;
				const fresh = state.fresh_acceptance_ids.length;
				const total = fresh + state.missing_acceptance_ids.length;
				const blockers = state.blocking_finding_ids.length
					+ state.unresolved_user_decision_ids.length
					+ state.replan_required_ids.length;
				const warnings = projection.warnings ?? [];
				const gitIntegration = projection.git_integration ? { git_integration: projection.git_integration } : {};
				const batchEvidence = projection.batch ? { batch: projection.batch } : {};
				const configEvidence = projection.config ? { config: projection.config } : {};
				const status = { plugin_version: PLUGIN_VERSION, ...state, ...gitIntegration, ...configEvidence, ...batchEvidence, ...(warnings.length > 0 ? { warnings } : {}) };
				const details = {
					state: "status",
					operation: "status",
					plugin_version: PLUGIN_VERSION,
					lifecycle: state.lifecycle,
					artifact_state: state.artifact_state,
					task_state: state,
					...gitIntegration,
					...configEvidence,
					...batchEvidence,
					...(warnings.length > 0 ? { warnings } : {}),
					result: `${fresh}/${total} acceptance items fresh; ${blockers} blocker${blockers === 1 ? "" : "s"}${warnings.map((warning) => `; ${warning.message}`).join("")}`,
					next_action: state.next_obligation,
				};
				presentTaskRailResult(ctx, taskId, details);
				return toolResult(JSON.stringify(status, null, 2), details);
			}
			const claim = projection.claim;
			if (!claim || claim.task_id !== taskId) {
				return failCanaryTool(taskId, action.op, "blocked", "claim_missing", `no active backend claim for ${taskId}`, "inspect authority state");
			}
			try {
				const result = (await runtime.executeOrdinary({ cwd: ctx.cwd }, {
					taskId,
					operation: toCanaryOperation(action, "executor") as { op: string; actor_id: string },
				})) as unknown as { revision: string; record: { lifecycle: string; artifact_state: string } };
				const updated = await projectAssuranceForTask(ctx.cwd, taskId);
				const taskState = updated.error
					? { lifecycle: result.record.lifecycle, artifact_state: result.record.artifact_state }
					: updated.projection;
				const nextAction = updated.error ? "inspect authority state" : updated.projection.next_obligation;
				const details = {
					state: "recorded",
					operation: action.op,
					lifecycle: result.record.lifecycle,
					artifact_state: result.record.artifact_state,
					task_state: taskState,
					result: "Kernel executor fact recorded",
					next_action: nextAction,
				};
				await reconcileRefsQuietly(ctx.cwd);
				presentTaskRailResult(ctx, taskId, details);
				return toolResult(
					JSON.stringify(
						{ revision: result.revision, lifecycle: result.record.lifecycle, artifact_state: result.record.artifact_state, task_state: taskState, next_action: nextAction },
						null,
						2,
					),
					details,
				);
			} catch (error) {
				return failCanaryTool(taskId, action.op, "failed", "mutation_failed", error instanceof Error ? error.message : String(error), "correct the reported failure and retry");
			}
		},
		renderCall(args, theme) {
			return renderCanaryCall(args, theme);
		},
		renderResult(result, _options, theme) {
			return renderCanaryResult(
				result as Parameters<typeof renderCanaryResult>[0],
				theme,
			);
		},
	});

	pi.registerTool({
		name: "imm_loop_action",
		label: "Project internal Loop action",
		description:
			"Build one deterministic, read-only Loop action or internal role dispatch envelope. This Tool never mutates repository or workflow state.",
		promptSnippet:
			"Use imm_loop_action at every internal Loop role boundary before invoking an Agent or performing current-context Executor work.",
		promptGuidelines: [
			"Use route for Step, repair, architecture, advisory, Compounder, Kernel, or scope-expansion authority projection.",
			"Use dispatch_role for QA and Review roles, then invoke the returned foreground Agent call exactly.",
		],
		parameters: Type.Object({
			action: Type.Union([
				Type.Object({
					op: Type.Literal("route"),
					ownership: literalUnion(LOOP_OWNERS),
					target: literalUnion(LOOP_TARGETS),
					context: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
					scope_expansion: Type.Optional(Type.Boolean()),
					kernel_operation: Type.Optional(literalUnion(KERNEL_OPERATIONS)),
				}),
				Type.Object({
					op: Type.Literal("dispatch_role"),
					role: literalUnion(LOOP_DIRECT_ROLES),
					context: Type.Record(Type.String(), Type.Unknown()),
				}),
			]),
		}),
		prepareArguments: prepareActionArgs,
		execute: async (
			_toolCallId: string,
			params: { action: LoopToolAction },
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			_ctx: ExtensionContext,
		) => {
			const { action } = params;
			// The Tool schema is intentionally broader than loop_contract's input
			// types (model-supplied JSON); loop_contract narrows and validates at
			// runtime, so these boundary casts are type-level only.
			const result = action.op === "route"
				? await buildLoopAction({
					ownership: action.ownership,
					target: action.target,
					context: action.context as RoleDelegationContext | undefined,
					scope_expansion: action.scope_expansion,
					kernel_operation: action.kernel_operation as Parameters<typeof buildLoopAction>[0]["kernel_operation"],
				})
				: await buildLoopRoleDispatch({ role: action.role, context: action.context as RoleDelegationContext });
			const details = loopResultDetails(result, action.op);
			return toolResult(JSON.stringify(result, null, 2), details);
		},
		renderCall(args, theme) {
			const action = (args as { action?: LoopToolAction }).action;
			const subject = action?.op === "route" ? action.target : action?.role;
			return renderStructuredCall("imm_loop_action", action?.op ?? "unknown", subject, theme);
		},
		renderResult(result, _options, theme) {
			return renderStructuredResult(
				result as Parameters<typeof renderStructuredResult>[0],
				theme,
			);
		},
	});
}

// ---------------------------------------------------------------------------
// Helpers (module scope; no workflow state)
// ---------------------------------------------------------------------------

// The derivation is shared with the Claude adapter so it cannot drift between
// Hosts; this module re-exports it for its existing callers and tests.
import {
	deriveAuthorizationOperation,
	type DerivedAuthorizationOperation,
} from "../runtime/authorization_operation";

export { deriveAuthorizationOperation, type DerivedAuthorizationOperation };

/**
 * Ordinary Kernel operation mapping, exported so the conformance suite can
 * prove the Tool schema and this projection cannot drift apart.
 */
export function toCanaryOperation(action: { op: string }, actorId: string) {
	switch (action.op) {
		case "freeze_artifacts":
			return { op: "freeze_artifacts", actor_id: actorId };
		case "record_finding":
			return {
				op: "record_finding",
				finding: (action as unknown as { finding: unknown }).finding,
				actor_id: actorId,
			};
		case "resolve_finding":
			return { op: "resolve_finding", finding_id: (action as unknown as { finding_id: string }).finding_id, actor_id: actorId };
		case "refute_finding":
			return {
				op: "refute_finding",
				finding_id: (action as unknown as { finding_id: string }).finding_id,
				attestation_id: (action as unknown as { attestation_id: string }).attestation_id,
				actor_id: actorId,
			};
		case "revise_intent":
			return { op: "revise_intent", next_intent: (action as unknown as { next_intent: unknown }).next_intent, actor_id: actorId };
		case "complete":
			return { op: "complete", actor_id: actorId };
		default:
			throw new Error(`unsupported ordinary operation: ${action.op}`);
	}
}

export async function recordCancelledUserDecision(
	ctx: ExtensionContext,
	taskId: string,
	operation: string,
	snapshotDigestRef: string,
): Promise<{ recorded: boolean; finding_id: string }> {
	const findingId = `user-decision-${operation}`;
	const current = await readTaskRecordRaw(ctx.cwd, taskId);
	const openDecision = current.record?.findings.find(
		(finding) =>
			finding.kind === "unresolved_user_decision" && finding.status === "open",
	);
	// Deduplicate onto the existing open decision trail regardless of its id:
	// a pending decision must never be shadowed by a second trail entry.
	if (openDecision) return { recorded: false, finding_id: openDecision.id };
	const runtime = await getSharedPiProgression();
	await runtime.executeOrdinary({ cwd: ctx.cwd }, {
		taskId,
		operation: {
			op: "record_finding",
			finding: {
				id: findingId,
				kind: "unresolved_user_decision",
				acceptance_id: null,
				summary: `${operation} confirmation cancelled by literal user; snapshot ${snapshotDigestRef}`,
			},
			actor_id: LITERAL_USER_ACTOR_ID,
		} as never,
	});
	return { recorded: true, finding_id: findingId };
}

export function buildUserDecisionOperation(record: {
	findings: Array<{ id: string; kind: string; status: string; summary?: string }>;
}) {
	const open = record.findings.filter(
		(finding) => finding.kind === "unresolved_user_decision" && finding.status === "open",
	);
	if (open.length !== 1)
		throw new Error(`resolve-user-decision requires exactly one open user decision; found ${open.length}`);
	return {
		op: "resolve_user_decision" as const,
		finding_id: open[0].id,
		resolution: `resume after literal-user decision: ${open[0].summary}`,
	};
}

/**
 * Read the TaskIntent through the TaskRecord's `intent_ref.path`.
 *
 * `freeze_artifacts` binds the sidecar in place, so a post-freeze read must
 * follow the record instead of guessing a default path; with no record yet
 * (pre-enrollment) the Kernel resolves the sidecar that exists. Same contract
 * as the Claude adapter's `readTaskIntentForRecord`.
 */
export function readTaskIntentForRecord(root: string, taskId: string): ReadTaskIntentResult {
	const record = readTaskRecordRaw(root, taskId).record;
	return readTaskIntent(root, taskId, record?.intent_ref.path, record?.intent_snapshot);
}

/**
 * The shared delivery identity selector: one function in workspace_scope.ts
 * picks the identity family per TaskRecord contract. This adapter-level alias
 * only narrows the record type for the Kernel ports that expect it; the dual-host
 * conformance seam imports it so both hosts' reportable identity is comparable.
 */
export function diffSnapshotOf(root: string, record: TaskRecord): {
	diff_hash: string;
	changed_paths: string[];
} {
	return taskDeliveryIdentity(root, record);
}

// Translation-only adapter for the internal Kernel assurance projection. All
// freshness, approval, finding, claim, and authorization facts come from the
// Kernel module; this wrapper only binds the host diff provider. The retired
// active-v2 migrator is gone: a v2 TaskRecord in the state layout is a
// fail-closed projection error, never an automatic migration trigger.
/**
 * Read-only task overview for the /imm-tasks overlay: the active claim's
 * task plus every not-enrolled docs/plans/*.intent.json draft. Settled
 * history stays on the CLI (BR-DEC-3); no second state source is created.
 */
async function buildTaskOverview(root: string): Promise<{
	active: TaskOverviewEntry | null;
	pending: TaskOverviewEntry[];
}> {
	const claim = await readBackendClaim(root);
	let active: TaskOverviewEntry | null = null;
	if (claim) {
		const projection = await projectAssuranceForTask(root, claim.task_id);
		if (!projection.error) {
			const state = projection.projection;
			const obligation = String(state.next_obligation);
			active = {
				task_id: claim.task_id,
				state: overviewRailState(state.lifecycle, obligation),
				result: `Assurance: ${obligation.replace(/_/g, " ")}`,
				next: `${state.fresh_acceptance_ids.length}/${state.fresh_acceptance_ids.length + state.missing_acceptance_ids.length} acceptance fresh · ${state.artifact_state}`,
			};
		} else {
			active = {
				task_id: claim.task_id,
				state: "Blocked",
				result: projection.error,
				next: "inspect authority state",
			};
		}
	}
	const pending: TaskOverviewEntry[] = [];
	const plansDir = resolve(root, "docs/plans");
	if (existsSync(plansDir)) {
		for (const name of readdirSync(plansDir).sort()) {
			if (!name.endsWith(".intent.json")) continue;
			const taskId = name.slice(0, -".intent.json".length);
			if (claim && taskId === claim.task_id) continue;
			if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(taskId)) continue;
			let summary: string;
			try {
				if (await readTaskTombstone(root, taskId)) continue;
				const intent = await parseTaskIntentV1(JSON.parse(readFileSync(join(plansDir, name), "utf8")));
				if (intent.task_id !== taskId) continue;
				summary = intent.goal;
			} catch {
				continue;
			}
			pending.push({ task_id: taskId, state: "Planning", result: summary, next: "not enrolled" });
		}
	}
	return { active, pending };
}

function overviewRailState(lifecycle: string, obligation: string): TaskRailState {
	if (lifecycle === "done") return "Completed";
	if (lifecycle === "stopped") return "Stopped";
	if (obligation === "run_review") return "Reviewing";
	if (obligation === "submit_assurance" || obligation === "run_qa") return "Verifying";
	if (obligation === "resolve_findings" || obligation === "resolve_user_decision" || obligation === "revise_intent") return "Blocked";
	return "Working";
}

export async function projectAssuranceForTask(
	root: string,
	taskId: string,
	nextScope?: readonly string[],
): Promise<AssuranceProjectionResult> {
	// A scope revision is projected against the scope it asks for (ADR 0021, D6).
	return projectAssurance(
		root,
		taskId,
		nextScope
			? (rootDir: string, record: TaskRecord) => diffSnapshotOf(rootDir, withNextScope(record, nextScope))
			: undefined,
	);
}

/**
 * The canonical scope a `revise_intent` payload asks for. It goes through the
 * Intent parser so entries it would fold away (covered by a directory) match the
 * scope the Kernel later records; a payload the parser rejects is reported by
 * the revision path itself, not here.
 */
function requestedScope(action: { op: string; next_intent?: unknown }): string[] | undefined {
	if (action.op !== "revise_intent") return undefined;
	try {
		return parseTaskIntentV1(action.next_intent).scope_hint;
	} catch {
		return undefined;
	}
}

/**
 * Publish and prove the task-scoped synthetic revision for a v4 record. v3
 * records keep the legacy full-source bundle and return null here.
 */
/**
 * Review refs are reconstructible evidence transport, never workflow authority.
 * A ref survives only while its task owns a nonterminal TaskRecord.
 */
async function reconcileReviewRevisionRefs(root: string): Promise<{ removed: string[]; failed: string[] }> {
	let listed: ReturnType<typeof listReviewRefs>;
	try {
		listed = listReviewRefs(root);
	} catch {
		return { removed: [], failed: [] };
	}
	const live = new Set<string>();
	try {
		const claim = await readBackendClaim(root);
		for (const entry of listed) {
			if (live.has(entry.taskId)) continue;
			try {
				const record = await readTaskRecordRaw(root, entry.taskId);
				if (record.record && record.record.lifecycle === "active" && claim?.task_id === entry.taskId)
					live.add(entry.taskId);
			} catch {
				// An unreadable owner is never proof of life, but deleting evidence on
				// a transient read failure is worse: leave it for the next pass.
				live.add(entry.taskId);
			}
		}
	} catch {
		for (const entry of listed) live.add(entry.taskId);
	}
	return reconcileReviewRefs(root, live);
}

/**
 * The coordinator port supplies a `HostContext`, which carries no UI. Pi hands
 * its full `ExtensionContext` through at runtime, so the notice still reaches
 * the user; a host that does not is left un-notified rather than throwing from
 * inside an authority commit, where a notification has no authority anyway.
 */
function notifyHost(ctx: HostContext, key: string, message: string, level: "warning" | "error"): void {
	const ui = (ctx as Partial<UiContext>).ui;
	if (ui) notifyOnce({ ui }, key, message, level);
}

// The invocation registry is shared with the progression module's
// module-scoped registry (see the top-level import above); commit/cancel
// semantics are identical to the previous extension implementation.

const piConfirmationReference: ConfirmationReferenceSource = ({ snapshot, now }) =>
	`pi-confirm-${createHash("sha256").update(`${snapshot.task_id}\0${now}\0${snapshot.intent_revision}\0${snapshot.intent_content_hash}\0${snapshot.diff_hash}`).digest("hex").slice(0, 16)}`;

type AssuranceTaskState = AssuranceProjectionResult["projection"] | { error: string };

/**
 * Ref cleanup is transport hygiene, never workflow authority: a failure is
 * swallowed here and retried by the next startup or terminal reconciliation.
 */
async function reconcileRefsQuietly(root: string): Promise<void> {
	try {
		await reconcileReviewRevisionRefs(root);
	} catch {
		/* non-authoritative */
	}
}

async function enrichAssuranceResult(
	ctx: ExtensionContext,
	taskId: string,
	result: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	if (result.recovery_error) {
		// Do not replay a failed observation for Host decoration or tracker hygiene.
		const taskState = { error: typeof result.reason === "string" ? result.reason : "authority projection unavailable" };
		return { ...result, task_state: taskState, next_action: nextActionForAssuranceResult(result, taskState) };
	}
	const projection = await projectAssuranceForTask(ctx.cwd, taskId);
	const taskState: AssuranceTaskState = projection.error
		? { error: projection.error }
		: projection.projection;
	await reconcileRefsQuietly(ctx.cwd);
	const tracker = result.tracker;
	return {
		...result,
		task_state: taskState,
		...(tracker ? { tracker } : {}),
		next_action: nextActionForAssuranceResult(result, taskState),
	};
}

function nextActionForAssuranceResult(result: Record<string, unknown>, taskState: AssuranceTaskState): string {
	const derived = result.recovery as { next_action: string } | undefined;
	if (derived) return derived.next_action;
	if (typeof result.recovery_action === "string") return result.recovery_action;
	const recovery = recoveryActionForAssuranceFailure(
		"error" in taskState ? taskState.error : result.reason,
	);
	if (recovery) return recovery;
	if (result.recovery_error || "error" in taskState) return "inspect authority state";
	if (result.state === "review_preparation_failed") return "repair Review preparation, then retry advance_assurance; QA is already committed";
	if (result.code === "verdict_invalid") return "fix the verdict payload and resubmit submit_review; the Review reservation remains active; do not re-dispatch the reviewer";
	if (taskState.lifecycle === "done" || taskState.lifecycle === "stopped") return "none";
	switch (result.state) {
		case "review_ready": return typeof (result as { review_command?: unknown }).review_command === "string" ? "run review_command in your shell, then submit_review" : "invoke the foreground reviewer and submit its verdict";
		case "verification_ready": return "invoke the reserved foreground verifier and submit_verification";
		case "awaiting_user": return "request_authorization";
		case "applied": return taskState.completion_ready ? "complete task" : taskState.next_obligation;
		case "completed":
		case "stopped": return "none";
		case "rework": return "repair findings, then advance assurance";
		case "cancelled": return "retry the interrupted foreground operation";
		case "settlement_unknown": return "advance_assurance to reconcile Kernel state; do not replay the uncertain write";
		case "blocked":
		case "failed":
		default: return taskState.next_obligation;
	}
}

function recoveryActionForAssuranceFailure(reason: unknown): string | null {
	if (typeof reason !== "string") return null;
	if (reason.includes("task scope contains unstaged or untracked changes:"))
		return "stage only the listed task-owned paths, then retry the blocked operation";
	if (reason.includes("QA resolution failed ("))
		return "repair the verification command or delivery environment, then retry advance_assurance";
	if (reason.includes("task delivery contains paths outside the authorization envelope:"))
		return "reconcile the listed paths: unstage unrelated paths or revise TaskIntent scope for task-owned paths, then retry advance_assurance";
	return null;
}

function toolResult(text: string, details?: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
}

/**
 * Pre-validation compatibility recovery for providers that encode the
 * object-valued Tool `action` as a JSON string (observed with
 * `hyper/qwen3.8-flash`: `{ "action": "{\"op\":\"status\"}" }`).
 *
 * Only the top-level `action` field is parsed, and only when it parses to a
 * non-null, non-array object. Native object input, invalid JSON, arrays,
 * `null`, primitives, and every other shape are returned unchanged so the
 * strict TypeBox schemas remain the authoritative boundary. Nested string
 * fields (`context`, `next_intent`, `finding`) are deliberately never
 * touched; this helper does not validate schemas, mutate inputs, or throw.
 *
 * Temporary compatibility layer owned by GitHub Issue #14
 * (github.com/dereknex/immune-brain/issues/14): remove after two consecutive
 * Pi or Hyper adapter upgrade cycles pass a live nested-object Tool-call
 * probe at least 30 days apart.
 */
/**
 * Pre-schema normalizer: some hosts deliver `action` as a JSON string. The Pi
 * runtime validates the returned value against the Tool schema immediately
 * after this shim, so the parameter type is the schema's, not a claim this
 * function makes about unvalidated input.
 */
function prepareActionArgs<Params>(args: unknown): Params {
	if (args === null || typeof args !== "object" || Array.isArray(args)) return args as Params;
	const input = args as Record<string, unknown>;
	if (typeof input.action !== "string") return input as Params;
	try {
		const parsed: unknown = JSON.parse(input.action);
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed))
			return { ...input, action: parsed } as Params;
	} catch {
		// Unchanged input keeps the normal host schema error authoritative.
	}
	return input as Params;
}

function failCanaryTool(
	taskId: string,
	operation: string,
	// `review_preparation_failed` is a declared ToolFailureV1 state and a
	// documented Loop recovery path; omitting it here made it unreportable.
	state: ToolFailureV1["state"],
	code: string,
	message: string,
	nextAction: string,
	details: AssuranceFailureDetails = {},
): never {
	return throwToolFailure({
		tool: "imm_kernel_canary",
		task_id: taskId,
		operation,
		state,
		code,
		message,
		next_action: nextAction,
		...details,
	});
}

function throwIfCanaryToolFailure(
	taskId: string,
	operation: string,
	result: Record<string, unknown>,
): void {
	if (!isToolFailureState(result.state)) return;
	const details = result as AssuranceFailureDetails;
	failCanaryTool(
		taskId,
		operation,
		result.state,
		typeof result.code === "string" ? result.code : `assurance_${result.state}`,
		typeof result.reason === "string"
			? result.reason
			: typeof result.result === "string"
				? result.result
				: "Kernel assurance operation failed",
		typeof result.next_action === "string"
			? result.next_action
			: "inspect authority state",
		// Preserve only the coordinator's bounded observation metadata.
		{
			...(details.diagnostics ? { diagnostics: details.diagnostics } : {}),
			...(details.prepare_observation ? { prepare_observation: details.prepare_observation } : {}),
			...(details.environment_failure ? { environment_failure: true } : {}),
			...(details.recovery ? { recovery: details.recovery } : {}),
			...(details.recovery_error ? { recovery_error: details.recovery_error } : {}),
		},
	);
}

// Re-exported pure lifecycle helpers and types (single source of truth in the
// progression module; the extension keeps its historical export surface).
export {
	PiRuntime,
	buildReviewPrompt,
	classifyReviewWorkload,
	deriveQaJobTimeoutMs,
	parseAssuranceVerdict,
	reviewReworkFindings,
	snapshotDigest,
	QA_JOB_TIMEOUT_SECONDS,
	REVIEW_DISPATCH_TIMEOUT_MS,
	REVIEW_PREPARATION_TIMEOUT_MS,
	REVIEW_TIMING_PROFILES,
	REVIEW_VERDICT_VALIDATION_TIMEOUT_MS,
};
export type {
	AssuranceAdvanceResult,
	AssuranceProgressionPorts,
	AssuranceSubmitReviewResult,
	AssuranceVerdict,
	QaVerificationProgress,
	SnapshotDescriptor,
} from "./pi-canary-assurance-progression";
