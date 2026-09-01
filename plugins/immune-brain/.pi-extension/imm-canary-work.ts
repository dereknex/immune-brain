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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	parseVerificationDescriptor,
	canonicalDescriptorBytes,
	resolveBunRunner,
	assertRunnerCompatible,
	runFixedVerification,
	VerificationAbortedError,
	findingsDigest,
	type FrozenRunner,
	type VerificationDescriptor,
} from "./pi-canary-verification";
import {
	captureReviewBundle,
	captureReviewManifest,
	listReviewRefs,
	reconcileReviewRefs,
	writeNativeReviewEvidence,
	type ReviewBundle,
	type ReviewManifestV5,
	type ReviewRevision,
} from "./pi-canary-review-bundle";
import type { InvocationToken } from "./pi-canary-invocations";
import { qaFindingId } from "./pi-canary-qa-findings";
import {
	reservedAgentParams,
	type ReservedAgentParams,
} from "./pi-canary-native-review";
import {
	renderCanaryCall,
	renderCanaryResult,
	type AssuranceRole,
} from "./pi-canary-assurance";
import {
	USER_ATTENTION_EVENT,
	clearTerminalTaskRailOnInput,
	loopResultDetails,
	notifyOnce,
	presentTaskRail,
	presentTaskRailResult,
	renderStructuredCall,
	renderStructuredResult,
	requestAuthorityDialog,
	resetInteractionPresentation,
	type UserAttentionEventV1,
	type UserAttentionReason,
} from "./pi-canary-interaction";
import { isToolFailureState, throwToolFailure } from "./pi-canary-tool-failure";
import { taskDiffHash, taskRevisionDiffHash, captureGitTaskSnapshot } from "../runtime/workspace_scope";
import {
	AssuranceProgression,
	buildReviewPrompt,
	classifyReviewWorkload,
	deriveQaJobTimeoutMs,
	deriveGithubTerminalProjectionInput,
	parseAssuranceVerdict,
	snapshotDigest,
	QA_JOB_TIMEOUT_SECONDS,
	REVIEW_DISPATCH_TIMEOUT_MS,
	REVIEW_PREPARATION_TIMEOUT_MS,
	REVIEW_TIMING_PROFILES,
	REVIEW_VERDICT_VALIDATION_TIMEOUT_MS,
	type AssuranceAdvanceResult,
	type AssuranceProgressionPorts,
	type AssuranceSubmitReviewResult,
	type AssuranceVerdict,
	type QaVerificationProgress,
	type SnapshotDescriptor,
} from "./pi-canary-assurance-progression";

