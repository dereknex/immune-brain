import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { randomUUID } from "node:crypto";
import { claimProcess, copySource } from "./single-copy";
import { LaneSupervisor, type ExecutorPreferences } from "../runtime/unattended/lane_supervisor";
import { readSettledTaskEvidence } from "../runtime/kernel/storage";
import {
	type BatchRunnerKernelPort,
	type BatchRunReport,
	type BatchTrackerPort,
} from "../runtime/unattended/batch_runner";
import { type BatchRunnerGitPort, advanceNativeParent } from "../runtime/unattended/batch_git";
import type { InitiativeObservationReader } from "../runtime/unattended/types";
import { piEntryToken, piRunEntryRefusal } from "./imm-canary-work";
import type { RunEntryManifest } from "../runtime/unattended/run_entry_manifest";
import { batchReason } from "../runtime/unattended/batch_reasons";
import { parseFinalVerification } from "../runtime/unattended/batch_final_verification";
import type { ReviewProfile } from "../runtime/config/layered_config";
import {
	parseLaneInstruction,
	parseLaneSessionClose,
	type LaneInstructionRequest,
	type LaneSessionCloseRequest,
	parseLaneOffers,
	parseMaxParallel,
	resolveLaneParallel,
	type LaneOffer,
} from "../runtime/unattended/batch_lanes";
import { type BatchLaneRunReport, reviewProfileFromArgs } from "../runtime/unattended/batch_state";
import {
	presentTaskRail,
	renderStructuredCall,
	renderStructuredResult,
	requestAuthorityDialog,
} from "./pi-canary-interaction";
import { throwToolFailure } from "./pi-canary-tool-failure";
import {
	type ToolMeta,
} from "../runtime/host-core/runtime";
import {
	type NativeConfirmationInput,
	NativeAuthorityError,
} from "../runtime/host-core/interaction";
import { PI_LANE_WAIT_MS, piLaneSupervisor, PiRuntime } from "./pi-host-runtime";

export { PI_LANE_WAIT_MS, piLaneSupervisor };
const defaultSupervisor = piLaneSupervisor;

export async function readSettledTaskRecord(
	root: string,
	taskId: string,
): Promise<{ scope_hint: string[]; intent_path: string | undefined } | null> {
	const settled = readSettledTaskEvidence(root, taskId);
	if (!settled) return null;
	return {
		scope_hint: settled.record.intent_snapshot.scope_hint ?? [],
		intent_path: settled.record.intent_ref?.path,
	};
}

export function mapDialogSelection(selected: string | undefined): "accept" | "decline" | "cancel" {
	if (selected === "confirm") return "accept";
	if (selected === "decline") return "decline";
	return "cancel";
}

function nonInteractiveRefusal(): { reason: string; recovery_action: string } {
	return {
		reason: "interactive TUI elicitation is unavailable in non-interactive mode",
		recovery_action: "invoke through an interactive Pi TUI session in the current Host",
	};
}

export interface PiBatchExecutionOptions {
	root: string;
	initiativeSlug?: string;
	taskId?: string;
	stop?: boolean;
	executor?: ExecutorPreferences;
	supervisor?: LaneSupervisor;
	interactive?: boolean;
	reuseOnly?: boolean;
	signal?: AbortSignal;
	max_parallel?: number;
	lane_offers?: LaneOffer[];
	final_verification?: string[];
	/** Lane mode: the Review profile fixed when a new batch starts (#426 F14). */
	review_profile?: ReviewProfile;
	/** Lane mode: one instruction for an idle Lane session, recorded before it is sent. */
	lane_instruction?: LaneInstructionRequest;
	/** Lane mode: the Executor close rule for an integrated child's session, recorded before the close. */
	lane_session_close?: LaneSessionCloseRequest;
	batchKernel?: Partial<BatchRunnerKernelPort>;
	batchGit?: BatchRunnerGitPort;
	batchTracker?: BatchTrackerPort;
	readInitiative?: InitiativeObservationReader;
	runtime?: PiRuntime;
	sessionId?: string;
	toolCallId?: string;
	confirmBatch?: (details: {
		title: string;
		summary: string;
		details: string;
		planDigest: string;
		signal?: AbortSignal;
	}) => Promise<"accept" | "decline" | "cancel">;
}

