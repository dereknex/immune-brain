import { buildAssuranceSnapshot, stagePlanningArtifactTransition } from "../runtime/assurance/verdict_authority";
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

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { PLUGIN_VERSION } from "../runtime/plugin_version";
import { findResumableBatchSlugForTask } from "../runtime/unattended/batch_preflight";
import { executePiUnattendedBatch } from "./imm-unattended-batch";
import {
} from "./pi-canary-verification";
import {
	listReviewRefs,
	reconcileReviewRefs,
	writeNativeReviewEvidence,
} from "./pi-canary-review-bundle";
import type { InvocationToken } from "./pi-canary-invocations";
import { runDeterministicQa } from "../runtime/assurance/qa";
import {
	captureStagedIntent,
	restoreStagedIntent as restoreStagedIntentShared,
} from "../runtime/staged_intent";
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
	type UserAttentionReason,
} from "./pi-canary-interaction";
import { isToolFailureState, throwToolFailure, type AssuranceFailureDetails, type ToolFailureV1 } from "./pi-canary-tool-failure";
import { resolveUxLanguage, uxText } from "./ux-language";

/** Host-native UI language; see ux-language.ts. Resolved once per process. */
const UX_LANG = resolveUxLanguage();
import { taskDeliveryIdentity } from "../runtime/workspace_scope";
import {
	AssuranceProgression,
	buildReviewPrompt,
	classifyReviewWorkload,
	deriveQaJobTimeoutMs,
	projectTerminalTrackerState,
	parseAssuranceVerdict,
	snapshotDigest,
	QA_JOB_TIMEOUT_SECONDS,
	REVIEW_DISPATCH_TIMEOUT_MS,
	REVIEW_PREPARATION_TIMEOUT_MS,
	REVIEW_TIMING_PROFILES,
	REVIEW_VERDICT_VALIDATION_TIMEOUT_MS,
	type AssuranceProgressionPorts,
	type HostContext,
} from "./pi-canary-assurance-progression";

// The Pi adapter imports the host-neutral runtime modules statically, exactly
// as the Claude adapter does; the retired dynamic-import isolation layer is
// gone. The adapter-owned logic that used to live behind it (the
// record-aware intent read, the tracker terminal wrapper, the shared batch
// progression accessors) is defined below, next to the machinery it uses.
import { LITERAL_USER_ACTOR_ID } from "../runtime/kernel/actor_identity";
import {
	reconcileKernelAuthority,
	repairKernelAuthority,
	readTaskRecordRaw,
	withKernelStoreLockForTask,
} from "../runtime/kernel/storage";
import { inspectStorageLayout } from "../runtime/kernel/storage_paths";
import { migrateLegacyLayout } from "../runtime/kernel/storage_layout_migration";
import {
	readTaskIntent,
	parseTaskIntentV1,
	canonicalIntentHash,
	type ReadTaskIntentResult,
} from "../runtime/kernel/intent";
import { readBackendClaim, readTaskTombstone } from "../runtime/kernel/backend_claim";
import {
	createMutationAuthorityRegistry,
	digestOfAction,
	type CapabilityBindingV2,
	type MutationAuthorityRegistry,
} from "../runtime/kernel/authority_port";
import {
	createCanaryApplication,
	capabilityActionFor,
	type CanaryApplication,
} from "../runtime/kernel/canary_application";
import { findingsDigestV2 } from "../runtime/kernel/reducer";
import {
	projectAssurance,
	type AssuranceProjectionResult,
} from "../runtime/kernel/assurance_projection";
import type { TaskRecord } from "../runtime/kernel/types";
import type { RoleDelegationContext } from "../runtime/role_prompt_bridge";
import { buildLoopAction, buildLoopRoleDispatch } from "../runtime/loop_contract";
import {
	runGithubTrackerOperation,
	type GithubTrackerResult,
} from "../runtime/github_issue_tracker";
import { reviewReworkFindings } from "../runtime/assurance/coordinator";

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
		applyOrdinaryOperation: (ctx, input) => executeOrdinaryOperation(ctx, input),
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
export async function getSharedPiProgression(): Promise<AssuranceProgression> {
	let progression = (globalThis as any)[GLOBAL_PI_PROGRESSION_KEY] as AssuranceProgression | undefined;
	if (!progression) {
		progression = new AssuranceProgression(createPiAssuranceProgressionPorts());
		(globalThis as any)[GLOBAL_PI_PROGRESSION_KEY] = progression;
	}
	return progression;
}

/**
 * Advance one task through the shared session progression and translate the
 * progression result into the batch runner's advance report shape.
 */