// The Kernel runtime graph is never type-checked from this extension: static
// imports resolve to ./runtime-stub.ts (relative so the Pi extension loader
// can resolve them at runtime), and the stub forwards to the real Kernel
// modules via dynamic import.
import {
	createMutationAuthorityRegistry,
	createCanaryApplication,
	buildLoopAction,
	buildLoopRoleDispatch,
	readBackendClaim,
	readTaskTombstone,
	markGithubTaskTerminal,
	reconcileKernelAuthority,
	repairKernelAuthority,
	readTaskRecord,
	withKernelStoreLock,
	inspectStorageLayout,
	migrateLegacyLayout,
	readTaskIntent,
	parseTaskIntentV1,
	canonicalIntentHash,
	projectAssurance,
	deriveAssuranceAuthorization,
	findingsDigestV2,
	capabilityActionFor,
	digestOfAction,
	type AssuranceAuthorizationReadiness,
	type AssuranceProjectionResult,
	type TaskRecordRead,
	type CanaryApplication,
	type MutationAuthorityRegistry,
	type CapabilityBindingV2,
} from "./runtime-stub";
import { invocationRegistry } from "./pi-canary-assurance-progression";

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const LOOP_OWNERS = ["plan", "kernel", "brainstorm", "planner", "loop"] as const;
const LOOP_TARGETS = [
	"step",
	"test-repair",
	"pr-repair",
	"architecture-exploration",
	"advisory-review",
	"compounder",
] as const;
const LOOP_DIRECT_ROLES = ["qa", "code-review", "ui-review"] as const;
const KERNEL_OPERATIONS = [
	"status",
	"freeze_artifacts",
	"record_finding",
	"resolve_finding",
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
	| "record-user-approval"
	| "approve-breaking-intent-revision"
	| "resolve-user-decision"
	| "stop";

export interface SnapshotDescriptorInput {
	root: string;
	task_id: string;
	role: AssuranceRole;
	record_revision: string;
	workspace_revision: string;
	intent_revision: number;
	intent_content_hash: string;
	diff_hash: string;
	lifecycle: string;
	artifact_state: string;
	risk?: "routine" | "material" | "critical";
	fresh_acceptance_ids: string[];
	missing_acceptance_ids: string[];
	stale_attestation_ids: string[];
	acceptance: Array<{ id: string; assertion: string; verification: string }>;
	dirty_files?: string[];
	review_bundle_digest?: string | null;
	/** Present only when Review authority binds an immutable Git revision (v4). */
	review_revision?: {
		contract: "assurance_kernel/review_revision_identity/v1";
		base_head: string;
		review_commit: string;
		review_tree: string;
		manifest_digest: string;
	};
}

export function buildSnapshot(input: SnapshotDescriptorInput): SnapshotDescriptor {
	return {
		contract: "assurance_kernel/assurance_snapshot/v2",
		task_id: input.task_id,
		role: input.role,
		record_revision: input.record_revision,
		workspace_revision: input.workspace_revision,
		intent_revision: input.intent_revision,
		intent_content_hash: input.intent_content_hash,
		diff_hash: input.diff_hash,
		lifecycle: input.lifecycle,
		artifact_state: input.artifact_state,
		risk: input.risk ?? "material",
		fresh_acceptance_ids: input.fresh_acceptance_ids,
		missing_acceptance_ids: input.missing_acceptance_ids,
		stale_attestation_ids: input.stale_attestation_ids,
		acceptance: input.acceptance,
		dirty_files: [...(input.dirty_files ?? [])].sort(),
		review_bundle_digest: input.review_bundle_digest ?? null,
		...(input.review_revision ? { review_revision: input.review_revision } : {}),
		root: resolve(input.root),
	};
}

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

export default function (
	pi: ExtensionAPI,
	dependencies: CanaryWorkExtensionDependencies = {},
) {
	const progression = new AssuranceProgression({
		projectTask: (root, taskId) => projectAssuranceState(root, taskId),
		readTaskRecord: (root, taskId) => readTaskRecord(root, taskId),
		readTaskIntent: (root, taskId) => readTaskIntent(root, taskId),
		frozenRunner: () => frozenRunner(),
		buildAssurance: (root, taskId, role, projection, runner) =>
			(dependencies.buildAssurance ?? buildAssuranceSnapshot)(root, taskId, role, projection, runner),
		ensureReviewRevision: (root, taskId, projection) => ensureTaskReviewRevision(root, taskId, projection),
		runQa: (snapshot, descriptors, runner, options) =>
			(dependencies.runQa ?? runDeterministicQa)(snapshot, descriptors, runner, options),
		writeReviewEvidence: (input) =>
			(dependencies.writeReviewEvidence ?? writeNativeReviewEvidence)(input),
		applyVerdict: (ctx, input) =>
			applyAssuranceVerdict(
				ctx,
				input.snapshot,
				input.verdict,
				input.invocation,
				input.actorId,
				input.hooks,
			),
		applyOrdinaryOperation: (ctx, input) => executeOrdinaryOperation(ctx, input),
		advanceBeforeProjection: dependencies.advanceBeforeProjection,
		qaBeforeProjection: dependencies.qaBeforeProjection,
		qaBeforeAuthorityCommit: dependencies.qaBeforeAuthorityCommit,
		qaOnAuthorityCommit: dependencies.qaOnAuthorityCommit,
		qaAfterAuthorityCommit: dependencies.qaAfterAuthorityCommit,
		qaJobTimeoutMs: dependencies.qaJobTimeoutMs,
	} satisfies AssuranceProgressionPorts);

	let railContext: ExtensionContext | undefined;
	const refreshTaskRail = async (ctx: ExtensionContext) => {
		try {
			const claim = await readBackendClaim(ctx.cwd);
			if (!claim) return;
			const projection = await projectAssuranceState(ctx.cwd, claim.task_id);
			if (projection.error) {
				presentTaskRail(ctx, {
					task_id: claim.task_id,
					state: "Blocked",
					result: projection.error,
					next: "Inspect authority state",
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
		if (event.toolName === "imm_canary_enrollment" && ctx) {
			const input = event.input as { task_id?: string } | undefined;
			if (input?.task_id) presentTaskRail(ctx, {
				task_id: input.task_id,
				state: "Planning",
				result: "Preparing enrollment",
				next: "Review the native enrollment decision",
			});
		}
		return progression.observeToolCall(event);
	});
	pi.on("tool_result", (event: unknown, ctx?: ExtensionContext) => {
		if (ctx) railContext = ctx;
		const result = event as { toolName?: string; details?: Record<string, unknown> };
		if (result.toolName === "imm_canary_enrollment" && ctx) {
			const taskId = typeof result.details?.task_id === "string" ? result.details.task_id : undefined;
			if (taskId) presentTaskRailResult(ctx, taskId, result.details);
		}
		progression.observeToolResult(event as Parameters<AssuranceProgression["observeToolResult"]>[0]);
	});
	pi.on("tool_execution_end", (event: unknown) => {
		progression.observeToolEnd(event as Parameters<AssuranceProgression["observeToolEnd"]>[0]);
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
		promptSnippet: "Kernel canary: record facts, run foreground QA, then submit one native Review receipt without polling.",
		promptGuidelines: [
			"Only the exact enrolled canary task is routable; verify the active backend claim first via status.",
			"After implementation and focused verification, freeze the artifacts, call advance_assurance, and consume its direct terminal result; do not poll or create a detached job.",
			"When advance_assurance returns review_ready, invoke the exact foreground Agent parameters from agent_params once, then call submit_review.",
			"For a complete breaking revision, call approve_breaking_intent_revision with the complete next_intent directly; do not ask for chat pre-confirmation because the host opens the single native confirmation before applying it.",
			"For a proven stale authority claim, call repair_authority_state directly; do not ask for chat pre-confirmation because the host opens the single native confirmation.",
			"After awaiting_user, call request_authorization directly so the host opens the single native confirmation; do not ask for chat pre-confirmation or ask the user to copy or report a command.",
		],
		parameters: Type.Object({
			task_id: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
			action: Type.Union([
				Type.Object({ op: Type.Literal("status") }),
				Type.Object({ op: Type.Literal("advance_assurance") }),
				Type.Object({ op: Type.Literal("submit_review") }),
				Type.Object({ op: Type.Literal("request_authorization") }),
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
		execute: async (toolCallId: string, params: { task_id: string; action: { op: string } }, signal: AbortSignal | undefined, onUpdate: ((update: ReturnType<typeof toolResult>) => void) | undefined, ctx: ExtensionContext) => {
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
					await withKernelStoreLock(ctx.cwd, () => undefined);
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
				presentTaskRail(ctx, {
					task_id: taskId,
					state: "Approval required",
					result: "Kernel authority repair requires literal-user approval",
					next: "Decide whether to repair the stale claim",
				});
				const repairSelection = await requestAuthorityDialog(pi, ctx, {
					attention_id: randomUUID(),
					task_id: taskId,
					reason: "authority_repair",
					label: "Kernel authority repair required",
				}, {
					title: "Repair Kernel authority state?",
					summary: [
						`Owner: ${taskId}`,
						`Terminal lifecycle: ${authority.owner_lifecycle}`,
						`Claim lifecycle: ${authority.claim_lifecycle_status}`,
					].join("\n"),
					details: [
						`Projection revision: ${authority.revision}`,
						"Action: remove only the stale global claim; preserve TaskRecord and tombstone.",
					].join("\n"),
					signal: ctx.signal ?? signal,
					actions: [
						{ value: "repair", label: "Repair stale claim", description: "Remove only the stale global claim" },
						{ value: "cancel", label: "Cancel", description: "Preserve all authority state unchanged" },
					],
				});
				if (repairSelection !== "repair") {
					const cancelled = {
						state: "cancelled",
						operation: action.op,
						result: "Authority repair cancelled with zero writes",
						next_action: "request authorization again if repair is still intended",
					};
					return toolResult(JSON.stringify(cancelled, null, 2), cancelled);
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
			if (action.op === "advance_assurance" || action.op === "request_authorization" || action.op === "submit_review" || action.op === "approve_breaking_intent_revision") {
				if ((action.op === "request_authorization" || action.op === "approve_breaking_intent_revision") && ctx.mode !== "tui")
					return failCanaryTool(taskId, action.op, "blocked", "tui_required", "literal-user authorization is TUI-only", "invoke the TUI Tool");
				const result = action.op === "advance_assurance"
					? await progression.advance(taskId, ctx, signal, (update) => {
						onUpdate?.(update);
						presentTaskRailResult(ctx, taskId, update.details as Record<string, unknown> | undefined);
					})
					: action.op === "submit_review"
						? await progression.submitReview(taskId, ctx)
						: action.op === "approve_breaking_intent_revision"
							? await authorizeExactOperation(
								taskId,
								"approve-breaking-intent-revision",
								ctx,
								(action as { next_intent?: unknown }).next_intent,
							)
							: await requestAuthorization(taskId, ctx);
				const enriched = await enrichAssuranceResult(ctx, taskId, result as unknown as Record<string, unknown>);
				presentTaskRailResult(ctx, taskId, enriched);
				throwIfCanaryToolFailure(taskId, action.op, enriched);
				return toolResult(JSON.stringify(enriched, null, 2), enriched);
			}
			const projection = await projectAssuranceState(ctx.cwd, taskId);
			if (projection.error) {
				const details = {
					state: "blocked",
					operation: action.op,
					result: projection.error,
					next_action: "inspect authority state",
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
				const details = {
					state: "status",
					operation: "status",
					lifecycle: state.lifecycle,
					artifact_state: state.artifact_state,
					task_state: state,
					result: `${fresh}/${total} acceptance items fresh; ${blockers} blocker${blockers === 1 ? "" : "s"}`,
					next_action: state.next_obligation,
				};
				presentTaskRailResult(ctx, taskId, details);
				return toolResult(JSON.stringify(state, null, 2), details);
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
				const updated = await projectAssuranceState(ctx.cwd, taskId);
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
			const result = action.op === "route"
				? await buildLoopAction({
					ownership: action.ownership,
					target: action.target,
					context: action.context,
					scope_expansion: action.scope_expansion,
					kernel_operation: action.kernel_operation,
				})
				: await buildLoopRoleDispatch({ role: action.role, context: action.context });
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
		| { state: "applied"; operation: AuthorizeOperation; lifecycle?: string }
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
				invocation = progression.openInvocation(taskId);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			notifyOnce(ctx, `authorization-open:${taskId}:${reason}`, `cannot authorize ${taskId}: ${reason}`, "error");
			return { state: "blocked", reason };
		}
		const projection = await projectAssuranceState(ctx.cwd, taskId);
		if (projection.error || !projection.claim) {
			const reason = projection.error ?? "no active backend claim";
			notifyOnce(ctx, `authorization-claim:${taskId}:${reason}`, `cannot authorize ${taskId}: ${reason}`, "error");
			progression.closeInvocation(invocation);
			return { state: "blocked", reason };
		}
		let userDecisionOperation: ReturnType<typeof buildUserDecisionOperation> | undefined;
		if (operation === "resolve-user-decision") {
			try {
				const current = await readTaskRecord(ctx.cwd, taskId);
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
		const dialogDetails = [
			`Operation: ${operation}`,
			...(userDecisionOperation
				? [
						`Finding: ${userDecisionOperation.finding_id}`,
						`Resolution: ${userDecisionOperation.resolution}`,
					]
				: []),
			...(nextIntent
				? [
						`Next Intent: rev ${nextIntent.revision} (${nextIntentHash})`,
						`Next Goal: ${nextIntent.goal}`,
						`Next Scope: ${nextIntent.scope_hint.join(", ")}`,
						`Next Acceptance Items: ${nextIntent.acceptance.length}`,
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
			result: `${operation} requires literal-user approval`,
			next: `Decide ${operation}`,
		});
		const attention = {
			attention_id: randomUUID(),
			task_id: taskId,
			reason: attentionReason,
			label: `${operation} approval required`,
		};
		try {
			const selected = await requestAuthorityDialog(pi, ctx, attention, {
				title: `Authorize ${operation}?`,
				summary: dialogSummary,
				details: dialogDetails,
				signal: ctx.signal,
				actions: [
					{ value: "authorize", label: "Authorize", description: `Apply ${operation} after freshness revalidation` },
					{ value: "cancel", label: "Cancel", description: "Leave managed authority unchanged" },
				],
			});
			confirmed = selected === "authorize";
		} catch {
			if (operation !== "stop" && operation !== "approve-breaking-intent-revision")
				await recordCancelledUserDecision(ctx, taskId, operation, snapshotDigestRef).catch(() => undefined);
			progression.closeInvocation(invocation);
			return { state: "cancelled", operation, reason: "confirmation aborted" };
		}
		if (!confirmed) {
			if (operation !== "stop" && operation !== "approve-breaking-intent-revision")
				await recordCancelledUserDecision(ctx, taskId, operation, snapshotDigestRef).catch(() => undefined);
			progression.closeInvocation(invocation);
			return { state: "cancelled", operation, reason: "cancelled" };
		}
		if (!progression.sessionActiveValue() || progression.sessionGenerationValue() !== authorizationGeneration || progression.invocationState(invocation) !== "open") {
			notifyOnce(ctx, `authorization-session:${taskId}:${operation}`, `authorize ${operation}: session changed; confirmation discarded`, "warning");
			progression.closeInvocation(invocation);
			return { state: "blocked", reason: "session changed; confirmation discarded" };
		}
		try {
			// Linearization point: only this fresh affirmative continuation
			// may mint/apply; timeout/cancel already won open -> cancelled.
			try {
				progression.commitInvocation(invocation);
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				notifyOnce(ctx, `authorization-commit:${taskId}:${operation}:${reason}`, `authorize ${operation} aborted: ${reason}`, "error");
				return { state: "blocked", reason };
			}
			const { registry, app } = await authorityPair();
			const now = new Date().toISOString();
			const priorIntent = await readTaskIntent(ctx.cwd, taskId);
			if (nextIntent) {
				nextIntentRef = {
					path: `docs/plans/${nextIntent.task_id}.intent.json`,
					content_hash: nextIntentHash!,
				};
			}
			// record-user-approval: literal-user approval for critical-task-completion. The approval payload is bound to the fresh
			// projection (task revision, intent content hash, diff hash) and
			// applied through the same exact-action capability path; the
			// The reducer requires kind user, user authority, and active:frozen state.
			const isUserApproval = operation === "record-user-approval";
			const approval = isUserApproval
				? {
						id: `approval-user-${randomUUID().slice(0, 8)}`,
						kind: "user" as const,
						authority_role: "user" as const,
						task_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						actor_id: "literal-user",
						summary: "literal user approval",
					}
				: undefined;
			const exactOperation = operation === "stop"
				? { op: "stop" as const, reason: "literal user stopped task parked for replan" }
				: operation === "approve-breaking-intent-revision"
					? {
							op: "approve_breaking_intent_revision" as const,
							next_intent: nextIntent!,
							next_intent_ref: nextIntentRef!,
						}
					: userDecisionOperation ?? userOperationFor(operation, approval);
				// The exact host-built operation is shared by capability digest and
				// application payload; command arguments cannot inject authority fields.
				const sidecar = nextIntent ? join(ctx.cwd, priorIntent.intent_ref.path) : undefined;
				const priorBytes = sidecar ? readFileSync(sidecar) : undefined;
				try {
					if (sidecar) {
						writeFileSync(sidecar, `${JSON.stringify(nextIntent, null, 2)}\n`);
						execFileSync("git", ["add", "--", priorIntent.intent_ref.path], {
							cwd: ctx.cwd,
							stdio: ["ignore", "pipe", "pipe"],
						});
						await dependencies.authorizationAfterSidecarStage?.();
					}
					// A breaking revision changes scope, but the Kernel still derives the
					// authority digest from the pre-mutation record; read that exact owner.
					const liveRecord = nextIntent ? await readTaskRecord(ctx.cwd, taskId) : null;
					if (nextIntent && !liveRecord?.record)
						throw new Error("TaskRecord changed before the breaking revision digest");
					const operationDiffHash = liveRecord?.record
						? diffHashOf(ctx.cwd, liveRecord.record)
						: projection.projection.diff_hash;
					const capability = await mintCapability(registry, {
						authority_kind: "user",
						task_id: taskId,
						action_kind: exactOperation.op,
						expected_record_hash: projection.projection.record_revision,
						intent_revision: nextIntent?.revision ?? projection.projection.intent_revision,
						intent_content_hash: nextIntentHash ?? projection.projection.intent_content_hash,
						diff_hash: operationDiffHash,
						actor_id: "literal-user",
						...(exactOperation.op === "record_user_approval" ? { approval: exactOperation.approval } : {}),
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
						operation: { ...exactOperation, capability, actor_id: "literal-user" } as never,
						prior_intent_token: priorIntent.token,
						diffProvider: (root: string, record: NonNullable<TaskRecordRead["record"]>) => diffHashOf(root, record),
						now,
					})) as unknown as { record: { lifecycle: string; artifact_state: string; intent_ref: { path: string }; intent_snapshot: { scope_hint: string[] } } };
					if (
						exactOperation.op === "stop"
						|| exactOperation.op === "approve_breaking_intent_revision"
					) stagePlanningArtifactTransition(ctx.cwd, result.record);
					return { state: "applied", operation, lifecycle: result.record.lifecycle };
				} catch (error) {
					if (sidecar && priorBytes) {
						const current = await readTaskRecord(ctx.cwd, taskId);
						if (current.record?.intent_snapshot.revision === priorIntent.intent.revision) {
							writeFileSync(sidecar, priorBytes);
							execFileSync("git", ["add", "--", priorIntent.intent_ref.path], {
								cwd: ctx.cwd,
								stdio: ["ignore", "pipe", "pipe"],
							});
						}
					}
					throw error;
				}
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
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
		const projection = await projectAssuranceState(ctx.cwd, taskId);
		if (projection.error || !projection.claim)
			return { state: "blocked", reason: projection.error ?? "no active backend claim" };
		await dependencies.authorizationBeforeRecordRead?.();
		const read = await readTaskRecord(ctx.cwd, taskId);
		if (!read.record) return { state: "blocked", reason: `task ${taskId} has no TaskRecord v3` };
		if (read.revision !== projection.projection.record_revision)
			return { state: "blocked", reason: "TaskRecord changed while deriving authorization operation" };
		const derived = deriveAuthorizationOperation({
			readiness: projection.projection.authorization,
			hasOpenReplanRequired: read.record.findings.some(
				(finding) => finding.kind === "replan_required" && finding.status === "open",
			),
		});
		if ("blocked" in derived) return { state: "blocked", reason: derived.blocked };
		return authorizeExactOperation(taskId, derived.operation, ctx);
	}
}

// ---------------------------------------------------------------------------
// Helpers (module scope; no workflow state)
// ---------------------------------------------------------------------------

export type DerivedAuthorizationOperation =
	| "resolve-user-decision"
	| "record-user-approval"
	| "stop";

// Kernel projection is the sole source of authorization readiness.
export function deriveAuthorizationOperation(input: {
	readiness: AssuranceAuthorizationReadiness;
	hasOpenReplanRequired?: boolean;
}): { operation: DerivedAuthorizationOperation } | { blocked: string } {
	if (input.hasOpenReplanRequired) return { operation: "stop" };
	if (input.readiness.state === "resolve_user_decision") return { operation: "resolve-user-decision" };
	if (input.readiness.state === "record_user_approval") return { operation: "record-user-approval" };
	if (input.readiness.blocked) return { blocked: input.readiness.blocked };
	return { blocked: "no unique host-derived authorization operation" };
}

function toCanaryOperation(action: { op: string }, actorId: string) {
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
	const current = await readTaskRecord(ctx.cwd, taskId);
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
			actor_id: "literal-user",
		} as never,
		prior_intent_token: (await readTaskIntent(ctx.cwd, taskId)).token,
		diffProvider: (root: string, record: NonNullable<TaskRecordRead["record"]>) => diffHashOf(root, record),
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

export function userOperationFor(operation: AuthorizeOperation, approval?: unknown) {
	if (operation !== "record-user-approval")
		throw new Error(`unsupported authorize operation: ${operation}`);
	// The approval payload is constructed by the authorize handler from
	// the fresh projection; it is never derived from untrusted input.
	if (approval === undefined) throw new Error("record-user-approval requires an approval payload");
	return { op: "record_user_approval" as const, approval };
}

/**
 * One record-aware freshness identity. v4 derives the scoped revision digest
 * from the immutable Enrollment base so committed and staged task work share a
 * single diff_hash with Review; v3 keeps the legacy HEAD -> index digest.
 */
function diffHashOf(root: string, record: NonNullable<TaskRecordRead["record"]>): string {
	if (record.contract === "assurance_kernel/task_record/v4") {
		if (!record.git_base_head)
			throw new Error("TaskRecord v4 is missing git_base_head");
		return taskRevisionDiffHash(root, record.intent_snapshot.scope_hint, record.git_base_head);
	}
	return taskDiffHash(root, record.intent_snapshot.scope_hint);
}

// Translation-only adapter for the internal Kernel assurance projection. All
// freshness, approval, finding, claim, and authorization facts come from the
// Kernel module; this wrapper only binds the host diff provider. The retired
// active-v2 migrator is gone: a v2 TaskRecord in the state layout is a
// fail-closed projection error, never an automatic migration trigger.
async function projectAssuranceState(root: string, taskId: string): Promise<AssuranceProjectionResult> {
	return projectAssurance(root, taskId, diffHashOf);
}

/**
 * Publish and prove the task-scoped synthetic revision for a v4 record. v3
 * records keep the legacy full-source bundle and return null here.
 */
async function ensureTaskReviewRevision(
	root: string,
	taskId: string,
	projection: AssuranceProjectionResult,
): Promise<ReviewRevision | null> {
	const current = await readTaskRecord(root, taskId);
	const record = current.record;
	if (!record) throw new Error(`task ${taskId} has no TaskRecord before Review preparation`);
	if (current.revision !== projection.projection.record_revision)
		throw new Error("TaskRecord changed before Review preparation");
	if (record.contract !== "assurance_kernel/task_record/v4") return null;
	if (!record.git_base_head)
		throw new Error("Review revision requires a TaskRecord v4 git_base_head");
	const manifest = captureReviewManifest(root, {
		taskId,
		baseHead: record.git_base_head,
		scopeHint: record.intent_snapshot.scope_hint,
		expectedDiffHash: projection.projection.diff_hash,
		intentRevision: projection.projection.intent_revision,
		intentContentHash: projection.projection.intent_content_hash,
		recordRevision: projection.projection.record_revision,
		workspaceRevision: projection.projection.workspace_revision,
		lifecycle: projection.projection.lifecycle,
		artifactState: projection.projection.artifact_state,
		risk: record.intent_snapshot.risk,
		outcomes: reviewPreflightOutcomes(record.intent_snapshot.acceptance),
	});
	return {
		contract: "assurance_kernel/review_revision/v1",
		base_head: manifest.base_head,
		review_tree: manifest.review_tree,
		review_commit: manifest.review_commit,
		review_ref: manifest.review_ref,
		diff_hash: manifest.diff_hash,
		manifest_digest: manifest.manifest_digest,
	};
}

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
				const record = await readTaskRecord(root, entry.taskId);
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

export interface QaVerificationProgressInput {
	index: number;
	total: number;
	acceptance_id: string;
	phase: "running" | "passed" | "failed";
	elapsed_ms: number;
}

export function boundedVerificationFailureDetail(stdout: string, stderr: string): string {
	const output = (stderr || stdout).trim();
	const limit = 500;
	if (output.length <= limit) return output;
	const marker = "\n... output omitted ...\n";
	const available = limit - marker.length;
	const headLength = Math.floor(available / 3);
	const tailLength = available - headLength;
	return `${output.slice(0, headLength)}${marker}${output.slice(-tailLength)}`;
}

export async function runDeterministicQa(
	snapshot: SnapshotDescriptor,
	descriptors: Map<string, VerificationDescriptor>,
	runner: FrozenRunner,
	options: {
		signal?: AbortSignal;
		onProgress?: (progress: QaVerificationProgressInput) => void;
		runVerification?: typeof runFixedVerification;
	} = {},
): Promise<AssuranceVerdict> {
	if (snapshot.role !== "qa") throw new Error("deterministic QA requires qa role");
	if (options.signal?.aborted) throw new VerificationAbortedError();
	const findings: NonNullable<AssuranceVerdict["findings"]> = [];
	const runVerification = options.runVerification ?? runFixedVerification;
	for (const [offset, item] of snapshot.acceptance.entries()) {
		if (options.signal?.aborted) throw new VerificationAbortedError();
		const descriptor = descriptors.get(item.id);
		if (!descriptor) throw new Error(`verification descriptor missing for ${item.id}`);
		const startedAt = Date.now();
		options.onProgress?.({
			index: offset + 1,
			total: snapshot.acceptance.length,
			acceptance_id: item.id,
			phase: "running",
			elapsed_ms: 0,
		});
		const result = await runVerification(snapshot.root, descriptor, runner, {
			signal: options.signal,
		});
		const failed = result.exit_code !== 0 || result.timed_out;
		options.onProgress?.({
			index: offset + 1,
			total: snapshot.acceptance.length,
			acceptance_id: item.id,
			phase: failed ? "failed" : "passed",
			elapsed_ms: Date.now() - startedAt,
		});
		if (failed) {
			const detail = boundedVerificationFailureDetail(result.stdout, result.stderr);
			findings.push({
				id: qaFindingId(item.id, snapshotDigest(snapshot)),
				kind: "blocking",
				acceptance_id: item.id,
				summary: `verification failed (exit ${result.exit_code}${result.timed_out ? ", timed out" : ""}) stdout=${result.stdout.length}B stderr=${result.stderr.length}B${detail ? `: ${detail}` : ""}`,
				findings_digest: "",
			});
		}
	}
	if (findings.length > 0) {
		return {
			contract: "assurance_kernel/assurance_verdict/v2",
			role: "qa",
			task_id: snapshot.task_id,
			snapshot_digest: snapshotDigest(snapshot),
			decision: "rework",
			findings,
		};
	}
	return {
		contract: "assurance_kernel/assurance_verdict/v2",
		role: "qa",
		task_id: snapshot.task_id,
		snapshot_digest: snapshotDigest(snapshot),
		decision: "pass",
		approval: {
			kind: "qa",
			authority_role: "qa",
			summary: `all ${snapshot.acceptance.length} fixed verification descriptor(s) passed`,
		},
	};
}

async function applyAssuranceVerdict(
	ctx: ExtensionContext,
	snapshot: SnapshotDescriptor,
	verdict: AssuranceVerdict,
	invocation: InvocationToken,
	actorId: string,
	hooks: { beforeCommit?: () => Promise<void>; onCommit?: () => void; afterCommit?: () => Promise<void> } = {},
	authorityKind: "qa" | "review" | "user" = snapshot.role,
): Promise<void> {
	const fresh = await projectAssuranceState(ctx.cwd, snapshot.task_id);
	if (
		fresh.error ||
		fresh.claim?.task_id !== snapshot.task_id ||
		fresh.projection.record_revision !== snapshot.record_revision ||
		fresh.projection.workspace_revision !== snapshot.workspace_revision ||
		fresh.projection.intent_revision !== snapshot.intent_revision ||
		fresh.projection.intent_content_hash !== snapshot.intent_content_hash ||
		fresh.projection.diff_hash !== snapshot.diff_hash ||
		fresh.projection.lifecycle !== snapshot.lifecycle ||
		fresh.projection.artifact_state !== snapshot.artifact_state
	) {
		throw new Error(`assurance snapshot changed before authority application: ${[
			fresh.error,
			fresh.claim?.task_id !== snapshot.task_id ? "claim" : null,
			fresh.projection.record_revision !== snapshot.record_revision ? "record_revision" : null,
			fresh.projection.workspace_revision !== snapshot.workspace_revision ? "workspace_revision" : null,
			fresh.projection.intent_revision !== snapshot.intent_revision ? "intent_revision" : null,
			fresh.projection.intent_content_hash !== snapshot.intent_content_hash ? "intent_content_hash" : null,
			fresh.projection.diff_hash !== snapshot.diff_hash ? "diff_hash" : null,
			fresh.projection.lifecycle !== snapshot.lifecycle ? `lifecycle(${snapshot.lifecycle}->${fresh.projection.lifecycle})` : null,
			fresh.projection.artifact_state !== snapshot.artifact_state ? `artifact_state(${snapshot.artifact_state}->${fresh.projection.artifact_state})` : null,
		].filter(Boolean).join(", ")}`);
	}
	const { registry, app } = await authorityPair();
	const priorIntentToken = (await readTaskIntent(ctx.cwd, snapshot.task_id)).token;
	const commitAndApply = async <T>(apply: () => Promise<T>): Promise<T> => {
		invocationRegistry.commit(invocation);
		const settlement = apply();
		let hookError: unknown;
		try { hooks.onCommit?.(); } catch (error) { hookError = error; }
		const result = await settlement;
		try { await hooks.afterCommit?.(); } catch (error) { hookError ??= error; }
		if (hookError) throw hookError;
		return result;
	};
	if (verdict.decision === "rework") {
		const findings = verdict.findings!.map((finding) => ({
			id: finding.id,
			kind: finding.kind,
			status: "open",
			acceptance_id: finding.acceptance_id,
			source: "review",
			review_round: null,
			summary: finding.summary,
		}));
		const now = new Date().toISOString();
		const capability = await mintCapability(registry, {
			authority_kind: authorityKind,
			task_id: snapshot.task_id,
			action_kind: "request_rework",
			expected_record_hash: snapshot.record_revision,
			intent_revision: snapshot.intent_revision,
			intent_content_hash: snapshot.intent_content_hash,
			diff_hash: snapshot.diff_hash,
			actor_id: actorId,
			findings,
			now,
		});
		await hooks.beforeCommit?.();
		const result = (await commitAndApply(async () => app.execute({
			root: ctx.cwd,
			task_id: snapshot.task_id,
			operation: {
				op: "request_rework",
				capability,
				findings: findings as never[],
				actor_id: actorId,
			},
			prior_intent_token: priorIntentToken,
			diffProvider: (root: string, record: NonNullable<TaskRecordRead["record"]>) => diffHashOf(root, record),
			now,
		}))) as unknown as { record: { lifecycle: string; artifact_state: string; intent_ref: { path: string }; intent_snapshot: { scope_hint: string[] }; findings?: Array<{ kind: string; status: string }> } };
		stagePlanningArtifactTransition(ctx.cwd, result.record);
		const parked = (result.record as { findings?: Array<{ kind: string; status: string }> }).findings?.some(
			(finding) => finding.kind === "replan_required" && finding.status === "open",
		);
		if (parked) notifyOnce(
			ctx,
			`rework-parked:${snapshot.task_id}`,
			`rework applied: review parked for replan with ${findings.length} finding(s)`,
			"warning",
		);
		return;
	}
	const now = new Date().toISOString();
	const approval = {
		id: `approval-${snapshot.role}-${randomUUID().slice(0, 8)}`,
		kind: snapshot.role === "qa" ? "qa" : "review",
		authority_role: snapshot.role === "qa" ? "qa" : "reviewer",
		task_revision: snapshot.intent_revision,
		intent_content_hash: snapshot.intent_content_hash,
		diff_hash: snapshot.diff_hash,
		actor_id: actorId,
		summary: verdict.approval!.summary,
		// Trusted revision identity comes from the host-verified snapshot, never
		// from the reviewer payload.
		...(snapshot.role === "review" && snapshot.review_revision
			? { review_revision: snapshot.review_revision }
			: {}),
	};
	const capability = await mintCapability(registry, {
		authority_kind: snapshot.role,
		task_id: snapshot.task_id,
		action_kind: "record_approval",
		expected_record_hash: snapshot.record_revision,
		intent_revision: snapshot.intent_revision,
		intent_content_hash: snapshot.intent_content_hash,
		diff_hash: snapshot.diff_hash,
		actor_id: actorId,
		approval,
		now,
	});
	await hooks.beforeCommit?.();
	await commitAndApply(async () => app.execute({
		root: ctx.cwd,
		task_id: snapshot.task_id,
		operation: { op: "record_approval", capability, approval, actor_id: actorId },
		prior_intent_token: priorIntentToken,
		diffProvider: (root: string, record: NonNullable<TaskRecordRead["record"]>) => diffHashOf(root, record),
		now,
	}));
}

async function buildAssuranceSnapshot(
	root: string,
	taskId: string,
	role: AssuranceRole,
	projection: AssuranceProjectionResult,
	runner: FrozenRunner,
): Promise<{
	snapshot: SnapshotDescriptor;
	descriptors: Map<string, VerificationDescriptor>;
	reviewBundle: ReviewBundle | null;
	reviewManifest: ReviewManifestV5 | null;
}> {
	const record = await readTaskRecord(root, taskId);
	if (
		!record.record ||
		record.revision !== projection.projection.record_revision ||
		record.record.intent_snapshot.revision !== projection.projection.intent_revision ||
		record.record.intent_ref.content_hash !== projection.projection.intent_content_hash
	) {
		throw new Error("TaskRecord changed before assurance snapshot capture");
	}
	const intent = record.record.intent_snapshot;
	const acceptance = intent.acceptance;
	const descriptors = new Map<string, VerificationDescriptor>();
		// Every verification string must parse as strict canonical JSON
		// verification_descriptor/v1 and claim the frozen runner version;
		// a free-form or version-mismatched string is ineligible.
	for (const item of acceptance) {
		const descriptor = parseVerificationDescriptor(item.verification);
		assertRunnerCompatible(descriptor, runner);
		descriptors.set(item.id, descriptor);
	}
	const reviewRevision = record.record.contract === "assurance_kernel/task_record/v4"
		? {
			contract: "assurance_kernel/review_revision_identity/v1" as const,
			base_head: record.record.git_base_head,
			review_commit: "",
			review_tree: "",
			manifest_digest: "",
		}
		: null;
	const reviewBundle = role === "review" && !reviewRevision
		? captureReviewBundle(
				root,
				intent.scope_hint,
				projection.projection.diff_hash,
				qaOutcomes(record.record),
			)
		: null;
	const reviewManifest = role === "review" && reviewRevision
		? captureReviewManifest(root, {
				taskId,
				baseHead: reviewRevision.base_head,
				scopeHint: intent.scope_hint,
				expectedDiffHash: projection.projection.diff_hash,
				intentRevision: projection.projection.intent_revision,
				intentContentHash: projection.projection.intent_content_hash,
				recordRevision: projection.projection.record_revision,
				workspaceRevision: projection.projection.workspace_revision,
				lifecycle: projection.projection.lifecycle,
				artifactState: projection.projection.artifact_state,
				risk: intent.risk,
				outcomes: qaOutcomes(record.record),
			})
		: null;
	const taskSnapshot = !reviewBundle && !reviewManifest
		? captureGitTaskSnapshot(root, intent.scope_hint)
		: null;
	const dirtyFiles = reviewManifest
		? Object.keys(reviewManifest.changed_paths)
		: reviewBundle
			? Object.keys(reviewBundle.dirty_files)
			: Object.keys(taskSnapshot!.staged_files);
	return {
		snapshot: buildSnapshot({
				root,
				task_id: taskId,
				role,
				record_revision: projection.projection.record_revision,
				workspace_revision: projection.projection.workspace_revision,
				intent_revision: projection.projection.intent_revision,
				intent_content_hash: projection.projection.intent_content_hash,
				diff_hash: projection.projection.diff_hash,
				lifecycle: projection.projection.lifecycle,
				artifact_state: projection.projection.artifact_state,
				risk: intent.risk,
				fresh_acceptance_ids: projection.projection.fresh_acceptance_ids,
				missing_acceptance_ids: projection.projection.missing_acceptance_ids,
				stale_attestation_ids: projection.projection.stale_attestation_ids,
				acceptance,
				dirty_files: dirtyFiles,
				review_bundle_digest: reviewManifest?.manifest_digest ?? reviewBundle?.bundle_digest ?? null,
				review_revision: reviewManifest
					? {
							contract: "assurance_kernel/review_revision_identity/v1",
							base_head: reviewManifest.base_head,
							review_commit: reviewManifest.review_commit,
							review_tree: reviewManifest.review_tree,
							manifest_digest: reviewManifest.manifest_digest,
						}
						: undefined,
		}),
		descriptors,
		reviewBundle,
		reviewManifest,
	};
}

function reviewPreflightOutcomes(
	acceptance: Array<{ id: string }>,
): Record<string, { status: "passed"; summary: string }> {
	const summary = `host-attested QA: all ${acceptance.length} fixed verification descriptor(s) passed`;
	return Object.fromEntries(
		acceptance.map((item) => [item.id, { status: "passed" as const, summary }]),
	);
}

function qaOutcomes(
	record: NonNullable<TaskRecordRead["record"]>,
): Record<string, { status: "passed" | "failed" | "blocked"; summary: string }> {
	return Object.fromEntries(
		record.attestations
			.filter((item) => item.kind === "qa")
			.flatMap((item) => item.acceptance_results)
			.map((result) => [result.acceptance_id, { status: result.status, summary: result.summary }]),
	);
}

let frozenRunnerValue: FrozenRunner | undefined;
async function frozenRunner(): Promise<FrozenRunner> {
	frozenRunnerValue ??= resolveBunRunner();
	return frozenRunnerValue;
}

// The invocation registry is shared with the progression module's
// module-scoped registry (see the top-level import above); commit/cancel
// semantics are identical to the previous extension implementation.

async function mintCapability(
	registry: MutationAuthorityRegistry,
	input: {
		authority_kind: "review" | "qa" | "user";
		task_id: string;
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
		action_digest: digest,
		expected_record_hash: input.expected_record_hash,
		intent_revision: input.intent_revision,
		intent_content_hash: input.intent_content_hash,
		diff_hash: input.diff_hash,
		actor_id: input.actor_id,
		confirmation_ref: `pi-confirm-${createHash("sha256").update(`${input.task_id}\0${now}`).digest("hex").slice(0, 16)}`,
		expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
		findings_digest:
			input.action_kind === "request_rework"
				? await findingsDigestV2(
						(input.findings as Array<{ id: string; kind: string; acceptance_id: string | null; summary: string }>).map((f) => ({
							id: f.id,
							kind: f.kind,
							acceptance_id: f.acceptance_id,
							summary: f.summary,
						})),
					)
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
	ctx: ExtensionContext,
	input: { taskId: string; operation: { op: string; actor_id: string; next_intent?: unknown } },
): Promise<unknown> {
	const { app } = await authorityPair();
	const operation = input.operation.op === "revise_intent"
		? { ...input.operation, next_intent: await parseTaskIntentV1(input.operation.next_intent) }
		: input.operation;
	const priorIntent = await readTaskIntent(ctx.cwd, input.taskId);
	const sidecar = join(ctx.cwd, priorIntent.intent_ref.path);
	const priorBytes = operation.op === "revise_intent" ? readFileSync(sidecar) : null;
	try {
		if (priorBytes) writeFileSync(sidecar, `${JSON.stringify(operation.next_intent, null, 2)}\n`);
		const result = await app.execute({
			root: ctx.cwd,
			task_id: input.taskId,
			operation: operation as never,
			prior_intent_token: priorIntent.token,
			diffProvider: (root: string, record: NonNullable<TaskRecordRead["record"]>) => diffHashOf(root, record),
			now: new Date().toISOString(),
		});
		if (operation.op === "freeze_artifacts" || operation.op === "stop")
			stagePlanningArtifactTransition(ctx.cwd, result.record);
		return result;
	} catch (error) {
		if (priorBytes) {
			const current = await readTaskRecord(ctx.cwd, input.taskId);
			if (current.record?.intent_snapshot.revision === priorIntent.intent.revision) writeFileSync(sidecar, priorBytes);
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

async function enrichAssuranceResult(
	ctx: ExtensionContext,
	taskId: string,
	result: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const projection = await projectAssuranceState(ctx.cwd, taskId);
	const taskState: AssuranceTaskState = projection.error
		? { error: projection.error }
		: projection.projection;
	let tracker: Awaited<ReturnType<typeof markGithubTaskTerminal>> | undefined;
	await reconcileRefsQuietly(ctx.cwd);
	if (!projection.error) {
		try {
			const terminalInput = deriveGithubTerminalProjectionInput(
				taskId,
				projection,
				await readTaskTombstone(ctx.cwd, taskId),
			);
			if (terminalInput) tracker = await markGithubTaskTerminal(ctx.cwd, terminalInput);
		} catch {
			tracker = {
				contract: "immune_brain/github_issue_tracker_result/v1",
				operation: "mark-terminal",
				status: "retryable_failure",
				association_found: false,
				message: "tracker observation failed after authoritative settlement",
			};
		}
	}
	return {
		...result,
		task_state: taskState,
		...(tracker ? { tracker } : {}),
		next_action: nextActionForAssuranceResult(result, taskState),
	};
}

function nextActionForAssuranceResult(result: Record<string, unknown>, taskState: AssuranceTaskState): string {
	if ("error" in taskState) return "inspect authority state";
	if (result.state === "review_preparation_failed") return "retry advance_assurance";
	if (taskState.lifecycle === "done" || taskState.lifecycle === "stopped") return "none";
	switch (result.state) {
		case "review_ready": return "invoke the reserved foreground Agent";
		case "awaiting_user": return "request_authorization";
		case "applied": return taskState.completion_ready ? "complete task" : taskState.next_obligation;
		case "completed":
		case "stopped": return "none";
		case "rework": return "repair findings, then advance assurance";
		case "cancelled": return "retry the interrupted foreground operation";
		case "settlement_unknown": return "inspect authority state";
		case "blocked":
		case "failed":
		default: return taskState.next_obligation;
	}
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
function prepareActionArgs(args: unknown): unknown {
	if (args === null || typeof args !== "object" || Array.isArray(args)) return args;
	const input = args as Record<string, unknown>;
	if (typeof input.action !== "string") return input;
	try {
		const parsed: unknown = JSON.parse(input.action);
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed))
			return { ...input, action: parsed };
	} catch {
		// Unchanged input keeps the normal host schema error authoritative.
	}
	return input;
}

function stagePlanningArtifactTransition(root: string, record: {
	intent_ref: { path: string };
	intent_snapshot: { scope_hint: string[] };
}): void {
	const intentActive = record.intent_ref.path.replace("docs/plans/archive/", "docs/plans/");
	const intentArchive = intentActive.replace("docs/plans/", "docs/plans/archive/");
	const specActive = record.intent_snapshot.scope_hint.find((path) =>
		/^docs\/specs\/(?!archive\/)[^/]+\.spec\.md$/.test(path)
		&& record.intent_snapshot.scope_hint.includes(path.replace("docs/specs/", "docs/specs/archive/")),
	);
	const candidates = [
		intentActive,
		intentArchive,
		...(specActive ? [specActive, specActive.replace("docs/specs/", "docs/specs/archive/")] : []),
	];
	const paths = candidates.filter((path) => existsSync(join(root, path)) || execFileSync(
		"git",
		["ls-files", "--cached", "--", path],
		{ cwd: root, encoding: "utf8" },
	).trim().length > 0);
	if (paths.length === 0) return;
	execFileSync("git", ["add", "--", ...paths], {
		cwd: root,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function failCanaryTool(
	taskId: string,
	operation: string,
	state: "blocked" | "failed" | "authority_conflict" | "settlement_unknown",
	code: string,
	message: string,
	nextAction: string,
): never {
	return throwToolFailure({
		tool: "imm_kernel_canary",
		task_id: taskId,
		operation,
		state,
		code,
		message,
		next_action: nextAction,
	});
}

function throwIfCanaryToolFailure(
	taskId: string,
	operation: string,
	result: Record<string, unknown>,
): void {
	if (!isToolFailureState(result.state)) return;
	failCanaryTool(
		taskId,
		operation,
		result.state,
		`assurance_${result.state}`,
		typeof result.reason === "string"
			? result.reason
			: typeof result.result === "string"
				? result.result
				: "Kernel assurance operation failed",
		typeof result.next_action === "string"
			? result.next_action
			: "inspect authority state",
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
