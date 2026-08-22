// P3 Pi lifecycle extension: the only production route for Kernel canary
// assurance after enrollment.
//
// Surface:
//   1. `imm_kernel_canary` — foreground assurance and Review authority.
//   2. `imm_loop_action` — read-only projection of internal Loop actions.
//   3. `input` — automatic Managed Path routing to the three public Skills.
//
// Deterministic QA and native Review sequencing lives in
// `pi-canary-assurance-progression.ts`. The adapter owns Tool schemas, TUI
// authorization, Kernel capability creation, and translation of direct
// progression results. No detached assurance job, completion follow-up,
// progression path, Footer content, polling, or secondary authority state is
// created here. A bounded task-level Task Rail mirrors existing projections at
// host input and Tool lifecycle boundaries.

import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
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
import { captureReviewBundle, writeNativeReviewEvidence, type ReviewBundle } from "./pi-canary-review-bundle";
import type { InvocationToken } from "./pi-canary-invocations";
import { qaEvidenceFreshnessId, qaFindingId } from "./pi-canary-qa-findings";
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
	beginUserAttention,
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
import { taskDiffHash, captureGitTaskSnapshot } from "../runtime/workspace_scope";
import {
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
	type AssuranceAdvanceResult,
	type AssuranceProgressionPorts,
	type AssuranceSubmitReviewResult,
	type AssuranceVerdict,
	type PendingReviewVerdict,
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
	reconcileKernelAuthority,
	repairKernelAuthority,
	readTaskRecordV2,
	readTaskIntent,
	parseTaskIntentV1,
	canonicalIntentHash,
	projectAssurance,
	routeManagedRequest,
	deriveAssuranceAuthorization,
	findingsDigestV2,
	capabilityActionFor,
	digestOfAction,
	type AssuranceAuthorizationReadiness,
	type AssuranceProjectionResult,
	type CanaryApplication,
	type MutationAuthorityRegistry,
	type CapabilityBindingV2,
} from "./runtime-stub";
import { invocationRegistry } from "./pi-canary-assurance-progression";

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REVIEW_DECISIONS = {
	Approve: "approve",
	"Request rework": "rework",
	Reject: "reject",
} as const;
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
	"record_evidence",
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

type ReviewDecision = (typeof REVIEW_DECISIONS)[keyof typeof REVIEW_DECISIONS];

export type { AssuranceRole } from "./pi-canary-assurance";
export type AuthorizeOperation =
	| "record-review-verdict"
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
	phase: string;
	risk?: "routine" | "material" | "critical";
	fresh_acceptance_ids: string[];
	missing_acceptance_ids: string[];
	stale_evidence_ids: string[];
	acceptance: Array<{ id: string; assertion: string; verification: string }>;
	dirty_files?: string[];
	review_bundle_digest?: string | null;
}