export type PiBatchExecutionResult =
	| NonNullable<Awaited<ReturnType<typeof advanceNativeParent>>>
	| { state: "started"; batch_id: string; report: BatchRunReport; manifest?: RunEntryManifest }
	| { state: "rejected"; reason: string; recovery_action: string }
	| { state: "cancelled"; reason: string; recovery_action: string }
	| { state: "blocked"; reason: string; recovery_action: string };

export async function executePiUnattendedBatch(
	options: PiBatchExecutionOptions,
): Promise<PiBatchExecutionResult> {
	if (Object.hasOwn(options, "lane_revision")) throw new Error("unknown parameter: lane_revision");
	if (!!options.initiativeSlug === !!options.taskId) return batchReason("batch_entry_ambiguous");

	const initiativeSlug = (options.taskId ?? options.initiativeSlug)!;
	const isSingleTask = Boolean(options.taskId);

	const reuseOnly = options.reuseOnly === true;
	const interactive = options.interactive ?? true;
	if (!reuseOnly && !interactive) return { state: "rejected", ...nonInteractiveRefusal() };

	let resolvedParallel: number | undefined;
	try {
		resolvedParallel = isSingleTask
			? 1
			: resolveLaneParallel(options.root, initiativeSlug, options.max_parallel, options.lane_offers, options.lane_instruction);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.startsWith("batch_record_shape_retired")) {
			return batchReason("batch_record_shape_retired");
		}
		if (message.startsWith("lane_offers_retired")) {
			return { state: "rejected", reason: message, recovery_action: "New batches create their own Lanes." };
		}
		throw error;
	}

	const runtime = options.runtime ?? new PiRuntime({
		cwd: options.root,
		interactive,
		supervisor: options.supervisor ?? defaultSupervisor,
		batchKernel: options.batchKernel,
		batchGit: options.batchGit,
		batchTracker: options.batchTracker,
		readInitiative: options.readInitiative,
		requestConfirmation: options.confirmBatch ? async (input: NativeConfirmationInput) => {
			let decision: "accept" | "decline" | "cancel" = "cancel";
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
						...(b.final_verification ?? []).map((cmd: string) => `  - ${cmd}`),
					].join("\n")
					: [
						`Initiative: ${b.initiative_slug}`,
						`Batch branch: ${b.batch_branch}`,
						`Plan digest: ${input.planDigest ?? ""}`,
						...(input.intentRevision ? [`TaskIntent revision: ${input.intentRevision}`, `TaskIntent content hash: ${input.intentContentHash ?? ""}`, `Preparation digest: ${input.bindingDigest ?? ""}`] : []),
						...(b.budget ? [`Budget: max_children=${b.budget.max_children}, qa_failure_limit=${b.budget.qa_failure_limit}`] : []),
						...(b.lane_mode ? [`Lane mode: max_parallel=${b.lane_mode.max_parallel}`] : []),
						...(b.final_verification ? [`Final verification: ${b.final_verification.join("; ")}`] : []),
						...(b.lane_mode?.review_profile ? [`Review: ${[b.lane_mode.review_profile.host, b.lane_mode.review_profile.model, b.lane_mode.review_profile.effort].filter(Boolean).join(" / ")}`] : []),
					].join("\n");
				const details = isParent
					? `Parent Tasks (${b.children.length}):\n${b.children.map((c: any) => `  - ${c.task_id} (${c.slice_id})`).join("\n")}`
					: [
						`Ordered children (${b.children.length}):\n${b.children.map((c: any) => `  - ${c.task_id} (${c.slice_id}) [risk: ${c.risk ?? "unknown"}]`).join("\n")}`,
						...(b.excluded.length > 0 ? [`\nExcluded children:\n${b.excluded.map((c: any) => `  - ${c.task_id} (${c.slice_id}): ${c.reason}`).join("\n")}`] : []),
						...(b.lane_mode ? [
							`\nParallel groups (${b.lane_mode.parallel_groups.length}):\n${b.lane_mode.parallel_groups.map((g: string[]) => `  - ${g.join(", ")}`).join("\n")}`,
							...(b.lane_mode.serialized.length > 0 ? [`\nSerialized by overlapping scope:\n${b.lane_mode.serialized.map((c: any) => `  - ${c.task_id} after ${c.overlaps_with.join(", ")}`).join("\n")}`] : []),
						] : []),
						...(b.re_confirmation_required?.length ? [`\nRe-confirmation required: ${b.re_confirmation_required.join(", ")}.\nRecovery: confirm to issue a fresh authorization bound to the current plan and HEAD.`] : []),
					].join("\n");

				decision = await options.confirmBatch!({
					title,
					summary,
					details,
					planDigest: input.planDigest ?? "",
					signal: input.signal,
				});
			}
			return {
				decision: decision === "accept" ? "accept" : decision === "decline" ? "decline" : "cancel",
				requestId: randomUUID(),
			};
		} : undefined,
	});

	const meta: ToolMeta = {
		taskId: initiativeSlug,
		sessionId: options.sessionId ?? "pi-batch",
		toolCallId: options.toolCallId ?? (options.stop ? "call-stop-lane" : "call-start-unattended-batch"),
		signal: options.signal,
		interactive,
	};

	try {
		const result = await runtime.startUnattendedBatch(initiativeSlug, meta, {
			plan_source: isSingleTask ? ("single_task" as const) : undefined,
			stop: options.stop,
			executor: options.executor,
			reuseOnly: options.reuseOnly,
			max_parallel: resolvedParallel,
			lane_offers: options.lane_offers,
			final_verification: options.final_verification,
			review_profile: options.review_profile,
			lane_instruction: options.lane_instruction,
			lane_session_close: options.lane_session_close,
		});
		return result as PiBatchExecutionResult;
	} catch (error) {
		if (error instanceof NativeAuthorityError) {
			if (error.reasonCode === "user_cancelled") {
				return { state: "cancelled", reason: error.message, recovery_action: error.recoveryAction };
			}
			return { state: "rejected", reason: error.message, recovery_action: error.recoveryAction };
		}
		throw error;
	}
}