export async function advancePiTask(root: string, taskId: string): Promise<any> {
	const progression = await getSharedPiProgression();
	const result = await progression.advance(taskId, { cwd: root });
	const facts = { diagnostics: result.diagnostics, environment_failure: result.environment_failure, recovery: result.recovery };
	if (result.state === "completed") return { state: "completed", ...facts };
	if (result.state === "stopped") return { state: "stopped", ...facts };
	if (result.state === "rework") return { state: "rework", operation: result.operation, summary: result.summary, ...facts };
	if (result.state === "review_ready") return { state: "review_ready", operation_id: result.operation_id, agent_params: result.agent_params, ...facts };
	if (result.state === "review_preparation_failed") return { state: result.state, operation: result.operation, operation_id: result.operation_id, reason: result.reason, ...facts };
	if (result.state === "blocked") return { state: "blocked", reason: result.reason, ...facts };
	return { state: "failed", reason: (result as { reason?: string }).reason ?? "advance failed", ...facts };
}

export default function (
	pi: ExtensionAPI,
	dependencies: CanaryWorkExtensionDependencies = {},
) {
	// One progression per extension load, published for the batch gate to reuse.
	// Reusing whatever instance a previous load left behind would leak another
	// session's Review reservations into this one, so the load always replaces it.
	const progression = new AssuranceProgression(createPiAssuranceProgressionPorts(dependencies));
	(globalThis as any)[GLOBAL_PI_PROGRESSION_KEY] = progression;

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
		railContext = ctx;
		clearTerminalTaskRailOnInput(ctx);
		await refreshTaskRail(ctx);
		return { action: "continue" } as const;
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
		progression.onSessionStart();
		if (!ctx) return;
		railContext = ctx;
		await reconcileRefsQuietly(ctx.cwd);
		if (ctx.mode !== "tui") return;
		await refreshTaskRail(ctx);
	});
	pi.on("tool_call", (event: { toolName?: string; input?: unknown; toolCallId?: string }, ctx?: ExtensionContext) => {
		if (ctx) railContext = ctx;
		if (event.toolName === "Agent") {
			// ADR 0017: correlate a reserved reviewer dispatch to its reservation.
			progression.piReviewHost.observeReviewDispatch(event.input as { prompt?: unknown; subagent_type?: unknown } | undefined, event.toolCallId);
		}
		if (event.toolName === "imm_canary_enrollment" && ctx) {
			const input = event.input as { task_id?: string } | undefined;
			if (input?.task_id) presentTaskRail(ctx, {
				task_id: input.task_id,
				state: "Planning",
				result: uxText(UX_LANG, "Preparing enrollment", "正在准备 Enrollment"),
				next: uxText(UX_LANG, "Review the native enrollment decision", "请审查原生 Enrollment 决策"),
			});
		}
	});
	pi.on("tool_result", (event: unknown, ctx?: ExtensionContext) => {
		if (ctx) railContext = ctx;
		const result = event as { toolName?: string; details?: Record<string, unknown>; toolCallId?: string; content?: Array<{ type?: string; text?: string }> };
		if (result.toolName === "Agent" && result.toolCallId) {
			// ADR 0017: record the reviewer's own result bytes for receipt-bound submission.
			const text = Array.isArray(result.content)
				? result.content.filter((part) => typeof part?.text === "string").map((part) => part.text as string).join("\n")
				: "";
			if (text) progression.piReviewHost.observeReviewResult(result.toolCallId, text);
		}
		if (result.toolName === "imm_canary_enrollment" && ctx) {
			const taskId = typeof result.details?.task_id === "string" ? result.details.task_id : undefined;
			if (taskId) presentTaskRailResult(ctx, taskId, result.details);
		}
	});
	pi.on("session_shutdown", async (_event: unknown, ctx?: ExtensionContext) => {
		resetInteractionPresentation(ctx ?? railContext);
		railContext = undefined;
		await progression.onSessionShutdown();
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
				Type.Object({ op: Type.Literal("request_authorization") }),
				Type.Object({ op: Type.Literal("request_stop") }),
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
				}),
				Type.Object({ op: Type.Literal("complete") }),
			]),
		}),
		prepareArguments: prepareActionArgs,
		execute: async (toolCallId: string, params: { task_id: string; action: { op: string; verdict?: unknown } }, signal: AbortSignal | undefined, onUpdate: ((update: ReturnType<typeof toolResult>) => void) | undefined, ctx: ExtensionContext) => {
			const { task_id: taskId, action } = params;
			railContext = ctx;
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
				const authority = await reconcileKernelAuthority(ctx.cwd, taskId);
				if (authority.state === "terminal_owner" || authority.state === "unowned") {
					// Repair is unrepresentable-by-construction removal: a leftover
					// retired claim file is inert, and the store already holds the
					// settled answer. Report the authority and write nothing.
					try {
						const repaired = await repairKernelAuthority(ctx.cwd, taskId, authority.revision);
						const result = {
							state: "recovered_retry",
							operation: action.op,
							authority: repaired,
							result: `No stale authority claim exists for ${taskId}; the store owns authority`,
							next_action: "retry the blocked managed request once",
						};
						return toolResult(JSON.stringify(result, null, 2), result);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						return failCanaryTool(taskId, action.op, "blocked", "authority_repair_failed", message, "inspect the kernel store authority state and retry");
					}
				}
				if (
					authority.state !== "repairable_stale_claim" ||
					authority.owner_task_id !== taskId
				) {
					const blocked = {
						state: "authority_conflict",
						operation: action.op,
						result: authority.diagnostic ?? `Authority state is ${authority.state}`,
						next_action: "inspect authority state",
					};
					presentTaskRailResult(ctx, taskId, blocked);
					return failCanaryTool(taskId, action.op, "authority_conflict", "authority_conflict", blocked.result, blocked.next_action);
				}
				try {
					const repaired = await repairKernelAuthority(ctx.cwd, taskId, authority.revision);
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
			if (action.op === "advance_assurance" || action.op === "request_stop" || action.op === "request_authorization" || action.op === "submit_review" || action.op === "approve_breaking_intent_revision") {
				if ((action.op === "request_stop" || action.op === "request_authorization" || action.op === "approve_breaking_intent_revision") && ctx.mode !== "tui")
					return failCanaryTool(taskId, action.op, "blocked", "tui_required", "literal-user authorization is TUI-only", "invoke the TUI Tool");
				const result = action.op === "advance_assurance"
					? await progression.advance(taskId, ctx, signal, (update: any) => {
						onUpdate?.(update);
						presentTaskRailResult(ctx, taskId, update.details as Record<string, unknown> | undefined);
					})
					: action.op === "submit_review"
						? await progression.submitMediated(taskId, ctx, action.verdict)
						: action.op === "approve_breaking_intent_revision"
							? await authorizeExactOperation(
								taskId,
								"approve-breaking-intent-revision",
								ctx,
								(action as { next_intent?: unknown }).next_intent,
							)
							: action.op === "request_stop"
								? await authorizeExactOperation(taskId, "stop", { ...ctx, signal: signal && ctx.signal ? AbortSignal.any([signal, ctx.signal]) : signal ?? ctx.signal })
								: await requestAuthorization(taskId, ctx);
				const enriched = await closeOutBatchChild(
					ctx,
					taskId,
					await enrichAssuranceResult(ctx, taskId, result as unknown as Record<string, unknown>),
				);
				presentTaskRailResult(ctx, taskId, enriched);
				throwIfCanaryToolFailure(taskId, action.op, enriched);
				return toolResult(JSON.stringify(enriched, null, 2), enriched);
			}
			const projection = await projectAssuranceForTask(ctx.cwd, taskId);
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
				const status = { plugin_version: PLUGIN_VERSION, ...state };
				const details = {
					state: "status",
					operation: "status",
					plugin_version: PLUGIN_VERSION,
					lifecycle: state.lifecycle,
					artifact_state: state.artifact_state,
					task_state: state,
					result: `${fresh}/${total} acceptance items fresh; ${blockers} blocker${blockers === 1 ? "" : "s"}`,
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
				const result = (await executeOrdinaryOperation(ctx, {
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

	type AuthorizationOutcome =
		| { state: "applied"; operation: AuthorizeOperation; lifecycle?: string; delivery_error?: string }
		| { state: "cancelled"; operation: AuthorizeOperation; reason: string }
		| { state: "blocked"; reason: string };

	async function authorizeExactOperation(
		taskId: string,
		operation: AuthorizeOperation,
		ctx: ExtensionContext,
		nextIntentInput?: unknown,
	): Promise<AuthorizationOutcome> {
		if (ctx.mode !== "tui") return { state: "blocked", reason: "imm_kernel_canary mutation is TUI-only" };
		let nextIntent: Awaited<ReturnType<typeof parseTaskIntentV1>> | undefined;
		let nextIntentHash: string | undefined;
		let nextIntentRef: { path: string; content_hash: string } | undefined;
		if (operation === "approve-breaking-intent-revision") {
			try {
				nextIntent = await parseTaskIntentV1(nextIntentInput);
				if (nextIntent.task_id !== taskId)
					throw new Error("next intent task_id must match the enrolled task");
				nextIntentHash = await canonicalIntentHash(nextIntent);
			} catch (error) {
				return {
					state: "blocked",
					reason: error instanceof Error ? error.message : String(error),
				};
			}
		}
			let invocation: InvocationToken;
			const authorizationGeneration = progression.sessionGenerationValue();
			try {
				if (operation === "stop" && progression.active(taskId)?.state === "running")
					throw new Error("assurance operation is already running");
				invocation = progression.openInvocation(taskId);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			notifyOnce(ctx, `authorization-open:${taskId}:${reason}`, `cannot authorize ${taskId}: ${reason}`, "error");
			return { state: "blocked", reason };
		}
		try {
		const projection = await projectAssuranceForTask(ctx.cwd, taskId);
		if (projection.error || !projection.claim) {
			const reason = projection.error ?? "no active backend claim";
			notifyOnce(ctx, `authorization-claim:${taskId}:${reason}`, `cannot authorize ${taskId}: ${reason}`, "error");
			progression.closeInvocation(invocation);
			return { state: "blocked", reason };
		}
		const priorIntent = await readTaskIntentForRecord(ctx.cwd, taskId);
		const sidecar = nextIntent ? join(ctx.cwd, priorIntent.intent_ref.path) : undefined;
		const priorBytes = sidecar ? readFileSync(sidecar) : undefined;
		const stagedSnapshot = sidecar ? captureStagedIntent(ctx.cwd, priorIntent.intent_ref.path) : undefined;
		let stagedNextDiffHash: string | undefined;
		const restoreStagedIntent = (): void => {
			if (!stagedSnapshot) return;
			restoreStagedIntentShared(ctx.cwd, stagedSnapshot);
		};
		if (nextIntent) {
			try {
				if (!sidecar || !priorBytes) throw new Error("breaking revision sidecar is missing");
				if (
					priorIntent.intent.revision !== projection.projection.intent_revision
					|| priorIntent.content_hash !== projection.projection.intent_content_hash
				) throw new Error("Intent changed while preparing the breaking revision");
				writeFileSync(sidecar, `${JSON.stringify(nextIntent, null, 2)}\n`);
				execFileSync("git", ["add", "--", priorIntent.intent_ref.path], {
					cwd: ctx.cwd,
					stdio: ["ignore", "pipe", "pipe"],
				});
				const stagedRecord = await readTaskRecordRaw(ctx.cwd, taskId);
				if (!stagedRecord.record || stagedRecord.revision !== projection.projection.record_revision)
					throw new Error("TaskRecord changed while preparing the breaking revision");
				stagedNextDiffHash = taskDeliveryIdentity(ctx.cwd, stagedRecord.record).diff_hash;
			} catch (error) {
				let restoreError: unknown;
				try { restoreStagedIntent(); } catch (err) { restoreError = err; }
				const primaryReason = error instanceof Error ? error.message : String(error);
				const reason = restoreError
					? `${primaryReason}; additionally, ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`
					: primaryReason;
				progression.closeInvocation(invocation);
				return { state: "blocked", reason };
			}
		}
		let userDecisionOperation: ReturnType<typeof buildUserDecisionOperation> | undefined;
		if (operation === "resolve-user-decision") {
			try {
				const current = await readTaskRecordRaw(ctx.cwd, taskId);
				if (!current.record) throw new Error(`task ${taskId} has no TaskRecord v2`);
				if (current.revision !== projection.projection.record_revision)
					throw new Error("task record changed while preparing user decision");
				userDecisionOperation = buildUserDecisionOperation(current.record);
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				notifyOnce(ctx, `authorization-decision:${taskId}:${reason}`, `cannot authorize ${taskId}: ${reason}`, "error");
				progression.closeInvocation(invocation);
				return { state: "blocked", reason };
			}
		}
		const dialogSummary = [
			`Task: ${taskId}`,
			`Decision: ${operation}`,
			`State: ${projection.projection.lifecycle}:${projection.projection.artifact_state} | Claim: ${projection.claim.lifecycle_status}`,
		].join("\n");
		const intentDelta = nextIntent
			? [
					`Risk: ${priorIntent.intent.risk} -> ${nextIntent.risk}`,
					`Goal: ${priorIntent.intent.goal} -> ${nextIntent.goal}`,
					`Scope added: ${nextIntent.scope_hint.filter((path) => !priorIntent.intent.scope_hint.includes(path)).join(", ") || "none"}`,
					`Scope removed: ${priorIntent.intent.scope_hint.filter((path) => !nextIntent.scope_hint.includes(path)).join(", ") || "none"}`,
					`Acceptance added: ${nextIntent.acceptance.filter((item) => !priorIntent.intent.acceptance.some((prior) => prior.id === item.id)).map((item) => item.id).join(", ") || "none"}`,
					`Acceptance removed: ${priorIntent.intent.acceptance.filter((item) => !nextIntent.acceptance.some((next) => next.id === item.id)).map((item) => item.id).join(", ") || "none"}`,
					`Acceptance changed: ${nextIntent.acceptance.filter((item) => { const prior = priorIntent.intent.acceptance.find((candidate) => candidate.id === item.id); return prior && (prior.assertion !== item.assertion || prior.verification !== item.verification); }).map((item) => item.id).join(", ") || "none"}`,
				]
			: [];
		const dialogDetails = [
			`Operation: ${operation}`,
			...(userDecisionOperation
				? [
						`Finding: ${userDecisionOperation.finding_id}`,
						`Resolution: ${userDecisionOperation.resolution}`,
					]
				: []),
			...(operation === "authorize-rework"
				? [`Replan boundaries: ${projection.projection.replan_required_ids.join(", ")}`]
				: []),
			...(nextIntent
				? [
						`Next Intent: rev ${nextIntent.revision} (${nextIntentHash})`,
						...intentDelta,
						`Acceptance Items: ${priorIntent.intent.acceptance.length} -> ${nextIntent.acceptance.length}`,
						`Next staged diff: ${stagedNextDiffHash}`,
					]
				: []),
			`Claim: ${projection.claim.lifecycle_status}`,
			`Record revision: ${projection.projection.record_revision}`,
			`State: ${projection.projection.lifecycle}:${projection.projection.artifact_state}`,
			`Intent: rev ${projection.projection.intent_revision} (${projection.projection.intent_content_hash})`,
			`Diff: ${projection.projection.diff_hash}`,
		].join("\n");
		const snapshotDigestRef = projection.projection.record_revision;
		let confirmed = false;
		const attentionReason: UserAttentionReason = operation === "approve-breaking-intent-revision"
			? "breaking_intent_revision"
			: "review_authorization";
		presentTaskRail(ctx, {
			task_id: taskId,
			state: "Approval required",
			result: uxText(UX_LANG, `${operation} requires your confirmation`, `${operation} 需要您的确认`),
			next: uxText(UX_LANG, `Decide ${operation}`, `请决策 ${operation}`),
		});
		const attention = {
			attention_id: randomUUID(),
			task_id: taskId,
			reason: attentionReason,
			label: uxText(UX_LANG, `${operation} approval required`, `${operation} 待您批准`),
		};
		try {
			const selected = await requestAuthorityDialog(pi, ctx, attention, {
				title: uxText(UX_LANG, `Authorize ${operation}?`, `是否批准 ${operation}？`),
				summary: dialogSummary,
				details: dialogDetails,
				signal: ctx.signal,
				actions: [
					{ value: "authorize", label: uxText(UX_LANG, "Authorize", "批准"), description: uxText(UX_LANG, `Apply ${operation} after re-checking state`, `重新校验状态后应用 ${operation}`) },
					{ value: "cancel", label: uxText(UX_LANG, "Cancel", "取消"), description: uxText(UX_LANG, "Leave managed authority unchanged", "保持托管权限状态不变") },
				],
			});
			confirmed = selected === "authorize";
		} catch (error) {
			if (nextIntent) {
				restoreStagedIntent();
			}
			if (
				operation !== "stop" &&
				operation !== "approve-breaking-intent-revision" &&
				operation !== "authorize-rework"
			)
				await recordCancelledUserDecision(ctx, taskId, operation, snapshotDigestRef).catch(() => undefined);
			progression.closeInvocation(invocation);
			if (operation === "stop" && !ctx.signal?.aborted && !(error instanceof Error && error.name === "AbortError")) {
				return { state: "blocked", reason: "native stop confirmation failed; retry request_stop in this Host" };
			}
			return { state: "cancelled", operation, reason: "confirmation aborted" };
		}
		if (!confirmed || ctx.signal?.aborted) {
			if (nextIntent) {
				restoreStagedIntent();
			}
			if (
				operation !== "stop" &&
				operation !== "approve-breaking-intent-revision" &&
				operation !== "authorize-rework"
			)
				await recordCancelledUserDecision(ctx, taskId, operation, snapshotDigestRef).catch(() => undefined);
			progression.closeInvocation(invocation);
			return { state: "cancelled", operation, reason: "cancelled" };
		}
		if (!progression.sessionActiveValue() || progression.sessionGenerationValue() !== authorizationGeneration || progression.invocationState(invocation) !== "open") {
			if (nextIntent) {
				restoreStagedIntent();
			}
			notifyOnce(ctx, `authorization-session:${taskId}:${operation}`, `authorize ${operation}: session changed; confirmation discarded`, "warning");
			progression.closeInvocation(invocation);
			return { state: "blocked", reason: "session changed; confirmation discarded" };
		}
			// Linearization point: only this fresh affirmative continuation
			// may mint/apply; timeout/cancel already won open -> cancelled.
			try {
				progression.commitInvocation(invocation);
			} catch (error) {
				if (nextIntent) {
					restoreStagedIntent();
				}
				const reason = error instanceof Error ? error.message : String(error);
				notifyOnce(ctx, `authorization-commit:${taskId}:${operation}:${reason}`, `authorize ${operation} aborted: ${reason}`, "error");
				return { state: "blocked", reason };
			}
			const { registry, app } = await authorityPair();
			const now = new Date().toISOString();
			if (nextIntent) {
				nextIntentRef = {
					path: `docs/plans/${nextIntent.task_id}.intent.json`,
					content_hash: nextIntentHash!,
				};
			}
			const exactOperation = operation === "stop"
				? { op: "stop" as const, reason: "literal user requested task stop" }
				: operation === "approve-breaking-intent-revision"
					? {
							op: "approve_breaking_intent_revision" as const,
							next_intent: nextIntent!,
							next_intent_ref: nextIntentRef!,
						}
					: operation === "authorize-rework"
						? { op: "authorize_rework" as const }
						: userDecisionOperation!;
				// The exact host-built operation is shared by capability digest and
				// application payload; command arguments cannot inject authority fields.
				try {
					if (nextIntent) await dependencies.authorizationAfterSidecarStage?.();
					// Re-read the owner record after confirmation and compare the staged
					// candidate digest immediately before capability issuance.
					const liveRecord = nextIntent ? await readTaskRecordRaw(ctx.cwd, taskId) : null;
					if (nextIntent && (!liveRecord?.record || liveRecord.revision !== projection.projection.record_revision || !stagedNextDiffHash))
						throw new Error("TaskRecord changed before the breaking revision digest");
					const operationDiffHash = liveRecord?.record
						? taskDeliveryIdentity(ctx.cwd, liveRecord.record).diff_hash
						: projection.projection.diff_hash;
					if (nextIntent && operationDiffHash !== stagedNextDiffHash)
						throw new Error("staged next-state diff changed after native confirmation");
					const capability = await mintCapability(registry, {
						authority_kind: "user",
						task_id: taskId,
						run_id: projection.projection.run_id,
						action_kind: exactOperation.op,
						expected_record_hash: projection.projection.record_revision,
						intent_revision: nextIntent?.revision ?? projection.projection.intent_revision,
						intent_content_hash: nextIntentHash ?? projection.projection.intent_content_hash,
						diff_hash: operationDiffHash,
						actor_id: LITERAL_USER_ACTOR_ID,
						...(exactOperation.op === "approve_breaking_intent_revision"
							? { next_intent: exactOperation.next_intent, next_intent_ref: exactOperation.next_intent_ref }
							: {}),
						...(exactOperation.op === "resolve_user_decision"
							? { finding_id: exactOperation.finding_id, resolution: exactOperation.resolution }
							: {}),
						...(exactOperation.op === "stop" ? { reason: exactOperation.reason } : {}),
						now,
					});
					const result = (await app.execute({
						root: ctx.cwd,
						task_id: taskId,
						operation: { ...exactOperation, capability, actor_id: LITERAL_USER_ACTOR_ID } as never,
						prior_intent_token: priorIntent.token,
						diffProvider: (root: string, record: TaskRecord) => diffSnapshotOf(root, record),
						now,
					})) as unknown as { record: { lifecycle: string; artifact_state: string; intent_ref: { path: string }; intent_snapshot: { scope_hint: string[] } } };
					if (exactOperation.op === "stop") progression.releaseStoppedReview(taskId);
					if (
						exactOperation.op === "stop" ||
						exactOperation.op === "authorize_rework" ||
						exactOperation.op === "approve_breaking_intent_revision"
					) stagePlanningArtifactTransition(ctx.cwd, result.record);
					return { state: "applied", operation, lifecycle: result.record.lifecycle };
			} catch (error) {
				if (stagedSnapshot) {
					const current = await readTaskRecordRaw(ctx.cwd, taskId);
					if (current.record?.intent_snapshot.revision === priorIntent.intent.revision) restoreStagedIntent();
				}
				throw error;
			}
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				if (operation === "stop") {
					const terminal = await projectAssuranceForTask(ctx.cwd, taskId).catch(() => null);
					if (terminal && !terminal.error && terminal.projection.lifecycle === "stopped") {
						progression.releaseStoppedReview(taskId);
						return { state: "applied", operation, lifecycle: "stopped", delivery_error: reason };
					}
				}
				notifyOnce(ctx, `authorization-apply:${taskId}:${operation}:${reason}`, `authorize failed: ${reason}`, "error");
				return { state: "blocked", reason };
			} finally {
				progression.closeInvocation(invocation);
			}
	}

	async function requestAuthorization(taskId: string, ctx: ExtensionContext): Promise<AuthorizationOutcome> {
		if (ctx.mode !== "tui") return { state: "blocked", reason: "imm_kernel_canary mutation is TUI-only" };
		if (progression.isInvocationOpen(taskId))
			return { state: "blocked", reason: `task ${taskId} already has an open invocation; concurrent assure/authorize is rejected` };
		const projection = await projectAssuranceForTask(ctx.cwd, taskId);
		if (projection.error || !projection.claim)
			return { state: "blocked", reason: projection.error ?? "no active backend claim" };
		await dependencies.authorizationBeforeRecordRead?.();
		const read = await readTaskRecordRaw(ctx.cwd, taskId);
		if (!read.record) return { state: "blocked", reason: `task ${taskId} has no TaskRecord v3` };
		if (read.revision !== projection.projection.record_revision)
			return { state: "blocked", reason: "TaskRecord changed while deriving authorization operation" };
		const derived = deriveAuthorizationOperation({
			readiness: projection.projection.authorization,
		});
		if ("blocked" in derived) return { state: "blocked", reason: derived.blocked };
		return authorizeExactOperation(taskId, derived.operation, ctx);
	}
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
	const { app } = await authorityPair();
	await app.execute({
		root: ctx.cwd,
		task_id: taskId,
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
		prior_intent_token: (await readTaskIntentForRecord(ctx.cwd, taskId)).token,
		diffProvider: (root: string, record: TaskRecord) => diffSnapshotOf(root, record),
		now: new Date().toISOString(),
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
	const currentPath = readTaskRecordRaw(root, taskId).record?.intent_ref.path;
	return readTaskIntent(root, taskId, currentPath);
}

async function markGithubTaskTerminal(
	root: string,
	input: { task_id: string; phase: "done" | "stopped"; terminal_event_id: string },
): Promise<GithubTrackerResult> {
	return runGithubTrackerOperation(root, { op: "mark-terminal", ...input });
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

export async function projectAssuranceForTask(root: string, taskId: string): Promise<AssuranceProjectionResult> {
	return projectAssurance(root, taskId);
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

async function mintCapability(
	registry: MutationAuthorityRegistry,
	input: {
		authority_kind: "review" | "qa" | "user";
		task_id: string;
		run_id: string | null;
		action_kind: string;
		expected_record_hash: string;
		intent_revision: number;
		intent_content_hash: string;
		diff_hash: string;
		actor_id: string;
		findings?: unknown[];
		approval?: unknown;
		next_intent?: unknown;
		next_intent_ref?: unknown;
		reason?: string;
		finding_id?: string;
		resolution?: string;
		now: string;
	},
) {
	const now = input.now;
	// The action digest is computed by the Kernel from the canonical action
	// builder (same field order and payload the consuming application will
	// inspect), so the minted capability always matches the applied action.
	const action = (await capabilityActionFor({
		op: input.action_kind,
		task_id: input.task_id,
		at: now,
		actor_id: input.actor_id,
		...(input.reason !== undefined ? { reason: input.reason } : {}),
		...(input.findings !== undefined ? { findings: input.findings } : {}),
		...(input.approval !== undefined ? { approval: input.approval } : {}),
		...(input.next_intent !== undefined ? { next_intent: input.next_intent } : {}),
		...(input.next_intent_ref !== undefined ? { next_intent_ref: input.next_intent_ref } : {}),
		...(input.finding_id !== undefined ? { finding_id: input.finding_id } : {}),
		...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
	})) as unknown as Record<string, unknown>;
	const digest = await digestOfAction(action as never);
	const binding: CapabilityBindingV2 = {
		authority_kind: input.authority_kind,
		task_id: input.task_id,
		...(input.run_id ? { run_id: input.run_id } : {}),
		action_digest: digest,
		expected_record_hash: input.expected_record_hash,
		intent_revision: input.intent_revision,
		intent_content_hash: input.intent_content_hash,
		diff_hash: input.diff_hash,
		actor_id: input.actor_id,
		confirmation_ref: `pi-confirm-${createHash("sha256").update(
			`${input.task_id}\0${now}\0${input.intent_revision}\0${input.intent_content_hash}\0${input.diff_hash}`,
		).digest("hex").slice(0, 16)}`,
		findings_digest:
			input.action_kind === "request_rework"
				? await findingsDigestV2(input.findings as never[])
				: null,
	};
	return registry.issue(binding);
}

let authorityPairPromise: Promise<{ registry: MutationAuthorityRegistry; app: CanaryApplication }> | null = null;
function authorityPair(): Promise<{ registry: MutationAuthorityRegistry; app: CanaryApplication }> {
	if (!authorityPairPromise) {
		authorityPairPromise = (async () => {
			const registry = await createMutationAuthorityRegistry();
			const app = await createCanaryApplication(registry);
			return { registry, app };
		})();
	}
	return authorityPairPromise;
}

async function executeOrdinaryOperation(
	ctx: HostContext,
	input: { taskId: string; operation: { op: string; actor_id: string; next_intent?: unknown } },
): Promise<unknown> {
	const { app } = await authorityPair();
	const operation = input.operation.op === "revise_intent"
		? { ...input.operation, next_intent: await parseTaskIntentV1(input.operation.next_intent) }
		: input.operation;
	const priorIntent = await readTaskIntentForRecord(ctx.cwd, input.taskId);
	const sidecar = join(ctx.cwd, priorIntent.intent_ref.path);
	const priorBytes = operation.op === "revise_intent" ? readFileSync(sidecar) : null;
	// A content-changing revision writes the sidecar before the kernel's drift
	// check runs; an unstaged write is itself scoped drift and deadlocks the
	// revision. Mirror the breaking-revision path: stage the written sidecar
	// (worktree == index) and restore the exact prior state on failure.
	const priorStaged = priorBytes !== null ? captureStagedIntent(ctx.cwd, priorIntent.intent_ref.path) : null;
	try {
		if (priorBytes) {
			writeFileSync(sidecar, `${JSON.stringify(operation.next_intent, null, 2)}\n`);
			execFileSync("git", ["add", "--", priorIntent.intent_ref.path], {
				cwd: ctx.cwd,
				stdio: ["ignore", "pipe", "pipe"],
			});
		}
		const result = await app.execute({
			root: ctx.cwd,
			task_id: input.taskId,
			operation: operation as never,
			prior_intent_token: priorIntent.token,
			diffProvider: (root: string, record: TaskRecord) => diffSnapshotOf(root, record),
			now: new Date().toISOString(),
		});
		if (operation.op === "freeze_artifacts" || operation.op === "stop")
			stagePlanningArtifactTransition(
				ctx.cwd,
				(result as { record: Parameters<typeof stagePlanningArtifactTransition>[1] }).record,
			);
		return result;
	} catch (error) {
		if (priorBytes) {
			const current = await readTaskRecordRaw(ctx.cwd, input.taskId);
			if (current.record?.intent_snapshot.revision === priorIntent.intent.revision && priorStaged) {
				restoreStagedIntentShared(ctx.cwd, priorStaged);
			}
		}
		throw error;
	}
}

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

/**
 * Gate-free closeout: a batch child that reached Kernel `done` in the foreground
 * re-enters the batch in the same call, reusing its authorization. Only `done`
 * continues; stopped, parked and Review-pending children end where they do
 * today. The continuation is transport: the Kernel result is returned
 * unchanged, and any failure is reported beside it with one retry action.
 */
async function closeOutBatchChild(
	ctx: ExtensionContext,
	taskId: string,
	enriched: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const taskState = enriched.task_state as { lifecycle?: unknown } | undefined;
	if (taskState?.lifecycle !== "done") return enriched;
	let slug: string | null;
	try {
		slug = findResumableBatchSlugForTask(ctx.cwd, taskId);
	} catch {
		return enriched;
	}
	if (!slug) return enriched;
	try {
		// The batch commit takes exactly the scope envelope plus this task's own
		// audit evidence and refuses unstaged changes: stage only that evidence.
		if (existsSync(join(ctx.cwd, ".imm", "audit", taskId)))
			execFileSync("git", ["-C", ctx.cwd, "add", "--", `.imm/audit/${taskId}`], { stdio: "ignore" });
		const batch = await executePiUnattendedBatch({ root: ctx.cwd, initiativeSlug: slug, reuseOnly: true, signal: ctx.signal });
		return { ...enriched, batch };
	} catch (error) {
		return {
			...enriched,
			batch: {
				state: "rejected",
				reason: `batch continuation failed: ${error instanceof Error ? error.message : String(error)}`,
				recovery_action: "call start_unattended_batch with the same Initiative to continue the batch",
			},
		};
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
	let tracker: Awaited<ReturnType<typeof markGithubTaskTerminal>> | undefined;
	await reconcileRefsQuietly(ctx.cwd);
	// One shared projection: the Claude Host runs the same step, so the opted-in
	// terminal tracker outcome does not depend on which Host settled the task.
	tracker = await projectTerminalTrackerState({
		root: ctx.cwd,
		task_id: taskId,
		projection,
		tombstone: await readTaskTombstone(ctx.cwd, taskId),
		markTerminal: (root, input) => markGithubTaskTerminal(root, input),
	});
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
	const recovery = recoveryActionForAssuranceFailure(
		"error" in taskState ? taskState.error : result.reason,
	);
	if (recovery) return recovery;
	if (result.recovery_error || "error" in taskState) return "inspect authority state";
	if (result.state === "review_preparation_failed") return "repair Review preparation, then retry advance_assurance; QA is already committed";
	if (result.code === "verdict_invalid") return "fix the verdict payload and resubmit submit_review; the Review reservation remains active; do not re-dispatch the reviewer";
	if (taskState.lifecycle === "done" || taskState.lifecycle === "stopped") return "none";
	switch (result.state) {
		case "review_ready": return "invoke the foreground reviewer and submit its verdict";
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
			...(details.environment_failure ? { environment_failure: true } : {}),
			...(details.recovery ? { recovery: details.recovery } : {}),
			...(details.recovery_error ? { recovery_error: details.recovery_error } : {}),
		},
	);
}

// Re-exported pure lifecycle helpers and types (single source of truth in the
// progression module; the extension keeps its historical export surface).
export {
	AssuranceProgression,
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