export function buildSnapshot(input: SnapshotDescriptorInput): SnapshotDescriptor {
	return {
		contract: "assurance_kernel/assurance_snapshot/v1",
		task_id: input.task_id,
		role: input.role,
		record_revision: input.record_revision,
		workspace_revision: input.workspace_revision,
		intent_revision: input.intent_revision,
		intent_content_hash: input.intent_content_hash,
		diff_hash: input.diff_hash,
		phase: input.phase,
		risk: input.risk ?? "material",
		fresh_acceptance_ids: input.fresh_acceptance_ids,
		missing_acceptance_ids: input.missing_acceptance_ids,
		stale_evidence_ids: input.stale_evidence_ids,
		acceptance: input.acceptance,
		dirty_files: [...(input.dirty_files ?? [])].sort(),
		review_bundle_digest: input.review_bundle_digest ?? null,
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

async function routeHostRequest(root: string, request: string) {
	const claim = await readBackendClaim(root);
	if (!claim) return routeManagedRequest({ root, request });
	const authority = await reconcileKernelAuthority(root, claim.task_id);
	if (authority.state === "authority_conflict")
		throw new Error(authority.diagnostic ?? "Kernel authority state conflicts");
	if (authority.state === "repairable_stale_claim")
		return routeManagedRequest({
			root,
			request,
			task_id: authority.owner_task_id ?? claim.task_id,
			assurance: {
				task_id: authority.owner_task_id ?? claim.task_id,
				phase: authority.owner_phase ?? "done",
				next_action: "repair_authority_state",
			},
		});
	if (authority.state !== "active_owner")
		return routeManagedRequest({ root, request });
	const projected = await projectAssurance(root, claim.task_id, diffHashOf);
	if (projected.error) throw new Error(projected.error);
	return routeManagedRequest({
		root,
		request,
		task_id: claim.task_id,
		assurance: {
			task_id: claim.task_id,
			phase: projected.projection.phase,
			next_action: statusNextAction(projected.projection),
		},
	});
}

function managedSkillCommand(phase: "none" | "brainstorm" | "planner" | "loop", request: string): string | null {
	if (phase === "none") return null;
	return `/skill:imm-${phase} ${request}`;
}

export default function (
	pi: ExtensionAPI,
	dependencies: CanaryWorkExtensionDependencies = {},
) {
	const progression = new AssuranceProgression({
		projectTask: (root, taskId) => projectAssuranceState(root, taskId),
		readTaskRecordV2: (root, taskId) => readTaskRecordV2(root, taskId),
		readTaskIntent: (root, taskId) => readTaskIntent(root, taskId),
		frozenRunner: () => frozenRunner(),
		buildAssurance: (root, taskId, role, projection, runner) =>
			(dependencies.buildAssurance ?? buildAssuranceSnapshot)(root, taskId, role, projection, runner),
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

	let managedRouteFailure: string | null = null;
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
				next_action: statusNextAction(projection.projection),
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
		if (event.streamingBehavior === undefined) managedRouteFailure = null;
		const text = event.text.trimStart();
		if (/^\/skill:imm-(?:brainstorm|planner|loop)(?:\s|$)/.test(text)) {
			return { action: "continue" } as const;
		}
		try {
			const route = await routeHostRequest(ctx.cwd, event.text);
			const command = managedSkillCommand(route.phase, event.text);
			return command
				? {
					action: "transform",
					text: command,
					...(event.images ? { images: event.images } : {}),
				} as const
				: { action: "continue" } as const;
		} catch (error) {
			managedRouteFailure = error instanceof Error ? error.message : String(error);
			return {
				action: "transform",
				text: `Managed Path routing failed closed: ${managedRouteFailure}\nDo not call tools or modify files. Report this routing error and stop.\nOriginal request: ${event.text}`,
				...(event.images ? { images: event.images } : {}),
			} as const;
		}
	});
	pi.on("agent_settled", () => {
		managedRouteFailure = null;
	});

	pi.on("session_start", async (_event: unknown, ctx?: ExtensionContext) => {
		progression.onSessionStart();
		if (!ctx || ctx.mode !== "tui") return;
		railContext = ctx;
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
		if (managedRouteFailure) {
			return { block: true, reason: `Managed Path routing failed closed: ${managedRouteFailure}` };
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
			"After fresh acceptance evidence, call advance_assurance and consume its direct terminal result; do not poll or create a detached job.",
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
				Type.Object({ op: Type.Literal("request_authorization") }),
				Type.Object({ op: Type.Literal("repair_authority_state") }),
				Type.Object({
					op: Type.Literal("record_evidence"),
					acceptance_id: Type.String(),
					status: Type.Union([
						Type.Literal("passed"),
						Type.Literal("failed"),
						Type.Literal("blocked"),
					]),
					summary: Type.String(),
				}),
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
				Type.Object({ op: Type.Literal("submit_review") }),
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
		execute: async (toolCallId: string, params: { task_id: string; action: { op: string } }, signal: AbortSignal | undefined, onUpdate: ((update: ReturnType<typeof toolResult>) => void) | undefined, ctx: ExtensionContext) => {
			const { task_id: taskId, action } = params;
			railContext = ctx;
			presentTaskRailResult(ctx, taskId, {
				state: "running",
				operation: action.op,
				result: `${action.op} started`,
				next_action: "Wait for the foreground Tool result",
			});
			if (action.op === "repair_authority_state") {
				if (ctx.mode !== "tui") return toolResult("imm_kernel_canary mutation is TUI-only");
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
					return toolResult(JSON.stringify(blocked, null, 2), blocked);
				}
				presentTaskRail(ctx, {
					task_id: taskId,
					state: "Approval required",
					result: "Kernel authority repair requires literal-user approval",
					next: "Decide whether to repair the stale claim",
				});
				const repairSelection = await requestAuthorityDialog(ctx, {
					title: "Repair Kernel authority state?",
					summary: [
						`Owner: ${taskId}`,
						`Terminal phase: ${authority.owner_phase}`,
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
					const blocked = {
						state: "authority_conflict",
						operation: action.op,
						result: error instanceof Error ? error.message : String(error),
						next_action: "inspect authority state",
					};
					return toolResult(JSON.stringify(blocked, null, 2), blocked);
				}
			}
			if (action.op === "advance_assurance" || action.op === "request_authorization" || action.op === "submit_review" || action.op === "approve_breaking_intent_revision") {
				if (ctx.mode !== "tui") return toolResult("imm_kernel_canary mutation is TUI-only");
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
				return toolResult(JSON.stringify(enriched, null, 2), enriched);
			}
			const projection = await projectAssuranceState(ctx.cwd, taskId);
			if (projection.error) {
				return toolResult(`kernel canary unavailable: ${projection.error}`, {
					state: "blocked",
					operation: action.op,
					result: projection.error,
					next_action: "inspect authority state",
				});
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
					phase: state.phase,
					task_state: state,
					result: `${fresh}/${total} acceptance items fresh; ${blockers} blocker${blockers === 1 ? "" : "s"}`,
					next_action: statusNextAction(state),
				};
				presentTaskRailResult(ctx, taskId, details);
				return toolResult(JSON.stringify(state, null, 2), details);
			}
			// Production mutation requires the TUI host; RPC/JSON/print fail
			// before any state read that could lead to mutation.
			if (ctx.mode !== "tui") {
				return toolResult("imm_kernel_canary mutation is TUI-only");
			}
			const claim = projection.claim;
			if (!claim || claim.task_id !== taskId) {
				return toolResult(`no active backend claim for ${taskId}`);
			}
			try {
				const result = (await executeOrdinaryOperation(ctx, {
					taskId,
					operation: toCanaryOperation(action, "executor") as { op: string; actor_id: string },
				})) as unknown as { revision: string; record: { phase: string } };
				const updated = await projectAssuranceState(ctx.cwd, taskId);
				const taskState = updated.error ? { phase: result.record.phase } : updated.projection;
				const nextAction = updated.error ? "inspect authority state" : statusNextAction(updated.projection);
				const details = {
					state: "recorded",
					operation: action.op,
					phase: result.record.phase,
					task_state: taskState,
					result: "Kernel executor fact recorded",
					next_action: nextAction,
				};
				presentTaskRailResult(ctx, taskId, details);
				return toolResult(
					JSON.stringify(
						{ revision: result.revision, phase: result.record.phase, task_state: taskState, next_action: nextAction },
						null,
						2,
					),
					details,
				);
			} catch (error) {
				return toolResult(`kernel canary mutation failed: ${error instanceof Error ? error.message : String(error)}`);
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
		| { state: "applied"; operation: AuthorizeOperation; phase?: string; decision?: ReviewDecision }
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
		let nextIntentRef: { path: string; revision: number; content_hash: string } | undefined;
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
		let pendingReview: PendingReviewVerdict | undefined;
		if (operation === "record-review-verdict") {
			pendingReview = progression.pendingReviewVerdict(taskId);
			if (!pendingReview) {
				const reason = "no pending native review verdict in this session";
				notifyOnce(ctx, `authorization-review:${taskId}`, `cannot authorize ${taskId}: ${reason}`, "error");
				progression.closeInvocation(invocation);
				return { state: "blocked", reason };
			}
		}
		let userDecisionOperation: ReturnType<typeof buildUserDecisionOperation> | undefined;
		if (operation === "resolve-user-decision") {
			try {
				const current = await readTaskRecordV2(ctx.cwd, taskId);
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
		const reviewFindings = pendingReview?.verdict.findings ?? [];
		const reviewBlockers = reviewFindings.filter((finding) => finding.kind === "blocking").length;
		const reviewWarnings = reviewFindings.filter((finding) => finding.kind === "advisory").length;
		const dialogSummary = [
			`Task: ${taskId}`,
			...(pendingReview
				? [
						`Review: ${pendingReview.verdict.decision.toUpperCase()} | Blockers: ${reviewBlockers} | Warnings: ${reviewWarnings}`,
						`QA: ${projection.projection.fresh_approval_kinds.includes("qa") ? "passed" : "missing"}`,
						`Scope: ${pendingReview.snapshot.dirty_files.length} scoped changed file(s)`,
						`Evidence: ${pendingReview.snapshot.review_bundle_digest ? "available" : "unavailable"}`,
						`Pending operation: ${operation}`,
					]
				: [
						`Decision: ${operation}`,
						`State: ${projection.projection.phase} | Claim: ${projection.claim.lifecycle_status}`,
					]),
		].join("\n");
		const dialogDetails = [
			`Operation: ${operation}`,
			...(userDecisionOperation
				? [
						`Finding: ${userDecisionOperation.finding_id}`,
						`Resolution: ${userDecisionOperation.resolution}`,
					]
				: []),
			...(pendingReview
				? [
						`Review bundle: ${pendingReview.snapshot.review_bundle_digest ?? "unavailable"}`,
						`Native agent: ${pendingReview.agentId}`,
						`Verdict: ${pendingReview.verdict.decision}`,
						`Summary: ${pendingReview.verdict.decision === "pass" ? pendingReview.verdict.approval!.summary : pendingReview.verdict.findings!.map((finding) => `${finding.id} ${finding.kind}: ${finding.summary}`).join("; ")}`,
						...(pendingReview.durationMs !== undefined ? [`Duration: ${Math.round(pendingReview.durationMs / 1000)}s`] : []),
						...(pendingReview.tokens ? [`Tokens: ${pendingReview.tokens.total}`] : []),
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
			`Phase: ${projection.projection.phase}`,
			`Intent: rev ${projection.projection.intent_revision} (${projection.projection.intent_content_hash})`,
			`Diff: ${projection.projection.diff_hash}`,
		].join("\n");
		const snapshotDigestRef = pendingReview
			? snapshotDigest(pendingReview.snapshot)
			: projection.projection.record_revision;
		let confirmed = false;
		let reviewDecision: ReviewDecision | undefined;
		let reviewNote: string | undefined;
		const attentionReason: UserAttentionReason = operation === "approve-breaking-intent-revision"
			? "breaking_intent_revision"
			: "review_authorization";
		presentTaskRail(ctx, {
			task_id: taskId,
			state: "Approval required",
			result: pendingReview ? "Independent Review verdict requires a literal-user decision" : `${operation} requires literal-user approval`,
			next: pendingReview ? "Decide Review outcome" : `Decide ${operation}`,
		});
		const endAttention = beginUserAttention(pi, {
			attention_id: randomUUID(),
			task_id: taskId,
			reason: attentionReason,
			label: pendingReview ? "Review approval required" : `${operation} approval required`,
		});
		try {
			if (pendingReview) {
				let selected: keyof typeof REVIEW_DECISIONS | "Cancel" | undefined;
				try {
					selected = await requestAuthorityDialog(ctx, {
						title: "Review authorization",
						summary: dialogSummary,
						details: dialogDetails,
						signal: ctx.signal,
						actions: [
							{ value: "Approve", label: "Approve", description: "Accept the independent Review verdict" },
							{ value: "Request rework", label: "Request rework", description: "Return the task to working with a required reason" },
							{ value: "Reject", label: "Reject", description: "Stop the task with a required reason" },
							{ value: "Cancel", label: "Cancel", description: "Keep the Review verdict pending with zero writes" },
						],
					});
					if (selected === "Request rework" || selected === "Reject") {
						reviewNote = (await ctx.ui.input(
							selected === "Request rework" ? "Required rework" : "Reason for rejection",
							"Required",
							{ signal: ctx.signal },
						))?.trim();
					}
				} catch (error) {
					if (ctx.signal?.aborted !== true && (!(error instanceof DOMException) || error.name !== "AbortError")) {
						const detail = error instanceof Error ? error.message : String(error);
						const reason = `Review decision UI failed: ${detail}`;
						notifyOnce(ctx, `authorization-ui:${taskId}:${operation}:${detail}`, reason, "error");
						progression.closeInvocation(invocation);
						return { state: "blocked", reason };
					}
					selected = undefined;
				}
				if (selected === undefined || selected === "Cancel" || ((selected === "Request rework" || selected === "Reject") && !reviewNote)) {
					progression.closeInvocation(invocation);
					return { state: "cancelled", operation, reason: "cancelled" };
				}
				reviewDecision = REVIEW_DECISIONS[selected];
				confirmed = true;
			} else {
				try {
					const selected = await requestAuthorityDialog(ctx, {
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
			}
			if (!confirmed) {
				if (operation !== "stop" && operation !== "approve-breaking-intent-revision")
					await recordCancelledUserDecision(ctx, taskId, operation, snapshotDigestRef).catch(() => undefined);
				progression.closeInvocation(invocation);
				return { state: "cancelled", operation, reason: "cancelled" };
			}
		} finally {
			endAttention();
		}
		if (!progression.sessionActiveValue() || progression.sessionGenerationValue() !== authorizationGeneration || progression.invocationState(invocation) !== "open") {
			notifyOnce(ctx, `authorization-session:${taskId}:${operation}`, `authorize ${operation}: session changed; confirmation discarded`, "warning");
			progression.closeInvocation(invocation);
			return { state: "blocked", reason: "session changed; confirmation discarded" };
		}
		try {
			if (operation === "record-review-verdict") {
				if (!pendingReview || !reviewDecision) throw new Error("pending native review verdict disappeared");
				if (reviewDecision === "rework") {
					await applyAssuranceVerdict(
						ctx,
						pendingReview.snapshot,
						{
							contract: "assurance_kernel/assurance_verdict/v2",
							role: "review",
							task_id: taskId,
							snapshot_digest: snapshotDigest(pendingReview.snapshot),
							decision: "rework",
							findings: [{
								id: `user-rework-${randomUUID().slice(0, 8)}`,
								kind: "blocking",
								acceptance_id: null,
								summary: reviewNote!,
								findings_digest: "",
							}],
						},
						invocation,
						"literal-user",
						{},
						"user",
					);
					progression.clearPendingReviewVerdict(taskId);
					return { state: "applied", operation, decision: "rework", phase: "working" };
				}
				if (reviewDecision === "reject") {
					progression.commitInvocation(invocation);
					const { registry, app } = await authorityPair();
					const now = new Date().toISOString();
					const reason = `literal user rejected Review: ${reviewNote}`;
					const capability = await mintCapability(registry, {
						authority_kind: "user",
						task_id: taskId,
						action_kind: "stop",
						expected_record_hash: projection.projection.record_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						actor_id: "literal-user",
						reason,
						now,
					});
					const result = (await app.execute({
						root: ctx.cwd,
						task_id: taskId,
						operation: { op: "stop", capability, reason, actor_id: "literal-user" },
						prior_intent_token: (await readTaskIntent(ctx.cwd, taskId)).token,
						diffProvider: (root: string, intent: { scope_hint: unknown }) => diffHashOf(root, intent),
						now,
					})) as unknown as { record: { phase: string } };
					progression.clearPendingReviewVerdict(taskId);
					return { state: "applied", operation, decision: "reject", phase: result.record.phase };
				}
				await applyAssuranceVerdict(
					ctx,
					pendingReview.snapshot,
					pendingReview.verdict,
					invocation,
					`native-review-${pendingReview.agentId}`,
				);
				progression.clearPendingReviewVerdict(taskId);
				return { state: "applied", operation, decision: "approve", phase: pendingReview.verdict.decision === "rework" ? "working" : "review" };
			}
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
					path: priorIntent.intent_ref.path,
					revision: nextIntent.revision,
					content_hash: nextIntentHash!,
				};
			}
			// record-user-approval: literal-user approval for critical-task-completion. The approval payload is bound to the fresh
			// projection (task revision, intent content hash, diff hash) and
			// applied through the same exact-action capability path; the
			// reducer requires kind user, user authority, and phase review.
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
			const capability = await mintCapability(registry, {
				authority_kind: "user",
				task_id: taskId,
				action_kind: exactOperation.op,
				expected_record_hash: projection.projection.record_revision,
				intent_revision: nextIntent?.revision ?? projection.projection.intent_revision,
				intent_content_hash: nextIntentHash ?? projection.projection.intent_content_hash,
				diff_hash: projection.projection.diff_hash,
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
				// The exact host-built operation is shared by capability digest and
				// application payload; command arguments cannot inject authority fields.
				const sidecar = nextIntent ? join(ctx.cwd, priorIntent.intent_ref.path) : undefined;
				const priorBytes = sidecar ? readFileSync(sidecar) : undefined;
				try {
					if (sidecar) writeFileSync(sidecar, `${JSON.stringify(nextIntent, null, 2)}\n`);
					const result = (await app.execute({
						root: ctx.cwd,
						task_id: taskId,
						operation: { ...exactOperation, capability, actor_id: "literal-user" } as never,
						prior_intent_token: priorIntent.token,
						diffProvider: (root: string, intent: { scope_hint: unknown }) => diffHashOf(root, intent),
						now,
					})) as unknown as { record: { phase: string } };
					return { state: "applied", operation, phase: result.record.phase };
				} catch (error) {
					if (sidecar && priorBytes) {
						const current = await readTaskRecordV2(ctx.cwd, taskId);
						if (current.record?.intent_revision === priorIntent.intent.revision)
							writeFileSync(sidecar, priorBytes);
					}
					throw error;
				}
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				if (
					operation === "record-review-verdict" &&
					pendingReview &&
					reason === "assurance snapshot changed before authority application" &&
					progression.pendingReviewVerdict(taskId)?.operationId === pendingReview.operationId
				) progression.clearPendingReviewVerdict(taskId);
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
		const read = await readTaskRecordV2(ctx.cwd, taskId);
		if (!read.record) return { state: "blocked", reason: `task ${taskId} has no TaskRecord v2` };
		if (read.revision !== projection.projection.record_revision)
			return { state: "blocked", reason: "TaskRecord changed while deriving authorization operation" };
		const derived = deriveAuthorizationOperation({
			hasPendingReviewVerdict: progression.hasPendingReviewVerdict(taskId),
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
	| "record-review-verdict"
	| "resolve-user-decision"
	| "record-user-approval"
	| "stop";

// Kernel-facts authorization readiness comes from the assurance projection;
// only the Pi-session pending native Review verdict is composed here.
export function deriveAuthorizationOperation(input: {
	hasPendingReviewVerdict: boolean;
	readiness: AssuranceAuthorizationReadiness;
	hasOpenReplanRequired?: boolean;
}): { operation: DerivedAuthorizationOperation } | { blocked: string } {
	if (input.hasPendingReviewVerdict) return { operation: "record-review-verdict" };
	if (input.hasOpenReplanRequired) return { operation: "stop" };
	if (input.readiness.state === "resolve_user_decision") return { operation: "resolve-user-decision" };
	if (input.readiness.state === "record_user_approval") return { operation: "record-user-approval" };
	if (input.readiness.blocked) return { blocked: input.readiness.blocked };
	return { blocked: "no unique host-derived authorization operation" };
}

function toCanaryOperation(action: { op: string }, actorId: string) {
	switch (action.op) {
		case "record_evidence": {
			const a = action as unknown as { acceptance_id: string; status: string; summary: string };
			return {
				op: "record_evidence",
				acceptance_id: a.acceptance_id,
				status: a.status,
				summary: a.summary,
				actor_id: actorId,
			};
		}
		case "record_finding":
			return {
				op: "record_finding",
				finding: (action as unknown as { finding: unknown }).finding,
				actor_id: actorId,
			};
		case "resolve_finding":
			return { op: "resolve_finding", finding_id: (action as unknown as { finding_id: string }).finding_id, actor_id: actorId };
		case "submit_review":
			return { op: "submit_review", actor_id: actorId };
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
	const current = await readTaskRecordV2(ctx.cwd, taskId);
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
		diffProvider: (root: string, intent: { scope_hint: unknown }) => diffHashOf(root, intent),
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

function diffHashOf(root: string, intent: { scope_hint?: unknown }): string {
	return taskDiffHash(root, intent.scope_hint);
}

// Translation-only adapter for the internal Kernel assurance projection. All
// freshness, approval, finding, claim, and authorization facts come from the
// Kernel module; this wrapper only binds the host diff provider.
function projectAssuranceState(root: string, taskId: string): Promise<AssuranceProjectionResult> {
	return projectAssurance(root, taskId, diffHashOf);
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
	if (snapshot.missing_acceptance_ids.length > 0) {
		findings.push({
			id: qaEvidenceFreshnessId(snapshotDigest(snapshot)),
			kind: "blocking",
			acceptance_id: null,
			summary: `executor evidence must be refreshed in working phase for acceptance ids: ${snapshot.missing_acceptance_ids.join(",")}`,
			findings_digest: "",
		});
	} else {
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
		fresh.projection.phase !== snapshot.phase
	) {
		throw new Error("assurance snapshot changed before authority application");
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
			diffProvider: (root: string, intent: { scope_hint: unknown }) => diffHashOf(root, intent),
			now,
		}))) as unknown as { record: { phase: string } };
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
		diffProvider: (root: string, intent: { scope_hint: unknown }) => diffHashOf(root, intent),
		now,
	}));
}

async function buildAssuranceSnapshot(
	root: string,
	taskId: string,
	role: AssuranceRole,
	projection: AssuranceProjectionResult,
	runner: FrozenRunner,
): Promise<{ snapshot: SnapshotDescriptor; descriptors: Map<string, VerificationDescriptor>; reviewBundle: ReviewBundle | null }> {
	const record = await readTaskRecordV2(root, taskId);
	if (
		!record.record ||
		record.revision !== projection.projection.record_revision ||
		record.record.intent_revision !== projection.projection.intent_revision ||
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
	const reviewBundle = role === "review"
		? captureReviewBundle(
				root,
				intent.scope_hint,
				projection.projection.diff_hash,
				Object.fromEntries(
					record.record.evidence.map((ev) => [ev.acceptance_id, { status: ev.status, summary: ev.summary }]),
				),
			)
		: null;
	const taskSnapshot = reviewBundle ? null : captureGitTaskSnapshot(root, intent.scope_hint);
	const dirtyFiles = reviewBundle
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
				phase: projection.projection.phase,
				risk: intent.risk,
				fresh_acceptance_ids: projection.projection.fresh_acceptance_ids,
				missing_acceptance_ids: projection.projection.missing_acceptance_ids,
				stale_evidence_ids: projection.projection.stale_evidence_ids,
				acceptance,
				dirty_files: dirtyFiles,
				review_bundle_digest: reviewBundle?.bundle_digest ?? null,
		}),
		descriptors,
		reviewBundle,
	};
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
		return await app.execute({
			root: ctx.cwd,
			task_id: input.taskId,
			operation: operation as never,
			prior_intent_token: priorIntent.token,
			diffProvider: (root: string, intent: { scope_hint: unknown }) => diffHashOf(root, intent),
			now: new Date().toISOString(),
		});
	} catch (error) {
		if (priorBytes) {
			const current = await readTaskRecordV2(ctx.cwd, input.taskId);
			if (current.record?.intent_revision === priorIntent.intent.revision) writeFileSync(sidecar, priorBytes);
		}
		throw error;
	}
}

type AssuranceTaskState = AssuranceProjectionResult["projection"] | { error: string };

async function enrichAssuranceResult(
	ctx: ExtensionContext,
	taskId: string,
	result: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const projection = await projectAssuranceState(ctx.cwd, taskId);
	const taskState: AssuranceTaskState = projection.error
		? { error: projection.error }
		: projection.projection;
	return {
		...result,
		task_state: taskState,
		next_action: nextActionForAssuranceResult(result, taskState),
	};
}

function nextActionForAssuranceResult(result: Record<string, unknown>, taskState: AssuranceTaskState): string {
	if ("error" in taskState) return "inspect authority state";
	if (taskState.phase === "done" || taskState.phase === "stopped") return "none";
	switch (result.state) {
		case "review_ready": return "invoke the reserved foreground Agent";
		case "awaiting_user": return "request_authorization";
		case "applied": return taskState.completion_ready ? "complete task" : statusNextAction(taskState);
		case "completed":
		case "stopped": return "none";
		case "rework": return "repair findings and record fresh evidence";
		case "cancelled": return "retry the interrupted foreground operation";
		case "settlement_unknown": return "inspect authority state";
		case "blocked":
		case "failed":
		default: return statusNextAction(taskState);
	}
}

function statusNextAction(state: {
	phase: string;
	missing_acceptance_ids: string[];
	blocking_finding_ids: string[];
	unresolved_user_decision_ids: string[];
	replan_required_ids: string[];
	completion_ready: boolean;
}): string {
	if (state.phase === "done" || state.phase === "stopped") return "none";
	if (state.missing_acceptance_ids.length > 0) return "record remaining acceptance evidence";
	if (
		state.blocking_finding_ids.length > 0
		|| state.unresolved_user_decision_ids.length > 0
		|| state.replan_required_ids.length > 0
	) return "resolve blocking assurance state";
	if (state.completion_ready) return "complete task";
	return "advance assurance";
}

function toolResult(text: string, details?: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
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
	PendingReviewVerdict,
	QaVerificationProgress,
	SnapshotDescriptor,
} from "./pi-canary-assurance-progression";