export type PiRetireStaleBatchResult =
	| { state: "retired"; batch_id: string; report: BatchRunReport | BatchLaneRunReport }
	| { state: "rejected"; reason: string; recovery_action: string }
	| { state: "cancelled"; reason: string; recovery_action: string }
	| { state: "blocked"; reason: string; recovery_action: string };

export async function executePiRetireStaleBatch(options: {
	root: string;
	initiativeSlug: string;
	signal?: AbortSignal;
	toolCallId?: string;
	sessionId?: string;
	entryToken?: string | null;
	runtime?: PiRuntime;
	confirmBatch: (details: { title: string; summary: string; details: string; signal?: AbortSignal }) => Promise<"accept" | "decline" | "cancel">;
}): Promise<PiRetireStaleBatchResult> {
	const runtime = options.runtime ?? new PiRuntime({
		cwd: options.root,
		interactive: true,
		requestConfirmation: async (input: NativeConfirmationInput) => {
			let decision: "accept" | "decline" | "cancel" = "cancel";
			if (input.batchDisposition) {
				const d = input.batchDisposition;
				const title = `Retire Stale Batch Record: ${options.initiativeSlug}`;
				const summary = [
					`Initiative: ${options.initiativeSlug}`,
					`Batch ID: ${d.batch_id}`,
					`State: ${d.batch_state}`,
					`Batch branch: ${d.batch_branch}`,
					`Plan digest: ${d.plan_digest}`,
					`Recorded commits: ${d.recorded_commits}`,
				].join("\n");
				const details = `Children (${d.children.length}):\n${d.children.map((c: any) => `  - ${c.task_id} (${c.slice_id}): state=${c.state}, commit=${c.commit ?? "none"}, lane=${c.lane_branch ?? "none"}, lifecycle=${c.kernel_lifecycle ?? "none"}`).join("\n")}`;

				decision = await options.confirmBatch({
					title,
					summary,
					details,
					signal: input.signal,
				});
			}
			return {
				decision: decision === "accept" ? "accept" : decision === "decline" ? "decline" : "cancel",
				requestId: randomUUID(),
			};
		},
	});

	const meta: ToolMeta = {
		taskId: options.initiativeSlug,
		sessionId: options.sessionId ?? "pi-retire-batch",
		toolCallId: options.toolCallId ?? "call-retire-stale-batch",
		signal: options.signal,
		entryToken: options.entryToken ?? undefined,
		interactive: true,
	};

	try {
		const result = await runtime.retireStaleBatch(options.initiativeSlug, meta);
		return result as PiRetireStaleBatchResult;
	} catch (error) {
		if (error instanceof NativeAuthorityError) {
			if (error.reasonCode === "user_cancelled") {
				return { state: "cancelled", reason: error.message, recovery_action: error.recoveryAction };
			}
			return { state: "rejected", reason: error.message, recovery_action: error.recoveryAction };
		}
		throw error;
	}
}

export interface PiBatchExtensionDependencies {
	runtime?: PiRuntime;
	readInitiative?: InitiativeObservationReader;
	batchKernel?: Partial<BatchRunnerKernelPort>;
	batchGit?: BatchRunnerGitPort;
}

export default function (
	pi: ExtensionAPI,
	dependencies: PiBatchExtensionDependencies = {},
) {
	// A second copy of the plugin in this process registers nothing (C-1); the
	// notice comes from this copy's other factory.
	if (!claimProcess(copySource(import.meta.url)).active) return;
	const supervisor = piLaneSupervisor;
	pi.registerTool({
		name: "start_unattended_batch",
		label: "Start unattended batch",
		description: "Start an unattended Lane batch for an Initiative or a single TaskIntent after native confirmation.",
		promptSnippet: "Start unattended batch run: invoke once in foreground after plan confirmation.",
		promptGuidelines: [
			"Call only inside an explicit drive entry, after plan confirmation; execute once in the foreground and consume the direct terminal result.",
			"Do not run this Tool in background, poll for completion, or issue a cancel subcommand.",
		],
		parameters: Type.Object({
			initiative_slug: Type.Optional(Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" })),
			task_id: Type.Optional(Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" })),
			stop: Type.Optional(Type.Boolean()),
			executor_host: Type.Optional(Type.Union([Type.Literal("pi"), Type.Literal("claude-code"), Type.Literal("antigravity")])),
			executor_model: Type.Optional(Type.String({ minLength: 1 })),
			executor_effort: Type.Optional(Type.String({ minLength: 1 })),
			review_host: Type.Optional(Type.Union([Type.Literal("pi"), Type.Literal("claude-code"), Type.Literal("antigravity")])),
			review_model: Type.Optional(Type.String({ minLength: 1 })),
			review_effort: Type.Optional(Type.String({ minLength: 1 })),
			// Integer minimum 1 as Claude Code declares it; multipleOf keeps the schema constructors to Number.
			max_parallel: Type.Optional(Type.Number({ minimum: 1, multipleOf: 1 })),
			lane_offers: Type.Optional(Type.Array(
				Type.Object({ task_id: Type.String(), path: Type.String() }, { additionalProperties: false }),
			)),
			final_verification: Type.Optional(Type.Array(Type.String(), { maxItems: 8 })),
			lane_instruction: Type.Optional(Type.Object({
				task_id: Type.String(),
				kind: Type.Optional(Type.Union([Type.Literal("instruction"), Type.Literal("correction")])),
				text: Type.String(),
				session_state: Type.Union([Type.Literal("idle"), Type.Literal("working"), Type.Literal("blocked"), Type.Literal("done")]),
			}, { additionalProperties: false })),
			lane_session_close: Type.Optional(Type.Object({ task_id: Type.String() }, { additionalProperties: false })),
		}, { additionalProperties: false }),
		execute: async (
			_toolCallId: string,
			params: { initiative_slug?: string; task_id?: string; stop?: boolean; executor_host?: "pi" | "claude-code" | "antigravity"; executor_model?: string; executor_effort?: string; review_host?: "pi" | "claude-code" | "antigravity"; review_model?: string; review_effort?: string; max_parallel?: number; lane_offers?: Array<{ task_id: string; path: string }>; final_verification?: string[]; lane_instruction?: unknown; lane_session_close?: unknown },
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		) => {
			if (Object.hasOwn(params, "lane_revision")) throw new Error("unknown parameter: lane_revision");
			const initiativeSlug = params.task_id ?? params.initiative_slug ?? "";
			if (ctx.mode !== "tui") {
				const refusal = nonInteractiveRefusal();
				throwToolFailure({
					tool: "start_unattended_batch",
					task_id: initiativeSlug,
					operation: "start_unattended_batch",
					state: "blocked",
					code: "unsupported_host",
					message: refusal.reason,
					next_action: refusal.recovery_action,
				});
			}
			const entryRefusal = piRunEntryRefusal("start_unattended_batch", ctx);
			if (entryRefusal)
				throwToolFailure({
					tool: "start_unattended_batch",
					task_id: initiativeSlug,
					operation: "start_unattended_batch",
					state: "blocked",
					code: entryRefusal.reason_code,
					message: entryRefusal.detail,
					next_action: entryRefusal.recovery_action,
				});

			const maxParallel = parseMaxParallel(params.max_parallel);
			const laneOffers = parseLaneOffers(params.lane_offers);
			const finalVerification = params.final_verification?.length === 0 ? undefined : parseFinalVerification(params.final_verification);
			const reviewProfile = reviewProfileFromArgs(params);
			const laneInstruction = parseLaneInstruction(params.lane_instruction);
			const laneSessionClose = parseLaneSessionClose(params.lane_session_close);

			const result = await executePiUnattendedBatch({
				root: ctx.cwd,
				...(params.initiative_slug ? { initiativeSlug: params.initiative_slug } : {}),
				...(params.task_id ? { taskId: params.task_id } : {}),
				...(params.stop ? { stop: true } : {}),
				executor: { executor_host: params.executor_host, executor_model: params.executor_model, executor_effort: params.executor_effort },
				supervisor,
				...(maxParallel !== undefined ? { max_parallel: maxParallel } : {}),
				...(laneOffers !== undefined ? { lane_offers: laneOffers } : {}),
				...(finalVerification !== undefined ? { final_verification: finalVerification } : {}),
				...(reviewProfile !== undefined ? { review_profile: reviewProfile } : {}),
				...(laneInstruction !== undefined ? { lane_instruction: laneInstruction } : {}),
				...(laneSessionClose !== undefined ? { lane_session_close: laneSessionClose } : {}),
				interactive: ctx.mode === "tui",
				signal,
				toolCallId: _toolCallId,
				sessionId: (ctx as any).sessionManager?.getSessionId?.() ?? "pi-batch",
				runtime: dependencies.runtime,
				readInitiative: dependencies.readInitiative,
				batchKernel: dependencies.batchKernel,
				batchGit: dependencies.batchGit,
				confirmBatch: async (details) => {
					presentTaskRail(ctx, {
						task_id: initiativeSlug,
						state: "Approval required",
						result: details.title,
						next: "Review batch plan evidence",
					});
					const selected = await requestAuthorityDialog(
						pi,
						ctx,
						{
							attention_id: randomUUID(),
							task_id: initiativeSlug,
							reason: "enrollment",
							label: details.title,
						},
						{
							title: details.title,
							summary: details.summary,
							details: details.details,
							signal: details.signal,
							actions: [
								{ value: "confirm", label: "Authorize batch run", description: "Start the unattended Lane batch run" },
								{ value: "decline", label: "Decline batch", description: "Reject this batch authorization; repository and authority stay unchanged" },
								{ value: "cancel", label: "Cancel", description: "Leave repository and authority unchanged" },
							],
						},
					);
					return mapDialogSelection(selected);
				},
			});

			if (result.state !== "started" && result.state !== "native_parent") {
				const failureState = result.state === "blocked" ? "blocked" : "failed";
				throwToolFailure({
					tool: "start_unattended_batch",
					task_id: initiativeSlug,
					operation: "start_unattended_batch",
					state: failureState,
					code: `batch_${result.state}`,
					message: result.reason,
					next_action: result.recovery_action,
				});
			}

			return {
				content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
				details: result,
			};
		},
		renderCall(args, theme) {
			const params = args as { initiative_slug?: string; task_id?: string };
			return renderStructuredCall("start_unattended_batch", "start", params.task_id ?? params.initiative_slug, theme);
		},
		renderResult(result, _options, theme) {
			return renderStructuredResult(
				result as Parameters<typeof renderStructuredResult>[0],
				theme,
			);
		},
	});

	pi.registerTool({
		name: "retire_stale_batch",
		label: "Retire stale batch",
		description: "Retire an Initiative's parked or drifted batch record to the terminal superseded state after native confirmation.",
		promptSnippet: "Retire stale batch: invoke once in foreground after the stale batch record is inspected.",
		promptGuidelines: [
			"Call only after inspecting the batch record; execute once in the foreground and consume the direct terminal result.",
			"Do not run this Tool in background, poll for completion, or issue a cancel subcommand.",
		],
		parameters: Type.Object({
			initiative_slug: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
		}, { additionalProperties: false }),
		execute: async (
			toolCallId: string,
			params: { initiative_slug: string },
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		) => {
			const { initiative_slug: initiativeSlug } = params;
			if (ctx.mode !== "tui") {
				const refusal = nonInteractiveRefusal();
				throwToolFailure({
					tool: "start_unattended_batch",
					task_id: initiativeSlug,
					operation: "retire_stale_batch",
					state: "blocked",
					code: "unsupported_host",
					message: refusal.reason,
					next_action: refusal.recovery_action,
				});
			}
			const entryRefusal = piRunEntryRefusal("retire_stale_batch", ctx);
			if (entryRefusal)
				throwToolFailure({
					tool: "start_unattended_batch",
					task_id: initiativeSlug,
					operation: "retire_stale_batch",
					state: "blocked",
					code: entryRefusal.reason_code,
					message: entryRefusal.detail,
					next_action: entryRefusal.recovery_action,
				});

			const result = await executePiRetireStaleBatch({
				root: ctx.cwd,
				initiativeSlug,
				signal,
				toolCallId,
				sessionId: (ctx as any).sessionManager?.getSessionId?.() ?? "pi-retire-batch",
				runtime: dependencies.runtime,
				entryToken: piEntryToken(ctx),
				confirmBatch: async (details) => {
					presentTaskRail(ctx, {
						task_id: initiativeSlug,
						state: "Approval required",
						result: details.title,
						next: "Review batch record evidence",
					});
					const selected = await requestAuthorityDialog(
						pi,
						ctx,
						{
							attention_id: randomUUID(),
							task_id: initiativeSlug,
							reason: "enrollment",
							label: details.title,
						},
						{
							title: details.title,
							summary: details.summary,
							details: details.details,
							signal: details.signal,
							actions: [
								{ value: "confirm", label: "Retire batch record", description: "Write the terminal superseded state and its report" },
								{ value: "decline", label: "Keep batch parked", description: "Leave the batch record and its authorization unchanged" },
								{ value: "cancel", label: "Cancel", description: "Leave repository and authority unchanged" },
							],
						},
					);
					return mapDialogSelection(selected);
				},
			});

			if (result.state !== "retired") {
				throwToolFailure({
					tool: "start_unattended_batch",
					task_id: initiativeSlug,
					operation: "retire_stale_batch",
					state: result.state === "blocked" ? "blocked" : "failed",
					code: `batch_${result.state}`,
					message: result.reason,
					next_action: result.recovery_action,
				});
			}
			return {
				content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
				details: result,
			};
		},
		renderCall(args, theme) {
			const params = args as { initiative_slug?: string };
			return renderStructuredCall("retire_stale_batch", "retire", params.initiative_slug, theme);
		},
		renderResult(result, _options, theme) {
			return renderStructuredResult(
				result as Parameters<typeof renderStructuredResult>[0],
				theme,
			);
		},
	});
}
